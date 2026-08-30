# -*- coding: utf-8 -*-
"""Normaliza os MUROS e o AQUARIO da Corte Afogada sem separar nada.

Por que nao usar separa_cenario.py aqui: ele recorta por ilhas e descarta
caco pequeno (MIN_TRIS/MIN_TAM). O aquario tem PEIXES soltos dentro do
tanque — ilhas minusculas e legitimas que o recorte jogaria fora. Muro e
peca unica por natureza; so o que estes arquivos precisam e o de sempre:
textura reamostrada a 1024 e exportacao JPEG (os crus tem 23-25 MB cada).

Assentar e centrar NAO se faz aqui: o renderer ja faz na montagem
(pecaUsuario/muroDaCasa medem a caixa e corrigem), e ja erramos duas vezes
tentando fazer isso na exportacao.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/normaliza_muros_cisterna.py
"""
import bpy, os

ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\A Corte Afogada\muros"
DEST = os.path.join(ORIG, "_separado")
TEX_ALVO = 1024

ARQUIVOS = {
    "muro inteiro.glb": "muro_inteiro.glb",
    "muro furado.glb": "muro_furado.glb",
    "aquario.glb": "aquario.glb",
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
    print("%-18s %6.2f MB  %6d tris  (%d textura(s) reamostrada(s))" % (saida, mb, tris, n))

print("pronto:", DEST)
