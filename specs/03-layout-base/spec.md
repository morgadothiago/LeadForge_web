# SPEC-003 — Layout base (sidebar + header)
- status: IMPLEMENTED | domain: frontend | sessao: 1 | ordem: 4 | depende de: SPEC-002
## Escopo
Route group `(app)` com layout: sidebar (#111417, borda #202226, logo Space Grotesk 700 #1fb390, itens Dashboard, Pipeline, Leads, Campanhas, Sequences, [Configuracoes: Email/WhatsApp, na SPEC 10/11]), header (titulo da pagina, busca, area de usuario placeholder ate SPEC-009), estado ativo por pathname, responsivo (sidebar colapsa em drawer < lg), paginas placeholder para cada rota, `not-found`, `error`, `loading`.
Server Component por padrao; `'use client'` so no que precisar (nav ativa, drawer).
## Criterios de aceite
- [x] Rotas /, /pipeline, /leads, /campanhas, /sequences respondem 200 com layout.
- [x] Item ativo: fundo primary/10%, texto #e9ecec; inativo #bcc4c7; icones Lucide 20px.
- [x] Em 375px sidebar vira drawer acessivel (teclado, aria).
- [x] Interface em PT-BR; sem `any`; build/lint/typecheck OK.
- [x] Ordem de dados nao depende de auth (SPEC-009 adiciona guarda depois).
## Decisoes pendentes
Nenhuma.

## Implementation Notes
- Arquivos: src/components/layout/* (Sidebar, SidebarNav, MobileNav, Header, PageTitle, Logo, PlaceholderPage, nav-items), src/app/(app)/{layout,loading,error,page}.tsx + pipeline/leads/campanhas/sequences, src/app/not-found.tsx; removido src/app/page.tsx.
- Verificado: typecheck, lint, test (17), build OK; curl 200 nas 5 rotas, 404 em rota inexistente; aria-current no item ativo.
- Drawer via @base-ui Dialog (focus trap, Esc, aria). error.tsx usa `retry` (API Next 16).
- Limitações: drawer/375px não testado visualmente em browser; Configurações (SPEC 10/11) e auth (SPEC-009) fora de escopo; busca do header é placeholder.
