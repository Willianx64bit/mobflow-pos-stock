# 70 — Inventário das APIs MobFlow e fronteira Supabase/Neon

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: inventário estático das rotas `src/routes/api/mobflow/*`. Sem chamadas de produção, sem alteração de código ou infraestrutura.

## 1. Inventário encontrado

| Rota | Método | Papel atual |
|---|---|---|
| `/api/mobflow/login` | POST | Login Better Auth/validação de conta, perfil, allowlist e status da empresa |
| `/api/mobflow/session-context` | GET | Contexto da sessão autenticada e permissões |
| `/api/mobflow/users` | POST | CRUD/gestão de usuários PDV, permissões e credenciais |
| `/api/mobflow/reauth-manager` | POST | Estado/configuração da senha de segurança da Gerência |
| `/api/mobflow/manager-password-recovery` | POST | Solicitação e consumo de recuperação da senha de segurança |
| `/api/mobflow/signup` | POST | Cadastro/ativação de empresa e Gerência; ainda integra Supabase para comprovante |
| `/api/mobflow/state` | GET/PUT | Snapshot operacional completo em `app_state`; PUT compara estado e emite alguns eventos |
| `/api/mobflow/receiving` | POST | Comandos dedicados de recebimento/conferência no snapshot, com eventos transacionais |
| `/api/mobflow/sync/events` | GET | Leitura paginada de eventos por cursor e tenant |

## 2. O que já está no Neon

As rotas Better Auth usam Neon para:
- identidade/perfil/allowlist e credenciais;
- contexto de sessão e permissões;
- gestão de usuários;
- senha separada da Gerência e recuperação;
- cadastro de empresa e metadados de cobrança;
- snapshot operacional em `app_state`;
- recebimento e eventos incrementais;
- leitura paginada do stream de eventos.

A API de eventos já filtra pelo `accountId` obtido da sessão autenticada e ordena por sequência. O consumidor no cliente ainda não foi implementado; o store segue dependendo do snapshot e do refresh periódico.

## 3. Dependência Supabase ainda observada

### Cadastro e comprovante
`signup.ts` ainda importa `@supabase/supabase-js` e usa Supabase para armazenamento do comprovante do cadastro. A metadata `payment_proof_path` é guardada em Neon. Essa rota precisa ser migrada para R2 preservando bucket privado, validação de MIME/tamanho, chave não previsível, limpeza do objeto se a gravação de metadados falhar e acesso autorizado.

### Login legado e modo de compatibilidade
O sistema mantém caminhos Supabase quando as flags de autenticação não selecionam Better Auth. A retirada desse fallback só deve acontecer depois de Preview validado, incluindo cadastro, login, sessão, recuperação da senha de Gerência e gestão de usuários.

### Cobrança pública do Admin
A tela de login ainda consulta uma Edge Function pública de billing no projeto Supabase separado do Admin. Não remover ou alterar nessa etapa: é uma dependência externa à migração do banco operacional e exige plano próprio de integração com Admin.

## 4. Snapshot e operações transacionais

- `state.ts` é a API central do snapshot completo e tem 553 linhas. O modelo atual ainda grava arrays operacionais em JSON.
- `receiving.ts` já demonstra padrão útil: autenticar, bloquear/ler estado, aplicar decisão, gravar alterações e emitir eventos na mesma transação; usa chave determinística por empresa/nota/operação para evitar duplicar liberação.
- `sync/events.ts` fornece paginação, cursor e high-water mark; é fonte para o futuro consumidor incremental.
- Não foi encontrada API dedicada para checkout, pagamentos de fiado, sessão/movimentação/fechamento de caixa, nem comandos relacionais de estoque. Essas operações ainda passam pelo store e snapshot.
- A existência de eventos no PUT do snapshot não substitui ledger relacional: comparação de snapshots não é suficiente para reconstruir com fidelidade todas as intenções, auditoria e idempotência de cada comando.

## 5. Ordem recomendada para fechar a migração

1. **Autorização comum:** criar helper server-side para sessão, status ativo, tenant e permissão, e cobrir testes negativos de tenant/role.
2. **Modelo relacional:** transformar o blueprint do documento 67 em DDL revisado, incluindo chaves, constraints, índices, tenant e auditoria.
3. **Ledger de estoque:** criar tabela dedicada de movimentações e plano de importação do histórico `stockMovements` existente; deduplicar por IDs de origem/operação e preservar legacy sem republicar como operação nova.
4. **Comandos transacionais:** checkout e estoque; depois caixa e fiado; depois transferências, baixas, balanço e conferência.
5. **Consumidor incremental:** fila offline durável, operação idempotente, reducer por categoria, cursor persistente e aplicação de página atômica.
6. **Leituras relacionais:** migrar telas de vendas, caixa, fiado, recebimento e histórico para consultas paginadas.
7. **R2:** mover comprovantes de cadastro e demais arquivos com chaves privadas e políticas de acesso.
8. **Desligamento gradual:** manter snapshot como bootstrap/recovery temporário; retirar polling e fallback Supabase apenas após testes de Preview e reconciliação.

## 6. Critérios para remover Supabase do PDV

A remoção só é segura quando:
- busca por `supabase`, `supabase.co`, `createClient`, `supabase.functions` e `supabase.storage` no código PDV não revelar dependências operacionais não planejadas;
- signup/comprovantes estiverem em R2;
- o fluxo público de cobrança tiver destino decidido com os responsáveis pelo Admin;
- todos os usuários/empresas e dados operacionais tiverem sido validados no Neon;
- Preview passar os testes de concorrência, offline, retry, isolamento e recuperação;
- não houver tráfego ativo necessário ao PDV nos serviços Supabase;
- plano de rollback e backup estiverem testados.

## 7. Limites
Inventário estático de código e documentação. Nenhuma migração SQL aplicada, nenhum dado consultado ou alterado nos bancos, nenhum secret acessado, nenhuma mudança em Vercel/Cloudflare/Supabase/Admin. ColetaFlow permanece fora do escopo.
