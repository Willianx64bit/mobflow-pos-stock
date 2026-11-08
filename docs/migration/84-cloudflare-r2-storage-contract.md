# MobFlow PDV — contrato técnico de armazenamento Cloudflare R2

Status: planejamento técnico; **nenhum bucket, credencial, upload ou migração foi criado/aplicado**.

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

1. Confirmar conta/bucket R2 e políticas de acesso sem alterar storage atual.
2. Definir limites por finalidade, MIME allowlist, retenção e autorização por tipo de arquivo.
3. Implementar cliente server-side R2 e configuração por ambiente (Preview primeiro).
4. Implementar metadados/intenção e APIs de upload/download/delete.
5. Testar isoladamente no Preview com objetos sintéticos.
6. Integrar fotos de produto e validar leitura/edição.
7. Integrar comprovantes Pix após auditoria read-only do consumidor no Admin e do fluxo de cadastro.
8. Integrar logos/documentos/anexos.
9. Só então preparar migração de objetos existentes com manifesto e rollback.

## 10. Critérios de aceite

- Bucket privado e nenhuma credencial exposta ao cliente.
- Isolamento por tenant verificado por testes negativos.
- Arquivos sempre autorizados pelo registro proprietário.
- Metadados Neon e objetos R2 reconciliáveis.
- Migração reversível sem apagar origem.
- Nenhuma alteração no MobFlow Admin, ColetaFlow ou produção durante a fase de planejamento.
