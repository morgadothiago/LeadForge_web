# SPEC-011 — WhatsApp (provider plugavel; Evolution como 1a implementacao)
- status: DRAFT | domain: fullstack | sessao: 2 | ordem: 12 | depende de: SPEC-001, SPEC-005, SPEC-000 (docker)
## Escopo
**Decisao do usuario (2026-09-19): trocar de provider deve ser facil (risco de banimento Baileys).** Todo o app fala SO com a interface `WhatsAppProvider` (`src/lib/whatsapp/provider.ts`): `createInstance`, `getQr`, `getStatus`, `sendText`, `parseWebhook(request) -> InboundMessage | StatusEvent | null`, `verifyWebhook(request)`. Implementacao `EvolutionProvider` em `src/lib/whatsapp/providers/evolution.ts`; registro `getWhatsAppProvider(instance.provider)` por factory. Nenhum import de Evolution fora de `providers/`. `WhatsAppInstance.provider` (enum: evolution | cloud_api | ...) define qual usar. Webhook (SPEC-012) chama `provider.parseWebhook`, nunca formato Evolution direto. Trocar = novo arquivo em `providers/` + valor no enum, sem tocar scheduler/webhook/UI.
Backend: client Evolution tipado (Zod nas respostas) — criar instancia, obter QR, status, `sendText` com delay 1-3s; regras: horario 8h-18h no fuso do lead (funcao pura `isWithinSendWindow(lead.timezone, now)`), validacao BR, sem envio fora da janela (reagenda `scheduledAt`). Webhook token por instancia gerado (`webhookToken`). apiKey da instancia cifrada.
Frontend: Configuracoes > WhatsApp: listar instancias, criar, exibir QR (polling de status), vincular a campanha (SPEC-005).
## Criterios de aceite
- [ ] Interface `WhatsAppProvider` + factory; teste com provider fake prova que scheduler/webhook funcionam sem Evolution.
- [ ] grep: nenhum import de `providers/evolution` fora da factory.
- [ ] Client testado com fetch mockado (sucesso, 4xx, timeout).
- [ ] `isWithinSendWindow` testada (limites 07:59, 08:00, 17:59, 18:00, fusos diferentes, DST).
- [ ] Envio fora da janela nao chama a API e reagenda.
- [ ] Teste ponta a ponta com Evolution real: PENDENTE (docker/colima parado; requer QR/telefone real).
- [ ] build/lint/typecheck OK.
## Riscos
Baileys nao-oficial: risco de banimento do numero; recomendar aquecimento e limites. Cold outreach sujeito a LGPD.

## Regra transversal: HTTP/429
Aplicar as regras de HTTP de saida e rate limit de specs/README.md (client Evolution): axios com interceptor, tratamento de 429 com `Retry-After`/backoff, testes de 429/5xx/timeout.
