# MobFlow PDV — contrato real do store/CAS e limite da primeira API

Data da auditoria: 2026-11-06  
Branch: `migration/neon-preparation`  
Escopo: leitura do código existente; nenhuma alteração em runtime, banco, autenticação ou sincronização.

## Arquivos inspecionados

- `package.json`
- `src/lib/store.ts`
- `src/lib/supabase.ts`
- `src/start.ts`
- `src/server.ts`

Os endpoints `src/routes/api/mobflow/session-context.ts` e `src/routes/api/mobflow/state.ts` ainda não existem nesta branch. Também não existe um módulo de autenticação server-side dedicado.

## O que o aplicativo faz hoje (contrato a preservar)

### Identidade e sessão

- O navegador usa `@supabase/supabase-js` e mantém a sessão com a chave `mobflow-auth-session`.
- `hydrateStore()` chama `supabase.auth.getUser()`; depois consulta `profiles.id` para obter `account_id`.
- O identificador efetivo do estado é `profile.account_id ?? user.id`.
- O cliente não deve poder escolher `user_id`, `account_id` ou `role` enviados no corpo da requisição.
- A primeira API Neon deve receber o access token atual em `Authorization: Bearer`, validá-lo com Supabase Auth no servidor e só então consultar o perfil Neon. Não decodificar JWT sem validar assinatura/claims e não trocar o provedor de sessão nesta fase.

### Leitura do estado

- A leitura atual busca `app_state(state, updated_at)` por `owner_id = accountId`.
- Se houver estado remoto, o store o hidrata e atualiza `lastCloudUpdatedAt` e `lastSyncedState`.
- Se não houver linha para uma conta nova, o store inicia um estado vazio; não deve importar dados locais de outra conta.
- A reconciliação usa `mergeConcurrentState(base, local, remote)`; ela combina registros por ID e trata movimentos de estoque como deltas para evitar aplicar duas vezes o mesmo movimento.

### Escrita e CAS

O fluxo atual em `persistState()` é um compare-and-swap por `updated_at`:

1. Captura um snapshot local e o `lastCloudUpdatedAt` esperado.
2. Se já existe versão, executa UPDATE de `app_state` filtrando simultaneamente por `owner_id` e `updated_at` esperado.
3. Se não existe versão, faz UPSERT com conflito em `owner_id`.
4. Se UPDATE não retorna linha, interpreta como conflito, relê o estado remoto, mescla e tenta novamente (até 3 tentativas).
5. Falhas de rede/SQL preservam o pedido de gravação para retry posterior; não podem ser tratadas como sucesso.
6. Ao confirmar a gravação, atualiza o timestamp/base sem sobrescrever uma versão mais nova já recebida por Realtime.

A API de escrita precisa reproduzir o resultado inequívoco: **gravado**, **conflito com versão remota**, ou **erro**. Não responder sucesso quando o CAS não atualizou nenhuma linha. A geração de timestamp deve ser monotônica e executada no servidor/banco, sem confiar no relógio do dispositivo.

### Sincronização e operações de estoque

- O store atual mantém Realtime Supabase e fallback de polling de 3 segundos.
- Há chamadas RPC independentes para recebimento, incluindo `accept_receiving` e `finalize_receiving_decisions`.
- Esta etapa de integração de leitura/escrita de `app_state` não deve alterar Realtime, polling, funções RPC de recebimento, ledger/movimentações, cálculo de estoque, merge ou lógica de retry do cliente.
- A troca do cliente para os novos endpoints deve ser uma etapa posterior, depois de testar as APIs isoladamente. Não fazer substituição global de `supabase.from()` ou `supabase.rpc()`.

## Regras de segurança da API Neon

- A conexão Neon permanece exclusivamente no servidor, usando `NEON_DATABASE_URL` e o papel restrito de teste.
- Validar o access token com o endpoint de usuário do Supabase Auth; rejeitar token ausente, inválido ou expirado.
- Derivar `user_id` do usuário validado e `account_id`/papel do registro `profiles` do Neon. Ignorar identidade/tenant/role fornecidos pelo navegador.
- Aplicar `app.user_id`, `app.account_id` e `app.role` como contexto transacional local, dentro da mesma conexão/transação da consulta. Nunca usar configuração de sessão persistente em pool.
- Não retornar dados de outro tenant, nem permitir que um filtro do cliente amplie o escopo.
- Não conceder acesso de API a tabelas de empresa, segurança ou recuperação nesta primeira fatia.

## Estado desta auditoria

- **Feito:** contrato do store, identidade, CAS, merge e limites das operações de estoque documentados a partir do código real da branch.
- **Não feito:** instalação de `@neondatabase/serverless`, criação do pool, rotas de sessão/estado, testes de API e deploy Preview.
- **Sem alterações:** `src/lib/store.ts`, `src/lib/supabase.ts`, `src/start.ts`, `src/server.ts`, schema Neon, dados e variáveis de Production.

## Próxima implementação segura

1. Preparar ambiente de trabalho que permita executar Bun e gerar `bun.lock` pelo gerenciador.
2. Adicionar o driver e um módulo server-only pequeno, sem importar o pool no bundle do navegador.
3. Implementar primeiro validação de sessão e leitura de contexto; testar token válido, inválido, expirado, perfil ausente/inativo.
4. Implementar leitura/escrita de estado com CAS e respostas explícitas; testar conflito concorrente, conta sem linha e isolamento entre tenants.
5. Só depois propor a troca controlada do store, sem tocar nas RPCs de estoque, Realtime ou polling.
6. Rodar typecheck/build/testes e validar somente em Preview da branch de migração.

Nunca mesclar esta branch inteira para `main` sem revisar separadamente os dois arquivos preexistentes de Edge Functions já identificados no plano de migração.
