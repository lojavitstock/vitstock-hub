# Auditoria funcional e técnica — Vitstock Hub

Data: 04/08/2026  
Escopo: frontend React/Vite, backend Fastify/PostgreSQL, Evolution API, Google Contacts e experiência em navegador local.

## 1. Resumo executivo

O núcleo de autenticação, leitura de conversas do WhatsApp, exibição de mensagens, contatos locais/Google, QR Code e persistência de captura/status está conectado a serviços reais. A aplicação compila sem erros, a API local respondeu saudável e o banco respondeu conectado.

O produto, porém, ainda não deve ser tratado como um CRM completo em produção. Funil, Campanhas e grande parte de Configurações são protótipos em memória. No Atendimento existem lacunas de confiabilidade: notas internas não persistem, a criação de nova conversa é apenas local, falhas de envio podem parecer sucesso, a autoria histórica não é confiável e várias ações visíveis não possuem implementação.

Classificação geral: **MVP operacional no atendimento, com riscos altos de confiança e módulos incompletos**.

## 2. Metodologia e limites

Foram executados:

- login real no ambiente local;
- navegação e inspeção visual das seis telas;
- testes seguros de abas, filtros, busca e responsividade;
- inspeção de console do navegador;
- compilação do frontend e verificação TypeScript do backend;
- leitura das rotas, integrações e regras de persistência;
- verificação do endpoint de saúde e do banco.

Não foram disparadas ações com efeito externo ou comercial: envio real de WhatsApp, campanha, sincronização Google, criação/edição de contato, captura/liberação ou conclusão de atendimento. Esses fluxos foram auditados pelo código e pelos estados da interface.

## 3. O que está funcionando

### Base técnica

- Frontend compila com sucesso.
- Backend passa na verificação TypeScript.
- `/health` retorna API saudável e banco conectado.
- Autenticação por sessão funciona.
- Cookies são `httpOnly`; segredos da Evolution permanecem no backend.
- Entradas principais são validadas com Zod e consultas usam parâmetros SQL.
- Logs do servidor ocultam autorização, cookies e `set-cookie`.
- Tokens Google são armazenados criptografados.

### Atendimento e WhatsApp

- Lista de conversas e histórico real são carregados da Evolution.
- Status de conexão e QR Code usam endpoints reais.
- Texto, imagens, áudio, documentos, figurinhas e parte das mensagens interativas são interpretados.
- Controle de velocidade de áudio está disponível.
- Captura/liberação, Entrega e Resolvido possuem persistência própria no PostgreSQL.
- Nomes locais/Google têm prioridade sobre nomes incompletos da Evolution.
- O cartão de conversa não respondida recebe destaque visual.

### Contatos

- A lista é carregada do PostgreSQL, com fallback para conversas da Evolution.
- Busca por nome e telefone funciona.
- Conexão OAuth e sincronização Google estão implementadas.
- Inclusão/edição pelo painel do contato está integrada ao Google Contacts.
- Fotos reais do Google foram carregadas durante o teste.

## 4. Matriz de funcionalidades

| Módulo | Estado | Observação |
|---|---|---|
| Login e sessão | Funcional | Sem limitação de tentativas. |
| Atendimento — leitura | Funcional com ressalvas | Polling frequente; deduplicação pode manter item antigo. |
| Atendimento — envio | Parcial | Sem confirmação confiável de falha/entrega/leitura. |
| Captura do atendimento | Parcial | Persiste, mas não impede outro atendente de enviar. |
| Não respondidas | Parcial | Regra funciona, mas há uma regressão após reabrir conversa resolvida. |
| Entrega/Resolvidos | Parcial | Persistem; reabertura é calculada no frontend. |
| Mídias recebidas | Parcial | Vídeo não possui player; anexos enviados não existem. |
| Contatos/Google | Funcional com melhorias | Filtro de etiquetas e iniciar chat estão incompletos. |
| Funil CRM | Protótipo | Dados mockados e alterações apenas em memória. |
| Campanhas | Protótipo perigoso | A interface informa envio sem chamar API. |
| Conexões | Parcial | Estado/QR reais; textos de WebSocket são incorretos. |
| Configurações | Protótipo | Equipe, setores e respostas rápidas não têm CRUD real. |
| Mobile | Não funcional | Sidebar fixa ocupa 224 px de uma tela de 390 px. |
| Testes automatizados | Ausente | Não há testes unitários, integração ou E2E. |

## 5. Achados prioritários

