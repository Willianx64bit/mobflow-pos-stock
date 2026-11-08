# 69 — Auditoria de permissões, papéis e limites de autorização

Data: 2026-11-08  
Branch: `migration/neon-preparation`  
Escopo: leitura do menu, rotas e API de usuários Better Auth. Sem alterações funcionais.

## 1. Modelo encontrado

### Papéis de identidade
- A API `/api/mobflow/users` identifica o titular como `manager` ou usuário `pdv`.
- O usuário titular/manager pode administrar usuários; a API também permite gestão a uma identidade com permissão `Gerência`.
- Usuários operacionais são registrados em `profiles.role='pdv'`, vinculados ao `account_id` da empresa.

### Permissões funcionais permitidas pela API
`PDV`, `Operações`, `Conferência`, `Validade`, `Fiado`, `Gerência`.

A permissão legada `Conferência` é normalizada para `Operações`. Isso significa que ela não é atualmente uma permissão independente na prática.

A API define permissões padrão `PDV` + `Operações`. Na criação do primeiro usuário PDV, se ainda não existir nenhum, a API adiciona `Gerência` caso não tenha sido selecionada. A tela de primeiro usuário da Gerência envia um conjunto mais amplo de permissões.

## 2. O que cada permissão libera na interface

| Permissão | Acesso de navegação observado |
|---|---|
| PDV | Tela principal e histórico de vendas; também habilita ações de caixa no menu |
| Operações | Área Operações e suas rotas de conferência, baixa, transferência, balanço, contatos e histórico de estoque |
| Validade | Tela de validade dos produtos |
| Fiado | Área Fiado |
| Gerência | Entrada na Gerência, sujeita também à senha de segurança separada |

Observações:
- `AppHeader` filtra as abas do menu com base nas permissões guardadas em `sessionStorage`.
- O usuário que tem somente `Operações` é direcionado/bloqueado para não navegar nas demais áreas.
- A tela `Gerência` verifica sessão e papel/permissão e exige senha de segurança separada para desbloquear a área.
- `Operações` permite retorno à Gerência apenas quando a permissão local contém `Gerência`.

## 3. Gestão de usuários no servidor

A API Better Auth `POST /api/mobflow/users`:
- inicia transação autenticada e deriva `accountId` da identidade da sessão;
- exige papel manager ou permissão `Gerência` para administrar usuários;
- valida CNPJ da empresa pelo perfil do titular;
- lista somente perfis PDV do mesmo `account_id`;
- cria usuário, credencial Better Auth, perfil e allowlist em transação;
- restringe atualização, bloqueio, redefinição de senha e exclusão a usuário PDV da mesma empresa;
- ao bloquear/excluir, desativa a allowlist;
- redefinir senha apaga sessões existentes do usuário;
- impede que um gerente retire de si mesmo a permissão Gerência quando a identidade atual a possui.

Ponto a revisar: a rota permite a gestão com base em papel/permissão, mas a política de quem pode conceder ou retirar a permissão `Gerência` de terceiros precisa ser explicitada. O código observado não mostra uma regra geral de “somente titular pode conceder Gerência”.

## 4. Lacunas para a migração

### A. Permissão de tela não é autorização de API
O menu e várias proteções de rota leem permissões do `sessionStorage`. Isso é adequado para experiência de navegação, mas não pode ser a barreira de segurança do novo backend. Cada comando e consulta no Neon deve validar a sessão, o tenant e a permissão no servidor, usando os dados atuais do perfil no banco — nunca confiar no array enviado/guardado no navegador.

### B. Rotas operacionais não têm um contrato uniforme
Na amostra auditada:
- `recebimento.tsx` protege a tela por `mobflow-management`;
- `conferencia.tsx` aceita `Operações` ou `Gerência`;
- `balanco-estoque.tsx` aceita `Operações` ou `mobflow-management`;
- `baixa-produtos.tsx` consulta diretamente Supabase para obter CNPJ e executa mutação via store.
Essas verificações têm formatos diferentes. Antes de mover operações para Neon, criar uma matriz única de autorização por ação e reforçar tudo no servidor.

