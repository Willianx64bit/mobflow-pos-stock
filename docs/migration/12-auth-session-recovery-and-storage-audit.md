# MobFlow PDV — auditoria de autenticação, recuperação e comprovantes

Data: 06/11/2026  
Branch: `migration/neon-preparation`  
Escopo: leitura do código versionado e inventários já realizados. Documento de auditoria; não altera o aplicativo, Supabase ou Neon.

## 1. Sessão do aplicativo

O cliente em `src/lib/supabase.ts` usa Supabase JS v2 com:

- persistência de sessão habilitada;
- renovação automática de token habilitada;
- detecção de sessão na URL desabilitada;
- chave de armazenamento `mobflow-auth-session`;
- escolha entre `localStorage` e `sessionStorage` pela preferência `mobflow-remember-login`;
- remoção da sessão dos dois storages no logout/limpeza do cliente;
- acesso ao storage protegido contra execução durante SSR.

O login é intermediado por `mobflow-login`: a função valida usuário, empresa, assinatura, papel, CNPJ e estado ativo; depois chama `signInWithPassword` e devolve a sessão ao frontend. Portanto, a migração de Auth precisa cobrir tanto a emissão/validação da identidade quanto o retorno e armazenamento de access token e refresh token.

### Requisitos de compatibilidade

1. Manter a distinção entre identidade individual (`profiles.id`) e conta/tenant (`profiles.account_id`).
2. Preservar login de gerente e operador, bloqueio por `profiles.active`, CNPJ e validação de assinatura.
3. Preservar renovação, expiração, logout e comportamento de “lembrar login”.
4. Definir como tokens emitidos pelo novo provedor serão verificados por APIs, Functions e camada de autorização.
5. Não confiar em papel/permissões enviados pelo navegador sem revalidar a identidade e o perfil no servidor.
6. Testar sessão em duas abas/dispositivos, refresh após expiração, logout, usuário bloqueado e troca de senha.

## 2. Reautenticação da Gerência

O código versionado de `mobflow-reauth-manager`:

- valida o bearer token com `auth.getUser(token)`;
- busca o perfil ativo do usuário;
- aceita gerente ou operador com permissão `Gerência`;
- consulta `manager_security_by_account` usando o `account_id`;
- suporta `status`, `set_password` e `verify`;
- armazena e compara o segredo de Gerência usando SHA-256 simples, sem salt/work factor no código analisado.

O inventário anterior registrou diferença entre o arquivo versionado e a função publicada v14 quanto ao critério de papel/permissão. A tentativa de recuperar o conteúdo publicado pela integração de leitura não foi concluída nesta etapa; portanto, a versão efetiva de produção permanece pendente de nova confirmação por fonte autorizada. Não escolher automaticamente uma das versões.

### Risco e decisão necessária

SHA-256 simples não é um esquema apropriado para armazenar senha humana. A migração deve decidir entre compatibilidade temporária com verificação de hash legado e atualização gradual para hash de senha com salt e work factor (por exemplo, Argon2id ou bcrypt), sem bloquear os usuários existentes. A decisão funcional sobre quem pode reautenticar como Gerência também precisa ser aprovada e testada.

## 3. Recuperação da senha da Gerência

Código analisado: `supabase/functions/mobflow-manager-password-recovery/index.ts`.

Fluxo de solicitação:

1. Recebe e-mail e CNPJ.
2. Procura perfil de gerente ativo e confere o e-mail com o registro da empresa.
3. Responde genericamente quando os dados não correspondem, reduzindo enumeração de contas.
4. Limita a três tokens por conta na janela móvel de uma hora.
5. Gera token aleatório, armazena apenas SHA-256 do token e define validade de 30 minutos.
6. Envia link por Gmail SMTP; a URL base usa `MOBFLOW_APP_URL` ou fallback do ambiente de teste.

Fluxo de redefinição:

1. Valida token e senha mínima de oito caracteres.
2. Localiza o hash do token, verifica validade e uso.
3. Tenta marcar o token como usado com atualização condicional (`used_at IS NULL` e `expires_at > now`), impedindo duas reivindicações concorrentes.
4. Depois grava a nova senha da Gerência em `manager_security_by_account`.

### Risco confirmado no fluxo atual

A reivindicação do token e a gravação da nova senha são duas operações separadas. O token pode ser marcado como usado e, em seguida, a gravação da senha falhar. Nesse cenário, o link fica consumido sem a troca de senha. Não é uma transação atômica.

### Requisito de destino

