# -*- coding: utf-8 -*-
"""Embute as DEZ COROAS 3D do ranking PvP (recortadas por separa_coroas.py).

Rodar (Python puro):
    python tools/embute_coroas_3d.py

Grava JOGO.MODELS['coroa_pvp_n1'..'n10'] em assets/embedded/coroas-pvp-3d.js.
O bilhete PNG (coroas-pvp.js) CONTINUA no jogo: o perfil 2D usa a imagem, e a
praca cai nela quando o modelo 3D nao carregou.
"""
import io, os, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\ranking_pvp\_separado"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "coroas-pvp-3d.js")


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - as DEZ COROAS do ranking PvP em 3D, arte do usuário.",
        " * Recortadas POR POSIÇÃO da folha (tools/separa_coroas.py): a ordem",
        " * esquerda->direita é a patente, e trocá-la não daria erro nenhum —",
        " * só a coroa errada na cabeça errada. Conferida de olho nos retratos.",
        " * O bilhete PNG (coroas-pvp.js) segue vivo: perfil 2D e fallback.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
    ]
    total, faltando = 0, []
    for n in range(1, 11):
        cam = os.path.join(ORIG, "coroa_%02d.glb" % n)
        if not os.path.exists(cam):
            faltando.append(os.path.basename(cam)); continue
        dados = open(cam, "rb").read()
        linhas.append("JOGO.MODELS['coroa_pvp_n%d']='%s';"
                      % (n, base64.b64encode(dados).decode("ascii")))
        total += len(dados)
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))
    print("coroas: %d · binário %.2f MB · arquivo %.2f MB"
          % (10 - len(faltando), total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("FALTANDO:", ", ".join(faltando))


main()
