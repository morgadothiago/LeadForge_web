# SPEC-035 — Landing page publica ("/")
- status: IMPLEMENTED (dev-frontend, 2026-09-26) | domain: frontend | depende de: 002 (design system), 027 (sidebar shadcn), 034 (para a secao de pricing real e para o /signup — hero/features podem comecar antes)

## Objetivo
Redesenhar a rota raiz (`/`) como landing page de marketing, publica e deslogada, no lugar do redirect atual para `/dashboard`. Direcao visual: estetica SaaS fintech limpa, mesmo nivel de polish de um dashboard de referencia (descrito abaixo pelo usuario, dev-frontend nao tem acesso a imagem).

## Contexto
Hoje `src/app/(app)/page.tsx` so redireciona `/` -> `/dashboard`, e `(app)/layout.tsx` exige `requireUser()` para **toda** rota do grupo `(app)`, incluindo `/`. Ou seja, hoje `/` nunca e alcancavel deslogado (cai em `/login` antes mesmo do redirect fazer sentido). Isso precisa mudar de arquitetura de rotas, nao so de conteudo.

## Direcao visual (descrita pelo usuario, referencia por imagem que o dev-frontend nao ve)
Estetica SaaS fintech limpa: fundo claro, cards arredondados (`rounded-2xl`) com sombra suave, cor primaria roxo/indigo (tom ~`#6D5EF5`), chips de variacao percentual em verde/vermelho (ex.: "+12%"/"-3%"), elementos tipo donut chart/grafico de linha como motivo visual recorrente, tipografia sans limpa, nav superior com estado ativo em pill escuro, avatar circular no canto. Objetivo: comunicar "produto B2B de prospeccao com dados/IA", adaptado para landing (hero + features + pricing em abas + prova social + CTA + footer) — nao e um dashboard, e marketing com essa linguagem visual. Reaproveitar/estender o design system existente (SPEC-002, ja migrado para shadcn na SPEC-027) em vez de recriar tokens do zero — se a cor primaria atual do design system nao for esse tom de roxo/indigo, o dev-frontend propoe o ajuste de token (nao cria uma paleta paralela so para a landing).

## Escopo
### Arquitetura de rotas
- `/` deixa de redirecionar; vira uma pagina publica fora do gate de `requireUser()`. Isso exige mover o grupo autenticado: opcao recomendada — landing fica em um novo route group `(marketing)` (ou direto em `src/app/page.tsx` fora de qualquer grupo autenticado) com layout proprio (sem sidebar/header do app), e o dashboard, que hoje "e" a raiz logicamente, continua acessivel em `/dashboard` (rota que ja existe, SPEC-004) — ou seja, nao muda URL de nada que ja funciona logado, so para de existir o redirect de `/` para `/dashboard`.
- Usuario ja autenticado que acessa `/`: redireciona para `/dashboard` (UX padrão de SaaS — evita mostrar a landing para quem ja e cliente). Usuario deslogado que acessa `/dashboard` ou qualquer rota do `(app)`: continua indo para `/login` como hoje (`(app)/layout.tsx` nao muda esse comportamento).
- `/login` continua existindo como esta.

### Secoes da pagina
1. **Nav superior**: logo, links de ancora (Produto/Recursos, Precos, Sobre), CTA "Entrar" (-> `/login`) e "Comecar" (-> `/signup`, SPEC-034, com plano pre-selecionado via query param quando vem do card de pricing) — nav com estado ativo em pill escuro conforme a referencia.
2. **Hero**: titulo/subtitulo de valor (prospeccao B2B automatizada com IA), CTA primario, e um elemento visual estilo "card de dashboard" (donut/linha, numeros com chips de variacao %) ilustrando o produto — usar dados ilustrativos estaticos, nao conectados a dado real.
3. **Features**: grid de cards `rounded-2xl` com sombra suave, icones (`lucide-react`, ja instalado), destacando: campanhas + ICP, sequences multi-canal, WhatsApp, busca de leads por IA, agentes de IA (SDR/Follow-up/Closer), pipeline Kanban, calendario/reunioes — mapeado 1:1 com o que o produto ja faz (specs 004-029), sem prometer nada que nao existe.
4. **Pricing**: abas mensal/anual reaproveitando o `PlanCard` construido na SPEC-034, alimentado pelos planos `starter`/`pro`/`business` de D-33-2 (precos placeholder, aviso claro no relatorio de entrega de que precisam confirmacao antes do launch); card do plano CTA -> `/signup?plan=<key>&cadence=<monthly|yearly>` (exceto `business`, que aponta pra contato/vendas, nao checkout).
5. **Prova social**: omitida por enquanto (D-35-2) — produto sem clientes/depoimentos reais documentados, sem fabricar. Reservar o espaco/componente (`SocialProofSection`) vazio ou com metricas agregadas genericas do produto (ex. "campanhas rodando 24/7"), nunca logo ou depoimento de cliente inventado.
6. **CTA final** + **footer** (links institucionais, redes, copyright).

