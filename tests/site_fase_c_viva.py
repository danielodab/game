#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova viva da Fase C no site: site/conta.html e site/loja.html contra a API de verdade.

    python tests/site_fase_c_viva.py

Sobe servidor/api.py numa porta livre, com banco descartável e o correio em
MODO DE PROVA (--emails-prova ARQ: cada e-mail vira uma linha JSON no arquivo,
e nada sai da máquina), e um servidor estático temporário na raiz do
repositório (este mesmo arquivo com --servir, por Popen). O estático serve os
arquivos como são, com uma exceção: /index.html (o jogo) vira uma página curta,
porque o cadastro leva ao jogo e esta prova não precisa carregar o jogo.

A página tests/site_fase_c_viva.html, na MESMA origem das páginas do site, abre
/site/conta.html?api=… e /site/loja.html?api=… num iframe e mexe no DOM. Três
rodadas do Chrome headless (prioridade baixa, uma de cada vez) com o MESMO
--user-data-dir, que guarda a sessão e os valores sintéticos entre elas:
  1. cria a conta pelo formulário, sobe um save com carteira (pela rota do
     jogo), compra e cancela na loja, compra um personagem, encerra sessões,
     troca a senha e pede a troca de e-mail (o código vai ao e-mail ATUAL);
  2. o Python lê o código no arquivo de prova e o passa pelo #hash da página DE
     PROVA (nunca do site); a página confirma a troca, sai de todas as sessões
     e pede o "esqueci a senha": primeiro de um e-mail sem conta (a mesma
     resposta, e nenhum e-mail sai), depois do e-mail novo;
  3. com o código do esqueci, redefine a senha e entra; a loja continua lá.
O nome e os e-mails saem de uma semente aleatória; as senhas, a própria página
sorteia. Tudo morre com a pasta temporária.

