# MobFlow PDV — auditoria do contrato da API de eventos e operações transacionais

**Branch:** `migration/neon-preparation`  
**Escopo:** auditoria somente leitura; nenhum código de produção, banco ou configuração foi alterado.

## 1. API de leitura incremental

Arquivo: `src/routes/api/mobflow/sync/events.ts`

A rota GET:
- abre transação autenticada e obtém o tenant de `identity.accountId`;
- lê o high-water mark em `mobflow_sync_counters`;
- consulta eventos do mesmo tenant com `sequence > cursor` e `sequence <= highWaterMark`;
- ordena por sequência crescente;
- usa paginação com padrão 100, máximo 250 (consulta até limite + 1);
- devolve `cursor`, `nextCursor`, `highWaterMark` e `hasMore`;
- faz rollback/liberação em erro.

A rota e os testes confirmam o contrato de paginação e isolamento pelo tenant autenticado. O cursor deve continuar sendo tratado pelo cliente como string decimal (bigint), nunca como número JavaScript, para não perder precisão em sequências grandes.

## 2. Envelope ainda incompleto para evolução

A tabela `mobflow_sync_events` guarda identificador, tenant, sequência, chave de idempotência, ator, categoria, modo de entrega, tipo/ID da entidade, payload JSON e data. Não há campo explícito de versão do schema do evento nem versão da entidade.

Consequência: antes de lançar o consumidor, definir versão do envelope/payload e regras de compatibilidade. Um cliente antigo precisa saber interpretar ou rejeitar com segurança um evento futuro; não pode avançar cursor silenciosamente quando não entende um evento.

## 3. Eventos gerados pela rota de snapshot

Arquivo: `src/routes/api/mobflow/state.ts`

A rota ainda grava o snapshot inteiro em `app_state` e, na mesma transação, compara snapshots e deriva eventos. As chaves de evento e idempotência são geradas com `randomUUID()` no momento da comparação.

Isso significa que uma repetição da mesma requisição lógica pode produzir novas chaves e novos eventos, pois não há uma chave estável da operação do dispositivo associada à alteração. A unicidade do banco protege a repetição da mesma chave, mas não deduplica duas UUIDs diferentes que representam a mesma ação.

O endpoint também produz projeções parciais:
- catálogo de produtos exclui foto, estoque e preço de venda;
- contatos são projetados somente com ID e tipo;
- caixa é projetado com metadados limitados;
- fornecedores são identificados pelo nome normalizado;
- configurações transmitem nomes de chaves alteradas, não os valores;
- mudanças de estoque/preço são derivadas de diferenças entre snapshots.

Essas projeções podem servir como notificações/índices de invalidação, mas não são suficientes para reconstruir integralmente o estado de outro dispositivo.

## 4. Operação de recebimento

Arquivo: `src/routes/api/mobflow/receiving.ts`

A rota de recebimento aplica liberação de estoque, atualiza `app_state` e acrescenta evento de recebimento + evento automático de estoque na mesma transação Neon. O campo `stockReleased` evita liberar novamente o mesmo recebimento; os testes cobrem aceite, decisão ausente, estoque inválido e repetição do aceite.

**Correção após conferência do código completo:** ao contrário do que uma leitura parcial poderia sugerir, a rota já usa chaves de idempotência determinísticas derivadas de empresa + ID do recebimento + tipo de evento (`stableIdempotencyUuid`). O `event_id` é novo em cada tentativa, mas a chave única de idempotência faz a função retornar a sequência do evento original. Portanto, a rota de recebimento tem proteção de repetição melhor do que a rota geral de snapshot.

Ponto pendente: essa chave é específica do domínio e não é um `operationId` genérico persistido na fila do dispositivo. Ao desenhar a fila offline universal, preservar essa proteção e padronizar o mesmo contrato para venda, caixa e estoque. Não substituir a chave estável de recebimento por UUID aleatório.

## 5. Vendas, caixa e demais operações

A auditoria anterior do store confirmou que checkout, abertura/fechamento de caixa, sangria/reforço, contatos, pagamentos de fiado, promoções, CRUD de produtos e ajustes passam pelo mecanismo geral de persistência de snapshot. Nesta branch não foi encontrada uma rota específica de vendas/checkout/caixa nos caminhos consultados; não se deve inferir que elas já têm comandos Neon dedicados.

O inventário de eventos da rota de snapshot não contém projeção de vendas. Caixa e contatos aparecem apenas como metadados redigidos. Portanto, o stream atual não pode substituir o snapshot nem reconstruir vendas, pagamentos e sessões de caixa.

## 6. Contrato necessário antes do consumidor

Cada comando offline precisa carregar:
1. `operationId`/idempotency key estável, criado uma vez no dispositivo e persistido até confirmação;
2. tipo e versão do comando;
3. tenant e ator resolvidos/validados no servidor, nunca confiados do payload;
4. entidade/IDs estáveis;
5. dados completos e mínimos para aplicar a alteração;
6. versão esperada quando houver concorrência;
7. resultado idempotente para retries, inclusive após timeout.

No servidor, mutação de negócio e evento devem ser gravados na mesma transação. A resposta deve confirmar o ID da operação e o sequence atribuído. O cliente só remove a operação da fila após confirmação durável.

O consumidor deve validar a versão do evento, aplicar em ordem, manter cursor por conta/empresa e avançar somente após aplicar integralmente a página. Evento desconhecido, inválido ou falha parcial deve interromper o avanço e preservar fila/dados locais.

## 7. Decisão

**Não iniciar ainda a substituição do polling nem remover o snapshot.** Próxima etapa de implementação, após fechar contratos: comandos transacionais para venda/estoque/caixa/contatos e recebimento com idempotência estável; depois consumidor incremental e fila offline persistente; só então testes em Preview com dois dispositivos e remoção gradual do polling.

Nenhuma migração SQL foi aplicada. A migration `0005_incremental_sync_foundation.sql` continua marcada como não aplicada e não deve ser executada até revisão final de permissões, ownership e compatibilidade.
