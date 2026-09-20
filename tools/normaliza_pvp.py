# -*- coding: utf-8 -*-
"""Normaliza os MUROS e o PORTAL do lote de PvP (20/09) — peça única, sem separar.

O mesmo do normaliza_muros_fecho.py, com a pasta do lote de PvP. Os dois muros
e o portal são peça única por natureza, então não passam pelo separador (as
duas FOLHAS de itens, essas sim, saem pelo tools/separa_pecas.py com
`--conta 4,4`, que já entrega textura 1024 e JPEG).

Assentar e centrar NÃO se faz aqui: quem monta mede a caixa e corrige — o
`muroDaCasa`/`pecaUsuario` no tabuleiro, o `vesteCampo` no Campo e o
`montaObra` na praça.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/normaliza_pvp.py
"""
import bpy, os

ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa e itens pvp"
DEST = os.path.join(ORIG, "_separado")
TEX_ALVO = 1024

# o nome cru do dono → o nome que o embutidor espera
ARQUIVOS = {
    "muri alto pvp.glb": "muro_alto.glb",      # o módulo ALTO (corta a visão)
    "muro medio pvp.glb": "muro_medio.glb",    # o módulo MÉDIO (cobertura baixa)
    "portal pvp.glb": "portal_pvp.glb",        # o portal de espadas do Campo
}

if not os.path.isdir(DEST):
    os.makedirs(DEST)

for nome, saida in ARQUIVOS.items():
    cam = os.path.join(ORIG, nome)
    if not os.path.exists(cam):
        print("FALTA:", cam)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=cam)
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n += 1
    tris = 0
    dims = None
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
            dims = tuple(round(v, 3) for v in o.dimensions)
    alvo = os.path.join(DEST, saida)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=alvo, export_format="GLB",
                              use_selection=True, export_animations=False,
                              export_image_format="JPEG")
    mb = os.path.getsize(alvo) / 1048576.0
    print("%-18s %6.2f MB  %6d tris  dims %s  (%d textura(s) reamostrada(s))" % (saida, mb, tris, dims, n))

print("pronto:", DEST)
