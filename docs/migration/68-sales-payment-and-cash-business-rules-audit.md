# 68 — Auditoria das regras de venda, pagamento e caixa

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: leitura do PDV e das rotas de caixa; nenhuma alteração no comportamento do aplicativo.

## 1. Fontes verificadas
- `src/routes/index.tsx`: tela principal do PDV e finalização.
- `src/lib/store.ts`: `checkout`, `addFiadoPayment`, abertura, movimentação e fechamento do caixa.
- `src/routes/caixa.tsx`: interface de abertura/fechamento e sangria/reforço.
- `src/routes/operacao-caixa.tsx` e `src/routes/vendas.tsx`: consultas de histórico.
- `src/routes/gerencia.tsx`: bloqueio de acesso à Gerência e validação de sessão/perfil.

## 2. Regras confirmadas no código atual

### Venda
1. A venda exige operador identificado e caixa aberto pertencente ao mesmo operador.
2. O PDV não permite finalizar venda fiado sem nome do cliente.
3. Produtos por unidade usam quantidades inteiras; produtos por kg aceitam precisão de milésimos.
4. O subtotal usa o preço efetivo do produto (inclui preço promocional vigente).
5. O desconto atual é aplicado ao total da venda, em valor fixo ou percentual; percentual limitado a 100%, valor fixo limitado ao subtotal. Total nunca fica negativo.
6. O registro guarda snapshot dos itens (nome, preço, custo, quantidade e unidade), subtotal, desconto, total, forma de pagamento, operador e sessão de caixa.
7. O checkout reduz o estoque localmente e cria um registro de movimentação por item, associado ao ID da venda.
8. A venda fiado inicia como não paga, sem pagamentos recebidos e lucro zero. O lucro é atualizado quando o fiado é quitado.
9. Para dinheiro, o valor recebido pode ser informado; se informado abaixo do total, a tela impede finalizar. Se vazio/zero, registra o total como recebido.
10. Para Pix, o PDV exige chave Pix cadastrada, gera payload e aguarda confirmação manual na interface antes de chamar checkout. O código atual não comprova liquidação bancária automática.
11. Cartão e Pix são registrados como uma única forma de pagamento por venda. O modelo atual não contém rateio de uma venda entre várias formas.
12. O checkout ainda é uma mutação local seguida da persistência do snapshot; não existe ainda comando transacional Neon de venda.

### Fiado
1. A venda exige cliente.
2. Pagamentos parciais são aceitos; cada pagamento recebe valor e data.
3. O valor de cada pagamento é limitado ao saldo restante.
4. A venda fica paga quando o acumulado alcança o total (tolerância de meio centavo).
5. Não existe, no trecho auditado, validação de limite de crédito do cliente, vencimento ou juros.
6. O pagamento parcial é hoje uma atualização local do objeto da venda; precisa virar comando idempotente transacional para evitar duplicidade em dispositivos concorrentes.

### Caixa
1. Cada operador só pode ter uma sessão aberta por vez; operadores diferentes podem ter sessões abertas simultaneamente.
2. A abertura permite valor inicial zero ou maior e observação opcional.
3. Sangria e reforço exigem sessão aberta, valor maior que zero e motivo obrigatório.
4. O fechamento é feito pelo operador que abriu a sessão.
5. Dinheiro esperado = troco inicial + vendas em dinheiro pagas - sangrias + reforços.
6. O fechamento registra dinheiro contado, esperado e diferença.
7. O cálculo atual é feito com as vendas e movimentações presentes no estado local do dispositivo. Portanto, pode estar incompleto se outro dispositivo tiver registrado operações ainda não sincronizadas.
8. O histórico de caixa e o histórico de vendas são telas de consulta; hoje consomem arrays do estado local/snapshot.

## 3. Riscos de concorrência que a migração precisa resolver
- Dois dispositivos podem finalizar vendas usando o mesmo estoque desatualizado. A validação e baixa de estoque precisam ocorrer sob transação e bloqueio/controle de versão no Neon.
- Um duplo toque, timeout ou repetição de checkout não pode criar duas vendas. Cada tentativa deve levar um `operationId` persistido antes do envio; a mesma chave deve retornar o resultado original.
- O fechamento precisa consultar vendas e movimentações canônicas da sessão no servidor, calcular esperado e gravar fechamento atomicamente.
- Pagamentos de fiado precisam bloquear/atualizar a venda em transação, limitar ao saldo real e usar idempotência por pagamento.
- A confirmação visual de Pix não deve ser interpretada pelo backend como confirmação bancária. O contrato atual registra a confirmação do operador; integração de conciliação bancária seria escopo separado.
- O identificador atual `uid()` usa `Math.random()`; não é suficiente como chave de idempotência durável. Gerar identificador forte uma única vez e persistir na fila offline.

