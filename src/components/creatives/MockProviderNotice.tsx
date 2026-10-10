import { FlaskConical } from "lucide-react";
import { MOCK_LABEL, MOCK_NOTICE } from "./creative-format";

/** SPEC-051b — avisa que o provedor ativo é o mock (vídeo placeholder, não um criativo real). */
export function MockProviderNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="min-w-0">
        <strong className="font-medium">{MOCK_LABEL}</strong>
        {!compact && <span className="text-muted-foreground"> — {MOCK_NOTICE}</span>}
      </p>
    </div>
  );
}
