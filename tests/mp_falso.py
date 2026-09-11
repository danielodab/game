#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O Mercado Pago DE MENTIRA das provas (Loja 2, 10/09).

    from mp_falso import MercadoPagoFalso
    mp = MercadoPagoFalso('TOKEN-DE-PROVA', 'segredo-de-prova')   # mp.base = 'http://127.0.0.1:N'
    ... python servidor/api.py --mp-api <mp.base>  (com SOTERRA_MP_TOKEN/SEGREDO/ENDERECO no ambiente)
    mp_id = mp.pagar(referencia)           # o jogador "pagou"
    status, corpo = mp.avisar(mp_id, api)  # o aviso assinado chega na API
    mp.parar()

Um ThreadingHTTPServer em 127.0.0.1 (porta livre), CORS *, numa thread. Imita
só o que o servidor usa da API do Mercado Pago, conferindo o Bearer (401 sem ele):
  POST /checkout/preferences   → 201 {id, init_point, sandbox_init_point, external_reference}
                                 (a mesma resposta para o mesmo X-Idempotency-Key)
  GET  /v1/payments/<id>       → 200 {id, status, status_detail, external_reference, transaction_amount,
                                      currency_id, live_mode, date_approved, date_created}
                                 | 404 {message:'Payment not found', status:404}
  GET  /v1/payments/search?external_reference=… → 200 {results:[…], paging:{total, limit, offset}}

O controle (as provas e as páginas de prova chamam; JSON, sem Bearer):
  POST /_falso/pagar    {referencia, status='approved', centavos?, live=True, moeda='BRL'} → {mp_id}
  POST /_falso/status   {mp_id, status}                                                    → {ok}
  POST /_falso/avisar   {mp_id, api, assinatura:'boa'|'ruim'|'sem', request_id?, tipo?}    → {status, corpo}
                        (POST <api>/api/pagamento/aviso?data.id=<mp_id>&type=<tipo> com x-signature e
                         x-request-id assinados pela regra da documentação e o corpo JSON de um webhook)
  GET  /_falso/estado   → {preferencias:[corpos recebidos], consultas:N, buscas:N}
  POST /_falso/falhar   {rota:'preferencias'|'pagamentos', vezes:N} → as N próximas respondem 500

