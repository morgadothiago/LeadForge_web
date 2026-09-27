import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE_NAME } from "@/lib/theme-state";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LeadForge",
  description: "Prospecção e pipeline de leads",
};

/**
 * SPEC-037 — tema lido do cookie `theme` no servidor (RSC), antes do primeiro paint, mesmo padrão
 * de `sidebar_state`/`parseSidebarDefaultOpen`. D-037-1: default `light` (identidade da landing
 * passa a ser a referência visual principal do produto); `dark` é a variante escura da mesma
 * identidade índigo (ver `globals.css`).
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased${theme === "dark" ? " dark" : ""}`}
      style={{ colorScheme: theme }}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
