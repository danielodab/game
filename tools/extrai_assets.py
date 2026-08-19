#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — tira os modelos de dentro do JavaScript.

POR QUE ISTO EXISTE
-------------------
O jogo abre por `file://`, onde `fetch` de `.glb` falha. A saida foi embutir
todo modelo como base64 dentro de `assets/embedded/*.js`. Funciona — e custa:

  · base64 e ~33% MAIOR que o binario;
  · o motor de JS tem de INTERPRETAR o arquivo inteiro como codigo-fonte
    antes de a primeira linha rodar;
  · a string vive em UTF-16 na memoria, entao 28 MB de texto viram ~56 MB de
    heap, e o `atob` cria mais uma copia binaria por cima.

Num celular isso e uma tela preta de varios segundos. Este script escreve os
`.glb`/`.png` DE VERDADE em `assets/models/bundle/`, e `js/assets_bundle.js`
os busca por `fetch` quando o jogo esta servido (http:// ou dentro do APK),
caindo para o embutido quando o usuario abre o `index.html` com dois cliques.

O QUE ELE LE
------------
Os arquivos `assets/embedded/env-kit.js` e `assets/embedded/models-*.js`, no
formato `JOGO.ALVO['chave']='base64';`. NAO mexe em `fx-*.js` nem em
`sprites-*.js` (dono diferente / fora do Git).

USO
---
    python tools/extrai_assets.py            # extrai e escreve o manifesto
    python tools/extrai_assets.py --conferir # so confere se esta em dia
"""

import base64
import binascii
import json
import os
import re
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEM = os.path.join(RAIZ, 'assets', 'embedded')
DESTINO = os.path.join(RAIZ, 'assets', 'models', 'bundle')
MANIFESTO = os.path.join(DESTINO, 'manifest.json')

# Os arquivos que participam. `fx-atlas.js` e `fx-placas.js` ficam de fora de
# proposito: sao 0,8 MB somados, tem outro dono, e o ganho nao paga o conflito.
FONTES = ['env-kit.js', 'models-anims.js', 'models-heroes.js', 'models-meshy.js',
          'models-monsters.js', 'models-bosses.js', 'models-summons.js']

# JOGO.MODELS['barbarian']='Z2xU...';   /   JOGO.ASSETS['barrel'] = 'Z2xU...';
RE_ITEM = re.compile(
    r"JOGO\.(MODELS|ASSETS)\[\s*'([^']+)'\s*\]\s*=\s*'([A-Za-z0-9+/=\s']*?)'\s*;",
    re.S)
# JOGO.MESHY_CLIPS['meshy_sumo']=['idle','walk'];
RE_CLIPS = re.compile(r"JOGO\.MESHY_CLIPS\[\s*'([^']+)'\s*\]\s*=\s*\[([^\]]*)\]\s*;")

# Alguns embutidos quebram a string em pedacos concatenados com ' + ' para nao
# estourar o limite de linha do editor. Juntar e so tirar as aspas e o mais.
RE_COLA = re.compile(r"'\s*\+\s*'")


def extensao(bruto):
    """Descobre o formato pelo cabecalho — nao confia no nome."""
    if bruto[:4] == b'glTF':
        return '.glb'
    if bruto[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if bruto[:3] == b'\xff\xd8\xff':
        return '.jpg'
    if bruto[:1] == b'{':
        return '.gltf'
    return '.bin'


def le_fonte(caminho):
    with open(caminho, 'r', encoding='utf-8') as f:
        texto = f.read()
    itens = []
    for m in RE_ITEM.finditer(texto):
        alvo, chave, b64 = m.group(1), m.group(2), m.group(3)
        limpo = RE_COLA.sub('', b64)
        limpo = re.sub(r'\s+', '', limpo)
        try:
            bruto = base64.b64decode(limpo)
        except (binascii.Error, ValueError) as e:
            raise SystemExit('base64 invalido em %s[%r]: %s' % (alvo, chave, e))
        itens.append((alvo, chave, bruto, len(limpo)))
    clipes = {}
    for m in RE_CLIPS.finditer(texto):
        clipes[m.group(1)] = re.findall(r"'([^']*)'", m.group(2))
    return itens, clipes


def principal(conferir=False):
    if not os.path.isdir(ORIGEM):
        raise SystemExit('nao achei %s' % ORIGEM)

    manifesto = {
        'gerado': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'ferramenta': 'tools/extrai_assets.py',
        'base': 'assets/models/bundle/',
        'itens': [],
        'meshyClips': {},
    }
    total_b64 = 0
    total_bin = 0
    escritos = 0
    faltando = []

    for nome in FONTES:
        caminho = os.path.join(ORIGEM, nome)
        if not os.path.isfile(caminho):
            print('  (pulando %s — nao existe)' % nome)
            continue
        pasta = os.path.splitext(nome)[0]
        itens, clipes = le_fonte(caminho)
        manifesto['meshyClips'].update(clipes)
        destino_pasta = os.path.join(DESTINO, pasta)
        if not conferir:
            os.makedirs(destino_pasta, exist_ok=True)
        for alvo, chave, bruto, n_b64 in itens:
            ext = extensao(bruto)
            # a chave vira nome de arquivo: so o que sobrevive a qualquer sistema
            seguro = re.sub(r'[^A-Za-z0-9._-]', '_', chave)
            rel = pasta + '/' + seguro + ext
            fis = os.path.join(DESTINO, pasta, seguro + ext)
            total_b64 += n_b64
            total_bin += len(bruto)
            manifesto['itens'].append({
                'alvo': alvo, 'chave': chave, 'arquivo': rel, 'bytes': len(bruto),
            })
            if conferir:
                if not os.path.isfile(fis) or os.path.getsize(fis) != len(bruto):
                    faltando.append(rel)
                continue
            antigo = None
            if os.path.isfile(fis) and os.path.getsize(fis) == len(bruto):
                with open(fis, 'rb') as f:
                    antigo = f.read()
            if antigo != bruto:
                with open(fis, 'wb') as f:
                    f.write(bruto)
                escritos += 1
        print('  %-22s %3d itens' % (nome, len(itens)))

    manifesto['totalBytes'] = total_bin
    manifesto['totalBase64'] = total_b64

    if conferir:
        if faltando:
            print('FALTANDO %d arquivo(s): %s' % (len(faltando), ', '.join(faltando[:5])))
            return 1
        print('em dia — %d itens, %.2f MB' % (len(manifesto['itens']), total_bin / 1048576.0))
        return 0

    with open(MANIFESTO, 'w', encoding='utf-8') as f:
        json.dump(manifesto, f, ensure_ascii=False, indent=1)

    print('')
    print('  itens ................ %d' % len(manifesto['itens']))
    print('  arquivos reescritos .. %d' % escritos)
    print('  base64 no .js ........ %.2f MB' % (total_b64 / 1048576.0))
    print('  binario em disco ..... %.2f MB' % (total_bin / 1048576.0))
    print('  economia ............. %.2f MB (%.0f%%)' % (
        (total_b64 - total_bin) / 1048576.0,
        100.0 * (total_b64 - total_bin) / total_b64 if total_b64 else 0))
    print('  manifesto ............ %s' % os.path.relpath(MANIFESTO, RAIZ))
    return 0


if __name__ == '__main__':
    sys.exit(principal('--conferir' in sys.argv))
