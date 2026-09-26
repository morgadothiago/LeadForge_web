/** Cookie `sidebar_state` (escrito pelo SidebarProvider do shadcn): "false" = recolhida; ausente/qualquer outro = expandida (D-S3). */
export function parseSidebarDefaultOpen(value: string | undefined): boolean {
  return value !== "false";
}
