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
Os JSON nunca contem segredo. Apos importar, abra cada no HTTP Request e RESELECIONE a credencial: os JSON a referenciam so pelo nome (sem id, que so existe depois de criada), e o n8n 1.82.1 falha a execucao com "Found credential with no ID" ate ela ser selecionada de novo no no.

## Importar os workflows
n8n > Workflows > Import from File: `n8n/workflows/tick.json` e/ou `ingest-leads-example.json`. Ambos entram INATIVOS; ative o do tick depois de conferir a credencial.

Pela CLI (`docker compose exec n8n ...`): `n8n import:workflow --input=arquivo.json` FALHA ("workflows.map is not a function"), pois o CLI espera um array. Use um diretorio: `n8n import:workflow --separate --input=<diretorio com os .json>/`.
- Tick: Schedule Trigger (1 min) -> HTTP Request POST `{{ $env.LEADFORGE_URL }}/api/cron/tick`. Se `$env` nao estiver acessivel nos nos (`N8N_BLOCK_ENV_ACCESS_IN_NODE`), troque a URL por um valor fixo.
- Ingestao: Manual -> Code (troque `campaignId` e a fonte de dados) -> HTTP Request em lotes de ate 100 leads. O no tem retry (4 tentativas, 5 s); em 429 o `Retry-After` indica quanto esperar (o retry fixo do n8n nao le esse header: para volumes altos, mantenha lotes pequenos ou aumente `waitBetweenTries`). O cabecalho `Idempotency-Key` evita duplicar lote reenviado.

## Endpoint de ingestao (resumo)
Ligar: `INTEGRATION_LEADS_ENABLED=true` + `INGEST_SECRET` (32+ chars) no `.env` e reiniciar o app. Desligado = 503. Contrato completo em `specs/14-n8n-integracao/spec.md`.

### Comportamento e riscos conhecidos
- Idempotency-Key: a chave guarda um hash SHA-256 do corpo (canonico, ordem de chaves irrelevante). Mesmo corpo = replay (`idempotentReplay: true`); corpo diferente = 422 "Esta chave de idempotencia ja foi usada com outro conteudo.". Reserva `processing` com mais de 2 min (processo caiu) e reassumida na repeticao; dentro de 2 min = 409 + `Retry-After: 1`.
- Campanha ARQUIVADA = 409 ("Campanha arquivada: nao aceita novos leads."). Campanha PAUSADA aceita o lead (entra `not_started`, nada e enviado).
- `name`, `company`, `source`, `externalId` (e URLs) rejeitam caracteres de controle e separadores U+2028/2029: o item vira `invalid`.
- E-mails com `+tag` NAO sao normalizados (mesma semantica de `suppression.ts`): um contato suprimido pode voltar como `x+1@dominio`. Decisao registrada.
- Se a auditoria (`WebhookEvent`) falhar depois de criar leads, a resposta e 200 com o resultado por item e `warnings: ["auditoria_nao_gravada"]` (nao ha 500 escondendo criacao parcial); a chave e liberada e reenviar o lote devolve `duplicate` com o `leadId`, sem recriar.
- RISCO (produto): com `Campaign.autoStart=true`, um lead vindo do endpoint e iniciado e enviado automaticamente, sem revisao humana, no proximo tick. Mantenha `autoStart` DESLIGADO em campanhas alimentadas por n8n e inicie manualmente apos revisar (o endpoint ja cria `not_started`).
- Rate limit e por processo (memoria) e nao ha teto de concorrencia: uso interno apenas.

## Frequencia do tick
1 minuto e o recomendado (cada rodada tem orcamento de ~25 s e max. 20 envios; ver `.env.example`). 2 minutos e aceitavel; menos que 1 min nao ajuda (ha lock contra rodadas concorrentes).

## Protecao do n8n
- Crie o usuario owner com senha forte no primeiro acesso.
- NAO exponha a porta 5678 na internet (nem via port-forward). Acesse por localhost, VPN ou proxy reverso com autenticacao e HTTPS.
- Guarde `N8N_ENCRYPTION_KEY` fora do git: perde-la torna as credenciais salvas ilegiveis.
- Use segredos diferentes para tick (`CRON_SECRET`) e ingestao (`INGEST_SECRET`); rotacione-os se vazarem (atualize a credencial no n8n e o `.env`).
