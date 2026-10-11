# SPEC-059 — Rate limit persistente (Redis) com fallback em memoria (D-049-14)
- status: IMPLEMENTED (aprovada por delegacao do usuario ao orquestrador, 2026-10-11; implementada 2026-10-11) | domain: backend | depende de: SPEC-049, SPEC-014, SPEC-018, SPEC-026, SPEC-055
- criada: 2026-10-11

## Objetivo
Os limiters hoje vivem em memoria por processo (multi-instancia = N x limite; zeram a cada deploy). Passam a usar Redis quando `REDIS_URL` existir, mantendo a semantica atual de cada um, com fallback em memoria.

## Escopo
Camada `src/lib/rate-limit/` (cliente ioredis lazy, circuit breaker, primitivas atomicas via script Lua, prefixo `lf:rl:`) e adocao em TODOS os limiters em memoria encontrados por grep:
- `SlidingLimiter` (janela deslizante): org (join/invite/create/signupJoin), billing (signup, cancel), password-reset, email-verification (reenvio), account-deletion (5 limiters), test-connection (3), lead-search.
- Login (`auth/rate-limit.ts`: falhas por e-mail+IP e por e-mail, backoff progressivo) usado por `actions/auth.ts` e `api/mobile/v1/auth/login`.
- Janela fixa: webhook WhatsApp (`whatsapp/webhook-rate-limit.ts`), unsubscribe (`channels/unsubscribe-rate-limit.ts`), ingestao de leads (`lead-ingest/handler.ts`), Meta/Google Ads (`lead-source/*-handler.ts`), reunioes (`meetings/webhook.ts`), mobile refresh e acoes/reauth (`mobile/refresh-limit.ts`, `mobile/action-limit.ts`).
- Env `REDIS_URL` (opcional) em `env.ts`/`.env.example`.

## Fora do escopo
Migrar locks/filas/cache a Redis; Redis Cluster/Sentinel; metricas; mudar limites/janelas de qualquer limiter; migration de banco (nenhuma).

## Requisitos
1. Sem `REDIS_URL`: comportamento identico ao atual (memoria por processo).
2. Com `REDIS_URL`: contagem compartilhada entre instancias, operacoes atomicas (um unico `EVAL` por decisao; sem INCR+EXPIRE separados), chaves `lf:rl:<namespace>:<chave>`, TTL sempre definido.
3. Falha do Redis: log (throttled) e uso do estado em memoria daquela chamada (nunca bloqueia nem lanca); circuito aberto por 5 s apos erro para nao adicionar latencia.
4. Semantica preservada: janela deslizante (SlidingLimiter), janela fixa com `retry-after = ttl` (buckets), backoff do login (`min(2^(n-limiar) s, 60 s)`, limiares 2/9, tetos 5/20 em 15 min, zerar em sucesso), reauth/refresh/action.
5. API: funcoes que consultam/registram viram assincronas (`Promise`); callers e testes ajustados. Nomes preservados.

## Decisoes (todas INFERRED, aprovadas pelo orquestrador por delegacao)
- D-059-1 (INFERRED): cliente `ioredis` (dependencia nova; Redis ja existe no compose). Conexao lazy, `enableOfflineQueue=false`, `commandTimeout` 500 ms, `connectTimeout` 1 s, `maxRetriesPerRequest=1`.
- D-059-2 (INFERRED): atomicidade por scripts Lua (`EVAL`): sorted set (sliding), contador com `PEXPIRE` na criacao (janela fixa), hash com backoff (login). Tempo da decisao vem do cliente (`now`), exceto TTL das chaves (Redis).
- D-059-3 (INFERRED): falha do Redis = fail-open para o Redis, mas com degradacao ao limiter em memoria do processo (nao libera tudo); circuit breaker de 5 s. Vale para todos, inclusive login (a protecao por processo continua) — nenhum limiter vira fail-closed.
- D-059-4 (INFERRED): namespaces explicitos por limiter (`name`) para nao colidir chaves entre limiters de mesmos parametros.
- D-059-5 (INFERRED): comportamento de "chave cheia"/teto de chaves (unsubscribe "full", webhook accept-sem-contar) existe so no backend memoria; no Redis o TTL limita o crescimento.
- D-059-7 (INFERRED): nenhuma PII/token em claro em chaves Redis. `rlKey` aplica HMAC-SHA256 (segredo `AUTH_SECRET`; SHA-256 simples se ausente) truncado a 32 hex na parte variavel; o namespace continua legivel. Memoria inalterada. Cliente com `lazyConnect` (connect na primeira chamada) e singleton em `globalThis` (HMR).
- D-059-6 (INFERRED): `clear()`/`_clear*` de testes continuam limpando apenas memoria; testes Redis usam fake in-process e um teste de integracao opcional (skip se Redis indisponivel).

