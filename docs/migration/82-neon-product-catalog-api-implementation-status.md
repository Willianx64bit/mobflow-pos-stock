# Doc 82 — Primeira implementação da API de catálogo no Neon

**Branch:** `migration/neon-preparation`  
**Status:** implementação inicial no código + testes unitários adicionados; ainda não validada por execução CI nem habilitada no ambiente.  

## Arquivos

- `src/routes/api/mobflow/products.ts`: endpoints GET, POST e PATCH para o catálogo relacional.
- `src/test/mobflow-products-api.test.ts`: testes de isolamento do tenant, autorização, criação, validação, bloqueio de alteração de saldo e conflito de versão.

## Contrato implementado

- A rota só responde quando `MOBFLOW_AUTH_PROVIDER=better-auth`; o fluxo legado continua inalterado.
- Toda consulta usa `beginAuthenticatedTransaction`; tenant é obtido da identidade autenticada, não do corpo/query.
- GET exige sessão e filtra pelo tenant autenticado; suporta busca, filtro ativo e paginação limitada.
- POST e PATCH exigem papel `manager` ou permissão atual `Gerência` no perfil retornado pelo servidor. `PDV` e `Operações` isolados não podem alterar catálogo.
- POST exige ID estável do cliente. Repetição com o mesmo ID e mesmos dados é tratada como replay; o mesmo ID com dados diferentes retorna conflito.
- PATCH exige `expectedVersion`; versão divergente retorna 409.
- Preço/custo usam duas casas decimais; unidade `un` exige quantidade inteira e `kg` aceita até três casas.
- PATCH não aceita alterar estoque nem foto. POST exige estoque zero; saldo inicial fica bloqueado até existir comando transacional próprio que atualize produto + ledger + evento.
- Códigos de barras são gravados em `product_barcodes` na mesma transação do produto; duplicidade retorna conflito.
- Fotos/base64/object key não são aceitos por esta API; R2 terá fluxo separado.
- Erros de schema ausente/privilégio insuficiente não devem ativar fallback silencioso para snapshot.

## Limitações que impedem considerar concluído

1. Migrations 0005/0006 continuam drafts não aplicados. A rota retornará indisponibilidade enquanto as tabelas não existirem.
2. O consumidor incremental do cliente ainda não existe; o catálogo ainda não foi integrado ao store/UI.
3. A primeira implementação não substitui o snapshot nem altera as telas existentes.
4. O produtor de evento de catálogo ainda precisa ser conectado e validado em conjunto com 0005 antes de habilitar gravações em Preview. Não usar esta API como fonte sincronizada entre dispositivos até esse passo.
5. A importação XLSX/CSV e o fluxo de saldo inicial/ajustes permanecem fora desta fatia.
6. Não foi possível executar os testes localmente nem confirmar um workflow GitHub Actions para estes commits nesta sessão. Os testes foram adicionados, mas não estão declarados como aprovados.
7. A matriz de permissão segue o que está comprovado hoje: somente manager/Gerência para escrita. Não foi ampliada para `Operações` sem confirmação do contrato atual.

## Próximos passos obrigatórios

- Completar o produtor de eventos transacional e testes de payload/replay.
- Validar o SQL gerado contra 0006 em branch Neon descartável, após aprovação separada para aplicar os drafts em teste.
- Corrigir e validar constraints de tenant, retenção e grants antes da migration.
- Rodar Vitest e TypeScript/build no CI.
- Criar service tipado no cliente e leitura paralela Preview; não ligar escrita da UI ainda.
- Implementar operação separada de saldo inicial/ajuste e ledger antes de importar saldo diferente de zero.

## Segurança / escopo

Nenhuma migration foi executada. Nenhum banco, dado, Supabase, Neon, Vercel Production ou configuração foi alterado. Nenhuma alteração no MobFlow Admin ou ColetaFlow. Somente arquivos na branch de preparação do MobFlow PDV foram adicionados/alterados.
