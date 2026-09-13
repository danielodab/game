#!/bin/sh
# =============================================================================
# SOTERRA no Coolify: administrar o banco de dentro do contêiner.
# No painel do Coolify, abra o Terminal da aplicação e rode:
#   admin contas               lista as contas
#   admin mestre "NOME"        marca a conta como Mestre (gm=1)
#   admin tirar-mestre "NOME"  tira a marca de Mestre
#   admin banir "NOME"         bane a conta (a sessão dela passa a levar 403)
#   admin desbanir "NOME"      tira o banimento
#   admin trocar-email "NOME" novo@x   troca o e-mail da conta (antes, confirme quem é a pessoa)
#   admin renomear "VELHO" "NOVO"  troca o nome da conta (a porta do dono: aceita até nome reservado à equipe)
#   admin email-teste ENDERECO manda um e-mail de prova (confere o SMTP)
#   admin eventos [N]          a trilha de auditoria, os N últimos (20 se omitir)
#   admin agenda               os eventos do mundo marcados e as regras do calendário
#   admin loja [N]             os N últimos pedidos da loja (30 se omitir)
#   admin loja-cancelar ID     cancela um pedido da loja que ainda não chegou ao jogo
#   admin barras "NOME"        o saldo de barras de ouro da conta e os 20 últimos movimentos
#   admin backup               faz um backup agora, em /dados/backups
# Depois de marcar ou tirar a marca de Mestre, a pessoa sai e entra de novo no site.
# =============================================================================
set -eu
BANCO=/dados/soterra.db

ajuda() { sed -n '4,19p' "$0" | sed 's/^# \{0,1\}//'; }
sql() { su-exec soterra sqlite3 "$BANCO" "$@"; }
texto() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }
tem_tabela() { [ "$(sql "select count(*) from sqlite_master where type = 'table' and name = '$1'")" = "1" ]; }
marca() {   # marca COLUNA VALOR NOME MENSAGEM
  [ -n "$3" ] || { echo "falta o NOME da conta (confira com: admin contas)"; exit 1; }
  n="$(sql "update contas set $1 = $2 where nome = $(texto "$3"); select changes();")"
  if [ "$n" = "1" ]; then echo "$4"; else echo "não achei a conta \"$3\" (confira com: admin contas)"; exit 1; fi
}

