#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""As miniaturas dos ícones do jogo para a wiki do site (11/09).

    python tools/icones_site.py

Lê os ícones embutidos do jogo (arte do dono, PNG de 128 px com alfa):
  assets/embedded/icones-itens.js    JOGO.ICONES_ITENS['<id do item>'] = '<png base64>'
  assets/embedded/icones-extras.js   JOGO.ICONES_EXTRAS['<id>']        (pedras, selos, insígnia, vintém)
e grava em site/img/:
  item-<id>.webp    um por item
  extra-<id>.webp   um por extra
em 96 px no lado maior (a wiki mostra em 48 px; 96 fica nítido em tela de
celular). Sem os 2,5 MB do embutido: a wiki pede só o ícone que mostra.

Os da Panóplia do Mestre (gm-*) ficam de fora: o Mestre não aparece no site.
Rodar de novo depois de embutir ícone novo (tools/embute_icones_itens.py e
tools/embute_icones_extras.py); miniatura que sobrou de um id que saiu é
apagada.
"""
import base64
import io
import os
import re
import sys

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
DESTINO = os.path.join(RAIZ, 'site', 'img')
LADO = 96
FONTES = [
    ('item', os.path.join(RAIZ, 'assets', 'embedded', 'icones-itens.js'), 'ICONES_ITENS'),
    ('extra', os.path.join(RAIZ, 'assets', 'embedded', 'icones-extras.js'), 'ICONES_EXTRAS'),
]


def extrai(caminho, variavel):
    with open(caminho, encoding='utf-8', errors='replace') as f:
        texto = f.read()
    padrao = r"JOGO\.%s\['([a-z0-9-]+)'\]\s*=\s*'(?:data:image/[a-z]+;base64,)?([A-Za-z0-9+/=]+)'" % variavel
    return re.findall(padrao, texto)


def main():
    os.makedirs(DESTINO, exist_ok=True)
    feitos, total = set(), 0
    for prefixo, caminho, variavel in FONTES:
        pares = extrai(caminho, variavel)
        if not pares:
            print('nenhum ícone lido de %s (%s)' % (os.path.relpath(caminho, RAIZ), variavel))
            return 1
        n = 0
        for id_, b64 in pares:
            if id_.startswith('gm-'):
                continue                      # a Panóplia do Mestre não vai ao site
            img = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')
            img.thumbnail((LADO, LADO), Image.LANCZOS)
            nome = '%s-%s.webp' % (prefixo, id_)
            img.save(os.path.join(DESTINO, nome), 'WEBP', quality=86, method=6)
            feitos.add(nome)
            total += os.path.getsize(os.path.join(DESTINO, nome))
            n += 1
        print('%s: %d miniaturas' % (prefixo, n))
    # a miniatura de um id que saiu do jogo não fica para trás
    for nome in os.listdir(DESTINO):
        if re.match(r'^(item|extra)-[a-z0-9-]+\.webp$', nome) and nome not in feitos:
            os.remove(os.path.join(DESTINO, nome))
            print('apagada (o id saiu do jogo): ' + nome)
    print('%d arquivos, %.0f KB em site/img/' % (len(feitos), total / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
