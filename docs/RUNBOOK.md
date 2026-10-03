# Vitstock Hub — Runbook de Desenvolvimento

> **Fluxo de integração:** toda alteração nova começa em `feature/*`, `fix/*` ou `chore/*` baseada em `origin/preview`, salvo tarefa explicitamente diferente. O fluxo normal integra por PR em `preview` para deploy de pré-produção e teste humano; Production (`main`) recebe somente PR de `preview` após gates técnicos, validação humana e decisão explícita de promoção.
>
> Este runbook descreve procedimentos do repositório atual. Ele não autoriza deploy, merge, migrations de produção, alteração de infraestrutura ou uso de credenciais.

## Princípio de praticidade

Vitstock Hub é um projeto pequeno e pessoal. O objetivo é aplicar **o menor processo que mantenha o desenvolvimento seguro e reproduzível**.

Evite aprovações redundantes, checklists extensos, procedimentos para cenários inexistentes e duplicação com os outros documentos. O runbook deve acelerar o trabalho, não criar burocracia.

## 1. Fluxo operacional padrão

```text
Issue aberta + `codex-ready` (ou instrução direta do responsável)
  ↓
entender escopo e ler contexto necessário
  ↓
verificar Git e ambiente
  ↓
criar branch própria de origin/preview (salvo exceção explícita)
  ↓
implementar mudança pequena
  ↓
testes / checks / build aplicáveis
  ↓
revisar diff
  ↓
commits/checkpoints e push da branch própria; Draft PR quando pertinente
  ↓
PR para preview, revisão técnica e integração autorizada
  ↓
deploy Preview → READY FOR HUMAN REVIEW → validação humana
  ↓
decisão explícita de promoção → PR preview para main
```

Testes e builds aprovados demonstram validação técnica, não aprovação funcional, de UX ou de produção.

## 2. Início de uma tarefa

Antes de modificar qualquer arquivo:

1. Leia `AGENTS.md` e a instrução/Issue da tarefa.
2. Leia somente a documentação relacionada:
   - `docs/PROJECT.md` para conceitos do produto;
   - `docs/ARCHITECTURE.md` para estado e integrações;
   - este arquivo para procedimento;
   - `docs/TESTING.md`, quando existir.
3. Verifique a branch e a árvore de trabalho:

   ```powershell
   git branch --show-current
   git status
   ```

4. Execute `git fetch origin` e confirme `origin/preview` como baseline, salvo exceção explícita na tarefa. Com working tree limpa, crie uma branch `feature/<descricao>`, `fix/<descricao>` ou `chore/<descricao>` a partir dela. Se houver divergência, preserve o estado e informe o problema antes de mudar de branch.
5. Identifique os arquivos, testes e efeitos colaterais diretamente relacionados.
6. Investigue a implementação existente antes de editar. Para bugs sem causa clara, diagnostique antes de corrigir.

Nunca desenvolva diretamente em `preview` ou `main`. Reutilize uma branch existente somente para continuar trabalho explicitamente identificado, depois de verificar sua baseline; não a reutilize para uma tarefa nova.

### Fila autorizada e execução de uma Issue

`codex-ready` significa que a Issue foi revisada e está explicitamente autorizada por uma pessoa para execução pelo Codex. O Codex só inicia autonomamente uma Issue aberta com essa label; backlog, `ROADMAP.md` ou a existência de uma Issue não são autorização. O Codex não aplica a própria label. Instruções diretas do responsável continuam sendo autorização explícita fora da fila.

Trabalhe em uma única Issue autorizada por vez. Não misture escopos nem inicie a próxima automaticamente. Para cada Issue:

