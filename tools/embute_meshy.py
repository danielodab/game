# -*- coding: utf-8 -*-
"""Traz os personagens novos do Meshy para o jogo.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_meshy.py

O QUE CHEGOU E POR QUE NAO DAVA PARA USAR DIRETO
------------------------------------------------
O usuario gerou os personagens no Meshy e deixou em Downloads/assets_ok. Cada
classe veio como SEIS arquivos .glb (idle, walk, run, attack, hit, death) de
19 a 21 MB cada — 126 MB por personagem, 370 MB nos tres. O jogo INTEIRO tem
29,6 MB hoje.

Medindo, o susto passou e virou conta simples:

  · a malha e boa: ~15 mil triangulos, 24 ossos. Isso e densidade de jogo.
  · os 19 MB sao quase todos UMA textura de 4096x4096.
  · e os seis arquivos sao REDUNDANTES — cada um ja carrega TODAS as acoes
    dentro de si. Basta escolher o mais completo e jogar os outros cinco fora.

Entao: um arquivo por classe, textura reamostrada, e o peso cai de 126 MB para
uns 2 MB por personagem.

AS ACOES TEM NOMES DIFERENTES EM CADA CLASSE
--------------------------------------------
O Meshy nomeou como quis, e nao ha padrao entre as classes: o sumo tem
'Attack'/'Idle_02'/'Walking', o xama tem 'Charged_Spell_Cast'/'Idle_5', o mago
tem 'Shot_and_Fall_Forward'. O jogo precisa de SEIS papeis fixos — idle, walk,
run, attack, hit, death — entao cada acao e mapeada para o papel dela e
RENOMEADA para o vocabulario que `autoActions()` em models3d_v2.js JA reconhece:
Idle, Walk, Run, Attack, HitReact, Death.

Nomear assim e de proposito: com esses nomes o modelo entra pelo caminho que o
jogo ja tem para modelo com clipe proprio (`own: true`), e NAO precisa de uma
linha de codigo nova no renderizador. Chamar de 'hit' teria custado um caso
especial, porque a regra la procura /HitReact/.
"""
import bpy, os, base64, io, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-meshy.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_meshy")

TEX_ALVO = 1024          # 4096 -> 1024: 16x menos pixel, e no tabuleiro nao se ve
                         # diferenca. E o mesmo raciocinio do atlas de particula.

# classe do jogo -> (pasta, arquivo mais completo, mapa de acao -> papel)
# O arquivo escolhido e o que traz MAIS acoes; os outros cinco sao copias.
CLASSES = [
    ("sumo", "sumo", "attack.glb", {
        "Idle_02":              "idle",
        "Walking":              "walk",
        "Running":              "run",
        "Attack":               "attack",
        "Crouch_and_Step_Back": "HitReact",
        "falling_down":         "death",
    }),
    ("invocador", "xama", "idle.glb", {
        "Idle_5":                  "idle",
        "Walking":                 "walk",
        "Running":                 "run",
        "Charged_Spell_Cast":      "attack",
        "Crouch_and_Step_Back":    "hit",
        "Stand_To_Side_Lying":     "death",
    }),
    # ATENCAO: para o mago o arquivo completo e o idle.glb, nao o attack.glb.
    # Peguei o attack primeiro e perdi DUAS acoes — justo idle e death, que sao
    # as mais usadas. Os seis arquivos sao redundantes mas nao sao IDENTICOS:
    # cada um traz um subconjunto diferente. Confira a lista antes de escolher.
    ("bruxo", "mago", "idle.glb", {
        "Idle_02":                 "idle",
        "Walking":                 "walk",
        "Running":                 "run",
        "Attack":                  "attack",
        "Crouch_and_Step_Back":    "hit",
        "Shot_and_Fall_Forward":   "death",
    }),
]


