# MobFlow PDV — auditoria de isolamento por empresa e persistência do app_state

Data: 06/11/2026  
Branch: `migration/neon-preparation`  
Escopo: leitura do contrato documentado e do código em `src/lib/store.ts`. Sem alterações funcionais ou de banco.

## 1. Identidade da empresa usada pelo estado

O fluxo de hidratação:

1. Carrega o estado local do navegador.
2. Obtém o usuário autenticado com `supabase.auth.getUser()`.
3. Consulta `profiles.account_id` pelo `profiles.id` do usuário.
4. Usa `profile.account_id` como identificador da empresa; se não existir, o código usa o ID do usuário como fallback.
5. Lê `app_state` por `owner_id = accountId`.
6. Registra o proprietário local em `localStorage` pela chave interna de owner e inicia Realtime/polling para aquele accountId.

Isso confirma que `profiles.id` e `profiles.account_id` têm funções diferentes. O fallback para user ID é um comportamento legado que precisa ser avaliado explicitamente na arquitetura de destino; não deve ser removido nem ampliado sem mapear contas antigas e dados existentes.

## 2. Isolamento do armazenamento local

O código mantém um owner marker local. Ao hidratar:
- dados locais são carregados;
- o código compara o owner marker com o accountId autenticado;
- se a empresa for a mesma, contatos locais que ainda não existem no snapshot remoto são preservados;
- se for outra empresa, o snapshot remoto substitui o estado operacional local;
- se não existir linha remota e a consulta não tiver erro, o estado é inicializado vazio, sem reutilizar o snapshot local de outra empresa;
- o owner marker e o snapshot resultante são gravados no navegador.

A lógica é importante para evitar que um mesmo navegador compartilhe dados entre empresas diferentes. Testes de troca de empresa no mesmo navegador são obrigatórios.

## 3. Persistência e concorrência

O estado principal continua sendo um JSONB em `app_state.state`, uma linha por `owner_id`.

### Escrita

- Sem timestamp base conhecido: UPSERT por `owner_id`.
- Com timestamp base: UPDATE condicional por `owner_id` e `updated_at` esperado (compare-and-swap).
- Se a atualização não encontra a versão esperada, o cliente lê a linha remota, faz merge e tenta novamente.
- Há até três tentativas no ciclo; falhas mantêm solicitação pendente e retry posterior.
- Mudanças locais são gravadas no localStorage e notificam a UI.

### Leitura e reconciliação

- Polling a cada 3 segundos.
- Realtime observa UPDATE em `public.app_state`, filtrado por `owner_id`.
- Ao receber evento, compara timestamps para não regredir a base; mescla dados e agenda reconciliação após 180 ms.
- Reconcilia ao assinar, recuperar foco/visibilidade e voltar à rede.
- Leituras concorrentes com escrita em andamento são adiadas para depois da fila.

### Merge

- Coleções com IDs são mescladas por ID.
- Movimentos de estoque são tratados como deltas novos em relação à base, ignorando registros `legacy`.
- Produtos recebem os deltas de estoque sem aplicar duas vezes o mesmo movimento já presente em ambos os lados.
- Carrinho e configurações preservam estado local conforme o contrato atual.

Esses detalhes são comportamento de negócio e consistência, não simples infraestrutura. Não substituir o snapshot por CRUD de tabelas ou eventos de domínio na primeira migração sem uma estratégia de compatibilidade e testes equivalentes.

## 4. Realtime e autorização tenant-aware

O canal atual é `mobflow-state:<accountId>`, recebe UPDATE de `app_state` com filtro `owner_id=eq.<accountId>` e transporta o snapshot JSONB.

O filtro é montado no cliente. Ele não pode ser considerado uma barreira de segurança. A autorização efetiva precisa garantir que um usuário autenticado só possa ler/escrever a linha do seu `account_id`, mesmo se adulterar o filtro, URL, payload ou parâmetros.

Para Neon Realtime, a sealed query deve ser emitida pelo backend após:
1. validar o token do usuário;
2. buscar o perfil ativo;
3. derivar `account_id` de fonte confiável;
4. criar consulta parametrizada com esse tenant;
5. emitir a sealed query com TTL limitado.

O cliente não deve escolher livremente o tenant da sealed query. O fato de uma assinatura ser criptografada não substitui autorização por empresa.

## 5. Riscos e pontos de validação

1. **Acesso direto a app_state:** confirmar as políticas RLS efetivas e grants de produção; o inventário anterior registrou grants excessivos a `anon`/`authenticated`, inclusive TRUNCATE, que não é restringido por RLS. Não reproduzir os grants na arquitetura Neon.
2. **Fallback de identidade:** mapear todos os perfis sem `account_id` e seus `app_state.owner_id` antes de decidir se o fallback `user.id` permanece.
3. **Mudança de empresa no mesmo navegador:** testar que localStorage de uma empresa nunca é mesclado com outra.
4. **Falha de leitura:** distinguir erro de consulta de “empresa sem snapshot”; não inicializar/sobrescrever estado vazio se a leitura falhou por autorização ou rede.
5. **CAS e timestamp:** manter atualização condicional e conflito sem perda de gravações concorrentes.
6. **Eventos duplicados/fora de ordem:** manter proteção temporal, merge idempotente e reconciliação.
7. **Polling:** manter fallback de 3 segundos até provar equivalência e cobertura de reconexão no novo Realtime.
8. **Recebimento:** preservar RPCs transacionais e não transformar a decisão/liberação em UPDATE genérico do JSON.
9. **Tamanho do snapshot:** medir latência e payload conforme histórico cresce; a arquitetura de primeira migração deve preservar compatibilidade com JSONB.
10. **Isolamento no backend:** toda API/RPC deve derivar tenant da sessão validada, não de um `account_id` fornecido livremente pelo navegador.

## 6. Testes de caracterização obrigatórios

- Duas empresas em perfis diferentes no mesmo navegador: alternar login e verificar isolamento local e remoto.
- Dois dispositivos da mesma empresa: escrita simultânea, CAS, merge e atualização da UI.
- Operador bloqueado durante sessão ativa: bloquear novas leituras/escritas após revalidação.
- Tentativa de ler/escrever `owner_id` de outra empresa por API direta.
- Perda de evento Realtime e recuperação por polling.
- Evento atrasado/duplicado e leitura antiga retornando depois de versão nova.
- Falha de rede durante CAS, retry e retomada sem perda.
- Empresa sem linha app_state versus consulta negada/indisponível.
- Recebimento simultâneo com outra gravação de estoque.
- Revogação de acesso e logout com assinatura Realtime ativa.

## 7. Limites desta rodada

- A análise foi feita no código versionado da branch de preparação e documentos de auditoria existentes.
- Não foram executadas consultas de escrita, testes de invasão, nem alterações em políticas.
- A auditoria não certifica por si só as políticas RLS atuais; elas precisam ser conferidas com o catálogo de produção já documentado e revalidadas antes de qualquer migração.
- Não foi ativado Neon Realtime, Data API, Auth ou Functions.

## 8. Próximas atividades

1. Fechar a revisão rota a rota e operação a operação.
2. Consolidar o modelo de autorização do backend para app_state, RPCs e Realtime.
3. Definir estratégia de identidade/JWT e de migração de Auth sem interromper sessões de produção.
4. Especificar arquitetura de compatibilidade e plano de rollback.
5. Encerrar a Etapa 3 somente quando riscos, testes e decisões pendentes estiverem listados e aprovados.

**Estado:** documentação de auditoria somente. Nenhuma alteração funcional, escrita no banco, mudança de configuração ou deploy.
