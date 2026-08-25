# -*- coding: utf-8 -*-
"""Embute os 90 icones de item do usuario (fundo removido por ele).

  python tools/embute_icones_itens.py

Origem: C:\\Users\\danie\\Downloads\\assets_ok\\icones itens\\<dg>\\<id>.png
(RGBA ~500px, alfa limpo conferido). Reamostrados para 128 no lado maior,
PNG mantido, base64 em JOGO.ICONES_ITENS[itemId].

DOIS NOMES TORTOS, POR EXTENSO (a tradicao dos lotes):
    av/av-hangman.png          -> av-hangman-lamp   (faltou o -lamp)
    gh/gh-pollen-slipperr.png  -> gh-pollen-slippers (um r a mais)
"""
import os, io, base64
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\icones itens"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "icones-itens.js")
LADO = 128

TORTOS = {
    "av-hangman": "av-hangman-lamp",
    "gh-pollen-slipperr": "gh-pollen-slippers",
}

linhas = [
    "var JOGO = (typeof window !== 'undefined')",
    "  ? (window.JOGO = window.JOGO || {})",
    "  : (globalThis.JOGO = globalThis.JOGO || {});",
    "/* SOTERRA 3.0 - os 90 icones de item, arte do usuario (fundo removido",
    " * por ele; alfa real). 128px no lado maior. Quem os liga no jogo e",
    " * js/render2d/icones_itens.js, embrulhando Art.itemIcon. Feito por",
    " * tools/embute_icones_itens.py. */",
    "JOGO.ICONES_ITENS = JOGO.ICONES_ITENS || {};",
]

total, n = 0, 0
for raiz, _, arqs in os.walk(ORIG):
    for f in sorted(arqs):
        if not f.lower().endswith(".png"):
            continue
        nome = f[:-4]
        itemId = TORTOS.get(nome, nome)
        im = Image.open(os.path.join(raiz, f)).convert("RGBA")
        w, h = im.size
        esc = min(1.0, LADO / float(max(w, h)))
        if esc < 1.0:
            im = im.resize((max(1, round(w * esc)), max(1, round(h * esc))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        dados = buf.getvalue()
        total += len(dados)
        n += 1
        linhas.append("JOGO.ICONES_ITENS['%s']='%s';"
                      % (itemId, base64.b64encode(dados).decode("ascii")))

f2 = io.open(SAIDA, "w", encoding="utf-8", newline="\n")
f2.write("\n".join(linhas) + "\n")
f2.close()
print("%d icones, %.1f KB -> %s" % (n, total / 1024.0, SAIDA))
