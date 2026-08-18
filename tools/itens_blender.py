# -*- coding: utf-8 -*-
"""SOTERRA 2.0 — itens gerados no Blender, no estilo do KayKit.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/itens_blender.py

Sai em assets/candidatos/blender/*.glb — pasta coberta pelo .gitignore, porque
isto ainda e PROVA e nao entrega. Nada em js/ olha para ela.

POR QUE SCRIPT E NAO MOUSE
--------------------------
Item de RPG e geometria dura, e script faz EM SERIE: uma funcao `machado()` com
parametros gera vinte machados no mesmo estilo. Com 90 itens e 18 conjuntos, e o
caminho que se paga. O que script NAO faz e organico — rosto, mao, bicho —, e
isso continua vindo de acervo CC0.

A LICAO DA PRIMEIRA TENTATIVA (ficou registrada porque custou uma rodada)
------------------------------------------------------------------------
A primeira versao montava tudo empilhando CAIXA e CILINDRO. Reprovou de longe:
o machado virou marreta, o escudo virou porta, o elmo virou ovo. O motivo e que
a peca do KayKit se define pela SILHUETA — a meia-lua do gume, a ponta do
escudo, a aba do elmo — e caixa nao faz curva.

A tecnica certa e a de sempre em modelagem de item: desenhar o PERFIL em duas
dimensoes e extrudar. `perfil()` abaixo faz isso. As caixas continuam existindo
para o que e mesmo caixa (cabo, faixa), nao para o que tem forma.

AS REGRAS DE ESTILO DO KAYKIT, que este arquivo obedece
-------------------------------------------------------
1. Poucos poligonos, nada de subdivisao: centenas de triangulos, nao milhares.
2. Sombreamento CHAPADO — a faceta aparece, e e ela que da a leitura do kit.
3. Cor chapada, fosca, sem textura pintada. E DESSATURADA: o aco do kit e um
   cinza esverdeado, nao branco. Branco puro salta da paleta.
4. Chanfro pequeno em tudo, senao a aresta some contra o chao escuro.
5. Proporcao GROSSA e tamanho igual ao do kit — o machado dele tem 1,72 m, e um
   de 1,20 m parece de outro jogo mesmo com a forma certa.
"""
import bpy, bmesh, os, math
from mathutils import Vector

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "candidatos", "blender")

# Dessaturada de proposito: o aco do kit e cinza esverdeado, nao branco.
COR = {
    "aco":      (0.55, 0.58, 0.56, 1.0),
    "aco_esc":  (0.31, 0.34, 0.34, 1.0),
    "madeira":  (0.40, 0.26, 0.16, 1.0),
    "couro":    (0.20, 0.15, 0.13, 1.0),
    "ouro":     (0.80, 0.62, 0.28, 1.0),
    "quente":   (0.64, 0.24, 0.19, 1.0),
    "roxo":     (0.42, 0.32, 0.55, 1.0),
    "verde":    (0.28, 0.52, 0.36, 1.0),
}


def limpa():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(nome, rgba):
    m = bpy.data.materials.get(nome)
    if m:
        return m
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    if "Roughness" in b.inputs:
        b.inputs["Roughness"].default_value = 0.9
    if "Metallic" in b.inputs:
        b.inputs["Metallic"].default_value = 0.0
    return m


