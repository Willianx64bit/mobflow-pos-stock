# MobFlow — plano para sincronizar estoque com segurança

## Objetivo e limites

Willian e Silvio no PDV e Conferente nas baixas devem enxergar o mesmo saldo, sem atualizar a página manualmente. Cada operação precisa ser confirmada e descontada uma única vez, mesmo quando duas pessoas atuam simultaneamente.

Este documento é apenas planejamento. Não altera o aplicativo, o banco, os saldos nem a versão publicada. Qualquer execução posterior depende de autorização. Preservar as demais telas, opções, permissões e regras existentes.

## O que o código atual já faz

- `src/lib/store.ts`, `startRealtime()` (320–367): recebe atualizações e já consulta o banco a cada **3 segundos** como recuperação.
- `refreshFromCloud()` (277–317): incorpora dados recebidos e avisa as telas; ignora consultas enquanto existe gravação em andamento.
- `persistState()` (370–463): evita sobrescrever uma versão alterada por outra sessão, tenta conciliar conflitos e já avisa as telas nessa conciliação.
- `mergeConcurrentState()` (100–156): reúne movimentações por identificador e usa suas quantidades para recompor o saldo.
- `checkout()` (599–627) e `applyStockWriteoff()`: alteram o estado local e retornam o registro sem aguardar confirmação de gravação no banco. `set()` (515–520) inicia essa gravação em segundo plano.

**Consequência:** não basta adicionar um temporizador ou um aviso às telas, pois ambos já existem. O diagnóstico anterior sobre ausência de aviso não deve ser tratado como verdade para esta versão. Ainda é necessário verificar o que efetivamente está publicado e reproduzir a falha.

## 1. Confirmar a versão e reproduzir sem risco

- Identificar qual versão cada usuário está acessando e comparar o código da Lovable com a branch conectada e a publicação no Vercel, somente se houver acesso verificável a elas.
- Conferir se os três usuários pertencem à mesma empresa e consultam o mesmo estoque.
- Preparar ambiente de teste isolado, sem movimentar o Sal 1kg real ou qualquer saldo de produção.
- Registrar, nesse ambiente, identificador da operação, versão recebida, momento da gravação, erros de rede e saldo exibido em cada sessão, sem registrar senhas ou tokens.
- Distinguir três situações: gravação pendente, atualização recebida mas não exibida, e saldo calculado incorretamente.

## 2. Tornar a atualização das telas previsível

Seguir a ideia do desenho: consultar o saldo compartilhado em intervalo curto, **sem recarregar a página inteira** e sem limpar carrinho ou formulários.

- Manter inicialmente o tempo real para atualização rápida e a consulta de recuperação a cada 3 segundos, que já existe.
- Unificar o tratamento dos dados vindos do tempo real, da consulta periódica e das respostas de gravação: validar empresa/versão, atualizar estado e armazenamento local e avisar todas as telas.
- Não permitir consultas sobrepostas. Se uma leitura for adiada por uma gravação, realizar nova leitura assim que ela terminar, em vez de depender indefinidamente do próximo intervalo.
- Reconsultar ao recuperar a conexão ou voltar à aba. Encerrar consultas da empresa anterior ao sair ou trocar de conta.
- Exibir um estado discreto: **Atualizado**, **Salvando**, **Reconectando** ou **Não foi possível confirmar**. Não mostrar saldo antigo como se fosse recém-confirmado.

O objetivo é recuperar atualizações em cerca de 3–5 segundos com a aba ativa, conexão normal e serviço disponível; não é uma garantia durante queda de rede, lentidão do serviço ou suspensão da aba pelo navegador.

**Retirar o tempo real fica como alternativa testada, não como primeiro passo.** Se ele continuar trazendo problemas ou não trouxer benefício, usar apenas consultas periódicas. Isso simplifica a entrega das atualizações, mas sozinho não resolve concorrência na gravação.

## 3. Confirmar cada venda e baixa de verdade

