# 64 — Desenho de comandos transacionais de venda e estoque

Status: especificação de implementação; **não implementado**.  
Escopo: MobFlow PDV, branch `migration/neon-preparation`.  
Não altera o MobFlow Admin, ColetaFlow, Supabase, Neon ou Vercel.

## 1. Por que esta etapa vem antes do consumidor de eventos

A auditoria do `store.ts` confirma que `actions.checkout()` monta a venda no navegador, calcula valores, decrementa estoque e adiciona movimentos localmente; em seguida, `set()` persiste o estado agregado. O caixa e os pagamentos de fiado também são alterados no estado local. Isso não é suficiente para garantir consistência entre dois dispositivos.

O endpoint `/api/mobflow/state` faz controle otimista de versão do documento inteiro e, ao comparar snapshots, emite alguns eventos de catálogo/estoque. Ele não transforma a venda em uma operação de domínio atômica. O inventário de eventos atual também não possui categorias explícitas `sales`, `cash` ou `payments`; eventos de venda e dados sensíveis do cliente são deliberadamente omitidos do snapshot de eventos.

A migração não deve tentar resolver isso apenas adicionando um evento de venda ao fluxo atual de snapshot: venda, pagamento, baixa de estoque, movimento e evento precisam ser confirmados juntos no servidor.

## 2. Contrato proposto para registrar venda

Criar endpoint autenticado dedicado (nome sugerido: `POST /api/mobflow/sales/checkout`) com um comando explícito e versionado. O navegador envia somente a intenção da venda e uma chave de idempotência persistida localmente.

Campos mínimos do comando:
- `operationId`: UUID gerado uma vez no dispositivo e persistido na fila offline; nunca regenerado em uma tentativa.
- `cashSessionId`: caixa aberto que o operador pretende usar.
- `payment`, `received`, `customer` e `cpf`: somente os dados realmente necessários à regra de negócio; minimizar e proteger dados pessoais.
- `discount` e `discountType`.
- `items[]`: `productId` e quantidade pretendida. Não confiar em preço, custo, nome, total, lucro, saldo anterior ou saldo final enviados pelo cliente.
- Versão do contrato, para permitir evolução sem interpretar payloads antigos incorretamente.

O servidor deve derivar empresa/tenant e operador exclusivamente da sessão autenticada. Nunca aceitar `accountId`, `tenantId` ou identidade do operador como autoridade enviada pelo cliente.

## 3. Transação obrigatória no Neon

Dentro de uma única transação autenticada:

1. Validar que a chave `operationId` ainda não foi processada para aquele tenant.
2. Bloquear/validar o caixa e confirmar que está aberto e pertence ao operador conforme as regras atuais.
3. Buscar os produtos do tenant e validar existência, unidade, quantidade, preço vigente e regras de desconto.
4. Bloquear os registros de estoque em ordem determinística (por exemplo, `productId` crescente) para evitar corrida entre vendas concorrentes.
5. Validar estoque disponível conforme a regra atual do MobFlow; não inventar política de estoque negativo.
6. Calcular no servidor subtotal, desconto, total e demais valores derivados. O custo/lucro só pode ser calculado a partir da fonte confiável atual, não do cliente.
7. Gravar venda e itens, pagamentos/recebíveis, baixa de estoque e movimentos de estoque.
8. Anexar evento(s) incremental(is) com chave(s) de idempotência determinísticas derivadas de `operationId`.
9. Registrar o resultado idempotente da operação, incluindo o identificador/resultado da venda.
10. Confirmar tudo junto. Qualquer erro deve reverter todos os efeitos.

Uma repetição com a mesma chave deve devolver o resultado original sem criar segunda venda, segundo pagamento, segunda baixa ou segundo movimento. Uma chave reutilizada com conteúdo diferente deve ser rejeitada.

## 4. Dados canônicos e histórico

Antes de escrever a migration, mapear o formato completo de `Sale`, itens, pagamentos, movimentos e caixa usado pela interface e pelos relatórios. A estrutura final pode usar tabelas normalizadas no Neon, mas o adaptador deve preservar o formato esperado pelo PDV enquanto as telas forem migradas.

A venda deve manter:
- identificador estável;
- data/hora do servidor;
- operador e caixa;
- itens com quantidades/unidades;
- preço efetivamente aplicado e desconto;
- forma(s) de pagamento e valores;
- vínculo com cliente quando aplicável;
- dados históricos necessários a relatórios.

