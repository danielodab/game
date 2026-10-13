# -*- coding: utf-8 -*-
"""SOTERRA — as folhas de efeito renderizadas no BLENDER (12/10).

Rodar (demora uns minutos; cada folha são 16 quadros no Cycles, CPU):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --factory-startup \\
      --python tools/fx_blender.py -- <pasta de saída> [tipo ...]

Sai <pasta>/<tipo>/f01.png … f16.png (RGBA, 256 px, fundo transparente). Quem monta a
folha 4×4 e embute em assets/embedded/fx-blender.js é tools/embute_fx_blender.py.

POR QUE EXISTE
--------------
O dono (12/10): "crie mais efeitos visuais nos ataques… tenho o Blender… muita coisa
repetitiva". O jogo tinha cinco filmes do acervo (estouro, chama, baque, anel, onda)
tingidos por elemento e quatro do CGHEVEN. Todo golpe de contato era a MESMA meia-lua
parada; o tiro e a bola não tinham filme nenhum no alvo; o chão nunca rachava.

Aqui cada efeito é GEOMETRIA EMISSIVA animada por quadro, vista de cima por uma câmera
ortográfica, em branco (as folhas são `tipo:branco`: o jogo as tinge com a cor do
elemento em js/render3d/fx3d_v2.js, `filme()`). Nada de partículas do Blender nem de
simulação — tudo keyframe, para o render ser determinístico e rápido.

OS SETE
-------
  golpe      o arco de um corte: uma lâmina curva que VARRE o quadro, núcleo branco
  impacto    o estouro seco de um acerto: clarão, lascas radiais e um anel
  rachadura  o chão rachando a partir do centro (folha de chão)
  raio       um relâmpago que desce, ramifica e pisca
  jato       a coluna d'água que sobe e respinga
  pilar      a coluna de luz da cura e da invocação, com faíscas subindo
  selo       o círculo de runas que gira (folha de chão)
"""
import bpy, math, os, random, sys

try:
    argv = sys.argv[sys.argv.index('--') + 1:]
except ValueError:
    argv = []
SAIDA = argv[0] if argv else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'candidatos', 'fx_blender')
SO = argv[1:]
QUADROS = 16
PX = 256
AMOSTRAS = 40


# ------------------------------------------------------------------ a cena
def cena_nova(nome):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # keyframes LINEARES de nascença (o Bézier dá 'overshoot' na escala; e o Blender 5.2 não tem mais Action.fcurves
    # para ajustar depois — as ações são em camadas)
    try:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    except Exception:
        pass
    sc = bpy.context.scene
    sc.name = nome
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = AMOSTRAS
    sc.cycles.use_denoising = False
    try:
        sc.cycles.use_adaptive_sampling = True
    except Exception:
        pass
    sc.render.resolution_x = sc.render.resolution_y = PX
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    try:
        sc.view_settings.view_transform = 'Standard'   # branco é branco: sem AgX/Filmic escurecendo o clarão
        sc.view_settings.look = 'None'
    except Exception:
        pass
    sc.frame_start = 1
    sc.frame_end = QUADROS
    # mundo preto
    w = bpy.data.worlds.new('mundo')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0, 0, 0, 1)
        bg.inputs[1].default_value = 0.0
    # câmera ortográfica olhando para baixo: o quadro vai de -1 a 1 nos dois eixos
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 2.0
    cd.clip_start = 0.1
    cd.clip_end = 100
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 10)
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    return sc


