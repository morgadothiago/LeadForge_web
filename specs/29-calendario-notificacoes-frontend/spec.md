# SPEC-029 — Calendario de reunioes + notificacoes (frontend)
- status: IMPLEMENTED (2026-09-21; aprovada pelo usuario; recomendacoes D-R1..D-R16 aprovadas) | domain: frontend | agente: dev-frontend | sessao: 5 | depende de: SPEC-028 (deve estar IMPLEMENTED), SPEC-027
- Backend em `specs/28-calendario-reunioes-notificacoes/spec.md` (modelo Meeting, actions, queries, `GET /api/notifications/summary`, lista e mark-read).

## Objetivo
Pagina `/calendario` (mes/semana/dia), dialog de reuniao, sino com Sheet, pagina `/notificacoes`, bolinhas "novo" na sidebar e toasts, alimentados por um unico polling.

## Contexto (lido do codigo)
- Sem pagina de calendario; `nav-items.ts` tem 7 itens; sidebar shadcn (SPEC-027) pronta; `sonner` + `Toaster` no layout `(app)`; `date-fns` 4.x; NAO ha `react-day-picker` nem `ui/calendar.tsx`; `ui/` tem dialog, select, input, tabs, badge, card, sheet, tooltip, dropdown-menu. Fuso: `Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo"})` (`lead-format.ts`), `startOfLocalDay(DEFAULT_TZ)`.
- Tokens: fundo `#0a0e11`, superficies `#111417`/borda `#202226`, primary `#1fb390`; sem cores novas hardcoded.

## Decisoes (APPROVED em 2026-09-21, recomendacoes)
D-R1 split (esta SPEC = frontend) | D-R2 sino le MobileAlert via rotas de sessao da SPEC-028 | D-R3 dialog exige oportunidade/campanha | D-R5 fuso SP, semana na segunda | D-R8 conflito so aviso | D-R10 shadcn Calendar (react-day-picker v9, `npx shadcn add calendar`) so como seletor/mini-mes + vistas custom (CSS grid + date-fns), sem FullCalendar/react-big-calendar | D-R13 bolinha simples (ponto verde; numero opcional no expandido) | D-R14 bolinha em Calendario, Leads, Aprovacoes, Configuracoes, Notificacoes (Pipeline sem) | D-R15 polling 30 s, sem SSE/WebSocket | D-R16 visitar a area NAO marca lida; marcar e explicito | D-R4/6/7/9/11/12 sao backend (SPEC-028).

## Escopo
1. `nav-items.ts` (fonte unica): `Calendario` (`/calendario`, `CalendarDays`, apos Pipeline) e `Notificacoes` (`/notificacoes`, `Bell`, antes de Configuracoes); total 9 itens; `NavItem` ganha `badgeKey?`. Ajustar testes de nav-items/AppSidebar.
2. `src/app/(app)/calendario/page.tsx` (Server Component, `requireUser`, busca do intervalo visivel) + `CalendarView` client. Mes (grade 6x7, chips hora+titulo curto, "+N"), Semana (00-24, rolagem inicial ~07:00, linha "agora", blocos por startsAt/endsAt), Dia (1 coluna), Agenda/lista <640px. Anterior/proximo/hoje; `?view=&date=&meeting=` na URL; semana inicia na segunda; pt-BR 24h; cabecalho "GMT-3"; calculo de dia/hora SEMPRE no fuso da reuniao/usuario, nunca do servidor. Bloco: primary/15 + borda primary; cancelada riscada/opaca; passada opaca. Arrastar/redimensionar fora do escopo.
3. Dialog criar/editar (`ui/dialog`): busca de lead, campanha/oportunidade, data, inicio/fim (15 em 15 min), fuso (padrao SP), link, notas, aviso de conflito; Salvar, Cancelar reuniao (confirmacao, com aviso de que o stage nao volta), Marcar realizada, No-show. Erros PT-BR; acessivel (labels, foco, Esc, aria-live). Usa actions da SPEC-028.
4. Sino no `Header`: `aria-label="Notificacoes, N nao lidas"`, ponto/contador `#1fb390` (99+), sem ponto com 0. Clique abre `ui/sheet` com ultimas 20 notificacoes (icone por kind, titulo/corpo fixos, horario relativo pt-BR), "Marcar como lida", "Marcar todas como lidas", "Abrir" (reuniao -> `/calendario?date=..&meeting=id`; handoff -> lead; demais -> area), rodape "Ver todas" -> `/notificacoes`. Foco preso, Esc fecha, foco volta ao sino.
5. Pagina `/notificacoes`: lista completa paginada (cursor), filtros area/kind e lidas/nao lidas, marcar lida/todas.
6. Bolinha "novo" na sidebar: ponto `#1fb390` 8px; dado de `byArea` do summary; Notificacoes = total. Acessibilidade: nunca so cor, `<span class="sr-only">, N novos itens</span>` no `SidebarMenuButton`, `data-has-new`; expandida ponto/`SidebarMenuBadge` a direita; colapsada ponto no canto do icone e tooltip "Rotulo (N novos)"; `aria-current` preservado; contraste 3:1 sobre `#111417`; sem pulso (`prefers-reduced-motion`).
7. `NotificationsProvider` client no layout `(app)` (dentro do `SidebarProvider`): UM polling de `GET /api/notifications/summary` a cada 30 s, pausa em aba oculta, refetch ao voltar foco e apos marcar lida, `If-None-Match`/304; sino, sidebar e toasts leem o MESMO estado; estado inicial do servidor (sem flash); erro de rede nao derruba UI nem zera contadores. Marcar lida = Server Action/rota com atualizacao otimista.
8. Toasts (sonner): "Reuniao em 15 min" / quando comeca, com botao "Abrir"; dedupe por id em `sessionStorage`.
9. Regra de lida: abrir a area nao marca; limpa ao marcar (individual/todas) ou quando o episodio resolve no backend.