## 4. Contratos de comando recomendados
Todos os comandos devem derivar empresa/conta da sessão autenticada, nunca aceitar tenant confiável do cliente.

| Comando | Efeito atômico esperado |
|---|---|
| `POST /api/mobflow/sales/checkout` | Validar carrinho, preço/desconto, caixa e política de estoque; criar venda/itens/pagamento; baixar estoque; inserir ledger de movimentação e eventos; tudo na mesma transação. |
| `POST /api/mobflow/fiado/:saleId/payments` | Registrar pagamento idempotente, atualizar saldo/status e lucro conforme regra atual. |
| `POST /api/mobflow/cash/sessions` | Abrir sessão; garantir no máximo uma sessão aberta por operador/escopo definido. |
| `POST /api/mobflow/cash/sessions/:id/movements` | Registrar sangria/reforço com motivo e idempotência. |
| `POST /api/mobflow/cash/sessions/:id/close` | Calcular esperado no servidor a partir do ledger; gravar contagem/diferença e fechar sob transação. |

As gravações operacionais e seus eventos de sincronização devem compartilhar a mesma transação. Respostas de replay idempotente devem devolver o resultado já criado, sem repetir efeitos.

## 5. Decisões ainda não confirmadas
A auditoria do código não prova que todas as regras atuais são escolhas finais de negócio. Antes de implementar os comandos, confirmar:
1. **Estoque insuficiente:** o sistema pode vender e deixar estoque negativo ou deve bloquear?
2. **Preço:** o preço capturado ao adicionar ao carrinho fica congelado até finalizar, ou o servidor deve validar preço vigente no instante da venda? O snapshot atual captura `effectivePrice` no checkout.
3. **Desconto:** há permissão/limite de desconto por operador? A UI atual permite desconto global no PDV, mas as regras de autorização precisam ser conferidas.
4. **Pagamento dividido:** manter exatamente uma forma por venda ou permitir dinheiro + Pix/cartão na mesma venda?
5. **Fiado:** manter pagamentos parciais sem limite/vencimento, como hoje, ou existem regras adicionais fora do trecho auditado?
6. **Sessões de caixa:** manter uma sessão por operador, ou deve existir uma sessão por terminal/caixa físico/empresa?
7. **Offline:** permitir finalizar venda totalmente offline, enfileirando e sincronizando depois, ou exigir conexão para validar estoque e caixa?
8. **Pix:** manter confirmação manual pelo operador ou planejar integração de confirmação bancária em etapa separada?
9. **Permissões:** quais ações exigem Gerência (desconto, estoque negativo, sangria, reforço, fechamento por outro operador, pagamento de fiado)?

Não foi encontrada base suficiente nesta leitura para decidir essas políticas por conta própria.

## 6. Testes de aceitação obrigatórios
- Dois dispositivos vendendo simultaneamente o último saldo disponível.
- Repetir a mesma requisição após timeout e comprovar uma única venda/baixa.
- Checkout offline, reinício do app, reconexão e replay sem duplicidade (se offline for autorizado).
- Pix com confirmação manual, cancelamento antes de confirmar e retry.
- Dinheiro com valor recebido vazio, exato, maior e menor que o total.
- Fiado com pagamento parcial, pagamento exato do saldo, pagamento acima do saldo e retry duplicado.
- Sangria/reforço simultâneos com venda em dinheiro.
- Dois dispositivos consultando/fechando a mesma sessão; impedir fechamento concorrente inconsistente.
- Fechamento calcula o total canônico mesmo que um dispositivo tenha ficado offline.
- Isolamento entre empresas em todos os comandos e consultas.

## 7. Limites desta etapa
- Apenas auditoria e documentação.
- Nenhuma alteração em `src/`, migrations SQL, dados, Supabase, Neon, Vercel ou Admin.
- O próximo passo seguro é mapear as permissões reais por ação e revisar os componentes completos de pagamento/fiado para fechar as decisões pendentes antes de escrever os endpoints transacionais.
