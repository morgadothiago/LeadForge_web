# SPEC-010 — Envio de email (Nodemailer)
- status: APPROVED (usuario, 2026-09-19: "pode fazer") | domain: backend (+ tela de config: frontend) | sessao: 2 | ordem: 11 | depende de: SPEC-001, SPEC-006, SPEC-008
## Escopo
`src/lib/channels/email.ts`: transport por EmailAccount, `sendEmail(touch)` com render de template, atualiza Touch (sent/failed, externalId=messageId, error). Cifra AES-256-GCM da senha (ENCRYPTION_KEY). Tela Configuracoes > Email (cadastro, teste de conexao `transporter.verify()`). Rodizio/limite diario por conta [D15]. Link/rodape de descadastro e header List-Unsubscribe (LGPD). Deteccao de resposta por IMAP fora do escopo desta SPEC (D16: polling IMAP? webhook de provedor?).
## Criterios de aceite
- [ ] Testes unitarios com transport mockado (jsonTransport/stream): envio ok e falha atualizam Touch.
- [ ] Senha nunca aparece em logs/respostas; decifra so no envio (teste).
- [ ] Limite diario respeitado.
- [ ] Teste real SMTP: PENDENTE se sem credenciais (registrar; nao e testavel na sessao).
- [ ] build/lint/typecheck OK.
## Decisoes (fechadas com as recomendacoes, usuario autorizou seguir)
- D15: limite diario POR CONTA, campo `EmailAccount.dailyLimit` (default 50, aquecimento), contado pelos Touches email `sent` do dia (fuso America/Sao_Paulo); rodizio entre contas ativas do usuario; sem capacidade -> reagenda `scheduledAt` para o proximo dia util, nao falha.
- D16: deteccao de resposta por e-mail FORA desta SPEC (IMAP/webhook em SPEC futura); nesta so o envio. Registrar como limitacao: respostas por e-mail nao pausam a sequencia ainda (resposta via WhatsApp pausa, SPEC-012).
- Descadastro: link assinado (HMAC com ENCRYPTION_KEY/AUTH_SECRET, sem PII) para Route Handler PUBLICO em `/api/webhooks/unsubscribe/[token]` (ja isento do proxy), marca lead `optedOutAt` + sequenceStatus opted_out, pagina simples PT-BR; header `List-Unsubscribe` + `List-Unsubscribe-Post`; rate limit 429 + Retry-After no handler (ver regra transversal).
- Erros SMTP (EAUTH, ECONNECTION, ETIMEDOUT, EENVELOPE, EMESSAGE, 4xx/5xx SMTP) normalizados em `AppError` PT-BR (src/lib/errors.ts), sem vazar credencial/host interno; Touch.error guarda mensagem curta sanitizada.
- Config: `ENCRYPTION_KEY` (32 bytes base64) obrigatoria so quando se usa e-mail; AES-256-GCM com IV aleatorio por senha e versao de chave no payload.

