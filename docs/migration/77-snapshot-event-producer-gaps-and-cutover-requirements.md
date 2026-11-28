# Doc 77 — Auditoria do produtor de eventos do snapshot e lacunas de migração

**Branch:** `migration/neon-preparation`  
**Escopo:** leitura do produtor `src/routes/api/mobflow/state.ts` e comparação com o consumidor ainda inexistente no cliente. Sem alterações funcionais ou SQL aplicado.

## 1. Papel atual do endpoint

O endpoint de gravação de estado continua recebendo e persistindo o snapshot completo de `app_state`. Dentro da mesma transação, compara o estado anterior e o novo e publica eventos incrementais para algumas diferenças. Portanto, o evento hoje é uma projeção auxiliar do snapshot; ainda não é a fonte autoritativa da operação.

O endpoint usa controle de versão/conflito (`expectedUpdatedAt`) e bloqueio transacional. Em conflito retorna HTTP 409 e o estado remoto. Isso evita sobrescrita silenciosa em alguns cenários, mas não substitui comandos de negócio por operação.

## 2. Categorias atualmente publicadas

O código observado publica eventos para:
- Operações de estoque: ajustes, baixas e transferências, como projeções resumidas.
- Validades manuais: upsert/delete com produto, nome, quantidade, data e unidade.
- Contatos: apenas ID e tipo (metadados redigidos).
- Sessões de caixa: ID, status e datas de abertura/fechamento.
- Movimentos de caixa: ID, sessão, tipo, valor e data.
- Fornecedores: chave derivada do nome e nome.
- Configurações: apenas indicação de quais campos textuais mudaram.
- Estoque e preço de produtos existentes: deltas/valores calculados pela comparação do snapshot.

Os eventos são inseridos na mesma transação do snapshot, então falha na publicação pode abortar a gravação do snapshot. Isso preserva atomicidade entre snapshot e eventos gerados por esse caminho.

## 3. Lacunas e limitações identificadas

### 3.1 Ainda não existe consumidor no cliente
O cliente não aplica `GET /api/mobflow/sync/events` como fluxo principal. Sem reducer/consumer, cursor persistente e recuperação, os eventos não substituem a leitura do snapshot.

### 3.2 Eventos não são comandos idempotentes de negócio
O produtor gera UUIDs novos para evento e chave de idempotência a cada comparação. A unicidade protege cada inserção individual, mas não representa uma chave estável da intenção do usuário entre tentativas. O endpoint de snapshot depende do diff do estado e do controle de versão para evitar repetições. Isso não é suficiente para o futuro outbox offline, que precisa guardar a mesma chave por operação e reutilizá-la em retries.

### 3.3 Projeções incompletas
- Eventos de contatos não carregam nome, documento, telefone ou endereço; isso parece intencional para reduzir exposição de PII, mas significa que não são suficientes para reconstruir a entidade em outro dispositivo.
- Eventos de fornecedores comparam/publicam somente o nome. Alteração isolada de CNPJ não gera evento.
- Eventos de operações de estoque resumem campos selecionados e não substituem documentos relacionais completos nem ledger.
- Configurações publicam apenas a lista de chaves alteradas, não os valores. Não permitem hidratar a configuração sem buscar outra fonte.
- O trecho observado de preço/estoque só emite evento para produtos já existentes no estado anterior; criação e exclusão precisam ser avaliadas separadamente e não se deve presumir que esses eventos cubram o catálogo inteiro.

### 3.4 Exclusões e dados sensíveis
As projeções de contatos omitem PII, o que é uma proteção positiva. Entretanto, exclusões são emitidas como tombstones genéricos. O futuro consumidor deverá validar tenant, tipo de entidade, versão/ordem e autorização antes de aplicar delete. Não permitir que payload de evento fornecido por cliente determine livremente a tabela/tenant.

### 3.5 Duplicidade conceitual de estoque
O endpoint gera eventos de operações de estoque e também compara saldo do produto para gerar evento automático de delta. Uma única alteração de estoque pode, portanto, produzir evento manual da operação e evento automático do saldo. Isso pode ser válido se os consumidores tratarem o primeiro como documento/histórico e o segundo como projeção de saldo, mas não podem aplicar ambos como dois deltas no estoque.

## 4. Consequências para a arquitetura alvo

1. Manter snapshot como bootstrap/recovery temporário, não como mecanismo normal de comando.
2. Criar APIs transacionais por operação; cada uma grava entidade relacional, atualiza saldo/ledger e publica evento no mesmo commit.
3. Atribuir chave de idempotência estável no dispositivo antes de enviar; persistir a fila no armazenamento local durável.
4. Separar claramente eventos de documento, eventos de saldo e notificações; definir reducer idempotente para cada tipo.
5. Não incluir PII de clientes/fornecedores ou segredos Pix em eventos de transporte sem necessidade e política explícita.
6. Para dados redigidos, o consumidor deve buscar a entidade pela API autenticada ou receber projeção segura suficiente, sem assumir que o evento isolado recompõe o cadastro.
7. Alterações em fornecedores devem detectar CNPJ quando relevante; unificar fornecedor/contato requer mapeamento de IDs, não chave pelo nome.
8. Eventos de estoque de uma operação devem referenciar o mesmo `operationId` e item/linha, para impedir que o consumidor some a movimentação manual e o delta automático duas vezes.

## 5. Relação com o schema relacional draft 0006

O draft 0006 cobre catálogo, código de barras, vendas, pagamentos, caixa e ledger de estoque. Ainda não define tabelas completas para:
- recebimentos e itens/decisões;
- conferências e contagens/itens desconhecidos;
- ajustes e itens;
- baixas e itens;
- transferências e itens/destino;
- validades/lotes;
- promoções;
- contatos e fornecedores;
- configurações da empresa.

Essas entidades precisam de desenho separado antes de declarar o schema operacional completo. O draft continua NÃO APLICADO e não deve ser executado como está sem revisão de permissões, RLS, sintaxe e migração.

## 6. Testes de regressão obrigatórios

- Snapshot e eventos confirmam ou falham juntos.
- Repetição após timeout não cria evento operacional duplicado.
- Um ajuste/baixa/transferência gera um documento e movimentos correspondentes, sem duplicar delta.
- Alteração apenas do CNPJ do fornecedor é propagada corretamente.
- Contatos redigidos não expõem PII nos eventos e ainda podem ser atualizados por caminho autorizado.
- Exclusão e reentrada do mesmo ID respeitam ordem/cursor.
- Evento atrasado ou duplicado não reverte estado mais recente.
- Falha no meio da página não avança cursor.
- Recuperação por snapshot não republica registros legados como novas operações.

## 7. Segurança e limites

Auditoria estática do código da branch de preparação. Nenhum endpoint foi chamado para mutação, nenhum dado foi escrito no Neon, nenhuma migration foi aplicada e nenhuma alteração foi feita em produção, MobFlow Admin ou ColetaFlow.
