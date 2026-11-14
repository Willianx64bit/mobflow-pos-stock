# Doc 75 — Auditoria de recebimentos, conferências e operações de estoque

**Branch:** `migration/neon-preparation`  
**Escopo:** auditoria somente de leitura do código atual. Nenhuma alteração foi aplicada ao banco, nenhuma migração foi executada e nenhuma regra de negócio foi modificada.

## 1. Estruturas operacionais observadas

O estado tipado em `src/lib/store.ts` mantém:
- `receiving: ReceivingNote[]`
- `conferences: Conference[]`
- `stockAdjustments: StockAdjustment[]`
- `stockWriteoffs: StockWriteoff[]`
- `stockTransfers: StockTransfer[]`
- `manualExpiries: ManualExpiry[]`
- `products: Product[]`
- `stockMovements: StockMovement[]`

Os objetos incluem snapshots de nome/código/unidade e, conforme a operação, estoque anterior/novo, operador, motivo, custo e destino. Isso é relevante para histórico: não se deve reconstruir documentos antigos somente consultando o cadastro atual do produto.

## 2. Recebimento de mercadorias — caminho parcialmente transacional

O cliente cria e edita notas no estado local:
- `createReceiving` cria nota pendente e atualiza a lista auxiliar de fornecedores.
- `addReceivingItems` acrescenta itens enquanto a nota está pendente.
- `startReceivingConference` cria ou reutiliza uma conferência aberta associada à nota.
- `saveReceivingConferenceDraft` grava rascunho de quantidades, validades e extras.
- `saveReceivingConference` finaliza a conferência, registra quantidades recebidas/extras e muda a nota para `analisando`; ainda não libera estoque.
- `setReceivingDecision` registra aceitar/devolver por produto.
- `completeReceivingDecision` exige decisão para todas as chaves, aguarda a fila de persistência e chama o caminho autoritativo.
- `acceptReceiving` aceita somente nota elegível com decisões concluídas e estoque ainda não liberado.
- `rejectReceiving`, `finishReceivingAction` e `deleteReceiving` ainda são alterações locais do estado.

### Rota Better Auth

`src/routes/api/mobflow/receiving.ts`:
- Só habilita o fluxo quando `MOBFLOW_AUTH_PROVIDER=better-auth`; no outro modo retorna 503.
- Abre transação autenticada e bloqueia a linha `app_state` da conta com `FOR UPDATE`.
- Lê a nota do JSON `state.receiving`, valida status, decisões e existência dos produtos.
- Soma apenas quantidades aceitas; quantidades devolvidas não entram no estoque.
- Marca a nota como aceita/liberada e atualiza os produtos no mesmo JSON.
- Registra evento manual de recebimento e eventos automáticos de delta de estoque na mesma transação.
- Usa chaves determinísticas derivadas de conta + nota + tipo de evento para idempotência.
- `stockReleased` evita uma segunda liberação.
- Limita o payload do evento a 15 KB.
- Confirma a transação somente depois de persistir eventos e novo estado.

**Limitação arquitetural:** apesar da transação e dos eventos, a operação ainda altera `products` e `receiving` dentro de `app_state`. Não é ainda uma implementação relacional com tabelas próprias de recebimentos, itens e ledger de estoque. Também não foi identificado aqui um comando Neon dedicado para criar/editar nota, salvar rascunho, rejeitar ou excluir.

**Ponto de atenção:** a elegibilidade da ação `finalize_decisions` aceita nota em `analisando` sem exigir `decisionCompleted` anterior, pois as decisões são enviadas no próprio comando. A rota valida todas as chaves antes de liberar. Não alterar essa regra sem testes de regressão do fluxo atual.

## 3. Conferência de recebimento

A conferência é um documento separado, ligado por `receivingId`. Guarda:
- status aberta/finalizada;
- contagens por produto;
- quantidades extras;
- validades dos itens e extras;
- nome, data e identificador da conferência.

O fluxo atual mantém rascunho e resultado no estado local. A conclusão muda a nota para análise, mas não deve por si só liberar estoque. A liberação ocorre no comando transacional de recebimento depois das decisões.

**Requisito de migração:** preservar a relação conferência → nota, os rascunhos, itens extras e validades. A conclusão da conferência e a aceitação/liberação são fases distintas e não podem ser fundidas.

## 4. Ajustes de estoque

`applyStockAdjustmentBatch`:
- valida motivo e lista de itens;
- aceita quantidade inteira para unidade e até três casas para kg;
- suporta modo `somar` e `definir`;
- captura estoque anterior e novo em cada item;
- cria um documento de ajuste com operador/data/motivo;
- atualiza produtos e cria uma movimentação por item.

