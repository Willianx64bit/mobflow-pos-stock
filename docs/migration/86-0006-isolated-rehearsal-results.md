# Doc86 — Ensaio controlado da migration 0006 (branch isolada)

Data: 2026-11-08  
Projeto Neon: `mobflow-pdv-realtime-test` (`proud-star-34734307`)  
Branch: `mobflow-0006-rehearsal-isolated` (`br-square-waterfall-bdi7kysd`)  
Database: `mobflow_pdv_test`  
Role de execução DDL: `mobflow_pdv_test_owner`  
Migration: `neon/migrations/0006_operational_relational_foundation_DRAFT.sql`  
Blob SHA da migration: `73a46cf8b0c8dfefd4690a1e91f8e126acdc8b62`

## Escopo e limites

A migration 0006 foi aplicada somente na branch isolada indicada acima. A branch foi criada a partir de `realtime-validation`; nenhuma alteração foi aplicada à branch pai, produção, Supabase, Vercel Production, MobFlow Admin ou ColetaFlow.

Foram usados exclusivamente dados sintéticos, com UUIDs e identificadores reservados para o ensaio. Nenhum dado real de cliente, venda, estoque ou usuário foi importado.

## Resultado da aplicação

- PostgreSQL 18.6.
- Papel `mobflow_api` existe, sem SUPERUSER e sem BYPASSRLS.
- Papel de ensaio `mobflow_pdv_test_owner` tem BYPASSRLS para DDL/fixture; testes de isolamento foram executados após `SET LOCAL ROLE mobflow_api`.
- As 9 tabelas operacionais foram criadas: products, product_barcodes, cash_sessions, cash_movements, sales, sale_items, sale_payments, receivable_payments e stock_movements.
- RLS habilitado nas 9 tabelas, com uma política tenant-scoped em cada uma.
- Grants para `mobflow_api` aplicados.

## Testes executados

1. **Aplicação transacional da migration:** concluída sem erro.
2. **Fixture multi-tenant:** criados dois tenants sintéticos independentes, cada um com perfil gerente, operador, produto e código de barras.
3. **Leitura isolada por tenant:** sob `mobflow_api` e contexto `app.account_id` do Tenant A, a consulta retornou somente o produto A; o produto B ficou invisível.
4. **Leitura de códigos de barras:** o Tenant A visualizou somente seu código de barras.
5. **Escrita cruzada via RLS:** tentativa de inserir produto do Tenant B com contexto do Tenant A foi rejeitada com SQLSTATE `42501` (violação da política RLS).
6. **Integridade composta tenant + produto:** tentativa de associar código de barras do Tenant A a produto do Tenant B foi rejeitada com SQLSTATE `23503`.
7. **Preservação do histórico:** movimento sintético de estoque foi criado; ao excluir o perfil operador, apenas `operator_profile_id` virou NULL, mantendo snapshot do operador, saldos anterior/posterior e delta.
8. **Ações referenciais:** FKs de tenant e histórico usam RESTRICT; a única FK CASCADE da 0006 é product_barcodes → products. A FK de operador do stock_movements usa SET NULL na coluna operator_profile_id.
9. **Limpeza:** todos os registros sintéticos foram removidos. Verificação final retornou zero perfis, produtos, códigos de barras e movimentos de teste remanescentes.

## Resultado

**Aprovado para a próxima rodada de testes de schema/RLS**, dentro desta branch isolada.

## Limitações que permanecem

- Este ensaio não valida o backfill de dados reais nem a compatibilidade de todos os IDs históricos.
- Não valida APIs de venda, caixa, recebimento ou comandos transacionais.
- Não valida sincronização offline, idempotência de ponta a ponta nem concorrência de vendas.
- Não autoriza ativar o catálogo Neon no Preview nem tornar as tabelas autoritativas.
- As políticas RLS isolam por tenant, mas a aplicação ainda deve validar o usuário/operador e as permissões no servidor; não substituem autorização de negócio.
- A migration continua sendo uma base relacional parcial; entidades operacionais ausentes continuam no mapa de lacunas do Doc79.
- Nenhuma aplicação da migration foi feita na branch pai ou em produção.

Próximo passo recomendado: executar testes de constraints e autorização por API, depois expandir a matriz para vendas/caixa e validar comandos transacionais antes de qualquer backfill.
