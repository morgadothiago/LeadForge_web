# Prompt: sidebar agrupada por seções (estilo Cloudflare)

Cole no `project-orchestrator` (ele cria a SPEC, depois `dev-frontend`, depois `qa-reviewer`). Escrito em 2026-10-10.
Referência visual: a sidebar da Cloudflare (seções com título pequeno em cinza, itens com ícone, alguns com chevron
que expande subitens, badge "New").

---

## Prompt

Contexto: LeadForge (`/Users/thiagomorgado/Desktop/LeadForge_web`), Next.js (breaking changes: leia
`node_modules/next/dist/docs/` antes de tocar em API Next), SDD obrigatório (SPEC APPROVED antes de código). Hoje a sidebar
do tenant (`src/components/layout/AppSidebar.tsx` + `nav-items.ts`) é uma lista plana de 10 itens. Quero **agrupar em
seções com título**, como a Cloudflare, para separar a **captação de novos leads** da área de **criativos** e do resto.

### Objetivo
Trocar `NAV_ITEMS` (lista plana) por `NAV_SECTIONS`: seções com título e itens; itens podem ter subitens (expansíveis).
Mesma navegação, mesmas rotas, mesmos contadores "novo": só a organização visual muda.

### Estrutura proposta (confirmar com o usuário antes de aprovar a SPEC)

| Seção | Itens |
|---|---|
| (sem título, topo) | Dashboard |
| **Captação de leads** | Leads (badge `leads`), Pipeline, Campanhas, Sequences, Calendário (badge `calendario`) |
| **Criativos** | Criativos (`/criativos`); reservar espaço para subitens futuros (Avatares, Biblioteca, Modelos) |
| **Automação** | Aprovações (badge `aprovacoes`) |
| **Conta** | Notificações (badge `notificacoes`), Configurações (badge `configuracoes`) |

Decisões a registrar na SPEC (D-0NN-x), com recomendação:
- Q1: Pipeline e Calendário ficam em "Captação" (recomendado: fazem parte do funil) ou em seção própria "Vendas"?
- Q2: Aprovações (rascunhos dos agentes de IA) em "Automação" (recomendado) ou em "Captação"?
- Q3: Itens com subitens usam chevron expansível (como "Compute >" da referência). Hoje só "Criativos" teria; criar
  já o suporte, mas **sem inventar subitens que não têm rota**. Se Criativos não tiver subrotas, vira item simples.
- Q4: seções colapsáveis? Recomendado **não**: título fixo, só itens com subitens expandem (igual à referência).
- Q5: badge "New" (como "Monetize New") para sinalizar funcionalidade recém-lançada: suportar `badge?: "new"` no tipo,
  usar em "Criativos" até o usuário decidir o contrário.

### Requisitos
1. `nav-items.ts`: novo tipo `NavSection { key, title?, items: NavItem[] }` e `NavItem` com `children?: NavItem[]`
   e `tag?: "new"`. Manter `NAV_ITEMS` derivado (flatten) para não quebrar `getPageTitle`/`isActivePath` e os testes.
   `ADMIN_NAV_ITEMS` do platform_admin **continua separado** e nunca aparece junto (SPEC-032).
2. `AppSidebar.tsx`: renderizar uma `SidebarGroup` por seção com `SidebarGroupLabel` (texto pequeno, cinza,
   `text-muted-foreground`, igual à referência); itens como hoje (ícone, badge de "novo" com bolinha, tooltip, estado
   ativo). Item com filhos: `Collapsible` + chevron que gira; abre sozinho se uma rota filha está ativa.
3. **Modo ícone** (`collapsible="icon"`): títulos de seção somem (ou viram divisor fino); itens com filhos abrem o
   submenu em popover/tooltip lateral; nada pode quebrar o layout recolhido.
4. **Mobile** (Sheet): mesma estrutura; fechar o menu ao navegar (`setOpenMobile(false)`, já existe).
5. **Acessibilidade**: um `<nav aria-label>` por seção ou `aria-labelledby` apontando para o título; chevron com
   `aria-expanded`/`aria-controls`; foco visível; ordem de tab = ordem visual; `aria-current="page"` no ativo.
6. Contadores: `countFor(summary, badgeKey)` continua funcionando por item; uma seção **recolhida/item pai** mostra a
   bolinha se algum filho tem novidade.
7. Design: usar só tokens existentes (ver `globals.css`); nada de cor nova. Comparar com a imagem de referência e
   com a densidade atual (altura de item `h-10`).
8. Sem nova dependência. Se `Collapsible` não existir em `src/components/ui`, criar o wrapper no padrão dos
   demais (base-ui, como `dropdown-menu.tsx`) ou usar `<details>` acessível.

### Fora do escopo
Mudar rotas, permissões, conteúdo das páginas, sidebar do admin, seletor de organização (`OrgSwitcher`, outra tarefa).

### Testes
- Lógica pura: flatten de seções, item ativo em rota filha, abrir pai quando filho ativo, bolinha agregada.
- SSR (`renderToStaticMarkup`, sem jsdom): títulos das seções, ordem, `aria-current`, ausência de `ADMIN_NAV_ITEMS` para
  provider e de `NAV_SECTIONS` para platform_admin.
- Nenhum teste existente de `nav-items`/`AppSidebar` pode quebrar sem justificativa.
- Rodar `npx tsc --noEmit`, `npm run lint` e vitest com `TEST_DATABASE_URL` apontando para banco `leadforge_*_test`
  novo (nunca `leadforge_test`). Validar visualmente em navegador (largura desktop, recolhida e mobile) antes de fechar.

### Critérios de aceitação
- Seções com título visíveis e na ordem da tabela; rotas e contadores idênticos aos de hoje.
- Recolhida e mobile funcionam; teclado completo; leitor de tela anuncia seção e estado.
- Platform admin inalterado. `tsc`, lint e vitest verdes. QA aprova.

### Entrega
SPEC nova em `specs/` (próximo número livre), status DRAFT com as Q1–Q5 para o usuário aprovar; só então dev-frontend.
