# MobFlow PDV — opções de arquitetura de destino (rascunho para validação)

Data: 06/11/2026  
Escopo: somente MobFlow PDV. Este documento é desenho técnico; não autoriza mudanças na produção.

## Objetivos que não podem regredir

1. Manter contas, usuários, permissões e experiência de login sem perda de acesso.
2. Preservar sincronização em tempo real entre dispositivos da mesma empresa.
3. Preservar isolamento por empresa (tenant) em toda leitura, escrita, função e assinatura.
4. Preservar merge concorrente, CAS, reconciliação offline e fallback de 3 segundos.
5. Preservar operações atômicas de recebimento, vendas e movimentos de estoque.
6. Manter Storage privado de comprovantes e cadastro/Pix funcionando.
7. Não alterar MobFlow Admin nem ColetaFlow nesta migração.

## Opção A — Supabase Auth + Neon Data API com JWT externo

**Condição de entrada:** Supabase Auth do projeto precisa emitir JWT assimétrico compatível (ES256/RS256), com JWKS público, claims `sub` e `role=authenticated`; validar também issuer/audience e rotação.

Fluxo:
- Login/refresh continuam no Supabase Auth.
- Frontend envia o access token Supabase ao Neon Data API.
- Neon valida assinatura pelo JWKS e aplica GRANT/RLS do PostgreSQL Neon.
- RLS Neon reproduz o isolamento por empresa, mas sem copiar permissões excessivas do Supabase.
- APIs privilegiadas e funções de negócio continuam server-side; nunca expor segredo/service role no cliente.
- Neon Realtime exige caminho separado: servidor autentica o usuário, deriva o account_id de fonte confiável e cria/renova sealed query específica para aquele tenant. O cliente não pode escolher livremente owner_id nem alterar a query.

Vantagens:
- Pode preservar as credenciais e sessões Supabase existentes.
- Mantém autorização de leitura/escrita no PostgreSQL via RLS.
- Reduz necessidade de construir uma API proxy para CRUD simples.

Riscos/bloqueios:
- Se o projeto usar HS256 legado, o Neon Data API não consegue validar esse token por JWKS público.
- A rotação para chave assimétrica precisa ser planejada; não fazer em produção como parte desta auditoria.
- A autorização do Neon Realtime beta não usa RLS PostgreSQL; sealed queries precisam ser autorizadas pelo backend e testadas contra cross-tenant.
- Ainda é necessário portar Edge Functions e operações RPC para o ambiente de destino.

## Opção B — Supabase Auth + API server-side própria + Neon

Fluxo:
- Login/refresh continuam no Supabase Auth.
- Frontend envia token ao backend do PDV.
- Backend valida a sessão com Supabase Auth (por exemplo, getUser/validação segura), carrega perfil/empresa e deriva account_id no servidor.
- Backend consulta Neon com credencial privada; nenhuma conexão privilegiada vai ao navegador.
- Backend cria e renova sealed queries do Neon Realtime após validar usuário e tenant.
- APIs reproduzem as operações atuais de estado/CAS, recebimento, usuários, reautenticação e recuperação.
- Cliente recebe eventos/snapshots e continua executando o merge/reconciliação local equivalente ao comportamento atual.

Vantagens:
- Não depende de Supabase Auth usar JWKS assimétrico.
- Mantém credenciais de banco e decisões de tenant no servidor.
- Facilita portar Edge Functions gradualmente e controlar auditoria/rate limit.

Riscos/bloqueios:
- Exige construir e testar camada de API para operações hoje feitas diretamente com supabase-js.
- Backend torna-se componente crítico para latência, disponibilidade e sincronização.
- Necessita estratégia robusta para refresh/revogação de token e reconexão Realtime.
- Não pode reduzir Realtime a polling.

## Opção C — Migrar identidade para Neon Auth

Fluxo:
- Neon Auth passa a gerir login, sessões e recuperação.
- Usuários e permissões são migrados para novo modelo de identidade.
- Senhas atuais não devem ser presumidas compatíveis com Better Auth; provavelmente será necessário fluxo de redefinição/reativação de conta.

Vantagens:
- Menos dependência futura do Supabase Auth.
- Integração nativa com Neon Data API e seus JWTs.

Riscos/bloqueios:
- Maior impacto para os usuários e suporte de acesso.
- Exige migração de identidade, recuperação, usuários PDV, políticas e sessões.
- Não é o caminho de menor risco para uma primeira migração de banco.

## Recomendação provisória

Não escolher ainda. Validar primeiro A e B em branch/ambiente isolado, sem dados reais:
1. Confirmar algoritmo/JWKS/claims do Supabase Auth atual.
2. Provar token de teste no Neon Data API (se A for tecnicamente viável).
3. Provar autorização multiempresa e negação cross-tenant em ambas as opções.
4. Implementar um protótipo de assinatura Neon Realtime com sealed query gerada no servidor, TTL/renovação e reconexão.
5. Reproduzir CAS e merge concorrente do app_state com duas sessões.
6. Comparar complexidade, segurança, latência e manutenção.
7. Só então apresentar recomendação e pedir aprovação para Etapa 4.

## Dependências externas que permanecem fora do escopo de migração

- Endpoint de cobrança pública `mobflow-public-billing` hospedado no projeto Supabase separado. Preservar a integração; não modificar o projeto Admin.
- E-mail de recuperação via Gmail SMTP, com segredos no ambiente server-side.
- Comprovantes de pagamento no bucket privado `mobflow-payment-proofs`; definir destino compatível (pode permanecer temporariamente no Supabase Storage, se a estratégia de identidade/autorização permitir).
- `mobflow-admin-api` está no projeto PDV, mas seu consumidor pertence ao fluxo Admin; confirmar dependência antes de qualquer remoção.

## Fora de escopo nesta fase

- Nenhuma alteração em produção, Auth, JWT signing keys, Edge Functions, Storage, Realtime, Neon Data API, Neon Auth, banco ou usuários.
- Nenhuma importação de dados reais.
- Nenhuma publicação/deploy.
- Nenhuma alteração no MobFlow Admin ou ColetaFlow.
