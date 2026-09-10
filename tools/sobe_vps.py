#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sobe o SOTERRA para o VPS (Hostinger KVM) — do Windows, sem rsync.

    python tools/sobe_vps.py IP-DO-VPS SEU-DOMINIO
    python tools/sobe_vps.py IP-DO-VPS SEU-DOMINIO --usuario ubuntu   (se não entrar como root)
    python tools/sobe_vps.py --so-pacote                               (só monta o pacote, para conferir)

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
FORA = ['tests', 'tools', 'docs', '.claude', 'unity',
        'assets/embedded/models-*', 'assets/embedded/env-kit*', 'assets/embedded/muro-*']
RE_DOMINIO = re.compile(r'^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$')
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
        sys.exit('parou aqui (código %d). Nada foi apagado no VPS; é só rodar de novo.' % r.returncode)


def main():
    ap = argparse.ArgumentParser(description='Sobe o SOTERRA para o VPS')
    ap.add_argument('host', nargs='?', help='o IP do VPS (hPanel → VPS → Visão geral)')
    ap.add_argument('dominio', nargs='?', help='o domínio apontado para o VPS, ou o hostname srvNNNNNN.hstgr.cloud')
    ap.add_argument('--usuario', default='root', help='usuário do SSH (padrão: root, como a Hostinger entrega)')
    ap.add_argument('--porta-ssh', type=int, default=22)
    ap.add_argument('--so-pacote', action='store_true', help='só monta o pacote e diz o tamanho')
    a = ap.parse_args()

    pacote = os.path.join(tempfile.gettempdir(), 'soterra-pacote.tar.gz')
    if a.so_pacote:
        monta(pacote)
        return
    if not a.host or not a.dominio:
        ap.error('informe o IP do VPS e o domínio (ou --so-pacote)')
    if not RE_HOST.match(a.host) or not RE_DOMINIO.match(a.dominio) or not RE_USUARIO.match(a.usuario):
        ap.error('IP, domínio ou usuário com caractere estranho')

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
              'rm -rf /tmp/soterra-pacote /tmp/soterra-pacote.tar.gz' % (sudo, a.dominio))
    roda(['ssh', '-t'] + opcoes + ['-p', str(a.porta_ssh), alvo, remoto])
    print('\nFeito. Abra https://%s' % a.dominio)


if __name__ == '__main__':
    main()
