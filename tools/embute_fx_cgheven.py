# -*- coding: utf-8 -*-
"""Traz os quatro filmes do CGHEVEN: escudo, portal, tornado e muzzle.

  python tools/embute_fx_cgheven.py

O QUE ENTRA (tudo CC0, cgheven.com, baixado com aval do usuario para
assets/candidatos/fx/cgheven/ — medido: 4K RGBA com alfa de verdade):

  Magical_Sheild_Block  8x8 @4K  -> escudo:unico   a folha que faltava para
                                                    a familia `escudo` do
                                                    FILME_FAM (a linha que o
                                                    proprio comentario de la
                                                    esperava)
  Portal_01 (frente)    6x6 @4K  -> portal:unico   o chao das invocacoes e os
                                                    portais do Acampamento
  Magical_Tornado       8x8 @4K  -> tornado:unico  a familia `cone` (vento)
  Realistic_muzzle      5x5 @4K  -> muzzle:unico   o clarao de boca do tiro
                                                    (familia `flecha`, na
                                                    ORIGEM — Cacador e Totem)

POR QUE `:unico` E NAO tres paletas: estas folhas sao ASSINADAS — o autor
rendeu a cor da coisa (escudo dourado, portal laranja). Tingir por elemento
como as folhas do rubberduck destruiria a assinatura. filme() cai para
`tipo:unico` com tinta BRANCA quando nao ha folha por paleta.

O FORMATO E O MESMO do fx-anim.js (ver tools/embute_fx_anim.py): premultiplica
o alfa (transparente vira preto, e preto soma zero no aditivo), apara quadros
vazios das pontas, amostra 16 momentos, empacota 4x4 de 128 px, JPEG 88.
A reducao 512->128 sai LIMPA — fonte 4K nao borra como o cethiel borrava.
"""
import os, io, base64
from PIL import Image, ImageChops

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(RAIZ, "assets", "candidatos", "fx", "cgheven")
SAIDA = os.path.join(RAIZ, "assets", "embedded", "fx-cgheven.js")

PX = 128
GRADE = 4
QUADROS = GRADE * GRADE
QUAL = 88

# arquivo -> (grade da origem, chave no jogo)
LOTES = [
    ("Magical_Sheild_Block_01_Front_4K_8x8.png", 8, "escudo:unico"),
    ("Portal_01_V1_Loop__Front_4K_6X6.png",      6, "portal:unico"),
    ("Magical_Tornado_01_Front_4K_8x8.png",      8, "tornado:unico"),
    ("Realistic_muzzle_01_Front_4K_5x5.png",     5, "muzzle:unico"),
]


def premultiplica(im):
    im = im.convert("RGBA")
    r, g, b, a = im.split()
    return Image.merge("RGB", (ImageChops.multiply(r, a),
                               ImageChops.multiply(g, a),
                               ImageChops.multiply(b, a)))


def vazio(im, corte=6):
    ex = im.getextrema()
    return ex[0][1] < corte and ex[1][1] < corte and ex[2][1] < corte


def fatia(caminho, grade):
    """A folha NxN do CGHEVEN vira a lista de quadros, em ordem de leitura."""
    folha = Image.open(caminho)
    w, h = folha.size
    fw, fh = w // grade, h // grade
    quadros = []
    for lin in range(grade):
        for col in range(grade):
            q = folha.crop((col * fw, lin * fh, (col + 1) * fw, (lin + 1) * fh))
            quadros.append(premultiplica(q))
    return quadros


def empacota(quadros):
    """Apara pontas vazias, amostra 16, empacota 4x4 de 128 px."""
    ini, fim = 0, len(quadros) - 1
    while ini < fim and vazio(quadros[ini]):
        ini += 1
    while fim > ini and vazio(quadros[fim]):
        fim -= 1
    uteis = quadros[ini:fim + 1] or quadros

    fl = Image.new("RGB", (PX * GRADE, PX * GRADE), (0, 0, 0))
    for i in range(QUADROS):
        k = int(round(i * (len(uteis) - 1) / float(QUADROS - 1))) if len(uteis) > 1 else 0
        q = uteis[k].resize((PX, PX), Image.LANCZOS)
        fl.paste(q, ((i % GRADE) * PX, (i // GRADE) * PX))
    buf = io.BytesIO()
    fl.save(buf, "JPEG", quality=QUAL, optimize=True)
    return buf.getvalue(), len(uteis)


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - filmes do CGHEVEN (CC0, cgheven.com): escudo, portal,",
        " * tornado e muzzle — as folhas `unico`, assinadas pelo autor, que",
        " * filme() usa SEM tinta de elemento. Formato identico ao fx-anim.js;",
        " * como ela e feita: tools/embute_fx_cgheven.py. */",
        "JOGO.FX_ANIM = JOGO.FX_ANIM || {};",
    ]
    total = 0
    for arquivo, grade, chave in LOTES:
        caminho = os.path.join(ORIG, arquivo)
        if not os.path.isfile(caminho):
            print("FALTA:", arquivo)
            continue
        dados, uteis = empacota(fatia(caminho, grade))
        linhas.append("JOGO.FX_ANIM['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        total += len(dados)
        print("%-16s %3d quadros uteis -> %5.1f KB" % (chave, uteis, len(dados) / 1024.0))
    f = io.open(SAIDA, "w", encoding="utf-8", newline="\n")
    f.write("\n".join(linhas) + "\n")
    f.close()
    print("saida: %s (%.1f KB)" % (SAIDA, total / 1024.0))


main()