Atualmente tudo é feito no cliente e persistido pelo snapshot geral. O ID vem de `uid()`, baseado em `Math.random()`; não é uma chave de idempotência segura para comandos offline/retry.

**Requisito Neon:** comando transacional com lock dos produtos envolvidos, validação de unidade/quantidade, documento + itens + ledger + eventos no mesmo commit. Para modo definir, o comando deve validar o saldo corrente no servidor, não confiar em `previousStock` vindo do navegador.

## 5. Baixas de estoque

`applyStockWriteoff`:
- motivos: Perda, Consumo e Doação;
- Doação exige destino;
- modos de custo: compra, venda ou média;
- valida quantidade positiva e inteira para unidade / três casas para kg;
- registra snapshots de custo unitário, custo total, estoque anterior/novo, operador e número sequencial;
- reduz o estoque e cria movimentações por item.

É operação local + snapshot, sem comando Neon dedicado observado nesta auditoria. A sequência do documento é calculada a partir da quantidade de documentos locais, portanto não é segura para geração concorrente em múltiplos dispositivos.

**Requisito Neon:** sequência/documento gerado no servidor; lock de estoque; validação de saldo e política de estoque negativo; custo calculado conforme regra aprovada; documento, itens, ledger e eventos na mesma transação. A regra atual permite que o cálculo de novo estoque fique negativo; não introduzir bloqueio sem decisão explícita de negócio.

## 6. Transferências

`applyStockTransfer` cria documento de transferência para destino identificado e itens com snapshots de custo/quantidade/saldo. A estrutura também inclui documento/identificação do destino e operador. A movimentação reduz o estoque local.

A operação observada permanece no estado local e snapshot; não foi identificada rota transacional Neon específica nesta revisão. A numeração baseada em documentos existentes no estado local também precisa ser substituída por geração concorrente segura no servidor.

**Questões de domínio ainda não resolvidas:** se transferência significa somente saída do estoque desta empresa ou se existe recebimento correspondente em outra empresa/filial; se haverá confirmação do destino; e se cancelamento gera movimento compensatório ou edição do documento. Não presumir transferência entre contas sem definição.

## 7. Histórico de movimentações

A normalização atual cria linhas históricas `legacy:*` para vendas, ajustes, baixas, transferências e recebimentos antigos sem movimentação própria. Essas linhas são marcadas `legacy: true` e não devem ser republicadas como novas operações.

O histórico relacional futuro precisa:
- preservar IDs e snapshots já existentes;
- deduplicar por operação de origem + item;
- distinguir registros originais de reconstruções históricas;
- manter documentos e ledger como registros permanentes;
- não recriar movimentos em cada sincronização;
- não usar eventos de sincronização como substitutos do livro de movimentações.

## 8. Matriz do estado atual

| Domínio | Operação no cliente | Caminho Neon dedicado observado | Situação |
|---|---|---|---|
| Criar/editar nota de recebimento | Sim | Não identificado | Snapshot |
| Rascunho de conferência | Sim | Não identificado | Snapshot |
| Finalizar conferência | Sim | Não identificado | Snapshot |
| Decisões e liberação do recebimento | Cliente chama API/RPC | Sim, Better Auth | Transacional, ainda sobre app_state |
| Ajuste em lote | Sim | Não identificado | Snapshot |
| Baixa | Sim | Não identificado | Snapshot |
| Transferência | Sim | Não identificado | Snapshot |
| Histórico de estoque | Estado local/JSON | Fundação de ledger ainda em preparação | Não relacional |

## 9. Próximos requisitos antes de implementar

1. Projetar comandos transacionais individuais para ajuste, baixa e transferência.
2. Definir política de estoque negativo e concorrência com vendas.
3. Definir semântica de transferência e cancelamento.
4. Definir se notas/conferências podem ser editadas ou excluídas depois de concluídas.
5. Migrar recebimentos/conferências com vínculo e estados preservados.
6. Garantir idempotência persistida no dispositivo antes de qualquer retry.
7. Criar testes de dois dispositivos, retry, timeout, concorrência, offline/reconexão e isolamento por empresa.
8. Manter o fluxo legado Supabase disponível até a validação ponta a ponta do caminho Neon Preview.

## 10. Segurança da auditoria

Este documento registra apenas o que foi observado no código consultado. Não comprova que migrations draft foram aplicadas, não autoriza alteração de produção e não altera o MobFlow Admin, ColetaFlow ou qualquer banco.
