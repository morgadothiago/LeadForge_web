# LeadForge — Prompt para Continuação do Projeto

## Contexto

Plataforma **SDR/Closer/Follow-up com CRM** para uso interno de agência. A IA busca leads na internet, faz prospecção multicanal (cold email, LinkedIn, WhatsApp via Evolution API) e follow-up automatizado até o lead responder. Quando responde, o usuário assume manualmente.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend + Backend | Next.js 16 full-stack (App Router + Server Actions) |
| Banco de dados | PostgreSQL + Prisma ORM |
| UI | Tailwind CSS v4 + shadcn/ui |
| WhatsApp | Evolution API (self-hosted, Docker) |
| Automação | n8n |
| Email | Nodemailer (SMTP) |
| Animações | Framer Motion |

**IMPORTANTE:** Toda instalação npm deve usar `--legacy-peer-deps` por causa do React 19.

## O que ja foi feito

Projeto em `/Users/thiagomorgado/leadforge` com Next.js 16.3.5, TypeScript, Tailwind e dependencias base instaladas. shadcn/ui parcialmente inicializado.

## Fluxo do Sistema

1. Usuario cria campanha (ex: "Sites para Advogados") com ICP e sequencia de follow-up
2. IA busca leads na internet (Google Maps, LinkedIn, sites) todo dia
3. Sistema dispara primeiro toque automaticamente (email/WhatsApp/LinkedIn)
4. Se nao responder, follow-up automatico segue a sequencia (dia 0, 2, 5, 7, 10...)
5. Quando responder -> sequencia pausa -> usuario assume no CRM
6. Usuario move lead no kanban ate fechar ou perder

## Design System — Inspirado no Coest Studio (coest.me)

### Paleta de Cores (Dark Mode First)

#### Fundos
| Token CSS | Hex | Uso |
|-----------|-----|-----|
| `--background` | `#0a0e11` | Fundo principal |
| `--card` | `#131619` | Superficie de cards |
| `--muted` | `#1a1d21` | Fundo muted |
| `--sidebar-background` | `#111417` | Sidebar |

#### Primaria (Teal-Green)
| Token CSS | Hex | Uso |
|-----------|-----|-----|
| `--primary` | `#1fb390` | Botoes, links, acoes |
| `--primary-hover` | `#1a9e7e` | Hover |
| `--primary-foreground` | `#0a0e11` | Texto sobre primary |

#### Texto
| Token CSS | Hex | Uso |
|-----------|-----|-----|
| `--foreground` | `#e9ecec` | Texto principal |
| `--muted-foreground` | `#747b82` | Texto secundario |
| `--destructive` | `#dc2626` | Erros, deletar |

#### Status Kanban
| Status | Hex |
|--------|-----|
| Novo Lead | `#3b82f6` |
| Contactado | `#eab308` |
| Em Follow-up | `#f97316` |
| Interessado | `#22c55e` |
| Reuniao Agendada | `#a855f7` |
| Fechado | `#16a34a` |
| Perdido | `#dc2626` |

#### Canais de Comunicacao
| Canal | Hex |
|-------|-----|
| Email | `#3b82f6` |
| WhatsApp | `#25D366` |
| LinkedIn | `#0077B5` |
| Telefone | `#a855f7` |

### Tipografia

| Fonte | Pesos | Uso |
|-------|-------|-----|
| **Space Grotesk** | 400, 500, 600, 700 | Headings, titulos, numeros grandes |
| **Inter** | 300, 400, 500, 600, 700 | Body text, labels, UI, inputs |

- Tamanho base: 16px
- Escala: 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72px
- Line height: 1.5 para body, 1.2 para headings

### Bordas e Radius

| Token | Valor | Uso |
|-------|-------|-----|
| `--radius` | `0.5rem` (8px) | Base radius |
| Menor | `0.375rem` (6px) | Botoes, inputs |
| Compacto | `0.25rem` (4px) | Badges, tags |
| Grande | `0.75rem` (12px) | Cards, modais |
| Extra | `1rem` (16px) | Elementos destacados |
| Pill | `9999px` | Botoes capsule |

### Sombras e Efeitos

