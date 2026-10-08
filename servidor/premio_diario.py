#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O PRÊMIO DIÁRIO DE RESGATE (08/10). O dono: "quero prêmios diários de resgate para quem entra
todos os dias no jogo... vinténs, 10 dias seguidos barra de ouro".

A REGRA
  - Um resgate por DIA DE BRASÍLIA (anuncio.py: dia_de/vira_em), à vontade do jogador — nada entra
    sozinho: ele abre o Quadro de Missões e toca em "Resgatar".
  - A ORDEM anda só pelos RESGATES (o dono, 08/10: "se ele entra no dia 1 e volta 9 dias depois, não
    colhe a barra do 10: colhe o prêmio 2, e assim por diante"): cada resgate é o próximo dia do
    calendário, um por dia de Brasília; pular dias não volta ao 1 nem adianta nada. O calendário é o
    MÊS de Brasília (o dono: "quando vira o mês ele zera e começa de novo"): no dia 1 de cada mês a
    contagem recomeça do 1º prêmio; o mês tem 28 a 31 posições (premios_do_dia vale para qualquer uma),
    e `total` guarda quantos resgates a conta já fez na vida.
  - O que cada dia dá (premios_do_dia): vinténs TODO dia, crescendo (100 no dia 1, +20 por dia, 680 no
    30); no dia 3 e no 7 de cada dezena, Fragmentos de Gema (3 e 5); no dia 5 de cada dezena, 5 Lascas da
    Lousa; no 10 e no 20, UMA barra de ouro; no 30, DUAS barras e 10 fragmentos. Tudo pelo caminho da
    loja: os vinténs por `credita` (pedido de preço 0 + loja_creditos, como o anúncio), as pedras por um
    pedido de preço 0 com sku 'diario' (como a trilha), a barra por `barras_move` com a ref 'diario:<dia>'
    (motivo 'presente' no banco, o CHECK não se altera; o extrato lê a ref). Entrega NA HORA pelo
    `_loja_na_hora`, como a trilha.
  - Idempotente por (conta, dia): o segundo toque no mesmo dia é 409 'ja-resgatado'; os pedidos levam
    idem 'diario-<resgate>-<k>'.

Tabelas NOVAS, nunca ALTER (o rolling update): `premio_diario` (uma linha por conta: o último dia, a
sequência e o total) e `premio_diario_resgates` (uma linha por resgate — a trilha de auditoria).
"""
import calendar
import datetime
import json

from anuncio import FUSO_S, dia_de, vira_em
from comum import Recusa, agora

CICLO = 31                       # o maior mês; o calendário de cada mês tem os dias dele (dias_no_mes)
VINTENS_BASE = 100               # o dia 1
VINTENS_POR_DIA = 20             # a cada dia da sequência
FRAGMENTO = 'stone-gem-frag'     # js/core/data/items.js, DATA.gema.fragmento
PEDRA_NEUTRA = 'stone-slate'
SKU_PEDRAS = 'diario'            # o pedido de preço 0 das pedras e dos fragmentos
SKU_VINTENS = 'diario-vintens'   # o pedido de preço 0 dos vinténs (credita)
REF_BARRAS = 'diario:'           # a ref do movimento de barras (loja.py mostra como 'diario')

ESQUEMA_DIARIO = """
-- O PRÊMIO DIÁRIO (08/10, premio_diario.py): o último dia de Brasília resgatado, a sequência e o total
CREATE TABLE IF NOT EXISTS premio_diario(
  conta_id   INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  ultimo_dia INTEGER NOT NULL,
  mes        INTEGER NOT NULL DEFAULT 0,
  sequencia  INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0
);
-- cada resgate: o dia, a posição na sequência e o que deu (a trilha de auditoria; sobrevive à conta)
CREATE TABLE IF NOT EXISTS premio_diario_resgates(
  id        INTEGER PRIMARY KEY,
  conta_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  dia       INTEGER NOT NULL,
  sequencia INTEGER NOT NULL,
  premios   TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  UNIQUE (conta_id, dia)
);
"""

ROTAS_DIARIO = {
    ('GET',  '/api/diario'):          ('diario_ler', True),
    ('POST', '/api/diario/resgatar'): ('diario_resgatar', True),
}


def mes_de(t):
    """O mês de Brasília do instante t, como AAAAMM (a chave da virada do calendário)."""
    d = datetime.datetime.fromtimestamp(int(t) + FUSO_S, datetime.timezone.utc)
    return d.year * 100 + d.month


def dias_no_mes(mes):
    return calendar.monthrange(mes // 100, mes % 100)[1]


def posicao(sequencia):
    """A posição no calendário (1..CICLO) do resgate `sequencia` (1 = o primeiro do mês)."""
    return ((max(1, int(sequencia)) - 1) % CICLO) + 1


def premios_do_dia(k):
    """O que o dia k (1..30) do ciclo dá: a lista de {tipo, alvo, qtd} no formato da fila da loja."""
    k = posicao(k)
    lista = [{'tipo': 'vintens', 'alvo': 'carteira', 'qtd': VINTENS_BASE + VINTENS_POR_DIA * (k - 1)}]
    resto = k % 10
    if resto == 0:
        lista.append({'tipo': 'barras', 'alvo': 'conta', 'qtd': 2 if k == 30 else 1})
    elif resto == 5:
        lista.append({'tipo': 'pedras', 'alvo': PEDRA_NEUTRA, 'qtd': 5})
    elif resto == 3:
        lista.append({'tipo': 'pedras', 'alvo': FRAGMENTO, 'qtd': 3})
    elif resto == 7:
        lista.append({'tipo': 'pedras', 'alvo': FRAGMENTO, 'qtd': 5})
    if k == 30:
        lista.append({'tipo': 'pedras', 'alvo': FRAGMENTO, 'qtd': 10})
    return lista


def sequencia_de_hoje(linha, dia, mes):
    """O número do resgate de HOJE: hoje já resgatou → o de hoje mesmo; virou o mês → 1; senão, o
    seguinte ao último (pular dias não volta ao 1 — a ordem anda só pelos resgates)."""
    if linha is None or int(linha['mes']) != mes:
        return 1
    if linha['ultimo_dia'] == dia:
        return int(linha['sequencia'])
    return int(linha['sequencia']) + 1


def estado_de(con, cid, t):
    """O que a tela mostra: hoje (o dia do ciclo, os prêmios, se já resgatou), a sequência, o calendário
    inteiro do ciclo e quando o dia vira."""
    dia, mes = dia_de(t), mes_de(t)
    linha = con.execute("SELECT ultimo_dia, mes, sequencia, total FROM premio_diario WHERE conta_id = ?", (cid,)).fetchone()
    resgatado = linha is not None and linha['ultimo_dia'] == dia
    seq = sequencia_de_hoje(linha, dia, mes)
    k = posicao(seq)
    n = dias_no_mes(mes)
    calendario = []
    for d in range(1, n + 1):
        calendario.append({'dia': d, 'premios': premios_do_dia(d),
                           'feito': d < k or (d == k and resgatado), 'hoje': d == k})
    return {'dia': dia, 'mes': mes, 'ciclo': n, 'sequencia': seq if resgatado else seq - 1,
            'total': int(linha['total']) if linha is not None else 0,
            'hoje': {'dia': k, 'resgatado': resgatado, 'premios': premios_do_dia(k)},
            'calendario': calendario, 'zeraEm': vira_em(t), 'agora': t}


class DiarioMixin:

    # -- GET /api/diario: o estado do dia ----------------------------------------------------------------
    def diario_ler(self, conta, corpo):
        with self.tranca:
            return 200, dict(estado_de(self.con, conta['id'], agora()), ok=True)

    # -- POST /api/diario/resgatar: o prêmio de hoje, uma vez -------------------------------------------
    def diario_resgatar(self, conta, corpo):
        cid, t = conta['id'], agora()
        dia, mes = dia_de(t), mes_de(t)
        with self._escrita():
            linha = self.con.execute("SELECT ultimo_dia, mes, sequencia, total FROM premio_diario WHERE conta_id = ?", (cid,)).fetchone()
            if linha is not None and linha['ultimo_dia'] == dia:
                raise Recusa(409, 'o prêmio de hoje já foi resgatado; o próximo abre à meia-noite de Brasília',
                             motivo='ja-resgatado', zeraEm=vira_em(t))
            seq = sequencia_de_hoje(linha, dia, mes)
            k = posicao(seq)
            premios = premios_do_dia(k)
            total = (int(linha['total']) if linha is not None else 0) + 1
            self.con.execute("INSERT INTO premio_diario(conta_id, ultimo_dia, mes, sequencia, total) VALUES (?, ?, ?, ?, ?) "
                             "ON CONFLICT(conta_id) DO UPDATE SET ultimo_dia = excluded.ultimo_dia, mes = excluded.mes, "
                             "sequencia = excluded.sequencia, total = excluded.total", (cid, dia, mes, seq, total))
            rid = self.con.execute("INSERT INTO premio_diario_resgates(conta_id, dia, sequencia, premios, criado_em) VALUES (?, ?, ?, ?, ?)",
                                   (cid, dia, seq, json.dumps(premios), t)).lastrowid
            pedidos = []
            for j, p in enumerate(premios):
                # o id da linha do resgate entra no idem: cada resgate é um pedido novo, nunca repetido
                idem = 'diario-%d-%d' % (rid, j)
                if p['tipo'] == 'vintens':
                    pedidos.append(self.credita(cid, SKU_VINTENS, p['qtd'], 'presente', idem, None, t))
                elif p['tipo'] == 'barras':
                    # o MESMO caminho do anúncio: o movimento no extrato e o saldo, juntos (motivo 'presente')
                    self.barras_move(cid, p['qtd'], 'presente', '%s%d' % (REF_BARRAS, dia), idem, t)
                else:
                    ja = self.con.execute("SELECT id FROM loja_pedidos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone()
                    if ja is not None:
                        pedidos.append(ja['id'])
                        continue
                    cur = self.con.execute("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
                                           "VALUES (?, ?, ?, 0, 'pendente', ?, ?)",
                                           (cid, SKU_PEDRAS, json.dumps(dict(p, origem='diario')), idem, t))
                    pedidos.append(cur.lastrowid)
            self._evento(cid, 'diario-resgate', {'dia': dia, 'sequencia': seq, 'posicao': k, 'pedidos': pedidos})
        # a entrega NA HORA pelo mesmo caminho da loja (fora da tranca; sem juiz, fica na fila e o jogo busca)
        entregue = self._loja_na_hora(conta) if hasattr(self, '_loja_na_hora') else None
        with self.tranca:
            estado = estado_de(self.con, cid, t)
        return 200, dict(estado, ok=True, resgatou=k, premios=premios, pedidos=pedidos,
                         entregue=(entregue if isinstance(entregue, dict) and not entregue.get('falhou') else None))
