"use server";

import { revalidatePath } from "next/cache";
import { requireActiveProviderOrg, requireProviderOrg } from "@/lib/auth/require-admin";
import { createCreativeDraftSchema, creativeIdSchema, listCreativesSchema } from "@/lib/schemas/creative";
import * as svc from "@/lib/creatives/service";
import type { AvatarsAndVoices, CreativeDetailView, CreativeView, ListCreativesResult } from "@/lib/creatives/types";
import { failure, safeAction, success, zodErrors, type ActionResult } from "./result";

/**
 * SPEC-051 (051a) — actions de criativos. `orgId`/`userId` SEMPRE da sessao (org ativa, SPEC-049); nunca aceitos do cliente.
 * Escrita: `requireActiveProviderOrg()` (org suspensa nao gera video/custo). Leitura: `requireProviderOrg()`.
 * `owner` e `member` operam; excluir exige owner OU criador (D-051-3). Erros de regra voltam como `{ ok:false, errors:{_form:[PT-BR]} }`.
 */
const revalidate = (): void => revalidatePath("/criativos");

export async function createCreativeDraft(input: unknown): Promise<ActionResult<CreativeView>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = createCreativeDraftSchema.safeParse(input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const view = await svc.createCreativeDraft({ orgId, userId: user.id }, parsed.data);
    revalidate();
    return success(view);
  });
}

async function mutate(input: unknown, fn: (ctx: { orgId: string; userId: string }, id: string) => Promise<CreativeView>): Promise<ActionResult<CreativeView>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = creativeIdSchema.safeParse(typeof input === "string" ? { id: input } : input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    const view = await fn({ orgId, userId: user.id }, parsed.data.id);
    revalidate();
    return success(view);
  });
}

export async function submitCreative(input: unknown): Promise<ActionResult<CreativeView>> {
  return mutate(input, (ctx, id) => svc.submitCreative(ctx, id));
}
export async function cancelCreative(input: unknown): Promise<ActionResult<CreativeView>> {
  return mutate(input, (ctx, id) => svc.cancelCreative(ctx, id));
}
export async function retryCreative(input: unknown): Promise<ActionResult<CreativeView>> {
  return mutate(input, (ctx, id) => svc.retryCreative(ctx, id));
}

export async function deleteCreative(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const { user, orgId } = await requireActiveProviderOrg();
    const parsed = creativeIdSchema.safeParse(typeof input === "string" ? { id: input } : input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    await svc.deleteCreative({ orgId, userId: user.id }, parsed.data.id);
    revalidate();
    return success({ id: parsed.data.id });
  });
}

export async function listCreatives(input: unknown = {}): Promise<ActionResult<ListCreativesResult>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    const parsed = listCreativesSchema.safeParse(input ?? {});
    if (!parsed.success) return failure(zodErrors(parsed.error));
    return success(await svc.listCreatives(orgId, parsed.data));
  });
}

export async function getCreative(input: unknown): Promise<ActionResult<CreativeDetailView>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    const parsed = creativeIdSchema.safeParse(typeof input === "string" ? { id: input } : input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    return success(await svc.getCreative(orgId, parsed.data.id));
  });
}

/** URL SAS de leitura (curta, 5 min) do video pronto, gerada pela SPEC-050 APOS checar a org. */
export async function getCreativeVideoUrl(input: unknown): Promise<ActionResult<{ url: string; expiresInSeconds: number }>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    const parsed = creativeIdSchema.safeParse(typeof input === "string" ? { id: input } : input);
    if (!parsed.success) return failure(zodErrors(parsed.error));
    return success(await svc.getCreativeVideoUrl(orgId, parsed.data.id));
  });
}

export async function listAvatarsAndVoices(): Promise<ActionResult<AvatarsAndVoices>> {
  return safeAction(async () => {
    const { orgId } = await requireProviderOrg();
    return success(await svc.listAvatarsAndVoices(orgId));
  });
}
