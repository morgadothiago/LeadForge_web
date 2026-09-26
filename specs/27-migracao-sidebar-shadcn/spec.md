# SPEC-027 — Migracao da sidebar custom para o componente oficial shadcn `Sidebar`
- status: IMPLEMENTED (validacao visual/teclado/leitor de tela PENDENTE do usuario; ver Implementation Notes) | aprovada por usuario, 2026-09-20; D-S1..D-S7 com as recomendacoes: shadcn intacto, breakpoint 1024px, expandido + Ctrl/Cmd+B, usuario/Sair no footer, variante sidebar fixa, item ativo primary/10, manter tooltip atual se compativel) | domain: frontend | agente: dev-frontend | sessao: 5 | depende de: SPEC-003, SPEC-009 (IMPLEMENTED)
- Numeracao: 24-26 pertencem ao repo mobile (`../mobile/specs/`); 27 nao colide.

## Objetivo
Trocar a sidebar/drawer artesanal (Sidebar, SidebarNav, MobileNav) pelo `Sidebar` oficial do shadcn (estilo base-nova, primitives @base-ui), ganhando modo colapsavel para icones, estado persistido em cookie, Sheet no mobile e atalho de teclado, sem mudar a identidade visual nem o comportamento das paginas.

## Contexto (estado atual, lido do codigo)
- `src/app/(app)/layout.tsx`: `<div flex h-screen>` com `<Sidebar/>` + coluna (`Header`, `HealthBanner` em Suspense, `<main>`), `Toaster`. Guarda de auth via `requireUser` (nao alterar).
- `src/components/layout/`: `Sidebar.tsx` (aside `hidden lg:flex`, w-64, `#111417`/borda `#202226`), `SidebarNav.tsx` (usa `NAV_ITEMS`, `isActivePath`, `aria-current="page"`, ativo `bg-primary/10 text-#e9ecec`, inativo `#bcc4c7`, hover `#202226`), `MobileNav.tsx` (Dialog base-ui, botao "Abrir menu", Logo, bloco usuario + `LogoutButton`), `Header.tsx` (inclui `MobileNav`, `PageTitle`, busca, usuario), `Logo.tsx`, `nav-items.ts` (fonte unica: 7 itens, `isActivePath`, `getPageTitle`), `HealthBanner.tsx`, `PageTitle.tsx`.
- `src/components/ui` NAO tem `sidebar.tsx`; ja tem `tooltip.tsx`, `dialog.tsx`; NAO tem `sheet`, `separator`. `src/hooks` nao existe (alias `@/hooks` ja em components.json). `globals.css` ja tem `--sidebar` e `--sidebar-foreground` (+ `--color-sidebar*` no @theme), faltam demais tokens (`--sidebar-primary`, `-accent`, `-border`, `-ring`...).
- Nota: nao ha badges na sidebar hoje; o aviso de saude do WhatsApp e o `HealthBanner` (faixa no layout). "Preservar badges/banner" = manter o banner intacto e, se aprovado em D-S4, nao introduzir badges novos.
- Next.js deste projeto tem breaking changes: o dev-frontend DEVE ler `node_modules/next/dist/docs/` (layouts, `cookies()` assincrono, Server/Client Components) antes de codar.

