# Roteiro de validação da sincronização incremental — Preview

**Escopo:** MobFlow PDV, branch `migration/neon-preparation`. Este roteiro não autoriza uso em produção e não deve ser executado antes de a Preview refletir o commit mais recente.

## Pré-condições

- [ ] Vercel Preview atualizada a partir de `migration/neon-preparation` (confirmar o commit exibido no deployment).
- [ ] URL de Preview e ambiente Neon de teste identificados; nunca apontar para o banco Supabase original nem para dados de produção.
- [ ] Usuário Better Auth de teste com permissão para vender e movimentar estoque.
- [ ] Duas sessões/dispositivos isolados: dispositivo A (origem) e dispositivo B (receptor), ambos autenticados na mesma empresa/tenant.
- [ ] Flags incrementais mantidas desligadas até a etapa de habilitação controlada e aprovação dos testes anteriores. Não habilitar flags como parte deste roteiro sem autorização explícita.
- [ ] Produto exclusivo de teste, ativo, unidade `un`, saldo conhecido (ex.: 20), preço/custo conhecidos; caixa de teste aberto pelo usuário A.
- [ ] Registrar IDs iniciais do produto, caixa, tenant e saldo. Não usar produto real de venda.

## A. Testes automatizados locais/CI

Na raiz do PDV:

```bash
npm ci
npm test -- --reporter=verbose
```

Critérios:
- Contrato atual de venda (`sales/sale`, `payload.sale`) é aplicado e replay não duplica a venda.
- Contrato atual de estoque de venda (`stock/product`) atualiza saldo e ledger; replay não duplica movimento.
- Operação manual aplica evento por produto e evento complementar `stock/stock_operation`.
- Eventos sucessivos em ordem crescente deixam o saldo mais recente.
- Eventos legados/incompletos conhecidos são rejeitados para acionar fallback seguro, sem fabricar campos.
- Pull rejeita sequências duplicadas/fora de ordem e só avança cursor depois que a aplicação da página termina com sucesso.

## B. Venda controlada via API

1. No dispositivo A, autenticar e abrir o caixa de teste.
2. Capturar o saldo inicial do produto de teste.
3. Enviar uma venda pequena (ex.: 2 unidades), com `idempotencyKey` UUID novo, pagamento à vista e valor recebido suficiente. Guardar o corpo/resposta sem dados pessoais.
4. Confirmar HTTP 201 e `replayed:false`.
5. Consultar Neon de teste e verificar, no mesmo tenant:
   - uma linha em `sales` e uma em `sale_items`;
   - uma linha correspondente em `sale_payments`;
   - uma linha em `stock_movements`, `operation_type='sale'`;
   - evento `sales/sale` com `payload.sale.id` e evento `stock/product` com `source='sale'`, `operationId`, `stockBefore`, `stockAfter`, `quantity`;
   - saldo do produto reduzido exatamente pela quantidade vendida.
6. Repetir a mesma requisição, com a mesma chave e mesmo corpo. Esperado: resposta de replay, sem nova venda, pagamento, movimento ou evento.
7. Reutilizar a chave com conteúdo diferente somente em cenário isolado de teste negativo. Esperado: conflito de idempotência, sem mutação.

## C. Movimentação manual controlada via API

1. Usar o mesmo produto de teste após registrar o saldo resultante da venda.
2. Enviar `POST /api/mobflow/stock` para `entry` de 3 unidades (ou ajuste equivalente aprovado), com `operationId` e `idempotencyKey` UUIDs novos e motivo explícito.
3. Esperado: HTTP 201, `replayed:false`, saldo aumentado em 3.
4. Conferir uma linha em `stock_movements` e dois eventos relacionados: `stock/product` (saldo autoritativo) e `stock/stock_operation` (evento complementar).
5. Repetir a mesma requisição. Esperado: `replayed:true`, sem duplicar movimento/eventos nem alterar saldo.
6. Reutilizar identificador com corpo diferente apenas no teste negativo isolado. Esperado: HTTP 409 `idempotency_conflict`.

## D. Leitura da API e aplicação no segundo dispositivo

1. No dispositivo B, iniciar com a sessão da mesma empresa e registrar o saldo anterior.
2. Chamar `GET /api/mobflow/sync/events?cursor=<cursor-anterior>&limit=100` autenticado.
3. Confirmar HTTP 200, tenant derivado da sessão (não de parâmetro do cliente), sequências estritamente crescentes e `nextCursor` igual à última sequência da página.
4. Confirmar que a página contém os eventos da venda e da movimentação, respeitando a ordem de gravação.
5. Aplicar os eventos no dispositivo B. Conferir venda visível uma única vez, saldo final igual ao Neon e movimento de estoque presente uma única vez.
6. Repetir o pull com o cursor já avançado. Esperado: nenhum evento repetido e nenhum efeito duplicado.
7. Testar duas operações em sequência (venda seguida de entrada/baixa) e confirmar que o segundo dispositivo termina com o saldo final da última sequência.

## E. Falhas e critérios de interrupção

- Se Preview não estiver atualizada, parar; não tentar contornar usando produção.
- Se autenticação, permissão, schema ou endpoint retornar erro, guardar status/código e interromper antes de repetir operações.
- Se saldo, contagens, eventos ou cursor divergirem, não habilitar flags.
- Se surgir evento legado não suportado, confirmar fallback por snapshot; não converter payload incompleto inventando campos.
- Não limpar tabelas nem excluir registros do banco como parte do teste. Preferir tenant/produto de teste descartável e registrar IDs para limpeza revisada separadamente.
- Ao concluir, anexar evidências: commit/deployment da Preview, requests/responses sanitizados, queries de conferência, sequência/cursor e capturas dos dois dispositivos.

## Resultado desta preparação

Este documento é um roteiro; não significa que os testes de API ou entre dispositivos já foram executados. A execução real depende da Preview atualizada e de sessão autenticada no ambiente Neon de teste.
