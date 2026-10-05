# Vitstock Hub — Design System V1.2

**Status:** candidato congelado para Design System Validation Gate — Run 2
**Produto:** Vitstock Hub
**Escopo:** apresentação e interação do frontend
**Não é:** especificação de backend, contrato de dados, autorização ou realtime

Este documento é o contrato visual do Vitstock Hub V1.2. Ele deve ser suficiente
para que um agente implemente uma tela coerente sem screenshots, imagens
conceituais ou acesso aos componentes visuais existentes.

As palavras **MUST**, **MUST NOT**, **SHOULD** e **MAY** são normativas:

- **MUST / MUST NOT:** regra obrigatória;
- **SHOULD:** regra padrão; uma exceção precisa ser justificada no próprio
  componente;
- **MAY:** escolha permitida quando não conflitar com uma regra mais específica.

## 1. Contexto e objetivo do produto

O Vitstock Hub é um CRM operacional de atendimento, com foco em conversas via
WhatsApp, Inbox compartilhada, contexto do contato e execução rápida pela equipe.
Ele deve parecer uma ferramenta de operação diária, não uma landing page, um
dashboard de métricas ou um produto de marketing.

A familiaridade conceitual do WhatsApp Web é desejada na leitura da Inbox e da
conversa: lista à esquerda, conversa ativa ao centro, composição no rodapé,
identidade clara do contato e pouca surpresa nas interações. A interface não
deve copiar logotipo, ilustrações, cores, assets ou detalhes proprietários do
WhatsApp.

### Ordem de prioridades

Quando duas decisões visuais entrarem em conflito, use esta ordem:

1. entendimento imediato do que está acontecendo;
2. velocidade para localizar, ler e responder;
3. visibilidade de estados, autoria, responsabilidade e falhas;
4. conforto de leitura prolongada e baixa carga cognitiva;
5. acessibilidade, teclado e touch;
6. consistência entre componentes;
7. personalidade visual da marca.

O produto é **dark-first**, denso e silencioso. A densidade deve reduzir o
deslocamento e a quantidade de decisões, nunca reduzir legibilidade ou alvo de
interação.

## 2. Limite funcional do design

Este documento governa somente a forma como o produto apresenta e permite
operar estados já definidos. Ele **MUST NOT** ser usado para autorizar:

- alteração de backend, banco, rotas, autenticação ou autorização;
- mudança de SSE, polling, reconciliação, ordenação ou deduplicação;
- mudança de scroll, cache, identidade de contatos, JIDs ou mensagens;
- mudança de regras de ownership, status, entrega, leitura ou resposta;
- criação de integrações, envio real, campanhas ou persistência de dados;
- alteração de configuração operacional, secrets ou ambiente.

Se uma decisão visual parecer exigir uma mudança funcional, preserve o contrato
funcional atual e registre a necessidade como uma questão separada. O design
deve representar o estado real; nunca deve transformar `connecting` em
"conectado", uma mensagem pendente em enviada ou uma ação sem efeito em sucesso.

## 3. Filosofia visual

### 3.1 Princípios

- **Operacional antes de ornamental:** cada cor, linha e movimento deve ajudar a
  localizar, interpretar ou executar uma tarefa.
- **Hierarquia por superfícies:** use níveis de fundo, bordas hairline e espaço
  consistente; não dependa de sombra forte ou cor vibrante.
- **Amarelo como instrumento:** `#FFBC00` marca ação, foco, seleção e atenção;
  não pinta a aplicação inteira.
- **Densidade legível:** priorize informação por área, mas preserve texto
  principal de no mínimo 14px e alvos interativos de no mínimo 36px no desktop
  e 44px em touch.
- **Estado explícito:** seleção, não lida, precisa de resposta, falha,
  reconexão e ownership devem ser distinguíveis por mais de uma pista.
- **Geometria moderada:** cantos pequenos ou médios, sem aparência de app
  infantil e sem excesso de cápsulas.
- **Familiaridade sem imitação:** use padrões reconhecíveis de mensageria, mas
  mantenha linguagem, tokens e proporções próprios do Vitstock.

### 3.2 Atmosfera

A atmosfera padrão é um conjunto de superfícies escuras quase neutras, com
contraste controlado e pequenos sinais cromáticos. O fundo da timeline é liso;
**MUST NOT** usar wallpaper, textura, padrão decorativo, fotografia,
glassmorphism, blur de fundo ou gradiente ornamental.

Não use grandes áreas de amarelo institucional, branco puro ou preto absoluto.
O preto da marca aparece como texto/contraste e em pequenos elementos, enquanto
as superfícies usam a escala dark definida abaixo.

## 4. Tokens semânticos

Implementações **MUST** referenciar tokens semânticos, não espalhar hexadecimais
diretamente nos componentes. Os nomes abaixo são o contrato; CSS variables,
Tailwind theme ou outro mecanismo equivalente podem ser usados.

### 4.1 Cor

#### Núcleo da identidade

| Token | Valor | Papel |
|---|---|---|
| `identity.yellow` | `#FFBC00` | Amarelo institucional; corresponde a `brand.primary` |
| `identity.black` | `#0B0D0F` | Preto de base; corresponde a `surface.canvas` |
| `identity.white` | `#F3F5F6` | Branco de leitura; corresponde a `text.primary` |
| `identity.gray` | `#56545E` | Cinza institucional para neutralidade/terciário, nunca para texto principal |

O preto, branco e cinza institucionais são referências da identidade, não uma
autorização para usar superfícies planas em preto absoluto, branco puro ou texto
cinza de baixo contraste. A aplicação usa as derivações semânticas abaixo.

#### Marca e ação

| Token | Valor | Uso |
|---|---|---|
| `brand.primary` | `#FFBC00` | Ação primária, foco, item selecionado, indicador importante, tag importante |
| `brand.hover` | `#FFD04A` | Hover de ação primária em superfície escura |
| `brand.pressed` | `#D99D00` | Pressionado/ativo |
| `brand.on-primary` | `#171717` | Texto/ícone sobre `brand.primary` |
| `brand.soft` | `#3A300E` | Fundo discreto de seleção/atenção |
| `brand.soft-strong` | `#54440D` | Fundo de tag/estado de atenção com texto claro |

