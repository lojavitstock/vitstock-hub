# Vitstock Hub — Runbook de Desenvolvimento

> **Baseline atual:** use a branch de desenvolvimento explicitamente indicada pela tarefa como baseline de implementação. No ciclo documentado no momento, a branch é `codex/perf-atendimento-inbox`; ela pode conter mudanças que ainda não existem em `main`.
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
implementar mudança pequena
  ↓
testes / checks / build aplicáveis
  ↓
revisar diff
  ↓
commit e push, quando autorizados
  ↓
READY FOR HUMAN REVIEW
  ↓
Preview e validação humana
  ↓
merge humano
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

4. Se a tarefa indicar uma branch, use-a como baseline. Não troque de branch automaticamente quando houver divergência: informe o problema.
5. Identifique os arquivos, testes e efeitos colaterais diretamente relacionados.
6. Investigue a implementação existente antes de editar. Para bugs sem causa clara, diagnostique antes de corrigir.

Não é necessário criar branch nova quando a tarefa já atribui uma. Nunca trabalhe diretamente em `main`.

### Fila autorizada e execução de uma Issue

`codex-ready` significa que a Issue foi revisada e está explicitamente autorizada por uma pessoa para execução pelo Codex. O Codex só inicia autonomamente uma Issue aberta com essa label; backlog, `ROADMAP.md` ou a existência de uma Issue não são autorização. O Codex não aplica a própria label. Instruções diretas do responsável continuam sendo autorização explícita fora da fila.

Trabalhe em uma única Issue autorizada por vez. Não misture escopos nem inicie a próxima automaticamente. Para cada Issue:

1. localize a Issue aberta e confirme `codex-ready`, quando o trabalho vier da fila;
2. leia a Issue e confirme o escopo e os critérios de aceite;
3. confirme a baseline indicada, sem assumir `main`;
4. crie/use `codex/issue-<numero>-<slug-curto>` a partir da baseline confirmada;
5. investigue o código e implemente a menor mudança verificável;
6. execute os checks aplicáveis de `docs/TESTING.md`;
7. faça o self-review do diff e confirme que não há mudanças fora do escopo;
8. crie commit, faça push somente da branch da Issue e prepare a Pull Request contra a baseline correta, quando solicitado;
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

- Nunca faça commit, push ou merge direto em `main`.
- Use a branch atribuída pela tarefa. Se não houver uma, crie uma branch descritiva somente quando necessário, preferencialmente `codex/<tipo>-<descricao>`.
- Nunca use `git push --force` em branch compartilhada.
- Nunca reescreva histórico compartilhado ou exclua branch remota sem autorização explícita.
- O merge depende de aprovação humana após Preview e validação funcional.

`codex/perf-atendimento-inbox` é a baseline deste ciclo atual, não uma regra permanente de nomenclatura ou fluxo.

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

Variáveis `VITE_*` já representadas no modelo, como `VITE_API_URL` e `VITE_USE_MOCK_DATA`, são públicas no bundle. Nunca coloque segredos nelas.

Segredos e integrações pertencem ao backend: `DATABASE_URL`, `SESSION_SECRET`, `WEBHOOK_SECRET`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, credenciais Google OAuth e as origens autorizadas pelo backend.

### Local não é necessariamente sandbox

`localhost` **não** significa que banco, Evolution API ou WhatsApp sejam locais. O script local inicia processos no computador, mas `.env.local` pode apontar para serviços externos.

Antes de uma ação capaz de enviar WhatsApp, modificar dados, criar usuários, sincronizar contatos, alterar Evolution API ou executar migration, confirme — sem expor segredos — quais serviços estão configurados como destino. Leitura de código, testes unitários isolados, type checking e build não precisam dessa verificação adicional quando não acessam serviços externos.

## 7. Executar localmente