def perfil(nome, pontos, espessura, plano="XZ", pos=(0, 0, 0), cor="aco"):
    """Constroi a peca a partir da SILHUETA e depois engrossa.

    `pontos` e o contorno em 2D, em sentido anti-horario. E daqui que sai a
    meia-lua do gume e a ponta do escudo — as formas que caixa nao faz.
    """
    me = bpy.data.meshes.new(nome)
    bm = bmesh.new()
    vs = []
    for (a, b) in pontos:
        if plano == "XZ":
            v = bm.verts.new((a, 0.0, b))     # desenha de frente, engrossa em Y
        elif plano == "YZ":
            v = bm.verts.new((0.0, a, b))     # desenha de PERFIL, engrossa em X
        else:
            v = bm.verts.new((a, b, 0.0))     # desenha deitado, engrossa em Z
        vs.append(v)
    bm.faces.new(vs)
    bm.normal_update()
    # "YZ" dizia o nome e construia em XY: a crista do elmo saiu deitada para
    # tras e o elmo ficou com 1,28 m de profundidade para 0,86 de altura.
    eixo = (0, 1, 0) if plano == "XZ" else ((1, 0, 0) if plano == "YZ" else (0, 0, 1))
    r = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    desl = Vector(eixo) * espessura
    bmesh.ops.translate(bm, vec=desl,
                        verts=[v for v in r["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(nome, me)
    bpy.context.collection.objects.link(o)
    o.location = Vector(pos) - Vector(eixo) * (espessura * 0.5)
    o.data.materials.append(material(cor, COR[cor]))
    return o


def caixa(nome, tam, pos=(0, 0, 0), rot=(0, 0, 0), cor="aco"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos, rotation=rot)
    o = bpy.context.active_object
    o.name = nome
    o.scale = Vector(tam)          # size=1 ja e um cubo de UMA unidade
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material(cor, COR[cor]))
    return o


def cilindro(nome, r, h, pos=(0, 0, 0), rot=(0, 0, 0), cor="madeira", lados=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=lados, radius=r, depth=h,
                                        location=pos, rotation=rot)
    o = bpy.context.active_object
    o.name = nome
    o.data.materials.append(material(cor, COR[cor]))
    return o


def chanfra(o, larg=0.014):
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                    offset=larg, segments=1, affect="EDGES", profile=0.5,
                    clamp_overlap=True)
    bm.to_mesh(me)
    bm.free()


def chapado(o):
    for p in o.data.polygons:
        p.use_smooth = False


def junta(objs, nome):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = nome
    return o


def finaliza(o, nome, altura_alvo=None):
    chanfra(o)
    chapado(o)
    o.name = nome
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    if altura_alvo:
        # o item do kit tem um tamanho; um menor parece de outro jogo mesmo com
        # a forma certa. Foi o segundo erro da primeira tentativa.
        atual = o.dimensions.z
        if atual > 0.001:
            o.scale = (altura_alvo / atual,) * 3
            bpy.ops.object.transform_apply(scale=True)
    mn = min((o.matrix_world @ Vector(c)).z for c in o.bound_box)
    o.location.z -= mn
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


# ---------------------------------------------------------------- os itens
def machado():
    """Machado de duas maos. O gume e um PERFIL de meia-lua, com barba embaixo
    e bico em cima — a silhueta que se reconhece a 20 px."""
    cabo = cilindro("cabo", 0.052, 1.42, pos=(0, 0, 0.71), cor="madeira", lados=8)
    gume = perfil("gume", [
        (0.04, 1.36), (0.20, 1.44), (0.34, 1.36), (0.42, 1.18),
        (0.44, 0.98), (0.38, 0.80), (0.26, 0.70), (0.14, 0.72),
        (0.07, 0.84), (0.05, 1.06),
    ], 0.075, pos=(0, 0, 0), cor="aco")
    contra = perfil("contra", [
        (-0.04, 1.30), (-0.20, 1.24), (-0.24, 1.10), (-0.18, 0.94),
        (-0.05, 0.90),
    ], 0.065, pos=(0, 0, 0), cor="aco_esc")
    anel1 = cilindro("a1", 0.066, 0.075, pos=(0, 0, 1.34),
                     rot=(math.radians(90), 0, 0), cor="couro", lados=8)
    anel2 = cilindro("a2", 0.066, 0.075, pos=(0, 0, 0.92),
                     rot=(math.radians(90), 0, 0), cor="couro", lados=8)
    pomo = cilindro("pomo", 0.062, 0.09, pos=(0, 0, 0.04), cor="aco_esc", lados=8)
    return finaliza(junta([cabo, gume, contra, anel1, anel2, pomo], "x"),
                    "Blender_2H_Axe", altura_alvo=1.72)


def escudo():
    """Escudo de brasao: ombros retos em cima e PONTA embaixo. E a ponta que
    faz o escudo parecer escudo; a chapa retangular virava porta."""
    chapa = perfil("chapa", [
        (-0.30, 0.98), (0.30, 0.98), (0.32, 0.72), (0.28, 0.44),
        (0.16, 0.18), (0.00, 0.02), (-0.16, 0.18), (-0.28, 0.44),
        (-0.32, 0.72),
    ], 0.085, plano="XZ", cor="madeira")
    borda = perfil("borda", [
        (-0.345, 1.02), (0.345, 1.02), (0.365, 0.72), (0.325, 0.43),
        (0.19, 0.15), (0.00, -0.03), (-0.19, 0.15), (-0.325, 0.43),
        (-0.365, 0.72),
    ], 0.055, plano="XZ", pos=(0, 0.016, 0), cor="aco")
    faixa = caixa("faixa", (0.13, 0.05, 0.80), pos=(0, -0.058, 0.52), cor="quente")
    umbo = cilindro("umbo", 0.10, 0.07, pos=(0, -0.075, 0.60),
                    rot=(math.radians(90), 0, 0), cor="ouro", lados=8)
    return finaliza(junta([borda, chapa, faixa, umbo], "x"),
                    "Blender_Shield", altura_alvo=1.02)


def elmo():
    """Elmo com ABA: a silhueta do kit tem a saia que desce sobre a nuca. Sem
    ela sobra um ovo, que foi o que saiu da primeira tentativa."""
    casco = perfil("casco", [
        (-0.27, 0.30), (-0.29, 0.50), (-0.22, 0.66), (-0.08, 0.74),
        (0.08, 0.74), (0.22, 0.66), (0.29, 0.50), (0.27, 0.30),
        (0.31, 0.22), (0.30, 0.12), (0.18, 0.06), (-0.18, 0.06),
        (-0.30, 0.12), (-0.31, 0.22),
    ], 0.50, plano="XZ", cor="aco")
    fresta = caixa("fresta", (0.40, 0.10, 0.055), pos=(0, -0.235, 0.45), cor="couro")
    nasal = caixa("nasal", (0.06, 0.10, 0.20), pos=(0, -0.235, 0.32), cor="aco_esc")
    crista = perfil("crista", [
        (0.20, 0.70), (0.10, 0.90), (-0.06, 0.96), (-0.20, 0.90), (-0.22, 0.74),
        (-0.10, 0.78), (0.06, 0.76),
    ], 0.07, plano="YZ", pos=(0, 0, 0), cor="quente")
    return finaliza(junta([casco, fresta, nasal, crista], "x"),
                    "Blender_Helmet", altura_alvo=0.86)


def cajado():
    """Cajado com cabeca GROSSA. O cristal fino da primeira tentativa sumia no
    tabuleiro; aqui a cabeca e larga como a do kit."""
    haste = cilindro("haste", 0.052, 1.55, pos=(0, 0, 0.78), cor="madeira", lados=8)
    garra = perfil("garra", [
        (-0.20, 1.52), (-0.24, 1.72), (-0.12, 1.88), (0.00, 1.94),
        (0.12, 1.88), (0.24, 1.72), (0.20, 1.52), (0.12, 1.62),
        (0.00, 1.60), (-0.12, 1.62),
    ], 0.09, plano="XZ", cor="aco_esc")
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.135,
                                          location=(0, 0, 1.70))
    cristal = bpy.context.active_object
    cristal.name = "cristal"
    cristal.data.materials.append(material("roxo", COR["roxo"]))
    anel = cilindro("anel", 0.072, 0.08, pos=(0, 0, 1.46),
                    rot=(math.radians(90), 0, 0), cor="ouro", lados=8)
    pomo = cilindro("pomo", 0.058, 0.09, pos=(0, 0, 0.04), cor="aco_esc", lados=8)
    return finaliza(junta([haste, garra, cristal, anel, pomo], "x"),
                    "Blender_Staff", altura_alvo=2.15)


ITENS = [("machado", machado), ("escudo", escudo), ("elmo", elmo), ("cajado", cajado)]


def main():
    if not os.path.isdir(SAIDA):
        os.makedirs(SAIDA)
    rel = []
    for nome, fn in ITENS:
        limpa()
        o = fn()
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        d = o.dimensions
        cam = os.path.join(SAIDA, nome + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=cam, export_format="GLB",
                                  use_selection=True, export_apply=True,
                                  export_yup=True)
        rel.append((nome, tris, d.x, d.y, d.z, os.path.getsize(cam) / 1024.0))

    print("\n=== ITENS GERADOS ===")
    print("%-10s %7s  %-20s %8s" % ("item", "tris", "tamanho (m)", "KB"))
    for n, t, x, y, z, kb in rel:
        print("%-10s %7d  %4.2f x %4.2f x %4.2f %8.1f" % (n, t, x, y, z, kb))
    print("TOTAL %.1f KB" % sum(r[5] for r in rel))


main()
