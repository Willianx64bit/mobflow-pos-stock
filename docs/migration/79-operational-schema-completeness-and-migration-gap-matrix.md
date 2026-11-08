# Doc 79 — Matriz de completude do schema operacional e lacunas de migração

**Branch:** `migration/neon-preparation`  
**Status:** planejamento e mapeamento; não é DDL aprovado.  
**Base:** docs 67, 72, 75, 76, 77, 78 e draft 0006.  
**Banco:** nenhuma alteração executada.

## 1. Objetivo

Consolidar o que o draft 0006 cobre, o que ainda falta modelar e como preservar o estado atual do MobFlow PDV sem transformar o snapshot em uma falsa fonte relacional. Esta matriz orienta o próximo desenho; não autoriza cutover.

## 2. Cobertura atual do draft 0006

| Domínio | Tabelas existentes no draft | Situação |
|---|---|---|
| Catálogo | products, product_barcodes | Parcial: foto depende de R2; revisar unicidade/códigos |
| Caixa | cash_sessions, cash_movements | Parcial: comandos e fechamento canônico faltam |
| Vendas | sales, sale_items, sale_payments | Parcial: regras do checkout e snapshots compatíveis precisam fechar |
| Fiado | receivable_payments | Parcial: histórico legado tem menos metadados |
| Histórico de estoque | stock_movements | Base estrutural; backfill e comandos ainda faltam |
| Transporte incremental | mobflow_sync_events, mobflow_sync_counters (0005) | Base estrutural; produtor/consumer e outbox durável faltam |

O draft 0006 tem nove tabelas operacionais. Não representa o domínio operacional completo.

## 3. Entidades ainda necessárias

Os nomes abaixo são propostas de trabalho, não nomes finais de tabelas. Todas as entidades persistidas devem ter tenant, IDs estáveis, timestamps e constraints tenant-scoped. Documentos e seus itens devem ser gravados atomicamente com seus efeitos no ledger e eventos.

### 3.1 Recebimentos de mercadoria

**Cabeçalho candidato:** `receivings`
- ID legado preservado, número/documento, fornecedor e snapshot do fornecedor;
- datas de emissão/recebimento, observações, status;
- referência a usuário responsável com snapshot;
- chave de idempotência da operação de liberação.

**Itens candidatos:** `receiving_items`
- produto opcional + código/nome/unidade em snapshot;
- quantidade esperada, quantidade conferida/recebida;
- preço/custo unitário se existir na origem;
- posição/ID legado estável.

**Decisões/extras:** `receiving_item_decisions` e `receiving_extra_items` (ou estrutura equivalente após validar o modelo real).
- decisão por item: aceitar, rejeitar ou pendente;
- quantidade aprovada;
- extras não previstos na nota;
- motivo e responsável.

**Invariante:** concluir conferência não libera estoque automaticamente. A decisão final de recebimento/liberação é uma operação separada, idempotente, que grava documento, saldo, ledger e evento no mesmo commit. Preservar `stockReleased` para impedir liberação duplicada.

### 3.2 Conferências

**Cabeçalho candidato:** `conferences`
- tipo/origem, status, datas, operador, notas;
- vínculo opcional com recebimento;
- política explícita para finalizar com balanço de estoque.

**Linhas/contagens candidatas:** `conference_counts`
- produto opcional, código/nome/unidade em snapshot;
- quantidade contada, quantidade esperada quando disponível;
- contagem por código desconhecido sem forçar FK de produto;
- chave de linha/contagem estável.

**Dados adicionais:** contagens extras e validades encontradas durante conferência devem ter representação própria ou JSON versionado apenas se forem dados auxiliares não consultáveis. Não usar JSON para esconder entidades que exigem filtro, integridade ou concorrência.

**Invariante:** finalizar conferência e efetivar balanço são atos distintos. Se o usuário escolhe ajustar saldo, criar comando de balanço idempotente e movimentos compensatórios no ledger; não sobrescrever histórico.

### 3.3 Ajustes de estoque