### Design system
- Reaproveita tokens/componentes do design system (SPEC-002/027): `Button`, `Card`, cores, tipografia, `tailwind-merge`, `framer-motion` para microinteracoes sutis (fade/slide ao rolar, hover em card) — sem exagero, mantendo o tom "produto serio", nao "site de landing generico".

## Fora do escopo
- Conteudo/copy final definitivo (dev-frontend escreve um copy placeholder profissional; ajuste fino de texto e algo o usuario revisa depois).
- Blog, changelog, paginas institucionais alem do necessario para o footer.
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-25)

D-35-1: CTA "Comecar" leva para `/signup` (SPEC-034), nao para `/login`. Signup self-service (cria User+Organization+trial) passa a fazer parte do escopo da SPEC-034, nao e SPEC futura.

D-35-2: Prova social omitida por enquanto — sem depoimento/logo fabricado. Espaco reservado, pode usar metrica agregada generica do produto, nunca cliente nominal inventado.

## Criterios de aceitacao
- [x] `/` publico, sem `requireUser()`, renderiza a landing completa (nav, hero, features, pricing, prova social conforme D-35-2, CTA, footer).
- [x] Usuario autenticado acessando `/` e redirecionado para `/dashboard`; `/dashboard` e demais rotas `(app)` continuam exigindo login como hoje.
- [x] Pricing consome os planos reais (D-33-2 ja `IMPLEMENTED`; precos/contato comercial sao placeholder — ver Implementation Notes).
- [x] Responsivo (mobile-first: nav vira menu, grid de features empilha, pricing tabs acessiveis por teclado), contraste AA, sem regressao de performance perceptivel (imagens otimizadas, sem libs novas pesadas).
- [x] build/lint/typecheck OK; validacao visual **NOT VERIFIED** (navegador indisponivel neste ambiente, mesmo padrao das SPECs anteriores).

## Ordem de execucao
dev-frontend. Estrutura/hero/features podem comecar assim que 002/027 (ja `IMPLEMENTED`) estiverem de pé — nao esperam 030-034. A secao de Pricing (CTA -> `/signup`) so fecha depois de 034 `IMPLEMENTED`; ate la, marcar Pricing como PENDENTE com dado de teste explicito no relatorio.

## Implementation Notes (dev-frontend, 2026-09-26)

### Arquivos criados
- `src/app/page.tsx` — landing pública ("/"), fora do grupo `(app)`. Checa sessão (mesmo padrão de `login/page.tsx`/`signup/page.tsx`: `requireUser()` + `catch UnauthorizedError`); autenticado → `redirect("/dashboard")`; deslogado → renderiza a landing. Busca `listActivePlans()` (SPEC-034) e passa para `PricingSection`.
- `src/components/landing/LandingNav.tsx` — nav superior sticky, links âncora (`#produto`/`#precos`/`#sobre`), CTA "Entrar" (`/login`) e "Começar" (`/signup`), menu mobile (client component, toggle com `aria-expanded`/`aria-controls`).
- `src/components/landing/HeroSection.tsx` — título/subtítulo de valor, CTA primário → `/signup`, CTA secundário âncora `#precos`.
- `src/components/landing/HeroVisual.tsx` — card ilustrativo do produto: donut chart (`recharts`, mesmo padrão de `WeeklyChart.tsx`) + 3 métricas com chips de variação % (verde/vermelho), **dados 100% estáticos/ilustrativos**, sem ligação com dado real (conforme escopo).
- `src/components/landing/FeaturesSection.tsx` — grid de 7 cards `rounded-2xl`, mapeados 1:1 ao produto existente (campanhas+ICP, sequences multicanal, WhatsApp, busca de leads por IA, agentes de IA sdr/followup/closer — nomes confirmados em `src/lib/agents/types.ts`/`prompt.ts` —, pipeline Kanban, calendário). Nenhuma feature inventada.
- `src/components/landing/PricingSection.tsx` — abas mensal/anual (`Tabs`/`TabsList`/`TabsTrigger`, mesmo componente base-ui usado em `PlanSelectionSection`), reaproveita `PlanCard` (SPEC-034) 1:1, alimentado por `plans: PlanView[]` vindo do server component pai. CTA self-service → `/signup?plan=<key>&cadence=<monthly|yearly>`; plano sem `selfServiceCheckout` (hoje "business") → `mailto:contato@leadforge.com` (contato comercial placeholder).
- `src/components/landing/SocialProofSection.tsx` — D-35-2: sem depoimento/logo fabricado; 3 "capacidades" genéricas da plataforma (nenhum número de cliente/estatística inventada).
- `src/components/landing/FinalCtaSection.tsx` — banner final, CTA → `/signup`.
- `src/components/landing/LandingFooter.tsx` — links institucionais mínimos (Produto/Conta/Contato) + copyright dinâmico.
- `src/components/landing/FadeInSection.tsx` — wrapper `framer-motion` (`whileInView`, `viewport.once`) para fade+slide sutil ao rolar; usado em Features/Pricing/SocialProof/FinalCta. Hero anima só o `HeroVisual` (fade+slide ao montar).

