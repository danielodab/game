#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""As barras de ouro compradas pela APPLE (In-App Purchase), dentro do aplicativo
de iPhone (26/10). Na web segue o Mercado Pago (pagamento.py); no Android, a
Google Play (pagamento_play.py).

Entra no cartório como mixin (`class Api(..., PagamentoAppleMixin)` no api.py).

POR QUE EXISTE: a Apple só deixa um aplicativo de iPhone vender item digital pela
compra dela (diretriz 3.1.1), e a 3.1.3(b) só deixa USAR no iPhone as barras
compradas na web ou no Android se as barras também forem vendidas ali pela Apple
(docs/APP_STORE.md §8.2). Então os MESMOS pacotes (loja.py, PACOTES) são produtos
consumíveis da Apple, com os mesmos ids da Play (`barras_50`…).

O CAMINHO DE UMA COMPRA:
  1. o aplicativo mostra os pacotes (GET /api/pagamento/apple: os produtos e o
     código da conta, um UUID; o PREÇO vem da Apple, na moeda do jogador) e abre
     a compra da Apple, SEM encerrá-la;
  2. a Apple devolve ao aplicativo a transação ASSINADA por ela (um JWS: o
     `jwsRepresentation` do StoreKit 2); o aplicativo a manda
     (POST /api/pagamento/apple {jws});
  3. o servidor CONFERE A ASSINATURA aqui mesmo, sem perguntar nada a ninguém: a
     cadeia de certificados do cabeçalho tem de terminar na raiz da Apple (Apple
     Root CA - G3, gravada aqui), com as marcas da Apple na folha e na
     intermediária, e a folha assina o JWS. Só então credita as barras — UMA vez
     por `transactionId`;
  4. o servidor responde `encerrar: true` e só aí o aplicativo ENCERRA a transação
     (o `finish` da Apple). Se o aplicativo fechar no meio, a transação fica
     aberta no aparelho e volta na próxima abertura: o servidor reconhece o
     `transactionId` e não credita duas vezes.
  E se o aplicativo nunca mandar? A Apple AVISA este servidor (App Store Server
  Notifications V2, POST /api/pagamento/apple/aviso): a compra avulsa chega como
  ONE_TIME_CHARGE, com a transação assinada e o UUID da conta — o servidor credita
  por ali também (o mesmo `transactionId`, uma vez só). O reembolso chega como
  REFUND ou REVOKE.

AS REGRAS QUE SEGURAM O DINHEIRO (as mesmas da Google e do Mercado Pago):
  - Nunca credita pelo que o aplicativo diz: só pelo que a APPLE assinou. O app
    (bundleId) e o produto vêm de dentro da assinatura.
  - UM crédito por transação: `pagamentos_apple.transacao` é único; o
    `creditado_em IS NULL` é lido dentro do BEGIN IMMEDIATE (vale entre os dois
    contêineres do rolling update); e o idem 'apple:<id>' no extrato das barras.
  - A compra feita por uma conta do jogo só credita NAQUELA conta: o aplicativo
    passa à Apple o UUID da conta (`appAccountToken`, um hmac — nada pessoal) e
    ele volta dentro da assinatura.
  - A transação revogada (com `revocationDate`) não credita; a que já foi
    estornada nunca mais credita.
  - O teto de R$ 400,00 por conta em 24 h vale aqui, somando a Google Play e o
    Mercado Pago. O que passa do teto NÃO credita e NÃO é encerrado: o aplicativo
    tenta de novo depois.
  - Conta banida não recebe (403; a transação fica aberta).
  - SANDBOX (a compra de teste: o revisor da Apple, o TestFlight e os testadores
    que você cria no App Store Connect — ninguém paga) credita, marcada como
    teste: o revisor da Apple TESTA a compra em Sandbox antes de aprovar, e sem
    isso a versão é recusada. Só entra no Sandbox quem o dono convida.
    SOTERRA_APPLE_SANDBOX=0 recusa. A transação do Xcode (assinada no próprio Mac)
    nunca credita.
  - REEMBOLSO: tira as barras que ainda houver; o que já foi gasto vira alerta
    para o Mestre ('faltou'), como na Google e no Mercado Pago.

