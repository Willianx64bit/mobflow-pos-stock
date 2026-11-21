# MobFlow PDV — confirmação de política efetiva do Storage

Data: 06/11/2026  
Projeto consultado: `mobflow-pos-stock` (`ezkwubdpblqkdfampopa`)  
Escopo: consultas SQL somente leitura ao catálogo PostgreSQL e leitura do código versionado. Nenhuma escrita foi executada.

## 1. Bucket confirmado em produção

Consulta à tabela `storage.buckets` para `mobflow-payment-proofs` retornou:

- `public = false` (bucket privado);
- limite de arquivo: 5.242.880 bytes (5 MiB);
- MIME permitidos: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.

Esses valores coincidem com o contrato descrito no inventário e na função de cadastro.

## 2. Políticas em storage.objects

Consulta somente leitura a `pg_policies` para `schemaname = 'storage'` e `tablename = 'objects'` retornou uma lista vazia: **nenhuma policy de linha foi encontrada para storage.objects** no catálogo consultado.

Interpretação limitada:
- o bucket é privado;
- o código versionado de `mobflow-signup` faz upload e remoção usando cliente com service-role no servidor;
- não foi encontrada política que permita acesso direto por usuário `anon` ou `authenticated` a objetos via Storage API;
- a ausência de policy não demonstra, sozinha, como o comprovante é consultado no painel externo nem se existe outro caminho privilegiado.

## 3. Dependência do painel administrativo

O arquivo versionado `supabase/functions/mobflow-admin-api/index.ts`:
- valida bearer token e compara e-mail com `MOBFLOW_ADMIN_EMAIL`;
- usa service role para consultar dados de `companies`;
- a ação observada é `list_companies`;
- a seleção de colunas não inclui `payment_proof_path`;
- não contém operação de Storage, URL assinada ou download de comprovante no código lido.

Portanto, **não foi localizado nesse endpoint o mecanismo que permite ao administrador visualizar/baixar o comprovante**. Isso permanece uma lacuna de rastreio, não prova de que a funcionalidade não exista em outro frontend/serviço.

## 4. Requisitos para destino

- manter o bucket privado;
- manter o acesso ao objeto restrito a serviço autorizado;
- criar endpoint server-side específico para consultar metadados e emitir URL assinada curta, se a visualização for necessária;
- verificar no servidor se o usuário é administrador autorizado antes de emitir link;
- nunca expor service-role no navegador;
- manter validação de MIME, tamanho, token de solicitação, path e compensação em caso de falha;
- incluir teste negativo para URL/objeto de outra empresa e para usuário sem autorização;
- mapear quem consome `payment_proof_path` antes de decidir qualquer migração de arquivos.

## 5. Evidência e limites

Evidência desta rodada:
- consulta read-only em `storage.buckets`;
- consulta read-only em `pg_policies`;
- leitura de `mobflow-signup/index.ts` e `mobflow-admin-api/index.ts` na branch `migration/neon-preparation`.

Nenhuma policy, objeto, bucket, dado, função ou configuração foi alterada. A configuração de Auth continua pendente de fonte de leitura autorizada.
