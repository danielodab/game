#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A PRESENÇA CONTADA PELO RELÉ: a prova de que uma conta caiu (15/09).

O dono: "arrume as falhas conhecidas" — e uma delas era o W.O. do duelo, que não custava nada a quem
sumia. Quem fecha a aba no meio do duelo não declara nada ao servidor; quem VÊ a conexão dela cair é o
Relé (servidor/rele.py), que já sabe de que conta é cada conexão (a sessão conferida, rele_ident.py). Ele
anota aqui dois eventos por conta:
  'caiu'    a última conexão identificada da conta, neste relé, fechou (ou perdeu a identidade)
  'voltou'  a conta ganhou de novo a primeira conexão identificada
e a API (servidor/grupo.py, duelo_fechar) lê para confirmar o W.O. que o cliente que ficou declara:
existe um 'caiu' da conta ausente DEPOIS de o duelo abrir e nenhum 'voltou' dela nos WO_MS seguintes.

O BANCO É O MESMO DA API. No Coolify os dois sobem com --banco /dados/soterra.db (servidor/coolify/
entrada.sh); no VPS, /var/lib/soterra/soterra.db (soterra-api.service e soterra-rele.service), os dois
como o usuário `soterra`. O relé abria o banco só para ler; a presença é a ÚNICA escrita dele: numa
thread fora do laço de eventos, com mode=rw (nunca cria o arquivo), a tabela criada se ainda faltar (no
rolling update o relé do contêiner novo pode chegar antes de a API criar) e a faxina das linhas de mais
de 24 h no máximo uma vez a cada 10 min. Banco trancado ou ausente = a anotação se perde e o W.O. daquela
queda fica sem prova (vale a vida do replay, sem coroa): a falha nunca pune quem ficou fora.

Tabela NOVA, nunca ALTER. Só biblioteca padrão."""
import os
import pathlib
import sqlite3
import threading
import time

ESQUEMA_PRESENCA = """
-- 15/09: a presença que o Relé conta (servidor/presenca.py) — a prova de queda do W.O. do duelo.
-- Tabela NOVA, nunca ALTER (o rolling update divide o banco)
CREATE TABLE IF NOT EXISTS rele_presenca(
  conta_id  INTEGER NOT NULL,
  evento    TEXT NOT NULL CHECK (evento IN ('caiu', 'voltou')),
  em_ms     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rele_presenca_conta ON rele_presenca(conta_id, em_ms);
"""
EVENTOS = ('caiu', 'voltou')
GUARDA_MS = 24 * 3600 * 1000      # as linhas mais velhas que isto saem na faxina
FAXINA_MS = 10 * 60 * 1000        # a faxina roda no máximo uma vez a cada tanto, por processo
WO_MS = 60 * 1000                 # o Coop.WO_MS do cliente: quem volta dentro disto não tomou W.O.
ESPERA_BANCO = 1.0                # s que o SQLite espera o banco trancado

_faxina = {'em': 0}
_tranca = threading.Lock()


def uri_escrita(caminho):
    """O endereço do banco para ESCREVER sem nunca criar o arquivo (mode=rw)."""
    return pathlib.Path(os.path.abspath(caminho)).as_uri() + '?mode=rw'


def anota(caminho, conta_id, evento, em_ms=None):
    """Grava um evento de presença. Síncrona: o relé chama numa thread. True se gravou."""
    if not caminho or evento not in EVENTOS or isinstance(conta_id, bool) or not isinstance(conta_id, int):
        return False
    em = int(time.time() * 1000) if em_ms is None else int(em_ms)
    try:
        con = sqlite3.connect(uri_escrita(caminho), uri=True, timeout=ESPERA_BANCO)
    except (sqlite3.Error, ValueError, OSError):
        return False
    try:
        con.executescript(ESQUEMA_PRESENCA)
        con.execute("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, ?, ?)", (conta_id, evento, em))
        with _tranca:
            faxina = em - _faxina['em'] >= FAXINA_MS
            if faxina:
                _faxina['em'] = em
        if faxina:
            con.execute("DELETE FROM rele_presenca WHERE em_ms < ?", (em - GUARDA_MS,))
        con.commit()
        return True
    except sqlite3.Error:
        return False
    finally:
        con.close()


def prova_de_queda(con, conta_id, desde_ms, agora_ms, janela_ms=WO_MS):
    """O que o banco diz da queda da conta desde `desde_ms` (a abertura do duelo): (veredito, ms).
      'provada'  um 'caiu' sem 'voltou' nos `janela_ms` seguintes, e a janela já passou (ms = o 'caiu')
      'cedo'     um 'caiu' sem 'voltou' ATÉ AGORA, mas a janela ainda não passou (ms = quando passa)
      'sem'      houve queda, e ela voltou dentro da janela: não é W.O.
      'nada'     nenhuma queda anotada (o relé ainda não viu a conexão morrer, ou a tabela não existe)
    `con` é a conexão da API (dentro da tranca dela)."""
    try:
        linhas = con.execute("SELECT evento, em_ms FROM rele_presenca WHERE conta_id = ? AND em_ms >= ? "
                             "ORDER BY em_ms, rowid", (conta_id, int(desde_ms))).fetchall()
    except sqlite3.Error:
        return 'nada', None
    quedas = [int(r[1]) for r in linhas if r[0] == 'caiu']
    voltas = [int(r[1]) for r in linhas if r[0] == 'voltou']
    if not quedas:
        return 'nada', None
    cedo = None
    for c in quedas:
        if any(c <= v <= c + janela_ms for v in voltas):
            continue                                  # voltou a tempo: esta queda não prova nada
        if agora_ms >= c + janela_ms:
            return 'provada', c
        cedo = c + janela_ms if cedo is None else min(cedo, c + janela_ms)
    return ('cedo', cedo) if cedo is not None else ('sem', None)
