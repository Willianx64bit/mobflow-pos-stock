# Doc 81 — Contrato da primeira fatia: catálogo de produtos no Neon

**Branch:** `migration/neon-preparation`  
**Status:** contrato técnico proposto; nenhuma API ou tela alterada.  
**Escopo:** MobFlow PDV somente. Supabase continua fallback até aceite do Preview.

## 1. Diagnóstico confirmado no código atual

- `Product` em `src/lib/store.ts` contém `id`, `code`, `barcodes?`, `ref?`, `name`, `price`, `cost?`, `stock`, `minStock`, `category`, `unit` e `photo?`.
- `saveProduct` cria/edita produto no estado local e chama persistência genérica do snapshot.
- Ao alterar saldo pelo cadastro, o cliente cria movimento manual no próprio estado.
- Ao cadastrar produto com saldo inicial positivo, o cliente cria movimento de cadastro.
- `deleteProduct` remove produto e também remove o item do carrinho local.
- `importProducts` faz importação/atualização em lote diretamente no estado.
- Não foi encontrado endpoint dedicado `/api/mobflow/products` nem `/catalog` nos caminhos verificados.
- O snapshot `PUT /api/mobflow/state` continua sendo a gravação cloud normal e o polling de 3 segundos continua ativo.
- O draft 0006 contém `products` e `product_barcodes`, mas ainda não foi aplicado.

**Conclusão:** não é seguro simplesmente apontar o frontend para uma nova tabela. Cadastro, edição, importação, exclusão e ajuste de estoque estão acoplados ao snapshot e ao ledger local. A primeira entrega deve separar comandos de catálogo de operações de saldo.

## 2. Princípio de domínio

Produto é cadastro; saldo é estado operacional. Alterar nome/preço/categoria não pode gerar movimento de estoque. Alterar saldo não deve ser escondido dentro de um PATCH genérico de produto.

Separar:
- cadastro: criar/editar dados não quantitativos;
- códigos: adicionar/remover códigos de barras;
- saldo inicial: comando próprio e auditável;
- ajuste de saldo: comando próprio, com motivo, permissão, lock e ledger;
- inativação: preservar histórico e referências de vendas;
- exclusão física: não permitir se houver histórico/vínculos; preferir inativação.

## 3. API proposta

Rotas candidatas; validar convenção do roteador antes de criar arquivos.

### Leitura
- `GET /api/mobflow/products?cursor=&limit=&q=&active=`
- Paginação estável por tenant, ordenação definida e busca por código/nome.
- Retornar os campos do contrato de produto sem carregar fotos binárias; `photo_object_key` é referência R2.
- Filtros e cursor nunca aceitam tenant do cliente.

### Criação/edição
- `POST /api/mobflow/products`: criar produto com ID estável e idempotency key.
- `PATCH /api/mobflow/products/:id`: editar apenas campos de cadastro, com versão esperada.
- Campos aceitos: code, ref, name, price, cost, minStock, category, unit, active.
- Rejeitar stock e photo URL/base64 nesses comandos.
- Códigos de barras tratados por endpoint/ação validada separadamente, com unicidade tenant-scoped.
- Atualização concorrente exige `expectedVersion`; conflito retorna 409 com versão atual.

### Saldo e histórico
- `POST /api/mobflow/stock/initial-balance`: somente criação, registra saldo inicial e movimento de ledger.
- `POST /api/mobflow/stock/adjustments`: comando separado de ajuste, uma operação idempotente com linhas.
- Ambos atualizam `products.stock`, `stock_movements` e `mobflow_sync_events` na mesma transação.
- A API de catálogo não pode gravar saldo nem ledger diretamente.

### Inativação
- `POST /api/mobflow/products/:id/deactivate` e `/reactivate` ou PATCH restrito ao campo active.
- Preservar o produto e histórico. Não remover silenciosamente produto usado em vendas, recebimentos ou ledger.

## 4. Validação server-side

Toda rota:
1. Chama `beginAuthenticatedTransaction`, derivando usuário e tenant da sessão.
2. Verifica papel/permissão do usuário para catálogo ou operação de estoque.
3. Usa tenant da identidade em todas as queries.
4. Valida strings, limites, unidade `un|kg`, valores monetários não negativos e decimais.
5. Usa transação e locks quando há concorrência de códigos ou saldo.
6. Define contexto RLS via helper de autenticação já existente.
7. Nunca aceita `tenant_id`, operador ou nome de usuário como autoridade do corpo.
8. Retorna erro tipado sem vazar SQL, dados de outra empresa ou PII.