## Criterios de aceitacao
- AC-1 sem REDIS_URL todos os limiters mantem testes existentes verdes (regressao).
- AC-2 SlidingLimiter via Redis: respeita max/janela, retorna segundos corretos, peek nao registra, estado compartilhado entre duas instancias do limiter.
- AC-3 janela fixa via Redis: max/ttl corretos, janela expira; concorrencia (Promise.all de N hits) conta exatamente N (atomicidade).
- AC-4 login via Redis: teto, backoff, reset por sucesso, camada por e-mail.
- AC-5 Redis falhando (erro em eval): limiters continuam funcionando em memoria e nada lanca; circuito reabre apos 5 s.
- AC-6 chaves com prefixo `lf:rl:` e TTL.
- AC-7 tsc, eslint e vitest completo verdes.
- AC-8 (condicional) integracao contra Redis real quando disponivel.

## Testes
`src/lib/rate-limit/*.test.ts` (fake RedisLike, fallback, falha, atomicidade, integracao condicional) + testes existentes ajustados para async.

## Riscos
- Relogios divergentes entre instancias afetam apenas `blockedUntil` do login (tolerancia de ms/s).
- Latencia extra de rede por request em rotas quentes (webhooks); mitigada por timeout 500 ms + circuit breaker.
- Redis compartilhado sem persistencia: reinicio zera contadores (equivalente ao estado anterior).

## Implementation Notes
- Novos: `src/lib/rate-limit/redis.ts` (cliente ioredis lazy, circuit breaker 5 s, scripts Lua, `redisHit`), `fake-redis.ts`, `redis-backend.test.ts`, `redis-real.test.ts` (condicional). Alterados: `integrations/rate-limit.ts` (SlidingLimiter async, param `name`), `auth/rate-limit.ts` (login async), `lead-ingest/handler.ts`, `lead-source/{meta,google-ads}-handler.ts`, `meetings/webhook.ts`, `whatsapp/{webhook-rate-limit,webhook-handler}.ts`, `channels/unsubscribe-rate-limit.ts` + rota, `mobile/{refresh-limit,action-limit,actions}.ts` + rota refresh e login, `org/rate-limit.ts`, `account-deletion/service.ts`, `integrations/test-connection.ts`, `actions/{auth,org,billing,lead-search,integration,account-deletion}.ts`, `env.ts`, `.env.example`, package.json (ioredis).
- Testes: tsc limpo; eslint 0 erros; vitest completo 162 arquivos / 2038 testes verdes (banco leadforge_059_test); integracao contra Redis real (docker) executou e passou.
- AC-1..AC-8: PASS (redis-backend.test.ts, redis-real.test.ts, suites existentes ajustadas para async).
- Limitacoes: `resetFailures`/`clearReauthFailures` limpam memoria e tentam limpar o Redis; se o Redis estiver fora no momento, as chaves la permanecem ate o TTL (limitacao aceita); `clear()`/`_clear*` limpam so memoria; clock skew afeta `blockedUntil` do login; unsubscribe "full"/teto de chaves so na memoria.
