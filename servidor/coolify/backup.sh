#!/bin/sh
# SOTERRA no Coolify: uma cópia do banco, as últimas 14 guardadas.
# Agendado no Coolify (Scheduled Tasks, uma vez por dia) ou na mão: `admin backup`.
# As cópias ficam no MESMO volume (/dados/backups); para ter uma fora do VPS,
# baixe de vez em quando, e conte também com os snapshots do VPS no hPanel.
set -eu
DADOS=/dados
[ -f "$DADOS/soterra.db" ] || { echo "[soterra] ainda não há banco para copiar"; exit 0; }
mkdir -p "$DADOS/backups"
chown soterra:soterra "$DADOS/backups"
ARQ="$DADOS/backups/soterra-$(date +%F).db"
# como o usuário soterra, dono do banco: o root criaria -wal/-shm que a API não grava
su-exec soterra sqlite3 "$DADOS/soterra.db" ".backup $ARQ"
find "$DADOS/backups" -name 'soterra-*.db' -mtime +14 -delete
echo "[soterra] backup feito: $ARQ"
