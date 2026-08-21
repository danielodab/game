# -*- coding: utf-8 -*-
"""Fotografa uma folha de peças de cenário, de cima e de frente.

Rodar:
  blender --background --factory-startup --python tools/ve_folha.py -- <arquivo.glb> <saida.png>

Existe porque separar às cegas deu errado: parti por PARTES SOLTAS e o que saiu
foram 112 cacos de 5 mm — folhas e pétalas soltas, não objetos. O Meshy monta
cada peça com várias cascas desconectadas, então "ilha de geometria" não é o
mesmo que "objeto". Antes de inventar outro critério eu preciso VER como as
peças estão dispostas na folha.
"""
import bpy, sys, os, math

def args():
    a = sys.argv
    a = a[a.index('--') + 1:] if '--' in a else []
    return (a[0] if a else None), (a[1] if len(a) > 1 else 'folha.png')

def main():
    arq, saida = args()
    if not arq or not os.path.exists(arq):
        print('falta o arquivo'); return

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=arq)

    # caixa de tudo, para enquadrar
    xs, ys, zs = [], [], []
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
    if not xs:
        print('cena vazia'); return
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; cz = (min(zs) + max(zs)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    print('CAIXA| x=%.3f y=%.3f z=%.3f  span=%.3f' % (max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs), span))

    cena = bpy.context.scene
    cena.render.engine = 'BLENDER_WORKBENCH'
    cena.render.resolution_x = 1500
    cena.render.resolution_y = 900
    cena.render.film_transparent = False
    try:
        cena.display.shading.light = 'STUDIO'
        cena.display.shading.color_type = 'TEXTURE'
    except Exception:
        pass

    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = span * 1.15
    cam = bpy.data.objects.new('cam', cam_d)
    cena.collection.objects.link(cam)
    cena.camera = cam

    # DE CIMA: mostra a disposição das peças na folha, que é o que eu preciso
    # para saber se dá para agrupar por vizinhança.
    cam.location = (cx, cy, cz + span * 2)
    cam.rotation_euler = (0, 0, 0)
    cena.render.filepath = saida.replace('.png', '_cima.png')
    bpy.ops.render.render(write_still=True)

    # DE FRENTE: mostra a altura relativa de cada uma
    cam.location = (cx, cy - span * 2, cz)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cena.render.filepath = saida.replace('.png', '_frente.png')
    bpy.ops.render.render(write_still=True)
    print('gravado:', saida)

main()
