# Doc 83 — Produtor de eventos e leitura Preview do catálogo

**Status:** produtor transacional conectado; leitura Neon do catálogo protegida por feature flag; validação automatizada solicitada pelo workflow dedicado.

## Produtor de eventos

- Cadastro (`POST`) insere produto, códigos de barras e evento `catalog/manual/product` na mesma transação.
- Edição (`PATCH`) atualiza versão, códigos de barras e evento na mesma transação.
- A chave de idempotência é determinística por tenant + produto + versão; replays não geram uma segunda versão/evento.
- O evento contém projeção do produto para futura reconstrução do catálogo pelo consumidor.
- Falha ao publicar o evento causa rollback da alteração do catálogo.
- Escritas verificam a existência das tabelas e função de eventos antes de operar. Leitura exige apenas as tabelas do catálogo.
- O ator vem da identidade autenticada do servidor; tenant nunca é aceito do cliente.

## Leitura Preview

- `src/lib/store.ts` consulta `/api/mobflow/products` somente quando `VITE_MOBFLOW_CATALOG_READ_PROVIDER=neon` e Better Auth está ativo.
- Busca paginada até o fim; se uma página falhar ou houver resposta inválida, mantém a lista do snapshot anterior.
- A consulta é somente leitura; nenhuma gravação de produto foi conectada ao cliente.
- O fallback `/api/mobflow/state` permanece intacto. Nenhum fallback foi removido.
- URLs de foto locais já conhecidas são preservadas; `photo_object_key` não é tratado como URL pública.
- A flag precisa ser definida apenas no ambiente Preview para o primeiro teste controlado. Não ativar em Production.

## Limitações / riscos remanescentes

1. Migrations 0005/0006 continuam drafts e não foram aplicadas. Até a aplicação validada em Neon de teste, a rota retorna indisponibilidade e o cliente usa snapshot.
2. O consumidor incremental ainda não aplica eventos no cliente. A leitura paginada do catálogo é a primeira etapa, não substitui a sincronização geral.
3. O endpoint ainda não possui comando de saldo inicial, ajuste, exclusão ou importação em lote. Estoque inicial diferente de zero é rejeitado.
4. A leitura Preview mantém a lista antiga se a API falhar, sem apagar dados locais.
5. A autorização de escrita permanece restrita a `manager`/`Gerência`; nenhum direito foi ampliado para `Operações`.
6. Testes e build precisam passar no workflow antes de qualquer ativação da flag Preview.

## Validação automatizada

- Workflow adicionado: `.github/workflows/migration-preview-validation.yml`.
- Executa testes da API de catálogo e de leitura incremental, `tsc --noEmit` e build.
- A execução precisa ser conferida no GitHub Actions. A criação do workflow, por si só, não é prova de aprovação.

## Segurança / escopo

Nenhuma migration ou consulta de escrita foi executada no Neon. Nenhuma configuração de Vercel/Preview foi alterada nesta etapa. Nenhum deploy de produção. MobFlow Admin e ColetaFlow não foram tocados.
