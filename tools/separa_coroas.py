# -*- coding: utf-8 -*-
"""Recorta as DEZ COROAS do ranking PvP das duas folhas do Meshy.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/separa_coroas.py

POR QUE NAO USAR separa_cenario.py: ele ordena as pecas por ALTURA, e para as
coroas a ordem e a POSICAO NA FOLHA — "coroa 1 a 5.glb" traz as patentes I a V
lado a lado, e trocar a V pela II nao da erro nenhum, so da a coroa errada na
cabeca errada. Aqui a ordem e o eixo mais comprido da folha, da esquerda para
a direita, e a numeracao sai continua entre as folhas (01..05, depois 06..10).

O agrupamento por vizinhanca, o assentamento e a reamostragem sao os mesmos do
separa_cenario.py — copiados, nao importados, porque script de Blender roda
sozinho via --python e nao enxerga modulo vizinho sem mexer no sys.path.
A ORDEM DEPOIS SE CONFERE DE OLHO nos retratos (contato_cenario.py): as
patentes crescem em pompa, entao a I e a mais simples e a X a mais carregada.
"""
import bpy, os, sys

RAIZ = r"C:\Users\danie\Downloads\assets_ok\ranking_pvp"
SAIDA = os.path.join(RAIZ, "_separado")
MIN_TRIS = 40
MIN_TAM = 0.08         # fracao da folha; coroa e peca miuda numa folha de 5
TEX_ALVO = 1024
EIXO_ALT = 2
EIXO_CHAO = (0, 1)

# folha -> numero da primeira coroa dela (a ordem alfabetica bate: "1 a 5" < "6a10")
FOLHAS = [("coroa 1 a 5.glb", 1), ("coroa 6a10.glb", 6)]


def limpa_cena():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def separa_soltas():
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.mesh.separate(type='LOOSE')
        except Exception:
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.separate(type='LOOSE')
            bpy.ops.object.mode_set(mode='OBJECT')


def caixa(o):
    bpy.context.view_layer.update()
    ptos = [o.matrix_world @ v.co for v in o.data.vertices]
    if not ptos:
        return None
    xs = [p.x for p in ptos]; ys = [p.y for p in ptos]; zs = [p.z for p in ptos]
    return {'min': (min(xs), min(ys), min(zs)),
            'max': (max(xs), max(ys), max(zs)),
            'dim': (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))}


def agrupa(itens, folga):
    pai = list(range(len(itens)))

    def acha(i):
        while pai[i] != i:
            pai[i] = pai[pai[i]]; i = pai[i]
        return i

    def une(a, b):
        ra, rb = acha(a), acha(b)
        if ra != rb: pai[rb] = ra

    def perto(a, b):
        ca, cb = a['cx'], b['cx']
        for eixo in EIXO_CHAO:
            if ca['min'][eixo] - folga > cb['max'][eixo]: return False
            if cb['min'][eixo] - folga > ca['max'][eixo]: return False
        return True

    for i in range(len(itens)):
        for j in range(i + 1, len(itens)):
            if perto(itens[i], itens[j]): une(i, j)

    grupos = {}
    for i, it in enumerate(itens):
        grupos.setdefault(acha(i), []).append(it)
    return list(grupos.values())


def junta(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def desgira(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def assenta(o, cx):
    d = [(cx['min'][e] + cx['max'][e]) / 2.0 for e in (0, 1, 2)]
    d[EIXO_ALT] = cx['min'][EIXO_ALT]
    for v in o.data.vertices:
        v.co.x -= d[0]
        v.co.y -= d[1]
        v.co.z -= d[2]


def reamostra():
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO); img.pack()


def main():
    if not os.path.isdir(SAIDA):
        os.makedirs(SAIDA)
    total = 0
    for arq, primeiro in FOLHAS:
        cam = os.path.join(RAIZ, arq)
        if not os.path.exists(cam):
            print("FALTA:", cam); continue
        limpa_cena()
        bpy.ops.import_scene.gltf(filepath=cam)
        separa_soltas()
        reamostra()

        ilhas = []
        for o in [x for x in bpy.data.objects if x.type == 'MESH']:
            cx = caixa(o)
            if cx: ilhas.append({'obj': o, 'cx': cx})
        folha = 1.0
        if ilhas:
            tmin = [min(i['cx']['min'][e] for i in ilhas) for e in (0, 1, 2)]
            tmax = [max(i['cx']['max'][e] for i in ilhas) for e in (0, 1, 2)]
            folha = max(tmax[e] - tmin[e] for e in (0, 1, 2))

        # a mesma varredura de folga do separa_cenario: fica-se no patamar
        escala = [0.030, 0.020, 0.014, 0.010, 0.007, 0.005, 0.0035, 0.0025, 0.0015, 0.001]
        contagens = [(f, len(agrupa(ilhas, folha * f))) for f in escala]
        print('   varredura:', ' '.join('%.4f>%d' % c for c in contagens))
        melhor, corrida, atual, ini = None, 0, None, None
        for f, n in contagens:
            if n != atual:
                atual, ini, corrida = n, f, 1
            else:
                corrida += 1
            if n > 1 and (melhor is None or corrida > melhor[2]):
                melhor = (ini, n, corrida)
        folga_usada = melhor[0] if melhor else 0.03
        grupos = agrupa(ilhas, folha * folga_usada)
        print('   patamar: folga %.4f -> %d grupo(s)' % (folga_usada, len(grupos)))

        pecas, cacos = [], 0
        for g in grupos:
            o = junta([it['obj'] for it in g])
            t = tris(o)
            cx = caixa(o)
            if not cx or t < MIN_TRIS or max(cx['dim']) < folha * MIN_TAM:
                cacos += 1
                bpy.data.objects.remove(o, do_unlink=True)
                continue
            pecas.append({'obj': o, 'tris': t, 'cx': cx})

        # A ORDEM E A POSICAO: esquerda -> direita ao longo do eixo mais
        # comprido da folha, que e o eixo em que as coroas estao enfileiradas.
        a, b = EIXO_CHAO
        span_a = max(p['cx']['max'][a] for p in pecas) - min(p['cx']['min'][a] for p in pecas)
        span_b = max(p['cx']['max'][b] for p in pecas) - min(p['cx']['min'][b] for p in pecas)
        eixo_fila = a if span_a >= span_b else b
        pecas.sort(key=lambda p: (p['cx']['min'][eixo_fila] + p['cx']['max'][eixo_fila]) / 2.0)

        print('=== %s -> %d peca(s), %d caco(s)' % (arq, len(pecas), cacos))
        for i, p in enumerate(pecas):
            num = primeiro + i
            d = p['cx']['dim']
            print('   coroa_%02d  alt=%.3f  chao=%.3f x %.3f  tris=%d'
                  % (num, d[EIXO_ALT], d[a], d[b], p['tris']))
            o = p['obj']
            desgira(o)
            assenta(o, caixa(o))
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            destino = os.path.join(SAIDA, 'coroa_%02d.glb' % num)
            bpy.ops.export_scene.gltf(filepath=destino, export_format='GLB',
                                      use_selection=True, export_animations=False,
                                      export_image_format='JPEG')
            total += 1
    print('=== TOTAL: %d coroa(s) em %s' % (total, SAIDA))


main()
