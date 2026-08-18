# -*- coding: utf-8 -*-
"""Converte e embute as criaturas das INVOCACOES do Xama.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_invocacoes.py

O PROBLEMA QUE ISTO RESOLVE
---------------------------
Seis das sete invocacoes estavam erradas no conceito: o Cao de Brasa era um
lobo, a Ninfa da Mare um esqueleto mago, o Falcao da Tempestade uma vespa. E
duas dividiam o MESMO modelo — o Colosso de Magma e o Golem da Montanha eram o
mesmo boi, um laranja e outro verde.

O acervo Quaternius (CC0) tem 25 criaturas em disco e nenhuma era usada. Os
chefes levaram seis; estas sao as que faltam para o Rebanho do Invocador.

O Goleling_Evolved ja esta embutido (foi escolhido para a Mina e reprovou por
ser largo e baixo). Ele sai de graca aqui, onde altura nao e requisito — golem
largo e exatamente o que um Golem da Montanha deve parecer.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(RAIZ, "assets", "candidatos", "quaternius_ultimate_monsters")
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-summons.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_inv")

# chave no jogo -> arquivo do acervo
BICHOS = [
    ("q_hywirl",   "Hywirl"),          # Familiar — bicho pequeno e estranho
    ("q_demon",    "Demon"),           # Cao de Brasa — vermelho e chifrudo
    ("q_dragon_ev", "Dragon_Evolved"), # Colosso de Magma — massa de colosso
    ("q_squidle",  "Squidle"),         # Ninfa da Mare — aquatico de verdade
    ("q_goleling_s", "Goleling"),      # Sentinela de Pedra — golem pequeno
    ("q_birb",     "Birb"),            # Falcao da Tempestade — e literalmente ave
]


def main():
    if not os.path.isdir(TMP):
        os.makedirs(TMP)
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 2.0 - criaturas das INVOCACOES do Xama (Quaternius, CC0 1.0)",
        " *",
        " * Seis das sete invocacoes estavam erradas no conceito — o Cao de Brasa era",
        " * um lobo, a Ninfa da Mare um esqueleto mago, o Falcao da Tempestade uma",
        " * vespa — e duas dividiam o MESMO modelo: o Colosso de Magma e o Golem da",
        " * Montanha eram o mesmo boi, um laranja e outro verde.",
        " *",
        " * O Golem da Montanha nao esta aqui: ele usa o Goleling_Evolved, que ja",
        " * veio embutido com os chefes e sobrou quando a Mina trocou para o Yeti.",
        " *",
        " * CC0 1.0 Universal. Ver docs/CREDITS_3D.md.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
    ]
    rel = []
    for chave, arq in BICHOS:
        origem = os.path.join(ORIG, arq + ".gltf")
        if not os.path.exists(origem):
            print("FALTA:", origem)
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=origem)
        destino = os.path.join(TMP, chave + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                                  use_selection=True, export_apply=False,
                                  export_animations=True)
        dados = open(destino, "rb").read()
        b64 = base64.b64encode(dados).decode("ascii")
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, b64))
        rel.append((chave, arq, len(dados) / 1024.0, len(b64) / 1024.0))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))
    print("\n=== INVOCACOES EMBUTIDAS ===")
    print("%-15s %-18s %10s %11s" % ("chave", "origem", "glb KB", "base64 KB"))
    for c, a, b, e in rel:
        print("%-15s %-18s %10.1f %11.1f" % (c, a, b, e))
    print("TOTAL base64: %.1f KB" % sum(r[3] for r in rel))


main()
