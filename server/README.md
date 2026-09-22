# Vitstock Hub API

Backend privado do Vitstock Hub. Todas as credenciais da Evolution API e do PostgreSQL devem existir somente neste serviço.

## Desenvolvimento

1. Configure as variáveis no `.env.local` da raiz.
2. Instale as dependências reproduzivelmente com `npm ci` nesta pasta.
3. Em um banco local explicitamente autorizado, execute `npm run migrate`. Esse comando modifica o banco; nunca o aponte para Production ou Preview.
4. Em um ambiente local autorizado, execute `npm run seed:admin` uma única vez.
5. Inicie com `npm run dev`.

## Produção no Railway

- Start command: `npm run start`
- Build command: `npm ci && npm run build`
- O Railway executa `node dist/scripts/migrate.js` como `preDeployCommand` antes de iniciar o serviço.
- Não execute migrations manualmente em Production como passo normal do deploy; qualquer operação manual exige tarefa autorizada e confirmação explícita do ambiente.
- Nunca use prefixo `VITE_` em segredos do backend.
