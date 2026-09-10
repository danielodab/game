#!/usr/bin/env bash
# =============================================================================
# SOTERRA — instala (ou atualiza) tudo num VPS Ubuntu: o jogo, o site, o Relé,
# a API de contas e o Caddy (HTTPS automático). Roda NO VPS, como root, de
# dentro do pacote que tools/sobe_vps.py mandou (ou de um clone do repositório):
#
#     bash servidor/instala.sh ENDERECO [OUTROS-NOMES...]
#
# ENDERECO é por onde o jogo vai abrir:
#   - um domínio seu já apontado para o IP do VPS (jogo.seudominio.com.br);
#   - sem domínio ainda, o hostname que a Hostinger dá ao VPS (hPanel → VPS →
#     Visão geral, algo como srv123456.hstgr.cloud) — HTTPS de verdade também;
#   - ou o próprio IP: funciona, mas SEM HTTPS (sem cadeado). Provisório.
# OUTROS-NOMES levam ao principal (ex.: www.seudominio.com.br). Um endereço só
# importa: o site e o jogo guardam a sessão por endereço.
#
# Pode rodar quantas vezes quiser: rodar de novo ATUALIZA jogo, site, API e
# relé. O banco (/var/lib/soterra) nunca é tocado.
# =============================================================================
set -euo pipefail

RE_NOME='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
RE_IP='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
uso() {
  echo "uso: bash servidor/instala.sh ENDERECO [OUTROS-NOMES...]"
  echo "  ex.: bash servidor/instala.sh jogo.seudominio.com.br"
  echo "       bash servidor/instala.sh seudominio.com.br www.seudominio.com.br"
  echo "       bash servidor/instala.sh srv123456.hstgr.cloud"
  exit 1
}
PRINCIPAL="${1:-}"
if [ -z "$PRINCIPAL" ] || ! printf '%s' "$PRINCIPAL" | grep -Eq "$RE_NOME"; then uso; fi
shift
EXTRAS=("$@")
for n in "${EXTRAS[@]}"; do
  printf '%s' "$n" | grep -Eq "$RE_NOME" || { echo "nome estranho: $n"; exit 1; }
  if printf '%s' "$n" | grep -Eq "$RE_IP"; then echo "o IP só pode ser o endereço principal"; exit 1; fi
done
if printf '%s' "$PRINCIPAL" | grep -Eq "$RE_IP"; then
  # IP puro: o `http://` na frente é obrigatório — sem ele o Caddy tiraria um
  # certificado da CA interna dele, que os outros PCs recusam (e o wss cai junto)
  [ "${#EXTRAS[@]}" -eq 0 ] || { echo "com o IP não há nomes extras"; exit 1; }
  SITE="http://$PRINCIPAL"; URL="http://$PRINCIPAL"; COM_HTTPS=0
else
  SITE="$PRINCIPAL"; URL="https://$PRINCIPAL"; COM_HTTPS=1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "rode como root (ou: sudo bash servidor/instala.sh $PRINCIPAL)"
  exit 1
fi
if [ ! -r /etc/os-release ] || ! grep -Eq '^ID(_LIKE)?=.*(ubuntu|debian)' /etc/os-release; then
  echo "este instalador é para Ubuntu (ou Debian)"
  exit 1
