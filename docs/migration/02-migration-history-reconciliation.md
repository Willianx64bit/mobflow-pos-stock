# MobFlow PDV — conciliação do histórico de migrações

Data: 2026-11-06
Escopo: análise do CSV exportado de `supabase_migrations.schema_migrations` e comparação com os SQL versionados. Somente documentação na branch isolada; nenhum SQL foi executado.

## Resultado

- O CSV contém **28 registros** de migração, em ordem cronológica.
- O GitHub contém 7 arquivos em `supabase/migrations`, mas somente 6 têm correspondência histórica clara no CSV; seus timestamps/nomes não coincidem exatamente.
- `20261028190000_stock_movement_ledger.sql` não aparece no histórico exportado. Tratar como alteração ainda não comprovada em produção, não como migração aplicada.
- `supabase/sql/mobflow_paid_company_accounts.sql` é um script auxiliar relacionado à criação de `companies`; não é um dos 28 registros e não deve ser aplicado separadamente sem comparar seu conteúdo com a migração histórica.
- O histórico não contém a criação inicial de `profiles` nem `app_state`. Portanto, ainda falta localizar ou reconstruir, a partir de fonte confiável, o schema-base anterior às 28 migrações.
- O histórico contém comandos com hashes de senha e UUIDs de contas específicas. Esses valores foram deliberadamente omitidos deste relatório e não devem ser copiados para Neon nem commitados em SQL de migração.

## Inventário dos 28 registros recuperados

| # | Version | Migration name | Observação |
|---:|---|---|---|
| 1 | 20261006202947 | `restrict_account_creation` | Cria allowlist e trigger de autorização; inclui seed de conta de teste no SQL histórico. |
| 2 | 20261006202951 | `fix_account_allowlist_trigger` | Ajusta a regra do trigger e restringe execução da função. |
| 3 | 20261006203004 | `lockdown_public_security_definer` | Revoga execução de `rls_auto_enable()`; a definição dessa função não está neste histórico. |
| 4 | 20261007114024 | `enable_app_state_realtime` | Adiciona `app_state` à publicação Realtime do Supabase; comportamento específico do Supabase. |
| 5 | 20261008111234 | `add_account_roles_and_shared_state_access` | Colunas/roles em `profiles`, funções auxiliares `private.current_account_id/role`, RLS em `profiles` e `app_state`. |
| 6 | 20261008111335 | `atomic_receiving_accept` | Primeira versão de `accept_receiving`. |
| 7 | 20261008111559 | `harden_atomic_receiving_rpc` | Revisa segurança e privilégios da RPC de recebimento. |
| 8 | 20261008203424 | `add_manager_password_hash` | Cria `manager_security`; inclui hash inicial específico, que não deve ser migrado como seed. |
| 9 | 20261012134256 | `accept_receiving_extras` | Atualiza `accept_receiving` para considerar itens extras. |
| 10 | 20261013023409 | `manager_passwords_per_company` | Cria `manager_security_by_account`. |
| 11 | 20261013023424 | `set_mercado1_manager_password` | Seed de hash de senha vinculado a conta específica; excluir de qualquer pacote de schema. |
| 12 | 20261013023435 | `preserve_existing_manager_password` | Seed/preservação de hash específico; excluir de qualquer pacote de schema. |
| 13 | 20261017014605 | `user_area_permissions` | Adiciona permissões por área em `profiles`. |
| 14 | 20261017200022 | `mobflow_paid_company_accounts` | Cria `companies`, restrições e acesso de service role. |
| 15 | 20261017200142 | `mobflow_unique_signup_email` | Índice único por e-mail normalizado em `companies`. |
| 16 | 20261017200846 | `mobflow_pix_manual_payment` | Acrescenta metadados de pagamento Pix/manual em `companies`. |
| 17 | 20261017201812 | `mobflow_admin_accounts` | Acrescenta role admin, allowlist administrativa e campos de confirmação. |
| 18 | 20261017201839 | `mobflow_payment_confirmation_fields` | Acrescenta campos de confirmação de pagamento. |
| 19 | 20261017203835 | `allow_mobflow_admin_auth_users` | Altera trigger para aceitar allowlist administrativa. |
| 20 | 20261017212407 | `mobflow_admin_login_rate_limit` | Cria tabela/função de controle de tentativas de login administrativo. |
| 21 | 20261017214242 | `mobflow_pix_payment_settings` | Cria configurações Pix; depois removidas pela migração 25. |
| 22 | 20261017215451 | `mobflow_signup_payment_proof` | Adiciona campos de comprovante e cria bucket privado no Storage. |
| 23 | 20261017220155 | `allow_public_signup_marker` | Altera trigger para aceitar marcador de cadastro público. |
| 24 | 20261017223044 | `add_first_manager_setup_for_new_companies` | Adiciona token e timestamp de configuração inicial de gerente. |
| 25 | 20261018203309 | `remove_obsolete_admin_payment_tables` | Reverte o trigger para allowlist de contas; remove função/tabelas administrativas e configurações Pix criadas anteriormente. |
| 26 | 20261019003449 | `manager_password_recovery_tokens` | Cria tokens de recuperação de senha por conta. |
| 27 | 20261020024225 | `allow_mobflow_monthly_price_69_90` | Altera restrição de preço para aceitar R$ 69,90 e R$ 79,90. |
| 28 | 20261027123026 | `atomic_app_state_compare_and_swap` | Cria `mobflow_save_state`, com bloqueio de linha, comparação de `updated_at` e gravação condicional. Crítica para concorrência. |