`brand.primary` deve aparecer em pequenas proporções. Em uma viewport
operacional, não deve formar um painel inteiro ou uma faixa decorativa. Uma
ação primária pode ser preenchida; seleção e foco devem preferir linha, borda,
dot ou fundo `brand.soft`.

#### Superfícies dark

| Token | Valor | Papel |
|---|---|---|
| `surface.canvas` | `#0B0D0F` | Fundo geral e áreas sem elevação |
| `surface.sidebar` | `#101416` | Navegação lateral recolhida/expandida |
| `surface.1` | `#13191C` | Lista, header, composer e painéis base |
| `surface.2` | `#182125` | Hover, item selecionado, campo e cartão operacional |
| `surface.3` | `#1E292E` | Card elevado, mensagem recebida, controles destacados |
| `surface.4` | `#253238` | Menu, popover, tooltip e dialog interno |
| `surface.scrim` | `rgba(0, 0, 0, 0.64)` | Overlay de dialog/drawer |

Um componente MUST subir no máximo um nível de superfície por relação de
hierarquia. Não pule para `surface.4` apenas para chamar atenção.
A timeline do Atendimento **MUST** usar `surface.canvas` (`#0B0D0F`) como fundo
padrão. `surface.1` **MUST NOT** ser usado como alternativa para a timeline. A
hierarquia padrão é: sidebar em `surface.sidebar`, Inbox em `surface.1`, timeline
em `surface.canvas`, mensagens recebidas em `message.incoming.background` e
mensagens enviadas em `message.outgoing.background`.

#### Texto

| Token | Valor | Uso |
|---|---|---|
| `text.primary` | `#F3F5F6` | Texto principal, título, conteúdo de mensagem |
| `text.secondary` | `#C4CCD0` | Apoio, preview, nome secundário |
| `text.muted` | `#929DA3` | Metadata, placeholder, timestamp |
| `text.subtle` | `#849096` | Texto terciário e ícone inativo |
| `text.disabled` | `#566168` | Controle indisponível; nunca para informação essencial |
| `text.inverse` | `#17191A` | Texto sobre amarelo institucional |
| `text.link` | `#9CCBFF` | Link e ação textual em fundo dark |

Não use `#FFFFFF` como texto padrão e não use cinza abaixo de `text.muted` para
texto necessário à operação.
`text.subtle` permanece abaixo de `text.muted` na hierarquia. Como texto normal,
pode ser usado sobre `surface.canvas`, `surface.sidebar`, `surface.1`,
`surface.2` e `surface.3`, onde mantém contraste mínimo de 4.5:1. Sobre
`surface.4`, use `text.muted` como texto; `text.subtle` ainda pode ser usado
para ícones inativos quando o contraste do ícone for de pelo menos 3:1.

#### Bordas e estados semânticos

| Token | Valor | Uso |
|---|---|---|
| `border.subtle` | `#263238` | Divisórias e contornos padrão |
| `border.default` | `#344148` | Campo, card e separação visível |
| `border.strong` | `#4A5961` | Contorno enfatizado ou hover persistente |
| `focus.ring` | `#FFBC00` | Foco de teclado e foco de formulário |
| `status.success` | `#45C17A` | Conectado, confirmado, lido |
| `status.info` | `#65A9FF` | Informação, sincronização, link operacional |
| `status.warning` | `#F0B85A` | Atenção, reconectando, pendente |
| `status.danger` | `#F26B6B` | Falha, desconectado, destrutivo |
| `status.neutral` | `#8C999F` | Inativo, desconhecido ou sem dados |

Estado semântico MUST incluir texto, ícone ou forma além da cor. Vermelho,
verde e amarelo não podem ser a única diferença entre estados.

#### Mensagens

| Token | Valor | Uso |
|---|---|---|
| `message.incoming.background` | `#1E292E` | Bolha recebida |
| `message.incoming.text` | `#F1F4F5` | Texto recebido |
| `message.outgoing.background` | `#4B493A` | Bolha enviada; amarelo suave e dessaturado |
| `message.outgoing.border` | `#6C674D` | Contorno discreto da bolha enviada |
| `message.outgoing.text` | `#F5F1D8` | Texto enviado confortável para leitura |
| `message.meta` | `#9EA39A` | Horário e metadata da mensagem |
| `message.internal.background` | `#3A3320` | Nota interna não visível ao cliente |
| `message.internal.border` | `#806A28` | Contorno da nota interna |
| `message.system.background` | `#182125` | Separador/aviso de sistema |
| `message.quote.background` | `#151C1F` | Superfície da resposta citada dentro da mensagem |
| `message.quote.border` | `#FFBC00` | Barra lateral da resposta citada |
| `message.quote.author` | `#F3F5F6` | Autor/origem da resposta citada |
| `message.quote.text` | `#C4CCD0` | Trecho citado |

Toda bolha de mensagem enviada **MUST** usar exatamente os tokens
`message.outgoing.background` (`#4B493A`), `message.outgoing.border` (`#6C674D`)
e `message.outgoing.text` (`#F5F1D8`). A implementação MUST usar esses tokens
sem ajuste, mistura, opacidade ou substituição local. `#FFBC00` e `brand.primary`
**MUST NOT** ser usados como fundo de mensagem enviada. Se esse tom precisar ser
alterado futuramente, a mudança deve ocorrer neste documento e valer para todas
as implementações.

### 4.2 Tipografia

Use `Inter` quando disponível, com fallback:

```text
Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
```

Não exigir download de fonte para a tela mock. A substituição pelo fallback não
deve alterar a hierarquia. Use pesos 400, 500, 600 e 700; evite 800 e 900.

| Token | Tamanho | Peso | Line-height | Uso |
|---|---:|---:|---:|---|
| `type.page-title` | 20px | 600 | 28px | Título da área |
| `type.section-title` | 16px | 600 | 22px | Cabeçalho de painel |
| `type.body` | 14px | 400 | 20px | Conteúdo padrão e mensagem |
| `type.body-strong` | 14px | 600 | 20px | Nome, item ativo, label importante |
| `type.body-compact` | 13px | 400 | 18px | Preview, controles compactos |
| `type.button` | 13px | 600 | 18px | Botões e navegação expandida |
| `type.meta` | 12px | 400 | 16px | Timestamp, status e ajuda |
| `type.badge` | 11px | 600 | 14px | Contadores e tags curtas |
| `type.mono` | 12px | 500 | 16px | IDs/valores técnicos quando inevitável |

