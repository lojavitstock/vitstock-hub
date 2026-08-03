# Vitstock Hub

## Testar localmente antes de publicar

O ambiente local usa a interface e o backend executados no computador. O banco PostgreSQL e a Evolution API continuam usando os serviços configurados no `.env.local`.

```powershell
npm.cmd run dev:local
```

Depois, acesse [http://localhost:3000](http://localhost:3000). Para encerrar os dois serviços, pressione `Ctrl+C` no terminal.

Alterações testadas dessa forma não são publicadas no Vercel. O deploy só acontece quando a mudança é enviada e mesclada na branch `main` do GitHub.
