#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A Google Play DE MENTIRA das provas (tests/pagamento_play_api.py): o verificador
que o servidor/pagamento_play.py consulta, num servidor HTTP de 127.0.0.1.

Faz o que a Google faz para o servidor do jogo, e só:
  POST /token                                  troca o JWT da conta de serviço por um token de acesso —
                                               e CONFERE a assinatura RS256 com a chave pública (a prova de
                                               que a assinatura feita sem biblioteca está certa)
  GET  /androidpublisher/v3/applications/<app>/purchases/products/<produto>/tokens/<token>
                                               a compra (404 se o token não é deste app e deste produto)
  GET  /androidpublisher/v3/applications/<app>/purchases/voidedpurchases
                                               os reembolsos

`credencial()` devolve o JSON de uma conta de serviço inventada (chave RSA gerada
aqui, na hora; nada de verdade). Nenhuma conversa com a Google de verdade.
"""
import base64
import hashlib
import json
import secrets
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = 'br.com.soterra.jogo'
SHA256_DER = bytes.fromhex('3031300d060960864801650304020105000420')


# ---- uma chave RSA de prova (1024 bits: rápida de gerar; a de verdade tem 2048) -------------------
def _miller(n, voltas=8):
    d, s = n - 1, 0
    while d % 2 == 0:
        d, s = d // 2, s + 1
    for _ in range(voltas):
        x = pow(secrets.randbelow(n - 3) + 2, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _primo(bits):
    while True:
        n = secrets.randbits(bits) | (3 << (bits - 2)) | 1
        if all(n % p for p in (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)) and pow(2, n - 1, n) == 1 and _miller(n):
            return n


def _der(tipo, corpo):
    n = len(corpo)
    if n < 0x80:
        tam = bytes([n])
    else:
        nb = (n.bit_length() + 7) // 8
        tam = bytes([0x80 | nb]) + n.to_bytes(nb, 'big')
    return bytes([tipo]) + tam + corpo


def _int(v):
    return _der(0x02, v.to_bytes(v.bit_length() // 8 + 1, 'big'))


def gera_chave():
    """(n, e, d, o PEM em PKCS#8 — o formato do arquivo da conta de serviço da Google)."""
    e = 65537
    while True:
        p, q = _primo(512), _primo(512)
        phi = (p - 1) * (q - 1)
        if p != q and phi % e:
            break
    n, d = p * q, pow(e, -1, phi)
    rsa = _der(0x30, _int(0) + _int(n) + _int(e) + _int(d) + _int(p) + _int(q) + _int(d % (p - 1)) + _int(d % (q - 1))
               + _int(pow(q, -1, p)))
    alg = _der(0x30, bytes.fromhex('06092a864886f70d010101') + b'\x05\x00')      # rsaEncryption, NULL
    pkcs8 = _der(0x30, _int(0) + alg + _der(0x04, rsa))
    b64 = base64.b64encode(pkcs8).decode('ascii')
    pem = '-----BEGIN PRIVATE KEY-----\n' + '\n'.join(b64[i:i + 64] for i in range(0, len(b64), 64)) \
        + '\n-----END PRIVATE KEY-----\n'
    return n, e, d, pem


def _sem_b64(texto):
    return base64.urlsafe_b64decode(texto + '=' * (-len(texto) % 4))


class GooglePlayFalsa:

    def __init__(self, porta=0):
        self.n, self.e, _, pem = gera_chave()
        self.email = 'prova@soterra-prova.iam.gserviceaccount.com'
        self._credencial = {'type': 'service_account', 'client_email': self.email, 'private_key': pem,
                            'private_key_id': 'chave-de-prova', 'token_uri': 'https://oauth2.googleapis.com/token'}
        self.compras = {}            # token → o que a Google sabe da compra
        self.voided = []
        self.acessos = set()         # os tokens de acesso emitidos
        self.pedidos_de_token = 0
        self.consultas = 0           # consultas de compra que chegaram
        self.jwt_ruim = 0
        self.fora = 0                # as próximas N consultas respondem 500
        self._trava = threading.Lock()
        self.servidor = ThreadingHTTPServer(('127.0.0.1', porta), self._atendente())
        self.base = 'http://127.0.0.1:%d' % self.servidor.server_address[1]
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()

    def credencial(self):
        return json.dumps(self._credencial)

    def compra(self, produto, estado=0, conta=None, teste=False, quantidade=None, app=APP):
        """Uma compra feita "no aparelho": devolve o purchaseToken. estado: 0 paga, 1 cancelada, 2 pendente."""
        token = 'tok.' + secrets.token_urlsafe(48)
        g = {'kind': 'androidpublisher#productPurchase', 'purchaseState': estado, 'consumptionState': 0,
             'orderId': 'GPA.%04d-%04d-%04d-%05d' % tuple(secrets.randbelow(10 ** k) for k in (4, 4, 4, 5)),
             'productId': produto, 'purchaseTimeMillis': '1'}
        if conta:
            g['obfuscatedExternalAccountId'] = conta
        if teste:
            g['purchaseType'] = 0
        if quantidade is not None:
            g['quantity'] = quantidade
        with self._trava:
            self.compras[token] = dict(g, _app=app)
        return token

    def muda(self, token, **campos):
        with self._trava:
            self.compras[token].update(campos)

    def reembolsa(self, token):
        """O reembolso na Google: a compra vira cancelada e entra na lista de anuladas."""
        with self._trava:
            g = self.compras.get(token)
            if g is not None:
                g['purchaseState'] = 1
            self.voided.append({'kind': 'androidpublisher#voidedPurchase', 'purchaseToken': token,
                                'orderId': g['orderId'] if g else 'GPA.0000-0000-0000-00000', 'voidedSource': 0,
                                'voidedReason': 1})

    def parar(self):
        self.servidor.shutdown()
        self.servidor.server_close()

    def _jwt_bom(self, jwt):
        try:
            cab, corpo, ass = jwt.split('.')
            c = json.loads(_sem_b64(corpo))
            if json.loads(_sem_b64(cab)).get('alg') != 'RS256' or c.get('iss') != self.email:
                return False
            if c.get('scope') != 'https://www.googleapis.com/auth/androidpublisher' \
                    or c.get('aud') != 'https://oauth2.googleapis.com/token' or not c.get('exp', 0) > c.get('iat', 0):
                return False
            k = (self.n.bit_length() + 7) // 8
            t = SHA256_DER + hashlib.sha256((cab + '.' + corpo).encode('ascii')).digest()
            esperado = b'\x00\x01' + b'\xff' * (k - len(t) - 3) + b'\x00' + t
            return pow(int.from_bytes(_sem_b64(ass), 'big'), self.e, self.n).to_bytes(k, 'big') == esperado
        except Exception:
            return False

    def _atendente(self):
        falso = self

        class Atendente(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, fmt, *args):
                pass

            def _responde(self, status, obj):
                corpo = json.dumps(obj).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)

            def do_POST(self):
                n = int(self.headers.get('Content-Length') or 0)
                dados = urllib.parse.parse_qs(self.rfile.read(n).decode('utf-8')) if n > 0 else {}
                if self.path != '/token':
                    return self._responde(404, {'error': 'not_found'})
                with falso._trava:
                    falso.pedidos_de_token += 1
                jwt = (dados.get('assertion') or [''])[0]
                if (dados.get('grant_type') or [''])[0] != 'urn:ietf:params:oauth:grant-type:jwt-bearer' \
                        or not falso._jwt_bom(jwt):
                    with falso._trava:
                        falso.jwt_ruim += 1
                    return self._responde(400, {'error': 'invalid_grant'})
                acesso = 'acesso-' + secrets.token_hex(16)
                with falso._trava:
                    falso.acessos.add(acesso)
                self._responde(200, {'access_token': acesso, 'expires_in': 3600, 'token_type': 'Bearer'})

            def do_GET(self):
                aut = self.headers.get('Authorization', '')
                if not aut.startswith('Bearer ') or aut[7:] not in falso.acessos:
                    return self._responde(401, {'error': {'code': 401}})
                partes = urllib.parse.urlsplit(self.path).path.split('/')
                # /androidpublisher/v3/applications/<app>/purchases/...
                if len(partes) < 7 or partes[1:4] != ['androidpublisher', 'v3', 'applications'] or partes[5] != 'purchases':
                    return self._responde(404, {'error': {'code': 404}})
                app = urllib.parse.unquote(partes[4])
                if partes[6] == 'voidedpurchases':
                    with falso._trava:
                        lista = list(falso.voided)
                    return self._responde(200, {'voidedPurchases': lista} if app == APP else {})
                if partes[6] != 'products' or len(partes) != 10 or partes[8] != 'tokens':
                    return self._responde(404, {'error': {'code': 404}})
                with falso._trava:
                    falso.consultas += 1
                    if falso.fora > 0:
                        falso.fora -= 1
                        return self._responde(500, {'error': {'code': 500}})
                    g = falso.compras.get(urllib.parse.unquote(partes[9]))
                    g = dict(g) if g is not None else None
                # a Google de verdade: o token só existe para o aplicativo e o produto em que foi comprado
                if g is None or g.pop('_app') != app or g['productId'] != urllib.parse.unquote(partes[7]):
                    return self._responde(404, {'error': {'code': 404, 'message': 'purchaseTokenNotFound'}})
                self._responde(200, g)

        return Atendente
