"use client";
import * as React from "react";
import { WhatsAppInstanceFormDialog } from "./WhatsAppInstanceFormDialog";
import { WhatsAppQrDialog } from "./WhatsAppQrDialog";

/** Botão "Nova instância" que, ao criar, abre direto o QR code. */
export function WhatsAppCreateButton() {
  const [created, setCreated] = React.useState<{ id: string; name: string } | null>(null);
  return (
    <>
      <WhatsAppInstanceFormDialog mode="create" onCreated={setCreated} />
      {created && <WhatsAppQrDialog instanceId={created.id} instanceName={created.name} open onOpenChange={(o) => !o && setCreated(null)} />}
    </>
  );
}
