#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""As provas de TELA do Santuário dos Elementos, num Chrome só (03/10).

    python tests/santuario_navegador.py [--porta 8183] [--fotos PASTA] [--so tela,jogo,celular]
                                         [--prazo 900] [--pagina tests/a.html,tests/b.html@390x844m]

Na máquina compartilhada, rode pela VEZ do Chrome (uma prova de navegador por vez):
    python .wt/_ferramentas/vez.py santuario --prazo 1800 -- python tests/santuario_navegador.py --fotos <pasta>

O que faz: serve a raiz do repositório (com a fila de conexões alta: o index.html inteiro
pede centenas de arquivos de uma vez — README, seção 5), sobe UM Chrome headless em TEMPO
REAL (página com WebGL por software não fecha no relógio virtual), prioridade baixa, perfil
descartável, e abre uma página por vez pelo protocolo de depuração (CDP):
  1. tela     tests/santuario_tela.html — as cinco salas no renderizador de verdade: conta
              o que o santuario3d.js desenhou (breu, água, pilares, setas, avisos), quem
              some no escuro, as casas que o escuro tira do alcance, a linha da sala na HUD;
  2. jogo     tests/santuario_jogo.html — o index.html inteiro: a porta no cais, a ficha, o
              cartão da primeira visita, a descida, a antessala, a batalha e a recompensa;
  3. celular  a mesma do jogo numa janela de 390×844 com toque.
Cada página termina com `window.__fim = { ok, total, falhas, linhas }`. No meio ela pode pedir
uma FOTO da janela inteira (HUD e tabuleiro juntos, que canvas.toDataURL não dá):
`window.__foto = 'nome'` — o script tira, grava em --fotos e responde `window.__fotoFeita`.
As fotos são para o dono olhar; a régua é a conta que a página faz.

