import { z } from "zod";

/** SPEC-031 — validação de entrada das queries/actions cross-tenant (`src/lib/queries/admin`, `src/lib/actions/admin`). */

export const ORG_LIST_PAGE_SIZE_MAX = 100;

export const listOrganizationsSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(ORG_LIST_PAGE_SIZE_MAX).catch(20).default(20),
    search: z
      .preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(100).optional()),
    status: z.enum(["active", "suspended", "cancelled"]).optional(),
  })
  .default({ page: 1, pageSize: 20 });

export const orgIdSchema = z.uuid("Organização inválida.");

export const suspendOrganizationSchema = z.object({
  orgId: z.uuid("Organização inválida."),
  reason: z
    .string({ error: "Motivo inválido." })
    .trim()
    .min(3, "Informe um motivo com ao menos 3 caracteres.")
    .max(500, "Motivo deve ter no máximo 500 caracteres."),
});

export const reactivateOrganizationSchema = z.object({
  orgId: z.uuid("Organização inválida."),
});

/** SPEC-040 — `createCourtesyOrganization` (só `platform_admin`, D-040-4): cria User+Organization+Membership(owner)+Subscription no plano "courtesy" (D-040-2/D-040-3). */
export const createCourtesyOrganizationSchema = z.object({
  name: z.string({ error: "Nome da organização é obrigatório." }).trim().min(1, "Nome da organização é obrigatório.").max(120),
  ownerEmail: z.string({ error: "E-mail é obrigatório." }).trim().toLowerCase().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  ownerName: z.string({ error: "Nome é obrigatório." }).trim().min(1, "Nome é obrigatório.").max(120),
});
