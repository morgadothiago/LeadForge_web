import { describe, expect, it } from "vitest";
import { ariaSort, buildLeadsQuery, formatPhone, maskBrPhone, nextSort, pageRange, relativeTime } from "./lead-format";

describe("buildLeadsQuery", () => {
  it("ignora vazios e aplica overrides", () => {
    expect(buildLeadsQuery({ q: " ana ", stage: "", page: "3" }, { page: 1 })).toBe("?q=ana&page=1");
    expect(buildLeadsQuery({})).toBe("");
    expect(buildLeadsQuery({ q: ["a", "b"] }, { sort: "name", dir: "asc", page: null })).toBe("?q=a&sort=name&dir=asc");
  });
});
describe("sort", () => {
  it("alterna direção", () => {
    expect(nextSort({ sort: "score", dir: "desc" }, "score")).toEqual({ sort: "score", dir: "asc" });
    expect(nextSort({ sort: "score", dir: "desc" }, "name")).toEqual({ sort: "name", dir: "asc" });
    expect(nextSort({ sort: "name", dir: "asc" }, "createdAt")).toEqual({ sort: "createdAt", dir: "desc" });
  });
  it("aria-sort", () => {
    expect(ariaSort({ sort: "name", dir: "asc" }, "name")).toBe("ascending");
    expect(ariaSort({ sort: "name", dir: "asc" }, "score")).toBe("none");
  });
});
describe("maskBrPhone", () => {
  it("máscara progressiva", () => {
    expect(maskBrPhone("")).toBe("");
    expect(maskBrPhone("11")).toBe("(11");
    expect(maskBrPhone("119123")).toBe("(11) 9123");
    expect(maskBrPhone("11912345678")).toBe("(11) 91234-5678");
    expect(maskBrPhone("+5511912345678")).toBe("(11) 91234-5678");
    expect(maskBrPhone("119123456789999")).toBe("(11) 91234-5678");
  });
  it("formatPhone", () => {
    expect(formatPhone("+5511912345678")).toBe("(11) 91234-5678");
    expect(formatPhone(null)).toBe("");
  });
});
describe("relativeTime / pageRange", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  it("relativo", () => {
    expect(relativeTime(new Date("2026-01-10T11:59:40Z"), now)).toBe("agora");
    expect(relativeTime(new Date("2026-01-07T12:00:00Z"), now)).toBe("há 3 dias");
    expect(relativeTime(new Date("2026-01-10T14:00:00Z"), now)).toBe("em 2 horas");
  });
  it("faixa", () => {
    expect(pageRange(2, 20, 45)).toEqual({ from: 21, to: 40 });
    expect(pageRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });
});
