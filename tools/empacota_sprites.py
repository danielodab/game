# -*- coding: utf-8 -*-
"""
Empacota os recortes de um personagem num módulo JS com as imagens embutidas.

Uso:  python tools/empacota_sprites.py sumo

Por que embutir em base64: o jogo precisa abrir com duplo clique (file://), e nesse
modo o navegador recusa carregar PNG solto para dentro do WebGL. Embutido, funciona.

Saída: assets/embedded/sprites-<classe>.js  (fora do Git, por licença de arte)
"""
import base64
import io
import json
import os
import sys

from PIL import Image

ALTURA = 300          # altura final de cada pose, em pixels
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Como as poses recortadas viram nomes de pose+direção.
# Cada folha do usuário traz 2 fileiras de 5: a varredura vai de frente a frente,
# passando por perfil, costas e o outro perfil.
DIRECOES = ['frente', 'perfil-esq', 'costas', 'perfil-dir', 'frente-b']

MAPA = {
    # arquivo base : (fase da fileira 1, fase da fileira 2)
    'sumo':  ('parado', 'andar_a'),
    'sumo1': ('parado_b', 'andar_b'),
    'sumo2': ('atacar', 'dano'),
}
ESPECIAIS = {'sumo_morte_vitoria_01': 'vitoria', 'sumo_morte_vitoria_02': 'morte'}


def carrega(caminho):
    im = Image.open(caminho).convert('RGBA')
    escala = ALTURA / im.height
    im = im.resize((max(1, int(im.width * escala)), ALTURA), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return im, base64.b64encode(buf.getvalue()).decode('ascii')


def main(classe):
    pasta = os.path.join(RAIZ, 'assets', 'packs', classe, 'recortes')
    if not os.path.isdir(pasta):
        print('nao achei %s' % pasta)
        return
    quadros, total = {}, 0
    for nome in sorted(os.listdir(pasta)):
        if not nome.endswith('.png'):
            continue
        base = nome[:-4]
        if base in ESPECIAIS:
            chave = ESPECIAIS[base] + '_frente'
        else:
            partes = base.rsplit('_', 1)
            if len(partes) != 2 or not partes[1].isdigit():
                continue
            arq, idx = partes[0], int(partes[1])
            if arq not in MAPA:
                continue
            fase = MAPA[arq][0 if idx <= 5 else 1]
            direcao = DIRECOES[(idx - 1) % 5]
            chave = '%s_%s' % (fase, direcao)
        im, b64 = carrega(os.path.join(pasta, nome))
        quadros[chave] = {'w': im.width, 'h': im.height, 'src': 'data:image/png;base64,' + b64}
        total += len(b64)

    destino = os.path.join(RAIZ, 'assets', 'embedded', 'sprites-%s.js' % classe)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, 'w', encoding='utf-8') as f:
        f.write('// Sprites de %s — gerado por tools/empacota_sprites.py. Nao editar a mao.\n' % classe)
        f.write('// Arte do usuario; fica fora do Git (ver .gitignore).\n')
        f.write('var JOGO = (typeof window !== "undefined")\n')
        f.write('  ? (window.JOGO = window.JOGO || {})\n')
        f.write('  : (globalThis.JOGO = globalThis.JOGO || {});\n')
        f.write('JOGO.SPRITES = JOGO.SPRITES || {};\n')
        f.write('JOGO.SPRITES["%s"] = %s;\n' % (classe, json.dumps(quadros, ensure_ascii=False)))

    print('%s: %d quadros, %.1f MB' % (classe, len(quadros), os.path.getsize(destino) / 1048576.0))
    for k in sorted(quadros):
        print('   ', k)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'sumo')