1. localize a Issue aberta e confirme `codex-ready`, quando o trabalho vier da fila;
2. leia a Issue e confirme o escopo e os critérios de aceite;
3. confirme `origin/preview` como baseline, salvo tarefa explicitamente diferente;
4. crie/use a branch própria, por exemplo `feature/issue-<numero>-<slug-curto>` ou `fix/issue-<numero>-<slug-curto>`;
5. investigue o código e implemente a menor mudança verificável;
6. execute os checks aplicáveis de `docs/TESTING.md`;
7. faça o self-review do diff e confirme que não há mudanças fora do escopo;
8. crie commits/checkpoints, envie cedo somente a branch da Issue e prepare PR para `preview`; features/fixes significativos podem abrir Draft PR antes da conclusão;
9. remova `codex-ready` após criar a Pull Request e mantenha a Issue aberta;
10. forneça o plano de validação manual e pare em **READY FOR HUMAN REVIEW**.

Não faça merge nesta etapa. Uma nova Issue exige nova autorização humana.

## 3. Alterações já existentes

Se `git status` indicar mudanças que não pertencem à tarefa:

- não sobrescreva, faça reset, descarte ou inclua essas mudanças silenciosamente;
- não faça stash automaticamente;
- identifique os arquivos afetados e, se necessário, peça orientação antes de tocar em área sobreposta;
- mantenha o commit da tarefa limitado aos seus próprios arquivos.

O objetivo é preservar trabalho preexistente, mesmo quando ele parecer incompleto.

## 4. Política de branches e Git

- Nunca desenvolva ou faça commit diretamente em `preview` ou `main`.
- Para trabalho novo, use `feature/<descricao>`, `fix/<descricao>` ou `chore/<descricao>` a partir de `origin/preview`, salvo tarefa explicitamente diferente.
- O fluxo normal não usa push direto para `preview` ou `main`; integrações e promoções ocorrem por PR.
- Nunca use `git push --force` em branch compartilhada.
- Nunca reescreva histórico compartilhado ou exclua branch remota sem autorização explícita.
- Enquanto não for necessário teste humano oficial, mantenha o trabalho na branch de desenvolvimento.
- Integração em `preview` exige revisão e autorização. Promoção para `main` exige gates técnicos, validação humana no Preview e decisão explícita.

O modelo de branches é:

```text
feature/*, fix/*, chore/*
  → PR e integração autorizada em preview
  → deploy de pré-produção e validação humana
  → decisão explícita de promoção e PR preview → main (Production)
```

### Draft PR e checkpoint remoto

Publique cedo features/fixes significativos na branch própria; um Draft PR para `preview` pode ser aberto ainda durante o desenvolvimento. Ele mantém checkpoint remoto, diff visível, CI, continuidade entre computadores e espaço para revisão. Não é aprovação funcional nem autorização automática de merge ou deploy.

Nenhuma sessão deve terminar com trabalho relevante existindo somente localmente. Antes de encerrar ou trocar de computador:

1. revise o diff e execute a validação proporcional; exclua secrets e arquivos fora do escopo;
2. adicione somente os arquivos relevantes e crie um commit/checkpoint na branch própria, mesmo que o trabalho ainda esteja incompleto;
3. envie a branch ao GitHub e faça `git fetch origin`;
4. compare `git rev-parse HEAD` e `git rev-parse origin/<branch-de-trabalho>` para confirmar a publicação do checkpoint; se os refs diferirem, investigue sem force;
5. deixe a working tree limpa ou documente um estado explicitamente preservado, incluindo localização e forma de recuperação das pendências.

Um commit só local, um Draft PR sem os últimos commits ou um diff não publicado não satisfazem esse checkpoint. Preservar trabalho local preexistente pode exigir uma tarefa explícita de checkpoint; não o descarte nem misture com outra tarefa.

### Sincronização em outro computador

Comece por leitura e atualização de refs:

```powershell
git fetch origin
git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git rev-parse origin/<branch-de-trabalho>
git rev-list --left-right --count <branch-de-trabalho>...origin/<branch-de-trabalho>
```

Na contagem, o primeiro número é ahead local e o segundo é behind. Se houver alterações locais, commits exclusivos ou divergência, pare, registre e preserve o estado. Não use reset, rebase, force, clean, restore ou stash automático como reação para resolver diferenças.

