# Doc 78 — Revisão de segurança e integridade dos drafts 0005/0006

**Branch:** `migration/neon-preparation`  
**Tipo:** revisão estática; nenhum SQL executado, nenhuma alteração em banco.

## 1. Resultado

Os drafts 0005 (eventos incrementais) e 0006 (fundação relacional operacional) ainda não estão prontos para aplicação. A estrutura geral está alinhada ao objetivo, mas há bloqueios que exigem revisão antes de qualquer execução.

## 2. Bloqueador: exclusão da identidade raiz do tenant

Nos dois drafts, tabelas centrais usam:
- `tenant_id REFERENCES public.profiles(id) ON DELETE CASCADE`;
- em 0005, contador e eventos também são apagados em cascata quando o perfil raiz do tenant é excluído.

O perfil gerente é a raiz da conta no modelo atual (`manager.id = account_id`). Portanto, excluir esse perfil pode apagar em cascata catálogo, vendas, pagamentos, caixa, ledger e histórico de sincronização. Isso é inadequado para registros financeiros/auditáveis sem uma política explícita de encerramento e retenção.

**Bloqueio:** não aplicar enquanto a política de exclusão/encerramento de empresa não estiver definida. Preferir desativação/soft delete da conta e retenção dos registros; qualquer cascade de tenant deve ser deliberado, protegido e testado.

## 3. Contexto RLS e autorização

Os dois drafts usam contexto transacional:
- `app.account_id` para tenant;
- `app.user_id` para operador.

A expressão `NULLIF(current_setting(..., true), '')::uuid` resulta em NULL quando o contexto está ausente; isso faz as políticas negarem linhas, comportamento fail-closed desejável.

Mas a proteção só funciona se:
1. a API estabelecer ambos os valores com `SET LOCAL`/parâmetros equivalentes após validar sessão;
2. o contexto for estabelecido na mesma conexão/transação que executa SQL;
3. nenhum endpoint permitir ao cliente escolher livremente account_id/user_id;
4. o papel `mobflow_api` não possuir bypass de RLS;
5. cada rota também incluir predicados explícitos de tenant e autorização por função/permissão.

O draft 0006 concede CRUD para `mobflow_api`; isso não substitui autorização por operação. O teste anterior indicou que `mobflow_api` não é superuser e não tem BYPASSRLS, mas permissões e owner de cada tabela ainda precisam ser confirmados no ambiente de aplicação.

## 4. Integridade dos operadores

O draft 0006 usa FKs compostas `(tenant_id, operator_profile_id) -> profiles(account_id,id)`, o que é a proteção correta contra operador de outra empresa. Há também FKs inline simples em `cash_movements.operator_profile_id` e `receivable_payments.operator_profile_id` para `profiles(id)`, redundantes com a FK composta. Recomenda-se remover as FKs simples e manter somente a composta para reduzir ambiguidade.

A FK do ledger usa `ON DELETE SET NULL (operator_profile_id)`, preservando `tenant_id` e o registro histórico. Confirmar que a versão PostgreSQL alvo aceita a lista de colunas e testar a migration em branch descartável antes de aplicação real.

## 5. Integridade do caixa

`cash_sessions_one_open_per_operator_uidx` implementa a regra atual de uma sessão aberta por operador, não uma por empresa/terminal. Isso corresponde ao comportamento observado. Porém, o schema ainda não garante por constraint que `closed_by` é o próprio operador autorizado; a autorização deve ser feita no comando server-side.

A constraint de fechamento exige `counted_amount` e `closed_at`, mas não exige `expected_amount`, `difference_amount` nem consistência aritmética. O comando de fechamento deve calcular esperado no servidor a partir de vendas/pagamentos/movimentos confirmados, nunca confiar no valor calculado no cliente.

## 6. Integridade de vendas e pagamentos

O draft permite múltiplas linhas em `sale_payments`, embora a regra atual observada seja uma forma de pagamento por venda. Isso pode ser útil no futuro, mas a API precisa impor a regra atual e validar que o valor pago/recebido e troco sejam coerentes com o total. Não habilitar split tender sem decisão de produto.

O campo `payment_status` da venda e as linhas de pagamento podem divergir se o comando não atualizar ambos atomicamente. A liquidação de fiado precisa gravar pagamento, atualizar status e lucro conforme regra atual na mesma transação.

## 7. Ledger e exclusão de produto

O ledger intencionalmente não tem FK para produto, preservando histórico quando o cadastro é removido. É uma decisão correta para auditoria, desde que `product_id` seja tratado como referência histórica e `product_name/product_code` sejam snapshots imutáveis.

`stock_movements_operation_line_key` e o índice de idempotência ajudam a deduplicar, mas o comando precisa definir `line_key` estável por item. A chave de idempotência do movimento não substitui a chave da operação; ambas precisam ser consistentes em retries.

O campo `source_kind` distingue legado real/reconstruído/live. Backfill deve mapear explicitamente os IDs antigos e nunca promover registros reconstruídos a histórico exato.

## 8. Eventos 0005

A função `mobflow_append_sync_event` usa SECURITY INVOKER e serializa sequência por tenant com lock no contador. É uma base adequada, mas:
- o papel precisa de privilégios mínimos nas tabelas/função;
- o ator deve ser validado como ativo e pertencente ao tenant;
- os contextos de sessão devem ser definidos pela API confiável;
- retenção/expurgo de eventos não está definido;
- a função retorna sequência anterior quando a chave idempotente repete, mas o chamador deve garantir que a mesma chave representa o mesmo conteúdo/operação;
- payload tem limite de 16 KB no banco; APIs devem aplicar limite compatível antes de chegar ao SQL.

Não habilitar a função para chamadas diretas de clientes.

## 9. Escopo ainda incompleto do draft 0006

O draft tem 9 tabelas: catálogo/produtos, códigos de barras, caixa, vendas/pagamentos e ledger. Não contém tabelas relacionais para recebimentos, conferências, ajustes, baixas, transferências, validades, promoções, contatos, fornecedores e configurações.

Isso não é necessariamente defeito se for uma primeira fundação incremental, mas não pode ser apresentado como schema completo nem usado para cutover total do snapshot.

## 10. Bloqueios para aprovação de aplicação

- [ ] Definir retenção e soft delete de tenant/contas.
- [ ] Remover FKs redundantes de operador e validar a FK composta restante.
- [ ] Executar validação de sintaxe em branch Neon descartável, nunca produção.
- [ ] Confirmar owner, grants e RLS efetivo para cada tabela.
- [ ] Testar contexto ausente, tenant errado, operador de outra empresa e usuário inativo.
- [ ] Implementar APIs transacionais e testes antes de tornar tabelas autoritativas.
- [ ] Definir invariantes de pagamentos e fechamento de caixa no servidor.
- [ ] Definir retenção, replay e reconciliação do event log.
- [ ] Desenhar as entidades operacionais ausentes.
- [ ] Só então solicitar aprovação explícita para aplicar migrations em ambiente de teste.

## 11. Limites

Esta é uma revisão estática dos arquivos SQL e código consultados. Não houve execução de DDL, DML, backfill, teste de escrita, alteração de permissões ou acesso à produção. MobFlow Admin e ColetaFlow permanecem intocados.
