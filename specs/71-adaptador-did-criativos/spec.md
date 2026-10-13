# SPEC-071 — Adaptador de vídeo com avatar `did` (ou provedor vencedor do spike) para Criativos — backend

- id: SPEC-071
- status: **DRAFT** (aguardando `APROVAR SPEC-071`; **só pode ser aprovada depois de SPEC-070 concluída**) | domain: backend | criada em 2026-10-12 | depende de: 070 (decisão do provedor), 051 (interface/runner/mock), 050 (StoredFile/Blob), 069 (limites/teto de IA por plano; etapa 069a+), 059 (rate limit, se aplicável) | bloqueia: 072
- Origem: recomendação aceita pelo usuário. Onde diz `did`, leia "provedor vencedor da SPEC-070"; se vencer outro, só o nome do arquivo/variáveis muda (a SPEC é reeditada com `APROVAR` novo).
- Classificação: D-071-n = INFERRED. Valores de preço = PLACEHOLDER até conferência na página oficial (SPEC-070). Nenhum código escrito.

## 1. Objetivo
Implementar `DidAvatarVideoProvider` (`src/lib/creatives/providers/did.ts`) cumprindo `AvatarVideoProvider` ao lado do `mock`, selecionável por `CREATIVE_PROVIDER=did`, sem alterar o contrato do runner, e alimentar o custo real do vídeo no teto de IA por plano da SPEC-069.

## 2. Contexto (verdade-base, lido do código)
- `provider.ts`: `listAvatars`, `listVoices`, `estimateCostCents`, `createVideo({idempotencyKey})`, `getStatus`, `fetchVideo` (stream; exige https, allowlist de host, bloqueio de IP privado com pinning via `url-guard.ts`, revalidar redirects ≤ 3, validar `content-type`), `cancel?`, `verifyWebhook?`.
- `config.ts`: `CREATIVE_PROVIDERS = ["mock"]`; em produção, provedor não explícito = erro `config`. `factory.ts` só devolve o mock.
- Runner (`runner.ts`): polling com backoff 5-60 s, `CREATIVE_JOB_MAX_ATTEMPTS` 120, timeout 30 min, lease, compare-and-set, `fail(..., "provider_failed" | "provider_unavailable" | "provider_rejected" | "timeout" | "download" | "storage" | "canceled")`; ao `done` baixa por stream e grava `StoredFile`, e persiste `costActualCents: st.costCents`. Custo está em **`CreativeJob.costEstimateCents`/`costActualCents`** (não em `Creative`; este pedido falava em `Creative.costCents`: manter o do job e expor na view do criativo).
- HTTP de saída: uma instância axios por integração, erro normalizado sem vazar corpo/headers, 429 com `Retry-After`/backoff com jitter, só repetir idempotente (regras transversais do `specs/README.md`).
- Chaves da plataforma: SPEC-069 define o admin como quem configura chaves e o tenant só usa (D-069-7/8: nunca exibida, só `hint`).