Com working tree limpa, remoto oficial confirmado e branch local sem commits exclusivos, use `git switch <branch-de-trabalho>` e confira novamente branch e ahead/behind. Se a branch local não existir, crie tracking com `git switch --track origin/<branch-de-trabalho>` depois de confirmar o ref remoto. Não sincronize `main` quando a tarefa for de Preview ou de outra branch.

Somente com branch correta, ahead=0 e sem divergência:

```powershell
git pull --ff-only origin <branch-de-trabalho>
git rev-parse HEAD
git rev-parse origin/<branch-de-trabalho>
git status --short
```

Se já estiver alinhada, nenhum pull é necessário. Se o fast-forward falhar, preserve o estado e diagnostique; não gere merge ou rebase automático. Pull não recupera commits que nunca foram enviados pelo outro computador.

### Encerramento e limpeza de branches

Não apague `feature/*`, `fix/*` ou `chore/*` apenas por serem antigas. A remoção exige autorização e todas estas evidências:

1. PR mergeado no destino correto;
2. nenhum commit exclusivo local ou remoto;
3. trabalho validado no estágio apropriado, incluindo Preview humano quando aplicável;
4. nenhuma necessidade razoável de recuperação ou referência pendente.

Atualize refs com `git fetch origin` e consulte o estado do PR. Compare a branch local com sua remota (`git log origin/<branch>..<branch>`) e revise `git cherry -v origin/preview <branch>` e `git cherry -v origin/preview origin/<branch>`. Qualquer linha `+` indica mudança exclusiva e bloqueia a remoção. Merge por squash pode manter SHAs diferentes; confirme também o diff e o PR, sem presumir exclusividade ou segurança apenas pelos nomes dos commits.

Depois do encerramento, prefira remover as cópias local e remota. Fora da branch alvo, use `git branch -d <branch>` e, após a confirmação remota, `git push origin --delete <branch>`. Se `-d` recusar, pare e investigue; não use `-D` automaticamente. Preserve checkpoints enquanto ainda forem necessários para revisão ou recuperação.

## 5. Dependências

O repositório possui dois projetos Node independentes, ambos com lockfile:

| Área | Manifesto | Instalação reproduzível | Quando usar |
| --- | --- | --- | --- |
| Frontend / raiz | `package.json` e `package-lock.json` | `npm ci` | Primeiro preparo, `node_modules` ausente ou sincronização estrita com o lockfile. |
| Backend | `server/package.json` e `server/package-lock.json` | `npm --prefix server ci` | Mesmo caso, mas somente para o backend. |

Use `npm install` (ou `npm --prefix server install`) apenas quando uma tarefa autorizada efetivamente alterar dependências. Documentação, análise e revisão não devem reinstalar pacotes.

## 6. Arquivos e variáveis de ambiente

| Arquivo | Papel |
| --- | --- |
| `.env.example` | Modelo versionado de variáveis, sem valores reais. |
| `.env.local` | Configuração local real; não é versionada. |
| `server/src/config.ts` | Validação e normalização da configuração de runtime do backend. |

O backend carrega `.env.local` da raiz e também aceita um `.env.local` dentro de `server/`, sem sobrescrever valores já definidos. Arquivos reais `.env`/ `.env.local` não devem ser commitados ou copiados para logs, Issues, PRs ou documentação.

Configurações reais `.env`, `.env.*`, `*.local` e credenciais ficam fora do Git. Somente modelos como `.env.example` e `.env.e2e.preview.example`, sem valores sensíveis, são versionados. Secrets precisam de estratégia separada de armazenamento/sincronização em mecanismo seguro autorizado; Git não transporta esses valores entre computadores. Bancos Docker e outros artefatos ignorados também exigem preparo separado.

Variáveis `VITE_*` já representadas no modelo, como `VITE_API_URL` e `VITE_USE_MOCK_DATA`, são públicas no bundle. Nunca coloque segredos nelas.

