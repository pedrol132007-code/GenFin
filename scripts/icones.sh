#!/usr/bin/env bash
# Gera os PNGs do app instalável (icons/) a partir dos SVGs de docs/logo.
# Uso: npm run icones   (rode npm run logo antes se o ícone mudou)
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SAIDA="$RAIZ/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

NAVEGADOR="${NAVEGADOR:-}"
if [ -z "$NAVEGADOR" ]; then
  for c in "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
           "/c/Program Files/Google/Chrome/Application/chrome.exe" \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "$(command -v google-chrome || true)" "$(command -v chromium || true)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then NAVEGADOR="$c"; break; fi
  done
fi
[ -n "$NAVEGADOR" ] || { echo "Chrome ou Edge não encontrado. Defina NAVEGADOR." >&2; exit 1; }
caminho(){ if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

png(){ # svg nome lado
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx}</style><img src="file:///%s">' \
    "$3" "$3" "$(caminho "$RAIZ/docs/logo/$1")" > "$TMP/$2.html"
  "$NAVEGADOR" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size="$3,$3" --user-data-dir="$TMP/perfil" \
    --screenshot="$(caminho "$SAIDA/$2.png")" "file:///$(caminho "$TMP/$2.html")" 2>/dev/null
  echo "  icons/$2.png"
}

mkdir -p "$SAIDA"
echo "Gerando ícones:"
png icone.svg          icon-192          192
png icone.svg          icon-512          512
png icone-maskable.svg icon-maskable-512 512
# O iPhone arredonda o ícone sozinho e não aceita transparência: usa o quadrado cheio
png icone-maskable.svg apple-touch-icon  180
