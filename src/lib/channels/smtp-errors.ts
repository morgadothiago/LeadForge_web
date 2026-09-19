import { AppError } from "@/lib/errors";

/** Normaliza erro de Nodemailer/SMTP em AppError PT-BR. Nunca inclui host, usuário, senha ou resposta crua na mensagem. */
export function normalizeSmtpError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = (e ?? {}) as { code?: string; responseCode?: number };
  const rc = typeof err.responseCode === "number" ? err.responseCode : undefined;
  const mk = (code: AppError["code"], userMessage: string, retryable: boolean) =>
    new AppError({ code, userMessage, retryable, status: rc, cause: e });
  switch (err.code) {
    case "EAUTH":
      return mk("unauthorized", "Falha de autenticação no servidor de e-mail. Verifique usuário e senha da conta.", false);
    case "ETIMEDOUT":
    case "ESOCKET_TIMEDOUT":
      return mk("timeout", "O servidor de e-mail demorou demais para responder. Tente novamente.", true);
    case "ECONNECTION":
    case "ESOCKET":
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "ENOTFOUND":
    case "EDNS":
      return mk("network", "Não foi possível conectar ao servidor de e-mail. Verifique host e porta.", true);
    case "EENVELOPE":
      return mk("validation", "Endereço de destinatário ou remetente recusado pelo servidor de e-mail.", false);
    case "EMESSAGE":
      return mk("upstream", "A mensagem foi rejeitada pelo servidor de e-mail.", rc !== undefined && rc >= 400 && rc < 500);
  }
  if (rc !== undefined && rc >= 400 && rc < 500) return mk("upstream", "O servidor de e-mail recusou temporariamente o envio. Tente novamente mais tarde.", true);
  if (rc !== undefined && rc >= 500) return mk("upstream", "O servidor de e-mail recusou o envio.", false);
  return mk("unknown", "Não foi possível enviar o e-mail.", false);
}
