# Doc88 — Primeiro comando transacional Neon: venda completa

Data: 2026-11-08  
Branch de código: `migration/neon-preparation`  
Ambiente de validação previsto: `mobflow-0006-rehearsal-isolated`  
Status: implementação inicial adicionada; execução CI/Preview ainda pendente.

## Entrega

Foi criada a rota `POST /api/mobflow/sales` em `src/routes/api/mobflow/sales.ts`.

A rota executa na mesma transação Neon:
1. autenticação e resolução de tenant/operador pelo servidor;
2. validação de permissão PDV (ou manager);
3. replay seguro por chave de idempotência, conferindo IDs, caixa, forma de pagamento, itens, desconto e recebido;
4. lock do caixa e validação de que está aberto e pertence ao operador autenticado;
5. lock ordenado dos produtos para reduzir deadlocks entre dispositivos;
6. validação de unidade, produto ativo e estoque suficiente;
7. cálculo de subtotal, desconto, total, custo, lucro e troco no servidor;
8. gravação da venda, snapshots dos itens e uma única forma de pagamento;
9. baixa do estoque, atualização de versão e inclusão do movimento permanente no ledger;
10. emissão de eventos de venda e de delta de estoque;
11. commit único. Qualquer falha antes do commit reverte todas as gravações.

Para venda Fiado, a venda fica unpaid e o pagamento inicial é zero. A liquidação posterior será tratada em comando próprio de recebimento de Fiado; não é implementada por esta rota.

## Testes adicionados

`src/test/mobflow-sales-command.test.ts` cobre:
- venda concluída com venda/item/pagamento/estoque/ledger/eventos;
- estoque insuficiente sem gravação;
- retry com a mesma chave retornando a venda original;
- reutilização da chave com outro ID rejeitada.

O workflow `.github/workflows/migration-preview-validation.yml` foi atualizado para incluir o novo teste.

## Pendências e limites

- Nenhuma execução CI foi observada no momento do registro; testes e TypeScript ainda precisam rodar.
- A rota ainda não está conectada ao fluxo `actions.checkout` do cliente. O cliente atual continua usando snapshot `app_state`; não ativar a rota como fluxo de venda padrão antes de adaptar o cliente para gerar e persistir um ID/chave estáveis no outbox local.
- Não foi realizado teste de concorrência com duas sessões reais nem teste de falha de rede após commit.
- O caixa e o estoque permanecem com comandos próprios ainda não implementados.
- A venda usa o schema 0006 já aplicado apenas na branch isolada; não aplicar em produção.
- Não habilitar flag de leitura do catálogo nem fazer backfill/cutover com base apenas nesta entrega.

## Próxima sequência

1. Rodar CI/TypeScript/build e corrigir erros.
2. Adaptar checkout do cliente para chamar a rota com chave estável persistida localmente; só limpar carrinho após confirmação ou replay confirmado.
3. Implementar caixa: abertura, reforço, sangria e fechamento com cálculo no servidor e idempotência.
4. Implementar comandos de estoque: ajuste, baixa, entrada, transferência e recebimento, cada um com saldo + ledger + evento na mesma transação.
5. Testes de concorrência, retry, timeout após commit, dois dispositivos e isolamento por tenant.
