# Vitstock Hub — Project Overview

## 1. Purpose

Vitstock Hub é uma plataforma interna desenvolvida para centralizar operações de atendimento, relacionamento com clientes e processos comerciais da Vitstock.

O sistema busca reduzir a fragmentação entre WhatsApp, contatos, atendimento, CRM e atividades comerciais, oferecendo uma interface única para a equipe.

O produto é desenvolvido prioritariamente para as necessidades reais da operação da Vitstock.

Não existe objetivo atual de transformá-lo em uma plataforma SaaS genérica ou competir em quantidade de funcionalidades com CRMs e plataformas omnichannel comerciais.

A prioridade é:

**resolver bem os fluxos utilizados pela Vitstock com baixa complexidade operacional.**

---

# 2. Product Principles

As decisões de produto devem seguir estes princípios.

## 2.1 Simplicidade

Uma funcionalidade deve existir porque resolve um problema real da operação.

Evitar adicionar recursos apenas porque outras plataformas possuem.

---

## 2.2 Operação centralizada

Sempre que fizer sentido, atendimento, histórico do cliente e contexto comercial devem estar acessíveis dentro do Hub.

O operador não deve precisar alternar constantemente entre múltiplas ferramentas para entender uma interação.

---

## 2.3 Informação contextual

Uma conversa não deve ser tratada apenas como uma sequência de mensagens.

Quando disponível, o sistema deve permitir compreender:

* quem é o cliente;
* histórico de interações;
* situação do atendimento;
* responsável atual;
* informações comerciais relevantes;
* origem real da interação;
* contexto necessário para responder corretamente.

---

## 2.4 Automação com controle

Automação deve reduzir tarefas repetitivas sem tornar o comportamento do sistema imprevisível.

Sempre que possível:

* estados devem ser visíveis;
* ações automáticas devem ser compreensíveis;
* erros devem ser recuperáveis;
* decisões importantes devem continuar sob controle humano.

---

## 2.5 Confiabilidade antes de quantidade de recursos

Fluxos fundamentais devem ser confiáveis antes da expansão do produto.

Especialmente:

* conexão WhatsApp;
* recebimento de mensagens;
* envio de mensagens;
* realtime;
* identificação correta das conversas;
* histórico;
* atribuição;
* estado de leitura/resposta.

---

# 3. Primary Users

## 3.1 Atendente

Usuário responsável por interagir com clientes.

Principais necessidades:

* visualizar conversas;
* responder rapidamente;
* identificar novas mensagens;
* saber quais conversas precisam de resposta;
* consultar informações do cliente;
* utilizar mídia e documentos;
* acompanhar o estado das mensagens;
* saber quando outro atendente está responsável por uma conversa.

---

## 3.2 Administrador

Usuário responsável pela configuração e gestão do sistema.

Pode possuir acesso a:

* conexão WhatsApp;
* usuários;
* configurações administrativas;
* integrações;
* regras operacionais;
* recursos de gestão.

Configurações administrativas não devem depender apenas de ocultação visual no frontend. Autorização deve ser aplicada também no backend quando necessário.

---

# 4. Core Product Areas

O Vitstock Hub é dividido conceitualmente nas seguintes áreas.

## 4.1 Atendimento

É uma das áreas centrais do produto e é responsável pela operação diária de conversas com clientes.

Principais conceitos:

* Inbox;
* lista de conversas;
* timeline de mensagens;
* composer;
* status das mensagens;
* mídia;
* documentos;
* realtime;
* estados de leitura;
* necessidade de resposta;
* responsável pela conversa.

A experiência deve favorecer velocidade operacional sem perder contexto.

---

# 5. Inbox

A Inbox representa o conjunto de conversas disponíveis para atendimento.

Cada conversa pode apresentar informações como:

* contato;
* última mensagem;
* horário da última atividade;
* estado de leitura;
* necessidade de resposta;
* atendente responsável;
* indicadores relevantes.

A ordenação deve refletir atividade recente sem regressões causadas por snapshots antigos ou eventos fora de ordem.

## 5.1 Não visualizada

Representa uma conversa que possui mensagem ainda não visualizada pelo operador. Ao visualizar corretamente a conversa, esse estado pode ser removido.

Esse conceito é independente de necessidade de resposta.

## 5.2 Não respondida

Representa uma conversa que ainda necessita de resposta da equipe. Visualizar uma conversa não significa respondê-la.

```text
não visualizada ≠ não respondida
```

Esses estados devem permanecer independentes.

---

# 6. Conversations

