# -*- coding: utf-8 -*-
"""O REGISTRO DE EVENTOS DE USO (15/10) — o funil, somado por dia, sem linha por jogador.

O cliente (js/core/eventos_uso.js) manda lotes de {nome, n}: 'boot', 'retorno_1d', 'tela:battle'…
Aqui só se SOMA em (dia × nome × versão × plataforma). Não há conta, nome, e-mail nem endereço na
tabela — o token da sessão, quando vem, serve só ao freio por conta (como no registro de erros) e
não é gravado; sem token o freio é por endereço, e o endereço também não é gravado.

Por isso a tabela não precisa de faxina ao excluir a conta (nada aponta para contas) e não entra
no "baixar meus dados" (não há nada seu nela). O que ela precisa é de retenção: RETENCAO_DIAS.

O Mestre lê GET /api/mestre/eventos?dias=30 e o site/mestre_eventos.js desenha o funil.
"""
import logging
import re
import threading
import time

from comum import Recusa, agora, chave_do_ip, le_ip
from mestre import FRASE_SO_MESTRE

log = logging.getLogger('api')

RETENCAO_DIAS = 180
LOTE_MAX = 30                    # eventos distintos num pedido
N_MAX = 50                       # o "n" que um lote diz de um mesmo evento
POSTS_POR_MINUTO = 12            # pedidos por endereço (ou conta) por minuto
NOMES_POR_DIA = 400              # nomes distintos que um dia aceita (contra lixo inventado)
DIAS_MAX = 180                   # o máximo que o painel pede
FAXINA_S = 600
NOME_RE = re.compile(r'^[A-Za-z0-9_:.\-]{1,40}$')
PLATAFORMAS = ('app', 'celular', 'pc')
FUSO_S = -3 * 3600               # o dia de Brasília, como o resto do jogo

ESQUEMA_EVENTOS_USO = """
-- 15/10: os eventos de uso (servidor/eventos_uso.py): uma linha por dia × nome × versão × plataforma, só a soma
CREATE TABLE IF NOT EXISTS eventos_uso(
  dia         TEXT NOT NULL,
  nome        TEXT NOT NULL,
  versao      TEXT NOT NULL DEFAULT '',
  plataforma  TEXT NOT NULL DEFAULT '',
  contagem    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, nome, versao, plataforma)
);
CREATE INDEX IF NOT EXISTS eventos_uso_dia ON eventos_uso(dia);
"""

ROTAS_EVENTOS_USO = {
    ('POST', '/api/registro/eventos'): ('registro_eventos', False),
    ('GET',  '/api/mestre/eventos'):   ('mestre_eventos', True, True, FRASE_SO_MESTRE),
}


def dia_de(t):
    """'AAAA-MM-DD' no dia de Brasília."""
    return time.strftime('%Y-%m-%d', time.gmtime(t + FUSO_S))


def le_evento(e):
    if not isinstance(e, dict):
        return None
    nome = e.get('nome')
    if not isinstance(nome, str) or not NOME_RE.match(nome):
        return None
    n = e.get('n', 1)
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        n = 1
    return {'nome': nome, 'n': min(n, N_MAX)}


def limpa_campo(v, maximo, permitido=None):
    if not isinstance(v, str):
        return ''
    v = v.strip()[:maximo]
    if permitido is not None and v not in permitido:
        return ''
    return v


