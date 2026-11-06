# MobFlow PDV — verificação do ambiente Neon de teste

Data: 06/11/2026  
Projeto: `mobflow-pdv-test`  
Project ID: `square-haze-51319178`  
Branch: `integration-test`  
Branch ID: `br-wandering-union-bd6vcsk6`

## Verificações somente leitura

- Projeto existe e está ativo.
- Região: `aws-us-east-2`.
- A branch `integration-test` está pronta e é a branch principal/default do projeto de teste.
- Consulta de tabelas no banco padrão retornou lista vazia: não há tabelas de aplicação presentes nesta branch.
- `get_realtime` retornou `enabled=false` e `pending=false`.
- Nenhuma configuração de Realtime foi habilitada ou alterada.
- Nenhuma migração/schema ou dado do Supabase foi importado nesta verificação.

## Interpretação

O ambiente continua sendo uma base isolada sem schema de aplicação, adequada para receber uma futura preparação controlada após aprovação do plano. A região `aws-us-east-2` coincide com uma das regiões documentadas para Neon Realtime beta, mas isso não significa que Realtime esteja ativo ou validado.

O fato de o banco estar sem tabelas foi confirmado por consulta de metadados do próprio Neon; não inferir ausência de todo o armazenamento interno do serviço a partir dessa consulta.

## Limites

Somente metadados e listagem de tabelas foram consultados. Nenhuma escrita SQL, criação de tabela, importação, ativação de serviço, alteração de segredo ou deploy foi executado.
