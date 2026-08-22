# Vitstock Hub — Estratégia Prática de Testes

> **Baseline atual:** esta documentação foi verificada na branch `codex/perf-atendimento-inbox`. Se a tarefa estiver em outra branch, não a troque automaticamente: informe a divergência e use o código atual daquela branch como evidência.

Este documento define o menor processo de validação que protege o Vitstock Hub sem transformar um projeto pequeno em uma operação corporativa de QA. Ele complementa o procedimento operacional em `RUNBOOK.md` e os invariantes técnicos em `ARCHITECTURE.md`.

## 1. Princípio de validação

**Teste automatizado não é validação funcional.**

Os testes automatizados detectam regressões técnicas nas regras e utilitários cobertos. A validação funcional final acontece no Vercel Preview e exige confirmação humana, especialmente para fluxos reais de WhatsApp, conexão, mídia e experiência visual.

O estado ao fim do trabalho do agente é **READY FOR HUMAN REVIEW**, nunca `DONE`.

Teste o comportamento alterado, os comportamentos adjacentes que podem regredir e os invariantes técnicos envolvidos. Não é necessário testar CRM ou áreas não relacionadas quando a mudança afeta somente, por exemplo, o scroll da timeline.

## 2. Stack de testes atual

O projeto usa a API nativa `node:test`, executada em arquivos TypeScript pelo bootstrap `tests/run-tests.mjs`, que delega a execução para o `tsx` disponível no backend.

| Arquivo | Papel atual |
| --- | --- |
| `tests/run-tests.mjs` | Bootstrap comum para executar um arquivo de teste TypeScript. |
| `tests/core.test.ts` | Regressões de Inbox, mensagens, reconciliação, SSE, autoria, replies, reações, lease, cache, mídia, popovers e Composer. |
| `tests/groupConversations.test.ts` | Regressões específicas de conversas em grupo. |
| `tests/os-userinfo.cjs` | Helper carregado pelo bootstrap; não é uma suíte independente. |
| `tests/e2e/*.spec.ts` | Smoke e Atendimento no Chromium via Playwright; executados contra QA local por padrão. |

O comando `npm test` executa as duas suítes atuais, nesta ordem: `core.test.ts` e `groupConversations.test.ts`.

Não existe métrica de cobertura ou um comando de lint. **No dedicated lint command currently exists.** A suíte E2E/browser usa Playwright e deve rodar contra o QA local por padrão.

## 3. Comandos confirmados

Execute a partir da raiz do repositório.

```powershell
# Todas as regressões automatizadas atuais
npm test

# Uma suíte específica, quando a tarefa exigir isolamento
node tests/run-tests.mjs tests/core.test.ts
node tests/run-tests.mjs tests/groupConversations.test.ts

# Frontend: TypeScript e build Vite
npm run build

# Backend: TypeScript sem emissão e build
npm --prefix server run check
npm --prefix server run build

# Ambiente QA local isolado para browser testing
npm run dev:e2e
npm run test:e2e
npm run qa:stop
```

`npm run build` executa `tsc && vite build`. O check do backend executa `tsc -p tsconfig.json --noEmit`; o build compila o backend para `server/dist`.

`npm run test:e2e` valida o backend QA por um marcador explícito antes de iniciar o Playwright. O alvo padrão é `http://localhost:3000`; um Preview remoto só pode ser usado com `PLAYWRIGHT_ALLOW_REMOTE=true` e configuração explícita de `PLAYWRIGHT_BASE_URL`. Não invente `npm run lint`, Cypress ou qualquer outro comando que não exista no repositório.

`npm run dev:e2e` gera uma credencial efêmera para o usuário sintético do QA e a grava somente em `.qa/qa-credentials.json`, que é ignorado pelo Git. O runner lê esse arquivo para o teste autenticado; nenhuma senha QA fixa é versionada.

### Preview remoto protegido

O fluxo remoto é separado do QA local e usa somente `.env.e2e.preview.local`, que nunca deve ser commitado. Na primeira configuração de uma máquina, copie `.env.e2e.preview.example` para `.env.e2e.preview.local`, preencha localmente `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_EMAIL` e `E2E_PASSWORD`, e execute:

