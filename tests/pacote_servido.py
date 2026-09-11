#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O pacote que vai para o servidor abre o jogo SOZINHO — e quanto ele baixa?

    python tests/pacote_servido.py              # o pacote do que está no disco (o próximo commit)
    python tests/pacote_servido.py --head       # o pacote do último commit, igual ao do sobe_vps
    python tests/pacote_servido.py --antes REF  # mede também a 1ª visita do pacote de REF

Monta o pacote como tools/sobe_vps.py (a mesma lista FORA, que o .dockerignore
repete), descompacta numa pasta temporária, roda nele servidor/coolify/versao.py
(o passo do build do contêiner e do instala.sh), serve com http.server numa
porta livre e abre o jogo no Chrome headless, em prioridade baixa, por uma
SONDA: uma página fora do pacote que põe o index.html num quadro e, quando o
menu aparece e os modelos ficam prontos, anota o que o jogo carregou. Cobra:
  - o pacote não leva tests/, tools/, docs/ nem os embutidos que o jogo
    servido não carrega, e o instala.sh vai com fim de linha LF;
  - nenhum arquivo pedido pela página falta (nenhum 404);
  - o menu do jogo aparece (o botão Descer), com as tabelas do cenário da
    Estufa e da Cisterna, e os modelos do cenário e das coroas vindos do bundle;
  - cada script desce com o hash do build (?v=) e cada modelo com o do
    manifesto (?h=);
  - os BYTES da primeira visita, e quanto caiu contra o jeito antigo (os
    cenario-*.js e o coroas-pvp-3d.js inteiros, que não descem mais);
  - a lista de carga do index.html não cita nada fora do pacote;
  - a landing do site abre, e pede a folha e os scripts com o hash do build.
