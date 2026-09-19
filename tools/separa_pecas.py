# -*- coding: utf-8 -*-
"""Separa as peças de cenário de uma folha do Meshy — por VÉRTICE, não por caixa.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/separa_pecas.py -- <pasta> [--recortar] [--conta 4,5,7]

POR QUE OUTRO SEPARADOR (19/09, lote do Fecho de Brasa)
------------------------------------------------------
O `separa_cenario.py` agrupa as ilhas de geometria pela CAIXA no plano do
chão: duas ilhas cujas caixas se tocam são a mesma peça. Funcionou na Estufa e
na Cisterna porque as peças vinham enfileiradas com vão largo. No Fecho o
Daniel pôs 4, 5 e 6 peças por folha, mais juntas, e as caixas de vizinhas
passaram a se sobrepor (uma bancada larga ao lado de uma calha comprida): o
agrupador colou duas em uma e cada folha saiu com 3 "peças".

Aqui o critério é a DISTÂNCIA ENTRE SUPERFÍCIES: os vértices de todas as ilhas
vão para uma grade de células de lado `g`; ilhas que ocupam a mesma célula ou
células vizinhas (26-vizinhança) são a mesma peça. Duas partes de uma peça se
tocam (gap ~0); peças diferentes têm ar entre elas, mesmo quando as caixas se
cruzam. O `g` não é chute: a folha diz quantas peças tem — pelo NOME do
arquivo ("A-B-C-D.glb" = quatro) ou por `--conta`, quando o Meshy gerou mais
objetos do que o pedido (a folha 3 do Fecho veio com um braseiro a mais) —,
então o script varre `g` do fino ao grosso e fica com o maior `g` que devolve
exatamente essa contagem.

Quando nenhum `g` acerta, há dois remendos, nesta ordem:
  · SOBRA peça: parte-se do `g` mais fino que ainda dá peças demais e fundem-se
    as duas de menor distância entre superfícies, até bater;
  · FALTA peça (duas ENCOSTADAS — a grelha no chão tocando a pilha de limalha,
    o sino tocando o carrinho — nenhuma distância separa o que se toca): o
    grupo que melhor se parte em dois é dividido por 2-médias nos centroides
    das ilhas; "melhor" = maior separação entre as duas metades em relação ao
    raio delas. Um objeto só, partido ao meio, tem separação ruim; dois
    objetos encostados têm separação boa.

CACO não é peça: grupo com poucos triângulos ou com só UMA dimensão grande (a
corda do sino, uma haste solta). Ele volta para a peça mais próxima, se
houver uma a menos de 6% da folha — a corda fica com o sino.

As peças saem NOMEADAS pela ordem em que estão na folha (ao longo do eixo
comprido) quando a contagem bate com os nomes do arquivo; senão saem numeradas
(`folhaN_NN.glb`) e o nome se dá olhando os retratos de `contato_cenario.py`.
Depois de separar é o de sempre: assentar, centrar, textura a 1024, JPEG.
"""
import bpy, os, sys, re, unicodedata
import numpy as np

MIN_TRIS = 40
MIN_TAM = 0.08          # fração da folha: abaixo disso (em 2 das 3 dimensões) é caco
TEX_ALVO = 1024
ESCALA = [0.0025, 0.0035, 0.005, 0.007, 0.010, 0.014, 0.020, 0.028, 0.040]


def argumentos():
    a = sys.argv
    a = a[a.index('--') + 1:] if '--' in a else []
    pasta = a[0] if a else None
    contas = []
    if '--conta' in a:
        contas = [int(x) for x in a[a.index('--conta') + 1].split(',')]
    # --bruto g1,g2,...  exporta, por folha, cada grupo do g dado E as duas
    #                    metades dele (2-médias), numerados: folhaK_NN,
    #                    folhaK_NNa, folhaK_NNb — para nomear pelos retratos
    # --mapa mapa.json   monta as peças pelo mapa: {"folha2": {"g": 0.007,
    #                    "fole_duplo_de_couro": ["1"], "forno": ["4a"],
    #                    "prensa": ["4b", "5"]}} — "NN" é o grupo inteiro,
    #                    "NNa"/"NNb" as metades (ordenadas pelo centro em X)
    brutos = []
    if '--bruto' in a:
        brutos = [float(x) for x in a[a.index('--bruto') + 1].split(',')]
    mapa = None
    if '--mapa' in a:
        import json
        mapa = json.load(open(a[a.index('--mapa') + 1], encoding='utf-8'))
    return pasta, ('--recortar' in a), contas, brutos, mapa


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


