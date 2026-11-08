# 73 — Auditoria somente leitura do Neon de validação

Data: 2026-11-08  
Projeto: `mobflow-pdv-realtime-test` (`proud-star-34734307`)  
Branch: `realtime-validation` (`br-wild-night-bds1bdfk`)  
Banco: `mobflow_pdv_test`  
Escopo: inspeção somente leitura para validar pré-requisitos do DDL 0006. Nenhuma escrita foi executada.

## 1. Estado observado

- Conexão feita como `mobflow_pdv_test_owner`.
- Papel `mobflow_api` existe.
- O papel `mobflow_api` não é superusuário, não cria bancos, não cria papéis e não tem `BYPASSRLS`.
- Foram encontradas 15 tabelas no schema `public`; nenhuma delas usa os nomes operacionais propostos em 0006 (`products`, `product_barcodes`, `cash_sessions`, `cash_movements`, `sales`, `sale_items`, `sale_payments`, `receivable_payments`, `stock_movements`).
- O schema `profiles` contém `id uuid` e `account_id uuid`, conforme esperado pelo baseline 0001.
- Agregação por perfil mostrou o padrão estrutural esperado: perfis manager com `id = account_id`; perfis PDV com `id <> account_id`. Nenhum username, email, CNPJ ou identificador individual foi incluído neste relatório.

## 2. Consequência para o DDL 0006

A inspeção confirmou que:
1. O papel de API necessário para as políticas do rascunho existe.
2. Os nomes das tabelas propostas não colidem com as 15 tabelas públicas atuais.
3. O modelo de perfil suporta uma chave composta `(account_id, id)` para garantir que operador/vendedor referenciado em cada linha pertence ao mesmo tenant.

O DDL foi ajustado em commit `fc02792c798688c0d219c8239b7dcbc46820ca02` para:
- criar índice único em `profiles(account_id, id)`;
- usar FKs compostas tenant + operador em sessões de caixa, movimentos de caixa, vendas, recebimentos de fiado e movimentos de estoque;
- ao excluir um perfil, permitir `SET NULL` apenas no campo de operador do histórico de estoque, preservando o tenant e o registro auditável.

## 3. O que esta auditoria NÃO prova

- Não prova que o DDL completo executa sem erro; nenhuma migration foi aplicada ou preparada em branch temporária.
- Não prova que o papel de API tem todos os privilégios de DDL necessários; ele não precisa ser o executor da migration.
- Não valida dados de produção nem autoriza backfill.
- Não valida regras comerciais nem autorização por funcionalidade.
- Não substitui testes de isolamento RLS com duas empresas e usuários de papéis diferentes.

## 4. Próximas verificações necessárias

1. Revisar as políticas RLS para garantir que o contexto `app.account_id` só seja definido pelo backend após autenticação e autorização.
2. Confirmar que cada rota operacional usa transação, tenant da sessão e permissões do usuário; nunca aceitar tenant informado pelo navegador.
3. Testar FKs compostas com manager, usuário PDV da mesma empresa e usuário de outra empresa.
4. Fazer validação sintática do DDL numa branch temporária isolada somente após autorização explícita para criar essa branch e executar o DDL de teste.
5. Criar testes de integração para checkout, pagamentos, caixa e ledger antes de considerar as tabelas autoritativas.

## 5. Limites respeitados

Somente consultas `SELECT` em catálogo/metadata e agregações não identificáveis no Neon de validação. Nenhum `CREATE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE` ou migration foi executado. Nenhuma configuração de produção, Supabase, Vercel, Admin ou ColetaFlow foi alterada.