Regras adicionais:

- títulos de tela não são enormes; o produto precisa preservar área de trabalho;
- não usar texto todo em caixa alta, exceto abreviações reais e pequenas labels;
- não usar `type.badge` para corpo de mensagem ou instrução;
- mensagens usam `type.body` e line-height de 20px;
- timestamps, status e texto auxiliar usam `type.meta`, nunca texto com menos de
  11px;
- o peso cria hierarquia antes de aumentar o tamanho ou a saturação da cor.

### 4.3 Espaçamento e densidade

Use unidade base de 4px:

| Token | Valor | Uso típico |
|---|---:|---|
| `space.1` | 4px | Separação de ícone e texto, microajuste |
| `space.2` | 8px | Gap interno compacto |
| `space.3` | 12px | Padding de linha, campo, menu |
| `space.4` | 16px | Padding padrão de painel |
| `space.5` | 20px | Respiro entre grupos |
| `space.6` | 24px | Seção interna ou dialog |
| `space.8` | 32px | Separação de blocos maiores |
| `space.10` | 40px | Margem excepcional em telas de configuração |

O Atendimento usa densidade compacta:

- item de conversa: 68px de altura padrão; 76px se houver duas linhas de preview
  e tags visíveis;
- avatar da lista: 40px;
- header da conversa: 64px;
- composer: 76–96px conforme o anexo/estado, sem cobrir a timeline;
- divisória: 1px;
- gap entre mensagens próximas: 8px; separador de dia: 16px;
- `space.10` não deve aparecer entre mensagens, itens de lista ou controles de
  operação.

Densidade nunca justifica truncar nome, mensagem ou estado essencial sem
tooltip/expansão acessível.

### 4.4 Tamanho, raio e elevação

#### Tamanhos

| Elemento | Desktop | Touch/mobile |
|---|---:|---:|
| Ícone padrão | 18px | 20px |
| Ícone de ação | 16px | 20px |
| Ícone button | caixa 36×36px | caixa 44×44px |
| Campo/combo padrão | 36px | 44px |
| Botão padrão | min-height 36px | min-height 44px |
| Avatar de conversa | 40px | 40px |
| Avatar de mensagem | 28px | 32px |

#### Radius

| Token | Valor | Uso |
|---|---:|---|
| `radius.xs` | 4px | Controles pequenos, tooltip |
| `radius.sm` | 6px | Tags, campos compactos, menus pequenos |
| `radius.md` | 8px | Botões, inputs, cards, bolhas |
| `radius.lg` | 10px | Dialogs, drawers e cards maiores |
| `radius.full` | 9999px | Avatares, dot e contador isolado |

Não usar `radius.full` em botões, cards, inputs ou bolhas de mensagem. Pills
ficam reservadas para contador pequeno ou avatar; uma tag comum usa 6px.

#### Bordas e elevação

- padrão: 1px `border.subtle`;
- contorno de campo: 1px `border.default`;
- foco: outline de 2px `focus.ring` com 2px de offset, sem depender só de sombra;
- elevação 0: sem sombra;
- elevação 1: `0 2px 8px rgba(0,0,0,.18)` para menu/card destacado;
- elevação 2: `0 8px 24px rgba(0,0,0,.28)` somente para dialog/drawer;
- não usar sombra luminosa amarela nem sombra para substituir contraste.

## 5. Primitives e componentes

### 5.1 Navegação e sidebar

A sidebar principal inicia **recolhida por padrão**:

- largura: 64px;
- fundo: `surface.sidebar`;
- borda direita: 1px `border.subtle`;
- logo/símbolo no topo em área de 64×64px, sem grande placa amarela;
- itens em caixa de 44×44px, centralizados;
- ícones de 20px, stroke uniforme;
- nomes ficam ocultos, mas cada item mantém `aria-label` e `title`/tooltip;
- controle de expandir fica visível, com `aria-expanded` e `aria-controls`;
- estado expandido usa largura 228px, revela nome + ícone e mantém a mesma ordem;
- transição de largura dura 160ms e não desloca conteúdo de modo abrupto;
- o estado expandido pode ser persistido apenas se isso já existir no produto;
  o design não exige nova persistência.

Estado de navegação:

- item ativo: fundo `surface.2`, linha vertical esquerda de 3px em
  `brand.primary`, ícone/texto `text.primary`;
- item inativo: `text.secondary`, sem borda colorida;
- hover: `surface.2` e `border.default`, sem trocar todo o item para amarelo;
- foco: anel `focus.ring` visível;
- badge numérico: `brand.primary` com `text.inverse`, apenas se houver número
  real; não inventar contagem.

O rodapé da sidebar pode mostrar status de conexão, integração e usuário. Cada
status deve ser um item separado, com dot + ícone + label acessível. Não chamar
SSE, polling ou qualquer conexão de "WebSocket" se esse não for o estado real.

### 5.2 Navigation de área

O cabeçalho de uma área tem entre 56px e 64px, usa `surface.1`, borda inferior
`border.subtle` e contém, nesta ordem quando aplicável: título, contexto/contagem,
espaço flexível, busca/ação secundária, ação primária. Não repetir o título em
vários níveis.

Tabs de filtro podem ser compactas, mas não devem virar uma fileira de pills
coloridas. A aba selecionada usa `surface.2` + texto `text.primary` + indicador
`brand.primary`; a não selecionada usa texto `text.muted`.

### 5.3 Lista de conversas

Cada item tem a anatomia fixa:

1. avatar de 40px;
2. coluna flexível com nome e preview;
3. timestamp no topo direito;
4. estado/contador/tags em linha secundária quando existirem.

Regras:

- nome: `type.body-strong`, uma linha, truncamento com acesso ao nome completo;
- preview: `type.body-compact` em `text.secondary`, máximo duas linhas;
- timestamp: `type.meta` em `text.muted`;
- avatar de grupo pode usar composição própria, mas não deve ser confundido com
  avatar individual;
- `unread` e `needsResponse` são estados distintos e devem continuar distintos
  na forma e na label;
