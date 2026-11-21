# MobFlow PDV — checkpoint de prontidão do Preview Neon

Data: 2026-11-06
Branch Git: `migration/neon-preparation`
Branch Neon: `integration-test` (`br-wandering-union-bd6vcsk6`)
Banco: `mobflow_pdv_test`

## Verificação executada nesta etapa

Conectado ao banco de teste usando exclusivamente o papel `mobflow_api_test`, sem usar o proprietário do banco para as consultas abaixo.

Resultado observado:

- Banco acessível com o papel restrito.
- Contexto de identidade transacional estava vazio ao conectar (`app.user_id` e `app.account_id` nulos), como esperado antes de autenticação.
- O papel consegue SELECT em `profiles`.
- Em `app_state`, consegue SELECT, INSERT e UPDATE.
- Não consegue DELETE em `app_state`.
- Não consegue INSERT/UPDATE em `profiles`.
- Não consegue SELECT em `companies`, `manager_security`, `manager_security_by_account`, `manager_password_recovery_tokens` ou `account_allowlist`.
- As consultas de contagem retornaram zero linhas visíveis em `profiles` e `app_state`; não foram criados dados de clientes.

## Preview Vercel

A implantação mais recente da branch foi encontrada como READY:

- Commit: `057e8f8699f7fc8f28b7fcacc4b405acc520300a`
- URL: `https://mobflow-pos-stock-lmeu1hzl9-willianx64bit.vercel.app`
- Escopo: Preview da branch de migração; não é Production.

Essa implantação contém a documentação de auditoria, não contém ainda as rotas de integração Neon.

## Bloqueio real para avançar com segurança

A branch ainda não contém:

- driver PostgreSQL/Neon instalado;
- pool server-only;
- rota server-side de validação do access token Supabase;
- rotas Neon de leitura e gravação CAS;
- testes executáveis dessas rotas.

O projeto usa `bun.lock`. Não editar esse lockfile manualmente nem adicionar dependência sem regenerá-lo com Bun. Sem ambiente de execução Bun/TypeScript disponível nesta sessão, não é seguro inventar o lockfile ou declarar que a integração compila.

## Próxima sequência obrigatória

1. Obter ambiente de execução Bun para instalar `@neondatabase/serverless` e atualizar `bun.lock` pelo gerenciador.
2. Implementar módulo server-only e validação do token com Supabase Auth; manter o login atual.
3. Criar endpoint de contexto de sessão e endpoint de leitura do estado.
4. Criar escrita CAS com retorno explícito de gravado/conflito/erro e timestamp do servidor.
5. Testar isolamento A/B, token inválido/expirado, primeira gravação e duas gravações concorrentes.
6. Fazer deploy Preview e testar fluxo ponta a ponta.
7. Somente depois avaliar a troca gradual do store; manter Realtime, polling, RPCs de recebimento e operações de estoque intocados.

## Limites preservados

Nenhum DDL/DML de produção, migração de dados, troca de autenticação, mudança no store, sincronização, estoque, Edge Functions, variável Production ou deploy Production foi executado nesta etapa.
