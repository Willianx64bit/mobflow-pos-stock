# Migração limpa do MobFlow — PDV

> Documento de acompanhamento. Branch de trabalho: `migration/neon-preparation`.
> **Regra absoluta:** não alterar `main`, produção, nem o projeto ColetaFlow.

## Objetivo

Preparar uma cópia funcional e independente do MobFlow PDV, substituindo a dependência operacional da Supabase por Neon PostgreSQL e Cloudflare R2.

Referência atual do PDV: https://mobflow-pos-stock.lovable.app

## Regra de cópia limpa

- [ ] Reaproveitar código, estrutura, regras de negócio, layouts, configurações não secretas e migrations necessárias.
- [ ] Recriar no Neon somente o schema, índices, constraints, funções e permissões necessários.
- [ ] Não copiar empresas, usuários de clientes, produtos de empresas, vendas, estoque, caixa, movimentações, financeiro, histórico, cobranças ou qualquer dado operacional.
- [ ] Não importar backups nem fazer dump de dados da Supabase.
- [ ] Não copiar chaves, senhas, tokens ou segredos da Supabase.
- [ ] Garantir que o banco novo comece sem empresas e sem histórico operacional.
- [ ] Manter apenas o necessário para o funcionamento inicial e para o cadastro de novas empresas.

## Arquitetura-alvo

- Banco de dados: Neon PostgreSQL.
- Arquivos e imagens: Cloudflare R2 privado.
- Hospedagem: ambiente de Preview isolado, sem publicar em produção durante a migração.
- Comunicação com o Admin: APIs próprias autenticadas e com isolamento por empresa.
- Autenticação: fluxo definido para o PDV e compatível com a aprovação de empresas no Admin.

## Checklist de execução

### 1. Inventário do sistema atual
- [ ] Mapear tabelas, relações, índices, constraints, triggers, views, RPCs e funções usados pelo PDV.
- [ ] Mapear Edge Functions, chamadas HTTP e fluxos que ainda dependem da Supabase.
- [ ] Mapear autenticação, sessão, cadastro, recuperação de senha e logout.
- [ ] Mapear uploads, leitura, atualização e remoção de imagens/arquivos.
- [ ] Identificar variáveis de ambiente necessárias, sem registrar valores secretos neste documento.

### 2. Banco Neon limpo
- [ ] Confirmar projeto e branch Neon exclusivos para o novo ambiente.
- [ ] Criar/aplicar migrations de estrutura sem dados de empresas.
- [ ] Configurar usuário de banco com permissões mínimas.
- [ ] Validar isolamento de dados por empresa.
- [ ] Confirmar que não existem empresas, vendas ou históricos importados.
- [ ] Documentar migrations aplicadas e pendentes.

### 3. Remoção da dependência Supabase
- [ ] Migrar consultas e gravações para Neon/API própria.
- [ ] Migrar autenticação e gerenciamento de sessão.
- [ ] Migrar operações antes executadas por RPC/Edge Functions.
- [ ] Remover imports e chamadas Supabase restantes após confirmar que não há consumidores.
- [ ] Verificar variáveis e configurações antigas no código e no Preview.
- [ ] Confirmar que o PDV funciona sem credenciais ou serviços Supabase.

### 4. Cloudflare R2
- [ ] Definir bucket privado exclusivo para o ambiente de teste.
- [ ] Configurar credenciais somente no servidor.
- [ ] Migrar upload, leitura, substituição e exclusão de imagens/arquivos para R2.
- [ ] Guardar no Neon apenas metadados e referências dos objetos.
- [ ] Validar autorização por empresa e impedir acesso cruzado.
- [ ] Não copiar arquivos antigos de empresas.

### 5. Integração com o Admin
- [ ] Definir o fluxo de cadastro de empresa no PDV.
- [ ] Garantir que uma empresa nova fique pendente até aprovação administrativa.
- [ ] Garantir que empresas pendentes não acessem as funções operacionais.
- [ ] Validar ativação após aceite no Admin.
- [ ] Validar rejeição/bloqueio e mensagens apresentadas ao usuário.

### 6. Testes do PDV
- [ ] Cadastro de empresa nova.
- [ ] Estado pendente antes da aprovação.
- [ ] Login após aprovação.
- [ ] Produtos e categorias.
- [ ] Estoque e movimentações.
- [ ] Vendas, caixa e fechamento.
- [ ] Sincronização e atualização entre dispositivos.
- [ ] Upload, visualização, substituição e exclusão de imagens no R2.
- [ ] Isolamento entre duas empresas de teste.
- [ ] Tratamento de erros e logs sem dependência Supabase.

### 7. Critérios de conclusão
- [ ] PDV executa os fluxos previstos usando Neon e R2.
- [ ] Nenhum dado de empresa/histórico da produção foi copiado.
- [ ] Nenhuma chamada operacional à Supabase permanece.
- [ ] Testes documentados com resultado e evidências.
- [ ] Preview de teste acessível sem proteção indevida de login Vercel.
- [ ] Produção permanece intacta até autorização expressa.

