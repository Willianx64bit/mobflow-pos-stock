# MobFlow PDV — inventário do schema atual

Data: 2026-11-06
Origem: CSV exportado de consulta somente leitura ao catálogo PostgreSQL do projeto Supabase PDV.
Escopo: tabelas, colunas, defaults, constraints, índices e indicadores de RLS. Nenhum dado de negócio foi exportado por esta consulta.

## Resultado confirmado

- 7 tabelas em `public`.
- RLS habilitado nas 7 tabelas.
- `relforcerowsecurity` está desativado nas 7 tabelas; não confundir RLS habilitado com FORCE ROW LEVEL SECURITY.
- Todas as tabelas abaixo foram identificadas no catálogo consultado.
- Este inventário não contém as expressões das policies, definições completas de funções, triggers, grants, views, tipos customizados, buckets/policies de Storage ou conteúdo das tabelas.

## Tabelas e estrutura

### `public.profiles`
Colunas: `id uuid` (PK, FK para `auth.users(id)), `username text` (único), `cnpj text`, `created_at timestamptz DEFAULT now()`, `account_id uuid` (FK para `auth.users(id)`), `role text DEFAULT 'manager'`, `active boolean DEFAULT true`, `display_name text NULL`, `permissions jsonb DEFAULT ["PDV", "Conferência"]`.
Constraint: role limitado a `manager`, `pdv`, `admin`.
Índice adicional: `profiles_account_id_idx(account_id)`.
Observação: manter distinção entre `id` do usuário e `account_id` da conta/gerente.

### `public.app_state`
Colunas: `owner_id uuid` (PK, FK para `auth.users(id)` com ON DELETE CASCADE), `state jsonb`, `updated_at timestamptz DEFAULT now()`.
Observação: estado operacional JSONB; preservar formato e CAS de gravação. Não migrar com transformação de JSON sem comparação e testes.

### `public.companies`
Colunas: `account_id uuid` (PK, FK para `auth.users(id)` com ON DELETE CASCADE), `company_name text`, `cnpj text`, `username text`, `email text`, `phone text`, `plan_code text DEFAULT 'complete'`, `monthly_price numeric DEFAULT 69.90`, `subscription_status text DEFAULT 'pending_payment'`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`, `payment_method text DEFAULT 'pix'`, `payment_confirmed_at timestamptz NULL`, `payment_confirmed_by uuid NULL` (FK para auth.users com ON DELETE SET NULL), `payment_notes text NULL`, `payment_request_token uuid DEFAULT gen_random_uuid()`, `payment_proof_path text NULL`, `payment_submitted_at timestamptz NULL`, `manager_setup_token uuid NULL`, `manager_setup_completed_at timestamptz NULL`, `subscription_expires_at timestamptz NULL`.
Constraints: CNPJ com 14 dígitos; nome entre 2 e 120 caracteres; preço > 0 e <= 9999.99; método de pagamento somente pix; plano somente complete; status em pending_payment/active/past_due/suspended/cancelled; unicidade de CNPJ e username.
Índices: PK/account_id; CNPJ único; username único; status; email normalizado único por `lower(email)`; token de pagamento único; token de setup único quando não nulo; vencimento quando não nulo.

### `public.account_allowlist`
Colunas: `username text` (PK), `cnpj text`, `active boolean DEFAULT true`, `created_at timestamptz DEFAULT now()`.

### `public.manager_security`
Colunas: `id boolean DEFAULT true` (PK e CHECK id=true), `password_hash text`.
Observação: tabela singleton legada; não descartar sem localizar dependências e política atual.

### `public.manager_security_by_account`
Colunas: `account_id uuid` (PK), `password_hash text`, `updated_at timestamptz DEFAULT now()`.
Observação: segurança de gerência por conta; não exportar hashes como seeds nem registrá-los em documentação.

### `public.manager_password_recovery_tokens`
Colunas: `id uuid DEFAULT gen_random_uuid()` (PK), `account_id uuid` (FK para auth.users com ON DELETE CASCADE), `token_hash text` (único), `expires_at timestamptz`, `used_at timestamptz NULL`, `created_at timestamptz DEFAULT now()`.
Índice adicional: `(account_id, created_at DESC)`.
Observação: preservar uso único, expiração e atomicidade de consumo do token com a troca da senha.

## Pontos de atenção

1. A relação com `auth.users` aparece em várias FKs. A migração não pode simplesmente remover essas FKs: precisa definir como identidade/autenticação será mantida ou substituída.
2. `profiles.id` e `profiles.account_id` têm papéis diferentes. Não colapsar ambos em um único ID.
3. RLS está habilitado, mas as policies não estão neste CSV. Não presumir que a segurança está completa apenas porque `rls_enabled=true`.
4. O CSV não lista triggers, funções, grants, policies, Storage nem dados. Esses itens continuam pendentes de auditoria.
5. `companies` possui índices únicos por email normalizado, CNPJ, username e tokens; todos devem ser preservados no desenho de destino.
6. Os hashes em `manager_security*` e tokens de recuperação são dados sensíveis. Não copiar valores para documentação, Git ou ambiente de teste.

## Próximo passo — somente leitura

Exportar as policies RLS e triggers atuais do projeto PDV. Em seguida, recuperar definições das funções relacionadas e grants. Só após comparar o estado completo será elaborado o schema de destino para Neon.

## Segurança da etapa

Consulta de catálogo somente leitura. Nenhum INSERT, UPDATE, DELETE, DDL, deploy, importação ou alteração de configuração foi executado.