Precisa do Chrome instalado (o mesmo das outras provas headless).
As peças daqui (prepara, servidor, visita, contas) servem tests/carga_prova.py.
"""
import argparse
import ast
import functools
import hashlib
import html
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.dont_write_bytecode = True        # nada de tools/__pycache__ no repositório
import sobe_vps  # noqa: E402

CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium']
# o dono usa a máquina enquanto a prova roda: o Chrome vai em prioridade baixa
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
MB = 1024.0 * 1024.0
MANIFESTO = 'assets/models/bundle/manifest.json'
# a regra do index.html ANTES desta rodada (commit df1f8dc): o que o caminho
# servido deixava de ler. Todo o resto descia — os cenario-*.js inteiros inclusive.
ANTIGO = re.compile(r'^assets/embedded/(env-kit|models-|muro-)')
RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def resumo():
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if falhas else 0


def ler(rel, raiz=RAIZ):
    with open(os.path.join(raiz, *rel.split('/')), 'rb') as f:
        return f.read().decode('utf-8', 'surrogateescape')


def tamanho(rel, raiz=RAIZ):
    fis = os.path.join(raiz, *rel.split('/'))
    return os.path.getsize(fis) if os.path.isfile(fis) else 0


def impressao(bruto):
    return hashlib.sha256(bruto).hexdigest()[:12]


def acha_chrome():
    return next((c for c in CHROMES if os.path.exists(c)), None)


# ------------------------------------------------------------- o index.html
def lista_do_index(texto):
    """A lista de carga do index.html (var arquivos = [...]), na ordem."""
    m = re.search(r'var arquivos = \[(.*?)\];', texto, re.S)
    if not m:
        return []
    return re.findall(r"'([^']+)'", re.sub(r'//[^\n]*', '', m.group(1)))


def _regex_js(texto, nome):
    m = re.search(r'var %s = /(.+?)/;' % nome, texto)
    return re.compile(m.group(1).replace('\\/', '/')) if m else None


def lista_servida(texto):
    """O que o caminho SERVIDO do index.html pede, pelas regras escritas nele
    (SO_MODELO sai, COM_TABELA vira a tabela). None se as regras sumirem."""
    so_modelo, com_tabela = _regex_js(texto, 'SO_MODELO'), _regex_js(texto, 'COM_TABELA')
    m = re.search(r"var TABELAS = '([^']+)';", texto)
    if not (so_modelo and com_tabela and m):
        return None
    saida = []
    for f in lista_do_index(texto):
        t = com_tabela.match(f)
        if t:
            saida.append(m.group(1) + t.group(1))
        elif not so_modelo.match(f):
            saida.append(f)
    return saida


def queda_contra_antigo(texto, raiz=RAIZ):
    """Quanto o jeito antigo baixava a mais na 1ª visita: os embutidos que ele
    lia inteiros e que a regra de agora troca pela tabela ou deixa para o
    bundle (tamanhos do repositório, onde os inteiros ainda moram)."""
    lista = lista_do_index(texto)
    antiga = [f for f in lista if not ANTIGO.match(f)]
    nova = lista_servida(texto) or []
    saiu = [f for f in antiga if f not in nova]
    entrou = [f for f in nova if f not in antiga]
    return sum(tamanho(f, raiz) for f in saiu) - sum(tamanho(f) for f in entrou), saiu


# ------------------------------------------------------------------ o pacote
def fora_de(ref):
    """A lista FORA do tools/sobe_vps.py de REF: o pacote de REF, com as regras de REF."""
    r = sobe_vps.git('show', ref + ':tools/sobe_vps.py')
    m = re.search(r'^FORA = (\[.*?\])', r.stdout, re.S | re.M) if r.returncode == 0 else None
    return ast.literal_eval(m.group(1)) if m else list(sobe_vps.FORA)


def por_cima(raiz, specs):
    """--por-cima CAMINHO=ARQUIVO (11/09): troca arquivos do pacote ja montado e roda
    o versao.py de novo, como o build faria. Devolve (ok, saida do versao.py)."""
    if not specs:
        return True, ''
    for spec in specs:
        caminho, _, origem = spec.partition('=')
        shutil.copyfile(origem, os.path.join(raiz, *caminho.split('/')))
        print('  por cima: %s <- %s' % (caminho, origem))
    r = subprocess.run([sys.executable, os.path.join(raiz, 'servidor', 'coolify', 'versao.py'), raiz],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def prepara(pasta, ref=None, arvore=True, nome='www'):
    """Monta o pacote (do disco, do último commit ou de REF), descompacta em
    pasta/<nome> e roda nele o versao.py do próprio pacote, como o build faz.
    Devolve (raiz, nomes no tar, caminho do pacote, saída do versao.py)."""
    pacote = os.path.join(pasta, nome + '.tar.gz')
    if ref:
        specs = ['.'] + [':(exclude)' + p for p in fora_de(ref)]
        r = sobe_vps.git('archive', '--format=tar.gz', '-o', pacote, ref, '--', *specs)
        if r.returncode != 0:
            raise SystemExit('o git archive de %s falhou: %s' % (ref, r.stderr.strip()))
    else:
        sobe_vps.monta(pacote, arvore=arvore)
    raiz = os.path.join(pasta, nome)
    os.makedirs(raiz)
    with tarfile.open(pacote) as tf:
        nomes = tf.getnames()
        tf.extractall(raiz, filter='data')
    saida = ''
    versao = os.path.join(raiz, 'servidor', 'coolify', 'versao.py')
    if os.path.isfile(versao):
        r = subprocess.run([sys.executable, versao, raiz], capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        saida = (r.stdout + r.stderr).strip()
        if r.returncode != 0:
            raise SystemExit('o versao.py falhou no pacote: ' + saida)
    return raiz, nomes, pacote, saida


# ----------------------------------------------------------------- o servidor
# A SONDA mora fora do pacote: põe o jogo num quadro e, quando o menu aparece
# e os modelos ficam prontos, escreve no próprio DOM o que o jogo carregou.
SONDA = r'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>sonda do jogo servido</title></head>
<body style="margin:0;background:#000">
<div id="summary">rodando</div>
<pre id="sonda"></pre>
<iframe id="jogo" src="/index.html" style="width:1280px;height:800px;border:0"></iframe>
<script>
(function () {
  var m = /[?&]limite=(\d+)/.exec(location.search);
  var LIMITE = m ? +m[1] : 85000, t0 = Date.now();
  // CARGA SOB DEMANDA: no menu desce so a base; a sonda anota esse instante
  // (`menu`) e pede o resto (JOGO.Bundle.tudo) antes de conferir o bundle inteiro
  var noMenu = null, tudoPedido = false, tudoFeito = false, tudoFalhas = null;
  function bilhete(v) {
    try { return typeof v === 'string' && v.length < 40 && atob(v).indexOf('SOTERRA-GLB:') === 0; }
    catch (e) { return false; }
  }
  function olha() {
    var info = null, pronto = false;
    try {
      var f = document.getElementById('jogo'), w = f.contentWindow, d = f.contentDocument;
      var descer = false;
      if (d && d.body) {
        var els = d.querySelectorAll('button, [role=button], a, div, span');
        for (var i = 0; i < els.length && !descer; i++) {
          if ((els[i].textContent || '').replace(/\s+/g, ' ').trim() === 'Descer') descer = true;
        }
      }
      var J = (w && w.JOGO) || {}, M = J.MODELS || {};
      var prontos = !!(J.Models3D2 && J.Models3D2.isReady && J.Models3D2.isReady() &&
                       J.Models3D && J.Models3D.isReady && J.Models3D.isReady());
      var cen = 0, cenB = 0, cor = 0, corB = 0, k;
      for (k in M) {
        if (/^(jd|cs)_/.test(k)) { cen++; if (bilhete(M[k])) cenB++; }
        if (/^coroa_pvp_/.test(k)) { cor++; if (bilhete(M[k])) corB++; }
      }
      info = {
        descer: descer, modelos_prontos: prontos,
        boot_ms: w ? w.__BOOT_MS : undefined,
        cenario: Object.keys(J.CENARIO || {}).sort(),
        cenario_nomes: Object.keys(J.CENARIO_NOME || {}).length,
        modelos: Object.keys(M).length,
        modelos_cenario: cen, modelos_cenario_do_bundle: cenB,
        coroas: cor, coroas_do_bundle: corB,
        bundle: J.Bundle && J.Bundle.info ? J.Bundle.info() : null,
        fora_do_pacote: w ? (w.__FORA_DO_PACOTE || null) : null,
        versao: (w && w.SOTERRA_VERSAO) ? w.SOTERRA_VERSAO.versao : null,
        falhou: !!(J.Models3D2 && J.Models3D2.failed && J.Models3D2.failed())
      };
      pronto = descer && prontos && w.__BOOT_MS !== undefined;
      if (pronto && !noMenu) {
        noMenu = { ms: Date.now() - t0, modelos: info.modelos,
                   bundle: info.bundle ? JSON.parse(JSON.stringify(info.bundle)) : null,
                   sob_demanda: !!(J.Bundle && J.Bundle.sobDemanda && J.Bundle.sobDemanda()) };
      }
      if (pronto && J.Bundle && J.Bundle.tudo && noMenu.sob_demanda) {
        if (!tudoPedido) {
          tudoPedido = true;
          J.Bundle.tudo(function (falhas) { tudoFeito = true; tudoFalhas = (falhas || []).length; });
        }
        pronto = tudoFeito;
      }
      info.menu = noMenu;
      info.tudo_falhas = tudoFalhas;
    } catch (e) { info = { erro: String((e && e.message) || e) }; }
    if (pronto || Date.now() - t0 > LIMITE) {
      document.getElementById('sonda').textContent = JSON.stringify(info);
      document.getElementById('summary').textContent = pronto ? 'PRONTO' : 'NAO CHEGOU';
      // 11/09: o jogo sai do quadro depois do resultado (como no tests/sob_demanda.py).
      // No tempo virtual o orçamento anda POR QUADRO desenhado: com a cena de pé em
      // GL por software (1280x800) os 90 s virtuais viravam meia hora de relógio.
      // Sem nada para desenhar, o resto do orçamento passa na hora e o Chrome sai
      // do jeito normal (fecha o cache em disco — a carga_prova reusa o perfil).
      var fj = document.getElementById('jogo');
      if (fj && fj.parentNode) fj.parentNode.removeChild(fj);
      return;
    }
    setTimeout(olha, 500);
  }
  setTimeout(olha, 500);
})();
</script>
</body></html>
'''


class Registro(object):
    """Cada pedido que chegou ao servidor: fase, caminho, query, código e bytes do corpo."""

    def __init__(self):
        self.fase = ''
        self.pedidos = []

    def da_fase(self, fase):
        return [p for p in self.pedidos if p['fase'] == fase]


class _Servidor(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass                  # o Chrome cancela pedidos no meio: não é erro da prova


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def servidor(raiz, registro, cache=None):
    """http.server na pasta `raiz`. `cache(caminho_com_query)` devolve o
    Cache-Control a mandar (a imitação do Caddyfile, em tests/carga_prova.py);
    sem ele, nenhum — como o http.server de sempre. A sonda é /__sonda.html."""

    class Atendente(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.split('?')[0] == '/__sonda.html':
                corpo = SONDA.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(corpo)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(corpo)
                return
            return http.server.SimpleHTTPRequestHandler.do_GET(self)

        def end_headers(self):
            if cache and not self.path.startswith('/__'):
                cc = cache(self.path)
                if cc:
                    self.send_header('Cache-Control', cc)
            http.server.SimpleHTTPRequestHandler.end_headers(self)

        def log_request(self, code='-', size='-'):
            caminho, _, query = self.path.partition('?')
            self._reg = {'fase': registro.fase, 'caminho': caminho, 'query': query,
                         'codigo': str(getattr(code, 'value', code)), 'bytes': 0}
            registro.pedidos.append(self._reg)

        def copyfile(self, source, outputfile):
            n = 0
            while True:
                bloco = source.read(256 * 1024)
                if not bloco:
                    break
                outputfile.write(bloco)
                n += len(bloco)
            if getattr(self, '_reg', None) is not None:
                self._reg['bytes'] += n

        def log_message(self, *a):
            pass

    porta = porta_livre()
    srv = _Servidor(('127.0.0.1', porta), functools.partial(Atendente, directory=raiz))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/' % porta


def _chrome(chrome, perfil, url, budget, relogio=1800):
    """O DOM do --dump-dom. A saida e lida por uma linha a parte (11/09): o
    Chrome escreve o DOM e fecha a pagina, mas as vezes um processo filho fica
    vivo segurando o stdout e o EOF nunca vem — o subprocess.run(capture_output)
    esperava o relogio inteiro (30 min). DOM completo e 20 s sem sair: derruba a
    arvore (taskkill /T) e devolve o que ja veio."""
    p = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                          '--no-default-browser-check', '--window-size=1400,900',
                          '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget,
                          '--dump-dom', url], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         creationflags=BAIXA)
    buf = []

    def le():
        for bloco in iter(lambda: p.stdout.read1(65536), b''):   # read1: o que ja chegou (read(n) esperava n bytes ou o EOF)
            buf.append(bloco)
    leitor = threading.Thread(target=le, daemon=True)
    leitor.start()
    t0, t_dump = time.time(), None
    while leitor.is_alive() and time.time() - t0 < relogio:
        leitor.join(timeout=2)
        if t_dump is None and b'</html>' in b''.join(buf[-3:])[-8000:]:
            t_dump = time.time()
        if t_dump is not None and time.time() - t_dump > 20:
            break
    if leitor.is_alive():
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
        else:
            p.kill()
        leitor.join(30)
    try:
        p.wait(timeout=30)
    except Exception:
        pass
    return b''.join(buf).decode('utf-8', 'replace')


def dom(chrome, perfil, url, budget):
    return _chrome(chrome, perfil, url, budget)


def visita(chrome, perfil, base, budget=90000):
    """Abre a sonda (o index.html num quadro) e devolve o que ela anotou."""
    dump = _chrome(chrome, perfil, base + '__sonda.html?limite=%d' % max(5000, budget - 5000), budget)
    m = re.search(r'<pre id="sonda">(.*?)</pre>', dump, re.S)
    if not m or not m.group(1).strip():
        return {'erro': 'a sonda não escreveu nada (DOM de %d bytes)' % len(dump)}
    try:
        info = json.loads(html.unescape(m.group(1)))
    except ValueError:
        return {'erro': 'sonda ilegível: ' + m.group(1)[:200]}
    return info if isinstance(info, dict) else {'erro': 'sonda vazia'}


def contas(pedidos):
    """Os bytes que desceram (corpos de resposta 200), por tipo."""
    t = {'total': 0, 'js': 0, 'modelos': 0, 'outros': 0, 'n200': 0, 'n304': 0, 'pedidos': 0}
    for p in pedidos:
        if p['caminho'].startswith('/__'):
            continue
        t['pedidos'] += 1
        if p['codigo'] == '304':
            t['n304'] += 1
        if p['codigo'] != '200':
            continue
        t['n200'] += 1
        n, c = p['bytes'], p['caminho']
        t['total'] += n
        if c.startswith('/assets/models/bundle/') and not c.endswith(('.json', '.js')):
            t['modelos'] += n
        elif c.endswith('.js'):
            t['js'] += n
        else:
            t['outros'] += n
    return t


def mapa_do_build(raiz):
    """O mapa {caminho: hash} que o versao.py gravou em js/versao.js (vazio no 'dev')."""
    txt = ler('js/versao.js', raiz)
    i = txt.find('SOTERRA_VERSAO = ')
    try:
        dados = json.loads(txt[i + len('SOTERRA_VERSAO = '):txt.rindex(';')])
    except ValueError:
        return {}
    return dados.get('arquivos') or {}


def _query(q):
    return dict(p.split('=', 1) for p in q.split('&') if '=' in p)


def enderecos_marcados(pedidos, raiz):
    """(scripts sem o hash do build, modelos sem o hash do manifesto)."""
    mapa = mapa_do_build(raiz)
    man = json.loads(ler(MANIFESTO, raiz))
    hash_modelo = {'/' + man['base'] + it['arquivo']: it.get('hash') for it in man['itens']}
    sem_v, sem_h = [], []
    for p in pedidos:
        c, q = p['caminho'], _query(p['query'])
        if c.startswith('/__') or p['codigo'] not in ('200', '304'):
            continue
        if c in hash_modelo:
            if not hash_modelo[c] or q.get('h') != hash_modelo[c]:
                sem_h.append(c + '?' + p['query'])
        elif c.endswith(('.js', '.css')) and c != '/js/versao.js':
            if q.get('v') != mapa.get(c[1:]):
                sem_v.append(c + '?' + p['query'])
    return sem_v, sem_h


# ------------------------------------------------------------------- a prova
def main():
    ap = argparse.ArgumentParser(description='o pacote servido abre o jogo, e quanto baixa')
    ap.add_argument('--head', action='store_true', help='o pacote do último commit (não o do disco)')
    ap.add_argument('--antes', metavar='REF', help='mede também a 1ª visita do pacote de REF (ex.: df1f8dc)')
    ap.add_argument('--budget', type=int, default=90000, help='tempo virtual do Chrome em ms')
    ap.add_argument('--por-cima', action='append', default=[], metavar='CAMINHO=ARQUIVO',
                    help='troca um arquivo do pacote antes do build (com --head: o commit mais SO '
                         'uma mudanca, sem as edicoes em andamento de outras rodadas); repetivel')
    a = ap.parse_args()
    chrome = acha_chrome()
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2
    pasta = tempfile.mkdtemp(prefix='soterra-pacote-')
    try:
        raiz, nomes, pacote, sv = prepara(pasta, arvore=not a.head)
        if sv:
            print('  ' + sv)
        okc, svc = por_cima(raiz, a.por_cima)
        if a.por_cima:
            print('  ' + svc[:300])
            if not okc:
                return 1
        topo = sorted({n.split('/')[0] for n in nomes})
        check('o pacote não leva tests/, tools/, docs/', not ({'tests', 'tools', 'docs', '.claude'} & set(topo)), ' '.join(topo))
        embutidos = [n for n in nomes if re.match(r'^assets/embedded/(models-|env-kit|muro-|cenario-|coroas-pvp-3d)', n)]
        check('nem os embutidos que o jogo servido não carrega (os cenario-*.js inteiros inclusive)',
              not embutidos, ', '.join(embutidos[:3]))
        man = json.loads(ler(MANIFESTO, raiz))
        tabelas = ['assets/models/bundle/' + t for t in sorted((man.get('tabelas') or {}).values())]
        check('leva as tabelas do cenário (assets/models/bundle/tabelas/) no lugar deles',
              len(tabelas) >= 2 and all(t in nomes for t in tabelas), ', '.join(tabelas))
        check('leva o servidor (api, relé, instala.sh, services, Caddyfile, versao.py) e o site',
              all(n in nomes for n in ['servidor/api.py', 'servidor/rele.py', 'servidor/instala.sh',
                                       'servidor/soterra-api.service', 'servidor/soterra-rele.service',
                                       'servidor/Caddyfile', 'servidor/coolify/versao.py',
                                       'site/index.html', 'site/conta.html', 'site/ranking.html']))
        for n in ['servidor/instala.sh', 'servidor/Caddyfile', 'servidor/soterra-api.service']:
            cr = open(os.path.join(raiz, n), 'rb').read().count(b'\r')
            check('%s com fim de linha Linux (LF)' % n, cr == 0, '%d CR' % cr)
        check('o pacote pesa menos de 300 MB', os.path.getsize(pacote) < 300 * MB,
              '%.0f MB' % (os.path.getsize(pacote) / MB))
        mapa = mapa_do_build(raiz)
        check('o versao.py do build gravou o hash de cada arquivo (js/versao.js)', len(mapa) > 50,
              '%d arquivos no mapa' % len(mapa))

        registro = Registro()
        srv, base = servidor(raiz, registro)
        try:
            registro.fase = 'jogo'
            info = visita(chrome, os.path.join(pasta, 'perfil1'), base, a.budget)
            registro.fase = 'site'
            site = dom(chrome, os.path.join(pasta, 'perfil2'), base + 'site/index.html', 5000)
        finally:
            srv.shutdown()
        jogo = registro.da_fase('jogo')
        check('o jogo servido do pacote chega ao menu (botão Descer), com os modelos prontos',
              info.get('descer') and info.get('modelos_prontos'),
              'boot %s ms' % info.get('boot_ms') if info.get('descer') else json.dumps(info)[:400])
        check('a landing do site abre', 'SOTERRA' in site and 'conta.html' in site)
        # a landing lê o mesmo mapa do jogo: a folha e cada script com o hash do
        # conteúdo (o que não mudou fica no cache entre deploys), e nunca mais o
        # carimbo do instante, que baixava tudo a cada visita
        da_landing = registro.da_fase('site')
        sem_v_site = enderecos_marcados(da_landing, raiz)[0]
        pediu_site = {p['caminho'] for p in da_landing if p['codigo'] in ('200', '304')}
        check('a landing pede a folha e os scripts com o hash do build (?v=), sem o carimbo do instante',
              {'/site/site.css', '/site/site.js', '/js/versao.js'} <= pediu_site and not sem_v_site,
              ', '.join(sem_v_site[:4]) or 'pediu: ' + ', '.join(sorted(pediu_site))[:200])
        check('as tabelas do cenário chegaram (JOGO.CENARIO da Estufa e da Cisterna, com os nomes)',
              {'garden', 'cistern'} <= set(info.get('cenario') or []) and (info.get('cenario_nomes') or 0) >= 30,
              '%s, %s nomes' % (info.get('cenario'), info.get('cenario_nomes')))
        check('os modelos do cenário e das coroas vieram do bundle, não do base64 dos .js',
              (info.get('modelos_cenario') or 0) >= 30 and info.get('modelos_cenario') == info.get('modelos_cenario_do_bundle')
              and (info.get('coroas') or 0) >= 10 and info.get('coroas') == info.get('coroas_do_bundle'),
              'cenário %s/%s, coroas %s/%s' % (info.get('modelos_cenario_do_bundle'), info.get('modelos_cenario'),
                                               info.get('coroas_do_bundle'), info.get('coroas')))
        b = info.get('bundle') or {}
        check('o bundle desceu inteiro, sem erro, e a ponte trocou todos os bilhetes',
              b.get('itens') == len(man['itens']) and not b.get('erros') and b.get('trocas') == b.get('itens')
              and not info.get('falhou'),
              'itens %s, trocas %s, erros %s' % (b.get('itens'), b.get('trocas'), (b.get('erros') or [])[:2]))
        # com o mapa do build, o index.html PULA o que não está no pacote: um
        # 404 a menos, mas o jogo subiria sem o módulo, calado (sem o nuvem.js,
        # sem save na nuvem). Tem de ser zero — e o versao.py já para o build.
        # CARGA SOB DEMANDA: até o menu desce só o grupo `base` do manifesto
        menu = info.get('menu') or {}
        base_man = ((man.get('grupos') or {}).get('base') or {}).get('bytes', 0)
        bm = (menu.get('bundle') or {}).get('bytes', 0)
        check('sob demanda: até o menu desceu só a base do manifesto (o resto na hora de descer)',
              menu.get('sob_demanda') and base_man and abs(bm - base_man) < 0.02 * base_man
              and bm < 0.5 * man.get('totalBytes', 1),
              'até o menu %.1f MB de modelos, base %.1f MB, todos %.1f MB'
              % (bm / MB, base_man / MB, man.get('totalBytes', 0) / MB))
        fora = info.get('fora_do_pacote')
        check('a lista do index.html não cita nada fora do pacote (o jogo não sobe sem um módulo, calado)',
              isinstance(fora, list) and not fora, ', '.join(fora) if isinstance(fora, list) else 'a sonda não leu: %r' % (fora,))

        # as molduras da landing esperam fotos em site/img/ (arte a fazer): o
        # onerror liga o fallback com a inicial — pedido que falta por desenho
        pedidos = registro.pedidos
        molduras = sorted({p['caminho'] for p in pedidos if p['codigo'] == '404' and p['caminho'].startswith('/site/img/')})
        if molduras:
            print('  (a landing tem %d molduras esperando foto em site/img/: fallback com a inicial)' % len(molduras))
        faltas = sorted({p['caminho'] for p in pedidos if p['codigo'] == '404'
                         and not p['caminho'].startswith(('/api/', '/ws', '/site/img/'))
                         and p['caminho'] != '/favicon.ico'})
        check('nenhum arquivo pedido pela página falta (0 × 404)', not faltas, ', '.join(faltas[:6]))
        bundle = [p for p in jogo if p['caminho'].startswith('/assets/models/bundle/') and p['codigo'] == '200']
        check('os modelos vieram do bundle (o caminho servido)', len(bundle) > 20, '%d arquivos do bundle' % len(bundle))
        inteiros = sorted({p['caminho'] for p in jogo if re.match(r'^/assets/embedded/(models-|env-kit|muro-|cenario-|coroas-pvp-3d)', p['caminho'])})
        check('o jogo servido não pediu embutido inteiro nenhum cujos modelos o bundle já traz',
              not inteiros, ', '.join(inteiros[:4]))
        pediu_tab = {p['caminho'][1:] for p in jogo if p['caminho'].startswith('/assets/models/bundle/tabelas/') and p['codigo'] == '200'}
        check('pediu as tabelas do cenário no lugar deles', set(tabelas) <= pediu_tab, ', '.join(sorted(pediu_tab)))
        sem_v, sem_h = enderecos_marcados(jogo, raiz)
        check('cada script desceu com o hash do build (?v=) — o que não muda fica no cache entre deploys',
              not sem_v, ', '.join(sem_v[:4]))
        check('cada modelo desceu com o hash do conteúdo (?h=) que o manifesto promete', not sem_h, ', '.join(sem_h[:4]))

        # ---- os bytes da primeira visita
        c = contas(jogo)
        idx = ler('index.html', raiz)
        queda, saiu = queda_contra_antigo(idx)
        print('  primeira visita: %.1f MB em %d arquivos (JS %.1f MB · modelos %.1f MB · resto %.1f MB)'
              % (c['total'] / MB, c['n200'], c['js'] / MB, c['modelos'] / MB, c['outros'] / MB))
        print('  o jeito antigo baixaria %.1f MB — os inteiros que não descem mais: %s'
              % ((c['total'] + queda) / MB, ', '.join(f.split('/')[-1] for f in saiu)))
        check('a primeira visita caiu uns 27 MB (ou mais) contra o jeito antigo de carregar',
              queda >= 25 * MB, '%.1f MB a menos (%.0f%%)' % (queda / MB, 100.0 * queda / max(1, c['total'] + queda)))
        servida = lista_servida(idx) or []
        esperado = (sum(tamanho(f, raiz) for f in servida) + man.get('totalBytes', 0) + tamanho(MANIFESTO, raiz)
                    + sum(tamanho(f, raiz) for f in ('index.html', 'css/style.css', 'js/versao.js', 'js/assets_bundle.js')))
        check('e a 1ª visita pesa o que a lista promete (scripts + bundle), sem nada em dobro',
              c['total'] <= esperado + 2 * MB, 'medido %.1f MB, lista %.1f MB' % (c['total'] / MB, esperado / MB))

        if a.antes:
            raiz_a = prepara(pasta, ref=a.antes, nome='antes')[0]
            reg_a = Registro()
            srv_a, base_a = servidor(raiz_a, reg_a)
            try:
                reg_a.fase = 'jogo'
                info_a = visita(chrome, os.path.join(pasta, 'perfil3'), base_a, a.budget)
            finally:
                srv_a.shutdown()
            ca = contas(reg_a.da_fase('jogo'))
            print('  %s (antes): %.1f MB em %d arquivos · agora: %.1f MB em %d · caiu %.1f MB'
                  % (a.antes, ca['total'] / MB, ca['n200'], c['total'] / MB, c['n200'], (ca['total'] - c['total']) / MB))
            check('medido de verdade: a 1ª visita caiu 25 MB ou mais contra %s' % a.antes,
                  info_a.get('descer') and ca['total'] - c['total'] >= 25 * MB,
                  'antes %.1f MB, agora %.1f MB' % (ca['total'] / MB, c['total'] / MB))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    return resumo()


if __name__ == '__main__':
    sys.exit(main())
