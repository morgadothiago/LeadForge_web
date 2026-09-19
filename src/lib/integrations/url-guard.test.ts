import { describe, expect, it } from "vitest";
import { _setIntegrationResolver, assertAllowedHost, classifyIp, maskHost, parseIntegrationUrl } from "./url-guard";

describe("classifyIp", () => {
  it.each([
    ["169.254.169.254", "blocked"], ["169.254.1.1", "blocked"], ["fd00:ec2::254", "blocked"], ["fe80::1", "blocked"], ["100.100.100.200", "blocked"],
    ["0.0.0.0", "blocked"], ["224.0.0.1", "blocked"], ["::", "blocked"], ["::ffff:169.254.169.254", "blocked"], ["::ffff:a9fe:a9fe", "blocked"],
    ["127.0.0.1", "private"], ["::1", "private"], ["10.1.2.3", "private"], ["172.16.0.1", "private"], ["172.31.255.1", "private"], ["192.168.1.1", "private"],
    ["fc00::1", "private"], ["fd12::1", "private"], ["::ffff:10.0.0.1", "private"],
    ["8.8.8.8", "public"], ["172.32.0.1", "public"], ["93.184.216.34", "public"], ["2606:4700::1111", "public"],
  ])("%s -> %s", (ip, cls) => {
    expect(classifyIp(ip)).toBe(cls);
  });
});

describe("parseIntegrationUrl", () => {
  it("normaliza e aceita http/https com porta", () => {
    expect(parseIntegrationUrl("https://Evo.Example.com/").url).toBe("https://evo.example.com");
    expect(parseIntegrationUrl("http://localhost:8080/api/").url).toBe("http://localhost:8080/api");
  });
  it.each([
    ["ftp://a.com"], ["javascript:alert(1)"], ["https://user:pw@a.com"], ["https://a.com#x"], ["https://a.com/?k=1"], ["nao-url"], ["https://a.com:0"], ["https://a.com:99999"], ["https://"],
  ])("rejeita %s", (u) => {
    expect(() => parseIntegrationUrl(u)).toThrow();
  });
});

describe("assertAllowedHost", () => {
  const resolveTo = (map: Record<string, string[]>) => _setIntegrationResolver(async (h) => {
    if (!map[h]) throw new Error("nx");
    return map[h];
  });
  it("metadados SEMPRE bloqueados (mesmo com allowPrivateHost)", async () => {
    resolveTo({ "meta.example.com": ["169.254.169.254"], "mix.example.com": ["93.184.216.34", "169.254.169.254"] });
    await expect(assertAllowedHost("169.254.169.254", true)).rejects.toThrow(/sempre bloqueado/);
    await expect(assertAllowedHost("meta.example.com", true)).rejects.toThrow(/sempre bloqueado/);
    await expect(assertAllowedHost("mix.example.com", true)).rejects.toThrow(/sempre bloqueado/);
    await expect(assertAllowedHost("metadata.google.internal", true)).rejects.toThrow(/sempre bloqueado/);
    await expect(assertAllowedHost("fd00:ec2::254", true)).rejects.toThrow(/sempre bloqueado/);
  });
  it("ALLOW_PRIVATE_SMTP_HOSTS não afrouxa nada", async () => {
    process.env.ALLOW_PRIVATE_SMTP_HOSTS = "true";
    try {
      await expect(assertAllowedHost("169.254.169.254", false)).rejects.toThrow();
      await expect(assertAllowedHost("127.0.0.1", false)).rejects.toThrow(/instância própria/);
    } finally {
      delete process.env.ALLOW_PRIVATE_SMTP_HOSTS;
    }
  });
  it("localhost/privado só com allowPrivateHost; DNS que resolve para IP interno é bloqueado", async () => {
    resolveTo({ "evo.example.com": ["10.0.0.5"], "pub.example.com": ["93.184.216.34"] });
    await expect(assertAllowedHost("127.0.0.1", false)).rejects.toThrow(/instância própria/);
    await expect(assertAllowedHost("evo.example.com", false)).rejects.toThrow(/instância própria/);
    await expect(assertAllowedHost("evo.example.com", true)).resolves.toMatchObject({ ip: "10.0.0.5", family: 4 });
    await expect(assertAllowedHost("::1", true)).resolves.toMatchObject({ family: 6 });
    await expect(assertAllowedHost("pub.example.com", false)).resolves.toMatchObject({ ip: "93.184.216.34" });
  });
  it("DNS falho -> erro PT-BR genérico", async () => {
    resolveTo({});
    await expect(assertAllowedHost("nx.example.com", false)).rejects.toThrow(/Não foi possível conectar/);
  });
  it("maskHost", () => {
    expect(maskHost("evolution.example.com")).toBe("ev***.example.com");
    expect(maskHost("10.1.2.3")).toBe("10.*.*.*");
    expect(maskHost("localhost")).toBe("lo***");
  });
  it("cleanup", () => _setIntegrationResolver(null));
});