acao="${1:-}"
nome="${2:-}"
case "$acao" in
  mestre|tirar-mestre|banir|desbanir)
    # nome com espaço sem aspas viraria DOIS argumentos, e o comando agiria
    # sobre outra conta (a do primeiro pedaço)
    [ $# -eq 2 ] || { echo "o NOME vai inteiro, num argumento só; com espaço, entre aspas: admin $acao \"Ana Clara\""; exit 1; } ;;
  trocar-email)
    # o mesmo cuidado: o NOME inteiro entre aspas, e o e-mail novo como terceiro argumento
    [ $# -eq 3 ] || { echo "uso: admin trocar-email \"NOME DA CONTA\" novo@exemplo.com (o NOME entre aspas se tiver espaço)"; exit 1; } ;;
  renomear)
    # os dois nomes inteiros, cada um num argumento só
    [ $# -eq 3 ] || { echo "uso: admin renomear \"NOME VELHO\" \"NOME NOVO\" (cada nome entre aspas se tiver espaço)"; exit 1; } ;;
  email-teste)
    [ $# -eq 2 ] || { echo "uso: admin email-teste seu@endereco.com"; exit 1; } ;;
  loja-cancelar)
    [ $# -eq 2 ] || { echo "uso: admin loja-cancelar ID (o número do pedido: veja em admin loja)"; exit 1; } ;;
  barras)
    [ $# -eq 2 ] || { echo "o NOME vai inteiro, num argumento só; com espaço, entre aspas: admin barras \"Ana Clara\""; exit 1; } ;;
esac
if [ -z "$acao" ] || [ "$acao" = "ajuda" ]; then ajuda; exit 0; fi
if [ "$acao" = "backup" ]; then exec /app/servidor/coolify/backup.sh; fi
# o teste do correio não precisa do banco: o docker exec herda o ambiente do
# contêiner (as SOTERRA_SMTP_* do Coolify), e o correio.py manda um e-mail de prova
if [ "$acao" = "email-teste" ]; then exec su-exec soterra python3 /app/servidor/correio.py --teste "$2"; fi
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
  trocar-email)
    # para quem se cadastrou com o e-mail errado (e por isso não recebe o código
    # do site). Só depois de confirmar por conta própria quem é a pessoa.
    novo="$3"
    printf '%s' "$novo" | grep -Eq '^[^@[:space:],;:<>()"\\]+@[^@[:space:],;:<>()"\\]+\.[^@[:space:],;:<>()"\\]+$' \
      || { echo "e-mail inválido: $novo"; exit 1; }
    [ "$(sql "select count(*) from contas where email = $(texto "$novo")")" = "0" ] \
      || { echo "esse e-mail já tem conta (confira com: admin contas)"; exit 1; }
    # o código de troca de e-mail que estiver aberto morre junto (senão ele trocaria de novo)
    velhos=""
    if tem_tabela codigos; then
      velhos="update codigos set usado = 1 where usado = 0 and finalidade = 'email' and conta_id = (select id from contas where nome = $(texto "$nome"));"
    fi
    n="$(sql "begin immediate; insert into eventos(conta_id, tipo, dados, criado_em) select id, 'email-trocado-admin', json_object('de', email, 'para', $(texto "$novo")), cast(strftime('%s', 'now') as integer) from contas where nome = $(texto "$nome"); $velhos update contas set email = $(texto "$novo") where nome = $(texto "$nome"); select changes(); commit;")"
    if [ "$n" = "1" ]; then echo "o e-mail de \"$nome\" agora é $novo (o login por e-mail passa a ser esse)."; else echo "não achei a conta \"$nome\" (confira com: admin contas)"; exit 1; fi ;;
  renomear)
    # a porta do DONO para qualquer nome, até um reservado à equipe (GM, Admin,
    # Mestre do Fundo…), que o cadastro pelo site recusa (servidor/nomes.py).
    # Confere só o tamanho (em letras, pelo length do sqlite: o sh contaria
    # bytes) e se o nome novo está livre. A sessão aberta continua (o token é
    # da conta, não do nome); o login por nome passa a ser o novo.
    novo="$3"
    tam="$(sql "select length($(texto "$novo"))")"
    { [ "$tam" -ge 3 ] && [ "$tam" -le 20 ]; } || { echo "o nome novo precisa ter de 3 a 20 caracteres (tem $tam)"; exit 1; }
    id="$(sql "select id from contas where nome = $(texto "$nome")")"
    [ -n "$id" ] || { echo "não achei a conta \"$nome\" (confira com: admin contas)"; exit 1; }
    [ "$(sql "select count(*) from contas where nome = $(texto "$novo") and id != $id")" = "0" ] \
      || { echo "esse nome já tem dono (confira com: admin contas)"; exit 1; }
    # a vitrine do ranking que mostrava o nome da conta acompanha já, sem esperar o próximo save
    vitrine=""
    if tem_tabela resumos; then
      vitrine="update resumos set nome = $(texto "$novo") where conta_id = $id and nome = (select nome from contas where id = $id);"
    fi
    n="$(sql "begin immediate; insert into eventos(conta_id, tipo, dados, criado_em) select id, 'renomeado-admin', json_object('de', nome, 'para', $(texto "$novo")), cast(strftime('%s', 'now') as integer) from contas where id = $id; $vitrine update contas set nome = $(texto "$novo") where id = $id; select changes(); commit;")"
    if [ "$n" = "1" ]; then echo "a conta \"$nome\" agora se chama \"$novo\" (o login por nome passa a ser esse; a sessão aberta continua)."; else echo "não achei a conta \"$nome\" (confira com: admin contas)"; exit 1; fi ;;
  eventos)
    n="${2:-20}"
    case "$n" in ''|*[!0-9]*) echo "N tem de ser um número"; exit 1 ;; esac
    sql -header -column "select e.id, datetime(e.criado_em, 'unixepoch') as quando, coalesce(c.nome, '-') as conta, e.tipo, substr(coalesce(e.dados, ''), 1, 90) as dados from eventos e left join contas c on c.id = e.conta_id order by e.id desc limit $n" ;;
  agenda)
    # só leitura (10/09): quem liga e cancela é o Mestre, pelo jogo. As tabelas
    # nascem quando a API nova sobe; antes disso, nada a mostrar.
    tem_tabela agenda_eventos || { echo "este banco ainda não tem a agenda: a API nova cria as tabelas quando sobe"; exit 1; }
    echo "Eventos pontuais no ar ou marcados (hora de Brasília):"
    sql -header -column "select id, tipo, multiplicador as mult, coalesce(calabouco, 'todos') as calabouco, titulo, datetime(inicio, 'unixepoch', '-3 hours') as inicio, datetime(fim, 'unixepoch', '-3 hours') as fim from agenda_eventos where cancelado_em is null and fim > cast(strftime('%s', 'now') as integer) order by inicio"
    echo
    echo "Regras do calendário automático (dias: 0 = domingo ... 6 = sábado; hora de Brasília):"
    sql -header -column "select id, tipo, multiplicador as mult, coalesce(calabouco, 'todos') as calabouco, titulo, dias, printf('%02d:%02d', hora_min / 60, hora_min % 60) as hora, duracao_min as minutos, coalesce(datetime(vigente_de, 'unixepoch', '-3 hours'), '-') as de, coalesce(datetime(vigente_ate, 'unixepoch', '-3 hours'), '-') as ate from agenda_regras where cancelado_em is null and (vigente_ate is null or vigente_ate > cast(strftime('%s', 'now') as integer)) order by id" ;;
  loja)
    # só leitura: os preços moram em servidor/loja.py (CATALOGO)
    n="${2:-30}"
    case "$n" in ''|*[!0-9]*) echo "N tem de ser um número"; exit 1 ;; esac
    tem_tabela loja_pedidos || { echo "este banco ainda não tem a loja: a API nova cria as tabelas quando sobe"; exit 1; }
    # 13/09: a coluna "barras" (o que o pedido custou em barras de ouro) só com a tabela nova no banco
    barras="0"
    if tem_tabela loja_barras; then barras="coalesce((select custo from loja_barras where pedido_id = p.id), 0)"; fi
    echo "Pedidos da loja, os mais novos primeiro (hora de Brasília; preço em vinténs, barras em barras de ouro; 0 e 0 = Mestre, presente ou crédito):"
    sql -header -column "select p.id, datetime(p.criado_em, 'unixepoch', '-3 hours') as quando, coalesce(c.nome, '-') as conta, p.sku, p.preco, $barras as barras, p.estado, coalesce(p.motivo, '') as motivo, coalesce(datetime(p.retirado_em, 'unixepoch', '-3 hours'), '-') as retirado, coalesce(datetime(p.fechado_em, 'unixepoch', '-3 hours'), '-') as fechado from loja_pedidos p left join contas c on c.id = p.conta_id order by p.id desc limit $n" ;;
  loja-cancelar)
    # só de pendente ou retirado. Se o jogo já tinha retirado o pedido e o
    # aplicar mesmo assim, o save seguinte o marca entregue (fica o evento
    # loja-cancelamento-tardio na trilha).
    id="$2"
    case "$id" in ''|*[!0-9]*) echo "ID tem de ser o número do pedido (veja em: admin loja)"; exit 1 ;; esac
    tem_tabela loja_pedidos || { echo "este banco ainda não tem a loja: a API nova cria as tabelas quando sobe"; exit 1; }
    estado="$(sql "select estado from loja_pedidos where id = $id")"
    [ -n "$estado" ] || { echo "não achei o pedido $id (confira com: admin loja)"; exit 1; }
    case "$estado" in
      pendente|retirado) ;;
      *) echo "o pedido $id já está $estado: só cancela pendente ou retirado"; exit 1 ;;
    esac
    # 13/09: o pedido pago em barras de ouro devolve as barras NA MESMA transação, uma vez só (o idem
    # 'pedido:ID:estorno' é o mesmo que a API usa: loja.py, _barras_do_pedido)
    devolve=""
    if tem_tabela loja_barras && tem_tabela barras_movimentos; then
      agora="cast(strftime('%s', 'now') as integer)"
      alvo="from loja_pedidos p join loja_barras lb on lb.pedido_id = p.id where p.id = $id and p.estado = 'cancelado' and p.motivo = 'admin' and lb.custo > 0 and not exists (select 1 from barras_movimentos m where m.conta_id = p.conta_id and m.idem = 'pedido:' || p.id || ':estorno')"
      devolve="insert or ignore into barras_saldo(conta_id, saldo, atualizado_em) select p.conta_id, 0, $agora $alvo; update barras_saldo set saldo = saldo + (select lb.custo $alvo), atualizado_em = $agora where conta_id = (select p.conta_id $alvo); insert into barras_movimentos(conta_id, delta, motivo, ref, saldo_depois, idem, criado_em) select p.conta_id, lb.custo, 'estorno-loja', 'pedido:' || p.id, (select saldo from barras_saldo where conta_id = p.conta_id), 'pedido:' || p.id || ':estorno', $agora $alvo;"
    fi
    n="$(sql "begin immediate; update loja_pedidos set estado = 'cancelado', motivo = 'admin', fechado_em = cast(strftime('%s', 'now') as integer) where id = $id and estado in ('pendente', 'retirado'); select changes(); insert into eventos(conta_id, tipo, dados, criado_em) select conta_id, 'loja-cancela-admin', json_object('id', id, 'sku', sku), cast(strftime('%s', 'now') as integer) from loja_pedidos where id = $id and estado = 'cancelado' and motivo = 'admin'; $devolve commit;")"
    if [ "$n" = "1" ]; then echo "pedido $id cancelado: a reserva de vinténs (ou as barras de ouro) voltou e ele não vai mais para o jogo."; else echo "o pedido $id mudou de estado agora há pouco; confira com: admin loja"; exit 1; fi ;;
  barras)
    # só leitura (13/09): o saldo de barras de ouro mora no servidor; quem dá é o Mestre, pelo painel do site
    tem_tabela barras_saldo || { echo "este banco ainda não tem as barras de ouro: a API nova cria as tabelas quando sobe"; exit 1; }
    id="$(sql "select id from contas where nome = $(texto "$nome")")"
    [ -n "$id" ] || { echo "não achei a conta \"$nome\" (confira com: admin contas)"; exit 1; }
    echo "Barras de ouro de \"$nome\": $(sql "select coalesce((select saldo from barras_saldo where conta_id = $id), 0)")"
    echo "Os 20 últimos movimentos (hora de Brasília):"
    sql -header -column "select m.id, datetime(m.criado_em, 'unixepoch', '-3 hours') as quando, m.delta, m.motivo, coalesce(m.ref, '') as ref, m.saldo_depois as saldo, coalesce(c.nome, '') as por from barras_movimentos m left join contas c on c.id = m.por where m.conta_id = $id order by m.id desc limit 20" ;;
  *)
    echo "não conheço \"$acao\""; ajuda; exit 1 ;;
esac
