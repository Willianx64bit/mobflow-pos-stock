# Auditoria do store local e preparação do consumidor incremental

Data: 2026-11-08  
Branch: `migration/neon-preparation`

## Arquivos examinados

- `src/lib/store.ts`, linhas 1–760 (leitura parcial/contínua nesta auditoria).
- Documento de arquitetura: `docs/migration/58-final-sync-architecture-and-execution-plan.md`.

## Achados confirmados

### 1. Estado local e persistência

- O store mantém o estado operacional inteiro em memória e em `localStorage` sob `mobflow:v1`.
- A função central `set()` atualiza o estado, grava o snapshot inteiro no localStorage e chama `persistState()` quando `cloudReady`.
- `persistState()` envia o objeto completo para `PUT /api/mobflow/state`, com `expectedUpdatedAt` para controle otimista de concorrência.
- O worker serializa as gravações, limita tentativas imediatas e tenta novamente após falhas. Isso é uma fila de persistência de snapshot, não uma fila durável de operações/eventos com idempotency key por operação.
- A fila atual é mantida em memória por `persistQueue`, `persistRequested` e `persistWorker`; não há persistência independente de operações pendentes no IndexedDB/localStorage.
- `hydrateStore()` primeiro valida sessão, depois busca o snapshot completo em `GET /api/mobflow/state`, mescla contatos locais em condição específica e substitui o restante do estado pelo snapshot remoto.

### 2. Reconciliação de 3 segundos

- `startRealtime()` instala listeners de foco, visibilidade e retorno à conexão.
- Apesar do nome `startRealtime`, o mecanismo atual não é Neon Realtime: executa `setInterval` a cada 3000 ms e chama `refreshFromCloud(accountId, true)`.
- `refreshFromCloud()` faz `GET /api/mobflow/state`, compara `updatedAt`, mescla snapshots com `mergeConcurrentState()` e persiste o snapshot local.
- A mesclagem protege parcialmente alterações simultâneas, incluindo movimentos de estoque e vendas, mas depende do snapshot completo e de heurísticas de comparação.
- Portanto, não remover o timer antes de o consumidor incremental estar implementado e validado em Preview.

### 3. Operações locais

- As ações de negócio chamam `set()`, o que persiste o snapshot inteiro. Exemplos examinados: abertura/fechamento de caixa, sangria/reforço, contatos, carrinho, checkout, pagamentos de fiado, promoções, cadastro/importação/ajuste de produtos e estoque.
- O checkout cria venda, reduz estoque e cria movimentos de estoque no mesmo estado local, mas o caminho de persistência atual é o snapshot agregado.
- O estado contém muitas coleções operacionais: produtos, vendas, movimentos, caixa, conferências, recebimentos, ajustes, baixas, transferências, validade, promoções, fornecedores, contatos e configurações.
- `normalizeState()` reconstrói movimentos históricos marcados como `legacy`; esses registros históricos não devem ser republicados como novas operações durante a migração para eventos.

## Implicações para a implementação

1. Não conectar ainda o endpoint de eventos diretamente a `set()` nem substituir o estado inteiro por cada página recebida.
2. Criar um envelope versionado e um reducer/projetor puro por tipo de evento, com testes que demonstrem que o evento atualiza apenas a entidade/coleção correspondente.
3. Distinguir claramente:
   - alterações locais ainda não confirmadas pelo servidor;
   - eventos confirmados pelo servidor;
   - dados históricos/legacy;
   - eventos já aplicados (idempotência local).
4. A fila atual de snapshot não pode ser simplesmente renomeada como fila offline. É necessário criar uma fila durável de operações com IDs estáveis, estado de envio/ack e recuperação após reinício.
5. Persistir cursor por conta/empresa. Aplicar a página e persistir resultado/cursor de forma coordenada; falha no processamento não pode avançar o cursor.
6. O consumidor deve integrar-se com as regras existentes de concorrência/estoque, sem somar duas vezes a mesma baixa recebida por snapshot e evento.
7. O snapshot completo pode continuar como bootstrap inicial/recuperação controlada durante a transição. Não deve continuar sendo consultado a cada 3 segundos no estado final.
8. Antes de ativar eventos no cliente, fechar inventário de produtores e payloads; confirmar que toda operação relevante grava evento na mesma transação e que os payloads contêm dados suficientes para projetar o estado sem solicitar o snapshot inteiro.

## Próxima etapa técnica

- Continuar o inventário de eventos e payloads no endpoint `state.ts` e nas rotas específicas.
- Mapear as ações do store para comandos/IDs idempotentes e definir quais operações passam a gravar diretamente em endpoints transacionais em Neon.
- Implementar primeiro os reducers puros e testes; depois cursor/queue; por último ativação em Preview.
- Preservar a reconciliação de 3 segundos até completar testes em dois dispositivos, offline/reconexão, concorrência, duplicidade, paginação, retomada e isolamento entre empresas.

## Limites

Auditoria somente de código/documentação na branch de preparação. Nenhuma alteração em produção, banco, login, senha principal, senha de segurança da Gerência, Admin ou ColetaFlow.