## Escopo
1. Instalar via `npx shadcn@latest add sidebar` (puxa `sidebar.tsx`, `sheet.tsx`, `separator.tsx`, `tooltip.tsx` (ja existe: NAO sobrescrever sem diff revisado), `input`/`skeleton` (ja existem), `hooks/use-mobile.ts` e variaveis CSS `--sidebar-*`). Revisar diff de todo arquivo tocado; reconciliar com os tokens existentes (mesmos hex: fundo `#111417`, borda `#202226`, texto `#bcc4c7`, ativo `#e9ecec` com `primary/10`, primary `#1fb390`). Se a CLI/registry base-nova gerar API diferente da esperada, seguir o que a CLI gerar e registrar desvio.
2. `AppSidebar` (client) composto com `SidebarProvider`, `Sidebar collapsible="icon"`, `SidebarHeader` (Logo; versao reduzida/inicial "L" no modo icone), `SidebarContent > SidebarGroup > SidebarMenu > SidebarMenuItem > SidebarMenuButton asChild/render Link` (conforme API gerada), `SidebarFooter` (usuario + `LogoutButton`), `SidebarRail`, `SidebarTrigger` no `Header`.
3. `nav-items.ts` continua fonte unica (nenhum item duplicado; `icon`, `label`, `href` consumidos dali; `isActivePath`/`getPageTitle` inalterados). Item ativo via `isActive={isActivePath(pathname, href)}` + `aria-current="page"` explicito.
4. Modo icone: `collapsible="icon"`, tooltip com `label` em cada item colapsado, atalho `Ctrl/Cmd+B` (padrao shadcn), estado persistido no cookie `sidebar_state` lido no `layout.tsx` (Server Component, `await cookies()`) e passado como `defaultOpen` para evitar flash.
5. Mobile (< lg? ver D-S2): o `Sidebar` renderiza `Sheet` no mobile; remover `MobileNav.tsx`; botao de abrir com `aria-label="Abrir menu"` (PT-BR), titulo sr-only "Menu de navegacao", fecha ao navegar, Esc e foco devolvido ao gatilho.
6. Remover `Sidebar.tsx`, `SidebarNav.tsx`, `MobileNav.tsx` (e ajustar `Header.tsx`/`layout.tsx`). `Logo`, `HealthBanner`, `PageTitle`, `PlaceholderPage` permanecem. `SidebarInset` envolve a coluna de conteudo; `HealthBanner` e `Toaster` continuam funcionando, `main` mantem scroll proprio (`h-screen`/overflow).
7. Ajuste de testes existentes e novos (ver Testes).

## Fora do escopo
- Novos itens de menu, sub-menus, grupos, busca no menu, mudanca de rotas/`nav-items`, badges de contagem novos, tema claro/toggle, redesign do Header (busca, usuario), mudanca de auth/`requireUser`, HealthBanner, paginas, mobile app, e demais componentes shadcn nao exigidos pelo `add sidebar`.
- Sem refactors nao relacionados; sem trocar biblioteca de icones.

## Requisitos funcionais
- RF1 Mesmos 7 itens, mesma ordem, mesmos rotulos PT-BR e icones lucide.
- RF2 Destaque ativo por prefixo (`/leads/123` ativa Leads); exatamente um item com `aria-current="page"` por rota conhecida; nenhum em rota desconhecida (404).
- RF3 Colapsar/expandir por botao, rail e `Ctrl/Cmd+B`; estado sobrevive a reload via cookie; primeira visita = expandida (D-S3).
- RF4 Icone-only: rotulo acessivel preservado (`aria-label`/texto sr-only + tooltip).
- RF5 Mobile: Sheet com mesmos itens, usuario e Sair; fecha ao navegar.
- RF6 HealthBanner permanece acima do `main`, mesma logica, falha nunca derruba layout.
- RF7 Logout continua funcionando (desktop no Header `lg`, footer da sidebar e mobile).
## Requisitos nao funcionais
- A11y: landmark `nav` com `aria-label="Navegacao principal"` (com acento como hoje: "Navegação principal"); tab order logico; foco visivel (`ring primary/40`); tooltips nao sao o unico rotulo; contraste AA mantido (`#bcc4c7` sobre `#111417`); respeita `prefers-reduced-motion` nas transicoes.
- Sem `any`; PT-BR na UI; sem hydration mismatch (cookie lido no servidor); sem CLS perceptivel; sem novas dependencias alem das puxadas pela CLI (deps `@base-ui`/`lucide` ja existentes; npm com `--legacy-peer-deps` se necessario).
- Server Component por padrao; `"use client"` so em AppSidebar/nav/trigger.

## Criterios de aceite
- [ ] `src/components/ui/sidebar.tsx`, `sheet.tsx`, `separator.tsx`, `src/hooks/use-mobile.ts` presentes; vars `--sidebar-*` em `globals.css` mapeadas para a identidade atual (sem regressao de cor).
- [ ] `Sidebar.tsx`, `SidebarNav.tsx`, `MobileNav.tsx` removidos; nenhuma referencia orfa (grep limpo).
- [ ] `nav-items.ts` e a unica definicao de itens.
- [ ] Item ativo correto em todas as 7 rotas e em subrotas; `aria-current` correto.
- [ ] Colapso para icones + tooltip + cookie persistido + `Ctrl/Cmd+B`.
- [ ] Mobile via Sheet: abre, navega, fecha, Esc, foco.
- [ ] HealthBanner, Header, Toaster e scroll do `main` sem regressao; `LogoutButton` ok.
- [ ] `npm run typecheck`, `lint`, `test`, `build` verdes; rotas `(app)` respondem 200 autenticado / redirect `/login` sem sessao.
- [ ] Nenhuma pagina existente alterada alem de layout/header.

