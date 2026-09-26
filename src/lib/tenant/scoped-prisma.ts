import { prisma } from "@/lib/prisma";

/**
 * SPEC-030 — policy layer central (D-30-3: implementação própria, sem CASL).
 *
 * `scopedPrisma(orgId)` é o ÚNICO jeito permitido de ler/escrever os modelos de negócio (todos os
 * listados em DIRECT_ORG_MODELS/INDIRECT_ORG_MODELS abaixo) fora do caminho cross-tenant explícito
 * de `platform_admin` (`src/lib/tenant/admin-prisma.ts`). Ele injeta automaticamente o filtro de
 * `orgId` (direto ou via relação, para os modelos que só têm o dono "pendurado" — Lead via Campaign,
 * Touch via Lead, etc.) em toda leitura/escrita, para que nenhuma query "esqueça" o filtro por acidente.
 *
 * Uso: `const db = scopedPrisma(orgId); await db.campaign.findMany({...});`
 *
 * Modelos fora desta lista (User, Membership, Organization, Mobile*) não são tenant-scoped por esta
 * SPEC e continuam acessados via `prisma` direto (`User`/`Membership`/`Organization` são a própria
 * infraestrutura de tenant; `Mobile*` é escopo por usuário, não por org, e não está no escopo da
 * SPEC-030 — ver seção 1 do spec.md).
 */

/** Modelos com coluna `orgId` própria. */
const DIRECT_ORG_MODELS = [
  "campaign",
  "icpProfile",
  "sequence",
  "messageTemplate",
  "whatsAppInstance",
  "emailAccount",
  "suppression",
  "schedulerRun",
  "integrationSecret",
  "integrationAuditLog",
  "agentSettings",
  "meetingSettings",
  "agent",
  "knowledgeDocument",
  "webhookEvent",
] as const;

/** Modelos sem `orgId` próprio: caminho de relação (nomes de campo do Prisma, não de tabela) até um modelo de DIRECT_ORG_MODELS. */
const INDIRECT_ORG_MODELS = {
  lead: ["campaign"],
  leadNote: ["lead", "campaign"],
  touch: ["lead", "campaign"],
  opportunity: ["campaign"],
  meeting: ["campaign"],
  stageHistory: ["opportunity", "campaign"],
  searchRun: ["campaign"],
  instanceAlert: ["instance"],
  agentRun: ["agent"],
  draft: ["lead", "campaign"],
  sequenceStep: ["sequence"],
} as const;

type DirectOrgModel = (typeof DIRECT_ORG_MODELS)[number];
type IndirectOrgModel = keyof typeof INDIRECT_ORG_MODELS;
export type OrgScopedModel = DirectOrgModel | IndirectOrgModel;

const ORG_PATH = {
  ...Object.fromEntries(DIRECT_ORG_MODELS.map((m) => [m, [] as string[]])),
  ...INDIRECT_ORG_MODELS,
} as unknown as Record<OrgScopedModel, string[]>;

function isDirectModel(model: string): model is DirectOrgModel {
  return (DIRECT_ORG_MODELS as readonly string[]).includes(model);
}

/** `["campaign"]` -> `{ campaign: { orgId } }`; `[]` -> `{ orgId }`. */
function buildOrgWhere(path: string[], orgId: string): Record<string, unknown> {
  if (path.length === 0) return { orgId };
  const [head, ...rest] = path;
  return { [head]: buildOrgWhere(rest, orgId) };
}

function mergeWhere(where: unknown, orgWhere: Record<string, unknown>): Record<string, unknown> {
  const base = (where ?? {}) as Record<string, unknown>;
  return { AND: [base, orgWhere] };
}

/**
 * `findUnique`/`update`/`delete` aceitam `where` com chave composta (ex.: `{ orgId_kind_value: { orgId, kind, value } }`),
 * que NÃO é um filtro válido em `findFirst`/`findMany` (`WhereInput` não conhece o nome da chave composta, só `WhereUniqueInput`).
 * "Achata" o container da chave composta nos campos individuais para poder reusar `findFirst` com segurança.
 */
