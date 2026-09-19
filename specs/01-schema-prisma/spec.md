# SPEC-001 — Schema Prisma corrigido e migrations
- status: IMPLEMENTED | domain: backend | sessao: 1 | ordem: 2 | depende de: SPEC-000

## Objetivo
Schema valido (`prisma validate`), com relacoes/FKs completas e estado de sequencia no lead.

## Problemas do schema do PROMPT
1. `Campaign.whatsappInstance WhatsAppInstance?` sem @relation; `WhatsAppInstance.campaign Campaign?` sem FK, e `campaignId` duplicado. Correcao: relacao 1 instancia : N campanhas, FK so em Campaign; remover `campaignId` de WhatsAppInstance.
2. `MessageTemplate` sem back-relation `steps SequenceStep[]`.
3. `Lead` sem `campaignId` (telas filtram por campanha).
4. Sem estado de resposta/pausa: adicionar em Lead.
5. `Touch` sem direcao (inbound de resposta), agendamento, erro, id externo.
6. Anotacoes (tela de detalhe) sem modelo -> `LeadNote`.
7. Strings livres para status/canal/etapa -> enums [D3].
8. Sem indices, sem onDelete, sem unique Opportunity(lead,campaign).
9. `Campaign.templates` e `MessageTemplate.campaignId` ok, mas Sequence global vs template por campanha: um step so pode usar template da mesma campanha (validar na aplicacao).
10. Generator `prisma-client-js` pode ser deprecado no Prisma 7 (`prisma-client`); seguir docs da versao de D1.
11. `EmailAccount.encryptedPassword`: definir cifra (AES-256-GCM com chave ENCRYPTION_KEY) — detalhado em SPEC-010.

## Schema proposto (delta principal; demais models como no PROMPT + indices)
```prisma
enum CampaignStatus { active paused archived }
enum Channel { email whatsapp linkedin phone }
enum SequenceStatus { not_started active paused_replied completed opted_out }   // estado no Lead
enum TouchStatus { pending scheduled sent delivered failed skipped replied }
enum TouchDirection { outbound inbound }
enum Stage { novo_lead contactado em_followup interessado reuniao_agendada fechado perdido }
enum WaStatus { disconnected connecting connected }

model Campaign {
  ...
  whatsappInstanceId String?
  whatsappInstance   WhatsAppInstance? @relation(fields: [whatsappInstanceId], references: [id], onDelete: SetNull)
  @@index([userId]) @@index([status])
}
model WhatsAppInstance {  // sem campaignId
  ...
  campaigns Campaign[]
}
model MessageTemplate { ... steps SequenceStep[] }   // SequenceStep.template onDelete: Restrict
model Lead {
  campaignId String
  campaign   Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  sequenceStatus   SequenceStatus @default(not_started)
  currentStepOrder Int      @default(0)
  nextTouchAt      DateTime?
  repliedAt        DateTime?
  optedOutAt       DateTime?
  timezone         String   @default("America/Sao_Paulo")
  notes LeadNote[]
  @@unique([campaignId, email]) @@unique([campaignId, phone])   // dedupe (nulos permitidos)
  @@index([campaignId, sequenceStatus, nextTouchAt])   // consulta do scheduler
}
model Touch {
  direction   TouchDirection @default(outbound)
  scheduledAt DateTime?
  externalId  String?      // id msg Evolution / messageId SMTP
  error       String?
  repliedAt   DateTime?
  @@index([leadId, createdAt]) @@index([status, scheduledAt])
  @@unique([leadId, stepId])  // idempotencia do scheduler
}
model LeadNote { id, leadId(FK cascade), body, createdAt }
model Opportunity { ... @@unique([leadId, campaignId]) @@index([campaignId, stage]) }
model WebhookEvent { id, source, eventId? @unique, payload Json, processedAt?, createdAt }  // idempotencia SPEC-012
```
Regra: Lead.sequenceStatus e Opportunity.stage sao independentes: resposta pausa sequencia (paused_replied) e move stage para `interessado` (ou conforme D4); opt-out -> opted_out + stage perdido.

## Escopo
Schema, migration inicial, seed (1 user admin, 1 ICP, 1 campanha, 1 sequencia 0/2/5/7/10, ~20 leads), types de dominio em `src/lib/domain/` (labels PT-BR, cores por stage/canal vindas do PROMPT).
## Fora do escopo
Queries de tela, auth.
## Criterios de aceite
- [x] `npx prisma validate` OK; `prisma migrate dev` gera migration sem erro (requer Postgres; se docker indisponivel, usar `prisma validate` + `migrate diff --from-empty --to-schema --script` e marcar migrate como PENDENTE).
- [x] Todas as relacoes bidirecionais presentes; nenhum campo relacional sem @relation.
- [x] Enums cobrem os 7 stages e 4 canais do PROMPT.
- [x] Seed idempotente (rodar 2x nao duplica).
- [x] `npm run typecheck` passa com o client gerado.
## Seguranca
Senha de EmailAccount nunca em texto puro; Lead.rawData sem segredos.
## Decisoes pendentes
D3 (enums vs String), D4 (resposta -> stage automatico?), D6 (lead pertence a 1 campanha; ok?), D1.

## Adendo (decisao do usuario)
`WhatsAppInstance.provider` enum `WhatsAppProviderKind { evolution cloud_api }` default `evolution`, para provider plugavel (SPEC-011).

## Implementation Notes
- Arquivos: prisma/schema.prisma, prisma/migrations/20260919042438_init, prisma/seed.ts, prisma/seed.test.ts, src/lib/domain/{index.ts,domain.test.ts}, docker-compose.yml (porta host 5434), .env/.env.example (DATABASE_URL porta 5434).
- Testes (VERIFIED): prisma validate, migrate dev, db seed x2, typecheck, lint, vitest (5 passed, incl. idempotencia do seed contra Postgres real).
- Criterios: todos PASS (validate; migrate aplicado; relacoes bidirecionais; 7 stages/4 canais; seed idempotente; typecheck).
- Decisoes: Meeting ganhou leadId (FK) pois Lead.meetings[] exigia back-relation; WhatsAppInstance.status virou enum WaStatus; Meeting.status segue String (nao especificado); Opportunity.position (D12); seed usa IDs fixos + upsert.
- Limitacoes: postgres local do host ocupa 5432/5433, container mapeado em 5434; seed.test.ts depende do Postgres ativo.

## Adendo (autorizado pelo usuario) - StageHistory e seed realista
- Nova tabela `StageHistory` (id, opportunityId FK Cascade, fromStage Stage?, toStage Stage, changedAt default now; indices [opportunityId, changedAt] e [toStage, changedAt]). Migration `stage_history`.
- `prisma/seed.ts` estendido (IDs fixos + upsert, idempotente): Touches outbound/inbound, Meetings e StageHistory coerentes com stage/sequenceStatus, datas relativas a `now` deterministicas por indice. Assinatura: `seed(prisma, now = new Date())`.
- Leads que responderam (interessado/reuniao/fechado) ficam `paused_replied` (fechado deixou de ser `completed`).
- Testes: idempotencia 2x, coerencia do historico. `vitest` com `fileParallelism: false` (testes compartilham o mesmo banco).

## Adendo (autorizado pelo usuario) - Opportunity.lostReason
- Novo campo `Opportunity.lostReason String?` (motivo de perda, max 500 validado na action). Migration `opportunity_lost_reason`. Ver SPEC-007.