- no produto real, a ordenação exibida deve respeitar a fonte funcional atual;
  o design não cria outra ordenação. No mock do Gate, use uma ordem estável
  somente conforme a ambiguidade controlada da seção 16.

Estados da linha:

| Estado | Tratamento visual |
|---|---|
| padrão | transparente sobre `surface.1`, texto secundário |
| hover | fundo `surface.2`, borda apenas se necessária |
| foco | fundo `surface.2` + anel `focus.ring` |
| selecionada | fundo `surface.2`, indicador esquerdo de 3px `brand.primary`, texto principal |
| não lida | nome em 600, dot `brand.primary` de 8px e contador se real |
| precisa de resposta | pequeno indicador `status.warning` + label/tooltip; não substituir o dot de não lida |
| erro/atenção | indicador `status.danger` + texto explicativo; nunca apenas um glow |
| desabilitada | `text.disabled`, sem hover, razão acessível |

Uma linha pode ser selecionada e não lida ao mesmo tempo. A seleção não apaga
automaticamente o estado de não lida; isso pertence ao contrato funcional.

### 5.4 Chat header

O header da conversa tem 64px, `surface.1`, borda inferior de 1px e padding
horizontal de 16px. Contém avatar, nome do contato, telefone ou contexto em
`text.muted`, e estado operacional/ownership quando real. Ações à direita são
icon buttons com label acessível, separadas por no máximo 8px.

O nome é o elemento mais forte. Status de conexão, captura e responsabilidade
não devem competir visualmente com ele. Em grupos, mostrar o nome do grupo e
participante somente quando o estado funcional o fornecer.

### Painel de contexto do contato

Em viewports a partir de 1440px, quando houver contexto de contato disponível,
o Atendimento **MUST** manter o painel de contexto persistente à direita, na
composição `sidebar | inbox | conversa | painel de contexto`. A largura padrão é
336px, com mínimo de 320px e máximo de 360px. Em ambos os modos — persistente e
sobreposto — use superfície `surface.1`, borda esquerda de 1px `border.subtle` e
hierarquia visual secundária à conversa.

A conversa **MUST** conservar no mínimo 480px de largura útil. Se a largura
disponível não permitir esse mínimo, o painel de contexto **MUST** ceder espaço e
abrir como Drawer sobreposto; nunca comprima a conversa abaixo de 480px. Quando
não houver contexto de contato disponível, não reserve uma coluna vazia.
No modo sobreposto em desktop, o Drawer de contexto mantém largura padrão de
336px, limitada a 320–360px quando o viewport permitir; abaixo de 768px, ocupa
100% da largura disponível.

O controle de contexto no header da conversa, quando disponível no produto,
identifica a abertura/fechamento do painel ou Drawer. Todo Drawer de contexto,
inclusive a visualização full-screen em mobile, **MUST** ter nome acessível e
`role="dialog"` com `aria-modal="true"`; **MUST** manter o foco do teclado dentro
dele, fechar por Escape e devolver o foco ao controle que o abriu. A visualização
full-screen em mobile também oferece controles explícitos de voltar e fechar.

#### Anatomia interna do painel

Quando os dados existirem, o painel **MUST** apresentar suas seções nesta ordem:
identidade; estado operacional/responsabilidade; tags; dados do contato; notas e
contexto interno. Se uma seção não tiver dados aplicáveis, omita-a sem inventar
valores ou placeholders que pareçam reais.

1. **Identidade:** avatar, nome do contato, telefone ou identificador secundário
   e uma informação curta de contexto quando disponível. O nome tem a maior
   hierarquia; telefone e contexto usam `text.muted`.
2. **Estado operacional/responsabilidade:** responsável/operador, estado da
   conversa, conexão ou outro estado funcional real, somente quando aplicável.
   Use os status semânticos existentes; não transforme a seção em dashboard.
3. **Tags:** grupo próprio, seguindo exclusivamente as regras existentes de
   Tag/Badge; não crie grandes áreas coloridas.
4. **Dados do contato:** linhas compactas `label` / `valor`, sem card separado
   por campo. Labels usam `type.meta` + `text.muted`; valores usam `type.body` +
   `text.primary` ou `text.secondary`. O espaço vertical entre linhas é de
   8–12px.
5. **Notas:** seção visual intitulada “Notas”. Use título `type.section-title` ou
   `type.body-strong`; cada item usa `surface.2`, borda `border.subtle`,
   `radius.md` e padding 12px. O texto usa `type.body` / `text.secondary` e pode
   incluir metadata opcional em `type.meta`. O mock pode mostrar autor/data
   fictícios.

Notas de contexto do contato **MUST NOT** parecer a “Nota interna” centralizada
na timeline: não use sua composição/alinhamento nem a apresente como mensagem
da conversa. São conteúdo do painel, não uma nova mensagem. Não invente edição,
criação ou persistência de notas se isso não fizer parte do produto.

### 5.5 Mensagens

Timeline usa exclusivamente `surface.canvas` (`#0B0D0F`) como fundo, com padding
horizontal responsivo de 16–24px e coluna com leitura vertical. O container
externo de cada mensagem, que agrupa texto, reply, mídia, product card ou
conteúdo composto, MUST usar `max-width: min(72%, 720px);` a partir de 768px e
`max-width: 88%;` abaixo de 768px. O mesmo limite rege a largura total desses
conteúdos; seus elementos internos podem ter limites próprios mais restritivos
quando especificados. Nunca force palavras longas para fora da tela. O conteúdo
preserva whitespace e links têm affordance clara.

#### Recebida

- alinhada à esquerda;
- fundo `message.incoming.background`;
- texto `message.incoming.text`;
- borda 1px `border.subtle`;
- `radius.md`, com o canto superior esquerdo reduzido a 4px para agrupar;
- avatar de 28px pode aparecer na primeira mensagem do bloco;
- metadata abaixo, alinhada ao início.

#### Enviada

- alinhada à direita;
- fundo `message.outgoing.background`, dessaturado;
- texto `message.outgoing.text`;
- borda `message.outgoing.border` discreta;
- `radius.md`, com o canto superior direito reduzido a 4px;
- nome do operador aparece somente quando a autoria/estado funcional o exigir;
- hora e status ficam abaixo, alinhados ao fim.

