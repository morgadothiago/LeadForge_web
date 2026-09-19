"use client";
import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/40 data-[active]:bg-card data-[active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel className={cn("mt-3 outline-none", className)} {...props} />;
}
