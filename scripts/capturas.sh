#!/usr/bin/env bash
# Gera as capturas de tela do README a partir dos dados de exemplo do app.
# Uso: npm run capturas   (defina NAVEGADOR para apontar outro Chrome/Edge)
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SAIDA="$RAIZ/docs/img"
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

# Caminhos no formato que o navegador entende (Windows precisa de C:/...)
caminho(){ if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

# Abre o app no modo exemplo, na aba e no tema pedidos, sem a faixa de aviso
preparar(){ # arquivo aba tema
  sed "s#</body>#<script>document.documentElement.dataset.theme='$3';aporteRebal='5.000,00';entrarDemo();irPara('$2');document.getElementById('aviso-demo').classList.add('oculto');</script></body>#" \
    "$RAIZ/carteira.html" > "$TMP/$1.html"
}
capturar(){ # nome largura altura pagina
  "$NAVEGADOR" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=4000 --window-size="$2,$3" --user-data-dir="$TMP/perfil" \
    --screenshot="$(caminho "$SAIDA/$1.png")" "file:///$(caminho "$4")" 2>/dev/null
  echo "  $1.png"
}

mkdir -p "$SAIDA"
echo "Gerando capturas em docs/img:"
while read -r nome aba tema larg alt; do
  preparar "$nome" "$aba" "$tema"
  capturar "$nome" "$larg" "$alt" "$TMP/$nome.html"
done <<'LISTA'
resumo resumo light 1280 1080
resumo-escuro resumo dark 1280 1080
analises analises light 1280 1500
ativos ativos light 1280 820
proventos proventos light 1280 900
rebalancear rebalancear light 1280 900
ir ir light 1280 1000
LISTA

# O headless tem largura mínima de janela; o celular vai num iframe de 390px
preparar celular-app resumo light
printf '<!doctype html><body style="margin:0;background:#EEF2EF"><iframe src="celular-app.html" style="border:0;width:390px;height:844px;display:block"></iframe></body>' > "$TMP/celular.html"
capturar celular 390 844 "$TMP/celular.html"

# Prévia social do repositório (1280x640), com o logo e a frase do README
cat > "$TMP/social.html" <<HTML
<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:1280px;height:640px;background:#EEF2EF;overflow:hidden}
body{display:flex;flex-direction:column;justify-content:center;padding:0 120px;box-sizing:border-box;font-family:"Bricolage Grotesque",sans-serif;color:#16232B}
img{width:720px;display:block}
p{font-size:38px;line-height:1.25;letter-spacing:-.015em;margin:44px 0 0;max-width:24ch;font-weight:500}
span{display:block;color:#5A6970;font-size:24px;font-weight:400;margin-top:18px;letter-spacing:0}
</style>
<img src="file:///$(caminho "$RAIZ/docs/logo/genfin.svg")">
<p>Sua carteira de investimentos num arquivo só.<span>Preço médio, alocação, proventos, rebalanceamento e imposto de renda.</span></p>
HTML
"$NAVEGADOR" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=4000 --window-size=1280,640 --user-data-dir="$TMP/perfil" \
  --screenshot="$(caminho "$RAIZ/docs/logo/social.png")" "file:///$(caminho "$TMP/social.html")" 2>/dev/null
echo "  ../logo/social.png"