`--api SCRIPT` troca o servidor/api.py por outro com a mesma linha de comando
(só para ensaiar a prova antes de a API ter as rotas da Fase C).
"""
import argparse
import functools
import html
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)     # o dono usa a máquina enquanto a prova roda
RESULTADOS = []

JOGO_DA_PROVA = ('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>o jogo (fora desta prova)</title>'
                 '</head><body><p id="jogo-da-prova">Aqui abriria o jogo; a prova da Fase C no site não precisa dele.</p>'
                 '</body></html>')


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra and not ok else ''))


# ---- o servidor estático (--servir) -------------------------------------------------
class Estatico(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
                             '.webp': 'image/webp', '.json': 'application/json'})

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0].split('#')[0] == '/index.html':
            corpo = JOGO_DA_PROVA.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()


def servir(porta):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', porta), functools.partial(Estatico, directory=RAIZ))
    srv.serve_forever()


# ---- miúdos ---------------------------------------------------------------------------
def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def espera_http(url, segundos=20):
    for _ in range(int(segundos / 0.2)):
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def pede(base, metodo, rota):
    try:
        with urllib.request.urlopen(urllib.request.Request(base + rota, method=metodo), timeout=10) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}
    except Exception:
        return 0, {}


def le_emails(arq):
    if not os.path.exists(arq):
        return []
    saida = []
    with open(arq, encoding='utf-8') as f:
        for linha in f:
            linha = linha.strip()
            if linha:
                try:
                    saida.append(json.loads(linha))
                except ValueError:
                    pass
    return saida


def codigo_para(arq, para, palavra, segundos=8):
    """o código de 6 dígitos do e-mail mais novo para `para` cujo assunto tem
    `palavra`; o "esqueci" manda numa thread, então espera um pouco"""
    for _ in range(int(segundos / 0.2)):
        for m in reversed(le_emails(arq)):
            if m.get('para') == para and palavra in str(m.get('assunto', '')).lower():
                achado = re.search(r'\b\d{6}\b', str(m.get('texto', '')))
                if achado:
                    return achado.group(0)
        time.sleep(0.2)
    return None


def rodada(chrome, perfil, url, saida, budget=150000):
    r = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                        '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget, '--dump-dom', url],
                       capture_output=True, timeout=600, creationflags=BAIXA)
    dom = r.stdout.decode('utf-8', 'replace')
    with open(saida, 'w', encoding='utf-8') as f:
        f.write(dom)
    resumo = re.search(r'id="summary"[^>]*>([^<]*)<', dom)
    linhas = [html.unescape(x) for x in re.findall(r'<div style="color: rgb[^"]*;">((?:PASSOU|FALHOU) · [^<]*)</div>', dom)]
    return html.unescape(resumo.group(1)) if resumo else '(sem resumo — a página não terminou)', linhas


def mostra(n, resumo, linhas):
    print('---- rodada %d ----' % n)
    for x in linhas:
        print('  ' + x)
    print('  resumo da rodada %d: %s' % (n, resumo))


def main():
    ap = argparse.ArgumentParser(description='A prova viva da Fase C no site')
    ap.add_argument('--servir', type=int, help=argparse.SUPPRESS)
    ap.add_argument('--api', default=os.path.join(RAIZ, 'servidor', 'api.py'),
                    help='o script da API (padrão: servidor/api.py)')
    args = ap.parse_args()
    if args.servir:
        servir(args.servir)
        return 0
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2

    pasta = tempfile.mkdtemp(prefix='soterra-fase-c-viva-')
    emails = os.path.join(pasta, 'emails.jsonl')
    papi, pest = porta_livre(), porta_livre()
    base = 'http://127.0.0.1:%d' % papi
    site = 'http://127.0.0.1:%d' % pest
    log_api = os.path.join(pasta, 'api.log')
    procs = []
    try:
        with open(log_api, 'w', encoding='utf-8') as log:
            procs.append(subprocess.Popen([sys.executable, args.api, '--porta', str(papi),
                                           '--banco', os.path.join(pasta, 'dados', 'soterra.db'), '--emails-prova', emails],
                                          stdout=log, stderr=subprocess.STDOUT, creationflags=BAIXA))
        procs.append(subprocess.Popen([sys.executable, os.path.abspath(__file__), '--servir', str(pest)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=BAIXA))
        subiu = espera_http(base + '/api/saude')
        if not subiu:
            with open(log_api, encoding='utf-8', errors='replace') as f:
                cauda = f.read()[-600:]
            check('a API sobe com --emails-prova', False, cauda.replace('\n', ' | '))
            print('PENDENTE: a API não subiu com --emails-prova (a frente SERVIDOR ainda não entrou?)')
            return 1
        st, saude = pede(base, 'GET', '/api/saude')
        stc, _ = pede(base, 'GET', '/api/loja/catalogo')
        prontas = saude.get('correio') is True and stc == 200
        check('a API tem as rotas da Fase C (correio em modo de prova e /api/loja/catalogo)', prontas,
              'saude=%s catalogo=%s' % (json.dumps(saude, ensure_ascii=False), stc))
        if not prontas:
            print('PENDENTE: a API ainda não tem as rotas da Fase C (frente SERVIDOR); nada a provar ao vivo no site.')
            return 1
        check('o servidor estático sobe', espera_http(site + '/tests/site_fase_c_viva.html'))

        semente = secrets.token_hex(4)
        nome = 'viva' + semente
        email, novo, sem_conta = nome + '@prova.local', nome + '.novo@prova.local', 'ninguem' + semente + '@prova.local'
        perfil = os.path.join(pasta, 'perfil')             # o MESMO nas três rodadas: guarda a sessão
        pagina = site + '/tests/site_fase_c_viva.html?api=' + base

        # ---- rodada 1
        resumo, linhas = rodada(chrome, perfil, pagina + '#rodada=1&semente=' + semente, os.path.join(pasta, 'r1.html'))
        mostra(1, resumo, linhas)
        check('rodada 1: conta, save, loja, sessões, senha e o pedido de troca de e-mail', 'tudo passou' in resumo, resumo)
        if 'tudo passou' not in resumo:
            return 1
        cod_troca = codigo_para(emails, email, 'e-mail')
        check('o código da troca de e-mail foi ao e-mail ATUAL', bool(cod_troca))
        check('e nada foi ao e-mail novo antes da confirmação', not any(m.get('para') == novo for m in le_emails(emails)))
        check('a troca de senha avisou o e-mail da conta',
              any(m.get('para') == email and 'senha' in str(m.get('assunto', '')).lower() and 'troc' in str(m.get('assunto', '')).lower()
                  for m in le_emails(emails)))
        if not cod_troca:
            return 1

        # ---- rodada 2
        resumo, linhas = rodada(chrome, perfil, pagina + '#rodada=2&codigo=' + cod_troca, os.path.join(pasta, 'r2.html'))
        mostra(2, resumo, linhas)
        check('rodada 2: o código pelo #hash da página de prova, sair de todas e o esqueci', 'tudo passou' in resumo, resumo)
        if 'tudo passou' not in resumo:
            return 1
        cod_esqueci = codigo_para(emails, novo, 'senha')
        check('o código do esqueci foi ao e-mail NOVO da conta', bool(cod_esqueci))
        check('o aviso da troca foi ao e-mail ANTIGO',
              any(m.get('para') == email and 'mudou' in str(m.get('assunto', '')).lower() for m in le_emails(emails)))
        check('o esqueci de um e-mail sem conta não mandou nada', not any(m.get('para') == sem_conta for m in le_emails(emails)))
        if not cod_esqueci:
            return 1

        # ---- rodada 3
        resumo, linhas = rodada(chrome, perfil, pagina + '#rodada=3&codigo=' + cod_esqueci, os.path.join(pasta, 'r3.html'))
        mostra(3, resumo, linhas)
        check('rodada 3: a senha redefinida pelo código, e a loja de pé', 'tudo passou' in resumo, resumo)

        with open(log_api, encoding='utf-8', errors='replace') as f:
            texto_log = f.read()
        check('nenhum código aparece no log da API', cod_troca not in texto_log and cod_esqueci not in texto_log)
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
        shutil.rmtree(pasta, ignore_errors=True)
        falhas = RESULTADOS.count(False)
        print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if RESULTADOS.count(False) else 0


if __name__ == '__main__':
    sys.exit(main())
