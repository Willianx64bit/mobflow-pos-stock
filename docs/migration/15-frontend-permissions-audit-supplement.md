# MobFlow PDV — complemento da auditoria de rotas e permissões

Data: 06/11/2026  
Branch: `migration/neon-preparation`  
Complementa: `13-frontend-routes-and-permissions-audit.md`  
Escopo: inspeção adicional dos arquivos de rota que não estavam cobertos na primeira rodada. Somente leitura.

## 1. Rotas adicionais inspecionadas

| Rota | Controle frontend observado | Ponto a validar |
|---|---|---|
| `/balanco-estoque` | Exige Gerência desbloqueada ou permissão Operações | Operações pode ajustar estoque; backend deve validar a permissão e tenant em cada escrita |
| `/caixa` | Exige `mobflow-pdv-authorized=1` e permissão PDV | Verificar que toda operação de caixa permanece autorizada no servidor |
| `/fiado-consulta` | Exige Gerência desbloqueada; lê permissões locais | Verificar a necessidade real da permissão e autorização das consultas |
| `/fiado/$customer` | Ações de pagamento alteram estado via store | A rota filha não apresentou guarda própria no trecho inspecionado; depende do fluxo pai/sessão |
| `/fiado/cliente` | Ações de pagamento alteram estado via store | A rota filha não apresentou guarda própria no trecho inspecionado; depende do fluxo pai/sessão |
| `/fornecedores-clientes` | Salva e exclui contatos via store; sem guarda explícita localizada no arquivo | Confirmar permissão Operações e validação server-side |
| `/historico-vendas` | Verifica nome, permissão PDV e flag de autorização local | Garantir autorização em qualquer consulta/exportação sensível |
| `/operacao-caixa` | Exige flag local de Gerência desbloqueada | Flag de navegador não é prova de autorização |
| `/promocoes` | Exige flag local de Gerência desbloqueada | Escrita de promoções deve ser protegida no servidor |
| `/vendas` | Exige flag local de Gerência desbloqueada | Verificar o motivo da restrição e proteger leitura/alteração no backend |
| `/saiba-mais` | Conteúdo público | Mantém acesso sem sessão |
| `/recuperar-senha` | Conteúdo público; chama função de recuperação | Manter rate limit, resposta genérica e token de uso único |

## 2. Conclusão ampliada

A aplicação possui uma proteção global de sessão no root, mas as permissões de cada rota são heterogêneas:
- algumas rotas conferem permissões em `sessionStorage`;
- outras conferem apenas uma flag de desbloqueio da Gerência;
- algumas não demonstraram guarda local específica;
- o menu filtra navegação, mas isso não impede acesso direto à URL;
- ações do store escrevem no snapshot compartilhado e não carregam, por si só, uma autorização server-side por operação.

Isso não prova que os dados estejam expostos: a proteção real depende das políticas de banco e dos endpoints/RPCs efetivos. Porém, a auditoria não pode certificar o isolamento por permissão apenas com os controles de interface.

## 3. Decisão para arquitetura de destino

Antes de liberar a migração:
1. Definir matriz formal de permissões por operação (ler, criar, editar, excluir, exportar, finalizar).
2. Mover a decisão de autorização para APIs/RPCs server-side, usando token validado e perfil atual.
3. Derivar tenant de `profiles.account_id` no servidor.
4. Tratar o frontend como experiência e não como fronteira de segurança.
5. Cobrir cada rota com testes negativos de URL direta e cada mutação com testes negativos de API.
6. Não alterar permissões existentes durante a migração de infraestrutura; correções de autorização devem ser isoladas, aprovadas e testadas separadamente.

## 4. Limites

Esta rodada não chamou APIs de produção, não tentou executar operações, não alterou arquivos funcionais, banco, políticas, configuração ou deploy. A revisão continua documental e não certifica o estado efetivo das políticas de produção.