**Candidatos:** `stock_adjustments`, `stock_adjustment_items`.
- cabeçalho com tipo (`somar`/`definir`), operador, data, motivo e status;
- itens com produto, snapshot, quantidade informada, saldo anterior/posterior e delta;
- IDs legados e chave de idempotência.

**Invariante:** o servidor calcula saldo anterior/posterior sob lock da linha do produto. `definir` calcula delta contra saldo canônico no momento da execução. O cliente nunca envia saldo final como autoridade.

### 3.4 Baixas/perdas/consumo/doação

**Candidatos:** `stock_writeoffs`, `stock_writeoff_items`.
- motivo: perda, consumo ou doação;
- destino obrigatório quando doação, conforme regra atual;
- modo de custo (compra/venda/média), valor e snapshots;
- operador, documento, data, observação.

**Invariante:** preservar a regra atual de permitir ou não estoque negativo somente após decisão de negócio. Não alterar silenciosamente. Cada item gera ledger no mesmo commit. Numeração/documento deve ser alocada no servidor para evitar colisão entre dispositivos.

### 3.5 Transferências

**Candidatos:** `stock_transfers`, `stock_transfer_items`.
- destino e snapshot do destino;
- itens, quantidades, unidade, custo e valores;
- estados e datas de criação/efetivação/cancelamento;
- IDs legados e operador.

**Bloqueio de domínio:** sem confirmação das semânticas atuais de destino, cancelamento e efeito sobre o estoque, não fechar constraints nem criar comando. Se transferência for entre locais/estoques, modelar origem e destino como entidades explícitas; não tratar como baixa simples sem confirmar.

### 3.6 Validades e lotes

**Candidatos:** `product_lots` ou `manual_expiries`, conforme distinção real do app.
- produto e snapshot;
- lote/identificador, validade, quantidade alocada;
- origem (manual, recebimento ou conferência);
- status e timestamps.

**Invariante:** alocação de quantidade deve ser validada no servidor contra estoque/lote sob lock. Não fundir validades de recebimento e validades manuais antes de mapear suas regras e origens.

### 3.7 Promoções

**Candidato:** `promotions`.
- produto/escopo, nome snapshot, preço original snapshot, preço promocional;
- início/fim, ativo, criação/alteração e autor;
- regras de sobreposição e precedência após confirmação.

**Invariante:** preço efetivo do checkout é calculado no servidor com base na política aprovada e no instante da venda. Preservar snapshots da venda para que alteração posterior da promoção não mude o passado.

### 3.8 Contatos e fornecedores

**Candidatos:** `business_contacts` e/ou `suppliers`.
- contato pode ser cliente ou fornecedor;
- nome, tipo, documento, telefone, endereço e snapshots necessários;
- fornecedores auxiliares atualmente têm lista separada com nome/CNPJ.

**Bloqueio de migração:** não unir automaticamente registros pelo nome normalizado. Criar relatório de correspondência por CNPJ/documento e casos ambíguos; preservar IDs e vínculos de vendas/recebimentos. Dados sem correspondência segura permanecem separados até decisão.

### 3.9 Configurações da empresa

**Candidato:** `company_settings` ou extensão controlada do cadastro da empresa.
- nome, CNPJ, telefone, endereço;
- tipo/chave Pix e configurações operacionais;
- logo apenas como object key R2 + metadados, nunca base64 no snapshot/evento.

**Segurança:** chave Pix pode ser dado sensível operacional; não colocar segredo ou valor integral em payload de evento. Eventos devem publicar apenas versão/chaves alteradas ou invalidation, e clientes autorizados consultam endpoint protegido.

## 4. Dados que não devem virar tabelas de negócio

- **Outbox offline do dispositivo:** armazenamento local durável, com operationId, payload versionado, status, tentativas e resposta. Não é fila central que substitui transação de negócio.
- **Cursor de sincronização:** persistência local por tenant/conta e dispositivo; servidor entrega páginas ordenadas.
- **Eventos incrementais:** transporte e notificação de mudanças, não ledger nem documento de domínio.
- **Snapshot app_state:** bootstrap/compatibilidade temporária; deve perder autoridade por domínio somente após migração, comparação e aceite.

