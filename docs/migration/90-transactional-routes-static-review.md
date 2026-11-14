# Doc90 — Revisão estática das rotas transacionais e correções

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Status: correções estáticas aplicadas; testes automatizados/DB ainda não executados.

## Correções feitas nesta revisão

### Venda — `POST /api/mobflow/sales`

- Replays agora conferem também nome e documento do cliente.
- Desconto percentual acima de 100 é rejeitado antes de consultar/gravar dados.
- Venda Fiado foi bloqueada explicitamente: o schema atual ainda não tem cadastro relacional de clientes nem comando de recebimento vinculado ao caixa. Aceitar Fiado sem esses vínculos produziria contas a receber incompletas.
- Adicionado `pg_advisory_xact_lock` por tenant + chave de idempotência para serializar retries simultâneos com a mesma chave. Sem isso, duas requisições que consultassem antes do primeiro commit poderiam terminar em conflito de unicidade em vez de retornar a venda original.
- O retry ainda exige mesmo ID, caixa, método, cliente, itens, desconto e valor recebido.

### Caixa — `POST /api/mobflow/cash`

- Replay de reforço/sangria confere o operador original; outro usuário da mesma empresa não recebe o resultado de operação alheia.
- Replay do fechamento também confere o operador responsável.
- O UPDATE de fechamento agora verifica `rowCount = 1`; se a sessão não puder ser fechada exatamente uma vez, a transação é revertida.
- Adicionado lock advisory por tenant + chave de idempotência para reforço/sangria concorrentes.
- O caixa continua serializando venda, movimentação e fechamento pela linha da sessão, evitando fechamento no meio de uma venda ou sangria.

### Estoque — `POST /api/mobflow/stock`

- Transferência foi bloqueada com `transfer_destination_required`: a implementação anterior registrava somente uma saída local, sem estoque de destino. Não deve ser apresentada como transferência concluída.
- Ajuste por saldo final não aceita repetir o mesmo produto no payload, evitando somar dois valores absolutos acidentalmente.
- Adicionado lock advisory por tenant + ID da operação para serializar retries concorrentes.
- O comando mantém locks ordenados por ID de produto, atualização condicional de saldo, ledger e eventos na mesma transação.

### Testes

- Fixture de replay de venda corrigida para refletir os campos de desconto, cliente e pagamento consultados pela rota.
- Fixture de replay de estoque agora inclui saldo anterior, motivo e chave determinística exigidos pela verificação.
- Testes novos: Fiado bloqueado até haver domínio relacional completo; desconto percentual acima de 100 rejeitado; transferência sem destino rejeitada.

## Validação disponível neste momento

- Revisão estática dos três handlers e dos testes feita.
- O status de commit disponível no GitHub mostra apenas Vercel como `failure`, com destino indicando `build-rate-limit`.
- Não foi obtido resultado de execução do workflow GitHub Actions para o commit mais recente; por isso Vitest, TypeScript e build **não podem ser declarados aprovados**.
- O ambiente Neon isolado ainda não foi usado para uma execução HTTP real destas rotas. Os testes atuais são mocks unitários, não comprovam RLS, constraints, bloqueios ou concorrência real.

## Bloqueios para validar de verdade

1. Conseguir uma execução CI de Vitest + TypeScript + build e corrigir o que ela apontar.
2. Aplicar a 0006 somente na branch isolada aprovada para ensaio e validar constraints/DDL.
3. Executar testes de integração usando `mobflow_api` e contexto tenant real sintético.
4. Fazer dois clientes simultâneos para a mesma chave e para o mesmo produto, confirmando um único efeito e replay da resposta original.
5. Simular timeout depois do commit e retry com a mesma chave.
6. Implementar transferência com origem e destino, e Fiado com cliente/recebimentos, antes de habilitar esses fluxos.
7. Conectar telas somente após esses critérios passarem.

## Segurança / escopo

Nenhuma tela foi conectada. Nenhuma migração foi aplicada nesta revisão. Nenhum dado real foi importado. Nenhuma configuração de produção foi alterada. MobFlow Admin e ColetaFlow permanecem intocados.

## Validação executada em sandbox independente (2026-11-08)

Para contornar a indisponibilidade de builds do Vercel por `build-rate-limit`, a branch foi clonada em sandbox Node 24 separado, sem publicar deployment.

- Instalação: `npm install --no-audit --no-fund` concluída. O repositório não contém `package-lock.json`, então `npm ci` não se aplica.
- Testes direcionados: **5 arquivos / 26 testes aprovados** (vendas, caixa, estoque, catálogo e sync).
- Suíte completa: **13 arquivos / 72 testes aprovados**.
- Build: `npm run build` concluído com sucesso (client, SSR e worker Cloudflare).
- TypeScript: `npx tsc --noEmit` continua falhando por diversos erros de tipagem no repositório. Foram identificados também erros estritos em handlers novos (body nullable, acesso a propriedades indexadas e rotas ainda não registradas no tipo gerado), além de erros preexistentes em autenticação, telas e estado. O build Vite não substitui essa verificação; a limpeza de tipos continua pendente.

## Inspeção read-only da branch Neon isolada

Alvo exato: projeto `proud-star-34734307`, branch `br-square-waterfall-bdi7kysd`, banco `mobflow_pdv_test`, role de inspeção `mobflow_pdv_test_owner`.

- As tabelas relacionais usadas pelos comandos existem: products, cash_sessions, cash_movements, sales, sale_items, sale_payments, stock_movements e mobflow_sync_events.
- Colunas consultadas pelas rotas foram encontradas com tipos compatíveis com os IDs/textos e valores numéricos esperados.
- RLS está habilitado nas tabelas operacionais consultadas; policies de tenant estão vinculadas ao role `mobflow_api`.
- Teste de leitura com `SET LOCAL ROLE mobflow_api` e contexto transacional: tenant C enxerga 1 produto, 1 caixa, 1 venda e 1 movimento de estoque; ao trocar o contexto para tenant A, a mesma consulta retorna 0 para todas essas tabelas. Isso confirma o isolamento básico de leitura para esse par sintético.
- A inspeção foi somente leitura. Nenhuma linha foi criada, atualizada ou removida; nenhum SQL de migração foi aplicado nesta etapa.

## O que ainda não está comprovado

- Concorrência real de duas requisições HTTP nas rotas.
- Retry depois de resposta perdida após commit, contra Neon real.
- Testes de escrita com `mobflow_api`, incluindo evento, ledger e rollback conjunto.
- Isolamento de escrita e autorização por operador em operações reais.
- TypeScript estrito limpo em todo o repositório e nos novos handlers.
- Transferência com destino e fluxo Fiado/recebíveis.

**Decisão:** manter as rotas sem conexão com telas. Os testes unitários e o build estão aprovados, mas a etapa de integração com banco e concorrência ainda precisa ser concluída antes de habilitar uso no PDV.
