# 96 — Inventário real do Storage, cobrança e conferência de dados

Data: 2026-11-08
Branch: `migration/neon-preparation`
Escopo: consultas somente de leitura no Supabase PDV/Admin e Neon, além de teste sintético no Cloudflare R2. Nenhuma origem foi apagada ou sobrescrita.

## 1. Supabase Storage — projeto mobflow-pos-stock

Consulta realizada no projeto Supabase `ezkwubdpblqkdfampopa`.

- Bucket encontrado: `mobflow-payment-proofs`.
- Bucket privado, limite configurado de 5 MiB e allowlist JPEG/PNG/WEBP/PDF.
- Consulta a `storage.objects`: zero objetos.
- Tabela `companies`: 2 registros; zero referências em `payment_proof_path` (zero referências R2 e zero referências legadas).

Conclusão: não há arquivo de comprovante a copiar desse bucket no momento da consulta. O fluxo novo ainda precisa de teste ponta a ponta no Preview.

## 2. Arquivos embutidos no app_state

Consulta de leitura em `public.app_state`:

- 2 linhas de estado.
- 4 produtos no JSON agregado; zero com `photo` preenchida.
- Zero valores de logo em `settings.companyLogo`.
- 4 recebimentos; zero com campo `document` preenchido.
- 29 documentos de baixa e 3 documentos de transferência (32 objetos JSON no total).

Os 32 objetos de baixa/transferência contêm metadados de operação, endereço/identificação e itens; não possuem campo de bytes/Base64, URL ou nome de arquivo. Portanto, não são anexos binários para copiar ao R2. Devem ser preservados como dados operacionais durante a migração relacional/estado.

## 3. Cloudflare R2 — teste sintético

Bucket privado: `mobflow-preview-files`.

Teste realizado pela API de gerenciamento Cloudflare, usando chave sintética:
- PUT: sucesso.
- GET: conteúdo lido idêntico ao enviado.
- DELETE: sucesso.
- Listagem posterior: vazia.

Limite da evidência: esse teste confirma o serviço R2 e o bucket, mas não valida as credenciais S3 instaladas na Vercel nem os endpoints do PDV/Admin. O teste ponta a ponta de cada aplicação permanece pendente.

## 4. Cobrança pública e configuração — diferença crítica

O endpoint `GET /api/mobflow/signup` foi consultado no deployment Preview mais recente da branch e respondeu HTTP 200 com `ok=true`, preço mensal e método Pix vindos de `admin_billing_settings` no Neon. A chave Pix não foi reproduzida.

Comparação read-only da configuração:
- Supabase Admin de origem: 1 linha, mensalidade R$ 49,90, método Pix.
- Neon Preview usado pelo PDV: 1 linha, mensalidade R$ 69,90, método Pix.
- Fingerprint da chave Pix coincide entre origem e Neon.

**A mensalidade diverge em R$ 20,00.** Não foi alterado nenhum valor. A migração não deve promover a configuração Preview nem fazer cutover até confirmar qual preço é o valor oficial a preservar. O POST de cadastro do PDV usa a mesma configuração Neon para gerar o payload Pix.

## 5. Admin Supabase — inventário após restauração

O projeto `mobflow-admin` (`xsitutjpdshmidzpgxpx`) foi restaurado e está `ACTIVE_HEALTHY`.

- Schema público: somente `admin_billing_settings`.
- A tabela possui 1 linha.
- `auth.users`: 1 usuário; `auth.identities`: 1 identidade.
- `storage.buckets`: nenhum bucket.
- `storage.objects`: zero objetos.
- Edge Functions antigas `mobflow-admin-api` e `mobflow-public-billing` permanecem ativas na origem; não foram removidas.

A identidade do usuário Admin foi encontrada por fingerprint de e-mail entre os usuários Better Auth do Neon Preview. A equivalência da senha não foi validada: o hash no destino não é idêntico ao hash de origem, então é necessário teste real de login ou redefinição controlada antes do corte.

## 6. Reconciliação de dados PDV — alerta de cutover

A comparação foi feita por fingerprints não reversíveis de IDs, sem expor IDs ou dados pessoais.

- Supabase PDV de origem: 7 perfis, 2 empresas e 2 snapshots `app_state`. O snapshot com dados operacionais contém 4 produtos, 73 vendas, 29 baixas e 3 transferências.
- Neon Preview `realtime-validation`: 9 perfis, 2 empresas e 4 snapshots `app_state`; os fingerprints de empresas/tenants não coincidem com os da origem.
- A branch `mobflow-0006-rehearsal-isolated` foi documentada como ensaio com fixtures sintéticas, sem importação real.

Conclusão: **a migração dos dados reais PDV → Neon ainda não foi concluída**. Contagens isoladas semelhantes não comprovam migração. É obrigatório importar preservando IDs e reconciliar cada tenant/domínio antes de cutover. Nenhum dado real foi copiado nesta auditoria.

## 7. Previews e variáveis

- PDV: deployment Preview da branch `migration/neon-preparation` READY após o commit documental.
- Admin: deployment anterior da branch READY; commits documentais recentes encontraram limite de builds da Vercel.
- As quatro variáveis R2 existem nos ambientes Preview dos dois projetos; segredos não foram revelados.
- PDV usa credencial de leitura/gravação; Admin usa credencial somente leitura.

## 8. Pendências reais após este inventário

1. Implementar upload/leitura/remoção de fotos de produto no R2 e persistir somente a chave no Neon.
2. Executar upload real pelo cadastro PDV, leitura pelo Admin e teste de isolamento entre tenants; validar credenciais S3 da Vercel, não apenas a API de gerenciamento.
3. Preservar os 32 registros JSON de baixa/transferência durante o backfill; não tratá-los como anexos binários.
4. Validar login Admin real e equivalência da senha; testar todas as ações administrativas.
5. Confirmar preço oficial antes de sincronizar `admin_billing_settings` entre origem e Neon.
6. Planejar e executar backfill real do Supabase PDV para uma branch Neon de ensaio, preservando IDs e verificando contagens/checksums.
7. Concluir contratos incrementais, rollback/replay e testes HTTP autenticados PDV/Admin antes de ativar leitura relacional ou cutover.

## 9. Segurança e limites

- Nenhuma alteração em `main` ou Production.
- Nenhuma alteração em ColetaFlow.
- Nenhuma exclusão, sobrescrita ou movimentação de dados Supabase.
- Nenhuma credencial foi exposta.
- Não desligar Supabase nem fazer cutover até validar banco, arquivos, autenticação, cobrança, sincronização e rollback.
