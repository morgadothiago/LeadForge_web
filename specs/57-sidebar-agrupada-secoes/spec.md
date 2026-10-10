# SPEC-057 — Sidebar do tenant agrupada em secoes com titulo (estilo Cloudflare)
- status: IMPLEMENTED (aprovada 2026-10-10, usuario: "executar com as recomendacoes") | domain: frontend | depende de: 032, 049b, 051b | briefing: docs/PROMPT_SIDEBAR_AGRUPADA.md

## Objetivo
Trocar a lista plana `NAV_ITEMS` por `NAV_SECTIONS` (secoes com titulo e itens; itens podem ter subitens expansiveis). Mesmas rotas, permissoes e contadores "novo": so a organizacao visual muda.

## Decisoes (todas CONFIRMED pelo usuario, recomendacoes do orquestrador)
- D-057-1 (Q1): Pipeline e Calendario ficam em "Captacao de leads".
- D-057-2 (Q2): Aprovacoes fica em "Automacao".
- D-057-3 (Q3): tipo/componente suportam subitens expansiveis (`children`, Collapsible + chevron, abre se filho ativo); NENHUM subitem sem rota e inventado; "Criativos" e item simples.
- D-057-4 (Q4): secoes NAO colapsaveis (titulo fixo); so itens com filhos expandem.
- D-057-5 (Q5): `tag?: "new"` suportado e usado em "Criativos".

## Estrutura
| Secao | Itens |
|---|---|
| (sem titulo) | Dashboard |
| Captacao de leads | Leads (badge leads), Pipeline, Campanhas, Sequences, Calendario (badge calendario) |
| Criativos | Criativos (tag new) |
| Automacao | Aprovacoes (badge aprovacoes) |
| Conta | Notificacoes (badge notificacoes), Configuracoes (badge configuracoes) |

## Requisitos
1. `nav-items.ts`: `NavSection {key, title?, items}`; `NavItem` ganha `children?` e `tag?: "new"`; `NAV_SECTIONS` exportado; `NAV_ITEMS` derivado por flatten (ordem das secoes; inclui filhos) para manter `getPageTitle`/`isActivePath`/testes. `ADMIN_NAV_ITEMS` continua separado (SPEC-032), nunca junto de `NAV_SECTIONS`.
2. `AppSidebar.tsx`: um `SidebarGroup` por secao com `SidebarGroupLabel` (`text-muted-foreground`); itens como hoje (icone, bolinha, tooltip, ativo, `aria-current`); item com filhos usa Collapsible com chevron (`aria-expanded`/`aria-controls`), abre se rota filha ativa, bolinha agregada dos filhos. Preservar `OrgSwitcher` (prop `plans`) e `NavUser`.
3. Modo icone: titulos somem (ou divisor fino); sem quebrar layout. Mobile: mesma estrutura, `setOpenMobile(false)` ao navegar.
4. A11y: `<nav>` por secao com `aria-labelledby` no titulo (topo sem titulo usa aria-label); foco visivel; ordem de tab = visual.
5. Somente tokens existentes; sem nova dependencia; `Collapsible` criado no padrao dos ui/ (base-ui) se nao existir.

## Fora do escopo
Rotas, permissoes, paginas, sidebar do admin, OrgSwitcher.

## Testes
Logica pura (flatten, ativo em filho, abrir pai, bolinha agregada); SSR (`renderToStaticMarkup`): titulos/ordem/aria-current, provider sem admin items, platform_admin sem NAV_SECTIONS; testes existentes nao quebram. tsc, lint, vitest (TEST_DATABASE_URL de banco `*_test` novo, nunca `leadforge_test`).

## Criterios de aceitacao
Secoes visiveis na ordem da tabela; rotas/contadores identicos; platform_admin inalterado; tsc/lint/vitest verdes; QA aprova. Validacao visual em navegador (desktop, recolhida, mobile) = PENDENTE (so manual).

## Implementation Notes
- Arquivos: src/components/layout/nav-items.ts (NAV_SECTIONS, flattenItems/flattenSections, hasActiveChild, aggregateFresh; NAV_ITEMS derivado), AppSidebar.tsx (NavSectionGroup/NavEntry), src/components/ui/collapsible.tsx (novo, base-ui), nav-items.test.ts, AppSidebar.test.tsx.
- Testes: tsc limpo; lint 0 erros (14 warnings preexistentes); vitest 145 arquivos/1809 testes verdes com TEST_DATABASE_URL=leadforge_sb_test.
- Decisoes: pai com filhos e botao Collapsible (nao link); topo sem titulo e admin usam aria-label "Navegacao principal"; titulos somem em modo icone.
- Limitacoes: nenhum item usa children hoje (suporte coberto so por testes de logica); validacao visual em navegador PENDENTE (desktop, recolhida, mobile); popover de subitens em modo icone nao implementado (subitens ficam ocultos recolhidos).
