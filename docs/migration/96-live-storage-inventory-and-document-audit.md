# 96 — Inventário real do Storage, cobrança e conferência de dados

Data: 2026-11-08
Branch: `migration/neon-preparation`
Escopo: consultas somente de leitura no Supabase PDV/Neon e teste sintético no Cloudflare R2. Nenhuma origem foi apagada ou sobrescrita.

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

## 4. Cobrança pública — PDV Preview

O endpoint `GET /api/mobflow/signup` foi consultado no deployment Preview mais recente da branch e respondeu HTTP 200 com `ok=true`, preço mensal e método Pix vindos de `admin_billing_settings` no Neon. O valor/chave Pix não foi reproduzido nesta auditoria.

A tela de cadastro usa esse endpoint para exibir o preço, e o `POST /api/mobflow/signup` também consulta a mesma tabela para gerar o payload Pix. Não foi encontrada chamada frontend para a antiga Edge Function `mobflow-public-billing` no fluxo Better Auth/Preview. Portanto, a cobrança pública já tem caminho Neon no PDV Preview; ainda falta teste de cadastro completo e leitura pelo Admin.

## 5. Reconciliação de dados — alerta de cutover

A comparação foi feita por fingerprints não reversíveis de IDs, sem expor IDs ou dados pessoais.

- Supabase PDV de origem: 7 perfis, 2 empresas e 2 snapshots `app_state`. O snapshot com dados operacionais contém 4 produtos, 73 vendas, 29 baixas e 3 transferências.
- Neon Preview `realtime-validation`: 9 perfis, 2 empresas e 4 snapshots `app_state`; os fingerprints de empresas/tenants não coincidem com os da origem.
- O banco Neon de ensaio contém dados sintéticos de validação. A branch `mobflow-0006-rehearsal-isolated` também foi documentada como ensaio com fixtures sintéticas, sem importação real.

Conclusão: **a migração de dados reais PDV → Neon ainda não foi concluída**. Contagens isoladas semelhantes não comprovam migração. É obrigatório importar preservando IDs e reconciliar cada tenant/domínio antes de cutover. Nenhum dado real foi copiado nesta auditoria.

## 6. Projeto Supabase Admin

A restauração do projeto `mobflow-admin` (`xsitutjpdshmidzpgxpx`) foi solicitada para inventário. O último status observado foi `COMING_UP`; o banco ainda retornou indisponível. As Edge Functions antigas aparecem ativas, mas isso não comprova que o banco/Storage esteja acessível. Não presumir que estejam vazios.

## 7. Previews e variáveis

- PDV: deployment Preview da branch `migration/neon-preparation` READY após o commit desta auditoria.
- Admin: deployment anterior da branch READY; o commit documental mais recente encontrou bloqueio de build por limite de builds da Vercel.
- As quatro variáveis R2 existem nos ambientes Preview dos dois projetos; os segredos não foram revelados nem lidos.
- PDV usa credencial de leitura/gravação; Admin usa credencial somente leitura.

## 8. Pendências reais após este inventário

1. Implementar upload/leitura/remoção de fotos de produto no R2 e persistir somente a chave no Neon. O catálogo atual ainda não possui esse fluxo.
2. Executar upload real pelo cadastro PDV, leitura pelo Admin e teste de isolamento entre tenants; validar credenciais S3 da Vercel, não apenas a API de gerenciamento.
3. Mapear se algum fluxo de baixa/transferência precisa de arquivo binário além dos 32 registros JSON existentes; não tratar esses registros como anexos.
4. Concluir inventário do banco e Storage do Supabase Admin após a restauração ficar ACTIVE.
5. Planejar e executar backfill real do Supabase PDV para uma branch Neon de ensaio, preservando IDs e verificando contagens/checksums; manter a origem intacta.
6. Concluir contratos incrementais, rollback/replay e testes HTTP autenticados PDV/Admin antes de ativar leitura relacional ou cutover.

## 9. Segurança e limites

- Nenhuma alteração em `main` ou Production.
- Nenhuma alteração em ColetaFlow.
- Nenhuma exclusão, sobrescrita ou movimentação de dados Supabase.
- Nenhuma credencial foi exposta.
- Não desligar Supabase nem fazer cutover até validar banco, arquivos, autenticação, cobrança, sincronização e rollback.