#### Resposta citada (quoted reply)

A resposta citada **MUST** aparecer dentro da bolha da mensagem, antes do
conteúdo principal. Ela **MUST** usar `message.quote.background`, `radius.sm`,
padding interno de `8px 10px` e uma barra esquerda de 3px em
`message.quote.border`, mantendo 8px de distância do conteúdo principal. O
amarelo institucional aparece somente nessa barra; a citação não é uma segunda
mensagem independente nem uma grande superfície amarela.

Autor/origem usa `message.quote.author` em `type.badge` ou `type.body-compact`,
peso 600. O trecho usa `message.quote.text` em `type.meta` ou
`type.body-compact`, limitado a no máximo duas linhas. Se houver truncamento,
o trecho completo deve permanecer disponível para tecnologias assistivas e deve
haver acesso claro ao conteúdo completo por teclado/touch quando necessário. A
anatomia e os quatro tokens são idênticos em mensagens recebidas e enviadas. Esta
regra governa somente a apresentação e não define comportamento funcional de
reply.

#### Sistema

Eventos de sistema não são bolhas de conversa. Usam linha centralizada ou
cartão horizontal de no máximo 600px, fundo `message.system.background`,
`text.muted`, ícone neutro e `type.meta`. Devem ser visualmente secundários.

#### Nota interna

A nota interna **MUST** ser um bloco próprio, centralizado horizontalmente na
timeline, visualmente separado das mensagens recebidas e enviadas. Use
`width: min(100%, 640px)`, `max-width: 640px` e margens horizontais automáticas;
em espaços menores, a largura acompanha o espaço disponível. Use
`message.internal.background`, borda `message.internal.border`, ícone de cadeado,
label explícita "Nota interna" e o texto "Visível somente para a equipe". A nota
**MUST NOT** usar alinhamento típico de mensagem recebida ou enviada nem parecer
uma mensagem enviada ao cliente.

#### Status de envio

O rodapé da mensagem deve distinguir `pending`, `sent`, `delivered`, `read` e
`failed` por ícone + texto/tooltip. `pending` usa `status.warning`, `failed`
usa `status.danger` e oferece retry quando permitido. Não mostrar check verde
para uma mensagem que ainda não foi confirmada.

### 5.6 Composer

O composer permanece ancorado ao final da conversa, sem cobrir conteúdo e sem
alterar a posição de scroll de outro modo que o contrato atual não permita.

- container: `surface.1`, borda superior `border.subtle`, padding 12px 16px;
- textarea: `surface.2`, altura mínima 44px em touch e 36px em desktop, resize
  vertical opcional apenas se já suportado;
- placeholder: `text.muted`, nunca instrução longa;
- ações de anexo, emoji, resposta e produto são icon buttons de 36/44px;
- ação Enviar usa `brand.primary` somente quando habilitada;
- enviar desabilitado usa `surface.3` + `text.disabled`, sem fingir sucesso;
- reply/edit/attachment preview aparece acima do campo, com botão de remover e
  label clara;
- erro de envio fica próximo ao composer e na mensagem falha, sem toast único
  como única evidência.

O documento não redefine atalhos, Enter, Shift+Enter, `/`, `\\`, draft ou retry:
essas regras permanecem as do produto e do backend. A aparência deve acomodar
os estados existentes sem mudar o comportamento.

### 5.7 Buttons e icon buttons

#### Button com texto

- primário: fundo `brand.primary`, texto `brand.on-primary`, radius 8px,
  padding horizontal 12–16px, min-height 36px;
- secundário: fundo `surface.2`, texto `text.primary`, borda `border.default`;
- terciário: fundo transparente, texto `text.secondary`, sem borda;
- destrutivo: fundo `status.danger` somente para confirmação final; preferir
  secundário com texto danger antes da ação;
- hover muda superfície/borda, não aplica escala ou salto;
- pressed usa `brand.pressed` ou um nível de superfície mais escuro;
- loading mantém largura e mostra indicador + label, sem duplicar clique.

#### Icon button

Cada icon button MUST ter nome acessível, foco de teclado e target mínimo. O
ícone não deve ser uma ilustração decorativa. Use iconografia outline consistente
com stroke 1.75–2px, caixa óptica centralizada e no máximo dois pesos visuais.

### 5.8 Inputs, search, select e textarea

- label visível por padrão; `aria-label` só substitui label quando o contexto é
  inequívoco, como busca com placeholder "Buscar conversas";
- campo padrão: 36px desktop / 44px touch, padding 8px 12px, radius 8px;
- search inclui ícone à esquerda e botão claro somente quando houver texto;
- select mostra chevron e estado selecionado; não usar lista customizada se o
  native select atender acessibilidade;
- textarea mantém padding superior suficiente para texto multilinha;
- focus: `border.strong` + anel de 2px `focus.ring`;
- erro: `status.danger` + mensagem específica abaixo, sem depender apenas de
  borda vermelha;
- disabled: `surface.1`, `text.disabled`, cursor not-allowed e razão quando
  relevante.

### 5.9 Tags e badges

Tags são metadados operacionais compactos, radius 6px, padding 2px 6px,
`type.badge`, fundo de baixa saturação e texto legível. A tag importante pode
usar `brand.soft-strong` + `brand.primary`/`text.primary`; não usar `brand.primary`
como faixa cheia.

Badges numéricos pequenos podem ser circulares/pill. Status deve preferir dot +
label. Não transformar cada filtro, status e categoria em pill colorida.

### 5.10 Avatars

Avatares são 40px na lista/header, 28–32px na timeline e 32–40px no perfil.
Sempre têm nome alternativo ou label acessível. Fallback de iniciais usa
superfície determinística da paleta dark; pode usar pequeno detalhe `brand.soft`,
mas não uma foto externa necessária para compreensão.

Status online/offline é um dot de 8px com borda de 2px na cor da superfície.
Não animar avatar continuamente.

### 5.11 Cards e product cards

Cards são raros no Atendimento. Use card quando houver agrupamento de informação
ou ação, não para envolver cada linha da tela.

Card padrão: `surface.2`, borda `border.subtle`, radius 8px, padding 16px.
Card destacado: `surface.3`, borda `border.default`; não usar sombra forte.

