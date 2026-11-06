# 20 — Auditoria de RPCs, privilégios e isolamento (produção, somente leitura)

Data da verificação: 2026-11-06  
Projeto Supabase consultado: `ezkwubdpblqkdfampopa`  
Escopo: catálogo SQL e definições de funções em produção. Nenhuma escrita, DDL ou alteração de configuração foi executada.

## 1. Confirmações de RLS

As sete tabelas públicas de aplicação consultadas estão com RLS habilitado:
- `account_allowlist`
- `app_state`
- `companies`
- `manager_password_recovery_tokens`
- `manager_security`
- `manager_security_by_account`
- `profiles`

Nenhuma dessas sete tabelas está com FORCE ROW LEVEL SECURITY habilitado. Isso deve ser considerado no desenho de roles e na execução de rotinas SECURITY DEFINER.

## 2. Políticas efetivamente encontradas

A consulta atual a `pg_policies` retornou quatro políticas em produção:
- `app_state`: SELECT, INSERT e UPDATE para `authenticated`, todas vinculadas a `private.current_account_id()`.
- `profiles`: SELECT para o próprio usuário ou para gerente consultando perfis do mesmo `account_id`.

Não foram retornadas políticas para as outras cinco tabelas públicas, nem política DELETE para `app_state`. Isto é um resultado do catálogo no momento da consulta; não presumir que grants ou rotinas privilegiadas ofereçam autorização segura por si só.

**Diferença importante para a documentação anterior:** RLS habilitado em uma tabela não significa que existam políticas para ela. A matriz de migração deve refletir separadamente RLS ligado, FORCE RLS e políticas existentes.

## 3. Funções SECURITY DEFINER e autorização

Foram encontradas as seguintes funções de aplicação:
- `public.mobflow_save_state(uuid, timestamptz, jsonb)`
- `public.accept_receiving(text)`
- `public.finalize_receiving_decisions(text, jsonb)`
- `private.current_account_id()`
- `private.current_account_role()`
- `public.enforce_mobflow_account_allowlist()`

As três RPCs operacionais e os dois helpers privados usam SECURITY DEFINER e `search_path = ''`. As RPCs operacionais têm EXECUTE para `authenticated`; nenhuma delas tem EXECUTE para `anon`. Os helpers privados também têm EXECUTE para `authenticated`, mas não para `anon`. A função de trigger de allowlist e a função event-trigger não são executáveis por usuários autenticados.

### 3.1 `mobflow_save_state`

A função:
- exige sessão autenticada;
- compara `private.current_account_id()` com o `p_owner_id` informado;
- valida que o estado seja JSON object;
- usa bloqueio de linha (`FOR UPDATE`) e timestamp esperado para controle otimista;
- devolve conflito com o estado atual quando o timestamp diverge;
- garante timestamp crescente no UPDATE.

Esta é uma fronteira de autorização e concorrência central. A implementação equivalente no destino precisa derivar tenant da identidade validada, preservar CAS/lock e impedir que o cliente escolha livremente o tenant.

### 3.2 Helpers de identidade/tenant

`private.current_account_id()` resolve `profiles.account_id` pelo `auth.uid()` e faz fallback para o próprio `auth.uid()` quando não encontra account_id. `private.current_account_role()` resolve role e faz fallback para `pdv`.

O fallback é comportamento legado relevante: não pode ser removido nem replicado cegamente. A migração deve definir explicitamente o comportamento para perfil ausente, conta sem associação, usuário recém-criado e usuário bloqueado.

### 3.3 Recebimento: `accept_receiving`

A função:
- deriva tenant via `private.current_account_id()`;
- bloqueia a linha do `app_state` do tenant com `FOR UPDATE`;
- só processa recebimento em estado `analisando`, com `decisionCompleted=true` e `stockReleased=false`;
- exige decisões válidas para todas as linhas;
- soma quantidades aceitas ao estoque e marca o recebimento como aceito/liberado.

Pontos a validar antes de portar:
- a função não faz a mesma checagem explícita de `auth.uid() IS NOT NULL` e comparação de tenant do `mobflow_save_state`; ela depende da identidade resolvida pelo helper e dos privilégios de execução;
- confirmar o contrato de negócio quando existem linhas devolvidas e aceitas;
- preservar bloqueio, idempotência e atomicidade entre atualização de estoque e status;
- verificar se a aplicação chama esta RPC diretamente ou se existe camada intermediária que adiciona autorização.

### 3.4 Recebimento: `finalize_receiving_decisions`

A função:
- rejeita ausência de tenant, decisões nulas ou payload que não seja objeto;
- bloqueia o estado do tenant;
- exige recebimento `analisando` e ainda não liberado;
- valida decisão `aceitar` ou `devolver` para cada linha;
- impede aceitar produto que não exista no catálogo;
- atualiza estoque das linhas aceitas e persiste decisões/status/liberação.

Ponto de atenção: o código atual grava status `aceito` e `stockReleased=true` após processar decisões que podem incluir devolução. Antes de qualquer reimplementação, comparar com UI, relatórios e semântica operacional esperada; não “corrigir” durante a migração sem testes e decisão de produto.

## 4. Triggers catalogados

A consulta encontrou triggers de aplicação:
- `enforce_mobflow_account_allowlist` associado ao fluxo de Auth/allowlist.
- Demais triggers retornados pertencem ao schema `storage` do Supabase e são infraestrutura do serviço; não copiar como triggers de aplicação para Neon.

A migração deve recriar apenas triggers próprios do MobFlow e substituir explicitamente qualquer dependência de Auth/Storage que seja específica do Supabase.

## 5. Requisitos de paridade no destino

1. Separar autenticação, identidade de usuário, tenant e papel; nunca confiar em `account_id` enviado pelo navegador.
2. Criar testes negativos para tentativa de leitura/escrita entre empresas, usuário sem perfil, perfil inativo, papel sem permissão e sessão expirada.
3. Preservar as garantias transacionais das RPCs de recebimento e do salvamento CAS.
4. Garantir que endpoints equivalentes não aceitem chamadas anônimas.
5. Fazer matriz explícita de EXECUTE por função e de grants por tabela; não copiar grants amplos do Supabase.
6. Testar operações concorrentes de estoque/recebimento e reconexão antes de remover qualquer polling ou fallback.
7. Comparar o comportamento de recebimento com a interface e relatórios antes de decidir se o status `aceito` representa corretamente cenários mistos.

## 6. Limitações

Esta auditoria é uma fotografia do catálogo e das definições de funções consultadas. Ela não certifica todas as chamadas do frontend, todos os caminhos das Edge Functions, nem todos os efeitos de triggers externos. A revisão completa das chamadas RPC e dos fluxos de estoque ainda é necessária.

Nenhuma alteração foi feita em produção, Neon, código funcional, autenticação, Realtime, sincronização ou deploy.
