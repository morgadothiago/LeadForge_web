import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { parseDocument } from "@/lib/domain/document";
import { randomCnpj, randomCpf } from "@/lib/test-utils/document";
import { canonicalEmail, claimTrial, docClaimHash, emailClaimHash, isDisposableEmailDomain } from "./trial-claim";

const createdHashes: string[] = [];
afterAll(async () => {
  await prisma.trialClaim.deleteMany({ where: { keyHash: { in: createdHashes } } });
});
const rnd = () => Math.random().toString(36).slice(2, 10);

describe("TrialClaim helpers (SPEC-065, D-065-19/27)", () => {
  it("e-mail canonico: minusculas, sem +tag, sem pontos em gmail/googlemail", () => {
    expect(canonicalEmail("A.B+x@Gmail.com")).toBe("ab@gmail.com");
    expect(canonicalEmail("a.b@googlemail.com")).toBe("ab@gmail.com");
    expect(canonicalEmail("  Fulano+promo@Empresa.com.br ")).toBe("fulano@empresa.com.br");
    expect(canonicalEmail("a.b@empresa.com")).toBe("a.b@empresa.com"); // pontos so sao ignorados no gmail
    expect(emailClaimHash("a.b+x@gmail.com")).toBe(emailClaimHash("AB@gmail.com"));
    expect(emailClaimHash("a@x.com")).not.toBe(emailClaimHash("b@x.com"));
  });
  it("hash e sha256 hex (64 chars) e NAO contem o dado em claro; e-mail e documento nunca colidem", () => {
    const doc = parseDocument(randomCpf())!;
    const h = docClaimHash(doc);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(doc.digits);
    expect(emailClaimHash("a@x.com")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("CNPJ: matriz e filial (mesma raiz de 8 digitos) geram o MESMO hash; raiz diferente, hash diferente", () => {
    const a = parseDocument(randomCnpj({ root: "12345678", branch: "0001" }))!;
    const b = parseDocument(randomCnpj({ root: "12345678", branch: "0007" }))!;
    const c = parseDocument(randomCnpj({ root: "12345679", branch: "0001" }))!;
    expect(docClaimHash(a)).toBe(docClaimHash(b));
    expect(docClaimHash(a)).not.toBe(docClaimHash(c));
  });
  it("dominios descartaveis (lista embutida + env)", () => {
    expect(isDisposableEmailDomain("x@mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("x+y@Mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("x@empresa.com.br")).toBe(false);
    process.env.TRIAL_DISPOSABLE_DOMAINS = "lixo.test, outro.test";
    try {
      expect(isDisposableEmailDomain("x@lixo.test")).toBe(true);
    } finally {
      delete process.env.TRIAL_DISPOSABLE_DOMAINS;
    }
  });
  it("claimTrial: 1o uso = true (2 linhas); repetir o e-mail OU o documento = false, sem excecao (nao aborta a transacao) e registra o que for novo", async () => {
    const email = `zz-claim-${rnd()}@test.local`;
    const doc = parseDocument(randomCpf())!;
    createdHashes.push(emailClaimHash(email), docClaimHash(doc));
    expect(await prisma.$transaction((tx) => claimTrial(tx, email, doc))).toBe(true);
    expect(await prisma.trialClaim.count({ where: { keyHash: { in: [emailClaimHash(email), docClaimHash(doc)] } } })).toBe(2);
    // mesmo e-mail canonico + doc novo
    const doc2 = parseDocument(randomCpf())!;
    createdHashes.push(docClaimHash(doc2));
    expect(await prisma.$transaction((tx) => claimTrial(tx, email.toUpperCase(), doc2))).toBe(false);
    expect(await prisma.trialClaim.count({ where: { keyHash: docClaimHash(doc2) } })).toBe(1); // o hash novo tambem fica registrado
    // e-mail novo + mesmo doc
    const email2 = `zz-claim-${rnd()}@test.local`;
    createdHashes.push(emailClaimHash(email2));
    expect(await prisma.$transaction((tx) => claimTrial(tx, email2, doc))).toBe(false);
  });
  it("claimTrial sob concorrencia: 2 cadastros com o mesmo documento => exatamente 1 recebe o trial", async () => {
    const doc = parseDocument(randomCpf())!;
    const e1 = `zz-claim-${rnd()}@test.local`;
    const e2 = `zz-claim-${rnd()}@test.local`;
    createdHashes.push(docClaimHash(doc), emailClaimHash(e1), emailClaimHash(e2));
    const rs = await Promise.all([prisma.$transaction((tx) => claimTrial(tx, e1, doc)), prisma.$transaction((tx) => claimTrial(tx, e2, doc))]);
    expect(rs.filter(Boolean)).toHaveLength(1);
  });
});
