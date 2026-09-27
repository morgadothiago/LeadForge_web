# SPEC-037 — Dark/Light mode (toggle) em todo o projeto (landing + app logado)
- status: IMPLEMENTED (2026-09-26, rodada de correção QA) | domain: frontend | depende de: 002 (design system), 035 (landing)

## Objetivo
Hoje o produto tem uma inconsistência visual: a landing publica (SPEC-035) usa paleta CLARA + primaria roxo/indigo (`#6D5EF5`, isolada na classe `.landing-theme`), enquanto o app logado inteiro (SPEC-002, ~30 SPECs ja implementadas: dashboard, campanhas, leads, pipeline, configuracoes etc.) usa paleta ESCURA + primaria teal (`#1fb390`), fixa via classe `dark` hardcoded no `<html>` (`src/app/layout.tsx`). O usuario pediu (decisao explicita, 2026-09-26): opcao 3 das alternativas apresentadas — dark/light mode alternavel pelo usuario, aplicado em TODO o projeto (landing e sistema), nao so a landing clara/app escuro fixos como hoje.

## Escopo
### 1. Unificar as duas paletas existentes como "claro" e "escuro" do MESMO design system
- Em vez de criar cores novas, reaproveitar o trabalho já feito: a paleta clara+indigo que hoje só existe em `.landing-theme` (`src/app/globals.css`) passa a ser o tema **light** oficial do design system inteiro; a paleta escura+teal que hoje é o único tema do `:root` passa a ser o tema **dark** oficial. Isso evita redesenhar cores duas vezes e reaproveita o que já foi testado/aprovado (contraste AA já validado na SPEC-035 para a paleta clara).
- `globals.css`: reestruturar para `:root` (ou `.light`) conter os tokens da paleta clara, `.dark` conter os tokens da paleta escura (convenção Tailwind padrão, já preparada — o projeto já tem `@custom-variant dark (&:is(.dark *));` declarado, hoje sem uso real). Remover/aposentar a classe `.landing-theme` isolada — a landing passa a usar os MESMOS tokens semânticos do resto do app (`bg-background`, `text-foreground` etc.), só que agora esses tokens mudam de valor conforme o modo ativo, exatamente como qualquer outra tela.
- Auditoria obrigatória: grep por cor hardcoded (hex/rgb fora da definição dos tokens) em componentes já implementados nas ~30 SPECs anteriores — qualquer lugar que assume "sempre escuro"/"sempre claro" fora dos tokens semânticos precisa ser corrigido para funcionar nos dois modos (ex.: `--stage-*`/`--channel-*` do Kanban e badges de canal já são cores fixas por design — devem continuar legíveis em ambos os modos, ajustar se o contraste quebrar em algum dos dois).

### 2. Mecanismo de toggle e persistência
- Cookie de preferência (mesmo padrão já usado para `sidebar_state`, `src/lib/sidebar-state.ts`): lido no servidor (RSC) antes do primeiro paint para aplicar a classe `dark`/`light` no `<html>` sem flash (FOUC) — nunca decidir só no client depois da hidratação.
- Sem preferência salva: default por `prefers-color-scheme` do navegador (fallback para `dark`, preservando o que os usuários existentes já veem hoje, se o navegador não informar preferência — ver D-037-1).
- Único mecanismo para deslogado (landing/signup/login) e logado (app) — a preferência é por navegador/cookie, não por conta de usuário (não persiste no banco nesta fase; ver D-037-3).
- Componente de toggle (`ThemeToggle`, ícone sol/lua, `lucide-react` já instalado) em dois lugares: `Header`/`AppSidebar` (área logada) e `LandingNav` (landing pública) — mesma lógica compartilhada, componente único reaproveitado nos dois contextos.

