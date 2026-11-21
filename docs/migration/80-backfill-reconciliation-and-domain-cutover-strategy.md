# Doc 80 — Estratégia de backfill, reconciliação e cutover por domínio

**Branch:** `migration/neon-preparation`  
**Status:** plano de execução futura; nenhum backfill realizado.  
**Referências:** docs 65, 66, 72, 74, 77, 78 e 79.

## 1. Princípio

A migração de `app_state` para tabelas relacionais deve ser incremental, auditável, idempotente e reversível durante o período de convivência. Não executar um import geral que substitua o estado atual. Cada domínio terá relatório dry-run, lote de importação, reconciliação e portão de cutover próprios.

Supabase/Neon de produção, usuários reais e dados existentes não são alvo deste plano até aprovação explícita. Os primeiros ensaios devem usar cópia sanitizada/sintética em ambiente isolado.

## 2. Fases obrigatórias

### Fase 0 — Congelar contrato e origem
- Registrar versão do formato do snapshot e versão do normalizador.
- Definir tenant de origem e destino sem aceitar tenant vindo do payload.
- Capturar contagens e hashes por coleção sem exportar PII para logs.
- Definir janela de consistência: snapshot consistente ou bloqueio breve de escrita durante extração.
- Guardar manifesto de execução com ID, horário, versão de código e algoritmo.

### Fase 1 — Dry-run sem escrita
Para cada coleção:
- contar registros, IDs vazios/repetidos, chaves inválidas e campos ausentes;
- validar enums, unidades, datas, decimais e tamanhos;
- identificar órfãos e referências cruzadas;
- detectar colisões de IDs e chaves únicas;
- gerar amostras redigidas e totais agregados;
- classificar cada registro como migrável, migrável com transformação, ambíguo ou inválido.

O dry-run não cria tabelas, não reserva IDs e não altera o snapshot. Resultado é relatório persistível e comparável entre execuções.

### Fase 2 — Manifesto determinístico
Cada lote recebe:
- `migration_run_id`;
- tenant;
- domínio/coleção;
- versão do algoritmo;
- hash da origem;
- contagem esperada;
- início/fim e estado;
- contagens importadas, ignoradas, transformadas e em erro.

Cada linha usa ID legado preservado quando possível. Para sublinhas que não têm ID, usar chave determinística baseada em tenant + entidade pai + índice estável + hash normalizado do conteúdo. Não usar Math.random nem UUID novo a cada retry.

### Fase 3 — Importação transacional em lotes
- Inserir em lotes limitados por domínio.
- Usar upsert apenas quando a semântica de atualização for comprovada; caso contrário, conflito deve virar erro auditável.
- Chaves de idempotência devem impedir duplicação em reexecução.
- Nunca usar `ON CONFLICT DO UPDATE` para sobrescrever silenciosamente registro operacional já importado.
- Cada lote deve confirmar seu manifesto e suas linhas na mesma transação, ou registrar falha sem marcar lote como concluído.
- Não misturar upload R2 e import relacional na mesma transação distribuída; usar estado de migração de mídia e reconciliação separada.

### Fase 4 — Reconciliação
Comparar origem e destino por:
- contagem de cabeçalhos e itens;
- total monetário por venda e período;
- saldo de estoque por produto;
- total de movimentos por tipo e período;
- total recebido e saldo pendente de Fiado;
- sessões abertas/fechadas e valores de caixa;
- recebimentos conferidos/liberados;
- documentos e status das operações;
- chaves e relações órfãs.

Diferenças devem ser classificadas e justificadas. Não corrigir divergência alterando silenciosamente o destino; gerar relatório de exceção e comando compensatório aprovado.

### Fase 5 — Leitura paralela em Preview
- API de leitura Neon retorna dados do domínio migrado.
- Snapshot continua disponível como comparação/rollback.
- Não habilitar escrita dupla cliente→snapshot e cliente→relacional sem um protocolo transacional/consistência formal.
- Comparar resultados em sessões de teste e cenários concorrentes.
- Nenhuma divergência crítica pode ser ignorada.

### Fase 6 — Cutover controlado
- Habilitar um domínio por flag server-side em Preview.
- Escritas passam a um único comando autoritativo.
- Leituras usam Neon para esse domínio.
- Snapshot deixa de receber alterações daquele domínio somente depois da confirmação de todas as rotas/telas dependentes.
- Monitorar erros, retries, latência, outbox pendente, divergências e RLS.
- Rollback deve preservar operações já confirmadas; não basta voltar a flag se o snapshot estiver desatualizado.

## 3. Estratégia por domínio

### 3.1 Produtos e códigos de barras
- Preservar `Product.id`, código interno, referência, nome, unidade, preço, custo, saldo, mínimo e categoria.
- Normalizar barcodes em linhas, sem assumir que `code` é barcode.
- Relatar códigos duplicados por tenant; não escolher produto vencedor automaticamente.
- Fotos são migradas separadamente para R2; gravar object key somente após upload e verificação de objeto.

