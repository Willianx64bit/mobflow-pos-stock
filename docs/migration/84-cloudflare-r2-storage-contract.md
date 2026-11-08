# MobFlow PDV — contrato técnico de armazenamento Cloudflare R2

Status: contrato técnico em execução no Preview. Bucket privado `mobflow-preview-files` e token R2 restrito ao bucket foram provisionados em 2026-11-08. As quatro variáveis R2 estão configuradas como secrets/valores de servidor somente na branch `migration/neon-preparation` dos projetos Vercel PDV e Admin. Nenhum objeto de teste foi enviado; nenhuma migração de arquivos existentes foi iniciada.

## 1. Objetivo e fronteira

Esta frente migra somente os objetos binários do MobFlow PDV para Cloudflare R2. O banco Neon continua guardando metadados, vínculo com empresa/registro, estado do upload e a chave do objeto. A migração de objetos não altera o modelo relacional, não aplica migrations Neon e não habilita APIs de domínio.

Escopo inicial:
- Fotos de produtos.
- Comprovantes Pix enviados no cadastro/fluxo de pagamento.
- Logos da empresa.
- Documentos e anexos operacionais.

Fora do escopo desta etapa:
- MobFlow Admin: somente auditoria de leitura/compatibilidade quando necessária; nenhuma alteração.
- ColetaFlow.
- Arquivos de produção, credenciais ou buckets Supabase existentes sem inventário e autorização separados.

## 2. Modelo de metadados

O Neon guarda, no mínimo:
- `tenant_id` e identificador do registro proprietário.
- `object_key` (chave interna R2, nunca URL pública).
- `purpose` / categoria do arquivo.
- MIME validado, tamanho em bytes e checksum SHA-256.
- Estado: `pending`, `uploaded`, `verified`, `failed`, `deleted`.
- Criado por, criado em, atualizado em e versão do objeto.
- Referência de migração/origem quando o arquivo vier de outro storage.

Não persistir URL assinada como referência permanente. O objeto é localizado pela chave e a API emite URL assinada curta quando autorizado.

## 3. Organização das chaves

Formato recomendado:
`tenants/{tenant_id}/{purpose}/{yyyy}/{mm}/{object_uuid}.{ext}`

Categorias permitidas: `product-photos`, `pix-proofs`, `company-logos`, `documents`, `attachments`.

- UUID aleatório no nome; nunca usar nome de cliente, CNPJ, e-mail ou nome original no caminho.
- Extensão derivada do MIME validado, não confiada do nome enviado.
- Nome original, se necessário para download, fica apenas em metadado sanitizado.
- Chaves não são fornecidas livremente pelo cliente; a API constrói e valida tenant e categoria.

## 4. Segurança de upload e download

- Bucket privado; bloquear acesso público e listagem pública.
- Nenhuma credencial R2 no navegador/app.
- Upload passa por endpoint autenticado que valida sessão, empresa, permissão e finalidade; emitir URL pré-assinada de uso único/curta duração ou intermediar o upload conforme limite técnico.
- Limitar tamanho por finalidade; limites finais serão definidos antes da implementação.
- Validar MIME permitido e assinatura/magic bytes no servidor; rejeitar extensão/MIME divergentes, arquivos vazios e tipos executáveis.
- Calcular checksum no servidor ou verificar checksum enviado contra o objeto recebido.
- Download passa por autorização do registro e do tenant antes de emitir URL assinada de curta duração.
- Comprovantes Pix e documentos são privados; não usar URLs públicas permanentes.
- Rate limit, logs sem conteúdo sensível e respostas que não revelem existência de arquivo de outro tenant.

## 5. Ciclo de vida e consistência

1. Criar intenção de upload no Neon como `pending`, com tenant, finalidade, ator e chave aleatória.
2. Autorizar e receber o objeto no R2.
3. Verificar tamanho, MIME e checksum.
4. Marcar metadado como `verified` em transação Neon.
5. Se a confirmação no Neon falhar, manter o objeto em estado órfão rastreável para limpeza posterior; não apagar imediatamente por falha transitória.
6. Exclusão lógica primeiro; limpeza física assíncrona após período de segurança e confirmação de que não há vínculo ativo.

Uploads repetidos usam chave de idempotência estável e não devem duplicar metadados. Atualização de foto deve preservar a versão anterior até a nova estar verificada.

## 6. Migração dos arquivos existentes

- Inventariar buckets, objetos, metadados e consumidores antes de copiar.
- Preservar referências atuais durante período de compatibilidade; resolver leitura antiga e nova por provider/versão, sem misturar chaves.
- Copiar em lotes com manifesto: origem, destino, tenant, tamanho, MIME, checksum e resultado.
- Verificar checksum e vínculo após cópia.
- Não excluir objeto de origem até reconciliação completa, janela de rollback e autorização explícita.
- Em falha, retomar pelo manifesto sem duplicar destino.
- O bucket `mobflow-payment-proofs` foi anteriormente reportado vazio na auditoria, mas isso deve ser rechecado antes de qualquer decisão de descarte.
- O fluxo atual de cadastro ainda usa Supabase Storage para comprovantes e grava a referência em `companies.payment_proof_path`; manter compatibilidade até contrato e consumidor serem auditados.

