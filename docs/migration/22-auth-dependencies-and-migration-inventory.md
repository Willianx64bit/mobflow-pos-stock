# 22 — Dependências de Auth, FKs e inventário de migrations

Data: 2026-11-06  
Projeto consultado: Supabase MobFlow PDV `ezkwubdpblqkdfampopa`  
Método: listagem de migrations e introspecção de tabelas em modo leitura.

## 1. Inventário de migrations registradas em produção

A consulta retornou 28 migrations, da primeira registrada em 06/10/2026 até a última em 27/10/2026. A sequência registrada é:

1. `restrict_account_creation`
2. `fix_account_allowlist_trigger`
3. `lockdown_public_security_definer`
4. `enable_app_state_realtime`
5. `add_account_roles_and_shared_state_access`
6. `atomic_receiving_accept`
7. `harden_atomic_receiving_rpc`
8. `add_manager_password_hash`
9. `accept_receiving_extras`
10. `manager_passwords_per_company`
11. `set_mercado1_manager_password`
12. `preserve_existing_manager_password`
13. `user_area_permissions`
14. `mobflow_paid_company_accounts`
15. `mobflow_unique_signup_email`
16. `mobflow_pix_manual_payment`
17. `mobflow_admin_accounts`
18. `mobflow_payment_confirmation_fields`
19. `allow_mobflow_admin_auth_users`
20. `mobflow_admin_login_rate_limit`
21. `mobflow_pix_payment_settings`
22. `mobflow_signup_payment_proof`
23. `allow_public_signup_marker`
24. `add_first_manager_setup_for_new_companies`
25. `remove_obsolete_admin_payment_tables`
26. `manager_password_recovery_tokens`
27. `allow_mobflow_monthly_price_69_90`
28. `atomic_app_state_compare_and_swap`

A lista comprova o histórico de versões registrado no Supabase, mas não substitui a comparação de cada arquivo SQL do repositório com o schema real. Essa reconciliação arquivo-a-arquivo continua pendente.

## 2. Dependências diretas com Supabase Auth

A introspecção atual confirmou FKs para `auth.users`:

| Tabela pública | Coluna | Referência |
|---|---|---|
| `profiles` | `id` | `auth.users.id` |
| `profiles` | `account_id` | `auth.users.id` |
| `app_state` | `owner_id` | `auth.users.id` |
| `companies` | `account_id` | `auth.users.id` |
| `companies` | `payment_confirmed_by` | `auth.users.id` |
| `manager_password_recovery_tokens` | `account_id` | `auth.users.id` |

Essa é uma dependência estrutural, não apenas uma dependência de login. Migrar Auth sem mapear IDs quebra referências ou exige estratégia de remapeamento transacional.

## 3. Implicações para migração de identidade

- Criar um mapa durável `supabase_user_id -> new_auth_user_id` antes de qualquer cutover de Auth.
- Preservar a identidade da empresa/tenant separada da identidade individual do usuário.
- Validar especificamente o padrão atual em que `profiles.account_id` e `companies.account_id` referenciam o ID Auth do gerente/conta.
- Migrar primeiro as entidades e FKs com IDs estáveis, ou executar remapeamento controlado em staging com validação de todas as FKs.
- Não usar username, CNPJ ou e-mail sintético como substituto automático do UUID sem regra de unicidade e reconciliação.
- Não apagar contas antigas nem alterar senha/session até provar login, recuperação, bloqueio e permissões no destino.

## 4. Dependência entre fases

A ordem segura deve separar:
1. schema e dados de aplicação;
2. backend/RPCs e autorização;
3. autenticação e mapeamento de identidade;
4. armazenamento de comprovantes;
5. Realtime;
6. corte de tráfego e rollback.

A sequência pode ser ajustada após a matriz completa de dependências, mas não se recomenda migrar Auth e Realtime junto com o primeiro corte de Postgres.

## 5. Limitações

A lista de migrations não revela por si só o conteúdo integral de cada migration nem garante que o repositório contém exatamente o SQL aplicado. A validação final exige comparar os 28 arquivos do repositório com o histórico e o catálogo de produção, identificar drift e classificar cada diferença. Nenhuma migration foi aplicada nesta auditoria.