Product card em mensagem é um card interno de até 360px, com imagem 72×72px,
nome em `type.body-strong`, preço em `type.body-strong` e metadata em
`type.meta`. A imagem usa radius 6px; o card preserva a cor da mensagem pai e
não vira uma superfície amarela. Use dados fictícios no mock.

## 6. Overlays e feedback

### Dialog

- overlay `surface.scrim`;
- largura padrão 480px, máximo 720px para conteúdo de formulário;
- fundo `surface.3`, borda `border.default`, radius 10px, elevação 2;
- header com título 16px e fechar nomeado;
- body padding 20–24px; footer com ações alinhadas ao fim;
- foco inicial, focus trap, `Escape` e retorno do foco são obrigatórios;
- ações destrutivas ficam visualmente separadas e exigem confirmação clara.

### Drawer

Drawers genéricos, exceto o painel de contexto do contato, têm 336px no desktop,
`surface.2`, borda no lado de abertura e elevação 2. O painel de contexto segue
as regras exclusivas de largura e composição das seções "Painel de contexto do
contato" e "Breakpoints de referência". Drawers genéricos em mobile ocupam a
largura total e mantêm header com voltar/fechar. Não usar drawer estreito para
formulário complexo.

### Menu e popover

Menu usa `surface.4`, borda `border.default`, radius 6px, padding 4px e itens
de 36px desktop/44px touch. Agrupe itens relacionados, divida destrutivo e
mostre shortcut somente se existir. O menu abre ancorado ao controle e nunca
fica cortado sem reposicionamento.

### Tooltip

Tooltip é reservado para ícone sem nome visível, principalmente sidebar
recolhida. Aparece após aproximadamente 300ms, não contém ação, usa
`surface.4` + `text.primary` e tem texto curto. Em touch, não dependa dele.

### Toast

Toast confirma somente resultado já conhecido. Posição padrão: canto superior
direito, abaixo do espaço seguro, largura máxima 360px. Inclui ícone + título
curto + mensagem; erro pode incluir ação. Não usar toast como única forma de
mostrar uma falha de envio, perda de rascunho ou estado persistente.

### Banner

Banner ocupa a largura do painel relevante, não a tela inteira sem motivo.
Usa ícone, texto e ação opcional:

- info: fundo `#1B2A3B`, `status.info`;
- warning: fundo `brand.soft`, `status.warning`;
- error: fundo `#3B2227`, `status.danger`;
- success: fundo `#1D3529`, `status.success`.

## 7. Loading, empty, error e conexão

### Loading

Use skeleton em forma e tamanho próximos do conteúdo final para lista, header e
mensagens. Skeleton usa `surface.3` com animação de opacidade muito discreta.
Spinner é permitido em ação local ou overlay pequeno; não substituir a tela
inteira por spinner se o layout puder permanecer visível.

### Empty

Empty state explica o que está vazio e qual próxima ação existe. Tem título
`type.section-title`, texto curto `text.secondary`, ícone simples e botão
somente quando houver ação real. Não usar ilustração decorativa nem mensagem
genérica de sucesso.

### Error

Erro mostra o que falhou, impacto e ação recuperável quando disponível. Use
`status.danger` com texto; preserve conteúdo útil já carregado. Não apagar
timeline/lista por uma falha transitória sem representar essa condição.

### Reconnecting e offline

`connected`, `connecting/reconnecting` e `disconnected` são estados distintos:

- **connected:** dot `status.success`, label "Conectado";
- **connecting/reconnecting:** dot `status.warning`, ícone de sincronização sem
  animação infinita agressiva, label "Reconectando";
- **disconnected:** dot `status.danger`, label "Desconectado" e ação/admin
  correspondente quando existir.

Reconectando/desconectado **MUST NOT** ser apresentado como operação normal,
mas também não deve destruir rascunho ou conteúdo local. A interface não deve
chamar qualquer desses estados de WebSocket por estética.

## 8. Semântica de status

Use as labels funcionais existentes e não crie sinônimos que confundam a equipe:

| Conceito | Representação visual mínima |
|---|---|
| conectado | dot success + label |
| reconectando | dot warning + label + feedback de atualização |
| desconectado | dot danger + label |
| não visualizada | dot/contador brand + nome forte |
| não respondida | indicador warning separado de não visualizada |
| capturada/atribuída | label de operador + ícone de pessoa/lock |
| resolvida | label neutral/success, sem apagar histórico |
| pendente | spinner/clock + label/tooltip |
| enviada | check simples + confirmação correspondente |
| entregue | check duplo `status.info`/texto |
| lida | check duplo `status.success`/texto |
| falha | danger + "Falha no envio" + retry se possível |
| nota interna | lock + "Nota interna" + "Visível somente para a equipe" |

Nunca derive uma semântica funcional somente da aparência. Se o backend não
confirmar um estado, exiba o estado de incerteza apropriado.

## 9. Responsive: composição própria para mobile

Mobile não é desktop espremido. A composição muda de navegação e de foco.

### Breakpoints de referência

| Faixa | Composição |
|---|---|
| `>= 1440px` | Sidebar (64px/228px) + Inbox (320px) + conversa flexível (mín. 480px) + contexto persistente (336px padrão; 320–360px) se disponível; ver seção do painel |
| `1024–1439px` | sidebar 64px + Inbox 300px + conversa; contexto abre Drawer sobreposto à conversa e não ocupa largura permanente |
| `900–1023px` | navegação compacta 64px + Inbox 288px + conversa flexível; contexto abre Drawer sobreposto e não ocupa coluna persistente |
| `768–899px` | uma área operacional principal por vez; inicia na Inbox e, ao abrir conversa, mostra a Conversa; navegação compacta permanece disponível; contexto abre Drawer sobreposto |
| `< 768px` | uma coluna por vez, sem sidebar desktop permanente; contexto ocupa painel/tela full-screen com voltar/fechar explícitos |
| `< 480px` | padding 12px, header simplificado, composer touch |

### Mobile

- área ativa começa com lista de conversas em tela inteira;
- abrir uma conversa troca para timeline em tela inteira;
- header da conversa tem botão Voltar de 44px;
- navegação principal fica em bottom navigation fixa de 56px, com quatro itens
  de ícone + label e foco acessível; nunca manter quatro colunas comprimidas;
