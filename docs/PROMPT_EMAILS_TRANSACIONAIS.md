# Prompt: e-mails transacionais completos (padrão SaaS)

Como usar: cole o bloco "PROMPT" abaixo no Claude Code deste projeto. Ele aciona o `project-orchestrator`, que cria as
SPECs em DRAFT (sem implementar) e devolve as perguntas em aberto. Só depois de você aprovar (`APROVAR SPEC-XXX`) os
agentes `dev-backend` / `dev-frontend` implementam e o `qa-reviewer` revisa.

Diagnóstico escrito em 2026-10-10, lido do código (não executado ponta a ponta com e-mail real).

---

## Diagnóstico: o que existe hoje

Infra pronta (SPEC-046/048): `sendSystemEmail(to, subject, {html,text}, scenario)` com cadeia ACS → Resend → SMTP,
remetente por cenário, nunca lança, templates em `src/lib/channels/email/templates/`.

| Momento do usuário | E-mail hoje | Onde | Observação |
|---|---|---|---|
| Cadastro na app (`/signup`) | **Não existe** | n/a | Só há "boas-vindas" de conta de cortesia criada pelo admin (`courtesy_welcome`). Usuário que se cadastra sozinho não recebe nada. |
| Confirmação de e-mail / verificação | **Não existe** | n/a | Não há campo `emailVerified` no `User`. |
| Recuperação de senha | Existe | `password-reset.ts` | OK. |
| Convite para organização | Existe | `org-invite.ts` (SPEC-049) | OK. |
| Início do trial | **Não existe** | n/a | Só o `subscription_success` com `status: trialing` (ver abaixo). |
| Pagamento aprovado / assinatura ativa | Existe, parcial | `subscription-success.ts` | Dispara em **todo** evento de billing com status `active` ou `trialing` (`process-event.ts:101`). Não distingue ativação inicial, renovação mensal, recuperação de pagamento ou simples atualização. **Risco de e-mail duplicado ou com texto errado: a verificar.** |
| Cobrança mensal debitada (renovação) | **Não existe** de forma explícita | n/a | Pode sair "por acaso" pelo item acima. Sem recibo/comprovante com valor, data, método e período. |
| Falha de pagamento | Parcial | `billing-reminder.ts` (`past_due_started`) | Sai pelo job diário, não no instante da falha, e só 1 aviso. Sem régua de cobrança (dunning). |
| Trial acabando | Existe | `billing-reminder.ts` (`trial_ending`, 3 dias) | OK. |
| Conta suspensa por falta de pagamento | Existe | `billing-reminder.ts` (`auto_suspended`) | OK. |
| Aviso de expurgo de dados | Existe | `billing-reminder.ts` (`purge_warning`, dia 75 de 90) | OK. |
| Assinatura cancelada | Existe | `subscription-canceled.ts` | Dispara no evento `canceled` do provedor. |
| **Pedido de cancelamento** feito pelo usuário | **Não existe tela própria** | n/a | A app só tem `createPortalSession` (portal do provedor). Não há ação "cancelar assinatura" nem e-mail de "recebemos seu pedido; acesso até DD/MM". |
| **Excluir conta / perfil** | **Não existe** | n/a | Não há ação de exclusão de conta/usuário nem e-mail de confirmação. Só o expurgo automático da org (90 dias, SPEC-033). |
| Alteração de senha / e-mail / login suspeito | **Não existe** | n/a | Sem e-mail de segurança. |
| Membro removido / saiu de uma organização | **Não existe** | n/a | SPEC-049 não notifica. |
| Troca de plano (upgrade/downgrade) | **Não existe** | n/a | |
| Cartão expirando / método de pagamento | **Não existe** | n/a | |
| Preferências / descadastro de e-mails de produto | Parcial | descadastro só para outreach (SPEC-010) | Transacional não precisa de opt-out, mas e-mails de produto/marketing precisariam. |

## Catálogo alvo (o que um SaaS maduro envia)

Prioridade **P0** = obrigatório para operar cobrança com segurança; **P1** = esperado; **P2** = depois.

