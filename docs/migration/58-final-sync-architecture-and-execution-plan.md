# MobFlow PDV — arquitetura final de sincronização Neon

Data: 2026-11-08  
Branch de trabalho: `migration/neon-preparation`

## Escopo e limites

Este documento trata exclusivamente do **MobFlow PDV**. O ColetaFlow é outro produto, está fora deste trabalho e não deve ser alterado. O MobFlow Admin também permanece fora do escopo de implementação: não alterar seu repositório, banco, configurações ou produção. Quando necessário, suas integrações podem ser apenas auditadas em modo de leitura para identificar contratos que o PDV precisa preservar.

Todo desenvolvimento desta preparação ocorre na branch `migration/neon-preparation`. Não aplicar migrações, importações, exclusões ou alterações em produção. Não alterar Supabase/Vercel Production.

## Objetivo final

O PDV deve operar com **sincronização automática por eventos incrementais no Neon**, sem baixar repetidamente o estado completo da empresa. O botão **Sincronizar** continua disponível como ação manual de recuperação/atualização. A solução deve preservar o funcionamento offline, impedir duplicidades e manter os dados locais seguros.

O termo realtime aqui significa que alterações novas são propagadas automaticamente aos demais dispositivos por uma camada de eventos e entrega incremental. O Neon Realtime beta não será dependência obrigatória nem mecanismo primário.

## Arquitetura desejada

1. Uma operação de negócio é persistida no Neon e seu evento correspondente é gravado na mesma transação. Não pode existir operação confirmada sem evento, nem evento publicado para operação revertida.
2. Os eventos são isolados por empresa/conta, ordenados por sequência e consultados com cursor e paginação.
3. Cada dispositivo mantém um cursor persistente, separado por conta/empresa. O cursor só avança depois que todos os eventos da página foram validados e aplicados corretamente.
4. O consumidor aplica apenas alterações novas, em ordem, sem substituir alterações locais ainda não enviadas.
5. Operações offline ficam em fila persistente no dispositivo. Ao recuperar conexão, a fila é enviada com identificadores idempotentes; repetição, timeout ou reenvio não pode duplicar venda, baixa ou movimento.
6. A API entrega páginas incrementais. Notificações podem avisar que existem eventos, mas a recuperação confiável sempre consulta a API com cursor.
7. O botão **Sincronizar** executa recuperação incremental, processa páginas pendentes, envia a fila local e informa sucesso/pendências/erro sem apagar dados locais.
8. Deve existir recuperação para dispositivo que ficou muito tempo offline, perdeu notificações ou precisa reconstruir estado. Se necessário, usar snapshot controlado/versionado como recuperação excepcional, nunca como polling permanente.
9. A consulta completa de `app_state` a cada 3 segundos deixa de ser o mecanismo principal e será removida somente após validação completa do consumidor incremental. O estado monolítico `app_state` também deixa gradualmente de ser a fonte principal de sincronização; não fazer uma substituição abrupta sem migração e compatibilidade.

## Estruturas já preparadas / evidências atuais

- Migração de fundação: `neon/migrations/0005_incremental_sync_foundation.sql`. Define eventos por tenant, contador/sequência, idempotência e função de append. O comentário atual indica que ela ainda não foi aplicada; confirmar antes de qualquer aplicação.
- Endpoint: `GET /api/mobflow/sync/events`. Autentica a sessão, deriva a conta/empresa da identidade autenticada, pagina eventos ordenados e devolve cursor, próximo cursor, high-water mark e indicador `hasMore`. Limite padrão 100 e máximo 250.
- Testes: `src/test/mobflow-sync-events-api.test.ts` cobre paginação, ordenação, cursor inválido, limite máximo, página vazia e rollback.
- Produtores de eventos já foram adicionados em várias operações e projeções, incluindo produtos, estoque/preço, promoções, conferências, ajustes, perdas, transferências, validade, recebimentos/decisões, contatos, fornecedores, caixa e configurações. Cada produtor precisa ser conferido para garantir payload/versionamento, escopo de tenant, transação e idempotência.
- Recebimento Better Auth: `src/routes/api/mobflow/receiving.ts` aplica decisões/estoque e registra eventos na mesma transação, com proteção contra liberação duplicada; testes em `src/test/better-auth-receiving.test.ts`.
- Estado atual do cliente: `src/lib/store.ts` mantém fila de persistência e chama `GET /api/mobflow/state` em reconciliação de 3 segundos. A auditoria de 2026-11-08 não encontrou consumidor de `/api/mobflow/sync/events` nem uso de `nextCursor` no cliente. Portanto, o endpoint existe, mas o cliente ainda não consome o fluxo incremental.
- `src/routes/api/mobflow/state.ts` ainda oferece leitura/escrita do snapshot completo e emite eventos em algumas categorias. A migração para operações/eventos nativos precisa ser gradual.

## O que ainda NÃO está pronto

