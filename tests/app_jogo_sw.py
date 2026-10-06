#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O jogo guardado no aparelho, com o SERVICE WORKER DE VERDADE num Chrome headless.

    python tests/app_jogo_sw.py

A regra está provada em tests/app_jogo.js com cache e rede de mentira. Aqui o
sw.js e o js/app_jogo.js DO JOGO rodam num Chrome, contra um servidor local que
anota cada pedido e responde tudo com `Cache-Control: no-store` (o cache HTTP
do navegador fica fora da conta: o que não chegou ao servidor saiu do service
worker). A página é uma SONDA pequena, não o jogo inteiro: escreve o
js/app_jogo.js só com `?app=1`, como o index.html, e relata o que viu.

As visitas, no MESMO perfil (fora a da web):
  web      sem ?app=1: nenhum service worker, nenhum cache, o /sw.js nem é pedido;
  1ª       no aplicativo, "Baixar tudo": registra e guarda os arquivos do build;
  2ª       mesma versão: os scripts NÃO chegam ao servidor; a página, o
           js/versao.js e o /api chegam;
  3ª       o servidor mudou um arquivo: o novo desce e roda, o velho é apagado, e
           um conteúdo que não bate com o hash do endereço não fica guardado;
  sem rede o servidor fora do ar: a página NÃO abre do aparelho;
  apagar   "Apagar o jogo guardado": some o service worker e o cache;
  válvula  o sw.js publicado com DESLIGA = true: desregistra e apaga sozinho.

Precisa do Chrome instalado. Não prova o WebView do Android nem o Capacitor.
"""
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'servidor', 'coolify'))
import versao as build  # noqa: E402

CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium']
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
RES = []

SONDA = r"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>SONDA-SOTERRA</title>
<script>document.write('<scr' + 'ipt src="js/versao.js?t=' + Date.now() + '"><\/scr' + 'ipt>');</script>
<script>
  var V = window.SOTERRA_VERSAO, q = new URLSearchParams(location.search);
  function url(f) { return f + '?v=' + V.arquivos[f]; }
  document.write('<link rel="stylesheet" href="' + url('css/b.css') + '">');
  document.write('<scr' + 'ipt src="' + url('js/a.js') + '"><\/scr' + 'ipt>');
  if (/[?&]app=1(&|$)/.test(location.search)) {
    window.__guardaJogo = true;
    document.write('<scr' + 'ipt src="' + url('js/app_jogo.js') + '"><\/scr' + 'ipt>');
  }
</script></head><body>SONDA-SOTERRA
<script>
window.addEventListener('load', async function () {
  var G = window.JOGO && window.JOGO.AppJogo, rel = { a: window.A_VALOR, app: !!G }, acao = q.get('acao');
  function dorme(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  try {
    if (G) {
      if (acao === 'apaga') await G.apaga();
      else {
        if (acao === 'guarda') await G.guarda(); else await G.abre();
        if (acao === 'tudo') await G.completa();
        if (acao === 'errado') { await fetch('js/a.js?v=000000000000'); await dorme(500); }
        if (acao === 'espera') await dorme(4000); else rel.estado = await G.estado();
      }
    }
    await fetch('api/ping.js?v=' + V.arquivos['js/a.js']);
    rel.controlada = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    rel.registros = (await navigator.serviceWorker.getRegistrations()).length;
    rel.caches = await caches.keys();
    rel.chaves = [];
    if (rel.caches.indexOf('soterra-jogo-1') >= 0) {
      var ks = await (await caches.open('soterra-jogo-1')).keys();
      rel.chaves = ks.map(function (k) { return new URL(k.url).pathname + new URL(k.url).search; }).sort();
    }
  } catch (e) { rel.erro = String(e); }
  await fetch('/__relato', { method: 'POST', body: JSON.stringify(rel) });
});
</script></body></html>
"""


def check(nome, ok, extra=''):
    RES.append(bool(ok))
    print(('PASSOU' if ok else 'FALHOU') + ' · ' + nome + ((' — ' + str(extra)) if (extra != '' and not ok) else ''))


def grava(pasta, rel, texto):
    fis = os.path.join(pasta, *rel.split('/'))
    os.makedirs(os.path.dirname(fis), exist_ok=True)
    with open(fis, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)


def le(rel):
    with open(os.path.join(RAIZ, *rel.split('/')), encoding='utf-8') as f:
        return f.read()


def faz_build(pasta):
    """O passo do build: o js/versao.js com o hash de cada arquivo (e o peso)."""
    arquivos = build.mapa_de(pasta)
    build.escreve(pasta, arquivos)
    return arquivos


