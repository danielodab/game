# -*- coding: utf-8 -*-
"""Normaliza os MUROS de um lote que vem um muro por arquivo, sem separar nada.

É o `normaliza_muros_fecho.py` com a pasta por ARGUMENTO. Do lote do lançamento
(03/10) em diante o muro chega sozinho no arquivo (regra do dono: "muros devem
ser individuais"), e três lotes entraram na mesma noite: Sala de Guerra,
Santuário dos Elementos e Câmara do Eco. Copiar o script do Fecho três vezes
só para trocar duas linhas era pedir para uma das cópias ficar para trás.

Outra diferença, e esta é regra: a pasta do dono NÃO recebe nada. O do Fecho
gravava em `<pasta do dono>\muros\_separado`; aqui a saída é a segunda pasta,
que quem chama escolhe (o `tools/prepara_cenario_lancamento.py` passa a pasta
de trabalho dele).

O que faz é o de sempre: textura reamostrada a 1024 e exportação em JPEG (os
crus têm 13 a 18 MB cada). Assentar e centrar NÃO se faz aqui: o renderizador
já mede a caixa e corrige na montagem (`pecaUsuario`, `muroDaCasa`).

Rodar:
  "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background \
      --factory-startup --python tools/normaliza_muros_lancamento.py -- <origem> <destino>
O nome de saída é o do arquivo, em minúsculas e com `_` no lugar de espaço.

ENXUGAR A MALHA NÃO: tentei (03/10) um Decimate para a parede da Sala de
Guerra, que veste 84 casas, e reprovei de olho. A 3 500 triângulos a pedra
vira papel amassado, e a 8 000 o UV ainda escorrega nas fiadas (o relevo do
Meshy está preso à malha densa). O módulo entra cru, como nos calabouços, e
quem economiza é o renderizador, que desenha a parede do salão por instância.
"""
import bpy, os, sys

TEX_ALVO = 1024


def main():
    a = sys.argv
    a = a[a.index('--') + 1:] if '--' in a else []
    if len(a) < 2 or not os.path.isdir(a[0]):
        print('USO: ... --python tools/normaliza_muros_lancamento.py -- <origem> <destino>')
        return
    orig, dest = a[0], a[1]
    if not os.path.isdir(dest):
        os.makedirs(dest)
    for nome in sorted(os.listdir(orig)):
        if not nome.lower().endswith('.glb'):
            continue
        saida = nome.lower().replace(' ', '_')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.join(orig, nome))
        n = 0
        for img in bpy.data.images:
            if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
                img.scale(TEX_ALVO, TEX_ALVO)
                img.pack()
                n += 1
        tris, dims = 0, None
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
                dims = tuple(round(v, 3) for v in o.dimensions)
        alvo = os.path.join(dest, saida)
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.export_scene.gltf(filepath=alvo, export_format='GLB',
                                  use_selection=True, export_animations=False,
                                  export_image_format='JPEG')
        print('MURO| %-22s %6.2f MB  %6d tris  dims %s  (%d textura(s) reamostrada(s))'
              % (saida, os.path.getsize(alvo) / 1048576.0, tris, dims, n))
    print('pronto:', dest)


main()