Uma Conversation representa o contexto de comunicação com um contato. Ela contém uma sequência cronológica de mensagens e metadados associados ao atendimento.

A conversa deve preservar:

* histórico;
* ordenação;
* identidade das mensagens;
* estado das mensagens;
* autoria;
* contexto do contato;
* informações operacionais.

Eventos duplicados ou snapshots antigos não devem criar mensagens duplicadas nem fazer o estado da conversa regredir.

---

# 7. Messages

Mensagens podem incluir:

* texto;
* imagem;
* vídeo;
* documento;
* outros formatos suportados pela integração.

Cada mensagem deve possuir identidade estável.

Quando disponível, o sistema acompanha estados como:

```text
pending
sent
delivered
read
failed
```

O envio pode utilizar atualização otimista para oferecer resposta imediata na interface. Posteriormente o estado local deve ser reconciliado com a confirmação real do backend/WhatsApp.

## 7.1 Retry

Mensagens que falharem podem oferecer mecanismo de nova tentativa quando tecnicamente seguro. O retry não deve gerar duplicação indevida.

## 7.2 Message Authorship

O sistema deve diferenciar mensagens enviadas:

* pelo operador através do Vitstock Hub;
* diretamente pelo WhatsApp;
* pelo WhatsApp Web;
* por outra integração.

Somente mensagens realmente enviadas através do Hub por um operador autenticado devem receber sua autoria. Mensagens externas não devem ser atribuídas automaticamente ao último atendente.

---

# 8. Realtime

O atendimento deve refletir novas mensagens e mudanças relevantes sem exigir atualização manual da página.

O sistema utiliza realtime para eventos como:

* nova mensagem;
* atualização de mensagem;
* mudança de status;
* atualização da conversa.

O objetivo funcional é que a interface permaneça sincronizada sem:

* duplicatas;
* saltos visuais;
* regressão de estado;
* ordenação incorreta;
* refetches desnecessários.

Detalhes técnicos pertencem ao `ARCHITECTURE.md`.

---

# 9. Conversation Timeline

A timeline apresenta o histórico da conversa e deve respeitar o contexto do operador.

Quando o operador estiver acompanhando o final:

* novas mensagens devem permanecer visíveis;
* envio deve acompanhar a mensagem mais recente.

Quando estiver consultando histórico:

* a posição deve ser preservada;
* novas mensagens não devem deslocar arbitrariamente o conteúdo;
* deve existir indicação perceptível de mensagens novas.

Carregamento de histórico e mídia não deve causar saltos inesperados.

---

# 10. WhatsApp Connection

O Hub depende da integração com WhatsApp para operação do Atendimento. A interface deve representar o estado real da conexão.

Se WhatsApp estiver desconectado:

* o sistema não deve transmitir falsa impressão de funcionamento;
* ações que dependem da conexão devem ser tratadas adequadamente;
* histórico antigo não deve ser confundido com conexão ativa.

O processo de conexão pode utilizar QR Code. O QR deve ser renovado quando necessário até:

* conexão;
* erro que exija intervenção;
* cancelamento do processo.

A interface deve privilegiar linguagem operacional em vez de detalhes técnicos de infraestrutura.

---

# 11. Conversation Ownership

O produto prevê controle de responsabilidade sobre conversas para reduzir respostas simultâneas de múltiplos atendentes.

O conceito planejado é um lease temporário:

```text
Atendente responde
        ↓
assume conversa
        ↓
lease temporário
        ↓
atividade renova lease
        ↓
inatividade libera conversa
```

Outros atendentes podem visualizar a conversa. Regras de concorrência devem ser garantidas pelo backend, não somente pela interface.

Os detalhes finais deste comportamento ainda podem evoluir conforme validação do produto.

---

# 12. Contacts

Contacts representam pessoas ou entidades que interagem com a Vitstock.

O módulo operacional de contatos centraliza:

* identificação;
* telefone;
* histórico;
* conversas;
* tags;
* informações comerciais;
* campos personalizados;
* observações;
* atividades e histórico de auditoria quando aplicável.

Telefones, e-mails e identidades de canal são valores separados do perfil.
Cada conversa continua sendo uma thread independente por identidade WhatsApp;
grupos permanecem no Atendimento e não aparecem como pessoas em Contatos.
Contatos podem ser pesquisados, paginados, etiquetados, arquivados e
mesclados/restaurados sob as permissões administrativas existentes. A
integração Google permanece a origem deliberada para salvar e editar dados
externos, sem apagar o contato local quando a sincronização falha.

