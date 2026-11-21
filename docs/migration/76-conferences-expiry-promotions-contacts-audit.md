# Doc 76 — Auditoria de conferências gerais, validade, promoções, contatos e fornecedores

**Branch:** `migration/neon-preparation`  
**Método:** leitura de `src/lib/store.ts`; nenhuma alteração de código funcional ou banco.

## 1. Conferências gerais

A estrutura `Conference` armazena ID, nome, data, status, contagens por produto, códigos desconhecidos, indicação de ajuste, vínculo opcional a recebimento e mapas de validade/quantidades extras.

Fluxo:
- `newConference` cria conferência aberta.
- `patchConference` atualiza qualquer conferência por callback no cliente.
- `countCode` procura código/barcode e soma quantidade; códigos desconhecidos são adicionados sem duplicar o mesmo texto.
- `setCount` e `setExpiry` alteram contagem/validade.
- `finishConference(id, adjust)` finaliza e, se solicitado, substitui o estoque dos produtos contados pelo valor contado; nesse caso cria movimentação de balanço com saldo anterior/novo e delta.

**Risco:** conferência geral e aplicação do balanço são operações locais no snapshot. Dois dispositivos podem partir do mesmo saldo e sobrescrever mudanças. O servidor deve validar o conjunto contado e aplicar o balanço com lock dos produtos, gerando documento, ledger e eventos na mesma transação. Não confundir conferência sem ajuste com alteração de estoque.

## 2. Validades manuais

`ManualExpiry` guarda ID, produto, nome em snapshot, quantidade, data de validade e unidade.

- `addManualExpiry` exige produto, data e quantidade positiva; calcula quantidades já alocadas para o produto e impede alocar mais que o estoque atual.
- `updateManualExpiry` recalcula alocação excluindo o próprio registro e valida limite.
- `deleteManualExpiry` remove o registro local.
- Validades capturadas na conferência de recebimento ficam também no recebimento/conferência; registros de notas manuais antigas são convertidos para `manualExpiries` durante `normalizeState`, e o registro manual legado é removido de `receiving`.

**Requisito:** preservar validade e lote/quantidade como informação operacional. A validação de saldo alocado precisa ocorrer no servidor com concorrência controlada. A migração deve identificar origem (recebimento/conferência ou cadastro manual) e não duplicar validade importada do legado. Não foi identificado comando Neon dedicado nesta auditoria.

## 3. Promoções

`Promotion` contém produto, nome e preço original em snapshot, preço promocional, início e fim.

- `savePromotion` exige produto existente, preço promocional finito e não negativo, datas preenchidas e fim posterior ao início.
- Ao salvar, captura nome e preço original atuais do produto.
- `deletePromotion` remove pelo ID.
- O preço efetivo é usado pelo fluxo de venda conforme vigência.

Hoje é estado local/snapshot; não foi identificada rota Neon específica. A migração deve preservar o snapshot do preço original e as datas, além de definir no servidor como resolver promoções concorrentes/overlap para o mesmo produto. Não alterar regra de prioridade sem confirmar o comportamento atual da tela e dos testes.

## 4. Contatos comerciais

`BusinessContact` suporta Cliente e Fornecedor, nome, documento, telefone e endereço (CEP, rua, número, bairro, cidade, estado).

- `saveContact` cria ID local ou atualiza registro existente.
- `deleteContact` remove localmente.
- Não foi identificada operação Neon dedicada nesta revisão.

**Requisito:** manter tipo, documento e endereço; escopo sempre por empresa; evitar duplicação em retry e colisão de nomes. Não usar nome como chave primária. A regra de unicidade de CPF/CNPJ deve ser definida sem bloquear cadastros legítimos sem documento.

## 5. Lista auxiliar de fornecedores

`Supplier` contém apenas nome e CNPJ opcional. Ao criar recebimento, o cliente procura fornecedor por nome em lowercase; se encontra, atualiza nome e CNPJ (se informado), senão adiciona.

Isso é uma lista auxiliar separada de `BusinessContact`, embora ambos representem fornecedores. Antes de normalizar o schema, decidir se a lista deve ser unificada com contatos, mantendo compatibilidade e evitando duplicar fornecedores já cadastrados. Não descartar silenciosamente registros sem correspondência segura.

## 6. Configurações da empresa e logo

`AppSettings` contém nome, CNPJ, telefone, endereço, chave Pix/tipo e logo. `normalizeState` remove `companyLogo` do estado compartilhado porque uma imagem base64 de vários MB fazia gravações cloud expirarem.

Implicações:
- Dados textuais de configuração continuam no snapshot.
- Logo não deve ser armazenada como base64 no JSON operacional.
- A arquitetura aprovada prevê Cloudflare R2 para logos/documentos e metadados/referências no Neon.
- A migração da logo deve preservar acesso e permissões; não assumir que os logos antigos ainda existem no snapshot depois da normalização.

## 7. Matriz de situação

| Domínio | Implementação observada | Neon dedicado observado |
|---|---|---|
| Conferência geral | Estado local + snapshot | Não |
| Balanço ao finalizar conferência | Atualização local + ledger no snapshot | Não |
| Validades manuais | Estado local + snapshot | Não |
| Validades do recebimento | Dentro de conferência/recebimento | Não separado |
| Promoções | Estado local + snapshot | Não |
| Contatos | Estado local + snapshot | Não |
| Fornecedores auxiliares | Estado local + snapshot | Não |
| Configurações textuais | Snapshot | Não identificado nesta auditoria |
| Logo da empresa | Removida do JSON compartilhado | R2 é destino arquitetural planejado |

## 8. Sequência de migração recomendada

1. Definir entidades e chaves tenant-scoped para contatos/fornecedores, promoções, validades, conferências e itens.
2. Resolver a sobreposição entre `BusinessContact` e `Supplier` sem perda de dados.
3. Separar conferência (contagem) de comando de balanço (efeito no estoque).
4. Criar comandos transacionais idempotentes para balanço e operações de validade que alterem alocação.
5. Migrar promoções com snapshots e datas preservados.
6. Mover logos para R2 em etapa separada, com referência e autorização.
7. Testar sincronização multi-dispositivo, offline/retry, isolamento entre empresas e migração de dados legados.
8. Manter Supabase fallback até o fluxo Neon Preview passar por validação ponta a ponta.

## 9. Limites

Este documento é uma auditoria do código observado. Não afirma que as operações já foram migradas, não executa SQL, não modifica produção, MobFlow Admin ou ColetaFlow.
