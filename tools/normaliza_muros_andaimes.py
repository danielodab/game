# -*- coding: utf-8 -*-
"""Normaliza os MUROS e a VIGA dos Andaimes do Vento sem separar nada.

O mesmo do normaliza_muros_fecho.py, com a pasta dos Andaimes: muro e viga
sao peca unica por natureza, entao nao passam pelo separa_pecas (que
recorta por ilhas e jogaria fora parte solta legitima — a corda do prumo
pendurada na viga, por exemplo). So o de sempre: textura reamostrada a
1024 e exportacao JPEG (os crus tem 18-22 MB cada).

O dono entregou o pilar com o nome do que ele e — "viga.glb" — e o
catalogo o registra no papel `pilar`, como nos outros temas.

Assentar e centrar NAO se faz aqui: o renderer ja faz na montagem
(pecaUsuario/muroDaCasa medem a caixa e corrigem).

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/normaliza_muros_andaimes.py
"""
import bpy, os

ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\Andaimes do vento\muros"
DEST = os.path.join(ORIG, "_separado")
TEX_ALVO = 1024

ARQUIVOS = {
    "muro.glb": "muro.glb",
    "muro quebrado.glb": "muro_quebrado.glb",
    "viga.glb": "viga.glb",
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