## 3. Escopo (Backend)
1. **Adaptador `did`**: `createVideo` (POST talk/clip com roteiro, avatar, voz PT-BR, formato, duração máxima; cabeçalho de idempotência do provedor se existir, senão a defesa do runner: `providerJobId` só é gravado depois da aceitação e `idempotencyKey` único por tentativa; **Q-071-5**), `getStatus` (mapeia estados do provedor para `processing|done|failed`; `rawStatus` curto, sem corpo cru), `fetchVideo` (URL do provedor tratada como não confiável conforme `provider.ts`), `cancel` best-effort (se a API não suportar, no-op documentado), `estimateCostCents` (tabela de preço por segundo em config, PLACEHOLDER), `listAvatars`/`listVoices` (catálogo estático curado PT-BR validado no spike, com cache; sem avatar/voz arbitrários, D-051-3).
2. **Custo real**: `getStatus` `done` devolve `costCents` calculado da resposta do provedor (créditos/segundos consumidos × preço configurado). Se o provedor não informar, usa `estimateCostCents(durationSec real)`. O runner grava em `CreativeJob.costActualCents`.
3. **Teto de IA da SPEC-069**: ao concluir, o custo real é somado ao consumo mensal da org usado pelo teto `maxAiBudgetCentsMonth`/`maxCreativesPerMonth`. **Decisão aberta Q-071-3**: criativos compartilham o teto de IA dos agentes ou têm teto próprio (`maxCreativesPerMonth`, já existente na 069: Free 0, Starter 3, Pro 20)? Recomendação: contagem por `maxCreativesPerMonth` (limite duro, já definido) **mais** custo real registrado para relatório do admin e alerta; teto em R$ próprio só se Q-071-2 exigir. Ao estourar: `plan_limit`/`plan_feature_locked` antes de chamar o provedor (guarda no `submitCreative`, fail-closed, dentro de `lockOrg`), e o runner recusa executar se o plano não permite (defesa em profundidade da 069, sem apagar o criativo).
4. **Configuração**: `CREATIVE_PROVIDERS = ["mock","did"]`; `CREATIVE_PROVIDER=did` exige chave. **Chave só em env** (`DID_API_KEY`, server-side) **ou** `IntegrationSecret` da plataforma configurado pelo admin (Q-071-1); nunca por organização, nunca visível ao tenant, nunca em log/auditoria/erro/`rawStatus`/resposta de action.
5. **Fallback**: em dev/teste (`NODE_ENV !== "production"`) sem `DID_API_KEY`, a factory cai para `mock` com aviso de log sem segredo. **Em produção NÃO há fallback silencioso**: `did` sem chave ou chave inválida = erro tipado `config` ("Geração de criativos indisponível no momento"), o app segue de pé (preserva D-051-1) e nunca troca para mock sem opt-in explícito.
6. **Erros** (via `AppError`): 401/403 chave inválida = `config` não retryable + alerta ao admin; 402/quota/crédito esgotado = `provider_unavailable` não retryable até o admin recarregar; 400/422 roteiro/avatar rejeitado ou moderação = `provider_rejected`; 408/429/5xx/timeout de rede = retryable com `Retry-After` ou backoff+jitter, tentativas limitadas; vídeo falho no provedor = `provider_failed`.
7. **Timeouts**: criação ≤ 30 s, status ≤ 15 s, download: conexão 15 s + inatividade 30 s (já do runner), tempo total do job 30 min (já existe).
8. **Segurança do download**: allowlist do host do provedor e do CDN, https, anti-SSRF com `assertAllowedHost`/`classifyIp`/`pinnedAgents`, redirects ≤ 3 revalidados, `content-type: video/mp4`.
9. **Duração máxima**: `CREATIVE_MAX_DURATION_SEC` (120 hoje). Recomendação (Q-071-4): **60 s no MVP** com `did`, para conter custo; configurável.
10. **Webhook**: fora do escopo; polling pelo tick (D-051-5).
11. **Auditoria/telemetria**: log estruturado sem roteiro, sem chave, sem URL assinada; contador de custo por org/mês.

## 4. Fora do escopo
Clonagem de voz/avatar do cliente, avatar por foto, BYOK por organização, webhook do provedor, geração de imagem, rotas novas, mudanças de UI (SPEC-072), troca do runner, migration (se o custo precisar de campo novo, é aditiva e escrita à mão, e a SPEC é reeditada).

## 5. Arquivos esperados
`src/lib/creatives/providers/did.ts`, `did-client.ts` (axios + interceptor de erro normalizado), `did-catalog.ts`; ajustes em `config.ts`, `factory.ts`, `messages.ts`, `service.ts` (guarda de plano/teto), `runner.ts` (defesa em profundidade e custo), `.env.example` (somente nomes, sem valor), testes `did-provider.test.ts` e fake `fake-did-server.ts`.

