import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando contas de e-mail" className="space-y-4">
      <Skeleton className="h-10 w-full max-w-sm" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}
