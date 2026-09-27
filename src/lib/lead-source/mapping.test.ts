import { describe, expect, it } from "vitest";
import { extractContact, fieldsFromGoogleUserColumnData, fieldsFromMetaFieldData } from "./mapping";

describe("mapeamento de campos (D-041-2: fixo, extra -> rawData)", () => {
  it("Google: user_column_data conhecido vira campo padrão; resto vira rawData", () => {
    const fields = fieldsFromGoogleUserColumnData([
      { column_id: "FULL_NAME", column_name: "Full name", string_value: "Ana Souza" },
      { column_id: "EMAIL", column_name: "Email", string_value: "Ana@Example.com" },
      { column_id: "PHONE_NUMBER", column_name: "Phone", string_value: "11 91234-5678" },
      { column_id: "COMPANY_NAME", column_name: "Company", string_value: "Acme" },
      { column_id: "JOB_TITLE", column_name: "Job title", string_value: "CTO" },
    ]);
    const c = extractContact(fields);
    expect(c.name).toBe("Ana Souza");
    expect(c.email).toBe("ana@example.com");
    expect(c.phone).toBe("+5511912345678");
    expect(c.company).toBe("Acme");
    expect(c.rawData).toEqual({ JOB_TITLE: "CTO" });
  });

  it("Google: telefone que não normaliza para BR vai pro rawData bruto, sem derrubar o lead", () => {
    const fields = fieldsFromGoogleUserColumnData([
      { column_id: "FULL_NAME", string_value: "John Doe" },
      { column_id: "PHONE_NUMBER", string_value: "+1 415-555-0100" },
    ]);
    const c = extractContact(fields);
    expect(c.phone).toBeNull();
    expect(c.rawData.PHONE_NUMBER).toBe("+1 415-555-0100");
  });

  it("Meta: field_data conhecido vira campo padrão; resto vira rawData", () => {
    const fields = fieldsFromMetaFieldData([
      { name: "full_name", values: ["Bruno Lima"] },
      { name: "email", values: ["bruno@example.com"] },
      { name: "phone_number", values: ["+5511987654321"] },
      { name: "city", values: ["São Paulo"] },
    ]);
    const c = extractContact(fields);
    expect(c.name).toBe("Bruno Lima");
    expect(c.email).toBe("bruno@example.com");
    expect(c.phone).toBe("+5511987654321");
    expect(c.rawData).toEqual({ city: "São Paulo" });
  });

  it("sem nome (só first/last) combina; sem nenhum -> 'Lead sem nome'", () => {
    expect(extractContact([{ key: "first_name", value: "Carla" }, { key: "last_name", value: "Reis" }]).name).toBe("Carla Reis");
    expect(extractContact([{ key: "city", value: "SP" }]).name).toBe("Lead sem nome");
  });

  it("e-mail inválido não vira campo padrão (vai pro rawData)", () => {
    const c = extractContact([{ key: "email", value: "nao-e-email" }]);
    expect(c.email).toBeNull();
    expect(c.rawData.email).toBe("nao-e-email");
  });

  it("entradas malformadas (não-array, item sem string_value/values) são ignoradas sem lançar", () => {
    expect(fieldsFromGoogleUserColumnData(null)).toEqual([]);
    expect(fieldsFromGoogleUserColumnData([{ column_id: "X" }, "not-an-object", 42])).toEqual([]);
    expect(fieldsFromMetaFieldData(undefined)).toEqual([]);
    expect(fieldsFromMetaFieldData([{ name: "x", values: [] }, { name: "y" }])).toEqual([]);
  });
});