Segredos e integrações pertencem ao backend: `DATABASE_URL`, `SESSION_SECRET`, `WEBHOOK_SECRET`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, credenciais Google OAuth e as origens autorizadas pelo backend. `BACKEND_PUBLIC_URL` identifica a URL pública da API usada pelo self-heal do webhook; em ambientes legados, o backend aceita `VITE_API_URL` como fonte de compatibilidade.

### Local não é necessariamente sandbox

`localhost` **não** significa que banco, Evolution API ou WhatsApp sejam locais. O script local inicia processos no computador, mas `.env.local` pode apontar para serviços externos.

Antes de uma ação capaz de enviar WhatsApp, modificar dados, criar usuários, sincronizar contatos, alterar Evolution API ou executar migration, confirme — sem expor segredos — quais serviços estão configurados como destino. Leitura de código, testes unitários isolados, type checking e build não precisam dessa verificação adicional quando não acessam serviços externos.

## 7. Executar localmente

| Comando | O que inicia / executa |
| --- | --- |
| `npm run dev:local` | Backend e Vite juntos pelo `scripts/dev-local.mjs`. |
| `npm run dev` | Backend e Vite juntos pelo `scripts/dev-local.mjs`. |
| `npm run dev:frontend` | Apenas Vite. |
| `npm run server:dev` | Apenas backend, delegando para `server` com `tsx watch`. |
| `npm run preview` | Servidor de preview do build Vite. |
| `npm run dev:e2e` | Prepara PostgreSQL QA local, executa migrations/seed QA e inicia backend QA + Vite com mocks externos. Requer Docker acessível. |
| `npm run test:e2e` | Executa Playwright Chromium após confirmar frontend local e marcador QA com Evolution/Google mock-only. |
| `npm run qa:stop` | Para os containers QA sem remover o volume. |

`npm run dev:local` configura interface em `http://localhost:3000` e API em `http://localhost:3001`. Ele injeta `VITE_API_URL=http://localhost:3001`, `FRONTEND_URL=http://localhost:3000`, `NODE_ENV=development` e `PORT=3001` para os processos que inicia.

Para trabalho separado, inicie backend com `npm run server:dev` e Vite com `npm run dev:frontend`, garantindo ambiente coerente. O Fastify escuta em `0.0.0.0` e recebe a porta por `PORT` (padrão 3001).

Não inicie servidores apenas por rotina em tarefa que não exige execução local.

O fluxo E2E não usa `.env.local` como fallback: `dev:e2e` injeta explicitamente `QA_MODE=true`, PostgreSQL `127.0.0.1:55432/vitstock_qa`, Evolution mock e Google mock. Se o guard rail não confirmar esses destinos, o processo aborta antes de iniciar a aplicação.

O `dev:e2e` gera uma credencial efêmera para o usuário sintético e a grava somente em `.qa/qa-credentials.json`, ignorado pelo Git. Não há senha QA fixa no repositório.

## 8. Banco de dados e migrations

O projeto usa PostgreSQL. Migrations versionadas estão em `server/migrations/` e são executadas por `server/src/scripts/migrate.ts`.

O runner:

1. cria `schema_migrations` se necessário;
2. lê arquivos `.sql` em ordem de nome;
3. ignora nomes já registrados;
4. executa cada migration e seu registro dentro de uma transação;
5. faz rollback daquela migration quando ela falha.

Comandos reais:

```powershell
# Na raiz do repositório
npm run server:migrate

# Dentro de server/
npm run migrate
```

Executar migration modifica o banco. Só o faça quando a tarefa autorizar e depois de confirmar ambiente seguro. O seed também modifica dados e não deve ser usado automaticamente:

```powershell
npm run server:seed-admin
```

### Segurança de migrations

`server/railway.json` executa `node dist/scripts/migrate.js` como `preDeployCommand` antes de um deploy Railway aprovado. Uma alteração de schema tem risco ampliado mesmo que o agente não execute migration manualmente.

