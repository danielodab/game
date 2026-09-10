#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova estática do contêiner do Coolify (esta máquina não tem Docker).

    python tests/coolify_prova.py

Cobra o que dá para cobrar sem construir a imagem:
  - o que o .dockerignore deixa entrar é o MESMO conteúdo do pacote do VPS
    (tools/sobe_vps.py), que tests/pacote_servido.py prova que abre o jogo;
  - os scripts do contêiner passam no `sh -n` e vão com fim de linha LF;
  - o Dockerfile aponta para arquivos que existem;
  - o Caddyfile de dentro separa o tráfego como o do VPS, nas mesmas portas
    que a entrada usa para a API e o Relé, e o healthcheck bate numa rota real.
"""
import fnmatch
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.dont_write_bytecode = True
import sobe_vps  # noqa: E402

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def ler(rel):
    with open(os.path.join(RAIZ, rel), 'rb') as f:
        return f.read().decode('utf-8')


def arquivos():
    r = subprocess.run(['git', '-C', RAIZ, 'ls-files', '--cached', '--others', '--exclude-standard'],
                       capture_output=True, text=True, encoding='utf-8')
    return [l for l in r.stdout.splitlines() if l.strip()]


def regex_docker(padrao):
    """Um padrão do .dockerignore em regex: `**/` é qualquer profundidade, `*`
    não atravessa `/`, e um diretório casa com tudo o que tem dentro."""
    rx = ''
    i = 0
    while i < len(padrao):
        if padrao.startswith('**/', i):
            rx += '(?:.*/)?'
            i += 3
        elif padrao[i] == '*':
            rx += '[^/]*'
            i += 1
        elif padrao[i] == '?':
            rx += '[^/]'
            i += 1
        else:
            rx += re.escape(padrao[i])
            i += 1
    return re.compile('^' + rx + '(?:/.*)?$')


def fica_no_docker(caminho, regras):
    return not any(r.match(caminho) for r in regras)


def fica_no_pacote(caminho):
    for p in sobe_vps.FORA:
        if '*' in p:
            if fnmatch.fnmatchcase(caminho, p):
                return False
        elif caminho == p or caminho.startswith(p + '/'):
            return False
    return True


def main():
    todos = arquivos()
    padroes = [l.strip() for l in ler('.dockerignore').splitlines() if l.strip() and not l.strip().startswith('#')]
    regras = [regex_docker(p) for p in padroes]
    na_imagem = {f for f in todos if fica_no_docker(f, regras)}
    no_pacote = {f for f in todos if fica_no_pacote(f)}
    so_imagem = sorted(na_imagem - no_pacote)
    so_pacote = sorted(no_pacote - na_imagem)
    check('a imagem leva o mesmo conteúdo do pacote do VPS (o que tests/pacote_servido.py prova)',
          not so_imagem and not so_pacote,
          'só na imagem: %s | só no pacote: %s' % (so_imagem[:5], so_pacote[:5]))
    check('nada de testes, ferramentas, documentação ou .git na imagem',
          not any(f.split('/')[0] in ('tests', 'tools', 'docs', '.git', '.claude') for f in na_imagem))
    check('nem os embutidos que o jogo servido não carrega',
          not any(re.match(r'^assets/embedded/(models-|env-kit|muro-|sprites-)', f) for f in na_imagem))
    check('o bundle de modelos entra (é dele que o jogo servido carrega)',
          sum(1 for f in na_imagem if f.startswith('assets/models/bundle/')) > 20)

    scripts = ['servidor/coolify/entrada.sh', 'servidor/coolify/admin.sh', 'servidor/coolify/backup.sh']
    for s in scripts:
        existe = os.path.isfile(os.path.join(RAIZ, s))
        cru = open(os.path.join(RAIZ, s), 'rb').read() if existe else b''
        r = subprocess.run(['sh', '-n', os.path.join(RAIZ, s)], capture_output=True, text=True) if existe else None
        check('%s existe, passa no sh -n e tem fim de linha LF' % s,
              existe and r.returncode == 0 and b'\r' not in cru and cru.startswith(b'#!/bin/sh'),
              (r.stderr.strip() if r else 'não existe'))
        eol = subprocess.run(['git', '-C', RAIZ, 'check-attr', 'eol', '--', s], capture_output=True, text=True).stdout
        check('%s fica LF no git mesmo com autocrlf (.gitattributes)' % s, eol.strip().endswith('lf'), eol.strip())
    eol = subprocess.run(['git', '-C', RAIZ, 'check-attr', 'eol', '--', 'Dockerfile'], capture_output=True, text=True).stdout
    check('o Dockerfile fica LF no git', eol.strip().endswith('lf'), eol.strip())

    df = ler('Dockerfile')
    check('o Dockerfile parte do Caddy oficial e instala python3, websockets, sqlite, su-exec e tini',
          df.startswith('#') and re.search(r'^FROM caddy:2-alpine\s*$', df, re.M) is not None and
          all(p in df for p in ['python3', 'py3-websockets', 'sqlite', 'su-exec', 'tini']))
    check('o Dockerfile roda a entrada que existe, e o admin vira comando',
          '/app/servidor/coolify/entrada.sh' in df and 'ln -s /app/servidor/coolify/admin.sh /usr/local/bin/admin' in df)
    check('o Dockerfile NÃO declara VOLUME (sem o volume do Coolify a entrada recusa subir)',
          re.search(r'^\s*VOLUME\b', df, re.M) is None)

    entrada = ler('servidor/coolify/entrada.sh')
    dentro = ler('servidor/coolify/Caddyfile')
    fora = ler('servidor/Caddyfile')
    check('a entrada recusa subir sem /dados montado', 'grep -qs " $DADOS " /proc/mounts' in entrada and 'exit 1' in entrada)
    check('a entrada põe a API na 8300 e o Relé na 8791, sem root (su-exec soterra)',
          '--porta 8300' in entrada and '--porta 8791' in entrada and 'su-exec soterra' in entrada)
    check('o Caddy de dentro escuta em :80, sem HTTPS próprio (o do Coolify manda)',
          re.search(r'^:80 \{', dentro, re.M) is not None and 'auto_https off' in dentro)
    for diretiva in ['encode zstd gzip', 'redir / /site/ 302', 'handle /api/* {', 'reverse_proxy 127.0.0.1:8300',
                     'reverse_proxy /ws 127.0.0.1:8791', 'file_server']:
        check('o Caddy de dentro tem "%s", como o do VPS' % diretiva, diretiva in dentro and diretiva in fora)
    check('o Caddy de dentro serve a pasta onde o Dockerfile põe o jogo (/srv/soterra)',
          'root * /srv/soterra' in dentro and 'COPY . /srv/soterra' in df)
    api = ler('servidor/api.py')
    check('o healthcheck bate numa rota real da API (/api/saude)',
          '/api/saude' in df and "('GET',  '/api/saude')" in api)
    admin = ler('servidor/coolify/admin.sh')
    check('o admin usa as colunas que o banco tem (contas.gm, contas.banido, eventos.criado_em)',
          all(c in api for c in ['gm         INTEGER', 'banido     INTEGER', 'criado_em INTEGER']) and
          'set $1 = $2 where nome' in admin and 'e.criado_em' in admin)

    check('o healthcheck responde rápido (o deploy do Coolify espera ~1 min)',
          '--interval=10s' in df and '--start-period=20s' in df)
    check('a pasta servida não guarda o Dockerfile nem o compose que o Coolify reescreve',
          'rm -f /srv/soterra/Dockerfile' in df and '/srv/soterra/docker-compose.yaml' in df and '/srv/soterra/.env' in df)
    check('o admin exige o NOME inteiro num argumento só', '[ $# -eq 2 ]' in admin)
    check('o backup leva data e hora (um de tarde não apaga o da madrugada)',
          'date +%F-%H%M%S' in ler('servidor/coolify/backup.sh'))
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