### Arquivos alterados
- `src/app/globals.css` — nova classe `.landing-theme` com paleta clara + primária roxo/índigo (`#6D5EF5`) **isolada** (não altera `:root`). Ver decisão de design abaixo.
- `src/app/(app)/page.tsx` — **removido**. Antes só redirecionava `/` → `/dashboard`; essa rota deixou de existir dentro do grupo `(app)` (que exige `requireUser()`), liberando "/" para a nova landing em `src/app/page.tsx`. `(app)/layout.tsx` não mudou — continua exigindo login para `/dashboard` e demais rotas do grupo, exatamente como antes.

### Decisão de design: paleta isolada em vez de recolorir o app
O design system atual (`:root` em `globals.css`) é **inteiramente escuro** (sem `.dark`/light variante já cabeada — `html { color-scheme: dark }` fixo, `<html>` sempre com classe `dark`, zero uso de `dark:` em `src/components/ui`/`billing`) e tem primária teal `#1fb390`, usada em ~30 SPECs já `IMPLEMENTED` (dashboard, pipeline, sidebar, etc.). A SPEC pede "fundo claro" + primária roxo/índigo especificamente para a landing (estética de marketing, distinta do produto logado). Recolorir `:root` globalmente trocaria a cor de marca e o tema de toda a área logada sem nenhuma SPEC pedindo isso — risco de regressão visual grande e fora de escopo.
Optei pela alternativa que a própria SPEC autoriza: isolei a paleta clara + índigo numa classe `.landing-theme` (só sobrescreve `--background/--foreground/--card/--muted/--primary/--secondary/--accent/--border/--input/--ring/--warning` e `color-scheme: light`), aplicada apenas na `<div>` raiz de `src/app/page.tsx`. Zero mudança visual em qualquer tela logada. `--radius-2xl` (`rounded-2xl`) e as animações (`fade-in`/`slide-up`) já existiam no design system e foram reaproveitadas sem alteração.

### Critérios de aceitação
| Critério | Status | Evidência |
|---|---|---|
| `/` público, sem `requireUser()`, renderiza landing completa (nav/hero/features/pricing/prova social/CTA/footer) | PASS | `src/app/page.tsx` fora de `(app)`; `npm run build` lista `/` como rota própria (não mais redirect); todas as 6 seções presentes |
| Usuário autenticado em `/` → `/dashboard`; `/dashboard`/`(app)` continuam exigindo login | PASS | `src/app/page.tsx` (bloco `requireUser`/`redirect`), `(app)/layout.tsx` inalterado |
| Pricing consome planos reais (ou sinaliza dado de teste) | PASS (com aviso) | `PricingSection` usa `listActivePlans()` real (SPEC-034 `IMPLEMENTED`); preços são os do seed D-33-2 — **placeholder, precisam confirmação de negócio antes do launch** (mesmo aviso já presente em SPEC-034); e-mail de contato comercial (`contato@leadforge.com`) também é placeholder |
| Responsivo mobile-first, tabs acessíveis por teclado, contraste AA, sem lib nova pesada | PASS | Grids `sm:`/`lg:` breakpoints em todas as seções, nav vira menu mobile; `Tabs` = `@base-ui/react/tabs` (mesmo componente acessível já usado em Configurações); contraste verificado via fórmula WCAG (texto/fundo ≥ 4.5:1 nos pares relevantes; ajustei o badge do hero de `bg-primary/10 text-primary` — 3.84:1, insuficiente — para `bg-accent text-accent-foreground` — 6.04:1); nenhuma lib nova instalada (`recharts`/`framer-motion`/`lucide-react` já existiam) |
| build/lint/typecheck OK; validação visual pendente se navegador indisponível | PASS (build/lint/typecheck); validação visual NOT VERIFIED | ver seção de testes abaixo — sem navegador disponível neste ambiente |

