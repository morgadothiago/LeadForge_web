import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

/** Slug livre (mesma lógica do signup, SPEC-033); `attempt > 0` acrescenta sufixo aleatório (corrida em P2002). */
export async function uniqueOrgSlug(base: string, attempt = 0): Promise<string> {
  const root = slugify(base);
  if (attempt > 0) return `${root}-${randomBytes(3).toString("hex")}`;
  let slug = root;
  let n = 0;
  while (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${root}-${n}`;
  }
  return slug;
}
