# 99 — Inventário cruzado PDV + Admin e plano de desligamento seguro

Data: 2026-11-08
Branch: migration/neon-preparation
Escopo: auditoria estática dos dois repositórios e evidências dos checkpoints 95–98 (PDV) e 04/94 (Admin). Não houve alteração de produção, Supabase de origem, dados, objetos ou secrets.

## Regra de saída
Nenhuma referência será removida por contagem. Cada fluxo precisa de substituto equivalente, teste positivo, teste de erro/permissão, isolamento por tenant e evidência de Preview. Código/infra Supabase ficam preservados até o aceite do cutover e janela de rollback.

## Inventário cruzado de consumidores

### PDV — chamadas e dependências encontradas
| Área/arquivo | Situação | Ação necessária |
|---|---|---|
| Login/cadastro `src/components/LoginScreen.tsx` | Fluxo Better Auth/Neon; referências Supabase já removidas do componente | Testar login gerente, operador, cadastro, pagamento e sessão em Preview |
| Logout operador `src/components/AppHeader.tsx` | Ainda importa cliente Supabase e chama `supabase.auth.signOut()` | Trocar pelo logout Better Auth e preservar limpeza dos estados locais; testar logout e revogação de sessão |
| Identidade/CNPJ na baixa `src/routes/baixa-produtos.tsx` | Ainda consulta `auth.getUser()` e `profiles` Supabase; fallback usa settings locais | Substituir por `GET /api/mobflow/session-context` e identidade account-scoped; validar CNPJ e documento gerado |
| Recuperação gerente `src/routes/recuperar-senha.tsx` | Endpoint Neon já existe (`/api/mobflow/manager-password-recovery`), mas ramo Supabase permanece como fallback condicionado por flag fixa true | Validar solicitação, e-mail Resend, token único/expiração, redefinição e login; então retirar somente o ramo antigo |
| Fiado `src/routes/fiado.tsx` | Reautenticação ainda chama Edge Function `mobflow-login` | Usar endpoint Neon de login/reautenticação, após comparar exatamente contrato de resposta, CNPJ, role e senha; testar pagamentos parciais e totais |
| Configurações/Gerência | Ramo Better Auth ativo; trechos Supabase legados continuam no arquivo | Migrar/confirmar cada operação: recuperação, reautenticação, listagem/criação/bloqueio de usuários, reset da aplicação e logout. Não remover antes de comparar ações/erros/permissões |
| APIs Neon `session-context`, `users`, `manager-password-recovery`, `reauth-manager`, `login` | Substitutos já presentes no código | Testar em runtime e confirmar schema/roles/permissões para cada ação |
| `src/lib/store.ts` e snapshot | Estado local + snapshot/outbox; sincronização incremental não está completa | Manter snapshot/fallback até todos os domínios, cursor, retry, idempotência, replay e dois dispositivos estarem validados |
| `supabase/functions/*` | Funções antigas de login, cadastro, recuperação, reautenticação e usuários | Preservar como rollback/referência; mapear consumidores e retirar uma a uma somente após paridade comprovada |

### Admin — chamadas e dependências encontradas
| Área/arquivo | Situação | Ação necessária |
|---|---|---|
| `src/App.tsx`, `src/lib/auth-client.ts` | Better Auth ativo | Testar login, sessão, refresh e logout no Preview |
| `src/lib/adminApi.ts` → `api/admin.ts` | API Neon ativa para sessão, cobrança, empresas, preço, confirmação, renovação, suspensão e URL de comprovante R2 | Comparar contratos e erros com a Edge Function antiga; testar cada ação |
| `supabase/functions/mobflow-admin-api` | Legado; autentica Supabase, consulta Admin/PDV e Storage; inclui exclusão de empresa | Não reativar como fallback. Preservar até confirmar consumidores externos e paridade de todas as ações |
| `supabase/functions/mobflow-public-billing` | Legado; lê configuração pública no Supabase | PDV Preview usa `GET /api/mobflow/signup` Neon. Confirmar que não há consumidores externos antes de retirar |
| Exclusão de empresa | API Neon retorna HTTP 501; antiga rotina apaga dados de várias tabelas, Auth e Storage | Implementar fluxo novo de exclusão controlada no Neon/R2; ver desenho abaixo |

## Variáveis antigas — inventário de remoção condicionada
Variáveis/segredos que pertencem aos fluxos Supabase antigos e precisam ser procurados em ambos os projetos Vercel (Production, Preview e Development), workflows, Edge Functions e integrações externas:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- No Admin legado: `MOBFLOW_PDV_URL`, `MOBFLOW_PDV_SERVICE_ROLE_KEY` (confirmar se ainda existem consumidores fora da Edge Function antiga).
- Qualquer `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_JWT_SECRET`, `SUPABASE_PROJECT_REF` ou variável com prefixo Supabase em CI/deploy (inventário real de ambiente ainda precisa ser feito sem revelar valores).

Não remover variáveis só por nome. Primeiro localizar referências em código, Vercel env scopes, GitHub Actions, cron/webhooks, scripts e clientes externos. Registrar apenas nome, ambiente, presença/ausência e consumidor — nunca valor. Remover uma variável somente após deploy validado sem ela e período de observação.

Variáveis de destino a preservar:
- Neon/Better Auth e URLs de origem confiável.
- R2: `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`.
- Realtime e e-mail conforme uso comprovado. Não exibir nem copiar secrets em logs/documentos.