### C. A permissão “PDV” agrupa mais de uma capacidade
Atualmente ela cobre venda, histórico de vendas e acesso às ações de abertura/fechamento/sangria/reforço no menu. Não há granularidade explícita para cada ação de caixa.

### D. A permissão “Operações” é ampla
Ela agrupa conferência, baixa, transferências, balanço, fornecedores/clientes e histórico de estoque. Não há distinção de permissões por tipo de movimento na matriz atual.

### E. Gerência e senha de segurança
Manter separados:
- autenticação primária do usuário;
- papel/permissão Gerência;
- senha de segurança adicional para desbloquear a área Gerência.
Não fundir a senha de segurança com a senha principal nem usar a senha de Gerência para autenticar chamadas comuns do PDV.

## 5. Contrato de autorização recomendado para Neon

Para toda rota:
1. validar sessão Better Auth no servidor;
2. obter `userId`, `accountId`, papel e permissões atuais do banco;
3. confirmar vínculo ativo do perfil e da allowlist;
4. validar permissão funcional exigida para aquela ação;
5. filtrar toda leitura/escrita pelo `accountId` derivado da sessão;
6. validar propriedade do recurso (ex.: sessão de caixa, venda, nota, produto);
7. executar autorização e mutação na mesma transação quando houver alteração de dados;
8. registrar ator, data, operação e chave idempotente em ledger/evento;
9. retornar 401 para sessão ausente, 403 para permissão insuficiente, 404 quando apropriado para recurso de outro tenant, sem revelar dados de outra empresa.

Matriz mínima sugerida (a confirmar com as regras de negócio):
- checkout e consulta de vendas: `PDV`;
- abertura, movimentação e fechamento de caixa: `PDV` + vínculo com operador/sessão; exceções administrativas explícitas;
- recebimento, conferência, baixa, transferência, balanço e ledger de estoque: `Operações`;
- consulta/pagamento de fiado: `Fiado` (e definir se PDV também pode receber pagamentos);
- validade: `Validade`;
- criar/editar usuários e permissões: `Gerência`;
- redefinição de senha de usuário e bloqueio: `Gerência`;
- reset total: somente identidade titular/manager, como já ocorre na API atual.

## 6. Itens que precisam de confirmação antes da implementação
1. Um usuário PDV pode receber pagamento de fiado ou somente quem tem `Fiado`?
2. Usuário com `Operações` pode acessar todas as operações (baixa, balanço, transferência, conferência) ou haverá permissões separadas?
3. Quem pode conceder/remover `Gerência`: apenas titular ou gerente delegado?
4. Gerência pode vender no PDV sem atribuir também `PDV`?
5. Quem pode fechar caixa de outro operador em caso de ausência?
6. Deve existir permissão independente para sangria/reforço?
7. O histórico de vendas é exclusivo de `PDV` ou Gerência também deve acessá-lo sem essa permissão?
8. Usuário bloqueado deve perder sessão imediatamente em todos os dispositivos (recomendado: revogar sessões no mesmo comando)?

## 7. Próximos passos seguros
1. Fechar a matriz de permissões com as respostas acima.
2. Auditar todas as rotas `/api/mobflow/*` e separar comandos operacionais de endpoints de estado/snapshot.
3. Implementar um helper server-side de autorização e testes de tenant/role/permission antes de migrar os comandos.
4. Só então conectar endpoints de vendas, caixa, fiado e estoque às tabelas relacionais.

## 8. Limites desta etapa
Somente documentação baseada no código lido. Nenhuma alteração em `src/`, SQL, dados, Supabase, Neon, Vercel ou MobFlow Admin. ColetaFlow não foi acessado.