```powershell
npm run test:e2e:preview
```

O comando valida o domínio Preview autorizado, envia o bypass da proteção Vercel apenas ao contexto do Playwright e executa um smoke read-only. O trace fica desativado nesse modo para evitar que headers de bypass sejam capturados em artefatos. O fluxo não substitui a validação humana e não deve ser apontado para Production.

## 4. Validação por tipo de alteração

| Tipo de alteração | Testes automatizados | Build frontend | Check/build backend | Preview manual |
| --- | --- | --- | --- | --- |
| Documentação | Normalmente não; revisar links e diff | Não | Não | Não |
| UI isolada do frontend | Testes relacionados se existirem | Sim | Só se contrato/API mudar | Sim, cenário afetado |
| Estado, Inbox, timeline ou realtime | Sim | Sim | Se contrato/API mudar | Sim |
| Backend | Sim, quando aplicáveis | Se contrato/API mudar | Sim | Se o fluxo afetado for visível |
| Frontend + backend | Sim | Sim | Sim | Sim |
| Migration | Revisão SQL e testes aplicáveis | Se aplicável | Sim | Sim, após fluxo autorizado |
| Configuração/infraestrutura | Testes e builds aplicáveis ao serviço | Quando aplicável | Quando aplicável | Validação específica |

Esta matriz é proporcional: uma mudança pequena não exige rodar tudo sem motivo, mas também não dispensa validação apenas por parecer simples.

## 5. Regressões do Atendimento

Para mudanças no Atendimento, escolha somente as áreas que a alteração pode afetar.

### Inbox

- conversa nova ou atualizada sobe uma única vez e na posição correta;
- snapshot antigo não regride atividade recente;
- filtros aplicáveis permanecem corretos;
- `unreadCount` e `needsResponse` continuam independentes;
- grupos permanecem classificados corretamente quando a alteração os envolve.

### Mensagens e autoria

- não há duplicação;
- a mensagem otimista converge com a confirmação usando identificadores explícitos;
- atualização de status não cria nova mensagem;
- retry não duplica envio;
- autoria interna do Hub é preservada;
- envio realmente externo continua sem autoria indevida.

### Realtime e reconciliação

- `message.upsert`, `message.status` e `conversation.updated`;
- reconnect do SSE e polling de segurança;
- eventos repetidos ou fora de ordem;
- atualizações incrementais que não exigem refetch completo.

### Timeline e scroll

- abertura ou retorno para a posição esperada;
- sticky-to-bottom e indicador de novas mensagens;
- leitura de histórico sem interrupção;
- prepend preservando viewport;
- mídia assíncrona sem deslocamento indevido;
- troca rápida entre conversas.

### Mídia, documentos e replies

- imagem, vídeo, áudio, documento e PDF quando afetados;
- download e viewer, inclusive fechamento por `Escape`;
- quoted/reply preservado sem contaminar outra mensagem;
- reação atualiza somente a mensagem original e não a atividade da conversa.

### Conexão WhatsApp

- `open`, `connecting` e desconectado/erro;
- QR Code e reconexão;
- bloqueio claro de envio quando a conexão não está operacional.

## 6. Cobertura atual de conversas em grupo

`tests/groupConversations.test.ts` cobre comportamentos realmente presentes na branch atual:

- identificação de JID `@g.us`, sem confundir telefone ou `@lid`;
- preservação do JID da conversa, participante, nome do participante e quoted context no inbound;
- autoria do atendente para envio de grupo pelo Hub;
- mídia e reações de participantes de grupo;
- preview realtime com remetente, unread/needs-response e ordenação por timestamp de mensagem real;
- reação de grupo sem criar item de timeline ou mudar atividade da Inbox;
- preservação estrutural dos campos de identidade de grupo durante reconciliação.

O arquivo não substitui validação manual de apresentação visual ou de filtros. Se uma mudança alterar esses fluxos, inclua um cenário de Preview específico.

## 7. Regras para testes automatizados

