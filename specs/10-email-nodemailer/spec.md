# SPEC-010 — Envio de email (Nodemailer)
- status: DRAFT | domain: backend (+ tela de config: frontend) | sessao: 2 | ordem: 11 | depende de: SPEC-001, SPEC-006, SPEC-008
## Escopo
`src/lib/channels/email.ts`: transport por EmailAccount, `sendEmail(touch)` com render de template, atualiza Touch (sent/failed, externalId=messageId, error). Cifra AES-256-GCM da senha (ENCRYPTION_KEY). Tela Configuracoes > Email (cadastro, teste de conexao `transporter.verify()`). Rodizio/limite diario por conta [D15]. Link/rodape de descadastro e header List-Unsubscribe (LGPD). Deteccao de resposta por IMAP fora do escopo desta SPEC (D16: polling IMAP? webhook de provedor?).
## Criterios de aceite
- [ ] Testes unitarios com transport mockado (jsonTransport/stream): envio ok e falha atualizam Touch.
- [ ] Senha nunca aparece em logs/respostas; decifra so no envio (teste).
- [ ] Limite diario respeitado.
- [ ] Teste real SMTP: PENDENTE se sem credenciais (registrar; nao e testavel na sessao).
- [ ] build/lint/typecheck OK.
## Decisoes pendentes
D15, D16.
