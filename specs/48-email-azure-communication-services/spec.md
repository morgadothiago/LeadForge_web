# SPEC-048 — E-mail transacional: Azure Communication Services (ACS Email) como provider
- status: IMPLEMENTED | domain: backend | depende de: 046 (interface `EmailProvider`, `sendSystemEmail`, templates, fallback)

## Objetivo
Usar Azure Communication Services (ACS Email) para o envio de e-mail do sistema. Como a SPEC-046 ja criou a abstracao `EmailProvider` (`src/lib/channels/email/provider.ts`) com adapters `resend` e `smtp`, esta SPEC adiciona um 3o adapter `acs` e define a precedencia/substituicao do provedor atual. Os 5 callsites continuam chamando apenas `sendSystemEmail`; templates e conteudo nao mudam.

## Contexto (verdade-base, lido no repo)
- `sendSystemEmail(to, subject, {html,text}, scenario, opts)` escolhe Resend se `RESEND_API_KEY`, senao SMTP; cai em SMTP em erro/timeout do Resend (D-046-2); nunca lanca.
- Remetente por cenario (`scenario.ts`, D-046-1) via `RESEND_FROM_*`.
- Regra transversal: HTTP de saida usa axios com erro normalizado (README). O SDK `@azure/communication-email` usa pipeline proprio — ver pergunta Q-048-3.
- ACS Email exige: recurso Communication Services + Email Communication Service + dominio verificado (ou dominio gerenciado Azure) conectado ao recurso; envio e assincrono (long-running operation, `beginSend`, com poll de status).

## Escopo proposto
1. Adapter `src/lib/channels/email/providers/acs.ts` (`AcsEmailProvider`) usando `@azure/communication-email` (`EmailClient`), mapeando `{to, subject, html, text, from}` para a mensagem ACS (plainText + html). Erros normalizados para `AppError` PT-BR, sem vazar connection string/chave.
2. Factory (`provider.ts`): nova ordem configuravel por env `EMAIL_PROVIDER=acs|resend|smtp` (ver Q-048-1 para default e fallback). Fallback em erro/timeout (D-046-2) generalizado: provider primario -> secundario(s) configurados, sem duplicar envio (documentar janela de corrida: ACS e assincrono, aceito o pedido = "enviado").
3. Env (`src/lib/env.ts` + `.env.example`): `AZURE_COMMUNICATION_CONNECTION_STRING` (ou `ACS_ENDPOINT` + credencial, Q-048-2), `ACS_FROM_NOREPLY`, `ACS_FROM_SUPPORT`, `ACS_FROM_BILLING` (remetentes por cenario, mesmo racional D-046-1; precisam ser MailFrom do dominio verificado no ACS). Todos opcionais: ausencia = proximo provider.
4. `scenario.ts`: `fromAddressForScenario` passa a resolver remetente conforme o provider ativo.
5. Documentacao em `docs/CONFIGURACAO_POS_PROJETO.md`: criacao do recurso ACS, dominio, DKIM/SPF, MailFrom.
6. Testes: mock do `EmailClient` (nunca chamar Azure real); sucesso, erro, timeout, fallback, ausencia de config, ausencia de vazamento de segredo em erro/log.

## Fora do escopo
- Alterar conteudo/templates/gatilhos dos e-mails (SPEC-046/038/039/040).
- Remover Resend/SMTP do codigo (so muda a precedencia; ver Q-048-1).
- E-mail de campanha/outreach do usuario (conta SMTP por usuario, SPEC-010) — fica como esta (Q-048-4).
- Provisionar recursos no Azure (responsabilidade do usuario).
- Recebimento de e-mail / webhooks de entrega ACS (Event Grid) — possivel SPEC futura.

## Criterios de aceitacao
- Com `EMAIL_PROVIDER=acs` e config valida, os 5 cenarios enviam via ACS (mock) com html+text e remetente correto.
- Config ACS ausente/invalida ou erro/timeout -> fallback conforme Q-048-1, sem lancar e sem duplicar.
- Nenhum segredo em logs/erros. Testes existentes de 046 continuam verdes. `tsc`, lint, vitest verdes.

## Seguranca / riscos
- Connection string e segredo: so server-side, nunca em `NEXT_PUBLIC_*`. Dominio nao verificado no ACS = envio falha (risco operacional, fallback mitiga). Limites de taxa do ACS (throttling) tratados como erro retentavel limitado.

## Decisoes (aprovadas pelo usuario)
- D-048-1 (Q-048-1): ordem por env `EMAIL_PROVIDER`. Default (ausente, ou ACS nao configurado) mantem o comportamento atual Resend -> SMTP. `EMAIL_PROVIDER=acs` + ACS configurado: ACS primario, fallback Resend (se `RESEND_API_KEY`) -> SMTP. `EMAIL_PROVIDER=smtp`: so SMTP.
- D-048-2 (Q-048-2): autenticacao por connection string (`AZURE_COMMUNICATION_CONNECTION_STRING`).
- D-048-3 (Q-048-3): aceito o SDK oficial `@azure/communication-email` (desvio registrado da regra axios).
- D-048-4 (Q-048-4): so e-mail de sistema; SMTP por usuario (SPEC-010) intocado.
- D-048-5 (Q-048-5): remetentes via env `ACS_FROM_NOREPLY/SUPPORT/BILLING` (mesmo agrupamento da D-046-1; cenario sem env especifico cai em `ACS_FROM_NOREPLY`).

## Implementation Notes
- Arquivos: `src/lib/channels/email/providers/acs.ts` (+`acs.test.ts`), `email/provider.ts` (`acsConfigured`, `getEmailProviderChain`, name `"acs"`), `email/scenario.ts` (`providerName` opcional), `channels/system-mail.ts` (loop pela cadeia, remetente por provider), `src/lib/env.ts`, `.env.example`, `docs/CONFIGURACAO_POS_PROJETO.md` (secao 2b), `package.json`/lock (`@azure/communication-email`), testes em `provider.test.ts`, `scenario.test.ts`, `system-mail.test.ts`.
- Decisoes tecnicas: `beginSend` aceito = "enviado" (sem poll de entrega); timeout (default 8s) aplicado a ACS/Resend, nao ao SMTP; erro do ACS vira `AppError` PT-BR sem `cause` (nao vaza connection string); ACS so e usado com `EMAIL_PROVIDER=acs`.
- Limitacoes: sem webhook de entrega/Event Grid; janela de corrida de duplicidade em timeout-mas-aceito (mesma D-046-2); `sendSystemEmail` nao distingue erros retentaveis entre elos.
- ACs: ACS via mock com html+text e remetente correto (acs.test.ts, system-mail.test.ts); fallback sem lancar (system-mail.test.ts); sem segredo em erros (acs.test.ts); testes 046 verdes. Resultados dos checks no relatorio de entrega.