# --------------------------------------------------------------- materiais
def material(nome, forca=1.0, mascara=None, cor=(1, 1, 1)):
    """Emissão branca × força, misturada com transparente pela MÁSCARA (uma função que
    monta nós e devolve o socket 0..1); sem máscara, a peça inteira acende."""
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (cor[0], cor[1], cor[2], 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    forca_no = nt.nodes.new('ShaderNodeValue')
    forca_no.name = 'forca'
    forca_no.outputs[0].default_value = forca
    nt.links.new(forca_no.outputs[0], em.inputs['Strength'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    if mascara:
        nt.links.new(mascara(nt), mix.inputs['Fac'])
    else:
        mix.inputs['Fac'].default_value = 1.0
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    m['forca_no'] = 'forca'
    return m


def no_forca(m):
    return m.node_tree.nodes['forca'].outputs[0]


def chave_forca(m, quadro, valor):
    s = no_forca(m)
    s.default_value = valor
    s.keyframe_insert('default_value', frame=quadro)


def chave_valor(nt, nome, quadro, valor):
    s = nt.nodes[nome].outputs[0]
    s.default_value = valor
    s.keyframe_insert('default_value', frame=quadro)


def mapa(nt, entrada, de0, de1, para0, para1, suave=True):
    mr = nt.nodes.new('ShaderNodeMapRange')
    try:
        mr.interpolation_type = 'SMOOTHSTEP' if suave else 'LINEAR'
    except Exception:
        pass
    mr.clamp = True
    nt.links.new(entrada, mr.inputs['Value'])
    mr.inputs['From Min'].default_value = de0
    mr.inputs['From Max'].default_value = de1
    mr.inputs['To Min'].default_value = para0
    mr.inputs['To Max'].default_value = para1
    return mr


def mult(nt, a, b):
    mt = nt.nodes.new('ShaderNodeMath')
    mt.operation = 'MULTIPLY'
    nt.links.new(a, mt.inputs[0])
    nt.links.new(b, mt.inputs[1])
    return mt.outputs[0]


def uv_xy(nt):
    uv = nt.nodes.new('ShaderNodeUVMap')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs[0], sep.inputs[0])
    return sep.outputs['X'], sep.outputs['Y']


def perfil_v(nt, v, borda=0.15):
    """brilho através da faixa: 1 no meio, cai suave para 0 nas bordas (v em 0..1)"""
    d = nt.nodes.new('ShaderNodeMath'); d.operation = 'SUBTRACT'; nt.links.new(v, d.inputs[0]); d.inputs[1].default_value = 0.5
    a = nt.nodes.new('ShaderNodeMath'); a.operation = 'ABSOLUTE'; nt.links.new(d.outputs[0], a.inputs[0])
    mr = mapa(nt, a.outputs[0], 0.5 - borda, 0.5, 1.0, 0.0)
    return mr.outputs[0]


def mascara_janela(nome_cabeca, largura, cauda=0.08):
    """a 'cabeça' (um Value animado) anda em u; acende o trecho [cabeça-largura, cabeça]"""
    def f(nt):
        u, v = uv_xy(nt)
        cab = nt.nodes.new('ShaderNodeValue'); cab.name = nome_cabeca; cab.outputs[0].default_value = 0.0
        # atrás da cabeça: sobe de 0 a 1 entre cabeça-largura e cabeça-largura+0.25 (rastro que some)
        s1 = nt.nodes.new('ShaderNodeMath'); s1.operation = 'SUBTRACT'; nt.links.new(cab.outputs[0], s1.inputs[0]); s1.inputs[1].default_value = largura
        d1 = nt.nodes.new('ShaderNodeMath'); d1.operation = 'SUBTRACT'; nt.links.new(u, d1.inputs[0]); nt.links.new(s1.outputs[0], d1.inputs[1])
        r1 = mapa(nt, d1.outputs[0], 0.0, largura * 0.6, 0.0, 1.0)
        # à frente da cabeça: cai de 1 a 0 em `cauda`
        d2 = nt.nodes.new('ShaderNodeMath'); d2.operation = 'SUBTRACT'; nt.links.new(cab.outputs[0], d2.inputs[0]); nt.links.new(u, d2.inputs[1])
        r2 = mapa(nt, d2.outputs[0], 0.0, cauda, 0.0, 1.0)
        return mult(nt, mult(nt, r1.outputs[0], r2.outputs[0]), perfil_v(nt, v))
    return f


def mascara_radial(raio_cheio=0.2, raio_zero=1.0):
    """um disco macio: 1 no centro até raio_cheio, 0 em raio_zero — medido no UV do plano (a meia-largura
    vale 1,0), então serve ao clarão de 2×2 e à gota de 0,16 do mesmo jeito; em coordenadas de objeto a
    gota inteira cabia dentro de raio_cheio e saía QUADRADA"""
    def f(nt):
        u, v = uv_xy(nt)
        du = nt.nodes.new('ShaderNodeMath'); du.operation = 'SUBTRACT'; nt.links.new(u, du.inputs[0]); du.inputs[1].default_value = 0.5
        dv = nt.nodes.new('ShaderNodeMath'); dv.operation = 'SUBTRACT'; nt.links.new(v, dv.inputs[0]); dv.inputs[1].default_value = 0.5
        x2 = mult(nt, du.outputs[0], du.outputs[0]); y2 = mult(nt, dv.outputs[0], dv.outputs[0])
        ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'; nt.links.new(x2, ad.inputs[0]); nt.links.new(y2, ad.inputs[1])
        sq = nt.nodes.new('ShaderNodeMath'); sq.operation = 'SQRT'; nt.links.new(ad.outputs[0], sq.inputs[0])
        mr = mapa(nt, sq.outputs[0], raio_cheio * 0.5, raio_zero * 0.5, 1.0, 0.0)
        return mr.outputs[0]
    return f


def mascara_faixa_v(borda=0.3):
    """só o perfil através da faixa (para as hastes e os pilares)"""
    def f(nt):
        u, v = uv_xy(nt)
        return perfil_v(nt, v, borda)
    return f


def mascara_pilar():
    """o pilar: perfil radial em u (centro claro) e esmaece no alto em v"""
    def f(nt):
        u, v = uv_xy(nt)
        topo = mapa(nt, v, 0.45, 1.0, 1.0, 0.0)
        base = mapa(nt, v, 0.0, 0.08, 0.0, 1.0)
        return mult(nt, mult(nt, perfil_v(nt, u, 0.5), topo.outputs[0]), base.outputs[0])
    return f


# ------------------------------------------------------------- geometria
def malha(nome, verts, faces, uvs=None, mat=None, z=0.0):
    me = bpy.data.meshes.new(nome)
    me.from_pydata([(x, y, z) for (x, y) in verts], [], faces)
    me.update()
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uvl.data[li].uv = uvs[vi]
    ob = bpy.data.objects.new(nome, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
    return ob


def faixa(nome, pontos, larguras, mat, z=0.0, uv_u=None):
    """uma tira ao longo de `pontos` (lista de (x,y)), com a largura de cada ponto; u = fração do caminho, v = 0..1 através"""
    n = len(pontos)
    verts, uvs = [], []
    comp = [0.0]
    for i in range(1, n):
        dx = pontos[i][0] - pontos[i - 1][0]; dy = pontos[i][1] - pontos[i - 1][1]
        comp.append(comp[-1] + math.hypot(dx, dy))
    tot = comp[-1] or 1.0
    for i in range(n):
        if i == 0:
            dx = pontos[1][0] - pontos[0][0]; dy = pontos[1][1] - pontos[0][1]
        elif i == n - 1:
            dx = pontos[-1][0] - pontos[-2][0]; dy = pontos[-1][1] - pontos[-2][1]
        else:
            dx = pontos[i + 1][0] - pontos[i - 1][0]; dy = pontos[i + 1][1] - pontos[i - 1][1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        w = larguras[i] / 2
        verts.append((pontos[i][0] + nx * w, pontos[i][1] + ny * w))
        verts.append((pontos[i][0] - nx * w, pontos[i][1] - ny * w))
        u = (uv_u[i] if uv_u else comp[i] / tot)
        uvs.append((u, 1.0)); uvs.append((u, 0.0))
    faces = []
    for i in range(n - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    return malha(nome, verts, faces, uvs, mat, z)


def plano(nome, w, h, mat, z=0.0):
    verts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    return malha(nome, verts, [(0, 1, 2, 3)], uvs, mat, z)


def anel(nome, r, esp, mat, z=0.0, seg=64):
    verts, uvs, faces = [], [], []
    for i in range(seg):
        a = i / seg * math.tau
        verts.append(((r + esp / 2) * math.cos(a), (r + esp / 2) * math.sin(a)))
        verts.append(((r - esp / 2) * math.cos(a), (r - esp / 2) * math.sin(a)))
        uvs.append((i / seg, 1.0)); uvs.append((i / seg, 0.0))
    for i in range(seg):
        a = i * 2; b = ((i + 1) % seg) * 2
        faces.append((a, a + 1, b + 1, b))
    return malha(nome, verts, faces, uvs, mat, z)


def chave(ob, quadro, loc=None, esc=None, rot=None):
    if loc is not None:
        ob.location = loc; ob.keyframe_insert('location', frame=quadro)
    if esc is not None:
        ob.scale = esc; ob.keyframe_insert('scale', frame=quadro)
    if rot is not None:
        ob.rotation_euler = rot; ob.keyframe_insert('rotation_euler', frame=quadro)


def _curvas(action):
    """as F-curves de uma ação, na API antiga (action.fcurves) ou na de camadas do Blender 4.4+/5.x"""
    fcs = getattr(action, 'fcurves', None)
    if fcs is not None:
        return list(fcs)
    out = []
    for layer in getattr(action, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for cb in getattr(strip, 'channelbags', []):
                out.extend(list(cb.fcurves))
    return out


def linear(ob):
    """interpolação linear em todas as curvas do objeto (as de Bézier dão 'overshoot' em escala);
    a preferência de cena_nova já faz isso de nascença — aqui é só garantia"""
    try:
        if ob.animation_data and ob.animation_data.action:
            for fc in _curvas(ob.animation_data.action):
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
    except Exception:
        pass


def linear_nt(nt):
    try:
        ad = nt.animation_data
        if ad and ad.action:
            for fc in _curvas(ad.action):
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
    except Exception:
        pass


# ------------------------------------------------------------ os efeitos
def golpe():
    """a lâmina curva que varre: um arco de 150°, grosso no meio, núcleo branco"""
    sc = cena_nova('golpe')
    rd = random.Random(7)
    n = 48
    pts, lar = [], []
    for i in range(n):
        t = i / (n - 1)
        a = math.radians(-78 + 156 * t)
        r = 0.84
        pts.append((r * math.sin(a), r * math.cos(a) - 0.16))
        lar.append(0.2 * math.sin(math.pi * t) ** 0.7 + 0.015)
    m = material('golpe', 6.0, mascara_janela('cabeca', 0.42, 0.05))
    ob = faixa('lamina', pts, lar, m)
    # a borda: a mesma tira mais larga, fraca, que fica um instante a mais (o rastro)
    m2 = material('golpe_rastro', 0.7, mascara_janela('cabeca', 0.7, 0.12))
    ob2 = faixa('rastro', pts, [w * 2.3 for w in lar], m2, z=-0.01)
    nt, nt2 = m.node_tree, m2.node_tree
    for q in range(1, QUADROS + 1):
        t = (q - 1) / 10.0
        chave_valor(nt, 'cabeca', q, min(1.45, 0.22 + t * 1.3))
        chave_valor(nt2, 'cabeca', q, min(1.6, 0.2 + t * 1.3))
        chave_forca(m, q, 6.0 if q <= 10 else max(0.0, 6.0 * (16 - q) / 6.0))
        chave_forca(m2, q, 0.7 if q <= 11 else max(0.0, 0.7 * (16 - q) / 5.0))
    linear_nt(nt); linear_nt(nt2)
    return sc


def impacto():
    """o acerto: clarão no centro, lascas radiais que voam e um anel que abre"""
    sc = cena_nova('impacto')
    rd = random.Random(11)
    mc = material('clarao', 8.0, mascara_radial(0.05, 1.0))
    cl = plano('clarao', 2.0, 2.0, mc, z=0.02)
    for q, e, f in [(1, 0.35, 9.0), (2, 0.75, 8.0), (4, 0.55, 4.0), (8, 0.25, 1.0), (12, 0.1, 0.0)]:
        chave(cl, q, esc=(e, e, 1)); chave_forca(mc, q, f)
    linear(cl)
    ma = material('anel', 3.0, mascara_faixa_v(0.5))
    an = anel('anel', 0.5, 0.16, ma)
    for q, e, f in [(1, 0.15, 4.0), (5, 1.1, 3.0), (10, 1.75, 1.0), (14, 2.0, 0.0)]:
        chave(an, q, esc=(e, e, 1)); chave_forca(ma, q, f)
    linear(an)
    ml = material('lasca', 6.0, mascara_faixa_v(0.5))
    for i in range(16):
        a = i / 16 * math.tau + rd.uniform(-0.12, 0.12)
        comp = rd.uniform(0.45, 0.95)
        w0 = rd.uniform(0.035, 0.07)
        pts = [(0, 0), (comp * 0.55, 0), (comp, 0)]
        ob = faixa('lasca%d' % i, pts, [w0, w0 * 0.7, 0.004], ml, z=0.01)
        ob.rotation_euler = (0, 0, a)
        for q, e in [(1, 0.15), (3, 0.6), (7, 1.0), (16, 1.12)]:
            chave(ob, q, esc=(e, 1, 1))
        linear(ob)
    for q, f in [(1, 7.0), (6, 6.0), (11, 1.5), (16, 0.0)]:
        chave_forca(ml, q, f)
    linear_nt(ml.node_tree)
    return sc


def rachadura():
    """o chão rachando: seis fendas que crescem do centro, com galhos, e um brilho que assenta"""
    sc = cena_nova('rachadura')
    rd = random.Random(23)
    mf = material('fenda', 5.0, mascara_janela('cabeca', 3.0, 0.04))
    nt = mf.node_tree
    for i in range(6):
        a0 = i / 6 * math.tau + rd.uniform(-0.25, 0.25)
        pts, lar = [(0.0, 0.0)], [0.12]
        x, y, a = 0.0, 0.0, a0
        n = rd.randint(5, 7)
        comp = rd.uniform(0.72, 0.98)
        for k in range(n):
            a += rd.uniform(-0.5, 0.5)
            passo = comp / n
            x += math.cos(a) * passo; y += math.sin(a) * passo
            pts.append((x, y)); lar.append(0.12 * (1 - (k + 1) / (n + 0.5)) + 0.008)
        ob = faixa('fenda%d' % i, pts, lar, mf)
        # um galho curto no meio
        kx = rd.randint(2, n - 1)
        bx, by = pts[kx]
        ab = a0 + rd.choice([-1, 1]) * rd.uniform(0.7, 1.3)
        gp = [(bx, by)]
        for k in range(3):
            gp.append((gp[-1][0] + math.cos(ab) * 0.12, gp[-1][1] + math.sin(ab) * 0.12)); ab += rd.uniform(-0.4, 0.4)
        faixa('galho%d' % i, gp, [0.05, 0.04, 0.026, 0.006], mf, uv_u=[0.55, 0.75, 0.9, 1.0])
    for q in range(1, QUADROS + 1):
        chave_valor(nt, 'cabeca', q, min(1.12, (q - 1) / 6.0 * 1.12))
        chave_forca(mf, q, 5.0 if q <= 11 else max(0.0, 5.0 * (16 - q) / 5.0))
    linear_nt(nt)
    mc = material('brilho_chao', 2.0, mascara_radial(0.05, 1.0))
    cl = plano('brilho', 2.0, 2.0, mc, z=-0.01)
    for q, e, f in [(1, 0.25, 2.2), (3, 0.7, 1.4), (8, 0.85, 0.7), (16, 0.9, 0.0)]:
        chave(cl, q, esc=(e, e, 1)); chave_forca(mc, q, f)
    linear(cl)
    return sc


def raio():
    """o relâmpago: desce em zigue-zague, ramifica, pisca e some"""
    sc = cena_nova('raio')
    rd = random.Random(5)
    mn = material('nucleo', 7.0, mascara_janela('cabeca', 3.0, 0.03))
    mg = material('halo', 1.3, mascara_janela('cabeca', 3.0, 0.03))
    pts = [(0.0, 0.98)]
    y = 0.98
    n = 10
    for k in range(n):
        y -= 1.9 / n
        pts.append((rd.uniform(-0.3, 0.3) * (0.4 + 0.6 * math.sin(math.pi * (k + 1) / n)), y))
    lar = [0.06 if 1 <= k <= n - 2 else 0.035 for k in range(n + 1)]
    faixa('raio', pts, lar, mn, z=0.01)
    faixa('halo', pts, [w * 3.2 for w in lar], mg, z=-0.01)
    # dois galhos
    for b in range(3):
        kx = rd.randint(2, n - 3)
        bx, by = pts[kx]
        d = rd.choice([-1, 1])
        gp = [(bx, by)]
        for k in range(4):
            gp.append((gp[-1][0] + d * rd.uniform(0.08, 0.18), gp[-1][1] - rd.uniform(0.08, 0.16)))
        uu = [kx / n + k * 0.07 for k in range(5)]
        faixa('galho%d' % b, gp, [0.035, 0.03, 0.022, 0.014, 0.004], mn, z=0.01, uv_u=uu)
        faixa('galhohalo%d' % b, gp, [0.1, 0.09, 0.07, 0.04, 0.01], mg, z=-0.01, uv_u=uu)
    ntn, ntg = mn.node_tree, mg.node_tree
    pisca = [0, 7.0, 7.5, 3.0, 8.0, 2.5, 6.5, 4.0, 5.0, 2.0, 3.0, 1.2, 1.6, 0.6, 0.3, 0.1, 0.0]
    for q in range(1, QUADROS + 1):
        cab = min(1.1, 0.25 + (q - 1) * 0.45)
        chave_valor(ntn, 'cabeca', q, cab); chave_valor(ntg, 'cabeca', q, cab)
        chave_forca(mn, q, pisca[q]); chave_forca(mg, q, pisca[q] * 0.22)
    linear_nt(ntn); linear_nt(ntg)
    return sc


def jato():
    """a coluna d'água: sobe, abre no alto, respinga em gotas e deixa o anel na base"""
    sc = cena_nova('jato')
    rd = random.Random(31)
    mcol = material('coluna', 3.5, mascara_pilar())
    col = plano('coluna', 0.42, 1.6, mcol)
    col.location = (0, -0.9, 0)       # a base no pé do quadro; a origem fica embaixo
    # a origem do plano está no centro: desloco a malha para a base ficar em y=0 do objeto
    for v in col.data.vertices:
        v.co.y += 0.8
    for q, ey, ex, f in [(1, 0.08, 0.6, 4.0), (4, 0.75, 0.9, 4.0), (7, 1.0, 1.0, 3.5), (11, 1.05, 1.15, 2.0), (16, 0.9, 1.3, 0.0)]:
        chave(col, q, esc=(ex, ey, 1)); chave_forca(mcol, q, f)
    linear(col)
    mg = material('gota', 4.0, mascara_radial(0.2, 0.9))
    for i in range(14):
        g = plano('gota%d' % i, 0.16, 0.16, mg, z=0.02)
        vx = rd.uniform(-0.55, 0.55); vy = rd.uniform(0.9, 1.5)
        x0 = rd.uniform(-0.08, 0.08); t0 = rd.randint(3, 7)
        for q in range(1, QUADROS + 1):
            t = max(0.0, (q - t0) / 10.0)
            x = x0 + vx * t; y = -0.9 + 0.5 + vy * t - 2.2 * t * t
            vis = 1.0 if q >= t0 and y > -0.95 else 0.0
            chave(g, q, loc=(x, y, 0.02), esc=(vis * (0.8 + 0.4 * t), vis * (1.0 + 0.6 * t), 1))
        linear(g)
    for q, f in [(1, 4.0), (10, 3.0), (16, 0.0)]:
        chave_forca(mg, q, f)
    linear_nt(mg.node_tree)
    ma = material('anel', 2.0, mascara_faixa_v(0.5))
    an = anel('anel', 0.5, 0.12, ma)
    an.location = (0, -0.9, 0)
    for q, ex, ey, f in [(3, 0.2, 0.08, 3.0), (8, 1.3, 0.5, 2.0), (14, 1.9, 0.75, 0.0)]:
        chave(an, q, esc=(ex, ey, 1)); chave_forca(ma, q, f)
    linear(an)
    return sc


def pilar():
    """a coluna de luz: sobe do chão, fica, e as faíscas sobem piscando"""
    sc = cena_nova('pilar')
    rd = random.Random(17)
    mcol = material('pilar', 2.6, mascara_pilar())
    col = plano('pilar', 0.7, 1.9, mcol)
    for v in col.data.vertices:
        v.co.y += 0.95
    col.location = (0, -0.95, 0)
    for q, ey, ex, f in [(1, 0.05, 0.5, 3.0), (4, 1.0, 0.9, 3.0), (9, 1.0, 1.0, 2.6), (13, 1.0, 1.2, 1.2), (16, 1.0, 1.4, 0.0)]:
        chave(col, q, esc=(ex, ey, 1)); chave_forca(mcol, q, f)
    linear(col)
    mb = material('base', 2.0, mascara_radial(0.1, 1.0))
    base = plano('base', 1.6, 0.5, mb, z=-0.01)
    base.location = (0, -0.9, 0)
    for q, e, f in [(1, 0.3, 3.0), (4, 1.0, 2.5), (12, 1.1, 1.0), (16, 1.2, 0.0)]:
        chave(base, q, esc=(e, e, 1)); chave_forca(mb, q, f)
    linear(base)
    me = material('faisca', 5.0, mascara_radial(0.15, 0.8))
    for i in range(14):
        p = plano('faisca%d' % i, 0.11, 0.11, me, z=0.03)
        x0 = rd.uniform(-0.3, 0.3); y0 = -0.9 + rd.uniform(0.0, 0.5); vy = rd.uniform(0.12, 0.22); t0 = rd.randint(2, 8)
        for q in range(1, QUADROS + 1):
            t = max(0.0, q - t0)
            vis = 1.0 if q >= t0 and q <= 15 else 0.0
            osc = 0.5 + 0.5 * math.sin(q * 1.9 + i)
            chave(p, q, loc=(x0 + 0.04 * math.sin(q * 0.8 + i), y0 + vy * t, 0.03), esc=(vis * (0.6 + 0.7 * osc), vis * (0.6 + 0.7 * osc), 1))
        linear(p)
    for q, f in [(1, 5.0), (12, 4.0), (16, 0.0)]:
        chave_forca(me, q, f)
    linear_nt(me.node_tree)
    return sc


def selo():
    """o círculo de runas: dois anéis que giram em sentidos opostos, oito glifos, pulsa e some"""
    sc = cena_nova('selo')
    rd = random.Random(41)
    ma = material('anel_fora', 3.0, mascara_faixa_v(0.5))
    mb = material('anel_dentro', 2.4, mascara_faixa_v(0.5))
    fora = anel('fora', 0.86, 0.09, ma)
    dentro = anel('dentro', 0.56, 0.065, mb)
    mg = material('glifo', 3.2, None)
    glifos = []
    for i in range(8):
        a = i / 8 * math.tau
        cx, cy = 0.71 * math.cos(a), 0.71 * math.sin(a)
        # um glifo: três riscos curtos cruzados
        g = bpy.data.objects.new('glifo%d' % i, None)
        sc.collection.objects.link(g)
        g.location = (cx, cy, 0.0); g.rotation_euler = (0, 0, a)
        for k in range(3):
            ang = rd.uniform(0, math.pi)
            L = rd.uniform(0.05, 0.09)
            pts = [(-math.cos(ang) * L, -math.sin(ang) * L), (math.cos(ang) * L, math.sin(ang) * L)]
            f = faixa('risco%d_%d' % (i, k), pts, [0.036, 0.036], mg, z=0.005)
            f.parent = g
        glifos.append(g)
    # a marca do centro: uma estrela de quatro pontas
    est = []
    for k in range(2):
        ang = k * math.pi / 2
        est.append(faixa('estrela%d' % k, [(-math.cos(ang) * 0.2, -math.sin(ang) * 0.2), (math.cos(ang) * 0.2, math.sin(ang) * 0.2)], [0.05, 0.05], mg, z=0.005))
    for q in range(1, QUADROS + 1):
        t = (q - 1) / 15.0
        abre = min(1.0, (q - 1) / 3.0)
        some = 1.0 if q <= 12 else max(0.0, (16 - q) / 4.0)
        chave(fora, q, esc=(abre, abre, 1), rot=(0, 0, t * math.radians(40)))
        chave(dentro, q, esc=(abre, abre, 1), rot=(0, 0, -t * math.radians(70)))
        for i, g in enumerate(glifos):
            a = i / 8 * math.tau + t * math.radians(40)
            chave(g, q, loc=(0.71 * math.cos(a) * abre, 0.71 * math.sin(a) * abre, 0), esc=(abre, abre, 1), rot=(0, 0, a))
        for e in est:
            chave(e, q, esc=(abre, abre, 1), rot=(0, 0, -t * math.radians(90)))
        pulso = 0.8 + 0.2 * math.sin(q * 1.3)
        chave_forca(ma, q, 3.0 * some * pulso); chave_forca(mb, q, 2.4 * some); chave_forca(mg, q, 3.2 * some * (1.2 - 0.2 * pulso))
    for ob in [fora, dentro] + glifos + est:
        linear(ob)
    linear_nt(ma.node_tree); linear_nt(mb.node_tree); linear_nt(mg.node_tree)
    return sc


EFEITOS = {'golpe': golpe, 'impacto': impacto, 'rachadura': rachadura, 'raio': raio, 'jato': jato, 'pilar': pilar, 'selo': selo}


def renderiza(nome):
    sc = EFEITOS[nome]()
    pasta = os.path.join(SAIDA, nome)
    os.makedirs(pasta, exist_ok=True)
    for q in range(1, QUADROS + 1):
        sc.frame_set(q)
        sc.render.filepath = os.path.join(pasta, 'f%02d.png' % q)
        bpy.ops.render.render(write_still=True)
    print('[fx_blender] %s: %d quadros em %s' % (nome, QUADROS, pasta), flush=True)


if __name__ == '__main__':
    for nome in (SO or list(EFEITOS.keys())):
        renderiza(nome)
    print('[fx_blender] fim', flush=True)