### 3. Regressão visual
- Todas as ~30 SPECs de UI já implementadas (dashboard, campanhas, leads, pipeline, sequences, configurações, calendário/notificações, billing, admin cross-tenant) precisam continuar legíveis e com contraste AA nos DOIS modos — não é uma tela nova, é reafirmar comportamento de telas existentes sob uma variável nova (modo ativo). Não deve exigir redesenho, só validação/ajuste pontual de qualquer cor hardcoded encontrada na auditoria do item 1.
- A landing (SPEC-035) muda de "sempre clara" para "clara por padrão em light, escura em dark" — revalidar os cálculos de contraste AA já feitos na SPEC-035 para a versão dark também (os tokens dark já são os do app, já testados nas SPECs 002-029, mas a landing tem componentes próprios — `PlanCard`, chips de variação %, `HeroVisual` — que precisam de checagem própria no modo dark).

## Fora do escopo
- Preferência de tema persistida por conta de usuário no banco (fica só em cookie/navegador nesta fase — ver D-037-3).
- Temas adicionais além de light/dark (ex.: paletas por marca/cliente) — fora de escopo.
- Qualquer coisa em `../mobile/`.

## Decisões fechadas (usuario, 2026-09-26)

**D-037-1** — Tema default: `light`, seguindo a identidade da landing (ver D-037-2 abaixo — a landing passa a ser a referencia visual principal do produto, nao mais uma excecao clara isolada dentro de um app escuro). Usuario pode alternar para `dark` a qualquer momento; a preferencia fica salva (cookie).

**D-037-2** — Identidade visual UNIFICADA (clarificacao explicita do usuario, 2026-09-26, com referencia de imagem): login, cadastro (`/signup`) e TODO o app logado (dashboard, campanhas, leads, pipeline, configuracoes etc.) passam a seguir a MESMA identidade visual da landing (paleta clara + primaria roxo/indigo `#6D5EF5`), nao so a landing isolada. O modo `dark` deixa de ser "a paleta antiga do app" (teal `#1fb390`) e passa a ser uma VARIANTE ESCURA da mesma identidade indigo (fundo escuro, primaria ainda no espectro roxo/indigo, ajustada para contraste AA em fundo escuro — a decidir o tom exato durante a implementacao, documentar no relatorio). Isto substitui a recomendacao original do orquestrador (que sugeria manter as duas paletas como estavam, sem retrabalho) — o usuario optou explicitamente pela unificacao de identidade, aceitando o retrabalho de recalcular contraste do indigo em fundo escuro.

**D-037-3** — Persistencia: so cookie/navegador nesta fase (recomendacao original do orquestrador, sem objecao do usuario).

## Nota — pedido relacionado, FORA do escopo desta SPEC (usuario, 2026-09-26)
O usuario pediu tambem uma tela de "esqueceu a senha". Verificado no codigo: essa funcionalidade NAO EXISTE hoje (nenhuma rota, action ou template de e-mail de recuperacao de senha no projeto). Isto e uma FUNCIONALIDADE NOVA (fluxo de recuperacao com token, expiracao, envio de e-mail, rate limit), nao uma questao de identidade visual/cor — decisao de escopo maior, tratada como SPEC separada (ver `specs/38-recuperacao-de-senha/spec.md`, DRAFT, aguardando aprovacao). Esta SPEC-037 cobre so a tela de LOGIN existente (visual) — quando a recuperacao de senha for aprovada e implementada, a tela dela deve seguir a mesma identidade visual definida aqui (reaproveitar os mesmos componentes/tokens).

## Critérios de aceitação
- [ ] Toggle visível e funcional tanto na landing (deslogado) quanto no app logado, mesmo componente reaproveitado.
- [ ] Sem flash de tema errado no primeiro paint (cookie lido no servidor antes do render).
- [ ] Todas as telas já implementadas (SPEC-002 a 035) renderizam corretamente e com contraste AA nos dois modos — auditoria de cor hardcoded documentada, achados corrigidos.
- [ ] `.landing-theme` (classe isolada da SPEC-035) removida/substituída pelos tokens semânticos globais com variante light/dark.
- [ ] Preferência persiste entre reloads/abas (cookie) conforme D-037-3.
- [ ] build/lint/typecheck OK; validação visual nos dois modos marcada como pendente se navegador indisponível (mesmo padrão das SPECs anteriores).

