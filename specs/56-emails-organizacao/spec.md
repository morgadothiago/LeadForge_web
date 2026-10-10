# SPEC-056 — E-mails de eventos de organizacao para owners (membro entrou/saiu/removido, convite aceito)
- status: DRAFT | domain: backend | depende de: 049, 052 (`sendOnce`/`notifyOrgOwners`) | catalogo: #17 (P1)

## Objetivo
Notificar os owners da organizacao quando: um convite e aceito/membro entra (via convite ou codigo), um membro sai, um membro e removido, e o papel de um membro muda; e notificar o proprio membro removido/afetado quando fizer sentido.

## Contexto (lido no repo)
- Somente `org_invite` envia e-mail hoje (`src/lib/actions/org.ts:226-257`, `templates/org-invite.ts`, cenario `org_invite` em `scenario.ts:15,24,34`). Aceitar convite (`acceptInvite` :275), entrar por codigo (`joinByCode` :296, `signUpAndJoin` :451), `removeMember` (:374), `leaveOrganization` (:401) e `changeMemberRole` (:345) nao notificam ninguem.
- Todos esses eventos ja gravam auditoria `OrgAuditLog` com `action` (`member_removed`, `member_left`, `role_changed`, ...; `recordOrgAudit`, `org.ts:363,~391,~420`), executados dentro de transacao com `lockOrg`. E-mail deve sair DEPOIS do commit (nunca dentro da transacao).
- Destinatario owners: `Membership.orgRole==="owner"` (padrao de `process-event.ts:17-27`); org pode ter varios owners; o ator nao precisa ser notificado do proprio ato.
- `joinCode` reutilizavel pode gerar rajada de e-mails (varios entrando) - risco de spam para owners (`Organization.joinCodeMaxUses`, `schema.prisma:~145`).

## Escopo proposto
1. Cenarios novos `org_member_joined`, `org_member_left`, `org_member_removed`, `org_role_changed` (noreply) nas tabelas Resend/ACS; templates PT-BR (html+texto) com nome da org, nome/e-mail do membro, data, link absoluto para `/configuracoes/equipe`.
2. Disparo pos-commit nas actions existentes via `notifyOrgOwners` + `sendOnce` (dedupe `org_member_joined:<orgId>:<userId>:<membershipId|ts>`), respeitando a org ativa (SPEC-049); best-effort, nunca lanca, nunca reverte.
3. Consolidar/limitar rajadas (Q-056-2): um resumo diario vs e-mail por evento, e teto por org/hora.
4. E-mail ao membro removido ("voce foi removido da organizacao X") - Q-056-1.
5. Testes: um e-mail por evento e por owner; ator excluido; sem e-mail em falha de transacao (rollback); duplo clique/retry sem duplicar; falha do provider nao propaga; org com varios owners.

## Fora do escopo
- Notificacoes in-app/push mobile; e-mail de convite (ja existe); preferencias de notificacao por usuario; auditoria de leitura.

## Criterios de aceitacao
- Cada evento listado envia o e-mail correto exatamente uma vez a cada owner (exceto o ator), apos commit; nenhum envio em acao recusada/rollback; `tsc`, lint, vitest verdes.

## Seguranca / riscos
- Vazamento de dados de membro para quem nao e owner (conferir destinatarios sob a org ativa); spam por codigo de entrada; e-mail enviado dentro de transacao seguraria o `lockOrg`.

## Decisoes pendentes
- Q-056-1: notificar tambem o membro removido / que teve papel alterado?
- Q-056-2: e-mail imediato por evento ou resumo (digest) para entradas por codigo?
- Q-056-3: quais eventos entram no P1 (so entrada/remocao/saida, ou tambem mudanca de papel)?
