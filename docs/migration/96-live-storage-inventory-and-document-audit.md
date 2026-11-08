# 96 — Inventário real do Storage e conferência de documentos

Data: 2026-11-08
Branch: `migration/neon-preparation`
Escopo: consultas somente de leitura no Supabase PDV e teste sintético no Cloudflare R2. Nenhuma origem foi apagada ou modificada.

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

## 4. Admin Supabase

O projeto de origem `mobflow-admin` (`xsitutjpdshmidzpgxpx`) foi consultado e está com status `INACTIVE`. Não foi reativado. A auditoria de suas tabelas e Storage depende de restaurar o projeto; não presumir que esteja vazio.

## 5. Previews e variáveis

- PDV e Admin têm deployments Preview READY na branch `migration/neon-preparation`.
- Os checks Vercel dos commits consultados estão em sucesso.
- As quatro variáveis R2 existem nos ambientes Preview dos dois projetos; as credenciais não foram reveladas nem lidas.
- PDV usa credencial de leitura/gravação; Admin usa credencial somente leitura.

## 6. Pendências reais após este inventário

1. Implementar upload/leitura/remoção de fotos de produto no R2 e persistir somente a chave no Neon. O catálogo atual ainda não possui esse fluxo.
2. Concluir a compatibilidade de comprovantes legados e executar upload real pelo cadastro PDV, leitura pelo Admin e teste de isolamento entre tenants.
3. Mapear se algum fluxo de baixa/transferência precisa de um arquivo binário além dos 32 registros JSON existentes; não tratar esses registros como anexos.
4. Restaurar temporariamente o projeto Supabase Admin somente após autorização, para inventariar seu banco e Storage.
5. Fazer a reconciliação dos dados relacionais PDV/Admin em Neon com contagens, IDs e checksums; o banco Neon de ensaio consultado não é prova de paridade com a origem.
6. Executar testes HTTP autenticados no Preview e testes de rollback/replay.

## 7. Segurança e limites

- Nenhuma alteração em `main` ou Production.
- Nenhuma alteração em ColetaFlow.
- Nenhuma exclusão, sobrescrita ou movimentação de dados Supabase.
- Nenhuma credencial foi exposta.
- Não desligar Supabase nem fazer cutover até validar banco, arquivos, autenticação, cobrança, sincronização e rollback.
