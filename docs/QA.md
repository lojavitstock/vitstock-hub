# Vitstock Hub — ambiente local de QA

Este ambiente é descartável e foi criado para validar o módulo de Contatos
da Issue #8 sem usar Railway, Vercel, Google Contacts ou Evolution API reais.

## Pré-requisito

- Docker Desktop em execução, com `docker compose` disponível.
- Node.js e npm já usados pelo projeto.

O ambiente usa PostgreSQL local em `127.0.0.1:55432`, banco
`vitstock_qa`, e mantém o frontend em `http://localhost:3000` e a API em
`http://localhost:3001`. O `QA_MODE=true` é obrigatório e falha ao iniciar se
o banco ou a Evolution configurada não forem locais.

## Ciclo rápido

Na raiz do repositório:

```text
npm run qa:setup
npm run qa:start
```

`qa:setup` sobe somente `docker-compose.qa.yml` e aplica as migrations no
banco local. `qa:start` inicia frontend e backend com variáveis temporárias,
mock-only. Para parar os processos, use `Ctrl+C`.

## Massa determinística

```text
npm run qa:seed
npm run qa:reset
```

`qa:seed` limpa e recria a massa QA no banco local. `qa:reset` remove o volume
do PostgreSQL QA, recria o banco, aplica as migrations e executa o seed.
Nenhum desses comandos deve ser apontado para uma URL de banco remoto.

O seed cria dois tenants, administradores, um usuário operacional, contatos
com múltiplos telefones e threads, identidade `@lid`, grupo, contato arquivado,
tags, duplicidade/telefone compartilhado e dados Google simulados.

O runner gera uma credencial efêmera para `qa-admin-a@vitstock.test` durante o
seed e a grava somente em `.qa/qa-credentials.json`, ignorado pelo
Git. O wrapper `npm run test:e2e` lê esse arquivo; nenhuma senha é mantida
em código ou documentação.

## Mocks controláveis

Com o usuário administrador autenticado:

- `GET /api/qa/status` confirma `QA_MODE`, banco local e integrações mock-only;
- `POST /api/qa/google/scenario` aceita `success`, `conflict`, `rate-limit`,
  `timeout`, `sync-token-expired`, `partial` e `external-delete`;
- `POST /api/qa/evolution/inbound` injeta uma mensagem inbound local, incluindo
  JID normal, `@lid` ou grupo `@g.us`, para validar Inbox e realtime.

O mock Google retorna perfil completo (nome, telefones, e-mail, empresa,
endereço, aniversário, biografia, site e campo customizado). Os cenários
`conflict`, `rate-limit` e `timeout` simulam respectivamente HTTP 412, 429 e
504. `sync-token-expired` sinaliza full sync, `partial` devolve uma falha
parcial controlada e `external-delete` omite um contato no full sync para
simular exclusão externa.
As chamadas Evolution permitidas são somente as rotas simuladas usadas pelo
fluxo local; qualquer rota não simulada falha de forma explícita.

## Fixtures CSV

`qa/fixtures/contacts.csv` contém linhas de sucesso, atualização, duplicidade,
formatação e rejeição para o fluxo de importação. É um fixture versionado,
sem dados reais.

## Limites de segurança

- Não use `.env.local` real com `qa:start`; o script sobrescreve as variáveis
  críticas com alvos locais e valores fictícios.
- O modo QA bloqueia startup quando `DATABASE_URL` ou `EVOLUTION_API_URL`
  apontam para host não local.
- Google e Evolution reais não são acessados; não configure credenciais reais
  no ambiente QA.
- `qa:reset` é destrutivo somente para o volume PostgreSQL local do QA.
- O ambiente não é um sandbox de produção: confirme o destino antes de
  executar qualquer comando fora destes scripts.

## Verificação manual

Depois de `dev:e2e`, execute `test:e2e` ou faça login usando a credencial
efêmera criada em `.qa/qa-credentials.json` e valide no Preview
local: isolamento entre tenants, contatos Google (sync/criação/edição),
duplicidade, múltiplos telefones, grupos, contato arquivado que recebe nova
mensagem, tags e importação CSV. O resultado esperado para este ciclo é
`READY FOR HUMAN REVIEW`; a aceitação funcional final continua humana.
