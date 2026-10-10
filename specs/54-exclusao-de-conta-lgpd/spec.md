# SPEC-054 — Exclusao de conta/perfil (LGPD) com confirmacao por e-mail e e-mails de solicitacao/conclusao
- status: DRAFT | domain: fullstack (## Backend, ## Frontend) | depende de: 033, 049, 052 (`sendOnce`), 055 (token/verificacao compartilham padrao; nao bloqueante) | catalogo: #13, #14 (P0, LGPD)

## Objetivo
Permitir que o usuario peca a exclusao da propria conta (direito de eliminacao, LGPD art. 18), com confirmacao por e-mail (token uso unico, expiracao curta), janela de arrependimento, e-mail "solicitacao recebida" e e-mail "conta excluida" explicando o que foi apagado/anonimizado e o que e retido por obrigacao legal. Cobre dono unico de organizacao com outros membros e usuario em varias orgs.

## Contexto (lido no repo)
- Nao existe acao de exclusao de conta nem de usuario (grep em `src/lib/actions/`: so org/auth/billing; nenhuma `deleteAccount`). Unico expurgo: automatico por ORG, 90 dias apos cancelamento (`src/lib/billing/purge.ts:26-57`): anonimiza Lead/Touch/LeadNote e blobs; NAO apaga `User`, `Membership`, `Organization`, `Subscription` nem e-mails (`purge.ts:9-17`).
- FKs de `User` (`prisma/schema.prisma`): `Membership` Cascade (:184), `PasswordResetToken` Cascade (:262), `EmailAccount` Cascade (:579), `StoredFile.uploadedBy` SetNull (:1122), `OrgInvite.createdBy`/`OrgAuditLog.actor` SetNull (:234/:247), **`Campaign.user` Restrict (:305)** -> um hard delete de `User` com campanhas FALHA hoje; campanhas pertencem a org e ao autor. Outras tabelas guardam `userId` sem FK (ex.: `MobileActionLog`, :1087; `IntegrationAuditLog`) e `User.lastOrgId` sem FK (:~207).
- Regras de membro (SPEC-049): `leaveOrganization` bloqueia ultimo owner e unica org (`org.ts:401-428`), `removeMember` bloqueia ultimo owner (`org.ts:374-399`); `lockOrg`/`actorIsOwner`/`revokeOwnerArtifacts` em `src/lib/org/guards`. `LAST_OWNER` (`org.ts:63`).
- Assinatura pertence a ORG (`Subscription.orgId @unique`), nao ao usuario; org pode ter varios owners. Org sem membros ficaria orfa com cobranca ativa.
- Sessao: JWT stateless; `User.sessionsInvalidatedAt` invalida sessoes (`require-user.ts:29-53`) - reutilizavel para encerrar sessoes ao pedir/concluir exclusao.
- Token de uso unico em hash: padrao `PasswordResetToken` (`schema.prisma:259-269`) e `OrgInvite.tokenHash` (:221-238). Mobile guarda dispositivos/refresh por usuario (`MobileDevice`).
- E-mails de sistema gravam destinatario so no envio (sem tabela de log de conteudo); a SPEC-052 introduz `EmailDispatchLog` (so scenario/dedupeKey/ids, sem corpo) - precisa entrar no escopo de exclusao.

## Escopo proposto
## Backend
1. Modelo aditivo `AccountDeletionRequest { id, userId (sem FK, para sobreviver), emailHash, tokenHash @unique, requestedAt, confirmedAt?, scheduledFor?, cancelledAt?, executedAt?, expiresAt }` + migration aditiva a mao.
2. Fluxo: (a) `requestAccountDeletion` (reautentica com senha; rate limit; anti-enumeracao N/A pois autenticado) cria pedido e envia e-mail de CONFIRMACAO com link `APP_BASE_URL/conta/excluir/<token>`; (b) confirmar link (uso unico, expiracao curta, so hash no banco) agenda `scheduledFor = confirmedAt + janela` (Q-054-2) e envia "solicitacao recebida" (#13) com data e como cancelar; (c) cancelar durante a janela (link + tela); (d) job no tick executa a exclusao ao vencer a janela e envia "conta excluida" (#14) ao e-mail ORIGINAL (capturado antes de apagar).
3. Execucao (conforme Q-054-1): hard delete ou anonimizacao do `User` (nome/e-mail/hash/avatar), remocao de `Membership`, `EmailAccount` (e segredos SMTP), `PasswordResetToken`, tokens/dispositivos mobile, `StoredFile` do usuario, `lastOrgId`; `OrgInvite`/`OrgAuditLog` ficam com ator nulo; tratar `Campaign.userId Restrict` (reatribuir a outro owner/membro da org ou anonimizar o autor - Q-054-5) e tabelas com `userId` sem FK.
4. Regras de org: se o usuario e o UNICO membro da org -> org entra no fluxo de cancelamento+retencao (SPEC-053/033) ou e excluida (Q-054-3); se e owner unico mas ha outros membros -> bloquear com mensagem ("promova outro owner ou transfira") (nunca org sem owner, SPEC-049); em varias orgs -> remove so as memberships (sem tocar orgs que continuam com owner).
5. Retencao legal: manter registros fiscais/financeiros (recibos, `WebhookEvent` de billing, dados de cobranca da org) pelo prazo que a lei exigir (Q-054-4), anonimizando o vinculo pessoal quando possivel; documentar a base legal.
6. E-mails/logs: apagar/anonimizar `EmailDispatchLog`/`BillingReminderLog` quando referenciam o usuario; `AccountDeletionRequest` guarda so hash do e-mail apos execucao. Segredos e tokens nunca em log.
7. E-mails novos (noreply): `account-deletion-confirm`, `account-deletion-requested`, `account-deletion-cancelled` (opcional), `account-deleted` (PT-BR, html+texto, links absolutos, lista clara "apagado / anonimizado / retido por lei"). Cenarios em `EmailScenario` + tabelas Resend/ACS.
8. Testes: token uso unico/expirado/reuso; reautenticacao exigida; janela e cancelamento; execucao idempotente (rerodar nao duplica e-mail #14); owner unico com outros membros bloqueado; usuario em varias orgs; Campaign Restrict tratado; sem vazamento de e-mail/token em log; provider falhando nao impede a exclusao (e-mail best-effort).
## Frontend
9. Tela em Configuracoes (conta) "Excluir minha conta": explicacao do que acontece, bloqueios (owner unico), senha, estado "exclusao agendada para DD/MM" com botao "Cancelar exclusao"; pagina publica/semi-publica de confirmar/cancelar via token; RHF+zod; a11y.

## Fora do escopo
- Exportacao/portabilidade de dados (LGPD art. 18 V) - SPEC propria (Q-054-6); exclusao de dados de LEADS da org (titulares dos leads sao outro controlador/operador - tratados pelo expurgo existente); exclusao por platform_admin (SPEC-031/032).

## Criterios de aceitacao
- Pedido -> e-mail de confirmacao -> confirmacao -> e-mail #13 -> apos a janela, conta removida/anonimizada e e-mail #14 enviado exatamente uma vez; cancelar na janela mantem tudo intacto.
- Nenhuma org fica sem owner; usuario em varias orgs perde so as memberships; login e sessoes invalidos apos a exclusao; dados retidos listados no e-mail coincidem com o que o codigo realmente retem.
- `tsc`, lint, vitest verdes; nenhum banco dropado/resetado; migration aditiva.

## Seguranca / riscos
- Conta tomada: exige senha + confirmacao por e-mail (+ aviso ao e-mail antigo). Race exclusao x cobranca ativa (org unica): definir ordem. Destrutivo e irreversivel: janela de arrependimento e idempotencia obrigatorias. Risco juridico: prazos de retencao exigem validacao do usuario/juridico (nao decidimos por ele).

## Decisoes pendentes
- Q-054-1 (D2 do doc): soft ou hard delete? (Opcoes: anonimizacao do `User` mantendo a linha - compativel com `Campaign` Restrict e auditoria; hard delete exige reatribuir campanhas.)
- Q-054-2 (D2): quantos dias de arrependimento? (sugestoes: 7 ou 15; 0 = imediato apos confirmar e-mail)
- Q-054-3: usuario unico membro de uma org: excluir a org junto (e a assinatura) ou seguir cancelamento+retencao 90 dias? E se a assinatura estiver ativa: bloquear ate cancelar (SPEC-053)?
- Q-054-4: o que a lei obriga a reter (notas/recibos/logs de acesso - Marco Civil art. 15 = 6 meses de logs de acesso; fiscal ~5 anos) e quem valida? (precisa de confirmacao do usuario/juridico)
- Q-054-5: autoria de campanhas do usuario excluido: reatribuir a outro owner ou manter autor anonimizado?
- Q-054-6: incluir exportacao de dados antes de excluir?
- Q-054-7: dividir em SPEC backend + frontend?
