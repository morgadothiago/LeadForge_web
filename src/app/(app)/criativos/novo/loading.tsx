import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando formulário" className="mx-auto max-w-2xl space-y-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