### P0 — Corrigir antes de confiar a operação

#### 1. Campanhas exibem falso sucesso

`Disparar Agora` apenas mostra um toast dizendo que o envio ocorreu; nenhuma API é chamada. Criar, ativar e pausar campanhas também altera somente o estado do navegador e se perde ao atualizar.

Risco: a equipe acredita que uma oferta foi enviada quando nada aconteceu.

Recomendação: ocultar/desabilitar o módulo até existir backend, ou implementar campanhas, grupos reais, fila de jobs, agendamento, histórico e resultado por destinatário.

#### 2. “Nova Conversa” não inicia uma conversa real

O formulário apenas cria uma conversa no estado React. Não envia mensagem, não grava no banco e desaparece na próxima sincronização.

Risco: o atendente acredita que iniciou um contato que nunca existiu.

Recomendação: exigir mensagem inicial e chamar o backend/Evolution; só inserir na lista após confirmação.

#### 3. Notas internas não são persistidas

A nota é adicionada apenas ao array local de mensagens. A atualização automática do histórico substitui o array pelos dados da Evolution e remove a nota.

Risco: perda de informação interna e falha de colaboração.

Recomendação: criar tabela/rotas de mensagens internas e mesclar mensagens Evolution + internas por data.

#### 4. Falhas de envio podem parecer sucesso

O frontend adiciona a mensagem otimista antes da resposta. O serviço captura erros e retorna `null`, mas a tela não reverte nem marca falha. Além disso, mensagens históricas são classificadas como `read` sem consultar o estado real.

Risco: mensagem não entregue com aparência de enviada/lida.

Recomendação: implementar estados `pending`, `sent`, `delivered`, `read` e `failed`, com ID da Evolution, retry e feedback visível.

#### 5. Autoria e exclusividade do atendente não são confiáveis

Todas as mensagens `fromMe` do histórico recebem o nome do usuário atualmente logado, inclusive mensagens enviadas por outros atendentes. Uma conversa capturada por outro usuário continua com o compositor habilitado; o endpoint de envio não valida o responsável.

Risco: autoria incorreta e respostas simultâneas de atendentes diferentes.

Recomendação: persistir cada envio com `user_id`, mostrar a autoria real e bloquear no frontend e no backend o envio por usuário não responsável.

### P1 — Fluxos importantes incompletos ou incorretos

#### 6. Busca de Atendimento não funciona

O campo aceita texto, mas não possui estado nem filtro conectado. Durante o teste, contatos sem relação com a busca continuaram exibidos.

#### 7. “Iniciar Chat” em Contatos perde o contato escolhido

O botão apenas navega para `/atendimento`; não envia telefone/ID, não seleciona a conversa e não abre o modal preenchido.

#### 8. Reabertura de conversa resolvida tem regressão

Uma nova mensagem recebida após `Resolvido` aparece em `Abertos`, mas esse estado é calculado somente no frontend. Quando o atendente responde, a última mensagem passa a ser `fromMe` e o status persistido antigo (`resolved`) pode fazer a conversa voltar para Resolvidos sem novo clique em Concluído.

Recomendação: ao detectar novo evento recebido, persistir `open` no backend de forma idempotente.

#### 9. Anexos enviados e vídeos recebidos estão incompletos

O clipe de anexo não tem ação. Vídeos são reconhecidos apenas como texto (`[Vídeo]`), sem player ou download adequado.

#### 10. Ações visíveis sem implementação

- Atendimento: busca, clipe, menu de três pontos e “Criar Negócio no Funil”.
- Contatos: “Filtrar Etiquetas”.
- Funil: “Nova Oportunidade”; cards são mocks e não persistem.
- Configurações: convidar atendente, criar setor e criar atalho.

Recomendação: desabilitar com indicação “Em desenvolvimento” tudo que ainda não possui efeito real.

#### 11. Botões de mensagem interativa são parciais

Links, telefone e cópia têm tratamento. Botões de resposta rápida renderizados no histórico não preenchem nem enviam uma resposta.

#### 12. Conexões afirma usar WebSocket, mas a aplicação usa polling

A tela mostra “WebSocket Conectado”, “Sincronização em Tempo Real” e webhook ativo. O webhook atual apenas registra o nome do evento e descarta o conteúdo; o frontend consulta chats a cada 4 segundos, mensagens a cada 2 segundos e status a cada 30 segundos.

Risco: diagnóstico operacional enganoso e carga crescente na Evolution/API.

