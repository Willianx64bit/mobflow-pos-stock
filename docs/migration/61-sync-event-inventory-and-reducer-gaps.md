# Matriz parcial de eventos e riscos do snapshot MobFlow

Data: 2026-11-08  
Branch: `migration/neon-preparation`

## Inventário confirmado em `src/routes/api/mobflow/state.ts`

Os eventos abaixo são derivados da diferença entre o snapshot anterior e o novo, dentro da transação que atualiza `app_state`.

| Categoria | Tipo de entidade | Operação/payload observado |
|---|---|---|
| `catalog` | `product` | `upsert` com campos de catálogo; `delete` |
| `promotions` | `promotion` | `upsert` com id, produto, preços e vigência; `delete` |
| `conference` | `conference` | `upsert` com contagens, desconhecidos, ajustes, recebimento e validades; `delete` |
| `stock` | `stock_adjustment` | `upsert` com motivo, operador e itens; `delete` |
| `stock` | `stock_writeoff` | `upsert` com baixa, motivo, operador e itens; `delete` |
| `stock` | `stock_transfer` | `upsert` com transferência, destino, operador e itens; `delete` |
| `master_data` | `manual_expiry` | `upsert` com produto, quantidade, validade e unidade; `delete` |
| `master_data` | `business_contact` | metadado redigido: id e tipo; `delete` |
| `master_data` | `cash_session` | metadado: id, status, abertura e fechamento; `delete` |
| `master_data` | `cash_movement` | metadado: id, sessão, tipo, valor e data; `delete` |
| `master_data` | `supplier` | nome; chave atual derivada do nome normalizado; `delete` |
| `settings` | `company_settings` | operação `changed` com lista de chaves permitidas |

Além disso, para produto já existente, o endpoint emite:
- `stock/product`: `stockDelta`, `resultingStock`, `source: state_update`.
- `price/product`: `price`, `previousPrice`, `source: state_update`.

## Lacunas relevantes

1. **Não há evento de venda nessa projeção.** A auditoria deve localizar se vendas são emitidas por rota específica ou se permanecem apenas dentro do snapshot. Não assumir que o stream atual cobre vendas.
2. Contatos, caixa e fornecedores carregam apenas metadados redigidos. Esses eventos não bastam para reconstruir todos os dados que outras telas podem precisar; é necessário definir projeção completa segura ou manter carregamento inicial controlado.
3. Configurações emitem somente nomes de chaves alteradas, não os valores. O consumidor não consegue aplicar a alteração sem outra leitura.
4. Chave de fornecedor baseada no nome normalizado é instável quando o nome muda e pode colidir; usar ID persistente antes de tratar fornecedor como entidade replicável.
5. Eventos de estoque derivados do snapshot são deltas e também trazem saldo resultante. O reducer deverá aplicar uma única estratégia (preferencialmente validar versão/resultado), nunca somar o delta duas vezes após bootstrap ou replay.
6. Eventos manuais usam IDs aleatórios para operação/idempotência em cada comparação. A repetição de uma alteração lógica não tem chave estável ponta a ponta.
7. Vários registros operacionais têm `upsert` e `delete` mas não foi definido tombstone/versão da entidade para impedir que um evento antigo ressuscite um registro excluído.
8. A projeção atual mistura eventos úteis para notificação/auditoria com eventos insuficientes para reconstruir o estado de uma segunda sessão. Não considerar o stream pronto para ser o único meio de sincronização.

## Matriz de trabalho antes de programar o reducer

Para cada entidade, preencher e testar:
- ID estável da entidade e do comando.
- Produtor e rota de negócio.
- Transação que altera a entidade.
- Envelope e versão do payload.
- Campos completos necessários ao consumidor.
- Política de exclusão/tombstone.
- Idempotência no servidor e no cliente.
- Ordem/versão por entidade.
- Proteção de dados sensíveis.
- Interação com alterações locais pendentes e bootstrap.

## Conclusão

O stream atual já oferece uma base de eventos incrementais, mas uma parte significativa é uma projeção redigida do snapshot e não um log de comandos completo. O próximo trabalho é auditar rotas de operação específicas (principalmente vendas, estoque, caixa e recebimento) e separar claramente eventos de notificação dos eventos suficientes para projetar o estado. Não ativar ainda o consumidor e não retirar o polling de 3 segundos.