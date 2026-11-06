# 23 — Encerramento da Etapa 3: auditoria e plano de migração

Data: 2026-11-06  
Repositório: `Willianx64bit/mobflow-pos-stock`  
Branch de preparação: `migration/neon-preparation`  
Produção Supabase: `ezkwubdpblqkdfampopa`  
Neon teste: projeto `square-haze-51319178`, branch `br-wandering-union-bd6vcsk6`.

## 1. Resultado da Etapa 3

A auditoria de arquitetura, dados, identidade, autorização, sincronização, RPCs, funções, rotas e armazenamento foi consolidada nos documentos 01–23 em `docs/migration/`. A etapa de levantamento está encerrada **com pendências e bloqueios explicitamente registrados**. Isto significa que há informação suficiente para planejar a execução controlada, mas não significa que a migração esteja pronta para corte de produção.

## 2. Arquitetura e comportamento que devem ser preservados

- `app_state` é o snapshot operacional JSONB central.
- `profiles.id` identifica o usuário; `profiles.account_id` identifica a conta/tenant. Não confundir.
- O salvamento principal usa `mobflow_save_state`, bloqueio de linha e comparação de `updated_at` (CAS).
- O frontend reconcilia snapshots, protege contra eventos fora de ordem e mantém polling de segurança de aproximadamente 3 segundos.
- Supabase Auth é dependência direta do frontend e de FKs de tabelas públicas.
- Login atual usa username + CNPJ + senha, com e-mail sintético no domínio `accounts.mobflow.local`.
- Há seis Edge Functions ativas identificadas na auditoria, incluindo login, usuários, reautenticação, signup, recuperação de senha e API administrativa.
- Comprovantes de pagamento ficam em bucket privado Supabase Storage.
- As operações de venda, estoque e recebimento precisam manter atomicidade, isolamento de tenant e comportamento de concorrência.

## 3. Riscos/bloqueios que impedem migração direta

### Bloqueio A — bootstrap e histórico de schema
O banco registra 28 migrations, mas o repositório contém apenas sete arquivos SQL em `supabase/migrations`. Os nomes/timestamps não coincidem exatamente e o histórico não fornece um bootstrap completo para banco vazio. É obrigatório obter schema-only confiável e reconciliar cada objeto antes de montar o schema Neon. Não reconstruir schema-base por suposição.

### Bloqueio B — Auth e IDs
Múltiplas FKs apontam para `auth.users`. Senhas Supabase não podem ser transferidas diretamente para Neon Managed Auth. Exige mapa de IDs, estratégia de reativação/reset de senha e testes do login por username/CNPJ. A configuração completa de Auth (políticas, confirmação, duração de sessão, refresh, MFA, SMTP) não foi validada via ferramenta.

### Bloqueio C — autorização/RLS
RLS está habilitado nas sete tabelas públicas identificadas, mas a consulta atual retornou somente quatro políticas: três em `app_state` e uma em `profiles`. Cinco tabelas não retornaram políticas. As rotinas SECURITY DEFINER e os grants precisam de desenho explícito no destino. Não copiar grants amplos do Supabase.

### Bloqueio D — Realtime
Neon Realtime permanece desabilitado na branch de teste. A documentação pública consultada descreve beta sem RLS nativo no Realtime. Não substituir Supabase Realtime diretamente. Exige backend que derive tenant, emita sealed queries autorizadas, controle revogação e mantenha polling como fallback até todos os testes passarem.

### Bloqueio E — ledger e recebimento
O arquivo `20261028190000_stock_movement_ledger.sql` não consta no histórico de produção. As RPCs de recebimento instaladas diferem funcionalmente das versões desse arquivo. Não aplicar automaticamente. Decidir separadamente se a primeira migração reproduz o comportamento atual ou se introduz o ledger como melhoria funcional.

### Bloqueio F — Storage
O bucket de comprovantes é privado e a consulta não encontrou políticas em `storage.objects`. O upload usa service role. A autorização para leitura/download precisa ser implementada no backend e validada sem expor objetos publicamente.

### Bloqueio G — diferenças entre fonte e produção
A versão publicada de `mobflow-reauth-manager` diverge do código versionado quanto a quais papéis com permissão Gerência são aceitos. É necessária decisão funcional e teste antes de portar/substituir a função.