class Estado(object):
    def __init__(self):
        self.pedidos, self.relato, self.trava = [], None, threading.Lock()

    def zera(self):
        with self.trava:
            self.pedidos, self.relato = [], None


def servidor(pasta, porta, est):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=pasta, **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def do_GET(self):
            with est.trava:
                est.pedidos.append(self.path)
            if self.path.startswith('/api/'):
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript')
                self.send_header('Content-Length', '2')
                self.end_headers()
                self.wfile.write(b'//')
                return
            super().do_GET()

        def do_POST(self):
            corpo = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            with est.trava:
                est.relato = json.loads(corpo.decode('utf-8'))
            self.send_response(204)
            self.end_headers()

    class S(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True
        request_queue_size = 64
    s = S(('127.0.0.1', porta), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def mata(p):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
    else:
        p.kill()
    try:
        p.wait(timeout=20)
    except Exception:
        pass


def visita(chrome, perfil, url, est, espera=45, pousa=0.5):
    """Abre a página e espera o relato dela. Devolve (relato, pedidos da visita).
    `pousa`: segundos a mais antes de derrubar o Chrome — o localStorage só vai
    para o disco uns segundos depois de escrito, e a prova mata o processo."""
    est.zera()
    p = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                          '--remote-debugging-port=0', '--user-data-dir=' + perfil, url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=BAIXA)
    try:
        t0 = time.time()
        while est.relato is None and time.time() - t0 < espera:
            time.sleep(0.2)
        time.sleep(pousa)
    finally:
        mata(p)
    time.sleep(1.0)                      # o perfil solta os arquivos antes da visita seguinte
    with est.trava:
        return est.relato, list(est.pedidos)


def sem_rede(chrome, perfil, url):
    """Com o servidor fora do ar: o que o Chrome mostra? (--dump-dom)"""
    p = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                          '--user-data-dir=' + perfil, '--virtual-time-budget=4000', '--dump-dom', url],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=BAIXA)
    try:
        saida = p.communicate(timeout=40)[0]
    except subprocess.TimeoutExpired:
        saida = b''
    finally:
        mata(p)
    time.sleep(1.0)
    return saida.decode('utf-8', 'replace')


def caminhos(pedidos):
    return [x.split('?')[0] for x in pedidos]


