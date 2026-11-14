# MobFlow PDV — matriz de autorização e operações (auditoria)

Data: 06/11/2026
Branch de referência: `migration/neon-preparation`
Escopo: somente auditoria de autorização, Edge Functions e contratos de operação. Nenhuma alteração funcional, DDL ou escrita em banco foi executada.

## 1. Modelo de identidade e empresa

- `profiles.id` identifica o usuário Auth individual.
- `profiles.account_id` identifica a empresa/conta e é o escopo de tenancy.
- O gerente principal normalmente tem `role='manager'` e `account_id=id`.
- Operadores têm `role='pdv'` e compartilham o `account_id` do gerente.
- `profiles.active` bloqueia login/ações protegidas quando falso.
- `profiles.permissions` contém permissões de produto: `PDV`, `Operações`, `Conferência`, `Validade`, `Fiado`, `Gerência`. O valor legado `Conferência` é normalizado para `Operações` na criação/edição de usuários.
- Não confundir `cnpj` (validação/vínculo comercial) com `account_id` (chave técnica de tenancy).

## 2. Matriz de autorização observada nas Edge Functions versionadas

| Operação | Identidade exigida | Escopo aplicado no servidor | Observação |
|---|---|---|---|
| Login | username/senha; função pública com verify_jwt=false | Busca profile por username; valida active, role esperado, CNPJ, empresa e assinatura | Cria primeiro gerente em fluxo legado autorizado pela allowlist |
| Listar usuários PDV | Bearer Auth válido + perfil ativo com role manager ou permissão Gerência | account_id do gerente autenticado; filtra role=pdv | Não aceita account_id do cliente |
| Criar usuário PDV | Mesmo requisito de gerência | Vincula novo profile ao account_id e CNPJ do gerente; valida allowlist | Primeiro operador pode receber Gerência automaticamente |
| Alterar permissões | Mesmo requisito de gerência | Busca alvo e exige target.account_id igual ao gerente e role=pdv | Lista de permissões é allowlist de seis valores |
| Bloquear/desbloquear | Mesmo requisito de gerência | Atualiza active somente no usuário pdv da mesma conta | Login também verifica active |
| Redefinir senha PDV | Mesmo requisito de gerência | Auth Admin updateUserById no alvo da mesma conta | Senha mínima de 6 caracteres no código consultado |
| Excluir usuário PDV | Mesmo requisito de gerência | Desativa allowlist da empresa e exclui Auth user; tenta restaurar allowlist se falhar | Operação multi-sistema com compensação |
| Reautenticar gerência | Bearer válido + perfil ativo e role manager ou pdv com permissão Gerência | manager_security_by_account por account_id | SHA-256 sem salt no código versionado; versão publicada diverge |
| Zerar aplicação | Bearer + role manager + senha exclusiva da gerência | app_state do account_id; depois exclui usuários pdv e allowlist daquela conta | Destrutiva e não atômica entre etapas; falhas parciais possíveis |
| Excluir todos PDV | Bearer + gerente ou pdv com permissão Gerência | profiles por account_id e role=pdv | Exclusão sequencial com compensação parcial de allowlist |
| Primeiro acesso gerente | Token de setup + CNPJ + username/senha | Empresa localizada por CNPJ e token; atualiza Auth, profile e companies | Fluxo sem sessão; operações em múltiplas tabelas não são uma transação única |
| Enviar comprovante | Token de solicitação + MIME/base64 permitidos | companies por payment_request_token; upload bucket privado e atualiza metadados | Remove objeto se update de metadados falhar |
| Recuperação senha gerência | Fluxo público com token de uso único | Tabela de tokens por account_id; e-mail SMTP | Rate limit, anti-enumeração, expiração e consumo atômico devem ser preservados |

## 3. Permissões de banco e camada de aplicação

O inventário de catálogo já documentado confirmou:

- RLS habilitado nas sete tabelas públicas consultadas.
- Somente quatro policies foram retornadas: SELECT/INSERT/UPDATE em `app_state` por `private.current_account_id()`, e SELECT em `profiles` para o próprio usuário/gerência da conta.
- Roles `anon` e `authenticated` têm privilégios de tabela excessivos em `app_state`; `anon` também tem privilégios amplos em `profiles`. Há TRUNCATE concedido a roles de cliente, que RLS não restringe.
- Tabelas administrativas (companies, allowlist, manager_security e tokens) não concedem privilégios de tabela a anon/authenticated no resultado consultado; operações ocorrem pelas Edge Functions com service role.
- `service_role` tem privilégios amplos e deve permanecer exclusivamente server-side.
- Funções SQL críticas são SECURITY DEFINER; no destino precisam de owner controlado, search_path seguro e EXECUTE concedido somente aos papéis necessários.

