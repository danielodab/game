# -*- coding: utf-8 -*-
"""Separa as peças de cenário que vieram GRUDADAS num arquivo só.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/separa_cenario.py -- <pasta> [--recortar]

POR QUE ISTO EXISTE
-------------------
O Daniel gera as peças no Meshy com VÁRIAS por imagem, para não gastar um
crédito por barril. O que chega é um `.glb` com UMA malha só, com todos os
objetos dentro dela — o gerador não separa nada.

PARTE SOLTA NÃO É PEÇA — foi meu primeiro erro aqui. Parti por ilhas de
geometria e o primeiro arquivo virou 112 "peças" de 5 mm: cada folha, cada
pétala e cada cogumelo do Meshy é uma casca desconectada. Uma peça inteira é
feita de dezenas dessas.

O critério que funciona é VIZINHANÇA. As peças ficam enfileiradas na folha, com
vão entre elas, então: parte-se em ilhas, e depois AGRUPAM-SE as ilhas cujas
caixas se tocam (ou quase) no plano do chão. Cada grupo é uma peça. O vão que
separa dois grupos é `FOLGA`, medido como fração do tamanho da folha — assim
funciona para folha grande e pequena sem número mágico.

O QUE ELE FAZ DEPOIS DE SEPARAR
-------------------------------
  · joga fora caco: qualquer ilha com menos de `MIN_TRIS` triângulos ou menor
    que `MIN_TAM` na maior dimensão. O Meshy deixa lixo solto — um vértice
    perdido, um plano de fundo — e sem isso a conta de "quantas peças vieram"
    mente.
  · mede cada peça e ordena da mais alta para a mais baixa, porque é a altura
    que decide se a peça é divisória (0,95 m), coluna (3,10 m) ou enfeite.
  · assenta cada uma no chão (base em y=0) e centra em X/Z: o jogo posiciona
    pelo pé, e peça descentrada fica torta na casa.
  · reamostra a textura para 1024 px, como em todo o resto do projeto.

Sem `--recortar` ele só RELATA. É de propósito: eu quero olhar a lista antes de
gravar 30 arquivos com nome errado.

CUIDADO AO REPROCESSAR PASTA ANTIGA
-----------------------------------
As quinze peças que já estão em `_separado` foram cortadas quando o eixo de cima
ainda estava trocado (veja `EIXO_ALT` abaixo). Elas saíram boas o bastante e o
`embute_cenario.py` referencia cada uma pelo NÚMERO do arquivo. Como a ordem de
saída é a da altura — agora a altura de verdade —, reprocessar aquela pasta pode
renumerar as peças e fazer a tabela `PECAS` apontar para outra coisa, sem erro
nenhum na tela. Se um dia for preciso, refaça os retratos e reconfira a tabela.
"""
import bpy, bmesh, os, sys, math, json

MIN_TRIS = 40          # abaixo disto e caco de gerador, nao peca
MIN_TAM = 0.10         # FRACAO da folha, nao unidade absoluta. Com o eixo de
                       # cima corrigido o agrupamento passou a separar de
                       # verdade, e o entulho que o Meshy espalha ao pe das
                       # pecas — lascas de 1 a 2 cm, chatas, com 200 triangulos —
                       # comecou a sair como "peca". Passa no corte de
                       # triangulos e passava no de tamanho absoluto. O que
                       # separa caco de peca nao e um numero de centimetros e
                       # sim a PROPORCAO: numa folha do Meshy uma peca de
                       # verdade ocupa de um quarto a uma folha inteira, e o
                       # entulho nunca chega a 10%. Se um dia vier folha com
                       # peca miuda de proposito, e aqui que se afrouxa.
TEX_ALVO = 1024
FOLGA = 0.03           # fracao do tamanho da folha: ilhas mais proximas que
                       # isto sao a MESMA peca. 3% de uma folha de 1,0 = 3 cm,
                       # e as pecas do Daniel vem com vao bem maior que isso.

