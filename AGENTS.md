# Vitstock Hub — Agent Instructions

Este arquivo define as regras obrigatórias para qualquer agente de IA que trabalhe neste repositório, incluindo o Codex e agentes futuros autorizados.

O objetivo destas regras é permitir desenvolvimento assistido por IA com autonomia controlada, mudanças pequenas, rastreabilidade e validação humana antes de integração à produção.

---

## 1. Project Identity

Vitstock Hub é uma aplicação interna de CRM, atendimento e operações comerciais da Vitstock.

Principais áreas do produto:

* Atendimento via WhatsApp
* Inbox compartilhada
* Conversas e mensagens
* Contatos
* CRM
* Gestão de atendentes
* Configurações
* Integrações
* Automações futuras

Stack principal:

* React
* Vite
* Node.js
* Fastify
* Evolution API
* SSE para realtime
* Vercel para frontend
* Railway para backend

Consulte `docs/PROJECT.md` para contexto funcional completo e `docs/ARCHITECTURE.md` para arquitetura técnica.

---

# 2. Source of Truth

Use as fontes de informação nesta ordem:

1. Código-fonte atual
2. `AGENTS.md`
3. GitHub Issue atribuída à tarefa
4. `docs/ARCHITECTURE.md`
5. `docs/RUNBOOK.md`
6. `docs/TESTING.md`
7. `docs/PROJECT.md`
8. `docs/ROADMAP.md`
9. `docs/CHANGELOG.md`

Se documentação e implementação atual divergirem, não assuma automaticamente que uma delas está correta. Investigue a divergência e registre-a.

Google Docs, conversas antigas, handoffs e notas externas são apenas referências históricas; não são fonte oficial para implementação.

Quando uma tarefa definir explicitamente uma branch de desenvolvimento, essa branch será a baseline de implementação da tarefa. Não assuma que `main` contém o trabalho mais recente desse ciclo; a baseline pode mudar em tarefas futuras.

---

# 3. Required Reading

Antes de modificar código, sempre leia:

* `AGENTS.md`
* a GitHub Issue ou instrução que define a tarefa

Leia quando relevante:

* `docs/PROJECT.md` para comportamento do produto
* `docs/ARCHITECTURE.md` para decisões técnicas
* `docs/RUNBOOK.md` para procedimentos
* `docs/TESTING.md` para validação
* `docs/ROADMAP.md` para contexto futuro

Não leia documentação irrelevante apenas para aumentar contexto. Priorize o menor conjunto de informações necessário para executar a tarefa corretamente.

---

# 4. Understand Before Changing

Antes de editar arquivos:

1. confirme o objetivo da tarefa;
2. identifique os arquivos e componentes envolvidos;
3. investigue a implementação atual;
4. procure testes relacionados;
5. identifique possíveis efeitos colaterais;
6. confirme branch e estado do Git.

Não implemente uma solução apenas com base na descrição da Issue sem primeiro verificar o código existente. Quando a causa não estiver clara, diagnostique antes de corrigir. Evite ciclos de tentativa e erro sem evidência.

---

# 5. Git Safety

Nunca:

* faça commit, push ou merge diretamente em `main`;
* execute force push;
* apague branches remotas sem autorização explícita;
* altere histórico Git compartilhado;
* faça deploy em produção.

Todo desenvolvimento deve ocorrer em branch específica ou worktree isolada. Antes de alterar arquivos, verifique o equivalente a:

```bash
git status
git branch --show-current
```

Se já existir uma branch definida para a tarefa, utilize-a. Não crie outra branch desnecessariamente. Se nenhuma branch estiver definida, utilize uma branch descritiva, preferencialmente `codex/<tipo>-<descricao>`.

A integração com `main` exige aprovação humana.

---

# 6. Scope Discipline

Implemente somente o escopo solicitado.

Não faça refactors, redesigns, renomes, reorganizações de diretórios, alterações arquiteturais, dependências, funcionalidades de roadmap ou limpeza de código não relacionados à tarefa.

Se encontrar outro problema, não aumente silenciosamente o escopo: registre-o e sugira uma nova Issue.

**Uma Issue → um problema → uma mudança verificável.**

---

