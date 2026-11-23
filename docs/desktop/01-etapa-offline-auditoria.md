# MobFlow Windows — Etapa 1: auditoria de base offline

**Branch:** `packaging/windows-exe-neon`  
**Escopo:** preparação do aplicativo Windows para abrir sem conexão, sem alterar o PDV web, Admin, ColetaFlow, bancos ou produção.

## Resultado da auditoria

### O que já existe
- O estado do PDV é persistido em `localStorage` por empresa, com chave `mobflow:v1:<tenantId>`.
- Há uma outbox em IndexedDB (`mobflow-incremental-sync`) com comandos de venda, caixa e estoque, UUID e chave de idempotência.
- A outbox preserva comandos em falhas de rede e só remove comandos após confirmação HTTP positiva.
- Há cursor incremental persistido em IndexedDB e endpoint autenticado `GET /api/mobflow/sync/events`.
- O fluxo incremental permanece protegido por flags de bootstrap; não está automaticamente habilitado em todos os ambientes.

### Bloqueios para uso realmente offline
- O Electron atual chama `loadURL(APP_URL)`, portanto depende do site hospedado para entregar o HTML/JS inicial.
- O bootstrap da aplicação consulta `/api/mobflow/session-context`; a sessão Better Auth também depende do servidor.
- O snapshot de empresa e o catálogo precisam ser previamente hidratados e persistidos antes da queda da internet.
- A existência da outbox não significa que todas as mutações do PDV estejam convertidas em comandos offline transacionais.
- Os comandos e endpoints transacionais precisam ser verificados por domínio antes de habilitar vendas/caixa/estoque offline.
- Uma versão local do frontend precisa ser empacotada no instalador; as rotas de servidor continuam remotas e só estarão disponíveis com rede.

## Decisão técnica desta etapa

Não ativar um falso “modo offline” apenas por detectar falta de internet. Não substituir a origem do site por arquivos locais sem preparar o build e testar o roteamento/recursos do TanStack Start. Não alterar o bootstrap de autenticação para permitir operações sem validar uma sessão previamente autorizada.

## Próximas tarefas de implementação

1. Preparar um build local do frontend para o Electron, mantendo as APIs remotas no domínio oficial.
2. Implementar tela de inicialização offline clara quando não houver conexão e sem cache local válido.
3. Persistir/validar cache local por empresa e sessão autorizada, sem misturar dados entre tenants.
4. Garantir que o aplicativo reabra no último estado local seguro; não prometer checkout offline até que o comando transacional esteja integrado.
5. Adicionar testes automatizados para abrir sem rede, reabrir após encerramento e preservar dados locais.

## Critérios de aceite da Etapa 1
- O executável abre sem internet e apresenta uma interface local, sem tela de erro do navegador.
- Se houver cache válido, carrega apenas os dados da empresa autenticada anteriormente e indica claramente que está offline.
- Se não houver cache/sessão previamente validada, informa que é necessário conectar para primeiro acesso.
- Nenhuma operação é descartada ou enviada para outra empresa.
- O PDV web e os fluxos de produção permanecem inalterados.

**Status:** auditoria concluída; implementação do shell local e cache offline ainda pendente.