import Link from "next/link";
import { Info } from "lucide-react";
import { UPGRADE_HREF, isAtLimit, limitReachedText, type UsageItem } from "./trial-ui";

export function limitNoticeId(metric: UsageItem["metric"]): string {
  return `limit-notice-${metric}`;
}

/**
 * SPEC-065b (D-065-18) — aviso ao lado de botoes de criar quando o plano ja esta no limite: explica o motivo e oferece "Fazer upgrade".
 * O botao fica desabilitado e ligado a este texto por `aria-describedby` (`limitNoticeId`). `item` ausente/ilimitado/abaixo do limite = nada.
 * So UX: a barreira real e o backend (`plan_limit`). `soft` = so informa (ex.: campanha pode ser criada pausada).
 */
export function LimitNotice({ item, soft = false, hint }: { item: UsageItem | undefined; soft?: boolean; hint?: string }) {
  if (!item || item.limit === null || !isAtLimit(item)) return null;
  return (
    <div id={limitNoticeId(item.metric)} role="note" data-slot="limit-notice" className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {limitReachedText(item.metric, item.limit)} {soft ? (hint ?? "") : "Para continuar, faça upgrade do plano."}
      </p>
      <Link href={UPGRADE_HREF} className="inline-flex min-h-9 items-center font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/40">
        Fazer upgrade
      </Link>
    </div>
  );
}
