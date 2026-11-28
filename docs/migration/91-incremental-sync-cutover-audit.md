# Doc91 — Auditoria do corte para sincronização incremental

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: somente MobFlow PDV. Auditoria estática do código atual; nenhuma tela ou operação foi ativada em produção.

## Decisão obrigatória

A migração não será considerada concluída enquanto o PDV continuar enviando o snapshot completo de `app_state` em cada alteração local. O objetivo final é sincronização incremental, com outbox durável, comandos idempotentes, eventos por domínio e Neon Realtime apenas como sinal de que há eventos novos.

O intervalo de polling de 3 segundos já foi removido do `store.ts` nesta branch, mas isso **não** significa que o envio de snapshots completos foi eliminado.

## Estado constatado no código

### Cliente — `src/lib/store.ts`

- `set()` persiste em `localStorage` e chama `persistState()` para cada alteração quando `cloudReady`.
- `persistState()` envia `PUT /api/mobflow/state` com `JSON.stringify({ state: snapshot, expectedUpdatedAt })`; portanto, ainda transmite o estado inteiro.
- A fila atual (`persistRequested`, `persistWorker`) serializa e agrupa chamadas em memória, mas não é um outbox durável de operações. Não há registro persistente individual de comandos pendentes, chave de idempotência por comando nem confirmação por evento.
- `refreshFromCloud()` lê `GET /api/mobflow/state` e substitui/mescla o snapshot inteiro.
- O callback do Neon Realtime chama `refreshFromCloud(accountId, true)`; logo, Realtime ainda funciona como aviso seguido de leitura do snapshot completo.
- O cursor de `mobflow_sync_events` não é armazenado nem consumido pelo cliente.

### Servidor — snapshot e eventos

- `GET/PUT /api/mobflow/state` continua sendo o caminho de hidratação e gravação do estado completo em `public.app_state`.
- O PUT gera projeções de eventos comparando snapshot anterior e novo. Isso é um produtor de eventos derivado de snapshots, não uma API de comandos incrementais usada diretamente pelas telas.
- Os eventos atuais de catálogo, promoções, conferências, operações de estoque, validade, alguns metadados, configurações, preço e saldo não cobrem integralmente todos os dados e operações do PDV.
- O próprio handler documenta que contatos, caixa e outros metadados continuam no snapshot; dados completos de vendas/clientes/pagamentos não são publicados no ledger de eventos por privacidade.
- `GET /api/mobflow/sync/events` já pagina eventos por cursor e tenant autenticado, mas ainda não há consumidor no `store.ts` que aplique esses eventos ao estado local e confirme o cursor.

### Comandos relacionais já preparados, mas ainda sem corte das telas

- `POST /api/mobflow/sales`: venda transacional, ledger e evento; integração do checkout e outbox idempotente ainda pendentes.
- `POST /api/mobflow/cash`: abertura, movimentação e fechamento; integração das telas ainda pendente.
- `POST /api/mobflow/stock`: operações de estoque; integração das telas ainda pendente.
- `POST /api/mobflow/receiving`: fluxo transacional de recebimento; caracterização e integração completas ainda pendentes.
- Esses comandos não autorizam remover o snapshot antigo enquanto todos os domínios não tiverem equivalência funcional, testes de retry e migração de dados concluídos.

### Botão de sincronização manual

- Não foi localizado um botão de sincronização no componente principal `src/components/AppHeader.tsx), nem nos textos de sincronização das telas `dashboard.tsx`, `configuracoes.tsx` e `operacoes.tsx).
- Antes de criar/substituir o controle visual, verificar se o botão citado está em outra área/versão do app ou se deve ser reintroduzido.
- O botão final deve chamar o mesmo mecanismo de outbox e pull incremental usado pelo automático; não pode disparar PUT do snapshot inteiro.

## Arquitetura final exigida