### Bloqueio H — operações e rotas
A auditoria identificou controles de rota/menu heterogêneos e flags locais que não constituem segurança. Ainda é necessário fechar o inventário exaustivo de cada chamada de operação e sua autorização server-side, especialmente vendas, caixa, estoque, baixas, transferências, inventário e recebimento. A interface não deve ser tratada como fronteira de segurança.

## 4. Plano recomendado para a Etapa 4 (execução futura)

1. **Congelar referência:** capturar schema-only, migrations históricas e definições de funções, políticas, triggers, grants, índices e constraints de produção.
2. **Reconciliação:** comparar os 28 registros históricos com os sete arquivos versionados e o catálogo real; classificar cada diferença como aplicada, ausente, substituída, obsoleta ou desconhecida.
3. **Bootstrap Neon:** preparar schema em branch Neon isolada, sem dados reais; criar roles e autorização mínima, sem copiar privilégios Supabase indiscriminadamente.
4. **Backend/RPCs:** portar operações para backend/SQL transacional com tenant derivado da sessão e testes de autorização negativos.
5. **Dados:** preparar export/import com contagens, checksums, validação de FKs, JSONB e reconciliação; nunca usar dados de produção em teste sem autorização e sanitização.
6. **Auth:** decidir manter Supabase Auth temporariamente ou migrar para Neon Managed Auth em fase separada; testar login, bloqueio, sessão, refresh, recuperação e IDs.
7. **Storage:** mover comprovantes por fluxo privado autenticado, validar MIME/tamanho/path e acesso por tenant.
8. **Realtime:** piloto isolado com sealed query assinada pelo backend, duas empresas, revogação, reconexão, ordenação e fallback de polling.
9. **Regressão funcional:** testar login, permissões, venda simultânea, estoque, recebimento, devolução, transferência, fechamento de caixa, histórico, relatórios, offline/reconexão e isolamento entre empresas.
10. **Cutover:** só após critérios aprovados, backup verificado, janela definida, plano de rollback ensaiado e autorização explícita.

## 5. Critérios mínimos para liberar corte

- Zero divergência não explicada no schema e no histórico.
- Zero acesso cruzado entre tenants em testes positivos/negativos.
- Nenhuma perda ou duplicação em testes concorrentes de estoque/venda/recebimento.
- Sessões, bloqueios e recuperação testados.
- Realtime validado com fallback ativo e sem exposição cross-tenant.
- Contagens/checksums e reconciliação de dados aprovados.
- Storage privado validado.
- Rollback ensaiado e tempo de recuperação aceitável.
- Aprovação explícita do responsável pelo produto.

## 6. Verificação de escopo GitHub

A comparação `main...migration/neon-preparation` mostrou a branch 45 commits à frente e sem commits atrás. O diff reporta 22 documentos de auditoria e também dois arquivos de Edge Functions como adicionados em relação a `main`:
- `supabase/functions/mobflow-admin-api/index.ts`
- `supabase/functions/mobflow-manager-password-recovery/index.ts`

Esses dois arquivos já fazem parte do conteúdo da branch comparada e não foram criados/alterados pelos commits de documentação desta etapa. Não fazer merge automático da branch inteira sem revisão separada desses arquivos. Os commits realizados nesta etapa foram somente adições/atualizações em `docs/migration/`.

## 7. Estado dos ambientes e limites desta etapa

- Nenhuma escrita, DDL, migration, importação ou exclusão foi executada no Supabase de produção.
- Nenhuma função foi publicada ou substituída.
- Nenhuma alteração funcional foi feita no site, frontend, login, estoque ou sincronização nesta etapa.
- Nenhum serviço Neon (Auth, Realtime, Storage, Data API ou Functions) foi ativado.
- A branch Neon de teste continua sem tabelas de aplicação e com Realtime desabilitado na verificação registrada.
- MobFlow Admin e ColetaFlow permaneceram fora do escopo.

**Conclusão:** Etapa 3 encerrada como auditoria e planejamento. Etapa 4 não iniciada. A execução exige autorização explícita e deve começar em ambiente Neon isolado, seguindo os bloqueios e critérios acima.
