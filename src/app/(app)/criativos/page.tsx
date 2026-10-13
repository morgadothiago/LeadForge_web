import { CreativeLibrary } from "@/components/creatives/CreativeLibrary";
import { parseLibraryFilters } from "@/components/creatives/creative-format";
import { getFormError } from "@/components/campaigns/form-utils";
import { listAvatarsAndVoices, listCreatives } from "@/lib/actions/creative";
import { redirectIfTrialExpired } from "@/lib/auth/require-page";
import { getExtraUsage } from "@/lib/queries/entitlements";

export const dynamic = "force-dynamic";

/** SPEC-051b — biblioteca de criativos (filtros na URL; 1a página SSR). */
export default async function CriativosPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3): trial expirado => redirect a /configuracoes/assinatura
  const filters = parseLibraryFilters(await searchParams);
  const [list, info, extra] = await Promise.all([listCreatives({ ...filters, limit: 20 }), listAvatarsAndVoices(), getExtraUsage().catch(() => [])]);
  return (
    <CreativeLibrary
      // `key` por filtro: reinicia o estado local de paginação quando a URL muda.
      key={`${filters.status ?? ""}|${filters.q ?? ""}`}
      initial={list.ok ? list.data : null}
      filters={filters}
      info={info.ok ? info.data : null}
      planUsage={extra.find((i) => i.metric === "creatives") ?? null}
      loadError={list.ok ? undefined : getFormError(list.errors, "Esta área é exclusiva de contas Provider com organização.")}
    />
  );
}