O evento de sincronização não deve transportar CPF, telefone, dados de cartão, credenciais, comprovantes ou outros dados pessoais desnecessários. O evento deve conter identificadores e projeção mínima para atualizar o dispositivo; dados completos são obtidos por endpoint autorizado, paginado e tenant-scoped.

## 5. Estoque e eventos

A baixa de estoque precisa ser uma atualização condicional/serializada no banco, não um delta calculado sobre saldo local. Cada linha da venda deve gerar movimento auditável com saldo anterior, delta e saldo resultante calculados dentro da transação.

A categoria do evento precisa ser revista: a migration `0005_incremental_sync_foundation.sql` atualmente restringe `category` a `stock`, `price`, `catalog`, `receiving`, `conference`, `promotions`, `users`, `settings` e `master_data`. Antes de produzir eventos de venda/caixa/pagamentos, decidir formalmente se:
- ampliar a enumeração/check constraint para categorias específicas; ou
- usar uma categoria genérica existente com `entity_type` bem definido.

Preferência: categorias explícitas e versionadas para venda, caixa e recebíveis, sem misturar venda com `master_data`. A mudança deve ser aditiva, coberta por migration e testes. Não aplicar a migration 0005 nem novas migrations sem validar o branch Neon de teste e autorização explícita.

## 6. Fila offline do dispositivo

A fila precisa ser persistente (IndexedDB preferencialmente, com estratégia de migração do localStorage), por tenant/conta/dispositivo. Cada comando conserva:
- operationId;
- tipo e versão;
- payload original;
- estado (pendente, enviando, confirmado, conflito ou erro recuperável);
- tentativas e última resposta segura;
- data local de criação.

Não remover item ao iniciar envio. Remover/arquivar somente após confirmação idempotente do servidor. Timeout/rede interrompida deve permitir reenvio com o mesmo operationId. A fila não deve ser sobrescrita por hidratação do snapshot nem por eventos recebidos.

A venda offline pode ser registrada localmente como pendente, mas a interface deve distinguir claramente venda local pendente de venda confirmada pelo servidor. O sistema não pode prometer consistência global de estoque enquanto o dispositivo estiver offline; definir e testar a política de venda offline/estoque negativo antes de ativar esse fluxo.

## 7. Caixa e fiado são comandos separados

Depois da venda, criar contratos específicos para:
- abrir caixa;
- lançar sangria/reforço;
- fechar caixa (o servidor calcula o valor esperado com todas as vendas confirmadas e movimentos);
- receber pagamento de fiado (operação idempotente, saldo calculado no servidor).

Fechamento não pode depender da lista local de vendas, pois ela pode estar incompleta. Pagamentos de fiado não podem ser anexados por substituição de um array no snapshot; devem ser comandos atômicos e idempotentes.

## 8. Plano de implementação e gates

1. Confirmar esquema real e tipos de vendas/caixa usados no projeto e relatórios.
2. Definir política atual de estoque insuficiente, descontos, múltiplos pagamentos e vendas offline.
3. Escrever testes de contrato e concorrência antes da rota.
4. Criar migration aditiva e rota no branch; não aplicar migration ainda.
5. Testar no Neon de validação: dois dispositivos vendendo o último item; repetição da mesma operação; timeout após commit; item inexistente; caixa fechado; pagamento inválido; falha no meio da transação.
6. Integrar o PDV mantendo o adaptador e a interface existentes.
7. Só então criar o reducer/consumidor de eventos e persistência do cursor.
8. Manter snapshot e polling como fallback até os testes completos em Preview passarem; retirar o polling de 3 segundos somente após validação de todos os fluxos.

## 9. Limites desta etapa

- Nenhum código de runtime foi alterado.
- Nenhuma migration foi aplicada.
- Nenhum dado/usuário foi importado.
- Supabase e produção permanecem intocados.
- MobFlow Admin e ColetaFlow permanecem intocados.

## 10. Pendências que precisam ser confirmadas no código antes da migration

- Schema completo e localização atual dos dados de vendas e itens (hoje no JSON `app_state`).
- Se o PDV permite estoque negativo e qual a regra exata.
- Regras de arredondamento, desconto, preço promocional e lucro.
- Se há pagamentos divididos além do tipo único atual e como `received` é usado.
- Regra de vínculo de venda ao caixa/operador e fechamento.
- Quais relatórios consomem `sales`, `cashSessions`, `cashMovements` e pagamentos de fiado.
- Estratégia de sincronização para vendas feitas offline simultaneamente em dispositivos diferentes.