- Cards: `shadow-lg` com opacidade sutil
- Hover cards: `shadow-xl` + `translate-y(-2px)` (elevacao)
- Botoes: `shadow-md` no hover
- Glassmorphism: `backdrop-blur-md bg-card/80` para modais e overlays
- Transicoes: `transition-all duration-200 ease-out` em todos os elementos interativos

### Padroes de Componentes

#### Sidebar
- Fundo: `#111417` com borda direita `#202226`
- Logo no topo (fonte Space Grotesk 700, cor `#1fb390`)
- Itens com hover `#202226`, ativo com fundo `#1fb390` opacity 10%
- Icones: Lucide React, tamanho 20px
- Texto: Inter 500, 14px, cor `#bcc4c7` (inativo) ou `#e9ecec` (ativo)

#### Cards de Metricas (Dashboard)
- Fundo `#131619`, borda `#202226`, radius 12px
- Titulo: Inter 400, 13px, cor `#747b82`
- Valor: Space Grotesk 700, 28px, cor `#e9ecec`
- Indicador de tendencia: seta + porcentagem (verde `#22c55e` ou vermelho `#dc2626`)

#### Tabela de Leads
- Header: fundo `#1a1d21`, borda inferior `#202226`
- Rows: fundo transparente, hover `#131619`
- Texto: Inter 400, 14px
- Status badges: pill com cor do status + fundo 10% opacity da cor

#### Pipeline Kanban
- Colunas: fundo `#0a0e11` com borda `#202226`
- Header da coluna: nome + contagem + cor do status
- Cards: fundo `#131619`, borda `#202226`, radius 8px, padding 16px
- Drag: `opacity-50` + `scale-105` no card arrastado
- Drop zone: borda pontilhada `#1fb390`

#### Botoes
- Primario: fundo `#1fb390`, texto `#0a0e11`, hover `#1a9e7e`
- Secundario: fundo transparente, borda `#202226`, texto `#e9ecec`
- Ghost: fundo transparente, texto `#747b82`, hover `#1a1d21`
- Perigo: fundo `#dc2626`, texto `#fafafa`

#### Inputs
- Fundo: `#0a0e11`
- Borda: `#202226`
- Focus: borda `#1fb390` + ring `#1fb390` opacity 20%
- Texto: Inter 400, 14px, cor `#e9ecec`
- Placeholder: cor `#747b82`

### Animações

- Fade in: `opacity-0 -> opacity-100` com `duration-300`
- Slide up: `translate-y-4 -> translate-y-0` com `duration-300`
- Scale: `scale-95 -> scale-100` em modais
- Cards: `hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200`
- Loading skeleton: shimmer com `animate-pulse` + gradiente `#131619` -> `#1a1d21`

## Schema Prisma Completo

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  name      String
  email     String   @unique
  role      String   @default("admin")
  avatarUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  campaigns      Campaign[]
  emailAccounts  EmailAccount[]
}

model IcpProfile {
  id          String   @id @default(uuid())
  name        String
  niche       String
  location    String?
  companySize String?
  signals     String[]
  keywords    String[]
  sources     String[]
  desiredData String[]
  createdAt   DateTime @default(now())
  campaigns Campaign[]
}

model Campaign {
  id          String   @id @default(uuid())
  name        String
  description String?
  status      String   @default("active")
  icpId       String
  icp         IcpProfile @relation(fields: [icpId], references: [id])
  sequenceId  String?
  sequence    Sequence?  @relation(fields: [sequenceId], references: [id])
  whatsappInstanceId String?
  whatsappInstance   WhatsAppInstance?
  userId      String
  user        User       @relation(fields: [userId], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  leads        Lead[]
  opportunities Opportunity[]
  templates    MessageTemplate[]
}

model Lead {
  id        String   @id @default(uuid())
  name      String
  company   String?
  email     String?
  phone     String?
  website   String?
  linkedin  String?
  source    String?
  score     Float    @default(0)
  tags      String[]
  rawData   Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  touches       Touch[]
  opportunities Opportunity[]
  meetings      Meeting[]
}

model Sequence {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  steps SequenceStep[]
  campaigns Campaign[]
}

model SequenceStep {
  id         String   @id @default(uuid())
  sequenceId String
  sequence   Sequence @relation(fields: [sequenceId], references: [id])
  day        Int
  channel    String
  templateId String
  template   MessageTemplate @relation(fields: [templateId], references: [id])
  order      Int
  touches Touch[]
  @@unique([sequenceId, order])
}

model Touch {
  id        String   @id @default(uuid())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id])
  stepId    String?
  step      SequenceStep? @relation(fields: [stepId], references: [id])
  channel   String
  status    String   @default("pending")
  sentAt    DateTime?
  content   String?
  createdAt DateTime @default(now())
}