def pontos_mundo(o):
    n = len(o.data.vertices)
    if n == 0:
        return np.zeros((0, 3))
    co = np.empty(n * 3, dtype=np.float64)
    o.data.vertices.foreach_get('co', co)
    co = co.reshape(n, 3)
    m = np.array(o.matrix_world)
    return co @ m[:3, :3].T + m[:3, 3]


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


class UF:
    def __init__(self, n):
        self.p = list(range(n))

    def acha(self, i):
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i

    def une(self, a, b):
        ra, rb = self.acha(a), self.acha(b)
        if ra != rb:
            self.p[rb] = ra


VIZ = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)
       if (dx, dy, dz) != (0, 0, 0)]


def agrupa_por_voxel(celulas_por_ilha):
    uf = UF(len(celulas_por_ilha))
    dono = {}
    for i, cels in enumerate(celulas_por_ilha):
        for c in cels:
            if c in dono:
                uf.une(i, dono[c])
            else:
                dono[c] = i
    for c, i in dono.items():
        for d in VIZ:
            n = (c[0] + d[0], c[1] + d[1], c[2] + d[2])
            j = dono.get(n)
            if j is not None:
                uf.une(i, j)
    grupos = {}
    for i in range(len(celulas_por_ilha)):
        grupos.setdefault(uf.acha(i), []).append(i)
    return list(grupos.values())


def quantiza(pts, g):
    q = np.floor(pts / g).astype(np.int64)
    q = np.unique(q, axis=0)
    return set(map(tuple, q.tolist()))


def slug(nome):
    s = unicodedata.normalize('NFKD', nome).encode('ascii', 'ignore').decode('ascii')
    s = re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_').lower()
    return s


