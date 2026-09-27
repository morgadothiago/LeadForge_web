# SPEC-046 — E-mail transacional: Resend (com fallback SMTP) + templates HTML + 2 cenarios novos
- status: APPROVED (usuario, 2026-09-27) | domain: backend | depende de: 010 (SMTP/Nodemailer), 033 (billing), 037 (identidade visual), 038 (esqueci-senha), 039 (lembretes), 040 (cortesia)

## Objetivo
Hoje `sendSystemEmail` (`src/lib/channels/system-mail.ts`) e SMTP/Nodemailer puro, texto plano, usado em 3 cenarios: esqueci-senha (SPEC-038), lembretes de cobranca (SPEC-039, 4 sub-tipos: trial acabando, inicio do past_due, suspensao automatica, aviso de expurgo) e boas-vindas de conta cortesia (SPEC-040). O usuario quer: (1) trocar/estender para usar Resend (API HTTP) com fallback automatico pro SMTP existente se a chave nao estiver configurada; (2) HTML com a identidade visual da SPEC-037 em vez de texto puro, com fallback de texto no mesmo envio (multipart); (3) 2 cenarios novos que nao existem hoje — confirmacao de assinatura efetuada e confirmacao de assinatura cancelada.

## Contexto (verdade-base, ja levantado, nao repetir exploracao)
- `src/lib/channels/system-mail.ts`: SMTP puro hoje, reaproveita `normalizeSmtpError`/`resolvePublicHost` (anti-SSRF, SPEC-010) — essa logica de seguranca deve ser preservada no adapter SMTP, nao descartada.
- 3 callsites atuais: `src/lib/actions/auth.ts:102` (esqueci-senha), `src/lib/billing/reminders.ts:62` (lembretes), `src/lib/actions/admin/organizations.ts:119` (boas-vindas cortesia).
- 2 cenarios NOVOS, sem callsite hoje: "assinatura efetuada com sucesso" (disparar dentro de `processBillingEvent`, `src/lib/billing/process-event.ts`, SPEC-033, no processamento do evento de checkout bem-sucedido) e "assinatura cancelada" (disparar no mesmo ponto que `status-map.ts` transiciona `Subscription.status` para `canceled`).

## Escopo proposto
1. **Interface `EmailProvider`** (`send({to, subject, html, text})`), mesmo padrao arquitetural ja usado para `PaymentProvider` (D-33-5, trocavel por env): `src/lib/channels/email/provider.ts` (interface + factory por env), `providers/resend.ts` (novo, Resend API/SDK), `providers/smtp.ts` (extrai a logica atual do `system-mail.ts` pra ca, preservando anti-SSRF/`normalizeSmtpError`). `sendSystemEmail` continua sendo a UNICA funcao publica que os 5 callsites chamam — ela escolhe o adapter (Resend se `RESEND_API_KEY` setada, senao SMTP) e nunca deixa de tentar enviar se uma chave faltar/expirar (fallback automatico, nao erro fatal).
2. **Templates HTML** (1 helper por cenario, gera `{html, text}` a partir do mesmo dado, layout simples e consistente: header com logo/cor primaria da SPEC-037, corpo, rodape): `templates/password-reset.ts`, `templates/billing-reminder.ts` (4 variantes internas: trial_ending/past_due_started/auto_suspended/purge_warning), `templates/courtesy-welcome.ts`, `templates/subscription-success.ts` (NOVO), `templates/subscription-canceled.ts` (NOVO). HTML+CSS inline simples (sem MJML/react-email — nao esta no projeto, nao adicionar dependencia pesada so pra isso), responsivo o minimo necessario (largura maxima ~600px, fonte legivel em qualquer cliente de e-mail).
3. **Cenario novo 1 — assinatura efetuada com sucesso**: disparar dentro de `processBillingEvent` (`src/lib/billing/process-event.ts`) quando o evento processado resulta em `Subscription.status` indo para `active`/`trialing` a partir de um estado anterior sem assinatura ativa (checkout inicial) — conteudo: plano assinado, valor, data da proxima cobranca.
4. **Cenario novo 2 — assinatura cancelada**: disparar no mesmo ponto de `status-map.ts` que grava `canceledAt`/transiciona pra `canceled` — conteudo: confirmacao do cancelamento, data ate quando o acesso continua (fim do periodo pago, se aplicavel) e data da retencao/expurgo (90 dias, D-33-4).
5. `.env.example`: `RESEND_API_KEY` (opcional — ausente = fallback SMTP) e `RESEND_FROM_EMAIL` (ver D-046-1, Resend exige remetente de dominio verificado).
6. Testes: mock/fixture do Resend (nunca chamar API real), cobrindo os 5 cenarios (3 existentes + 2 novos) gerando html+text corretos, e o fallback SMTP automatico quando `RESEND_API_KEY` ausente/invalida.

## Fora do escopo
- Mudar o CONTEUDO/regra de negocio dos 3 e-mails ja existentes (so o mecanismo de envio + visual) — datas/valores/condicoes de disparo continuam as mesmas ja aprovadas nas SPECs 038/039/040.
- Configurar de fato o dominio/remetente verificado no Resend — responsabilidade do usuario fora do codigo (ver D-046-1).
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-27)

D-046-1: Remetente POR CENARIO (nao unico) — cada template tem seu proprio `from` verificado no Resend (ex.: cobranca@dominio para lembretes/assinatura, suporte@ ou no-reply@ para esqueci-senha/boas-vindas de cortesia). Configuracao exata de qual e-mail por cenario cabe ao dev-backend propor (`RESEND_FROM_*` por cenario ou um mapa de remetentes), documentando no relatorio — o usuario configura os enderecos reais/verificados no Resend depois, fora do codigo.

D-046-2: Fallback SMTP tambem em ERRO/TIMEOUT do Resend (nao so quando a chave esta ausente) — maximiza a chance do e-mail sair. Implementar com cuidado pra nao duplicar envio (ex.: se o Resend retornar erro DEPOIS de aceitar a requisicao mas antes de confirmar entrega, decidir por timeout curto + fallback, documentando a janela de corrida aceita).

D-046-3: E-mail de "assinatura efetuada com sucesso" dispara em TODA transicao pra `active`/`trialing` com sucesso, incluindo troca de plano (nao so o checkout inicial) — ajustar o gatilho em `processBillingEvent` de acordo.

## Riscos
- Resend e um servico de terceiro novo no projeto — se a chave for invalida/o servico cair, o fallback SMTP (D-046-2) e a rede de seguranca; testar esse caminho e obrigatorio, nao so o caminho feliz do Resend.
- HTML de e-mail tem compatibilidade inconsistente entre clientes (Gmail/Outlook/Apple Mail renderizam CSS de formas diferentes) — usar HTML+CSS inline simples (sem flexbox/grid, tabelas se necessario) reduz esse risco; o `text` (fallback multipart) garante legibilidade minima em qualquer cliente.

## Ordem de execucao
Backend (dev-backend), unica frente (sem UI nova), depois QA. Aprovada, decisoes fechadas — pode implementar direto.
