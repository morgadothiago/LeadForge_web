import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Carregando instâncias de WhatsApp" className="space-y-4">
      <Skeleton className="h-10 w-full max-w-sm" />
      {Array.from({ length: 2 }, (_, i) => (
        <Skeleton key={i} className="h-64 w-full" />
      ))}
    </div>
  );
}
