# Auditoria dos eventos gerados pelo endpoint de snapshot

Data: 2026-11-08  
Branch: `migration/neon-preparation`

## Escopo

Leitura de `src/routes/api/mobflow/state.ts`, linhas iniciais até a projeção de conferências, em conjunto com os documentos 57–59. Nenhuma alteração de runtime ou banco foi feita.

## Achados

1. O endpoint `GET /api/mobflow/state` lê um único registro de `public.app_state` para a conta autenticada e devolve o snapshot completo.
2. O endpoint `PUT` aceita um objeto `state` inteiro (limite 8 MiB) e usa `expectedUpdatedAt` + `FOR UPDATE`/comparação otimista para evitar sobrescrever uma versão remota diferente.
3. Quando atualiza o snapshot, o próprio endpoint compara estado anterior e novo e deriva eventos para algumas coleções, incluindo catálogo de produtos, promoções e conferências.
4. Os eventos de catálogo excluem foto, estoque e preço de venda; comentários indicam que estoque/preço possuem eventos dedicados e fotos serão movidas para object storage.
5. A projeção de promoções/conferências é construída a partir de comparação de snapshots, não de comandos de negócio explícitos.
6. Para os eventos derivados do snapshot, os argumentos de idempotência são gerados com `randomUUID()` durante cada requisição. Isso merece tratamento antes de usar o endpoint como produtor definitivo: uma repetição lógica do mesmo comando pode gerar um novo evento se chegar como uma nova atualização aceita. O controle otimista reduz alguns cenários, mas não substitui uma chave de operação estável ponta a ponta.
7. O snapshot completo continua sendo a unidade de escrita e a origem da comparação. Assim, o endpoint de eventos hoje é uma projeção incremental de mudanças detectadas em snapshots, e não ainda uma arquitetura inteiramente command/event-first.

## Decisões necessárias antes do consumidor

- Definir quais entidades serão atualizadas por comandos transacionais próprios em vez de diffs do snapshot.
- Para cada comando, gerar uma idempotency key estável no cliente e reutilizá-la em retries.
- Distinguir eventos originados por comandos explícitos daqueles derivados de snapshots legados.
- Versionar os payloads e declarar quais campos são obrigatórios/opcionais.
- Para exclusões, definir tombstone e comportamento de replay.
- Garantir que um evento tenha informação suficiente para projetar a coleção sem depender do snapshot completo.
- Evitar publicar a mesma alteração duas vezes por caminhos distintos (por exemplo, evento específico de estoque e evento inferido do snapshot).
- Fazer reconciliação de contagens/versões entre snapshot e stream durante a transição.

## Próximo passo

Completar o inventário de tipos e payloads no restante de `state.ts` e rotas especializadas. Em seguida, desenhar a matriz comando → transação → evento → reducer. Não implementar consumidor até fechar essa matriz e os contratos de idempotência.

## Segurança

Não aplicar `0005_incremental_sync_foundation.sql` sem aprovação e verificação do ambiente. Não remover polling, fallback Supabase ou snapshot bootstrap. Não tocar produção, Admin, ColetaFlow ou fluxos de senha.