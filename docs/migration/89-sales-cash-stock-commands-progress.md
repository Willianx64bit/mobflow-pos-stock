# Doc89 — Progresso dos comandos Neon de venda, caixa e estoque

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Neon de ensaio: `mobflow-0006-rehearsal-isolated` / `mobflow_pdv_test`

## Situação inicial e progresso

| Etapa | Escopo | Estado |
|---|---|---|
| 1 | Venda completa | Rota inicial criada; integração com checkout e validação automatizada ainda pendentes |
| 2 | Abertura e movimentação de caixa | Rota criada; testes adicionados; não executados em CI até este registro |
| 3 | Fechamento e conferência de caixa | Implementado dentro da rota de caixa, com cálculo server-side; precisa validar regras completas de recebimentos e diferenças |
| 4 | Ajustes, baixas, entradas e transferências | Rota genérica criada; testes básicos adicionados; integração de cada tela/fluxo ainda pendente |
| 5 | Dois dispositivos, retry após falha, timeout pós-commit e idempotência ponta a ponta | Pendente |

## Código adicionado

### Venda — `POST /api/mobflow/sales`

- Venda, itens, pagamento, baixa de estoque, ledger e eventos na mesma transação.
- Locks em caixa e produtos, ordenados por ID para reduzir deadlocks.
- Uma forma de pagamento por venda.
- Fiado permanece unpaid; liquidação posterior exige comando próprio.
- Replay valida IDs, caixa, método, itens, desconto e valor recebido.
- Não conectar ao checkout atual até o cliente persistir a chave de idempotência no outbox e recuperar a resposta original após reconexão.

### Caixa — `POST /api/mobflow/cash`

Ações:
- `open`: abre caixa por operador; bloqueio de segundo caixa aberto pela constraint parcial do banco.
- `movement`: adição/reforço ou retirada/sangria; exige motivo, valor positivo e caixa aberto do próprio operador; chave idempotente.
- `close`: bloqueia a sessão, soma abertura + vendas pagas em dinheiro + adições − retiradas, grava valor contado, esperado e diferença; chave de fechamento salva para replay.

Observações:
- O cálculo inclui vendas `payment_method='cash'` e `payment_status='paid'` registradas naquela sessão.
- Recebimentos de Fiado ainda não têm vínculo com uma sessão de caixa no schema atual; precisam de decisão de negócio e modelagem antes de incluí-los no fechamento.
- Fechamento é irreversível nesta rota; reabertura não foi criada.
- A regra atual permite um caixa aberto por operador, não um único caixa aberto por empresa.

### Estoque — `POST /api/mobflow/stock`

Tipos:
- `adjustment`: soma ou define saldo.
- `writeoff`: baixa por perda/consumo/doação.
- `entry`: entrada de saldo.
- `transfer`: saída para destino externo/transferência registrada.

Cada operação:
- deriva tenant e operador da sessão;
- bloqueia produtos em ordem de ID;
- valida unidade e saldo não negativo;
- atualiza saldo, grava snapshot permanente no ledger e emite eventos na mesma transação;
- usa chave estável por operação/produto e valida o conteúdo no replay.

Limites:
- A transferência atual é registrada como saída do estoque local; não cria entrada em outro tenant/filial porque não existe domínio de transferências entre empresas no schema 0006.
- O campo `total_value` usa custo atual do produto para avaliar valor movimentado; regras específicas de custo médio/compra/venda do fluxo antigo ainda precisam ser mapeadas.
- Não conectar telas existentes até adaptar payloads e comparar todas as regras antigas de ajuste, perda, recebimento e transferência.

## Testes adicionados

- `src/test/mobflow-cash-command.test.ts`
- `src/test/mobflow-stock-command.test.ts`
- `src/test/mobflow-sales-command.test.ts`

O workflow `.github/workflows/migration-preview-validation.yml` agora lista os três testes, catálogo e sync. Consulta de execuções não retornou workflow run para os commits consultados; portanto **nenhum teste é declarado aprovado**.

## Bloqueios para concluir

1. Rodar Vitest, TypeScript e build; corrigir erros reais.
2. Testar contra Neon isolado, não apenas mocks.
3. Validar constraints e schema com as rotas sob o papel `mobflow_api`.
4. Corrigir/adicionar vínculo de recebimentos Fiado ao caixa se a regra atual exigir contabilização no fechamento.
5. Integrar o checkout e telas de caixa/estoque com outbox local durável; preservar ações atuais até comparação de comportamento.
6. Teste de duas sessões concorrentes no mesmo produto e no mesmo caixa.
7. Teste de timeout após commit e retry com mesma chave, comprovando uma única venda/movimentação.
8. Testes de isolamento tenant e permissões para cada tipo de operação.
9. Só então habilitar em Preview, com flag explícita e rollback; não ativar em produção.

## Segurança e escopo

Nenhuma migração adicional foi aplicada ao banco. Nenhum dado real foi importado. Nenhuma configuração Vercel/produção foi alterada. MobFlow Admin e ColetaFlow permaneceram intocados.
