# -*- coding: utf-8 -*-
"""Traz o ESCUDO do Minotauro — a peça que ele crava no chão para barrar.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_escudo.py

O gancho já existia. Quando fiz o verbo BARRAR, o muro invocado foi desenhado
como uma CAIXA de pedra, e ficou anotado no código que era provisório: bastaria
um modelo responder pela chave `muro-escudo` em `Models3D2` que ele entraria
sozinho, encaixado no porte da casa e tingido pelo elemento de quem o ergueu.
Este script é só isso — o modelo chegou, a chave é essa.

O arquivo vem com 17,75 MB, quase todos de três texturas grandes; a mesma
reamostragem para 1024 px que os personagens usam derruba isso para uns 2 MB.
Nenhuma animação, o que é certo: o escudo não anda, ele sobe do chão e afunda —
e essa animação é do renderizador, não do arquivo.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\minotauro\minotauro\ESCUDO.glb"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "muro-escudo.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_escudo")
CHAVE = "muro-escudo"
TEX_ALVO = 1024


def limpa_lixo():
    """A `Icosphere` solta que o Meshy deixa em todo arquivo."""
    fora = []
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None and len(o.data.vertices) < 600:
            fora.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    if fora:
        print("LIXO REMOVIDO|", ", ".join(fora))


def main():
    if not os.path.exists(ORIG):
        print("FALTA:", ORIG); return
    if not os.path.isdir(TMP):
        os.makedirs(TMP)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=ORIG)
    limpa_lixo()

    ntex = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO); img.pack(); ntex += 1

    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)

    destino = os.path.join(TMP, CHAVE + ".glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                              use_selection=True, export_animations=False,
                              export_image_format="JPEG")
    dados = open(destino, "rb").read()
    b64 = base64.b64encode(dados).decode("ascii")

    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - o escudo que o Minotauro crava no chão (verbo BARRAR).",
        " *",
        " * Substitui a caixa de pedra provisória. O renderizador já procurava por",
        " * esta chave: ver `MURO_MODELO` em js/render3d/renderer3d_v2.js, onde a",
        " * peça é encaixada no porte da casa, tingida pelo elemento de quem a",
        " * ergueu, e animada subindo do chão e afundando quando o turno acaba.",
        " *",
        " * Sem animação no arquivo, e é assim que tem de ser: subir e afundar é",
        " * movimento do renderizador, não clipe do modelo.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MODELS['%s']='%s';" % (CHAVE, b64),
        "",
    ]
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n=== ESCUDO DO MINOTAURO ===")
    print("  antes  %.2f MB" % (os.path.getsize(ORIG) / 1048576.0))
    print("  depois %.2f MB · %d triangulos · %d textura(s) reamostrada(s)"
          % (len(dados) / 1048576.0, tris, ntex))
    print("  arquivo %.2f MB" % (os.path.getsize(SAIDA) / 1048576.0))


main()
