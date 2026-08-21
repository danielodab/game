# -*- coding: utf-8 -*-
"""Traz os EFEITOS ANIMADOS do rubberduck para o jogo. Python puro.

  python tools/embute_fx_anim.py

O QUE MUDA NO JOGO
------------------
Ate agora todo efeito era um TILE PARADO, cinza, tingido por codigo. Isso
resolveu o problema de "cada elemento precisa de uma cor" com um atlas so, e foi
a escolha certa enquanto nao havia arte. Mas efeito parado nao explode: ele
aparece e some, e a explosao acontece na imaginacao do jogador.

Estes sao renders volumetricos de verdade, com 20 a 40 quadros cada.

O pacote ANUNCIA cinco variacoes de cor por efeito, e eu comecei mapeando uma
por elemento. Medindo a cor media de cada uma, sao TRES matizes com duas
quase-duplicatas (ver o comentario em CORES). Entao entram so as tres, e a
identidade de elemento vem de uma tinta calculada — a tabela esta em `filme()`,
em js/render3d/fx3d_v2.js.

DUAS DECISOES DE FORMATO, E O PORQUE
------------------------------------
1. PRE-MULTIPLICAR E JOGAR O ALFA FORA. Os quadros vem RGBA, e o RGB nas areas
   transparentes NAO e preto — chega a 255, lixo comum de render. Entao nao
   dava para simplesmente descartar o alfa. Multiplicando RGB por alfa o
   transparente vira preto de verdade, e ai a folha fica ADITIVA: o preto
   soma zero. Fogo e brilho querem mistura aditiva de qualquer jeito, entao
   isto nao e concessao, e o modo certo.

   O ganho: sem alfa da para usar JPEG. PNG com alfa desta folha da ~400 KB;
   JPEG da ~40 KB. Sao 10x, e sobre 15 folhas isso decide se a coisa entra no
   jogo ou nao.

2. QUATRO POR QUATRO, SEMPRE. Cada animacao vira uma folha de 4x4 quadros de
   128 px — 512x512 — independentemente de a origem ter 20, 30 ou 40 quadros.
   Amostro 16 momentos espacados.

   O numero nao e arbitrario: o atlas de particula que o jogo ja usa e 4x4 de
   128 px, entao o codigo de indexar folha 4x4 ja existe e ja foi depurado.
   E 16 quadros a 24 fps duram 0,66 s, que e a duracao de um golpe — 30 quadros
   dariam 1,25 s e o efeito ficaria pendurado depois de a jogada acabar.
"""
import os, io, base64
from PIL import Image, ImageChops

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(RAIZ, "assets", "candidatos", "fx", "_rd", "effect-images")
SAIDA = os.path.join(RAIZ, "assets", "embedded", "fx-anim.js")

PX = 128          # lado de cada quadro (o mesmo do atlas de particula)
GRADE = 4         # 4x4
QUADROS = GRADE * GRADE
QUAL = 88         # qualidade JPEG

# tipo do pacote -> como o jogo o chama
TIPOS = [
    ("explosion",   "estouro"),
    ("flame",       "chama"),
    ("flat_effect", "baque"),
    ("ring",        "anel"),
    ("shockwave",   "onda"),
]

# TRES MATIZES, E NAO CINCO. O pacote anuncia cinco variacoes de cor por
# efeito, e eu comecei mapeando uma por elemento. Ai medi a cor media de cada
# uma e o mapa caiu:
#
#   fire           (189,128, 75)  laranja
#   fire+smoke     (169,119, 66)  laranja quase igual
#   blueish_flame  ( 31,154,116)  verde-azulado (nao azul, apesar do nome)
#   blueish_smoke  (  0, 98, 79)  o mesmo, mais escuro
#   magic          (137,128,173)  lavanda
#
# Sao TRES matizes com duas quase-duplicatas. Com o mapa de cinco, `terra` saia
# laranja identico a `fogo` na tela — dois elementos indistinguiveis, que e o
# oposto do motivo de haver variacao de cor.
#
# Entao: so as tres matizes de verdade entram, e a identidade de elemento vem de
# uma TINTA calculada em `filme()` a partir da razao entre a cor do elemento no
# jogo e a cor medida da folha. Isso corta o pacote de 25 folhas para 15, e
# ainda separa os cinco elementos melhor do que as cinco folhas separavam.
CORES = [
    ("fire",          "fire"),
    ("blueish_flame", "blueish_flame"),
    ("magic",         "magic"),
]


