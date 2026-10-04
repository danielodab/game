# -*- coding: utf-8 -*-
"""Enxuga um módulo de parede do Meshy: malha baixa NOVA + textura REASSADA da alta.

POR QUE EXISTE (03/10/2026). O módulo de parede que o Meshy devolve tem 15 a 16
mil triângulos, e parede é a peça que mais se repete: o contorno do Salão da
Sede são 84 casas. Com a arte do dono o salão passou a desenhar 1,74 MILHÃO de
triângulos por quadro (medido, `R.stats()`), contra as caixas de antes, e a
prova `tests/guerra_hud.html` reprovou: no Chrome por software cada quadro
demorava tanto que a retentativa do "fechar a guerra" não cabia no prazo. Em
celular de entrada o efeito é o mesmo, só que no jogo.

POR QUE NÃO UM DECIMATE SIMPLES. Foi a primeira tentativa, e reprovou de olho:
a malha do Meshy é feita de centenas de ILHAS soltas (a parede lisa tem mais de
700) e o UV está preso à malha densa. Derrubar triângulos rasga as ilhas ("papel
amassado") e faz a textura escorregar nas fiadas.

O QUE ESTE SCRIPT FAZ é o caminho de sempre de jogo, alta -> baixa:
  1. a BAIXA nasce de um remesh por voxel da alta (uma casca só, sem ilhas),
     derrubada até o alvo de triângulos;
  2. ela ganha UV novo (Smart UV Project);
  3. a COR, o RELEVO (normal, espaço tangente) e a RUGOSIDADE são assados da
     alta para a baixa no Cycles (selecionado -> ativo). O relevo assado é o que
     devolve as juntas da pedra que a malha perdeu;
  4. exporta só a baixa, em JPEG: cor 1024, relevo e rugosidade 512 (a régua
     de `tools/reduz_texturas.py`; aqui já nascem assim).
O metal vira 0: são paredes de pedra e madeira, e o friso de bronze perde o
brilho de metal, que de longe não se lê.

Rodar (quem chama é o `tools/prepara_cenario_lancamento.py`):
  blender --background --factory-startup --python tools/enxuga_muros_lancamento.py -- \
      <pasta das peças> <chave>:<triângulos|caixa> [<chave>:<triângulos|caixa> ...]
`caixa` no lugar do número faz a baixa ser a caixa da peça (12 triângulos): é o modo
da parede de tijolo do salão, ver o comentário no passo 1a.
A peça cheia é guardada em `<pasta>/_cheio/<chave>.glb` e a enxuta toma o lugar.
Rodar de novo parte SEMPRE da cheia guardada (não enxuga o que já foi enxugado).
"""
import bpy, os, sys, math, shutil

COR_PX, RELEVO_PX = 1024, 512
VOXELS = 200                # a maior medida da peça dividida por isto = o voxel


