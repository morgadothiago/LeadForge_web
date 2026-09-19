# n8n com o LeadForge (opcional)

> AVISO: a integracao com n8n NAO foi testada contra um n8n real. Os workflows JSON passam so em validacao estatica (testes vitest); a importacao e a execucao no n8n 1.82 estao PENDENTES. Se a importacao reclamar de algum parametro, ajuste o no na interface do n8n e exporte de novo.

## Para que serve
O n8n e OPCIONAL. Sem ele o sistema funciona igual: agende o tick com cron do host, Vercel Cron ou `npm run tick` (ver `docs/CONFIGURACAO_POS_PROJETO.md`). Com n8n voce pode:
1. Disparar `POST /api/cron/tick` a cada minuto (workflow `n8n/workflows/tick.json`).
2. Postar leads de qualquer fonte em `POST /api/integrations/leads` (exemplo em `n8n/workflows/ingest-leads-example.json`).

## Subir
```bash
docker compose up -d n8n     # requer N8N_ENCRYPTION_KEY no .env (o compose recusa subir sem ela)
```
A UI fica em `http://localhost:5678`. No primeiro acesso crie o usuario OWNER. O n8n usa banco proprio (`n8n`) no mesmo Postgres.
Dentro do container o LeadForge e alcancado por `LEADFORGE_URL` (default `http://host.docker.internal:3000`, ja mapeado no compose via `extra_hosts`). Em producao defina `LEADFORGE_URL` com a URL publica (https) do app.

## Credenciais (Header Auth)
No n8n: Credentials > New > "Header Auth". Crie DUAS credenciais, com estes NOMES exatos (os workflows referenciam por nome):
| Nome | Header Name | Header Value |
|---|---|---|
| `LeadForge CRON_SECRET` | `Authorization` | `Bearer <valor do CRON_SECRET>` |
| `LeadForge INGEST_SECRET` | `Authorization` | `Bearer <valor do INGEST_SECRET>` |
Os JSON nunca contem segredo. Apos importar, abra cada no HTTP Request e confirme que a credencial correta esta selecionada.

## Importar os workflows
n8n > Workflows > Import from File: `n8n/workflows/tick.json` e/ou `ingest-leads-example.json`. Ambos entram INATIVOS; ative o do tick depois de conferir a credencial.
- Tick: Schedule Trigger (1 min) -> HTTP Request POST `{{ $env.LEADFORGE_URL }}/api/cron/tick`. Se `$env` nao estiver acessivel nos nos (`N8N_BLOCK_ENV_ACCESS_IN_NODE`), troque a URL por um valor fixo.
- Ingestao: Manual -> Code (troque `campaignId` e a fonte de dados) -> HTTP Request em lotes de ate 100 leads. O no tem retry (4 tentativas, 5 s); em 429 o `Retry-After` indica quanto esperar (o retry fixo do n8n nao le esse header: para volumes altos, mantenha lotes pequenos ou aumente `waitBetweenTries`). O cabecalho `Idempotency-Key` evita duplicar lote reenviado.

## Endpoint de ingestao (resumo)
Ligar: `INTEGRATION_LEADS_ENABLED=true` + `INGEST_SECRET` (32+ chars) no `.env` e reiniciar o app. Desligado = 503. Contrato completo em `specs/14-n8n-integracao/spec.md`.

## Frequencia do tick
1 minuto e o recomendado (cada rodada tem orcamento de ~25 s e max. 20 envios; ver `.env.example`). 2 minutos e aceitavel; menos que 1 min nao ajuda (ha lock contra rodadas concorrentes).

## Protecao do n8n
- Crie o usuario owner com senha forte no primeiro acesso.
- NAO exponha a porta 5678 na internet (nem via port-forward). Acesse por localhost, VPN ou proxy reverso com autenticacao e HTTPS.
- Guarde `N8N_ENCRYPTION_KEY` fora do git: perde-la torna as credenciais salvas ilegiveis.
- Use segredos diferentes para tick (`CRON_SECRET`) e ingestao (`INGEST_SECRET`); rotacione-os se vazarem (atualize a credencial no n8n e o `.env`).
