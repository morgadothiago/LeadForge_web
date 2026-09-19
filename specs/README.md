# LeadForge — Indice de SPECs (SDD)
SPECs 000-008 APPROVED (usuario, 2026-09-19); todas APPROVED (014, 015, 019 com defaults conservadores, revisaveis). Aprovar com `APROVAR SPEC-XXX`. Uma SPEC por vez, na ordem. Toda SPEC de codigo Next 16: ler `node_modules/next/dist/docs/` antes (AGENTS.md).
Fullstack = executa dev-backend primeiro, depois dev-frontend.

| SPEC | Feature | Agente | Sessao | Status | Depende de |
|---|---|---|---|---|---|
| 000 | Setup, versoes, deps, docker, env, prisma.ts | dev-backend | 1 | APPROVED | - |
| 001 | Schema Prisma corrigido + seed | dev-backend | 1 | IMPLEMENTED | 000 |
| 002 | Design system | dev-frontend | 1 | APPROVED | 000 |
| 003 | Layout base | dev-frontend | 1 | APPROVED | 002 |
| 004 | Dashboard | backend+frontend | 1 | APPROVED | 001,003 |
| 005 | Campanhas + ICP | backend+frontend | 1 | APPROVED | 001,003 |
| 006 | Sequences + Templates | backend+frontend | 1 | APPROVED | 001,003,005 |
| 007 | Pipeline Kanban | backend+frontend | 1 | APPROVED | 001,003 |
| 008 | Leads (lista/detalhe) | backend+frontend | 1 | APPROVED | 001,003,007 |
| 009 | Autenticacao | backend+frontend | 2 (antecipar?) | APPROVED | 001,003 |
| 010 | Email Nodemailer | backend (+cfg UI) | 2 | APPROVED | 001,006,008 |
| 011 | WhatsApp Evolution | backend+frontend | 2 | IMPLEMENTED | 001,005 |
| 012 | Webhook receiver | dev-backend | 2 | IMPLEMENTED | 011 |
| 013 | Scheduler follow-up | dev-backend | 2 | IMPLEMENTED | 006,010,011,012 |
| 014 | Integracao n8n | dev-backend | 2/posterior | APPROVED (padrao) | 013 |
| 017 | Politica de envio gentil + anti-banimento + supressao global | backend+frontend | 2 | IMPLEMENTED | 010,011,012 |
| 019 | Agentes de IA (SDR, Follow-up, Closer) configuraveis | backend+frontend | 3 (depois de 013 e 018) | APPROVED (padrao) | 013,017,012,018 |
| 018 | Chaves de API e integracoes pelo painel (Configuracoes) | backend+frontend | 2 (depois de 017/013) | APPROVED | 009,010,011,016 |
| 016 | Erros HTTP/axios em PT-BR (prerequisito de 011-015) | dev-backend | 2 | APPROVED | 000 |
| 015 | Busca de leads por IA | dev-backend | posterior | APPROVED (padrao) | 005,008,014 |

Ordem (sessao 2): 009,010,016 feitos -> 011 -> 012 -> 017 -> 013 -> 014 -> 015. Ordem sessao 1: 000 -> 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 | 009 -> 010 -> 011 -> 012 -> 013 -> 014 -> 015.
Nota: 004 (dashboard) fica antes de 005-008 por ordem do PROMPT; com poucos dados usa seed.

## Decisoes aceitas (2026-09-19)
D1 Prisma 7.x estavel (CLI+client) | D2 DBs separados evolution/n8n | D3 enums | D5 vitest | D6 lead em 1 campanha | D9 ICP reutilizavel | D10 templates por campanha | D11 stage livre | D12 position no kanban | D13 sem CSV agora. D14 sessao propria jose+argon2, login e-mail/senha. D4 resposta WhatsApp move p/ interessado. D17 token por instancia na URL + rotacao. D18 opt-out por mensagem curta exata + alerta de possivel opt-out. Extra: WhatsApp via provider plugavel (SPEC-011).

## Decisoes pendentes (sessao 2)
D1 versao Prisma (7.x estavel p/ CLI e client, ou 8 rc p/ ambos) | D2 DBs separados p/ evolution/n8n | D3 enums vs String | D4 resposta move stage automaticamente? | D5 framework de testes (vitest) | D6 lead em 1 campanha | D8 "resposta"=Touch inbound | D9 ICP 1:1 ou N:1 | D10 templates por campanha ou globais | D11 transicoes de stage livres? | D12 ordem intra-coluna (position) | D13 importacao CSV | D14 auth (Auth.js/propria/nenhuma) e quando | D15 limite diario email | D16 deteccao resposta email | D17 auth do webhook | D18 regra de opt-out | D19 executor do scheduler | D20 papel do n8n | D21-23 busca IA (fontes, LLM, orcamento).

## Limitacoes de validacao
Docker parado: migrate, Evolution, n8n, SMTP nao verificaveis ponta a ponta; SPECs marcam esses criterios como PENDENTE.

## Regras transversais (usuario, 2026-09-19)
**HTTP de saida e rate limit (vale para SPECs 010-015 e qualquer cliente novo):**
- Todo cliente HTTP de saida (Evolution, n8n, provedor de busca/LLM, SMTP-API) usa UMA instancia axios por integracao, com interceptor de resposta que normaliza o erro (status, codigo, mensagem PT-BR, `retryAfter`) sem vazar corpo/headers/segredos.
- 429: respeitar `Retry-After` (segundos ou data HTTP); sem header, backoff exponencial com jitter e teto; maximo de tentativas; so repetir metodo idempotente ou com chave de idempotencia; nunca laco infinito. 5xx/timeout: retry limitado. 4xx (exceto 408/429): nao repetir.
- Endpoints proprios (Route Handlers, ex.: webhook SPEC-012) devolvem 429 + `Retry-After` ao limitar. Server Actions nao controlam status: devolver erro tipado em `ActionResult`.
- Testes obrigatorios por cliente: 429 com e sem `Retry-After`, tentativas esgotadas, 5xx, timeout, sem vazamento de segredo no erro.
- Onde a SPEC citar `fetch`, trocar por axios e registrar o desvio. Adicionar `axios` com `--legacy-peer-deps`.
