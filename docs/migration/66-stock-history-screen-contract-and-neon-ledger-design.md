# 66 — Contrato da tela de histórico e desenho do ledger Neon

Status: auditoria concluída + desenho técnico; **sem implementação ou aplicação de banco**.  
Branch: `migration/neon-preparation`. Escopo exclusivo do MobFlow PDV.

## 1. Contrato real da tela atual

Arquivo: `src/routes/movimentacoes-estoque.tsx`.

A tela lê diretamente `useStore(s => s.stockMovements ?? [])`. Hoje não consulta uma API paginada. A tela oferece:

- Operação: “Todas” ou um tipo específico. A lista inclui tipos comuns e também os tipos existentes nos registros.
- Movimento: todas, somente entradas (`delta > 0`), somente saídas (`delta < 0`) ou sem alteração (`delta === 0`).
- Pesquisa textual sem distinção de maiúsculas/minúsculas em nome do produto, código, operador e detalhes.
- Data inicial e final inclusivas, comparadas pela data local do dispositivo.
- Ordenação decrescente por `date`.
- Contador de registros após os filtros.
- Tabela com data/hora, operação, produto/código, quantidade, valor total, estoque antes/depois e variação.
- Modal de detalhe com operador, referência e `operationId`.

O botão “Limpar filtros” redefine o período para hoje, operação e movimento para “Todas” e limpa a pesquisa. O período inicial da tela também começa em hoje. Esses comportamentos são parte do contrato atual e precisam ser preservados, inclusive no mobile.

## 2. Implicações para a API de histórico

A API nova deve suportar os filtros sem mudar o significado:
- `operationType` opcional;
- `direction`: all / in / out / unchanged;
- `fromDate` e `toDate` interpretadas no fuso/local-date informado pelo cliente, com limites inclusivos;
- `search` aplicado a product_name_snapshot, product_code_snapshot, operator_snapshot e details;
- ordenação `occurred_at DESC, id DESC`;
- cursor composto para paginação estável;
- `totalCount` opcional apenas se eficiente; a tela não deve exigir contagem total cara em cada página.

O backend deve receber datas como datas civis (YYYY-MM-DD) e definir explicitamente o fuso usado para construir os limites. Não converter silenciosamente data local para UTC e deslocar o dia. A ordenação precisa incluir desempate por ID para duas movimentações no mesmo instante.

A API deve retornar o contrato de visualização equivalente ao `StockMovement`, incluindo snapshots, e não exigir que o produto ainda exista no catálogo.

## 3. Achados sobre o modelo legado e riscos de migração

Arquivo: `src/lib/store.ts`, função `normalizeState()`.

1. A tela pode apresentar registros reais e registros reconstruídos em memória. Os reconstruídos usam `legacy: true`.
2. As vendas legadas são reconstruídas por item da venda. O ID inclui índice do item, o que preserva produtos repetidos dentro de uma mesma venda.
3. Ajustes, baixas e transferências usam IDs legados por operação + produto. Se uma operação tiver mais de uma linha para o mesmo produto, essa estratégia pode colidir; validar se o modelo permite essa situação antes do backfill.
4. Recebimentos legados agregam linhas por produto. Essa agregação precisa ser reproduzida no backfill para não alterar a quantidade exibida.
5. Para movimentos legados sem saldo anterior/posterior, o código reconstrói os saldos retroativamente a partir do estoque atual e da lista de movimentos. Esses saldos são estimativas de compatibilidade, não evidência contábil histórica.
6. A verificação `knownMovementIds` é criada antes de acrescentar candidatos legados. IDs repetidos entre candidatos devem ser tratados explicitamente no processo de migração.
7. A ponte considera movimento real por `operationId` para evitar reconstrução. O backfill precisa aplicar a mesma regra de precedência, sem inferir que registros reais de um tipo cobrem automaticamente todos os itens de uma operação diferente.
8. O código de normalização também transforma recebimentos manuais antigos em registros de validade e os remove da coleção `receiving`; isso é contexto de compatibilidade e não deve ser confundido com movimento físico de estoque.

## 4. Fonte e transação: não confiar em um único caminho atual

O checkout, ajustes, baixa, transferência, balanço, importação e cadastro geram movimentos no frontend e persistem pelo snapshot `app_state`. Recebimento tem caminhos próprios e RPCs históricas no Supabase; há SQL legado que atualiza o JSON do app_state e agrega movimentos no mesmo estado. A migração para Neon não deve copiar esses caminhos de forma literal.

O desenho-alvo deve tornar a operação de domínio autoritativa no servidor:
- transação altera saldo relacional;
- mesma transação insere uma linha no livro-razão;
- mesma transação insere evento incremental;
- chave de idempotência retorna o resultado anterior em retry.

Não publicar movimento no ledger ao simplesmente salvar um snapshot inteiro. Isso transformaria sincronizações/reconciliações em falsas operações de estoque.

## 5. Proposta refinada de tabela