O contato deve funcionar como ponto de união entre comunicação e relacionamento comercial.

---

# 13. CRM

O CRM deve complementar o Atendimento. O objetivo não é reproduzir um CRM corporativo completo.

Ele deve permitir acompanhar informações comerciais relevantes da operação da Vitstock. Possíveis conceitos incluem:

* contatos;
* leads;
* oportunidades;
* etapas;
* atividades;
* follow-ups;
* histórico.

A implementação desses conceitos depende de validação no roadmap. A presença neste documento não significa que todos estejam implementados atualmente.

---

# 14. Advertising Context

Algumas conversas podem realmente se originar de anúncios ou campanhas.

Informações de anúncio devem aparecer apenas quando existirem metadados reais associados à mensagem/interação correspondente.

Uma mensagem comum não deve receber contexto de anúncio por:

* herança de mensagem anterior;
* metadata antiga;
* estado compartilhado incorretamente;
* inferência sem evidência.

O produto deve privilegiar precisão sobre tentativa de preencher contexto automaticamente.

---

# 15. Search and Filters

À medida que o volume de conversas e contatos aumenta, busca e filtros tornam-se recursos operacionais importantes.

Podem considerar:

* contato;
* telefone;
* status;
* atendente;
* tags;
* estado de leitura;
* necessidade de resposta;
* período;
* outros atributos relevantes.

Filtros futuros devem priorizar cenários reais de operação.

---

# 16. Notifications

O sistema pode utilizar notificações para eventos operacionais relevantes.

Atualmente, novas mensagens recebidas podem produzir notificação sonora.

Notificações devem evitar falsos positivos causados por:

* histórico;
* mensagens enviadas pelo próprio operador;
* eventos duplicados;
* polling equivalente;
* mudanças apenas de status.

Preferências individuais de notificação podem ser consideradas futuramente.

---

# 17. Media

O Atendimento deve suportar mídia de maneira consistente, incluindo conforme suporte disponível:

* imagens;
* vídeos;
* documentos;
* PDFs.

Visualizadores devem possuir comportamento previsível, como fechamento pelo botão ou `Esc`, download quando apropriado e preview quando tecnicamente viável.

---

# 18. Settings

Configurações devem ser separadas conforme responsabilidade.

### Administrativas

* conexão WhatsApp;
* usuários;
* integrações;
* configurações globais.

### Pessoais

Possíveis exemplos futuros:

* senha;
* preferências;
* notificações.

A interface deve evitar expor detalhes técnicos desnecessários para usuários operacionais.

---

# 19. Product Status Vocabulary

Para evitar ambiguidade:

## Implemented

Existe no código. Não significa necessariamente que foi validado funcionalmente.

## Automated Validation Passed

Testes/build relevantes passaram. Não significa validação funcional.

## Awaiting Human Review

Implementação disponível para validação.

## Validated

Comportamento confirmado manualmente no Preview.

## Planned

Existe como intenção de produto. Não significa implementação autorizada.

## Research

Ideia ou alternativa em investigação. Não deve ser tratada como requisito.

---

# 20. Product Scope Discipline

Nem toda funcionalidade encontrada em Chatwoot, CRMs, ferramentas WhatsApp, plataformas SaaS, pesquisas ou benchmarks deve ser implementada.

Referências externas servem para:

* compreender problemas;
* identificar padrões;
* comparar soluções;
* descobrir alternativas.

A decisão final deve considerar:

1. necessidade real da Vitstock;
2. frequência do problema;
3. impacto operacional;
4. complexidade;
5. manutenção futura.

---

# 21. Current Product Priority

A prioridade atual é consolidar os fundamentos do Atendimento antes de expandir significativamente o produto.

```text
conexão confiável
        ↓
mensagens confiáveis
        ↓
realtime confiável
        ↓
Inbox confiável
        ↓
operação multiatendente
        ↓
contexto do cliente
        ↓
CRM
        ↓
automação
        ↓
analytics
```

O roadmap detalhado pertence a `ROADMAP.md`.

---

# 22. Product Philosophy

Vitstock Hub deve permanecer uma ferramenta prática.

A pergunta para uma nova funcionalidade não deve ser:

> "Outros CRMs possuem isso?"

A pergunta deve ser:

> "Isso resolve um problema suficientemente importante da operação da Vitstock para justificar sua complexidade?"

O objetivo não é construir o sistema com mais funcionalidades.

O objetivo é construir o sistema que melhor atende à operação para a qual ele existe.
