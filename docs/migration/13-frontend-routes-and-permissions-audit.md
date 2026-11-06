# MobFlow PDV — auditoria de rotas, menus e permissões do frontend

Data: 06/11/2026  
Branch: `migration/neon-preparation`  
Escopo: leitura dos arquivos frontend na branch de preparação. Não altera comportamento, banco ou deploy.

## 1. Modelo de autorização observado

O frontend usa três camadas distintas:

1. **Sessão Auth:** `src/routes/__root.tsx` recupera a sessão Supabase, consulta `profiles` pelo ID do usuário, rejeita perfil inexistente, inativo ou com papel `admin`, grava papel/nome/permissões no `sessionStorage` e hidrata o estado da empresa.
2. **Permissões de navegação:** `src/components/AppHeader.tsx` filtra itens do menu e verifica permissões antes de navegar. As permissões são carregadas do `sessionStorage`; o rótulo legado `Conferência` é normalizado para `Operações`.
3. **Autorização de operações privilegiadas:** as Edge Functions `mobflow-users`, `mobflow-reauth-manager` e outras revalidam token e perfil no servidor para ações administrativas. Essa camada é essencial e deve ser preservada independentemente da interface.

O estado `mobflow-management=1` no `sessionStorage` representa o desbloqueio local da área de Gerência. Ele não substitui a validação server-side: configurações chama `mobflow-reauth-manager` para confirmar o perfil e o status antes de liberar o gerenciamento de usuários.

## 2. Rotas encontradas no route tree

O `src/routeTree.gen.ts` declara as seguintes rotas de aplicação:

- `/` — PDV
- `/baixa-produtos`
- `/balanco-estoque`
- `/caixa`
- `/conferencia`
- `/configuracoes`
- `/dashboard`
- `/estoque`
- `/fiado` e subrotas de cliente
- `/fiado-consulta`
- `/fornecedores-clientes`
- `/gerencia`
- `/historico-vendas`
- `/movimentacoes-estoque`
- `/operacao-caixa`
- `/operacoes`
- `/promocoes`
- `/recebimento`
- `/recuperar-senha`
- `/saiba-mais`
- `/transferencias`
- `/validade`
- `/vendas`

Rotas públicas explicitamente liberadas no root: `/recuperar-senha` e `/saiba-mais`. As demais dependem da sessão global, mas nem todas demonstraram uma checagem local específica de permissão.

## 3. Verificações encontradas por área

| Área/rota | Verificação frontend observada | Observação para migração |
|---|---|---|
| Root / sessão | Consulta sessão e perfil; rejeita perfil ausente/inativo e role admin | Reproduzir validação de identidade e perfil no servidor |
| Menu lateral | Filtra abas por permissões em sessionStorage | Menu é conveniência visual, não barreira de segurança |
| PDV `/` | Redireciona operador sem permissão PDV para Operações; ações de venda também consultam autorização local | Conferir todas as mutações server-side e tenant scope |
| Operações `/operacoes` | Lê permissão Gerência para mostrar atalho de retorno; não foi vista guarda de entrada equivalente à da Conferência | Verificar se operador sem permissão pode abrir URL diretamente |
| Conferência `/conferencia` | Redireciona se não tiver Operações nem Gerência | Guarda local depende de sessionStorage; backend deve validar |
| Gerência `/gerencia` | Operador somente Operações é redirecionado; desbloqueio depende de senha/status | Manter reautenticação no servidor e revisar divergência da função publicada |
| Estoque `/estoque` | Exige `mobflow-management=1` | Flag local pode ser manipulada; ações críticas devem validar Gerência no backend |
| Recebimento `/recebimento` | Exige `mobflow-management=1` | Mesmo risco da flag local |
| Configurações `/configuracoes` | Reconsulta sessão, chama `mobflow-reauth-manager`, exige perfil permitido e flag desbloqueada | É um padrão mais forte; documentar ações individuais também |
| Dashboard `/dashboard` | Redireciona se `mobflow-management` não estiver ativo | Proteção de interface; exigir autorização em operações/dados sensíveis |
| Fiado `/fiado` | Revalida senha do operador para certas alterações usando função de login | Preservar reautenticação sem criar sessão paralela acidental |
| Validade `/validade` | Menu exige permissão Validade; na rota inspecionada não foi localizada guarda equivalente | Validar acesso direto e operações de escrita |
| Baixa de produtos / transferências | Consultam usuário/perfil para obter CNPJ, mas não foi localizada guarda de permissão na rota analisada | Revisar autorização das mutações e tenant scope |
| Demais rotas | Route tree confirma existência; checagem individual ainda não foi inspecionada em profundidade | Não declarar liberadas ou protegidas sem auditar cada arquivo e ação |

