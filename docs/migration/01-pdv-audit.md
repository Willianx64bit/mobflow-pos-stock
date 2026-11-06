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

## Conciliação entre código publicado e GitHub (06/11/2026)

Foi feita comparação direta da fonte publicada no Supabase com a branch `migration/neon-preparation`:

| Função | Versão publicada | Situação na branch após auditoria |
|---|---:|---|
| `mobflow-login` | 27 | Igual à publicada |
| `mobflow-users` | 23 | Igual à publicada |
| `mobflow-signup` | 16 | Igual à publicada |
| `mobflow-reauth-manager` | 14 | Divergência de uma condição de autorização; a branch exige `role === "pdv"` para usuários que não sejam `manager`, enquanto a função publicada aceita qualquer perfil ativo com permissão `Gerência`. A versão da branch é mais restritiva. Não sobrescrever sem decisão explícita sobre a regra correta. |
| `mobflow-manager-password-recovery` | 11 | Fonte publicada capturada na branch; o arquivo não existia no GitHub antes desta auditoria |
| `mobflow-admin-api` | 1 | Fonte publicada capturada na branch; o arquivo não existia no GitHub antes desta auditoria |

As duas funções ausentes foram adicionadas somente à branch de migração, sem implantação. A função de recuperação depende de SMTP Gmail (variáveis `GMAIL_SMTP_HOST`, `GMAIL_SMTP_PORT`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`) e `MOBFLOW_APP_URL`; os valores secretos não foram consultados nem registrados.

### Pontos de segurança/robustez para a nova implementação

- `mobflow-login` usa Service Role no servidor e valida status de assinatura, CNPJ, papel e usuário. A substituição deve manter essas verificações antes de criar sessão.
- `mobflow-users` possui ações destrutivas (`reset_application`, `delete_all_pdv`) e operações em múltiplas etapas. Exigem confirmação forte, autorização por empresa e tratamento de falha parcial.
- `mobflow-manager-password-recovery` gera token aleatório, persiste hash, limita solicitações recentes por conta e tenta consumir o token uma única vez. Hoje marca o token como usado antes de salvar a nova senha; se a gravação da senha falhar, o link fica consumido. A nova versão deve tornar o consumo e a troca de senha atômicos ou implementar compensação segura.
- `mobflow-reauth-manager` usa SHA-256 simples para a senha de gerência. Antes de reproduzir, avaliar migração para hash de senha com salt e fator de trabalho apropriado, mantendo compatibilidade planejada com hashes existentes.
- `mobflow-admin-api` publicado no projeto PDV (v1) implementa somente `list_companies`; confirmar se ainda é chamada por algum cliente ou se é legado antes de removê-la.

## Limites mantidos

As fontes capturadas são referência de auditoria na branch isolada. Nenhuma função foi implantada, nenhum segredo foi copiado, nenhuma migração foi aplicada e nenhum dado real foi alterado.


## Etapa 2 — infraestrutura de teste provisionada (06/11/2026)

Foi criado um projeto Neon exclusivo para o PDV, sem reaproveitar o projeto `coletaflow`:

- Projeto: `mobflow-pdv-test`
- Project ID: `square-haze-51319178`
- Região: `aws-us-east-2`
- PostgreSQL: `17.11`
- Branch padrão: `integration-test` (`br-wandering-union-bd6vcsk6`)
- Banco: `mobflow_pdv_test`
- Role: `mobflow_test_owner`
- Verificação SQL: conexão confirmada, versão 17.11 e zero tabelas no schema `public`.

O projeto foi criado sem dados, sem importar schemas, usuários ou dados de produção. O compute ficou com configuração mínima de 0,25 CU e máximo de 0,5 CU; o plano Free não permitiu definir explicitamente o intervalo de suspensão, então foi mantido o padrão da conta.

### Decisão de autenticação pendente

A documentação oficial atual do Neon informa que o Managed Better Auth não aceita importar hashes de senha existentes do Supabase. Usuários com senha precisarão criar novas credenciais/reautenticar, ou a aplicação deverá manter temporariamente Supabase Auth como provedor externo enquanto o banco migra. Não habilitar Neon Auth nem alterar login antes de escolher e testar a estratégia.

Referência: https://neon.com/docs/auth/migrate/from-supabase

### Limites desta preparação

Nenhuma tabela, função, extensão, política RLS ou dado foi criado/importado. Data API, Neon Auth, Functions e Realtime permanecem desativados. O projeto é apenas a base isolada de integração para a próxima etapa.


## Etapa 3 — início da reprodução do banco (06/11/2026)

A revisão da branch confirmou que o diretório `supabase/migrations` contém somente 7 arquivos SQL versionados. A auditoria anterior registrou 28 migrações aplicadas no Supabase. Portanto, faltam 21 definições históricas no repositório, além de não haver um dump completo do schema-base.

Os 7 arquivos presentes foram inspecionados. Eles incluem RPCs de recebimento, permissões, metadados de cobrança e o ledger central de movimentações de estoque. Alguns dependem de objetos criados em migrações anteriores não versionadas (por exemplo, `private.current_account_id()`, tabelas e estruturas preexistentes). Aplicá-los isoladamente no Neon vazio falharia ou poderia produzir uma estrutura incompleta.

A consulta de leitura das migrações pelo conector Supabase foi bloqueada pela validação do identificador do projeto: o valor retornado pela listagem é `ezkwubdpblqkqdfampopa` (21 caracteres), enquanto a ferramenta exige uma referência com exatamente 20 caracteres. Nenhuma alteração foi feita no Supabase.

### Decisão de segurança

**Não aplicar parcialmente os 7 arquivos no Neon.** A reprodução precisa incluir o schema-base e todas as migrações na ordem original, especialmente RLS, funções auxiliares, gatilhos, RPCs CAS e regras de isolamento por empresa. Não inventar as 21 migrações ausentes nem gerar tabelas por inferência.

### Próxima ação necessária para continuar

Recuperar as 28 migrações aplicadas (ou um dump somente de schema, sem dados, acompanhado da lista de migrações) a partir do Supabase/CLI ou de backup confiável. Depois comparar com os 7 arquivos versionados, reconstruir uma sequência completa e aplicar somente no Neon de teste. O PDV permanece sem tabelas e sem dados.


## Etapa 3 — conciliação do histórico recuperado (06/11/2026)

O CSV exportado diretamente de `supabase_migrations.schema_migrations` foi recebido e contém 28 registros. A análise comparativa foi documentada em `docs/migration/02-migration-history-reconciliation.md`.

Principais conclusões:
- 6 dos 7 arquivos SQL versionados têm correspondência histórica clara, mas com timestamps/nomes divergentes.
- `20261028190000_stock_movement_ledger.sql` não aparece entre as 28 migrações aplicadas; não presumir que esteja em produção.
- O histórico não cria o schema-base de `profiles` e `app_state`; é necessário recuperar um dump schema-only confiável antes de montar o bootstrap do Neon.
- Migrações intermediárias criam e depois removem tabelas/funções administrativas. Não reaplicar a sequência parcialmente.
- Existem migrações com hashes e IDs específicos de contas; valores sensíveis foram excluídos da documentação e não serão levados ao Neon.
- A função `mobflow_save_state` é o mecanismo CAS crítico e precisa manter bloqueio de linha, comparação de timestamp e gravação condicional.
- Storage de comprovantes e Realtime precisam ser tratados separadamente; o registro Realtime é específico do Supabase.

Nenhuma SQL foi executada e nenhum dado/schema foi importado. Próxima dependência: obter o schema-base completo (tabelas, funções, triggers, RLS, grants, índices, constraints e policies de Storage) para conciliação com o estado final das 28 migrações.
