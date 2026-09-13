# -*- coding: utf-8 -*-
"""A ponte da API para o JUIZ (servidor/juiz/juiz.js) — dono: servidor.

O juiz é um processo Node que roda as regras do jogo (os mesmos arquivos JS do
cliente) para o servidor não confiar no que o navegador diz: a sala refeita da
semente e dos lances, o saque sorteado aqui, a forja e a roleta. A API fala com
ele por HTTP no 127.0.0.1 (a porta vem de --juiz na linha de comando da API).

Só biblioteca padrão (urllib), como o resto do servidor. Sem juiz no ar, a
chamada levanta Recusa 503: melhor recusar a recompensa agora (o cliente guarda
e tenta de novo) do que pagar sem conferir.
"""
import json
import urllib.error
import urllib.request

from comum import Recusa

TEMPO_PADRAO = 20.0          # segundos: refazer uma sala longa leva menos de 1 s; a folga é da máquina ocupada


class Juiz:
    def __init__(self, base):
        # base = 'http://127.0.0.1:8792' (ou None: sem juiz configurado)
        self.base = base.rstrip('/') if base else None

    def ligado(self):
        return bool(self.base)

    def pede(self, metodo, rota, corpo=None, tempo=TEMPO_PADRAO):
        if not self.base:
            raise Recusa(503, 'o juiz do servidor não está configurado')
        dados = None if corpo is None else json.dumps(corpo, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(self.base + rota, data=dados, method=metodo,
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=tempo) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            try:
                corpo_erro = json.loads(e.read().decode('utf-8'))
            except Exception:
                corpo_erro = {'ok': False, 'erro': 'o juiz respondeu %d' % e.code}
            if e.code == 422:
                # regra do jogo recusou (lance impossível, sala que não fecha): o porquê vai ao cliente
                extra = {'motivo': corpo_erro.get('motivo')}
                if isinstance(corpo_erro.get('indice'), int):
                    extra['indice'] = corpo_erro['indice']      # POST /op: qual op do pedido o juiz recusou
                raise Recusa(422, corpo_erro.get('erro') or 'o juiz recusou', **extra)
            raise Recusa(503, 'o juiz falhou (%d)' % e.code)
        except (urllib.error.URLError, OSError, ValueError):
            raise Recusa(503, 'o juiz do servidor não respondeu — tente de novo em instantes')

    def saude(self):
        try:
            return self.pede('GET', '/saude', tempo=3.0)
        except Recusa:
            return None
