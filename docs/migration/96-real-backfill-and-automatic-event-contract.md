# 96 — Backfill real de produção e contrato incremental automático

Data: 2026-11-09  
Escopo: MobFlow PDV, branch `migration/neon-preparation` e Neon isolado de ensaio.

## 1. Origem confirmada

A origem operacional é o projeto Supabase `mobflow-pos-stock`, usando `public.app_state` como snapshot autoritativo legado. A consulta SQL direta foi usada porque a estimativa da listagem de tabelas retornava zero linhas apesar de existirem snapshots.

Fonte confirmada:
- 7 usuários Auth;
- 7 perfis MobFlow;
- 2 empresas;
- 2 snapshots `app_state`;
- 9 registros em `account_allowlist`.

Um tenant não possui operações no snapshot. O outro contém:
- 4 produtos;
- 73 vendas e 82 itens;
- 7 sessões de caixa (2 abertas e 5 fechadas);
- 1 movimentação de caixa;
- 124 movimentos de estoque;
- 1 promoção;
- 2 recebimentos de Fiado;
- 4 recebimentos de mercadoria, 5 conferências, 3 transferências, 29 baixas e 1 ajuste de estoque preservados no snapshot legado.

## 2. Destino isolado

Foi criado o banco `mobflow_pdv_real_backfill` no branch Neon `br-red-tree-bdk94c7k`, projeto `proud-star-34734307`.

Esse banco é separado do banco de Preview já existente. Não houve troca de `NEON_DATABASE_URL`, não foi conectado ao Vercel e não houve cutover.

Foram aplicadas nesse banco isolado as migrations 0001 a 0008 da branch de preparação. A migração 0008 teve uma correção de pré-validação: a verificação de sessão de caixa agora consulta as sessões do snapshot de origem, em vez de procurar a sessão na tabela relacional antes de ela ser importada.

## 3. Dados copiados e conferência

Foram copiados perfis, empresas, allowlist e os dois snapshots completos. O backfill relacional foi executado com os IDs originais da origem.

| Entidade relacional | Origem esperada | Neon após backfill |
|---|---:|---:|
| Perfis | 7 | 7 |
| Empresas | 2 | 2 |
| Allowlist | 9 | 9 |
| Snapshots | 2 | 2 |
| Produtos | 4 | 4 |
| Vendas | 73 | 73 |
| Itens de venda | 82 | 82 |
| Pagamentos de venda | 73 | 73 |
| Recebimentos Fiado | 2 | 2 |
| Sessões de caixa | 7 | 7 |
| Movimentos de caixa | 1 | 1 |
| Movimentos de estoque | 124 | 124 |
| Promoções | 1 | 1 |
| Marcadores de backfill | 2 | 2 |

Integridade adicional:
- O hash MD5 de cada snapshot no Neon é idêntico ao hash calculado na origem.
- O total das 73 vendas confere: R$ 2.409,18.
- Os dois recebimentos de Fiado totalizam R$ 18,59, igual à origem.
- Os 124 movimentos de estoque preservam soma de delta 112,820.
- Os dois itens de venda cujo produto já não existe no catálogo foram preservados com código/nome em snapshot e `product_id` nulo; não foram descartados nem associados a produto incorreto.
- Um produto já tinha saldo negativo de -4 na origem. O saldo foi preservado, sem correção artificial.
- A origem não possuía códigos de barras adicionais para importar.
- A migration 0008 foi executada novamente como teste de idempotência; as contagens permaneceram iguais.
- Nenhum evento histórico falso foi criado; a tabela de eventos começa vazia para que a primeira sincronização não reproduza operações antigas.

## 4. Credenciais que ainda não foram copiadas

Os 7 usuários Auth e seus hashes de senha não foram importados. Também não foram copiados hashes de segurança do gerente nem sessões Supabase. Os perfis e empresas estão no banco de ensaio, mas esse banco ainda não está pronto para autenticação de usuários reais.

O próximo passo de identidade continua sendo o dry-run e a importação protegida de Better Auth, preservando UUIDs e bcrypt, com sessões antigas invalidadas e novo login. Isso não foi misturado ao backfill operacional.

## 5. Contrato de eventos automáticos implementado

A sincronização normal deve transportar somente eventos pequenos e aplicáveis pelo reducer:
- venda comum: evento `sales/sale` agora é `automatic`;
- abertura/fechamento de caixa: `cash/cash_session` agora é `automatic`;
- movimentação de caixa: `cash/cash_movement` agora é `automatic`;
- efeitos de saldo do estoque: `stock/product` permanecem `automatic`;
- inclusão/alteração/exclusão de promoção: eventos `promotions/promotion` são automáticos.

A API de eventos filtra `delivery_mode='automatic'`. Eventos manuais não são enviados no feed realtime. Quando uma página termina, o cursor avança até o high-water mark do Neon, mesmo que existam apenas eventos manuais nesse intervalo. Assim, eventos manuais não bloqueiam nem são baixados repetidamente. O botão de sincronização completa continua responsável por reconciliar o snapshot pesado.

## 6. Atualizações que continuam manuais

Permanecem no botão manual enquanto não houver projeção relacional e reducer completos:
- cadastro/edição/importação/exclusão de catálogo;
- configurações da empresa, contatos e fornecedores;
- recebimentos e conferências;
- baixas, transferências e ajustes em lote como documentos completos;
- alterações de preço e demais atualizações grandes.

Limitações funcionais ainda abertas:
- Venda Fiado ainda não usa o comando incremental de vendas; a rota Neon recusa Fiado até o modelo de clientes/recebíveis estar completo. Esse fluxo permanece no caminho manual legado.
- Transferência ainda não tem origem/destino implementados no comando Neon.
- Operações de baixa não são enfileiradas pelo store atual.
- O fluxo de preço/catálogo não é automático; fica no botão manual.
- A autenticação Better Auth ainda não foi ligada ao novo banco de backfill.

## 7. Validação pendente antes de ativar flags

- Executar a suíte GitHub Actions completa e o build após as alterações de eventos.
- Apontar um Preview isolado para o banco de backfill somente depois de importar e validar as credenciais.
- Testar login, isolamento de tenant, venda comum, caixa, estoque, fila offline, retry idempotente, Realtime e cursor em dois dispositivos.
- Testar Fiado e operações pesadas pelo botão manual.
- Só então ativar `VITE_MOBFLOW_INCREMENTAL_SYNC` e `VITE_MOBFLOW_INCREMENTAL_BOOTSTRAP_READY` no Preview.

Produção, `main`, Supabase de origem, MobFlow Admin e ColetaFlow permanecem inalterados.