# QUAL EIXO E O DE CIMA. Isto estava ERRADO e custou caro. O `.glb` chega em
# Y-para-cima, mas o importador de glTF do Blender converte para a convencao da
# casa — Z para cima — girando o objeto 90 graus em X. Como `caixa()` mede em
# coordenadas de MUNDO, o que sai ja vem convertido: X e Y sao o chao, Z e a
# altura. O codigo antigo supunha Y como altura e com isso (a) agrupava as ilhas
# no plano X/altura em vez do plano do chao, colando no pilar o entulho que so
# se sobrepoe a ele visto de lado; (b) relatava a PROFUNDIDADE na coluna "alt",
# que e justamente o numero pelo qual eu decido o papel da peca; e (c) centrava
# a peca em X e na ALTURA, deixando-a descentrada na profundidade — o muro
# nascia meio metro fora do centro da casa.
#
# E o mesmo tombo que `contato_cenario.py` documenta nos quinze retratos pretos:
# o eixo vertical destes arquivos nao e o que se supoe.
EIXO_ALT = 2           # Z, depois da conversao do importador
EIXO_CHAO = (0, 1)     # X e Y — o plano onde as pecas estao enfileiradas


def argumentos():
    a = sys.argv
    if '--' in a:
        a = a[a.index('--') + 1:]
    else:
        a = []
    pasta = a[0] if a else None
    return pasta, ('--recortar' in a)


def limpa_cena():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def separa_soltas():
    """Quebra toda malha da cena em ilhas de geometria."""
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.mesh.separate(type='LOOSE')
        except Exception:
            # `separate` só roda em modo de edição em algumas versões
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.separate(type='LOOSE')
            bpy.ops.object.mode_set(mode='OBJECT')


