/** Resposta 429 para Route Handlers próprios: JSON PT-BR + header Retry-After. */
export function tooManyRequests(retryAfterSeconds = 30): Response {
  const secs = Math.max(1, Math.ceil(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30));
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: `Muitas requisições. Tente novamente em ${secs}s.`,
      retryAfterSeconds: secs,
    }),
    { status: 429, headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(secs) } },
  );
}
