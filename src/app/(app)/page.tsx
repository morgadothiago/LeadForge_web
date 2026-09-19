import { redirect } from "next/navigation";

/** O dashboard vive em /dashboard; "/" só redireciona (preserva filtros da query). */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v) && v[0] !== undefined) q.set(k, v[0]);
  }
  const qs = q.toString();
  redirect(qs ? `/dashboard?${qs}` : "/dashboard");
}
