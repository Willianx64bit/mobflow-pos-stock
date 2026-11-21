# MobFlow PDV — matriz de Edge Functions e dependências

Data: 06/11/2026  
Escopo: código do PDV na branch `migration/neon-preparation` e inventário já consultado no projeto Supabase PDV. Documento de planejamento; não altera Functions nem ambientes.

## Inventário

| Function | Versão publicada | verify_jwt | Responsabilidade/dependências que precisam ser preservadas |
|---|---:|---:|---|
| `mobflow-login` | 27 | false | Busca perfil e empresa, valida assinatura/status, allowlist, cria/valida usuário em casos previstos e autentica por senha. Usa Auth Admin e tabelas `profiles`, `companies`, `manager_security_by_account`, `account_allowlist`. Como `verify_jwt=false`, mantém validações internas e proteção contra abuso. |
| `mobflow-users` | 23 | true | Valida bearer com `auth.getUser`; lista/cria/atualiza permissões/ativa/desativa/redefine senha/exclui usuários; usa Auth Admin, `profiles`, `account_allowlist`, `manager_security_by_account`, `app_state`. Ações `reset_application` e `delete_all_pdv` são destrutivas e exigem autorização forte, confirmação e tratamento de falha parcial. |
| `mobflow-reauth-manager` | 14 | true | Valida bearer, perfil e senha exclusiva da gerência por empresa em `manager_security_by_account`; ações `status`, `set_password`, `verify`. SHA-256 atual deve ser tratado como legado na migração e avaliado para hash com salt/work factor. |
| `mobflow-signup` | 16 | false | Cadastro, primeiro acesso da gerência e envio de comprovante. Usa Auth Admin, `profiles`, `companies`, `account_allowlist`, `app_state`, bucket privado `mobflow-payment-proofs` e chamada HTTP para `mobflow-public-billing` no projeto separado `xsitutjpdshmidzpgxpx`. `submit_payment_proof` faz upload e atualiza metadados; se atualização falha, remove o objeto enviado. `complete_manager_setup` usa token de setup e atualiza usuário/perfil/empresa. |
| `mobflow-manager-password-recovery` | 11 | false | Solicita e reseta senha de gerência; usa `profiles`, `companies`, `manager_password_recovery_tokens`, `manager_security_by_account` e Gmail SMTP via variáveis de ambiente `GMAIL_SMTP_HOST`, `GMAIL_SMTP_PORT`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`; também usa `MOBFLOW_APP_URL`. Preservar rate limit e respostas genéricas contra enumeração. A reivindicação do token e a atualização da senha precisam ser atômicas ou ter compensação segura. |
| `mobflow-admin-api` | 1 | true | Valida bearer e email administrativo permitido; atualmente expõe `list_companies` com leitura de `companies`. Está hospedada no projeto PDV, mas parece atender o fluxo do painel Admin. Não remover nem alterar sem confirmar o consumidor; não acessar/modificar o projeto Admin nesta migração. |

## Dependências externas

1. **Cobrança pública:** `mobflow-public-billing` permanece em outro projeto Supabase (`xsitutjpdshmidzpgxpx`). O cadastro do PDV consulta esse endpoint para obter configurações de Pix/preço. Preservar integração e não alterar o projeto externo.
2. **E-mail:** recuperação de senha depende de Gmail SMTP e segredo de app no ambiente server-side. Nunca transportar esses segredos para o navegador ou versionamento.
3. **Comprovantes:** bucket privado `mobflow-payment-proofs`, limite e tipos já inventariados no documento de schema. Definir se permanece temporariamente no Supabase Storage ou migra para outro armazenamento; não tornar público.
4. **Auth Admin:** cadastro, usuários e recuperação executam operações privilegiadas no Supabase Auth. A migração precisa oferecer equivalente server-side; não usar chave privilegiada no frontend.
5. **Allowlist de conta:** o gatilho `auth.users` e a tabela `account_allowlist` participam do fluxo de criação. Preservar a regra em serviço seguro equivalente, mesmo se a identidade migrar.

## Divergência importante — reautenticação da gerência

A Function publicada em produção (`mobflow-reauth-manager` v14) difere do arquivo versionado no GitHub: a produção permite qualquer perfil ativo com permissão de Gerência; o arquivo da branch também exige `role === 'pdv'` para não-gerentes. Não escolher uma das versões automaticamente. Registrar decisão funcional e reproduzir a versão aprovada nos testes antes da migração.

## Regras para portar

- Para endpoints hoje com `verify_jwt=false`, não assumir que o gateway protege a chamada: preservar autenticação, validação de payload, rate limit e anti-enumeração dentro do endpoint.
- Para endpoints com `verify_jwt=true`, manter verificação de sessão e autorização de tenant/role; a autenticação não substitui autorização de ação.
- Derivar `account_id` do usuário validado no servidor. Nunca confiar em `account_id`, `owner_id`, role ou email administrativo enviado pelo cliente.
- Operações multi-tabela de cadastro/primeiro acesso/recuperação devem ser transacionais ou usar compensações verificáveis. Documentar idempotência e falhas parciais.
- Não portar `service_role` para o cliente; usar conexão privada/credencial server-side no Neon.
- Manter logs sem tokens, senhas, hashes, comprovantes ou segredos SMTP.
- Testar usuário suspenso, empresa inadimplente/expirada, usuário bloqueado, tenant cruzado, token expirado/reutilizado, SMTP indisponível, Storage indisponível e falha parcial de Auth/DB.

## Estado da auditoria

- Cinco Functions publicadas coincidem com o código versionado consultado; `mobflow-reauth-manager` é a exceção conhecida.
- Nenhuma Function foi alterada ou invocada nesta auditoria.
- Nenhum segredo ou valor de variável de ambiente foi lido.
- Nenhuma chamada foi feita ao endpoint de cobrança externo.
- O painel Admin e seu projeto permanecem fora do escopo.

## Próximos bloqueios da Etapa 3

1. Confirmar qual comportamento de reautenticação da gerência é o correto (sem editar a Function atual).
2. Definir destino do Storage privado e compatibilidade do fluxo de comprovantes.
3. Definir contrato de API server-side para CRUD, Auth Admin, CAS e RPCs.
4. Confirmar estratégia de JWT do Supabase sem alterar signing keys.
5. Completar testes de caracterização e matriz de autorização antes de iniciar Etapa 4.
