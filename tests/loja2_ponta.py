#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova de PONTA A PONTA da Loja 2 (10/09): os pacotes de vinténs pelo
Mercado Pago (o de mentira, local), o saldo "a caminho", a compra no site com
vintém pago que o jogo ainda não recebeu, o jogo recebendo tudo (pacote,
personagem, bônus de XP de 1, 3 e 7 dias, insígnias, pedras), os presentes do
Mestre, o estorno e o avatar no ranking.

    python tests/loja2_ponta.py [--navegador SCRIPT] [--orcamento MS]

Sobe, tudo descartável:
  · tests/mp_falso.py — o Mercado Pago de mentira — numa porta livre;
  · servidor/api.py numa porta livre, banco numa pasta temporária, com
    SOTERRA_MP_TOKEN e SOTERRA_MP_SEGREDO INVENTADOS AQUI (só no ambiente do
    subprocesso; nada disso é credencial de verdade) e SOTERRA_ENDERECO = a
    própria API; `--mp-api` aponta o falso;
  · o MAESTRO: um HTTP local (CORS *) que guarda a conta do Mestre (criada por
    HTTP, gm = 1 por SQL, como o `admin` faz) e faz, a pedido da página, o que
    ela não pode fazer sozinha: pagar, estornar e avisar no Mercado Pago de
    mentira, dar presente do Mestre, ler a ficha, os alertas e a trilha.
A página tests/loja2_ponta.html abre no Chrome sem cabeça (prioridade baixa,
perfil novo) com `?api=…&maestro=…`, cria a própria conta e usa os módulos de
verdade do jogo (nuvem.js, loja.js, progress.js, db.js e hud.js). Depois, aqui:
as contas no banco (um crédito por pagamento, nenhum para o aviso forjado, o
de valor trocado e o de modo trocado), o log sem o token nem o segredo, e a
cena 7 ("em breve": uma segunda API sem as variáveis).

--navegador SCRIPT: em vez de abrir o Chrome daqui, chama
`python SCRIPT URL SAIDA ORCAMENTO` (um lançador de Chrome em prioridade baixa)
e lê o DOM que ele gravou em SAIDA.

