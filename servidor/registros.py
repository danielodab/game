#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O registro de erros (02/10, antes do lançamento): o que quebra no navegador de quem
joga e o que estoura dentro da própria API, juntos num lugar que o Mestre lê no site.

Entra no cartório como mixin (`class Api(..., RegistrosMixin)` no api.py).

POR QUE: até aqui um erro de JavaScript na máquina de um jogador morria no console dele,
e a exceção não tratada da API só ia para o journal (log.exception) — que o dono só lê
quando alguém reclama. Com o jogo na internet, o primeiro aviso de um defeito tem de
chegar antes da reclamação.

O CAMINHO:
  - o cliente (js/core/registro_erros.js) pega window.onerror e unhandledrejection,
    tira repetidos, limita por sessão e por minuto e manda em lote para
    POST /api/registro/erros. Com ou sem login: a conta, se houver, sai do TOKEN aqui
    (nunca de um número que o cliente escreve);
  - a API registra as próprias exceções não tratadas (Atendente._atende chama
    registra_excecao_api no `except Exception`);
  - cada ERRO DISTINTO é uma linha de `erros_registro`, com a chave de repetição
    (sha256 da origem, da mensagem e do primeiro quadro da pilha), o contador, a
    primeira e a última vez e as últimas versões, telas e navegadores em que apareceu;
  - o Mestre lê agrupado em GET /api/mestre/erros e apaga o que já resolveu em
    POST /api/mestre/erros/apagar (site/mestre_erros.js).

O QUE NÃO SE GUARDA (a Política de Privacidade promete): nada de dado pessoal além do id
da conta. O texto passa por `limpa`: e-mail, endereço IP, token comprido e a consulta de
URL (?api=, ?v=…) viram marcadores antes de gravar. O navegador chega e fica resumido em
"família versão · sistema" (o User-Agent inteiro identifica demais). O IP de quem manda
serve só ao freio, em memória, e nunca vai ao banco.

OS TETOS (o registro não pode virar um jeito de encher o disco):
  - por pedido, LOTE_MAX erros; cada campo cortado (MENSAGEM_MAX, PILHA_MAX…);
  - por endereço (ou conta), POSTS_POR_MINUTO pedidos; o resto leva 429 e o cliente
    desiste da sessão;
  - no banco, CHAVES_MAX erros distintos: o mais velho (pela última vez) sai para o novo
    entrar; e RETENCAO_DIAS: a faxina apaga o que não aparece há 30 dias;
  - contas por erro: CONTAS_POR_ERRO (o painel diz "50 ou mais").

