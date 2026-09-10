#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O pacote que vai para o VPS abre o jogo SOZINHO?

    python tests/pacote_servido.py

Monta o pacote do mesmo jeito que tools/sobe_vps.py (git archive do último
commit), descompacta numa pasta temporária, serve com http.server numa porta
livre e abre, no Chrome headless, o jogo (index.html) e o site
(site/index.html). Cobra:
  - o pacote não leva tests/, tools/, docs/ nem os embutidos que o jogo
    servido não carrega, e o instala.sh vai com fim de linha LF;
  - nenhum arquivo pedido pela página falta (nenhum 404);
  - o menu do jogo aparece (o botão Descer) e a landing do site abre.
Precisa do Chrome instalado (o mesmo das outras provas headless).
"""
import functools
import http.server
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', 'tools'))
sys.dont_write_bytecode = True        # nada de tools/__pycache__ no repositório
import sobe_vps  # noqa: E402

CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium']
RESULTADOS = []
PEDIDOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


class Atendente(http.server.SimpleHTTPRequestHandler):
    def log_request(self, code='-', size='-'):
        PEDIDOS.append((self.path.split('?')[0], str(getattr(code, 'value', code))))

    def log_message(self, *a):
        pass


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def dom(chrome, perfil, url, budget):
    r = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                        '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget,
                        '--dump-dom', url], capture_output=True, timeout=600)
    return r.stdout.decode('utf-8', 'replace')


def main():
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2
    pasta = tempfile.mkdtemp(prefix='soterra-pacote-')
    try:
        pacote = sobe_vps.monta(os.path.join(pasta, 'pacote.tar.gz'))
        raiz = os.path.join(pasta, 'www')
        os.makedirs(raiz)
        with tarfile.open(pacote) as tf:
            nomes = tf.getnames()
            tf.extractall(raiz, filter='data')
        topo = sorted({n.split('/')[0] for n in nomes})
        check('o pacote não leva tests/, tools/, docs/', not ({'tests', 'tools', 'docs', '.claude'} & set(topo)), ' '.join(topo))
        embutidos = [n for n in nomes if re.match(r'^assets/embedded/(models-|env-kit|muro-)', n)]
        check('nem os embutidos que o jogo servido não carrega', not embutidos, ', '.join(embutidos[:3]))
        check('leva o servidor (api, relé, instala.sh, services, Caddyfile) e o site',
              all(n in nomes for n in ['servidor/api.py', 'servidor/rele.py', 'servidor/instala.sh',
                                       'servidor/soterra-api.service', 'servidor/soterra-rele.service',
                                       'servidor/Caddyfile', 'site/index.html', 'site/conta.html', 'site/ranking.html']))
        for n in ['servidor/instala.sh', 'servidor/Caddyfile', 'servidor/soterra-api.service']:
            cr = open(os.path.join(raiz, n), 'rb').read().count(b'\r')
            check('%s com fim de linha Linux (LF)' % n, cr == 0, '%d CR' % cr)
        check('o pacote pesa menos de 300 MB', os.path.getsize(pacote) < 300 * 1024 * 1024,
              '%.0f MB' % (os.path.getsize(pacote) / 1024 / 1024))

        porta = porta_livre()
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', porta), functools.partial(Atendente, directory=raiz))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:%d/' % porta
        try:
            jogo = dom(chrome, os.path.join(pasta, 'perfil1'), base + 'index.html', 90000)
            check('o jogo servido do pacote chega ao menu (botão Descer)', re.search(r'>\s*Descer\s*<', jogo) is not None,
                  'DOM de %d bytes' % len(jogo))
            site = dom(chrome, os.path.join(pasta, 'perfil2'), base + 'site/index.html', 5000)
            check('a landing do site abre', 'SOTERRA' in site and 'conta.html' in site)
        finally:
            srv.shutdown()
        # as molduras da landing esperam fotos em site/img/ (arte a fazer): o
        # onerror liga o fallback com a inicial — pedido que falta por desenho
        molduras = sorted({p for p, c in PEDIDOS if c == '404' and p.startswith('/site/img/')})
        if molduras:
            print('  (a landing tem %d molduras esperando foto em site/img/: fallback com a inicial)' % len(molduras))
        faltas = sorted({p for p, c in PEDIDOS if c == '404' and not p.startswith(('/api/', '/ws', '/site/img/'))
                         and p != '/favicon.ico'})
        bundle = [p for p, c in PEDIDOS if p.startswith('/assets/models/bundle/') and c == '200']
        check('nenhum arquivo pedido pela página falta (0 × 404)', not faltas, ', '.join(faltas[:6]))
        check('os modelos vieram do bundle (o caminho servido)', len(bundle) > 20, '%d arquivos do bundle' % len(bundle))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
