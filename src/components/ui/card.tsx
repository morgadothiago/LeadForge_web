import * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.ComponentProps<"div">;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-lg shadow-black/20", className)}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-lg font-semibold", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
export function CardFooter({ className, ...props }: DivProps) {
  return <div className={cn("flex items-center p-5 pt-0", className)} {...props} />;
}