## Testes obrigatorios (vitest; suite atual nao pode regredir)
- Atualizar testes existentes que importem `SidebarNav`/`MobileNav`/`Sidebar` (localizar por grep) para o novo componente; nao apagar cobertura.
- Unitario `nav-items`: `isActivePath` (exato, prefixo, falso-positivo `/leadsx`), `getPageTitle`.
- Componente `AppSidebar`: renderiza 7 itens a partir de `NAV_ITEMS`; ativo por `usePathname` mockado (todas as rotas + subrota + desconhecida); `aria-current` unico; links com `href` corretos.
- A11y: roles/landmark `navigation` com nome; botao trigger com nome acessivel; itens navegaveis por Tab; modo icone mantem nome acessivel; (axe/`jest-axe`/`vitest-axe` so se ja instalado; senao asserts manuais e registrar limite).
- Responsivo: `useIsMobile` mockado (matchMedia) -> renderiza Sheet no mobile e sidebar fixa no desktop; Sheet fecha ao clicar em item.
- Cookie: `layout`/provider recebe `defaultOpen` conforme cookie `sidebar_state` (true/false/ausente) e escreve cookie ao alternar.
- Regressao: HealthBanner (com e sem alertas, falha de query) e Header (usuario, logout) continuam com seus testes.
## Validacao manual (limites)
Sem navegador nesta sandbox: validacao visual (identidade, tooltips, animacao, 375/768/1024/1440px, teclado real, leitor de tela) fica **PENDENTE do usuario** e deve constar como tal no fechamento. Nao declarar "visual OK" sem essa checagem.

## Riscos
- R1 CLI base-nova pode sobrescrever `tooltip.tsx`/`globals.css` ou gerar tokens que alterem cores: revisar diff, nao usar `--overwrite` cegamente.
- R2 `SidebarProvider` usa `use-mobile` via matchMedia: flash/hidratacao no primeiro paint mobile (mitigar com CSS `md:`/`lg:` e cookie).
- R3 Breakpoint do shadcn (768px) difere do atual (`lg` 1024px): comportamento tablet muda (D-S2).
- R4 Layout `h-screen overflow-hidden` vs `SidebarInset` (`min-h-svh`): pode quebrar scroll do `main`/kanban horizontal (SPEC-007) — testar Pipeline.
- R5 Conflito de tokens `--sidebar` existentes vs gerados; `@theme inline` duplicado.
- R6 Next com breaking changes: leitura de cookie em Server Component e `LayoutProps` devem seguir docs locais.
- R7 Lint pode acusar codigo gerado (`react/*`, `any`); ajustar minimamente, sem reescrever o componente.

## Decisoes pendentes
[NEEDS_DECISION] D-S1 Deixar o codigo gerado do shadcn intacto (recomendado, facilita upgrades) ou customizar livremente `sidebar.tsx`? Rec.: intacto; customizar so via classes/CSS vars nos consumidores.
[NEEDS_DECISION] D-S2 Breakpoint do modo mobile: manter `lg` (1024px, comportamento atual, exige ajustar `use-mobile`/constante) ou aceitar 768px do shadcn? Rec.: manter 1024px para nao mudar tablet.
[NEEDS_DECISION] D-S3 Estado inicial: expandida (rec.) ou icones; e `Ctrl/Cmd+B` habilitado? Rec.: expandida + atalho habilitado.
[NEEDS_DECISION] D-S4 Bloco usuario + Sair: footer da sidebar (rec., unifica desktop/mobile) ou manter so no Header no desktop? Impacta duplicacao do nome/e-mail no Header.
[NEEDS_DECISION] D-S5 Variante visual: `variant="sidebar"` fixa com borda (identica a hoje, rec.) vs `floating`/`inset`.
[NEEDS_DECISION] D-S6 Item ativo: manter fundo `primary/10` + texto `#e9ecec` (rec., zero mudanca visual) vs padrao accent do shadcn.
[NEEDS_DECISION] D-S7 Permitir que a CLI atualize `tooltip.tsx` existente (mostrar diff) ou manter o atual e adaptar? Rec.: manter atual se API compativel.