Uma entrega/PR com migration deve informar:

- arquivo e motivo;
- tabelas/colunas afetadas;
- compatibilidade com código existente;
- impacto e risco dos dados;
- recuperação ou rollback, quando aplicável;
- plano de validação.

Agentes nunca executam migrations manualmente em produção. Merge e deploy continuam sob autoridade humana.

## 9. Testes e validação técnica

### Testes existentes

```powershell
npm test
```

O comando usa o Node test runner por `tests/run-tests.mjs` e executa a suíte principal definida no `package.json`, cobrindo regressões de núcleo, backend, webhook, QA, grupos, contatos e metadata. O conjunto exato acompanha o script e o runner versionados, em vez de ser duplicado neste procedimento.

Não existe script de lint no `package.json` atual. Não invente um comando de lint; registre essa limitação se uma tarefa exigir validação equivalente.

### Frontend

```powershell
npm run build
```

O comando executa `tsc && vite build`. Para mudança frontend, este é o check mínimo quando aplicável.

### Backend

```powershell
npm --prefix server run check
npm --prefix server run build
```

O primeiro faz type check sem emitir arquivos; o segundo compila o backend para `server/dist`.

### Matriz mínima

| Tipo de alteração | Testes | Build frontend | Check/build backend |
| --- | --- | --- | --- |
| Documentação | Normalmente não necessário; revisar links e diff | Não necessário | Não necessário |
| Frontend isolado | Testes relacionados quando existirem | Sim | Só se contrato/API for afetado |
| Backend isolado | Testes relacionados quando existirem | Só se contrato/API for afetado | Sim |
| Frontend + backend | Sim | Sim | Sim |
| Migration | Testes aplicáveis e revisão SQL | Se aplicável | Sim, mais análise de impacto |

Se teste ou build falhar, determine se a causa veio da alteração atual. Corrija regressões dentro do escopo. Se a falha for preexistente, registre evidência; não modifique testes apenas para escondê-la.

Quando `docs/TESTING.md` existir, use-o para a estratégia detalhada. Este runbook mantém apenas o procedimento operacional.

## 10. Revisar o diff

Antes de commit:

```powershell
git status
git diff
git diff --cached
git diff --check
```

Procure por arquivos inesperados, segredos, `.env` reais, logs/debug não solicitado, configuração/dependência/lockfile acidental, migration não documentada e mudanças fora do escopo.

## 11. Diagnóstico e falhas

Use: **diagnosticar → confirmar causa → corrigir → validar**. Evite ciclos de suposição e tentativa repetida.

O Atendimento possui diagnósticos opt-in:

- `VITE_SCROLL_TRACE=true` emite `[SCROLL_TRACE]` para eventos relevantes de timeline;
- `VITE_OUTBOUND_TRACE=true` e `OUTBOUND_TRACE=true` medem etapas de envio sem registrar conteúdo de mensagem.

Use-os somente quando a tarefa permitir instrumentação e mantenha-os desativados no fluxo normal.

### Falha de teste ou build

Identifique a causa; corrija se estiver no escopo; documente evidência se for preexistente. Não esconda falhas e não declare a alteração pronta se ela introduziu a regressão.

### Backend indisponível

Não assuma que o código está errado. Quando seguro, verifique configuração local e health; não altere Railway, banco ou infraestrutura sem autorização.

### Evolution API indisponível

Diferencie falha da aplicação de falha do provider. Não desconecte, faça logout, resete instância ou gere QR automaticamente. Informe a evidência e aguarde autorização para ações externas.

### Working tree suja

Preserve as alterações; não use reset ou stash automático. Identifique origem e peça orientação se houver sobreposição com a tarefa.

### Preview indisponível

Informe o impedimento e não declare validação funcional. Em erro de CORS/origin, diagnostique a origem e a regra bloqueadora; alterações de Railway, Vercel ou `ALLOWED_FRONTEND_ORIGINS` exigem autorização específica.