## Arquivos: estado comprovado e lacunas
- Comprovantes Pix: PDV tem upload R2 e metadado `companies.payment_proof_path`; Admin cria URL assinada R2 de 60s e valida prefixo de tenant. Bucket Supabase PDV `mobflow-payment-proofs` foi inventariado com zero objetos e zero referências na consulta de 2026-11-08. Ainda falta teste real pelo formulário PDV → banco Neon → Admin → abrir arquivo, incluindo tentativa de acesso cross-tenant.
- Fotos: NÃO migradas. `ProductForm` mantém Data URL/Base64; API relacional de produtos ainda não aceita bytes nem upload. Implementar endpoint autenticado, validação MIME/assinatura/tamanho, chave tenant-scoped, gravação R2, persistência `photo_object_key`, leitura autorizada e remoção substitutiva com compensação. Preservar visual e edição de produto.
- Logos: fluxo R2 já existe em `/api/mobflow/company-logo`; testar PUT/GET/DELETE com credenciais S3 da Vercel e tenant.
- Documentos/anexos: inventário de origem identificou 32 documentos JSON de baixa/transferência, mas sem bytes/Base64/URL/nome de arquivo; são dados operacionais a preservar, não binários para copiar. Recebimentos verificados sem campo document preenchido. Importação XLSX/CSV é local. Ainda precisa busca abrangente por Data URLs, Blob/File, base64, URLs e campos de anexos em todos os domínios e telas.
- Inventário Storage Supabase Admin: nenhum bucket/objeto no checkpoint 96. Reconsultar antes do corte.

## Desenho seguro de exclusão de empresa no Admin
1. Autorização: Better Auth + allowlist Admin, MFA/reautenticação recente e confirmação digitando identificador/nome; nunca confiar no nome enviado pelo browser.
2. Pré-visualização: API retorna contagem por domínio, usuários, vendas, estoque, movimentos, caixa, recebimentos, documentos e objetos R2; mostra dependências e irreversibilidade.
3. Soft-delete inicial: marcar tenant como `deletion_pending`, bloquear novos logins/escritas e revogar sessões/tokens da empresa; registrar ator, motivo, horário e snapshot de auditoria. Não apagar imediatamente.
4. Retenção: aplicar política legal/financeira definida; separar dados que devem ser retidos de dados que podem ser eliminados. Não presumir que venda/registro financeiro possa ser apagado.
5. Plano de objetos: listar chaves R2 pelo prefixo exato do tenant e cruzar com metadados; gerar manifesto com key, tamanho, ETag/checksum e resultado. Nunca usar prefixo parcial ou confiar em caminho fornecido pelo cliente.
6. Execução idempotente: job server-side com `deletion_id`, etapas/checkpoints e retries; transações Neon para dados relacionais, lote de exclusão R2 separado, reconciliação após cada etapa. Não manter transação SQL aberta durante operações de rede.
7. Integridade: FK/cascade explícitos e testados; evitar cascata que apague histórico compartilhado ou identidade Admin. Nunca remover conta Admin, configurações globais ou registros de outras empresas.
8. Recuperação: janela de quarentena com possibilidade de reativar tenant antes da purga; backup/export auditável antes da purga; após purga, registrar comprovante de execução sem dados sensíveis.
9. Resposta: `202 Accepted` com estado do job, depois endpoint de status; falhas parciais ficam visíveis e retomáveis, nunca reportar sucesso falso.
10. Testes: tenant sintético com dados de todos os domínios, tenant vizinho para provar isolamento, repetição do mesmo job, falha no meio, objeto órfão, FK restritiva, reativação e purga final. Ação fica indisponível até aprovação.

## Bloqueios de saída definitiva
- Divergência de mensalidade no checkpoint 96: Supabase Admin R$49,90 e Neon Preview R$69,90. Não promover Preview nem alterar preço sem reconciliar fonte oficial; o padrão comercial informado é R$49,90.
- Dados reais PDV ainda não foram importados/reconciliados: fingerprints de tenants não coincidem. Não confundir fixtures Preview com migração real.
- Sync incremental não está completo; snapshot/outbox permanece necessário.
- Fotos ainda sem fluxo R2.
- R2 por credenciais S3 Vercel e fluxo comprovante Admin ainda sem E2E.
- Login Admin e equivalência de senha da origem precisam ser testados; nunca redefinir senha sem autorização.
- Builds recentes limitados pela quota Vercel Hobby; não disparar deployments repetidos. Testes locais/CI e inspeção estática até janela de build.

## Plano de execução com gates
A. Inventário cruzado de todos consumidores e envs; incluir busca em workflows, Vercel e integrações externas.
B. Fechar fluxos PDV: logout, CNPJ da baixa, recuperação, fiado, usuários/gerência/reset; teste de contrato e regressão.
C. Fechar R2: comprovante E2E, foto produto, logo E2E, inventário completo de anexos, manifesto e checksum de qualquer objeto a copiar.
D. Fechar Admin: ações administrativas, exclusão segura (soft-delete/job/quarentena/purga), comprovantes e billing.
E. Backfill real: snapshot consistente, preservar IDs/tenant, comparar contagens e checksums por domínio; reconciliar dados antes de cutover.
F. Testes integrados: login/cadastro/pagamento, CRUD, venda, caixa, estoque, baixa/transferência/recebimento, fiado, usuários/permissões, arquivos, suspensão/renovação/Admin, offline/outbox/retry/replay, dois dispositivos e isolamento multi-tenant.
G. Retirada gradual: feature flags/compatibilidade, deployment Preview, smoke tests, observação; remover consumidores/variáveis/Edge Functions em sequência, manter backups e rollback.
H. Desligar projetos/buckets/functions Supabase somente após aprovação explícita, período estável e plano de reversão.

## Segurança
Nenhuma alteração em main/Production, Supabase de origem, dados reais, R2 de produção, senha Admin ou ColetaFlow. Nenhum secret foi lido ou registrado. Este documento é auditoria/plano, não declaração de migração concluída.
