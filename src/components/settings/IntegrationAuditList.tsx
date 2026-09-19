import Link from "next/link";
import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/components/leads/lead-format";
import type { IntegrationAuditPage } from "@/lib/queries/integration";
import { formatAuditRow } from "./integration-format";

export function IntegrationAuditList({ audit }: { audit: IntegrationAuditPage }) {
  const href = (p: number) => `/configuracoes/integracoes?page=${p}`;
  if (audit.items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-8 text-center">
        <History className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Nenhuma alteração registrada ainda.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {audit.items.map((e) => {
          const r = formatAuditRow(e);
          return (
            <li key={e.id} className="grid gap-0.5 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
              <time dateTime={e.at.toISOString()} className="text-xs text-muted-foreground">
                {formatDateTime(e.at)}
              </time>
              <p>
                <span className="font-medium">{r.action}</span> · {r.integration}
                <span className="text-muted-foreground"> — {r.user}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="sr-only">Host: </span>
                {r.host}
              </p>
            </li>
          );
        })}
      </ul>
      <nav aria-label="Paginação do histórico" className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          Página {audit.page} de {audit.totalPages} ({audit.total} registro{audit.total === 1 ? "" : "s"})
        </span>
        <div className="flex gap-2">
          {audit.page > 1 && (
            <Link href={href(audit.page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Anterior
            </Link>
          )}
          {audit.page < audit.totalPages && (
            <Link href={href(audit.page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Próxima
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
