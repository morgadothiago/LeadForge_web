import { scorePassword, type StrengthLevel } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

const FILL: Record<StrengthLevel, string> = {
  0: "bg-muted",
  1: "bg-red-600 dark:bg-red-400",
  2: "bg-orange-600 dark:bg-orange-400",
  3: "bg-yellow-600 dark:bg-yellow-400",
  4: "bg-green-600 dark:bg-green-400",
};
const TEXT: Record<StrengthLevel, string> = {
  0: "text-muted-foreground",
  1: "text-red-700 dark:text-red-300",
  2: "text-orange-700 dark:text-orange-300",
  3: "text-yellow-800 dark:text-yellow-300",
  4: "text-green-700 dark:text-green-300",
};

/**
 * SPEC-064 — indicador de forca (orientacao, nao bloqueia). Barra de 4 segmentos + texto (cor nunca e a unica informacao).
 * Calculo local; `personal` = nome/e-mail do mesmo formulario. Anuncia mudancas em `aria-live="polite"`.
 */
export function PasswordStrength({ password, personal = [], id }: { password: string; personal?: string[]; id?: string }) {
  const s = scorePassword(password, personal);
  return (
    <div id={id} className="space-y-1.5" data-testid="password-strength">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cn("h-1.5 flex-1 rounded-full transition-colors", n <= s.level ? FILL[s.level] : "bg-muted")} />
        ))}
      </div>
      <p role="status" aria-live="polite" className={cn("min-h-4 text-xs", TEXT[s.level])}>
        {s.level === 0 ? (
          <span className="text-muted-foreground">Use letras, números e símbolos para uma senha mais forte.</span>
        ) : (
          <>
            <strong className="font-medium">Força: {s.label}.</strong> <span className="text-muted-foreground">{s.hint}</span>
          </>
        )}
        {s.level === 1 && <span className="sr-only"> Aviso: senha muito fraca, fácil de adivinhar.</span>}
      </p>
    </div>
  );
}
