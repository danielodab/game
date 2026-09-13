#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Os AMIGOS e os INIMIGOS da conta (13/09).

PEDIDO DO DONO: "no menu inferior deve ter uma lista de amigos e inimigos; os
amigos mostram quando estão online e se estão em batalha; os inimigos não podem
mandar mensagem nem troca, mas podem desafiar pvp".

A lista mora aqui, por CONTA — a mesma que o relé confere na praça (o `nuvem`
da presença). Quem está online, em que sala e se está em batalha NÃO é daqui:
só o relé sabe quem está ligado, e ele responde ao {t:'amigos'} lendo esta
tabela só para ler (servidor/rele.py). É também o relé que deixa de entregar
sussurro e troca entre quem se marcou inimigo; o duelo passa.

Entra no cartório como mixin (`class Api(..., AmigosMixin)` no api.py), com a
mesma conexão e a mesma tranca.

  GET  /api/amigos           {amigos: [{conta, nome, nivel}], inimigos: [...]}
  POST /api/amigos/definir   {conta | nome, tipo: 'amigo' | 'inimigo' | null}

Uma relação por par de contas: marcar inimigo tira dos amigos e vice-versa;
null tira de qualquer lista. Até LISTA_MAX de cada. Pelo nome vale o nome do
jogo (o do resumo) ou, sem ele, o da conta, sem caixa; nome repetido é recusado
— aí se adiciona tocando na pessoa na praça, que vai pela conta.
"""
import logging

from comum import Recusa, agora

log = logging.getLogger('api')

LISTA_MAX = 100
NOME_MAX = 40

ESQUEMA_AMIGOS = """
CREATE TABLE IF NOT EXISTS relacoes(
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  alvo_id     INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('amigo', 'inimigo')),
  em          INTEGER NOT NULL,
  PRIMARY KEY (conta_id, alvo_id)
);
CREATE INDEX IF NOT EXISTS relacoes_alvo ON relacoes(alvo_id, tipo);
"""


class AmigosMixin:
    """As rotas /api/amigos (ver ROTAS no api.py)."""

    def _am_lista(self, cid):
        rs = self.con.execute(
            "SELECT x.alvo_id, x.tipo, COALESCE(NULLIF(r.nome, ''), c.nome) AS nome, "
            "COALESCE(r.nivel_max, 0) AS nivel FROM relacoes x JOIN contas c ON c.id = x.alvo_id "
            "LEFT JOIN resumos r ON r.conta_id = x.alvo_id "
            "WHERE x.conta_id = ? AND c.banido = 0 ORDER BY nome COLLATE NOCASE, x.alvo_id", (cid,)).fetchall()
        fora = {'amigos': [], 'inimigos': []}
        for r in rs:
            fora['amigos' if r['tipo'] == 'amigo' else 'inimigos'].append(
                {'conta': r['alvo_id'], 'nome': r['nome'], 'nivel': r['nivel']})
        return fora

    def amigos_lista(self, conta, corpo):
        with self.tranca:
            return 200, dict(ok=True, **self._am_lista(conta['id']))

    def _am_alvo(self, corpo):
        """A conta de quem se quer marcar: pelo id (o toque na praça) ou pelo nome."""
        alvo, nome = corpo.get('conta'), corpo.get('nome')
        if alvo is not None:
            if isinstance(alvo, bool) or not isinstance(alvo, int) or alvo < 1:
                raise Recusa(400, 'conta precisa ser um id')
            if self.con.execute("SELECT 1 FROM contas WHERE id = ? AND banido = 0", (alvo,)).fetchone() is None:
                raise Recusa(404, 'conta não encontrada')
            return alvo
        if not isinstance(nome, str) or not nome.strip():
            raise Recusa(400, 'diga a conta ou o nome')
        nome = nome.strip()[:NOME_MAX]
        achados = self.con.execute(
            "SELECT c.id FROM contas c LEFT JOIN resumos r ON r.conta_id = c.id WHERE c.banido = 0 AND "
            "(r.nome = ? COLLATE NOCASE OR ((r.nome IS NULL OR r.nome = '') AND c.nome = ? COLLATE NOCASE)) "
            "LIMIT 2", (nome, nome)).fetchall()
        if not achados:
            raise Recusa(404, 'ninguém com esse nome')
        if len(achados) > 1:
            raise Recusa(409, 'há mais de uma pessoa com esse nome — adicione tocando nela na praça')
        return achados[0]['id']

    def amigos_definir(self, conta, corpo):
        tipo = corpo.get('tipo')
        if tipo not in ('amigo', 'inimigo', None):
            raise Recusa(400, "o tipo é 'amigo', 'inimigo' ou null")
        cid = conta['id']
        with self.tranca:
            alvo = self._am_alvo(corpo)
            if alvo == cid:
                raise Recusa(400, 'você não pode se pôr na própria lista')
            if tipo is None:
                self.con.execute("DELETE FROM relacoes WHERE conta_id = ? AND alvo_id = ?", (cid, alvo))
            else:
                n = self.con.execute("SELECT COUNT(*) FROM relacoes WHERE conta_id = ? AND tipo = ? AND alvo_id != ?",
                                     (cid, tipo, alvo)).fetchone()[0]
                if n >= LISTA_MAX:
                    raise Recusa(409, 'a lista está cheia (%d)' % LISTA_MAX)
                self.con.execute("INSERT OR REPLACE INTO relacoes(conta_id, alvo_id, tipo, em) VALUES (?, ?, ?, ?)",
                                 (cid, alvo, tipo, agora()))
            self.con.commit()
            fora = self._am_lista(cid)
        return 200, dict(ok=True, conta=alvo, tipo=tipo, **fora)
