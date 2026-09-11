#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — monta a pasta `www/` que vira o APK.

POR QUE NAO APONTAR O CAPACITOR PARA A RAIZ
-------------------------------------------
`webDir: "."` funcionaria, e empacotaria no telefone o repositorio inteiro:
`.git`, `docs/`, `unity/`, as 55 paginas de `tests/`, os 42 MB de modelos
originais em `assets/models/kaykit_*` — e, pior, os 28 MB de
`assets/embedded/models-*.js` que o aplicativo NAO USA.

Nao usa porque dentro do APK o Capacitor serve os arquivos por
`https://localhost`, e nesse endereco `js/assets_bundle.js` busca os `.glb` de
verdade. O base64 embutido so existe para o caso `file://`, que e o duplo
clique no computador — e esse caso nao existe dentro do telefone.

MEDIDO: a pasta `www/` sai por volta de 24 MB, contra ~100 MB do repositorio.

USO
---
    python tools/extrai_assets.py     # 1) garante os .glb de verdade
    python tools/empacota_www.py      # 2) monta a www/
    npx cap sync android              # 3) leva para o projeto Android

`www/` fica FORA do Git (e gerada; ver .gitignore).
"""

import argparse
import json
import os
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
PASTAS = ['css', 'js', 'vendor', 'assets/models/bundle']


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
    a = ap.parse_args(argv)
    www = os.path.abspath(a.saida)
    manifesto = os.path.join(RAIZ, 'assets', 'models', 'bundle', 'manifest.json')
    if not os.path.isfile(manifesto):
        print('FALTA o manifesto dos modelos. Rode antes:')
        print('    python tools/extrai_assets.py')
        return 1
    with open(manifesto, encoding='utf-8') as f:
        man = json.load(f)
    faltando = [i['arquivo'] for i in man['itens']
                if not os.path.isfile(os.path.join(RAIZ, 'assets', 'models', 'bundle', i['arquivo']))]
    if faltando:
        print('FALTAM %d modelo(s) extraidos, comecando por %s' % (len(faltando), faltando[0]))
        print('Rode:  python tools/extrai_assets.py')
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
    for p in ['js', 'css', 'vendor', 'assets/models/bundle', 'assets/embedded']:
        d = os.path.join(www, *p.split('/'))
        if os.path.isdir(d):
            print('    %-24s %7.2f MB' % (p, tamanho(d) / 1048576.0))
    print('    %-24s %7.2f MB' % ('TOTAL', tamanho(www) / 1048576.0))
    print('')
    print('  Proximo passo:  npx cap sync android')
    return 0


if __name__ == '__main__':
    sys.exit(principal())