class EventosUsoMixin:

    def _eventos_uso_init(self):
        self._eventos_baldes = {}
        self._eventos_tranca = threading.Lock()
        self._eventos_faxina_em = 0

    def _eventos_freia(self, chave):
        t = time.monotonic()
        with self._eventos_tranca:
            lista = [x for x in self._eventos_baldes.get(chave, ()) if x > t - 60]
            if len(lista) >= POSTS_POR_MINUTO:
                self._eventos_baldes[chave] = lista
                return False
            lista.append(t)
            self._eventos_baldes[chave] = lista
            if len(self._eventos_baldes) > 20000:
                for k in [k for k, v in self._eventos_baldes.items() if not v or v[-1] <= t - 60]:
                    del self._eventos_baldes[k]
        return True

    def _eventos_faxina(self, t, forcar=False):
        if not forcar and time.monotonic() - self._eventos_faxina_em < FAXINA_S:
            return
        self._eventos_faxina_em = time.monotonic()
        limite = dia_de(t - RETENCAO_DIAS * 86400)
        n = self.con.execute("DELETE FROM eventos_uso WHERE dia < ?", (limite,)).rowcount
        if n:
            log.info("eventos de uso: %d linha(s) de antes de %s saíram", n, limite)

    # -- POST /api/registro/eventos (com ou sem conta) -------------------------------------
    def registro_eventos(self, conta, corpo):
        lote = corpo.get('eventos')
        if not isinstance(lote, list) or not lote:
            raise Recusa(400, 'eventos precisa ser uma lista com pelo menos um evento')
        token = corpo.get('_token')
        conta = self.conta_do_token(token) if token else None
        if conta is not None and conta['banido']:
            conta = None
        ip = le_ip(corpo.get('_ip'))
        freio = ('conta:%d' % conta['id']) if conta is not None else ('ip:%s' % (chave_do_ip(ip) if ip else '?'))
        if not self._eventos_freia(freio):
            raise Recusa(429, 'eventos demais deste lugar agora; o resto fica para depois', liberaEm=agora() + 60)
        versao = limpa_campo(corpo.get('versao'), 40)
        plataforma = limpa_campo(corpo.get('plataforma'), 12, PLATAFORMAS)
        eventos = [x for x in (le_evento(e) for e in lote[:LOTE_MAX]) if x is not None]
        t = agora()
        dia = dia_de(t)
        aceitos = 0
        with self._escrita():
            self._eventos_faxina(t)
            nomes_hoje = self.con.execute("SELECT COUNT(DISTINCT nome) FROM eventos_uso WHERE dia = ?", (dia,)).fetchone()[0]
            for ev in eventos:
                existe = self.con.execute("SELECT 1 FROM eventos_uso WHERE dia = ? AND nome = ? LIMIT 1",
                                          (dia, ev['nome'])).fetchone()
                if existe is None:
                    if nomes_hoje >= NOMES_POR_DIA:
                        continue
                    nomes_hoje += 1
                self.con.execute(
                    "INSERT INTO eventos_uso(dia, nome, versao, plataforma, contagem) VALUES (?, ?, ?, ?, ?) "
                    "ON CONFLICT(dia, nome, versao, plataforma) DO UPDATE SET contagem = contagem + excluded.contagem",
                    (dia, ev['nome'], versao, plataforma, ev['n']))
                aceitos += 1
        return 200, {'ok': True, 'aceitos': aceitos, 'descartados': len(lote) - aceitos}

    # -- GET /api/mestre/eventos?dias=30 -----------------------------------------------------
    def mestre_eventos(self, conta, corpo):
        q = corpo.get('_query') or {}
        try:
            dias = int((q.get('dias') or ['30'])[0] if isinstance(q.get('dias'), list) else (q.get('dias') or 30))
        except (TypeError, ValueError):
            dias = 30
        dias = max(1, min(DIAS_MAX, dias))
        desde = dia_de(agora() - (dias - 1) * 86400)
        with self.tranca:
            linhas = [dict(r) for r in self.con.execute(
                "SELECT dia, nome, versao, plataforma, contagem FROM eventos_uso WHERE dia >= ? ORDER BY dia, nome",
                (desde,))]
        por_nome, por_dia, por_plataforma = {}, {}, {}
        for r in linhas:
            por_nome[r['nome']] = por_nome.get(r['nome'], 0) + r['contagem']
            d = por_dia.setdefault(r['dia'], {})
            d[r['nome']] = d.get(r['nome'], 0) + r['contagem']
            por_plataforma[r['plataforma'] or '?'] = por_plataforma.get(r['plataforma'] or '?', 0) + r['contagem']
        return 200, {'ok': True, 'dias': dias, 'desde': desde, 'linhas': linhas, 'porNome': por_nome,
                     'porDia': por_dia, 'porPlataforma': por_plataforma, 'retencaoDias': RETENCAO_DIAS}
