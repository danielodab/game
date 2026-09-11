#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova viva da loja (Fase C): o jogo retirando, aplicando e confirmando
contra a API de verdade.

    python tests/loja_viva.py

Sobe servidor/api.py numa porta livre com banco descartável (prioridade baixa),
abre tests/loja_viva.html no Chrome sem cabeça apontando para ela (`?api=`), e
lê o resultado da página. A página cria uma conta descartável por HTTP (nome e
senha gerados por ela, que morrem com a pasta temporária), sobe um save com
carteira, compra pelas rotas como o site faria, e deixa os módulos do jogo
(nuvem.js + loja.js) retirarem, aplicarem e subirem — /api/loja/minha tem de
mostrar entregue (e estornado, no caso sem saldo) com a carteira do servidor
debitada.

Se o servidor ainda não tiver as rotas da loja, a prova diz isso e sai com 2
(pendência, não falha)."""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.join(AQUI, '..', 'servidor', 'api.py')
PAGINA = os.path.join(AQUI, 'loja_viva.html')
CHROMES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
]
# o dono usa a máquina enquanto a prova roda: a API e o Chrome em prioridade baixa
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    porta = s.getsockname()[1]
    s.close()
    return porta


def espera_api(porta, segundos=15):
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/api/saude' % porta, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def tem_loja(porta):
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/loja/catalogo' % porta, timeout=3) as r:
            return r.status == 200 and bool(json.loads(r.read().decode('utf-8')).get('itens'))
    except urllib.error.HTTPError:
        return False
    except Exception:
        return False


def main():
    try:
        sys.stdout.reconfigure(errors='replace')
    except Exception:
        pass
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2
    pasta = tempfile.mkdtemp(prefix='soterra-loja-viva-')
    porta = porta_livre()
    proc = subprocess.Popen([sys.executable, API, '--porta', str(porta),
                             '--banco', os.path.join(pasta, 'dados', 'soterra.db')],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=BAIXA)
    try:
        if not espera_api(porta):
            print('a API não subiu na porta', porta)
            return 1
        if not tem_loja(porta):
            print('PENDENTE: o servidor ainda não tem as rotas da loja (/api/loja/*) — a prova viva fica para a junção')
            return 2
        perfil = os.path.join(pasta, 'perfil')
        url = 'file:///' + PAGINA.replace('\\', '/') + '?api=http://127.0.0.1:%d' % porta
        saida = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                                '--user-data-dir=' + perfil, '--virtual-time-budget=60000',
                                '--allow-file-access-from-files', '--dump-dom', url],
                               capture_output=True, timeout=240, creationflags=BAIXA)
        dom = saida.stdout.decode('utf-8', 'replace')
        resumo = re.search(r'id="summary"[^>]*>([^<]*)<', dom)
        linhas = re.findall(r'<div style="color: rgb[^"]*;">((?:PASSOU|FALHOU) · [^<]*)</div>', dom)
        for l in linhas:
            print(l.replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'))
        print('RESUMO:', resumo.group(1) if resumo else '(sem resumo — a página não terminou)')
        ok = bool(resumo) and 'tudo passou' in resumo.group(1)
        return 0 if ok else 1
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        shutil.rmtree(pasta, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
