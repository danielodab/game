#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sobe o SOTERRA para o VPS (Hostinger KVM) — do Windows, sem rsync.

    python tools/sobe_vps.py IP-DO-VPS ENDERECO [OUTROS-NOMES...]

    ENDERECO      por onde o jogo abre: jogo.seudominio.com.br, ou (sem domínio)
                  o hostname do VPS srv123456.hstgr.cloud, ou o próprio IP
                  (sem HTTPS). OUTROS-NOMES levam ao principal (www.…).
    --usuario U   usuário do SSH (padrão root, como a Hostinger entrega)
    --so-pacote   só monta o pacote e diz o tamanho, sem mandar nada

Exemplos:
    python tools/sobe_vps.py 181.215.1.2 jogo.seudominio.com.br
    python tools/sobe_vps.py 181.215.1.2 seudominio.com.br www.seudominio.com.br
    python tools/sobe_vps.py 181.215.1.2 srv123456.hstgr.cloud

O que faz:
  1. Monta o pacote com o que está COMMITADO (git archive do último commit),
     com fim de linha Linux. Ficam de fora tests/, tools/, docs/ e os 144 MB
     de embutidos que o jogo servido não carrega (ele busca os modelos em
     assets/models/bundle/). Arte fora do git também não vai. Mudança não
     commitada NÃO vai — o script avisa.
  2. Manda por scp para /tmp do VPS (pede a senha do VPS).
  3. Descompacta e roda servidor/instala.sh lá (pede a senha de novo).

Com a sua chave SSH cadastrada no VPS, não pede senha nenhuma. Usa o ssh e o
scp que já vêm no Windows 10/11.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORA = ['tests', 'tools', 'docs', '.claude', 'unity', 'servidor/dados',
        'assets/embedded/models-*', 'assets/embedded/env-kit*', 'assets/embedded/muro-*']
RE_NOME = re.compile(r'^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$')
RE_IP = re.compile(r'^[0-9]{1,3}(\.[0-9]{1,3}){3}$')
RE_HOST = re.compile(r'^[A-Za-z0-9.:-]+$')
RE_USUARIO = re.compile(r'^[a-z_][a-z0-9_-]*$')


def git(*args, **kw):
    # autocrlf desligado SÓ neste comando: com ele ligado (o padrão do Git no
    # Windows) o pacote sairia com CRLF e o bash do VPS quebraria no instala.sh
    return subprocess.run(['git', '-C', RAIZ, '-c', 'core.autocrlf=false', '-c', 'core.eol=lf'] + list(args),
                          capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)


def monta(destino):
    if git('rev-parse', '--git-dir').returncode != 0:
        sys.exit('isto precisa rodar de dentro do repositório do jogo')
    if git('cat-file', '-e', 'HEAD:servidor/instala.sh').returncode != 0:
        sys.exit('servidor/instala.sh ainda não está commitado — commite antes de subir')
    sujo = [l for l in git('status', '--porcelain').stdout.splitlines() if l.strip()]
    if sujo:
        print('AVISO: %d arquivo(s) com mudança não commitada — eles NÃO vão (o pacote é o último commit).' % len(sujo))
    commit = git('log', '-1', '--format=%h %s').stdout.strip()
    specs = ['.'] + [':(exclude)' + p for p in FORA]
    r = git('archive', '--format=tar.gz', '-o', destino, 'HEAD', '--', *specs)
    if r.returncode != 0:
        sys.exit('o git archive falhou: ' + r.stderr.strip())
    mb = os.path.getsize(destino) / 1024 / 1024
    print('pacote: %s (%.0f MB) — commit %s' % (destino, mb, commit))
    return destino


def roda(cmd):
    print('> ' + ' '.join(cmd))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        sys.exit('parou aqui (código %d). O banco do VPS não foi tocado; é só rodar de novo.' % r.returncode)


def main():
    ap = argparse.ArgumentParser(description='Sobe o SOTERRA para o VPS')
    ap.add_argument('host', nargs='?', help='o IP do VPS (hPanel → VPS → Visão geral)')
    ap.add_argument('enderecos', nargs='*',
                    help='o endereço principal (domínio, srvNNNNNN.hstgr.cloud ou o IP) e nomes extras (www.…)')
    ap.add_argument('--usuario', default='root', help='usuário do SSH (padrão: root, como a Hostinger entrega)')
    ap.add_argument('--porta-ssh', type=int, default=22)
    ap.add_argument('--so-pacote', action='store_true', help='só monta o pacote e diz o tamanho')
    a = ap.parse_args()

    pacote = os.path.join(tempfile.gettempdir(), 'soterra-pacote.tar.gz')
    if a.so_pacote:
        monta(pacote)
        return
    if not a.host or not a.enderecos:
        ap.error('informe o IP do VPS e o endereço (ou --so-pacote)')
    if not RE_HOST.match(a.host) or not RE_USUARIO.match(a.usuario):
        ap.error('IP ou usuário com caractere estranho')
    for e in a.enderecos:
        if not RE_NOME.match(e):
            ap.error('endereço estranho: %s' % e)
    if any(RE_IP.match(e) for e in a.enderecos[1:]) or (RE_IP.match(a.enderecos[0]) and len(a.enderecos) > 1):
        ap.error('o IP só pode ser o único endereço (sem nomes extras)')

    monta(pacote)
    alvo = '%s@%s' % (a.usuario, a.host)
    sudo = '' if a.usuario == 'root' else 'sudo '
    opcoes = ['-o', 'StrictHostKeyChecking=accept-new']
    print('\n== enviando (pede a senha do VPS)')
    roda(['scp'] + opcoes + ['-P', str(a.porta_ssh), pacote, alvo + ':/tmp/soterra-pacote.tar.gz'])
    print('\n== instalando no VPS (pede a senha de novo)')
    remoto = ('set -e; rm -rf /tmp/soterra-pacote; mkdir -p /tmp/soterra-pacote; '
              'tar -xzf /tmp/soterra-pacote.tar.gz -C /tmp/soterra-pacote; '
              '%sbash /tmp/soterra-pacote/servidor/instala.sh %s; '
              'rm -rf /tmp/soterra-pacote /tmp/soterra-pacote.tar.gz' % (sudo, ' '.join(a.enderecos)))
    roda(['ssh', '-t'] + opcoes + ['-p', str(a.porta_ssh), alvo, remoto])
    esquema = 'http://' if RE_IP.match(a.enderecos[0]) else 'https://'
    print('\nFeito. O site: %s%s   O jogo: %s%s/index.html' % (esquema, a.enderecos[0], esquema, a.enderecos[0]))


if __name__ == '__main__':
    main()