### 3.2 Vendas e pagamentos
- Preservar ID da venda e IDs de item quando disponíveis.
- Para item sem ID, chave estável pela posição original e hash do conteúdo.
- Mapear rótulos de pagamento em português por tabela explícita; valores desconhecidos ficam em exceção.
- Preservar `hiddenFromFiado`, `paidAt` e estados antigos sem inferir valores.
- Pagamentos antigos de Fiado não têm método, operador nem ID próprio: gerar ID determinístico e marcar metadados ausentes, sem inventá-los.
- Validar total = subtotal - desconto conforme regra histórica; divergência não deve ser corrigida automaticamente.
- Preservar snapshots do produto/vendedor/cliente.

### 3.3 Caixa
- Resolver `openedBy`/operador por tenant + username conhecido.
- Usuários não encontrados ou duplicados ficam em exceção; não mapear por semelhança de nome.
- Preservar texto original em snapshot mesmo quando UUID for resolvido.
- Sessões abertas devem ser migradas sem simular fechamento.
- Fechamentos históricos com campos ausentes são preservados com status legado compatível, não fabricar valores esperados.

### 3.4 Ledger de estoque
- Preservar IDs legados e separar `legacy_real` de `legacy_reconstructed`.
- Deduplicar por tenant + source_legacy_id e por operation + line_key.
- Comparar saldo reconstruído com saldo atual; registrar diferenças por produto.
- Nunca transformar saldo reconstruído em movimento exato.
- Importar ledger antes de cutover de telas de histórico; não recriar registros em cada sincronização.
- Ajustes posteriores de reconciliação devem ser novos movimentos compensatórios, com motivo e referência à execução.

### 3.5 Recebimentos/conferências/operações
- Preservar estado da conferência separado do estado de liberação de estoque.
- Manter `stockReleased` e validar que uma operação liberada gere apenas um efeito no ledger.
- Preservar decisões por item, extras, códigos desconhecidos, destino de doação/transferência e modo de custo.
- IDs ausentes devem ser determinísticos e reportados como derivados.
- Não importar documentos ambíguos como concluídos.

### 3.6 Contatos e fornecedores
- Correspondência primária por documento normalizado quando válido e não ambíguo.
- Nome normalizado pode apenas sugerir candidatos; nunca mesclar sozinho.
- Preservar IDs e relações existentes.
- Duplicados e documentos conflitantes ficam em fila de revisão.

### 3.7 Promoções, validades e configurações
- Preservar datas, timezone interpretado, preço snapshot e status.
- Verificar validade de período e unidade/quantidade.
- Configurações textuais vão para Neon; segredos/chaves não entram em eventos.
- Logo e mídia vão para R2 em processo separado com checksum, MIME, tamanho, object key tenant-scoped e política de acesso.

## 4. Tabelas técnicas de controle sugeridas

Avaliar uma estrutura de controle de migração isolada, sem misturar com tabelas de negócio:
- `migration_runs`: manifesto de execução por tenant/domínio/versão;
- `migration_batches`: lotes e estado;
- `migration_exceptions`: referência ao registro e código de exceção, sem copiar PII desnecessária.

Essas tabelas não devem ser criadas até definir retenção, acesso e se o relatório ficará no banco ou em artefato protegido. Não armazenar snapshot completo ou dados pessoais em logs técnicos.

## 5. Códigos de exceção mínimos

- `duplicate_legacy_id`
- `duplicate_barcode`
- `missing_required_field`
- `unknown_enum`
- `orphan_reference`
- `ambiguous_operator`
- `unresolved_contact_match`
- `money_total_mismatch`
- `stock_balance_mismatch`
- `legacy_payment_metadata_missing`
- `reconstructed_history`
- `invalid_date_or_timezone`
- `unsupported_media`

Cada exceção precisa de severidade, domínio, ID de origem, ação recomendada e estado de resolução. Evitar valores pessoais em mensagens/logs.

## 6. Critérios de aceite

- Reexecutar o mesmo dry-run produz o mesmo resultado para a mesma origem/versão.
- Reexecutar o mesmo lote não duplica documentos, pagamentos ou movimentos.
- Mesma chave com conteúdo diferente falha em conflito.
- Contagens e totais reconciliam ou têm exceções aprovadas.
- Nenhum operador/contato é associado por aproximação.
- Ledger mantém IDs e distinção de reconstruídos.
- Timeout após commit pode ser repetido sem duplicar efeitos.
- Snapshot permanece intacto até domínio ser aceito.
- RLS bloqueia tenant diferente e usuário inativo.
- Testes offline/reconexão e duas instâncias passam antes do cutover.

## 7. Não fazer

- Não importar produção para branch de teste sem processo formal de sanitização e autorização.
- Não apagar nem truncar `app_state`.
- Não usar snapshot inteiro como fonte para reescrever tabelas a cada sincronização.
- Não gerar novos IDs a cada retry.
- Não deduplicar fornecedores/contatos só por nome.
- Não inventar método de pagamento, operador, custo, saldo anterior ou data ausente.
- Não tratar movimentos reconstruídos como registros históricos exatos.
- Não executar migration, backfill ou cutover por inferência.

## 8. Limites

Plano técnico/documental. Nenhuma migration foi executada, nenhum dado foi lido de produção para importação, nenhum registro foi escrito/alterado/apagado e nenhum projeto fora do MobFlow PDV preparation branch foi tocado.
