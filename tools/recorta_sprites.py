# -*- coding: utf-8 -*-
"""
Recorta folhas de sprites: remove o fundo e fatia as poses.

Uso:  python tools/recorta_sprites.py assets/packs/sumo

Como funciona
  1. Remove o fundo por PREENCHIMENTO a partir das bordas (flood fill). É o que
     permite apagar um bege que se parece com a cor da pele: o que está dentro do
     personagem nunca é alcançado a partir de fora.
  2. Aceita dois tipos de fundo: cor chapada (bege) e xadrez de transparência
     (dois cinzas alternados, que aparece quando a imagem foi salva em JPG).
  3. Fatia a folha achando os vãos vazios entre as poses (projeção do alfa), em
     vez de assumir uma grade fixa.
  4. Salva cada pose já aparada, em PNG com transparência.
"""
import os
import sys
from collections import deque

from PIL import Image

TOL_BASE = 42        # distância de cor aceita como "mesmo fundo"
TOL_SOMBRA = 78      # segunda passada, mais frouxa, para a sombra desenhada
MIN_LARGURA = 40     # ignora fatias menores que isto (ruído)
MIN_ALTURA = 40
MARGEM = 6           # respiro ao redor de cada pose recortada


def dist(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def eh_cinza(p, folga=18):
    return max(p) - min(p) < folga


def remove_fundo(im):
    """Devolve a imagem RGBA com o fundo transparente."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()

    # amostra os cantos para descobrir o(s) tom(ns) de fundo
    cantos = [px[1, 1], px[w - 2, 1], px[1, h - 2], px[w - 2, h - 2]]
    xadrez = all(eh_cinza(c) for c in cantos)
    tons = []
    for c in cantos:
        if not any(dist(c, t) < 24 for t in tons):
            tons.append(c)

    def eh_fundo(p, tol):
        if xadrez:
            # xadrez de transparência: cinza claro/médio. A folga é generosa porque
            # o JPG borra as bordas dos quadrados e tinge os cinzas.
            return eh_cinza(p, 34) and 78 <= (p[0] + p[1] + p[2]) / 3 <= 215
        return any(dist(p, t) < tol for t in tons)

    # Xadrez de transparência: o JPG deixa franjas coloridas ENTRE os quadrados,
    # que bloqueiam o preenchimento. Como o personagem não tem cinza médio (pele e
    # roupa são saturadas, o contorno é escuro demais, dentes e olhos claros demais),
    # aqui a remoção por cor global é mais segura que o preenchimento.
    if xadrez:
        for y in range(h):
            for x in range(w):
                if eh_fundo(px[x, y], TOL_BASE):
                    px[x, y] = (0, 0, 0, 0)
        return im

    visto = bytearray(w * h)
    fila = deque()

    # semeia por toda a borda
    for x in range(w):
        for y in (0, h - 1):
            if eh_fundo(px[x, y], TOL_BASE):
                fila.append((x, y)); visto[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if eh_fundo(px[x, y], TOL_BASE):
                fila.append((x, y)); visto[y * w + x] = 1

    # primeira passada: o fundo propriamente dito
    apagar = []
    while fila:
        x, y = fila.popleft()
        apagar.append((x, y))
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visto[ny * w + nx]:
                if eh_fundo(px[nx, ny], TOL_BASE):
                    visto[ny * w + nx] = 1
                    fila.append((nx, ny))

    # segunda passada, mais frouxa: pega a sombra desenhada e o serrilhado do JPG.
    # Continua partindo só do que já é fundo, então nunca invade o personagem.
    fila = deque(apagar)
    while fila:
        x, y = fila.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visto[ny * w + nx]:
                if any(dist(px[nx, ny], t) < TOL_SOMBRA for t in tons):
                    visto[ny * w + nx] = 1
                    apagar.append((nx, ny))
                    fila.append((nx, ny))

    for x, y in apagar:
        px[x, y] = (0, 0, 0, 0)
    return im


def faixas(valores, minimo):
    """Agrupa índices com conteúdo em faixas contíguas."""
    saida, ini = [], None
    for i, v in enumerate(valores):
        if v > 0 and ini is None:
            ini = i
        elif v == 0 and ini is not None:
            if i - ini >= minimo:
                saida.append((ini, i))
            ini = None
    if ini is not None and len(valores) - ini >= minimo:
        saida.append((ini, len(valores)))
    return saida


def fatia(im):
    """Devolve as poses da folha, em ordem de leitura."""
    w, h = im.size
    a = im.split()[3]
    ap = a.load()

    linhas_cheias = [sum(1 for x in range(0, w, 3) if ap[x, y] > 24) for y in range(h)]
    poses = []
    for y0, y1 in faixas(linhas_cheias, MIN_ALTURA):
        col = [sum(1 for y in range(y0, y1, 3) if ap[x, y] > 24) for x in range(w)]
        for x0, x1 in faixas(col, MIN_LARGURA):
            recorte = im.crop((x0, y0, x1, y1))
            bb = recorte.getbbox()
            if not bb:
                continue
            recorte = recorte.crop(bb)
            fundo = Image.new('RGBA', (recorte.width + MARGEM * 2, recorte.height + MARGEM * 2), (0, 0, 0, 0))
            fundo.paste(recorte, (MARGEM, MARGEM))
            poses.append(fundo)
    return poses


def main(pasta):
    saida = os.path.join(pasta, 'recortes')
    os.makedirs(saida, exist_ok=True)
    total = 0
    for nome in sorted(os.listdir(pasta)):
        if not nome.lower().endswith(('.png', '.jpg', '.jpeg')):
            continue
        caminho = os.path.join(pasta, nome)
        base = os.path.splitext(nome)[0]
        im = remove_fundo(Image.open(caminho))
        poses = fatia(im)
        for i, p in enumerate(poses, 1):
            destino = os.path.join(saida, '%s_%02d.png' % (base, i))
            p.save(destino)
            print('  %s  %dx%d' % (os.path.basename(destino), p.width, p.height))
        print('%s -> %d poses' % (nome, len(poses)))
        total += len(poses)
    print('TOTAL: %d poses em %s' % (total, saida))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/packs/sumo')
