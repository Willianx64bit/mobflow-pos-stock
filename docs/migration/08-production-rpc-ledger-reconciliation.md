# MobFlow PDV — confirmação do estado real das RPCs e ledger de estoque

Data: 06/11/2026  
Escopo: leitura direta do catálogo PostgreSQL de produção e comparação com o arquivo versionado na branch `migration/neon-preparation`. Nenhuma escrita foi executada.

## Resultado confirmado no Supabase de produção

A tabela `supabase_migrations.schema_migrations` contém exatamente 28 registros, terminando em `20261027123026 atomic_app_state_compare_and_swap`. Não existe registro com versão `20261028190000` para `stock_movement_ledger`.

Consulta ao catálogo de objetos públicos não encontrou tabela, view ou outro objeto cujo nome corresponda a `stock_movement`/ `movement`.

As definições efetivamente instaladas de `public.accept_receiving` e `public.finalize_receiving_decisions` foram lidas por `pg_get_functiondef`. Nenhuma delas atualiza a chave `stockMovements` dentro do JSONB. Ambas alteram produtos/recebimentos dentro de `app_state`; a função `mobflow_save_state` está instalada e implementa CAS.

## Diferenças em relação a `supabase/sql/stock_movement_ledger.sql`

O arquivo do GitHub não é apenas uma adição de ledger: ele substitui as duas RPCs de recebimento e altera o comportamento.

### `finalize_receiving_decisions`

- **Produção:** exige recebimento `status='analisando'`, `stockReleased=false`; valida decisões e produtos; marca `decisionCompleted=true`, `status='aceito'`, `stockReleased=true`; atualiza estoque no snapshot. Não registra movimento no array `stockMovements`.
- **Arquivo GitHub:** mantém a validação, acrescenta operador, data, IDs determinísticos e eventos de estoque ao array `stockMovements`; também marca status/flags no snapshot.
- Implicação: aplicar o arquivo pode mudar histórico/relatório de estoque e exige teste de compatibilidade com o frontend e com dados históricos.

### `accept_receiving`

- **Produção:** aceita apenas `status='analisando'`, exige `decisionCompleted=true` e `stockReleased=false`; valida decisões previamente gravadas; atualiza estoque e estado de recebimento.
- **Arquivo GitHub:** aceita `status IN ('conferido','divergente')`, sem exigir `decisionCompleted`; adiciona movimentos ao array `stockMovements`.
- Implicação: a mudança altera o contrato funcional da operação, não apenas a auditoria de movimentos. Não pode ser aplicada automaticamente nem assumida como versão correta.

## Conclusão

A suspeita anterior está agora confirmada: a migração `stock_movement_ledger.sql` não aparece no histórico remoto e o código efetivamente instalado das RPCs não contém o ledger. Além disso, as RPCs no arquivo versionado diferem funcionalmente das RPCs de produção.

Isso não prova que o recurso de ledger esteja ausente de toda a interface ou de todos os fluxos de venda; prova somente que esse arquivo não foi aplicado e que essas duas RPCs instaladas não escrevem no array `stockMovements`. O frontend pode registrar outros tipos de movimentos no snapshot por outros caminhos, que precisam de auditoria separada.

## Decisão obrigatória antes da migração

1. Tratar as definições lidas em produção como referência atual do comportamento do PDV, não o arquivo SQL do GitHub.
2. Não aplicar `stock_movement_ledger.sql` em produção ou Neon sem aprovação explícita e testes de regressão.
3. Comparar os fluxos de venda, ajuste, baixa, transferência, entrada e recebimento para identificar quais já geram movimentos no frontend e quais dependem das RPCs.
4. Definir se a migração deve primeiro reproduzir exatamente o comportamento atual ou se o ledger é uma melhoria funcional separada, com aprovação e rollout próprios.
5. Construir testes que provem que estoque não duplica e que relatórios permanecem consistentes nos dois caminhos de recebimento.

## Fontes e evidências

- Supabase production: `supabase_migrations.schema_migrations` (SELECT, 28 registros).
- Supabase production: `pg_get_functiondef` para `accept_receiving`, `finalize_receiving_decisions` e `mobflow_save_state` (SELECT).
- Supabase production: catálogo `pg_class`/ `pg_namespace` para objetos públicos de movimento (SELECT; nenhum resultado).
- GitHub isolado: `supabase/sql/stock_movement_ledger.sql` na branch `migration/neon-preparation`.

## Segurança e escopo

- Somente SELECTs foram executados no Supabase.
- Nenhuma migração foi aplicada e nenhum dado foi alterado.
- Nenhum projeto, código ou configuração do Neon foi alterado.
- MobFlow Admin e ColetaFlow continuam fora do escopo.