- a lista não permanece visível atrás da timeline;
- painel de contexto do contato segue a composição full-screen com voltar/fechar
  explícitos definida nos breakpoints;
- composer ocupa a largura, respeita safe area e usa targets de 44px;
- menus com hover desaparecem; ações ficam no header ou em menu explícito;
- preview de mensagem ocupa no máximo 88% da largura;
- tags secundárias podem recolher atrás de "mais", sem sumir sem acesso.

Orientação landscape deve preservar a regra de uma coluna se a largura útil
for menor que 768px. O mock deve demonstrar ao menos desktop e mobile.

## 10. Acessibilidade e interação

- contraste mínimo alvo: 4.5:1 para texto normal e 3:1 para texto grande/
  componentes; valide tokens sobre cada superfície real;
- foco sempre visível com `focus.ring`, inclusive em sidebar recolhida;
- toda ação de ícone tem nome acessível e estado `aria-pressed`, `aria-expanded`
  ou `aria-selected` quando aplicável;
- ordem de tabulação segue leitura: navegação → filtros/lista → header →
  timeline → composer;
- `Escape` fecha menu, tooltip interativo, dialog, drawer ou viewer conforme a
  camada mais recente;
- dialogs têm `role="dialog"`, nome, foco inicial e retorno do foco;
- campos têm label associado, descrição e erro associado;
- listas usam semântica de lista quando apropriado; item selecionado expõe o
  estado para tecnologia assistiva;
- toasts e banners importantes usam live region sem interromper digitação;
- não comunicar estado apenas por cor, movimento ou posição;
- respeitar `prefers-reduced-motion: reduce`: remover deslocamentos, pulse e
  transições não essenciais;
- touch targets têm 44px; não colocar duas ações destrutivas adjacentes sem
  separação textual;
- não usar texto abaixo de 11px;
- idioma da interface e do mock: português do Brasil.

## 11. Motion

Motion é funcional e discreto:

- hover/focus: 120–160ms;
- abertura de menu/popover: 140ms, opacity + deslocamento máximo de 4px;
- drawer/dialog: 160–200ms;
- expansão de sidebar: 160ms;
- não usar bounce, spring exagerado, parallax, zoom de card ou brilho amarelo;
- não animar toda a lista ou toda a timeline ao receber uma mensagem;
- loading pode ter pulse de opacidade suave; reconnect pode ter rotação curta,
  mas sempre acompanhado de label;
- com reduced motion, usar mudança imediata de superfície/opacidade.

## 12. Do / Don't

### Do

- usar `#FFBC00` para uma ação ou sinal importante, em área pequena;
- separar `unread` de `needsResponse`;
- construir hierarquia com `surface.canvas` → `surface.1` → `surface.2` →
  `surface.3`;
- usar amarelo dessaturado apenas na bolha enviada;
- mostrar falha, pendência e reconexão com texto recuperável;
- manter labels, foco, teclado e touch previsíveis;
- tratar mobile como lista/timeline em navegação própria;
- usar dados fictícios e estados demonstráveis no teste de validação.

### Don't

- não pintar sidebar, header, fundo ou bolhas de amarelo institucional;
- não usar `#FFBC00` como fundo de mensagem enviada;
- não usar gradientes decorativos, glassmorphism, blur ornamental ou wallpaper;
- não tornar todo botão/card/tag uma pill;
- não usar sombras fortes ou glow como hierarquia principal;
- não copiar identidade visual de WhatsApp, Linear, Intercom, Superhuman ou
  Airtable;
- não mostrar check verde, toast de sucesso ou "conectado" sem estado confirmado;
- não diminuir fonte para compensar layout desktop em mobile;
- não adicionar componentes/estados funcionais que o produto não possui;
- não alterar contratos técnicos para satisfazer uma preferência visual.

## 13. Regras de implementação para agentes

1. Leia `AGENTS.md` e este `DESIGN.md` antes de implementar.
2. Para o `Design System Validation Gate`, receba somente esses dois arquivos e
   a instrução funcional neutra. Não receba screenshots, imagens conceituais,
   links de inspiração ou o CSS/frontend atual.
3. Comece listando os tokens semânticos usados e o mapa de regiões da tela.
4. Construa primitives isolados a partir deste contrato; não importe
   componentes, classes ou CSS existentes do Vitstock Hub durante o mock.
5. Use dados fictícios e determinísticos: contatos, mensagens, tags e produtos
   não podem ser reais nem chamar API.
6. Não adicione backend, SSE, polling, autenticação, banco ou rota para cumprir o
   teste visual. O sandbox pode declarar somente as dependências mínimas para
   executar e construir o mock em seu próprio `package.json`.
7. Não invente um token cromático novo para resolver desconforto local. Primeiro
   use o token semântico mais próximo; se ele não servir, registre a lacuna e
   revise este documento antes de continuar.
8. Se uma regra funcional já existir no código real, preserve-a quando o design
   for migrado. Este documento não substitui tipos, testes ou contratos.
9. Toda exceção visual deve ter motivo operacional verificável e ser adicionada
   a uma revisão futura do documento, não escondida em CSS local.
10. Antes de considerar a interface coerente, teste pelo menos: padrão, hover,
    selecionado, não lido, foco, loading, empty, erro, reconectando, nota
    interna, falha de envio e mobile.

## 14. Design System Validation Gate

Antes de qualquer migração do frontend real, um novo agente deverá executar o
Run 2 como teste independente, começando do zero. Ele receberá somente:

- `AGENTS.md`;
- `DESIGN.md` V1.2.

Instrução neutra ao agente: "Crie uma tela mock isolada de atendimento para um
CRM baseado em WhatsApp. Siga `AGENTS.md` e `DESIGN.md`, use somente dados
fictícios e não conecte integrações."

Esse agente deverá construir uma tela mock isolada de atendimento, com dados
fictícios, sem API, banco, SSE, polling, Evolution, autenticação ou lógica real.

O agente do Run 2 **MUST NOT** receber arquivos ou código do mock do Run 1,
screenshots do Run 1, descrição estética do resultado, nem correções manuais
aplicadas àquele mock. O Run 1 é preservado somente como evidência histórica e
não pode servir de base de implementação. A instrução funcional permanece a
mesma instrução neutra acima.

