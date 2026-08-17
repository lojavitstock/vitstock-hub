# Vitstock Hub — Roadmap

## 1. Purpose

Este documento registra a direção de evolução do Vitstock Hub. Ele responde onde o produto está e para onde deve evoluir, sem funcionar como backlog, checklist, changelog ou cronograma.

O trabalho executável pertence a GitHub Issues. Decisões de implementação, datas e aceitação funcional permanecem sob revisão humana.

## 2. Product Direction

O Vitstock Hub é uma ferramenta interna da Vitstock. A direção aprovada é:

```text
Atendimento confiável
        ↓
Contexto do cliente
        ↓
CRM
        ↓
Automação
        ↓
Analytics / IA
```

O produto não busca reproduzir integralmente Chatwoot, CRMs comerciais ou plataformas omnichannel. Deve priorizar necessidade operacional real, simplicidade, confiabilidade, baixa complexidade operacional e evolução incremental.

## 3. Current State

O Atendimento já possui uma base implementada: Inbox, mensagens, realtime por SSE com reconciliação de segurança, conexão e QR Code, mídia, replies, reações, envio otimista, retry, autoria, estados de leitura e necessidade de resposta, scroll por conversa, grupos, multiatendente e conversation lease.

Contatos já têm persistência e integração com Google Contacts, incluindo edição de perfil e início de conversa. CRM, automação, analytics e IA ainda não são áreas funcionais do produto. O Funil e Campanhas existentes são fundações visuais/mock, não módulos operacionais.

## 4. CURRENT — Consolidate Customer Service

O objetivo atual não é reconstruir Atendimento, e sim consolidá-lo como a fundação estável do produto.

- eliminar bugs operacionais relevantes identificados na prática;
- validar os fluxos no Preview antes de integração;
- corrigir inconsistências que possam transmitir estados falsos;
- preservar performance, confiabilidade e comportamento incremental já estabelecidos;
- validar a experiência móvel atual antes de propor um redesign amplo.

Detalhes como um limite específico de upload, texto técnico incorreto ou regressão visual pontual devem ser avaliados como Issues, não como itens detalhados deste horizonte.

## 5. NEXT — Customer Context

O próximo horizonte é transformar Contatos em uma camada útil de contexto operacional para o Atendimento.

A base existente inclui contatos persistidos, Google Contacts/People API, edição de perfil, dados pessoais e comerciais e início de conversa. A evolução deverá melhorar a organização dos contatos, completar a busca, trazer contexto relevante para a conversa e integrar informações comerciais úteis ao atendimento.

Etiquetas devem nascer como um modelo reutilizável, inicialmente aplicável a contatos e conversas, com possibilidade de extensão futura para oportunidades. O desenho de dados não pertence a este roadmap.

## 6. LATER — Functional CRM

O CRM atual não é funcional: o Funil é apenas uma fundação visual com dados mockados. Quando este horizonte começar, a direção é substituir gradualmente mocks por dados persistidos e relacionamentos reais.

O escopo conceitual inclui oportunidades, pipeline, etapas, atividades, follow-ups, relacionamento com contatos e histórico comercial. Não implica reproduzir um CRM corporativo completo.

Nesse momento deverá ser avaliado um modelo persistido de atividades/eventos capaz de conectar, quando fizer sentido:

```text
Contato
 ├── Conversas
 ├── Notas
 ├── Oportunidades
 ├── Follow-ups
 └── Atividades
```

Esse modelo é uma direção arquitetural futura, não uma implementação aprovada agora.

## 7. FUTURE — Automation

Automação deve ser considerada depois que Atendimento, Contatos e CRM possuírem dados estruturados e confiáveis suficientes.

Possíveis capacidades incluem regras, gatilhos, ações, follow-ups automáticos, tarefas, workflows e integrações. Esses exemplos não são requisitos aprovados. A automação deve reduzir trabalho repetitivo sem retirar controle humano nem tornar a operação imprevisível.

## 8. FUTURE — Analytics

Analytics deve partir de dados reais gerados pela operação, não de dashboards criados por comparação com outros CRMs.

Futuras métricas podem responder perguntas sobre volume de atendimento, tempo de resposta, conversões, desempenho comercial, pipeline, atividades e oportunidades. Cada métrica deve ter uma pergunta operacional clara.

## 9. FUTURE — AI

IA não é prioridade imediata. Só deve ser avaliada quando houver contexto confiável, dados estruturados e casos de uso claros.

Assistência ao atendente, resumo de conversas, classificação, recuperação de contexto e análise são possibilidades de pesquisa futura, não funcionalidades aprovadas. Qualquer uso deve aumentar produtividade sem comprometer controle humano.

## 10. Deferred Areas

- **Campanhas:** não são prioridade. A implementação atual é visual/mock e não deve ser apresentada como operacional enquanto não tiver backend real.
- **Respostas rápidas:** podem evoluir futuramente, com escopo inicial preferencial por empresa. As duas respostas fixas atuais não representam o recurso final.
- **Setores e filas:** não são prioridade imediata. O lease atual permanece a base operacional; classificação, distribuição, ownership e impacto no lease exigem decisão própria quando houver necessidade real.
- **Grupos:** fazem parte da implementação atual e, por enquanto, seguem a mesma lógica operacional de ownership das conversas privadas.
- **Notificações:** o som atual é suficiente neste horizonte. Preferências individuais e notificações do navegador ficam para avaliação futura conforme necessidade.
- **Mobile:** não iniciar redesign amplo antes de validar o produto atual em dispositivos móveis; problemas concretos devem virar Issues específicas.

## 11. Technical Debt vs Product Roadmap

Dívida técnica e bugs não entram automaticamente no roadmap estratégico. Exemplos já identificados incluem limite divergente de anexos entre frontend e backend, texto técnico de WebSocket, SSE process-local, listas sem virtualização, responsabilidades concentradas em `evolution.ts`, payloads Evolution flexíveis e ausência de testes E2E/browser.

Cada item deve ser avaliado individualmente e, quando relevante, transformado em GitHub Issue. Este roadmap não aprova automaticamente Redis, virtualização, E2E, refactors ou novas dependências.

## 12. Research and External References

Chatwoot, CRMs, ferramentas WhatsApp e outros produtos servem para pesquisa: entender padrões, identificar problemas, comparar soluções e gerar opções. Eles não definem requisitos automáticos e não devem ser copiados como arquitetura ou escopo do Vitstock Hub.

## 13. Roadmap vs GitHub Issues

```text
ROADMAP
→ direção do produto

GitHub Issues
→ trabalho executável e verificável
```

Por exemplo, “Consolidar Atendimento” é uma direção. Corrigir um limite de upload, uma mensagem técnica incorreta ou uma regressão específica de scroll são possíveis Issues. O roadmap não deve se transformar em uma lista dessas tarefas.

## 14. Prioritization Principles

Antes de incluir trabalho em um horizonte, avaliar:

1. Resolve um problema real da Vitstock?
2. Com que frequência o problema ocorre?
3. Qual é o impacto operacional?
4. Já existe fundação técnica útil?
5. Qual complexidade adicional introduz?
6. Qual custo futuro de manutenção cria?
7. É necessário agora ou apenas interessante?

Preferir alto valor operacional com baixa complexidade desnecessária.
