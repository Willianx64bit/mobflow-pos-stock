# MobFlow Desktop — recuperação offline e fila transacional

## O que esta etapa implementa

- O service worker do PDV Desktop guarda a página inicial e os arquivos estáticos do aplicativo para permitir abrir a interface sem rede depois de uma primeira abertura online.
- Respostas de API, login e sessão nunca são armazenadas pelo service worker.
- O Electron mantém o contexto mínimo de autorização criptografado com o armazenamento seguro do Windows. A recuperação offline aceita somente perfil PDV com permissão PDV; não restaura perfil de gerência.
- A cópia local da empresa é tenant-scoped e só pode ser aberta com o mesmo accountId previamente validado.
- A cópia local precisa ter sido atualizada nos últimos 7 dias. Sessão e dados antigos exigem reconexão.
- No Desktop, comandos transacionais entram primeiro na outbox IndexedDB. Uma cópia de recuperação em localStorage é mantida até a confirmação da gravação no IndexedDB.
- A fila mantém ordem de criação e chave de idempotência estável. A confirmação só remove o comando quando o endpoint responde HTTP de sucesso e JSON `ok: true`.
- O envio é tentado automaticamente quando a rede volta, quando o aplicativo recebe foco e durante a sincronização manual.
- Se a conexão cair mesmo com `navigator.onLine` ainda indicando rede, o comando já está persistido na fila e não depende de detectar a queda antes do clique.

## Operações transacionais enfileiradas

- Venda (incluindo pagamento em dinheiro, cartão, Pix ou fiado na criação da venda).
- Abertura e fechamento de caixa.
- Sangria e reforço.
- Ajuste/balanço de estoque.
- Recebimento posterior de fiado (pagamento parcial ou quitação de uma venda).
- Baixa de estoque.
- Transferência de estoque.

As operações locais aparecem como pendentes até que o Neon confirme a mesma chave de idempotência. Vendas offline recebem o rótulo **VENDA SALVA OFFLINE**; não são apresentadas como concluídas pelo servidor.

## Tratamento de falhas

- Erro de rede, sessão expirada e respostas temporárias mantêm o comando pendente.
- Erro definitivo de negócio marca o comando como falho e bloqueia comandos posteriores para preservar a ordem causal.
- A sincronização manual pode solicitar nova tentativa dos comandos falhos.
- Repetir uma chamada usa o mesmo idempotencyKey; os endpoints transacionais de vendas, caixa e estoque fazem replay idempotente para evitar duplicação.
- Depois do envio, o PDV recarrega/mescla o snapshot do Neon sem descartar registros locais ainda pendentes.

## Limites desta etapa

- É necessário entrar online pelo menos uma vez neste computador e carregar o catálogo/dados da empresa.
- O modo offline restaurado é exclusivo do perfil PDV autorizado. Acesso de gerência não é restaurado sem servidor.
- Cadastro/edição/importação de catálogo, recebimento/conferência e outras rotinas que ainda usam endpoints não transacionais não fazem parte da fila offline desta etapa. Pagamentos posteriores de fiado agora usam a mesma outbox transacional, com chave de idempotência estável e replay seguro no endpoint `/api/mobflow/receivables`.
- O estoque de outros dispositivos não é conhecido enquanto este computador está desconectado. Ao reconectar, o Neon valida novamente as permissões e aplica os comandos em ordem; falhas de negócio permanecem pendentes/falhas em vez de serem descartadas.
- A fila e o snapshot do aplicativo ficam no perfil local do Windows (IndexedDB/localStorage); o contexto de autorização, por sua vez, é criptografado com Electron safeStorage. Proteja o acesso à conta do Windows.
- O build e os testes automatizados não substituem o ensaio final em um Windows real: primeiro login online, reinício sem internet, venda/caixa/estoque offline, queda durante envio, reconexão, sessão expirada e troca de empresa.

## Critério de conclusão para validação real

1. Abrir o MobFlow Desktop online, entrar como operador PDV e aguardar catálogo/snapshot carregar.
2. Fechar o aplicativo, desligar a internet e abrir novamente.
3. Confirmar que o mesmo operador e o catálogo da empresa são recuperados.
4. Abrir caixa, fazer uma venda, registrar sangria/reforço e uma movimentação de estoque suportada.
5. Fechar/reabrir o aplicativo sem internet e confirmar que os dados e pendências continuam presentes.
6. Reconectar e confirmar que cada operação aparece uma única vez no Neon e que o contador de pendências chega a zero.
7. Repetir com sessão expirada e com uma falha permanente de negócio para confirmar que a fila não descarta nem reordena comandos.
