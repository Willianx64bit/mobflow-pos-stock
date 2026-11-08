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
