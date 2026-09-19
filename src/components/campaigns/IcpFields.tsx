"use client";
import { Input } from "@/components/ui/input";
import type { FieldErrors } from "@/lib/actions/result";
import { Field } from "./Field";
import { fieldError, type IcpValues } from "./form-utils";

/** Campos do ICP; `prefix` casa com as chaves de erro ("icp." inline, "" na gestão). */
export function IcpFields({
  idPrefix,
  prefix,
  values,
  onChange,
  errors,
}: {
  idPrefix: string;
  prefix: string;
  values: IcpValues;
  onChange: (v: IcpValues) => void;
  errors?: FieldErrors;
}) {
  const set = (k: keyof IcpValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...values, [k]: e.target.value });
  const err = (k: keyof IcpValues) => fieldError(errors, `${prefix}${k}`);
  const text = (k: keyof IcpValues, label: string, opts: { required?: boolean; hint?: string; placeholder?: string }) => (
    <Field id={`${idPrefix}-${k}`} label={label} error={err(k)} required={opts.required} hint={opts.hint}>
      {(a) => <Input {...a} value={values[k]} onChange={set(k)} placeholder={opts.placeholder} />}
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
