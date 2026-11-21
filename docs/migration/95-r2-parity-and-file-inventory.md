# 95 — R2 parity, comprovantes Pix e inventário de arquivos

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: auditoria estática do PDV/Admin e leitura do schema Neon de teste. Nenhum dado, arquivo de cliente, objeto de Storage, segredo ou ambiente de produção foi alterado.

## 1. Estado real do R2

Bucket configurado: `mobflow-preview-files` (privado).  
Credenciais: PDV read/write e Admin read-only, ambas limitadas ao bucket.  
Variáveis Preview cadastradas nos dois projetos Vercel para a branch de migração.

**Importante:** configuração de credenciais não comprova conectividade. Ainda não há evidência de um PUT/GET/DELETE real no bucket: o último inventário do contrato R2 indicava zero objetos e `last_used_on` nulo. O teste operacional deve ser feito somente em Preview, com chave sintética, após existir deployment Preview executável. Não testar na produção.

## 2. Comprovantes Pix — PDV

Arquivo: `src/routes/api/mobflow/signup.ts`.

- O cadastro valida token de solicitação, MIME allowlist (JPEG/PNG/WEBP/PDF), limite de 5 MB e assinatura binária.
- Com as quatro variáveis R2 presentes, grava em `tenants/{account_id}/pix-proofs/{ano}/{mês}/{uuid}.{ext}`.
- Salva a chave em `companies.payment_proof_path`.
- Se a atualização do banco falhar, tenta remover o objeto recém-enviado.
- Se R2 não estiver configurado, ainda existe fallback legado para Supabase Storage `mobflow-payment-proofs`, com caminho `{requestToken}/{uuid}.{ext}`.
- Se houver configuração R2 parcial, a rota falha com 503; não cai silenciosamente no Supabase.

**Compatibilidade ainda incompleta:** o Admin gera URL assinada somente para chaves no novo prefixo R2. Um registro legado com caminho Supabase em `payment_proof_path` não é lido pelo Admin migrado. Antes de desligar o Storage antigo, precisamos suportar a leitura de ambos os formatos durante a transição ou migrar e verificar todos os objetos e referências.

## 3. Comprovantes Pix — Admin

Arquivo: `api/admin.ts`.

- Acesso exige sessão Better Auth e e-mail igual a `MOBFLOW_ADMIN_EMAIL`.
- A leitura consulta `companies.payment_proof_path` no banco Neon do PDV.
- Aceita somente chave com prefixo `tenants/{account_id}/pix-proofs/`, valida segmentos e emite URL assinada R2 de 60 segundos.
- A credencial R2 do Admin é read-only, conforme desenho.

**Pendente:** teste ponta a ponta PDV upload → Neon metadata → Admin lista → Admin abre comprovante; testar também registro legado sem tentar acessar arquivo de outro tenant. Não remover objetos antigos durante a validação.

## 4. Fotos de produtos

Estado atual identificado:

- A UI `src/components/ProductForm.tsx` mantém a foto como Data URL/Base64 no estado do formulário e aceita até 5 MB.
- O estado legado `src/lib/store.ts` ainda tipa `Product.photo` como string, compatível com o formato antigo.
- A API relacional `src/routes/api/mobflow/products.ts` retorna `photoObjectKey` a partir de `products.photo_object_key`.
- A API rejeita explicitamente `photo` e `photoObjectKey` no cadastro do produto, com código `photo_upload_required`; não existe nesta branch endpoint de upload/download de foto R2.
- A migration relacional já contém `photo_object_key`, mas isso é apenas a referência, não o fluxo de arquivo.

**Conclusão:** fotos ainda não foram migradas para R2. A implementação deve manter o mesmo comportamento visual do formulário e o contrato de dados, substituindo a persistência Base64 por upload autenticado e referência de objeto. O endpoint de download deve validar tenant e vínculo do produto. Não alterar regras de cadastro/edição de produto.

## 5. Documentos e anexos

A auditoria da árvore de código identificou importação de planilhas XLSX/CSV como processamento local, não como arquivo persistido no Storage. Também existem campos de documento/anexo em operações de estoque (por exemplo, documento em baixa/transferência), mas a fonte atual não foi mapeada completamente para identificar se são Base64, metadados ou apenas dados locais.

Não foi confirmado nesta leitura um fluxo genérico de upload/download de documentos ou anexos em R2. Antes de implementar, mapear os tipos de operação e a estrutura dos campos no estado legado, sem alterar seu conteúdo nem comportamento.

## 6. Inventário de Storage Supabase — limite da evidência

