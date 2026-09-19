import { Card } from "@/components/ui/card";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <h2 className="font-heading text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <p className="text-xs text-muted-foreground">Em construção.</p>
    </Card>
  );
}
