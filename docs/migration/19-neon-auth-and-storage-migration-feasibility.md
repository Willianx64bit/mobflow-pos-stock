# MobFlow PDV — viabilidade de migração de Auth e Storage para Neon

Data: 06/11/2026  
Escopo: análise de compatibilidade entre os fluxos atuais do MobFlow e as capacidades Neon documentadas. Não habilita Auth, Storage, Functions ou Realtime.

## 1. Decisão de arquitetura: separar banco e identidade

O projeto usa Supabase Auth hoje. A migração do Postgres, isoladamente, não exige trocar o provedor de identidade. Há duas estratégias tecnicamente distintas:

### Estratégia A — migrar Postgres primeiro, manter Supabase Auth temporariamente

- Mantém os usuários, senhas, IDs Auth e sessões existentes no curto prazo.
- A aplicação valida tokens Supabase no backend que acessa Neon.
- Exige manter o projeto Supabase Auth ativo e uma integração segura entre o novo backend e o provedor antigo.
- Reduz o risco de corte de login no mesmo momento da migração dos dados.
- Não conclui a retirada do Supabase; cria uma fase de convivência que precisa de prazo e plano de encerramento.

### Estratégia B — migrar também Supabase Auth para Neon Managed Better Auth

- Neon Managed Auth usa Better Auth e armazena usuários/sessões no schema `neon_auth`.
- O SDK Neon oferece `SupabaseAuthAdapter()` para preservar chamadas semelhantes a `signInWithPassword` e `getSession` em parte do frontend.
- A documentação oficial informa que hashes de senha do Supabase não podem ser migrados.
- Não se deve prometer continuidade de IDs de usuário, sessões ou vínculo automático de contas.
- A documentação informa que `updateUser()` não pode alterar e-mail ou senha no Managed Auth.
- A aplicação precisa planejar novo cadastro/definição de senha ou outro fluxo de recuperação/ativação para os usuários existentes.

**Conclusão:** Auth é uma migração separada e de alto impacto. Não deve ser feita no mesmo corte de Postgres sem um plano de reidentificação, recuperação de acesso e suporte aos usuários.

## 2. Identidade atual do MobFlow

- Login de negócio é por username + senha + CNPJ, não por e-mail digitado pelo usuário.
- A Edge Function cria um e-mail sintético no formato `<username-normalizado>@accounts.mobflow.local` para usar Supabase Auth.
- O frontend recebe access token/refresh token e chama `auth.setSession`.
- `profiles.id` representa a identidade individual.
- `profiles.account_id` representa o tenant/empresa e não pode ser confundido com o ID individual.
- O gerente principal atualmente usa `account_id` igual ao seu ID Auth na criação inicial; operadores compartilham o account_id do gerente.
- O snapshot `app_state.owner_id`, empresas, segurança da Gerência e outros dados usam o identificador da empresa.

## 3. Consequência de IDs diferentes

Se os usuários forem recriados no Neon Auth, os IDs Auth provavelmente serão diferentes. A migração precisa manter uma tabela de correspondência segura entre:
- ID antigo do Supabase Auth;
- ID novo do Neon Auth;
- username normalizado;
- papel e status;
- account_id/tenant antigo.

A correspondência é necessária para atualizar `profiles.id` e qualquer FK que aponte para o usuário. Em paralelo, o `account_id` precisa permanecer estável durante a primeira migração, se a auditoria das FKs confirmar que ele é a chave de tenant usada pelos dados operacionais.

Não regenerar `account_id` automaticamente: isso poderia separar usuários da empresa do snapshot `app_state`, configurações, empresas e segurança da Gerência.

## 4. Compatibilidade com Managed Better Auth

Pontos favoráveis:
- AWS é a plataforma/região do projeto Neon de teste.
- O projeto de teste está em `aws-us-east-2`, região compatível com Managed Auth.
- O SDK oferece adaptador para manter formas de chamada Supabase em parte do frontend.
- Managed Auth suporta e-mail/senha e sessões.

Pontos que exigem protótipo:
- Se o endereço sintético `@accounts.mobflow.local` é aceito no fluxo de cadastro/login e como se comportam verificação e envio de e-mail.
- Como implementar o login por username + CNPJ mantendo a validação de empresa e assinatura.
- Como manter o comportamento de “lembrar login” entre localStorage e sessionStorage.
- Como as funções/backend validam JWT Managed Auth e resolvem perfil/tenant.
- Como atualizar ou remover e-mail/credenciais quando o usuário troca username.
- Como fazer a recuperação de senha do gerente sem depender do fluxo atual Supabase.
- Como lidar com usuários bloqueados, revogação de sessão e troca de senha.