- Contrato formal/versionado de cada tipo de evento e payload.
- Auditoria completa de todos os produtores, incluindo cobertura de operações e consistência de transação.
- Redutor/projetor puro no cliente para aplicar cada tipo de evento.
- Persistência segura de cursor por conta e integração com a fila offline existente.
- Tratamento de eventos desconhecidos, versões incompatíveis, lacunas, duplicados e recuperação.
- Integração do botão **Sincronizar** com envio da fila local + consumo incremental.
- Testes ponta a ponta em Preview com dois dispositivos e cenários offline/concorrência.
- Só depois desses testes: desligar o polling de snapshot de 3 segundos e reduzir a dependência de `app_state`.

## Sequência de execução obrigatória

### Etapa 1 — Auditoria e contrato
- Mapear todos os tipos de evento, payloads, produtores e operações correspondentes.
- Definir envelope versionado: identificador, tenant, sequência, tipo, versão do payload, entidade, chave da entidade, timestamp e dados mínimos necessários.
- Confirmar idempotência, ordenação, autorização e transação.
- Não alterar a sincronização ativa nesta etapa.

### Etapa 2 — Consumidor incremental isolado
- Criar redutores/projetores puros e testes unitários por tipo de evento.
- Tratar eventos repetidos sem efeito duplicado; rejeitar/encaminhar versões desconhecidas sem avançar cursor indevidamente.
- Garantir que alterações locais não enviadas não sejam sobrescritas.
- Não ligar ainda o consumidor ao fluxo principal do usuário.

### Etapa 3 — Cursor e fila offline
- Persistir cursor por conta/empresa e versão do contrato.
- Integrar envio idempotente da fila offline com confirmação do servidor.
- Cursor só avança após aplicação bem-sucedida da página inteira.
- Implementar retomada, paginação, backoff e recuperação.

### Etapa 4 — Botão Sincronizar e ativação em Preview
- O botão envia operações locais pendentes e busca eventos incrementais até alcançar o high-water mark.
- Mostrar estado compreensível: sincronizado, enviando, recebendo, pendente ou erro.
- Validar em Preview com duas sessões/dispositivos.
- Manter reconciliação de snapshot como fallback enquanto os testes são executados.

### Etapa 5 — Validação e retirada gradual do polling
Testar pelo menos:
- Dois dispositivos realizando venda e baixa de estoque simultaneamente.
- Alteração de preço/produto refletida no outro dispositivo.
- Operação offline, encerramento/reabertura do app e reconexão.
- Reenvio do mesmo evento/operação sem duplicar efeitos.
- Eventos atrasados, páginas múltiplas e retomada de cursor.
- Recebimento/conferência, ajuste, transferência, perda e operações de caixa.
- Falha no meio da página: cursor não avança parcialmente.
- Falha no envio local: dados permanecem na fila.
- Recuperação após longo período offline.
- Isolamento entre empresas.
Só depois de aprovação desses testes em Preview remover o polling completo de 3 segundos. Retirar gradualmente o uso de `app_state` como sincronização principal, preservando eventual snapshot de recuperação controlada.

### Etapa 6 — Migração de produção (futura, com autorização explícita)
Somente após Preview validado: plano de backup, migração de dados, reconciliação de contagens, janela de corte, monitoramento e rollback. Não executar nesta preparação.

## Regras de segurança e compatibilidade

- Nunca confiar em tenant/empresa informado pelo cliente; derivar da sessão autenticada.
- Nunca avançar cursor antes da aplicação integral da página.
- Nunca apagar fila local em timeout, falha ou resposta ambígua.
- Usar idempotency keys estáveis por operação.
- Não publicar dados sensíveis em eventos desnecessários.
- Preservar isolamento multiempresa e autorização por função.
- Não remover fallback Supabase antes de provar o caminho Neon no Preview.
- Não alterar fluxo de login principal nem a senha separada de segurança da Gerência durante o trabalho de sincronização.

## Relação com migração de arquivos para R2

A migração de fotos de produtos, comprovantes Pix, logos e documentos para Cloudflare R2 é uma trilha separada. Antes de substituir o bucket de comprovantes usado pelo cadastro do PDV, mapear o consumidor/download no Admin apenas por auditoria de leitura. O Admin não será modificado neste escopo. Preservar arquivos privados, autorização, validação de MIME/tamanho, caminhos isolados por empresa e limpeza quando a gravação de metadados no Neon falhar.

## Próximo trabalho técnico

1. Continuar leitura integral de `src/lib/store.ts`, especialmente mutações locais, fila `persistQueue`, worker, guards e reconciliação.
2. Extrair inventário de todos os produtores e payloads de eventos em `state.ts` e demais rotas.
3. Fechar contrato versionado e matriz evento → redutor → entidade/tela.
4. Implementar/testar o consumidor incremental isolado antes de ativá-lo.
5. Continuar auditoria de uso Supabase para identificar a origem real dos ~20 GB; os dados já observados (app_state ~19,6 KB, bucket de comprovantes vazio no momento da consulta e tabelas públicas pequenas) não explicam esse volume. Não atribuir a causa sem métricas de Usage/Analytics.

## Estado de segurança desta documentação

Este documento registra a arquitetura e o plano. Não aplica migrações, não altera dados, não muda produção e não remove o polling atual. O polling permanece deliberadamente até a conclusão dos testes de Preview.