- Não apague teste para fazer build passar.
- Não enfraqueça assertion para acomodar uma regressão.
- Se um teste existente estiver incorreto, registre a evidência antes de alterá-lo.
- Se uma falha era preexistente, identifique-a claramente na entrega.
- Quando uma tarefa autorizada corrigir bug importante sem cobertura, prefira adicionar a regressão mínima pertinente; isto não obriga teste novo para toda alteração.

Ao corrigir bug, registre quando aplicável: cenário inicial, ação, resultado atual e resultado esperado. Reproduza antes da mudança e repita o mesmo cenário depois. Para problema intermitente, faça mais de uma repetição somente quando isso for necessário para confiar no resultado.

## 8. Diagnóstico opt-in

Os traces existentes ajudam a observar problemas sem substituir testes:

| Flag | Escopo | Uso |
| --- | --- | --- |
| `VITE_SCROLL_TRACE=true` | Frontend | Emite `SCROLL_TRACE` para eventos relevantes de scroll, resize, restauração, histórico e realtime. |
| `VITE_OUTBOUND_TRACE=true` | Frontend | Mede etapas de submit, renderização otimista, HTTP e confirmação SSE. |
| `OUTBOUND_TRACE=true` | Backend | Mede etapas de idempotência, persistência e chamada à Evolution. |

Essas flags devem permanecer opt-in. Logs de diagnóstico não devem expor conteúdo de mensagem, mídia, tokens, cookies ou credenciais. Instrumentação temporária deve ser removida ao final da investigação, salvo se for um mecanismo permanente e documentado.

## 9. Banco de dados e migrations

Uma migration exige revisão de:

- SQL e ordem do arquivo;
- compatibilidade com schema e queries atuais;
- defaults, nulidade e índices;
- impacto em dados existentes;
- recuperação/rollback quando necessário.

Não execute migration em produção como agente. Se um teste local de migration for necessário, confirme antes que o banco é seguro: `localhost` não garante PostgreSQL local nem ambiente isolado.

## 10. Falhas e serviços externos

### Teste ou build falhou

1. Identifique o teste ou o lado afetado (frontend/backend).
2. Isole e reproduza quando possível.
3. Determine se a alteração atual introduziu a falha.
4. Corrija regressão dentro do escopo ou registre evidência objetiva de que é preexistente.

Não declare **READY FOR HUMAN REVIEW** com regressão nova conhecida. Não esconda falha com mudança de teste, configuração ou infraestrutura não relacionada.

### Validação com serviços externos

Testes unitários, type checks e builds normalmente não devem depender de Evolution API, Railway, Vercel ou banco externo. Quando uma validação realmente precisar de um serviço externo:

- confirme ambiente e destino;
- não envie mensagem real sem autorização;
- não altere provider, banco, QR, deploy ou infraestrutura como efeito colateral inesperado.

## 11. Preview e validação humana

Use um plano manual curto e específico para a mudança:

```text
Manual Validation

Environment:
Vercel Preview

Scenario:
...

Steps:
1. ...
2. ...

Expected:
- ...

Regression checks:
- ...
```

O Preview é a etapa de validação funcional. Um agente pode preparar cenário, executar checks locais e reportar evidências, mas não aceita sozinho UX, integração real ou prontidão para produção.

## 12. Responsabilidade pela validação

O Codex executa testes, revisa diff, procura regressões, analisa falhas e compara uma alteração com os invariantes. Não pode alterar testes arbitrariamente, aceitar regressão, fazer merge, deploy, migrations de produção ou administrar secrets.

Ferramentas auxiliares futuras, quando explicitamente autorizadas, são opcionais e não substituem a responsabilidade do Codex de interpretar a evidência e manter o escopo.

## 13. Critério mínimo de saída

Uma mudança segue para **READY FOR HUMAN REVIEW** quando, conforme aplicável:

- testes relevantes passaram;
- build do frontend passou;
- check/build do backend passou;
- regressões potencialmente afetadas foram consideradas;
- não há nova falha conhecida ignorada;
- o plano manual de Preview foi preparado quando necessário.

Isso ainda não significa validação funcional final.

## 14. Referência rápida

```powershell
npm test
node tests/run-tests.mjs tests/core.test.ts
node tests/run-tests.mjs tests/groupConversations.test.ts
npm run build
npm --prefix server run check
npm --prefix server run build
```
