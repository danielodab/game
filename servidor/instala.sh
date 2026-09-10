#!/usr/bin/env bash
# =============================================================================
# SOTERRA — instala (ou atualiza) tudo num VPS Ubuntu: o jogo, o site, o Relé,
# a API de contas e o Caddy (HTTPS automático). Roda NO VPS, como root, de
# dentro do pacote que tools/sobe_vps.py mandou (ou de um clone do repositório):
#
#     bash servidor/instala.sh SEU-DOMINIO
#
# SEU-DOMINIO é o endereço que vai abrir o jogo: um domínio seu já apontado
# para o IP do VPS (ex.: jogo.seudominio.com.br) ou, sem domínio ainda, o nome
# que a Hostinger dá ao VPS (hPanel → VPS → Visão geral → Hostname, algo como
# srv123456.hstgr.cloud). O Caddy tira o certificado HTTPS sozinho.
#
# Pode rodar quantas vezes quiser: rodar de novo ATUALIZA jogo, site, API e
# relé. O banco (/var/lib/soterra) nunca é tocado.
# =============================================================================
set -euo pipefail

DOMINIO="${1:-}"
if [ -z "$DOMINIO" ] || ! printf '%s' "$DOMINIO" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
  echo "uso: bash servidor/instala.sh SEU-DOMINIO   (ex.: jogo.seudominio.com.br)"
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "rode como root (ou: sudo bash servidor/instala.sh $DOMINIO)"
  exit 1
fi
if [ ! -r /etc/os-release ] || ! grep -Eq '^ID(_LIKE)?=.*(ubuntu|debian)' /etc/os-release; then
  echo "este instalador é para Ubuntu (ou Debian)"
  exit 1
fi

PACOTE="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/soterra
OPT=/opt/soterra
if [ ! -f "$PACOTE/index.html" ] || [ ! -f "$PACOTE/servidor/api.py" ]; then
  echo "não achei o jogo em $PACOTE (rode de dentro do pacote: bash servidor/instala.sh ...)"
  exit 1
fi

passo() { printf '\n== %s\n' "$*"; }

passo "1/6 dependências (python3, websockets, sqlite3, rsync, cron, Caddy)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3 python3-websockets sqlite3 rsync cron curl ca-certificates gnupg
if ! command -v caddy >/dev/null 2>&1; then
  # o repositório OFICIAL do Caddy (caddyserver.com/docs/install): o Ubuntu
  # 22.04 não tem o pacote, e o do 24.04 é uma versão de 2022
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

passo "2/6 o jogo e o site em $WEB"
mkdir -p "$WEB"
if [ "$PACOTE" != "$WEB" ]; then
  # o que não é para a web fica de fora (vale também para um clone do git)
  rsync -a --delete \
    --exclude '/servidor/' --exclude '/.git/' --exclude '/tests/' --exclude '/tools/' \
    --exclude '/docs/' --exclude '/.claude/' --exclude '/unity/' \
    --exclude '/assets/embedded/models-*' --exclude '/assets/embedded/env-kit*' \
    --exclude '/assets/embedded/muro-*' \
    "$PACOTE"/ "$WEB"/
fi
chmod -R u=rwX,go=rX "$WEB"

passo "3/6 o Relé e a API (systemd)"
id soterra >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin soterra
mkdir -p "$OPT"
install -m 0644 "$PACOTE/servidor/rele.py" "$PACOTE/servidor/api.py" "$OPT/"
install -m 0644 "$PACOTE/servidor/soterra-rele.service" "$PACOTE/servidor/soterra-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable soterra-rele soterra-api >/dev/null 2>&1
systemctl restart soterra-rele soterra-api

passo "4/6 o Caddy para https://$DOMINIO"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'SOTERRA' /etc/caddy/Caddyfile && [ ! -f /etc/caddy/Caddyfile.antes-do-soterra ]; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.antes-do-soterra
fi
sed "s/jogo\.exemplo\.com\.br/$DOMINIO/g" "$PACOTE/servidor/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "  ufw ligado neste VPS: 80 e 443 liberadas"
fi

passo "5/6 o backup diário do banco (/var/backups/soterra, 14 dias)"
cat > /etc/cron.daily/soterra-backup <<'CRON'
#!/bin/sh
# SOTERRA: uma cópia do banco por dia, as últimas 14 guardadas (feito pelo instala.sh)
set -e
[ -f /var/lib/soterra/soterra.db ] || exit 0
mkdir -p /var/backups/soterra
chmod 700 /var/backups/soterra
sqlite3 /var/lib/soterra/soterra.db ".backup /var/backups/soterra/soterra-$(date +%F).db"
find /var/backups/soterra -name 'soterra-*.db' -mtime +14 -delete
CRON
chmod 0755 /etc/cron.daily/soterra-backup

passo "6/6 conferindo"
sleep 2
ok=1
for s in soterra-rele soterra-api caddy; do
  if systemctl is-active --quiet "$s"; then
    echo "  $s: de pé"
  else
    echo "  $s: CAIU — últimas linhas do log:"
    journalctl -u "$s" -n 15 --no-pager || true
    ok=0
  fi
done
if curl -fsS --max-time 5 http://127.0.0.1:8300/api/saude >/dev/null; then
  echo "  a API responde em /api/saude"
else
  echo "  a API NÃO respondeu em 127.0.0.1:8300"
  ok=0
fi
RESOLVE="$(getent ahostsv4 "$DOMINIO" 2>/dev/null | awk 'NR==1 {print $1}')"
MEUS="$(hostname -I 2>/dev/null || true)"
if [ -z "$RESOLVE" ]; then
  echo "  AVISO: $DOMINIO ainda não existe no DNS — o HTTPS sai sozinho quando existir"
elif ! printf ' %s ' $MEUS | grep -q " $RESOLVE "; then
  echo "  AVISO: $DOMINIO aponta para $RESOLVE, mas este VPS é: $MEUS — acerte o registro A"
else
  echo "  DNS: $DOMINIO aponta para este VPS"
fi

echo
if [ "$ok" = 1 ]; then
  echo "Pronto. O site:  https://$DOMINIO"
  echo "        O jogo:  https://$DOMINIO/index.html"
  echo "O certificado HTTPS sai no primeiro acesso (até um minuto). Se não abrir:"
  echo "  journalctl -u caddy -n 50 --no-pager"
else
  echo "Algo não subiu — veja as linhas acima."
  exit 1
fi
