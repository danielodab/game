#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Os pacotes de vinténs pagos com dinheiro de verdade (Loja 2, 10/09):
Mercado Pago Checkout Pro (Pix e cartão), só pelo servidor, REST com urllib.

Entra no cartório como mixin (`class Api(..., PagamentoMixin)` no api.py).

O CAMINHO DE UM PACOTE:
  1. o site pede (POST /api/pagamento/pacote): o servidor grava a intenção
     (`pagamentos`), cria a PREFERÊNCIA no Mercado Pago e devolve o endereço de
     pagamento; o jogador paga na página do Mercado Pago;
  2. o Mercado Pago avisa (POST /api/pagamento/aviso, configurado no painel
     dele): o servidor confere a ASSINATURA (x-signature) e CONSULTA o
     pagamento na API do Mercado Pago — nunca confia no corpo do aviso;
  3. aprovado, o servidor credita os vinténs UMA vez, como um crédito da loja
     (loja.py: o pedido de preço 0 com entrega {tipo:'vintens'}), que anda pelo
     mesmo caminho de toda entrega; até o jogo receber, os vinténs contam no
     saldo do site ("a caminho");
  4. a volta do navegador (POST /api/pagamento/conferir) só DISPARA uma
     consulta ao Mercado Pago pela external_reference: cobre o aviso perdido;
  5. (26/10) o servidor também confere SOZINHO, de minuto em minuto, as
     intenções abertas e ainda sem crédito (`liga_conferencia`): o crédito não
     depende do aviso chegar nem do jogador voltar à loja.

AS REGRAS QUE SEGURAM O DINHEIRO:
  - Nunca credita pela volta do navegador nem pelo corpo do aviso: sempre pelo
    que a API do Mercado Pago responde, com o nosso token.
  - UM crédito por pagamento do Mercado Pago, em três camadas: a chave
    `pagamentos_mp.mp_id` (o id DELE), o `creditado_em IS NULL` lido dentro do
    BEGIN IMMEDIATE (vale entre os dois contêineres do rolling update) e o
    índice único loja_pedidos(conta_id, idem) com 'mp:<id>' (os dois-pontos
    não passam no RE_IDEM: nenhuma compra do jogador ocupa essa chave).
  - A assinatura é conferida ANTES de qualquer consulta (o servidor não vira
    amplificador de quem forja aviso).
  - O estado de um pagamento só anda para a frente (ETAPA): a leitura velha que
    chega depois da nova é ignorada — um 'approved' atrasado não credita um
    pagamento já estornado.
  - O teto de R$ 400,00 por conta em 24 h vale nas intenções E no que credita:
    a mesma preferência aceita mais de um pagamento; o que passa do teto não
    credita e vira alerta 'teto-diario' (o Mestre decide).
  - Aviso que não pode ser processado por configuração errada (o modo de teste
    trocado) responde 503: o Mercado Pago avisa de novo depois da correção. E o
    Mestre tem o botão "conferir no Mercado Pago" (a mesma consulta da volta).
  - Nenhum dado pessoal vai ao Mercado Pago (sem e-mail, sem nome na
    preferência): o Mercado Pago pede o que precisar na página dele.
  - O token e a assinatura secreta nunca vão para log, repr nem erro. HTTP
    sempre FORA de self.tranca e de _escrita (como o SMTP do correio.py).
  - Estorno e contestação NÃO tiram vinténs do save: marcam a conta
    (`contas_alertas`, que o painel do Mestre mostra) e logam; o dono decide.

AS BARRAS DE OURO (13/09, loja.py): os pacotes à venda são de BARRAS. Aprovado o
pagamento, as barras entram NA HORA no saldo da conta (`barras_move`, motivo
'pacote', idem 'mp:<id>' — a terceira camada, no lugar do índice de
loja_pedidos), sem pedido nem jogo no meio. No estorno ou na contestação, as
barras que ainda houver saem ('estorno-pagamento'); o que já foi gasto não tem de
onde sair e vai no alerta ('faltou'). A coluna `pagamentos.vintens` guarda a
QUANTIDADE do pacote na moeda dele (sem ALTER: o rolling update); o pagamento
de um pacote de vinténs criado antes do deploy ainda credita vinténs.

A configuração vem SÓ de variáveis de ambiente (no Coolify: Runtime ligado,
Build DESLIGADO; no token e na assinatura, "Is Literal"; ver SUBIR.md, seção 7):

  SOTERRA_MP_TOKEN     o Access Token (o de produção começa com APP_USR-)
  SOTERRA_MP_SEGREDO   a assinatura secreta do webhook (painel do Mercado Pago)
  SOTERRA_ENDERECO     https://soterra.viidoo.io (aqui obrigatório: a volta do navegador)
  SOTERRA_MP_TESTE=1   opcional: usa o sandbox_init_point e credita o pagamento de
                       teste venha com o live_mode que vier (26/10: no modelo novo do
                       Mercado Pago o teste corre em produção); sem ela, só live_mode=true

