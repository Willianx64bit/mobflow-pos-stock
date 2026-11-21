# 21 — Neon Realtime: avaliação de segurança e prontidão para MobFlow

Data da verificação documental: 2026-11-06  
Branch Neon de teste: `br-wandering-union-bd6vcsk6` (`integration-test`, região `aws-us-east-2`)  
Estado observado anteriormente: Realtime desabilitado. Nenhuma ativação foi feita.

## 1. Estado do produto

A publicação oficial da Neon de 15/10/2026 descreve Neon Realtime como **beta pública**. O produto oferece live queries determinísticas, incluindo joins e agregações, via SDK TypeScript e sealed queries. A publicação informa que:
- o serviço é habilitado por branch;
- funciona com branches e scale-to-zero;
- o SDK é a interface recomendada enquanto o protocolo subjacente ainda está mudando;
- a funcionalidade está disponível, entre outras regiões, em `us-east-2`;
- o beta é gratuito no momento da publicação, mas compute e egress continuam sujeitos a cobrança;
- **a publicação declara explicitamente que ainda não há Row-Level Security no Neon Realtime**;
- a Neon não publicou benchmarks de desempenho para o beta e pede testes reais antes da maturidade GA.

Fonte oficial: https://neon.com/blog/neon-now-has-realtime (15/10/2026).

## 2. Consequência de segurança para MobFlow

Sealed query impede que o cliente altere/forje livremente a consulta assinada, mas isso não substitui autorização por empresa. Como o Realtime beta não oferece RLS, o MobFlow não pode depender de uma policy do banco para filtrar eventos de cada tenant no stream.

Modelo mínimo necessário:
1. O navegador autentica normalmente com o backend.
2. O backend valida sessão, usuário ativo, papel e empresa.
3. O backend deriva o tenant a partir do perfil validado; nunca aceita `account_id` arbitrário do navegador.
4. O backend constrói a query com tenant derivado no servidor e emite a sealed query.
5. A query retorna somente as colunas/linhas estritamente necessárias à tela.
6. Cada emissão/renovação de sealed query repete a autorização; revogação/bloqueio deve impedir novas emissões.
7. O backend limita duração, escopo e frequência de emissão conforme capacidades documentadas do SDK; esses detalhes ainda precisam ser confirmados em teste/versão exata.

Não entregar conexão PostgreSQL, credencial Neon, segredo de assinatura ou token administrativo ao navegador.

## 3. Adequação ao modelo de dados atual

O MobFlow hoje sincroniza snapshot JSONB completo em `app_state`, filtrado pelo `owner_id`, com reconciliação local, CAS e polling de segurança de 3 segundos. A UI e o store fazem merge e proteção contra eventos fora de ordem.

Uma live query sobre o snapshot inteiro poderia reduzir polling, mas não deve ser tratada como substituição automática:
- a query precisa ser tenant-scoped no servidor;
- mudanças podem retornar snapshots grandes e sensíveis;
- o Realtime não substitui a escrita transacional, CAS, bloqueio ou validação de autorização;
- o comportamento de reconexão, re-subscribe, perda temporária de rede, ordenação, replay e confirmação de transação precisa ser testado com o SDK atual;
- não foi encontrada evidência documental suficiente para certificar garantias de replay/entrega exatamente uma vez; o cliente deve continuar tolerante a duplicatas, lacunas e reordenação até prova em teste.

## 4. Arquitetura recomendada para teste

- Manter escrita via API/backend com transações e CAS no Postgres.
- Introduzir Realtime somente como canal de atualização/leitura, nunca como autoridade de escrita.
- Começar com query mínima por tenant e payload reduzido, sem dados de autenticação, tokens, hashes ou informações de outras empresas.
- Manter polling atual como fallback durante todo o piloto.
- Fazer comparação lado a lado de estado recebido por Realtime com leitura autoritativa do Postgres.
- Em reconexão ou divergência, buscar snapshot autoritativo e reconciliar antes de retomar o stream.
- Implementar revogação de usuário bloqueado no backend e validar o tempo até cessar acesso em uma conexão já aberta.

## 5. Critérios obrigatórios antes de qualquer corte

1. Teste de isolamento com duas empresas e usuários de papéis diferentes.
2. Teste de tentativa de reutilizar sealed query de outra empresa/usuário.
3. Teste de usuário bloqueado enquanto mantém conexão ativa.
4. Teste de token expirado, refresh e re-subscribe.
5. Teste de desconexão, suspensão de app mobile, troca Wi-Fi/4G e reconexão.
6. Teste de rajada de gravações e concorrência de múltiplos caixas.
7. Teste de duplicidade, perda aparente, eventos fora de ordem e recuperação via snapshot.
8. Teste de consumo, latência e custo com volume representativo.
9. Teste de branch correto: preview nunca pode assinar consulta de produção.
10. Aprovação explícita antes de remover polling ou ativar Realtime na branch de produção.

## 6. Decisão atual

**Não ativar Neon Realtime em produção nem remover polling nesta etapa.** O beta é promissor para protótipo isolado, mas a ausência declarada de RLS no Realtime é um bloqueio para uso direto como substituto do canal Supabase atual sem camada backend estrita e testes de isolamento/revogação.

A branch de teste permanece sem Realtime habilitado. A arquitetura deve manter o fallback de polling até que os critérios acima sejam aprovados.

## 7. Referências oficiais complementares

- Neon Realtime beta: https://neon.com/blog/neon-now-has-realtime
- Supabase Realtime Authorization e cache de políticas durante conexão: https://supabase.com/docs/guides/realtime/authorization
- Supabase Realtime protocol, expiração de token e reconexão: https://supabase.com/docs/guides/realtime/protocol

As páginas Supabase são referência para entender o comportamento atual que será substituído, não evidência de que Neon ofereça as mesmas garantias.
