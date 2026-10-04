#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""As barras de ouro compradas pela GOOGLE PLAY, dentro do aplicativo de Android
(04/10). Na web nada muda: lá o pacote continua pelo Mercado Pago (pagamento.py).

Entra no cartório como mixin (`class Api(..., PagamentoPlayMixin)` no api.py).

POR QUE EXISTE: a Play não aceita que um aplicativo venda item digital por outro
meio que não a cobrança dela. Então, no aplicativo, os MESMOS pacotes (loja.py,
PACOTES) são produtos da Play, e quem cobra é a Google.

O CAMINHO DE UMA COMPRA:
  1. o aplicativo mostra os pacotes (GET /api/pagamento/play: quais produtos; o
     PREÇO vem da Google, na moeda do jogador) e abre a compra da Play;
  2. a Google devolve ao aplicativo um `purchaseToken`; o aplicativo o manda
     (POST /api/pagamento/play {pacote, token});
  3. o servidor PERGUNTA À GOOGLE (Play Developer API, purchases.products.get,
     com a conta de serviço) se aquele token é uma compra paga deste aplicativo e
     deste produto. Só então credita as barras — UMA vez;
  4. o servidor responde `consumir: true` e só aí o aplicativo CONSOME a compra na
     Google (o que libera comprar o mesmo pacote de novo). Se o aplicativo fechar
     no meio, a compra fica "não consumida" no aparelho e ele a manda de novo ao
     abrir: o servidor reconhece o token e não credita duas vezes.

AS REGRAS QUE SEGURAM O DINHEIRO (as mesmas do Mercado Pago):
  - Nunca credita pelo que o aplicativo diz: sempre pelo que a Google responde à
    NOSSA conta de serviço. O endereço consultado leva o nome do aplicativo e o
    produto: token de outro aplicativo ou de outro produto a Google não acha.
  - UM crédito por compra, em três camadas: `pagamentos_play.token` é único; o
    `creditado_em IS NULL` é lido dentro do BEGIN IMMEDIATE (vale entre os dois
    contêineres do rolling update); e o idem 'play:<id>' no extrato das barras.
    O número do pedido da Google (orderId) também é único.
  - Compra PENDENTE (a Google ainda espera o dinheiro) não credita; cancelada ou
    reembolsada não credita; a que já foi estornada nunca mais credita.
  - O teto de R$ 400,00 por conta em 24 h vale aqui também, somando o que entrou
    pelo Mercado Pago. O que passa do teto NÃO credita e NÃO é consumido: o
    aplicativo tenta de novo depois; a compra que ninguém confirma em 3 dias a
    Google devolve sozinha ao comprador.
  - Conta banida não recebe (403; a compra fica sem confirmar e a Google devolve).
    Conta excluída não tem sessão: não chega aqui.
  - A compra feita por uma conta do jogo só credita NAQUELA conta: o aplicativo
    passa à Google um código da conta (`conta`, um hmac — nada pessoal) e a
    Google o devolve na consulta.
  - Compra de TESTE (a dos testadores de licença, que não paga nada) só credita
    com SOTERRA_PLAY_TESTE=1.
  - REEMBOLSO: a Google não avisa este servidor na hora (o aviso em tempo real
    dela exige Pub/Sub; ver docs/GOOGLE_PLAY.md §9). O servidor PERGUNTA de
    tempos em tempos (purchases.voidedpurchases: tudo o que foi reembolsado,
    cancelado ou contestado nos últimos 30 dias) e tira as barras que ainda
    houver; o que já foi gasto vira alerta para o Mestre ('faltou'), como no
    estorno do Mercado Pago. O Mestre também pode mandar conferir na hora
    (POST /api/mestre/pagamento/play/estornos).
  - A chave da conta de serviço nunca vai para log, repr nem erro. HTTP sempre
    FORA de self.tranca e de _escrita.

A CONFIGURAÇÃO vem só de variáveis de ambiente (no Coolify: Runtime ligado, Build
DESLIGADO, "Is Literal"; ver docs/GOOGLE_PLAY.md §9):

  SOTERRA_PLAY_CREDENCIAL  o JSON da conta de serviço da Google (o arquivo inteiro
                           colado na variável) OU o caminho de um arquivo com ele,
                           fora do Git
  SOTERRA_PLAY_PACOTE      opcional: o nome do aplicativo (padrão br.com.soterra.jogo)
  SOTERRA_PLAY_TESTE=1     opcional: aceita também compra de teste (testador de licença)