## Backend (implementado, sessao 2; status segue APPROVED ate o frontend fechar)
### Contrato
- Env: `ENCRYPTION_KEY` (32 bytes base64, `openssl rand -base64 32`; `getEncryptionKey()` em `src/lib/env.ts` valida so quando usada, erro claro). `APP_BASE_URL` opcional (fallback `AUTH_URL`) para o link de descadastro.
- Schema (migration `email_account_settings`): `EmailAccount.fromName?`, `dailyLimit Int @default(50)`, `lastVerifiedAt?`, `lastError?`; `Touch.emailAccountId?` (FK SetNull, indice) para contar envios por conta (campo NAO previsto no texto da SPEC, necessario para D15).
- Cifra `src/lib/crypto/secret-box.ts`: `encrypt(plain, key?)`/`decrypt(payload, key?)`, AES-256-GCM, payload `v1:iv:tag:cipher` (base64), IV aleatorio de 12 bytes por segredo.
- `src/lib/channels/email.ts`: `sendEmail(touchId, {now?, transport?, createTransport?}) -> {status:'sent',messageId,accountId} | {status:'already_sent'} | {status:'skipped',reason:'opted_out'|'sequence_completed'} | {status:'deferred',nextAt} | {status:'failed',error:AppError}`; nunca lanca por falha SMTP (grava Touch `failed` + `error` <=200 chars sanitizado). `pickEmailAccount(userId, now) -> {status:'ok',account} | {status:'deferred',nextAt} | {status:'no_account'}`; rodizio = menos envios no dia, empate = menos recente. Dia = America/Sao_Paulo (UTC-3 fixo); adiado vira `scheduled` com `scheduledAt` = dia seguinte 08:00 SP. `normalizeSmtpError` (`smtp-errors.ts`): EAUTH nao-retryable; ECONNECTION/ESOCKET/ETIMEDOUT e 4xx retryable; EENVELOPE, 5xx nao.
- Mensagem: texto puro, rodape PT-BR + headers `List-Unsubscribe: <url>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Descadastro `src/lib/channels/unsubscribe.ts`: token `base64url({l:leadId,e:exp}).base64url(HMAC-SHA256)`, validade 180 dias, segredo = HMAC(ENCRYPTION_KEY, "leadforge:unsubscribe:v1") (derivado de ENCRYPTION_KEY, nao AUTH_SECRET), comparacao timing-safe. Rota publica `GET|POST /api/webhooks/unsubscribe/[token]` (GET so confirma; POST/one-click efetiva, idempotente; invalido -> 400 PT-BR; 429 + Retry-After: 10/min por token, 600/min global quando o IP e "unknown" e 30/min por IP quando `TRUSTED_PROXY_IP_HEADER` esta definido). Isenta do proxy (matcher exclui `api/webhooks`, confirmado).
- Actions (`src/lib/actions/email.ts`): `createEmailAccount`, `updateEmailAccount` (senha vazia mantem), `deleteEmailAccount`, `setActive`, `testEmailConnection` (verify, timeout 15s, retorna `{ok,message}` e grava lastVerifiedAt/lastError). Queries: `listEmailAccounts`, `getEmailAccount` -> `EmailAccountView` com `hasPassword`, sem senha. E-mail duplicado = erro no campo `email`.
### Criterios
- Transport mockado envio ok/falha atualiza Touch: PASS (`src/lib/channels/email.test.ts`). Senha fora de logs/respostas/queries, decifra so no envio: PASS. Limite diario: PASS. SMTP real: PENDENTE (sem credenciais). build/lint/typecheck: PASS.
### Limitacoes
- Rate limit em memoria por processo; sem `TRUSTED_PROXY_IP_HEADER` o IP e "unknown" (limite so por token + teto global 600/min). Existe o estado `sending` com reserva atomica (ver hardening abaixo), que impede envio concorrente duplicado. Reagendamento e para o dia seguinte 08:00 (nao pula fim de semana). Trocar ENCRYPTION_KEY invalida senhas gravadas e links emitidos. Respostas por e-mail nao detectadas (D16).

## Implementation Notes (hardening 2026-09-19)
- Envio duplicado: `TouchStatus.sending` + `Touch.updatedAt` (migration `20260919055047_touch_status_sending`). `sendEmail` reserva atomicamente via `updateMany` (status in pending/scheduled/failed, ou `sending` com `updatedAt` < 15 min atrás = recuperação de crash, `SENDING_STALE_MS`); count=0 => `already_sent`. Todos os desfechos saem de `sending`; exceção inesperada => `failed` (try/finally). `failed` foi mantido reservável para preservar o reenvio existente (desvio do pedido literal pending/scheduled). `sending` não conta como enviado (queries contam `sent`/`delivered`/`replied`); nenhum Record<TouchStatus> exigiu mudança.
- Descadastro: IP "unknown" não limita por IP; limita por token (10/min) + teto global (600/min). Com IP confiável: 30/min por IP + 10/min por token. 429 via `tooManyRequests` (JSON PT-BR + Retry-After). Configurar `TRUSTED_PROXY_IP_HEADER` atrás de proxy (documentado em .env.example).
- Testes: concorrência (Promise.all => 1 envio), falha/exceção fora de sending, crash recuperável, 100 IPs unknown não se bloqueiam, mesmo token limitado, POST idempotente. Limitação: limiter em memória por processo.

## Limitacoes
- Duplicidade residual: se `sendMail` tem sucesso mas o `update` do Touch para `sent` falha, o Touch vai a `failed` e o retry reenvia o e-mail; um crash apos o envio com o Touch em `sending` ha mais de 15 min (`SENDING_STALE_MS`) tambem reenvia.
- Rate limit do descadastro em memoria por processo (reinicia no deploy; nao compartilhado entre instancias). Teto de 10.000 chaves; chave por token so para token com assinatura valida.
- D16 (deteccao de resposta por IMAP/webhook) fora do escopo.
- SMTP real NAO testado (so jsonTransport/streamTransport e falha de conexao local).
- SSRF em `testEmailConnection`/envio: mitigado (2026-09-19) resolvendo o DNS e bloqueando IPs internos antes de conectar, conectando no IP checado (`tls.servername` = host original); `ALLOW_PRIVATE_SMTP_HOSTS=true` libera (default false). Risco residual: IP publico que responde apenas a portas/servicos alheios (port scanning por porta arbitraria de SMTP) continua possivel.

## Implementation Notes (QA fixes 2026-09-19)
- Migrations do zero: banco temporario `leadforge_migtest` no Postgres do Docker, `prisma migrate deploy` aplicou as 7 migrations com sucesso (VERIFIED); banco dropado. A migration `email_account_settings` NAO contem `passwordHash` (o achado nao se confirmou); nenhuma migration alterada.
- Anti-SSRF: `src/lib/channels/ssrf.ts` (`resolvePublicHost`, `isBlockedIp`; bloqueia 0/8, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, multicast, ::1, ::, fc00::/7, fe80::/10, ff00::/8, IPv4-mapeado). `buildTransport` agora e async e conecta no IP checado. Mensagem: "Host nao permitido: aponta para rede interna.". Env `ALLOW_PRIVATE_SMTP_HOSTS` (.env.example). Testes de e-mail usam a env = true; `ssrf.test.ts` cobre o bloqueio.
- Header injection: schema Zod rejeita CR/LF/U+2028/U+2029 em fromName, e-mail, host, imapHost e provider. Testes com `streamTransport` (MIME cru; jsonTransport nao serializa cabecalhos) para subject, fromName e destinatario.
- Rate limit: teto `MAX_KEYS`=10.000; varredura periodica (10s) em vez de por requisicao; lotado -> varre expiradas (max 1/s), descarta a mais antiga NAO bloqueada (scan <=100); se todas bloqueadas, IP novo recebe 429 de 1s. Chave por token so apos verificar a assinatura (token invalido nao consome memoria nem conta no limite por token; segue contando no IP/global). Token valido com mapa lotado e aceito sem contar (descadastro e obrigacao legal).
- Cobertura de sessao: `src/lib/actions/email-auth-coverage.test.ts` (cada action/query sem sessao + teste estatico de `requireUser`).

### Criterios de UI
- [x] Item "Configuracoes" na navegacao (Sidebar + drawer mobile) -> `/configuracoes` (redireciona a `/configuracoes/email`), abas E-mail e WhatsApp "em breve" (desabilitado): PASS (typecheck/build; visual NAO verificado no navegador).
- [x] Lista de contas (e-mail, provedor, host:porta, remetente, limite, ativa/inativa, status da verificacao), estado vazio, loading.tsx, "Nova conta": PASS (build).
- [x] Dialog criar/editar com presets Gmail/Outlook/Zoho/Outro, senha mostrar/ocultar, nunca pre-preenchida, dica de senha de app, limite diario com texto de aquecimento, erros por campo e `_form`: PASS (build); interacao NAO verificada no navegador.
- [x] Acoes: testar conexao (toast + aria-live), ativar/desativar, editar, excluir com ConfirmDialog e erro `_form`: implementado; NAO exercitado contra SMTP/BD real.
- [x] Aviso LGPD/descadastro e limitacao D16 na pagina.
- [x] Guarda do proxy: sem cookie `/configuracoes/email` -> 307 `/login?next=...` (VERIFIED com `next start`).
- [x] Testes vitest dos presets/formatacao (`src/components/settings/email-presets.test.ts`); suite 212/212, tsc e lint limpos, build OK.
### Implementation Notes
- Arquivos: `src/components/settings/{email-presets.ts,email-presets.test.ts,SettingsTabs.tsx,EmailAccountFormDialog.tsx,EmailAccountList.tsx}`, `src/app/(app)/configuracoes/{layout,page}.tsx`, `.../email/{page,loading}.tsx`, `src/components/layout/nav-items.ts`.
- Cards responsivos em todas as larguras (nao ha tabela separada no desktop); Server Component na pagina, `use client` so em lista/acoes/dialog/abas.
- Limitacoes: verificacao visual em 375/768/1280 e teste SMTP real PENDENTES.