--pagina roda, no mesmo Chrome, OUTRAS páginas de tests/ (as réguas que o Santuário mexeu: o cais
de oito portas, as fichas, os ícones, a régua do mundo), separadas por vírgula. Elas terminam do
jeito das suítes da casa — window.__pronto / window.__done / window.TEST_RESULTS e o resumo em
#summary (o portão de tests/bateria.html) — e o script lê o resumo e as linhas de falha. O sufixo
`@LARGURAxALTURA` muda a janela e um `m` no fim liga o toque (tests/fichas_fotos.html mede o
celular: `tests/fichas_fotos.html@390x844m`).
"""
import argparse
import base64
import functools
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True

CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium']
BAIXA = 0x00004000 if os.name == 'nt' else 0           # BELOW_NORMAL_PRIORITY_CLASS

PAGINAS = {
    'tela':    ('tests/santuario_tela.html', (1400, 900), False),
    'jogo':    ('tests/santuario_jogo.html', (1400, 900), False),
    'celular': ('tests/santuario_jogo.html?celular=1', (390, 844), True),
}


class Servidor(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Fila(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    request_queue_size = 256          # o padrão (5) recusa conexão na rajada do index.html inteiro


class Cdp(object):
    """O mínimo do protocolo: mandar um método e esperar a resposta dele."""
    def __init__(self, url):
        from websockets.sync.client import connect
        self.ws = connect(url, max_size=128 * 1024 * 1024)
        self.n = 0
        self.espera = 180          # s por resposta: a página desenha com WebGL por software e fica ocupada
        self.console = []

    def __call__(self, metodo, **params):
        self.n += 1
        meu = self.n
        self.ws.send(json.dumps({'id': meu, 'method': metodo, 'params': params}))
        while True:
            m = json.loads(self.ws.recv(timeout=self.espera))
            if m.get('id') == meu:
                if 'error' in m:
                    raise RuntimeError('%s: %s' % (metodo, m['error']))
                return m.get('result', {})
            # os erros da página ficam guardados: a prova que quebra calada é a pior
            if m.get('method') == 'Runtime.exceptionThrown':
                d = m['params'].get('exceptionDetails', {})
                self.console.append('EXCEÇÃO: ' + str((d.get('exception') or {}).get('description') or d.get('text'))[:400])

    def avalia(self, expr):
        r = self('Runtime.evaluate', expression=expr, returnByValue=True)
        return (r.get('result') or {}).get('value')


def sobe_chrome(chrome):
    perfil = tempfile.mkdtemp(prefix='soterra-santuario-chrome-')
    proc = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
                             '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
                             '--remote-debugging-port=0', '--user-data-dir=' + perfil, 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=BAIXA)
    arq = os.path.join(perfil, 'DevToolsActivePort')
    for _ in range(200):
        if os.path.exists(arq) and os.path.getsize(arq) > 0:
            break
        time.sleep(0.1)
    porta = open(arq).read().split()[0]
    alvos = json.loads(urllib.request.urlopen('http://127.0.0.1:%s/json/list' % porta).read())
    pagina = [a for a in alvos if a.get('type') == 'page'][0]
    return proc, perfil, Cdp(pagina['webSocketDebuggerUrl'])


def mata(proc, perfil):
    # a árvore inteira: o gpu-process e os renderizadores sobrevivem ao pai e queimam CPU para sempre
    if os.name == 'nt':
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True)
    else:
        proc.kill()
    time.sleep(0.5)
    shutil.rmtree(perfil, ignore_errors=True)


# o fim de uma suíte da casa (o mesmo portão de tests/bateria.html): __pronto / __done / TEST_RESULTS com o resumo
# pintado em #summary. Devolve o formato do __fim: o resumo, as falhas contadas e as linhas de falha da página.
DA_CASA = r"""(function () {
  var t = window.TEST_RESULTS, s = document.getElementById('summary') || document.querySelector('.allpass, .fail');
  var resumo = s ? s.textContent.trim() : '';
  var pronto = window.__pronto === true || window.__done === true || (t && typeof t.failed === 'number') ||
               /passou|FALHOU|falharam|PASS/i.test(resumo);
  if (!pronto || /rodando|carregando/i.test(resumo)) return null;
  var falhas = [];
  if (t && t.failures) falhas = t.failures.slice(0, 40);
  else [].slice.call(document.querySelectorAll('#log > *, #lista > *, li, .fail')).forEach(function (e) {
    // a linha de falha das suítes da casa começa por FALHOU (ou ✘): div de cor no #log, <li> com o selo
    var x = e.textContent.trim();
    if (e !== s && /^(FALHOU|✘)/.test(x) && falhas.length < 40) falhas.push(x.replace(/^(FALHOU|✘)\s*·?\s*/, '').slice(0, 500));
  });
  var n = (t && typeof t.failed === 'number') ? t.failed
        : ((typeof window.__fail === 'number' && window.__fail) || (/FALHOU|falharam|✘/i.test(resumo) ? Math.max(1, falhas.length) : 0));
  var nums = resumo.match(/\d+/g) || [];
  if (!t && n && nums.length >= 2) n = +nums[0];           // "FALHOU — 3 de 120"
  return JSON.stringify({ ok: n === 0, total: t ? (t.passed + t.failed) : (nums.length ? +nums[nums.length - 1] : 0), falhas: n,
                          linhas: [resumo].concat(n ? falhas.map(function (x) { return 'FALHOU · ' + x; }) : []) });
})()"""


def roda(cdp, base, rel, tam, celular, prazo, fotos, prefixo):
    w, h = tam
    cdp('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=celular)
    cdp('Emulation.setTouchEmulationEnabled', enabled=celular, maxTouchPoints=5 if celular else 1)
    cdp.console = []
    # com --fotos a página fica sabendo que há quem tire a foto (sem isso ela não espera por ninguém)
    if fotos:
        rel += ('&' if '?' in rel else '?') + 'fotos=1'
    cdp('Page.navigate', url=base + rel)
    fim = time.time() + prazo
    tiradas = 0
    while time.time() < fim:
        time.sleep(0.3)
        try:
            pedido = cdp.avalia('window.__foto || null')
            if pedido:
                if fotos:
                    # a foto que não sai não derruba a prova: a régua é a conta da página, não a imagem
                    try:
                        png = cdp('Page.captureScreenshot', format='png')['data']
                        nome = os.path.join(fotos, '%s%s.png' % (prefixo, pedido))
                        with open(nome, 'wb') as fh:
                            fh.write(base64.b64decode(png))
                        tiradas += 1
                    except Exception as e:
                        print('   foto %s não saiu: %s' % (pedido, str(e)[:120]), flush=True)
                cdp.avalia('window.__fotoFeita = window.__foto; window.__foto = null; true')
            r = cdp.avalia('window.__fim ? JSON.stringify(window.__fim) : null')
            if r:
                return json.loads(r), tiradas
            r = cdp.avalia(DA_CASA)
            if r:
                return json.loads(r), tiradas
        except Exception:
            # a página ocupada (um trecho longo de desenho) ou trocando de documento: a resposta atrasada
            # é descartada pelo id, e a pergunta sai de novo até o prazo da página
            continue
    try:
        parcial = cdp.avalia('JSON.stringify({ linhas: (window.__linhas || []), onde: window.__onde || null })')
    except Exception:
        parcial = None
    return {'ok': False, 'total': 0, 'falhas': 1, 'linhas': ['FALHOU · a página não terminou em %d s — %s' % (prazo, parcial)]}, tiradas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--porta', type=int, default=8183)
    ap.add_argument('--fotos', default=None)
    ap.add_argument('--so', default='tela,jogo,celular')
    ap.add_argument('--prazo', type=int, default=900)
    ap.add_argument('--pagina', default=None, help='outras páginas de tests/, separadas por vírgula (@LxA[m] muda a janela)')
    args = ap.parse_args()
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome nesta máquina')
        return 2
    if args.fotos:
        os.makedirs(args.fotos, exist_ok=True)
    srv = Fila(('127.0.0.1', args.porta), functools.partial(Servidor, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d/' % args.porta
    lista = [(n, PAGINAS[n]) for n in args.so.split(',') if n in PAGINAS]
    if args.pagina:
        lista = []
        for item in args.pagina.split(','):
            rel, _, jan = item.strip().partition('@')
            toque = jan.endswith('m')
            lado = jan.rstrip('m').split('x') if jan else []
            tam = (int(lado[0]), int(lado[1])) if len(lado) == 2 else (1400, 900)
            lista.append((os.path.splitext(os.path.basename(rel))[0], (rel, tam, toque)))
    total = falhas = 0
    proc, perfil, cdp = sobe_chrome(chrome)
    try:
        cdp('Page.enable')
        cdp('Runtime.enable')
        for nome, (rel, tam, celular) in lista:
            t0 = time.time()
            r, tiradas = roda(cdp, base, rel, tam, celular, args.prazo, args.fotos, nome + '_')
            print('\n== %s (%s, %dx%d) — %d s, %d fotos' % (nome, rel, tam[0], tam[1], time.time() - t0, tiradas), flush=True)
            for linha in r.get('linhas') or []:
                print(linha)
            for linha in cdp.console[:12]:
                print('   ' + linha)
            total += int(r.get('total') or 0)
            falhas += int(r.get('falhas') or 0) + (0 if r.get('ok') or r.get('falhas') else 1)
    finally:
        try:
            cdp('Browser.close')
        except Exception:
            pass
        mata(proc, perfil)
        srv.shutdown()
    print('\nRESUMO: ' + ('FALHOU %d de %d' % (falhas, total) if falhas else 'tudo passou (%d)' % total))
    return 1 if falhas else 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')          # o console cp1252 do Windows quebra no "✕" e no "→"
    except Exception:
        pass
    sys.exit(main())