- O botão de finalizar deve acompanhar a confirmação efetiva da operação, não apenas esperar um tempo fixo.
- Gerar um identificador estável por operação. Uma repetição após falha de rede deve reutilizar esse identificador para não descontar novamente.
- Confirmar sucesso e liberar o comprovante definitivo somente quando o banco confirmar a operação correspondente. Confirmar Pix recebido continua sendo uma ação separada da confirmação de gravação da venda.
- Em falha ou resultado incerto, preservar os dados e consultar o identificador antes de reenviar. Evitar tanto perda da operação quanto desconto duplicado.
- Não confundir “a fila de gravação terminou” com “esta operação foi salva”: a confirmação precisa corresponder à operação.

## 4. Garantir o desconto simultâneo no banco

Esta etapa é separada das atualizações visuais e exigiria autorização específica para mudanças no banco.

- Consolidar venda/baixa, movimentação e alteração de saldo em uma transação: tudo é confirmado junto ou nada é aplicado.
- Aplicar a quantidade sobre o saldo atual no banco, sem enviar um saldo absoluto calculado a partir de uma tela possivelmente desatualizada.
- Impedir repetição pelo identificador da operação e gerar uma versão crescente no banco, sem depender do relógio de cada aparelho.
- Validar empresa, usuário e regras de estoque já existentes antes da operação; não inventar novas restrições.
- Planejar a compatibilidade dos demais caminhos que alteram estoque — recebimento, transferência, ajuste, balanço, conferência e importação — para que uma gravação antiga do estado completo não sobrescreva o novo saldo.
- Não recalcular saldos históricos nem reaplicar movimentações antigas automaticamente. A transição deve preservar os saldos existentes e ser validada em ambiente separado.

## 5. Testes de aceitação com três sessões

Usar três sessões realmente separadas e autenticadas no ambiente de teste, não três abas compartilhando a mesma sessão.

| Teste | Resultado necessário |
|---|---|
| Saldo 100; Willian vende 1 e Conferente baixa 1 simultaneamente | 98 nas três sessões; duas operações distintas |
| Saldo 100; Willian, Silvio e Conferente retiram 1 simultaneamente | 97 nas três sessões; três operações distintas |
| Repetir a mesma operação após resposta perdida | Um único desconto e um único registro |
| Evento repetido ou antigo chega depois de um novo | Não duplicar o desconto nem retroceder o saldo confirmado |
| Tempo real desconectado, consulta periódica disponível | Saldo converge sem F5 e sem perder o carrinho |
| Rede cai durante a confirmação e depois retorna | Resolver a operação pelo identificador; não apresentar sucesso falso |
| Trocar de empresa ou sair da conta | Não receber nem aplicar dados da empresa anterior |

Também testar cadastros recentes, duas operações da mesma quantidade, muitas operações seguidas, gravações lentas e todos os caminhos existentes de alteração de estoque. Comparar o saldo confirmado no banco com PDV, gerência e histórico.

## 6. Ordem segura de execução futura

1. Diagnóstico e comparação das versões, sem mudanças de produção.
2. Testes isolados que reproduzam a falha.
3. Correção limitada da atualização das telas e da confirmação das operações.
4. Se necessário, mudança transacional de estoque, com compatibilidade e testes próprios antes de ativar.
5. Revisão dos resultados e autorização separada para publicar.

Não substituir o banco por uma cópia antiga nem ajustar saldos para esconder falhas. Uma eventual reversão deve preservar as operações efetuadas após a atualização.

## Detalhes técnicos a validar antes de implementar

Foco inicial: `src/lib/store.ts` (`refreshFromCloud`, `startRealtime`, `persistState`, `mergeConcurrentState`, `set`, `checkout`, `applyStockWriteoff`), `src/routes/index.tsx` e `src/routes/baixa-produtos.tsx` (`finalize`).

Verificar especialmente a relação entre versão remota e base de conciliação durante respostas fora de ordem, o uso de datas geradas no navegador como versão, os caminhos sem base de conciliação e a distinção entre operações locais pendentes e operações já confirmadas. São riscos a testar, não causas comprovadas desta ocorrência.

**Critério final:** todas as quantidades são descontadas exatamente uma vez e os três usuários convergem para o saldo confirmado sem atualizar a página, preservando as demais funções do MobFlow.