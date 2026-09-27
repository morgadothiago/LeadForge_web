/**
 * SPEC-046 — layout HTML compartilhado pelos 5 templates transacionais (identidade visual da SPEC-037:
 * "LeadForge" + cor primária `#6d5ef5`; para e-mail usa-se um tom fixo, sem replicar dark mode — fundo
 * de cliente de e-mail é sempre claro por padrão). HTML+CSS inline simples (sem MJML/react-email, fora
 * do escopo), largura máxima ~600px, tabelas em vez de flexbox/grid (compatibilidade Gmail/Outlook/Apple
 * Mail). `text` (fallback multipart) é montado separadamente por cada template, nunca derivado do HTML.
 */
const PRIMARY = "#6d5ef5";
const TEXT_COLOR = "#1f2933";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";
const BG_COLOR = "#f4f4f7";

/** Escapa HTML básico — defesa em profundidade para qualquer dado dinâmico interpolado nos templates. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailLayoutInput {
  /** Corpo em HTML (já com tags de parágrafo/link/etc. — não é escapado aqui, os templates escapam o que for dinâmico). */
  bodyHtml: string;
  /** Texto curto usado como preheader (preview no cliente de e-mail); opcional. */
  preheader?: string;
}

/** Envolve o corpo de um template no header (logo/nome + cor primária) + rodapé padrão. */
export function renderEmailLayout({ bodyHtml, preheader }: EmailLayoutInput): string {
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
    : "";
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LeadForge</title>
  </head>
  <body style="margin:0;padding:0;background:${BG_COLOR};font-family:Arial,Helvetica,sans-serif;">
    ${preheaderHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG_COLOR};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid ${BORDER_COLOR};">
            <tr>
              <td style="background:${PRIMARY};padding:20px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">LeadForge</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:${TEXT_COLOR};font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid ${BORDER_COLOR};color:${MUTED_COLOR};font-size:12px;line-height:1.5;">
                LeadForge — este é um e-mail automático, não responda diretamente a esta mensagem.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Botão de call-to-action com o mesmo tom primário do header. */
export function renderButton(label: string, href: string): string {
  return `<p style="text-align:center;margin:28px 0;">
  <a href="${escapeHtml(href)}" style="background:${PRIMARY};color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">${escapeHtml(label)}</a>
</p>`;
}

export { PRIMARY as EMAIL_PRIMARY_COLOR };