Ligado = TOKEN, SEGREDO e ENDERECO. Desligado, os pacotes aparecem "em breve",
as rotas de pagamento respondem 503 e o resto funciona igual. O `--mp-api URL`
do api.py (SÓ para as provas: http://127.0.0.1:PORTA) troca a API de verdade
pelo Mercado Pago de mentira de tests/mp_falso.py; não há variável para isso.
"""
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from comum import Recusa, agora
from loja import PACOTES_A_VENDA, POR_PACOTE, RE_IDEM, id_valido, le_json, moeda_do_pacote, reais

log = logging.getLogger('api')

API_REAL = 'https://api.mercadopago.com'
TIMEOUT = 10
PACOTES_POR_HORA = 10            # pedidos de pacote por conta por hora (freio 'pagamento:<conta>')
TETO_CENTAVOS_DIA = 40000        # R$ 400,00 por conta em 24 h: nas intenções (as que falharam não contam) E
                                 # no que credita (a mesma preferência aceita vários pagamentos: o que passa espera)
CONFERIR_POR_HORA = 30           # voltas do navegador por conta por hora
REEMISSOES_MAX = 3               # crédito de pacote recusado pelo jogo volta até 3 vezes; na 4ª, alerta
PAGAMENTOS_LISTA = 20
ALERTAS_LISTA = 50
ALERTAS_VISTOS_DA_CONTA = 10
PREFERENCIA_VALIDADE = 2 * 3600  # o link de pagamento vale 2 h: Pix e cartão fecham em minutos, e um link vivo
                                 # aceita mais de um pagamento (o teto no crédito segura o resto)
CONFERE_A_CADA = 60              # s entre duas voltas da conferência automática (26/10, liga_conferencia)
CONFERE_NOVOS = 3 * 3600         # a intenção mais nova que isto é conferida em toda volta (o link vale 2 h)…
CONFERE_VELHOS = 24 * 3600       # …e até 24 h (o Pix ou o cartão em análise que demora), de
CONFERE_VELHOS_A_CADA = 15       # 15 em 15 voltas
CONFERE_LOTE = 50                # intenções por volta, as mais novas primeiro
CRIADO_PRESO = 30                # s: intenção 'criado' mais velha que isto é retomada no mesmo idem
RE_REFERENCIA = re.compile(r'^sot-(\d{1,15})-[0-9a-f]{16}$')
RE_MP_ID = re.compile(r'^\d{1,20}$')
FUSO = timezone(timedelta(hours=-3))       # Brasília, deslocamento fixo (como o api.py)
PENDENTES = ('pending', 'in_process', 'authorized')
RECUSADOS = ('rejected', 'cancelled')
ESTORNOS = ('refunded', 'charged_back')              # terminais: o dinheiro voltou ao comprador
CONTESTACOES = ('charged_back',)
EM_DISPUTA = ('in_mediation',)                       # reclamação ABERTA: pode voltar a 'approved' (o vendedor
                                                     # ganhou) ou virar estorno; não cancela nada, só alerta
# A ordem das etapas de um pagamento. A consulta ao Mercado Pago roda FORA da trava: duas leituras em voo
# do mesmo pagamento (aviso e reenvio, aviso e conferência, os dois contêineres) podem gravar fora de
# ordem, e a que faria o estado VOLTAR é velha. A única volta que vale: a disputa encerrada a favor do
# vendedor (in_mediation → approved).
ETAPA = {'pending': 1, 'in_process': 1, 'authorized': 1, 'approved': 2, 'in_mediation': 3,
         'rejected': 4, 'cancelled': 4, 'refunded': 4, 'charged_back': 4}
TIPOS_ALERTA = ('estorno', 'contestacao', 'estorno-antes-da-entrega', 'valor-diferente', 'conta-banida',
                'credito-recusado', 'teto-diario', 'barras-faltaram')
HOSTS_MP = ('mercadopago.com.br', 'mercadopago.com')
FRASE_EM_BREVE = 'os pacotes de barras de ouro chegam em breve'
FRASE_DESLIGADO = 'pagamentos desligados'
FRASE_MP_FORA = 'o Mercado Pago não respondeu; tente de novo em instantes'
FRASE_MP_FORA_AVISO = 'o Mercado Pago não respondeu'
FRASE_MODO_TROCADO = 'modo do servidor trocado (confira SOTERRA_MP_TESTE)'

ESQUEMA_PAGAMENTO = """
-- a intenção de compra de um pacote (uma preferência no Mercado Pago); dinheiro é trilha: a conta que some deixa a linha
CREATE TABLE IF NOT EXISTS pagamentos(
  id            INTEGER PRIMARY KEY,
  conta_id      INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  pacote        TEXT NOT NULL,
  vintens       INTEGER NOT NULL CHECK (vintens > 0),
  centavos      INTEGER NOT NULL CHECK (centavos > 0),
  referencia    TEXT UNIQUE,
  preferencia   TEXT,
  endereco      TEXT,
  estado        TEXT NOT NULL DEFAULT 'criado' CHECK (estado IN ('criado', 'aberto', 'falhou')),
  idem          TEXT,
  criado_em     INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_idem ON pagamentos(conta_id, idem) WHERE idem IS NOT NULL;
CREATE INDEX IF NOT EXISTS pagamentos_conta ON pagamentos(conta_id, criado_em);
-- cada pagamento do Mercado Pago (o id DELE é a chave): credita UMA vez
CREATE TABLE IF NOT EXISTS pagamentos_mp(
  mp_id          TEXT PRIMARY KEY,
  pagamento_id   INTEGER NOT NULL REFERENCES pagamentos(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  detalhe        TEXT,
  valor_centavos INTEGER,
  pedido_id      INTEGER REFERENCES loja_pedidos(id) ON DELETE SET NULL,
  reemissoes     INTEGER NOT NULL DEFAULT 0,
  creditado_em   INTEGER,
  estornado_em   INTEGER,
  atualizado_em  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pagamentos_mp_pagamento ON pagamentos_mp(pagamento_id);
-- o que o dono precisa olhar (estorno, contestação, valor estranho…): o Mestre marca como visto
CREATE TABLE IF NOT EXISTS contas_alertas(
  id        INTEGER PRIMARY KEY,
  conta_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  tipo      TEXT NOT NULL,
  dados     TEXT,
  criado_em INTEGER NOT NULL,
  visto_em  INTEGER,
  visto_por INTEGER REFERENCES contas(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS contas_alertas_abertos ON contas_alertas(visto_em, id);
"""


# ---- a assinatura do aviso (funções puras; tests/pagamento_api.py cobre) -----------------------
# A regra da documentação oficial de webhooks do Mercado Pago (conferida em 10/09):
# x-signature = "ts=<carimbo>,v1=<hmac>" (partes por vírgula, chave=valor, com espaço
# em volta tolerado); o manifesto é "id:<data.id>;request-id:<x-request-id>;ts:<ts>;",
# com o data.id (da URL) em minúsculas e sem a parte cujo valor não veio; o hmac é
# SHA-256, em hexadecimal, com a assinatura secreta do painel como chave.
def le_assinatura(cabecalho):
    """'ts=1704908010,v1=618c85…' → (ts, v1); None no que faltar."""
    ts = v1 = None
    if isinstance(cabecalho, str):
        for parte in cabecalho.split(','):
            chave, sep, valor = parte.partition('=')
            if not sep:
                continue
            chave, valor = chave.strip(), valor.strip()
            if chave == 'ts':
                ts = valor or None
            elif chave == 'v1':
                v1 = valor or None
    return ts, v1


def manifesto(data_id, request_id, ts):
    partes = []
    if data_id:
        partes.append('id:%s' % data_id.lower())
    if request_id:
        partes.append('request-id:%s' % request_id)
    partes.append('ts:%s' % ts)
    return ';'.join(partes) + ';'


def assina(segredo, data_id, request_id, ts):
    chave = segredo.encode('utf-8') if isinstance(segredo, str) else segredo
    return hmac.new(chave, manifesto(data_id, request_id, ts).encode('utf-8'), hashlib.sha256).hexdigest()


def assinatura_confere(segredo, cabecalho, request_id, data_id):
    """True só se o x-signature casa com o manifesto deste aviso."""
    ts, v1 = le_assinatura(cabecalho)
    if not segredo or not ts or not v1:
        return False
    esperado = assina(segredo, data_id if isinstance(data_id, str) else None,
                      request_id if isinstance(request_id, str) else None, ts)
    return hmac.compare_digest(esperado.encode('ascii'), v1.encode('utf-8', errors='replace'))


def base_de_prova(url):
    """O `--mp-api` do api.py: SÓ http://127.0.0.1:PORTA ou http://localhost:PORTA."""
    try:
        p = urllib.parse.urlsplit(url or '')
        porta = p.port
    except ValueError:
        porta = None
    if (p.scheme != 'http' or p.hostname not in ('127.0.0.1', 'localhost') or not porta or p.path not in ('', '/')
            or p.query or p.fragment or p.username or p.password):
        raise ValueError('--mp-api aceita só http://127.0.0.1:PORTA ou http://localhost:PORTA (é para as provas)')
    return 'http://%s:%d' % (p.hostname, porta)


def endereco_do_mp(url):
    """O endereço de pagamento que o Mercado Pago devolveu, se for mesmo dele (https, host dele)."""
    if not isinstance(url, str) or len(url) > 2000:
        return False
    try:
        p = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (p.hostname or '').lower()
    return p.scheme == 'https' and any(host == h or host.endswith('.' + h) for h in HOSTS_MP)


def _iso(instante):
    return datetime.fromtimestamp(instante, FUSO).isoformat(timespec='milliseconds')


def _texto(v, tam):
    return v[:tam] if isinstance(v, str) and v else None


def _centavos(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float('inf'), float('-inf')):
        return None
    return int(round(v * 100))


def moeda_do_pagamento(pg):
    """13/09: 'barras' (os pacotes de hoje) ou 'vintens' (o pacote antigo, fora da venda)."""
    pacote = POR_PACOTE.get(pg['pacote'])
    if pacote is not None:
        return moeda_do_pacote(pacote)
    return 'barras' if str(pg['pacote']).startswith('barras-') else 'vintens'


def qtd_dados(pg):
    """O pedaço dos dados de alerta e de evento que diz quanto o pacote vale: {'barras': N} ou {'vintens': N}."""
    return {moeda_do_pagamento(pg): pg['vintens']}


def estado_publico(pg, mps):
    """O estado que o site mostra, derivado da intenção e dos pagamentos do Mercado Pago dela."""
    if pg['estado'] == 'falhou':
        return 'falhou'
    if not mps:
        return 'aberto'
    if any(m['status'] == 'approved' and m['creditado_em'] is not None and m['estornado_em'] is None for m in mps):
        return 'aprovado'
    sts = [m['status'] for m in mps]
    # aprovado sem crédito (valor estranho, acima do teto de 24 h) e disputa aberta: em análise
    if any(s in PENDENTES or s in EM_DISPUTA or s == 'approved' for s in sts):
        return 'pendente'
    if any(s in ESTORNOS for s in sts):
        return 'estornado'
    if any(s in RECUSADOS for s in sts):
        return 'recusado'
    return 'pendente'


def pag_publico(pg, mps):
    """<pag> (o contrato do site): {id, pacote, nome, moeda, barras, vintens, centavos, preco, estado, creditado,
    pedido, criadoEm, atualizadoEm}. A quantidade soma os créditos válidos quando a pessoa pagou mais de uma vez na
    mesma preferência; ela vai em `barras` ou em `vintens` conforme a `moeda` do pacote (a outra fica 0). O pacote
    de barras não tem `pedido` (as barras entram direto no saldo)."""
    pacote = POR_PACOTE.get(pg['pacote'])
    validos = [m for m in mps if m['creditado_em'] is not None and m['estornado_em'] is None]
    creditados = [m for m in mps if m['creditado_em'] is not None]
    ultimo = max(creditados, key=lambda m: (m['creditado_em'], m['mp_id'])) if creditados else None
    moeda = moeda_do_pagamento(pg)
    qtd = pg['vintens'] * max(1, len(validos))
    return {'id': pg['id'], 'pacote': pg['pacote'], 'nome': pacote['nome'] if pacote else pg['pacote'], 'moeda': moeda,
            'barras': qtd if moeda == 'barras' else 0, 'vintens': qtd if moeda == 'vintens' else 0,
            'centavos': pg['centavos'], 'preco': reais(pg['centavos']),
            'estado': estado_publico(pg, mps), 'creditado': bool(validos),
            'pedido': ({'id': ultimo['pedido_id'], 'estado': ultimo['pedido_estado']}
                       if ultimo is not None and ultimo['pedido_id'] is not None else None),
            'criadoEm': pg['criado_em'],
            'atualizadoEm': max([pg['atualizado_em']] + [m['atualizado_em'] for m in mps])}


# ---- o Mercado Pago (a conversa HTTP) ---------------------------------------------------------
class MercadoPagoFalhou(Exception):
    """A conversa com o Mercado Pago falhou. A mensagem é para o log: só o código HTTP
    ou o tipo do erro (nunca o token, nunca a URL com consulta)."""


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    """Redirecionamento vira erro: o urllib levaria o Authorization junto para outro endereço."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_ABRE = urllib.request.build_opener(_SemRedirecionar)


class MercadoPago:
    """Sem argumentos: desligado (é o que o cartório usa quando ninguém passa um,
    como nos testes que criam a Api dentro do processo)."""

    def __init__(self, token=None, segredo=None, endereco=None, teste=False, base=None):
        self._token = token or None
        self._segredo = segredo or None
        self.endereco = (endereco or '').rstrip('/') or None
        self.teste = bool(teste)
        self.base = (base or API_REAL).rstrip('/')
        self.prova = self.base != API_REAL

    def __repr__(self):                 # nunca o token nem a assinatura, nem num traceback
        return '<MercadoPago %s>' % self.descricao()

    @classmethod
    def do_ambiente(cls, env=None, base=None):
        env = os.environ if env is None else env

        def valor(nome):
            v = env.get(nome)
            return v.strip() if isinstance(v, str) and v.strip() else None

        teste = (valor('SOTERRA_MP_TESTE') or '').lower() in ('1', 'sim', 'true')
        return cls(token=valor('SOTERRA_MP_TOKEN'), segredo=valor('SOTERRA_MP_SEGREDO'),
                   endereco=valor('SOTERRA_ENDERECO'), teste=teste, base=base)

    @property
    def ligado(self):
        return bool(self._token and self._segredo and self.endereco)

    def descricao(self):
        """A linha do log de boot. Nunca o token nem a assinatura."""
        if not self.ligado:
            faltam = [nome for nome, v in (('SOTERRA_MP_TOKEN', self._token), ('SOTERRA_MP_SEGREDO', self._segredo),
                                           ('SOTERRA_ENDERECO', self.endereco)) if not v]
            return 'DESLIGADO (falta %s)' % ', '.join(faltam)
        linha = 'Mercado Pago (%s), volta em %s' % ('teste' if self.teste else 'produção', self.endereco)
        if self.prova:
            linha += ' — API DE PROVA em %s' % self.base
        return linha

    def confere(self, cabecalho, request_id, data_id):
        return assinatura_confere(self._segredo, cabecalho, request_id, data_id)

    def _pede(self, metodo, caminho, corpo=None, cabecalhos=None):
        dados = None if corpo is None else json.dumps(corpo, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(self.base + caminho, data=dados, method=metodo)
        req.add_header('Authorization', 'Bearer ' + (self._token or ''))
        req.add_header('Content-Type', 'application/json')
        req.add_header('Accept', 'application/json')
        for k, v in (cabecalhos or {}).items():
            req.add_header(k, v)
        try:
            with _ABRE.open(req, timeout=TIMEOUT) as r:
                status, bruto = r.status, r.read()
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                bruto = e.read()
            except Exception:                           # noqa: BLE001
                bruto = b''
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise MercadoPagoFalhou(e.__class__.__name__) from None
        try:
            resposta = json.loads(bruto.decode('utf-8')) if bruto else None
        except (UnicodeDecodeError, ValueError):
            resposta = None
        return status, resposta

    def cria_preferencia(self, corpo, chave):
        status, r = self._pede('POST', '/checkout/preferences', corpo, {'X-Idempotency-Key': chave})
        if status not in (200, 201) or not isinstance(r, dict):
            raise MercadoPagoFalhou('HTTP %d' % status)
        return r

    def consulta(self, mp_id):
        """O pagamento, ou None se o Mercado Pago não o conhece (404)."""
        status, r = self._pede('GET', '/v1/payments/%s' % mp_id)
        if status == 404:
            return None
        if status != 200 or not isinstance(r, dict):
            raise MercadoPagoFalhou('HTTP %d' % status)
        return r

    def busca(self, referencia):
        consulta = urllib.parse.urlencode({'external_reference': referencia, 'sort': 'date_created',
                                           'criteria': 'desc', 'limit': 20})
        status, r = self._pede('GET', '/v1/payments/search?' + consulta)
        if status != 200 or not isinstance(r, dict):
            raise MercadoPagoFalhou('HTTP %d' % status)
        res = r.get('results')
        return [p for p in res if isinstance(p, dict)] if isinstance(res, list) else []


_DESLIGADO = MercadoPago()


# ---- o mixin --------------------------------------------------------------------------
class PagamentoMixin:

    def _mp(self):
        mp = getattr(self, 'mp', None)
        return mp if mp is not None else _DESLIGADO

    # -- os alertas (o painel do Mestre lê: mestre.py) -----------------------------------------
    def _alerta(self, cid, tipo, dados, t):
        """Dentro de uma transação de escrita: um alerta para o dono olhar."""
        cur = self.con.execute("INSERT INTO contas_alertas(conta_id, tipo, dados, criado_em) VALUES (?, ?, ?, ?)",
                               (cid, tipo, json.dumps(dados, ensure_ascii=False), t))
        log.warning("alerta %d (%s) na conta #%s: o painel do Mestre mostra", cur.lastrowid, tipo, cid)
        return cur.lastrowid

    CONSULTA_ALERTAS = ("SELECT a.*, c.nome AS conta_nome, v.nome AS visto_nome FROM contas_alertas a "
                        "LEFT JOIN contas c ON c.id = a.conta_id LEFT JOIN contas v ON v.id = a.visto_por")

    @staticmethod
    def _alerta_publico(r):
        return {'id': r['id'],
                'conta': {'id': r['conta_id'], 'nome': r['conta_nome']} if r['conta_id'] is not None else None,
                'tipo': r['tipo'], 'dados': le_json(r['dados']) or {}, 'criadoEm': r['criado_em'],
                'vistoEm': r['visto_em'],
                'vistoPor': {'id': r['visto_por'], 'nome': r['visto_nome']} if r['visto_por'] is not None else None}

    def _alertas_lista(self, limite=ALERTAS_LISTA):
        """Dentro da tranca: os abertos primeiro (os mais novos antes), depois os vistos."""
        linhas = self.con.execute(self.CONSULTA_ALERTAS + " ORDER BY (a.visto_em IS NULL) DESC, a.id DESC LIMIT ?",
                                  (limite,)).fetchall()
        return [self._alerta_publico(r) for r in linhas]

    def _alertas_da_conta(self, cid):
        """Dentro da tranca: os abertos da conta e os 10 últimos vistos."""
        abertos = self.con.execute(self.CONSULTA_ALERTAS + " WHERE a.conta_id = ? AND a.visto_em IS NULL "
                                   "ORDER BY a.id DESC LIMIT ?", (cid, ALERTAS_LISTA)).fetchall()
        vistos = self.con.execute(self.CONSULTA_ALERTAS + " WHERE a.conta_id = ? AND a.visto_em IS NOT NULL "
                                  "ORDER BY a.id DESC LIMIT ?", (cid, ALERTAS_VISTOS_DA_CONTA)).fetchall()
        return [self._alerta_publico(r) for r in list(abertos) + list(vistos)]

    # -- o <pag> público ---------------------------------------------------------------------------
    def _pag_publico(self, pg):
        """Dentro da tranca: o <pag> de uma linha de `pagamentos`."""
        mps = self.con.execute(
            "SELECT m.*, p.estado AS pedido_estado FROM pagamentos_mp m LEFT JOIN loja_pedidos p ON p.id = m.pedido_id "
            "WHERE m.pagamento_id = ? ORDER BY m.atualizado_em, m.mp_id", (pg['id'],)).fetchall()
        return pag_publico(pg, mps)

    def _pagamentos_da_conta(self, cid, limite=PAGAMENTOS_LISTA):
        linhas = self.con.execute("SELECT * FROM pagamentos WHERE conta_id = ? ORDER BY id DESC LIMIT ?",
                                  (cid, limite)).fetchall()
        return [self._pag_publico(r) for r in linhas]

    # -- POST /api/pagamento/pacote ----------------------------------------------------------------
    def _corpo_preferencia(self, pacote, pid, referencia, t):
        """A preferência do Checkout Pro. SEM `payer` (nenhum dado pessoal vai ao
        Mercado Pago) e SEM `notification_url` (o aviso é o do painel dele, onde
        nasce a assinatura secreta). Boleto e lotérica fora: só Pix e cartão."""
        volta = '%s/site/loja.html?pagamento=%d&volta=' % (self._mp().endereco, pid)
        return {'items': [{'id': pacote['id'], 'title': 'SOTERRA: ' + pacote['nome'], 'quantity': 1,
                           'currency_id': 'BRL', 'unit_price': round(pacote['centavos'] / 100, 2)}],
                'external_reference': referencia,
                'back_urls': {'success': volta + 'aprovado', 'pending': volta + 'pendente', 'failure': volta + 'falhou'},
                'auto_return': 'approved',
                'statement_descriptor': 'SOTERRA',
                'payment_methods': {'excluded_payment_types': [{'id': 'ticket'}, {'id': 'atm'}], 'installments': 1},
                'expires': True, 'expiration_date_from': _iso(t), 'expiration_date_to': _iso(t + PREFERENCIA_VALIDADE),
                'metadata': {'pagamento': pid}}

    def pagamento_pacote(self, conta, corpo):
        mp = self._mp()
        if not mp.ligado:
            raise Recusa(503, FRASE_EM_BREVE, pagamento=False)
        pacote_id, idem = corpo.get('pacote'), corpo.get('idem')
        # só os pacotes à venda (13/09: os de barras); o de vinténs, fora da venda, é "desconhecido" para pedir
        pacote = POR_PACOTE.get(pacote_id) if isinstance(pacote_id, str) and pacote_id in PACOTES_A_VENDA else None
        if pacote is None:
            raise Recusa(400, 'pacote desconhecido')
        if not isinstance(idem, str) or not RE_IDEM.match(idem):
            raise Recusa(400, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        cid, t = conta['id'], agora()
        with self._escrita():
            ja = self.con.execute("SELECT * FROM pagamentos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone()
            if ja is not None:                          # o mesmo clique chegando de novo
                if ja['pacote'] != pacote_id:
                    raise Recusa(409, 'idem já usado em outro pacote')
                if ja['estado'] == 'falhou':
                    raise Recusa(409, 'esse pedido falhou; tente de novo')
                if ja['estado'] == 'aberto':
                    return 200, {'ok': True, 'pagamento': self._pag_publico(ja), 'endereco': ja['endereco'],
                                 'repetido': True}
                # 'criado': outro pedido com esta chave está falando com o Mercado Pago agora (ou caiu no meio)
                if ja['atualizado_em'] > t - CRIADO_PRESO:
                    raise Recusa(409, 'esse pedido ainda está sendo criado; tente de novo em instantes')
                self.con.execute("UPDATE pagamentos SET atualizado_em = ? WHERE id = ?", (t, ja['id']))
                pid, referencia = ja['id'], ja['referencia']
            else:
                chave = 'pagamento:%d' % cid
                libera = self._conta_limite(chave, PACOTES_POR_HORA, 3600, t)
                if libera is not None:
                    raise Recusa(429, 'pedidos de pacote demais nesta hora (%d)' % PACOTES_POR_HORA, liberaEm=libera)
                # o que a conta pode pagar em 24 h: o dinheiro já CREDITADO (cada pagamento do Mercado Pago, que
                # numa mesma preferência podem ser vários) mais as intenções que ainda não creditaram nada (as
                # que falharam não contam). Sem a primeira parte, quem pagou o mesmo link N vezes abria outra
                # intenção, pagava, e o dinheiro entrava sem poder creditar (o teto do crédito o segura)
                dia = self.con.execute(
                    "SELECT g.centavos, g.criado_em AS em FROM pagamentos g WHERE g.conta_id = ? AND g.criado_em > ? "
                    "AND g.estado != 'falhou' AND NOT EXISTS (SELECT 1 FROM pagamentos_mp m WHERE m.pagamento_id = g.id "
                    "AND m.creditado_em IS NOT NULL AND m.estornado_em IS NULL) "
                    "UNION ALL SELECT g.centavos, m.creditado_em AS em FROM pagamentos_mp m "
                    "JOIN pagamentos g ON g.id = m.pagamento_id WHERE g.conta_id = ? AND m.creditado_em > ? "
                    "AND m.estornado_em IS NULL ORDER BY em", (cid, t - 86400, cid, t - 86400)).fetchall()
                soma = sum(r['centavos'] for r in dia)
                if soma + pacote['centavos'] > TETO_CENTAVOS_DIA:
                    libera, resto = None, soma
                    for r in dia:
                        resto -= r['centavos']
                        if resto + pacote['centavos'] <= TETO_CENTAVOS_DIA:
                            libera = r['em'] + 86400
                            break
                    raise Recusa(429, 'o teto de pacotes é %s por dia' % reais(TETO_CENTAVOS_DIA), liberaEm=libera)
                cur = self.con.execute(
                    "INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, estado, idem, criado_em, atualizado_em) "
                    "VALUES (?, ?, ?, ?, 'criado', ?, ?, ?)",       # `vintens` = a quantidade na moeda do pacote
                    (cid, pacote_id, pacote['barras'], pacote['centavos'], idem, t, t))
                pid = cur.lastrowid
                referencia = 'sot-%d-%s' % (pid, secrets.token_hex(8))
                self.con.execute("UPDATE pagamentos SET referencia = ? WHERE id = ?", (referencia, pid))
                self._anota_limite(chave, t)
                self._evento(cid, 'pagamento-criado', {'id': pid, 'pacote': pacote_id, 'centavos': pacote['centavos']})
        # fora da tranca: a conversa com o Mercado Pago leva até 10 s
        try:
            pref = mp.cria_preferencia(self._corpo_preferencia(pacote, pid, referencia, t), referencia)
            endereco = pref.get('sandbox_init_point' if mp.teste else 'init_point')
            if not endereco_do_mp(endereco) or not isinstance(pref.get('id'), (str, int)):
                raise MercadoPagoFalhou('a resposta não trouxe um endereço de pagamento do Mercado Pago')
        except MercadoPagoFalhou as e:
            log.warning("pagamento %d: a preferência não nasceu (%s)", pid, e)
            with self._escrita():
                self.con.execute("UPDATE pagamentos SET estado = 'falhou', atualizado_em = ? "
                                 "WHERE id = ? AND estado = 'criado'", (agora(), pid))
            raise Recusa(502, FRASE_MP_FORA)
        with self._escrita():
            self.con.execute("UPDATE pagamentos SET preferencia = ?, endereco = ?, estado = 'aberto', atualizado_em = ? "
                             "WHERE id = ?", (str(pref['id'])[:120], endereco, agora(), pid))
            pub = self._pag_publico(self.con.execute("SELECT * FROM pagamentos WHERE id = ?", (pid,)).fetchone())
        log.info("pagamento: #%d pediu %s (pagamento %d)", cid, pacote_id, pid)
        return 201, {'ok': True, 'pagamento': pub, 'endereco': endereco}

    # -- POST /api/pagamento/aviso (o Mercado Pago chama; sem conta) ----------------------------------
    def pagamento_aviso(self, conta, corpo):
        mp = self._mp()
        if not mp.ligado:
            raise Recusa(503, FRASE_DESLIGADO)
        consulta = corpo.get('_query') or {}
        cab = corpo.get('_cabecalhos') or {}
        data_id = consulta.get('data.id')
        if not isinstance(data_id, str) or not data_id:
            raise Recusa(400, 'aviso sem data.id')
        # a assinatura ANTES de tudo: nada de consulta ao Mercado Pago por aviso forjado
        if not mp.confere(cab.get('x-signature'), cab.get('x-request-id'), data_id):
            self._avisos_recusados = getattr(self, '_avisos_recusados', 0) + 1
            log.warning("pagamento: aviso com assinatura inválida recusado (%d desde o boot)", self._avisos_recusados)
            raise Recusa(401, 'assinatura inválida')
        tipo = consulta.get('type') or consulta.get('topic')
        if tipo != 'payment':
            log.info("pagamento: aviso do tipo %.40r ignorado", tipo)
            return 200, {'ok': True, 'ignorado': 'tipo'}
        if not RE_MP_ID.match(data_id):
            raise Recusa(400, 'data.id precisa ser o número do pagamento')
        log.info("pagamento: aviso do Mercado Pago (mp %s)", data_id)
        try:
            p = mp.consulta(data_id)
        except MercadoPagoFalhou as e:
            log.warning("pagamento: a consulta do mp %s falhou (%s); o Mercado Pago avisa de novo", data_id, e)
            raise Recusa(503, FRASE_MP_FORA_AVISO)
        if p is None:
            log.warning("pagamento: o Mercado Pago não conhece o pagamento mp %s (simulação do painel?)", data_id)
            return 200, {'ok': True, 'ignorado': 'pagamento desconhecido'}
        r = self._pagamento_processa(p)
        if r.get('ignorado') == 'modo trocado':
            # configuração errada (SOTERRA_MP_TESTE): 503, e o Mercado Pago avisa de novo depois da correção.
            # Com 200 o aviso sumia, e o pagamento ficava sem crédito para sempre
            raise Recusa(503, FRASE_MODO_TROCADO)
        return 200, dict({'ok': True}, **r)

    # -- o único lugar que credita (o aviso E a conferência passam por aqui) ----------------------------
    def _pagamento_processa(self, p):
        """`p` é o pagamento como a API do Mercado Pago o devolveu (nunca o corpo
        de um aviso). Devolve {'estado': <estado público>} ou {'ignorado': motivo}."""
        mp = self._mp()
        mp_id = p.get('id')
        mp_id = str(mp_id) if isinstance(mp_id, int) and not isinstance(mp_id, bool) else mp_id
        if not isinstance(mp_id, str) or not RE_MP_ID.match(mp_id):
            log.warning("pagamento: resposta do Mercado Pago sem id de pagamento; ignorada")
            return {'ignorado': 'pagamento sem id'}
        ref = p.get('external_reference')
        if not isinstance(ref, str) or not RE_REFERENCIA.match(ref):
            log.info("pagamento: o mp %s não é de um pacote daqui (referência de outro sistema); ignorado", mp_id)
            return {'ignorado': 'referência desconhecida'}
        with self.tranca:
            pg = self.con.execute("SELECT id FROM pagamentos WHERE referencia = ?", (ref,)).fetchone()
        if pg is None:
            log.info("pagamento: o mp %s traz uma referência que este banco não tem; ignorado", mp_id)
            return {'ignorado': 'referência desconhecida'}
        live = p.get('live_mode')
        # 26/10 — O MODELO NOVO DE TESTE DO MERCADO PAGO. As credenciais de teste agora são as de um VENDEDOR DE
        # TESTE (o token começa com APP_USR-, como o de produção), o comprador é uma conta de teste, e o teste corre
        # no ambiente de produção: o pagamento aprovado pode chegar com live_mode=true. A regra de antes (modo teste
        # só credita live_mode=false) recusava TODO pagamento de teste — o dono pagou e as barras não entraram.
        # Agora: em PRODUÇÃO só credita live_mode=true (pagamento de teste nunca vira barra de graça); em modo
        # TESTE credita qualquer um — o dinheiro de verdade não chega a um vendedor de teste, e um pagamento real
        # que chegasse aqui é de alguém que pagou de verdade e recebe o que pagou.
        if not mp.teste and live is not True:
            log.warning("pagamento %d (mp %s): live_mode=%s, e o servidor está em modo produção: não credita "
                        "(confira SOTERRA_MP_TESTE)", pg['id'], mp_id, live)
            return {'ignorado': 'modo trocado'}
        if mp.teste and live is True:
            log.info("pagamento %d (mp %s): live_mode=True com o servidor em modo teste (o teste novo do Mercado Pago "
                     "corre em produção): credita", pg['id'], mp_id)
        status = _texto(p.get('status'), 40) or 'desconhecido'
        detalhe = _texto(p.get('status_detail'), 80)
        valor = _centavos(p.get('transaction_amount'))
        moeda = p.get('currency_id')
        t = agora()
        with self._escrita():
            pg = self.con.execute("SELECT * FROM pagamentos WHERE referencia = ?", (ref,)).fetchone()
            antes = self.con.execute("SELECT * FROM pagamentos_mp WHERE mp_id = ?", (mp_id,)).fetchone()
            if antes is not None and antes['pagamento_id'] != pg['id']:
                log.warning("pagamento: o mp %s já está ligado a outra intenção; ignorado", mp_id)
                return {'ignorado': 'pagamento de outra intenção'}
            if (antes is not None and ETAPA.get(status, 0) < ETAPA.get(antes['status'], 0)
                    and not (antes['status'] in EM_DISPUTA and status == 'approved')):
                log.info("pagamento %d (mp %s): leitura velha (%s depois de %s); ignorada",
                         pg['id'], mp_id, status, antes['status'])
                return {'estado': self._pag_publico(pg)['estado']}
            if antes is None:
                self.con.execute("INSERT INTO pagamentos_mp(mp_id, pagamento_id, status, detalhe, valor_centavos, "
                                 "atualizado_em) VALUES (?, ?, ?, ?, ?, ?)", (mp_id, pg['id'], status, detalhe, valor, t))
            else:
                self.con.execute("UPDATE pagamentos_mp SET status = ?, detalhe = ?, valor_centavos = ?, atualizado_em = ? "
                                 "WHERE mp_id = ?", (status, detalhe, valor, t, mp_id))
            linha = self.con.execute("SELECT * FROM pagamentos_mp WHERE mp_id = ?", (mp_id,)).fetchone()
            mudou = antes is None or antes['status'] != status
            if mudou:
                log.info("pagamento %d (mp %s): %s → %s", pg['id'], mp_id, antes['status'] if antes else '-', status)
            if status == 'approved':
                if valor != pg['centavos'] or moeda != 'BRL':
                    if mudou:
                        self._alerta(pg['conta_id'], 'valor-diferente',
                                     {'pagamento': pg['id'], 'mp': mp_id, 'esperado': pg['centavos'],
                                      'recebido': valor, 'moeda': _texto(moeda, 8)}, t)
                elif linha['creditado_em'] is None and linha['estornado_em'] is None:
                    self._pagamento_credita(pg, mp_id, t, mudou)
            elif status in EM_DISPUTA:
                # reclamação aberta: o crédito fica como está (a disputa pode acabar a favor do vendedor e o
                # pagamento voltar a 'approved'); o Mestre fica sabendo, e o 'refunded'/'charged_back' que
                # vier depois passa pelo estorno de sempre
                if mudou and linha['creditado_em'] is not None and linha['estornado_em'] is None:
                    ped = (self.con.execute("SELECT estado FROM loja_pedidos WHERE id = ?", (linha['pedido_id'],)).fetchone()
                           if linha['pedido_id'] is not None else None)
                    self._alerta(pg['conta_id'], 'contestacao',
                                 {'pagamento': pg['id'], 'mp': mp_id, **qtd_dados(pg), 'pedido': linha['pedido_id'],
                                  'estadoPedido': ped['estado'] if ped is not None else None, 'status': status,
                                  'aberta': True}, t)
            elif status in ESTORNOS:
                if linha['creditado_em'] is not None and linha['estornado_em'] is None:
                    self._pagamento_estorna(pg, linha, status, t)
            pub = self._pag_publico(pg)
        return {'estado': pub['estado']}

    def _pagamento_credita(self, pg, mp_id, t, mudou=True):
        """Dentro da _escrita do processa: o crédito da loja, UMA vez por mp_id.
        O teto de 24 h vale aqui também (o dinheiro aprovado de fato): a mesma
        preferência aceita mais de um pagamento, então contar só as intenções
        não segura quem paga o mesmo link N vezes. O que passa do teto NÃO
        credita (creditado_em fica nulo) e vira alerta 'teto-diario' — uma vez,
        na mudança de estado; passadas as 24 h, a próxima consulta (o aviso
        repetido, a volta, o botão do Mestre) credita."""
        cid = pg['conta_id']
        if cid is None:
            log.warning("pagamento %d (mp %s): aprovado, mas a conta não existe mais; nada creditado", pg['id'], mp_id)
            return
        pago = self.con.execute(
            "SELECT COALESCE(SUM(g.centavos), 0) FROM pagamentos_mp m JOIN pagamentos g ON g.id = m.pagamento_id "
            "WHERE g.conta_id = ? AND m.creditado_em > ? AND m.estornado_em IS NULL", (cid, t - 86400)).fetchone()[0]
        if pago + pg['centavos'] > TETO_CENTAVOS_DIA:
            if mudou:
                self._alerta(cid, 'teto-diario', {'pagamento': pg['id'], 'mp': mp_id, **qtd_dados(pg),
                                                  'centavos': pg['centavos'], 'pagoEm24h': pago}, t)
            log.warning("pagamento %d (mp %s): passa do teto de %s em 24 h (já creditado: %s); não credita agora",
                        pg['id'], mp_id, reais(TETO_CENTAVOS_DIA), reais(pago))
            return
        idem = 'mp:%s' % mp_id
        banida = self.con.execute("SELECT banido FROM contas WHERE id = ?", (cid,)).fetchone()
        if moeda_do_pagamento(pg) == 'barras':
            # 13/09: as barras entram NA HORA no saldo; o idem 'mp:<id>' no extrato é a terceira camada
            self.barras_move(cid, pg['vintens'], 'pacote', 'pagamento:%d' % pg['id'], idem, t)
            self.con.execute("UPDATE pagamentos_mp SET creditado_em = ? WHERE mp_id = ?", (t, mp_id))
            self._evento(cid, 'pagamento-credito', {'pagamento': pg['id'], 'mp': mp_id, 'barras': pg['vintens'],
                                                    'pedido': None})
            if banida is not None and banida['banido']:
                self._alerta(cid, 'conta-banida', {'pagamento': pg['id'], 'mp': mp_id, 'barras': pg['vintens'],
                                                   'pedido': None}, t)
            log.info("pagamento %d (mp %s): %d barras de ouro creditadas à conta #%d", pg['id'], mp_id,
                     pg['vintens'], cid)
            return
        ja = self.con.execute("SELECT id FROM loja_pedidos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone()
        pid = ja['id'] if ja is not None else self.credita(cid, pg['pacote'], pg['vintens'], 'pagamento', idem, mp_id, t)
        self.con.execute("UPDATE pagamentos_mp SET pedido_id = ?, creditado_em = ? WHERE mp_id = ?", (pid, t, mp_id))
        self._evento(cid, 'pagamento-credito', {'pagamento': pg['id'], 'mp': mp_id, 'vintens': pg['vintens'],
                                                'pedido': pid})
        if banida is not None and banida['banido']:
            # o dinheiro entrou: credita do mesmo jeito (o pedido espera) e o dono decide
            self._alerta(cid, 'conta-banida', {'pagamento': pg['id'], 'mp': mp_id, 'vintens': pg['vintens'],
                                               'pedido': pid}, t)
        log.info("pagamento %d (mp %s): %d vinténs creditados à conta #%d (pedido %d)", pg['id'], mp_id,
                 pg['vintens'], cid, pid)

    def _pagamento_estorna(self, pg, linha, status, t):
        """Dentro da _escrita do processa: estorno ou contestação de um pagamento
        que já creditou. O crédito que o jogo ainda não CONFIRMOU (pendente, ou
        retirado sem o save que fecha) é cancelado: sai do "a caminho" e não
        volta na próxima retirada — se o jogo já o tinha aplicado, o PUT
        seguinte o fecha 'entregue' e _pagamento_entregue_tardio alerta. O que
        já chegou vira alerta. Nunca tira vinténs do save.
        13/09: o pacote de BARRAS tira as barras que ainda houver no saldo; o que já
        foi gasto vai no alerta (`faltou`)."""
        cid, mp_id = pg['conta_id'], linha['mp_id']
        if moeda_do_pagamento(pg) == 'barras':
            qtd = pg['vintens']
            tirado = 0
            if cid is not None:
                tirado = -(self.barras_move(cid, -qtd, 'estorno-pagamento', 'pagamento:%d' % pg['id'],
                                            'mp:%s:estorno' % mp_id, t, parcial=True) or 0)
            dados = {'pagamento': pg['id'], 'mp': mp_id, 'barras': qtd, 'tirado': tirado, 'faltou': qtd - tirado,
                     'status': status}
            tipo = 'contestacao' if status in CONTESTACOES else 'estorno'
            self.con.execute("UPDATE pagamentos_mp SET estornado_em = ? WHERE mp_id = ?", (t, mp_id))
            self._alerta(cid, tipo, dados, t)
            self._evento(cid, 'pagamento-estorno', dados)
            log.warning("pagamento %d (mp %s): %s — %d barras tiradas, %d já gastas — alerta '%s' para o Mestre",
                        pg['id'], mp_id, status, tirado, qtd - tirado, tipo)
            return
        ped = self.con.execute("SELECT id, estado FROM loja_pedidos WHERE id = ?", (linha['pedido_id'],)).fetchone() \
            if linha['pedido_id'] is not None else None
        estado = ped['estado'] if ped is not None else None
        dados = {'pagamento': pg['id'], 'mp': mp_id, 'vintens': pg['vintens'],
                 'pedido': linha['pedido_id'], 'estadoPedido': estado, 'status': status}
        if estado in ('pendente', 'retirado'):
            self.con.execute("UPDATE loja_pedidos SET estado = 'cancelado', motivo = 'estorno', fechado_em = ? "
                             "WHERE id = ? AND estado IN ('pendente', 'retirado')", (t, ped['id']))
            tipo = 'estorno-antes-da-entrega'
            dados['cancelado'] = True
        elif estado == 'entregue':
            tipo = 'contestacao' if status in CONTESTACOES else 'estorno'
        else:                                           # cancelado, estornado ou sumiu: nunca chegou ao jogo
            tipo = 'estorno-antes-da-entrega'
        self.con.execute("UPDATE pagamentos_mp SET estornado_em = ? WHERE mp_id = ?", (t, mp_id))
        self._alerta(cid, tipo, dados, t)
        self._evento(cid, 'pagamento-estorno', dados)
        log.warning("pagamento %d (mp %s): %s com o crédito %s (%s) — alerta '%s' para o Mestre",
                    pg['id'], mp_id, status, linha['pedido_id'], estado, tipo)

    # -- ganchos do _loja_confirma (loja.py), dentro da transação do save ------------------------------
    def _pagamento_credito_recusado(self, cid, pid, motivo, versao, t):
        """O jogo recusou o pedido `pid` (já 'estornado'). Se for o crédito vigente
        de um pacote pago, ele volta como um crédito novo (mesma quantia), até
        REEMISSOES_MAX vezes; depois vira alerta. Devolve o id novo ou None."""
        cr = self.con.execute(
            "SELECT c.vintens, c.mp_id, p.sku FROM loja_creditos c JOIN loja_pedidos p ON p.id = c.pedido_id "
            "WHERE c.pedido_id = ? AND c.origem = 'pagamento' "
            "AND c.pedido_id NOT IN (SELECT pedido_id FROM loja_presentes)", (pid,)).fetchone()
        if cr is None or cr['mp_id'] is None:
            return None
        linha = self.con.execute("SELECT * FROM pagamentos_mp WHERE mp_id = ?", (cr['mp_id'],)).fetchone()
        if linha is None or linha['pedido_id'] != pid or linha['estornado_em'] is not None:
            return None
        dados = {'mp': cr['mp_id'], 'vintens': cr['vintens'], 'pedido': pid, 'motivo': motivo, 'versao': versao,
                 'reemissoes': linha['reemissoes']}
        if linha['reemissoes'] >= REEMISSOES_MAX:
            self._alerta(cid, 'credito-recusado', dados, t)
            return None
        vez = linha['reemissoes'] + 1
        novo = self.credita(cid, cr['sku'], cr['vintens'], 'pagamento', 'mp:%s:r%d' % (cr['mp_id'], vez), cr['mp_id'], t)
        self.con.execute("UPDATE pagamentos_mp SET pedido_id = ?, reemissoes = ?, atualizado_em = ? WHERE mp_id = ?",
                         (novo, vez, t, cr['mp_id']))
        self._evento(cid, 'pagamento-reemite', {'mp': cr['mp_id'], 'de': pid, 'para': novo, 'vez': vez})
        log.info("pagamento (mp %s): o jogo recusou o crédito %d (%s); reemitido como %d (%dª vez)",
                 cr['mp_id'], pid, motivo, novo, vez)
        return novo

    def _pagamento_entregue_tardio(self, cid, pid, versao, t):
        """O jogo aplicou um pedido que já estava cancelado. Se era o crédito de um
        pacote estornado, os vinténs entraram depois do estorno: alerta."""
        linha = self.con.execute(
            "SELECT m.* FROM pagamentos_mp m JOIN loja_creditos c ON c.pedido_id = m.pedido_id "
            "WHERE m.pedido_id = ? AND c.origem = 'pagamento'", (pid,)).fetchone()
        if linha is None or linha['estornado_em'] is None:
            return
        pg = self.con.execute("SELECT id, vintens FROM pagamentos WHERE id = ?", (linha['pagamento_id'],)).fetchone()
        self._alerta(cid, 'contestacao' if linha['status'] in CONTESTACOES else 'estorno',
                     {'pagamento': linha['pagamento_id'], 'mp': linha['mp_id'],
                      'vintens': pg['vintens'] if pg is not None else None, 'pedido': pid,
                      'estadoPedido': 'entregue', 'tardio': True, 'versao': versao, 'status': linha['status']}, t)

    # -- a consulta pela referência (a volta, o botão "conferir" e o do Mestre) --------------------------
    def _pagamento_reconcilia(self, pg):
        """FORA da tranca: busca a intenção no Mercado Pago pela external_reference
        e processa cada pagamento achado pelo mesmo `processa` do aviso (nunca
        credita sozinha). Cobre o aviso perdido, o que chegou com o servidor mal
        configurado e o crédito que esperava o teto de 24 h. Devolve (quantos
        pagamentos achou, [motivos do que foi ignorado])."""
        if not pg['referencia'] or pg['estado'] == 'falhou':
            return 0, []
        try:
            achados = self._mp().busca(pg['referencia'])
        except MercadoPagoFalhou as e:
            log.warning("pagamento %d: a busca no Mercado Pago falhou (%s)", pg['id'], e)
            raise Recusa(503, FRASE_MP_FORA_AVISO)
        n, ignorados = 0, []
        for p in achados:
            if p.get('external_reference') == pg['referencia']:
                n += 1
                r = self._pagamento_processa(p)
                if r.get('ignorado'):
                    ignorados.append(r['ignorado'])
        return n, ignorados

    # -- a conferência automática (26/10) --------------------------------------------------------------
    def pagamento_confere_abertos(self, velhos=False):
        """O dono, 26/10: "esperando pagamento e tive que clicar em aprovado pro
        saldo entrar". O aviso do Mercado Pago pode não chegar (a assinatura do
        modo produtivo diferente da de teste, o endereço do aviso sem cadastro no
        modo produtivo, o servidor fora no minuto do aviso), e o crédito ficava
        esperando o jogador apertar "conferir". Agora o servidor confere sozinho:
        as intenções abertas e ainda sem crédito das últimas CONFERE_NOVOS (ou
        CONFERE_VELHOS, com `velhos`) passam pela mesma `_pagamento_reconcilia`
        do botão — a busca pela external_reference e o mesmo `processa`, que
        credita UMA vez por pagamento. Idempotente: vale nos dois contêineres do
        rolling update e junto com o aviso. A intenção cujos pagamentos foram
        TODOS ignorados (o modo trocado) não volta nas próximas voltas deste
        processo: a configuração só muda com outro deploy, e o log não enche.
        Devolve {vistos, creditados, falhou}; o Mercado Pago fora para a volta."""
        if not self._mp().ligado:
            return {'vistos': 0, 'creditados': 0, 'falhou': False}
        pulados = self.__dict__.setdefault('_confere_pulados', set())
        t = agora()
        with self.tranca:
            pgs = self.con.execute(
                "SELECT * FROM pagamentos p WHERE estado = 'aberto' AND criado_em >= ? AND NOT EXISTS "
                "(SELECT 1 FROM pagamentos_mp m WHERE m.pagamento_id = p.id AND m.creditado_em IS NOT NULL) "
                "ORDER BY id DESC LIMIT ?", (t - (CONFERE_VELHOS if velhos else CONFERE_NOVOS), CONFERE_LOTE)).fetchall()
        vistos = creditados = 0
        for pg in pgs:
            if pg['id'] in pulados:
                continue
            try:
                n, ignorados = self._pagamento_reconcilia(pg)
            except Recusa:                              # o Mercado Pago fora (já logado): a próxima volta tenta
                return {'vistos': vistos, 'creditados': creditados, 'falhou': True}
            vistos += 1
            if n and len(ignorados) == n:
                pulados.add(pg['id'])
            with self.tranca:
                if self.con.execute("SELECT 1 FROM pagamentos_mp WHERE pagamento_id = ? AND creditado_em IS NOT NULL",
                                    (pg['id'],)).fetchone():
                    creditados += 1
        return {'vistos': vistos, 'creditados': creditados, 'falhou': False}

    # -- POST /api/pagamento/conferir (a volta do navegador e o botão "conferir") ----------------------
    def pagamento_conferir(self, conta, corpo):
        mp = self._mp()
        if not mp.ligado:
            raise Recusa(503, FRASE_EM_BREVE, pagamento=False)
        pid = corpo.get('id')
        if not id_valido(pid):
            raise Recusa(400, 'id precisa ser o número do pagamento')
        cid, t = conta['id'], agora()
        chave = 'pag-conferir:%d' % cid
        with self._escrita():                           # o freio numa transação própria: o 404 não a desfaz
            libera = self._conta_limite(chave, CONFERIR_POR_HORA, 3600, t)
            if libera is not None:
                raise Recusa(429, 'conferências demais nesta hora (%d)' % CONFERIR_POR_HORA, liberaEm=libera)
            self._anota_limite(chave, t)
        with self.tranca:
            pg = self.con.execute("SELECT * FROM pagamentos WHERE id = ? AND conta_id = ?", (pid, cid)).fetchone()
        if pg is None:                                  # inclusive o de outra conta
            raise Recusa(404, 'pagamento não encontrado')
        self._pagamento_reconcilia(pg)
        with self.tranca:
            pub = self._pag_publico(self.con.execute("SELECT * FROM pagamentos WHERE id = ?", (pid,)).fetchone())
        return 200, {'ok': True, 'pagamento': pub}

    # -- GET /api/pagamento/meus ----------------------------------------------------------------------
    def pagamento_meus(self, conta, corpo):
        with self.tranca:
            pags = self._pagamentos_da_conta(conta['id'])
        return 200, {'ok': True, 'ligado': self._mp().ligado, 'pagamentos': pags}


def liga_conferencia(api, intervalo=CONFERE_A_CADA, primeira=30, para=None):
    """A conferência automática (26/10) numa thread do próprio servidor, no molde da varredura de reembolsos
    da Google Play (pagamento_play.liga_varredura): de `intervalo` em `intervalo` s as intenções das últimas
    3 h; a primeira volta e uma a cada CONFERE_VELHOS_A_CADA, as das últimas 24 h. Erro só vai para o log: a
    próxima volta tenta de novo, e o jogador e o Mestre seguem com o botão "conferir". `para` (um
    threading.Event) desliga a thread: só as provas usam."""
    if not api._mp().ligado:
        return None
    para = para or threading.Event()
    log.info("pagamento: a conferência automática dos pagamentos abertos roda de %g em %g s", intervalo, intervalo)

    def volta():
        if para.wait(primeira):
            return
        n = 0
        while True:
            try:
                r = api.pagamento_confere_abertos(velhos=n % CONFERE_VELHOS_A_CADA == 0)
                if r['creditados']:
                    log.info("pagamento: a conferência automática creditou %d pagamento(s) sem esperar o aviso",
                             r['creditados'])
            except Exception:
                log.exception("pagamento: a conferência automática quebrou")
            n += 1
            if para.wait(intervalo):
                return

    th = threading.Thread(target=volta, name='mp-conferencia', daemon=True)
    th.start()
    return th