Só biblioteca padrão. Tabelas NOVAS, nunca ALTER (o rolling update divide o banco).
"""
import hashlib
import json
import logging
import os
import re
import sys
import threading
import time
import traceback

from comum import Recusa, agora, chave_do_ip, le_ip
from mestre import FRASE_SO_MESTRE

log = logging.getLogger('api')

RETENCAO_DIAS = 30
CHAVES_MAX = 5000                # erros distintos guardados (o banco inteiro)
LOTE_MAX = 20                    # erros num pedido só
POSTS_POR_MINUTO = 12            # pedidos por endereço (ou conta) por minuto
MENSAGEM_MAX = 300
PILHA_LINHAS = 8                 # quadros da pilha que ficam
PILHA_MAX = 1500
CAMPO_MAX = 60                   # tela, versão, navegador
LISTA_MAX = 10                   # versões, telas e navegadores distintos lembrados por erro
CONTAS_POR_ERRO = 50
VEZES_MAX = 1000                 # o "vezes" que um lote diz ter visto do mesmo erro (o cliente junta repetidos)
FAXINA_S = 600                   # a faxina dos 30 dias roda no máximo a cada 10 min por processo
PAINEL_MAX = 200                 # grupos no GET do Mestre
TIPOS = ('erro', 'promessa', 'excecao')

ESQUEMA_REGISTROS = """
-- 02/10: o registro de erros (servidor/registros.py). Uma linha por erro DISTINTO
CREATE TABLE IF NOT EXISTS erros_registro(
  chave        TEXT PRIMARY KEY,
  origem       TEXT NOT NULL CHECK (origem IN ('cliente', 'api')),
  tipo         TEXT NOT NULL,
  mensagem     TEXT NOT NULL,
  onde         TEXT,
  pilha        TEXT,
  contagem     INTEGER NOT NULL DEFAULT 1,
  primeira_em  INTEGER NOT NULL,
  ultima_em    INTEGER NOT NULL,
  versoes      TEXT,
  telas        TEXT,
  navegadores  TEXT
);
CREATE INDEX IF NOT EXISTS erros_registro_ultima ON erros_registro(ultima_em);
-- as contas que viram cada erro (até CONTAS_POR_ERRO): só o id, e somem com a conta
CREATE TABLE IF NOT EXISTS erros_registro_contas(
  chave     TEXT NOT NULL REFERENCES erros_registro(chave) ON DELETE CASCADE,
  conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  em        INTEGER NOT NULL,
  PRIMARY KEY (chave, conta_id)
);
CREATE INDEX IF NOT EXISTS erros_registro_contas_conta ON erros_registro_contas(conta_id);
"""

ROTAS_REGISTROS = {
    ('POST', '/api/registro/erros'):      ('registro_erros', False),
    ('GET',  '/api/mestre/erros'):        ('mestre_erros', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/erros/apagar'): ('mestre_erros_apagar', True, True, FRASE_SO_MESTRE),
}

# ---- a limpeza do texto (nada de dado pessoal no banco) ---------------------------------
_RE_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
_RE_IPV4 = re.compile(r'\b(\d{1,3}\.){3}\d{1,3}\b')
_RE_IPV6 = re.compile(r'\b([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b')
# token, hash, código: 24 ou mais, com letra E número (o nome comprido de uma função não tem número)
_RE_TOKEN = re.compile(r'\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}\b')
# a consulta de uma URL (?v=…, ?api=…, ?t=…) até o :linha da pilha; um '?' de frase fica
_RE_CONSULTA = re.compile(r'(?<=[\w/])\?[\w.%+\-]*=[\w.%=&+\-]*')
_RE_ORIGEM = re.compile(r'\b(https?|file|capacitor)://[^/\s)]*')   # o domínio: a mesma pilha em casa e no ar
_RE_NUMERO = re.compile(r'\d{4,}')
_RE_CONTROLE = re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')


def limpa(texto, tam):
    """Texto vindo de fora sem o que identifica alguém, cortado em `tam`."""
    if not isinstance(texto, str):
        return ''
    t = _RE_CONTROLE.sub(' ', texto[:tam * 4])
    t = _RE_EMAIL.sub('<email>', t)
    t = _RE_CONSULTA.sub('', t)
    t = _RE_ORIGEM.sub('', t)
    t = _RE_IPV4.sub('<ip>', t)
    t = _RE_IPV6.sub('<ip>', t)
    t = _RE_TOKEN.sub('<token>', t)
    return t.strip()[:tam]


def normaliza_mensagem(m):
    """A mensagem que entra na chave: números compridos (ids, instantes) viram '#',
    senão "sala 1789218000 caiu" e "sala 1789218001 caiu" seriam dois erros."""
    return _RE_NUMERO.sub('#', m)


def corta_pilha(pilha):
    linhas = [ln.strip() for ln in limpa(pilha, PILHA_MAX * 2).splitlines() if ln.strip()]
    return '\n'.join(linhas[:PILHA_LINHAS])[:PILHA_MAX]


def chave_de(origem, mensagem, pilha, onde):
    primeiro = (pilha.splitlines() or [''])[0] if pilha else ''
    base = '\n'.join((origem, normaliza_mensagem(mensagem), primeiro or onde or ''))
    return hashlib.sha256(base.encode('utf-8')).hexdigest()[:32]


def _junta_lista(texto, novo):
    """A lista JSON de um campo (versões, telas…) com `novo` no fim, sem repetir, até LISTA_MAX."""
    try:
        lista = json.loads(texto) if texto else []
    except ValueError:
        lista = []
    if not isinstance(lista, list):
        lista = []
    if novo:
        lista = [x for x in lista if x != novo] + [novo]
    return json.dumps(lista[-LISTA_MAX:], ensure_ascii=False)


def _lista(texto):
    try:
        v = json.loads(texto) if texto else []
    except ValueError:
        return []
    return v if isinstance(v, list) else []


def le_entrada(e):
    """Uma entrada do lote do cliente, limpa e cortada; None se não serve."""
    if not isinstance(e, dict):
        return None
    mensagem = limpa(e.get('mensagem'), MENSAGEM_MAX)
    if not mensagem:
        return None
    tipo = e.get('tipo') if e.get('tipo') in TIPOS else 'erro'
    vezes = e.get('vezes')
    vezes = vezes if isinstance(vezes, int) and not isinstance(vezes, bool) and 1 <= vezes <= VEZES_MAX else 1
    return {'tipo': tipo, 'mensagem': mensagem, 'pilha': corta_pilha(e.get('pilha')),
            'onde': limpa(e.get('onde'), 200), 'vezes': vezes}


class RegistrosMixin:

    def _registros_init(self):
        self._registro_baldes = {}       # chave do endereço ou da conta → [instantes] (em memória: é freio, não trilha)
        self._registro_tranca = threading.Lock()
        self._registro_faxina_em = 0

    # -- o freio --------------------------------------------------------------------------
    def _registro_freia(self, chave):
        t = time.monotonic()
        with self._registro_tranca:
            lista = [x for x in self._registro_baldes.get(chave, ()) if x > t - 60]
            if len(lista) >= POSTS_POR_MINUTO:
                self._registro_baldes[chave] = lista
                return False
            lista.append(t)
            self._registro_baldes[chave] = lista
            if len(self._registro_baldes) > 20000:          # quem some do minuto não ocupa memória para sempre
                for k in [k for k, v in self._registro_baldes.items() if not v or v[-1] <= t - 60]:
                    del self._registro_baldes[k]
        return True

    # -- a gravação (dentro de _escrita) ----------------------------------------------------
    def _registro_faxina(self, t, forcar=False):
        if not forcar and time.monotonic() - self._registro_faxina_em < FAXINA_S:
            return
        self._registro_faxina_em = time.monotonic()
        n = self.con.execute("DELETE FROM erros_registro WHERE ultima_em < ?", (t - RETENCAO_DIAS * 86400,)).rowcount
        if n:
            log.info("registro de erros: %d erro(s) sem aparecer há %d dias saíram", n, RETENCAO_DIAS)

    def _registro_grava(self, origem, ent, contexto, conta_id, t):
        """Uma entrada limpa (le_entrada) no banco: soma na linha da chave ou abre outra."""
        chave = chave_de(origem, ent['mensagem'], ent['pilha'], ent['onde'])
        r = self.con.execute("SELECT versoes, telas, navegadores FROM erros_registro WHERE chave = ?",
                             (chave,)).fetchone()
        versao, tela, nav = contexto.get('versao'), contexto.get('tela'), contexto.get('navegador')
        if r is None:
            total = self.con.execute("SELECT COUNT(*) FROM erros_registro").fetchone()[0]
            if total >= CHAVES_MAX:
                # cheio: sai o que está quieto há mais tempo (um erro novo vale mais que um velho resolvido)
                self.con.execute("DELETE FROM erros_registro WHERE chave IN (SELECT chave FROM erros_registro "
                                 "ORDER BY ultima_em, chave LIMIT ?)", (total - CHAVES_MAX + 1,))
            self.con.execute(
                "INSERT INTO erros_registro(chave, origem, tipo, mensagem, onde, pilha, contagem, primeira_em, "
                "ultima_em, versoes, telas, navegadores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (chave, origem, ent['tipo'], ent['mensagem'], ent['onde'] or None, ent['pilha'] or None, ent['vezes'],
                 t, t, _junta_lista(None, versao), _junta_lista(None, tela), _junta_lista(None, nav)))
        else:
            self.con.execute(
                "UPDATE erros_registro SET contagem = contagem + ?, ultima_em = ?, versoes = ?, telas = ?, "
                "navegadores = ? WHERE chave = ?",
                (ent['vezes'], t, _junta_lista(r['versoes'], versao), _junta_lista(r['telas'], tela),
                 _junta_lista(r['navegadores'], nav), chave))
        if conta_id is not None:
            ja = self.con.execute("SELECT COUNT(*) FROM erros_registro_contas WHERE chave = ?", (chave,)).fetchone()[0]
            if ja < CONTAS_POR_ERRO:
                self.con.execute("INSERT OR REPLACE INTO erros_registro_contas(chave, conta_id, em) VALUES (?, ?, ?)",
                                 (chave, conta_id, t))
            else:
                self.con.execute("UPDATE erros_registro_contas SET em = ? WHERE chave = ? AND conta_id = ?",
                                 (t, chave, conta_id))
        return chave

    # -- POST /api/registro/erros (com ou sem conta) ---------------------------------------
    def registro_erros(self, conta, corpo):
        lote = corpo.get('erros')
        if not isinstance(lote, list) or not lote:
            raise Recusa(400, 'erros precisa ser uma lista com pelo menos um erro')
        # a conta vem do TOKEN (se houver e estiver vivo); token morto não é 401 aqui: o erro
        # de quem acabou de cair também interessa
        token = corpo.get('_token')
        conta = self.conta_do_token(token) if token else None
        if conta is not None and conta['banido']:
            conta = None
        ip = le_ip(corpo.get('_ip'))
        freio = ('conta:%d' % conta['id']) if conta is not None else ('ip:%s' % (chave_do_ip(ip) if ip else '?'))
        if not self._registro_freia(freio):
            raise Recusa(429, 'erros demais deste lugar agora; o resto fica para depois', liberaEm=agora() + 60)
        contexto = {'versao': limpa(corpo.get('versao'), CAMPO_MAX) or None,
                    'tela': limpa(corpo.get('tela'), CAMPO_MAX) or None,
                    'navegador': limpa(corpo.get('navegador'), CAMPO_MAX) or None}
        entradas = [x for x in (le_entrada(e) for e in lote[:LOTE_MAX]) if x is not None]
        t = agora()
        with self._escrita():
            self._registro_faxina(t)
            for ent in entradas:
                self._registro_grava('cliente', ent, contexto, conta['id'] if conta is not None else None, t)
        return 200, {'ok': True, 'aceitos': len(entradas), 'descartados': len(lote) - len(entradas)}

    # -- a exceção não tratada da própria API ----------------------------------------------
    def registra_excecao_api(self, metodo, caminho, token=None):
        """Chamada DE DENTRO do `except Exception` do Atendente (sys.exc_info vale). Nunca
        levanta: o registro de um erro não pode virar outro erro na resposta."""
        try:
            tipo, valor, tb = sys.exc_info()
            if tipo is None:
                return
            quadros = traceback.extract_tb(tb)[-PILHA_LINHAS:]
            # só arquivo:linha em função — nada das variáveis locais (elas teriam o corpo do pedido)
            pilha = '\n'.join('%s:%d em %s' % (os.path.basename(q.filename), q.lineno, q.name)
                              for q in reversed(quadros))
            ent = {'tipo': 'excecao', 'mensagem': limpa('%s: %s' % (tipo.__name__, valor), MENSAGEM_MAX) or tipo.__name__,
                   'pilha': pilha[:PILHA_MAX], 'onde': limpa('%s %s' % (metodo, caminho), 200), 'vezes': 1}
            t = agora()
            with self._escrita():
                cid = None
                if token:
                    r = self.con.execute("SELECT conta_id FROM sessoes WHERE token = ?", (token,)).fetchone()
                    cid = r[0] if r is not None else None
                self._registro_faxina(t)
                self._registro_grava('api', ent, {'versao': None, 'tela': None, 'navegador': None}, cid, t)
        except Exception:                                    # noqa: BLE001
            log.exception("registro de erros: a exceção da API não foi registrada")

    # -- o painel do Mestre -------------------------------------------------------------------
    def mestre_erros(self, conta, corpo):
        t = agora()
        with self._escrita():
            self._registro_faxina(t, forcar=True)
        with self.tranca:
            linhas = self.con.execute(
                "SELECT e.*, (SELECT COUNT(*) FROM erros_registro_contas x WHERE x.chave = e.chave) AS contas "
                "FROM erros_registro e ORDER BY e.ultima_em DESC, e.chave LIMIT ?", (PAINEL_MAX,)).fetchall()
            total, vezes = self.con.execute("SELECT COUNT(*), COALESCE(SUM(contagem), 0) FROM erros_registro").fetchone()
            dia = self.con.execute("SELECT COUNT(*) FROM erros_registro WHERE ultima_em > ?", (t - 86400,)).fetchone()[0]
        return 200, {
            'ok': True, 'agora': t, 'retencaoDias': RETENCAO_DIAS, 'total': total, 'vezes': vezes, 'ultimas24h': dia,
            'mais': total > len(linhas),
            'erros': [{'chave': r['chave'], 'origem': r['origem'], 'tipo': r['tipo'], 'mensagem': r['mensagem'],
                       'onde': r['onde'], 'pilha': r['pilha'], 'contagem': r['contagem'],
                       'primeiraEm': r['primeira_em'], 'ultimaEm': r['ultima_em'], 'versoes': _lista(r['versoes']),
                       'telas': _lista(r['telas']), 'navegadores': _lista(r['navegadores']),
                       'contas': r['contas'], 'contasNoTeto': r['contas'] >= CONTAS_POR_ERRO} for r in linhas]}

    def mestre_erros_apagar(self, conta, corpo):
        """O Mestre resolveu: o grupo sai (se voltar a acontecer, nasce de novo, com contagem nova)."""
        chave, tudo = corpo.get('chave'), corpo.get('tudo') is True
        if not tudo and (not isinstance(chave, str) or not re.match(r'^[0-9a-f]{32}$', chave)):
            raise Recusa(400, 'diga a chave do erro (ou tudo: true)')
        with self._escrita():
            if tudo:
                n = self.con.execute("DELETE FROM erros_registro").rowcount
            else:
                n = self.con.execute("DELETE FROM erros_registro WHERE chave = ?", (chave,)).rowcount
            self._evento(conta['id'], 'erros-apagados', {'quantos': n, 'tudo': tudo})
        log.info("registro de erros: o Mestre #%d apagou %d grupo(s)", conta['id'], n)
        return 200, {'ok': True, 'apagados': n}