## 6. Testes (sem rede)
- Servidor/transport falso (nock-like ou adaptador axios injetado): criação ok, idempotência (mesma chave não cria 2 jobs, `providerJobId` estável), `getStatus` (processing/done/failed), custo real vs estimado, `fetchVideo` com MP4 pequeno, `cancel`.
- Erros: 401, 402, 422/moderação, 429 com e sem `Retry-After`, 5xx, timeout, tentativas esgotadas, resposta malformada.
- Segurança: URL de download http, host fora da allowlist, IP privado/loopback/169.254, redirect para host proibido, redirects > 3, content-type errado, vídeo grande demais: todos barrados.
- Sem vazamento: nenhuma string da chave em mensagem de erro, `rawStatus`, log capturado, resposta de action ou snapshot.
- Config: `did` sem chave em dev cai para mock; em produção dá erro `config`; provedor inválido continua erro.
- Teto: `plan_limit`/`plan_feature_locked` barra antes de chamar o provedor; org sem permissão do plano não é processada pelo runner; custo real soma no consumo mensal; isolamento por org.
- Regressão: suíte do mock e do runner (`runner.test.ts`, `mock-provider.test.ts`) continua verde; `tsc`, `eslint`, `vitest` verdes. **Nenhum teste chama rede real.** Um teste manual opcional (`npm run creatives:smoke:did`, fora do CI, exige chave local) gera 1 vídeo curto.

## 7. Critérios de aceitação
- `CREATIVE_PROVIDER=did` com chave: criar criativo -> job -> `ready` com vídeo no Blob (validado manualmente com crédito de teste); `mock` segue como padrão em dev.
- Retry/timeout/cancelamento sem cobrança dupla comprovada por teste de idempotência.
- `CreativeJob.costActualCents` preenchido e refletido no consumo do plano da 069.
- Grep da chave em logs/erros/testes = zero ocorrências.
- Em produção sem chave: erro `config`, app de pé.

## 8. Segurança e riscos
- **Custo**: vídeo falho cobrado, loop de retry, usuário malicioso: mitigado por teto por plano, limite de concorrência (2), duração máxima, guarda `fail-closed`, alerta ao admin.
- **Direitos de imagem/termos**: só avatares de catálogo licenciados para uso comercial (conferido no spike); aviso ao usuário de que o vídeo é gerado por IA.
- **Moderação**: blocklist existente (`moderation.ts`) + rejeição do provedor; roteiro nunca logado.
- **Vazamento de chave**: só server-side, nunca no bundle (`server-only`), nunca em `NEXT_PUBLIC_*`, redigida em logs, rotação documentada; revisão `git grep` antes do commit.
- **SSRF** via URL de download (tratado) e **lock-in** (interface preservada).
- **Dependência de terceiro** fora do ar: `provider_unavailable` retryable, criativo fica visível, sem fallback silencioso em produção.

## 9. Decisões e perguntas
- D-071-1 (INFERRED): `did` convive com `mock`; `mock` continua padrão em dev/teste; produção exige opt-in explícito.
- D-071-2 (INFERRED): custo em `CreativeJob` (já existe); a view do criativo expõe estimado/real.
- **Q-071-1 [BLOQUEANTE]** Onde mora a chave da plataforma? Recomendação: **env (`DID_API_KEY`) na Vercel agora**; migrar para `IntegrationSecret` gerido pelo admin na etapa 069 de integrações quando existir, sem mudar o adaptador.
- **Q-071-2 [BLOQUEANTE]** Quem paga? Recomendação: **a plataforma** (D-069-7), embutido nos planos Starter/Pro e limitado por `maxCreativesPerMonth`; Free 0; créditos extras fora do escopo; BYOK não.
- **Q-071-3 [BLOQUEANTE]** Teto: contagem por plano (recomendado) vs teto em R$ compartilhado com agentes.
- Q-071-4 Duração máxima: recomendação 60 s no MVP.
- Q-071-5 A API do provedor aceita chave de idempotência? Responder no spike; se não, aceitar o risco residual de 1 cobrança dupla em crash entre `createVideo` e gravar `providerJobId` (documentar e reconciliar manualmente).
- Q-071-6 Conta paga do provedor: quem contrata e quando (só após spike aprovado e preços conferidos)? Recomendação: usuário, plano mínimo, sem comprar antes de 070 concluída.
