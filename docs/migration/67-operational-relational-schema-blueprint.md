# 67 — Blueprint do banco operacional relacional do MobFlow

Status: desenho arquitetural baseado no código atual; **não implementado**.  
Branch: `migration/neon-preparation`. Nenhum DDL foi aplicado.

## 1. Diagnóstico do ponto de partida

A migration Neon `0001_initial_schema.sql` cria identidade/perfis, empresas, segurança de gerência, allowlist e `app_state`. Ela não cria tabelas relacionais de produtos, vendas, caixa, pagamentos, recebimentos ou estoque.

O modelo operacional atual está em `src/lib/store.ts` como arrays dentro do estado:
- `products`, `sales`, `stockMovements`;
- `cashSessions`, `cashMovements`;
- `receiving`, `conferences`;
- `stockAdjustments`, `stockWriteoffs`, `stockTransfers`;
- `contacts`, `suppliers`, `promotions`, `manualExpiries`.

O cliente carrega e persiste o estado completo em `localStorage` e usa `PUT /api/mobflow/state` para enviar snapshots ao Neon. O endpoint protege a escrita por `expectedUpdatedAt` e emite alguns eventos comparando snapshots, mas ainda grava o JSON completo. O fluxo de checkout continua sendo calculado no cliente e não existe ainda um comando Neon transacional dedicado para finalizar venda.

Conclusão: o próximo passo não é criar tabelas isoladas sem contratos. É migrar por domínios, preservando o snapshot como bootstrap/rollback temporário.

## 2. Modelo relacional proposto

### Catálogo
`products`
- `id`, `tenant_id`, `code`, `name`, `reference`, `unit`;
- `price`, `cost`, `stock`, `min_stock`, `category`;
- `photo_object_key` (referência R2, não URL pública fixa);
- `active`, `created_at`, `updated_at`, `version`.

Restrições candidatas: unicidade por tenant + código normalizado; índices por tenant + nome/código. Código de barras múltiplo deve ir para `product_barcodes` (`tenant_id`, `product_id`, `barcode`, `is_primary`), com unicidade por tenant + barcode. Não presumir que `code` e barcode são equivalentes.

### Vendas
`sales`
- `id`, `tenant_id`, `cash_session_id`, `seller_profile_id` e snapshot do vendedor;
- `status`, `occurred_at`, `subtotal`, `discount_amount`, `discount_type`, `total`, `cost_total`, `profit_total`;
- `customer_id` opcional e snapshots de nome/documento quando necessários;
- `idempotency_key`, `created_at`.

`sale_items`
- `id`, `tenant_id`, `sale_id`, `product_id` nullable, snapshots de código/nome/unidade;
- `quantity`, `unit_price`, `unit_cost`, `line_discount`, `line_total`, `line_cost`.

`sale_payments`
- `id`, `tenant_id`, `sale_id`, `method`, `amount`, `received_amount`, `change_amount`, `created_at`.
- Para Fiado: pagamentos posteriores em tabela append-only `receivable_payments`, ligados à venda/cliente, com idempotência.

Não presumir que o campo atual `payment` permite pagamentos divididos. A UI/regra atual precisa ser mapeada antes de fechar enum e validações. Preservar dinheiro, cartão, Pix e Fiado, descontos em R$ ou %, troco, vendedor e dados de cliente existentes.

### Estoque e auditoria
`stock_movements` conforme docs 65/66, com snapshots históricos, `operation_id`, `line_key`, delta e saldos anterior/posterior. Operação de domínio e movimento devem ser atômicos.
- Não apagar movimento ao excluir produto.
- Não atualizar histórico para “corrigir” saldo; registrar movimento compensatório.
- Estoque fracionado exige `numeric` com precisão definida após conferir todas as regras de quantidade e pesagem.

### Caixa
`cash_sessions`: abertura, operador, valor inicial, estado, fechamento, valor contado, esperado, diferença, observação.
`cash_movements`: sangria/reforço, sessão, valor, motivo, operador, data.
- A sessão pertence ao tenant e deve ter regra de concorrência para impedir duas aberturas indevidas para o mesmo operador, se essa for a regra confirmada.
- Fechamento deve calcular o esperado no servidor usando vendas e movimentos confirmados, não confiar no cálculo local desatualizado.
- Vendas e pagamentos precisam referenciar a sessão quando aplicável.

### Operações complementares
- `receivings` e `receiving_items`: nota, fornecedor, quantidades esperadas/recebidas, decisões, extras, status e liberação de estoque.
- `stock_adjustments` e linhas, `stock_writeoffs` e linhas, `stock_transfers` e linhas: documentos operacionais e snapshots.
- `conferences` e linhas/contagens: sessões de conferência, códigos desconhecidos, ajustes e ligação ao recebimento.
- `contacts`, `suppliers`, `promotions`, `manual_expiries`: tabelas próprias ou fase posterior, conforme dependências da interface.

Os documentos de operação guardam contexto; o ledger guarda o efeito de estoque. Não duplicar a autoridade do saldo em tabelas de documentos.

## 3. Fluxo transacional obrigatório de venda

O comando futuro de checkout deve receber `operationId` estável, sessão de caixa, linhas do carrinho, desconto e pagamentos. No servidor:
1. Validar identidade, tenant, papel/permissões, sessão de caixa ativa e payload.
2. Verificar idempotência; mesma chave + mesmo payload retorna a venda original, mesma chave + payload diferente é conflito.
3. Bloquear linhas de produtos em ordem determinística para evitar deadlock.
4. Validar produto ativo, unidade, preço/regra de preço e política de estoque negativo.
5. Calcular valores e descontos no servidor com decimal exato.
6. Inserir venda, itens e pagamentos.
7. Atualizar saldos de estoque.
8. Inserir um movimento por linha de venda (inclusive produto repetido, com `line_key` próprio).
9. Inserir evento(s) incrementais.
10. Commit único; qualquer falha reverte venda, pagamentos, saldo, ledger e eventos.

