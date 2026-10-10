# SPEC-054 — Exclusao de conta/perfil (LGPD) com confirmacao por e-mail e e-mails de solicitacao/conclusao
- status: IMPLEMENTED (aprovada 2026-10-10; 054a backend e 054b frontend IMPLEMENTADAS 2026-10-10) | domain: fullstack (## Backend, ## Frontend) | depende de: 033, 049, 052 (`sendOnce`), 055 (token/verificacao compartilham padrao; nao bloqueante) | catalogo: #13, #14 (P0, LGPD)

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

## Decisoes registradas (2026-10-10, usuario aprovou com as recomendacoes do RETOMAR secao 3 item 4)
- D-054-1 (Q-054-1, CONFIRMED): soft delete (anonimizacao do `User` mantendo a linha), purga definitiva apos 30 dias.
- Demais questoes (Q-054-2..7): o usuario mandou seguir e delegou; decididas abaixo como **INFERRED / conservadoras** (revisaveis; nenhuma e CONFIRMED pelo usuario alem da D-054-1).
- D-054-2 (Q-054-2, INFERRED): janela de arrependimento = os mesmos 30 dias antes da purga. Apos confirmar o e-mail a conta fica bloqueada/oculta (anonimizacao so na purga) e pode ser cancelada pelo link do e-mail ou pelo login nesse periodo.
- D-054-3 (Q-054-3, INFERRED): unico membro de uma org -> a org entra no fluxo de cancelamento+retencao da SPEC-053/033; se houver assinatura ativa (nao cancelada) BLOQUEAR a exclusao ate cancelar (mensagem clara). Owner unico com outros membros -> BLOQUEAR (promover outro owner antes). Varias orgs -> remove so as memberships.
- D-054-4 (Q-054-4, INFERRED, **precisa de validacao juridica do usuario**): reter registros fiscais/financeiros (recibos, `WebhookEvent` de billing) 5 anos e logs de acesso 6 meses (Marco Civil art. 15), anonimizando o vinculo pessoal.
- D-054-5 (Q-054-5, INFERRED): campanhas do usuario excluido ficam com autor anonimizado (nao reatribuir); por isso soft delete mantem a linha do `User` (D-054-1) e `Campaign.userId Restrict` nao e tocado.
- D-054-6 (Q-054-6, INFERRED): exportacao de dados (portabilidade) FORA de escopo; SPEC futura.
- D-054-7 (Q-054-7, INFERRED): dividida em 054a (backend) e 054b (frontend).
- Decisoes transversais: (c) recibo = so e-mail informativo; (d) regua de cartao e PIX igual.

## Implementation Notes — 054a (backend, 2026-10-10)
- **Migration (aditiva, escrita a mao):** `prisma/migrations/20261014120000_account_deletion_request` (so `CREATE TABLE`/`INDEX`). Aplicada APENAS no banco de teste `leadforge_054_test` (`prisma migrate diff` banco x schema: "No difference detected"). **Falta `prisma migrate deploy` no banco de dev `leadforge`** (nunca `migrate dev`/`reset`).
- **Extensao minima do modelo (decisao tecnica, nao altera regra de negocio):** alem dos campos do item 1, `AccountDeletionRequest` ganhou `cancelTokenHash @unique` (token PROPRIO de cancelamento do link do e-mail #13; so hash) e `logsPurgedAt` (marca a limpeza dos logs retidos 6 meses). Indices `[userId, requestedAt]` e `[scheduledFor]`.
- **Arquivos:** `src/lib/account-deletion/{constants,retention,blockers,service,purge}.ts` (+`account-deletion.test.ts`, 20 testes); `src/lib/actions/account-deletion.ts`; `src/lib/schemas/account-deletion.ts`; templates `src/lib/channels/email/templates/{account-deletion-confirm,account-deletion-requested,account-deletion-cancelled,account-deleted}.ts`; `scenario.ts` (+4 cenarios, remetente noreply Resend/ACS) e `scenario.test.ts`; `scheduler/run-tick.ts` (job isolado); `actions/auth.ts` e `app/api/mobile/v1/auth/login/route.ts` (login bloqueado na janela); `use-server-auth.test.ts`/`auth/auth.test.ts` (allowlist das 4 actions publicas); `prisma/schema.prisma`.
- **Fluxo:** `requestAccountDeletion` (senha; 5 tentativas/15min e 3 pedidos/h por usuario; novo pedido substitui o pendente) -> e-mail de confirmacao (link `APP_BASE_URL/conta/excluir/<token>`, 24h, uso unico, so sha256 no banco) -> `confirmAccountDeletion` (atomico; `scheduledFor = agora + 30 dias`; `sessionsInvalidatedAt = agora`; dispositivos mobile revogados; e-mail #13 com link `APP_BASE_URL/conta/excluir/cancelar/<token>`) -> janela de 30 dias com conta bloqueada (login web e mobile recusam DEPOIS de validar a senha) -> job no tick `runAccountDeletionJob` (idempotente: o pedido e reivindicado por `updateMany executedAt:null` dentro da transacao de anonimizacao; `sendOnce` `account_deleted:<pedidoId>` garante o #14 uma vez, ao e-mail ORIGINAL capturado antes de anonimizar). Cancelar: pelo link (`cancelAccountDeletionByToken`), pela sessao (pedido ainda nao confirmado) ou por e-mail+senha (`cancelAccountDeletionWithPassword`, "cancelar pelo login": nao abre sessao); aviso "exclusao cancelada" por e-mail. Cancelar e permitido ate a execucao (inclusive se o tick atrasar).
- **Regras de org (D-054-3), reavaliadas no pedido, na confirmacao (sob `lockOrg`; bloqueio nao consome o token) e na purga:** unico membro + assinatura `trialing|active|past_due` sem `cancelAtPeriodEnd` => `active_subscription`; unico owner com outros membros => `last_owner_with_members`; `platform_admin` e conta sem senha tambem bloqueiam. Unico membro com assinatura cancelada/agendada segue o fluxo 053/033 sozinho (nada reimplementado; testado com `purgeCanceledOrgs`). Se na hora da purga virar bloqueado (mudou na janela), a purga e ADIADA (rollback, 1 log por pedido) e nenhum #14 sai: nunca org sem owner.
- **O que a purga faz** (fonte unica: `retention.ts`, usada pelo e-mail #14, com teste cruzando texto x codigo): anonimiza `User` (nome/e-mail `removido-<id>@removido.invalid`/senha/avatar/`lastOrgId`) mantendo a linha (Campaign Restrict e autoria de campanhas/criativos preservadas, D-054-5); apaga `Membership` (so do usuario), `EmailAccount` (+segredo), `PasswordResetToken`, `MobileDevice`, `MobileActionLog`, `EmailDispatchLog` do usuario; `StoredFile` do usuario sem uso por criativo = soft delete + blob removido (best-effort; falha fica para `reconcileOrgBlobs`), em uso = so desvincula o autor; `OrgInvite`/`OrgAuditLog` com ator/alvo nulos, convites ao e-mail do usuario revogados e com e-mail anonimizado, `meta.email` removido; e-mail do usuario redigido (`[removido]`) dos payloads de `WebhookEvent` das orgs dele (registro retido). `IntegrationAuditLog` do usuario retido por 6 meses e apagado por `purgeRetainedUserLogs` (marca `logsPurgedAt`). `BillingReminderLog` nao referencia usuario (so org): nada a limpar.
- **Retencao (D-054-4, INFERRED, PRECISA DE VALIDACAO JURIDICA DO USUARIO):** 5 anos para registros de cobranca da organizacao (assinatura/`WebhookEvent`: ficam sem job de descarte) e 6 meses para logs de auditoria vinculados ao usuario (apagados pelo job). Comentado em `retention.ts` e listado no e-mail #14.

### Contrato para o frontend (054b) — `src/lib/actions/account-deletion.ts` (`"use server"`, `ActionResult<T>`, zod em `src/lib/schemas/account-deletion.ts`)
| Action | Acesso | Entrada | Sucesso (`data`) | Erros (`errors`) |
|---|---|---|---|---|
| `getAccountDeletionState()` | sessao provider | — | `{status: "none"\|"awaiting_confirmation"\|"scheduled", confirmationExpiresAt, scheduledFor, windowDays: 30, blockers: {code,message,orgId?,orgName?}[], canRequest}` | `_form` |
| `requestAccountDeletion({password})` | sessao provider | senha | `{emailSent, expiresAt}` | `password` (senha incorreta); `code: ["blocked"]` + `blockers: [codigos]` + `_form` (mensagens); `code: ["already_scheduled"]` + `scheduledFor`; `code: ["rate_limited"]` |
| `cancelAccountDeletion()` | sessao | — | `{cancelled:true}` | `code: ["not_pending"]` |
| `previewAccountDeletionToken({token})` | PUBLICA (rate limit IP) | token | `{valid:false}` \| `{valid:true, kind:"confirm", expiresAt}` \| `{valid:true, kind:"cancel", scheduledFor}` | `code: ["rate_limited"]` |
| `confirmAccountDeletion({token})` | PUBLICA | token do e-mail de confirmacao | `{scheduledFor, windowDays}` (encerra o cookie se for o mesmo usuario) | `code: ["token_invalid"]` (generico: invalido/expirado/usado); `code: ["blocked"]` + `blockers` |
| `cancelAccountDeletionByToken({token})` | PUBLICA | token do e-mail #13 | `{cancelled:true}` | `code: ["token_invalid"]` |
| `cancelAccountDeletionWithPassword({email,password})` | PUBLICA (rate limit email+IP) | e-mail+senha | `{cancelled:true}` | `_form` "E-mail ou senha invalidos."; `code: ["not_pending"]`; `code: ["rate_limited"]` |
- Codigos de bloqueio (`blockers`): `active_subscription`, `last_owner_with_members`, `platform_admin`, `no_password`.
- `login` (web) durante a janela, com senha correta: `errors = {_form:[msg com a data], code:["account_deletion_pending"], scheduledFor:[ISO]}` e NENHUM cookie; o front deve oferecer "Cancelar exclusao" (`cancelAccountDeletionWithPassword`) e depois logar. Login mobile: `403 {error:{code:"account_deletion_pending"}}`.
- Rotas que o front precisa criar e liberar no `proxy.ts` (publicas): `/conta/excluir/[token]` (confirmar) e `/conta/excluir/cancelar/[token]` (cancelar). Os e-mails ja apontam para elas.

### Verificacao 054a (VERIFIED, banco `leadforge_054_test`)
`npx tsc --noEmit` limpo; `npm run lint` 0 erros (18 warnings preexistentes); `npx vitest run` 153 arquivos / 1919 testes passando.
| Criterio | Status | Evidencia |
|---|---|---|
| Pedido -> confirmacao -> #13 -> janela -> purga -> #14 uma vez | PASS | `account-deletion.test.ts` (confirmacao; purga; concorrentes; idempotencia) |
| Cancelar na janela mantem tudo intacto | PASS | "por link do e-mail" |
| Nenhuma org sem owner; varias orgs so perdem memberships | PASS | "owner unico", "virar owner unico durante a janela", purga com 3 orgs |
| Login/sessoes invalidos apos confirmar/purgar | PASS | sessao antiga rejeitada; login web/mobile bloqueado; login pos-purga recusado |
| Retencao coincide com o e-mail #14 | PASS | "retencao: ... texto do e-mail coincide" |
| Token uso unico/expirado/reuso; so hash; sem vazamento em log | PASS | testes de pedido/confirmacao |
| Provider de e-mail falhando nao impede a exclusao | PASS | "provider de e-mail falhando" |
| Migration aditiva; nenhum banco dropado/resetado | PASS | `migrate diff` sem diferenca; dev nao tocado |

### Limitacoes / riscos conhecidos (054a)
- Se o processo cair entre o commit da anonimizacao e o envio do #14, o e-mail se perde (o e-mail original ja nao existe; padrao 052 "reserva antes, sem retry").
- Rate limits em memoria (D-049-14). Org em que o usuario era unico membro e que nao tem `Subscription` fica ativa e sem membros (nao ha fluxo 053/033 para ela). Registros de cobranca nao tem job de descarte aos 5 anos.
- Plano de cortesia (assinatura `active` sem `cancelAtPeriodEnd`) bloqueia o unico membro: precisa de cancelamento manual/suporte.
- Org com notificacao aos demais owners ("fulano saiu") nao e enviada aqui (escopo da SPEC-056); fica apenas o `OrgAuditLog` `member_left` com `meta.reason = "account_deleted"`.

## Implementation Notes — 054b (frontend, 2026-10-10)
- **Arquivos novos:** `src/components/account/{DeleteAccountPanel.tsx,DeletionTokenLanding.tsx,deletion-format.ts,deletion-landing-state.ts,account-deletion-ui.test.tsx}`; `src/app/(app)/configuracoes/conta/{page,loading}.tsx`; `src/app/conta/excluir/[token]/page.tsx`; `src/app/conta/excluir/cancelar/[token]/page.tsx`; `src/proxy.test.ts`. **Alterados:** `src/proxy.ts` (libera `/conta/excluir/*`), `src/components/settings/SettingsTabs.tsx` (aba "Conta", todos os papéis), `src/components/auth/LoginForm.tsx` (trata `account_deletion_pending`). Nenhuma alteração de backend.
- **Tela (Configurações > Conta):** RHF + `zodResolver(requestAccountDeletionSchema)` (mesmo schema da action, padrão SPEC-042/045), `PasswordInput`/`Field`. Estados `none` (passos + listas Apagado/Anonimizado/Retido lidas de `retention.ts`, mesma fonte do e-mail #14 e da purga; formulário de senha), bloqueios (`blockers` mostrados com título por código + mensagem do servidor; formulário oculto), `awaiting_confirmation` ("Confira seu e-mail", validade, "Cancelar pedido", reenviar com senha), `scheduled` ("Exclusão agendada para DD/MM/AAAA" + "Cancelar exclusão"). Erros: senha -> campo; `rate_limited`/`blocked` -> alerta geral (sem códigos técnicos); `already_scheduled` -> `router.refresh()`.
- **Páginas públicas:** abrir o link só faz `previewAccountDeletionToken` (GET nunca consome o token); a ação exige clicar no botão. Cada rota aceita só o seu tipo de token (tipo trocado = inválido, genérico). Estados: confirm, cancel, sucesso (agendada/cancelada), `token_invalid` (genérico: inválido/expirado/usado), erro (rate limit). `referrer: no-referrer`, `robots: noindex`; foco movido para o resultado, `role=alert/status` + `aria-live`.
- **Login:** com `errors.code = account_deletion_pending` mostra a data (`scheduledFor`) e o botão "Cancelar exclusão e entrar": chama `cancelAccountDeletionWithPassword` com o e-mail+senha já digitados e, em seguida, repete o `login`. Não há página separada de "cancelar com e-mail+senha" (o login cobre o caso).
- **Datas:** DD/MM/AAAA em UTC (mesmo fuso da mensagem do servidor e dos e-mails).
- **Limitação conhecida:** após confirmar, as sessões são encerradas (054a), então o estado `scheduled` na tela de Configurações só aparece em casos raros (sessão criada depois do agendamento); `cancelAccountDeletion` (sessão) retorna `not_pending` nesse estado e a tela orienta a usar o link do e-mail ou o login. O fluxo real de cancelamento é pelo link do e-mail #13 e pelo login.
- **Responsividade/a11y/dark mode:** mobile-first (listas empilhadas, 3 colunas só em `md+`, botões largos no mobile, abas já com scroll horizontal), tokens do design system (`warning`, `destructive`, `success`, `primary`) que têm variantes dark; labels ligados por `htmlFor`, `aria-invalid/describedby`, `aria-busy` nos botões. Não validado em navegador real (só SSR/typecheck).

### Verificação 054b (VERIFIED, banco `leadforge_054_test`)
`npx tsc --noEmit` limpo; `npm run lint` 0 erros (18 warnings preexistentes); `npx vitest run` 155 arquivos / 1933 testes passando (14 novos: `account-deletion-ui.test.tsx` + `proxy.test.ts`).
| Critério (item 9 da SPEC) | Status | Evidência |
|---|---|---|
| Explicação do que acontece / apagado-anonimizado-retido | PASS | "none: explica a janela..." |
| Bloqueios (owner único etc.) | PASS | "bloqueios: mostra titulo + mensagem..." |
| Senha com RHF+zod | PASS | schema compartilhado; campo `delete-account-password` renderizado |
| Estado "exclusão agendada para DD/MM" + Cancelar exclusão | PASS | "scheduled: ..." |
| Página pública confirmar/cancelar via token (rotas liberadas no proxy) | PASS | `proxy.test.ts`; `loadDeletionLandingState`; SSR dos estados |
| Login com `account_deletion_pending` | PASS (código) / NOT VERIFIED (interação) | fluxo implementado em `LoginForm`; teste SSR só cobre o estado inicial |
