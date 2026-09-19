# SPEC-000 — Setup inicial e infraestrutura
- status: IMPLEMENTED
- domain: backend
- sessao: 1 | ordem: 1 | depende de: nenhuma

## Objetivo
Deixar o projeto pronto para desenvolvimento: versoes alinhadas, dependencias completas, Docker Compose, .env, lib/prisma.ts.

## Contexto / riscos (do diagnostico)
- package.json: `prisma ^8.0.0-rc.15` (RC) vs `@prisma/client ^7.10.0` -> desalinhado. [NEEDS_DECISION D1]
- AGENTS.md: Next 16 tem breaking changes; ler `node_modules/next/dist/docs/` (index.md, 01-app) ANTES de qualquer codigo Next. Vale para todas as SPECs.
- Docker nao roda (colima parado): compose e validado so estaticamente (`docker compose config`) ate o usuario subir colima.
- Deps faltantes: zod, framer-motion, nodemailer (+@types/nodemailer), @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, recharts.
- `@tanstack/react-table ^9.2.4` e `lucide-react ^1.47.0`: confirmar que existem/funcionam (versoes incomuns).
- Compose do PROMPT: `version:` obsoleto; senhas/chaves hardcoded; evolution e n8n usam o mesmo DB `leadforge` do app (risco de colisao de tabelas); `atendai/evolution-api:latest` e `n8n:latest` sem pin; webhook usa host.docker.internal (nao funciona em Linux sem extra_hosts); Evolution exige tambem redis config (CACHE_REDIS_*) — verificar docs da imagem.

## Escopo
1. Alinhar versoes Prisma (conforme D1).
2. `npm i --legacy-peer-deps zod framer-motion nodemailer @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities recharts` e `-D @types/nodemailer`.
3. `docker-compose.yml` (sem `version`), servicos postgres, redis, evolution, n8n; segredos via `.env`; databases separados para evolution/n8n (init script) [D2]; versoes pinadas.
4. `.env.example` (todas as vars do PROMPT + DATABASE_URL, AUTH_SECRET conforme SPEC-009) e `.env` local gitignored.
5. `src/lib/prisma.ts` singleton (padrao globalThis, conforme docs Prisma da versao escolhida; Prisma 7 pode exigir `prisma.config.ts` e driver adapter).
6. Scripts npm: `typecheck` (tsc --noEmit), `db:migrate`, `db:generate`, `db:seed`.
7. `src/lib/env.ts` validando env com Zod.
## Fora do escopo
Schema (SPEC-001), qualquer UI, subir containers.
## Criterios de aceite
- [x] `npm ls prisma @prisma/client` mostra versoes de mesma major/minor compativel.
- [x] `npm run build`, `npm run lint`, `npm run typecheck` passam.
- [x] `docker compose config` valida sem erro; sem segredos hardcoded no yml.
- [x] `import { prisma } from '@/lib/prisma'` compila; hot reload nao cria multiplos clients (revisao de codigo).
- [x] `.env.example` cobre todas as vars usadas; `.env` no .gitignore.
- [x] Todas as deps novas presentes em package.json.
- [ ] Verificacao runtime `docker compose up`: PENDENTE (nao executada; imagens/tags pinadas nao verificadas em runtime).
## Testes
Comandos acima; env.ts com teste unitario (vitest so se aprovado, D5).
## Seguranca
Sem segredos no repo; senhas fortes no .env.example como placeholders.
## Decisoes pendentes
D1 (versao Prisma), D2 (DBs separados), D5 (framework de testes).

## Implementation Notes
- Arquivos: package.json, docker-compose.yml, docker/init-databases.sh, .env.example, .env (ignorado), .gitignore (+!.env.example), prisma.config.ts, prisma/schema.prisma (placeholder), src/lib/{prisma,env,env.test}.ts, vitest.config.ts.
- Resultados (VERIFIED): npm ls (prisma 7.10.0 = @prisma/client 7.10.0), typecheck, lint, build, vitest (3 testes), docker compose config.
- Decisoes: Prisma 7 exige driver adapter (@prisma/adapter-pg, pg) e prisma.config.ts (dotenv); prisma.config.ts com seed `tsx prisma/seed.ts` (seed criado na SPEC-001); vite adicionado explicitamente (peer do vitest ignorado por --legacy-peer-deps); n8n sem basic auth (removido no n8n 1.x), usa N8N_ENCRYPTION_KEY; Evolution com CACHE_REDIS_*.
- Limitacoes: prisma/schema.prisma e apenas generator+datasource para permitir `prisma generate`/typecheck; SPEC-001 o substitui. Containers nao subidos (PENDENTE).