## Fora do escopo
Backend/migration/rotas (SPEC-028); Google/ICS; drag-resize; recorrencia; agenda mobile; WebSocket/SSE; bolinha em Pipeline.

## NFR
Acessibilidade (teclado/aria); responsivo; nenhum dado sensivel em storage alem de ids de dedupe; sem PII em logs; sessao obrigatoria.

## Criterios de aceite
1. Reuniao criada aparece nas 3 vistas no dia/hora corretos em pt-BR/SP, mesmo com TZ do processo UTC.
2. Cancelar mostra aviso de stage; conflito mostra aviso sem bloquear.
3. Sino mostra ponto verde com nao lidas, abre Sheet com ultimas notificacoes; marcar lida/todas funcionam e o ponto some.
4. Toast de 15 min aparece uma vez por reuniao.
5. Calendario e Notificacoes na sidebar navegam e ficam ativos (`aria-current`), 9 itens, colapsada com tooltip.
6. Item com novidade mostra bolinha com texto acessivel, tambem em modo icone, e some ao marcar lida.
7. Um unico polling alimenta sino, sidebar e toast.
8. typecheck, lint e `npm test` verdes.

## Testes obrigatorios
CalendarView 3 vistas + agenda; helpers de dia/semana/mes com TZ=UTC e Asia/Tokyo (virada 23:30-00:30, semana na segunda); dialog criar/editar/cancelar; sino/contador 99+; Sheet (abrir/fechar/foco/marcar lida/todas/link); provider (polling, pausa em aba oculta, 304, erro de rede); sidebar expandida/colapsada com bolinha + sr-only + tooltip, sem bolinha em 0; toast sem repeticao; nav-items 9 itens; `/notificacoes` filtros e paginacao. Validacao visual em navegador: PENDENTE do usuario.

## Riscos
Fuso do usuario fora de SP (v1 fixa SP); polling mantem latencia ate 30 s; dependencia nova `react-day-picker` (Tailwind 4/tema escuro).