| # | Cenário | Gatilho | Remetente | Prio |
|---|---|---|---|---|
| 1 | Boas-vindas ao cadastrar | signup concluído | support | P0 |
| 2 | Verificar e-mail (link com token de uso único e expiração) | signup | noreply | P1 |
| 3 | Início do trial (data de fim, o que acontece depois) | trial criado | billing | P0 |
| 4 | Pagamento confirmado / assinatura ativada | 1ª cobrança aprovada | billing | P0 |
| 5 | **Recibo da mensalidade** (valor, data, método final do cartão/PIX, período, nº do pedido) | cada renovação aprovada | billing | P0 |
| 6 | **Falha na cobrança** (imediato) + régua: D+0, D+3, D+5, D+7 com link para atualizar o pagamento | evento `payment.failed` | billing | P0 |
| 7 | Pagamento recuperado | evento `payment.recovered` | billing | P1 |
| 8 | Próxima cobrança em N dias (renovação anual e PIX) | job diário | billing | P1 |
| 9 | Troca de plano (upgrade/downgrade, novo valor, quando vale) | mudança de plano | billing | P1 |
| 10 | **Pedido de cancelamento recebido** ("acesso até DD/MM", como reverter) | usuário pede cancelar | billing | P0 |
| 11 | Cancelamento efetivado + retenção de 90 dias + como reativar | fim do período | billing | P0 |
| 12 | Reativação confirmada | usuário reativa | billing | P1 |
| 13 | **Solicitação de exclusão de conta** (confirmação com link, janela de arrependimento) | usuário pede excluir | noreply | P0 (LGPD) |
| 14 | **Conta excluída** (o que foi apagado/anonimizado, o que fica por obrigação legal) | exclusão concluída | noreply | P0 (LGPD) |
| 15 | Senha alterada / e-mail alterado (para o endereço antigo e o novo) | ação do usuário | noreply | P1 |
| 16 | Novo login em dispositivo desconhecido | login | noreply | P2 |
| 17 | Convite aceito / membro removido / saiu da organização (para os owners) | SPEC-049 | noreply | P1 |
| 18 | Cartão expirando | 30/7 dias antes | billing | P2 |

## PROMPT

