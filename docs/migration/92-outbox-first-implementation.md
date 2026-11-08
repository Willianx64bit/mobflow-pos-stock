# Doc92 — Primeira implementação do outbox e sincronização incremental

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: somente MobFlow PDV. Não habilitado em produção.

## Implementado nesta etapa

### Fila local

- Novo módulo `src/lib/sync-outbox.ts`.
- IndexedDB armazena comandos por tenant, domínio, endpoint, payload, chave de idempotência, data, tentativas e estado.
- Uma cópia síncrona temporária em localStorage protege o comando entre a ação do usuário e o commit do IndexedDB; a cópia é removida depois que o IndexedDB confirma a gravação.
- Ao retomar a sincronização, o backup é restaurado para IndexedDB antes do envio.
- O endpoint é validado contra o domínio permitido; a chave de idempotência precisa corresponder ao payload.
- Reenvio usa a mesma chave. Resposta de sucesso remove o comando; falha transitória mantém pendente; erro de negócio/permissão fica marcado para revisão e tentativa manual.

### Comandos ligados às ações atuais (protegidos por feature flags)

- Venda à vista, Pix e cartão: `POST /api/mobflow/sales`.
- Abertura, sangria/reforço e fechamento de caixa: `POST /api/mobflow/cash`.
- Ajuste de estoque: `POST /api/mobflow/stock`.
- Fiado, baixa de estoque, transferência, recebimento, importação e alterações gerais de cadastro ainda não foram conectados ao outbox.

### Compatibilidade do schema de eventos

- A migration `0005_incremental_sync_foundation.sql` foi atualizada para incluir as categorias `sales` e `cash` e aceitar payloads limitados a 128 KiB.
- Como o schema de eventos já existe no Neon de ensaio, foi criado o draft aditivo `0007_incremental_sales_cash_event_compatibility_DRAFT.sql` para atualizar a constraint de categoria e o limite de payload em branches que já receberam a 0005.
- **A 0007 não foi aplicada.** Antes de habilitar os comandos no Preview, validar a constraint real do banco e aplicar a migration somente na branch Neon isolada aprovada.

### Recebimento incremental

- Novo módulo `src/lib/sync-event-apply.ts` aplica projeções de venda, caixa, estoque e preço de forma idempotente.
- O cursor só avança depois que a página foi aplicada.
- Categorias/eventos sem projeção ainda lançam erro controlado; nesse caso, o cliente recupera um snapshot autenticado e adota o cursor consistente desse snapshot, em vez de ignorar silenciosamente a alteração.
- `GET /api/mobflow/state` agora retorna o high-water mark do ledger no mesmo SELECT do snapshot, evitando que o cursor inicial pule eventos concorrentes entre duas consultas.
- Neon Realtime, foco da janela, retorno online e botão manual acordam o mesmo ciclo incremental; não foi criado timer de 3 segundos.

### Botão manual

- O cabeçalho do PDV ganhou controle de sincronização.
- Mostra estado de execução, operações pendentes e erros permanentes.
- Chama o mesmo ciclo de push do outbox e pull de eventos usado pelo Realtime.

## Proteções: feature flags fechadas

O envio incremental pelas ações exige simultaneamente:

- `VITE_MOBFLOW_INCREMENTAL_SYNC=true`
- `VITE_MOBFLOW_INCREMENTAL_BOOTSTRAP_READY=true`

Nenhuma dessas flags foi configurada por esta etapa. O padrão permanece desligado. Isso é intencional: ainda há gaps de bootstrap e recuperação que precisam ser fechados antes de permitir que um comando deixe de gravar o snapshot legado.

## Bloqueios antes de habilitar o outbox no Preview

1. **Schema de eventos:** confirmar e aplicar a migration draft 0007 na branch Neon isolada; sem ela, as categorias `sales` e `cash` podem ser rejeitadas pela constraint existente.
2. **Bootstrap relacional:** os comandos sales/cash/stock gravam tabelas normalizadas e eventos, mas o GET inicial ainda lê o snapshot `app_state`. Um dispositivo novo poderia receber snapshot antigo e adotar um cursor que já inclui comandos incrementais; precisa de projeção relacional no bootstrap ou atualização atômica do snapshot pelo servidor.
2. **Rollback de erro de negócio:** as telas ainda fazem atualização otimista local. Se o servidor rejeitar estoque insuficiente, caixa fechado ou permissão, o comando fica visível como falho, mas a reversão da alteração otimista por ID ainda precisa ser implementada e testada.
3. **Cobertura de domínios:** Fiado/recebimentos, baixas, transferências, importação, catálogo, promoções, contatos, fornecedores, validade, conferências, documentos e configurações ainda precisam de comandos/projeções próprios.
4. **Projeções de eventos:** eventos legados ainda acionam fallback de snapshot; cada categoria precisa de payload completo, aplicação idempotente e teste antes de remover esse fallback.
5. **Testes de integração real:** validar contra Neon isolado escrita, RLS, concorrência, timeout pós-commit, retry, duas sessões e reinício do navegador. Testes unitários/mocks não substituem esses testes.
6. **Reconciliação do snapshot:** definir migração/compatibilidade para que dispositivos antigos e novos não sobrescrevam dados de um modelo com o outro durante o rollout.

## Critérios para abrir as flags

- Todos os fluxos do PDV mapeados e cobertos.
- Bootstrap devolve estado relacional consistente com cursor.
- Operação otimista tem rollback/recuperação por ID em rejeição.
- Outbox sobrevive a fechamento do app, troca de rede e sessão expirada.
- Dois dispositivos recebem alterações sem snapshot completo por operação.
- Eventos duplicados, fora de ordem e retries não duplicam venda, caixa ou estoque.
- Botão manual e Realtime usam o mesmo mecanismo e exibem erros sem ocultar operações pendentes.

## Validação e limites

- GitHub Actions run `42514160387`: testes de API, outbox, aplicação de eventos e bootstrap **aprovados**; build de produção **aprovado**.
- O passo `tsc --noEmit` continua não bloqueante e aponta 538 erros de tipagem distribuídos no legado. Os novos módulos `sync-outbox.ts` e `sync-event-apply.ts`, e as novas linhas de integração no `store.ts`, não aparecem na lista de erros dessa execução. Há erros antigos ainda em `AppHeader.tsx` e em outros módulos.
- O Vercel Preview continua sujeito ao bloqueio de `build-rate-limit`; nenhum deploy foi considerado atualizado.
- Nenhuma flag foi ativada, nenhuma migração de banco foi aplicada nesta etapa e nenhum dado de produção foi alterado.
- MobFlow Admin, main/produção e ColetaFlow permanecem intocados.
