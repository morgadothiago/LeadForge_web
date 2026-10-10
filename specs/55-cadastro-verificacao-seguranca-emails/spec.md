# SPEC-055 — E-mails de cadastro, verificacao de e-mail e seguranca da conta
- status: DRAFT | domain: fullstack (## Backend, ## Frontend) | depende de: 038, 046, 048, 052 (`sendOnce`) | catalogo: #1 (P0), #2 (P1), #15 (P1); #16 login em dispositivo novo (P2) so registrado como futuro

## Objetivo
Enviar boas-vindas ao usuario que se cadastra sozinho, verificar o e-mail (token uso unico) e avisar sobre alteracoes de seguranca (senha/e-mail alterados) - incluindo o endereco antigo.

## Contexto (lido no repo)
- Signup: `signUpAndStartCheckout` (`src/lib/actions/billing.ts:88-137`) cria User+Org+Membership+Subscription e `createSession` sem enviar e-mail; `signUpAndJoin` (`org.ts:451`) idem; `createOrganization` (`org.ts:125`) cria org extra (nao deve gerar boas-vindas de conta). So existe `courtesy_welcome` (`courtesy-welcome.ts`, SPEC-040, conta criada pelo admin, remetente support).
- Nao existe `emailVerified`/`emailVerifiedAt` em `User` (`schema.prisma:195-219`). Nao ha fluxo de verificacao; checkout self-service e login funcionam sem verificar.
- Reset de senha (SPEC-038): `forgotPassword` (`auth.ts:86`) anti-enumeracao + `resetPassword` (`auth.ts:123`) invalida sessoes via `sessionsInvalidatedAt` (`require-user.ts:29-53`), token em hash/expira 24h (D-038-1, `PasswordResetToken`). `resetPassword` NAO envia e-mail de "senha alterada".
- Nao existe tela/acao de alterar senha, e-mail ou perfil logado (grep `changePassword|updateProfile|changeEmail` em `src/` sem resultados; configuracoes tem agentes/assinatura/email/equipe/integracoes/supressao/whatsapp). Logo #15 para "e-mail alterado" depende de CRIAR a funcionalidade (Q-055-4); "senha alterada" cobre ao menos o reset existente.
- Login e login mobile (`auth.ts:34`, `src/app/api/mobile/v1/auth/login/route.ts`) nao registram dispositivo/IP conhecido para #16.
- Rate limit de signup por IP (`signupLimiter`, `billing.ts:~92`); anti-enumeracao: duplicate email retorna mensagem generica (`billing.ts:~118-125`) - o e-mail de boas-vindas NUNCA deve ser enviado/omitido de forma que revele conta existente.

## Escopo proposto
## Backend
1. Boas-vindas (#1, support): disparado APOS commit do signup (e `signUpAndJoin`), best-effort, idempotente `welcome:<userId>` via `sendOnce`; nao em `createOrganization`. Conteudo: proximos passos, link do app, suporte, data do fim do trial (coordenar com SPEC-052 item 5, Q-052-6).
2. Verificacao de e-mail (#2, noreply): colunas aditivas `User.emailVerifiedAt DateTime?`; `EmailVerificationToken { userId, email, tokenHash @unique, expiresAt, usedAt }` (padrao `PasswordResetToken`); acao de reenvio com rate limit + cooldown; rota de confirmacao; usuarios EXISTENTES: backfill (marcar como verificados? Q-055-2). Efeito do nao-verificado: Q-055-1 (D5 do doc).
3. Seguranca (#15, noreply): e-mail "senha alterada" no `resetPassword` (e em eventual troca de senha logado) para o proprio endereco, com orientacao "nao foi voce"; e-mail "e-mail alterado" para o endereco ANTIGO (e confirmacao ao novo) - so se a troca de e-mail for criada (Q-055-4). Sem dado sensivel, sem link que de acesso direto.
4. Cenarios novos: `welcome`, `email_verification`, `password_changed`, `email_changed` em `EmailScenario` e nas tabelas Resend/ACS (support/noreply).
5. Testes: boas-vindas uma vez por usuario (retry/duplo submit); nenhum e-mail em signup com e-mail ja existente (anti-enumeracao); token de verificacao uso unico/expira/reuso/hash; reenvio com rate limit; "senha alterada" no reset; falha do provider nao quebra signup/reset; snapshots de template.
## Frontend
6. Banner/estado "verifique seu e-mail" + botao reenviar + pagina de confirmacao (conforme Q-055-1); RHF+zod; a11y. Tela de alterar senha/e-mail apenas se Q-055-4 = criar.

## Fora do escopo
- #16 login em dispositivo desconhecido (P2: exige modelo de dispositivo/IP/geolocalizacao); MFA; e-mails de marketing/produto e preferencias de descadastro (exigem base legal e opt-out - SPEC propria); social login.

## Criterios de aceitacao
- Signup novo envia 1 boas-vindas; e-mail ja cadastrado nao envia nada e responde igual a antes; reenvios/duplo clique nao duplicam.
- Verificacao conforme decisao Q-055-1; token so hash, uso unico, expiracao curta.
- Reset de senha envia aviso "senha alterada" ao proprio usuario; nenhum e-mail revela existencia de conta.
- `tsc`, lint, vitest verdes; migration aditiva a mao.

## Seguranca / riscos
- Enumeracao de contas por diferenca de e-mail/tempo de resposta; token em log; spam de reenvio (rate limit por usuario+IP). Bloquear acesso de usuarios existentes por falta de verificacao e risco de churn (backfill). Mudanca de e-mail e fluxo sensivel (confirmacao dupla).

## Decisoes pendentes
- Q-055-1 (D5 do doc): verificacao de e-mail bloqueia o uso do app, so o checkout/pagamento, ou apenas avisa? (Recomendacao a validar pelo usuario: bloquear so checkout/convites/envios de campanha.)
- Q-055-2: usuarios ja existentes: marcar como verificados via backfill ou exigir verificacao?
- Q-055-3: boas-vindas e "inicio do trial" (SPEC-052) em um e-mail so?
- Q-055-4: criar tela/acao de alterar senha e e-mail do perfil nesta SPEC (hoje nao existem) ou so cobrir o reset?
- Q-055-5: idioma unico pt-BR ou preparar i18n (en) nos templates agora? (hoje tudo pt-BR; recomendacao: so pt-BR)
- Q-055-6: usuarios convidados via `signUpAndJoin` com token de convite: o clique no convite conta como e-mail verificado?
