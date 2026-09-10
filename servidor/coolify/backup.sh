#!/bin/sh
# SOTERRA no Coolify: uma cópia do banco com data e hora; ficam as dos últimos 14 dias.
# Agendado no Coolify (Scheduled Tasks, uma vez por dia) ou na mão: `admin backup`.
# As cópias ficam no MESMO volume (/dados/backups); para ter uma fora do VPS,
# baixe de vez em quando ou ligue Automation > Backups com destino S3. O
# snapshot do VPS no hPanel é o último recurso: ele volta o VPS INTEIRO,
# com todas as outras aplicações, para o dia do snapshot.
set -eu
DADOS=/dados
[ -f "$DADOS/soterra.db" ] || { echo "[soterra] ainda não há banco para copiar"; exit 0; }
mkdir -p "$DADOS/backups"
chown soterra:soterra "$DADOS/backups"
ARQ="$DADOS/backups/soterra-$(date +%F-%H%M%S).db"
# como o usuário soterra, dono do banco: o root criaria -wal/-shm que a API não grava
su-exec soterra sqlite3 "$DADOS/soterra.db" ".backup $ARQ"
find "$DADOS/backups" -name 'soterra-*.db' -mtime +14 -delete
echo "[soterra] backup feito: $ARQ"
