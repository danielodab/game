# -*- coding: utf-8 -*-
"""Embute as 10 coroas de ranking PvP do usuario.

  python tools/embute_coroas_pvp.py

Origem: C:\\Users\\danie\\Downloads\\assets_ok\\ranking_pvp\\nivelN.png
(RGBA transparentes, ~170-230px). Reamostradas para 128 no lado maior,
PNG mantido (o alfa e a alma da coroa), base64 em JOGO.COROAS_PVP['nN'].

UM NOME TORTO, POR EXTENSO: o nivel 3 tem DOIS arquivos — "nivel 3.png"
(com espaco, fundo OPACO: a primeira tentativa) e "nivel_3.png"
(transparente: o refazimento). Entra o refazimento; o opaco fica de fora
DE PROPOSITO e esta linha e o registro do porque.
"""
import os, io, base64
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\ranking_pvp"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "coroas-pvp.js")
LADO = 128

ARQUIVOS = {
    1: "nivel1.png", 2: "nivel2.png",
    3: "nivel_3.png",              # o refazimento transparente; "nivel 3.png" e o opaco descartado
    4: "nivel4.png", 5: "nivel5.png", 6: "nivel6.png",
    7: "nivel7.png", 8: "nivel8.png", 9: "nivel9.png", 10: "nivel10.png",
}

linhas = [
    "var JOGO = (typeof window !== 'undefined')",
    "  ? (window.JOGO = window.JOGO || {})",
    "  : (globalThis.JOGO = globalThis.JOGO || {});",
    "/* SOTERRA 3.0 - as 10 coroas do ranking PvP, arte do usuario.",
    " * PNG com alfa (a transparencia e a alma), 128px no lado maior.",
    " * Quem as pendura acima da cabeca e o hub3d; a escada de pontos",
    " * mora em js/core/brasa.js. Feitas por tools/embute_coroas_pvp.py. */",
    "JOGO.COROAS_PVP = JOGO.COROAS_PVP || {};",
]

total = 0
for nivel in sorted(ARQUIVOS):
    caminho = os.path.join(ORIG, ARQUIVOS[nivel])
    im = Image.open(caminho).convert("RGBA")
    w, h = im.size
    esc = LADO / float(max(w, h))
    im = im.resize((max(1, round(w * esc)), max(1, round(h * esc))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    dados = buf.getvalue()
    total += len(dados)
    linhas.append("JOGO.COROAS_PVP['n%d']='%s';" % (nivel, base64.b64encode(dados).decode("ascii")))
    print("n%-2d %s -> %dx%d, %.1f KB" % (nivel, ARQUIVOS[nivel], im.size[0], im.size[1],
                                          len(dados) / 1024.0))

f = io.open(SAIDA, "w", encoding="utf-8", newline="\n")
f.write("\n".join(linhas) + "\n")
f.close()
print("saida: %s (%.1f KB)" % (SAIDA, total / 1024.0))