def limpa_lixo():
    """Tira do arquivo o que nao e o personagem.

    Os .glb do Meshy trazem uma `Icosphere` solta, sem pai e fora do esqueleto —
    sobra do gerador. Ela viajava junto e aparecia em cena.

    NAO mexo mais na escala aqui. O rig e feito em centimetros (o osso `Hips`
    tem 1226 de comprimento) e o armature encolhe por 0,01; assar essa
    transformacao virou o personagem de cabeca para baixo. O tamanho passou a
    ser resolvido no jogo, em `naturalHeight`, que agora mede o ESQUELETO quando
    a malha em pose de repouso vem degenerada.
    """
    fora = []
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            fora.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    if fora:
        print("LIXO REMOVIDO|", ", ".join(fora))

    # ---- POR QUE NAO CONSERTO O RIG EM CENTIMETROS AQUI
    # O arquivo chega com os ossos em cm (o `Hips` tem 1226 de comprimento) e um
    # armature que encolhe por 0,01. Malha e esqueleto discordam por 100x, e
    # tudo que MEDE no jogo mede a malha.
    #
    # Tentei tres consertos e os tres pioraram, cada um com foto:
    #   1. transform_apply(scale) no armature  -> personagem de cabeca para baixo
    #   2. o mesmo com todos os objetos juntos -> idem, a malha e filha e recebia
    #      a transformacao duas vezes
    #   3. escalar os ossos em modo de EDICAO  -> a pose de repouso fica certa,
    #      mas as CURVAS DE ANIMACAO continuam em cm e a pose animada quebra
    #
    # O item 3 e a licao que vale registrar: mexer no bind sem mexer nas acoes
    # deixa o modelo parado bonito e o modelo ANIMADO errado — e o teste que
    # olha a pose de repouso passa.




def reamostra_texturas():
    """4096 -> 1024. E daqui que vem a queda de 19 MB para ~2 MB."""
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n += 1
    return n


def renomeia_acoes(mapa):
    """Da a cada acao o PAPEL que o jogo pede, e descarta o que nao serve.

    Sem isto o renderizador teria de conhecer o vocabulario do Meshy, que muda
    de personagem para personagem — o mago tem 'Shot_and_Fall_Forward' onde o
    sumo tem 'falling_down'.
    """
    achadas, perdidas = {}, []
    for orig, papel in mapa.items():
        a = bpy.data.actions.get(orig)
        if a:
            a.name = "soterra_" + papel      # prefixo evita colisao no rename
            achadas[papel] = orig
        else:
            perdidas.append(orig)
    # segundo passe: tira o prefixo agora que nao ha risco de colidir
    for a in bpy.data.actions:
        if a.name.startswith("soterra_"):
            a.name = a.name[len("soterra_"):]
    # o que nao foi mapeado sai do arquivo: peso morto
    for a in list(bpy.data.actions):
        if a.name not in mapa.values():
            bpy.data.actions.remove(a)
    return achadas, perdidas


def main():
    if not os.path.isdir(TMP):
        os.makedirs(TMP)

    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 2.0 - personagens do usuario, gerados no Meshy",
        " *",
        " * Cada classe chegou como SEIS .glb de ~20 MB (um por animacao), num total",
        " * de 126 MB por personagem. Mas os seis eram REDUNDANTES: cada arquivo ja",
        " * trazia todas as acoes. E os 20 MB eram quase so uma textura 4096x4096.",
        " *",
        " * Aqui e um arquivo por classe, textura em %d px, com as seis acoes" % TEX_ALVO,
        " * renomeadas para os papeis que o jogo pede (idle/walk/run/attack/hit/death)",
        " * — o Meshy nomeia diferente em cada personagem e o renderizador nao pode",
        " * depender disso.",
        " *",
        " * ~15 mil triangulos e 24 ossos por personagem: densidade de jogo, nao de",
        " * escultura. Nao precisou decimar.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]

    rel = []
    for classe, pasta, arquivo, mapa in CLASSES:
        origem = os.path.join(ORIG, pasta, pasta, arquivo)
        if not os.path.exists(origem):
            print("FALTA:", origem); continue

        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=origem)

        limpa_lixo()
        ntex = reamostra_texturas()
        achadas, perdidas = renomeia_acoes(mapa)

        tris = 0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)

        chave = "meshy_" + classe
        destino = os.path.join(TMP, chave + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                                  use_selection=True, export_animations=True,
                                  export_animation_mode="ACTIONS",
                                  export_image_format="JPEG")
        dados = open(destino, "rb").read()
        b64 = base64.b64encode(dados).decode("ascii")
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, b64))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;" %
                      (chave, "['" + "','".join(sorted(achadas.keys())) + "']"))
        rel.append((classe, os.path.getsize(origem) / 1048576.0,
                    len(dados) / 1048576.0, tris, len(achadas), perdidas, ntex))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n=== PERSONAGENS DO MESHY ===")
    print("%-11s %10s %10s %8s %7s %s" % ("classe", "antes MB", "depois MB", "tris", "acoes", "perdidas"))
    for c, a, d, t, na, p, nt in rel:
        print("%-11s %10.1f %10.2f %8d %7d %s" % (c, a, d, t, na, ",".join(p) or "-"))
    print("arquivo: %.2f MB" % (os.path.getsize(SAIDA) / 1048576.0))


main()
