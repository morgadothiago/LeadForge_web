/**
 * SPEC-065b (D-065-14) — textos (PT-BR, simples, sem culpar o usuario) da tela de bloqueio do teste gratis expirado.
 * Puro para testar por tabela: dono x membro x "ja usou o teste".
 */
export function blockedPanelCopy(opts: { isOwner: boolean; ownerName: string | null; endedAtText: string | null; neverGranted: boolean }): { title: string; text: string } {
  if (!opts.isOwner) {
    const who = opts.ownerName ? ` (${opts.ownerName})` : "";
    return {
      title: "O teste grátis desta organização terminou",
      text: `Peça ao proprietário${who} para assinar um plano. Assim que a assinatura for confirmada, você volta a usar tudo normalmente.`,
    };
  }
  if (opts.neverGranted) {
    return {
      title: "Não foi possível liberar o teste grátis para este cadastro",
      text: "Assine um plano para continuar: é só escolher abaixo. Se achar que isso é um engano, fale com o suporte.",
    };
  }
  return {
    title: opts.endedAtText ? `Seu teste grátis terminou em ${opts.endedAtText}` : "Seu teste grátis terminou",
    text: "Seus dados estão guardados: assine um plano e você volta exatamente de onde parou.",
  };
}
