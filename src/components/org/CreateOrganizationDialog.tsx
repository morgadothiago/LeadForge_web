"use client";
import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface PlanOption {
  key: string;
  name: string;
  priceMonthlyCents: number;
}

/**
 * SPEC-062 (D-062-14) — MINIMO da 062a para o build compilar: a criacao direta de organizacao (com trial) saiu; criar outra
 * organizacao = escolher plano, pagar e so entao nomea-la, em `/assinar?nova=1` (tela da 062b). A API de props foi mantida
 * (`plans` nao e mais usado) para nao tocar `OrgSwitcher`/`MyOrganizations`; a 062b troca por um link direto.
 */
export function CreateOrganizationDialog({ open: controlledOpen, onOpenChange }: { plans?: PlanOption[]; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [innerOpen, setInnerOpen] = React.useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setInnerOpen;
  return (
    <>
      {!controlled && (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" /> Nova organização
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova organização</DialogTitle>
            <DialogDescription>Cada organização tem a sua própria assinatura. Escolha um plano e, depois de pagar, dê um nome à nova organização.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Link href="/assinar?nova=1" className={buttonVariants()}>
              Escolher plano
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
