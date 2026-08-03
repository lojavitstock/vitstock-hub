# Vitstock Hub API

Backend privado do Vitstock Hub. Todas as credenciais da Evolution API e do PostgreSQL devem existir somente neste serviço.

## Desenvolvimento

1. Configure as variáveis no `.env.local` da raiz.
2. Instale as dependências com `npm install` nesta pasta.
3. Execute `npm run migrate`.
4. Execute `npm run seed:admin` uma única vez.
5. Inicie com `npm run dev`.

## Produção no Railway

- Start command: `npm run start`
- Build command: `npm install && npm run build`
- Antes do primeiro deploy, execute as migrações e crie o administrador inicial.
- Nunca use prefixo `VITE_` em segredos do backend.
