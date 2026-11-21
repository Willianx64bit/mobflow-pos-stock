# MobFlow PDV — auditoria das operações locais de venda, caixa e estoque

**Branch:** `migration/neon-preparation`  
**Arquivos principais:** `src/lib/store.ts`, `src/routes/api/mobflow/state.ts`, `src/routes/api/mobflow/receiving.ts`  
**Escopo:** leitura e documentação; nenhuma regra de negócio foi modificada.

## 1. Como as operações chegam ao servidor hoje

As ações do store alteram o estado local e chamam `set(...)`. O mecanismo de persistência serializa o estado completo e envia `PUT /api/mobflow/state`. No modo Better Auth, a chamada passa pela API Neon; no modo legado, a chamada utiliza a sessão Supabase.

O mecanismo atual:
- salva o snapshot completo em localStorage;
- mantém uma fila serial em memória para PUTs;
- tenta resolver conflito usando `expectedUpdatedAt` e mesclagem de snapshots;
- repete tentativas, mas a fila não é uma fila durável de comandos individuais;
- faz GET completo do snapshot a cada 3 segundos.

Portanto, não é seguro trocar essa persistência por eventos sem criar primeiro comandos transacionais e uma fila persistente por operação.

## 2. Venda / checkout — prioridade máxima

Em `actions.checkout`:
- exige operador e caixa aberto localmente;
- cria ID da venda via `uid()`;
- calcula itens, preço efetivo, desconto, total e lucro no cliente;
- reduz estoque no estado local;
- cria movimentos de estoque vinculados ao ID da venda;
- limpa o carrinho e inclui a venda no array local;
- chama o mecanismo geral de snapshot.

Não existe, no fluxo auditado, comando de venda Neon dedicado. O servidor recebe um snapshot e deriva alguns eventos de diferenças de estoque, mas não grava uma entidade de venda transacional independente.

**Risco:** dois dispositivos podem concluir vendas com base no mesmo estoque local antigo. O conflito de snapshot/mesclagem não equivale a uma reserva/baixa transacional de estoque no banco. A migração precisa validar estoque e registrar venda + itens + pagamentos + movimentos + evento dentro de uma única transação Neon, com chave idempotente persistida antes do envio.

A venda deve manter o ID local original ao reenviar após timeout; nunca criar uma segunda venda por retry.

## 3. Caixa

As ações locais:
- `openCashSession`: cria sessão com ID via `uid()`;
- `addCashMovement`: cria sangria/reforço local;
- `closeCashSession`: calcula o esperado usando vendas e movimentos que o dispositivo conhece e marca a sessão como fechada.

Não há comando dedicado de caixa no caminho auditado. Em dispositivos simultâneos, o cálculo local pode não incluir vendas ou movimentos feitos em outro aparelho.

**Contrato futuro:** abertura, sangria, reforço e fechamento precisam validar no servidor a sessão ativa e calcular o fechamento a partir dos registros canônicos do banco. O servidor deve impedir duas sessões incompatíveis e impedir fechamento repetido ou movimento duplicado. O fechamento não deve confiar em totais calculados exclusivamente no cliente.

## 4. Pagamento de fiado

`addFiadoPayment` adiciona pagamento ao array `sale.payments` local, calcula saldo e atualiza `paid`/lucro; `markFiadoPaid` também altera a venda local.

Sem operação atômica no servidor, dois dispositivos podem registrar pagamentos concorrentes sobre o mesmo saldo e sobrescrever/duplicar valores.

**Contrato futuro:** pagamento com ID de operação idempotente, valor validado no servidor, saldo recalculado sob bloqueio transacional e evento completo de pagamento.

## 5. Estoque e cadastro

O store cobre:
- cadastro/edição/importação de produtos;
- ajuste direto de estoque e preço;
- ajustes e balanços;
- baixas/perdas/consumo/doações;
- transferências;
- finalização de conferência;
- recebimento (este último já tem rota Better Auth própria).

Essas ações, em geral, atualizam produtos e histórico localmente e depois salvam o snapshot completo. Os IDs de várias operações usam `uid()`, que hoje é um identificador curto baseado em `Math.random()`, não uma chave criptográfica/UUID. O ID já salvo no estado pode identificar o registro local, mas o desenho da fila deve adotar um identificador robusto e estável criado uma única vez por comando.

**Risco de concorrência:** alterações de estoque calculadas a partir de `previousStock` local podem se sobrepor. O servidor precisa receber uma intenção clara (por exemplo, adicionar quantidade, baixa com motivo, definir saldo com versão esperada) e executar validação + alteração + movimento + evento na mesma transação.

Importações em lote exigem um ID de lote estável e uma chave idempotente por linha/operação para que uma reconexão não aplique o lote duas vezes.

## 6. Outras operações de negócio

Contatos, fornecedores, promoções, conferências, vencimentos manuais e anexos/documentos também são gravados pelo snapshot geral. A projeção atual de eventos não transporta todos os campos necessários para reconstrução e alguns eventos não contêm valores completos.

Cada domínio precisa de um contrato explícito de criação/edição/exclusão, incluindo tombstone para exclusão e payload completo ou referência canônica consultável.

## 7. Ordem recomendada de migração

1. **Venda e estoque:** modelo canônico de vendas/itens/pagamentos/movimentos e transação idempotente.
2. **Caixa e fiado:** operações de caixa e pagamentos sob transação no servidor.
3. **Ajustes de estoque e importação:** comandos de intenção, controle de versão e idempotência por lote/linha.
4. **Catálogo e dados auxiliares:** CRUD com tombstones e payload versionado.
5. **Fila offline persistente:** armazenamento local por comando, status pendente/em envio/confirmado/erro recuperável; apagar somente após confirmação do servidor.
6. **Consumidor de eventos:** aplicar por sequência, com cursor por empresa e avanço após página integralmente aplicada.
7. **Preview com dois ou mais dispositivos:** venda simultânea, estoque concorrente, offline, retry após timeout, pagamento parcial de fiado, caixa e recuperação.
8. Somente após aprovação desses testes: reduzir o snapshot para bootstrap/recuperação e remover o polling completo de 3 segundos.

## 8. Proteções que não devem ser perdidas

- O recebimento já usa chave de idempotência determinística derivada de empresa + recebimento + tipo de evento; preservar essa proteção.
- Não alterar regras visíveis do PDV durante a etapa de infraestrutura.
- Não remover o fallback Supabase até Better Auth/Neon Preview passar pelos testes ponta a ponta.
- Não aplicar a migration `0005` nem mexer no Neon/Supabase de produção nesta etapa.
