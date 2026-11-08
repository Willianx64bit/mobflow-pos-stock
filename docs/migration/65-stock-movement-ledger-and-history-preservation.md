# 65 — Livro-razão de movimentações e preservação do histórico

Status: auditoria e desenho; **não implementado**.  
Escopo: MobFlow PDV na branch `migration/neon-preparation`.  
Nenhuma alteração em runtime, banco, produção, MobFlow Admin ou ColetaFlow.

## 1. Descoberta importante: o histórico atual não é uma tabela SQL independente

A tela Operações → Histórico de movimentação do estoque consome a coleção `stockMovements` do estado do PDV. O tipo está definido em `src/lib/store.ts`:

- `id`, `operationId`, `date`, `type`;
- `productId`, `productCode`, `productName`, `unit`;
- `quantity`, `totalValue`;
- `stockBefore`, `stockAfter`, `delta`;
- `operator`, `details`, `legacy`.

Hoje essa coleção faz parte do JSON `app_state.state`, não de uma tabela relacional própria no Neon. Portanto, a futura migração deve extrair e preservar os registros antes de retirar `stockMovements` do snapshot. Não assumir que já existe uma tabela SQL de histórico.

## 2. Origens que já geram movimentações no store

A auditoria do código identificou pelo menos estas origens:
- venda (`checkout`);
- cadastro de produto com estoque inicial;
- alteração manual de estoque no cadastro;
- importação de produtos;
- edição direta do campo estoque;
- ajuste/balanço em lote;
- baixa por perda, consumo ou doação;
- transferência;
- conferência finalizada com ajuste;
- recebimento de mercadoria.

Os nomes e detalhes são parte da experiência da tela atual e devem ser preservados. A lista acima é o inventário identificado no store, não uma autorização para remover ou renomear categorias. Antes de implementar, conferir os métodos restantes e os filtros/relatórios da tela.

## 3. Registros históricos legados

`normalizeState()` reconstrói movimentações antigas a partir de vendas, ajustes, baixas, transferências e recebimentos quando não encontra um registro não-legado associado à operação. Esses itens recebem `legacy: true`, IDs determinísticos com prefixo `legacy:` e valores de saldo reconstruídos retrospectivamente quando necessário.

Regras obrigatórias:
- Não converter essas reconstruções em novas movimentações operacionais.
- Não publicar eventos de sincronização para os registros `legacy` como se fossem ações novas.
- Não duplicar um registro quando uma operação já possuir movimentação real.
- Preservar IDs, data, tipo, descrição, operador, quantidade e valores disponíveis.
- Identificar explicitamente os dados que foram estimados/reconstruídos, sem apresentá-los como saldo histórico comprovado.
- A importação deve ser idempotente: executar duas vezes não pode duplicar linhas.

## 4. Arquitetura proposta: livro-razão relacional

Criar uma tabela canônica dedicada (nome sugerido: `public.stock_movements`) separada de `mobflow_sync_events`.

Campos conceituais:
- `id` UUID ou identificador estável compatível com IDs históricos;
- `tenant_id` e `actor_profile_id` para isolamento e autoria;
- `operation_id` e `operation_type` para rastrear a origem;
- `product_id` e snapshots de código/nome/unidade;
- `movement_type` e `details`;
- `quantity`, `delta`, `stock_before`, `stock_after`;
- `total_value`;
- `occurred_at` (data/hora de negócio) e `created_at` (registro no servidor);
- `is_legacy` e metadados de proveniência/reconstrução quando aplicável.

Restrições e índices:
- chave única de idempotência adequada a tenant + operação + item + tipo;
- índice por tenant e data desc para a tela;
- índice por tenant + produto + data desc para consulta do histórico de um produto;
- índice por tenant + operation_id para abrir a operação que originou o movimento;
- RLS/escopo tenant em todas as consultas;
- valores numéricos com precisão compatível com unidade fracionada (kg), sem usar float para cálculos monetários.

A chave definitiva e tipos de coluna devem ser definidos após conferir o esquema relacional de produtos e a estratégia de IDs do Neon. Não aplicar DDL nesta etapa.

