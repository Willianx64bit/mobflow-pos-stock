# Doc87 — Constraints e ensaio transacional de vendas, caixa e estoque

Data: 2026-11-08  
Ambiente: Neon `mobflow-pdv-realtime-test`  
Branch: `mobflow-0006-rehearsal-isolated` (`br-square-waterfall-bdi7kysd`)  
Database: `mobflow_pdv_test`  
Base: migration 0006 aplicada e validada no Doc86.

## Limite importante

Esta rodada validou constraints e comportamento transacional do PostgreSQL com SQL sintético. **Não validou comandos transacionais da aplicação**, porque não foram encontrados endpoints Neon de venda, caixa ou movimentação de estoque na branch `migration/neon-preparation`. O catálogo possui uma rota Neon; vendas/caixa/estoque ainda não têm os comandos equivalentes. Portanto não há teste de API, autenticação/autorização HTTP, idempotência ponta a ponta nem concorrência de clientes nesta rodada.

## Fixtures

Foi criado um tenant sintético C, um operador, um produto com estoque inicial 20, um caixa aberto, uma venda, um item, um pagamento e um movimento de estoque. IDs e valores são exclusivamente sintéticos. Estes registros permanecem na branch isolada para inspeção e não devem ser confundidos com dados reais.

## Constraints negativas executadas

| Cenário | Resultado observado |
|---|---|
| Segundo caixa aberto para o mesmo operador/tenant | Bloqueado por `cash_sessions_one_open_per_operator_uidx` (`23505`) |
| Movimento de caixa com valor negativo | Bloqueado por CHECK (`23514`) |
| Venda apontando para caixa inexistente/outro tenant | Bloqueada por FK composta (`23503`) |
| Reutilização da idempotency key de venda | Bloqueada por UNIQUE (`23505`) |
| Item repetido na mesma linha lógica da venda | Bloqueado por UNIQUE (`23505`) |
| Quantidade negativa em movimento de estoque | Bloqueada por CHECK (`23514`) |

## Atomicidade

1. **Venda + item:** uma venda sintética foi inserida dentro de um bloco; a inserção do item falhou por quantidade negativa. O sub-bloco foi revertido e uma asserção confirmou que a venda-pai não permaneceu.
2. **Estoque + ledger:** foi simulada a atualização do saldo e inserção do movimento, seguida por falha deliberada. O sub-bloco foi revertido e asserções confirmaram saldo original 20 e zero movimento correspondente.

Esses testes comprovam rollback atômico do PostgreSQL para statements agrupados na mesma transação/subtransação. Não provam que os futuros endpoints da aplicação agrupem corretamente as gravações.

## Lacunas e riscos identificados

- `products.stock` não tem CHECK para impedir saldo negativo. A regra precisa ser imposta por comando transacional com lock/UPDATE condicional e política de negócio explícita.
- A tabela `stock_movements` registra o ledger, mas não atualiza o saldo sozinha; o comando deve alterar saldo e inserir ledger na mesma transação.
- Não há constraint que garanta que totais dos itens, descontos, total da venda e pagamentos somem corretamente.
- `sale_payments` aceita várias linhas; a regra comercial atual de uma forma de pagamento por venda deve ser validada no comando (ou refletida em constraint depois de confirmar todas as exceções legítimas).
- A tabela permite status `paid/partial/unpaid` sem validar coerência com valores recebidos.
- O fechamento de caixa tem CHECK de campos mínimos, mas não calcula nem valida saldo esperado, retiradas, adições, vendas e diferença.
- A unique parcial garante apenas um caixa aberto por operador; não define se a regra desejada é um caixa aberto por empresa.
- Não foram executados testes de concorrência real (duas sessões simultâneas), retries HTTP, timeout após commit, replay idempotente retornando o resultado original ou falha de rede.
- O perfil/tenant precisa ser validado pelo servidor; RLS é defesa adicional, não substitui autorização por papel/permissão.

## Veredito

**Constraints básicas: aprovadas nos cenários executados. Atomicidade SQL: aprovada nos dois cenários simulados. Comandos transacionais de aplicação: ainda não implementados/não testáveis.**

Não considerar a migração de dados reais autorizada. Próxima etapa é desenhar e implementar, em preparação/Preview isolado, os comandos server-side de venda, movimento de caixa, fechamento e ajuste/baixa de estoque. Cada comando deve receber chave de idempotência estável, derivar tenant/operador da sessão, aplicar as regras comerciais, gravar ledger/evento e saldo na mesma transação e devolver o resultado original em retry.
