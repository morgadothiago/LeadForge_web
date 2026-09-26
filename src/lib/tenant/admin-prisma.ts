import { prisma } from "@/lib/prisma";

/**
 * SPEC-030 — caminho cross-tenant EXPLÍCITO para `platform_admin` (D-30-3). Nunca importar isto a
 * partir de código que atende um `provider` (chame `requirePlatformAdmin()` antes, sempre).
 *
 * Ao contrário de `scopedPrisma(orgId)`, `adminPrisma` não injeta nenhum filtro de org — é o Prisma
 * Client cru, de propósito, porque o admin de plataforma PRECISA enxergar todos os tenants (SPEC-031
 * "admin cross-tenant" consome isto). O nome do módulo existe justamente para que um `grep` por
 * `admin-prisma` deixe óbvio, em code review, todo ponto do código que faz query sem escopo de org.
 *
 * Fora de escopo nesta SPEC-030 (ver "Fora do escopo" do spec.md): nenhuma tela/endpoint usa isto
 * ainda — este arquivo só prepara o terreno para SPEC-031/032.
 */
export const adminPrisma = prisma;