## 5. Relação entre livro-razão e eventos de sincronização

São responsabilidades diferentes:
- `stock_movements`: registro histórico completo e auditável para a tela Operações.
- `mobflow_sync_events`: envelope incremental e ordenado para notificar/aplicar alterações nos dispositivos.

Uma operação de estoque deve gravar, na mesma transação:
1. alteração do saldo do produto;
2. movimento no livro-razão;
3. evento incremental mínimo;
4. chave idempotente/resultado da operação.

O evento não substitui o movimento e não deve carregar todos os dados pessoais ou históricos desnecessários. O reducer do cliente pode atualizar uma projeção local, mas o histórico paginado deve poder consultar o livro-razão autorizado no servidor.

## 6. Consistência e proteção contra duplicação

- Cada comando de domínio gera um `operationId` estável no dispositivo, persistido durante tentativas offline.
- Cada item de movimento tem identidade determinística dentro da operação.
- Repetir o mesmo comando retorna o resultado original e não cria outro movimento.
- Um retry com mesma chave e payload diferente deve ser rejeitado.
- Atualização de saldo, movimento e evento confirmam ou revertem juntos.
- Movimentos registrados não devem ser editados/apagados pelo fluxo comum; correções devem ser novas movimentações compensatórias, mantendo trilha de auditoria.
- Exclusão de produto não pode apagar seu histórico; manter snapshots de código/nome/unidade e política de referência apropriada.

## 7. Compatibilidade com a tela atual

A tela deve continuar exibindo os mesmos dados e significados:
- filtros por período, tipo, produto e operador, conforme implementados atualmente;
- ordenação mais recente primeiro;
- saldo anterior/posterior e variação;
- detalhes e identificação da operação;
- quantidades fracionadas para kg;
- totais/valores com a mesma regra de arredondamento.

A futura API de histórico deve ser tenant-scoped e paginada. Não carregar todo o livro-razão a cada polling ou a cada abertura do PDV. A primeira página e filtros devem ser buscados sob demanda; paginação deve usar cursor estável (data + ID), não offset sem ordenação determinística.

## 8. Plano de migração dos dados existentes

1. Ler o `app_state` por tenant em modo somente leitura.
2. Normalizar o estado com a mesma regra de legado usada pelo cliente, em processo de migração controlado e versionado.
3. Produzir relatório de contagem por tipo, período e origem; registrar quantos itens são reais e quantos são reconstruídos.
4. Importar para a tabela nova com IDs estáveis e upsert idempotente.
5. Comparar contagem, somatórios e amostras por tenant entre snapshot e livro-razão.
6. Fazer leitura paralela em Preview: comparar a tela antiga com a consulta nova sem mudar a origem oficial.
7. Só depois de reconciliação aprovada, mudar a tela para a API do Neon.
8. Manter rollback de leitura ao snapshot até validar integridade e desempenho; não apagar a coleção antiga durante a primeira fase.

## 9. Testes obrigatórios

- Migração repetida não duplica registros.
- Venda repetida por timeout não duplica movimento.
- Estoque e movimento confirmam/revertem juntos.
- Duas vendas concorrentes no mesmo produto não produzem saldos/movimentos inconsistentes.
- Ajuste, balanço, baixa, transferência, importação, cadastro inicial, recebimento e conferência mantêm tipos e detalhes.
- Registros `legacy` são preservados e não viram novas operações.
- Histórico permanece disponível após exclusão/arquivamento de produto.
- Isolamento entre tenants e paginação sem perda/duplicação.
- Filtros e ordenação equivalentes à tela atual.
- Unidade kg, valores e arredondamentos preservados.

## 10. Limites e próximos passos

Este documento não implementa tabela, endpoint, backfill ou alteração de tela. Próxima etapa: mapear a tela de histórico e seus filtros, conferir o schema relacional atual de produtos/identidade no Neon, e então especificar a migration e API do livro-razão. A migração de vendas deve usar o mesmo livro-razão, mas não deve ser implementada antes de validar os contratos e regras de negócio.