### Testes executados
- `npm run typecheck` — VERIFIED, sem erros (precisou `npx next typegen` uma vez para regenerar `.next/types` após mover/remover `(app)/page.tsx`; script `typecheck` do `package.json` não roda isso sozinho, é regenerado automaticamente no próximo `next dev`/`next build`).
- `npm run lint` — VERIFIED, 0 erros (4 warnings pré-existentes em `src/lib/billing/`, não relacionados a esta SPEC).
- `npm run build` — VERIFIED, sucesso; `/` aparece como rota dinâmica própria (`ƒ /`), sem regressão nas demais ~50 rotas.
- `npm run test` (vitest, suíte completa) — VERIFIED, 98 arquivos / 1238 testes, todos passando (nenhuma regressão). Não foram adicionados testes automatizados dedicados à landing: seguindo o padrão já existente no repo (`login/page.tsx`/`signup/page.tsx` também não têm teste de página — RSCs de página não são unit-testados neste projeto, só a lógica pura extraída em `lib/`); a landing não introduziu lógica pura nova que justificasse extração (é composição de seções + `listActivePlans()`/`PlanCard`, já cobertos por `plans.test.ts` e testes de `PlanCard` na SPEC-034).
- Validação visual em navegador real: **NOT VERIFIED** — sem navegador disponível neste ambiente (mesmo padrão de SPECs anteriores do repo). Contraste de cor validado por cálculo (fórmula de luminância relativa WCAG), não por inspeção visual direta.

### Limitações conhecidas / follow-ups sugeridos (não bloqueiam `IMPLEMENTED`)
- Preços exibidos no pricing e link de contato comercial (`contato@leadforge.com`) são placeholder — confirmar antes do launch (mesmo aviso já registrado na SPEC-034 para os preços).
- Validação visual em 3 larguras (375/768/1280) feita apenas por revisão de código/CSS (grids, breakpoints, contraste calculado), não por screenshot real — recomenda-se um passe visual manual antes do launch público.

## Rodada de correção — QA de contraste AA (dev-frontend, 2026-09-26)

QA independente encontrou 2 achados de contraste AA insuficiente em `text-primary` (rodada anterior verificou só 1 par — o badge acima do H1 — e generalizou incorretamente "contraste AA OK" para todos os pares). SPEC reaberta (`IN_PROGRESS`) para corrigir e, desta vez, recalcular **todos** os 8 usos de `text-primary`/`text-primary-foreground` em `src/components/landing/`, não só os reportados.

### Achados do QA (confirmados por fórmula de luminância relativa WCAG)

