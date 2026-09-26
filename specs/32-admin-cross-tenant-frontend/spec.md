# SPEC-032 — Administrador: area cross-tenant (UI)
- status: DRAFT | domain: frontend | depende de: 031, 002 (design system), 027 (sidebar shadcn)

## Objetivo
Tela(s) para o `platform_admin` listar todos os Providers/Organizations, ver detalhe/uso e suspender/reativar, usando as queries/actions da SPEC-031.

## Escopo
- Nova secao no app, visivel SO para `platformRole === "platform_admin"` (sidebar ganha item "Administracao" so para esse papel; `provider` nunca ve o item nem acessa a rota — pagina trata negacao como as demais telas admin-only do projeto, ex. SPEC-018).
- Rota sugerida: `/(app)/admin/organizacoes` (lista) e `/(app)/admin/organizacoes/[id]` (detalhe) — dev-frontend confirma se cabe no grupo `(app)` atual ou se precisa de um layout proprio para o admin (ex.: sem o menu de campanhas/leads que so faz sentido para Provider).
- Lista: tabela/cards com nome, status (badge), dono, contadores, busca por nome/e-mail, paginacao — reaproveitar padroes ja existentes (ex.: lista de auditoria da SPEC-018, paginacao de leads da SPEC-008).
- Detalhe: contadores + botao suspender/reativar com `ConfirmDialog` (mesmo padrao usado em SPEC-011/018), toast de resultado, motivo obrigatorio ao suspender.
- Reaproveita integralmente o design system (SPEC-002) e a sidebar shadcn (SPEC-027) — nenhum componente novo de base, so composicao.

## Fora do escopo
- Metricas de billing (entra quando a SPEC-034/033 estiverem prontas — pode virar SPEC de ajuste incremental depois, nao redesenha esta tela).
- Convite/gestao de membros (D-30-4).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [ ] `provider` nao ve o item de menu nem acessa `/admin/organizacoes*` (redirect/erro tratado).
- [ ] `platform_admin` lista, busca, pagina, ve detalhe, suspende (com motivo) e reativa, com toasts e estado otimista/revalidacao coerente com o resto do app.
- [ ] Responsivo (mobile/tablet/desktop), acessivel (foco, aria, navegavel por teclado) seguindo o padrao ja usado nas demais telas.
- [ ] build/lint/typecheck OK; validacao visual marcada como pendente se navegador/docker nao estiver disponivel (mesmo padrao das SPECs anteriores).

## Ordem de execucao
dev-frontend, apos 031 `IMPLEMENTED`.
