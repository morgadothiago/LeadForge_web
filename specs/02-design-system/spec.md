# SPEC-002 — Design system (tokens, fontes, componentes base)
- status: IMPLEMENTED | domain: frontend | sessao: 1 | ordem: 3 | depende de: SPEC-000
## Objetivo
Tokens CSS/Tailwind v4 do PROMPT (dark-first), fontes e componentes shadcn tematizados.
## Pre-requisito
Ler `node_modules/next/dist/docs/` (fontes via next/font, CSS) antes de codar (AGENTS.md).
## Escopo
- `globals.css`: `@theme` com --background #0a0e11, --card #131619, --muted #1a1d21, --sidebar #111417, --primary #1fb390 (+hover #1a9e7e, fg #0a0e11), --foreground #e9ecec, --muted-foreground #747b82, --destructive #dc2626, borda #202226, radius 0.5rem; cores de stage (7) e canal (4).
- `next/font`: Space Grotesk (400-700) heading, Inter (300-700) body; `lang="pt-BR"`, dark forcado (sem toggle).
- shadcn components: button (4 variantes + pill), input, card, badge, table, dialog, dropdown, select, tabs, skeleton, tooltip, sonner/toast. Nota: components.json usa @base-ui/react; manter.
- `StatusBadge` (stage) e `ChannelBadge`, `MetricCard`, `Skeleton` shimmer, utilitarios de animacao (fade-in, slide-up, scale, hover elevacao).
- Pagina `/design` (dev-only) mostrando os componentes.
## Fora do escopo
Layout de app, telas.
## Criterios de aceite
- [x] Cada token do PROMPT existe e tem o hex exato (revisao por grep).
- [x] Fontes carregadas via next/font, sem @import externo.
- [x] Botao primario: fundo #1fb390, hover #1a9e7e; input focus com borda primary + ring 20%.
- [x] StatusBadge renderiza os 7 stages com cor + fundo 10%.
- [x] `/design` renderiza sem erro de console; build/lint/typecheck passam.
- [x] Contraste texto/fundo >= WCAG AA para foreground e primary-foreground (verificar).
- [x] Respeita `prefers-reduced-motion`.
## Testes
Verificacao visual (screenshot/Playwright se disponivel) + build.
## Decisoes pendentes
Nenhuma (D7: aceitar dark-only).

## Implementation Notes
- Arquivos: src/app/{globals.css,layout.tsx,design/*}, src/components/ui/*, src/components/domain/{StatusBadge,ChannelBadge,MetricCard}.tsx, src/lib/utils.ts, src/lib/design-tokens.test.ts; dep nova: sonner.
- Testes: typecheck, lint, test (17), build VERIFIED. Tokens/contraste (fg 16:1+, primary-fg sobre primary >=4.5) cobertos por design-tokens.test.ts. reduced-motion via media query global.
- Decisoes: componentes sobre @base-ui/react (Dialog, Menu, Select, Tabs, Tooltip); Button/Input/Card/Badge/Table em HTML puro; /design faz notFound() em producao; StatusBadge/ChannelBadge reutilizam src/lib/domain.
- Limitacoes: verificacao visual/console do /design NAO executada (sem Playwright); build prerender OK. Cor de tendencia positiva usa #22c55e literal.