Permissões específicas devem ser derivadas das permissões reais do MobFlow; não assumir que qualquer usuário PDV pode editar preço, custo, saldo ou excluir cadastro. A matriz Doc69 continua sendo referência.

## 5. Regras para importação em lote

Não manter a importação atual como uma escrita direta para Neon sem contrato.

Proposta:
- `POST /api/mobflow/products/import/preview`: valida arquivo já parseado pelo cliente e devolve resumo, colisões e operações propostas sem escrita.
- `POST /api/mobflow/products/import/commit`: exige `importId`/idempotency key estável, versão do preview e confirmação do usuário.
- Definir por item se cria, atualiza ou ignora; nunca sobrescrever código duplicado por escolha implícita.
- O modo atual `replace|add` altera estoque: migrar para semântica explícita. `replace` não deve ser interpretado como substituir catálogo inteiro nem zerar saldo sem decisão.
- Atualizações de saldo importadas devem gerar operações de ajuste auditáveis e ledger, nunca PATCH de produto.
- Lotes devem ser atômicos ou ter resultado por item explicitamente persistido e reexecutável; não aceitar estado parcial desconhecido.
- Relatar produtos criados/atualizados/ignorados, códigos duplicados e diferenças de saldo.

## 6. Contrato de eventos

- Cadastro/edição/inativação gera evento `catalog` com projeção suficiente e sem foto binária.
- Preço pode ser evento `price` conforme convenção final; payload não pode duplicar efeito de estoque.
- Saldo/ledger gera evento `stock` referenciando operationId e lineKey.
- Um evento de catálogo não pode atualizar saldo no reducer.
- Mesmo idempotency key + mesmo payload retorna resposta original; chave igual com payload diferente gera 409.
- O produtor atual baseado em diff de snapshot não será usado para comandar as novas operações; coexistência deve evitar publicação duplicada.

## 7. Compatibilidade do cliente

Etapas:
1. Criar API e testes sem alterar comportamento de telas.
2. Adicionar client service tipado para Better Auth/Neon Preview.
3. Implementar leitura paralela de produtos e comparar com snapshot.
4. Implementar create/edit/inactivate em Preview, com flag server-side e fallback Supabase preservado.
5. Implementar saldo inicial/ajustes separadamente e reconciliar ledger.
6. Migrar importação em etapa própria.
7. Só depois mudar hidratação/estado local para usar resposta canônica Neon.
8. Não remover persistência de snapshot até todos os fluxos que dependem de produtos estarem cobertos.

O cliente deve continuar offline-first. Comandos offline entram em outbox durável com ID estável antes da rede; enquanto o outbox não estiver implementado, não anunciar que cadastro/ajuste offline sincroniza de forma segura com Neon.

## 8. Testes obrigatórios da primeira fatia

- Isolamento entre duas empresas e usuário inativo.
- Manager e PDV com permissões diferentes.
- Criar produto, atualizar campos e conflito por versão.
- Código de barras duplicado no mesmo tenant e permitido em tenant diferente.
- Unidade inválida, valores negativos, decimais inválidos e payload excessivo.
- Produto inativado continua visível em histórico/vendas.
- Alterar preço/nome não cria movimento de estoque.
- Saldo inicial e ajuste criam exatamente um ledger por linha.
- Timeout após commit + retry não duplica produto nem movimento.
- Import preview sem escrita; commit repetido idempotente.
- Snapshot legado continua íntegro durante Preview.
- Teste de regressão de checkout, recebimento e conferência.

## 9. Decisões pendentes antes do código funcional

- Permissões exatas de cadastro, preço/custo, código de barras e inativação.
- Se códigos internos podem se repetir no mesmo tenant; barcodes já são separados.
- Semântica exata dos modos atuais de importação `replace` e `add`.
- Como mapear IDs gerados atualmente por `uid()` para IDs estáveis seguros sem quebrar referências.
- Política de ajuste de estoque negativo e saldo inicial.
- Política de exclusão/inativação.

## 10. Não realizado

Nenhum endpoint, tipo, tela, migration, tabela, flag, dado ou configuração foi alterado. Nenhum SQL foi executado. O documento é contrato para implementação segura após fechar as decisões acima.