```
Você está no projeto LeadForge (/Users/thiagomorgado/Desktop/LeadForge_web). Use o fluxo Spec-Driven do projeto:
acione o agente `project-orchestrator`. NÃO implemente código agora: crie as SPECs em status DRAFT (próximo número
livre em specs/, padrão das SPECs 046/048/049), atualize specs/README.md e termine listando as perguntas em aberto.

OBJETIVO
Completar os e-mails transacionais do ciclo de vida do usuário e da assinatura, no padrão de SaaS maduros, sobre a
infra que já existe (SPEC-046/048: `sendSystemEmail`, cadeia ACS → Resend → SMTP, remetente por cenário, templates em
src/lib/channels/email/templates/). Leia docs/PROMPT_EMAILS_TRANSACIONAIS.md (diagnóstico e catálogo alvo) e confirme
o diagnóstico no código antes de escrever: src/lib/billing/process-event.ts, reminders.ts, pix-renewal.ts,
status-map.ts, provider.ts, src/lib/actions/{auth,billing,org}.ts, prisma/schema.prisma (User, Subscription,
BillingReminderLog, Organization.purgedAt) e src/lib/billing/purge.ts. Se o diagnóstico divergir do código, o código vence.

LACUNAS A COBRIR (ordem de prioridade)
P0
 1. Boas-vindas no cadastro (hoje só existe para conta de cortesia).
 3/4/5. Início do trial, pagamento confirmado e RECIBO de cada mensalidade debitada (valor, data, método, período).
    Hoje `subscription_success` dispara em TODO evento com status active/trialing: separe ativação inicial,
    renovação, recuperação e update, com idempotência por evento (nunca e-mail duplicado em reentrega de webhook).
 6. Falha de cobrança no instante do evento `payment.failed` + régua de cobrança D+0/D+3/D+5/D+7 antes da suspensão
    (hoje só 1 aviso pelo job diário), com link para atualizar o pagamento.
 10. Pedido de cancelamento recebido: criar também a AÇÃO de cancelar assinatura na app (hoje só há o portal do
     provedor), com cancelamento ao fim do período vs imediato (pergunte), e o e-mail "recebemos, acesso até DD/MM".
 11. Cancelamento efetivado (revisar o template atual) e 12 reativação.
 13/14. Exclusão de conta/perfil: criar a ação (hoje não existe) com confirmação por e-mail (token de uso único,
     expiração), janela de arrependimento, e-mail de "solicitação recebida" e de "conta excluída" explicando o que é
     apagado/anonimizado e o que é retido por obrigação legal (LGPD). Resolver o caso de dono único de organização
     com outros membros (SPEC-049: nunca deixar org sem owner) e de usuário em várias orgs.
P1
 2. Verificação de e-mail; 7 pagamento recuperado; 8 aviso de próxima cobrança; 9 troca de plano;
 15 senha/e-mail alterados (avisar o endereço antigo); 17 eventos de organização para owners.
P2
 16 login em dispositivo novo; 18 cartão expirando.

REGRAS TÉCNICAS (obrigatórias nas SPECs)
 - Tudo passa por `sendSystemEmail` (nunca importar provider direto); novos cenários entram em `EmailScenario` e nas
   três tabelas de remetente (Resend e ACS), reusando noreply/support/billing.
 - Best-effort: e-mail nunca derruba nem reverte a transação de billing/auth (mesmo padrão de `notifyOwners`).
 - Idempotência: padrão do `BillingReminderLog` (insert com `@@unique` como reserva ANTES de enviar). Nenhum e-mail
   duplicado por reentrega de webhook, retry de job ou clique duplo.
 - Destinatário: owners da org para cobrança; o próprio usuário para conta/segurança; respeitar a org ativa (SPEC-049).
 - Templates: PT-BR, versão HTML e texto, mesmo layout (`templates/layout.ts`), sem dado sensível (nunca senha, token
   completo em log, nº de cartão além dos 4 últimos), todo link absoluto a partir de `APP_BASE_URL`.
 - Segurança: tokens só em hash, uso único, expiração curta; anti-enumeração em fluxos públicos; rate limit; nenhum
   e-mail que revele se uma conta existe.
 - Provedor de pagamento: funciona com mock, Stripe e AbacatePay (PIX é cobrança avulsa com renovação controlada
   pelo LeadForge, SPEC-047); o recibo e a régua devem cobrir cartão e PIX.
 - LGPD: base legal por e-mail (transacional não exige opt-out; e-mail de produto/marketing exige), registro do que
   foi enviado, e a exclusão de conta deve cobrir os dados de e-mail/logs.
 - Testes: template (snapshot de assunto/corpo), cenário→remetente, idempotência sob reentrega, falha do provider não
   propaga, e e-mail correto por tipo de evento. Nunca chamar provedor real (mocks).
 - Respeite AGENTS.md (Next.js com breaking changes) e a regra de não dropar/resetar bancos; migrations aditivas
   escritas à mão (o banco de dev `leadforge` tem drift antigo: nunca `prisma migrate dev` nele).

ENTREGA
 Divida em SPECs coerentes (sugestão: A) ciclo de assinatura e cobrança [3,4,5,6,7,8,9]; B) cancelamento e reativação
 [10,11,12]; C) exclusão de conta e LGPD [13,14]; D) cadastro, verificação e segurança [1,2,15,16]; E) e-mails de
 organização [17]; cartão expirando [18] fica como P2). Para cada SPEC: objetivo, contexto lido do repo (com
 arquivo:linha), escopo, fora do escopo, critérios de aceitação, riscos e perguntas em aberto (Q-0NN-x). Não aprove
 nada: aguarde `APROVAR SPEC-XXX`.

PERGUNTAS QUE VOCÊ DEVE TRAZER RESPONDIDAS OU EM ABERTO
 - Cancelar: ao fim do período ou imediato? Há reembolso proporcional?
 - Excluir conta: soft ou hard delete? Prazo de arrependimento? O que a lei obriga a reter (notas/recibos)?
 - Recibo: basta e-mail com os dados ou precisa de PDF/nota fiscal? Quem emite?
 - Régua de cobrança: datas e número de tentativas por provedor (cartão vs PIX).
 - Verificação de e-mail bloqueia o acesso ou só o checkout?
 - Idioma único (pt-BR) ou preparar para en?
```

## Decisões que você precisa tomar (resumo)

1. **Cancelamento:** ao fim do período pago (padrão de mercado) ou imediato? Com reembolso proporcional?
2. **Exclusão de conta:** soft ou hard delete, e quantos dias de arrependimento?
3. **Recibo:** só e-mail com os dados, ou PDF/nota fiscal (precisa de emissor)?
4. **Régua de cobrança:** mesmas datas para cartão e PIX?
5. **Verificação de e-mail:** bloqueia o uso ou só o checkout?
