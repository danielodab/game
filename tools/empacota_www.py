#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — monta a pasta `www/` que vira o aplicativo de Android.

O APLICATIVO ABRE O JOGO DO SERVIDOR (04/10, decisao do dono)
-------------------------------------------------------------
O codigo do jogo NAO vai mais dentro do aplicativo: o `server.url` do
capacitor.config.json aponta para o servidor do jogo, e o celular passa a
atualizar junto com a web, na hora, sem esperar a revisao da loja a cada
mudanca de regra.

Entao a www/ PADRAO e UM arquivo: `app/index.html`, a tela "sem conexao" que
o Capacitor mostra quando o servidor nao responde (`server.errorPath`), com o
endereco do servidor escrito nela. Tem de ser um arquivo so: com o
`server.url` ligado, o Capacitor entrega do pacote apenas o endereco exato
dessa pagina.

Os tres arquivos do Capacitor que o js/mobile.js carrega (botao voltar,
segundo plano, tela acesa) agora sao servidos pelo SERVIDOR, de
`vendor/capacitor/` — versionados no Git. Este script confere que eles sao os
mesmos do node_modules (a parte nativa e a parte JS tem de ser da mesma
versao) e recusa montar se nao forem.

O ENDERECO DO SERVIDOR e a constante SERVIDOR logo abaixo — o unico lugar
onde ele se decide. O capacitor.config.json o repete (o Capacitor le de la), e
este script recusa montar se os dois nao baterem.

O JEITO ANTIGO: --embutida
--------------------------
`--embutida` monta a www/ com o CODIGO DO JOGO dentro (index.html, css/, js/,
vendor/, os embutidos, as tabelas, o site/) e a linha
`window.SOTERRA_APP = { servidor: ... }` no js/versao.js, por onde o jogo
acha a API, o rele e os modelos. E a saida se um dia a loja recusar o jogo
servido: tire `url` e `errorPath` do capacitor.config.json e use esta opcao.
Os modelos (assets/models/bundle, ~246 MB) nao entram em nenhum dos dois
jeitos: passam do que a loja deixa baixar de inicio.

USO
---
    npm install                       # uma vez: traz o Capacitor
    python tools/empacota_www.py      # monta a www/ (a tela "sem conexao")
    npx cap sync android              # leva para o projeto Android

