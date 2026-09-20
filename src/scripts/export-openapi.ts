import { writeFileSync } from "node:fs";
import { spec } from "@/lib/openapi";

// SPEC-021: exporta o contrato mobile versionado (o app gera tipos a partir dele). Uso: npm run openapi:export [saida]
const out = process.argv[2] ?? "openapi.json";
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log(`openapi exportado em ${out}`);