def agrupa(itens, folga):
    """Une ilhas cujas caixas se tocam no chao (X/Y). Union-find simples.

    Só o plano do CHÃO importa: as peças estão lado a lado na folha, e duas
    partes da MESMA peça (o cogumelo e o tronco onde ele nasce) se sobrepõem
    vistas de cima, enquanto peças diferentes têm vão entre elas.
    """
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
    """Funde os objetos de um grupo num só, para exportar como uma peça."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def caixa(o):
    """Dimensões em MUNDO, já com a escala do objeto aplicada."""
    bpy.context.view_layer.update()
    ptos = [o.matrix_world @ v.co for v in o.data.vertices]
    if not ptos:
        return None
    xs = [p.x for p in ptos]; ys = [p.y for p in ptos]; zs = [p.z for p in ptos]
    return {
        'min': (min(xs), min(ys), min(zs)),
        'max': (max(xs), max(ys), max(zs)),
        'dim': (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)),
    }


def assenta(o, cx):
    """Centra no CHÃO (X/Y) e põe a base em Z=0 — o jogo posiciona pelo pé.

    O deslocamento é medido em MUNDO e aplicado nos VÉRTICES, que são locais.
    Os dois espaços só batem se a matriz do objeto for a identidade, e depois do
    importador de glTF ela não é — daí `desgira()`, que assa a matriz nos
    vértices antes. Sem isso a peça descia no eixo errado e aparecia enterrada.
    """
    d = [(cx['min'][e] + cx['max'][e]) / 2.0 for e in (0, 1, 2)]
    d[EIXO_ALT] = cx['min'][EIXO_ALT]
    for v in o.data.vertices:
        v.co.x -= d[0]
        v.co.y -= d[1]
        v.co.z -= d[2]


def desgira(o):
    """Assa a matriz do objeto nos vértices, deixando-a identidade.

    O importador de glTF entrega o objeto GIRADO 90° em X (é assim que ele
    converte Y-para-cima em Z-para-cima). Enquanto essa rotação estiver na
    matriz, mexer em `v.co` mexe num espaço que não é o do mundo. Aplicando a
    transformação primeiro, mundo e local passam a ser a mesma coisa e
    `assenta()` acerta.
    """
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def reamostra():
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO); img.pack(); n += 1
    return n


def main():
    pasta, recortar = argumentos()
    if not pasta or not os.path.isdir(pasta):
        print('USO: ... --python tools/separa_cenario.py -- <pasta> [--recortar]')
        return

    saida = os.path.join(pasta, '_separado')
    if recortar and not os.path.isdir(saida):
        os.makedirs(saida)

    relatorio = []
    arquivos = sorted(f for f in os.listdir(pasta) if f.lower().endswith('.glb'))
    for arq in arquivos:
        limpa_cena()
        bpy.ops.import_scene.gltf(filepath=os.path.join(pasta, arq))
        antes = len([o for o in bpy.data.objects if o.type == 'MESH'])
        separa_soltas()
        reamostra()

        # 1) todas as ilhas, SEM filtrar ainda. O filtro de caco tem de vir
        #    DEPOIS de agrupar: um cogumelo tem 50 triangulos e 3 cm, e jogar
        #    fora antes tira justamente as partes que compoem a peca.
        ilhas = []
        for o in [x for x in bpy.data.objects if x.type == 'MESH']:
            cx = caixa(o)
            if cx: ilhas.append({'obj': o, 'cx': cx})

        # 2) tamanho da folha, para a folga sair em fracao e nao em numero magico
        if ilhas:
            todos_min = [min(i['cx']['min'][e] for i in ilhas) for e in (0, 1, 2)]
            todos_max = [max(i['cx']['max'][e] for i in ilhas) for e in (0, 1, 2)]
            folha = max(todos_max[e] - todos_min[e] for e in (0, 1, 2))
        else:
            folha = 1.0
        # VARREDURA DE FOLGA. Um valor fixo nao serve: 3% juntou tres pecas numa
        # so, e um valor pequeno demais parte a peca nas proprias partes. Como
        # as pecas vem ENFILEIRADAS com vao entre elas, existe uma faixa larga de
        # folga onde a contagem se ESTABILIZA — e e esse patamar que eu quero,
        # nao um numero que eu escolhi. Varre-se de grosso a fino e fica-se com a
        # maior folga do patamar mais longo.
        escala = [0.030, 0.020, 0.014, 0.010, 0.007, 0.005, 0.0035, 0.0025, 0.0015, 0.001]
        contagens = []
        for f in escala:
            contagens.append((f, len(agrupa(ilhas, folha * f))))
        print('   varredura:', ' '.join('%.4f→%d' % c for c in contagens))

        melhor, corrida, atual, ini = None, 0, None, None
        for f, n in contagens:
            if n != atual:
                atual, ini, corrida = n, f, 1
            else:
                corrida += 1
            if n > 1 and (melhor is None or corrida > melhor[2]):
                melhor = (ini, n, corrida)
        folga_usada = melhor[0] if melhor else FOLGA
        grupos = agrupa(ilhas, folha * folga_usada)
        # o `else` e a folha que nao se parte em nenhuma folga: nao ha patamar
        # para escolher, entao vale a folga padrao e o grupo unico
        print('   patamar escolhido: folga %.4f → %d grupo(s)'
              % (folga_usada, len(grupos)))

        # 3) junta cada grupo e SO ENTAO decide se e peca ou caco
        pecas, cacos = [], 0
        for g in grupos:
            o = junta([it['obj'] for it in g])
            t = tris(o)
            cx = caixa(o)
            if not cx or t < MIN_TRIS or max(cx['dim']) < folha * MIN_TAM:
                cacos += 1
                bpy.data.objects.remove(o, do_unlink=True)
                continue
            pecas.append({'obj': o, 'tris': t, 'cx': cx,
                          'alt': cx['dim'][EIXO_ALT], 'ilhas': len(g)})

        # da mais alta para a mais baixa: a altura e o que decide o papel
        pecas.sort(key=lambda p: -p['alt'])

        print('\n=== %s — %d malha(s) -> %d peca(s), %d caco(s)' % (arq, antes, len(pecas), cacos))
        for i, p in enumerate(pecas):
            d = p['cx']['dim']
            a, b = EIXO_CHAO
            print('   %2d  alt=%6.3f  chao=%6.3f x %6.3f  tris=%5d  (%d ilhas)'
                  % (i + 1, d[EIXO_ALT], d[a], d[b], p['tris'], p['ilhas']))
            relatorio.append({'arquivo': arq, 'i': i + 1, 'alt': d[EIXO_ALT],
                              'larg': max(d[a], d[b]), 'tris': p['tris']})

        if recortar:
            base = os.path.splitext(arq)[0].replace(' ', '_')
            for i, p in enumerate(pecas):
                o = p['obj']
                # desgirar ANTES de medir de novo: `assenta` mexe em vértices e
                # só acerta com a matriz do objeto já assada
                desgira(o)
                assenta(o, caixa(o))
                bpy.ops.object.select_all(action='DESELECT')
                o.select_set(True)
                bpy.context.view_layer.objects.active = o
                destino = os.path.join(saida, '%s_%02d.glb' % (base, i + 1))
                bpy.ops.export_scene.gltf(filepath=destino, export_format='GLB',
                                          use_selection=True, export_animations=False,
                                          export_image_format='JPEG')

    print('\n=== TOTAL: %d peca(s) em %d arquivo(s)' % (len(relatorio), len(arquivos)))
    if recortar:
        print('gravadas em:', saida)
    else:
        print('(ensaio — nada foi gravado; passe --recortar para valer)')


main()
