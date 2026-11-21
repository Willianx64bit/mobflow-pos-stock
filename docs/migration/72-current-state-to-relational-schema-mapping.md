# 72 — Mapeamento do estado atual para o schema relacional

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: comparação dos tipos reais de `src/lib/store.ts` com o DDL 0006 em rascunho. Somente leitura/documentação.

## 1. Catálogo atual → `products`

Tipo atual:
`Product = { id, code, barcodes?, ref?, name, price, cost?, stock, minStock, category, unit, photo? }`

| Campo atual | Destino proposto | Observação |
|---|---|---|
| `id` | `products.id` | Preservar string original. |
| `code` | `products.code` | Não presumir que seja código de barras. |
| `barcodes[]` | `product_barcodes` | Gerar uma linha por código; validar duplicados dentro do tenant antes do backfill. |
| `ref` | `products.reference` | Preservar string, inclusive vazio/null conforme normalização definida. |
| `name` | `products.name` | Campo obrigatório. |
| `price`, `cost` | `price`, `cost` | Converter número JS para decimal sem erro binário; validar arredondamento. |
| `stock`, `minStock` | `stock`, `min_stock` | Quantidade atual usa número JS; unidade kg aceita 3 casas na UI. |
| `category` | `category` | O tipo atual é string, não assumir nullable sem revisar dados. |
| `unit` | `unit` | Normalização atual aceita apenas `un` ou `kg`. |
| `photo` | `photo_object_key` | Não copiar URL/data URL diretamente. Requer migração de arquivo para R2 e mapeamento de object key, em trilha separada. |

## 2. Vendas atuais → `sales` + `sale_items` + `sale_payments`

Tipo atual `Sale` inclui:
- cabeçalho: `id`, `date`, `cashSessionId`, `total`, `profit`, `subtotal`, `discount`, `discountType`, `payment`, `received`, `customer`, `cpf`, `seller`, `paid`, `paidAt`, `hiddenFromFiado`;
- itens: `productId?`, `name`, `price`, `cost?`, `qty`, `unit?`;
- recebimentos de fiado: `payments?: { value, date }[]`.

Mapeamento:
- cabeçalho → `sales`, mantendo snapshots de vendedor/cliente e valores;
- cada item → `sale_items`, com `line_key` determinístico baseado na posição original (não usar product_id sozinho, pois o mesmo produto pode aparecer em duas linhas);
- forma inicial → `sale_payments`;
- pagamentos posteriores de fiado → `receivable_payments`.

Lacunas que impedem backfill direto:
1. `FiadoPayment` não armazena método de recebimento, operador, ID individual nem idempotency key. O backfill pode preservar valor/data, mas não inventar esses dados; criar IDs estáveis derivados de venda + índice + hash do registro.
2. `hiddenFromFiado` e `paidAt` não têm coluna dedicada no rascunho. Precisam ser preservados em campo de compatibilidade ou decisão explícita de descarte; não descartar silenciosamente.
3. O status `paid`/ausente precisa ser normalizado com cuidado por forma de pagamento e histórico parcial. Não inferir que uma venda sem `paid` é paga.
4. `payment` atual usa rótulos em português (`Dinheiro`, `Cartão`, `Pix`, `Fiado`); conversão para `cash/card/pix/fiado` deve ser explícita e reportar valores desconhecidos.
5. O tipo atual não registra desconto por item; o rascunho mantém `line_discount` em zero para preservar extensão futura, mas não deve fabricar desconto individual.

## 3. Caixa atual → `cash_sessions` + `cash_movements`

`CashSession` atual usa `openedAt`, `openedBy` (texto), `openingAmount`, `status`, `closedAt?`, `closedBy?`, `countedCash?`, `expectedCash?`, `difference?`, `note?`.

`CashMovement` usa `id`, `sessionId`, `type` (`sangria`/`reforco`), `amount`, `reason`, `operator` (texto), `date`.

Gaps:
- O estado atual identifica operador pelo nome de usuário, não pelo UUID do perfil. O backfill precisa resolver por tenant + username, gerar relatório para não encontrados/duplicados e nunca adivinhar.
- `closedBy` não tem coluna própria no DDL inicial; precisa ser preservado em `closed_by_snapshot` ou estrutura compatível.
- Movimentos antigos não possuem chave de idempotência. Gerar chave estável de backfill, distinta de chaves dos comandos novos.
- `CashMovement.type` deve mapear explicitamente para `withdrawal` ou `addition`.

## 4. Histórico de estoque → `stock_movements`

Tipo atual inclui ID string, `operationId`, data, tipo, produto, código/nome, unidade, quantidade, valor, saldo antes/depois, delta, operador e detalhes.

Regras:
- Preservar `id` legado como `source_legacy_id`, e escolher um novo ID de destino estável. O DDL mantém `id` string para evitar conversão destrutiva.
- `legacy: true` deve virar `source_kind = legacy_reconstructed` somente quando o registro foi criado por `normalizeState()`. Movimentos reais persistidos continuam `legacy_real` no processo de backfill, para diferenciá-los de comandos novos (`live`).
- `operationId + line_key` deve ser determinístico e tolerar mais de um item do mesmo produto.
- `date` pode vir sem timezone/offset. Backfill deve preservar string de origem em relatório e definir interpretação temporal com regra explícita; não aplicar UTC por suposição.
- `productId` permanece sem FK obrigatória para manter histórico após remoção do produto.
- Saldos reconstruídos por `normalizeState()` são estimativas e devem permanecer marcados.

## 5. Outros domínios ainda fora do DDL 0006

O estado inclui recebimentos, conferências, ajustes, baixas, transferências, contatos, fornecedores, promoções e validades. Não foram criadas tabelas para esses domínios nesta primeira fatia. Não armazenar tudo em JSON genérico como solução permanente; cada domínio deve ser mapeado após revisar suas rotas, IDs, estados, linhas e efeitos de estoque.

## 6. Ajustes necessários antes de chamar o DDL de candidato a aplicação

1. Adicionar compatibilidade para `Sale.hiddenFromFiado`, `Sale.paidAt` e `CashSession.closedBy` (ou documentar decisão de retenção equivalente).
2. Rever operador por UUID versus snapshot e garantir validação de tenant no servidor.
3. Definir mapeamento temporal legado para campos `timestamptz`.
4. Confirmar campos obrigatórios e defaults contra dados reais, incluindo `category`, códigos e valores ausentes.
5. Definir estratégia de conversão de foto para R2 fora desta migration.
6. Criar relatório de pré-backfill sem escrita e testes de conversão/round-trip.
7. Atualizar DDL somente depois de revisar a cadeia completa de migrations e os grants/RLS.

## 7. Limites

Nenhuma alteração de runtime, UI, Supabase, Neon, Vercel, Admin ou ColetaFlow. Nenhum dado foi lido de produção nem importado. Este documento usa somente os tipos e normalização presentes no repositório da branch de preparação.