## 5. Mapa de dependências recomendado

1. **Fundação de identidade/tenant:** perfil, empresa, permissões, contexto RLS e política de retenção.
2. **Catálogo:** produtos e códigos; migração de fotos em trilha R2 separada.
3. **Caixa e vendas:** sessão, checkout, pagamentos iniciais e Fiado; comandos transacionais e testes de concorrência.
4. **Ledger:** histórico permanente, backfill idempotente e reconciliação com snapshot.
5. **Recebimentos e conferências:** documentos/itens/decisões separados da liberação de estoque.
6. **Operações de estoque:** ajustes, baixas, transferências e balanços de conferência.
7. **Validades e promoções:** regras e comandos concorrentes.
8. **Contatos/fornecedores/configurações:** deduplicação segura e proteção de PII.
9. **Sync e cutover por domínio:** outbox durável, reducer, cursor, reconciliação e desligamento gradual do snapshot.

A ordem é de dependência técnica, não uma autorização para implementar todos os domínios de uma vez.

## 6. Campos legados que exigem compatibilidade explícita

- Vendas: `hiddenFromFiado`, `paidAt`, `paid`, pagamentos antigos sem método/operador/ID individual.
- Caixa: `openedBy` e `closedBy` são textos; mapear para UUID por tenant + usuário, sem adivinhar.
- Recebimentos: manter estado de conferência, decisões, extras e `stockReleased`.
- Ajustes/baixas/transferências: preservar IDs, snapshots, motivo, modo de custo, destino e ordem.
- Conferências: preservar códigos desconhecidos e opção de efetivar balanço.
- Estoque: separar histórico real de linhas reconstruídas; nunca tratar reconstrução como fato exato.
- Contatos/fornecedores: preservar vínculos e IDs; não deduplicar apenas por nome.
- Configurações: não perder campos textuais nem tentar recuperar logo base64 que já tenha sido removida do snapshot.

Cada campo sem destino deve constar em relatório de compatibilidade, com decisão explícita de preservar, transformar ou descartar. Nenhum descarte silencioso.

## 7. Contrato comum para comandos transacionais futuros

Cada comando de escrita deve:
1. Derivar tenant e usuário da sessão validada, nunca do corpo do cliente.
2. Validar permissão específica da operação.
3. Exigir operationId/idempotency key estável criado uma vez no dispositivo.
4. Validar payload, versão e consistência de valores.
5. Bloquear linhas afetadas em ordem determinística.
6. Gravar documento/itens, atualizar projeções de saldo e inserir ledger/eventos em uma única transação.
7. Repetir mesma chave + mesmo payload retornando o resultado original; mesma chave + payload diferente retorna conflito.
8. Retornar resposta canônica para reconciliar a fila offline.
9. Preservar a pendência local quando houver timeout ou falha de rede.

## 8. Portões antes de cada domínio virar autoritativo

- [ ] Schema e constraints revisados em migration separada.
- [ ] RLS e autorização negativa testadas com dois tenants e usuários inativos.
- [ ] API transacional com idempotência implementada.
- [ ] Testes concorrentes, retry, timeout, offline/reconexão e restart aprovados.
- [ ] Backfill dry-run com contagem, colisões, órfãos e valores não mapeados.
- [ ] Leitura paralela comparada com snapshot, sem escrita dupla.
- [ ] Preview validado em dois dispositivos.
- [ ] Aprovação explícita para habilitar o domínio.
- [ ] Rollback documentado sem perda de operações já confirmadas.

## 9. Limites

Este documento é uma matriz de planejamento baseada nas auditorias estáticas. Não cria tabelas, não aplica migrations, não implementa APIs nem modifica dados. Nenhuma alteração foi feita em Supabase, Neon, Vercel Production, MobFlow Admin ou ColetaFlow.
