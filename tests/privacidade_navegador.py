#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova de navegador dos direitos do titular e do registro de erros (02/10).

    python tests/privacidade_navegador.py [--porta 8143] [--so-site]

Na máquina compartilhada, rode pela VEZ do Chrome (uma prova de navegador por vez):
    python .wt/_ferramentas/vez.py conta --prazo 1800 -- python tests/privacidade_navegador.py

Serve a raiz do repositório (http.server, que também recebe o POST /__resultado das
páginas), sobe a API DE VERDADE (servidor/api.py, banco descartável, --emails-prova),
cria uma conta e abre no Chrome headless, EM TEMPO REAL (o index.html inteiro não
fecha com --virtual-time-budget), um perfil descartável por página:
  1. tests/site_privacidade.html — o site com fetch falso (termos, privacidade, o aceite
     no cadastro, o bloco da Minha conta, o painel de erros do Mestre);
  2. tests/privacidade_jogo.html — o jogo inteiro contra a API: o registro de erros
     ligado, a ficha Contas, baixar os dados e excluir a conta.
Depois confere no banco: o erro lançado pelo jogo chegou com a conta (antes da
exclusão) e, excluída, a conta virou a lápide. O Chrome roda em prioridade baixa e
morre no fim (a árvore inteira), dê certo ou não.
"""
import argparse
import functools
import http.server
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
import urllib.parse

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
import privacidade  # noqa: E402

CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium']
BAIXA = 0x00004000 if os.name == 'nt' else 0           # BELOW_NORMAL_PRIORITY_CLASS

RESULTADOS = {}


class Servidor(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/__resultado':
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length') or 0)
        try:
            r = json.loads(self.rfile.read(n).decode('utf-8'))
            RESULTADOS[r.get('pagina')] = r
        except ValueError:
            pass
        self.send_response(204)
        self.end_headers()


def mata_arvore(proc):
    if proc.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], capture_output=True)
    else:
        proc.kill()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        pass


def abre_pagina(chrome, url, pagina, prazo):
    perfil = tempfile.mkdtemp(prefix='soterra-priv-chrome-')
    proc = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
                             '--no-default-browser-check', '--mute-audio', '--window-size=1400,900',
                             '--user-data-dir=' + perfil, url],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=BAIXA)
    fim = time.time() + prazo
    try:
        while time.time() < fim and pagina not in RESULTADOS:
            time.sleep(0.5)
    finally:
        mata_arvore(proc)
        time.sleep(0.5)
        shutil.rmtree(perfil, ignore_errors=True)
    return RESULTADOS.get(pagina)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--porta', type=int, default=8143)
    ap.add_argument('--so-site', action='store_true')
    ap.add_argument('--so-jogo', action='store_true')
    args = ap.parse_args()
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome nesta máquina')
        return 2
    total = falhas = 0

    def check(nome, ok, extra=''):
        nonlocal total, falhas
        total += 1
        falhas += 0 if ok else 1
        print(('PASSOU' if ok else 'FALHOU') + ' · ' + nome + ('' if ok or not extra else ' — ' + str(extra)))

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', args.porta), functools.partial(Servidor, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pasta = tempfile.mkdtemp(prefix='soterra-priv-nav-')
    banco = os.path.join(pasta, 'dados', 'soterra.db')
    porta_api = porta_livre()
    base_api = 'http://127.0.0.1:%d' % porta_api
    log = open(os.path.join(pasta, 'api.log'), 'w', encoding='utf-8')
    api = subprocess.Popen([sys.executable, API, '--porta', str(porta_api), '--banco', banco,
                            '--emails-prova', os.path.join(pasta, 'emails.jsonl')],
                           stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    try:
        check('a API sobe', espera_api(base_api, api))
        site = 'http://127.0.0.1:%d' % args.porta
        r = None if args.so_jogo else abre_pagina(chrome, site + '/tests/site_privacidade.html?relatar=1',
                                                  'site_privacidade', 180)
        if not args.so_jogo:
            check('site_privacidade.html terminou', r is not None)
            # a prova da Fase C (o cadastro de sempre, agora com a caixa do aceite): página leve,
            # cabe no tempo virtual
            perfil = tempfile.mkdtemp(prefix='soterra-priv-chrome-')
            try:
                saida = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                                        '--user-data-dir=' + perfil, '--virtual-time-budget=90000', '--dump-dom',
                                        site + '/tests/site_fase_c.html'], capture_output=True, timeout=240,
                                       creationflags=BAIXA).stdout.decode('utf-8', 'replace')
            except subprocess.TimeoutExpired:
                saida = ''
            finally:
                shutil.rmtree(perfil, ignore_errors=True)
            m = re.search(r'<div id="summary"[^>]*>([^<]*)<', saida)
            fase_c = m.group(1) if m else '(sem resumo)'
            for ln in re.findall(r'>(FALHOU · [^<]*)<', saida):    # as linhas do #log, não o código do <script>
                print('   ' + ln)
            check('site_fase_c.html (o cadastro e a conta de antes): ' + fase_c, fase_c.startswith('tudo passou'))
        if r:
            for ln in r['linhas']:
                print('   ' + ln)
            check('site_privacidade.html: %d de %d' % (r['total'] - r['falhas'], r['total']), r['falhas'] == 0)
        if not args.so_site:
            c = Cliente(base_api)
            nome = 'Prova Priv %s' % secrets.token_hex(2)
            senha = 'senha-da-prova-%s' % secrets.token_hex(3)
            email = nome.replace(' ', '').lower() + '@soterra.test'
            st, rr = c.cadastra(nome, email=email, senha=senha)
            check('a conta da prova nasce (com o aceite)', st == 201, rr)
            q = urllib.parse.urlencode({'api': base_api, 'token': c.token, 'id': c.conta['id'], 'nome': nome,
                                        'senha': senha, 'email': email, 'relatar': 1})
            r = abre_pagina(chrome, site + '/tests/privacidade_jogo.html?' + q, 'privacidade_jogo', 420)
            check('privacidade_jogo.html terminou', r is not None)
            if r:
                for ln in r['linhas']:
                    print('   ' + ln)
                check('privacidade_jogo.html: %d de %d' % (r['total'] - r['falhas'], r['total']), r['falhas'] == 0)
            con = sqlite3.connect(banco)
            con.row_factory = sqlite3.Row
            try:
                cid = c.conta['id']
                e = con.execute("SELECT * FROM erros_registro WHERE mensagem LIKE ?",
                                ('%prova do registro ' + str(cid) + '%',)).fetchone()
                check('o erro lançado pelo jogo chegou ao banco, como erro do cliente', e is not None and e['origem'] == 'cliente')
                if e is not None:
                    check('com a versão, a tela e o navegador resumido',
                          json.loads(e['versoes'] or '[]') and json.loads(e['telas'] or '[]') and
                          ' · ' in (json.loads(e['navegadores'] or '[""]') or [''])[0], dict(e))
                lap = con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone()
                check('excluída pelo jogo: a conta virou a lápide', lap is not None and lap['nome'] == privacidade.LAPIDE_NOME % cid
                      and lap['banido'] == 1, dict(lap) if lap else None)
                check('e o número dela saiu do registro de erros (a conta some com ela)',
                      con.execute("SELECT COUNT(*) FROM erros_registro_contas WHERE conta_id = ?", (cid,)).fetchone()[0] == 0)
            finally:
                con.close()
    finally:
        mata_arvore(api)
        log.close()
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(pasta, ignore_errors=True)
    print('\nRESUMO: %s' % ('tudo passou (%d)' % total if not falhas else 'FALHOU — %d de %d' % (falhas, total)))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