fi
# Um VPS com Coolify (ou outro painel) já tem um proxy nas portas 80 e 443.
# Instalar o Caddy aqui disputaria as portas com ele e, depois de um
# reinício, podia derrubar todas as outras aplicações. Nesse caso, suba pelo
# Coolify: servidor/SUBIR.md, parte "No Coolify".
if [ -d /data/coolify ] || { command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^coolify'; }; then
  echo "Este VPS tem o Coolify. O instalador disputaria as portas 80 e 443 com ele"
  echo "e derrubaria as outras aplicações. Suba pelo Coolify: servidor/SUBIR.md, parte \"No Coolify\"."
  exit 1
fi
if ! command -v caddy >/dev/null 2>&1 && command -v ss >/dev/null 2>&1    && [ -n "$(ss -Hltn '( sport = :80 or sport = :443 )' 2>/dev/null)" ]; then
  echo "Outro programa já escuta na porta 80 ou 443 deste VPS (um painel, um nginx...)."
  echo "O instalador não vai disputar com ele. Veja quem é: ss -ltnp '( sport = :80 or sport = :443 )'"
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
# VPS recém-criado: nos primeiros minutos o Ubuntu se atualiza sozinho
# (apt-daily / unattended-upgrades) e segura a trava do apt — e o apt-get,
# diferente do apt, não espera. O install espera a trava do dpkg por até
# 15 min; o update (cuja trava não segue esse prazo) tenta de novo.
APT="apt-get -o DPkg::Lock::Timeout=900"
atualiza_listas() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    $APT update -q && return 0
    echo "  o apt está ocupado (o Ubuntu se atualizando sozinho?) — tento de novo em 15 s"
    sleep 15
  done
  return 1
}
atualiza_listas
$APT install -y -q python3 python3-websockets sqlite3 rsync cron curl ca-certificates gnupg
if ! command -v caddy >/dev/null 2>&1; then
  # o repositório OFICIAL do Caddy (caddyserver.com/docs/install): o Ubuntu
  # 22.04 não tem o pacote, e o do 24.04 é uma versão de 2022
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  atualiza_listas
  $APT install -y -q caddy
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

passo "4/6 o Caddy para $URL"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'SOTERRA' /etc/caddy/Caddyfile && [ ! -f /etc/caddy/Caddyfile.antes-do-soterra ]; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.antes-do-soterra
fi
sed "s|^jogo\.exemplo\.com\.br {|$SITE {|" "$PACOTE/servidor/Caddyfile" > /etc/caddy/Caddyfile
grep -qF "$SITE {" /etc/caddy/Caddyfile || { echo "não achei a linha do endereço no Caddyfile do pacote"; exit 1; }
for n in "${EXTRAS[@]}"; do
  printf '\n# %s leva ao endereço principal (a sessão mora num endereço só)\n%s {\n\tredir https://%s{uri} permanent\n}\n' \
    "$n" "$n" "$PRINCIPAL" >> /etc/caddy/Caddyfile
done
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
# como o usuário soterra, dono do banco: se o root abrisse o banco com a API
# parada, os arquivos -wal/-shm nasceriam do root e a API não gravaria mais
install -d -m 700 -o soterra -g soterra /var/backups/soterra
runuser -u soterra -- sqlite3 /var/lib/soterra/soterra.db ".backup /var/backups/soterra/soterra-$(date +%F).db"
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
if [ "$COM_HTTPS" = 1 ]; then
  MEUS="$(hostname -I 2>/dev/null || true)"
  for n in "$PRINCIPAL" "${EXTRAS[@]}"; do
    # `|| true`: o getent sai com 2 quando o nome não existe, e o pipefail +
    # set -e matariam o instalador aqui — em vez de avisar, que é o combinado
    RESOLVE="$(getent ahostsv4 "$n" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
    if [ -z "$RESOLVE" ]; then
      echo "  AVISO: $n ainda não existe no DNS — o HTTPS sai sozinho quando existir"
    elif [ "${RESOLVE#127.}" != "$RESOLVE" ]; then
      echo "  DNS: $n resolve aqui pelo /etc/hosts — confira de fora: nslookup $n 8.8.8.8"
    elif ! printf ' %s ' $MEUS | grep -q " $RESOLVE "; then
      echo "  AVISO: $n aponta para $RESOLVE, mas este VPS é: $MEUS — acerte o registro A"
    else
      echo "  DNS: $n aponta para este VPS"
    fi
  done
else
  echo "  AVISO: pelo IP não há HTTPS (sem cadeado). Quando tiver domínio, rode de novo com ele."
fi

echo
if [ "$ok" = 1 ]; then
  echo "Pronto. O site:  $URL"
  echo "        O jogo:  $URL/index.html"
  if [ "$COM_HTTPS" = 1 ]; then
    echo "O certificado HTTPS sai no primeiro acesso (até um minuto). Se não abrir:"
    echo "  journalctl -u caddy -n 50 --no-pager"
  fi
else
  echo "Algo não subiu — veja as linhas acima."
  exit 1
fi