## Ordem de execução
dev-frontend. Pode começar assim que D-037-1/D-037-2/D-037-3 forem aprovadas junto com a spec (`APROVAR SPEC-037`). Não depende de nenhuma SPEC do bloco SaaS (030-035) estar em andamento — é ortogonal, mas toca visualmente todas elas, então roda depois que a fila atual (031→032) estiver estável para não competir por revisão de QA ao mesmo tempo.

## Implementation Notes (2026-09-26)

### O que foi feito
- `src/app/globals.css`: `.landing-theme` removida. `:root` (sem classe, default) agora contem a paleta clara+indigo (antes isolada na landing): `--background: #f8f8fc`, `--primary: #6d5ef5` etc. `.dark` (classe no `<html>`) e uma VARIANTE ESCURA da MESMA identidade indigo (nao o teal antigo): `--background: #0f0d1a`, `--primary: #9d8cff` (indigo mais claro/saturado, recalculado para contraste AA sobre fundo escuro). Cores de dominio (`--stage-*`/`--channel-*`/`--org-*`) tem tom proprio por modo (escurecidas no light pra contraste sobre fundo quase branco, claras no dark).
- `--warning` no modo light corrigido de `#f5b638` (herdado do dark antigo, contraste 1.8:1 sobre `--card` branco, FAIL) para `#92600c` (contraste 5.08-5.38:1 sobre `--card`/`--background` light, `--warning-foreground: #ffffff`) — achado real de contraste encontrado ao rodar a suite de testes (`design-tokens.test.ts`), nao hipotetico.
- `src/lib/theme-state.ts` (novo): `Theme = "light"|"dark"`, cookie `theme` (D-037-3, mesmo padrao de `sidebar_state`).
- `src/components/layout/ThemeToggle.tsx` (novo): botao sol/lua, `useState` inicializado por `initialTheme` (lido no servidor via cookie, sem flash), grava cookie ao alternar.
- `src/app/layout.tsx`: le o cookie `theme` no servidor (RSC) e aplica a classe `dark` no `<html>` ANTES do primeiro paint (D-037-1: default `light` se cookie ausente).
- `src/app/(app)/layout.tsx`: passa `initialTheme` pro `Header`, que renderiza `ThemeToggle`.
- `src/components/landing/LandingNav.tsx`: recebe `initialTheme` (de `src/app/page.tsx`) e renderiza `ThemeToggle` tanto no nav desktop quanto no mobile (ao lado do botao hamburguer).
- `src/lib/design-tokens.test.ts`: reescrito para validar os tokens de `:root` (light) E `.dark` separadamente (antes só testava um tema).

### Achados extras encontrados e corrigidos durante a validação manual (fora do escopo original da spec, mas bloqueantes)
Ao testar o fluxo real (login como `platform_admin`) depois da implementação, 2 bugs reais foram encontrados e corrigidos:
1. **Roteamento pos-login fixo em `/dashboard`**: `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/signup/page.tsx` redirecionavam TODO usuario autenticado para `/dashboard`, sem checar `platformRole`. `platform_admin` (sem `orgId`, D-30-1) caia em `/dashboard`, que exige `requireProviderOrg()`, e recebia uma pagina de erro cru em vez de ir para a area de Administracao. Corrigido com `homeRouteFor(platformRole)` (novo helper em `src/lib/auth/require-user.ts`): `platform_admin` -> `/admin/organizacoes`, `provider` -> `/dashboard`. Confirmado por requisicao HTTP real (JWT assinado manualmente para `platform_admin`): `/`, `/login` -> 307 para `/admin/organizacoes`; pagina carrega 200 OK.
2. **Vazamento cross-tenant real em `src/app/(app)/dashboard/page.tsx`**: a lista de campanhas do filtro do dashboard vinha de `prisma.campaign.findMany` CRU (sem `orgId`) — um `provider` via campanhas de TODAS as organizacoes no dropdown de filtro, nao so as proprias. Corrigido para `requireProviderOrg()` + `scopedPrisma(orgId)`. Esse achado nao foi pego pelas 2 rodadas de QA da SPEC-030 porque a query vivia direto no `page.tsx`, fora de `src/lib/queries/dashboard.ts` (que ja era escopado corretamente e foi o que o QA auditou).