Sem a credencial, desligado: as rotas respondem 503 e o resto funciona igual. O
`--play-api URL` do api.py (SÓ para as provas: http://127.0.0.1:PORTA) troca a
Google de verdade pela de mentira de tests/play_falso.py.

Sem dependência nenhuma: a conta de serviço pede um JWT assinado com RSA
(RS256), e a assinatura é feita aqui mesmo (PKCS#1 v1.5 é uma potência modular).
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from comum import Recusa, agora
from loja import PACOTES, PACOTES_A_VENDA, POR_PACOTE, reais
from pagamento import TETO_CENTAVOS_DIA, _ABRE, base_de_prova

log = logging.getLogger('api')

APP_PADRAO = 'br.com.soterra.jogo'
API_PLAY = 'https://androidpublisher.googleapis.com'
API_TOKEN = 'https://oauth2.googleapis.com'
ESCOPO = 'https://www.googleapis.com/auth/androidpublisher'
TIMEOUT = 10
CONFERE_POR_HORA = 30            # consultas à Google por conta por hora (freio 'play:<conta>')
QUANTIDADE_MAX = 10              # a compra de várias unidades de uma vez (a Play permite ligar por produto)
COMPRAS_LISTA = 10
VARRE_A_CADA = 6 * 3600          # s entre duas perguntas "o que foi reembolsado?"
VARRE_PAGINAS = 20               # páginas de reembolsos por varredura (cada uma traz dezenas)
RE_TOKEN = re.compile(r'^[A-Za-z0-9._~:+/=-]{16,2000}$')
RE_APP = re.compile(r'^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$')
# os estados que a Google dá a uma compra de produto (purchases.products: purchaseState)
COMPRADA, CANCELADA, PENDENTE = 0, 1, 2
FRASE_DESLIGADO = 'a compra pela Google Play chega em breve'
FRASE_GOOGLE_FORA = 'a Google Play não respondeu; tente de novo em instantes'


def produto_play(pacote_id):
    """O id do produto NA PLAY para um pacote do jogo. A Play só aceita letra
    minúscula, dígito, sublinhado e ponto no id de produto — o hífen dos nossos
    pacotes não passa. O mapa mora SÓ aqui: 'barras-50' → 'barras_50'."""
    return pacote_id.replace('-', '_')


PRODUTOS = {produto_play(p['id']): p['id'] for p in PACOTES}

ESQUEMA_PLAY = """
-- cada compra da Google Play (o purchaseToken DELA é a chave): credita UMA vez. Dinheiro é trilha: a conta
-- que some deixa a linha. `pacote` vazio = reembolso de uma compra que este servidor nunca viu (fica a
-- lápide: se o token aparecer depois, não credita)
CREATE TABLE IF NOT EXISTS pagamentos_play(
  id            INTEGER PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,
  pedido        TEXT,
  conta_id      INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  pacote        TEXT NOT NULL DEFAULT '',
  barras        INTEGER NOT NULL DEFAULT 0,
  centavos      INTEGER NOT NULL DEFAULT 0,
  quantidade    INTEGER NOT NULL DEFAULT 1,
  teste         INTEGER NOT NULL DEFAULT 0,
  estado        TEXT NOT NULL DEFAULT 'visto',
  creditado_em  INTEGER,
  estornado_em  INTEGER,
  criado_em     INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_play_pedido ON pagamentos_play(pedido) WHERE pedido IS NOT NULL;
CREATE INDEX IF NOT EXISTS pagamentos_play_conta ON pagamentos_play(conta_id, creditado_em);
"""


# ---- a assinatura RS256 (funções puras; tests/pagamento_play_api.py cobre) ----------------------
def _b64(dados):
    return base64.urlsafe_b64encode(dados).rstrip(b'=').decode('ascii')


def _der(dados, i=0):
    """Um elemento DER a partir de `i`: (tipo, conteúdo, o índice depois dele)."""
    tipo, tam = dados[i], dados[i + 1]
    i += 2
    if tam & 0x80:
        n = tam & 0x7f
        tam = int.from_bytes(dados[i:i + n], 'big')
        i += n
    return tipo, dados[i:i + tam], i + tam


def chave_rsa(pem):
    """A chave privada da conta de serviço ('-----BEGIN PRIVATE KEY-----', PKCS#8)
    → (n, d). ValueError no que não for isso."""
    try:
        miolo = re.sub(r'-----[A-Z ]+-----|\s', '', pem)
        tipo, corpo, _ = _der(base64.b64decode(miolo))
        if tipo != 0x30:
            raise ValueError
        _, _, i = _der(corpo)                   # a versão
        _, _, i = _der(corpo, i)                # o algoritmo (RSA)
        tipo, chave, _ = _der(corpo, i)         # OCTET STRING com a RSAPrivateKey
        tipo2, seq, _ = _der(chave)
        if tipo != 0x04 or tipo2 != 0x30:
            raise ValueError
        nums, i = [], 0
        while i < len(seq) and len(nums) < 4:   # versão, n, e, d
            _, v, i = _der(seq, i)
            nums.append(int.from_bytes(v, 'big'))
        n, d = nums[1], nums[3]
        if n.bit_length() < 1024 or d <= 0:
            raise ValueError
        return n, d
    except Exception:
        raise ValueError('a chave privada da conta de serviço não é uma chave RSA em PKCS#8') from None


_SHA256_DER = bytes.fromhex('3031300d060960864801650304020105000420')


def assina_rs256(n, d, mensagem):
    """RSASSA-PKCS1-v1_5 com SHA-256: 00 01 FF…FF 00 ‖ DigestInfo ‖ hash, elevado a d."""
    k = (n.bit_length() + 7) // 8
    t = _SHA256_DER + hashlib.sha256(mensagem).digest()
    em = b'\x00\x01' + b'\xff' * (k - len(t) - 3) + b'\x00' + t
    return pow(int.from_bytes(em, 'big'), d, n).to_bytes(k, 'big')


# ---- a Google (a conversa HTTP) ---------------------------------------------------------------
class PlayFalhou(Exception):
    """A conversa com a Google falhou. A mensagem é para o log: só o código HTTP
    ou o tipo do erro (nunca a chave, nunca o token de acesso, nunca o purchaseToken)."""


class GooglePlay:
    """O VERIFICADOR: quem pergunta à Google. Sem argumentos: desligado (é o que
    o cartório usa quando ninguém passa um). As provas trocam a Google por uma
    de mentira pelo `base` (tests/play_falso.py) ou passam outro objeto com
    `ligado`, `teste`, `app`, `compra(produto, token)` e `anuladas()`."""

    def __init__(self, credencial=None, app=APP_PADRAO, teste=False, base=None):
        self.app = app if isinstance(app, str) and RE_APP.match(app) else APP_PADRAO
        self.teste = bool(teste)
        self.base_play = (base or API_PLAY).rstrip('/')
        self.base_token = (base or API_TOKEN).rstrip('/')
        self.falso = bool(base)
        self.email = self.kid = self._chave = None
        self.defeito = None                     # por que a credencial não serviu (para o log, sem segredo)
        self._acesso, self._vence = None, 0
        self._tranca = threading.Lock()
        if credencial:
            try:
                c = json.loads(credencial) if isinstance(credencial, str) else credencial
                self._chave = chave_rsa(c['private_key'])
                self.email, self.kid = str(c['client_email']), c.get('private_key_id')
            except (ValueError, KeyError, TypeError) as e:
                self.email = self._chave = None
                self.defeito = str(e) if isinstance(e, ValueError) and 'RSA' in str(e) \
                    else 'não é o JSON de uma conta de serviço (faltam client_email e private_key)'

    def __repr__(self):                         # nunca a chave, nem num traceback
        return '<GooglePlay %s>' % self.descricao()

    @classmethod
    def do_ambiente(cls, env=None, base=None):
        env = os.environ if env is None else env
        bruto = (env.get('SOTERRA_PLAY_CREDENCIAL') or '').strip()
        cred = defeito = None
        if bruto.startswith('{'):
            cred = bruto
        elif bruto:                             # o caminho de um arquivo (fora do Git)
            try:
                with open(bruto, encoding='utf-8') as f:
                    cred = f.read()
            except OSError:
                defeito = 'o arquivo de SOTERRA_PLAY_CREDENCIAL não abriu'
        play = cls(cred, app=(env.get('SOTERRA_PLAY_PACOTE') or '').strip() or APP_PADRAO,
                   teste=(env.get('SOTERRA_PLAY_TESTE') or '').strip() == '1', base=base)
        play.defeito = play.defeito or defeito
        return play

    @property
    def ligado(self):
        return self._chave is not None and bool(self.email)

    def descricao(self):
        if not self.ligado:
            return 'Google Play desligada (%s)' % (self.defeito or 'falta SOTERRA_PLAY_CREDENCIAL')
        return 'Google Play ligada (%s%s%s)' % (self.app, ', aceita compra de TESTE' if self.teste else '',
                                                ', Google de MENTIRA em %s' % self.base_play if self.falso else '')

    def _http(self, metodo, url, dados=None, cabecalhos=None):
        req = urllib.request.Request(url, data=dados, method=metodo)
        for k, v in (cabecalhos or {}).items():
            req.add_header(k, v)
        try:
            with _ABRE.open(req, timeout=TIMEOUT) as r:     # sem seguir redirecionamento: o Authorization não viaja
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, None
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise PlayFalhou(type(e).__name__) from None

    def _token_de_acesso(self):
        """O token OAuth da conta de serviço (vale 1 h; guardado até 5 min antes de vencer)."""
        with self._tranca:
            if self._acesso and time.time() < self._vence - 300:
                return self._acesso
            t = int(time.time())
            cab = {'alg': 'RS256', 'typ': 'JWT'}
            if self.kid:
                cab['kid'] = self.kid
            # o `aud` é sempre o endereço de verdade: é o que a Google confere na assinatura
            corpo = {'iss': self.email, 'scope': ESCOPO, 'aud': API_TOKEN + '/token', 'iat': t, 'exp': t + 3600}
            base = _b64(json.dumps(cab).encode()) + '.' + _b64(json.dumps(corpo).encode())
            jwt = base + '.' + _b64(assina_rs256(self._chave[0], self._chave[1], base.encode('ascii')))
            dados = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                            'assertion': jwt}).encode('ascii')
            status, r = self._http('POST', self.base_token + '/token', dados,
                                   {'Content-Type': 'application/x-www-form-urlencoded'})
            if status != 200 or not isinstance(r, dict) or not isinstance(r.get('access_token'), str):
                raise PlayFalhou('a Google recusou a conta de serviço (HTTP %s)' % status)
            self._acesso = r['access_token']
            validade = r.get('expires_in')
            self._vence = time.time() + (validade if isinstance(validade, (int, float)) and validade > 0 else 3600)
            return self._acesso

    def _pede(self, caminho):
        status, r = self._http('GET', self.base_play + caminho, None,
                               {'Authorization': 'Bearer ' + self._token_de_acesso()})
        if status == 401:                       # o token caiu antes da hora: um novo, uma vez
            with self._tranca:
                self._acesso = None
            status, r = self._http('GET', self.base_play + caminho, None,
                                   {'Authorization': 'Bearer ' + self._token_de_acesso()})
        return status, r

    def compra(self, produto, token):
        """purchases.products.get: o que a Google sabe desta compra. None quando
        ela não conhece o token PARA este aplicativo e este produto (400, 404, 410)."""
        status, r = self._pede('/androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s'
                               % (urllib.parse.quote(self.app, safe=''), urllib.parse.quote(produto, safe=''),
                                  urllib.parse.quote(token, safe='')))
        if status in (400, 404, 410):
            return None
        if status != 200 or not isinstance(r, dict):
            raise PlayFalhou('HTTP %s na consulta da compra' % status)
        return r

    def anuladas(self):
        """purchases.voidedpurchases: as compras reembolsadas, canceladas ou
        contestadas dos últimos 30 dias (o padrão da Google): [{purchaseToken, orderId, …}]."""
        saida, pagina = [], None
        for _ in range(VARRE_PAGINAS):
            caminho = '/androidpublisher/v3/applications/%s/purchases/voidedpurchases?type=0' \
                % urllib.parse.quote(self.app, safe='')
            if pagina:
                caminho += '&token=' + urllib.parse.quote(pagina, safe='')
            status, r = self._pede(caminho)
            if status != 200 or not isinstance(r, dict):
                raise PlayFalhou('HTTP %s na lista de reembolsos' % status)
            saida += [v for v in (r.get('voidedPurchases') or []) if isinstance(v, dict)]
            pagina = ((r.get('tokenPagination') or {}).get('nextPageToken')) if isinstance(r.get('tokenPagination'), dict) \
                else None
            if not pagina:
                break
        return saida


