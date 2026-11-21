# MobFlow PDV — comparação da função publicada de reautenticação

Data: 06/11/2026  
Projeto: `mobflow-pos-stock`  
Função: `mobflow-reauth-manager`  
Escopo: leitura da função ativa publicada e comparação com o arquivo versionado na branch de preparação. Sem deploy ou alteração de função.

## 1. Estado publicado confirmado

A função publicada está:
- ativa;
- versão 14;
- `verify_jwt = true`;
- código recuperado diretamente do projeto Supabase correto.

## 2. Divergência confirmada

O código publicado consulta perfil por ID de usuário, exige `active`, `account_id` e aceita:
- papel `manager`; ou
- qualquer outro papel cujo array `permissions` inclua `Gerência`.

O código versionado na branch de preparação aceita:
- papel `manager`; ou
- papel `pdv` com permissão `Gerência`.

Portanto, a condição publicada é mais ampla para perfis não-manager: não restringe explicitamente o segundo caso a `role = pdv`. Não é seguro substituir a função publicada pelo arquivo do repositório sem decidir qual comportamento é intencional e testar os perfis existentes.

Ambas as versões consultam `manager_security_by_account` pelo `account_id`, suportam status/configuração/verificação e usam SHA-256 simples para o segredo de Gerência. A função publicada continua ativa; nada foi publicado nesta auditoria.

## 3. Decisão pendente

Antes da migração:
1. Confirmar quais papéis legítimos podem possuir a permissão Gerência.
2. Definir se o papel é condição obrigatória além da permissão.
3. Testar gerente principal, operador com Gerência e perfis legados/administrativos.
4. Preservar a autorização server-side e o tenant derivado do perfil autenticado.
5. Planejar migração do hash legado separadamente, sem invalidar a senha de Gerência de todos os clientes.

## 4. Integridade e escopo

A função ativa permaneceu na versão 14. Nenhum segredo foi lido ou exibido. Nenhum deploy, configuração, dado ou schema foi alterado.