**Decisão de desenho:** não reproduzir os grants excessivos no Neon. O novo backend deve expor operações de negócio explicitamente autorizadas, usar credenciais privadas no servidor, derivar account_id da identidade validada e manter RLS como defesa adicional quando houver acesso SQL por usuário.

## 4. Matriz de operações de estoque e recebimento

| Operação | Caminho observado | Persistência/efeito | Invariante de migração |
|---|---|---|---|
| Venda | Frontend/store.ts | Movimento negativo em stockMovements + alteração de estoque dentro do snapshot | Venda e delta não podem duplicar em retry/merge |
| Cadastro com estoque inicial | Frontend/store.ts | Movimento Cadastro positivo | Saldo inicial e evento devem permanecer coerentes |
| Importação | Frontend/store.ts | Movimento Importação com delta correspondente | Importação repetida não pode duplicar movimento |
| Ajuste manual/balanço | Frontend/store.ts | Movimento com diferença do saldo | Preservar motivo, operador, saldo antes/depois |
| Baixa | Frontend/store.ts | Movimento negativo | Idempotência e saldo final |
| Transferência | Frontend/store.ts | Movimento Transferência no estoque de origem | Confirmar efeitos nos dois produtos/locais e concorrência |
| Conferência | Frontend/store.ts | Movimento Balanço quando contagem difere | Preservar fechamento e delta |
| Recebimento | RPC finalize_receiving_decisions / accept_receiving | Bloqueio da linha app_state, validação e atualização transacional de estoque/recebimento | Reproduzir exatamente os contratos instalados em produção; não substituir pelo SQL ledger não aplicado |

## 5. Divergências e riscos que bloqueiam a matriz final

1. **Reautenticação de gerência:** produção v14 permite perfil ativo com permissão Gerência; arquivo versionado exige adicionalmente role pdv para não-gerentes. Falta confirmar a regra funcional aprovada. Não escolher automaticamente.
2. **Operações destrutivas:** reset_application atualiza app_state, depois remove usuários; delete_all_pdv desativa allowlist e exclui Auth em sequência. Não são transações distribuídas; a migração deve especificar idempotência, confirmação reforçada, trilha de auditoria e recuperação de falha parcial.
3. **Permissões de UI:** esta matriz comprova os gates das Edge Functions consultadas, mas ainda não é inventário completo de todas as verificações de rota/tela no frontend. Antes da migração, cruzar cada menu/ação do app com o backend e testar chamadas diretas sem permissão.
4. **Concorrência de estoque:** vendas e movimentos comuns são montados no cliente e gravados no snapshot via CAS/merge. Recebimentos são RPCs transacionais no servidor. Os dois caminhos precisam continuar separados no primeiro corte.
5. **Transferência:** o resumo do store identifica movimento negativo na origem; confirmar no código completo o pareamento/entrada no destino e o formato de IDs antes de congelar contrato.
6. **Autorização Realtime:** a assinatura atual filtra owner_id no cliente, mas no Neon Realtime a sealed query precisa ser emitida no servidor após autenticação, com tenant derivado de fonte confiável. Não confiar em account_id informado pelo cliente.

## 6. Testes de autorização obrigatórios

- Usuário ativo e inativo; assinatura ativa, vencida, suspensa e cancelada.
- Manager, operador com Gerência e operador sem Gerência.
- Cada permissão isolada: PDV, Operações, Validade, Fiado, Gerência.
- Tentativa de listar/alterar/excluir usuário de outra empresa adulterando userId.
- Tentativa de trocar account_id/owner_id no payload.
- Acesso direto a endpoints sem sessão, com token expirado e com sessão revogada.
- Usuário bloqueado durante sessão existente: definir e testar prazo/efeito da revogação.
- Reset da aplicação com falha após gravar estado, após excluir parte dos usuários e durante allowlist.
- Recuperação com token expirado, usado duas vezes, SMTP indisponível e concorrência de consumo.
- Realtime: adulteração de parâmetros, sealed query expirada, usuário bloqueado e isolamento entre empresas.

## 7. Conclusão desta rodada

A autorização do PDV não é apenas role-based: combina identidade Auth, profile ativo, role, permissões granulares, account_id, CNPJ, status de assinatura e operações privilegiadas server-side. A arquitetura Neon deve preservar cada dimensão e centralizar a derivação de tenant no servidor.

Esta matriz é parcial e baseada no código versionado da branch de preparação e nos resultados de catálogo já registrados. Não representa prova de que todas as telas/rotas do frontend foram cobertas, nem substitui validação das versões publicadas das seis Edge Functions.

## 8. Limites mantidos

- Nenhuma escrita no Supabase de produção.
- Nenhuma alteração em banco, Auth, JWT, Storage, Edge Functions ou Realtime.
- Nenhuma importação/ativação no Neon.
- Nenhuma alteração de código funcional ou deploy.
- Nenhuma alteração no MobFlow Admin ou ColetaFlow.
