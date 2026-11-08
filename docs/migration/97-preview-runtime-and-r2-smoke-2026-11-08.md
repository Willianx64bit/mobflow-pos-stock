# 97 — Checkpoint de Preview, R2 e autenticação

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: MobFlow PDV. Somente verificações e ajustes em branch de migração.

## 1. Preview e capacidade de build

- Commit validado: `db7538ceb2370b6cf928ac4d53d4d27ff8d1428d`.
- Deployment Preview: `dpl_3WSQVB7RwmeGi7kq7UPBXRHeBmyW`.
- URL: https://mobflow-pos-stock-dvwfz0iza-willianx64bit.vercel.app/
- Estado observado: `READY`.
- A página inicial respondeu HTTP 200.
- `GET /api/mobflow/signup` respondeu HTTP 200 e retornou mensalidade R$ 49,90, método Pix.
- `GET /api/auth/get-session` respondeu HTTP 200 com `null`, comportamento esperado sem cookie de sessão; isso confirma a rota, não um login completo.
- O deployment e os builds foram iniciados e concluídos sem erro de rate limit. A integração não expõe um medidor exato de quota; a evidência disponível é o sucesso dos builds atuais.

## 2. Correção de testes de autenticação

O CI anterior tinha 4 falhas em 88 testes:
- Um teste de isolamento de tenant enviava Bearer token, mas o fluxo atual valida sessão Better Auth por cookie.
- Três expectativas ainda testavam o bridge legado Neon Managed Auth, que o Preview já bloqueia intencionalmente.

Ajustes somente nos testes:
- O caso de isolamento agora usa cookie Better Auth.
- O teste do bridge legado agora verifica o bloqueio fail-closed quando `MOBFLOW_AUTH_PROVIDER=neon`.

Commits:
- `bfcd8c417f423b1bd364f4fbba99d1bb8d2a2dd2`
- `db7538ceb2370b6cf928ac4d53d4d27ff8d1428d`

No commit mais recente, os checks `test` e `validate` terminaram com sucesso. Nenhuma regra de negócio ou autenticação de produção foi alterada.

## 3. Teste real de objeto no R2

Bucket privado: `mobflow-preview-files`.

Objeto sintético usado: `migration-validation/smoke-20261108-pdv-admin.txt` (72 bytes, sem dados de cliente).

Resultado pela API de gerenciamento Cloudflare:
- PUT: sucesso.
- GET: sucesso; conteúdo retornado idêntico ao enviado.
- DELETE: sucesso.
- Listagem posterior pelo prefixo: objeto ausente.

Limite da evidência: o teste valida leitura/gravação/remoção no bucket via API de gerenciamento. Não valida as credenciais S3 da Vercel nem os endpoints de upload/leitura das aplicações.

## 4. Comprovantes Pix — estado do código

O fluxo PDV em `src/routes/api/mobflow/signup.ts` já:
- exige as quatro variáveis R2 completas;
- aceita JPEG, PNG, WEBP e PDF, com limite de 5 MiB e validação da assinatura do arquivo;
- grava em `tenants/{accountId}/pix-proofs/...`;
- grava a chave em `companies.payment_proof_path` no Neon;
- remove o objeto recém-enviado se a atualização do banco falhar.

O Admin tem leitura por URL assinada temporária e validação do prefixo do tenant.

Pendente: teste ponta a ponta pelo formulário de cadastro, leitura pelo Admin e isolamento entre tenants usando as credenciais S3 instaladas nos ambientes Preview. Não declarar o fluxo completo antes desse teste.

## 5. Fotos, documentos e anexos

Fotos de produtos ainda não estão migradas:
- `ProductForm` continua usando imagem em Data URL/Base64.
- O tipo `Product` ainda guarda `photo` localmente.
- O endpoint relacional de produtos não aceita nem persiste uma chave R2 de foto.
- A tabela `public.products` não existe no banco `mobflow_auth_import_rehearsal` consultado nesta execução.

Inventário anterior da origem Supabase PDV:
- zero objetos no bucket de comprovantes;
- zero fotos em produtos e zero logos no snapshot consultado;
- 32 campos `document` em registros de baixa/transferência são metadados JSON de operação, não arquivos binários/Base64/URLs. Devem ser preservados como dados operacionais, não enviados artificialmente ao R2.

A implementação de fotos R2 deve aguardar a tabela relacional e o fluxo de escrita de catálogo estarem prontos. Não substituir silenciosamente Data URL por uma URL quebrada.

## 6. Banco Neon de ensaio especificado

Consulta somente de leitura no projeto `proud-star-34734307`, branch `br-wild-night-bds1bdfk`, database `mobflow_auth_import_rehearsal`:

- `companies`: 0 linhas.
- `app_state`: 0 linhas.
- Better Auth: 1 `user`, 1 `account`, 1 `session`.
- Tabelas relacionais operacionais como `products` não estão presentes.

A tabela `admin_billing_settings` contém R$ 49,90 / Pix. O Admin Supabase de origem também contém R$ 49,90 / Pix, e o endpoint público Preview do PDV retornou R$ 49,90. A divergência de R$ 69,90 registrada no checkpoint 96 não foi reproduzida nesta consulta. Como a conexão Neon da Vercel é segredo e não pode ser lida pelo conector, o vínculo exato entre o runtime e este database não foi inspecionado diretamente.

Conclusão: o database especificado ainda não contém a cópia dos dados operacionais do PDV. O sucesso do endpoint de cobrança não comprova a migração de empresas, perfis, produtos, vendas ou estoque.

## 7. Dependências Supabase que permanecem

O PDV ainda mantém caminhos de fallback Supabase em telas/fluxos de autenticação e administração:
- `src/components/LoginScreen.tsx`
- `src/routes/configuracoes.tsx`
- `src/routes/gerencia.tsx`
- `src/routes/recuperar-senha.tsx`

Esses caminhos não devem ser removidos antes de provar a equivalência Better Auth/Neon e o rollback. O bundle atual ainda inclui pacotes Supabase; isso é dívida de portabilidade conhecida, não evidência de que o Preview tenha voltado a usar o Supabase como banco principal.

## 8. Próximos passos

1. Confirmar qual conexão de dados cada Preview usa sem revelar segredos; expor apenas identificadores não sensíveis de ambiente/database em diagnóstico protegido, se necessário.
2. Aplicar/validar o schema operacional no database unificado e preparar backfill real, preservando IDs e tenant.
3. Implementar foto R2 ligada ao produto por chave, mantendo compatibilidade com imagens legadas.
4. Executar teste ponta a ponta de comprovante Pix PDV → R2 → leitura Admin.
5. Mapear e migrar qualquer arquivo binário real remanescente; preservar os 32 documentos JSON no backfill.
6. Completar rollback/replay e os testes autenticados antes de habilitar flags ou cutover.

Nenhuma alteração em `main`, Production, ColetaFlow ou Supabase de produção. Nenhum dado de origem foi removido ou movido.
