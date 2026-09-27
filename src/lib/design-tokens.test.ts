import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

/** SPEC-037: `:root` (light, default) e `.dark` (variante escura) agora tem paletas distintas —
 * separa o texto do arquivo em 2 blocos pra checar cada tema isoladamente. */
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
const darkBlock = css.slice(css.indexOf(".dark {"));

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Extrai `--token: #hex;` de um bloco de CSS (usado pra ler os tokens de domínio sem repetir o hex
 * manualmente aqui — assim o teste acompanha `globals.css` em vez de duplicar valores). */
function readVar(block: string, token: string): string {
  const m = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,8});`));
  if (!m) throw new Error(`token ${token} não encontrado no bloco CSS`);
  return m[1];
}

/** Fundo real de um badge de domínio (`StatusBadge`/`ChannelBadge`/`OrgStatusBadge`): a cor do
 * texto composta a 10% de opacidade (`color-mix(in srgb, <cor> 10%, transparent)`) sobre `--card`
 * — não `--card` sólido. QA (SPEC-037, rodada de correção): o contraste real é menor que o
 * calculado contra `--card` puro, porque o fundo já é levemente tingido pela própria cor do texto. */
function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function badgeBg(colorHex: string, cardHex: string): string {
  const [cr, cg, cb] = hexToRgb(colorHex);
  const [br, bg, bb] = hexToRgb(cardHex);
  const mix = (c: number, b: number) => Math.round(c * 0.1 + b * 0.9);
  return `#${[mix(cr, br), mix(cg, bg), mix(cb, bb)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const DOMAIN_TOKENS = [
  "--stage-novo-lead", "--stage-contactado", "--stage-em-followup", "--stage-interessado",
  "--stage-reuniao-agendada", "--stage-fechado", "--stage-perdido",
  "--channel-email", "--channel-whatsapp", "--channel-linkedin", "--channel-phone",
  "--org-active", "--org-suspended", "--org-cancelled",
];

describe("design tokens — light (:root, default, D-037-1)", () => {
  it.each([
    ["--background", "#f8f8fc"], ["--card", "#ffffff"], ["--muted", "#f1f0f8"],
    ["--sidebar", "#ffffff"], ["--primary", "#6d5ef5"], ["--primary-hover", "#5a4ce0"],
    ["--primary-foreground", "#ffffff"], ["--foreground", "#14121f"],
    ["--muted-foreground", "#66647a"], ["--destructive", "#dc2626"], ["--border", "#e7e5f3"],
  ])("%s = %s", (token, hex) => {
    expect(rootBlock).toContain(`${token}: ${hex};`);
  });
  it("contraste AA", () => {
    expect(ratio("#14121f", "#f8f8fc")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", "#6d5ef5")).toBeGreaterThanOrEqual(4.5);
  });
  it("--warning tem contraste AA sobre card e sobre fundo", () => {
    expect(rootBlock).toContain("--warning: #92600c;");
    expect(ratio("#92600c", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#92600c", "#f8f8fc")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", "#92600c")).toBeGreaterThanOrEqual(4.5);
  });

  /** Achado 1/2 do QA (SPEC-037, correção): cobre TODOS os tokens `--stage-*`/`--channel-*`/
   * `--org-*` no modo light contra o fundo REAL do badge (`color-mix` 10% sobre `--card`), não só
   * `background/foreground/primary/warning` como a suíte fazia antes. */
  it.each(DOMAIN_TOKENS)("%s tem contraste AA (>=4.5:1) sobre o fundo real do badge (color-mix 10%% sobre --card)", (token) => {
    const color = readVar(rootBlock, token);
    const card = readVar(rootBlock, "--card");
    expect(ratio(color, badgeBg(color, card))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("design tokens — dark (.dark, D-037-2: variante escura da mesma identidade índigo)", () => {
  it.each([
    ["--background", "#0f0d1a"], ["--card", "#16131f"], ["--muted", "#1e1a2b"],
    ["--sidebar", "#0c0a15"], ["--primary", "#9d8cff"], ["--primary-hover", "#8672f0"],
    ["--primary-foreground", "#14121f"], ["--foreground", "#eceaf7"],
    ["--muted-foreground", "#948fb0"], ["--destructive", "#dc2626"], ["--border", "#2a2540"],
  ])("%s = %s", (token, hex) => {
    expect(darkBlock).toContain(`${token}: ${hex};`);
  });
  it("contraste AA", () => {
    expect(ratio("#eceaf7", "#0f0d1a")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#14121f", "#9d8cff")).toBeGreaterThanOrEqual(4.5);
  });
  it("--warning tem contraste AA sobre card e sobre fundo", () => {
    expect(darkBlock).toContain("--warning: #f5b638;");
    expect(ratio("#f5b638", "#16131f")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#f5b638", "#0f0d1a")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#14121f", "#f5b638")).toBeGreaterThanOrEqual(4.5);
  });

  /** Achado 2 do QA (SPEC-037, correção): cobre TODOS os tokens de domínio no modo dark contra o
   * fundo real do badge — achado original (`--channel-linkedin`, `--stage-reuniao-agendada`/
   * `--channel-phone`, `--stage-perdido`/`--org-cancelled`, `--stage-novo-lead`/`--channel-email`)
   * falhava 4.5:1 nesse cálculo mais preciso; tokens ajustados em `globals.css`. */
  it.each(DOMAIN_TOKENS)("%s tem contraste AA (>=4.5:1) sobre o fundo real do badge (color-mix 10%% sobre --card)", (token) => {
    const color = readVar(darkBlock, token);
    const card = readVar(darkBlock, "--card");
    expect(ratio(color, badgeBg(color, card))).toBeGreaterThanOrEqual(4.5);
  });
});