## 7. APIs previstas (contrato, não implementação)

- `POST /api/mobflow/storage/upload-intents`: cria intenção autenticada, valida finalidade/tamanho e retorna instruções temporárias de upload.
- `POST /api/mobflow/storage/{uploadId}/complete`: verifica objeto e confirma metadado.
- `GET /api/mobflow/storage/{fileId}/download`: autoriza tenant/registro e retorna URL assinada curta.
- `DELETE /api/mobflow/storage/{fileId}`: exclusão lógica autorizada; limpeza física assíncrona.
- Endpoint administrativo de migração em lote não faz parte da API pública do PDV e exigirá autorização operacional separada.

Esses endpoints não devem aceitar `tenant_id`, bucket, chave arbitrária ou URL de destino fornecidos como autoridade pelo cliente. Tenant/ator vêm da sessão autenticada.

## 8. Testes obrigatórios

- Usuário de outra empresa não cria intenção, não conclui upload e não baixa arquivo.
- Usuário sem permissão não acessa finalidade restrita.
- MIME falso, extensão divergente, tamanho acima do limite, checksum divergente e arquivo vazio são rejeitados.
- URL expirada/reutilizada e chave de outro tenant são rejeitadas.
- Retry de intenção/conclusão não duplica metadado.
- Falha entre upload R2 e confirmação Neon deixa item recuperável, sem perda silenciosa.
- Atualização de foto preserva versão anterior até verificação da nova.
- Exclusão lógica e limpeza física respeitam retenção e vínculos.
- Migração em lote retoma após falha e reconcilia contagem, bytes e checksum.
- Nenhum segredo R2 aparece em bundle, logs ou respostas.

## 9. Ordem de implementação

1. [Concluído no Preview] Confirmar conta/bucket privado `mobflow-preview-files` e token S3 restrito a esse bucket com leitura e gravação.
2. [Parcial] Cliente server-side R2 e variáveis de ambiente configurados no PDV; upload de comprovante Pix do cadastro já grava no R2 quando as quatro variáveis estão presentes, mantendo fallback legado apenas para ambientes sem R2.
3. [Em andamento] Admin Preview recebeu cliente R2 server-side e endpoint autenticado que gera URL assinada de leitura por 60 segundos, validando o prefixo `tenants/{account_id}/pix-proofs/`.
4. [Pendente] Validar visualização de comprovantes no Admin Preview com arquivo sintético pequeno; isso gera uma operação de escrita/leitura dentro da franquia gratuita disponível.
5. [Pendente] Definir metadados/intenção, limites por finalidade, allowlist MIME e retenção antes de criar APIs genéricas de upload/download/delete.
6. [Pendente] Fotos de produto: a API de catálogo já usa a coluna `photo_object_key`, mas rejeita explicitamente payloads com `photo`/`photoObjectKey` até existir o fluxo seguro de upload e leitura; não há endpoint genérico R2 pronto.
7. [Pendente] Logo da empresa: a tela ainda lê imagem como Data URL/base64; o store remove `settings.companyLogo` do estado compartilhado para evitar payloads grandes. Não está integrada ao R2 e precisa de referência por chave + URL curta autorizada.
8. [Pendente] Documentos/anexos: sem fluxo R2 integrado identificado nesta auditoria.
9. [Pendente] Preparar migração de objetos existentes somente após inventário, manifesto, checksum, rollback e autorização expressa.

## 10. Estado do provisionamento Preview

- Dois tokens ativos verificados via Cloudflare API: PDV com `Workers R2 Storage Bucket Item Read` + `Workers R2 Storage Bucket Item Write`; Admin com `Workers R2 Storage Bucket Item Read` somente. Ambos limitados ao recurso do bucket `mobflow-preview-files`.
- Token S3: Access Key ID deriva do ID do token e Secret Access Key é o SHA-256 do valor do token, conforme documentação oficial Cloudflare.
- Vercel Preview variables confirmadas nos projetos `mobflow-pos-stock` e `mobflow-will`, exclusivamente para `migration/neon-preparation`; o Admin usa a credencial read-only e o PDV usa a credencial read/write.
- `last_used_on` do token ainda está nulo na verificação; não houve upload/consulta S3 até este checkpoint.
- Não foi criado plano adicional nem iniciado upload em massa. O bucket Standard vazio não gera custo de armazenamento enquanto não houver objetos; o uso deve permanecer dentro das franquias gratuitas enquanto não ultrapassar 10 GB-mês, 1 milhão de operações Classe A e 10 milhões Classe B.

## 11. Critérios de aceite

- Bucket privado e nenhuma credencial exposta ao cliente.
- Isolamento por tenant verificado por testes negativos.
- Arquivos sempre autorizados pelo registro proprietário.
- Metadados Neon e objetos R2 reconciliáveis.
- Migração reversível sem apagar origem.
- Nenhuma alteração no MobFlow Admin, ColetaFlow ou produção durante a fase de planejamento.
