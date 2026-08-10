# Vitstock Hub — Regras de Engenharia

## Prioridade atual

A prioridade absoluta é o módulo de Atendimento WhatsApp.

Não expandir CRM, Campanhas, Automações ou outras áreas sem solicitação explícita.

## Objetivos atuais

1. Tornar o Atendimento extremamente rápido.
2. Eliminar travamentos durante digitação e navegação.
3. Reduzir carregamentos e requisições desnecessárias.
4. Tornar mensagens e conversas confiáveis.
5. Migrar gradualmente de polling agressivo para atualização orientada a eventos.

## Princípios

- Backend é a fonte da verdade para estados críticos.
- Não criar estado crítico somente no frontend.
- Preferir alterações incrementais a grandes reescritas.
- Não alterar módulos fora do escopo da tarefa.
- Não adicionar dependências sem necessidade clara.
- Reutilizar a arquitetura existente sempre que for tecnicamente saudável.
- Não criar abstrações prematuras.
- Não alterar UX ou visual sem solicitação.
- Nunca ocultar erro de envio ou apresentar falso sucesso.
- Manter compatibilidade com Evolution API existente.
- Nunca expor credenciais ou segredos no frontend.

## Performance React

- Estado digitado no Composer deve permanecer local ao Composer sempre que possível.
- Digitar uma mensagem não deve rerenderizar listas grandes ou o histórico completo.
- Evitar cálculos pesados dentro do render.
- Evitar recriar arrays, objetos e callbacks desnecessariamente.
- Listas grandes devem ser paginadas ou virtualizadas quando necessário.
- Otimização deve ser baseada em evidência/profiling, não em memoização indiscriminada.

## Escopo

Antes de alterar código:

1. Leia somente os arquivos necessários para entender a tarefa.
2. Identifique dependências diretamente relacionadas.
3. Evite varrer ou refatorar módulos não relacionados.

## Validação

Após alterações relevantes:

- executar verificação TypeScript;
- executar testes existentes relacionados;
- executar build;
- corrigir regressões antes de concluir.

## Entrega

No final de cada tarefa, responda de forma concisa com:

1. causa encontrada;
2. arquivos alterados;
3. mudanças realizadas;
4. testes executados;
5. resultado;
6. riscos ou pendências;
7. métricas antes/depois quando aplicável.

Não gere documentação extensa ou relatórios longos sem solicitação.

Não faça commit automaticamente a menos que solicitado.