### Não “corrigir o ambiente” automaticamente

Quando ferramenta, serviço ou configuração externa estiver indisponível, primeiro diagnostique e informe. Não reinstale ferramentas, altere Railway/Vercel, resete banco ou Evolution, troque secrets ou modifique infraestrutura como tentativa automática de resolver o problema.

## 12. Commit, push e Pull Request

### Commit

Faça commits/checkpoints pequenos para preservar trabalho relevante dentro do escopo autorizado, inclusive antes de encerrar uma sessão ou trocar de computador. Antes, execute a validação proporcional, revise o diff e confirme que não há segredo ou arquivo fora do escopo.

Use Conventional Commits claros:

```text
fix(atendimento): corrigir posição do indicador de novas mensagens
feat(crm): adicionar campo de origem do contato
refactor(inbox): preservar identidade durante reconciliação
```

Não misture mudanças não relacionadas no mesmo commit.

### Push

Publique cedo a branch própria e confirme o checkpoint em `origin`, conforme o procedimento da seção 4 e o escopo autorizado. O fluxo normal não usa push direto para `preview` ou `main`, nem force push em histórico compartilhado.

### Pull Request / entrega para revisão

Para a revisão de um PR para `preview`, prepare:

```text
## Problem
## Root Cause
## Solution
## Files Changed
## Validation
## Risks
## Manual Test Plan
```

Para migrations, acrescente `## Migration Impact`. Em alterações sensíveis de Atendimento, destaque somente áreas aplicáveis: Inbox, mensagens, SSE, polling, scroll, atualização otimista e conexão WhatsApp.

## 13. Preview e validação humana

Preview é o ambiente oficial de integração, deploy de pré-produção e teste humano antes da promoção para `main`:

```text
branch própria → PR → revisão e integração autorizada em preview → deploy
→ READY FOR HUMAN REVIEW → validação humana
→ decisão explícita de promoção → PR preview para main
```

O agente pode confirmar implementação, checks executados e a existência de Preview quando observável. Não pode confirmar sozinho aprovação funcional, UX, integração ou prontidão para produção.

Um Preview pode precisar ser incluído explicitamente em `ALLOWED_FRONTEND_ORIGINS` no backend Railway para usar cookies e API. Se falhar por CORS/origin:

1. diagnostique a origem e a regra bloqueadora;
2. informe a origem que precisaria ser autorizada;
3. aguarde autorização para qualquer alteração externa.

## 14. Fluxo de execução

O fluxo operacional normal do projeto é:

```text
Issue aberta + `codex-ready` (ou instrução direta do responsável)
↓
Codex
↓
implementação
↓
validação técnica
↓
revisão do diff
↓
checkpoint remoto e PR para preview
↓
revisão e integração autorizada em preview
↓
deploy Preview → READY FOR HUMAN REVIEW
↓
validação humana
↓
decisão explícita de promoção → PR preview para main
```

O Codex é atualmente o único agente automatizado autorizado nesse fluxo. Ferramentas auxiliares futuras dependerão de autorização humana explícita e não recebem autoridade automática para merge, deploy, produção, migrations de produção ou secrets.

## 15. Ready for Human Review

Uma tarefa chega a **READY FOR HUMAN REVIEW** quando, conforme aplicável:

- escopo implementado sem alterações não relacionadas;
- testes, checks e builds relevantes passaram;
- diff revisado;
- documentação necessária atualizada;
- branch correta;
- trabalho relevante commitado e publicado na branch própria, com checkpoint confirmado em `origin`;
- PR criado/atualizado quando solicitado, podendo ser Draft durante o desenvolvimento;
- riscos e pendências informados;
- plano objetivo de teste manual fornecido.

Não use apenas `DONE`: aprovação funcional continua sendo humana.

