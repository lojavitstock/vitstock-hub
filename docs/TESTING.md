# Vitstock Hub — Estratégia Prática de Testes

> **Fluxo de integração:** mudanças nascem de `origin/preview` em `feature/*`, `fix/*` ou `chore/*`, salvo tarefa explicitamente diferente. Gates técnicos precedem a integração autorizada por PR em `preview`, o deploy de pré-produção e a validação humana. Production (`main`) recebe mudanças somente por PR de `preview`, após esses gates e decisão explícita de promoção.

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
| `tests/server.test.ts` | Contratos básicos do Fastify, health, CORS, autenticação e webhook. |
| `tests/evolutionWebhook.test.ts` | Reconciliação e monitoramento do webhook da Evolution. |
| `tests/messageEditDelete.test.ts` | Regras e payloads de edição, exclusão e ações de mensagem. |
| `tests/productLibrary.test.ts` | Validação de imagem/MIME/tamanho, storage fake e regra de preço/snapshot da biblioteca de produtos. |
| `tests/qaServer.test.ts` | Rotas e fixtures exclusivas do modo QA. |
| `tests/groupConversations.test.ts` | Regressões específicas de conversas em grupo. |
| `tests/contactDomain.test.ts` | Normalização, deduplicação e domínio de contatos. |
| `tests/contactChatNavigation.test.ts` | Resolução de conversa a partir da navegação de contatos. |
| `tests/qaEnvironment.test.ts` | Guards de ambiente QA e contratos das integrações simuladas. |
| `tests/whatsappMetadata.test.ts` | Identidade e metadata específicas do WhatsApp. |
| `tests/notifications.test.ts` | Elegibilidade, dedupe, previews, navegação por ID explícito, captura antecipada do prompt, passthrough restrito do service worker e resultados estruturados de notificações desktop. |
| `tests/os-userinfo.cjs` | Helper carregado pelo bootstrap; não é uma suíte independente. |
| `tests/e2e/*.spec.ts` | Smoke, Atendimento e notificações/PWA no Chromium via Playwright; inclui o botão de teste desktop e o caminho de mensagem em background, executados contra QA local por padrão. |

| `tests/e2e/products.spec.ts` | CRUD visual de produtos, upload fake em memória, prévia, atalhos, retorno same-tab, arquivamento, autorização e isolamento entre empresas em QA local. |
| `tests/e2e/product-send.spec.ts` | Envio de produto pelo mock Evolution, loading/double click, falha/retry, FK local/snapshot histórico, PN/LID/grupo e isolamento de tenant. |

O comando `npm test` executa a suíte principal definida no `package.json`, usando o bootstrap `tests/run-tests.mjs` para os arquivos TypeScript listados pelo runner. Para uma suíte específica, execute diretamente o bootstrap com o arquivo desejado.

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

Para Product Library/Bling, `npm run dev:e2e`/`npm run qa:setup` são os fluxos autorizados para aplicar as migrations pelo runner; os guards fixam PostgreSQL em `127.0.0.1:55432/vitstock_qa`, Evolution/Google em mocks locais e abortam se os limites não forem satisfeitos. Não rode `server:migrate` sem confirmar explicitamente o destino. O driver padrão de QA é `memory`; `npm --prefix server run product:r2-smoke` é um smoke opt-in que grava e remove somente um objeto temporário no bucket R2 Preview, e `npm run product:r2-qa-smoke` exercita a Product API em QA local com R2 real quando o backend QA foi iniciado explicitamente com `PRODUCT_STORAGE_DRIVER=r2`. Nenhum teste padrão de CI escreve em R2. Evolution continua mock-only; o envio real Preview exige autorização separada.

`npm run test:e2e -- tests/e2e/product-send.spec.ts tests/e2e/products.spec.ts` valida o fluxo de produtos em QA. A suíte de envio consulta refs por conexão fixa ao PostgreSQL QA somente após confirmar `/api/qa/ready`; não usa `.env.local` ou `DATABASE_URL`. O cenário de rejeição de mídia é controlado por uma rota admin registrada apenas em QA e restaurado após o teste. Os testes backend em `tests/server.test.ts` usam banco/transport/storage simulados para rollback, concorrência, tenant, campos forjados e corrida de confirmação/webhook, sem R2 ou provider reais.

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