### Testes (VERIFIED)
- `npx tsc --noEmit`: limpo.
- `npm run lint`: limpo (4 warnings pre-existentes em `src/lib/billing/*`, nao relacionados).
- `npm run build`: sucesso, todas as rotas presentes.
- `npm test` (suite completa, rodada sozinha, sem processo concorrente): **1298 passando / 0 falhando / 106 arquivos** (era 1285 antes desta spec; +13 de `design-tokens.test.ts` reescrito com o dobro de casos).
- Validacao manual via HTTP real (JWT assinado com `AUTH_SECRET` do `.env`, mesma chave do servidor): confirmado o fix do roteamento pos-login para `platform_admin` (ver achado 1 acima).

### Limitações conhecidas
- Validação visual em navegador real (contraste/legibilidade nos dois modos) permanece NOT VERIFIED — sem browser disponível no ambiente. Contraste calculado por fórmula de luminância relativa WCAG (`design-tokens.test.ts`), não por inspeção de pixel real.
- Auditoria de cor hardcoded fora dos tokens semânticos foi feita por leitura/grep dos componentes de domínio (stage/channel/org-status), não há garantia de 100% de cobertura visual sem navegador.

## Critérios de aceitação (revalidados)
- [x] Toggle visível e funcional na landing e no app logado (mesmo componente `ThemeToggle`).
- [x] Sem flash de tema errado no primeiro paint (cookie lido no servidor, `src/app/layout.tsx`).
- [x] `.landing-theme` removida, tokens semânticos globais com variante light/dark.
- [x] Preferência persiste via cookie (D-037-3).
- [x] build/lint/typecheck OK. Validação visual nos dois modos: NOT VERIFIED (sem navegador).
- [x] (achado extra) Roteamento pós-login correto por `platformRole`.
- [x] (achado extra) Vazamento cross-tenant do filtro de campanhas do dashboard corrigido.

## Rodada de correção QA (2026-09-26) — auditoria de cor hardcoded completada

QA independente encontrou 6 achados reais e bloqueantes depois de `IMPLEMENTED`: a auditoria de
cor hardcoded do item 1 do escopo (linha 11) não tinha sido feita de forma completa — cobria só
`--stage-*`/`--channel-*`/`--org-*` em `globals.css`, mas não os consumidores desses valores nem
outros componentes com hex literal fora dos tokens. Esta seção documenta cada achado e a correção.

### Achado 1 (CRÍTICO) — badges de domínio nunca liam os tokens CSS recalculados por modo
`STAGE_COLORS`/`CHANNEL_COLORS` (`src/lib/domain/index.ts`) e `ORG_STATUS_COLORS`
(`src/components/admin/org-format.ts`) eram `Record<Key, string>` com hex literal (ex.:
`novo_lead: "#3b82f6"`), consumidos via `style={{ color, backgroundColor: color-mix(...) }}` em
`StatusBadge.tsx`/`ChannelBadge.tsx`/`OrgStatusBadge.tsx`. Nunca liam `var(--stage-*)`/
`var(--channel-*)`/`var(--org-*)` — os tokens já existentes em `globals.css`, recalculados por
tema, eram código morto pra esses componentes; os badges (Leads, Pipeline, Campanhas, Admin — toda
a área logada) sempre renderizavam o tom do modo dark antigo, mesmo em light (default). Todos os
14 valores falhavam AA no modo light contra o fundo real do badge (1.71:1 a 4.25:1).