A CONFIGURAÇÃO vem só de variáveis de ambiente (no Coolify: Runtime ligado; ver
docs/APP_STORE.md §8.2 e servidor/SUBIR.md §7). NENHUM segredo: a assinatura da
Apple se confere com a chave pública dela.

  SOTERRA_APPLE=1           liga a compra pela Apple (e a loja no iPhone)
  SOTERRA_APPLE_BUNDLE      opcional: o bundle do aplicativo (padrão br.com.soterra.jogo)
  SOTERRA_APPLE_APP_ID      opcional: o "ID da Apple" do aplicativo (padrão 6826929117);
                            o aviso de produção de outro aplicativo é recusado
  SOTERRA_APPLE_SANDBOX=0   opcional: recusa a compra de teste (Sandbox)

Sem SOTERRA_APPLE=1, desligada: as rotas respondem 503, o catálogo diz `apple:
false` e a loja do iPhone segue fechada. O `--apple-raiz ARQ` do api.py (SÓ para as
provas: tests/apple_falsa.py) troca a raiz da Apple por uma de mentira — a
assinatura continua sendo conferida, só a raiz muda.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

from comum import Recusa, agora
from loja import PACOTES, PACOTES_A_VENDA, POR_PACOTE, reais
from pagamento import TETO_CENTAVOS_DIA
from pagamento_play import PRODUTOS, produto_play

try:
    from cryptography import x509
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    TEM_ECDSA = True
except ImportError:                      # sem a biblioteca: desligada, nada é creditado
    TEM_ECDSA = False

log = logging.getLogger('api')

