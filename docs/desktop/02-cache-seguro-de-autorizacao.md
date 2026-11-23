# MobFlow Windows — cache seguro de autorização (fundação offline)

## Implementado

- O Electron expõe uma ponte restrita via preload para gravar, consultar e limpar o contexto mínimo de autorização.
- O processo principal aceita chamadas somente de frames cuja origem seja o domínio oficial do PDV.
- O contexto é criptografado com `safeStorage` do Electron/Windows antes de ser gravado em `app.getPath("userData")`.
- O registro contém somente empresa (`accountId`), função, usuário, permissões e data de validação.
- Não são persistidos senha, cookie Better Auth, token bearer ou segredo de sessão.
- A validade local é limitada a 7 dias; registros inválidos, expirados ou com data futura são rejeitados.
- O cache é atualizado somente depois de uma resposta válida do endpoint autenticado `/api/mobflow/session-context`.
- O evento explícito `mobflow-user-logout` solicita a limpeza do cache.

## Limite intencional desta entrega

Esta é a fundação para recuperação offline de identidade, não a ativação do login offline. O frontend ainda não consome o registro para entrar no PDV sem rede, e nenhuma operação de venda/caixa/estoque foi liberada offline por esta mudança.

Antes de usar o cache para abrir o PDV offline, ainda é necessário:
1. Revalidar o contexto local e hidratar somente o snapshot da mesma empresa.
2. Definir como expirar/revogar acesso offline sem internet e como exigir reconexão após o prazo.
3. Bloquear operações que ainda não tenham comando transacional offline.
4. Integrar venda/caixa/estoque à outbox e garantir recuperação após encerramento abrupto.
5. Validar o fluxo em Windows real, inclusive logout, troca de usuário e expiração.

## Segurança

O cache local serve como autorização de interface em modo sem rede. Ele não substitui a autorização do servidor: toda chamada online continua exigindo Better Auth, tenant e permissões validadas no servidor.
