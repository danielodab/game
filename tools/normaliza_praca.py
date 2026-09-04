# -*- coding: utf-8 -*-
"""Normaliza as CONSTRUÇÕES DA PRAÇA (mapa principal): árvore-mundo, arena,
cofre (o banco), comércio (o mercadinho) e sede da guilda.

Cada arquivo é UMA peça (meshes=1, sem folha fundida) — não passa pelo
separador. O de sempre: textura reamostrada a 1024 e exportação JPEG (os
crus têm 19-25 MB cada). Assentar e centrar fica para a montagem no hub,
que mede a caixa e corrige — a regra da casa.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/normaliza_praca.py
"""
import bpy, os

ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa principal"
DEST = os.path.join(ORIG, "_separado")
TEX_ALVO = 1024

ARQUIVOS = {
    "arvore central.glb": "arvore_central.glb",
    "arena.glb": "arena.glb",
    "cofre.glb": "cofre.glb",
    "comercio.glb": "comercio.glb",
    "sede.glb": "sede.glb",
    # a barraca do ferreiro: quando o dono puser o arquivo, entra sozinha
    "forja.glb": "forja.glb",
    "tenda sorte.glb": "tenda_sorte.glb",     # a Barraquinha da Sorte (03/09)
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
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    alvo = os.path.join(DEST, saida)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=alvo, export_format="GLB",
                              use_selection=True, export_animations=False,
                              export_image_format="JPEG")
    mb = os.path.getsize(alvo) / 1048576.0
    print("%-22s %6.2f MB  %6d tris  (%d textura(s))" % (saida, mb, tris, n))

print("pronto:", DEST)