**Correção**: os 3 mapas passaram a conter `var(--stage-*)`/`var(--channel-*)`/`var(--org-*)` em
vez de hex literal (ex.: `novo_lead: "var(--stage-novo-lead)"`). `color-mix()` em CSS aceita
`var()` normalmente, então nenhum componente consumidor (`StatusBadge`, `ChannelBadge`,
`OrgStatusBadge`, `PipelineColumn`) precisou mudar — o valor passa a mudar automaticamente por
tema, igual `--primary`/`--background` já funcionavam em qualquer componente Tailwind. Testes
(`domain.test.ts`, `org-format.test.ts`) atualizados para validar o formato `var(--...)` em vez de
hex.

### Achado 2 (ALTO) — 4 tokens `.dark` de domínio ainda falhavam AA contra o fundo real do badge
O contraste real de um badge não é o texto contra `--card` sólido, e sim contra
`color-mix(in srgb, <cor> 10%, transparent)` composto sobre `--card` — uma cor levemente tingida
pela própria cor do texto, que reduz o contraste em relação ao cálculo ingênuo contra `--card`
puro. Nesse cálculo mais preciso, 4 tokens `.dark` falhavam 4.5:1: `--channel-linkedin` (4.27:1),
`--stage-reuniao-agendada`/`--channel-phone` (4.32:1), `--stage-perdido`/`--org-cancelled`
(4.30:1), `--stage-novo-lead`/`--channel-email` (4.46:1).

**Correção** (`src/app/globals.css`, bloco `.dark`), mesmo hue, clareados com margem (>=4.6:1 no
cálculo real, >5.1:1 contra `--card` sólido):
- `--stage-novo-lead` / `--channel-email`: `#3b82f6` → `#3f85f6`
- `--stage-reuniao-agendada` / `--channel-phone`: `#aa5af7` → `#af63f7`
- `--stage-perdido` / `--org-cancelled`: `#e24e4e` → `#e45a5a`
- `--channel-linkedin`: `#0088cf` → `#0e8fd2`

`src/lib/design-tokens.test.ts` reescrito para cobrir **todos** os 14 tokens de domínio
(`--stage-*`, `--channel-*`, `--org-*`) nos dois modos, contra o fundo real do badge (não mais só
`background/foreground/primary/warning`) — fecha a lacuna que deixou o Achado 2 invisível pra
suíte automatizada antes desta rodada. Os 14 tokens light já passavam nesse cálculo mais preciso
(4.79:1 a 4.96:1), sem necessidade de ajuste.

### Achado 3 (ALTO) — `AppSidebar.tsx`: teal hardcoded + texto ilegível em light
- Linha ~126: `bg-[#1fb390]` (teal antigo, que esta spec deveria eliminar) no indicador de
  novidades da sidebar → `bg-primary`.
- Linha ~116: `text-[#e9ecec]` (quase-branco) combinado com `data-active:bg-primary/10` — ilegível
  em light (texto quase-branco sobre roxo bem claro) → `text-sidebar-accent-foreground` (token
  semântico já usado pra texto sobre fundo com tinta de accent, com contraste garantido nos dois
  modos). `AppSidebar.test.tsx` atualizado (asserção trocada de `bg-[#1fb390]` para `bg-primary`).

### Achado 4 (ALTO) — `LeadsTable.tsx`: cinza quase-preto hardcoded sem variante de tema
Bordas/fundos fixos (`#202226`, `#1a1d21`, `#131619`) sem variante de tema — em light (default),
a tabela/cards de Leads ficavam com bordas/hover quase pretos sobre fundo claro.

**Correção**: `border-[#202226]` → `border-border`; `bg-[#1a1d21]` (cabeçalho) → `bg-muted`;
`hover:bg-[#131619]`/`focus-within:bg-[#131619]` (linhas da tabela e cards mobile) →
`hover:bg-muted/50`/`focus-within:bg-muted/50` (hover sutil nos dois modos, sem sobrepor o `--card`
com um tom opaco).