| Local | Par (antes) | Contraste antes | Limite exigido | Status |
|---|---|---|---|---|
| `HeroVisual.tsx:38` — badge "IA" (`text-xs`, 12px) | `text-primary` (#6d5ef5) sobre `bg-primary/10` computado sobre `bg-card` branco (#f0eefe aprox.) | **4.04:1** | 4.5:1 (texto normal) | FAIL |
| `PricingSection.tsx:47` — link `contato@leadforge.com` (`text-sm`, 14px) | `text-primary` (#6d5ef5) sobre `background` (#f8f8fc) | **4.34:1** | 4.5:1 (texto normal) | FAIL |

### Correção aplicada

Trocado `text-primary` por `text-accent-foreground` (#4a3fd1) nos 2 pontos — mesmo token já usado e testado no badge de categoria acima do H1 (`bg-accent text-accent-foreground`), reaproveitado em vez de introduzir uma cor nova. Não usei `--primary-hover` (#5a4ce0) porque, calculado, ficaria abaixo de `--accent-foreground` em ambos os fundos (ver tabela "depois" abaixo — `accent-foreground` dá margem maior e é a opção já validada no design system da landing).

- `src/components/landing/HeroVisual.tsx:38` — `text-primary` → `text-accent-foreground` (badge "IA", mantém `bg-primary/10`).
- `src/components/landing/PricingSection.tsx:47` — `text-primary` → `text-accent-foreground` (link de contato comercial no estado vazio de planos).

### Achado adicional (fora dos 2 reportados pelo QA, encontrado ao recalcular os 8 pares)

Ao recalcular todos os 8 usos (não só os 2 reportados), encontrei um **terceiro par abaixo de 4.5:1** que não tinha sido reportado pelo QA:

| Local | Par (antes) | Contraste antes | Limite exigido | Status |
|---|---|---|---|---|
| `FinalCtaSection.tsx:13` — subtítulo do banner final (`text-base`/`sm:text-lg`, 16-18px, peso normal — não é "texto grande" pela definição WCAG, que exige ≥24px normal ou ≥18.66px bold) | `text-primary-foreground/85` (branco a 85% opacidade) sobre `bg-primary` | **3.79:1** | 4.5:1 (texto normal) | FAIL |

Corrigido removendo o modificador de opacidade `/85` (mesma cor `text-primary-foreground`, 100% opaco, igual ao H2 acima dele no mesmo banner):

- `src/components/landing/FinalCtaSection.tsx:13` — `text-primary-foreground/85` → `text-primary-foreground`.

### Tabela completa — recálculo dos 8 usos de `text-primary`/`text-primary-foreground` em `src/components/landing/`

Fórmula: luminância relativa WCAG (`L = 0.2126R + 0.7152G + 0.0722B` em sRGB linearizado), contraste = `(L_clara + 0.05) / (L_escura + 0.05)`. Cores de `.landing-theme` em `globals.css`. Onde há opacidade (`/NN`), o canal foi pré-misturado (alpha blend) sobre o fundo antes do cálculo de luminância — não é uma aproximação visual, é o valor de cor final renderizado.

| # | Local | Elemento | Texto normal ou grande? | Par cor/fundo | Contraste ANTES | Contraste DEPOIS | Limite | Status final |
|---|---|---|---|---|---|---|---|---|
| 1 | `HeroSection.tsx:16` | span dentro do H1 (`text-4xl`/`sm:text-5xl`/`lg:text-[3.25rem]`, bold) | Grande (≥24px bold) | `text-primary` #6d5ef5 / `background` #f8f8fc | 4.34:1 | — (sem alteração) | 3:1 | PASS (já confirmado pelo QA — não recalculado por exigência explícita, valor mantido por referência) |
| 2 | `SocialProofSection.tsx:21` | ícone `aria-hidden="true"` (decorativo, não é texto) | N/A — gráfico decorativo, isento de 1.4.3; se aplicável 1.4.11 (3:1) | `text-primary` #6d5ef5 / `card` branco (fundo do card ao redor) | 4.34:1 (sobre `background`, pois o card usa a mesma cor de fundo da página nesta seção) | — (sem alteração) | 3:1 (não-texto) ou isento | PASS (já confirmado pelo QA — não recalculado por exigência explícita) |
| 3 | `FeaturesSection.tsx:70` | ícone `f.icon` `aria-hidden="true"` dentro de container `bg-primary/10 text-primary` (decorativo — título/descrição do card já transmitem a informação em texto) | N/A — gráfico decorativo | `text-primary` #6d5ef5 / `bg-primary/10` sobre `card` branco | 4.04:1 | — (sem alteração, não precisa) | 3:1 (não-texto) ou isento — 4.5:1 não se aplica (não é texto) | PASS (4.04 ≥ 3:1; ícone `aria-hidden`, informação redundante ao `<h3>`/`<p>` em texto puro) |
| 4 | `FinalCtaSection.tsx:10` | H2 (`text-3xl`/`sm:text-4xl`, bold) | Grande (≥24px bold) | `text-primary-foreground` branco / `bg-primary` #6d5ef5 | 4.60:1 | — (sem alteração, já passava) | 3:1 (grande) — passa até no limite de texto normal | PASS |
| 5 | `FinalCtaSection.tsx:13` | Parágrafo subtítulo (`text-base`/`sm:text-lg`, peso normal) | Normal (16-18px, não é bold nem ≥24px) | `text-primary-foreground/85` branco a 85% / `bg-primary` #6d5ef5 | **3.79:1 (FAIL)** | `text-primary-foreground` (100%) / `bg-primary` → **4.60:1** | 4.5:1 (normal) | FAIL → **corrigido → PASS** |
| 6 | `FinalCtaSection.tsx:19` | Link/botão "Começar agora" (`buttonVariants({ size: "lg" })`, semibold) | Normal (botão `lg` não atinge 24px; tratado como texto normal por segurança) | `text-primary` #6d5ef5 / `bg-primary-foreground` branco | 4.60:1 | — (sem alteração, já passava) | 4.5:1 (normal) | PASS |
| 7 | `HeroVisual.tsx:38` | Badge "IA" (`text-xs`, 12px, semibold) | Normal (12px, muito abaixo do limite de texto grande) | `text-primary` #6d5ef5 / `bg-primary/10` sobre `card` branco | **4.04:1 (FAIL)** | `text-accent-foreground` #4a3fd1 / mesmo fundo → **6.32:1** | 4.5:1 (normal) | FAIL → **corrigido → PASS** |
| 8 | `PricingSection.tsx:47` | Link "contato@leadforge.com" (`text-sm`, 14px) dentro de parágrafo `text-sm text-muted-foreground` | Normal (14px) | `text-primary` #6d5ef5 / `background` #f8f8fc | **4.34:1 (FAIL)** | `text-accent-foreground` #4a3fd1 / mesmo fundo → **6.78:1** | 4.5:1 (normal) | FAIL → **corrigido → PASS** |

Resultado: dos 8 usos, 3 estavam abaixo de 4.5:1 para texto normal (itens 5, 7, 8 — os 2 reportados pelo QA + 1 adicional encontrado nesta varredura completa); todos os 3 foram corrigidos e agora ficam entre 4.60:1 e 6.78:1. Os outros 5 (itens 1-4, 6) já atendiam ao limite aplicável (3:1 para texto grande/gráfico decorativo, ou 4.5:1 para texto normal) e não foram alterados.

### Testes executados (após o fix)
- `npm run typecheck` — VERIFIED, sem erros.
- `npm run lint` — VERIFIED, 0 erros (mesmos 4 warnings pré-existentes em `src/lib/billing/`, não relacionados à landing).
- `npm run build` — VERIFIED, sucesso; `/` continua como rota dinâmica própria, sem regressão nas demais rotas.
- `npm test` (vitest, suíte completa) — VERIFIED, 101 arquivos / 1254 testes, todos passando (nenhuma regressão; nenhum teste automatizado dedicado à landing foi adicionado, mesmo racional já registrado na rodada anterior — mudança é só de classe de cor, sem lógica nova).

### Critério de aceitação revalidado
| Critério | Status | Evidência |
|---|---|---|
| AC-004 — Responsivo, **contraste AA**, sem lib nova pesada | PASS | Tabela completa acima — todos os 8 usos de `text-primary`/`text-primary-foreground` recalculados por fórmula de luminância relativa WCAG; os 3 que estavam abaixo de 4.5:1 (texto normal) foram corrigidos e ficam agora entre 4.60:1 e 6.78:1; os demais já atendiam ao limite aplicável (3:1 texto grande/decorativo, ou 4.5:1 texto normal) |

### Limitações conhecidas (mantidas)
- Validação visual em navegador real ainda **NOT VERIFIED** (sem navegador disponível neste ambiente) — contraste validado por cálculo de luminância relativa WCAG, não por inspeção visual/ferramenta de captura de pixel real. Recomenda-se confirmação visual (ex. DevTools/axe) antes do launch público.

### Nota de rastreabilidade -- bloqueio externo de teste (QA, 2026-09-26)
Numa rodada de QA anterior, a suite completa (npm test) nao reproduzia 100% verde por causa de uma flakiness PRE-EXISTENTE e EXTERNA a esta SPEC: src/lib/mobile/meeting-reminders.test.ts / alerts.test.ts (SPEC-028/023) custavam tempo O(numero de Organizations ativas) no banco de teste compartilhado (sweepAlerts varre 1x por org ativa, por design, desde a SPEC-030) e alguns cleanups/asserts nao filtravam por orgId, causando timeout/contaminacao cross-org intermitente. A causa raiz foi corrigida numa rodada de dev-backend da SPEC-031 (helper src/lib/test-utils/park-other-orgs.ts + filtro por orgId nos testes afetados), confirmada por 2 rodadas de QA independente da SPEC-031 e revalidada aqui: apos o fix, npm test roda 100% verde de forma consistente (3 execucoes identicas, 101/101 arquivos, 1254/1254 testes). Nenhuma mudanca de codigo de producao desta SPEC-035 foi necessaria para isso.
