# Migração limpa do MobFlow — PDV

> Documento de acompanhamento. Branch de trabalho: `migration/neon-preparation`.
> **Regra absoluta:** não alterar `main`, produção, nem o projeto ColetaFlow.

## Objetivo

Preparar uma cópia funcional e independente do MobFlow PDV, substituindo a dependência operacional da Supabase por Neon PostgreSQL e Cloudflare R2.

Referência atual do PDV: https://mobflow-pos-stock.lovable.app

## Regra de cópia limpa

- [ ] Reaproveitar código, estrutura, regras de negócio, layouts, configurações não secretas e migrations necessárias.
- [ ] Recriar no Neon somente o schema, índices, constraints, funções e permissões necessários.
- [ ] Não copiar empresas, usuários de clientes, produtos de empresas, vendas, estoque, caixa, movimentações, financeiro, histórico, cobranças ou qualquer dado operacional.
- [ ] Não importar backups nem fazer dump de dados da Supabase.
- [ ] Não copiar chaves, senhas, tokens ou segredos da Supabase.
- [ ] Garantir que o banco novo comece sem empresas e sem histórico operacional.
- [ ] Manter apenas o necessário para o funcionamento inicial e para o cadastro de novas empresas.

## Arquitetura-alvo

- Banco de dados: Neon PostgreSQL.
- Arquivos e imagens: Cloudflare R2 privado.
- Hospedagem: ambiente de Preview isolado, sem publicar em produção durante a migração.
- Comunicação com o Admin: APIs próprias autenticadas e com isolamento por empresa.
- Autenticação: fluxo definido para o PDV e compatível com a aprovação de empresas no Admin.

## Checklist de execução

### 1. Inventário do sistema atual
- [ ] Mapear tabelas, relações, índices, constraints, triggers, views, RPCs e funções usados pelo PDV.
- [ ] Mapear Edge Functions, chamadas HTTP e fluxos que ainda dependem da Supabase.
- [ ] Mapear autenticação, sessão, cadastro, recuperação de senha e logout.
- [ ] Mapear uploads, leitura, atualização e remoção de imagens/arquivos.
- [ ] Identificar variáveis de ambiente necessárias, sem registrar valores secretos neste documento.

### 2. Banco Neon limpo
- [ ] Confirmar projeto e branch Neon exclusivos para o novo ambiente.
- [ ] Criar/aplicar migrations de estrutura sem dados de empresas.
- [ ] Configurar usuário de banco com permissões mínimas.
- [ ] Validar isolamento de dados por empresa.
- [ ] Confirmar que não existem empresas, vendas ou históricos importados.
- [ ] Documentar migrations aplicadas e pendentes.

### 3. Remoção da dependência Supabase
- [ ] Migrar consultas e gravações para Neon/API própria.
- [ ] Migrar autenticação e gerenciamento de sessão.
- [ ] Migrar operações antes executadas por RPC/Edge Functions.
- [ ] Remover imports e chamadas Supabase restantes após confirmar que não há consumidores.
- [ ] Verificar variáveis e configurações antigas no código e no Preview.
- [ ] Confirmar que o PDV funciona sem credenciais ou serviços Supabase.

### 4. Cloudflare R2
- [ ] Definir bucket privado exclusivo para o ambiente de teste.
- [ ] Configurar credenciais somente no servidor.
- [ ] Migrar upload, leitura, substituição e exclusão de imagens/arquivos para R2.
- [ ] Guardar no Neon apenas metadados e referências dos objetos.
- [ ] Validar autorização por empresa e impedir acesso cruzado.
- [ ] Não copiar arquivos antigos de empresas.

### 5. Integração com o Admin
- [ ] Definir o fluxo de cadastro de empresa no PDV.
- [ ] Garantir que uma empresa nova fique pendente até aprovação administrativa.
- [ ] Garantir que empresas pendentes não acessem as funções operacionais.
- [ ] Validar ativação após aceite no Admin.
- [ ] Validar rejeição/bloqueio e mensagens apresentadas ao usuário.

### 6. Testes do PDV
- [ ] Cadastro de empresa nova.
- [ ] Estado pendente antes da aprovação.
- [ ] Login após aprovação.
- [ ] Produtos e categorias.
- [ ] Estoque e movimentações.
- [ ] Vendas, caixa e fechamento.
- [ ] Sincronização e atualização entre dispositivos.
- [ ] Upload, visualização, substituição e exclusão de imagens no R2.
- [ ] Isolamento entre duas empresas de teste.
- [ ] Tratamento de erros e logs sem dependência Supabase.

### 7. Critérios de conclusão
- [ ] PDV executa os fluxos previstos usando Neon e R2.
- [ ] Nenhum dado de empresa/histórico da produção foi copiado.
- [ ] Nenhuma chamada operacional à Supabase permanece.
- [ ] Testes documentados com resultado e evidências.
- [ ] Preview de teste acessível sem proteção indevida de login Vercel.
- [ ] Produção permanece intacta até autorização expressa.

## Registro de andamento

| Data | Etapa | Resultado / observação |
|---|---|---|
| 2026-11-10 | Planejamento | Checklist criado; execução e validações ainda precisam ser registradas. |

> Atualizar este arquivo a cada etapa: marcar somente o que foi efetivamente implementado e testado. Registrar bloqueios e evidências; não marcar como concluído apenas porque existe código.
