# 74 — Confirmação do fluxo atual de sincronização no cliente

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Fonte: leitura de `src/lib/store.ts` na branch de preparação. Nenhum código foi alterado.

## 1. Fluxo atual confirmado

O cliente ainda usa `app_state` como fonte principal compartilhada:
- `hydrateStore()` chama `/api/mobflow/session-context` e depois `/api/mobflow/state`;
- o estado remoto é carregado como um objeto completo e combinado com a cópia local;
- `set()` persiste o estado completo no `localStorage` e chama `persistState()`;
- `persistState()` envia o snapshot inteiro por `PUT /api/mobflow/state`, com `expectedUpdatedAt`;
- conflito HTTP 409 busca/mescla snapshot remoto e tenta persistir novamente;
- `startRealtime()` instala listeners de foco, visibilidade e reconexão, mas também inicia polling a cada 3 segundos;
- cada polling chama `GET /api/mobflow/state`, que baixa o snapshot completo;
- o retry do worker usa timer de 1,8 segundo após falhas persistentes.

## 2. Consequências técnicas

1. O stream incremental existente não é consumido pelo store: ainda não há cursor durável nem aplicação de páginas de eventos.
2. A fila de persistência é serializada em memória (`persistQueue`/`persistWorker`), não uma outbox durável de comandos individuais.
3. `set()` não representa intenção de negócio. Ele grava estado completo, tornando difícil aplicar idempotência e autorização por operação.
4. O merge tenta preservar dados locais e somar deltas de movimentos, mas não substitui transações de venda/estoque no servidor.
5. O polling atual é explicitamente fallback temporário; remover apenas o timer sem implementar consumidor incremental deixaria dispositivos sem receber atualizações.
6. A migração deve separar três responsabilidades: comando de negócio, evento de transporte e ledger histórico. Não usar o evento de sync como substituto do histórico de estoque.

## 3. Sequência de substituição recomendada

### Fase A — Outbox local
- Criar tabela/armazenamento local durável para comandos pendentes, com UUID idempotente criado uma vez.
- Persistir comando antes de tentar enviar.
- Marcar como confirmado apenas após resposta canônica do servidor.
- Em erro de rede/timeout, manter comando e repetir com a mesma chave.
- Não apagar nem substituir dados locais em falha.

### Fase B — Comandos transacionais
- Começar por checkout e movimentos de estoque, pois hoje alteram múltiplas estruturas relacionadas.
- Servidor valida sessão, tenant, permissões, caixa e versão/estoque.
- Uma transação grava entidade, itens, pagamentos, ledger e evento incremental.
- Repetir a mesma chave deve devolver o resultado original sem nova baixa/venda/movimento.

### Fase C — Consumidor incremental
- Buscar `GET /api/mobflow/sync/events?cursor=...`.
- Aplicar eventos em ordem; validar tenant e tipo; tratar evento desconhecido sem avançar cursor indevidamente.
- Atualizar cursor local somente depois que a página inteira for aplicada com sucesso.
- Buscar páginas adicionais enquanto `hasMore` for verdadeiro, respeitando `highWaterMark`.
- Cursor e outbox persistem entre reinícios e reconexões.

### Fase D — Desativação controlada do snapshot polling
- Executar testes de duas ou mais instalações, offline/reconexão, duplicação, timeout, paginação, reinício e isolamento multiempresa.
- Manter snapshot apenas como bootstrap/reconciliação controlada durante transição.
- Remover polling de 3 segundos somente depois que o consumidor incremental for comprovadamente suficiente no Preview.

## 4. Critérios de aceite

- Nenhuma venda ou movimento duplicado após retry.
- Nenhuma atualização perdida após ficar offline e reiniciar o app.
- Cursor não avança quando uma página falha parcialmente.
- Dispositivo recebe apenas eventos posteriores ao cursor, sem baixar estado completo a cada ciclo.
- Duas empresas nunca recebem dados uma da outra.
- A tela de histórico continua consultando o ledger completo, com filtros atuais; não fica limitada aos eventos recentes.
- Botão manual “Sincronizar” continua disponível para reenviar outbox e recuperar páginas pendentes.

## 5. Limites

Auditoria somente de código. Nenhuma alteração no cliente, API, banco, Supabase, Vercel, Admin ou ColetaFlow.
