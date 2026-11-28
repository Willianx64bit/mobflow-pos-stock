# 95 — Snapshot completo manual e sincronização incremental

Data: 2026-11-09  
Branch: `migration/neon-preparation`

## Alterações aplicadas

- `set()` mantém as alterações no armazenamento local do dispositivo e não dispara mais `PUT /api/mobflow/state` a cada mutação.
- O envio de snapshot completo passou a ser solicitado somente pelo botão manual de sincronização no cabeçalho do PDV.
- O botão executa primeiro o envio da outbox; se houver operação pendente ou com falha, interrompe a reconciliação completa para não sobrescrever dados antes da confirmação dos comandos.
- Após a outbox ser drenada, o botão envia o snapshot completo e atualiza a cópia local/cursor a partir do Neon.
- O retry temporizado de 1,8 s do snapshot completo foi removido. Uma falha mantém os dados locais e exige nova ação manual.
- O consumidor incremental não baixa mais automaticamente o snapshot completo ao encontrar um evento ainda não suportado. Ele preserva o cursor e informa que é necessária reconciliação manual.
- O Neon Realtime continua sendo apenas um sinal para iniciar o envio da outbox e a busca de eventos por cursor.
- A hidratação inicial continua podendo ler o snapshot para carregar a sessão/dispositivo; isso é bootstrap de leitura, não envio automático do estado completo.

## Estado da ativação

A rota incremental continua protegida por duas flags de Preview:
- `VITE_MOBFLOW_INCREMENTAL_SYNC=true`
- `VITE_MOBFLOW_INCREMENTAL_BOOTSTRAP_READY=true`

Essas flags não foram ativadas nesta alteração. A auditoria anterior não comprovou que o backfill relacional contém os dados operacionais reais; portanto, não é seguro liberar o checkout incremental antes de validar o bootstrap e os dados de produtos/estoque.

## MobFlow Admin

O Admin não usa o mecanismo de snapshot `app_state` do PDV: suas operações administrativas consultam e atualizam diretamente as tabelas relacionais do Neon. Nenhuma mudança de sincronização foi necessária no Admin nesta etapa.

## Validação

- Build Vercel Preview do commit `9fae4f15c17f87b3721e006ccf0c4f4e7db92644`: READY.
- Nenhuma alteração em `main`, Produção ou ColetaFlow.
- Nenhuma alteração destrutiva no Neon ou nos dados de empresas.
- Ainda faltam testes autenticados de duas instalações, outbox offline/reconexão, cursor e cobertura completa de eventos antes de ativar as flags incrementais.
