# -*- coding: utf-8 -*-
"""Converte os seis chefes escolhidos para .glb e embute em base64.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_chefes.py

POR QUE PASSAR PELO BLENDER
---------------------------
Os arquivos do acervo sao `.gltf`: JSON com o buffer ja em base64 la dentro, e
a textura como arquivo SOLTO ao lado (Atlas_Monsters.png). Embutir isso direto
custaria duas coisas — o inchaco de base64 dentro de base64, e a textura que
nao viajaria junto. Reexportar como `.glb` resolve as duas: binario compacto e
textura embarcada num arquivo so, que e exatamente o formato que
assets/embedded/models-monsters.js ja guarda.
"""
import bpy, os, base64, io, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(RAIZ, "assets", "candidatos", "quaternius_ultimate_monsters")
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-bosses.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_chefes")

# chave no jogo -> arquivo do acervo
CHEFES = [
    ("q_mushnub",  "Mushnub_Evolved"),
    ("q_glub",     "Glub_Evolved"),
    ("q_bluedemon", "BlueDemon"),
    ("q_alpaking", "Alpaking_Evolved"),
    ("q_goleling", "Goleling_Evolved"),
    ("q_ghostskull", "Ghost_Skull"),
    # Goleling_Evolved reprovou na medicao: 4,28 m (abaixo do teto de 4,76) e
    # 3,85 celulas de largura — subir a escala ate 5,20 m o levaria a 4,7
    # celulas. E golem largo, nao alto. O Yeti e humanoide e ereto: ganha altura
    # sem espalhar no tabuleiro.
    ("q_yeti", "Yeti"),
]


def limpa():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    if not os.path.isdir(TMP):
        os.makedirs(TMP)
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 2.0 - modelos dos SEIS CHEFES (Quaternius Ultimate Monsters, CC0 1.0)",
        " *",
        " * Os chefes de hoje reprovaram na medicao: o triceratops dizia ter 3,84 m e",
        " * de pe media 1,81 m, MENOR que o Barbaro sozinho. Estes seis foram",
        " * escolhidos pelo usuario e sobem para 5,20 m, acima do teto de personagem",
        " * (4,76 m, com a maior fusao).",
        " *",
        " * Vieram de `.gltf` (JSON com buffer em base64 e textura solta ao lado) e",
        " * foram reexportados como `.glb` binario com a textura embarcada — sem isso",
        " * seria base64 dentro de base64, e o atlas nao viajaria junto.",
        " *",
        " * CC0 1.0 Universal: dominio publico, sem atribuicao obrigatoria e sem",
        " * restricao de redistribuicao. Pode ficar no Git. Ver docs/CREDITS_3D.md.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
    ]

    rel = []
    for chave, arq in CHEFES:
        origem = os.path.join(ORIG, arq + ".gltf")
        if not os.path.exists(origem):
            print("FALTA:", origem)
            continue
        limpa()
        bpy.ops.import_scene.gltf(filepath=origem)
        destino = os.path.join(TMP, chave + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                                  use_selection=True, export_apply=False,
                                  export_animations=True)
        dados = open(destino, "rb").read()
        b64 = base64.b64encode(dados).decode("ascii")
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, b64))
        rel.append((chave, arq, os.path.getsize(origem) / 1024.0,
                    len(dados) / 1024.0, len(b64) / 1024.0))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n=== CHEFES EMBUTIDOS ===")
    print("%-14s %-18s %10s %10s %10s" % ("chave", "origem", "gltf KB", "glb KB", "base64 KB"))
    for c, a, g, b, e in rel:
        print("%-14s %-18s %10.1f %10.1f %10.1f" % (c, a, g, b, e))
    print("TOTAL base64: %.1f KB" % sum(r[4] for r in rel))
    print("arquivo: %s (%.1f KB)" % (SAIDA, os.path.getsize(SAIDA) / 1024.0))


main()