O comando deve devolver resultado canônico para a fila offline. O frontend não deve gerar uma segunda venda ao repetir por timeout.

## 4. Fluxo de operação offline

A fila atual de persistência é uma fila serial de snapshots em memória; não é ainda um diário durável de comandos. Antes de tornar Neon autoritativo:
- persistir cada comando no armazenamento local antes de tentar rede;
- criar `operationId` criptograficamente forte uma única vez;
- guardar payload, versão de schema, estado (pending/sending/confirmed/failed), tentativas e resposta confirmada;
- retry usa a mesma chave;
- nunca apagar pendência por timeout ou erro;
- após confirmação, aplicar resposta/eventos sem repetir efeito local;
- reconciliar cursor incremental sem avançar antes de aplicar a página inteira.

Vendas offline precisam de política de conflito explícita para estoque/preço e eventual venda abaixo de zero. Não inventar regra nesta etapa.

## 5. Multiempresa, segurança e índices

Todas as tabelas operacionais devem ter `tenant_id` não nulo e políticas RLS com identidade transacional validada pelo servidor. Toda query deve filtrar tenant explicitamente além de RLS. Índices compostos começam por tenant:
- produtos: (tenant_id, code), (tenant_id, name);
- vendas: (tenant_id, occurred_at DESC), (tenant_id, cash_session_id);
- itens: (tenant_id, sale_id), (tenant_id, product_id);
- pagamentos: (tenant_id, sale_id), (tenant_id, created_at);
- caixa: (tenant_id, status), (tenant_id, opened_at DESC);
- ledger: (tenant_id, occurred_at DESC, id DESC), (tenant_id, product_id, occurred_at DESC);
- comandos: UNIQUE (tenant_id, idempotency_key).

Definir papéis e permissões com base no sistema atual; não inferir que todo usuário PDV pode executar ajustes, excluir produtos ou fechar caixa. Validar cada ação contra permissões existentes.

## 6. Mídia e Cloudflare R2

As tabelas guardam apenas object keys e metadados de mídia. Fotos de produto, comprovantes Pix, logos e documentos vão para R2 privado/público conforme finalidade. Upload deve validar MIME, tamanho e autorização, gerar chave tenant-scoped, e limpar objeto órfão se transação de metadados falhar. URLs de leitura devem ser assinadas quando privadas. Não misturar migração R2 com DDL de vendas/estoque.

## 7. Plano de implementação em fatias

Fase A — contratos e schema:
1. Mapear todas as regras de checkout, pagamentos, descontos, caixa e permissões na UI atual.
2. Confirmar tipos/IDs, decimal e regra de estoque negativo.
3. Criar migrations aditivas de catálogo, caixa, vendas, pagamentos e ledger no Neon de teste; revisar RLS/grants.
4. Testar migrations e rollback no branch Neon isolado.

Fase B — comandos de servidor:
5. Implementar produto/catálogo CRUD transacional.
6. Implementar checkout e pagamentos com idempotência.
7. Implementar caixa e movimentos.
8. Implementar demais operações de estoque, uma por uma.
9. Criar eventos no mesmo commit.

Fase C — cliente:
10. Implementar fila offline durável.
11. Implementar reducer e cursor incremental.
12. Adaptar telas para comandos e consultas paginadas, mantendo experiência visual.

Fase D — migração e retirada gradual:
13. Backfill por tenant com relatório, reconciliação e reexecução idempotente.
14. Leitura paralela em Preview e comparação com snapshot.
15. Ativar domínio migrado por flag em Preview.
16. Remover escrita/leitura do snapshot daquele domínio somente após aceite; manter snapshot para domínios ainda não migrados.

## 8. Testes e critérios de aceite

- Duas vendas simultâneas no mesmo item e em itens diferentes.
- Retry idempotente após timeout antes/depois do commit.
- Fila offline após fechar/reabrir app e após logout/login.
- Estoque fracionado kg, descontos, troco, Pix/cartão/dinheiro/Fiado.
- Pagamento posterior de Fiado concorrente.
- Abertura/fechamento de caixa e sangria/reforço em dois dispositivos.
- Permissões por papel/usuário e isolamento entre empresas.
- Eventos ordenados, paginação, cursor persistente e recuperação.
- Histórico antigo comparado com ledger após backfill.
- R2: upload interrompido, metadado falho, objeto órfão e acesso de outro tenant negado.

## 9. Decisões ainda pendentes — não assumir silenciosamente

1. Pode vender com estoque insuficiente ou negativo?
2. Preço é sempre o preço atual do cadastro ou o preço capturado no carrinho?
3. Checkout aceita múltiplas formas de pagamento na mesma venda?
4. Como desconto é aplicado: total, item ou ambos?
5. Regra de Fiado, cliente obrigatório, limite e recebimentos parciais.
6. Uma sessão de caixa por operador ou por empresa/terminal?
7. Vendas offline são permitidas sem limite ou exigem validação posterior?
8. Quais permissões exatas controlam preço, desconto, estoque, sangria, fechamento e exclusão?
9. Quais dados pessoais devem ser snapshots em vendas e por quanto tempo são retidos?

Essas decisões exigem inspeção das telas/regras existentes e, quando houver ambiguidade real, confirmação do usuário. Não são motivo para alterar comportamento por suposição.

## 10. Limites desta etapa

Este blueprint não cria tabelas, endpoints, comandos, filas ou mudanças de UI. Não aplica migrations nem acessa produção. Mantém Supabase como fonte atual até Preview Neon passar por testes. MobFlow Admin e ColetaFlow permanecem fora do escopo.
