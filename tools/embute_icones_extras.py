# -*- coding: utf-8 -*-
"""Embute os icones EXTRAS do usuario (03/09): pedras de forja, selos de chefe,
a Insignia de Fundacao e o vintem — tudo que ainda era desenhado por codigo
(ou era um caractere ❂/⚜, ou nem tinha icone, caso do vintem).

  python tools/embute_icones_extras.py

Origem (tres pastas SOLTAS em assets_ok, nao dentro de "icones itens"):
  assets_ok\\pedras de forja\\stone-<x>.png   -> 'stone-<x>'   (ids de DATA.stones)
  assets_ok\\selos de chefe\\<elemento>.png    -> 'selo-<elemento>'
  assets_ok\\moedas\\insignia.png              -> 'insignia'
  assets_ok\\moedas\\vitem.png                 -> 'vintem'      (nome torto: faltou o n)

RGBA com alfa limpo (conferido). Reamostrados para 128 no lado maior, PNG
mantido, base64 em JOGO.ICONES_EXTRAS[id]. Quem os liga no jogo e
js/render2d/icones_extras.js (embrulha Art.stoneIcon e cria seloIcon,
insigniaIcon e vintemIcon).
"""
import os, io, base64
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "icones-extras.js")
LADO = 128

# pasta -> (prefixo do id, {nome torto: id})
PASTAS = [
    ("pedras de forja", "", {}),
    ("selos de chefe", "selo-", {}),
    ("moedas", "", {"vitem": "vintem"}),
]

linhas = [
    "var JOGO = (typeof window !== 'undefined')",
    "  ? (window.JOGO = window.JOGO || {})",
    "  : (globalThis.JOGO = globalThis.JOGO || {});",
    "/* SOTERRA 3.0 - icones extras, arte do usuario (03/09): pedras de forja,",
    " * selos de chefe, insignia de fundacao e vintem. 128px no lado maior.",
    " * Quem os liga no jogo e js/render2d/icones_extras.js. Feito por",
    " * tools/embute_icones_extras.py. */",
    "JOGO.ICONES_EXTRAS = JOGO.ICONES_EXTRAS || {};",
]

total, n = 0, 0
for pasta, prefixo, tortos in PASTAS:
    base = os.path.join(ORIG, pasta)
    if not os.path.isdir(base):
        print("FALTA A PASTA:", base)
        continue
    for f in sorted(os.listdir(base)):
        if not f.lower().endswith(".png"):
            continue
        nome = f[:-4]
        chave = prefixo + tortos.get(nome, nome)
        im = Image.open(os.path.join(base, f)).convert("RGBA")
        w, h = im.size
        esc = min(1.0, LADO / float(max(w, h)))
        if esc < 1.0:
            im = im.resize((max(1, round(w * esc)), max(1, round(h * esc))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        dados = buf.getvalue()
        total += len(dados)
        n += 1
        linhas.append("JOGO.ICONES_EXTRAS['%s']='%s';"
                      % (chave, base64.b64encode(dados).decode("ascii")))
        print("  %-16s <- %s\\%s (%dx%d)" % (chave, pasta, f, w, h))

f2 = io.open(SAIDA, "w", encoding="utf-8", newline="\n")
f2.write("\n".join(linhas) + "\n")
f2.close()
print("%d icones, %.1f KB -> %s" % (n, total / 1024.0, SAIDA))