function flattenUniqueWhere(where: AnyArgs): AnyArgs {
  const out: AnyArgs = {};
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      Object.assign(out, v as AnyArgs);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Erro lançado quando a leitura/escrita alveja um registro que não pertence à org — nunca "vaza" que o registro existe em outra org. */
export class TenantNotFoundError extends Error {
  constructor(model: string) {
    super(`Registro de "${model}" não encontrado nesta organização.`);
    this.name = "TenantNotFoundError";
  }
}

type AnyArgs = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDelegate = any;

/**
 * Envolve o delegate de um modelo do Prisma Client injetando o filtro de org em toda operação.
 * `update`/`delete`/`upsert` usam o padrão "verifica antes" (findFirst com o where único + filtro de
 * org) porque `where` de update/delete só aceita campos únicos — não dá para "AND" direto ali.
 */
function wrapDelegate(model: OrgScopedModel, delegate: AnyDelegate, orgId: string): AnyDelegate {
  const path = ORG_PATH[model];
  const orgWhere = buildOrgWhere(path, orgId);
  const direct = isDirectModel(model);

  async function assertInOrg(uniqueWhere: AnyArgs): Promise<void> {
    const found = await delegate.findFirst({ where: mergeWhere(flattenUniqueWhere(uniqueWhere), orgWhere), select: { id: true } });
    if (!found) throw new TenantNotFoundError(model);
  }

  return {
    findMany: (args: AnyArgs = {}) => delegate.findMany({ ...args, where: mergeWhere(args.where, orgWhere) }),
    findFirst: (args: AnyArgs = {}) => delegate.findFirst({ ...args, where: mergeWhere(args.where, orgWhere) }),
    findUnique: (args: AnyArgs) => delegate.findFirst({ ...args, where: mergeWhere(flattenUniqueWhere(args.where as AnyArgs), orgWhere) }),
    findFirstOrThrow: async (args: AnyArgs = {}) => {
      const r = await delegate.findFirst({ ...args, where: mergeWhere(args.where, orgWhere) });
      if (!r) throw new TenantNotFoundError(model);
      return r;
    },
    findUniqueOrThrow: async (args: AnyArgs) => {
      const r = await delegate.findFirst({ ...args, where: mergeWhere(flattenUniqueWhere(args.where as AnyArgs), orgWhere) });
      if (!r) throw new TenantNotFoundError(model);
      return r;
    },
    count: (args: AnyArgs = {}) => delegate.count({ ...args, where: mergeWhere(args.where, orgWhere) }),
    aggregate: (args: AnyArgs = {}) => delegate.aggregate({ ...args, where: mergeWhere(args.where, orgWhere) }),
    groupBy: (args: AnyArgs) => delegate.groupBy({ ...args, where: mergeWhere(args.where, orgWhere) }),
    create: (args: AnyArgs) => delegate.create({ ...args, data: direct ? { ...(args.data as AnyArgs), orgId } : args.data }),
    createMany: (args: AnyArgs) => {
      const data = args.data as AnyArgs[];
      return delegate.createMany({ ...args, data: direct ? data.map((d) => ({ ...d, orgId })) : data });
    },
    update: async (args: AnyArgs) => {
      await assertInOrg(args.where as AnyArgs);
      const data = args.data as AnyArgs;
      return delegate.update({ ...args, data: direct && "orgId" in data ? { ...data, orgId } : data });
    },
    updateMany: (args: AnyArgs = {}) => delegate.updateMany({ ...args, where: mergeWhere(args.where, orgWhere) }),
    delete: async (args: AnyArgs) => {
      await assertInOrg(args.where as AnyArgs);
      return delegate.delete(args);
    },
    deleteMany: (args: AnyArgs = {}) => delegate.deleteMany({ ...args, where: mergeWhere(args.where, orgWhere) }),
    upsert: async (args: AnyArgs) => {
      const existing = await delegate.findFirst({ where: mergeWhere(flattenUniqueWhere(args.where as AnyArgs), orgWhere), select: { id: true } });
      if (existing) {
        const data = args.update as AnyArgs;
        return delegate.update({ where: args.where, data: direct && "orgId" in data ? { ...data, orgId } : data });
      }
      const create = args.create as AnyArgs;
      return delegate.create({ data: direct ? { ...create, orgId } : create });
    },
  };
}

export type ScopedPrisma = { [K in OrgScopedModel]: AnyDelegate } & {
  /** Escapa-hatch explícito para operações fora do escopo de org (ex.: `$transaction`). Use com cautela — não filtra por org sozinho. */
  raw: typeof prisma;
};

/** Cliente com escopo de Organization. Único caminho permitido para os modelos de negócio fora de `admin-prisma.ts`. */
export function scopedPrisma(orgId: string): ScopedPrisma {
  if (!orgId) throw new Error("scopedPrisma: orgId obrigatório.");
  const cache = new Map<string, AnyDelegate>();
  return new Proxy({} as ScopedPrisma, {
    get(_target, prop: string) {
      if (prop === "raw") return prisma;
      if (prop in ORG_PATH) {
        if (!cache.has(prop)) {
          const delegate = (prisma as unknown as Record<string, AnyDelegate>)[prop];
          cache.set(prop, wrapDelegate(prop as OrgScopedModel, delegate, orgId));
        }
        return cache.get(prop);
      }
      throw new Error(`scopedPrisma: modelo "${prop}" não é tenant-scoped (ou não existe). Use admin-prisma.ts se for cross-tenant intencional.`);
    },
  });
}
