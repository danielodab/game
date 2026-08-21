# -*- coding: utf-8 -*-
"""Fotografa cada peça de cenário de uma pasta, uma imagem por peça.

Rodar:
  blender --background --factory-startup --python tools/contato_cenario.py -- <pasta> <saida>

Depois de separar as peças eu preciso saber QUAL É QUAL para dar nome e papel a
cada uma. Ler o nome do arquivo não diz nada (`itens_jardim_03`), e adivinhar
pela altura já me enganou uma vez. Então: um retrato de frente por peça, todos
na mesma escala relativa, e eu nomeio olhando.
"""
import bpy, sys, os, math, glob


def args():
    a = sys.argv
    a = a[a.index('--') + 1:] if '--' in a else []
    return (a[0] if a else None), (a[1] if len(a) > 1 else '.')


def caixa_da_cena():
    xs, ys, zs = [], [], []
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
    if not xs:
        return None
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def main():
    pasta, saida = args()
    if not pasta or not os.path.isdir(pasta):
        print('falta a pasta'); return
    if not os.path.isdir(saida):
        os.makedirs(saida)

    for arq in sorted(glob.glob(os.path.join(pasta, '*.glb'))):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=arq)
        cx = caixa_da_cena()
        if not cx:
            print('VAZIO|', arq); continue
        x0, y0, z0, x1, y1, z1 = cx
        cxx = (x0 + x1) / 2; cyy = (y0 + y1) / 2; czz = (z0 + z1) / 2
        span = max(x1 - x0, y1 - y0, z1 - z0)

        cena = bpy.context.scene
        cena.render.engine = 'BLENDER_WORKBENCH'
        cena.render.resolution_x = 420
        cena.render.resolution_y = 420
        try:
            cena.display.shading.light = 'STUDIO'
            cena.display.shading.color_type = 'TEXTURE'
        except Exception:
            pass

        cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'
        cam_d.ortho_scale = span * 1.35
        cam = bpy.data.objects.new('c', cam_d)
        cena.collection.objects.link(cam); cena.camera = cam
        cam.location = (cxx + span * 1.4, cyy + span * 1.4, czz + span * 1.4)

        # MIRA POR RESTRIÇÃO, não por conta de ângulo. Calcular o `rotation_euler`
        # à mão me deu quinze retratos pretos: o arquivo do Meshy chega com o eixo
        # vertical trocado em relação ao que eu supus, e a câmera ficou olhando
        # para fora da cena. Um `TRACK_TO` mirando um alvo no centro acerta
        # sozinho, seja qual for a convenção de eixo do arquivo.
        alvo = bpy.data.objects.new('alvo', None)
        alvo.location = (cxx, cyy, czz)
        cena.collection.objects.link(alvo)
        con = cam.constraints.new('TRACK_TO')
        con.target = alvo
        con.track_axis = 'TRACK_NEGATIVE_Z'
        con.up_axis = 'UP_Y'
        bpy.context.view_layer.update()

        nome = os.path.splitext(os.path.basename(arq))[0]
        cena.render.filepath = os.path.join(saida, nome + '.png')
        bpy.ops.render.render(write_still=True)
        print('RETRATO| %-28s alt=%.3f larg=%.3f' % (nome, y1 - y0, max(x1 - x0, z1 - z0)))


main()