# 7. Production Boundaries

Por padrão, agentes não possuem autorização para modificar produção.

Nunca:

* acesse ou altere banco de dados de produção;
* execute migrations em produção;
* altere configuração de produção do Railway ou Vercel;
* modifique sessões de produção da Evolution API;
* envie mensagens reais para clientes;
* altere DNS, secrets ou credenciais;
* faça deploy em produção.

Qualquer exceção exige autorização humana explícita para aquela ação específica. Autorização pontual não implica autorização permanente.

Alterações que adicionem ou modifiquem migrations exigem atenção adicional: um deploy posteriormente aprovado pode executá-las automaticamente pelo fluxo configurado no Railway. Destaque migrations na entrega/PR, inclua plano de validação, impacto e risco; nunca as execute manualmente em produção como agente.

Antes de executar uma ação que possa modificar dados, enviar mensagens, alterar o estado do WhatsApp ou executar migrations, verifique qual ambiente e quais serviços estão configurados. `localhost` e `npm run dev:local` não garantem banco ou provider isolados; iniciar processos locais para leitura, build e testes não exige essa verificação adicional.

---

# 8. Secrets

Nunca coloque credenciais em código, commits, logs, Issues, Pull Requests, documentação ou arquivos versionados.

Utilize variáveis de ambiente. Arquivos `.env` reais não devem ser commitados; somente arquivos como `.env.example`, sem valores sensíveis, podem ser versionados.

Se uma credencial aparecer acidentalmente em contexto ou arquivo, não a reproduza.

---

# 9. Architecture Guardrails

Preserve os padrões arquiteturais existentes salvo quando a tarefa explicitamente exigir mudança.

No Atendimento:

* backend é autoridade para regras de concorrência e posse;
* validações de segurança somente no frontend são insuficientes;
* SSE é o mecanismo primário de realtime;
* polling deve funcionar como fallback/reconciliação;
* evite refetch completo da Inbox quando atualização incremental for suficiente;
* preserve reconciliação, deduplicação, ordenação e identidade por IDs estáveis;
* eventos duplicados de SSE/polling não devem gerar mensagens duplicadas;
* atualizações antigas não devem sobrescrever estado mais recente;
* correlacione mensagens do Hub somente por identificadores explícitos, nunca por texto ou proximidade de horário;
* mantenha metadata de anúncio, reply e reaction restrita à mensagem que a contém; reaction não é nova atividade de conversa;
* preserve o scroll por conversa e não trate `connecting` ou `disconnected` como estado operacional;
* mudanças não devem degradar performance perceptível da Inbox.

Não substitua mecanismos existentes por implementações aparentemente mais simples sem entender por que eles existem.

Decisões arquiteturais importantes devem ser refletidas em `docs/ARCHITECTURE.md`.

---

# 10. Realtime Safety

Alterações relacionadas a mensagens, Inbox ou SSE devem considerar pelo menos:

* mensagem recebida e enviada;
* status de mensagem;
* conversa aberta e fechada;
* troca rápida entre conversas;
* eventos duplicados e fora de ordem;
* reconnect do SSE;
* polling de fallback;
* estado otimista e estado confirmado pelo backend.

Evite assumir que eventos chegarão exatamente uma vez ou sempre na ordem esperada.

---

# 11. Dependencies

Não adicione bibliotecas sem necessidade clara.

Antes de adicionar uma dependência:

1. verifique se a funcionalidade já existe no projeto;
2. verifique se pode ser implementada com a stack atual;
3. avalie impacto no bundle, backend e manutenção;
4. justifique a dependência na Pull Request.

Não atualize dependências em massa durante uma tarefa não relacionada.

---

# 12. Testing

Antes de declarar uma implementação pronta para revisão, execute os testes relevantes disponíveis no projeto. Quando aplicável:

```bash
npm test
npm run build
```

Utilize somente os comandos reais definidos pelo projeto; consulte `docs/TESTING.md` e `docs/RUNBOOK.md` para os checks de frontend e backend. Execute também testes específicos relacionados à alteração quando existirem.

Não ignore testes falhando. Se um teste já falhava antes da alteração, confirme que é preexistente e registre-o na entrega. Não altere testes apenas para fazer uma implementação incorreta passar.

