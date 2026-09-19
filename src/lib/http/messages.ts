import type { AppErrorCode } from "@/lib/errors";

/** Mensagens PT-BR seguras por código e pelo NOME da integração (nunca corpo/headers/segredos). */
export function messageFor(code: AppErrorCode, name: string, retryAfterSeconds?: number): string {
  switch (code) {
    case "rate_limited":
      return retryAfterSeconds
        ? `${name} recebeu requisições demais. Tente novamente em ${retryAfterSeconds}s.`
        : `${name} recebeu requisições demais. Aguarde um instante e tente novamente.`;
    case "timeout":
      return `${name} demorou para responder. Tente novamente em instantes.`;
    case "network":
      return `Não foi possível conectar a ${name}. Verifique a conexão ou a configuração e tente novamente.`;
    case "unauthorized":
      return `Credenciais de ${name} inválidas ou expiradas. Verifique a configuração.`;
    case "forbidden":
      return `Sem permissão para executar esta operação em ${name}.`;
    case "not_found":
      return `Recurso não encontrado em ${name}.`;
    case "conflict":
      return `Conflito ao processar a solicitação em ${name}.`;
    case "validation":
      return `${name} rejeitou os dados enviados. Revise as informações e tente novamente.`;
    case "upstream":
      return `${name} está com instabilidade no momento. Tente novamente em instantes.`;
    default:
      return `Falha inesperada ao comunicar com ${name}. Tente novamente.`;
  }
}