## Registro de andamento

| Data | Etapa | Resultado / observação |
|---|---|---|
| 2026-11-10 | Planejamento | Checklist criado; execução e validações ainda precisam ser registradas. |

> Atualizar este arquivo a cada etapa: marcar somente o que foi efetivamente implementado e testado. Registrar bloqueios e evidências; não marcar como concluído apenas porque existe código.


## Checkpoint de análise e correções — 2026-11-10

### Origem Supabase — somente inventário, sem copiar dados
- O PDV de origem contém dados de empresas, perfis, estado e allowlist. Eles foram consultados apenas para identificar o que **não** deve ser migrado.
- Nenhuma empresa, perfil de cliente, venda, estoque, caixa, movimentação, histórico, token ou arquivo de cliente foi copiado para o Neon.
- Nenhuma alteração foi feita na origem Supabase.
- A branch de migração é intencionalmente separada da main, que continua sendo a versão oficial com Supabase. Não fazer merge geral da main sobre esta branch; selecionar mudanças funcionais individualmente se forem necessárias.

### Neon Preview confirmado
- Projeto Neon PDV: proud-star-34734307.
- Branch de Preview: mobflow-historical-rehearsal-20261109 (br-red-tree-bdk94c7k).
- Database usado pelo endpoint de cadastro, confirmado em log de runtime: mobflow_pdv_clean_start, papel mobflow_signup_preview.
- Tabelas centrais verificadas sem dados operacionais: companies=0, profiles=0, account_allowlist=0, app_state=0, products=0, sales=0, stock_movements=0, cash_sessions=0.
- Configuração global admin_billing_settings: uma linha; mensalidade R$ 49,90 e Pix configurado.
- **Resíduos que impedem declarar o banco 100% vazio:** uma linha em admin_internal.company_deletion_audit, dois registros em user, dois em account e uma sessão, sem perfis associados. Não são empresas ativas, mas são registros de teste/histórico. A limpeza desses registros está pendente de autorização explícita; não foram apagados.

### Correções aplicadas somente no Preview
- Corrigido o contexto de tenant: app.account_id agora é definido antes dos inserts protegidos por RLS e antes do fluxo de primeiro acesso do gerente.
- Criadas políticas RLS dedicadas para o papel server-side mobflow_signup_preview em companies, profiles e account_allowlist.
- Concedida leitura mínima de companies ao papel mobflow_api, limitada por RLS ao tenant autenticado.
- Migration versionada em neon/migrations/20261110070000_signup_rls_and_subscription_gate.sql e aplicada somente ao database Preview acima.
- Teste controlado executado como mobflow_signup_preview: inserts de identidade/conta/perfil/allowlist/empresa/estado, leitura e atualizações passaram; a transação de teste foi revertida e não deixou empresa de teste.
- A autenticação do PDV agora revalida o status e vencimento da assinatura em cada requisição autenticada, bloqueando sessões existentes quando a empresa está pendente, suspensa ou vencida.

### Neon Realtime
- Neon Realtime já estava habilitado na branch de Preview e o alias do PDV estava permitido.
- Recuperado o segredo existente e restauradas as variáveis NEON_REALTIME_SECRET e VITE_NEON_REALTIME_URL no Vercel, exclusivamente para Preview + migration/neon-preparation.
- Não registrar o segredo neste arquivo.
- Pendente: teste visual em dois dispositivos. A API de eventos incrementais ainda não substitui o snapshot completo; manter a reconciliação/fallback atual até testes de concorrência e reconexão.

### Arquivos e armazenamento
- Código atual contém endpoints server-side R2 para comprovantes Pix, logo da empresa e fotos de produto.
- Bucket privado de Preview: mobflow-preview-files.
- O teste anterior via API de gerenciamento Cloudflare confirmou PUT/GET/DELETE no bucket, mas ainda falta provar as credenciais S3 instaladas na Vercel.
- Pendente: entrar no Admin Preview, abrir Configurações e clicar em **Testar armazenamento R2**. O teste cria e remove um objeto sintético e informa upload/leitura/remoção.
- Pendente: teste real de upload/visualização de logo e foto de produto, com isolamento entre duas empresas.

### Deploy e testes
- O Preview do PDV para a branch foi gerado como READY após as correções.
- O Preview do Admin continua READY e a autenticação Better Auth registrou sign-in HTTP 200 e consulta de sessão HTTP 200.
- Pendente: validar visualmente o painel Admin, confirmar carregamento da lista vazia de empresas e executar o teste R2 pela interface.
- Pendente: teste ponta a ponta cadastro PDV → pendência → Admin aprova → login PDV liberado.
- Pendente: executar build/testes automatizados após as últimas alterações e validar sincronização em dois dispositivos.
