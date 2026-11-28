# MobFlow PDV — ensaio isolado da migration 0006

Status: branch Neon de ensaio criada e pronta; migration 0006 **não aplicada**.

## Ambiente isolado

- Projeto Neon de teste: `mobflow-pdv-realtime-test` (`proud-star-34734307`).
- Branch pai: `realtime-validation` (`br-wild-night-bds1bdfk`).
- Branch exclusiva de ensaio: `mobflow-0006-rehearsal-isolated` (`br-square-waterfall-bdi7kysd`).
- Banco: `mobflow_pdv_test`.
- PostgreSQL observado: 18.6.
- A branch de ensaio foi criada a partir da branch de validação e está `ready`.
- Verificação read-only confirmou que ela herdou apenas a base já existente da migration 0005: `mobflow_sync_counters`, `mobflow_sync_events` e `mobflow_append_sync_event`. As tabelas de domínio da 0006 ainda não existem.

Nenhuma migration foi executada nesta branch. Nenhum dado de negócio foi inserido.

## Correções aplicadas ao rascunho 0006

1. FKs do tenant raiz para `profiles(id)` mudaram de `ON DELETE CASCADE` para `ON DELETE RESTRICT`. Isso impede apagar vendas, caixa e histórico de estoque em cascata ao remover o perfil raiz; desativação deve ser o caminho operacional.
2. FKs redundantes de operador de coluna única foram removidas de `cash_movements` e `receivable_payments`. Permanecem as FKs compostas `(tenant_id, operator_profile_id)` para garantir o mesmo tenant.
3. O ledger de estoque preserva o snapshot do operador e usa `ON DELETE SET NULL (operator_profile_id)` na FK composta, mantendo o tenant e o registro histórico.
4. As tabelas e APIs continuam aditivas; a migration não troca `app_state` como fonte de verdade nem habilita leitura Neon.

## Bloqueios ainda a validar antes da execução

- Confirmar sintaxe e comportamento da FK com lista de colunas `ON DELETE SET NULL (operator_profile_id)` no PostgreSQL 18.6 da branch isolada.
- Verificar se o role executor tem ownership/DDL grants adequados; não executar como `mobflow_api`.
- Confirmar que `mobflow_api` existe na branch e recebe apenas grants mínimos.
- Revisar políticas RLS com sessão real da API: contexto `app.account_id` e `app.user_id` setados dentro da mesma transação; testes negativos entre tenants.
- Revisar unicidade de código/barcode e formato dos IDs antigos.
- Conferir se exclusão de produto pode apagar códigos de barras sem quebrar referências históricas; movimentos de estoque não têm FK para produto intencionalmente.
- Validar constraints, índices, nomes, permissões e repetibilidade da migration.
- Avaliar retenção/arquivamento antes de qualquer exclusão de perfil ou tenant.

## Roteiro de ensaio (após autorização explícita)

1. Capturar inventário read-only e estado inicial da branch isolada.
2. Aplicar a migration corrigida somente nessa branch.
3. Confirmar todas as tabelas, constraints, índices, grants, policies e RLS.
4. Inserir dados sintéticos em transação de teste: dois tenants, perfis manager/PDV, produtos, barcode, caixa, venda, pagamento e movimentos.
5. Validar FKs compostas rejeitando operador de outro tenant.
6. Validar RLS para leitura/escrita no tenant correto e bloqueio do tenant vizinho.
7. Validar que remoção de perfil raiz com registros operacionais é bloqueada e que remoção de operador em movimento histórico preserva o movimento e limpa apenas o operador.
8. Validar unicidade/idempotência e consistência das constraints.
9. Fazer rollback/limpeza somente dos dados sintéticos conhecidos, sem apagar branch ou schema.
10. Registrar resultados e correções antes de propor aplicação em outra branch.

## Critérios de segurança

- Não aplicar em `realtime-validation`, produção ou branch padrão.
- Não importar dados reais nem fazer backfill de `app_state`.
- Não habilitar feature flag de leitura Neon no app.
- Não executar migration sem autorização explícita do usuário após apresentar o diff final.
- A branch de ensaio deve permanecer isolada até decisão posterior.