def main():
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('app_jogo_sw.py: não achei o Chrome — prova não rodada')
        return 2
    base_tmp = tempfile.mkdtemp(prefix='soterra-sw-')
    pasta = os.path.join(base_tmp, 'www')
    srv = None
    try:
        grava(pasta, 'index.html', SONDA)
        grava(pasta, 'sw.js', le('sw.js'))
        grava(pasta, 'js/app_jogo.js', le('js/app_jogo.js'))
        grava(pasta, 'js/a.js', "window.A_VALOR = 'v1';\n")
        grava(pasta, 'css/b.css', 'body { color: #123; }\n')
        mapa1 = faz_build(pasta)
        with socket.socket() as so:
            so.bind(('127.0.0.1', 0))
            porta = so.getsockname()[1]
        est = Estado()
        srv = servidor(pasta, porta, est)
        base = 'http://127.0.0.1:%d/' % porta
        perfil, perfil_web = os.path.join(base_tmp, 'perfil'), os.path.join(base_tmp, 'perfil-web')
        do_jogo = sorted('/%s?v=%s' % (f, h) for f, h in mapa1.items() if build.do_jogo(f))

        # ---------------------------------------------------------------- a web
        r, ped = visita(chrome, perfil_web, base, est)
        check('WEB: a página abre e relata', bool(r) and r.get('a') == 'v1' and not r.get('erro'), r)
        r = r or {}
        check('WEB: nenhum service worker, nenhum cache, página não controlada',
              r.get('registros') == 0 and r.get('caches') == [] and r.get('controlada') is False and r.get('app') is False, r)
        check('WEB: o /sw.js e o js/app_jogo.js nem são pedidos', '/sw.js' not in caminhos(ped) and '/js/app_jogo.js' not in caminhos(ped), ped)

        # ---------------------------------------------------------------- 1ª no aplicativo
        r, ped = visita(chrome, perfil, base + '?app=1&acao=tudo', est)
        r = r or {}
        check('APP 1ª: registra o service worker', r.get('registros') == 1 and not r.get('erro'), r)
        check('APP 1ª: "Baixar tudo" guarda os arquivos do build, com o hash de cada um', r.get('chaves') == do_jogo, (r.get('chaves'), do_jogo))
        check('APP 1ª: os bytes guardados batem com o peso do build',
              (r.get('estado') or {}).get('bytes') == build.peso_do_jogo(pasta, mapa1), r.get('estado'))

        # ---------------------------------------------------------------- 2ª, mesma versão
        r, ped = visita(chrome, perfil, base + '?app=1', est)
        r = r or {}
        cs = caminhos(ped)
        check('APP 2ª: a página é controlada e o jogo roda', r.get('controlada') is True and r.get('a') == 'v1', r)
        check('APP 2ª: os arquivos guardados NÃO chegam ao servidor',
              not any(c in cs for c in ('/js/a.js', '/css/b.css', '/js/app_jogo.js')), ped)
        check('APP 2ª: a página e o js/versao.js vêm da rede', '/' in [x.split('?')[0] for x in ped] and '/js/versao.js' in cs, ped)
        check('APP 2ª: /api chega ao servidor mesmo com hash e cara de script', '/api/ping.js' in cs, ped)
        check('APP 2ª: nada de /api nem da página dentro do cache', r.get('chaves') == do_jogo, r.get('chaves'))

        # ---------------------------------------------------------------- 3ª, o servidor mudou
        grava(pasta, 'js/a.js', "window.A_VALOR = 'v2';\n")
        mapa2 = faz_build(pasta)
        r, ped = visita(chrome, perfil, base + '?app=1&acao=errado', est)
        r = r or {}
        check('APP 3ª: o arquivo que mudou é pedido ao servidor com o hash novo',
              ('/js/a.js?v=' + mapa2['js/a.js']) in ped and mapa2['js/a.js'] != mapa1['js/a.js'], ped)
        check('APP 3ª: roda o código NOVO', r.get('a') == 'v2', r)
        check('APP 3ª: o que não mudou segue saindo do aparelho', '/css/b.css' not in caminhos(ped) and '/js/app_jogo.js' not in caminhos(ped), ped)
        chaves = r.get('chaves') or []
        check('APP 3ª: a versão velha foi apagada e a nova guardada',
              ('/js/a.js?v=' + mapa2['js/a.js']) in chaves and ('/js/a.js?v=' + mapa1['js/a.js']) not in chaves and len(chaves) == 3, chaves)
        check('APP 3ª: conteúdo que não bate com o hash do endereço não é guardado',
              '/js/a.js?v=000000000000' in ped and '/js/a.js?v=000000000000' not in chaves, (ped, chaves))

        # ---------------------------------------------------------------- sem rede
        srv.shutdown()
        srv.server_close()
        dom = sem_rede(chrome, perfil, base + '?app=1')
        check('SEM REDE: a página NÃO abre do aparelho (jogo somente online)', 'SONDA-SOTERRA' not in dom, dom[:200])
        srv = servidor(pasta, porta, est)

        # ---------------------------------------------------------------- apagar
        r, ped = visita(chrome, perfil, base + '?app=1&acao=apaga', est, pousa=8)
        r = r or {}
        check('APAGAR: some o service worker e o cache', r.get('registros') == 0 and 'soterra-jogo-1' not in (r.get('caches') or ['?']), r)
        r, ped = visita(chrome, perfil, base + '?app=1', est)
        r = r or {}
        check('APAGAR: a abertura seguinte não registra de novo e busca tudo na rede',
              r.get('registros') == 0 and r.get('controlada') is False and '/js/a.js' in caminhos(ped) and '/sw.js' not in caminhos(ped), (r, ped))

        # ---------------------------------------------------------------- a válvula do sw.js
        r, ped = visita(chrome, perfil, base + '?app=1&acao=guarda', est, pousa=8)
        r = r or {}
        check('GUARDAR de novo: registra', r.get('registros') == 1, r)
        fonte = le('sw.js')
        grava(pasta, 'sw.js', fonte.replace('var DESLIGA = false;', 'var DESLIGA = true;'))
        faz_build(pasta)
        r, ped = visita(chrome, perfil, base + '?app=1&acao=espera', est)
        r = r or {}
        check('VÁLVULA: o sw.js novo é buscado no servidor', '/sw.js' in caminhos(ped), ped)
        check('VÁLVULA: desregistra e apaga o cache sozinho', r.get('registros') == 0 and 'soterra-jogo-1' not in (r.get('caches') or ['?']), r)
        r, ped = visita(chrome, perfil, base + '?app=1&acao=espera', est)
        r = r or {}
        check('VÁLVULA: com ela fechada o jogo abre da rede e nada fica guardado',
              r.get('a') == 'v2' and '/js/a.js' in caminhos(ped) and r.get('chaves') == [], (r, ped))
    finally:
        try:
            if srv:
                srv.shutdown()
                srv.server_close()
        except Exception:
            pass
        shutil.rmtree(base_tmp, ignore_errors=True)
    print('\n%d de %d passaram' % (sum(RES), len(RES)))
    return 0 if all(RES) else 1


if __name__ == '__main__':
    sys.exit(main())
