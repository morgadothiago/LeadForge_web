import Link from "next/link";
import type { CreativeView } from "@/lib/creatives/types";
import { Card } from "@/components/ui/card";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { CreativeThumb } from "./CreativeThumb";
import { ASPECT_LABEL, LANGUAGE_LABEL, formatDuration, progressLabel } from "./creative-format";

const dateFmt = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

/** SPEC-051b — card da biblioteca; o cartão inteiro é um link (título) para a página do criativo. */
export function CreativeCard({ creative: c }: { creative: CreativeView }) {
  const progress = progressLabel(c);
  return (
    <Card className="group relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-xl">
      <CreativeThumb status={c.status} className="h-36 w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 font-heading text-base font-semibold leading-snug">
            <Link href={`/criativos/${c.id}`} className="break-words outline-none after:absolute after:inset-0 focus-visible:underline hover:underline">
              {c.title}
            </Link>
          </h3>
          <CreativeStatusBadge status={c.status} className="shrink-0" />
        </div>
        <p className="line-clamp-2 break-words text-sm text-muted-foreground">{c.script}</p>
        {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        {c.status === "failed" && c.error && <p className="line-clamp-2 text-xs text-destructive">{c.error}</p>}
        <p className="mt-auto pt-1 text-xs text-muted-foreground">
          {ASPECT_LABEL[c.aspectRatio].name} · {LANGUAGE_LABEL[c.language]}
          {c.durationSec ? ` · ${formatDuration(c.durationSec)}` : ""} · {dateFmt(c.createdAt)}
        </p>
      </div>
    </Card>
  );
}
