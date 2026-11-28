# 71 — Revisão inicial do DDL operacional 0006

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: revisão estática do arquivo SQL proposto; **não executado e não aplicado**.

## 1. Artefato criado

Arquivo: `neon/migrations/0006_operational_relational_foundation_DRAFT.sql`

Commit: `95fa248640de5be2cd30181bf502aac4c89ac358`

O rascunho é aditivo e propõe:
- catálogo relacional: `products`, `product_barcodes`;
- caixa: `cash_sessions`, `cash_movements`;
- vendas: `sales`, `sale_items`, `sale_payments`, `receivable_payments`;
- livro-razão auditável: `stock_movements`;
- chaves compostas por empresa/tenant, índices, idempotência e RLS.

Não altera `app_state`, autenticação, endpoints, interface ou dados existentes. Não substitui o snapshot neste estágio.

## 2. Decisões de compatibilidade incorporadas

1. IDs de entidades operacionais permanecem `text`, pois o estado atual do frontend usa IDs string. O tenant continua UUID.
2. Itens de venda guardam snapshots de nome/código/unidade/preço/custo; o histórico não depende do cadastro atual.
3. `stock_movements` não tem FK obrigatória para produto: exclusão de produto não apaga auditoria.
4. Ledger distingue `live`, `legacy_real` e `legacy_reconstructed`, com origem legada, versão do algoritmo e hash opcionais.
5. `operation_id + line_key` permite linhas repetidas do mesmo produto sem colidir.
6. Pagamentos de fiado ficam separados dos pagamentos iniciais da venda.
7. Restrição parcial impede duas sessões abertas para o mesmo operador dentro do tenant, refletindo o comportamento observado no código.
8. A tabela de pagamentos aceita linhas múltiplas estruturalmente, mas isso **não ativa pagamento dividido na interface** nem muda a regra atual de uma forma por venda.

## 3. Bloqueios antes de qualquer aplicação

O arquivo é um primeiro rascunho para revisão, não uma migration aprovada. Antes de executar, verificar:

- Existência, privilégios e ownership do papel `mobflow_api` no branch Neon alvo; a migration 0005 já pressupõe esse papel, mas o DDL 0006 não deve ser aplicado sem validar a cadeia completa.
- Se o runner que aplica migrations tem permissões para criar tabelas, índices, políticas e conceder privilégios.
- Se o schema real do Neon já contém nomes conflitantes ou migrations adicionais além da baseline conhecida.
- Se `profiles.id` representa de fato o ID canônico do tenant em todos os usuários; o backend deve sempre derivar tenant da sessão.
- Consistência tenant/operador: as FKs simples para `profiles(id)` não garantem sozinhas que o operador pertence ao tenant da linha. Cada comando deve validar `profiles.account_id = tenant_id`; uma revisão futura pode adicionar FKs compostas após confirmar a modelagem de perfis.
- Se os IDs atuais de produto, venda, sessão, pagamento e movimento podem ser preservados sem conversão.
- Regras de códigos e códigos de barras: o rascunho não força unicidade de `products.code`, pois código interno e barcode não devem ser presumidos equivalentes.
- Precisão decimal e regras de arredondamento usadas pelo app, inclusive quantidade kg em milésimos e valores monetários.
- Valores reais de `operation_type`, `payment_method`, `unit` e status encontrados nos dados e telas antes de fechar checks.
- Se o fechamento do caixa atual permite algum estado legado parcial que precise ser importado sem violar o check proposto.

## 4. Pontos técnicos para a próxima revisão

### Segurança e RLS
- O rascunho habilita RLS e cria política tenant-scoped para cada tabela, usando contexto transacional `app.account_id`.
- RLS não substitui filtros explícitos por tenant nas queries.
- Os comandos devem validar usuário ativo, papel/permissão e vínculo com a empresa antes de gravar.
- O uso de FKs simples de operador exige validação explícita de tenant no servidor; não confiar em IDs enviados pelo navegador.
- Rever grants mínimos por tabela e por operação; o rascunho concede CRUD ao papel de API para permitir evolução, mas a aplicação deve expor somente comandos autorizados.

### Transações
- Checkout deve gravar venda, itens, pagamento inicial, atualização de estoque, ledger e eventos no mesmo commit.
- Pagamento posterior de fiado deve bloquear a venda, validar saldo restante e inserir pagamento com idempotência.
- Sangria/reforço deve bloquear e validar sessão aberta.
- Fechamento deve bloquear a sessão, calcular valores a partir de vendas/pagamentos/movimentos canônicos e registrar o fechamento uma única vez.
- Nenhum endpoint deve aceitar `tenant_id` como autoridade do cliente.

### Histórico
- Não importar `legacy_reconstructed` como se fossem registros contábeis exatos.
- Antes do backfill, gerar relatório sem escrita para colisões, IDs repetidos, linhas agregadas e snapshots incompletos.
- O endpoint da tela de histórico deve manter filtros, período civil local inclusivo, busca, ordenação e detalhes definidos no documento 66.
- Eventos incrementais são transporte; não substituem o ledger consultável.

## 5. O que não foi feito

- Nenhuma migration foi executada em Neon.
- Nenhuma tabela foi criada em banco algum.
- Nenhum dado foi importado, atualizado ou apagado.
- Nenhum endpoint, tela ou regra comercial foi alterado.
- Supabase, Vercel Production, MobFlow Admin e ColetaFlow não foram tocados.

## 6. Próximo passo seguro

Fazer revisão cruzada do DDL contra todas as migrations já existentes e os tipos completos do estado atual; corrigir o rascunho antes de criar testes de aplicação em branch Neon isolado. Só depois de validação estática e aprovação explícita, executar no banco de teste — nunca em produção por inferência.