A reivindicação do token e a atualização da senha devem ocorrer numa única transação no backend, ou num fluxo idempotente com compensação comprovada. Preservar:
- token aleatório, armazenando somente hash;
- uso único e expiração;
- limitação de solicitações;
- resposta genérica para evitar enumeração;
- envio de e-mail server-side;
- proteção contra repetição e corrida;
- logs sem token, senha ou segredo SMTP.

Configuração SMTP e URL pública são dependências de ambiente. Nenhum segredo deve ser versionado ou enviado ao cliente.

## 4. Cadastro inicial e comprovante de pagamento

Código analisado: `supabase/functions/mobflow-signup/index.ts`.

### Upload do comprovante

- Usa bucket privado `mobflow-payment-proofs`.
- Aceita JPEG, PNG, WEBP e PDF.
- Limita o arquivo a 5 MiB, validando tamanho após decodificação.
- Exige token de solicitação UUID válido e procura a empresa pelo token.
- Gera caminho isolado por token de solicitação e UUID de arquivo.
- Faz upload sem sobrescrita (`upsert: false`).
- Atualiza `payment_proof_path`, `payment_submitted_at` e mantém estado `pending_payment`.
- Se a atualização do registro falha, tenta remover o objeto recém-enviado.

### Requisitos de destino

1. Manter armazenamento privado; não criar leitura pública.
2. Preservar validação de token, MIME, tamanho e caminho isolado.
3. Definir autorização server-side para upload, consulta, download e exclusão.
4. Usar URL assinada de curta duração quando a visualização for necessária.
5. Preservar a compensação quando o upload concluir e a gravação de metadados falhar.
6. Prever limpeza de arquivos órfãos e auditoria de ações administrativas.
7. Testar falha de upload, falha ao gravar metadados, repetição do envio, arquivo acima do limite e acesso de outra conta.

### Outras dependências do cadastro

O fluxo usa credencial privilegiada server-side para Auth Admin e tabelas. Também chama `mobflow-public-billing` no projeto Supabase separado `xsitutjpdshmidzpgxpx` para obter configuração Pix/preço. Essa integração externa não faz parte da migração do banco PDV e não deve ser alterada nesta etapa.

O primeiro acesso da Gerência e o cadastro inicial são fluxos multi-etapas envolvendo allowlist, Auth, perfil e empresa. Há compensações em algumas falhas, mas não existe uma única transação envolvendo Auth e todas as tabelas. A arquitetura futura deve prever idempotência, rastreabilidade e recuperação de falhas parciais.

## 5. Dependências e segredos

Dependências identificadas:
- Supabase Auth Admin e emissão/renovação de sessão;
- Gmail SMTP (`GMAIL_SMTP_HOST`, `GMAIL_SMTP_PORT`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`);
- `MOBFLOW_APP_URL`;
- bucket privado de comprovantes;
- endpoint de cobrança pública em projeto Supabase externo.

Os nomes das variáveis são registrados para inventário, mas seus valores não devem ser exportados, copiados para Git ou exibidos em logs.

## 6. Pendências e limites desta auditoria

- Configuração Auth do projeto (confirmação de e-mail, duração de sessão, rotação de refresh token, política de senha, MFA e SMTP) não foi disponibilizada pela leitura atual. Não assumir valores.
- A versão publicada de `mobflow-reauth-manager` e sua divergência com o repositório precisam ser confirmadas por fonte autorizada.
- A matriz de autorização do backend está documentada parcialmente em `11-authorization-and-operations-matrix.md`; a auditoria de menus, rotas e componentes frontend ainda não foi fechada.
- As políticas efetivas do bucket e os consumidores frontend de leitura/download precisam de confirmação adicional.
- Não foi feito teste de fluxo, alteração de configuração, chamada de escrita, upload, redefinição ou login neste trabalho.

## 7. Próximas atividades da Etapa 3

1. Localizar no frontend todas as chamadas de Auth e funções e mapear telas/rotas por permissão.
2. Confirmar a versão efetivamente publicada de `mobflow-reauth-manager`.
3. Obter, por leitura autorizada, os parâmetros de configuração Auth e políticas de Storage.
4. Comparar opções de identidade e armazenamento de arquivos sem provisionar nem ativar serviços.
5. Consolidar plano de migração com sequência, critérios de aceite, rollback e matriz de testes.

**Estado:** auditoria/documentação somente. Nenhuma alteração funcional, DDL, gravação de dados, deploy ou ativação de serviço foi realizada.
