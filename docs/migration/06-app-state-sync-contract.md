# MobFlow PDV — contrato atual de estado, sincronização e autenticação

Data: 06/11/2026  
Escopo: somente leitura do código na branch `migration/neon-preparation`. Nenhum código foi alterado.

## Arquivos e versões inspecionados

- `src/lib/store.ts` — blob SHA `45b081b27382113bc97d24fba5cafb6c679056a0`.
- `src/lib/supabase.ts` — blob SHA `14831ced7319dfa49c2ff0099e17a46990800dc6`.
- `src/components/LoginScreen.tsx` — blob SHA `960b7208e93a02de096850328d106d626c953834`.
- `package.json` — blob SHA `7d2440397760875a67a2f20d3894d768a2a4c44e`.

## Estado operacional e persistência

- O estado operacional principal é um único snapshot JSONB em `public.app_state.state`, por empresa (`owner_id`).
- O snapshot contém coleções como produtos, vendas, movimentos de estoque, caixa, conferências, recebimentos, ajustes, baixas, transferências, promoções, fornecedores e configurações.
- A primeira gravação usa UPSERT por `owner_id`; gravações seguintes usam UPDATE condicional por `owner_id` + `updated_at` esperado (CAS).
- Se o CAS não atualiza linha, o cliente lê a versão remota, mescla com o estado local e tenta novamente. Há até três tentativas por ciclo e retry posterior com atraso em caso de falha.
- A fila de persistência agrupa mudanças locais e não deve descartar silenciosamente falhas de gravação.
- A reconciliação protege a versão-base contra leituras/eventos atrasados e não deve substituir uma versão remota mais nova por snapshot antigo.
- O merge é sensível a domínio: mescla coleções por ID e trata movimentos de estoque como deltas para evitar aplicar duas vezes a mesma movimentação recebida localmente e via Realtime.
- O estado local é persistido em `localStorage`; a hidratação evita misturar dados locais de empresas diferentes.

## Contrato atual de Realtime

- Canal Supabase: `mobflow-state:<accountId>`.
- Evento: somente `UPDATE` na tabela `public.app_state`.
- Filtro: `owner_id=eq.<accountId>`.
- Ao receber evento, o cliente valida a versão temporal, mescla com o estado local, notifica a UI e agenda reconciliação após 180 ms.
- Ao assinar, o cliente faz leitura de reconciliação.
- Fallback de polling permanece ativo a cada 3 segundos.
- Também há reconciliação em foco, retorno de visibilidade e reconexão de rede.
- O payload Realtime atual transporta o snapshot `state` da linha, não um conjunto de eventos de domínio. Isso precisa ser considerado ao avaliar volume, latência e custo da futura assinatura Neon.
- O novo backend precisa garantir o escopo de empresa no servidor; o cliente não pode determinar livremente o tenant da consulta selada.

## Operações transacionais que não podem virar gravações comuns

O código chama dois RPCs distintos:
- `accept_receiving(p_receiving_id)`: aceita/libera recebimento de forma autoritativa; após sucesso o cliente hidrata o snapshot do banco para não somar o estoque duas vezes.
- `finalize_receiving_decisions(p_receiving_id, p_decisions)`: envia decisões atuais ao banco; o cliente espera a fila de persistência antes da chamada, usa timeout de 20 segundos e não faz gravação local automática após o RPC para evitar sobrescrever estoque recém-confirmado.

Essas operações precisam continuar transacionais, com bloqueio/validação/idempotência e retorno inequívoco. Não substituí-las por UPDATE genérico de JSONB.

## Sessão e armazenamento de autenticação

- O cliente usa `@supabase/supabase-js ^2.75.0`.
- A chave usada no navegador é publishable, não service-role.
- Sessão é persistida no navegador com chave `mobflow-auth-session`.
- Com “lembrar login” ativo, o armazenamento é `localStorage`; desativado, `sessionStorage`. O código remove a sessão dos dois armazenamentos no logout.
- `detectSessionInUrl` está desativado; `autoRefreshToken` e `persistSession` estão ativos.
- O fluxo de login chama a Edge Function `mobflow-login`, depois aplica a sessão retornada com `auth.setSession`.
- Cadastro chama `mobflow-signup`; recuperação chama `mobflow-manager-password-recovery`; reautenticação chama `mobflow-reauth-manager`; gestão de usuários chama `mobflow-users`.
- O login também consulta `mobflow-public-billing` em outro projeto Supabase (`xsitutjpdshmidzpgxpx`). Essa dependência externa deve continuar intacta e fora do escopo desta migração.

## Stack que condiciona a integração

- React 19.2.
- TanStack Start / React Router.
- TanStack Query 5.
- Vite 8.
- Supabase JS 2.75.
- Vitest; os testes automatizados identificados até agora cobrem apenas roteamento básico, não o contrato de sincronização acima.
- O app não declara atualmente dependências `@neon/realtime*` ou `@neon/neon-js`; qualquer adoção deve ser prototipada e versionada apenas na branch isolada.

## Critérios de equivalência para a migração

1. Mesmo usuário/empresa continua hidratando apenas seu próprio snapshot.
2. CAS preserva a versão mais nova e merge não duplica movimentos de estoque.
3. Realtime atualiza a UI entre dispositivos sem refresh.
4. Assinatura não atravessa tenants; testar adulteração de parâmetros e tentativa de leitura cruzada.
5. Evento atrasado, duplicado ou perdido não regride o estado; reconciliação e fallback continuam funcionando.
6. Offline, foco/visibilidade, reconexão e renovação da sealed query são cobertos por testes.
7. Recebimentos continuam transacionais e idempotentes.
8. Opção “lembrar login” mantém comportamento equivalente, incluindo refresh e logout.
9. Dependência de cobrança externa, SMTP e comprovantes não quebra durante a migração.

## Próximos passos da Etapa 3

- Completar matriz de endpoints e dependências de cada Edge Function.
- Confirmar estratégia de identidade/JWT sem alterar a chave de produção.
- Desenhar API server-side e autorização tenant-aware para CAS, RPCs e sealed queries.
- Preparar testes de caracterização antes de qualquer alteração de código.
- Encerrar Etapa 3 com plano de migração revisado e aprovação explícita antes da Etapa 4.

## Limites mantidos

Nenhuma alteração de código, banco, Auth, JWT, Storage, Realtime, Data API, Function, deploy ou dados. Nenhuma ação no MobFlow Admin ou ColetaFlow.