model Opportunity {
  id        String   @id @default(uuid())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id])
  campaignId String
  campaign  Campaign @relation(fields: [campaignId], references: [id])
  stage     String   @default("novo_lead")
  value     Float?
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  meetings Meeting[]
}

model Meeting {
  id              String   @id @default(uuid())
  opportunityId   String
  opportunity     Opportunity @relation(fields: [opportunityId], references: [id])
  scheduledAt     DateTime
  duration        Int      @default(30)
  calendarEventId String?
  status          String   @default("scheduled")
  createdAt       DateTime @default(now())
}

model WhatsAppInstance {
  id           String   @id @default(uuid())
  instanceName String   @unique
  number       String
  status       String   @default("disconnected")
  webhookToken String
  apiKey       String?
  campaignId   String?
  campaign     Campaign?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model EmailAccount {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  provider        String
  imapHost        String?
  smtpHost        String
  port            Int      @default(587)
  email           String   @unique
  encryptedPassword String
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
}

model MessageTemplate {
  id         String   @id @default(uuid())
  campaignId String
  campaign   Campaign @relation(fields: [campaignId], references: [id])
  channel    String
  name       String
  subject    String?
  body       String
  createdAt  DateTime @default(now())
}
```

## Docker Compose

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: leadforge
      POSTGRES_USER: leadforge
      POSTGRES_PASSWORD: leadforge123
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  evolution:
    image: atendai/evolution-api:latest
    ports:
      - "8080:8080"
    environment:
      - SERVER_URL=http://localhost:8080
      - AUTHENTICATION_API_KEY=sua-chave-evolution
      - DATABASE_ENABLED=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://leadforge:leadforge123@postgres:5432/leadforge
      - DATABASE_CONNECTION_CLIENT_NAME=leadforge
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_SAVE_MESSAGE_UPDATE=true
      - DATABASE_SAVE_DATA_CONTACTS=true
      - DATABASE_SAVE_DATA_CHATS=true
      - WEBHOOK_GLOBAL_ENABLED=true
      - WEBHOOK_GLOBAL_URL=http://host.docker.internal:3000/api/webhooks/whatsapp
      - WEBHOOK_GLOBAL_BY_EVENTS=true
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DELAY_MESSAGE=1200
      - DELAY_MESSAGE_TYPING=1000
    volumes:
      - evolution_store:/evolution/store

  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=leadforge123
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=leadforge
      - DB_POSTGRESDB_USER=leadforge
      - DB_POSTGRESDB_PASSWORD=leadforge123
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  pgdata:
  evolution_store:
  n8n_data:
```

## Variaveis de Ambiente (.env)

```env
DATABASE_URL=postgresql://leadforge:leadforge123@localhost:5432/leadforge
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=sua-chave-evolution
EVOLUTION_WEBHOOK_SECRET=secret-webhook
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha-app
NEXTAUTH_SECRET=secret-qualquer
NEXTAUTH_URL=http://localhost:3000
```

## Integracao WhatsApp — Evolution API

### Criar instancia
```
POST /instance/create
{
  "instanceName": "leadforge-main",
  "number": "5511999999999",
  "integration": "WHATSAPP-BAILEYS",
  "qrcode": true,
  "webhook": {
    "url": "http://localhost:3000/api/webhooks/whatsapp",
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
  }
}
```

### Enviar mensagem
```
POST /message/sendText/{instanceName}
{
  "number": "5511988887777",
  "text": "Ola {{name}}, tudo bem? Vi que a {{company}}...",
  "delay": 1200
}
```

### Webhook recebido
```json
{
  "event": "messages.upsert",
  "instance": "leadforge-main",
  "data": {
    "key": { "remoteJid": "5511988887777@s.whatsapp.net", "fromMe": false },
    "pushName": "Joao da Silva",
    "message": { "conversation": "Ola, tenho interesse!" }
  }
}
```

### Regras WhatsApp
- Delay 1-3s entre mensagens
- So enviar entre 8h-18h no fuso do lead
- Se lead responder -> pausar sequencia automatica
- Detectar opt-out ("parar", "sair", "nao quero") -> marcar como perdido
- Validar formato BR: 55+DDD+9+numero

## Telas Prioritarias

### 1. Dashboard
Cards metricas (leads novos, follow-up, respostas, reunioes) + grafico semanal + ultimas atividades

### 2. Pipeline (Kanban)
Colunas com drag and drop: Novo Lead -> Contactado -> Em Follow-up -> Interessado -> Reuniao Agendada -> Fechado/Perdido

### 3. Lista de Leads
Tabela com filtros por campanha, status, canal, score. Busca por nome/email.

### 4. Detalhe do Lead
Ficha completa + timeline de touches + tags + anotacoes + botao mover etapa.

### 5. Campanhas
Criar/editar: nome, ICP vinculado, sequencia de follow-up, instancia WhatsApp.

### 6. Sequences (Builder)
Builder visual de steps: dia X + canal + template. Preview e duplicar.

## Ordem de Implementacao

1. Configurar Docker Compose e rodar PostgreSQL + Evolution API + n8n
2. Criar schema Prisma e rodar migrate
3. Criar lib/prisma.ts (singleton)
4. Configurar design system (cores, fontes, tokens CSS)
5. Criar layout base (sidebar + header)
6. Criar Dashboard com metricas
7. Criar CRUD de Campanhas + ICP
8. Criar CRUD de Sequences
9. Criar Pipeline Kanban
10. Criar lista e detalhe de Leads
11. Integrar envio de email (Nodemailer)
12. Integrar WhatsApp (Evolution API)
13. Criar webhook receiver
14. Integrar n8n para automacao

## Regras de Codigo

1. TypeScript estrito, sem `any`
2. Server Components por padrao, `'use client'` so com necessidade
3. Prisma queries com `include` para evitar N+1
4. Validar com Zod
5. Server Actions para mutations
6. Interface em PT-BR

## Estimativa de Tokens e Tempo

| Tarefa | Tokens | Tempo estimado |
|--------|--------|---------------|
| Docker Compose + .env | ~2k | 2 min |
| Schema Prisma completo | ~3k | 3 min |
| lib/prisma.ts + utils | ~1k | 1 min |
| Design system (cores, tokens) | ~3k | 3 min |
| Layout (sidebar + header) | ~5k | 5 min |
| Dashboard | ~5k | 5 min |
| Campanhas CRUD | ~6k | 6 min |
| Sequences builder | ~5k | 5 min |
| Pipeline Kanban | ~8k | 8 min |
| Leads CRUD | ~6k | 6 min |
| Integracao Email | ~4k | 4 min |
| Integracao WhatsApp/Evolution | ~6k | 6 min |
| Webhook receiver | ~3k | 3 min |
| **TOTAL** | **~57k** | **~57 min** |

### Sobre tempo por sessao

- Sessao Claude: ~150-200k tokens de output possivel
- **57k tokens estimados = cabe em 1 sessao** com folga
- Tempo real depende da velocidade de geracao do Claude (geralmente 5-10 min por bloco de codigo)
- **Estimativa realista: 1 a 1.5 horas** para completar tudo
- Recomendacao: dividir em 2 sessoes se quiser revisar entre as partes

### Sessao 1 (infra + base)
- Docker Compose, Schema Prisma, Design System, Layout, Dashboard (~19k tokens, ~20 min)

### Sessao 2 (telas + integracoes)
- Campanhas, Sequences, Kanban, Leads, Email, WhatsApp, Webhooks (~38k tokens, ~37 min)