## Conciliação com os arquivos do GitHub

| Arquivo versionado na branch | Registro histórico correspondente | Situação |
|---|---|---|
| `20261008120000_account_roles_and_atomic_receiving.sql` | #5 `add_account_roles_and_shared_state_access` | Conteúdo-base correspondente; timestamp e nome diferem. O arquivo também contém uma versão inicial de `accept_receiving`, que no histórico real aparece no registro #6 separado. |
| `20261008121500_harden_atomic_receiving_rpc.sql` | #7 `harden_atomic_receiving_rpc` | Correspondência de função; timestamp difere. |
| `20261012110000_accept_receiving_extras.sql` | #9 `accept_receiving_extras` | Correspondência de função; timestamp difere. |
| `20261016190000_user_area_permissions.sql` | #13 `user_area_permissions` | Correspondência de função; timestamp difere. |
| `20261017000000_mobflow_admin_accounts.sql` | #17 `mobflow_admin_accounts` | Correspondência parcial; comparar cuidadosamente porque o SQL versionado não representa necessariamente todos os detalhes/estado posterior. |
| `20261017010000_mobflow_pix_payment_settings.sql` | #21 `mobflow_pix_payment_settings` | Correspondência inicial, mas a tabela foi removida no registro #25. Não recriar sem confirmar dependências atuais. |
| `20261028190000_stock_movement_ledger.sql` | Nenhum registro no CSV | Não consta como aplicada no Supabase consultado. Manter como candidata de migração futura, sujeita a auditoria e testes. |

## Pontos críticos identificados

### 1. Schema-base ausente

O histórico recuperado começa com objetos que pressupõem a existência de estruturas anteriores:
- `public.profiles`
- `public.app_state`
- `public.rls_auto_enable()`
- `auth.users` e papéis/grants do Supabase
- políticas e gatilhos preexistentes não criados integralmente pelos 28 registros.

As 28 migrações não são um bootstrap completo para um banco PostgreSQL vazio. É necessário obter um dump confiável de schema-only ou recuperar a origem das estruturas-base. Não criar essas estruturas por suposição.

### 2. CAS de estado operacional

A função `public.mobflow_save_state(uuid, timestamptz, jsonb)` verifica o usuário autenticado e a conta, valida o JSON, bloqueia a linha com `FOR UPDATE`, compara o timestamp esperado e só então grava. Em conflito, devolve o estado atual sem sobrescrever.

Essa semântica deve ser preservada e testada com gravações concorrentes. Não substituir por read-modify-write no cliente, por upsert cego ou por gravação sem comparação.

### 3. Segurança de autenticação e dados específicos

Três migrações do histórico contêm hashes e/ou identificadores de contas específicas. Elas são operações de dados/credenciais, não schema reutilizável. Não exportar esses valores para repositório, não semear no Neon e não tratar hashes antigos como credenciais seguras. A estratégia de autenticação deve ser definida separadamente.

### 4. Estado final de objetos administrativos

O histórico cria e depois remove `mobflow_admin_allowlist`, `mobflow_admin_login_attempts`, `mobflow_payment_settings` e a função `mobflow_admin_login_guard`. Também substitui a função do trigger de allowlist, removendo as exceções administrativas e de cadastro público introduzidas antes.

Não reaplicar migrações intermediárias isoladamente. Confirmar o estado atual das funções, tabelas, permissões e clientes que as utilizam.

### 5. Storage e Realtime

A migração de comprovantes cria o bucket privado `mobflow-payment-proofs`; o histórico exportado não inclui uma auditoria completa das policies de Storage. O registro Realtime é específico do Supabase. Ambos precisam de plano próprio na arquitetura de destino, não de cópia cega para Neon.

### 6. Ledger de movimentações

O arquivo `stock_movement_ledger.sql` não está no histórico aplicado. Antes de adotá-lo, revisar a função por completo, especialmente a ordem de cálculo dos movimentos, validação de decisões, idempotência e atomicidade com a atualização de estoque. Só então aplicar no ambiente de teste e executar regressões de recebimento/estoque.

## Plano seguro a partir daqui

1. Localizar/exportar o schema-base completo do Supabase em modo schema-only, incluindo tabelas, constraints, índices, funções, triggers, policies, grants e dependências de Storage.
2. Comparar esse dump com o estado final representado pelas 28 migrações, resolvendo divergências e identificando objetos removidos.
3. Separar schema de dados de configuração, credenciais, hashes e UUIDs reais.
4. Montar uma sequência limpa e reproduzível de migrações para PostgreSQL/Neon, sem comandos específicos de Supabase que não se apliquem.
5. Aplicar somente no projeto Neon de teste `mobflow-pdv-test`, branch `integration-test`, depois executar testes de RLS/autorização, login, CAS concorrente, recebimentos e estoque.
6. Manter Supabase, produção, branch `main`, projeto Admin e ColetaFlow intocados.

## Estado da execução

Nenhum SQL deste CSV foi executado. Nenhum schema ou dado foi importado. Nenhuma credencial ou hash foi copiado. As únicas alterações desta etapa são documentos nesta branch de migração.
