#!/bin/sh
# =============================================================================
# SOTERRA no Coolify: o que roda dentro do contêiner.
#   - a API de contas e o Relé, cada um num laço que o faz renascer se cair,
#     rodando como o usuário soterra (sem root);
#   - o Caddy de dentro, em primeiro plano: é ele que o Coolify vigia.
#
# O banco mora em /dados, que TEM de ser um volume persistente do Coolify
# (Persistent Storage com destino /dados). Sem ele, as contas e os saves de
# todo mundo sumiriam no próximo deploy — por isso o contêiner se recusa a
# subir. SOTERRA_SEM_VOLUME=1 libera, só para testar com `docker run`.
# =============================================================================
set -eu

DADOS=/dados
if ! grep -qs " $DADOS " /proc/mounts; then
  if [ "${SOTERRA_SEM_VOLUME:-}" = "1" ]; then
    echo "[soterra] AVISO: $DADOS não é um volume — o banco some quando o contêiner sair (modo de teste)" >&2
  else
    echo "[soterra] ERRO: $DADOS não é um volume persistente." >&2
    echo "[soterra] No Coolify: na aplicação, Persistent Storage, adicione um volume com destino $DADOS e faça Redeploy." >&2
    echo "[soterra] Sem isso as contas e os saves se perderiam no próximo deploy, então o contêiner não sobe." >&2
    exit 1
  fi
fi
mkdir -p "$DADOS/backups"
chown -R soterra:soterra "$DADOS"

vigia() {
  nome="$1"
  shift
  while true; do
    su-exec soterra "$@" || true
    echo "[soterra] $nome caiu — renasce em 2 s" >&2
    sleep 2
  done
}

# o JUIZ (12/09): as regras do jogo em Node, só no 127.0.0.1; a API fala com ele
vigia juiz node    /app/servidor/juiz/juiz.js --host 127.0.0.1 --porta 8792 --raiz /srv/soterra &
vigia api  python3 /app/servidor/api.py  --host 127.0.0.1 --porta 8300 --banco "$DADOS/soterra.db" --juiz http://127.0.0.1:8792 &
vigia rele python3 /app/servidor/rele.py --host 127.0.0.1 --porta 8791 --banco "$DADOS/soterra.db" &

exec caddy run --config /app/servidor/coolify/Caddyfile --adapter caddyfile
