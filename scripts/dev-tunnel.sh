#!/usr/bin/env bash
# Sobe o túnel Cloudflare para o dev local, grava o endereço novo no .env e recria o webhook de dev do AbacatePay.
#
# Uso:   bash scripts/dev-tunnel.sh [--dev] [--no-webhook]
#   --dev         também sobe `npm run dev` (já com o .env atualizado) e derruba tudo no Ctrl+C.
#   --no-webhook  não mexe no AbacatePay (só túnel + .env).
#
# O que faz: 1) cloudflared tunnel --url http://localhost:3000  2) lê o https://*.trycloudflare.com
# 3) atualiza AUTH_URL e APP_BASE_URL no .env  4) recria o webhook `leadforge-dev` (modo teste) com o endereço novo.
# Sem --dev: reinicie o `npm run dev` depois (o Next só lê o .env ao subir). Deixe este terminal aberto: fechar derruba o túnel.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
RUN_DEV=0
RUN_WEBHOOK=1
for arg in "$@"; do
  case "$arg" in
    --dev) RUN_DEV=1 ;;
    --no-webhook) RUN_WEBHOOK=0 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

command -v cloudflared >/dev/null || { echo "cloudflared não encontrado (brew install cloudflared)." >&2; exit 1; }
[ -f .env ] || { echo ".env não encontrado na raiz do projeto." >&2; exit 1; }

LOG="$(mktemp -t leadforge-tunnel.XXXXXX)"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

echo "Subindo o túnel para http://localhost:$PORT ..."
cloudflared tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
PIDS+=($!)

URL=""
for _ in $(seq 1 40); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "Não consegui obter o endereço do túnel. Log:" >&2; tail -20 "$LOG" >&2; exit 1; }
echo "Túnel: $URL"

# Atualiza (ou cria) uma chave do .env sem imprimir outros valores.
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
  else
    printf '\n%s=%s\n' "$key" "$val" >>.env
  fi
}
set_env AUTH_URL "$URL"
set_env APP_BASE_URL "$URL"
echo ".env atualizado: AUTH_URL e APP_BASE_URL."

if [ "$RUN_WEBHOOK" -eq 1 ]; then
  if grep -q '^PAYMENT_PROVIDER=abacatepay' .env; then
    node scripts/abacatepay-webhook.mjs || echo "AVISO: não consegui recriar o webhook (veja o erro acima). Recadastre no painel." >&2
  else
    echo "PAYMENT_PROVIDER não é abacatepay; webhook não alterado."
  fi
fi

if [ "$RUN_DEV" -eq 1 ]; then
  echo "Subindo npm run dev (Ctrl+C derruba o dev e o túnel) ..."
  npm run dev &
  PIDS+=($!)
else
  echo "Pronto. Reinicie o 'npm run dev' para ele ler o .env novo. Mantenha este terminal aberto (Ctrl+C derruba o túnel)."
fi

wait
