# -*- coding: utf-8 -*-
"""Extrai o atlas de partículas embutido para o projeto Unity.

Rodar:
  python tools/extrai_fx_atlas.py

O PROBLEMA QUE ISTO RESOLVE
---------------------------
O atlas de 16 formas (Kenney Particle Pack, CC0 1.0) vive em
`assets/embedded/fx-atlas.js` como base64, porque a linha JS abre por file://
e fetch de .png falha lá. A Unity não lê base64 de dentro de um .js: ela quer
o PNG em disco, importado como textura. Reescrever as 16 formas à mão seria
inventar arte que já existe — este script só desfaz o embrulho.

Saídas (Assets/Resources/fx/):
  atlas.png    o PNG 512×512 original, 4×4 quadros de 128 px
  _mapa.json   qual quadro é qual — índice, nome Kenney e o nome que o
               código C# usa (o mesmo TILE de js/render3d/fx3d_v2.js)

O _mapa.json existe para o teste poder provar que o C# e o PNG falam do mesmo
quadro: um índice trocado aqui não dá erro nenhum — só desenha meia-lua onde
devia haver runa, e ninguém percebe até a foto.
"""
import base64
import json
import os
import re
import struct

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTE = os.path.join(RAIZ, "assets", "embedded", "fx-atlas.js")
SAIDA = os.path.join(RAIZ, "unity", "SOTERRA-Tatico", "Assets", "Resources", "fx")

# O nome C#/JS de cada quadro, na ordem dos índices (linha a linha).
# É a MESMA tabela TILE de js/render3d/fx3d_v2.js — a fonte da verdade do
# significado de cada forma. Mudou lá, muda aqui.
NOMES = [
    "ponto",       # 0  circle_05  — ponto macio, o de sempre
    "corte",       # 1  slash_02   — meia-lua do corte
    "cascalho",    # 2  dirt_02    — o chão que se ergue
    "brasa",       # 3  fire_01    — fogo e meteoro
    "runa",        # 4  magic_01   — círculo de runas: invocação e armadilha
    "brilho",      # 5  star_07    — quatro pontas: cura e bênção
    "fumaca",      # 6  smoke_04   — sopro e cone
    "raio",        # 7  spark_05   — faísca e relâmpago
    "redemoinho",  # 8  twirl_02   — onda e vórtice
    "anel",        # 9  circle_02  — anel vazado: nova e escudo
    "risco",       # 10 trace_01   — risco: flecha e projétil
    "estouro",     # 11 scorch_01  — estouro sujo: impacto
    "aura",        # 12 magic_03   — estrela de quatro braços: aura e pacto
    "lingua",      # 13 muzzle_04  — língua de fogo: sopro curto
    "halo",        # 14 light_01   — halo concêntrico: escudo e luz
    "cintila",     # 15 star_08    — cintilação cruzada: piscar e teleporte
]


def le_atlas_js(caminho):
    """Devolve (nomes_kenney, cols, rows, lado, bytes_do_png)."""
    with open(caminho, "r", encoding="utf-8") as f:
        texto = f.read()

    m = re.search(r"nomes:\s*\[([^\]]*)\]", texto)
    kenney = re.findall(r"'([^']+)'", m.group(1))

    cols = int(re.search(r"cols:\s*(\d+)", texto).group(1))
    rows = int(re.search(r"rows:\s*(\d+)", texto).group(1))
    lado = int(re.search(r"lado:\s*(\d+)", texto).group(1))

    # O base64 vem picado em strings concatenadas com '+'. Junta-se TUDO que
    # está entre aspas depois de "png:" — inclusive o prefixo data:, que é
    # removido depois; tentar parar na primeira vírgula quebraria se o Kenney
    # tivesse uma vírgula dentro do base64 de padding.
    corpo = texto[texto.index("png:"):]
    corpo = corpo[: corpo.index("licenca")]
    pedacos = re.findall(r"'([^']*)'", corpo)
    b64 = "".join(pedacos)
    prefixo = "data:image/png;base64,"
    if b64.startswith(prefixo):
        b64 = b64[len(prefixo):]
    return kenney, cols, rows, lado, base64.b64decode(b64)


def dimensoes_png(dados):
    """Largura e altura direto do cabeçalho IHDR — sem depender do PIL."""
    if dados[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("o base64 não decodificou um PNG (assinatura errada)")
    largura, altura = struct.unpack(">II", dados[16:24])
    return largura, altura


def main():
    kenney, cols, rows, lado, png = le_atlas_js(FONTE)

    if len(kenney) != cols * rows:
        raise SystemExit("o fx-atlas.js declara %d nomes para %d quadros"
                         % (len(kenney), cols * rows))
    if len(NOMES) != len(kenney):
        raise SystemExit("a tabela NOMES daqui tem %d entradas e o atlas %d — "
                         "alguém mexeu num lado só" % (len(NOMES), len(kenney)))

    larg, alt = dimensoes_png(png)
    esperado = (cols * lado, rows * lado)
    if (larg, alt) != esperado:
        raise SystemExit("o PNG mede %dx%d e o mapa diz %dx%d — o atlas mudou "
                         "de grade e o codigo C# leria o quadro errado"
                         % (larg, alt, esperado[0], esperado[1]))

    os.makedirs(SAIDA, exist_ok=True)

    with open(os.path.join(SAIDA, "atlas.png"), "wb") as f:
        f.write(png)

    mapa = {
        "fonte": "assets/embedded/fx-atlas.js",
        "licenca": "Kenney Particle Pack - CC0 1.0",
        "cols": cols,
        "rows": rows,
        "lado": lado,
        # A linha 0 é a de CIMA do PNG (ordem de leitura), como no JS: o
        # shader/quem lê decide como converter para UV — o mapa só registra.
        "quadros": [
            {"indice": i, "nome": NOMES[i], "kenney": kenney[i]}
            for i in range(len(NOMES))
        ],
    }
    with open(os.path.join(SAIDA, "_mapa.json"), "w", encoding="utf-8") as f:
        json.dump(mapa, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("atlas.png  %dx%d (%d bytes)" % (larg, alt, len(png)))
    print("_mapa.json %d quadros" % len(NOMES))


if __name__ == "__main__":
    main()
