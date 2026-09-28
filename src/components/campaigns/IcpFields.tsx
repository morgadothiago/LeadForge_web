"use client";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Field } from "./Field";
import { rhfErrorAt, type IcpValues } from "./form-utils";

/**
 * Campos do ICP registrados no react-hook-form do formulário-pai (SPEC-043).
 * `prefix` monta o nome do campo registrado: "icp." no create da campanha (schema aninhado),
 * "" no diálogo de gestão de ICP (chaves planas).
 */
export function IcpFields({
  idPrefix,
  prefix,
  register,
  errors,
}: {
  idPrefix: string;
  prefix: string;
  register: (name: string) => UseFormRegisterReturn;
  errors: unknown;
}) {
  const name = (k: keyof IcpValues) => `${prefix}${k}`;
  const err = (k: keyof IcpValues) => rhfErrorAt(errors, ...(prefix ? [prefix.replace(/\.$/, "")] : []), k as string);
  const text = (k: keyof IcpValues, label: string, opts: { required?: boolean; hint?: string; placeholder?: string }) => (
    <Field id={`${idPrefix}-${k}`} label={label} error={err(k)} required={opts.required} hint={opts.hint}>
      {(a) => <Input {...a} {...register(name(k))} placeholder={opts.placeholder} />}
    </Field>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {text("name", "Nome do ICP", { required: true, placeholder: "Ex.: Escritórios de advocacia SP" })}
      {text("niche", "Nicho", { required: true, placeholder: "Ex.: Advocacia" })}
      {text("location", "Local", { placeholder: "Ex.: São Paulo, SP" })}
      {text("companySize", "Porte", { placeholder: "Ex.: 2 a 10 funcionários" })}
      {text("signals", "Sinais", { hint: "Separe por vírgula. Ex.: site desatualizado, sem WhatsApp" })}
      {text("keywords", "Palavras-chave", { hint: "Separe por vírgula." })}
      {text("sources", "Fontes", { hint: "Separe por vírgula. Ex.: Google Maps, LinkedIn" })}
      {text("desiredData", "Dados desejados", { hint: "Separe por vírgula. Ex.: email, telefone" })}
    </div>
  );
}