Limitações documentadas:
- JWT Managed Auth usa EdDSA/Ed25519, validade de 15 minutos e não permite custom claims.
- MFA, passkeys, SAML/SSO e plugins arbitrários não estão expostos no Managed Auth conforme matriz da skill consultada; se algum deles for requisito atual, manter o provedor ou avaliar Better Auth self-managed com a versão instalada validada.
- Produção requer SMTP próprio para fluxos de e-mail que dependam de links; não assumir o SMTP compartilhado de desenvolvimento como solução de produção.

## 5. Estratégia de transição recomendada para avaliação

Não é autorização para executar. A proposta a comparar no plano final é:

1. Primeiro preparar e validar o Postgres Neon e APIs, mantendo Supabase Auth como provedor temporário.
2. Implementar um adaptador server-side que valida a identidade existente e consulta o perfil/tenant no banco de destino.
3. Migrar dados mantendo `account_id` estável e criando mapeamento de IDs individuais.
4. Validar todas as operações e sincronização com usuários reais de teste, sem mudar produção.
5. Em fase separada, prototipar Managed Better Auth e o fluxo de reativação de credenciais.
6. Fazer corte de Auth somente após aprovar experiência de primeiro acesso, reset de senha, sessão, logout, bloqueio e suporte.
7. Manter plano de rollback que não dependa de tentar converter hashes de senha impossíveis de exportar.

Essa sequência reduz o número de variáveis alteradas no mesmo corte e evita misturar migração de dados com reidentificação de todos os usuários.

## 6. Storage para comprovantes

O bucket atual é privado, limite 5 MiB e aceita JPEG/PNG/WEBP/PDF. A auditoria de produção encontrou zero objetos no bucket na medição anterior e confirmou novamente bucket privado, sem policies de linha em `storage.objects`.

Neon Object Storage:
- é S3-compatible e branchable;
- buckets `private` exigem credencial para todas as operações;
- suporta URLs pré-assinadas de upload/download;
- está disponível na região `aws-us-east-2` do projeto de teste.

Arquitetura proposta para avaliação:
- upload/download de bytes direto ao storage por URL pré-assinada de curta duração;
- backend valida usuário, solicitação, empresa, MIME, tamanho e path antes de emitir a URL;
- banco guarda apenas bucket/key e metadados;
- chave nunca é escolhida livremente pelo navegador;
- limpeza/compensação de arquivo órfão em falha da atualização do registro;
- acesso privado continua obrigatório.

O endpoint e a autorização do painel que visualiza comprovantes ainda precisam ser encontrados. Não criar bucket nem migrar arquivos nesta etapa.

## 7. APIs e Functions

Como o frontend atual é TanStack Start/Vite e faz chamadas Supabase diretamente, o caminho preferido a prototipar é uma camada backend (handlers do app ou Neon Functions) que:
- autentica o usuário;
- resolve perfil e tenant;
- executa SQL transacional/CAS;
- emite sealed queries para Realtime;
- emite URLs pré-assinadas para Storage.

Não expor `DATABASE_URL`, segredo Realtime, service credentials ou credenciais S3 ao navegador. Não usar Data API automaticamente só porque existe `supabase-js`: a aplicação usa diretamente o SDK para Auth e também para PostgREST; a dependência de banco deve ser substituída por APIs autorizadas, a menos que uma decisão específica justifique compatibilidade PostgREST.

## 8. Fontes técnicas consultadas

- Neon Auth skill e referência Managed Auth, com guia oficial de migração Supabase Auth.
- Neon Object Storage skill.
- Neon Functions production hardening.
- Neon Realtime queries e subscribing.
- URLs de referência: https://neon.com/docs/auth/migrate/from-supabase.md ; https://neon.com/docs/auth/production-checklist.md ; https://neon.com/docs/realtime/guides/queries.md ; https://neon.com/docs/compute/functions/authentication.md

## 9. Decisões ainda necessárias

1. A migração inicial mantém Supabase Auth ou inclui corte de Auth?
2. Se houver Managed Auth, qual será o processo de redefinição/reativação de senha para os usuários atuais?
3. O username continuará sendo identificador de login, com CNPJ obrigatório para operador/gerente?
4. O `account_id` será preservado como identificador estável de tenant?
5. Qual backend hospedará os endpoints autorizados: handlers no host atual ou Neon Functions?
6. Qual é o fluxo real de visualização/download do comprovante no painel administrativo?

## 10. Limites

Nenhum serviço Neon foi ativado. Não foram criados buckets, credenciais, usuários, tabelas ou Functions. Nenhuma configuração Auth foi alterada. Esta é uma avaliação de compatibilidade para o plano, não uma decisão de corte aprovada.