BUNDLE_PADRAO = 'br.com.soterra.jogo'
APP_ID_PADRAO = '6826929117'             # o "ID da Apple" do aplicativo (codemagic.yaml, APP_STORE_APPLE_ID)
CONFERE_POR_HORA = 60                    # transações mandadas por conta por hora (freio 'apple:<conta>')
QUANTIDADE_MAX = 10
COMPRAS_LISTA = 10
JWS_MAX = 20000                          # caracteres: uma transação assinada tem uns 3 mil
RE_JWS = re.compile(r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
RE_TRANSACAO = re.compile(r'^\d{1,30}$')
RE_BUNDLE = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$')
FRASE_DESLIGADO = 'a compra pela App Store chega em breve'
FRASE_ASSINATURA = 'a App Store não reconhece essa compra'

# A raiz da Apple: "Apple Root CA - G3" (https://www.apple.com/certificateauthority/), a que assina as
# transações do StoreKit 2 e os avisos do App Store Server. Certificado PÚBLICO; vale até 30/04/2039.
# SHA-256 do DER: 63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179 (conferido em 26/10)
APPLE_RAIZ_G3 = """-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----"""
APPLE_RAIZ_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179'
# as marcas que a Apple põe nos certificados da cadeia (a mesma regra da biblioteca oficial dela)
OID_FOLHA = '1.2.840.113635.100.6.11.1'
OID_INTERMEDIARIA = '1.2.840.113635.100.6.2.1'

ESQUEMA_APPLE = """
-- cada transação da Apple (o transactionId DELA é a chave): credita UMA vez. Dinheiro é trilha: a conta que
-- some deixa a linha. `pacote` vazio = reembolso de uma transação que este servidor nunca viu (fica a lápide:
-- se ela aparecer depois, não credita)
CREATE TABLE IF NOT EXISTS pagamentos_apple(
  id            INTEGER PRIMARY KEY,
  transacao     TEXT NOT NULL UNIQUE,
  original      TEXT,
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
CREATE INDEX IF NOT EXISTS pagamentos_apple_conta ON pagamentos_apple(conta_id, creditado_em);
-- o UUID que o aplicativo passa à Apple (appAccountToken) → a conta: o aviso da Apple só traz o UUID
CREATE TABLE IF NOT EXISTS contas_apple(
  token     TEXT PRIMARY KEY,
  conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE
);
"""


# ---- a assinatura da Apple (funções puras; tests/pagamento_apple_api.py cobre) -----------------------
def _b64url(texto):
    return base64.urlsafe_b64decode(texto + '=' * (-len(texto) % 4))


def _tem_marca(cert, oid):
    try:
        cert.extensions.get_extension_for_oid(x509.ObjectIdentifier(oid))
        return True
    except x509.ExtensionNotFound:
        return False


def _assinado_por(cert, emissor):
    """O certificado `cert` foi assinado pela chave de `emissor` (ECDSA)?"""
    if cert.issuer != emissor.subject:
        return False
    chave = emissor.public_key()
    if not isinstance(chave, ec.EllipticCurvePublicKey):
        return False
    try:
        chave.verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
        return True
    except InvalidSignature:
        return False


def le_jws(jws, raizes):
    """Confere um JWS da Apple e devolve o conteúdo (um dict). ValueError com o motivo
    (para o log; nunca o JWS) no que não passar. `raizes`: os DER aceitos como raiz.

    A regra é a da biblioteca oficial da Apple (app-store-server-library): o cabeçalho
    diz ES256 e traz a cadeia (x5c) folha → intermediária → raiz; a raiz é,
    byte a byte, uma das aceitas; a intermediária tem a marca 1.2.840.113635.100.6.2.1
    e foi assinada pela raiz; a folha tem a marca 1.2.840.113635.100.6.11.1 e foi
    assinada pela intermediária; todas valem na data da assinatura (signedDate); e a
    folha assina o JWS."""
    if not TEM_ECDSA:
        raise ValueError('falta a biblioteca cryptography')
    if not isinstance(jws, str) or len(jws) > JWS_MAX or not RE_JWS.match(jws):
        raise ValueError('não é um JWS')
    cab64, corpo64, ass64 = jws.split('.')
    try:
        cab = json.loads(_b64url(cab64))
        corpo = json.loads(_b64url(corpo64))
        assinatura = _b64url(ass64)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('JWS ilegível') from None
    if not isinstance(cab, dict) or not isinstance(corpo, dict):
        raise ValueError('JWS ilegível')
    if cab.get('alg') != 'ES256':
        raise ValueError('algoritmo %.20r' % cab.get('alg'))
    x5c = cab.get('x5c')
    if not isinstance(x5c, list) or len(x5c) != 3 or not all(isinstance(c, str) for c in x5c):
        raise ValueError('sem a cadeia de certificados')
    try:
        ders = [base64.b64decode(c, validate=True) for c in x5c]
        folha, inter, raiz = [x509.load_der_x509_certificate(d) for d in ders]
    except (ValueError, TypeError):
        raise ValueError('certificado ilegível') from None
    if ders[2] not in raizes:
        raise ValueError('a cadeia não termina na raiz da Apple')
    if not _tem_marca(inter, OID_INTERMEDIARIA) or not _tem_marca(folha, OID_FOLHA):
        raise ValueError('certificado sem a marca da Apple')
    if not _assinado_por(inter, raiz) or not _assinado_por(folha, inter):
        raise ValueError('cadeia de certificados quebrada')
    quando = corpo.get('signedDate')
    quando = (datetime.fromtimestamp(quando / 1000, timezone.utc)
              if isinstance(quando, (int, float)) and not isinstance(quando, bool) and quando > 0
              else datetime.now(timezone.utc))
    for c in (folha, inter, raiz):
        if not c.not_valid_before_utc <= quando <= c.not_valid_after_utc:
            raise ValueError('certificado fora da validade')
    chave = folha.public_key()
    if not isinstance(chave, ec.EllipticCurvePublicKey) or len(assinatura) != 64:
        raise ValueError('assinatura torta')
    der = encode_dss_signature(int.from_bytes(assinatura[:32], 'big'), int.from_bytes(assinatura[32:], 'big'))
    try:
        chave.verify(der, (cab64 + '.' + corpo64).encode('ascii'), ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        raise ValueError('assinatura que não confere') from None
    return corpo


class LojaApple:
    """O VERIFICADOR: quem confere o que a Apple assinou. Sem argumentos: desligado (é
    o que o cartório usa quando ninguém passa um). `raiz` é SÓ PARA AS PROVAS: o PEM
    de uma raiz de mentira (tests/apple_falsa.py) no lugar da da Apple."""

    def __init__(self, ligado=False, bundle=BUNDLE_PADRAO, app_id=APP_ID_PADRAO, sandbox=True, raiz=None):
        self.bundle = bundle if isinstance(bundle, str) and RE_BUNDLE.match(bundle) else BUNDLE_PADRAO
        self.app_id = str(app_id) if app_id and str(app_id).isdigit() else None
        self.sandbox = bool(sandbox)
        self.falsa = raiz is not None
        self.defeito = None if TEM_ECDSA else 'falta a biblioteca cryptography'
        self._raizes = []
        if TEM_ECDSA:
            try:
                pem = raiz if raiz is not None else APPLE_RAIZ_G3
                der = x509.load_pem_x509_certificate(pem.encode('ascii')).public_bytes(serialization.Encoding.DER)
                if raiz is None and hashlib.sha256(der).hexdigest() != APPLE_RAIZ_G3_SHA256:
                    raise ValueError
                self._raizes = [der]
            except (ValueError, TypeError):
                self.defeito = 'a raiz da Apple não abriu'
        self._ligado = bool(ligado) and bool(self._raizes)

    def __repr__(self):
        return '<LojaApple %s>' % self.descricao()

    @classmethod
    def do_ambiente(cls, env=None, raiz=None):
        env = os.environ if env is None else env

        def valor(nome):
            v = env.get(nome)
            return v.strip() if isinstance(v, str) and v.strip() else None

        return cls(ligado=valor('SOTERRA_APPLE') in ('1', 'sim', 'true'),
                   bundle=valor('SOTERRA_APPLE_BUNDLE') or BUNDLE_PADRAO,
                   app_id=valor('SOTERRA_APPLE_APP_ID') or APP_ID_PADRAO,
                   sandbox=valor('SOTERRA_APPLE_SANDBOX') != '0', raiz=raiz)

    @property
    def ligado(self):
        return self._ligado

    def descricao(self):
        if not self.ligado:
            return 'App Store desligada (%s)' % (self.defeito or 'falta SOTERRA_APPLE=1')
        return 'App Store ligada (%s%s%s)' % (self.bundle, ', aceita Sandbox' if self.sandbox else ', SEM Sandbox',
                                              ', raiz de MENTIRA' if self.falsa else '')

    def transacao(self, jws):
        """A transação assinada pela Apple, conferida. ValueError no que não passar."""
        return le_jws(jws, self._raizes)

    def aviso(self, jws):
        """O aviso do App Store Server (o signedPayload), conferido. ValueError no que não passar."""
        return le_jws(jws, self._raizes)


_DESLIGADA = LojaApple()


class PagamentoAppleMixin:

    def _apple(self):
        apple = getattr(self, 'apple', None)
        return apple if apple is not None else _DESLIGADA

    def _apple_conta(self, cid):
        """O UUID da conta que o aplicativo entrega à Apple na compra (appAccountToken)
        e que volta dentro da transação assinada: um hmac com o segredo do servidor,
        no formato de UUID (a Apple só aceita UUID) — não diz nada da conta a quem não
        tem o segredo."""
        segredo = self.segredo if isinstance(self.segredo, bytes) else str(self.segredo).encode('utf-8')
        bruto = hmac.new(segredo, b'apple-conta:%d' % cid, hashlib.sha256).digest()[:16]
        return str(uuid.UUID(bytes=bruto, version=4))

    @staticmethod
    def _apple_publico(r):
        estado = 'estornada' if r['estornado_em'] is not None else 'creditada' if r['creditado_em'] is not None \
            else r['estado']
        pacote = POR_PACOTE.get(r['pacote'])
        return {'id': r['id'], 'pacote': r['pacote'], 'nome': pacote['nome'] if pacote else r['pacote'],
                'barras': r['barras'], 'estado': estado, 'teste': bool(r['teste']), 'criadoEm': r['criado_em']}

    def _apple_pago_24h(self, cid, t):
        """Dentro da tranca: os centavos já creditados à conta em 24 h, pela Apple, pela Google Play e pelo
        Mercado Pago (o teto vale somando os três)."""
        return self._play_pago_24h(cid, t)       # pagamento_play.py: lá a soma já leva a Apple

    # -- GET /api/pagamento/apple: o que o aplicativo pode vender a esta conta ---------------------------
    def apple_ver(self, conta, corpo):
        apple = self._apple()
        if not apple.ligado:
            raise Recusa(503, FRASE_DESLIGADO, apple=False)
        cid, t = conta['id'], agora()
        token = self._apple_conta(cid)
        with self._escrita():
            # o UUID → a conta: é por ele que o aviso da Apple acha quem comprou
            self.con.execute("INSERT OR IGNORE INTO contas_apple(token, conta_id) VALUES (?, ?)", (token, cid))
            pago = self._apple_pago_24h(cid, t)
            compras = [self._apple_publico(r) for r in self.con.execute(
                "SELECT * FROM pagamentos_apple WHERE conta_id = ? ORDER BY id DESC LIMIT ?", (cid, COMPRAS_LISTA))]
            saldo = self._barras_saldo(cid)
        # sem preço: no aplicativo o preço é o que a APPLE mostra (na moeda do jogador). `cabe` diz se o pacote
        # ainda cabe no teto de 24 h — o aplicativo nem abre a compra do que não creditaria
        pacotes = [{'id': p['id'], 'produto': produto_play(p['id']), 'nome': p['nome'], 'barras': p['barras'],
                    'cabe': pago + p['centavos'] <= TETO_CENTAVOS_DIA} for p in PACOTES]
        return 200, {'ok': True, 'ligado': True, 'teste': apple.sandbox, 'conta': token, 'pacotes': pacotes,
                     'compras': compras, 'barras': {'saldo': saldo}}

    # -- a transação: conferida, e quem é ------------------------------------------------------------
    def _apple_le(self, jws):
        """A transação assinada → o conteúdo conferido, ou Recusa 400 (ESTE aplicativo, um produto daqui,
        um consumível, o ambiente que o servidor aceita)."""
        apple = self._apple()
        try:
            tx = apple.transacao(jws)
        except ValueError as e:
            log.warning("apple: transação recusada (%s)", e)
            raise Recusa(400, FRASE_ASSINATURA, estado='desconhecida', encerrar=False)
        tid = tx.get('transactionId')
        tid = str(tid) if isinstance(tid, int) and not isinstance(tid, bool) else tid
        if not isinstance(tid, str) or not RE_TRANSACAO.match(tid):
            raise Recusa(400, FRASE_ASSINATURA, estado='desconhecida', encerrar=False)
        if tx.get('bundleId') != apple.bundle:
            log.warning("apple: transação %s de outro aplicativo (%.60r)", tid, tx.get('bundleId'))
            raise Recusa(400, FRASE_ASSINATURA, estado='desconhecida', encerrar=False)
        if tx.get('productId') not in PRODUTOS:
            raise Recusa(400, 'pacote desconhecido', estado='desconhecida', encerrar=False)
        ambiente = tx.get('environment')
        if ambiente not in ('Production', 'Sandbox') or (ambiente == 'Sandbox' and not apple.sandbox):
            log.warning("apple: transação %s do ambiente %.20r, que o servidor não aceita", tid, ambiente)
            raise Recusa(409, 'essa é uma compra de teste, e o servidor não aceita teste agora', estado='teste',
                         encerrar=False)
        tx['transactionId'] = tid
        return tx

    def _apple_dona(self, tx):
        """Dentro da tranca: a conta do UUID que veio na transação (None se não veio ou não se conhece)."""
        token = tx.get('appAccountToken')
        if not isinstance(token, str) or not token:
            return None
        r = self.con.execute("SELECT conta_id FROM contas_apple WHERE token = ?", (token.lower(),)).fetchone()
        return r[0] if r is not None else None

    # -- POST /api/pagamento/apple {jws}: confere a assinatura e credita UMA vez --------------------------
    def apple_compra(self, conta, corpo):
        apple = self._apple()
        if not apple.ligado:
            raise Recusa(503, FRASE_DESLIGADO, apple=False)
        jws = corpo.get('jws')
        if not isinstance(jws, str) or not RE_JWS.match(jws) or len(jws) > JWS_MAX:
            raise Recusa(400, 'compra inválida')
        cid, t = conta['id'], agora()
        with self._escrita():
            chave = 'apple:%d' % cid
            libera = self._conta_limite(chave, CONFERE_POR_HORA, 3600, t)
            if libera is not None:
                raise Recusa(429, 'conferências de compra demais nesta hora (%d)' % CONFERE_POR_HORA, liberaEm=libera)
            self._anota_limite(chave, t)
        tx = self._apple_le(jws)
        token = tx.get('appAccountToken')
        if isinstance(token, str) and token and not hmac.compare_digest(token.lower(), self._apple_conta(cid)):
            raise Recusa(403, 'essa compra foi feita por outra conta do jogo: entre nela para receber as barras',
                         estado='outra-conta', encerrar=False)
        return self._apple_credita(cid, tx, 'aplicativo')

    def _apple_credita(self, cid, tx, fonte):
        """O crédito de uma transação já conferida, à conta `cid` (o aplicativo dela, ou o aviso da Apple).
        Devolve (status, resposta) como a rota."""
        tid, t = tx['transactionId'], agora()
        pacote_id = PRODUTOS[tx['productId']]
        pacote = POR_PACOTE.get(pacote_id)
        if pacote is None or pacote_id not in PACOTES_A_VENDA:
            raise Recusa(400, 'pacote desconhecido', estado='desconhecida', encerrar=False)
        qtd = tx.get('quantity')
        qtd = 1 if qtd is None else qtd
        if isinstance(qtd, bool) or not isinstance(qtd, int) or not 1 <= qtd <= QUANTIDADE_MAX:
            raise Recusa(409, 'quantidade de compra que o jogo não aceita', estado='quantidade', encerrar=False)
        teste = tx.get('environment') == 'Sandbox'
        original = tx.get('originalTransactionId')
        original = str(original) if isinstance(original, (int, str)) and not isinstance(original, bool) else None
        barras, centavos = pacote['barras'] * qtd, pacote['centavos'] * qtd
        with self._escrita():
            ja = self.con.execute("SELECT * FROM pagamentos_apple WHERE transacao = ?", (tid,)).fetchone()
            if ja is not None and ja['estornado_em'] is not None:
                raise Recusa(409, 'essa compra foi cancelada ou reembolsada', estado='cancelada', encerrar=True)
            if tx.get('revocationDate'):
                # revogada pela Apple (reembolso ou família): se chegou a creditar, as barras saem
                if ja is not None:
                    self._apple_estorna(ja, 'revogada pela Apple', t)
                else:
                    self.con.execute("INSERT INTO pagamentos_apple(transacao, original, estado, estornado_em, criado_em, "
                                     "atualizado_em) VALUES (?, ?, 'estornada', ?, ?, ?)", (tid, original, t, t, t))
                # 200 com ok: o estorno e a lápide têm de ficar gravados (uma Recusa desfaria a transação)
                return 200, {'ok': True, 'creditado': False, 'encerrar': True, 'estado': 'cancelada',
                             'erro': 'essa compra foi cancelada ou reembolsada'}
            if ja is not None and ja['creditado_em'] is not None:
                # já creditada (pelo aplicativo ou pelo aviso da Apple): o aplicativo só precisa ENCERRAR
                return 200, {'ok': True, 'creditado': False, 'repetido': True, 'encerrar': True, 'estado': 'creditada',
                             'barras': {'saldo': self._barras_saldo(cid)}}
            if ja is not None and ja['conta_id'] is not None and ja['conta_id'] != cid:
                raise Recusa(403, 'essa compra foi feita por outra conta do jogo: entre nela para receber as barras',
                             estado='outra-conta', encerrar=False)
            banida = self.con.execute("SELECT banido FROM contas WHERE id = ?", (cid,)).fetchone()
            if banida is None or banida['banido']:
                raise Recusa(403, 'esta conta não pode receber compras', estado='conta-banida', encerrar=False)
            nova = ja is None
            if nova:
                aid = self.con.execute(
                    "INSERT INTO pagamentos_apple(transacao, original, conta_id, pacote, barras, centavos, quantidade, "
                    "teste, estado, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visto', ?, ?)",
                    (tid, original, cid, pacote_id, barras, centavos, qtd, 1 if teste else 0, t, t)).lastrowid
                self._evento(cid, 'apple-compra', {'apple': aid, 'pacote': pacote_id, 'transacao': tid, 'teste': teste,
                                                   'fonte': fonte})
            else:
                aid = ja['id']
            pago = self._apple_pago_24h(cid, t)
            if not teste and pago + centavos > TETO_CENTAVOS_DIA:
                if nova:
                    self._alerta(cid, 'teto-diario', {'apple': aid, 'transacao': tid, 'barras': barras,
                                                      'centavos': centavos, 'pagoEm24h': pago}, t)
                log.warning("apple %d: passa do teto de %s em 24 h (já creditado: %s); não credita agora", aid,
                            reais(TETO_CENTAVOS_DIA), reais(pago))
                return 200, {'ok': True, 'creditado': False, 'encerrar': False, 'estado': 'teto',
                             'erro': 'o teto de pacotes é %s por dia; as barras entram quando houver espaço'
                                     % reais(TETO_CENTAVOS_DIA)}
            self.barras_move(cid, barras, 'pacote', 'apple:%d' % aid, 'apple:%d' % aid, t)
            self.con.execute("UPDATE pagamentos_apple SET estado = 'creditada', creditado_em = ?, atualizado_em = ?, "
                             "conta_id = ? WHERE id = ?", (t, t, cid, aid))
            self._evento(cid, 'pagamento-credito', {'apple': aid, 'transacao': tid, 'barras': barras, 'teste': teste})
            saldo = self._barras_saldo(cid)
        log.info("apple %d: %d barras de ouro creditadas à conta #%d (%s)%s", aid, barras, cid, fonte,
                 ' (compra de TESTE, Sandbox)' if teste else '')
        return 201, {'ok': True, 'creditado': True, 'encerrar': True, 'estado': 'creditada', 'barras': {'saldo': saldo},
                     'compra': {'id': aid, 'pacote': pacote_id, 'nome': pacote['nome'], 'barras': barras}}

    # -- o reembolso ---------------------------------------------------------------------------------------
    def _apple_estorna(self, linha, fonte, t):
        """Dentro de _escrita: a transação foi reembolsada ou revogada. Uma vez só
        (estornado_em). Se creditou, tira as barras que ainda houver; o que já foi
        gasto vai no alerta ('faltou'), como na Google e no Mercado Pago."""
        if linha['estornado_em'] is not None:
            return False
        self.con.execute("UPDATE pagamentos_apple SET estornado_em = ?, estado = 'estornada', atualizado_em = ? "
                         "WHERE id = ?", (t, t, linha['id']))
        if linha['creditado_em'] is None:
            return True                         # nunca creditou: só fica marcada para nunca creditar
        cid, qtd, tirado = linha['conta_id'], linha['barras'], 0
        if cid is not None:
            tirado = -(self.barras_move(cid, -qtd, 'estorno-pagamento', 'apple:%d' % linha['id'],
                                        'apple:%d:estorno' % linha['id'], t, parcial=True) or 0)
        dados = {'apple': linha['id'], 'transacao': linha['transacao'], 'barras': qtd, 'tirado': tirado,
                 'faltou': qtd - tirado, 'status': fonte}
        self._alerta(cid, 'estorno', dados, t)
        self._evento(cid, 'pagamento-estorno', dados)
        log.warning("apple %d: %s — %d barras tiradas, %d já gastas — alerta 'estorno' para o Mestre", linha['id'],
                    fonte, tirado, qtd - tirado)
        return True

    # -- POST /api/pagamento/apple/aviso: o App Store Server Notifications V2 (sem conta: a assinatura é a porta)
    def apple_aviso(self, conta, corpo):
        apple = self._apple()
        if not apple.ligado:
            raise Recusa(503, FRASE_DESLIGADO)
        payload = corpo.get('signedPayload')
        try:
            aviso = apple.aviso(payload)
        except ValueError as e:
            self._apple_avisos_recusados = getattr(self, '_apple_avisos_recusados', 0) + 1
            log.warning("apple: aviso recusado (%s; %d desde o boot)", e, self._apple_avisos_recusados)
            raise Recusa(401, 'assinatura inválida')
        tipo, dados = aviso.get('notificationType'), aviso.get('data')
        dados = dados if isinstance(dados, dict) else {}
        if dados.get('bundleId') != apple.bundle:
            log.warning("apple: aviso %.30r de outro aplicativo (%.60r); ignorado", tipo, dados.get('bundleId'))
            return 200, {'ok': True, 'ignorado': 'outro aplicativo'}
        ambiente = dados.get('environment')
        if ambiente == 'Production' and apple.app_id and str(dados.get('appAppleId')) != apple.app_id:
            log.warning("apple: aviso de produção com outro appAppleId; ignorado")
            return 200, {'ok': True, 'ignorado': 'outro aplicativo'}
        if ambiente == 'Sandbox' and not apple.sandbox:
            return 200, {'ok': True, 'ignorado': 'sandbox'}
        log.info("apple: aviso %s%s (%s)", tipo, '/' + aviso['subtype'] if isinstance(aviso.get('subtype'), str) else '',
                 ambiente)
        if tipo not in ('ONE_TIME_CHARGE', 'REFUND', 'REVOKE'):
            return 200, {'ok': True, 'ignorado': 'tipo'}       # TEST, CONSUMPTION_REQUEST, REFUND_DECLINED…
        try:
            tx = self._apple_le(dados.get('signedTransactionInfo'))
        except Recusa as r:
            # a transação de dentro não serve (outro produto, ambiente recusado): 200, ou a Apple insiste
            return 200, {'ok': True, 'ignorado': r.erro}
        t = agora()
        if tipo in ('REFUND', 'REVOKE'):
            with self._escrita():
                linha = self.con.execute("SELECT * FROM pagamentos_apple WHERE transacao = ?",
                                         (tx['transactionId'],)).fetchone()
                if linha is None:
                    # reembolso de uma transação que nunca chegou aqui: fica a lápide, para ela nunca creditar
                    self.con.execute("INSERT INTO pagamentos_apple(transacao, original, estado, estornado_em, criado_em, "
                                     "atualizado_em) VALUES (?, ?, 'estornada', ?, ?, ?)",
                                     (tx['transactionId'], str(tx.get('originalTransactionId') or '') or None, t, t, t))
                    return 200, {'ok': True, 'estado': 'lapide'}
                feito = self._apple_estorna(linha, 'reembolso na App Store' if tipo == 'REFUND' else 'revogada pela Apple', t)
            return 200, {'ok': True, 'estado': 'estornada' if feito else 'ja-estornada'}
        # ONE_TIME_CHARGE: a compra avulsa — credita pela conta do UUID, mesmo sem o aplicativo mandar
        with self.tranca:
            cid = self._apple_dona(tx)
        if cid is None:
            log.warning("apple: compra %s sem conta conhecida (o aplicativo a manda quando abrir)", tx['transactionId'])
            return 200, {'ok': True, 'ignorado': 'conta desconhecida'}
        try:
            _, r = self._apple_credita(cid, tx, 'aviso da Apple')
        except Recusa as rc:
            log.warning("apple: o aviso da compra %s não creditou (%s)", tx['transactionId'], rc.erro)
            return 200, {'ok': True, 'ignorado': rc.erro}
        return 200, {'ok': True, 'estado': r.get('estado'), 'creditado': bool(r.get('creditado'))}


__all__ = ['APPLE_RAIZ_G3', 'ESQUEMA_APPLE', 'LojaApple', 'PagamentoAppleMixin', 'le_jws']