_DESLIGADA = GooglePlay()


class PagamentoPlayMixin:

    def _play(self):
        play = getattr(self, 'play', None)
        return play if play is not None else _DESLIGADA

    def _play_conta(self, cid):
        """O código da conta que o aplicativo entrega à Google na compra
        (obfuscatedAccountId) e que a Google devolve na consulta: um hmac com o
        segredo do servidor — não diz nada da conta a quem não tem o segredo."""
        segredo = self.segredo if isinstance(self.segredo, bytes) else str(self.segredo).encode('utf-8')
        return hmac.new(segredo, b'play-conta:%d' % cid, hashlib.sha256).hexdigest()[:40]

    @staticmethod
    def _play_publico(r):
        estado = 'estornada' if r['estornado_em'] is not None else 'creditada' if r['creditado_em'] is not None \
            else r['estado']
        pacote = POR_PACOTE.get(r['pacote'])
        return {'id': r['id'], 'pacote': r['pacote'], 'nome': pacote['nome'] if pacote else r['pacote'],
                'barras': r['barras'], 'estado': estado, 'teste': bool(r['teste']), 'criadoEm': r['criado_em']}

    def _play_pago_24h(self, cid, t):
        """Dentro da tranca: os centavos já creditados à conta em 24 h, pela Play e pelo Mercado Pago."""
        play = self.con.execute("SELECT COALESCE(SUM(centavos), 0) FROM pagamentos_play WHERE conta_id = ? "
                                "AND creditado_em > ? AND estornado_em IS NULL", (cid, t - 86400)).fetchone()[0]
        mp = self.con.execute(
            "SELECT COALESCE(SUM(g.centavos), 0) FROM pagamentos_mp m JOIN pagamentos g ON g.id = m.pagamento_id "
            "WHERE g.conta_id = ? AND m.creditado_em > ? AND m.estornado_em IS NULL", (cid, t - 86400)).fetchone()[0]
        return play + mp

    # -- GET /api/pagamento/play: o que o aplicativo pode vender a esta conta -------------------------
    def play_ver(self, conta, corpo):
        play = self._play()
        if not play.ligado:
            raise Recusa(503, FRASE_DESLIGADO, play=False)
        cid, t = conta['id'], agora()
        with self.tranca:
            pago = self._play_pago_24h(cid, t)
            compras = [self._play_publico(r) for r in self.con.execute(
                "SELECT * FROM pagamentos_play WHERE conta_id = ? ORDER BY id DESC LIMIT ?", (cid, COMPRAS_LISTA))]
            saldo = self._barras_saldo(cid)
        # sem preço: no aplicativo o preço é o que a GOOGLE mostra (na moeda do jogador). `cabe` diz se o
        # pacote ainda cabe no teto de 24 h — o aplicativo nem abre a compra do que não creditaria
        pacotes = [{'id': p['id'], 'produto': produto_play(p['id']), 'nome': p['nome'], 'barras': p['barras'],
                    'cabe': pago + p['centavos'] <= TETO_CENTAVOS_DIA} for p in PACOTES]
        return 200, {'ok': True, 'ligado': True, 'teste': play.teste, 'conta': self._play_conta(cid),
                     'pacotes': pacotes, 'compras': compras, 'barras': {'saldo': saldo}}

    # -- POST /api/pagamento/play {pacote, token}: confere na Google e credita UMA vez -----------------
    def play_compra(self, conta, corpo):
        play = self._play()
        if not play.ligado:
            raise Recusa(503, FRASE_DESLIGADO, play=False)
        pacote_id, token = corpo.get('pacote'), corpo.get('token')
        if isinstance(pacote_id, str) and pacote_id in PRODUTOS:        # o aplicativo pode mandar o id da Play
            pacote_id = PRODUTOS[pacote_id]
        pacote = POR_PACOTE.get(pacote_id) if isinstance(pacote_id, str) and pacote_id in PACOTES_A_VENDA else None
        if pacote is None:
            raise Recusa(400, 'pacote desconhecido')
        if not isinstance(token, str) or not RE_TOKEN.match(token):
            raise Recusa(400, 'compra inválida')
        cid, t = conta['id'], agora()
        with self._escrita():
            ja = self.con.execute("SELECT * FROM pagamentos_play WHERE token = ?", (token,)).fetchone()
            pronto = self._play_ja_resolvida(ja, cid)
            if pronto is not None:              # o aplicativo mandando de novo: sem gastar consulta à Google
                return pronto
            chave = 'play:%d' % cid
            libera = self._conta_limite(chave, CONFERE_POR_HORA, 3600, t)
            if libera is not None:
                raise Recusa(429, 'conferências de compra demais nesta hora (%d)' % CONFERE_POR_HORA, liberaEm=libera)
            self._anota_limite(chave, t)
        # fora da tranca: a conversa com a Google leva até 10 s
        try:
            g = play.compra(produto_play(pacote_id), token)
        except PlayFalhou as e:
            log.warning("play: a consulta da compra da conta #%d falhou (%s)", cid, e)
            raise Recusa(502, FRASE_GOOGLE_FORA)
        if g is None:
            # a Google não conhece o token neste aplicativo e neste produto: inventado, de outro app, de outro pacote
            log.warning("play: #%d mandou uma compra de %s que a Google não conhece", cid, pacote_id)
            raise Recusa(400, 'a Google Play não reconhece essa compra', estado='desconhecida', consumir=False)
        if g.get('productId') not in (None, produto_play(pacote_id)):
            raise Recusa(400, 'a Google Play não reconhece essa compra', estado='desconhecida', consumir=False)
        estado = g.get('purchaseState')
        t = agora()
        if estado == CANCELADA:                 # cancelada ou reembolsada: se chegou a creditar, as barras saem
            with self._escrita():
                ja = self.con.execute("SELECT * FROM pagamentos_play WHERE token = ?", (token,)).fetchone()
                if ja is not None:
                    self._play_estorna(ja, 'cancelada', t)
            raise Recusa(409, 'essa compra foi cancelada ou reembolsada', estado='cancelada', consumir=False)
        if estado == PENDENTE:
            return 200, {'ok': True, 'creditado': False, 'consumir': False, 'estado': 'pendente'}
        if estado != COMPRADA:
            raise Recusa(502, FRASE_GOOGLE_FORA)
        teste = g.get('purchaseType') == 0      # 0 = compra de teste (testador de licença): não entrou dinheiro
        if teste and not play.teste:
            log.warning("play: #%d mandou uma compra de TESTE e o servidor não aceita teste", cid)
            raise Recusa(409, 'essa é uma compra de teste, e o servidor não aceita teste agora', estado='teste',
                         consumir=False)
        dona = g.get('obfuscatedExternalAccountId')
        if isinstance(dona, str) and dona and not hmac.compare_digest(dona, self._play_conta(cid)):
            raise Recusa(403, 'essa compra foi feita por outra conta do jogo: entre nela para receber as barras',
                         estado='outra-conta', consumir=False)
        qtd = g.get('quantity')
        qtd = 1 if qtd is None else qtd
        if isinstance(qtd, bool) or not isinstance(qtd, int) or not 1 <= qtd <= QUANTIDADE_MAX:
            raise Recusa(409, 'quantidade de compra que o jogo não aceita', estado='quantidade', consumir=False)
        pedido = g.get('orderId') if isinstance(g.get('orderId'), str) and g.get('orderId') else None
        barras, centavos = pacote['barras'] * qtd, pacote['centavos'] * qtd
        with self._escrita():
            ja = self.con.execute("SELECT * FROM pagamentos_play WHERE token = ?", (token,)).fetchone()
            pronto = self._play_ja_resolvida(ja, cid)       # o contêiner vizinho creditou enquanto a Google respondia
            if pronto is not None:
                return pronto
            if pedido is not None and self.con.execute(
                    "SELECT 1 FROM pagamentos_play WHERE pedido = ? AND token != ?", (pedido, token)).fetchone():
                raise Recusa(409, 'essa compra já foi usada', estado='repetida', consumir=False)
            banida = self.con.execute("SELECT banido FROM contas WHERE id = ?", (cid,)).fetchone()
            if banida is None or banida['banido']:
                # não credita e não manda consumir: a compra sem confirmação a Google devolve em 3 dias
                raise Recusa(403, 'esta conta não pode receber compras', estado='conta-banida', consumir=False)
            nova = ja is None
            if nova:
                pid = self.con.execute(
                    "INSERT INTO pagamentos_play(token, pedido, conta_id, pacote, barras, centavos, quantidade, teste, "
                    "estado, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visto', ?, ?)",
                    (token, pedido, cid, pacote_id, barras, centavos, qtd, 1 if teste else 0, t, t)).lastrowid
                self._evento(cid, 'play-compra', {'play': pid, 'pacote': pacote_id, 'pedidoGoogle': pedido,
                                                  'teste': teste})
            else:
                pid = ja['id']
            pago = self._play_pago_24h(cid, t)
            if pago + centavos > TETO_CENTAVOS_DIA:
                if nova:
                    self._alerta(cid, 'teto-diario', {'play': pid, 'pedidoGoogle': pedido, 'barras': barras,
                                                      'centavos': centavos, 'pagoEm24h': pago}, t)
                log.warning("play %d: passa do teto de %s em 24 h (já creditado: %s); não credita agora", pid,
                            reais(TETO_CENTAVOS_DIA), reais(pago))
                # 200 com ok: a linha e o alerta têm de ficar gravados (uma Recusa desfaria a transação)
                return 200, {'ok': True, 'creditado': False, 'consumir': False, 'estado': 'teto',
                             'erro': 'o teto de pacotes é %s por dia; as barras entram quando houver espaço'
                                     % reais(TETO_CENTAVOS_DIA)}
            self.barras_move(cid, barras, 'pacote', 'play:%d' % pid, 'play:%d' % pid, t)
            self.con.execute("UPDATE pagamentos_play SET estado = 'creditada', creditado_em = ?, atualizado_em = ?, "
                             "pedido = COALESCE(pedido, ?) WHERE id = ?", (t, t, pedido, pid))
            self._evento(cid, 'pagamento-credito', {'play': pid, 'pedidoGoogle': pedido, 'barras': barras,
                                                    'teste': teste})
            saldo = self._barras_saldo(cid)
        log.info("play %d: %d barras de ouro creditadas à conta #%d%s", pid, barras, cid, ' (compra de TESTE)' if teste else '')
        return 201, {'ok': True, 'creditado': True, 'consumir': True, 'estado': 'creditada', 'barras': {'saldo': saldo},
                     'compra': {'id': pid, 'pacote': pacote_id, 'nome': pacote['nome'], 'barras': barras}}

    def _play_ja_resolvida(self, ja, cid):
        """Dentro da tranca: a resposta pronta para um token que o servidor já
        conhece e não precisa mais perguntar à Google; None se precisa."""
        if ja is None:
            return None
        if ja['estornado_em'] is not None:
            raise Recusa(409, 'essa compra foi cancelada ou reembolsada', estado='cancelada', consumir=False)
        if ja['creditado_em'] is not None:
            # já creditada (a esta conta ou a outra): o aplicativo só precisa CONSUMIR para a Google liberar
            # o pacote de novo. Nada entra duas vezes
            return 200, {'ok': True, 'creditado': False, 'repetido': True, 'consumir': True, 'estado': 'creditada',
                         'barras': {'saldo': self._barras_saldo(cid)}}
        if ja['conta_id'] is not None and ja['conta_id'] != cid:
            raise Recusa(403, 'essa compra foi feita por outra conta do jogo: entre nela para receber as barras',
                         estado='outra-conta', consumir=False)
        return None

    # -- o reembolso ------------------------------------------------------------------------------------
    def _play_estorna(self, linha, fonte, t):
        """Dentro de _escrita: a compra foi reembolsada, cancelada ou contestada.
        Uma vez só (estornado_em). Se creditou, tira as barras que ainda houver;
        o que já foi gasto vai no alerta ('faltou'), como no Mercado Pago."""
        if linha['estornado_em'] is not None:
            return False
        self.con.execute("UPDATE pagamentos_play SET estornado_em = ?, estado = 'estornada', atualizado_em = ? "
                         "WHERE id = ?", (t, t, linha['id']))
        if linha['creditado_em'] is None:
            return True                         # nunca creditou: só fica marcada para nunca creditar
        cid, qtd, tirado = linha['conta_id'], linha['barras'], 0
        if cid is not None:
            tirado = -(self.barras_move(cid, -qtd, 'estorno-pagamento', 'play:%d' % linha['id'],
                                        'play:%d:estorno' % linha['id'], t, parcial=True) or 0)
        dados = {'play': linha['id'], 'pedidoGoogle': linha['pedido'], 'barras': qtd, 'tirado': tirado,
                 'faltou': qtd - tirado, 'status': fonte}
        self._alerta(cid, 'estorno', dados, t)
        self._evento(cid, 'pagamento-estorno', dados)
        log.warning("play %d: %s — %d barras tiradas, %d já gastas — alerta 'estorno' para o Mestre", linha['id'],
                    fonte, tirado, qtd - tirado)
        return True

    def play_varre_estornos(self):
        """Pergunta à Google o que foi reembolsado nos últimos 30 dias e estorna o
        que ainda não foi. Idempotente (vale rodar nos dois contêineres). Devolve
        {vistos, estornados}; PlayFalhou se a Google não respondeu."""
        play = self._play()
        if not play.ligado:
            return {'vistos': 0, 'estornados': 0}
        anuladas = play.anuladas()              # fora da tranca
        feitos, t = 0, agora()
        with self._escrita():
            for v in anuladas:
                token = v.get('purchaseToken')
                if not isinstance(token, str) or not RE_TOKEN.match(token):
                    continue
                pedido = v.get('orderId') if isinstance(v.get('orderId'), str) and v.get('orderId') else None
                linha = self.con.execute("SELECT * FROM pagamentos_play WHERE token = ?", (token,)).fetchone()
                if linha is None:
                    # reembolso de uma compra que nunca chegou aqui: fica a lápide, para o token nunca creditar
                    if pedido is not None and self.con.execute("SELECT 1 FROM pagamentos_play WHERE pedido = ?",
                                                               (pedido,)).fetchone():
                        pedido = None
                    self.con.execute("INSERT INTO pagamentos_play(token, pedido, estado, estornado_em, criado_em, "
                                     "atualizado_em) VALUES (?, ?, 'estornada', ?, ?, ?)", (token, pedido, t, t, t))
                    continue
                if self._play_estorna(linha, 'reembolso na Google Play', t):
                    feitos += 1
        return {'vistos': len(anuladas), 'estornados': feitos}

    # -- POST /api/mestre/pagamento/play/estornos: o Mestre manda conferir os reembolsos agora ------------
    def mestre_play_estornos(self, conta, corpo):
        if not self._play().ligado:
            raise Recusa(503, FRASE_DESLIGADO, play=False)
        self._mestre_freio(conta, 'play-estornos', CONFERE_POR_HORA, 'conferências demais nesta hora; espere um pouco')
        try:
            r = self.play_varre_estornos()
        except PlayFalhou as e:
            log.warning("play: a lista de reembolsos falhou (%s)", e)
            raise Recusa(502, FRASE_GOOGLE_FORA)
        return 200, dict(r, ok=True)


def liga_varredura(api, intervalo=VARRE_A_CADA, primeira=120):
    """A pergunta periódica "o que foi reembolsado?", numa thread do próprio
    servidor (não há agendador no contêiner). Erro só vai para o log: a próxima
    volta tenta de novo, e o Mestre tem o botão."""
    if not api._play().ligado:
        return None

    def volta():
        time.sleep(primeira)
        while True:
            try:
                r = api.play_varre_estornos()
                if r['estornados']:
                    log.warning("play: %d compra(s) reembolsada(s) estornada(s) agora", r['estornados'])
            except PlayFalhou as e:
                log.warning("play: a lista de reembolsos falhou (%s); tento de novo depois", e)
            except Exception:
                log.exception("play: a varredura de reembolsos quebrou")
            time.sleep(intervalo)

    th = threading.Thread(target=volta, name='play-estornos', daemon=True)
    th.start()
    return th


__all__ = ['ESQUEMA_PLAY', 'GooglePlay', 'PagamentoPlayMixin', 'PlayFalhou', 'base_de_prova', 'liga_varredura',
           'produto_play']