Recomendação: corrigir os textos imediatamente; depois processar webhooks e transmitir eventos ao frontend por SSE ou WebSocket.

### P2 — Desempenho, experiência e manutenção

#### 13. Renderização e consultas não escalam

- 467 contatos são renderizados de uma vez, sem paginação ou virtualização.
- A fila de atendimento também renderiza centenas de conversas.
- Cada usuário consulta chats + contatos da Evolution a cada 4 segundos.
- Abrir informações de contato pode listar toda a agenda Google para localizar um telefone.

Recomendação: paginação/virtualização, cache, busca no servidor e eventos em tempo real.

#### 14. Deduplicação pode manter conversa antiga

Quando dois JIDs representam o mesmo telefone, o código mantém o primeiro objeto e apenas melhora o nome; não substitui pelo item com mensagem mais recente apesar do comentário indicar isso.

#### 15. Layout mobile é inutilizável

Em viewport de 390 px, a sidebar fixa ocupa 224 px e restam apenas 166 px para todo o Atendimento. Não existe menu móvel nem mudança entre lista/conversa.

#### 16. Acessibilidade incompleta

- modais sem `role=dialog`, foco inicial, retenção de foco ou fechamento por Escape;
- vários botões apenas com ícone sem nome acessível;
- labels não associados aos campos por `htmlFor`/`id`;
- textos muito pequenos (9–11 px) em áreas operacionais.

#### 17. Configuração e código possuem valores rígidos

Nome da instância, URL de callback Google de produção, textos Oracle/Railway, grupos de campanha, setores e respostas rápidas estão fixos no código.

#### 18. Ausência de testes automatizados

Não há testes para parser de mensagens, regras de status, normalização de telefone, autorização, rotas Google/Evolution ou fluxos do navegador. O console também mostra avisos de migração futura do React Router.

## 6. Segurança

Pontos positivos:

- sessão por cookie `httpOnly`;
- validação de origem em operações mutáveis;
- validação Zod e SQL parametrizado;
- chaves externas ficam no backend;
- tokens Google criptografados;
- comparação segura do segredo do webhook;
- redação de cabeçalhos sensíveis nos logs.

Melhorias:

- adicionar rate limit e bloqueio progressivo no login;
- aplicar autorização de responsável no endpoint de envio;
- criar trilha de auditoria para captura, liberação, status, notas e mensagens;
- validar permissões por papel nas futuras rotas de equipe/configuração;
- adicionar limpeza/expiração operacional de sessões antigas;
- evitar callback Google de produção fixo no código; usar variável validada.

## 7. Plano recomendado

### Etapa 1 — Confiabilidade do Atendimento

1. Persistir mensagens enviadas, notas internas e autor real.
2. Criar outbox de envio com status e retry.
3. Impedir envio por atendente não responsável.
4. Tornar Nova Conversa e Iniciar Chat reais.
5. Corrigir busca, anexos, vídeo e ações sem implementação.
6. Persistir reabertura automática no backend.

### Etapa 2 — Eventos e desempenho

1. Processar webhook da Evolution de forma idempotente.
2. Usar SSE/WebSocket entre backend e frontend.
3. Reduzir polling e adicionar cache.
4. Paginar/virtualizar contatos, conversas e mensagens.
5. Evitar varrer toda a agenda Google a cada abertura de painel.

### Etapa 3 — Produto real

1. Implementar CRUD e persistência do Funil.
2. Implementar Campanhas com scheduler, grupos reais e logs de entrega.
3. Implementar equipe, setores/filas e respostas rápidas no backend.
4. Integrar “Criar Negócio” e atalhos ao Atendimento.

### Etapa 4 — Qualidade

1. Testes unitários do parser e regras de conversa.
2. Testes de integração do backend com serviços simulados.
3. Testes E2E de login, atendimento, contatos e status.
4. Layout responsivo e revisão de acessibilidade.

## 8. Critério de pronto para operação diária

O núcleo pode ser considerado confiável quando:

- nenhuma ação informa sucesso sem confirmação do backend;
- notas e mensagens sobrevivem a atualização/relogin;
- autoria e responsável são preservados;
- falhas de envio ficam visíveis e podem ser reenviadas;
- nova conversa e iniciar chat funcionam de ponta a ponta;
- status aberto/entrega/resolvido não regressam sozinhos;
- módulos protótipos estão implementados ou claramente desabilitados;
- os fluxos críticos têm testes automatizados.