`www/` fica FORA do Git (e gerada; ver .gitignore).
"""

import argparse
import json
import os
import re
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(RAIZ, 'www')

# Arquivos soltos na raiz que o aplicativo precisa.
ARQUIVOS = ['index.html']

# Pastas inteiras. `assets/embedded` NAO entra em peso (os models-*.js o APK
# nao usa): so os embutidos que o index.html pede no caminho SERVIDO — a
# mesma leitura do build (servidor/coolify/versao.py, lista_de_carga). Antes
# era uma lista escrita a mao com 2 arquivos, e o APK pedia 8: sons, icones
# de item e de extras, a coroa em PNG e dois efeitos davam 404 no aparelho.
#
# `assets/models/bundle` NAO entra (ver o cabecalho): so as tabelas dos
# cenarios, que o index.html le como script do proprio pacote. `site/` entra
# porque e a porta da conta: o jogo manda para site/conta.html quem nao entrou.
PASTAS = ['css', 'js', 'vendor', 'assets/models/bundle/tabelas', 'site']

# ============================================================================
#  O SERVIDOR DO JOGO, visto do aplicativo — O UNICO LUGAR ONDE ISTO SE ESCREVE
#  (o mesmo endereco do "Domains" do Coolify, em servidor/SUBIR.md). Sem barra
#  no fim. Se o dominio mudar: troque aqui, rode este script e gere outro AAB.
# ============================================================================
SERVIDOR = 'https://soterra.viidoo.io'

# Os arquivos do Capacitor que o js/mobile.js carrega DENTRO do aplicativo
# (botao voltar, segundo plano, tela acesa). Saem do node_modules e moram em
# vendor/capacitor/, de onde o servidor os entrega; a web nunca os pede.
CAPACITOR = [
    ('node_modules/@capacitor/core/dist/capacitor.js', 'capacitor.js'),
    ('node_modules/@capacitor/app/dist/plugin.js', 'app.js'),
    ('node_modules/@capacitor-community/keep-awake/dist/plugin.js', 'keep-awake.js'),
]

# A Play recusa o que passa disto no download inicial. A www/ fica muito
# abaixo; a trava e para o dia em que alguem puser os modelos de volta.
LIMITE_MB = 150


def lista_servida():
    """O que o index.html servido pede (a lista do build), ou (None, erro)."""
    sys.path.insert(0, os.path.join(RAIZ, 'servidor', 'coolify'))
    import versao  # noqa: E402
    return versao.lista_de_carga(RAIZ)


def tamanho(caminho):
    total = 0
    for base, _, arqs in os.walk(caminho):
        for a in arqs:
            total += os.path.getsize(os.path.join(base, a))
    return total


def apaga_www(www):
    """So apaga o que e seguro apagar: pasta vazia ou uma www/ montada antes."""
    if os.path.isdir(www):
        if os.listdir(www) and not os.path.isfile(os.path.join(www, 'index.html')):
            print('RECUSO apagar %s: nao esta vazia e nao parece uma www/ deste script' % www)
            return False
        shutil.rmtree(www)
    os.makedirs(www)
    return True


def casca(www, servidor):
    """A www/ padrao: so a tela "sem conexao", com o endereco do servidor."""
    # o Capacitor le o endereco do capacitor.config.json: tem de ser o mesmo daqui
    with open(os.path.join(RAIZ, 'capacitor.config.json'), encoding='utf-8') as f:
        cfg = json.load(f).get('server') or {}
    if cfg.get('url') != servidor or cfg.get('errorPath') != 'index.html':
        print('capacitor.config.json nao bate com este script:')
        print('    server.url       = %r   (esperado %r)' % (cfg.get('url'), servidor))
        print('    server.errorPath = %r   (esperado %r)' % (cfg.get('errorPath'), 'index.html'))
        return 1
    # a parte JS dos plugins (servida pelo servidor) tem de ser a do node_modules (a nativa)
    velhos = []
    for origem, nome in CAPACITOR:
        try:
            with open(os.path.join(RAIZ, *origem.split('/')), 'rb') as f1, \
                 open(os.path.join(RAIZ, 'vendor', 'capacitor', nome), 'rb') as f2:
                if f1.read().replace(b'\r\n', b'\n') != f2.read().replace(b'\r\n', b'\n'):
                    velhos.append(nome)
        except OSError:
            velhos.append(nome)
    if velhos:
        print('vendor/capacitor/ esta diferente do node_modules: %s' % ', '.join(velhos))
        print('Copie de novo (e publique na web ANTES de enviar o aplicativo):')
        for origem, nome in CAPACITOR:
            print('    cp %s vendor/capacitor/%s' % (origem, nome))
        return 1
    with open(os.path.join(RAIZ, 'app', 'index.html'), encoding='utf-8') as f:
        pagina = f.read()
    if pagina.count("'__SERVIDOR__'") != 1:
        print("app/index.html: esperava UMA marca '__SERVIDOR__' para trocar pelo endereco")
        return 1
    # a pagina e servida sozinha: nada de arquivo a parte (ver o comentario dela)
    if re.search(r'<(script|img|link)[^>]+(src|href)=', pagina):
        print('app/index.html pede um arquivo a parte; ela tem de ser um arquivo so')
        return 1
    if not apaga_www(www):
        return 1
    with open(os.path.join(www, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(pagina.replace("'__SERVIDOR__'", json.dumps(servidor)))
    print('')
    print('  www/ montada em %s' % www)
    print('    index.html (a tela "sem conexao")  %7.1f KB' % (tamanho(www) / 1024.0))
    print('    o jogo abre de:                    %s' % servidor)
    print('')
    print('  Proximo passo:  npx cap sync android')
    return 0


def principal(argv=None):
    ap = argparse.ArgumentParser(description='monta a pasta www/ do APK')
    ap.add_argument('--saida', default=WWW,
                    help='onde montar (padrao: www/ na raiz; so apaga pasta vazia ou uma www/ antiga)')
    ap.add_argument('--servidor', default=SERVIDOR,
                    help='o servidor do jogo (padrao: a constante SERVIDOR, %s)' % SERVIDOR)
    ap.add_argument('--embutida', action='store_true',
                    help='o jeito antigo: o codigo do jogo vai DENTRO do aplicativo (ver o cabecalho)')
    a = ap.parse_args(argv)
    www = os.path.abspath(a.saida)
    servidor = a.servidor.rstrip('/')
    # https e so https: o aplicativo recusa conteudo misto, e a senha passa por aqui
    if not re.match(r'^https://[A-Za-z0-9.-]+(:[0-9]+)?$', servidor):
        print('SERVIDOR invalido: %r — tem de ser https://dominio, sem caminho' % servidor)
        return 1
    sem_cap = [o for o, _ in CAPACITOR if not os.path.isfile(os.path.join(RAIZ, *o.split('/')))]
    if sem_cap:
        print('FALTA o Capacitor no node_modules (%s). Rode antes:' % sem_cap[0])
        print('    npm install')
        return 1

    if not a.embutida:
        return casca(www, servidor)

    pedidos, erro = lista_servida()
    if erro:
        print('NAO li a lista de carga do index.html: ' + erro)
        return 1
    embutidos = sorted(f for f in pedidos if f.startswith('assets/embedded/'))
    sem_disco = [e for e in embutidos if not os.path.isfile(os.path.join(RAIZ, *e.split('/')))]
    if sem_disco:
        print('FALTAM no disco %d embutido(s) que o index.html pede: %s' % (len(sem_disco), ', '.join(sem_disco)))
        return 1

    if not apaga_www(www):
        return 1

    for a in ARQUIVOS:
        shutil.copy2(os.path.join(RAIZ, a), os.path.join(www, a))
    for p in PASTAS:
        origem = os.path.join(RAIZ, *p.split('/'))
        if not os.path.isdir(origem):
            print('  (pulando %s — nao existe)' % p)
            continue
        shutil.copytree(origem, os.path.join(www, *p.split('/')))
    for e in embutidos:
        d = os.path.join(www, *e.split('/'))
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(os.path.join(RAIZ, *e.split('/')), d)

    # os tres arquivos do Capacitor, onde o js/mobile.js os procura
    destino_cap = os.path.join(www, 'vendor', 'capacitor')
    os.makedirs(destino_cap, exist_ok=True)
    for origem, nome in CAPACITOR:
        shutil.copy2(os.path.join(RAIZ, *origem.split('/')), os.path.join(destino_cap, nome))

    # A LINHA DO APLICATIVO: o js/versao.js do git ('dev', sem mapa) mais o
    # endereco do servidor. json.dumps escreve a string com aspas e escapes.
    with open(os.path.join(www, 'js', 'versao.js'), 'a', encoding='utf-8', newline='\n') as f:
        f.write('\n// Gravado por tools/empacota_www.py: so existe na www/ do aplicativo.\n')
        f.write('window.SOTERRA_APP = { servidor: %s };\n' % json.dumps(servidor))

    # `tests/save_sandbox.js` entra porque o index.html o pede quando alguem
    # abre com `?sandbox=1`. Sao 4 KB e evita um 404 no aparelho.
    destino_testes = os.path.join(www, 'tests')
    os.makedirs(destino_testes, exist_ok=True)
    shutil.copy2(os.path.join(RAIZ, 'tests', 'save_sandbox.js'),
                 os.path.join(destino_testes, 'save_sandbox.js'))

    # a conferencia: todo arquivo que o index.html servido pede esta na www/
    fora = [f for f in pedidos if not os.path.isfile(os.path.join(www, *f.split('/')))]
    if fora:
        print('FALTAM na www/ %d arquivo(s) que o index.html servido pede: %s'
              % (len(fora), ', '.join(fora[:8])))
        return 1

    print('')
    print('  www/ montada em %s' % www)
    print('    %d arquivos da lista de carga, todos na www/ (%d embutidos)' % (len(pedidos), len(embutidos)))
    for p in ['js', 'css', 'vendor', 'site', 'assets/models/bundle', 'assets/embedded']:
        d = os.path.join(www, *p.split('/'))
        if os.path.isdir(d):
            print('    %-24s %7.2f MB' % (p, tamanho(d) / 1048576.0))
    total = tamanho(www) / 1048576.0
    print('    %-24s %7.2f MB' % ('TOTAL', total))
    print('    servidor do jogo:        %s' % servidor)
    if total > LIMITE_MB:
        print('')
        print('  PESADA DEMAIS: %.0f MB passa dos %d MB que cabem com folga na Play.' % (total, LIMITE_MB))
        return 1
    print('')
    print('  Proximo passo:  npx cap sync android')
    return 0


if __name__ == '__main__':
    sys.exit(principal())