Tabela proposta: `public.stock_movements` (nome ainda sujeito ao padrão final do schema).

Colunas conceituais:
- `id uuid primary key` para novas linhas; para backfill, manter um mapeamento imutável do ID legado textual para UUID ou adotar ID textual compatível. A escolha deve ocorrer antes do DDL, não durante a importação.
- `tenant_id uuid not null references public.profiles(id)`;
- `operation_id text not null`, `operation_type text not null`;
- `line_key text not null` para identificar a linha dentro da operação, inclusive produto repetido;
- `product_id text/uuid nullable` conforme o futuro catálogo relacional; não inventar FK obrigatória que apague histórico;
- snapshots `product_code`, `product_name`, `unit`;
- `quantity numeric`, `delta numeric`, `stock_before numeric`, `stock_after numeric`;
- `total_value numeric(14,2)`;
- `operator_snapshot text`, `details text`;
- `occurred_at timestamptz`, `created_at timestamptz`;
- `source_kind` (ex.: live, legacy_real, legacy_reconstructed) e `source_legacy_id text` quando aplicável;
- `idempotency_key uuid` para comandos novos.

Não fixar ainda unidade, precisão numérica, FK do produto ou chave única até mapear o schema definitivo do catálogo e dos IDs. A migration 0001 cria `profiles` e `app_state`, mas não cria tabela relacional de produtos. O schema relacional do catálogo ainda é pré-requisito. O ledger deve manter snapshot de nome/código/unidade para sobreviver a renomeação ou exclusão do produto.

## 6. Chaves e backfill

Não usar somente `operation_id + product_id` como chave: vendas podem ter o mesmo produto em linhas distintas e recebimentos agregam linhas. Estratégia recomendada:
- Novas operações: `operation_id + line_key` determinístico, com `idempotency_key` no comando.
- Backfill de movimento real: preservar o ID de origem em `source_legacy_id`; chave de deduplicação baseada nesse ID dentro do tenant.
- Backfill de reconstruções: chave derivada do ID determinístico produzido por `normalizeState()`, guardando a origem/tipo de reconstrução.
- Registrar versão do algoritmo de reconstrução e hash do registro de origem para auditoria.
- Importar em lotes pequenos, com relatório de rejeições e reconciliação; nunca descartar silenciosamente colisões.

O processo deve primeiro gerar relatório de colisões de IDs e linhas repetidas sem escrever nada. Somente após revisão aprovada executar backfill no banco de teste.

## 7. Separação entre eventos e histórico

O ledger é a fonte de consulta auditável da tela. A tabela `mobflow_sync_events` é transporte incremental, ordenado por sequência e cursor. Uma transação de estoque escreve nos dois. O cliente pode atualizar uma projeção local com eventos, mas o histórico paginado não depende de baixar todos os eventos nem o snapshot inteiro.

A categoria `stock` da migration 0005 não deve ser tratada como linha de histórico. Evento pode representar atualização de estoque com payload compacto; ledger contém cada item e os campos necessários para auditoria e exibição.

## 8. Sequência segura de execução

1. Mapear schema de produtos/estoque relacional que será criado e contratos das operações.
2. Criar especificação final e DDL aditivo do ledger, sem aplicar.
3. Testar DDL e RLS no branch Neon isolado.
4. Implementar serviço transacional para uma operação por vez, começando por uma operação de risco controlável, sem desligar o snapshot.
5. Criar backfill read-only/relatório de colisões do JSON app_state.
6. Executar backfill apenas em Neon de teste, validar contagens e amostras.
7. Criar endpoint de leitura paginada e teste de equivalência da tela.
8. Executar leitura paralela em Preview e comparar resultados.
9. Migrar a tela somente após aprovação de equivalência e testes concorrentes.
10. Retirar movimentos do snapshot apenas depois de todos os produtores e consumidores estarem migrados.

## 9. Critérios de aceite

- Mesmos filtros, busca, período local inclusivo, ordenação e detalhes da tela atual.
- Histórico continua disponível após exclusão/renomeação do produto.
- Nenhum retry cria linha duplicada.
- Nenhum snapshot de sincronização cria movimentação.
- Venda, recebimento, ajuste, baixa, transferência, balanço, importação e cadastro geram ledger e evento na mesma transação.
- Backfill repetido é idempotente; colisões são reportadas.
- Registros reconstruídos são identificáveis como reconstruídos e não são apresentados como saldos históricos exatos.
- Paginação não perde nem repete itens com timestamps iguais.
- RLS impede leitura/escrita entre empresas.
- Falha em qualquer parte reverte saldo, ledger e evento juntos.

## 10. O que foi e não foi feito

Concluída nesta etapa: inspeção da tela, filtros, ordenação, modal, normalização de legado e baseline Neon.  
Não feito: DDL, backfill, endpoint, reducer, mudança de tela, alteração de runtime, aplicação de migration ou acesso a produção. MobFlow Admin e ColetaFlow não foram tocados.
