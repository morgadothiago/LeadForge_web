# SPEC-031 — Administrador: backend cross-tenant (listar/gerir Organizations)
- status: DRAFT | domain: backend | depende de: 030

## Objetivo
Dar ao papel `platform_admin` (SPEC-030) as queries/actions para enxergar e administrar todos os Providers/Organizations que assinam a plataforma: listar, ver uso/saude, suspender e reativar. Base de dados para a tela da SPEC-032.

## Escopo
- Queries (`src/lib/queries/admin/*`), sempre via `requirePlatformAdmin()` + caminho `crossTenant` explicito do policy layer da SPEC-030:
  - `listOrganizations({page, pageSize, search?, status?})` — nome, slug, status, data de criacao, dono (nome/email do `owner`), contadores basicos (campanhas ativas, leads totais, instancias WhatsApp conectadas) — sem PII de lead individual, so agregados.
  - `getOrganizationDetail(orgId)` — os mesmos contadores + status de assinatura (campo(s) que a SPEC-033 define; aqui so o que ja existe: `Organization.status`) + ultima atividade (ultimo `SchedulerRun`/`Touch` da org).
- Actions (`src/lib/actions/admin/*`), `ActionResult<T>`, sempre `requirePlatformAdmin()`:
  - `suspendOrganization({orgId, reason})` -> seta `Organization.status = "suspended"`; cron (SPEC-030) ja para de processar; nao apaga dado nenhum.
  - `reactivateOrganization({orgId})` -> volta `status = "active"`.
  - Auditoria: reaproveitar o padrao de `IntegrationAuditLog` (SPEC-018) — novo model `PlatformAuditLog` (id, adminUserId, orgId, action `suspend|reactivate`, reason?, at) ou extensao de um log generico — decisao tecnica do dev-backend (documentar a escolha), nao precisa `[NEEDS_DECISION]`.
- Todas as queries/actions cross-tenant desta SPEC NUNCA passam pelo helper "padrao" com `orgId` implicito (SPEC-030) — sempre pelo caminho explicito de admin, e cada uma tem teste confirmando que um `provider` comum recebe `ForbiddenError`/`ActionResult` de erro ao tentar chamar.

## Fora do escopo
- Tela (SPEC-032).
- Metricas financeiras/billing detalhadas (SPEC-033 define o que existe para mostrar; esta SPEC so expõe o que ja existe no schema base).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [ ] `platform_admin` lista/ve detalhe/suspende/reativa qualquer org; `provider` recebe erro em toda tentativa (teste cobrindo os 2 papeis).
- [ ] Suspender uma org bloqueia o cron (reusa criterio ja testado na SPEC-030) sem apagar dados.
- [ ] Auditoria registra quem/quando/acao/motivo.
- [ ] build/lint/typecheck/testes OK.

## Ordem de execucao
dev-backend, apos 030 `IMPLEMENTED`. Precede 032.
