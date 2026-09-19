"use client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { STAGES, STAGE_LABELS } from "@/lib/domain";

export function DesignInteractive() {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold">Interativos</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>Abrir dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Título</DialogTitle>
              <DialogDescription>Conteúdo de exemplo.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Editar</DropdownMenuItem>
            <DropdownMenuItem>Arquivar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" />}>Tooltip</TooltipTrigger>
            <TooltipContent>Dica rápida</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button onClick={() => toast.success("Salvo com sucesso")}>Toast</Button>
      </div>
      <Select defaultValue="novo_lead">
        <SelectTrigger className="max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Resumo</TabsTrigger>
          <TabsTrigger value="b">Atividade</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Painel resumo</TabsContent>
        <TabsContent value="b">Painel atividade</TabsContent>
      </Tabs>
      <Toaster />
    </section>
  );
}