1. **Outbox local durável:** persistir cada comando pendente no armazenamento local antes de tentar a rede. Cada comando tem ID estável/idempotency key, tenant/sessão vinculados no servidor, domínio, payload validado e estado pendente/em envio/confirmado/falhou.
2. **Push incremental:** enviar lotes limitados de comandos, nunca o objeto completo `State`. Servidor valida autorização e regras do domínio, grava tabelas relacionais, ledger e evento na mesma transação.
3. **Idempotência e retry:** repetir o mesmo comando após timeout/reconexão retorna o resultado original sem duplicar venda, baixa, movimento, caixa ou recebimento.
4. **Pull incremental:** guardar cursor confirmado por empresa/dispositivo. Buscar `/api/mobflow/sync/events?cursor=...` em páginas; aplicar eventos em ordem; persistir o novo cursor somente depois de aplicar a página com sucesso. Eventos duplicados são ignorados por ID/sequence.
5. **Projeções seguras:** payloads de evento contêm apenas os campos necessários para atualizar a projeção local. Dados sensíveis de cliente, documentos e pagamentos não devem ser expostos em eventos gerais.
6. **Neon Realtime:** subscription recebe apenas sinal do tenant autenticado; ao sinal, executa pull incremental do cursor atual. Não busca `/api/mobflow/state` em cada notificação.
7. **Recuperação:** foco, retorno online, reconexão WebSocket e botão manual executam o mesmo ciclo push-outbox + pull-events. Fallback temporário deve ser acionado por falha/expiração, nunca por timer fixo de 3 segundos.
8. **Snapshot de bootstrap/backup:** manter leitura completa apenas para primeira hidratação, recuperação controlada e exportação/backup, não para cada alteração nem para cada evento.

## Domínios que precisam de contrato e testes antes de trocar o transporte

- Produtos e catálogo: criar/editar/excluir, preço, foto e códigos alternativos.
- Vendas: itens, descontos, formas de pagamento, recebimento, cancelamento/estorno e histórico.
- Estoque: ledger, ajuste, balanço, entrada, baixa, recebimento, validade e transferência.
- Caixa: abertura, sangria, reforço, fechamento, diferenças e recebimentos de fiado conforme regra aprovada.
- Clientes, fornecedores, contatos e fiado/contas a receber.
- Promoções, conferências, configurações, permissões e documentos/anexos.
- MobFlow Admin: aprovações, empresas, billing e leitura de comprovantes devem continuar consistentes com o mesmo Neon, sem compartilhar payloads indevidos entre tenants.

## Ordem segura de implementação

1. Não alterar mais o comportamento de persistência atual até existir cobertura de comandos para todos os fluxos; não desativar o snapshot antes do corte.
2. Definir schema do outbox local, estados, cursor por dispositivo e política de retenção/retry.
3. Completar e validar no Neon isolado os comandos transacionais e as projeções de eventos por domínio.
4. Integrar primeiro um domínio de cada vez às telas existentes, com flag de Preview e comparação de resultados contra o fluxo legado.
5. Implementar consumidor de eventos com aplicação idempotente e cursor persistente; Realtime apenas acorda o consumidor.
6. Implementar/atualizar o botão manual para chamar o ciclo incremental compartilhado.
7. Rodar testes offline, dois dispositivos simultâneos, tenant isolation, evento duplicado/fora de ordem, timeout pós-commit, retry, sessão expirada e reconexão.
8. Só depois de todos os domínios e telas aprovados, remover `PUT /api/mobflow/state` do caminho de gravação normal. Manter GET de snapshot como bootstrap/recuperação temporária.
9. Depois da validação do PDV, repetir a mesma auditoria de sincronização e consistência no MobFlow Admin.

## Critérios de aceite obrigatórios

- Nenhum timer de 3 segundos enviando ou baixando snapshots.
- Nenhuma mutação comum envia `JSON.stringify(state)` para `/api/mobflow/state`.
- Push contém somente comandos/eventos alterados.
- Pull contém somente eventos posteriores ao cursor.
- Outbox e cursor sobrevivem a fechar/reabrir o navegador e reiniciar o dispositivo.
- Retry nunca duplica efeito financeiro ou de estoque.
- Neon Realtime não dispara leitura de snapshot completo.
- Botão manual e sincronização automática usam exatamente o mesmo mecanismo incremental.
- Offline, reconexão, duas sessões e isolamento de empresa passam nos testes.
- Snapshot completo só é usado em bootstrap/recuperação controlada até a retirada definitiva do legado.

## Limites mantidos

- Somente branch `migration/neon-preparation`; sem merge em `main` e sem alteração de produção.
- Nenhuma mudança no ColetaFlow.
- Nenhum dado real, bucket ou configuração de produção alterado nesta auditoria.