A assinatura é feita aqui de novo, pela regra da documentação (sem importar o
servidor): é o outro lado da prova da função pura de pagamento.py.
Nenhuma credencial de verdade: o token e o segredo são os que a prova inventar.
"""
import hashlib
import hmac
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FUSO = timezone(timedelta(hours=-3))
DETALHES = {'approved': 'accredited', 'pending': 'pending_waiting_transfer', 'in_process': 'pending_contingency',
            'authorized': 'pending_capture', 'rejected': 'cc_rejected_other_reason', 'cancelled': 'expired',
            'refunded': 'refunded', 'charged_back': 'settled', 'in_mediation': 'in_process'}


def _agora_iso():
    return datetime.now(FUSO).isoformat(timespec='milliseconds')


def assina_aviso(segredo, data_id, request_id, ts):
    """A regra da documentação de webhooks do Mercado Pago, escrita aqui de novo."""
    partes = []
    if data_id:
        partes.append('id:' + str(data_id).lower())
    if request_id:
        partes.append('request-id:' + request_id)
    partes.append('ts:' + ts)
    texto = ';'.join(partes) + ';'
    return hmac.new(segredo.encode('utf-8'), texto.encode('utf-8'), hashlib.sha256).hexdigest()


class MercadoPagoFalso:

    def __init__(self, token, segredo, porta=0):
        self.token, self.segredo = token, segredo
        self._trava = threading.Lock()
        self.preferencias = []           # os corpos que o servidor mandou
        self.chaves = []                 # os X-Idempotency-Key, na mesma ordem
        self._pref_por_chave = {}
        self.pagamentos = {}             # mp_id (texto) → o pagamento
        self.consultas = 0
        self.buscas = 0
        self.falhas = {'preferencias': 0, 'pagamentos': 0}
        self._proximo = 9100000000 + secrets.randbelow(10 ** 8) * 10
        self.servidor = ThreadingHTTPServer(('127.0.0.1', porta), self._atendente())
        self.servidor.daemon_threads = True
        self.base = 'http://127.0.0.1:%d' % self.servidor.server_address[1]
        self._thread = threading.Thread(target=self.servidor.serve_forever, name='mp-falso', daemon=True)
        self._thread.start()

    # -- o estado, em Python --------------------------------------------------------------
    def _novo_id(self):
        with self._trava:
            self._proximo += 1
            return str(self._proximo)

    def _preferencia_de(self, referencia):
        with self._trava:
            for corpo in self.preferencias:
                if corpo.get('external_reference') == referencia:
                    return corpo
        return None

    def pagar(self, referencia, status='approved', centavos=None, live=True, moeda='BRL'):
        if centavos is None:
            pref = self._preferencia_de(referencia)
            itens = (pref or {}).get('items') or [{}]
            centavos = int(round(float(itens[0].get('unit_price') or 1) * 100))
        mp_id = self._novo_id()
        p = {'id': int(mp_id), 'status': status, 'status_detail': DETALHES.get(status, status),
             'external_reference': referencia, 'transaction_amount': round(centavos / 100, 2), 'currency_id': moeda,
             'live_mode': bool(live), 'date_created': _agora_iso(),
             'date_approved': _agora_iso() if status == 'approved' else None,
             'payer': {'email': 'comprador-de-mentira@exemplo.test'}}     # o servidor não guarda nada disso
        with self._trava:
            self.pagamentos[mp_id] = p
        return mp_id

    def status(self, mp_id, status):
        with self._trava:
            p = self.pagamentos[str(mp_id)]
            p['status'] = status
            p['status_detail'] = DETALHES.get(status, status)
            if status == 'approved' and not p.get('date_approved'):
                p['date_approved'] = _agora_iso()
        return True

    def falhar(self, rota, vezes=1):
        with self._trava:
            self.falhas[rota] = int(vezes)

    def estado(self):
        with self._trava:
            return {'preferencias': json.loads(json.dumps(self.preferencias)), 'consultas': self.consultas,
                    'buscas': self.buscas}

    def avisar(self, mp_id, api, assinatura='boa', request_id=None, tipo='payment'):
        """O aviso do webhook, como o Mercado Pago o manda: (status, corpo da resposta da API)."""
        data_id = str(mp_id)
        rid = request_id or '%s-%s' % (secrets.token_hex(4), secrets.token_hex(6))
        ts = str(int(time.time() * 1000))
        segredo = self.segredo if assinatura == 'boa' else 'nao-e-o-segredo-' + secrets.token_hex(4)
        with self._trava:
            p = self.pagamentos.get(data_id)
        corpo = {'action': 'payment.updated', 'api_version': 'v1', 'data': {'id': data_id},
                 'date_created': _agora_iso(), 'id': secrets.randbelow(10 ** 11), 'live_mode': bool(p and p['live_mode']),
                 'type': tipo, 'user_id': 123456}
        url = api.rstrip('/') + '/api/pagamento/aviso?' + urllib.parse.urlencode({'data.id': data_id, 'type': tipo})
        req = urllib.request.Request(url, data=json.dumps(corpo).encode('utf-8'), method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('x-request-id', rid)
        if assinatura != 'sem':
            req.add_header('x-signature', 'ts=%s,v1=%s' % (ts, assina_aviso(segredo, data_id, rid, ts)))
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8') or '{}')

    def parar(self):
        self.servidor.shutdown()
        self.servidor.server_close()

    # -- o HTTP --------------------------------------------------------------------------
    def _atendente(self):
        falso = self

        class Atendente(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, fmt, *args):
                pass

            def _responde(self, status, obj):
                corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(corpo)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.end_headers()
                self.wfile.write(corpo)

            def _corpo(self):
                n = int(self.headers.get('Content-Length') or 0)
                if n <= 0:
                    return {}
                try:
                    v = json.loads(self.rfile.read(n).decode('utf-8'))
                except ValueError:
                    return {}
                return v if isinstance(v, dict) else {}

            def _autorizado(self):
                return self.headers.get('Authorization', '') == 'Bearer ' + falso.token

            def _falha(self, rota):
                with falso._trava:
                    if falso.falhas.get(rota, 0) > 0:
                        falso.falhas[rota] -= 1
                        return True
                return False

            def do_OPTIONS(self):
                self.send_response(204)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Content-Length', '0')
                self.end_headers()

            def do_GET(self):
                partes = urllib.parse.urlsplit(self.path)
                if partes.path == '/_falso/estado':
                    return self._responde(200, falso.estado())
                if not partes.path.startswith('/v1/payments'):
                    return self._responde(404, {'message': 'not found', 'status': 404})
                if not self._autorizado():
                    return self._responde(401, {'message': 'invalid access token', 'status': 401})
                if self._falha('pagamentos'):
                    return self._responde(500, {'message': 'internal_error', 'status': 500})
                if partes.path == '/v1/payments/search':
                    q = urllib.parse.parse_qs(partes.query)
                    ref = (q.get('external_reference') or [''])[0]
                    with falso._trava:
                        falso.buscas += 1
                        achados = [json.loads(json.dumps(p)) for p in falso.pagamentos.values()
                                   if p['external_reference'] == ref]
                    achados.sort(key=lambda p: p['date_created'], reverse=True)
                    return self._responde(200, {'results': achados, 'paging': {'total': len(achados), 'limit': 20,
                                                                               'offset': 0}})
                mp_id = partes.path[len('/v1/payments/'):]
                with falso._trava:
                    falso.consultas += 1
                    p = falso.pagamentos.get(mp_id)
                    p = json.loads(json.dumps(p)) if p is not None else None
                if p is None:
                    return self._responde(404, {'message': 'Payment not found', 'status': 404})
                return self._responde(200, p)

            def do_POST(self):
                partes = urllib.parse.urlsplit(self.path)
                corpo = self._corpo()
                if partes.path == '/checkout/preferences':
                    if not self._autorizado():
                        return self._responde(401, {'message': 'invalid access token', 'status': 401})
                    if self._falha('preferencias'):
                        return self._responde(500, {'message': 'internal_error', 'status': 500})
                    chave = self.headers.get('X-Idempotency-Key') or ''
                    with falso._trava:
                        if chave and chave in falso._pref_por_chave:
                            return self._responde(201, falso._pref_por_chave[chave])
                        pid = '123456789-%s' % secrets.token_hex(6)
                        resposta = {'id': pid, 'external_reference': corpo.get('external_reference'),
                                    'init_point': 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=' + pid,
                                    'sandbox_init_point':
                                        'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=' + pid}
                        falso.preferencias.append(corpo)
                        falso.chaves.append(chave)
                        if chave:
                            falso._pref_por_chave[chave] = resposta
                    return self._responde(201, resposta)
                if partes.path == '/_falso/pagar':
                    mp_id = falso.pagar(corpo.get('referencia'), corpo.get('status') or 'approved',
                                        corpo.get('centavos'), corpo.get('live', True), corpo.get('moeda') or 'BRL')
                    return self._responde(200, {'mp_id': mp_id})
                if partes.path == '/_falso/status':
                    try:
                        falso.status(corpo.get('mp_id'), corpo.get('status'))
                    except KeyError:
                        return self._responde(404, {'ok': False})
                    return self._responde(200, {'ok': True})
                if partes.path == '/_falso/avisar':
                    status, resposta = falso.avisar(corpo.get('mp_id'), corpo.get('api'),
                                                    corpo.get('assinatura') or 'boa', corpo.get('request_id'),
                                                    corpo.get('tipo') or 'payment')
                    return self._responde(200, {'status': status, 'corpo': resposta})
                if partes.path == '/_falso/falhar':
                    falso.falhar(corpo.get('rota'), corpo.get('vezes') or 1)
                    return self._responde(200, {'ok': True})
                return self._responde(404, {'message': 'not found', 'status': 404})

        return Atendente