## Restricoes de implementacao
Ler `node_modules/next/dist/docs/` antes; nao commitar; nao alterar decisoes de SPECs anteriores; nao tocar backend/auth/paginas; parar com `SCOPE CONFLICT`/`[NEEDS_DECISION]` se a CLI exigir dependencia ou mudanca fora do escopo. Ao concluir: marcar Implementation Notes com arquivos, comandos e o que ficou PENDENTE (validacao visual).

## Implementation Notes
- Arquivos: novos `src/components/ui/{sidebar,sheet,separator}.tsx`, `src/hooks/use-mobile.ts`, `src/components/layout/AppSidebar.tsx`, `src/lib/sidebar-state.ts`; testes `AppSidebar.test.tsx`, `nav-items.test.ts`, `sidebar-state.test.ts`. Alterados: `(app)/layout.tsx` (SidebarProvider + cookie `sidebar_state` via `await cookies()` + SidebarInset), `Header.tsx` (SidebarTrigger), `globals.css` (tokens `--sidebar-*` mapeados aos hex atuais), `ui/tooltip.tsx`, `ui/button.tsx`. Removidos: `Sidebar.tsx`, `SidebarNav.tsx`, `MobileNav.tsx`.
- Testes: typecheck VERIFIED; eslint VERIFIED (limpo); vitest VERIFIED (990/990, 74 arquivos; eram 971). `npm run build` FAILED por ambiente: sem rede para baixar Google Fonts (Space Grotesk), sem relacao com a mudanca; NOT VERIFIED.
- Desvios (registrados): (1) a CLI gerou `import { cn } from "cn"` e adicionou o pacote npm `cn`; revertido package.json/lock e trocado por `@/lib/utils` nos 3 arquivos gerados. (2) `tooltip.tsx` existente era incompativel (sem `side/align`, usados pelo sidebar): mantido o estilo e adicionadas as props de posicionamento (`side`,`align`,`alignOffset`,`sideOffset`), sem sobrescrever pela versao da CLI. (3) `button.tsx`: adicionado size `icon-sm` (exigido pelo codigo gerado). (4) `sidebar.tsx`: apenas as 2 strings do Sheet traduzidas para PT-BR ("Menu de navegação"); resto intacto (D-S1). `use-mobile.ts` reescrito com `useSyncExternalStore` (breakpoint 1024, D-S2; lint react-hooks proibia setState no effect). (5) `SidebarInset` renderiza `<main>`, entao o `<main>` antigo virou `<div>` de scroll interno; Header fica dentro do landmark main. (6) Classes `md:` do codigo gerado (768px) permanecem: entre 768-1023px pode haver flash da sidebar desktop antes da hidratacao; apos hidratar vale o Sheet (1024).
- Aria: trigger "Abrir ou recolher menu"; rail "Recolher ou expandir menu"; nav "Navegação principal". Modo icone: rotulos mantidos no DOM (sr-only via truncamento) + tooltip; botao Sair em icone usa `text-[0px]` (nome acessivel preservado).
- Testes de componente usam `renderToStaticMarkup` (ambiente node; nao ha jsdom/testing-library/axe). Interacoes (clique fecha Sheet, Ctrl+B, escrita do cookie, Esc/foco) NAO cobertas automaticamente.
- PENDENTE do usuario: validacao visual (identidade, tooltips, animacao, 375/768/1024/1440px), scroll do `main` e kanban horizontal do Pipeline (SPEC-007), teclado real, leitor de tela, `build`, cookie persistindo apos reload.
- Ajuste 2026-09-21 (pedido do usuario): footer agora e dropdown estilo nav-user (SidebarMenuButton lg com avatar de iniciais, nome, e-mail e ChevronsUpDown; menu com identificacao e item Sair que roda a mesma server action logout via onClick/useTransition; side right no desktop, bottom no mobile). `ui/dropdown-menu.tsx` ganhou prop `side`. LogoutButton nao e mais usado no footer.