---

# 13. Functional Validation

Testes automatizados não significam que uma funcionalidade está concluída.

O fluxo esperado é:

```text
implementação
↓
testes
↓
checks e build aplicáveis
↓
commit
↓
push
↓
Pull Request / Preview
↓
validação humana
↓
merge
```

A validação funcional ocorre no ambiente de Preview. Somente uma pessoa pode confirmar que uma funcionalidade foi validada funcionalmente. O agente nunca deve afirmar validação funcional apenas porque testes automatizados passaram.

---

# 14. Debugging

Quando um bug não possuir causa clara, **diagnostique antes de modificar comportamento.**

Prefira:

```text
observar → medir → identificar causa → corrigir → remover instrumentação temporária
```

em vez de tentativa e erro. Logs temporários podem ser adicionados para diagnóstico, mas devem ser removidos quando não forem mais necessários. Não deixe telemetria contraditória ou debug logging desnecessário no código final.

---

# 15. Documentation

Atualize documentação quando uma mudança alterar arquitetura, comportamento importante, workflow de desenvolvimento, configuração necessária, integração ou decisão técnica permanente.

Não atualize documentação apenas para registrar detalhes triviais de implementação.

Utilize:

* `PROJECT.md` → comportamento e conceitos do produto;
* `ARCHITECTURE.md` → arquitetura e decisões técnicas;
* `ROADMAP.md` → direção futura;
* `RUNBOOK.md` → procedimentos operacionais de desenvolvimento;
* `TESTING.md` → estratégia e procedimentos de teste;
* `CHANGELOG.md` → mudanças relevantes.

GitHub Issues e Pull Requests devem registrar o estado operacional das tarefas. Não use arquivos permanentes de documentação como substituto para o estado de uma Issue.

---

# 16. Commit Discipline

Commits devem ser pequenos, coerentes e descritivos. Prefira Conventional Commits, por exemplo:

```text
fix(atendimento): corrigir posição do indicador de novas mensagens
feat(crm): adicionar campo de origem do contato
refactor(inbox): preservar identidade durante reconciliação
```

Evite mensagens genéricas como `fix`, `update`, `changes`, `ajustes` ou `final`. Não inclua mudanças não relacionadas no mesmo commit.

---

# 17. Pull Request Requirements

Quando a tarefa envolver Pull Request, informe:

## Problem

O problema resolvido.

## Root Cause

A causa identificada, quando aplicável.

## Solution

O que foi alterado.

## Files Changed

Principais arquivos modificados.

## Validation

Testes, checks e builds executados.

## Risks

Possíveis regressões ou pontos sensíveis.

## Manual Test Plan

Passos objetivos para validação no Preview.

Não declare a funcionalidade como validada antes da confirmação humana.

---

# 18. Definition of Agent Done

O trabalho do agente está concluído quando:

* o escopo solicitado foi implementado;
* não existem alterações não relacionadas;
* testes relevantes passaram;
* checks e builds aplicáveis passaram;
* documentação necessária foi atualizada;
* mudanças foram revisadas;
* commit foi criado quando solicitado;
* branch foi enviada quando solicitado;
* PR foi criado quando solicitado;
* instruções de validação foram fornecidas.

O estado final do agente deve ser **READY FOR HUMAN REVIEW**, nunca **DONE**. A conclusão funcional depende de validação humana.

---

# 19. Human Authority

A decisão humana prevalece sobre decisões automatizadas relacionadas a escopo, arquitetura, produto, prioridades, deploy, produção, merge e aceitação funcional.

Atualmente, o Codex é o único agente automatizado autorizado no fluxo normal do projeto. Ele pode analisar, implementar dentro do escopo, testar, revisar, identificar problemas, sugerir melhorias e preparar Pull Requests. Nenhum agente possui autoridade final sobre produto ou produção; ferramentas auxiliares futuras dependerão de autorização humana explícita.

---

# 20. Core Principle

O objetivo da automação neste projeto é:

**reduzir trabalho manual sem reduzir controle humano.**

Prefira sempre:

**mudanças pequenas, contexto suficiente, execução verificável e aprovação humana.**