describe("SSRF QA: IPv6 embutido, formas alternativas de IPv4, faixas reservadas", () => {
  const blocked = [
    "::127.0.0.1", "::7f00:1", "::a9fe:a9fe", "::169.254.169.254",
    "64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b:1::a9fe:a9fe", "64:ff9b:1:0:0:0:7f00:1",
    "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:0:a9fe:a9fe", "::ffff:0:7f00:1",
    "2002:a9fe:a9fe::", "2002:7f00:1::", "2002:0a00:0001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::1",
    "fec0::1", "fec0:0:0:1::5", "fe80::1", "ff02::1", "fd00:ec2::254", "0:0:0:0:0:0:0:0",
    "192.0.0.1", "192.0.0.170", "198.18.0.1", "198.19.255.255", "100.64.0.1", "100.127.255.255", "100.100.100.200",
    "240.0.0.1", "255.255.255.255", "224.0.0.1", "239.1.1.1", "0.0.0.0", "0.1.2.3", "169.254.169.254",
    "0x7f.1", "2130706433", "0177.0.0.1", "0xa9fea9fe", "2852039166",
  ];
  const privateOk = ["127.0.0.1", "::1", "10.0.0.1", "172.16.5.5", "192.168.0.10", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1"];
  const publicOk = ["8.8.8.8", "2606:4700:4700::1111", "93.184.216.34", "2001:4860:4860::8888", "64:ff9b::808:808", "2002:0808:0808::"];
  // formas numéricas alternativas: classifyIp normaliza; as privadas viram "private", as reservadas "blocked"
  it.each(blocked.filter((ip) => !["0x7f.1", "2130706433", "0177.0.0.1"].includes(ip)))("classifyIp bloqueia %s", (ip) => {
    expect(classifyIp(ip)).toBe("blocked");
  });
  it.each(["0x7f.1", "2130706433", "0177.0.0.1"])("forma alternativa %s = loopback (private)", (ip) => {
    expect(classifyIp(ip)).toBe("private");
  });
  it.each(privateOk)("%s é private", (ip) => expect(classifyIp(ip)).toBe("private"));
  it.each(publicOk)("%s é public", (ip) => expect(classifyIp(ip)).toBe("public"));

  it("assertAllowedHost bloqueia TUDO acima mesmo com allowPrivateHost=true (exceto loopback/privados legítimos)", async () => {
    _setIntegrationResolver(async () => { throw new Error("não deveria resolver IP literal"); });
    for (const ip of blocked) {
      const isLoopbackAlt = ["0x7f.1", "2130706433", "0177.0.0.1"].includes(ip);
      for (const h of [ip, `[${ip}]`]) {
        if (isLoopbackAlt) {
          await expect(assertAllowedHost(h, false)).rejects.toThrow(/instância própria/);
          await expect(assertAllowedHost(h, true)).resolves.toMatchObject({ ip: "127.0.0.1" });
        } else if (ip.includes(":") || !h.startsWith("[")) {
          await expect(assertAllowedHost(h, true), h).rejects.toThrow(/sempre bloqueado/);
        }
      }
    }
    _setIntegrationResolver(null);
  });
  it("URLs completas com IPv6 embutido / formas alternativas passam pelo parse e são bloqueadas", async () => {
    for (const u of ["http://[::127.0.0.1]/", "http://[64:ff9b::a9fe:a9fe]:8080", "http://[2002:a9fe:a9fe::]", "http://[::ffff:0:a9fe:a9fe]", "http://2852039166/", "http://0xa9.0xfe.0xa9.0xfe/", "http://[fec0::1]/"]) {
      await expect(assertAllowedHost(parseIntegrationUrl(u).hostname, true), u).rejects.toThrow(/sempre bloqueado/);
    }
    await expect(assertAllowedHost(parseIntegrationUrl("http://0177.0.0.1:8080").hostname, false)).rejects.toThrow(/instância própria/);
  });
  it("hostname com ponto final é normalizado (metadados e localhost)", async () => {
    _setIntegrationResolver(async () => ["93.184.216.34"]);
    for (const h of ["metadata.google.internal.", "metadata.google.internal..", "METADATA.GOOGLE.INTERNAL.", "metadata.goog."]) {
      await expect(assertAllowedHost(h, true), h).rejects.toThrow(/sempre bloqueado/);
    }
    await expect(assertAllowedHost("localhost.", false)).rejects.toThrow(/instância própria/);
    await expect(assertAllowedHost("localhost.", true)).resolves.toMatchObject({ ip: "127.0.0.1" });
    expect(parseIntegrationUrl("http://localhost./x").hostname).toBe("localhost");
    _setIntegrationResolver(null);
  });
  it("IP RESOLVIDO é reclassificado da mesma forma (DNS devolvendo IPv6 embutido de metadados)", async () => {
    for (const ip of ["::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::", "::a9fe:a9fe", "::ffff:0:a9fe:a9fe", "100.100.100.200", "fd00:ec2::254"]) {
      _setIntegrationResolver(async () => ["93.184.216.34", ip]);
      await expect(assertAllowedHost("x.exemplo.com", true), ip).rejects.toThrow(/sempre bloqueado/);
    }
    _setIntegrationResolver(async () => ["8.8.8.8", "2606:4700:4700::1111"]);
    await expect(assertAllowedHost("x.exemplo.com", false)).resolves.toMatchObject({ ip: "8.8.8.8" });
    _setIntegrationResolver(null);
  });
  it("IPs públicos legítimos passam", async () => {
    for (const ip of ["8.8.8.8", "2606:4700:4700::1111", "93.184.216.34"]) await expect(assertAllowedHost(ip, false)).resolves.toBeTruthy();
  });
  it("DNS que falha: mensagem única (sem oráculo)", async () => {
    _setIntegrationResolver(async () => { throw new Error("ENOTFOUND"); });
    await expect(assertAllowedHost("nx.exemplo.com", true)).rejects.toThrow(/Não foi possível conectar ao servidor informado/);
    _setIntegrationResolver(null);
  });
});