Enquanto não for necessário teste humano oficial, mantenha o trabalho na branch de desenvolvimento, com checkpoint remoto e Draft PR quando pertinente. Para esse teste, o fluxo é branch → PR → integração autorizada em `preview` → deploy → validação humana. Um Draft PR ou CI aprovado não constitui aprovação funcional nem autorização de promoção para `main`.

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

### Bling read-only foundation

`tests/blingCatalog.test.ts` integra `npm test` e cobre normalização, busca por
tokens AND, ranking SKU/nome, páginas locais, limite de sync 100, geração
publicada somente após conclusão e preservação do último snapshot em falha.
`npm run test:e2e -- tests/e2e/bling-catalog.spec.ts` valida as migrations 025
no PostgreSQL QA, multipágina, busca/acento/SKU, ausência de provider calls em
busca/carregar mais, snapshot preservado em resposta inválida/incompleta,
coordenação do lock PostgreSQL e confirmação explícita na UI. Usa apenas o mock
Bling interno.

`tests/bling.test.ts` integra `npm test`: OAuth ADMIN/state/tenant/erros,
criptografia autenticada com AAD, refresh e concorrência, headers JWT/Basic,
timeout de corpo, 401/429/Retry-After/5xx/network/retries, contratos e IDs/string.
Também cobre body OAuth estrito, inicialização do backend com env opcional
incompleto/inválido e captura do logger Fastify real (request/response/callback).
Confirma que confirmação tardia de reserva PostgreSQL não comprime a janela
real de dispatch (quatro chamadas nunca cabem em um segundo).
Transporte sempre injetado; runtime com `NODE_ENV=test` bloqueia Bling real.
QA usa `blingQa.ts` interno (não existe base URL configurável/proxy externo).
`dev:e2e` injeta credenciais fictícias e uma chave efêmera independente; reiniciar
QA requer reconectar seus vínculos fictícios, pois a chave muda. Nenhum secret real.

`npm run test:e2e -- tests/e2e/bling.spec.ts` testa Configurações/connect/callback/
disconnect, ciphertext no PostgreSQL QA, state single-use/expirado, ADMIN/tenant,
read models, dez GETs concorrentes com apenas um refresh e budget diário esgotado.
Também valida catálogo operacional via `criterio=2`, paginação/busca ativa,
contrato de status `A`/`I`/`E` da lista observada e fail-closed do catálogo
selecionável. Import/link/relink rejeitam `I` e `E`; `E` no detail é somente um
sinal de rejeição para seleção, enquanto leitura direta rejeita esse contrato
com 502. Detail, snapshots persistidos e sync de vínculo existente permanecem
`A`/`I`; sync continua cobrindo status autoritativo `I`. A migration 024 adiciona
somente unicidade case-insensitive de SKU por empresa; migrations 022, 023, 024
e 025 são aplicadas apenas pelo `dev:e2e` guardado. Também valida importação com
dados autoritativos e imagem local, SKU ausente e duplicado, conflito atômico no
sync, link/relink/sync, nome local preservado, preço cadastrado protegido,
saldos físicos/virtuais e rollback quando o estoque é inválido. O DELETE de
vínculo permanece como rota de compatibilidade e deve responder 409 sem mudar
produto, vínculo, saldos, imagem ou referências/snapshots; a UI não deve expor
ação de desvincular. Relink permanece funcional e archive retira da lista ativa
preservando vínculo e histórico. `POST /api/products` continua rejeitando
criação manual com `bling_product_required`.
`tests/server.test.ts` simula falha SQL após upload e confirma rollback mais
remoção somente do novo objeto armazenado. `tests/e2e/products.spec.ts` cobre o
fluxo UI Bling-only, paginação, validação de SKU, imagem colada/substituída,
estoque e preço na prévia; `tests/e2e/product-send.spec.ts` confirma override
imutável por mensagem, envio sem chamada Bling e preservação dos snapshots
anteriores à sincronização. Inclui duas instâncias PgBlingStore
contra PostgreSQL QA, refresh único, 401/expiry/connect/disconnect concorrentes,
rotação preservada após GET 403, janela de requests e disponibilidade do pool
Hub com DB_POOL_MAX=1. Compara snapshots de products/message_product_refs antes
e depois quando aplicável, sem provider/R2 real. Budget alterado apenas no banco
QA fixo é restaurado no finally; nunca banco remoto. OAuth real e dados reais
são excluídos.

```powershell
npm test
node tests/run-tests.mjs tests/core.test.ts
node tests/run-tests.mjs tests/groupConversations.test.ts
npm run build
npm --prefix server run check
npm --prefix server run build
```
