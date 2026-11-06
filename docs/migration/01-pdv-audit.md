# MobFlow PDV — auditoria inicial para migração

Data: 2026-11-06

## Proteção e escopo
Auditoria somente leitura. Branch isolada: migration/neon-preparation, criada a partir de main. Não foram alterados banco, dados, funções publicadas, variáveis, domínio ou deploy de produção.

Projeto Supabase: ezkwubdpblqkdfampopa (mobflow-pos-stock, região us-west-2).
Repositório: Willianx64bit/mobflow-pos-stock.

## Stack e cliente
- React 19.2; TanStack Start / React Router; TanStack Query; Supabase JS ^2.75.0; Vite 8.
- O build usa vite build; testes definidos via Vitest.
- O cliente Supabase está em src/lib/supabase.ts. URL e publishable key estão declaradas diretamente no arquivo. A publishable key não é service-role, mas a configuração deve ser padronizada por ambiente antes da migração.
- O bootstrap consulta sessão Auth, lê profiles e hidrata o estado do aplicativo. A sessão é mantida no navegador e há proteções para SSR.

## Estrutura pública observada
Foram identificadas sete tabelas públicas, todas com RLS habilitado: profiles, app_state, account_allowlist, manager_security, manager_security_by_account, companies e manager_password_recovery_tokens.

app_state.state é JSONB e concentra estado operacional. Não normalizar nem alterar seu formato sem mapear serialização, sincronização e compatibilidade com versões antigas.

## Migrações identificadas
Foram retornadas 28 migrações, cobrindo controle de criação de contas, allowlist, segurança, Realtime em app_state, acesso compartilhado, RPCs atômicas de recebimento, senhas de gerência por empresa, permissões por área, contas pagas, cobrança Pix, confirmação manual, recuperação de senha, preço mensal e atomic_app_state_compare_and_swap.

A migração atomic_app_state_compare_and_swap é crítica: a concorrência do estado possui proteção atômica que precisa ser reproduzida. Não substituir por leitura/edição/gravação simples.

## Edge Functions observadas
- mobflow-login (versão 27; verify_jwt=false)
- mobflow-users (versão 23; verify_jwt=true)
- mobflow-reauth-manager (versão 14; verify_jwt=true)
- mobflow-signup (versão 16; verify_jwt=false)
- mobflow-manager-password-recovery (versão 11; verify_jwt=false)
- mobflow-admin-api (versão 1; verify_jwt=true)

verify_jwt=false não prova ausência de autenticação: cada função deve ser inspecionada para confirmar validação manual de token, autorização, rate limiting e validação de entrada.

## Requisitos de migração
1. Preservar inicialmente o formato e a semântica do JSONB app_state.
2. Reproduzir a proteção CAS e os RPCs atômicos antes de migrar tráfego.
3. Recriar políticas RLS e validar isolamento entre empresas/contas.
4. Planejar migração de Auth com IDs, senhas, recuperação e sessões; não copiar credenciais sem avaliar compatibilidade.
5. Reimplementar Edge Functions como APIs server-side seguras; segredos somente no servidor.
6. Preservar uploads/comprovantes e referências do Storage.
7. Criar testes de regressão para vendas, estoque, recebimento, permissões, login e sincronização simultânea.

## Limites desta fase
Não aplicar migrations no Supabase ou Neon, não copiar dados reais, não alterar Auth/RLS/Storage, não implantar funções e não mudar domínio ou publicação oficial. As próximas mudanças serão feitas somente na branch de migração e em ambientes de teste isolados.