# Reset, exclusão e testes integrados — Preview

Data da revisão: 2026-11-08  
Escopo: somente `migration/neon-preparation`, Neon Preview `proud-star-34734307` / branch `br-wild-night-bds1bdfk` / database `mobflow_pdv_test`, e bucket R2 Preview `mobflow-preview-files`.

## Resultado da inspeção do schema

A inspeção de `information_schema.columns` e `pg_constraint` confirmou as tabelas Better Auth (`user`, `account`, `session`, `verification`), perfis/empresa (`profiles`, `companies`, `account_allowlist`, `manager_security_by_account`, `manager_password_recovery_tokens`, `auth_identity_links`, `app_state`) e tabelas operacionais relacionais.

As tabelas operacionais usadas pelo reset existem e possuem `tenant_id`: `receivable_payments`, `sale_items`, `sale_payments`, `cash_movements`, `sales`, `cash_sessions`, `stock_movements`, `promotions`, `products`, `mobflow_sync_events`, `mobflow_sync_counters` e `mobflow_legacy_backfill_runs`.

`product_barcodes` não tem exclusão separada na rotina: seus vínculos com `products` usam `ON DELETE CASCADE`, então a remoção dos produtos remove seus códigos de barras associados. `app_state.owner_id` referencia `profiles.id` com cascade; o reset mantém o perfil principal e atualiza seu snapshot para vazio.

## Reset operacional do PDV

- Preservar o perfil principal, login, senha, sessão/identidade Better Auth e `manager_security_by_account`.
- Limpar tabelas operacionais listadas acima, estado local/snapshot e fila/cursor de sincronização.
- Remover usuários PDV e allowlist vinculada ao CNPJ.
- Remover somente objetos R2 em `tenants/{tenantId}/products/` e `tenants/{tenantId}/company-logos/`.
- Preservar `tenants/{tenantId}/pix-proofs/` e qualquer arquivo de cobrança/assinatura.
- Se a limpeza R2 falhar após commit Neon, informar claramente que a limpeza ficou parcial e permitir repetição segura.
- Não executar em empresa real durante esta validação.

## Exclusão total pelo Admin

- Confirmar nome exato e UUID da empresa no servidor.
- Proteger a conta administrativa principal.
- Bloquear novas operações do tenant com status `cancelled` antes da limpeza externa. Se R2 falhar, manter a empresa bloqueada no Neon e permitir retry.
- Apagar todos os objetos sob `tenants/{accountId}/`, incluindo fotos, logos e comprovantes Pix.
- Apagar dependências operacionais, usuários/perfis da empresa, tokens de recuperação, allowlist e registro da empresa; preservar outras empresas e a conta Admin.
- Verificar que o prefixo R2 e todos os registros tenant-scoped estão vazios antes de confirmar sucesso.

## Teste integrado — executar somente após Preview disponível

1. Criar duas empresas descartáveis A e B no Preview, com logins de gerência separados.
2. Em A, cadastrar usuário PDV, produto com código de barras e foto, logo, estoque, venda, pagamento, caixa, movimento de estoque e comprovante Pix de teste.
3. Em B, cadastrar dados e um objeto R2 próprios para provar isolamento.
4. Executar reset no PDV da empresa A:
   - confirmar snapshot e tabelas operacionais vazios;
   - confirmar que a gerência de A continua autenticando com a mesma senha;
   - confirmar usuário PDV de A removido e fila/cursor local zerados;
   - confirmar foto/logo de A removidas e comprovante Pix preservado;
   - confirmar todos os dados e arquivos de B intactos.
5. Recriar dados de teste em A e executar exclusão total pelo Admin:
   - confirmar status bloqueado durante a exclusão;
   - confirmar remoção dos registros da empresa, perfis, usuários, credenciais, allowlist, tokens e todos os objetos R2 de A;
   - confirmar B e a conta administrativa principal continuam funcionando.
6. Repetir a exclusão de A após simular falha R2/DB, garantindo que a operação seja retomável sem atingir B.
7. Validar login, recuperação de senha, cadastro, aprovação de pagamento, listagem, comprovante assinado e upload/download R2 nos dois previews.

## Critérios de aprovação

- Nenhum acesso cruzado entre A e B.
- Nenhuma exclusão de dados da conta Admin principal.
- Reset preserva acesso de gerência e comprovante Pix.
- Exclusão Admin remove todos os dados e arquivos do tenant.
- Falhas parciais ficam visíveis, com retry seguro, sem declarar sucesso falso.

## Pendências

- Deploy/execução integrada aguardam a renovação da quota Vercel; os checks atuais retornam `build-rate-limit`.
- Não há aprovação de build PDV neste checkpoint.
- Nenhum reset ou exclusão foi executado em empresa real ou descartável até o Preview estar disponível.