def junta(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def desgira(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def caixa(o):
    p = pontos_mundo(o)
    if len(p) == 0:
        return None
    return p.min(axis=0), p.max(axis=0)


def assenta(o):
    """Centra em X/Y e põe a base em Z=0 (depois de `desgira`, local = mundo)."""
    mn, mx = caixa(o)
    d = (mn + mx) / 2.0
    d[2] = mn[2]
    n = len(o.data.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    o.data.vertices.foreach_get('co', co)
    co = co.reshape(n, 3) - d
    o.data.vertices.foreach_set('co', co.reshape(-1))
    o.data.update()


def reamostra():
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n += 1
    return n


def duas_medias(cent, pesos):
    """2-médias nos centroides das ilhas (plano do chão), com peso por vértice.
    Devolve (rótulos, separação): separação = distância entre os dois centros
    dividida pela soma dos raios RMS — quanto maior, mais parecem dois objetos."""
    if len(cent) < 2:
        return None, 0.0
    # semente: os dois pontos mais afastados ao longo do eixo principal
    xy = cent[:, :2]
    media = (xy * pesos[:, None]).sum(axis=0) / pesos.sum()
    d = xy - media
    cov = (d * pesos[:, None]).T @ d
    val, vec = np.linalg.eigh(cov)
    eixo = vec[:, int(np.argmax(val))]
    proj = d @ eixo
    c = np.array([xy[int(np.argmin(proj))], xy[int(np.argmax(proj))]])
    rot = None
    for _ in range(30):
        dist = ((xy[:, None, :] - c[None, :, :]) ** 2).sum(axis=2)
        novo = np.argmin(dist, axis=1)
        if rot is not None and np.array_equal(novo, rot):
            break
        rot = novo
        for k in (0, 1):
            m = rot == k
            if m.any():
                c[k] = (xy[m] * pesos[m, None]).sum(axis=0) / pesos[m].sum()
    if rot is None or not (rot == 0).any() or not (rot == 1).any():
        return None, 0.0
    raios = []
    for k in (0, 1):
        m = rot == k
        r2 = ((xy[m] - c[k]) ** 2).sum(axis=1)
        raios.append(float(np.sqrt((r2 * pesos[m]).sum() / pesos[m].sum())))
    sep = float(np.sqrt(((c[0] - c[1]) ** 2).sum())) / max(1e-9, raios[0] + raios[1])
    return rot, sep


def exporta(objs, destino):
    o = junta(objs)
    desgira(o)
    assenta(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=destino, export_format='GLB',
                              use_selection=True, export_animations=False,
                              export_image_format='JPEG')
    print('   gravado:', os.path.basename(destino), '%.2f MB' % (os.path.getsize(destino) / 1048576.0))


def main():
    pasta, recortar, contas, brutos, mapa = argumentos()
    if not pasta or not os.path.isdir(pasta):
        print('USO: ... --python tools/separa_pecas.py -- <pasta> [--recortar] [--conta 4,5,7] '
              '[--bruto g1,g2,g3] [--mapa mapa.json]')
        return
    saida = os.path.join(pasta, '_bruto' if brutos else '_separado')
    if (recortar or brutos or mapa) and not os.path.isdir(saida):
        os.makedirs(saida)

    arquivos = sorted(f for f in os.listdir(pasta) if f.lower().endswith('.glb'))
    total = 0
    for k_arq, arq in enumerate(arquivos):
        nomes = [n.strip() for n in os.path.splitext(arq)[0].split('-') if n.strip()]
        esperado = contas[k_arq] if k_arq < len(contas) else len(nomes)
        chave_folha = 'folha%d' % (k_arq + 1)
        if mapa is not None and chave_folha not in mapa:
            continue
        limpa_cena()
        bpy.ops.import_scene.gltf(filepath=os.path.join(pasta, arq))
        separa_soltas()
        reamostra()
        ilhas = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices) > 0]
        pts = [pontos_mundo(o) for o in ilhas]
        todos = np.vstack(pts)
        mn, mx = todos.min(axis=0), todos.max(axis=0)
        folha = float((mx - mn).max())
        eixo_longo = int(np.argmax((mx - mn)[:2]))   # X ou Y: o chão
        print('\n=== %s — %d ilha(s), folha %.3f, esperado %d peça(s)' % (arq, len(ilhas), folha, esperado))

        def caixa_de(gr):
            p = np.vstack([pts[i] for i in gr])
            return p.min(axis=0), p.max(axis=0)

        def e_caco(gr):
            mn, mx = caixa_de(gr)
            dim = mx - mn
            t = sum(tris(ilhas[i]) for i in gr)
            return t < MIN_TRIS or int((dim >= folha * MIN_TAM).sum()) < 2

        def gap(gr_a, gr_b):
            a0, a1 = caixa_de(gr_a); b0, b1 = caixa_de(gr_b)
            d = np.maximum(0, np.maximum(a0 - b1, b0 - a1))
            return float(np.sqrt((d ** 2).sum()))

        def pecas_para(g):
            cels = [quantiza(p, g) for p in pts]
            grupos = agrupa_por_voxel(cels)
            boas = [gr for gr in grupos if not e_caco(gr)]
            cacos = [gr for gr in grupos if e_caco(gr)]
            for c in cacos:
                if not boas:
                    break
                k = min(range(len(boas)), key=lambda i: gap(c, boas[i]))
                if gap(c, boas[k]) <= folha * 0.06:
                    boas[k] = boas[k] + c
            return boas

        # ---- os grupos de UM g, mais as metades de cada um (para nomear de olho)
        def grupos_e_metades(g):
            grupos = pecas_para(folha * g)
            grupos.sort(key=lambda gr: float(np.vstack([pts[i] for i in gr])[:, eixo_longo].mean()))
            metades = []
            for gr in grupos:
                cent = np.array([pts[i].mean(axis=0) for i in gr])
                pesos = np.array([float(len(pts[i])) for i in gr])
                rot, sep = duas_medias(cent, pesos) if len(gr) >= 4 else (None, 0.0)
                if rot is None:
                    metades.append((None, 0.0)); continue
                a = [gr[i] for i in range(len(gr)) if rot[i] == 0]
                b = [gr[i] for i in range(len(gr)) if rot[i] == 1]
                # 'a' é a metade de MENOR centro em X (depois Y), sempre
                ca = np.vstack([pts[i] for i in a]).mean(axis=0)
                cb = np.vstack([pts[i] for i in b]).mean(axis=0)
                if (ca[0], ca[1]) > (cb[0], cb[1]):
                    a, b = b, a
                metades.append(((a, b), sep))
            return grupos, metades

        if brutos:
            g = brutos[k_arq] if k_arq < len(brutos) else brutos[-1]
            grupos, metades = grupos_e_metades(g)
            print('   BRUTO em g = %.4f: %d grupo(s)' % (g, len(grupos)))
            for k, gr in enumerate(grupos):
                p = np.vstack([pts[i] for i in gr]); dim = p.max(axis=0) - p.min(axis=0)
                print('   %02d  alt=%6.3f chao=%6.3f x %6.3f tris=%5d  sep=%.2f'
                      % (k + 1, dim[2], dim[0], dim[1], sum(tris(ilhas[i]) for i in gr), metades[k][1]))
            # exportar mexe na cena (join): copia os índices antes, exporta por último
            planos = []
            for k, gr in enumerate(grupos):
                planos.append(('%s_%02d' % (chave_folha, k + 1), list(gr)))
                if metades[k][0] is not None:
                    planos.append(('%s_%02da' % (chave_folha, k + 1), list(metades[k][0][0])))
                    planos.append(('%s_%02db' % (chave_folha, k + 1), list(metades[k][0][1])))
            # cada exportação junta objetos: duplica as ilhas para não consumir
            for rotulo, gr in planos:
                copias = []
                for i in gr:
                    o = ilhas[i]
                    c = o.copy(); c.data = o.data.copy()
                    bpy.context.scene.collection.objects.link(c)
                    copias.append(c)
                exporta(copias, os.path.join(saida, rotulo + '.glb'))
            total += len(grupos)
            continue

        if mapa is not None:
            plano = mapa[chave_folha]
            g = float(plano.get('g', 0.007))
            grupos, metades = grupos_e_metades(g)
            print('   MAPA em g = %.4f: %d grupo(s)' % (g, len(grupos)))
            for nome, partes in plano.items():
                if nome == 'g':
                    continue
                gr = []
                for tok in partes:
                    m = re.match(r'^(\d+)([ab]?)$', str(tok))
                    k = int(m.group(1)) - 1
                    if m.group(2) == '':
                        gr += grupos[k]
                    else:
                        gr += metades[k][0][0 if m.group(2) == 'a' else 1]
                copias = []
                for i in gr:
                    o = ilhas[i]
                    c = o.copy(); c.data = o.data.copy()
                    bpy.context.scene.collection.objects.link(c)
                    copias.append(c)
                p = np.vstack([pts[i] for i in gr]); dim = p.max(axis=0) - p.min(axis=0)
                print('   %-36s alt=%6.3f chao=%6.3f x %6.3f  (%s)' % (nome, dim[2], dim[0], dim[1], '+'.join(map(str, partes))))
                exporta(copias, os.path.join(saida, slug(nome) + '.glb'))
                total += 1
            continue

        contagens = []
        for f in ESCALA:
            contagens.append((f, len(pecas_para(folha * f))))
        print('   varredura:', ' '.join('%.4f→%d' % c for c in contagens))
        acertos = [f for f, n in contagens if n == esperado]
        if acertos:
            f_usado = max(acertos)
            boas = pecas_para(folha * f_usado)
            print('   patamar: g = %.4f da folha → %d peça(s)' % (f_usado, len(boas)))
        else:
            demais = [f for f, n in contagens if n > esperado]
            if demais:
                f_usado = max(demais)
                boas = pecas_para(folha * f_usado)
                print('   sem patamar: parto de g = %.4f (%d peças) e fundo as mais próximas'
                      % (f_usado, len(boas)))
            else:
                # todo g dá peças DE MENOS: há peças encostadas; parte-se do g
                # mais fino (o que menos cola) e divide-se por 2-médias
                f_usado = min(f for f, n in contagens)
                boas = pecas_para(folha * f_usado)
                print('   sem patamar: parto de g = %.4f (%d peças) e divido as encostadas'
                      % (f_usado, len(boas)))
            amostras = [np.vstack([pts[i] for i in gr]) for gr in boas]
            rng = np.random.default_rng(7)

            def sub(p):
                return p if len(p) <= 3000 else p[rng.choice(len(p), 3000, replace=False)]

            amostras = [sub(p) for p in amostras]

            def dist(a, b):
                melhor = np.inf
                for i in range(0, len(a), 500):
                    d = np.sqrt(((a[i:i + 500, None, :] - b[None, :, :]) ** 2).sum(axis=2))
                    melhor = min(melhor, float(d.min()))
                return melhor

            while len(boas) > esperado:
                par, dmin = None, np.inf
                for i in range(len(boas)):
                    for j in range(i + 1, len(boas)):
                        d = dist(amostras[i], amostras[j])
                        if d < dmin:
                            dmin, par = d, (i, j)
                i, j = par
                print('   fundindo grupos %d+%d (gap %.4f da folha)' % (i + 1, j + 1, dmin / folha))
                boas[i] = boas[i] + boas[j]
                amostras[i] = sub(np.vstack([amostras[i], amostras[j]]))
                del boas[j]; del amostras[j]

        # FALTA peça: duas encostadas num grupo só. Divide-se, por 2-médias nos
        # centroides das ilhas, o grupo cuja divisão separa melhor.
        while len(boas) < esperado:
            melhor, melhor_sep, melhor_rot = None, 0.0, None
            for gi, gr in enumerate(boas):
                if len(gr) < 4:
                    continue
                cent = np.array([pts[i].mean(axis=0) for i in gr])
                pesos = np.array([float(len(pts[i])) for i in gr])
                rot, sep = duas_medias(cent, pesos)
                if rot is not None and sep > melhor_sep:
                    melhor, melhor_sep, melhor_rot = gi, sep, rot
            if melhor is None:
                print('   NÃO consegui dividir mais — fico com %d peça(s)' % len(boas))
                break
            gr = boas[melhor]
            a = [gr[i] for i in range(len(gr)) if melhor_rot[i] == 0]
            b = [gr[i] for i in range(len(gr)) if melhor_rot[i] == 1]
            print('   dividindo o grupo %d por 2-médias (separação %.2f): %d + %d ilhas'
                  % (melhor + 1, melhor_sep, len(a), len(b)))
            boas[melhor] = a
            boas.append(b)

        def centro(gr):
            p = np.vstack([pts[i] for i in gr])
            return float(p[:, eixo_longo].mean())
        boas.sort(key=centro)
        com_nome = (len(boas) == len(nomes))
        rotulos = []
        for k, gr in enumerate(boas):
            p = np.vstack([pts[i] for i in gr])
            dim = p.max(axis=0) - p.min(axis=0)
            rotulo = nomes[k] if com_nome else 'folha%d_%02d' % (k_arq + 1, k + 1)
            rotulos.append(rotulo)
            print('   %d  %-36s alt=%6.3f  chao=%6.3f x %6.3f  tris=%5d  (%d ilhas)'
                  % (k + 1, rotulo, dim[2], dim[0], dim[1], sum(tris(ilhas[i]) for i in gr), len(gr)))
        if not com_nome:
            print('   (contagem %d ≠ %d nomes: saída numerada — nomeie pelos retratos)' % (len(boas), len(nomes)))
        total += len(boas)

        if recortar:
            objs_por_peca = [[ilhas[i] for i in gr] for gr in boas]
            for k, objs in enumerate(objs_por_peca):
                o = junta(objs)
                desgira(o)
                assenta(o)
                bpy.ops.object.select_all(action='DESELECT')
                o.select_set(True)
                bpy.context.view_layer.objects.active = o
                destino = os.path.join(saida, slug(rotulos[k]) + '.glb')
                bpy.ops.export_scene.gltf(filepath=destino, export_format='GLB',
                                          use_selection=True, export_animations=False,
                                          export_image_format='JPEG')
                print('   gravado:', os.path.basename(destino),
                      '%.2f MB' % (os.path.getsize(destino) / 1048576.0))

    print('\n=== TOTAL: %d peça(s) em %d arquivo(s)' % (total, len(arquivos)))
    if not recortar:
        print('(ensaio — nada foi gravado; passe --recortar para valer)')


main()