| Comando | O que inicia / executa |
| --- | --- |
| `npm run dev:local` | Backend e Vite juntos pelo `scripts/dev-local.mjs`. |
| `npm run dev` | Apenas Vite. |
| `npm run server:dev` | Apenas backend, delegando para `server` com `tsx watch`. |
| `npm run preview` | Servidor de preview do build Vite. |
| `npm run dev:e2e` | Prepara PostgreSQL QA local, executa migrations/seed QA e inicia backend QA + Vite com mocks externos. Requer Docker acessível. |
| `npm run test:e2e` | Executa Playwright Chromium após confirmar frontend local e marcador QA com Evolution/Google mock-only. |
| `npm run qa:stop` | Para os containers QA sem remover o volume. |

`npm run dev:local` configura interface em `http://localhost:3000` e API em `http://localhost:3001`. Ele injeta `VITE_API_URL=http://localhost:3001`, `FRONTEND_URL=http://localhost:3000`, `NODE_ENV=development` e `PORT=3001` para os processos que inicia.

Para trabalho separado, inicie backend com `npm run server:dev` e Vite com `npm run dev`, garantindo ambiente coerente. O Fastify escuta em `0.0.0.0` e recebe a porta por `PORT` (padrão 3001).

Não inicie servidores apenas por rotina em tarefa que não exige execução local.

O fluxo E2E não usa `.env.local` como fallback: `dev:e2e` injeta explicitamente `QA_MODE=true`, PostgreSQL `127.0.0.1:55432/vitstock_qa`, Evolution mock e Google mock. Se o guard rail não confirmar esses destinos, o processo aborta antes de iniciar a aplicação.

O `dev:e2e` gera uma credencial efêmera para o usuário sintético e a grava somente em `test-results/qa-credentials.json`, ignorado pelo Git. Não há senha QA fixa no repositório.

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

O comando usa Node test runner por `tests/run-tests.mjs` e atualmente executa:

- `tests/core.test.ts`;
- `tests/groupConversations.test.ts`.

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

Faça commit somente quando solicitado. Antes, execute a validação aplicável, revise o diff e confirme que não há segredo ou arquivo fora do escopo.

Use Conventional Commits claros:

```text
fix(atendimento): corrigir posição do indicador de novas mensagens
feat(crm): adicionar campo de origem do contato
refactor(inbox): preservar identidade durante reconciliação
```

Não misture mudanças não relacionadas no mesmo commit.

### Push

Faça push somente com instrução/autorização. Nunca faça push para `main` nem use `git push --force` em branch compartilhada.

### Pull Request / entrega para revisão

Quando solicitado, prepare:

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

O Preview da Vercel é o ambiente de validação funcional antes do merge:

```text
branch → push → READY FOR HUMAN REVIEW → Preview → validação humana → merge
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
commit/push/PR quando autorizado
↓
READY FOR HUMAN REVIEW
↓
Preview
↓
validação humana
↓
merge humano
```

O Codex é atualmente o único agente automatizado autorizado nesse fluxo. Ferramentas auxiliares futuras dependerão de autorização humana explícita e não recebem autoridade automática para merge, deploy, produção, migrations de produção ou secrets.

## 15. Ready for Human Review

Uma tarefa chega a **READY FOR HUMAN REVIEW** quando, conforme aplicável:

- escopo implementado sem alterações não relacionadas;
- testes, checks e builds relevantes passaram;
- diff revisado;
- documentação necessária atualizada;
- branch correta;
- commit, push e PR feitos somente quando solicitados;
- riscos e pendências informados;
- plano objetivo de teste manual fornecido.

Não use apenas `DONE`: aprovação funcional continua sendo humana.

Após a validação humana, o merge somente pode ocorrer com autorização explícita, na baseline correta. Em seguida, registre a validação, feche a Issue quando apropriado, remova a branch da Issue somente quando for seguro e sincronize a baseline. **READY FOR HUMAN REVIEW** nunca implica merge automático.

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
