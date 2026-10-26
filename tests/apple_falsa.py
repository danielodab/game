#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A APPLE DE MENTIRA das provas da compra no iPhone (servidor/pagamento_apple.py) — 26/10.

A Apple não é chamada pelo servidor: ela ASSINA. Esta peça faz o mesmo papel com
uma cadeia de certificados inventada, no mesmo formato da de verdade:

    raiz (P-384, autoassinada) → intermediária (com a marca 1.2.840.113635.100.6.2.1)
                               → folha (P-256, com a marca 1.2.840.113635.100.6.11.1)

e assina as transações do StoreKit 2 (o `jwsRepresentation`) e os avisos do App
Store Server Notifications V2 (o `signedPayload`) em ES256, com a cadeia no `x5c`.
O servidor sobe com `--apple-raiz ARQ` (o PEM desta raiz): a assinatura continua
sendo conferida de ponta a ponta, só a raiz é outra.

    from apple_falsa import AppleFalsa
    apple = AppleFalsa()
    apple.grava_raiz('/tmp/raiz.pem')                 # para o --apple-raiz
    jws = apple.transacao('barras_50', conta_uuid)    # o que o aplicativo manda
    aviso = apple.aviso('ONE_TIME_CHARGE', jws)       # o que a Apple manda ao servidor

`torta=` estraga uma parte de propósito (as provas do que NÃO pode passar).
"""
import base64
import datetime
import itertools
import json
import time
import uuid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.x509.oid import NameOID

OID_FOLHA = '1.2.840.113635.100.6.11.1'
OID_INTERMEDIARIA = '1.2.840.113635.100.6.2.1'
BUNDLE = 'br.com.soterra.jogo'
APP_ID = 6826929117
_numeros = itertools.count(2000001043762000)


def _b64(dados):
    return base64.urlsafe_b64encode(dados).rstrip(b'=').decode('ascii')


def _nome(cn):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn), x509.NameAttribute(NameOID.ORGANIZATION_NAME,
                                                                                     'Apple de Mentira')])


def _cert(sujeito, chave_publica, emissor, chave_emissor, ca, marca=None, de=None, ate=None):
    agora = datetime.datetime.now(datetime.timezone.utc)
    b = (x509.CertificateBuilder().subject_name(_nome(sujeito)).issuer_name(_nome(emissor))
         .public_key(chave_publica).serial_number(x509.random_serial_number())
         .not_valid_before(de or agora - datetime.timedelta(days=1))
         .not_valid_after(ate or agora + datetime.timedelta(days=365))
         .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True))
    if marca:
        b = b.add_extension(x509.UnrecognizedExtension(x509.ObjectIdentifier(marca), b'\x05\x00'), critical=False)
    algo = hashes.SHA384() if isinstance(chave_emissor.curve, ec.SECP384R1) else hashes.SHA256()
    return b.sign(chave_emissor, algo)


class AppleFalsa:
    def __init__(self):
        self.k_raiz = ec.generate_private_key(ec.SECP384R1())
        self.k_inter = ec.generate_private_key(ec.SECP384R1())
        self.k_folha = ec.generate_private_key(ec.SECP256R1())
        self.raiz = _cert('Raiz de Mentira - G3', self.k_raiz.public_key(), 'Raiz de Mentira - G3', self.k_raiz, True)
        self.inter = _cert('Intermediaria de Mentira', self.k_inter.public_key(), 'Raiz de Mentira - G3',
                           self.k_raiz, True, OID_INTERMEDIARIA)
        self.folha = _cert('Folha de Mentira', self.k_folha.public_key(), 'Intermediaria de Mentira', self.k_inter,
                           False, OID_FOLHA)

    def raiz_pem(self):
        return self.raiz.public_bytes(serialization.Encoding.PEM).decode('ascii')

    def grava_raiz(self, arquivo):
        with open(arquivo, 'w', encoding='ascii') as f:
            f.write(self.raiz_pem())
        return arquivo

    def _cadeia(self, torta):
        folha, inter, raiz = self.folha, self.inter, self.raiz
        if torta == 'sem-marca':                # a folha sem a marca da Apple, assinada certinho
            folha = _cert('Folha de Mentira', self.k_folha.public_key(), 'Intermediaria de Mentira', self.k_inter, False)
        if torta == 'outra-raiz':               # uma cadeia inteira de outra raiz (bem formada, mas não é a aceita)
            outra = AppleFalsa()
            folha, inter, raiz = outra.folha, outra.inter, outra.raiz
            return [folha, inter, raiz], outra.k_folha
        if torta == 'vencida':                  # a folha já vencida na data da assinatura
            ontem = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=2)
            folha = _cert('Folha de Mentira', self.k_folha.public_key(), 'Intermediaria de Mentira', self.k_inter,
                          False, OID_FOLHA, de=ontem - datetime.timedelta(days=30), ate=ontem)
        return [folha, inter, raiz], self.k_folha

    def assina(self, conteudo, torta=None):
        """Um JWS ES256 com a cadeia no x5c. `torta`: 'sem-marca', 'outra-raiz', 'vencida', 'alg-none',
        'conteudo' (o conteúdo mexido depois de assinado) ou 'sem-cadeia'."""
        certs, chave = self._cadeia(torta)
        cab = {'alg': 'none' if torta == 'alg-none' else 'ES256',
               'x5c': [base64.b64encode(c.public_bytes(serialization.Encoding.DER)).decode('ascii') for c in certs]}
        if torta == 'sem-cadeia':
            cab['x5c'] = cab['x5c'][:1]
        cab64 = _b64(json.dumps(cab).encode())
        corpo64 = _b64(json.dumps(conteudo).encode())
        der = chave.sign((cab64 + '.' + corpo64).encode('ascii'), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        assinatura = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
        if torta == 'conteudo':
            conteudo = dict(conteudo, quantity=9)
            corpo64 = _b64(json.dumps(conteudo).encode())
        return cab64 + '.' + corpo64 + '.' + _b64(assinatura)

    def transacao(self, produto, conta=None, torta=None, **campos):
        """A transação de um consumível, como o StoreKit 2 a assina. `conta`: o appAccountToken (UUID)."""
        t = int(time.time() * 1000)
        tid = str(campos.pop('transactionId', None) or next(_numeros))
        tx = {'transactionId': tid, 'originalTransactionId': tid, 'bundleId': BUNDLE, 'productId': produto,
              'purchaseDate': t, 'originalPurchaseDate': t, 'quantity': 1, 'type': 'Consumable',
              'inAppOwnershipType': 'PURCHASED', 'signedDate': t, 'environment': 'Production',
              'transactionReason': 'PURCHASE', 'storefront': 'BRA', 'storefrontId': '143503', 'currency': 'BRL',
              'price': 4900}
        if conta:
            tx['appAccountToken'] = conta
        tx.update(campos)
        return self.assina(tx, torta)

    def aviso(self, tipo, transacao_jws, ambiente='Production', bundle=BUNDLE, app_id=APP_ID, subtipo=None,
              torta=None):
        """O signedPayload do App Store Server Notifications V2."""
        conteudo = {'notificationType': tipo, 'notificationUUID': str(uuid.uuid4()), 'version': '2.0',
                    'signedDate': int(time.time() * 1000),
                    'data': {'appAppleId': app_id, 'bundleId': bundle, 'bundleVersion': '2', 'environment': ambiente,
                             'signedTransactionInfo': transacao_jws}}
        if subtipo:
            conteudo['subtype'] = subtipo
        return self.assina(conteudo, torta)
