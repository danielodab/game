#!/bin/sh
# =============================================================================
# SOTERRA no Coolify: administrar o banco de dentro do contêiner.
# No painel do Coolify, abra o Terminal da aplicação e rode:
#   admin contas               lista as contas
#   admin mestre NOME          marca a conta como Mestre (gm=1)
#   admin tirar-mestre NOME    tira a marca de Mestre
#   admin banir NOME           bane a conta (a sessão dela passa a levar 403)
#   admin desbanir NOME        tira o banimento
#   admin eventos [N]          a trilha de auditoria, os N últimos (20 se omitir)
#   admin backup               faz um backup agora, em /dados/backups
# Depois de marcar ou tirar a marca de Mestre, a pessoa sai e entra de novo no site.
# =============================================================================
set -eu
BANCO=/dados/soterra.db

ajuda() { sed -n '4,12p' "$0" | sed 's/^# \{0,1\}//'; }
sql() { su-exec soterra sqlite3 "$BANCO" "$@"; }
texto() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }
marca() {   # marca COLUNA VALOR NOME MENSAGEM
  [ -n "$3" ] || { echo "falta o NOME da conta (confira com: admin contas)"; exit 1; }
  n="$(sql "update contas set $1 = $2 where nome = $(texto "$3"); select changes();")"
  if [ "$n" = "1" ]; then echo "$4"; else echo "não achei a conta \"$3\" (confira com: admin contas)"; exit 1; fi
}

acao="${1:-}"
nome="${2:-}"
if [ -z "$acao" ] || [ "$acao" = "ajuda" ]; then ajuda; exit 0; fi
if [ "$acao" = "backup" ]; then exec /app/servidor/coolify/backup.sh; fi
[ -f "$BANCO" ] || { echo "ainda não há banco em $BANCO (ninguém se cadastrou ainda?)"; exit 1; }

case "$acao" in
  contas)
    sql -header -column "select id, nome, email, gm as mestre, banido, datetime(criado_em, 'unixepoch') as criada from contas order by id" ;;
  mestre)
    marca gm 1 "$nome" "\"$nome\" agora é Mestre. Ela precisa sair e entrar de novo no site." ;;
  tirar-mestre)
    marca gm 0 "$nome" "\"$nome\" não é mais Mestre." ;;
  banir)
    marca banido 1 "$nome" "\"$nome\" está banida: a sessão dela passa a levar 403." ;;
  desbanir)
    marca banido 0 "$nome" "\"$nome\" pode voltar a jogar." ;;
  eventos)
    n="${2:-20}"
    case "$n" in ''|*[!0-9]*) echo "N tem de ser um número"; exit 1 ;; esac
    sql -header -column "select e.id, datetime(e.criado_em, 'unixepoch') as quando, coalesce(c.nome, '-') as conta, e.tipo, substr(coalesce(e.dados, ''), 1, 90) as dados from eventos e left join contas c on c.id = e.conta_id order by e.id desc limit $n" ;;
  *)
    echo "não conheço \"$acao\""; ajuda; exit 1 ;;
esac
