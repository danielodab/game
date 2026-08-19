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

import json
import os
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(RAIZ, 'www')

# Arquivos soltos na raiz que o aplicativo precisa.
ARQUIVOS = ['index.html']

# Pastas inteiras. `assets/embedded` NAO entra em peso: so os dois atlas de
# efeito, que continuam embutidos de proposito (0,8 MB, outro dono).
PASTAS = ['css', 'js', 'vendor', 'assets/models/bundle']
EMBUTIDOS_QUE_FICAM = ['assets/embedded/fx-atlas.js', 'assets/embedded/fx-placas.js']


def tamanho(caminho):
    total = 0
    for base, _, arqs in os.walk(caminho):
        for a in arqs:
            total += os.path.getsize(os.path.join(base, a))
    return total


def principal():
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

    if os.path.isdir(WWW):
        shutil.rmtree(WWW)
    os.makedirs(WWW)

    for a in ARQUIVOS:
        shutil.copy2(os.path.join(RAIZ, a), os.path.join(WWW, a))
    for p in PASTAS:
        origem = os.path.join(RAIZ, *p.split('/'))
        if not os.path.isdir(origem):
            print('  (pulando %s — nao existe)' % p)
            continue
        shutil.copytree(origem, os.path.join(WWW, *p.split('/')))
    destino_emb = os.path.join(WWW, 'assets', 'embedded')
    os.makedirs(destino_emb, exist_ok=True)
    for e in EMBUTIDOS_QUE_FICAM:
        o = os.path.join(RAIZ, *e.split('/'))
        if os.path.isfile(o):
            shutil.copy2(o, os.path.join(destino_emb, os.path.basename(e)))

    # `tests/save_sandbox.js` entra porque o index.html o pede quando alguem
    # abre com `?sandbox=1`. Sao 4 KB e evita um 404 no aparelho.
    destino_testes = os.path.join(WWW, 'tests')
    os.makedirs(destino_testes, exist_ok=True)
    shutil.copy2(os.path.join(RAIZ, 'tests', 'save_sandbox.js'),
                 os.path.join(destino_testes, 'save_sandbox.js'))

    print('')
    print('  www/ montada em %s' % WWW)
    for p in ['js', 'css', 'vendor', 'assets/models/bundle', 'assets/embedded']:
        d = os.path.join(WWW, *p.split('/'))
        if os.path.isdir(d):
            print('    %-24s %7.2f MB' % (p, tamanho(d) / 1048576.0))
    print('    %-24s %7.2f MB' % ('TOTAL', tamanho(WWW) / 1048576.0))
    print('')
    print('  Proximo passo:  npx cap sync android')
    return 0


if __name__ == '__main__':
    sys.exit(principal())