Integração da branch em `preview` e promoção para `main` são decisões distintas. Após gates técnicos e validação humana no Preview, a promoção só ocorre por PR de `preview` para `main` e decisão explícita. Registre a validação e feche a Issue quando apropriado; remova branches somente pelo procedimento da seção 4. **READY FOR HUMAN REVIEW** nunca implica merge automático.

### Relatório final

Ao entregar uma tarefa, use de forma concisa:

```text
READY FOR HUMAN REVIEW
Issue:
Branch:
Baseline:
Diagnóstico:
Arquivos alterados:
Mudança:
Validação técnica:
Commit:
PR:
Manual Test Plan:
Riscos/observações:
```

## 16. Modelo de Manual Test Plan

```text
Manual Test Plan

Environment:
Vercel Preview

Steps:
1. ...
2. ...
3. ...

Expected:
- ...
- ...

Regression checks:
- ...
```

Para Atendimento, inclua Inbox, timeline, mensagens, SSE/polling, scroll, atualização otimista ou conexão apenas quando a mudança afetar esses fluxos.

## 17. Referência rápida de comandos confirmados

### Bling foundation — gate separado de OAuth real

Runtime é API v3/OAuth, nunca MCP. Configure somente no backend e somente após
revisão/autorização separada: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`,
`BLING_REDIRECT_URI`, `INTEGRATION_ENCRYPTION_KEY`. A chave é independente,
32 bytes criptograficamente aleatórios em base64; preserve-a em armazenamento
seguro, não no Git. Perder/trocar a chave exige reconectar os tenants existentes.
Callback cadastrado no app Bling deve corresponder ao env, terminar em
`/api/integrations/bling/callback` e usar HTTPS fora de QA. Não copiar credenciais
Production para Preview. Envs incompletos/chave inválida/callback inválido
desabilitam a conexão sem impedir o backend de iniciar. Preserve a mesma chave
por ambiente durante redeploys; não gere uma nova chave a cada deployment.
O pool Bling acrescenta no máximo uma conexão por processo ao pool Hub existente
(default quatro); considerar esse total e deploys sobrepostos no limite Railway.
Falha da troca de token mantém state consumido: iniciar um novo Conectar.
Token POST usa apenas grant_type/code ou grant_type/refresh_token; redirect_uri
é compatível no authorize, mas o Bling usa o callback cadastrado no aplicativo.

Migration `022_bling_integration.sql` é aditiva (três tabelas da integração),
sem alteração de produtos/contatos/mensagens. Validar somente pelo harness QA
local. Railway aplicará pelo runner existente apenas em deployment posteriormente
aprovado; este desenvolvimento não autoriza aplicar em Preview/Production.
Recuperação lógica, por operador autorizado: desabilitar env Bling/reverter código
sem remover tabelas; remoção posterior das três tabelas perde vínculos/states/
budget mas não afeta catálogo local. Não apagar a migration de controle em uso.

Primeiro OAuth real: gate separado, humano ADMIN no Preview, conferir contrato
de token/JWT divergente nos exemplos oficiais, status sanitizado, leitura de uma
página/produto/depósito/estoque e desconexão. Nunca scan completo, sync, pedidos,
webhooks, importação de imagens ou alteração da Product Library. Não registrar
codes/tokens nem anexar HAR/trace contendo callback/credenciais. Desconectar no
Hub não revoga o app na conta Bling; revogação é feita separadamente no provider.
401 persistente exige reconectar; não repetir token POST automaticamente após
timeout, pois uma rotação pode ter ocorrido. Não promover só por testes verdes.

```powershell
# Git (leitura e revisão)
git status
git branch --show-current
git diff
git diff --cached
git diff --check

# Desenvolvimento local
npm run dev:local
npm run dev
npm run server:dev

# Testes e build do frontend
npm test
npm run build

# Validação do backend
npm --prefix server run check
npm --prefix server run build
```

Antes de comando que modifique dados, serviços ou infraestrutura, confirme a autorização e o ambiente de destino.
