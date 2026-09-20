# SPEC-021 — Mobile: contrato de API /api/mobile/v1 + auth mobile
- status: APPROVED (usuario, 2026-09-19) | domain: backend | agente: dev-backend | depende de: SPEC-009 | bloqueia: 022, 023, 024
## Objetivo
Camada de API enxuta, versionada e read-mostly para o app de MONITORAMENTO. O mobile NAO e operacional: nada de CRUD pesado (sequencias, templates, integracoes/chaves, leads em massa) — fica no web.
## Diagnostico do codigo nao commitado (recomendacao de destino; nada apagado nesta etapa)
| Arquivo | Recomendacao |
|---|---|
| `src/lib/auth/session-token.ts` (`bearerToken`) | MANTER o helper; usar so no guard mobile. |
| `src/lib/auth/session.ts` (getSession aceita Bearer) | REVERTER: o JWT web de 7 dias e cookie; aceita-lo como Bearer amplia a superficie (token longo, sem revogacao). Mobile usa token proprio. |
| `src/proxy.ts` (Bearer + PUBLIC_API + 401 JSON) | REVERTER o Bearer do web; manter so a ideia "401 JSON em /api/*" restrita a `/api/mobile/v1/*` (que faz auth propria no handler, fora do redirect a /login). |
| `src/app/api/actions/auth/login/route.ts` | SUBSTITUIR por `/api/mobile/v1/auth/login` (devolve access+refresh, sem depender de cookie); remover o original. |
| `src/app/api/actions/*` (espelho das ~50 actions) | DESCARTAR: expor Server Actions como REST viola o escopo e a minimizacao. |
| `src/lib/openapi.ts` (~2170 linhas, ~50 endpoints) | REESCREVER para o subconjunto mobile (~15 endpoints); manter os 4 endpoints server-to-server existentes (cron, webhooks, unsubscribe) so se ja documentados intencionalmente. |
| `src/app/api/openapi/route.ts` | MANTER protegido (Bearer/sessao) ou so em dev; nao publico em producao. |
Decisao final sobre descartar exige aprovacao (D-M2).
## Auth mobile (proposta)
- Access token JWT (jose, `aud: "mobile"`, HS256 com segredo distinto do web ou claim `aud` obrigatoria), TTL 15 min, claims `sub`, `did` (deviceId), `jti`. Web cookie NAO vale no mobile e vice-versa.
- Refresh token opaco (32 bytes aleatorios), guardado como HASH (sha256) em `MobileDevice`; rotacao a cada uso; reuso de refresh antigo = revoga o dispositivo (deteccao de roubo). TTL 30 dias deslizante (D-M5).
- Modelo `MobileDevice`: id, userId, name (ex.: "iPhone do Thiago", informado), platform (ios|android), refreshHash, pushToken?, appVersion, createdAt, lastSeenAt, revokedAt?. Migration.
- Endpoints: `POST /auth/login` (email, senha, deviceName, platform), `POST /auth/refresh`, `POST /auth/logout` (revoga o dispositivo), `GET /auth/me`, `GET /devices`, `DELETE /devices/{id}` (revogar remotamente; tambem no web em Ajustes se houver UI, fora desta SPEC).
- Verificacao a cada request: assinatura + `exp` + dispositivo nao revogado (1 consulta indexada; aceitavel no volume).
- Rate limit: reutilizar `rate-limit.ts` (login: 5 falhas/IP+email, 20/email, 15 min); acrescentar limite em `/auth/refresh` (ex.: 30/15min/dispositivo) e 429 + `Retry-After`. Nota: store e em memoria (1 instancia); registrar limitacao.
- Biometria: e do app (SPEC-024), local, desbloqueia o refresh token no SecureStore; NAO substitui auth do servidor.
- Senha nunca e persistida no app. Mensagens de erro genericas ("credenciais invalidas") sem enumerar e-mail.
## Contrato /api/mobile/v1 (princípios)
- Versionado no path; mudanca incompatível = v2. Envelope `{ data, meta? }` / erro `{ error: { code, message } }` PT-BR sem stack/segredo.
- Bearer obrigatorio (exceto login/refresh). Somente GET nas rotas de dados nesta SPEC; POSTs de acao ficam na SPEC-026.
- Paginacao por cursor: `?limit` (max 50, padrao 20) + `?cursor`; resposta `meta.nextCursor`.
- Campos so o necessario ao painel. PII: NUNCA telefone/e-mail completos; lead exposto como `id`, `displayName` (primeiro nome + inicial ou nome da empresa), `company`, `stage`; telefone/e-mail nunca no mobile (D-M6). Corpo de mensagem so em Aprovacoes (SPEC-026), truncado e por demanda. Sem segredos (apiKey, webhookToken, IntegrationSecret, hash).
- Validacao Zod de todo input; `Cache-Control: no-store`.
- OpenAPI reescrito para este escopo, com exemplos e sem campos internos. E a UNICA fonte do contrato: o app (repo separado `~/Desktop/LeadForge/mobile`, D-M1) gera seus tipos a partir dele; entregar tambem um comando/script que exporta `openapi.json` versionado.
- Rotas de dados (implementadas em 022/023/026): `/summary`, `/pipeline`, `/campaigns`, `/campaigns/{id}`, `/whatsapp/instances`, `/scheduler`, `/agents/queue`, `/lead-search/runs`, `/alerts`, `/alerts/{id}/read`, `/devices/push-token`.
## Criterios de aceite (testaveis)
1. Login valido devolve access(15 min)+refresh e cria `MobileDevice`; invalido = 401 generico; 6a tentativa errada = 429 com `Retry-After`.
2. Access expirado = 401 `token_expired`; refresh gera novo par e invalida o refresh anterior; reuso do refresh antigo = 401 e dispositivo revogado.
3. Logout revoga: o refresh e o access desse dispositivo deixam de funcionar imediatamente.
4. JWT de cookie web rejeitado em `/api/mobile/v1/*` (aud) e access mobile rejeitado nas paginas web.
5. Sem Bearer = 401 JSON (nunca redirect). `getSession` web e `proxy` voltam ao comportamento so-cookie.
6. Paginacao: limit>50 vira 50; cursor invalido = 400; sem duplicar/pular itens em teste com 120 registros.
7. Nenhuma resposta contem `passwordHash`, `refreshHash`, `apiKey`, `webhookToken`, telefone ou e-mail de lead (teste de snapshot/varredura de chaves proibidas).
8. `openapi` lista apenas rotas mobile e valida contra as respostas reais (teste de contrato).
9. Refresh hash no banco nao permite reconstruir o token (teste: token bruto nunca gravado nem logado).
## Testes obrigatorios
Vitest: login/refresh/rotacao/reuso/logout/revogacao, aud cruzado, rate limit, paginacao, varredura de PII/segredo, contrato OpenAPI.
## Seguranca / LGPD
Menor privilegio (usuario admin unico hoje; role no token para evolucao futura); tokens curtos; revogacao remota; logs sem token/senha; HTTPS obrigatorio em producao (D-M8); dispositivos com retencao (D-M5).
## Fora do escopo
Metricas (022), alertas/push (023), app (024+), OAuth/SSO, MFA no servidor.
## Limitacoes de validacao
Sem Docker/DB real: testes com prisma mockado ou banco de testes (SPEC-020); rate limit em memoria nao vale multi-instancia; teste em aparelho na SPEC-024.
## Decisoes pendentes: D-M2, D-M5, D-M6, D-M8 (ver README).
