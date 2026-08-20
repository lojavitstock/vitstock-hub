---
name: Task
about: Bug, melhoria ou funcionalidade do Vitstock Hub
title: ''
labels: ''
assignees: ''
---

## Context

<!-- Explique brevemente por que esta mudança é necessária. -->

## Goal

<!-- Descreva o resultado final de produto, sem prescrever a implementação. -->

## Current Behavior

<!-- Descreva o comportamento atual, quando aplicável. -->

## Expected Behavior

<!-- Descreva o comportamento esperado de forma observável. -->

## Functional Scope

<!-- Liste somente as capacidades que fazem parte desta entrega. Para Issues pequenas, 1–3 itens bastam. -->

-

## Out of Scope

<!-- Registre o que explicitamente não deve ser alterado ou implementado. -->

-

## Acceptance Criteria

<!-- Cada critério deve poder ser comprovado por código, teste ou Browser QA. Evite critérios vagos. -->

- [ ]

## Acceptance Scenarios

<!-- Para Issues pequenas, use somente os cenários necessários. Para módulos maiores, cubra os fluxos principais. -->

### Scenario 1 —

Given:

When:

Then:

## Data / Persistence Expectations

<!-- Remova esta seção ou escreva N/A quando não envolver dados. -->

-

## Error States

<!-- Registre somente estados relevantes: loading, vazio, falha de API, dados inválidos, offline ou permissão. -->

-

## Relevant Documentation

Consulte somente os documentos relevantes ao escopo, seguindo a ordem definida em `AGENTS.md`:

- `AGENTS.md`
- `docs/PROJECT.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNBOOK.md`
- `docs/TESTING.md`
- `docs/ROADMAP.md`

<!-- Não é necessário ler todos os documentos para toda tarefa. -->

## Technical Validation

<!-- Descreva os checks específicos desta Issue. TESTING.md é a fonte de verdade. -->

- [ ] Testes automatizados aplicáveis
- [ ] Build/check aplicável
- [ ] Outras validações existentes no repositório, quando necessárias

## Browser QA

<!-- Descreva os fluxos que o Codex deve executar no localhost ou Preview antes da entrega. Para Issues pequenas, 1–2 passos podem bastar. -->

1.

## Regression Areas

<!-- Indique somente áreas adjacentes que podem regredir. -->

-

## Human Validation

<!-- Mantenha esta etapa pequena: é a aceitação final de Leo, não a repetição de toda a QA do Codex. -->

Validar a experiência geral e as regras de negócio no ambiente aplicável.

## Stop Conditions / Human Decision Required

O Codex deve parar e solicitar decisão humana se encontrar:

- necessidade de alterar o escopo de produto;
- decisão comercial não especificada;
- mudança arquitetural significativa não necessária ao escopo original;
- migration destrutiva ou risco relevante de dados;
- necessidade de serviço pago;
- necessidade de credencial ou permissão não autorizada;
- conflito entre critérios de aceite;
- impossibilidade de validar comportamento crítico.

Um bug normal dentro do escopo não é automaticamente uma Stop Condition. Se puder diagnosticar e corrigir com segurança dentro desta Issue, o Codex deve iterar sem pedir microaprovação.

## Delivery Requirements

Antes de **READY FOR HUMAN REVIEW**, o Codex deve, conforme aplicável:

- satisfazer os Acceptance Criteria;
- executar a validação técnica aplicável;
- executar o Browser QA aplicável;
- corrigir regressões encontradas dentro do escopo;
- revisar o diff;
- criar commit, push e Pull Request conforme o `RUNBOOK.md` e a autorização da tarefa;
- fornecer resumo, riscos e o Human Validation final.

## Autonomia durante a execução

Durante a execução de uma Issue `codex-ready`, o Codex pode iterar internamente dentro do escopo aprovado para diagnosticar, implementar, testar, abrir localhost, usar o navegador, corrigir bugs encontrados e repetir a validação. Não precisa solicitar aprovação para cada pequeno ajuste dentro do escopo. Deve parar diante das Stop Conditions acima e não possui autoridade adicional para merge, deploy, produção, migrations de produção ou secrets.