## 4. Achados e riscos

### 4.1 Menu não é autorização

A filtragem do menu em `AppHeader` usa permissões em `sessionStorage`. Um usuário pode tentar abrir diretamente uma URL. A segurança real precisa estar no backend, com verificação de usuário, papel, permissão e `account_id` em cada operação de leitura/escrita protegida.

### 4.2 Flags locais de Gerência

Algumas páginas verificam apenas `sessionStorage.getItem("mobflow-management") === "1"`. Essa flag é estado de interface e pode ser alterada pelo cliente. Não deve ser tratada como prova de autorização na arquitetura de destino.

### 4.3 Permissões legadas

O sistema normaliza `Conferência` para `Operações` em vários pontos. O backend de usuários também aceita ambos e normaliza ao salvar. A migração precisa preservar essa compatibilidade ou executar uma conversão controlada com testes para não retirar acesso de operadores existentes.

### 4.4 Perfil e sessão

O bootstrap do root consulta diretamente `profiles` após recuperar a sessão. O perfil e as permissões são copiados para o `sessionStorage`, mas a sessão Auth continua sendo a identidade base. No destino, o servidor deve obter o ID do token validado e consultar o perfil/tenant atualizado, sem confiar em permissões antigas armazenadas no navegador.

### 4.5 Fluxos sensíveis

As funções administrativas usam service role e precisam continuar sendo a fronteira de autorização. Em particular:
- `mobflow-users`: listar/criar/editar permissões/ativar/desativar/excluir usuários e ações destrutivas;
- `mobflow-reauth-manager`: confirmar e desbloquear Gerência;
- `mobflow-manager-password-recovery`: redefinir credencial de Gerência;
- `mobflow-login`: validar identidade, CNPJ, estado ativo e assinatura.

Não migrar essas operações para chamadas diretas do cliente com chave privilegiada.

## 5. Matriz de testes obrigatória para a migração

Para cada rota e cada mutação:
1. Sem sessão: negar, exceto rotas públicas declaradas.
2. Sessão expirada/inválida: negar e limpar estado local corretamente.
3. Perfil bloqueado/inativo: negar inclusive em sessão já aberta.
4. Operador sem permissão da área: negar URL direta e operação backend.
5. Operador com permissão somente Operações: manter o fluxo de redirecionamento e impedir PDV.
6. Usuário com permissão removida enquanto está conectado: refletir a revogação sem depender de novo login prolongado.
7. Usuário de outra empresa: não ler nem alterar dados de outro `account_id`.
8. Papel gerente e operador com Gerência: preservar as diferenças funcionais previstas.
9. Ação destrutiva: reautenticação server-side, confirmação e trilha de auditoria.
10. Menu e rota: consistência entre permissão exibida, permissão aplicada e permissão do backend.

## 6. Limites desta rodada

- A lista de rotas veio do route tree gerado; as páginas foram inspecionadas por amostragem dirigida, não linha a linha em todas as 24 rotas.
- A inspeção não executou o app nem tentou contornar permissões.
- Não foram chamados endpoints de produção para alterar dados.
- Não foram alteradas regras RLS, funções, sessões, permissões ou configurações.
- A matriz não certifica que todas as operações estão protegidas; registra verificações observadas e pontos que exigem aprofundamento.

## 7. Próxima etapa da auditoria

1. Inspecionar as rotas restantes e todas as ações que alteram dados, comparando-as com as Edge Functions/RPCs.
2. Auditar o contrato do `app_state` e o escopo de `account_id` em cada operação.
3. Fechar a validação de Realtime (autorização por tenant, ordenação, reconexão e fallback de polling).
4. Consolidar a arquitetura alvo e a sequência de migração, com testes e rollback.

**Estado:** auditoria documental somente. Nenhuma alteração funcional, escrita em banco, configuração, publicação ou ativação de serviço foi realizada.
