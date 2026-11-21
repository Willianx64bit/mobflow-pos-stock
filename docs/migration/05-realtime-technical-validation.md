# MobFlow PDV — validação técnica do Neon Realtime

Data: 06/11/2026  
Escopo: somente MobFlow PDV. Documento de auditoria; nenhuma configuração foi alterada.

## Estado do ambiente de teste

- Projeto Neon: `mobflow-pdv-test` (`square-haze-51319178`).
- Branch: `integration-test` (`br-wandering-union-bd6vcsk6`).
- Região: `aws-us-east-2`.
- Consulta somente leitura `get_realtime`: `enabled=false`, `pending=false`.
- Realtime continua desativado. Nenhum segredo foi obtido ou rotacionado.

## O que a documentação oficial confirma

1. **Status:** Neon Realtime está em public beta (anúncio oficial de 15/10/2026). Não é GA.
2. **Escopo:** Realtime é habilitado por branch, não como uma ativação global de todo o projeto. Branches-filhas herdam a configuração do pai. Portanto, o aviso histórico sobre reinício de todos os computes ao habilitar *logical replication* não deve ser atribuído automaticamente ao Neon Realtime: são recursos/operações diferentes.
3. **Regiões anunciadas para Realtime:** `us-east-1`, `us-east-2`, `eu-central-1` e `ap-southeast-1`. A região `aws-us-east-2` do ambiente de teste está na lista.
4. **Preço durante beta:** o Realtime está gratuito durante o beta, mas compute do banco e egress continuam sujeitos à cobrança normal.
5. **Limitações declaradas:** a documentação ainda classifica o produto como beta, informa que o protocolo subjacente pode mudar e recomenda usar o SDK em vez da API bruta; não publica benchmarks e informa que RLS PostgreSQL ainda não é suportado diretamente pelo Realtime.
6. **Autorização:** a autorização ocorre no backend que recebe a requisição autenticada, deriva o tenant de fonte confiável, constrói a consulta com parâmetros vinculados e sela a consulta. Não aceitar `account_id`/tenant livremente do cliente.
7. **Sealed query:** é uma capacidade bearer criptografada, vinculada à consulta, parâmetros e banco. O TTL documentado atualmente é de 60 segundos. Deve ser enviada por HTTPS, não colocada em URL, logs ou armazenamento persistente do navegador, e renovada antes de expirar.
8. **Forma das consultas:** live queries precisam ser consultas somente leitura e determinísticas. Tabelas precisam de replica identity estável; tabelas com chave primária atendem ao requisito documentado.
9. **Cliente:** Neon documenta suporte ao React e TanStack Start. Para React Native, há orientação específica de WebSocket/origin caso a branch restrinja origens; confirmar a tecnologia efetivamente usada pelo cliente Android antes de desenhar esse detalhe.

## Impacto para o MobFlow PDV

- O modelo atual do MobFlow depende de eventos em `app_state`, merge local, proteção contra eventos fora de ordem, reconciliação, recuperação de conexão e fallback de polling de 3 segundos. Neon Realtime não elimina a necessidade de testar esses comportamentos.
- A assinatura deve representar apenas os dados da empresa autenticada. A identidade/empresa precisa ser resolvida no backend; uma sealed query não substitui a autenticação da requisição que a emite.
- O backend precisa manter e renovar a sealed query durante sessões longas e lidar com expiração, reconexão, renovação falha e revogação/alteração de permissões.
- Como RLS ainda não está disponível diretamente no Realtime beta, a segurança multiempresa da assinatura deve ser demonstrada por testes negativos de cross-tenant. O acesso CRUD via Neon Data API é uma trilha separada: ali a documentação exige JWT validado por JWKS, claims `sub` e `role=authenticated`, GRANTs e políticas RLS.
- O beta não deve ser tratado como garantia de preço futuro, estabilidade de protocolo, benchmark ou SLA para produção.

## Critérios obrigatórios antes de recomendar adoção

1. Testar em branch isolada, sem dados reais e sem habilitar Realtime sem aprovação explícita.
2. Provar duas sessões da mesma empresa recebendo atualizações sem refresh.
3. Provar que uma empresa não recebe eventos nem snapshots de outra, inclusive tentando adulterar parâmetros enviados pelo cliente.
4. Testar sealed query expirando e renovando antes/depois do TTL, reconexão WebSocket, troca de sessão e usuário bloqueado.
5. Testar merge concorrente, eventos fora de ordem, escrita offline e reconciliação/fallback atual.
6. Medir latência, impacto de compute/egress e comportamento de cold start com carga representativa.
7. Confirmar suporte de região, limites, preço pós-beta, mudanças de SDK/protocolo e maturidade antes de produção.

## Correção de escopo operacional

Uma nota anterior misturava o aviso de reinício de computes da habilitação de PostgreSQL logical replication com o Neon Realtime. A documentação atual descreve Realtime como recurso por branch. Não há evidência suficiente nesta auditoria para afirmar que habilitar Realtime reinicia todos os computes do projeto. A ação continua bloqueada nesta fase por ser uma mudança de configuração que exige autorização explícita e plano de teste, não por uma alegação de reinício global.

## Fontes oficiais consultadas

- https://neon.com/blog/neon-now-has-realtime
- https://neon.com/docs/realtime/guides/queries
- https://neon.com/docs/realtime/sdks/typescript
- https://neon.com/docs/realtime/guides/subscribing
- https://neon.com/docs/data-api/custom-authentication-providers
- https://neon.com/docs/data-api/access-control
- https://neon.com/docs/compute/functions/environment-variables

## Limites mantidos

- Nenhuma alteração em produção, no projeto/branch Neon, Auth, Data API, Realtime, banco, código ou deploy.
- Nenhum dado real foi importado.
- MobFlow Admin e ColetaFlow permanecem fora do escopo.
