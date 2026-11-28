# MobFlow PDV — auditoria do consumidor de sincronização incremental

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: auditoria somente de código e testes. Nenhuma migration foi aplicada e nenhum dado/ambiente foi alterado.

## Resultado

A API de leitura incremental está implementada em `GET /api/mobflow/sync/events`, com paginação por sequência, limite máximo de 250 eventos, high-water mark por empresa e escopo derivado da identidade autenticada. Os testes cobrem ordenação, paginação, cursor inválido, limite, página vazia e rollback em falha.

A fundação de eventos está definida em `neon/migrations/0005_incremental_sync_foundation.sql`. A migration é aditiva e está marcada como ainda não aplicada.

**Bloqueio principal:** a auditoria de `src/lib/store.ts` não encontrou consumo de `/api/mobflow/sync/events`, cursor persistente ou aplicação de eventos. O cliente ainda chama `GET /api/mobflow/state` por `refreshFromCloud()` e executa reconciliação completa a cada 3 segundos em `startRealtime()`. Portanto, não é seguro remover essa reconciliação.

## Semântica atual do cliente

- O estado local é mantido no armazenamento do navegador e pode ter uma fila de persistência em andamento.
- `refreshFromCloud()` evita sobrescrever estado enquanto há persistência local em andamento e agenda reconciliação posterior.
- A gravação principal ainda é um documento completo em `public.app_state`, com controle otimista por `expectedUpdatedAt`.
- A API de eventos é uma camada adicional; não substitui ainda a leitura do estado completo.

## Eventos e projeções observados

- O endpoint de estado emite eventos manuais de catálogo, promoções, conferências e operações de estoque ao comparar o estado anterior com o próximo.
- O recebimento no caminho Better Auth emite evento manual de recebimento e eventos automáticos de delta de estoque na mesma transação da alteração de `app_state`.
- A projeção de catálogo exclui deliberadamente foto, estoque e preço de venda; esses dados têm tratamento separado.
- A API de eventos retorna payloads genéricos. Não existe ainda um projetor cliente centralizado que converta, de forma idempotente, cada categoria/entidade em alterações locais.

## Trabalho necessário antes de ativar o consumidor

1. Definir um contrato versionado de payload por categoria/entidade, incluindo operações `upsert`, `delete`, delta de estoque e eventos manuais.
2. Criar um projetor puro e testável que aplique eventos ao estado local sem substituir campos que não pertencem ao evento.
3. Persistir o cursor por conta/empresa, junto com a versão do estado projetado, somente depois de aplicar com sucesso todos os eventos da página.
4. Tornar a aplicação idempotente: repetir uma página após falha não pode duplicar estoque, vendas ou movimentos.
5. Definir bootstrap e recuperação: conta sem cursor, cursor antigo/inválido, lacunas, evento desconhecido e necessidade de snapshot completo.
6. Coordenar o consumidor com `persistWorker`, `persistQueue` e alterações locais; não aplicar eventos sobre gravação local pendente.
7. Testar dois aparelhos, offline/reconexão, páginas com mais de 250 eventos, repetição, falha no meio da página, exclusão/edição concorrente e isolamento entre empresas.
8. Só depois comparar resultados do projetor com `GET /api/mobflow/state` em Preview e considerar reduzir/remover a reconciliação completa.

## Recebimento no Neon

A rota `src/routes/api/mobflow/receiving.ts` executa a leitura bloqueante de `app_state`, valida decisões, calcula os deltas e grava eventos e novo estado dentro da mesma transação. O teste `src/test/better-auth-receiving.test.ts` cobre decisão completa, decisão ausente, estoque atual inválido, aceitação e repetição após liberação.

Essa cobertura é útil, mas ainda não substitui testes reais de concorrência/transação no Neon Preview, nem valida o consumo desses eventos em dois clientes.

## Limites de segurança mantidos

- Não remover o polling/reconciliação de 3 segundos nesta etapa.
- Não aplicar a migration 0005 em produção.
- Não remover fallback Supabase.
- Não alterar o fluxo de login principal nem a senha separada de segurança da Gerência.
- Não modificar o MobFlow Admin nem o ColetaFlow.
- Não declarar a migração concluída antes dos testes ponta a ponta e do plano de rollback.

## Arquivos verificados

- `src/lib/store.ts`
- `src/routes/api/mobflow/sync/events.ts`
- `src/test/mobflow-sync-events-api.test.ts`
- `src/routes/api/mobflow/state.ts`
- `neon/migrations/0005_incremental_sync_foundation.sql`
- `src/routes/api/mobflow/receiving.ts`
- `src/test/better-auth-receiving.test.ts`
