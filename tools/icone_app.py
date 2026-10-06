#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O ICONE E A TELA DE ABERTURA DO APLICATIVO (06/10, pedido do dono)

"Pode ser preto escrito ST e online em baixo, nas cores em amarelo."

Desenha tudo de uma vez, a partir de UM desenho (a funcao `marca`):

  android/app/src/main/res/mipmap-*/ic_launcher.png          o icone quadrado (aparelhos antigos)
  android/app/src/main/res/mipmap-*/ic_launcher_round.png    o redondo
  android/app/src/main/res/mipmap-*/ic_launcher_foreground.png  a frente do icone adaptativo (fundo transparente;
                                                             o fundo e a cor de values/ic_launcher_background.xml)
  android/app/src/main/res/drawable*/splash.png              a tela de abertura, deitada e em pe
  docs/arte-loja/icone-512.png · icone-1024.png              o icone da ficha da Play
  docs/arte-loja/destaque-1024x500.png                       a imagem de destaque da ficha

    python tools/icone_app.py

Precisa do Pillow e da Georgia Bold do Windows (a serifa mais proxima do letreiro do jogo). So desenha:
nao instala nem baixa nada. Mudou o desenho? Rode de novo e recompile o aplicativo.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
RES = os.path.join(RAIZ, 'android', 'app', 'src', 'main', 'res')
LOJA = os.path.join(RAIZ, 'docs', 'arte-loja')
FONTE = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'georgiab.ttf')

FUNDO = (11, 13, 16)            # o preto do jogo (#0b0d10), o mesmo do backgroundColor da casca
OURO = (245, 197, 66)           # o amarelo do letreiro
OURO_ESCURO = (150, 108, 20)

# densidade -> (icone, frente do adaptativo)
ICONES = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}


def fonte(px):
    return ImageFont.truetype(FONTE, max(4, int(px)))


def texto_espacado(d, centro_x, y, txt, f, cor, espaco):
    """Letras com folga entre elas (o PIL nao tem letter-spacing): centra o conjunto em centro_x."""
    larguras = [d.textlength(c, font=f) for c in txt]
    total = sum(larguras) + espaco * (len(txt) - 1)
    x = centro_x - total / 2.0
    for c, w in zip(txt, larguras):
        d.text((x, y), c, font=f, fill=cor)
        x += w + espaco


def marca(lado, fundo=True, margem=0.0):
    """O desenho: "ST" grande e "ONLINE" embaixo, em ouro. `margem` encolhe a marca (a frente do icone
    adaptativo so pode usar o miolo: o lancador corta as bordas em circulo, gota ou quadrado)."""
    S = 4                                             # desenha 4x maior e reduz: borda lisa sem serrilhado
    L = lado * S
    img = Image.new('RGBA', (L, L), FUNDO + (255,) if fundo else (0, 0, 0, 0))
    util = L * (1 - 2 * margem)
    cx, cy = L / 2.0, L / 2.0
    if fundo:
        # um clarao morno atras das letras, bem discreto, para o preto nao ficar chapado
        halo = Image.new('RGBA', (L, L), (0, 0, 0, 0))
        dh = ImageDraw.Draw(halo)
        r = util * 0.42
        dh.ellipse((cx - r, cy - r * 0.92, cx + r, cy + r * 0.92), fill=OURO_ESCURO + (70,))
        img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(util * 0.13)))
    d = ImageDraw.Draw(img)
    f1 = fonte(util * 0.50)
    f2 = fonte(util * 0.125)
    # mede para centrar o bloco "ST" + "ONLINE" na altura
    caixa1 = d.textbbox((0, 0), 'ST', font=f1)
    caixa2 = d.textbbox((0, 0), 'ONLINE', font=f2)
    h1, h2 = caixa1[3] - caixa1[1], caixa2[3] - caixa2[1]
    folga = util * 0.075
    topo = cy - (h1 + folga + h2) / 2.0
    w1 = d.textlength('ST', font=f1)
    d.text((cx - w1 / 2.0, topo - caixa1[1]), 'ST', font=f1, fill=OURO)
    texto_espacado(d, cx, topo + h1 + folga - caixa2[1], 'ONLINE', f2, OURO, util * 0.028)
    return img.resize((lado, lado), Image.LANCZOS)


def redondo(img):
    lado = img.size[0]
    S = 4
    m = Image.new('L', (lado * S, lado * S), 0)
    ImageDraw.Draw(m).ellipse((0, 0, lado * S - 1, lado * S - 1), fill=255)
    fora = Image.new('RGBA', img.size, (0, 0, 0, 0))
    fora.paste(img, (0, 0), m.resize((lado, lado), Image.LANCZOS))
    return fora


def tela(larg, alt):
    """A tela de abertura: o fundo do jogo com a marca no meio."""
    img = Image.new('RGBA', (larg, alt), FUNDO + (255,))
    lado = int(min(larg, alt) * 0.46)
    m = marca(lado, fundo=True)
    img.paste(m, ((larg - lado) // 2, (alt - lado) // 2))
    return img.convert('RGB')


def destaque():
    """A imagem de destaque da Play (1024x500): a marca a esquerda e o nome do jogo."""
    W, H = 1024, 500
    img = Image.new('RGBA', (W, H), FUNDO + (255,))
    lado = 360
    img.paste(marca(lado, fundo=True), (70, (H - lado) // 2))
    d = ImageDraw.Draw(img)
    f = fonte(92)
    d.text((470, 170), 'SOTERRA', font=f, fill=OURO)
    texto_espacado(d, 470 + d.textlength('SOTERRA', font=f) / 2.0, 290, 'ONLINE', fonte(34), OURO, 14)
    return img.convert('RGB')


def grava(img, *caminho):
    alvo = os.path.join(*caminho)
    os.makedirs(os.path.dirname(alvo), exist_ok=True)
    img.save(alvo, 'PNG', optimize=True)
    return alvo


def main():
    if not os.path.isfile(FONTE):
        print('falta a fonte %s' % FONTE)
        return 1
    feitos = 0
    for dens, (ico, frente) in ICONES.items():
        pasta = os.path.join(RES, 'mipmap-' + dens)
        inteiro = marca(ico)
        grava(inteiro, pasta, 'ic_launcher.png')
        grava(redondo(inteiro), pasta, 'ic_launcher_round.png')
        # a frente do adaptativo: 108 dp no total, e so os 66 dp do meio aparecem com certeza
        grava(marca(frente, fundo=False, margem=0.20), pasta, 'ic_launcher_foreground.png')
        feitos += 3
    # o fundo do icone adaptativo: a cor do jogo
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % FUNDO)
    # as telas de abertura: no tamanho exato das que ja existem
    for pasta in sorted(os.listdir(RES)):
        alvo = os.path.join(RES, pasta, 'splash.png')
        if pasta.startswith('drawable') and os.path.isfile(alvo):
            with Image.open(alvo) as velha:
                tam = velha.size
            grava(tela(*tam), alvo)
            feitos += 1
    grava(marca(512), LOJA, 'icone-512.png')
    grava(marca(1024), LOJA, 'icone-1024.png')
    grava(destaque(), LOJA, 'destaque-1024x500.png')
    print('%d arquivos do aplicativo e 3 da ficha da loja (%s)' % (feitos, LOJA))
    return 0


if __name__ == '__main__':
    sys.exit(main())