Fontes consultadas na branch de migração:
- `src/routes/api/mobflow/signup.ts`: bucket legado `mobflow-payment-proofs`.
- `src/components/ProductForm.tsx` e `src/lib/store.ts`: foto de produto mantida como string/Base64 no estado local/legado.
- `src/routes/api/mobflow/company-logo.ts`: fluxo de logo no R2; Neon guarda `settings.companyLogoObjectKey`.
- `src/routes/api/mobflow/products.ts`: coluna relacional `photo_object_key`, sem fluxo de bytes.
- `docs/migration/84-cloudflare-r2-storage-contract.md`: registra que o bucket legado de comprovantes havia sido reportado vazio numa auditoria anterior, mas exige rechecagem.

Esta auditoria de código **não equivale a uma listagem real dos objetos Supabase**. Ainda precisamos obter a listagem de buckets/objetos no projeto de origem, com contagem, tamanho total, MIME, chaves e referências no banco. Não inferir que um bucket está vazio apenas porque não apareceu no código. Não excluir nem sobrescrever origem.

## 7. Compatibilidade do Admin com Neon — verificação de schema de teste

Leitura realizada no projeto Neon isolado `proud-star-34734307`, branch `br-wild-night-bds1bdfk`, database `mobflow_pdv_test` (não produção).

Foram confirmadas as tabelas/colunas usadas pelo código atual:
- `companies`: contém os campos usados por listagem, cobrança, status e comprovante, incluindo `payment_proof_path`, `payment_submitted_at`, `payment_request_token`, `subscription_expires_at` e `manager_setup_completed_at`.
- `admin_billing_settings`: contém `id`, `monthly_price`, `payment_method`, `pix_phone`, `updated_at`, `updated_by`.
- Better Auth: `user`, `account` e `session` presentes com os campos esperados pela configuração atual.
- `products`: contém `photo_object_key`.

Contagens da massa isolada no momento da leitura: companies 2, admin_billing_settings 1, products 2, Better Auth user 6, account 6 e session 2. São dados de teste e não representam volume de produção.

**Pendente:** validar autenticação por HTTP no Preview, sessão/cookies, listagem de empresas, todas as ações administrativas existentes, leitura do comprovante, configuração pública de cobrança e integração do cadastro do PDV. A leitura SQL comprova schema, não o funcionamento ponta a ponta.

## 8. Cobrança pública — ponto de compatibilidade

A fonte antiga `supabase/functions/mobflow-public-billing/index.ts` lê `admin_billing_settings` e devolve mensalidade, método Pix e chave Pix, além de nome/cidade do recebedor. O Admin novo já lê e atualiza essa tabela por `api/admin.ts`; o cadastro Neon do PDV também consulta essa tabela.

Na branch atual do PDV, o frontend `src/components/LoginScreen.tsx` consulta `GET /api/mobflow/signup` para carregar somente `monthly_price` e `payment_method`. Essa rota já lê `admin_billing_settings` no Neon. O POST de cadastro também lê a mesma tabela e monta o payload Pix no servidor; o envio de comprovante segue pelo mesmo endpoint POST com a ação `submit_payment_proof`.

A função antiga `mobflow-public-billing` do projeto Supabase administrativo permanece no repositório como referência de origem, mas não foi encontrada como chamada ativa no frontend da branch de migração consultada. Portanto, não criar uma segunda API pública sem necessidade. Preservar o contrato efetivamente consumido por `GET /api/mobflow/signup` e testar a resposta e o fluxo de QR Pix em Preview. Não alterar preço, método, chave ou regras de cobrança.

## 9. Próximos passos técnicos, sem cutover

1. Identificar todas as referências frontend à função pública antiga e reproduzir seu contrato em endpoint Neon.
2. Definir compatibilidade de leitura para comprovantes antigos e novos; testar o fluxo novo completo no Preview.
3. Implementar upload/download autenticado de fotos R2 e ligar o formulário sem alterar o comportamento de cadastro.
4. Mapear documentos/anexos por tipo de operação e reproduzir seus fluxos existentes.
5. Obter inventário real do Supabase Storage e criar manifesto de cópia (origem, destino, tenant, MIME, bytes, checksum, resultado).
6. Copiar em lotes de teste, verificar checksum e referências; manter a origem intacta até reconciliação e autorização.
7. Só depois avançar para sincronização relacional completa, rollback por command ID/replay e testes multi-dispositivo.
8. Não ativar flags incrementais, remover fallback ou desligar Supabase enquanto qualquer domínio/fluxo permanecer sem paridade comprovada.

## 10. Restrições

- Nenhuma alteração em `main`, Production, Supabase original ou dados de clientes.
- Nenhuma mudança nas regras de pagamento, renovação, suspensão, catálogo ou operações.
- Nenhuma exclusão de arquivos de origem.
- Nenhuma alteração no ColetaFlow.
