# MobFlow PDV — mapa dos fluxos de movimentação de estoque

Data: 06/11/2026  
Escopo: leitura do código na branch `migration/neon-preparation`; complementa a reconciliação das RPCs de produção. Nenhum código ou banco foi alterado.

## Como o ledger atual funciona no app

- `StockMovement` é um tipo armazenado dentro do snapshot `app_state.state.stockMovements`; não é uma tabela SQL dedicada no schema público atual.
- O frontend cria os movimentos no `src/lib/store.ts` por meio de `movementEntry`, e grava o array junto com o restante do snapshot JSONB.
- A tela `src/routes/movimentacoes-estoque.tsx` apenas lê `useStore(s => s.stockMovements)`, filtra e apresenta os registros.
- O merge de sincronização combina movimentos por ID e calcula deltas novos em relação à base para evitar reaplicar o mesmo movimento ao saldo do produto.

## Fluxos que geram movimento no frontend

| Operação | Onde é gerado | Evidência no store |
|---|---|---|
| Venda | Finalização da venda | Cria um movimento por produto, tipo `Venda`, delta negativo. |
| Cadastro com estoque inicial | Criação de produto | Cria tipo `Cadastro`, delta positivo. |
| Importação de produtos | Importação/atualização | Cria tipo `Importação`, delta conforme estoque incluído ou diferença importada. |
| Edição/ajuste de estoque | Ajuste manual | Cria `Ajuste de estoque` (ou `Balanço` conforme motivo), delta da diferença. |
| Baixa | Aplicação de baixa | Cria tipo `Baixa`, delta negativo. |
| Transferência | Aplicação de transferência | Cria tipo `Transferência`, delta negativo no estoque de origem. |
| Conferência | Finalização com ajuste | Cria tipo `Balanço` para cada produto cuja contagem difere do saldo anterior. |

Os registros são adicionados ao array do estado local, e a fila normal de persistência do snapshot os envia junto com o estado operacional.

## Recebimento é um caminho diferente e sensível

- O frontend chama RPCs transacionais do banco: `finalize_receiving_decisions` e `accept_receiving`.
- As RPCs atualmente instaladas em produção atualizam o saldo e o estado do recebimento sob bloqueio da linha `app_state`, mas não escrevem em `state.stockMovements`.
- O `store.ts` contém uma ponte de compatibilidade: durante a normalização/hidratação, para recebimentos com `stockReleased=true` sem movimento real associado, reconstrói um movimento marcado `legacy: true`. Calcula `stockBefore/stockAfter` a partir do saldo atual e de operações históricas.
- Movimentos `legacy` são explicitamente excluídos do cálculo de deltas novos no merge de concorrência.
- O arquivo não aplicado `supabase/sql/stock_movement_ledger.sql` tenta passar a gravação do movimento de recebimento para dentro da transação da RPC e remover a dependência desse registro sintético.

**Implicação:** não basta criar uma tabela de ledger no Neon nem aplicar o SQL versionado. É necessário decidir se a primeira migração reproduz a ponte `legacy` exatamente ou se, em uma mudança funcional separada, passa a registrar movimentos de recebimento dentro das RPCs. Misturar os dois modelos pode duplicar entradas ou alterar saldos.

## Requisitos de equivalência e testes

1. Cada venda, cadastro, importação, ajuste, baixa, transferência e balanço deve gerar os mesmos movimentos e deltas do comportamento atual.
2. Recebimentos antigos sem evento devem continuar aparecendo uma única vez na tela, com os mesmos valores reconstruídos.
3. Recebimentos novos devem ser testados antes e depois de qualquer mudança de RPC, garantindo que o movimento não seja duplicado.
4. O merge deve continuar excluindo `legacy` do delta e usando IDs estáveis para reconhecer o mesmo movimento em dispositivos diferentes.
5. Testar duas sessões simultâneas da mesma empresa e verificar saldo, histórico e ordem dos eventos.
6. Não alterar o formato JSON atual durante a primeira migração sem teste de compatibilidade e plano de reversão.

## Evidência consultada

- `src/lib/store.ts`: tipo `StockMovement`, helper `movementEntry`, merge por ID, normalização/reconstrução de movimentos legados e funções de venda/cadastro/importação/ajuste/baixa/transferência/conferência.
- `src/routes/movimentacoes-estoque.tsx`: leitura e apresentação do array.
- `supabase/sql/stock_movement_ledger.sql`: proposta versionada, ainda ausente do histórico remoto consultado.
- Catálogo Supabase de produção: RPCs instaladas sem escrita em `stockMovements`.

## Segurança e escopo

Somente leitura. Nenhuma alteração em código, dados, schema, RPC, Auth, Realtime ou configuração. MobFlow Admin e ColetaFlow permanecem fora do escopo.