def premultiplica(im):
    """RGB x alfa. O transparente vira PRETO, e preto soma zero no aditivo."""
    im = im.convert("RGBA")
    r, g, b, a = im.split()
    return Image.merge("RGB", (ImageChops.multiply(r, a),
                               ImageChops.multiply(g, a),
                               ImageChops.multiply(b, a)))


def vazio(im, corte=6):
    """Quadro praticamente preto — o comeco e o fim das animacoes."""
    return (im.getextrema()[0][1] < corte and im.getextrema()[1][1] < corte
            and im.getextrema()[2][1] < corte)


def folha(pasta):
    """Uma animacao inteira vira uma folha 4x4."""
    arqs = sorted(f for f in os.listdir(pasta) if f.lower().endswith(".png"))
    if not arqs:
        return None, 0

    # Descarta os quadros VAZIOS das pontas antes de amostrar. Sem isso, uma
    # animacao que comeca e termina em preto gastaria 2 das 16 celulas
    # mostrando nada — 12% da folha para dois quadros que o jogador nao ve.
    quadros = []
    for f in arqs:
        im = premultiplica(Image.open(os.path.join(pasta, f)))
        quadros.append(im)
    ini, fim = 0, len(quadros) - 1
    while ini < fim and vazio(quadros[ini]):
        ini += 1
    while fim > ini and vazio(quadros[fim]):
        fim -= 1
    uteis = quadros[ini:fim + 1]
    if not uteis:
        uteis = quadros

    fl = Image.new("RGB", (PX * GRADE, PX * GRADE), (0, 0, 0))
    for i in range(QUADROS):
        k = int(round(i * (len(uteis) - 1) / float(QUADROS - 1))) if len(uteis) > 1 else 0
        q = uteis[k]
        if q.size != (PX, PX):
            q = q.resize((PX, PX), Image.LANCZOS)
        fl.paste(q, ((i % GRADE) * PX, (i // GRADE) * PX))
    return fl, len(uteis)


def main():
    if not os.path.isdir(ORIG):
        print("FALTA:", ORIG); return

    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - efeitos ANIMADOS (rubberduck, CC0).",
        " *",
        " * Cada chave e uma folha de 4x4 quadros de %d px, em JPEG." % PX,
        " * Sem canal alfa DE PROPOSITO: o RGB ja vem multiplicado pelo alfa, o",
        " * transparente e preto de verdade, e a folha e desenhada com mistura",
        " * ADITIVA — em que preto soma zero. Fogo e brilho querem aditivo de",
        " * qualquer jeito; a economia (10x menor que PNG com alfa) veio junto.",
        " *",
        " * TRES MATIZES, nao cinco: o pacote anuncia cinco variacoes de cor mas",
        " * duas sao quase-duplicatas das outras. A cor de cada elemento sai de",
        " * uma tinta medida, na tabela TINTA de js/render3d/fx3d_v2.js.",
        " *",
        " * Gerado por tools/embute_fx_anim.py.",
        " */",
        "JOGO.FX_ANIM = JOGO.FX_ANIM || {};",
        "JOGO.FX_ANIM_GRADE = %d;" % GRADE,
        "JOGO.FX_ANIM_PX = %d;" % PX,
    ]

    rel, total = [], 0
    for pasta_t, nome_t in TIPOS:
        for el, pasta_c in CORES:
            d = os.path.join(ORIG, pasta_t, pasta_c)
            if not os.path.isdir(d):
                print("  faltou:", d); continue
            fl, n = folha(d)
            if fl is None:
                continue
            buf = io.BytesIO()
            fl.save(buf, "JPEG", quality=QUAL, optimize=True)
            dados = buf.getvalue()
            total += len(dados)
            chave = nome_t + ":" + el
            linhas.append("JOGO.FX_ANIM['%s']='%s';"
                          % (chave, base64.b64encode(dados).decode("ascii")))
            rel.append((chave, n, len(dados) / 1024.0))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== EFEITOS ANIMADOS ===")
    print("%-18s %8s %9s" % ("chave", "origem", "KB"))
    for c, n, kb in rel:
        print("%-18s %6d q %9.1f" % (c, n, kb))
    print("\n%d folhas · imagem %.0f KB · arquivo %.0f KB"
          % (len(rel), total / 1024.0, os.path.getsize(SAIDA) / 1024.0))


main()