Regras do blind test:

- não reutilizar componentes, classes, tokens CSS ou arquivos visuais existentes
  do Vitstock Hub;
- não receber screenshots, imagens conceituais, links de referência visual ou
  a imagem que motivou a direção inicial;
- implementar sidebar recolhida (64px) e expandida (228px), incluindo controle
  visível de expandir/recolher, labels no estado expandido, iconografia coerente
  e estado `aria-expanded`. O mecanismo pode ser demonstrado de modo interativo
  ou por dois estados claramente verificáveis. A composição também
  demonstra lista de conversas, conversa ativa, header, mensagens
  recebidas/enviadas, composer, painel de contexto conforme desktop/mobile,
  filtros/estados, estados de conexão e pelo menos um overlay;
- demonstrar estados selecionado, hover, foco, não lido, precisa de resposta,
  nota interna, pending/failed, empty ou error e mobile;
- demonstrar também um product card, uma resposta citada, uma mensagem longa,
  ação de emoji, preview de reply ou anexo no composer e uma nota fictícia no
  painel de contexto;
- validar as duas composições de tablet: 900–1023px com Inbox e conversa lado a
  lado; 768–899px com Inbox ou Conversa como área principal, nunca ambas
  comprimidas lado a lado;
- não corrigir visualmente o mock por instrução baseada na imagem original.

O sandbox do mock **MUST** ser reproduzível de forma independente: entregar seu
próprio `package.json` e arquivo de lock (por exemplo, `package-lock.json` para
npm), scripts mínimos `dev` e `build`, dependências explicitamente declaradas e
nenhuma dependência do frontend real ou do `node_modules` do checkout anfitrião.
Deve ser possível executar, a partir de uma cópia limpa do sandbox, `npm install`,
`npm run dev` e `npm run build` sem importar ou compilar arquivos da aplicação
real.

O resultado será avaliado por pessoas. Se o agente precisar perguntar o que
uma regra significa, ou se a interface ficar incoerente sem referência visual,
a primeira ação será revisar este `DESIGN.md`. Não se deve ensinar o mock por
edição manual antes de corrigir o contrato. Somente depois de uma versão do
documento produzir uma interface coerente o frontend real poderá ser migrado,
em tarefa separada e autorizada.

## 15. Critérios de aceitação da V1.2

`DESIGN.md` V1.2 é candidato congelado para o Run 2 quando:
- a composição confirma o painel persistente >=1440px, os limites de largura
  descritos e o fallback sobreposto/full-screen sem comprimir a conversa;
- timeline, contraste de `text.subtle`, cores exatas da mensagem enviada e nota
  interna centralizada obedecem aos tokens e limites definidos neste documento;
- todos os wrappers de mensagem, incluindo mídia, replies e product cards,
  respeitam os limites desktop/mobile sem exceções implícitas;
- a anatomia da resposta citada e do painel de contexto segue este contrato,
  incluindo a distinção entre Notas do contato e Nota interna da timeline;
- as composições de tablet 900–1023px e 768–899px não são ambíguas nem
  contraditórias;
- um agente independente consegue identificar a filosofia dark-first,
  densidade, prioridades e limites funcionais;
- todos os tokens principais têm nomes semânticos e valores concretos;
- superfície, texto, borda, radius, elevação, spacing e typography não exigem
  escolha arbitrária para a tela de atendimento;
- sidebar, navegação, lista, seleção, unread, hover, foco, header, mensagens,
  composer, buttons, inputs, tags, avatars, cards e overlays têm anatomia e
  estados definidos;
- mensagens enviadas são explicitamente confortáveis e não usam `#FFBC00`;
- loading, empty, error, reconnecting e status de envio não são ambíguos;
- mobile possui composição própria e targets touch definidos;
- acessibilidade, teclado, reduced motion e estados semânticos estão cobertos;
- a regra de não alteração de backend/contratos está explícita;
- o Run 2 exige apenas `AGENTS.md` + `DESIGN.md` V1.2, não recebe materiais do
  Run 1 e exige sandbox isolado com execução reproduzível;
- uma revisão crítica não encontra uma lacuna capaz de alterar a identidade,
  hierarquia ou leitura da tela.

## 16. Ambiguidades controladas da V1.2

Estas são as únicas escolhas deixadas abertas porque não mudam a identidade ou
a hierarquia do sistema:

1. **Fonte disponível:** Inter é a preferência; o fallback de sistema é
   permitido quando Inter não estiver instalada. O tamanho, peso e line-height
   continuam obrigatórios.
2. **Biblioteca de ícones:** a implementação pode usar Lucide ou outra biblioteca
   outline equivalente. A semântica, espessura, tamanho e label acessível são
   obrigatórios; o desenho exato de cada glifo não é identidade do produto.
3. **Conteúdo fictício do mock:** nomes, textos, horários, tags e produtos podem
   variar, desde que demonstrem a densidade e todos os estados exigidos. Não
   usar dados reais.
4. **Persistência do estado expandido:** expandir/recolher é obrigatório; a
   persistência entre sessões é decisão funcional fora deste documento.
5. **Atalhos e envio:** este documento especifica aparência e estados do
   composer, não redefine a tecla que envia, o formato de draft ou o retry.
6. **Navegação do mock:** nomes e ordem dos módulos não são arquitetura de
   informação canônica do produto. No Validation Gate, o mock **MAY** usar labels
   fictícias/determinísticas para demonstrar item ativo, inativo, badge e sidebar
   recolhida/expandida. A escolha não representa a navegação definitiva, e sua
   ausência não deve bloquear o agente.
7. **Filtro e ordenação da Inbox do mock:** este documento não redefine filtro
   inicial, ordenação funcional ou fonte de dados da Inbox. O blind mock usa um
   conjunto fictício determinístico e uma ordem estável somente para demonstrar
   visualmente os estados exigidos. Isso não é contrato funcional; não criar
   lógica real nem bloquear por não conhecer a ordenação da aplicação.

Nenhuma dessas ambiguidades autoriza novos tokens, novo comportamento funcional
ou reutilização do frontend real no blind test.