## Arquivos esperados (indicativo)
src/app/(app)/calendario/page.tsx; src/app/(app)/notificacoes/page.tsx; src/components/calendar/*; src/components/notifications/* (provider, bell, sheet); ui/calendar.tsx; layout/nav-items.ts, AppSidebar.tsx, Header.tsx, layout `(app)` (+testes).

## Restricoes de implementacao
Ler `node_modules/next/dist/docs/` antes de codar (Next 16). Nao alterar decisoes da SPEC-027. So iniciar com SPEC-028 IMPLEMENTED.

## Implementation Notes
- Arquivos novos: `lib/calendar/{tz,layout,form}.ts` (+ `tz.test.ts`, `layout.test.ts`); `lib/notifications/{client-types,client,poller,toast-dedupe}.ts` (+ `client-types.test.ts`); `lib/actions/meeting-search.ts`; `components/ui/calendar.tsx`; `components/calendar/{CalendarView,MeetingDialog,types}` (+ `CalendarView.test.tsx`); `components/notifications/{NotificationsProvider,NotificationBell,NotificationRow,NotificationsList,notification-ui}` (+ `notifications-ui.test.tsx`); `app/(app)/calendario/page.tsx`; `app/(app)/notificacoes/page.tsx`.
- Arquivos alterados: `layout/nav-items.ts` (9 itens, `badgeKey`), `layout/AppSidebar.tsx` (bolinha #1fb390 + sr-only + tooltip com contagem + `data-has-new`), `layout/Header.tsx` (sino), `app/(app)/layout.tsx` (NotificationsProvider com estado inicial do servidor), `ui/sheet.tsx` (sr-only "Fechar"), `lib/queries/meetings.ts` (+`getMeetingStart`), testes `nav-items.test.ts` e `AppSidebar.test.tsx`; dependencia `react-day-picker`.
- Testes (executados): `npx tsc --noEmit` VERIFIED; `npx eslint` VERIFIED (0 erros, 0 avisos); `npx vitest run` VERIFIED: 87 arquivos, 1113 testes.
- Criterios: AC1 PASS (tz.test + CalendarView.test com TZ=UTC e Asia/Tokyo, virada 23:30-00:30); AC2 PASS na logica (aviso de estagio no dialog de cancelamento + `warning` da action em toast; conflito so aviso, `findConflicts`); AC3 PASS na logica (sino, contador 99+, estado otimista `applyMarkRead/AllRead`; Sheet abrir/fechar/foco por base-ui NAO exercitado em DOM); AC4 PASS (`claimToastIds` + `shouldToastReminder`); AC5 PASS (AppSidebar.test: 9 itens, aria-current, tooltip); AC6 PASS (bolinha + sr-only, modo icone por classes `group-data-[collapsible=icon]`); AC7 PASS (um `createSummaryPoller` no provider; teste com timers falsos: 30 s, 304/If-None-Match, aba oculta, erro de rede); AC8 PASS.
- Decisoes/desvios: (1) `react-day-picker` instalado com `--legacy-peer-deps` (conflito ERESOLVE preexistente do swagger-ui-react); versao 10.0.1 (a SPEC citava v9), API compativel; `ui/calendar.tsx` escrito a mao (sem `npx shadcn add`). (2) Nao ha jsdom/testing-library no projeto: testes de componente sao SSR (`renderToStaticMarkup`) + logica pura; interacoes (foco preso, Esc, hidratacao, dialog aberto) nao sao exercitadas em DOM. (3) Fuso/dia/hora via `Intl` (nao date-fns) porque date-fns usa o fuso do processo. (4) Adicionados dois adaptadores minimos sem contrato novo: action `searchMeetingLeads` (a query `searchLeadsForMeeting` nao e chamavel do cliente) e query `getMeetingStart` (link `/calendario?meeting=id` sem `date`, pois o alerta nao carrega data). (5) Toast so para lembretes <=15 min (titulo fixo "Reuniao em N min"), disparado quando a contagem de Calendario muda (busca da lista, sem 2o polling). (6) Selecao de data do dialog usa `<input type="date">` nativo; o `Calendar` (react-day-picker) e o seletor "Escolher data" da barra. (7) Vista padrao sem `?view=`: semana. Agenda (<640px) exibida no lugar das grades. (8) Fila de Aprovacoes tem bolinha mas nao e limpa por "marcar lida" (dado = Draft pendente, D-R16).
- Limitacoes/PENDENTES: validacao visual em navegador (mobile 375, tablet 768, desktop 1280+), teclado e leitor de tela PENDENTES do usuario; `npm run db:migrate` (SPEC-028) no banco de dev PENDENTE (sem a migration a pagina /calendario falha no banco de dev); sem arrastar/redimensionar (fora do escopo); fuso do usuario fixo em America/Sao_Paulo na vista.