Sai com 0 (tudo passou), 1 (alguma falha) ou 2 (pendência: falta o Mercado
Pago de mentira ou as rotas da Loja 2 no servidor)."""
import html
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import nomes  # noqa: E402  (a lei dos nomes: a conta descartável não pode cair num nome reservado)

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PAGINA = os.path.join(AQUI, 'loja2_ponta.html')
CHROMES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
]
# o dono usa a máquina enquanto a prova roda: a API e o Chrome em prioridade baixa
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + str(extra)[:600]) if (extra and not ok) else ''),
          flush=True)
    return bool(ok)


def limita_nucleos():
    """Este processo (e os filhos, que herdam) em no máximo um quarto dos núcleos, piso de 2."""
    try:
        import ctypes
        n = os.cpu_count() or 2
        k = max(2, n // 4)
        mascara = 0
        for i in range(max(0, n - k), n):
            mascara |= 1 << i
        k32 = ctypes.windll.kernel32
        k32.SetProcessAffinityMask(k32.GetCurrentProcess(), ctypes.c_size_t(mascara))
    except Exception:
        pass


def nome_livre(prefixo):
    """Nome descartável só com letras que nenhuma palavra reservada usa (o molde do loja_viva)."""
    for _ in range(100):
        n = secrets.randbelow(6 ** 9)
        nome = prefixo + ''.join('hjkqxz'[(n // 6 ** i) % 6] for i in range(9))
        if not nomes.reservado(nome):
            return nome
    raise RuntimeError('nenhum nome livre')


def pede_json(url, corpo=None, metodo=None, timeout=20):
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(url, data=dados, method=metodo or ('GET' if corpo is None else 'POST'))
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8') or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or 'null')
        except ValueError:
            return e.code, None


def sobe_api(pasta, rotulo, env_extra=None, mp_api=None):
    """(proc, base, banco, arquivo do log) — a API de verdade num subprocesso."""
    porta = porta_livre()
    base = 'http://127.0.0.1:%d' % porta
    banco = os.path.join(pasta, rotulo, 'soterra.db')
    os.makedirs(os.path.dirname(banco), exist_ok=True)
    log_arq = os.path.join(pasta, rotulo + '.log')
    env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
    env['PYTHONIOENCODING'] = 'utf-8'
    for k, v in (env_extra or {}).items():
        env[k] = v.replace('{BASE}', base)
    args = [sys.executable, API, '--porta', str(porta), '--banco', banco]
    if mp_api:
        args += ['--mp-api', mp_api]
    log = open(log_arq, 'w', encoding='utf-8')
    proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env, creationflags=BAIXA)
    proc._log = log
    return proc, base, banco, log_arq


def derruba(proc):
    if proc is None:
        return
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
    try:
        proc._log.close()
    except Exception:
        pass


def cauda(arq, n=25):
    try:
        return ''.join(open(arq, encoding='utf-8', errors='replace').readlines()[-n:])
    except Exception:
        return '(sem log)'


def sql(banco, consulta, *args):
    b = sqlite3.connect(banco, timeout=10)
    b.row_factory = sqlite3.Row
    try:
        linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
        b.commit()
        return linhas
    finally:
        b.close()


# ---- o maestro ------------------------------------------------------------------------
class Maestro:
    """O Mestre e o Mercado Pago de mentira a serviço da página."""

    def __init__(self, api_base, banco, falso_base):
        self.api, self.banco, self.falso = api_base, banco, falso_base
        self.mestre = Cliente(api_base)
        status, r = self.mestre.cadastra(nome_livre('mq'))
        if status != 201:
            raise RuntimeError('o Mestre não nasceu: %r' % (r,))
        sql(banco, "UPDATE contas SET gm = 1 WHERE id = ?", self.mestre.conta['id'])

    def falso_pede(self, rota, corpo=None):
        return pede_json(self.falso + rota, corpo)

    def age(self, metodo, rota, q, corpo):
        """(status, json) de cada pedido da página."""
        c = corpo or {}
        if rota == '/saude':
            return 200, {'ok': True, 'mestre': self.mestre.conta['id']}
        if rota == '/pagar' and metodo == 'POST':
            linhas = sql(self.banco, "SELECT referencia, centavos FROM pagamentos WHERE id = ?", int(c.get('pagamento') or 0))
            if not linhas or not linhas[0]['referencia']:
                return 404, {'ok': False, 'erro': 'pagamento sem referência no banco'}
            pedido = {'referencia': linhas[0]['referencia'], 'status': c.get('status') or 'approved',
                      'live': c.get('live', True), 'moeda': c.get('moeda') or 'BRL'}
            if c.get('centavos') is not None:
                pedido['centavos'] = c['centavos']
            st, r = self.falso_pede('/_falso/pagar', pedido)
            return 200, {'ok': st == 200 and bool(r and r.get('mp_id')), 'http': st, 'mp_id': (r or {}).get('mp_id'),
                         'referencia': linhas[0]['referencia'], 'corpo': r}
        if rota == '/status' and metodo == 'POST':
            st, r = self.falso_pede('/_falso/status', {'mp_id': c.get('mp_id'), 'status': c.get('status')})
            return 200, {'ok': st == 200, 'http': st, 'corpo': r}
        if rota == '/avisar' and metodo == 'POST':
            pedido = {'mp_id': c.get('mp_id'), 'api': self.api, 'assinatura': c.get('assinatura') or 'boa'}
            vezes = max(1, min(20, int(c.get('vezes') or 1)))
            if vezes == 1:
                st, r = self.falso_pede('/_falso/avisar', pedido)
                r = r or {}
                return 200, {'ok': st == 200, 'http': r.get('status'), 'corpo': r.get('corpo')}
            saidas = [None] * vezes

            def um(i):
                st, r = self.falso_pede('/_falso/avisar', pedido)
                saidas[i] = (r or {}).get('status') if st == 200 else 'falso %s' % st
            fios = [threading.Thread(target=um, args=(i,)) for i in range(vezes)]
            for f in fios:
                f.start()
            for f in fios:
                f.join(30)
            return 200, {'ok': True, 'https': saidas}
        if rota == '/falso':
            st, r = self.falso_pede('/_falso/estado')
            return 200, {'ok': st == 200, 'estado': r}
        if rota == '/presentear' and metodo == 'POST':
            pedido = {'conta': c.get('conta'), 'idem': secrets.token_hex(8)}
            for k in ('sku', 'vintens'):
                if k in c:
                    pedido[k] = c[k]
            st, r = self.mestre.pede('POST', '/api/mestre/presentear', pedido)
            return 200, {'ok': True, 'http': st, 'corpo': r}
        if rota == '/ficha':
            st, r = self.mestre.pede('GET', '/api/mestre/conta?id=%d' % int(q.get('conta') or 0))
            return 200, {'ok': True, 'http': st, 'corpo': r}
        if rota == '/alertas':
            st, r = self.mestre.pede('GET', '/api/mestre/alertas')
            return 200, {'ok': True, 'http': st, 'corpo': r}
        if rota == '/mestre/avatar':
            if metodo == 'POST':
                st, r = self.mestre.pede('POST', '/api/avatar', {'avatar': c.get('avatar')})
            else:
                st, r = self.mestre.pede('GET', '/api/avatar')
            return 200, {'ok': True, 'http': st, 'corpo': r}
        if rota == '/trilha':
            linhas = sql(self.banco, "SELECT tipo, dados, criado_em FROM eventos WHERE conta_id = ? ORDER BY id",
                         int(q.get('conta') or 0))
            for l in linhas:
                try:
                    l['dados'] = json.loads(l['dados']) if l['dados'] else None
                except ValueError:
                    pass
            return 200, {'ok': True, 'eventos': linhas}
        return 404, {'ok': False, 'erro': 'o maestro não conhece ' + rota}


def serve_maestro(maestro):
    class Atende(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _cors(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')

        def _responde(self, status, corpo):
            dados = json.dumps(corpo, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self._cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

        def _age(self, metodo):
            partes = urlsplit(self.path)
            q = {k: v[0] for k, v in parse_qs(partes.query).items()}
            corpo = None
            n = int(self.headers.get('Content-Length') or 0)
            if n:
                try:
                    corpo = json.loads(self.rfile.read(n).decode('utf-8'))
                except ValueError:
                    corpo = None
            try:
                status, r = maestro.age(metodo, partes.path, q, corpo)
            except Exception as e:           # o maestro não derruba a página: ela vê o erro
                status, r = 500, {'ok': False, 'erro': '%s: %s' % (type(e).__name__, e)}
            self._responde(status, r)

        def do_GET(self):
            self._age('GET')

        def do_POST(self):
            self._age('POST')

    srv = ThreadingHTTPServer(('127.0.0.1', porta_livre()), Atende)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]


# ---- o navegador ----------------------------------------------------------------------
def roda_pagina(url, pasta, navegador, orcamento):
    saida = os.path.join(pasta, 'pagina.html')
    if navegador:
        subprocess.run([sys.executable, navegador, url, saida, str(orcamento)], timeout=1800,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=BAIXA)
        return open(saida, encoding='utf-8', errors='replace').read() if os.path.exists(saida) else ''
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        return None
    r = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                        '--user-data-dir=' + os.path.join(pasta, 'perfil'), '--virtual-time-budget=%d' % orcamento,
                        '--allow-file-access-from-files', '--dump-dom', url],
                       capture_output=True, timeout=1800, creationflags=BAIXA)
    return r.stdout.decode('utf-8', 'replace')


# ---- as contas no banco, depois da página ----------------------------------------------
def confere_banco(banco, ids):
    cid = ids.get('conta')
    mp = ids.get('mp') or {}
    cred = sql(banco, "SELECT cr.origem, cr.mp_id, cr.vintens, p.estado FROM loja_creditos cr "
                      "JOIN loja_pedidos p ON p.id = cr.pedido_id WHERE p.conta_id = ? ORDER BY p.id", cid)
    pag = [c for c in cred if c['origem'] == 'pagamento']
    check('banco: três créditos de pacote nesta conta (Arca, Tesouro e a Bolsa estornada), um por pagamento',
          len(pag) == 3 and len({c['mp_id'] for c in pag}) == 3 and
          sorted(c['vintens'] for c in pag) == [1000, 12000, 25000], pag)
    fora = {str(mp.get('errado')), str(mp.get('teste'))}
    check('banco: nenhum crédito para o pagamento de valor trocado nem para o de modo trocado',
          mp.get('errado') and mp.get('teste') and not [c for c in cred if str(c['mp_id']) in fora], (fora, cred))
    check('banco: a Bolsa estornada antes da entrega ficou cancelada; o resto entregue',
          [c['estado'] for c in pag if c['vintens'] == 1000] == ['cancelado'] and
          all(c['estado'] == 'entregue' for c in pag if c['vintens'] != 1000), pag)
    check('banco: um crédito de presente (os 1.000 vinténs do Mestre), entregue',
          [(c['vintens'], c['estado']) for c in cred if c['origem'] == 'presente'] == [(1000, 'entregue')], cred)
    duplos = sql(banco, "SELECT mp_id, COUNT(*) AS n FROM loja_creditos WHERE mp_id IS NOT NULL GROUP BY mp_id HAVING n > 1")
    check('banco: nenhum pagamento do Mercado Pago creditou duas vezes', not duplos, duplos)
    ev = sql(banco, "SELECT tipo FROM eventos WHERE conta_id = ? AND tipo = 'pagamento-credito'", cid)
    check('banco: a trilha tem três pagamento-credito (nem o aviso repetido nem os dez em paralelo somaram)',
          len(ev) == 3, len(ev))
    alertas = sorted({a['tipo'] for a in sql(banco, "SELECT tipo FROM contas_alertas WHERE conta_id = ?", cid)})
    check('banco: alertas de valor-diferente, estorno, contestação e estorno-antes-da-entrega',
          {'valor-diferente', 'estorno', 'contestacao', 'estorno-antes-da-entrega'} <= set(alertas), alertas)


def confere_log(log_arq, segredos):
    texto = open(log_arq, encoding='utf-8', errors='replace').read()
    check('o log da API não tem o token nem a assinatura secreta', not any(s in texto for s in segredos))
    check('o boot diz que o pagamento está ligado no Mercado Pago (produção)',
          re.search(r'pagamento: Mercado Pago \(produção\)', texto) is not None,
          [l for l in texto.splitlines() if 'pagamento' in l][:3])


# ---- a cena 7: "em breve" ----------------------------------------------------------------
def cena_em_breve(pasta):
    proc, base, banco, log_arq = sobe_api(pasta, 'embreve')
    try:
        if not espera_api(base, proc):
            check('cena 7: a API sem as variáveis sobe', False, cauda(log_arq))
            return
        st, cat = pede_json(base + '/api/loja/catalogo')
        check('cena 7: catálogo com pagamento.ligado:false e os 4 pacotes à mostra',
              st == 200 and (cat.get('pagamento') or {}).get('ligado') is False and len(cat.get('pacotes') or []) == 4,
              (st, cat.get('pagamento') if isinstance(cat, dict) else cat))
        c = Cliente(base)
        st, r = c.cadastra(nome_livre('eb'))
        check('cena 7: cadastro', st == 201, r)
        st, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'pacote-1000', 'idem': secrets.token_hex(8)})
        check('cena 7: POST /api/pagamento/pacote → 503 "em breve" com pagamento:false',
              st == 503 and r.get('pagamento') is False and 'em breve' in (r.get('erro') or ''), (st, r))
        st, r = Cliente(base).pede('POST', '/api/pagamento/aviso?data.id=123&type=payment', {'type': 'payment'})
        check('cena 7: POST /api/pagamento/aviso → 503', st == 503, (st, r))
        st, r = c.pede('POST', '/api/pagamento/conferir', {'id': 1})
        check('cena 7: POST /api/pagamento/conferir → 503', st == 503, (st, r))
        st, r = c.pede('GET', '/api/pagamento/meus')
        check('cena 7: GET /api/pagamento/meus → 200 ligado:false', st == 200 and r.get('ligado') is False and
              r.get('pagamentos') == [], (st, r))
        # a loja de vinténs do jogo funcionando igual: o save sobe com a carteira, o site compra, o jogo entrega
        progress = {'version': 22, 'unlockedClasses': ['sumo', 'curandeiro'], 'cards': {}, 'inventory': [],
                    'heroes': {'sumo': {'classId': 'sumo', 'xp': 10, 'level': 1}}}
        db = {'versao': 1, 'jogador': {'nome': None}, 'carteira': {'moedas': 2000}, 'banco': {'moedas': 0, 'itens': []},
              'mercado': None}
        st, r = c.salva(0, progress, db)
        check('cena 7: o 1º save sobe com 2.000 vinténs', st == 200, (st, r))
        st, r = c.pede('POST', '/api/loja/comprar', {'sku': 'pedras-agua', 'idem': secrets.token_hex(8)})
        ok = st == 201 and r['saldo']['disponivel'] == 1500 and r['saldo'].get('aCaminho') == 0
        check('cena 7: comprar 10 Lágrimas (500) com a carteira do save → 201, disponível 1.500, a caminho 0', ok, (st, r))
        pid = (r.get('pedido') or {}).get('id')
        st, r = c.pede('POST', '/api/loja/retirar', {})
        ent = [p for p in r.get('pedidos', []) if p['id'] == pid]
        check('cena 7: o jogo retira a entrega das pedras (sem origem, sem agora)',
              st == 200 and ent and ent[0]['entrega'] == {'tipo': 'pedras', 'alvo': 'stone-tear', 'qtd': 10} and
              'origem' not in ent[0], r)
        db['carteira']['moedas'] = 1500
        db['loja'] = {'aplicadas': [pid], 'recusadas': []}
        st, r = c.salva(1, progress, db)
        st2, m = c.pede('GET', '/api/loja/minha')
        estado = [p['estado'] for p in m.get('pedidos', []) if p['id'] == pid]
        check('cena 7: o PUT do save fecha entregue; carteira 1.500', st == 200 and estado == ['entregue'] and
              m['saldo']['carteira'] == 1500, (st, estado, m.get('saldo')))
        texto = open(log_arq, encoding='utf-8', errors='replace').read()
        check('cena 7: o boot loga pagamento DESLIGADO', 'pagamento: DESLIGADO' in texto,
              [l for l in texto.splitlines() if 'pagamento' in l][:3])
    finally:
        derruba(proc)


# ---- tudo -------------------------------------------------------------------------------
def main():
    navegador, orcamento = None, 240000
    args = sys.argv[1:]
    if '--navegador' in args:
        navegador = os.path.abspath(args[args.index('--navegador') + 1])
    if '--orcamento' in args:
        orcamento = int(args[args.index('--orcamento') + 1])
    limita_nucleos()
    try:
        from mp_falso import MercadoPagoFalso
    except ImportError as e:
        print('PENDENTE: falta tests/mp_falso.py (o Mercado Pago de mentira da frente SERVIDOR):', e)
        return 2
    # inventados aqui, só para esta corrida (vão só para o ambiente do subprocesso)
    token = 'TEST-%d-%s' % (secrets.randbelow(10 ** 12), secrets.token_hex(16))
    segredo = secrets.token_hex(24)
    pasta = tempfile.mkdtemp(prefix='soterra-loja2-')
    falso = proc = srv = None
    try:
        falso = MercadoPagoFalso(token, segredo)
        proc, base, banco, log_arq = sobe_api(
            pasta, 'ligada', {'SOTERRA_MP_TOKEN': token, 'SOTERRA_MP_SEGREDO': segredo, 'SOTERRA_ENDERECO': '{BASE}'},
            mp_api=falso.base)
        if not espera_api(base, proc):
            print('a API não subiu:\n' + cauda(log_arq))
            return 1
        st, cat = pede_json(base + '/api/loja/catalogo')
        if isinstance(cat, dict) and cat.get('versao') == 3:
            # 13/09: a loja virou BARRAS DE OURO (catálogo v3): o pacote de vinténs saiu da venda e o roteiro
            # desta página (pacote de vinténs → compra em vinténs) não existe mais. As barras de ponta a ponta
            # (pacote, estorno, juiz, trocas, Mestre) estão em tests/barras_api.py; esta página espera o roteiro novo
            print('PENDENTE: o catálogo é o v3 (barras de ouro, 13/09); o roteiro de vinténs desta prova saiu da '
                  'venda — as barras de ponta a ponta estão em tests/barras_api.py')
            return 2
        if st != 200 or not isinstance(cat, dict) or cat.get('versao') != 2 or 'pagamento' not in cat:
            print('PENDENTE: o servidor ainda não tem o catálogo v2 da Loja 2 (versao=%r)' %
                  (cat.get('versao') if isinstance(cat, dict) else None))
            return 2
        maestro = Maestro(base, banco, falso.base)
        srv, maestro_base = serve_maestro(maestro)
        url = 'file:///' + PAGINA.replace('\\', '/') + '?api=%s&maestro=%s' % (base, maestro_base)
        print('página:', url, flush=True)
        t0 = time.time()
        dom = roda_pagina(url, pasta, navegador, orcamento)
        if dom is None:
            print('sem Chrome/Edge para a prova sem cabeça')
            return 2
        linhas = re.findall(r'<div class="linha[^"]*"[^>]*>((?:PASSOU|FALHOU) · [^<]*)</div>', dom)
        for l in linhas:
            print(html.unescape(l))
        resumo = re.search(r'id="summary"[^>]*>([^<]*)<', dom)
        pagina_ok = bool(resumo) and 'tudo passou' in resumo.group(1)
        print('PÁGINA (%.0f s): %s' % (time.time() - t0, html.unescape(resumo.group(1)) if resumo else
                                         '(sem resumo — a página não terminou)'), flush=True)
        m = re.search(r'<pre id="ids"[^>]*>([^<]*)</pre>', dom)
        ids = {}
        try:
            ids = json.loads(html.unescape(m.group(1))) if m else {}
        except ValueError:
            ids = {}
        if ids.get('conta'):
            confere_banco(banco, ids)
        else:
            check('a página devolveu os ids da corrida', False, 'sem <pre id="ids">')
        derruba(proc)
        proc = None
        confere_log(log_arq, (token, segredo))
        cena_em_breve(pasta)
        falhas = RESULTADOS.count(False)
        print('RESUMO: página %s; aqui %d de %d' % ('ok' if pagina_ok else 'COM FALHA', len(RESULTADOS) - falhas,
                                                     len(RESULTADOS)))
        return 0 if (pagina_ok and not falhas) else 1
    finally:
        derruba(proc)
        if srv is not None:
            srv.shutdown()
        if falso is not None:
            try:
                falso.parar()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