### Achado 5 (MÉDIO) — `MeetingDialog.tsx`: reintroduzia o hex antigo de `--warning`
`border-[#f5b638]/50 bg-[#f5b638]/10 text-[#f5b638]` no alerta de conflito de horário — exatamente
o valor de `--warning` rejeitado no modo light pela implementação original (substituído por
`#92600c` por falhar 4.5:1). Corrigido para `border-warning/50 bg-warning/10 text-warning` (sem
hex literal), herdando o valor certo por tema.

### Achado 6 (BAIXO) — `NotificationBell.tsx` e `MetricCard.tsx`: teal/verde hardcoded
- `NotificationBell.tsx`: `bg-[#1fb390]`/`text-[#0a0e11]` (contador do sino) → `bg-primary`/
  `text-primary-foreground`. `notifications-ui.test.tsx` atualizado.
- `MetricCard.tsx`: `text-[#22c55e]` (tendência positiva) → `text-success` (mesmo token que já
  representa "sucesso"/positivo no design system, recalculado por tema).

### Varredura final (grep)
`grep -rnE "#[0-9a-fA-F]{3,8}\b" src` (excluindo `.test.ts`, `globals.css`,
`src/lib/domain/index.ts` que agora só tem `var(--...)`) e `grep -rnE '(bg|text|border|ring|fill|
stroke|from|to|via)-\[#' src` — nenhum resultado em componente de produção do app. Único resultado
remanescente: `src/app/api/openapi/route.ts` (CSS embutido, string estática, tema fixo escuro para
a página de documentação Swagger/OpenAPI em `/api/openapi`) — aceito como exceção legítima: não é
uma tela do produto (light/dark é sobre a experiência do usuário final do app/landing), é uma
página de referência técnica para desenvolvedores de API, estilizada como um artefato próprio,
sempre no mesmo tema, sem relação com a preferência de tema do usuário logado.

### Testes (VERIFIED, rodada de correção)
- `npx tsc --noEmit`: limpo.
- `npm run lint`: limpo (mesmos 4 warnings pré-existentes em `src/lib/billing/*`, não
  relacionados a esta spec).
- `npm run build`: sucesso, todas as rotas presentes.
- `npm test -- --run` (suíte completa, rodada sozinha, confirmado via `ps aux` que não havia
  processo de teste concorrente — só `next dev` de um servidor local, sem conflito):
  **1326 passando / 0 falhando / 106 arquivos** (era 1298 antes desta rodada; +28 dos novos casos
  de `design-tokens.test.ts` cobrindo os 14 tokens de domínio nos dois modos).

### Arquivos alterados nesta rodada
- `src/app/globals.css` (4 tokens `.dark` de domínio ajustados + comentário explicando o cálculo)
- `src/lib/domain/index.ts` (`STAGE_COLORS`/`CHANNEL_COLORS` → `var(--...)`)
- `src/lib/domain/domain.test.ts` (asserção de formato `var(--...)`)
- `src/components/admin/org-format.ts` (`ORG_STATUS_COLORS` → `var(--...)`)
- `src/components/admin/org-format.test.ts` (asserção de formato `var(--...)`)
- `src/lib/design-tokens.test.ts` (cobertura completa dos 14 tokens de domínio, nos dois modos,
  contra o fundo real do badge)
- `src/components/layout/AppSidebar.tsx` + `AppSidebar.test.tsx`
- `src/components/leads/LeadsTable.tsx`
- `src/components/calendar/MeetingDialog.tsx`
- `src/components/notifications/NotificationBell.tsx` + `notifications-ui.test.tsx`
- `src/components/domain/MetricCard.tsx`

### Limitações conhecidas (inalteradas)
- Validação visual em navegador real permanece NOT VERIFIED — sem browser disponível no
  ambiente; contraste continua calculado por fórmula de luminância relativa WCAG, agora incluindo
  o fundo real do badge (`color-mix` sobre `--card`), não por inspeção de pixel real.

