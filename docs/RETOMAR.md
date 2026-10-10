# Para retomar: o que está pronto, o que está bloqueado e o que depende de você

Criado em 2026-10-10 (noite), antes de você dormir. **Este arquivo é atualizado quando as tarefas em andamento terminam**
(ver "Estado final" no fim). Branch: `feat/specs-048-051`. Repo: git@github.com:morgadothiago/LeadForge_web.git.

## 1. Como conferir o estado em 1 minuto

```bash
git log --oneline -10 && git status --short   # o que foi commitado / o que sobrou
npx tsc --noEmit                              # deve estar limpo
npx prisma migrate status                     # deve dizer "up to date"
```

Ambiente local: Postgres/Redis/Mailpit no Docker (`colima start` se `docker ps` falhar), `npm run dev`, e **`npm run dev:tick`
em outro terminal** (sem ele criativos ficam em "Na fila"). Mailpit: http://localhost:8025.

## 2. Em andamento quando você saiu (resultado na seção "Estado final")

| Tarefa | O que é | Etapas restantes |
|---|---|---|
| SPEC-057 | Sidebar agrupada em seções (Captação de leads, Criativos, Automação, Conta) | dev-frontend → QA |
| SPEC-058a/b | Busca de leads sob demanda (botão "Buscar leads" na campanha): só owner, tetos 2/dia/campanha e 10/dia/org, estado "rodando" persistido | 058a → QA → 058b → QA |

Regra combinada: **só commitar quando tudo estiver verde** (tsc, lint sem erros, vitest em banco `*_test` novo, QA aprovado). Se algo
reprovar no QA e não for corrigível sozinho, fica **sem commit** e listado abaixo.

## 3. Decisões que SÓ VOCÊ pode tomar (bloqueiam trabalho)

| # | Decisão | Bloqueia | Minha recomendação |
|---|---|---|---|
| 1 | Aprovar **SPEC-052b** (falha de cobrança, régua D+3/5/7, recuperação, próxima cobrança, troca de plano) | e-mails de cobrança restantes | Aprovar a parte de PIX/mock já; cartão espera a Q-052-5 |
| 2 | **Q-052-5**: nomes dos eventos de falha/recuperação de cartão do AbacatePay (precisa da doc/sandbox do provedor) | 052b só na parte de cartão | Pesquisar na doc do provedor |
| 3 | Aprovar **SPEC-053** (cancelamento/reativação), **054** (exclusão de conta LGPD), **055** (verificação/segurança de cadastro), **056** (e-mails de organização) | cada uma delas | Responder as 5 decisões de e-mail abaixo |
| 4 | **5 decisões de e-mail**: (a) cancelamento: acesso até fim do período ou imediato? reembolso? (b) exclusão de conta: soft ou hard, em quantos dias? (c) recibo: só e-mail informativo (já assumido) (d) régua de cartão e PIX igual (já assumido) (e) verificação de e-mail: obrigatória antes de usar ou só aviso? | 053-056 | (a) até fim do período, sem reembolso proporcional; (b) soft delete 30 dias e depois purga; (e) obrigatória para enviar mensagens, não para entrar |
| 5 | **Provedor de avatar real** (Q-051-1: HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar) | criativos reais (hoje só mock) | Escolher 1 e abrir SPEC; antes cumprir D-051-15 (SSRF/timeouts) |
| 6 | **Q-051-11**: teto de retentativas dos criativos | ajuste fino | Aceitar o default |
| 7 | **Drift `20260928*`** (CPF/CNPJ, trial, AbacatePay): importar essa feature ou remover as colunas do banco de dev? | limpeza de migrations; o aviso "nunca `migrate dev`" continua até lá | Decidir se a feature existe; se não, remover só no banco de dev, com backup |
| 8 | **Rate limit persistente** (D-049-14): hoje em memória, não vale entre instâncias | produção multi-instância | SPEC própria (Redis/Postgres) antes de escalar |
| 9 | **LLM grátis**: SPEC-036 está aprovada mas **não implementada** (adapter OpenAI-compatível: Groq/OpenRouter/Ollama/Gemini) | agentes de IA sem custo | Implementar a 036 |
| 10 | **Q-052-6**: `trial-started` separado das boas-vindas (SPEC-055) ou um e-mail só? (assumi separado) | 055 | Revisar quando aprovar a 055 |
| 11 | Abrir o **Pull Request** da branch (não abri) | merge | https://github.com/morgadothiago/LeadForge_web/pull/new/feat/specs-048-051 |
| 12 | **Paginação da busca Places** (`nextPageToken`/rotação de keywords): hoje 1 página de até 20 e repetir dá duplicados | qualidade da captação | SPEC separada depois da 058 |

## 4. O que só funciona com você (chaves, contas, navegador)

- **Nenhuma tela logada foi vista em navegador real**: sidebar, criativos, seletor de organização, convites, equipe. Use
  `docs/ROTEIRO_DE_TESTES.md` (blocos A, B, C) e `docs/PRIMEIROS_PASSOS.md`. Falha de isolamento entre tenants é bloqueante.
- **Google Places / Maps**: criar chave (Fase 8 do PRIMEIROS_PASSOS), `LEAD_SEARCH_ENABLED=true`, cadastrar em
  `/configuracoes/integracoes`. A busca nunca rodou com a API real; o SKU cobrado não foi confirmado; defina teto de orçamento no Google.
- **Azure (ACS e Blob), Resend, AbacatePay, Evolution, Claude**: só testados com mocks. Valide o recibo com webhook real/sandbox do
  AbacatePay (campos `amount`, `paidAt`, `card.lastDigits` foram assumidos).
- **Produção (Vercel)**: definir `CRON_SECRET` (cron por minuto já está no `vercel.json`; exige plano pago, no Hobby só 1x/dia),
  `TRUSTED_PROXY_IP_HEADER` (obrigatória em produção), envs de e-mail e storage. Sem `CRON_SECRET` nada avança (sequências, criativos, busca).

## 5. Riscos conhecidos (não bloqueiam, mas não esqueça)

- 052a: se o provedor de e-mail falhar na hora do envio, aquele e-mail **se perde** (chave de idempotência reservada antes; sem retry).
- 052a: o signup espera o envio do e-mail de trial antes de criar a sessão (SMTP lento atrasa o cadastro).
- 052a: `EmailDispatchLog` sem purga; falta teste de integração das actions `signUpAndStartCheckout`/`createOrganization` chamando o trial.
- Troca de plano está **sem e-mail** até a 052b (regressão consciente).
- Termos da Places API restringem cache/armazenamento de dados: confirme antes de operar em escala.
- `.storage/` (arquivos locais) e `.env` não vão para o git (conferido).

## 6. Estado final (preenchido quando as tarefas terminarem)

_Ainda não preenchido: as tarefas da seção 2 estavam rodando. Se esta seção continuar vazia ao acordar, algo travou:
rode a seção 1 e me diga o que o `git status` mostra._
