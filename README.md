# Vitstock Hub

Plataforma interna da Vitstock para atendimento via WhatsApp, Inbox compartilhada,
contatos, operações comerciais e integrações.

## Arquitetura

- Frontend React + Vite em `http://localhost:3000`.
- Backend Node.js + Fastify em `http://localhost:3001`.
- PostgreSQL, Evolution API, Google Contacts/OAuth e SSE.
- Playwright para QA local e Preview remoto.
- Vercel hospeda o frontend; Railway hospeda o backend e serviços associados.

Consulte [AGENTS.md](AGENTS.md), `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md` e
`docs/TESTING.md` para as regras e procedimentos completos.

## Pré-requisitos

O fluxo de referência usa Windows 11 e PowerShell. Instale Git, Node.js/npm
compatíveis com os lockfiles e Docker Desktop com o daemon Linux/WSL2 para QA.
O repositório não fixa versões de Node.js, npm ou Docker em `package.json`.

## Primeiro PC

Use a URL real de `origin`:

```powershell
git clone https://github.com/lojavitstock/vitstock-hub.git
cd vitstock-hub
git fetch --all
```

`main` é a linha estável/produção, `preview` é a integração e o trabalho
deve ocorrer em branch própria (`codex/...`, `feature/...` ou `fix/...`).
Confirme a baseline antes de começar; não assuma `main`.

```powershell
npm ci
npm --prefix server ci
npx playwright install chromium
```

## Desenvolvimento local normal

```powershell
npm run dev:local
```

Esse comando inicia frontend e backend nas portas 3000/3001. O backend pode
usar integrações definidas no `.env.local`; portanto este modo não é E2E
isolado e nunca deve usar Production como fallback de QA.

## QA local

O ambiente QA é exclusivamente local:

```text
QA_MODE=true
PostgreSQL 127.0.0.1:55432/vitstock_qa
Evolution mock + Google mock
Frontend localhost:3000
Backend localhost:3001
```

Os guards abortam se esses limites não forem confirmados. Com Docker disponível:

```powershell
docker info
npm run dev:e2e
```

O wrapper inicia PostgreSQL QA, aplica migrations/seed QA e mantém backend e
frontend ativos. Em outro terminal execute:

```powershell
npm run test:e2e
```

Encerre o wrapper com `Ctrl+C`; para parar o Compose QA depois, use:

```powershell
npm run qa:stop
```

Também existem `npm run qa:setup`, `npm run qa:seed`, `npm run qa:reset` e
`npm run qa:start`. Nunca aponte esses comandos para banco remoto.

## Preview

`preview` é a branch oficial de integração:

```text
Vercel Preview → Railway Preview → PostgreSQL Preview
                              → Evolution Preview
                              → Google OAuth Preview
```

URLs atuais:

- Frontend: <https://vitstock-hub-git-preview-vitstocks-projects.vercel.app>
- Backend: <https://vitstock-hub-api-preview.up.railway.app>

Preview nunca pode utilizar banco, Redis, Evolution, backend ou callback Google
de Production.

## Preview E2E

O arquivo `.env.e2e.preview.example` é uma referência versionada. Crie a cópia
local no PowerShell e preencha somente na máquina:

```powershell
Copy-Item .env.e2e.preview.example .env.e2e.preview.local
```

Variáveis necessárias: `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_EMAIL`,
`E2E_PASSWORD` e `PLAYWRIGHT_BASE_URL`. Nunca publique ou imprima seus valores.
O usuário E2E existe apenas no PostgreSQL Preview.

```powershell
npm run test:e2e:preview
```

O teste deve passar sem `console.error` inesperado, `pageerror` ou requests
para Production. Preview E2E complementa, mas não substitui, o QA local.

## Google OAuth

Production e Preview usam clientes separados. O cliente Preview é `Vitstock Hub
Preview` e usa:

<https://vitstock-hub-api-preview.up.railway.app/api/google/callback>

Não documente Client IDs, Client Secrets ou tokens reais.

## Fluxo Git e dois PCs

```text
branch própria → QA local + Playwright → PASS/regressão → commit/push
→ preview → E2E Preview quando necessário → revisão humana → merge humano
```

O Codex entrega em **READY FOR HUMAN REVIEW**; não faz merge automático.

Primeira configuração em outro PC:

```powershell
git clone https://github.com/lojavitstock/vitstock-hub.git
cd vitstock-hub
npm ci
npm --prefix server ci
git fetch --all
git checkout <branch-de-trabalho>
```

PC já configurado:

```powershell
git status
git fetch --all
git checkout <branch-de-trabalho>
git pull
```

Antes de trocar de máquina, faça `git status`, commit autorizado e `git push`.
Git não sincroniza `.env.local`, `.env.e2e.preview.local`, credenciais, bancos
Docker ou `.qa/qa-credentials.json`.

## Checks confirmados

| Objetivo | Comando |
| --- | --- |
| Testes do projeto | `npm test` |
| TypeScript + build frontend | `npm run build` |
| TypeScript backend | `npm --prefix server run check` |
| Build backend | `npm --prefix server run build` |
| E2E local | `npm run dev:e2e` + `npm run test:e2e` |
| E2E Preview | `npm run test:e2e:preview` |
| Diff | `git diff --check` |

Não existe script de lint; não use `npm run lint`.

## Segurança

Nunca versione `.env.local` ou `.env.e2e.preview.local`, secrets Google,
Evolution ou sessão. Não execute seed, migrations manuais, E2E, envio de
mensagens ou alteração de sessão contra Production. Preview deve permanecer
isolado de Production.

## Troubleshooting

### Docker

Execute `docker info`. Se o servidor não responder, abra o Docker Desktop e
aguarde o engine Linux/WSL2 antes de iniciar QA. Não remova volumes nem use
`docker system prune` como diagnóstico.

### Portas 3000 e 3001

O frontend QA usa `3000` com `strictPort`; o backend usa `3001`. Investigue
uma porta ocupada antes de encerrar qualquer processo:

```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -State Listen
```

Não altere as portas do QA para apontar para outro ambiente.

### Playwright e Preview protegido

Depois de `npm ci`, use `npx playwright install chromium` se necessário. Para
Preview, `npm run test:e2e:preview` injeta o Automation Bypass somente no host
Preview autorizado; o valor nunca deve ser documentado ou impresso.

Se o login E2E falhar, confirme que `E2E_EMAIL` e `E2E_PASSWORD` vêm do arquivo
local ignorado e que o usuário existe somente no PostgreSQL Preview. Não faça
seed contra Production.

## Quick Start — PC novo

```powershell
git clone https://github.com/lojavitstock/vitstock-hub.git
cd vitstock-hub
npm ci
npm --prefix server ci
npx playwright install chromium
git fetch --all
git checkout <branch-de-trabalho>
docker info
npm run dev:e2e
npm run test:e2e
```

## Quick Start — PC já configurado

```powershell
git status
git fetch --all
git checkout <branch-de-trabalho>
git pull
npm run dev:e2e
npm run test:e2e
```

## Checklist de um PC novo

- [ ] Git, Node.js/npm e Docker Desktop instalados
- [ ] Repositório clonado e branch correta confirmada
- [ ] `npm ci` e `npm --prefix server ci` concluídos
- [ ] Chromium do Playwright instalado
- [ ] Docker respondendo
- [ ] QA local PASS
- [ ] Playwright local PASS
- [ ] `.env.e2e.preview.local` configurado somente se Preview E2E for necessário
- [ ] Preview E2E PASS quando a integração real fizer parte da tarefa

Para procedimentos operacionais, consulte `docs/RUNBOOK.md` e `docs/TESTING.md`.
