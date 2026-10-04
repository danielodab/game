#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — monta a pasta `www/` que vira o aplicativo de Android.

POR QUE NAO APONTAR O CAPACITOR PARA A RAIZ
-------------------------------------------
`webDir: "."` funcionaria, e empacotaria no telefone o repositorio inteiro:
`.git`, `docs/`, `unity/`, as paginas de `tests/`, os modelos originais e os
`assets/embedded/models-*.js` que o aplicativo NAO USA.

POR QUE OS MODELOS NAO VAO NO PACOTE
------------------------------------
A Google Play limita o que o aplicativo baixa de inicio (200 MB), e
`assets/models/bundle` passa disso sozinho (~246 MB). Entao o aplicativo abre
so com o codigo e a interface, e baixa os modelos do SERVIDOR DO JOGO, sob
demanda, exatamente como a web faz (`js/assets_bundle.js`): a base antes do
menu, cada calabouco na hora de descer.

Para isso a www/ leva um `js/versao.js` com UMA linha a mais:

    window.SOTERRA_APP = { servidor: 'https://...' }

E so por ela que o jogo sabe que esta no aplicativo e onde moram a API
(`js/core/sessao.js`, `site/site.js`), o rele (`js/core/rede.js`) e os modelos
(`js/assets_bundle.js`). Na web essa linha nao existe, e nada muda la.

O ENDERECO DO SERVIDOR e a constante SERVIDOR logo abaixo — o unico lugar.

O QUE ENTRA
-----------
index.html, css/, js/, vendor/, os embutidos que o index.html servido pede, as
tabelas dos cenarios (`assets/models/bundle/tabelas/`, 44 KB), o `site/` (e por
ele que se entra na conta) e os tres arquivos do Capacitor que o jogo carrega
de `vendor/capacitor/` (copiados do node_modules).

USO
---
    npm install                       # uma vez: traz o Capacitor
    python tools/empacota_www.py      # monta a www/
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
# (botao voltar, segundo plano, tela acesa). Saem do node_modules e so existem
# na www/: a web nunca os pede.
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


def principal(argv=None):
    ap = argparse.ArgumentParser(description='monta a pasta www/ do APK')
    ap.add_argument('--saida', default=WWW,
                    help='onde montar (padrao: www/ na raiz; so apaga pasta vazia ou uma www/ antiga)')
    ap.add_argument('--servidor', default=SERVIDOR,
                    help='o servidor do jogo (padrao: a constante SERVIDOR, %s)' % SERVIDOR)
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

    pedidos, erro = lista_servida()
    if erro:
        print('NAO li a lista de carga do index.html: ' + erro)
        return 1
    embutidos = sorted(f for f in pedidos if f.startswith('assets/embedded/'))
    sem_disco = [e for e in embutidos if not os.path.isfile(os.path.join(RAIZ, *e.split('/')))]
    if sem_disco:
        print('FALTAM no disco %d embutido(s) que o index.html pede: %s' % (len(sem_disco), ', '.join(sem_disco)))
        return 1

    if os.path.isdir(www):
        # so apaga o que e seguro apagar: pasta vazia ou uma www/ montada antes
        if os.listdir(www) and not os.path.isfile(os.path.join(www, 'index.html')):
            print('RECUSO apagar %s: nao esta vazia e nao parece uma www/ deste script' % www)
            return 1
        shutil.rmtree(www)
    os.makedirs(www)

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