def malhas():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def so(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def tris(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def imagem(nome, px, cor):
    img = bpy.data.images.new(nome, px, px, alpha=True)
    if not cor:
        img.colorspace_settings.name = 'Non-Color'
    return img


def tapa_furos(img, voltas=96):
    """O raio do assado que não acha a alta deixa o pixel PRETO e transparente. Na face
    da parede isso acontece nas frestas entre os tijolos da ponta, e na fileira vira uma
    tira preta em cada emenda. Cada pixel sem resposta copia o vizinho que tem (em
    voltas, de fora para dentro do furo), e no fim a imagem fica opaca."""
    import numpy as np
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    ok = px[:, :, 3] > 0.5
    for _ in range(voltas):
        if ok.all():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            viz = np.roll(ok, (dy, dx), axis=(0, 1))
            cor = np.roll(px, (dy, dx), axis=(0, 1))
            pega = (~ok) & viz
            px[pega] = cor[pega]
            ok = ok | pega
    px[:, :, 3] = 1.0
    img.pixels[:] = px.reshape(-1).tolist()
    img.update()


def enxuga(pasta, chave, alvo):
    cheio_dir = os.path.join(pasta, '_cheio')
    if not os.path.isdir(cheio_dir):
        os.makedirs(cheio_dir)
    destino = os.path.join(pasta, chave + '.glb')
    cheio = os.path.join(cheio_dir, chave + '.glb')
    if not os.path.exists(cheio):
        shutil.copyfile(destino, cheio)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=cheio)
    ms = malhas()
    so(ms[0])
    for o in ms:
        o.select_set(True)
    if len(ms) > 1:
        bpy.ops.object.join()
    alta = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    alta.name = 'alta'
    n_alta = tris(alta)
    maior = max(alta.dimensions)
    voxel = maior / VOXELS

    caixa = (alvo == 'caixa')
    xs = [v.co.x for v in alta.data.vertices]
    ys = [v.co.y for v in alta.data.vertices]
    zs = [v.co.z for v in alta.data.vertices]
    x0, x1, y0, y1, z0, z1 = min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)
    if caixa:
        # 1a. A BAIXA É A CAIXA da peça: 12 triângulos de face chapada. É o modo da parede
        # do Salão da Sede, que é tijolo de junta funda. Lá a casca derrubada (o modo de
        # baixo) saiu manchada: as normais de uma malha de 2 000 triângulos ondulam, e o
        # relevo assado em cima delas borra as fiadas. Numa face plana a normal é uma só e
        # o relevo assado guarda a junta inteira. Perde-se a saliência da cornija no
        # contorno (ela fica pintada e com relevo), que a 15 m de câmera não se lê.
        # A LARGURA DA CAIXA É A DO CORPO, não a da cornija. A cornija passa uns
        # centímetros dos tijolos de cada lado; com a caixa na largura dela, a ponta da
        # face não acha tijolo atrás, o raio do assado erra e fica uma tira preta em cada
        # emenda da fileira. Medida na faixa do meio da altura, a caixa fecha nos tijolos.
        meio = [v.co.x for v in alta.data.vertices if z0 + 0.3 * (z1 - z0) < v.co.z < z0 + 0.7 * (z1 - z0)]
        if meio:
            x0, x1 = min(meio), max(meio)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        baixa = bpy.context.view_layer.objects.active
        baixa.name = 'baixa'
        baixa.scale = (x1 - x0, y1 - y0, z1 - z0)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        n_casca = 12
        bpy.ops.object.shade_flat()
    else:
        # 1b. a baixa: casca por voxel, derrubada até o alvo
        so(alta)
        bpy.ops.object.duplicate()
        baixa = bpy.context.view_layer.objects.active
        baixa.name = 'baixa'
        baixa.data.materials.clear()
        so(baixa)
        rm = baixa.modifiers.new('casca', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = voxel
        bpy.ops.object.modifier_apply(modifier=rm.name)
        n_casca = tris(baixa)
        dc = baixa.modifiers.new('derruba', 'DECIMATE')
        dc.decimate_type = 'COLLAPSE'
        dc.ratio = min(1.0, float(alvo) / max(1, n_casca))
        dc.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dc.name)
        # AS PONTAS RETAS. O módulo emenda com a cópia vizinha, e a casca derrubada deixa a
        # borda ondulada (um voxel para dentro aqui, um para fora ali): em fileira isso vira
        # uma costura de fendas. Todo vértice a até voxel e meio de um extremo em X (as duas
        # pontas) ou em Z (a base e o topo) vai para o plano do extremo. Em Y (a espessura)
        # não: lá estão o relevo da face e a saliência da cornija.
        folga = voxel * 1.5
        for v in baixa.data.vertices:
            if v.co.x < x0 + folga: v.co.x = x0
            elif v.co.x > x1 - folga: v.co.x = x1
            if v.co.z < z0 + folga: v.co.z = z0
            elif v.co.z > z1 - folga: v.co.z = z1
        baixa.data.update()
        bpy.ops.object.shade_smooth()
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
        except Exception:
            pass

    # 2. UV novo
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.012)
    bpy.ops.object.mode_set(mode='OBJECT')

    # 3. o material da baixa, com as três imagens que vão receber o assado
    mat = bpy.data.materials.new('enxuta_' + chave)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    imgs = {'cor': imagem(chave + '_cor', COR_PX, True),
            'relevo': imagem(chave + '_relevo', RELEVO_PX, False),
            'rug': imagem(chave + '_rug', RELEVO_PX, False)}
    nos = {}
    for k, img in imgs.items():
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        nos[k] = n
    baixa.data.materials.append(mat)

    cena = bpy.context.scene
    cena.render.engine = 'CYCLES'
    try:
        cena.cycles.device = 'CPU'
    except Exception:
        pass
    cena.cycles.samples = 6
    bk = cena.render.bake
    bk.use_selected_to_active = True
    if caixa:
        # a caixa está POR FORA da alta: o raio parte dela e entra até achar o tijolo
        bk.cage_extrusion = voxel * 1.0
        bk.max_ray_distance = (y1 - y0) * 0.9
    else:
        bk.cage_extrusion = voxel * 2.5   # a casca fica a menos de um voxel da alta
        bk.max_ray_distance = voxel * 6.0
    bk.margin = 8
    bk.use_clear = True

    def assa(tipo, qual, **extra):
        for n in nt.nodes:
            n.select = False
        nos[qual].select = True
        nt.nodes.active = nos[qual]
        bpy.ops.object.select_all(action='DESELECT')
        alta.select_set(True)
        baixa.select_set(True)
        bpy.context.view_layer.objects.active = baixa
        bpy.ops.object.bake(type=tipo, use_selected_to_active=True, cage_extrusion=bk.cage_extrusion,
                            max_ray_distance=bk.max_ray_distance, margin=8, **extra)

    assa('DIFFUSE', 'cor', pass_filter={'COLOR'})
    assa('NORMAL', 'relevo', normal_space='TANGENT')
    assa('ROUGHNESS', 'rug')

    # 4. liga as três no material e exporta só a baixa
    nt.links.new(nos['cor'].outputs['Color'], bsdf.inputs['Base Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nos['relevo'].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(nos['rug'].outputs['Color'], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0.0
    for img in imgs.values():
        tapa_furos(img)
        img.pack()
    so(baixa)
    bpy.ops.export_scene.gltf(filepath=destino, export_format='GLB', use_selection=True,
                              export_animations=False, export_image_format='JPEG')
    print('ENXUTA| %-20s %6d -> %5d tris (casca %d)  %.2f -> %.2f MB'
          % (chave, n_alta, tris(baixa), n_casca, os.path.getsize(cheio) / 1048576.0,
             os.path.getsize(destino) / 1048576.0))


def main():
    a = sys.argv
    a = a[a.index('--') + 1:] if '--' in a else []
    if len(a) < 2 or not os.path.isdir(a[0]):
        print('USO: ... --python tools/enxuga_muros_lancamento.py -- <pasta das peças> <chave>:<tris> ...')
        return
    for par in a[1:]:
        chave, alvo = par.split(':')
        try:
            enxuga(a[0], chave, alvo if alvo == 'caixa' else int(alvo))
        except Exception as e:
            import traceback
            traceback.print_exc()
            print('ENXUTA-ERRO| %s: %s' % (chave, e))


main()
