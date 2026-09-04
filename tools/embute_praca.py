# -*- coding: utf-8 -*-
"""Embute as CONSTRUÇÕES DA PRAÇA (mapa principal) num arquivo JS do jogo.

Rodar (Python puro):
    python tools/embute_praca.py

Grava JOGO.MODELS['praca_*'] em assets/embedded/models-praca.js — só modelos,
sem tabela de catálogo: quem os posiciona é o hub3d, um a um, pelo nome.
Como todo models-*, o SERVIDO exige rodar tools/extrai_assets.py depois.
"""
import io, os, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa principal\_separado"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-praca.js")

PECAS = [
    ("arvore_central.glb", "praca_arvore",   "A Árvore-Mundo do Acampamento"),
    ("arena.glb",          "praca_arena",    "A Arena de duelos"),
    ("cofre.glb",          "praca_banco",    "O Banco (cofre-fortaleza)"),
    ("comercio.glb",       "praca_mercado",  "O Mercadinho"),
    ("sede.glb",           "praca_sede",     "A Sede das Guildas"),
    # a barraca do ferreiro: o hub já espera `praca_forja` — enquanto o
    # arquivo não existe, sai como FALTANDO e o lugar segue nos provisórios
    ("forja.glb",          "praca_forja",    "A Forja (barraca do ferreiro)"),
    ("tenda_sorte.glb",    "praca_loteria",  "A Barraquinha da Sorte (a roleta dos selos)"),
]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - as CONSTRUÇÕES DA PRAÇA, arte do usuário (30/08):",
        " * a Árvore-Mundo com os seis climas nos galhos, a Arena, o Banco,",
        " * o Mercadinho e a Sede das Guildas. O hub3d as posiciona pelo nome.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
    ]
    total, faltando = 0, []
    for arq, chave, nome in PECAS:
        cam = os.path.join(ORIG, arq)
        if not os.path.exists(cam):
            faltando.append(arq); continue
        dados = open(cam, "rb").read()
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        total += len(dados)
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))
    print("pecas: %d · binário %.2f MB · arquivo %.2f MB"
          % (len(PECAS) - len(faltando), total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("FALTANDO:", ", ".join(faltando))


main()
