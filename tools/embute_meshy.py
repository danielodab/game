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
        # sobrava sem uso; investida para a frente serve de esquiva
        "Standard_Forward_Charge": "Dodge",
    }),
    # ATENCAO: para o mago o arquivo completo e o idle.glb, nao o attack.glb.
    # Peguei o attack primeiro e perdi DUAS acoes — justo idle e death, que sao
    # as mais usadas. Os seis arquivos sao redundantes mas nao sao IDENTICOS:
    # cada um traz um subconjunto diferente. Confira a lista antes de escolher.
    # O LADINO tem SETE acoes, uma a mais que os outros: `Shot_and_Blown_Back` e
    # reacao a dano de verdade (levar tiro e ser jogado para tras), entao ela
    # fica como HitReact e o `Crouch_and_Step_Back` sobra para a ESQUIVA — que
    # nos outros cai num substituto.
    ("espadachim", "ladino", "attack.glb", {
        "Idle_02":                          "idle",
        "Walking":                          "walk",
        "Running":                          "run",
        "Sword_Judgment":                   "attack",
        "Shot_and_Blown_Back":              "HitReact",
        "Fall_Dead_from_Abdominal_Injury":  "death",
        "Crouch_and_Step_Back":             "Dodge",
    }),
    # MINOTAURO (v3, o verbo BARRAR). Sete acoes no attack.glb, e a sobra
    # `ForwardRight_Run_Fight` — avancar lutando — serve de esquiva.
    ("minotauro", "minotauro", "attack.glb", {
        "Idle_02":                "idle",
        "Walking":                "walk",
        "Running":                "run",
        "Triple_Combo_Attack":    "attack",
        "Hit_Reaction":           "HitReact",
        "dying_backwards":        "death",
        "ForwardRight_Run_Fight": "Dodge",
    }),
    # CURANDEIRA (v3). ESTA VEIO DIFERENTE DAS OUTRAS: nos personagens
    # anteriores os seis .glb eram redundantes (cada um trazia todas as acoes) e
    # bastava escolher o mais completo. Nos dela cada arquivo traz UMA acao so,
    # entao nao ha "o mais completo" — e preciso FUNDIR os seis. Por isso a
    # entrada abaixo passa `None` no lugar do arquivo: o mapa deixa de ser
    # {nome-da-acao: papel} e vira {arquivo: papel}.
    #
    # E DOIS ARQUIVOS ESTAO TROCADOS EM RELACAO AO NOME. `attack.glb` contem
    # `Slap_Reaction` — reacao a um tapa, ou seja, LEVAR dano — e `hit.glb`
    # contem `mage_soell_cast_6` (sic), que e uma conjuracao, ou seja, ATACAR.
    # Mapeio pelo que a animacao E, nao pelo nome do arquivo: uma curandeira que
    # apanha quando manda atacar seria um defeito silencioso, dificil de achar
    # depois. Se o Daniel quis mesmo um tapa como ataque dela, e so trocar as
    # duas linhas.
    ("curandeiro", "curandeira", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",      # mage_soell_cast_6 -> conjurar
        "attack.glb": "HitReact",    # Slap_Reaction     -> levar dano
        "death.glb":  "death",
    }),
    # CACADOR (v3). Substitui o Batedor encapuzado do KayKit, que segurava o
    # lugar do `arqueiro` desde o inicio. O id da CLASSE continua `arqueiro`:
    # trocar id exigiria migracao de save e o nome visivel ja resolve.
    #
    # Fusao de arquivos, como a curandeira — mas com uma novidade que o caminho
    # antigo nao cobria: `walk.glb` traz DUAS acoes uteis, `Walking` e
    # `Running`, e os dois papeis (andar e correr) saem do MESMO arquivo. Como a
    # chave do mapa e o arquivo, um valor so nao dava conta; por isso o valor
    # pode agora ser uma LISTA de pares (acao, papel).
    #
    # Os outros cinco pedem a acao pelo nome so por seguranca — cada um traz uma
    # acao so, entao "a primeira" bastaria. Mas escrever o nome documenta o que
    # o arquivo contem de verdade, que aqui NUNCA e o que o nome do arquivo diz.
    #
    # E os nomes de arquivo mentem, como no resto do elenco: `hit.glb` guarda
    # `Rifle_Aim_Turn_Right` (mirar = o ataque a distancia dele) e `attack.glb`
    # guarda `Slap_Reaction` (levar um tapa = reagir a dano). `run.glb` sobra do
    # rodizio — `Vault_with_Rifle`, saltar um obstaculo — e vira a ESQUIVA.
    ("arqueiro", "caçador", None, {
        "idle.glb":   ("Idle_02",               "idle"),
        "walk.glb":   [("Walking",              "walk"),
                       ("Running",              "run")],
        "hit.glb":    ("Rifle_Aim_Turn_Right",  "attack"),
        "attack.glb": ("Slap_Reaction",         "HitReact"),
        "death.glb":  ("falling_down",          "death"),
        "run.glb":    ("Vault_with_Rifle",      "Dodge"),
    }),
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



    # ---- O RIG EM CENTIMETROS NAO SE CONSERTA AQUI
    # O arquivo chega com os ossos em cm (o `Hips` tem 1226) e um armature que
    # encolhe por 0,01. Malha e esqueleto discordam por 100x.
    #
    # Quatro tentativas, todas com foto, e todas piores que nao mexer:
    #   1. transform_apply(scale) no armature       -> de cabeca para baixo
    #   2. o mesmo com todos os objetos juntos      -> idem (malha e filha)
    #   3. escalar os ossos em modo de EDICAO       -> pose de repouso certa,
    #      animada quebrada (as curvas continuam em cm)
    #   4. o item 3 MAIS escalar as curvas junto    -> continua invertido
    #
    # O item 4 e o que fecha a conta: renderizando SEM animar, os tres ficam
    # perfeitos e em pe. Ou seja, o modelo esta bom e quem inverte e o CLIPE
    # depois que eu mexo nele. Entao a resposta e nao mexer: o arquivo sai como
    # o gerador fez, e o tamanho e resolvido no jogo, em `naturalHeight`, que
    # mede o ESQUELETO quando a malha em repouso vem degenerada.

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


def pares_do_valor(valor):
    """Le o valor do mapa de fusao e devolve sempre uma lista de (acao, papel).

    O mapa de fusao e {arquivo: valor}, e o valor aceita tres formas — todas
    nascidas de um personagem que quebrou a anterior:

      "walk"                                 a curandeira: um arquivo, uma acao
                                             so, e tanto faz o nome dela.
      ("Walking", "walk")                    o cacador: o arquivo traz sobra do
                                             exportador junto, entao e preciso
                                             DIZER qual acao serve.
      [("Walking","walk"), ("Running","run")] tambem o cacador: um MESMO arquivo
                                             (walk.glb) rende dois papeis.

    `None` no lugar da acao quer dizer "a primeira que vier", que e o
    comportamento antigo e o que os cinco personagens ja embutidos usam.
    """
    if isinstance(valor, str):
        return [(None, valor)]
    if isinstance(valor, tuple) and len(valor) == 2 and isinstance(valor[1], str):
        return [valor]
    return [tuple(par) for par in valor]


def acha_acao(novas, nome):
    """Procura a acao pelo nome entre as recem-importadas.

    Nao basta comparar o nome cru, por duas razoes:

      · o importador de glTF do Blender BATIZA a acao com `rig|animacao|faixa` —
        o `idle.glb` do cacador entra como `Armature|Idle_02|baselayer`, nao
        como `Idle_02`. (Nem todo arquivo faz isso: o `walk.glb` dele traz
        `Walking` e `Running` puros. Depende de como o glTF foi gravado.)
      · o Blender poe sufixo `.001` quando o nome ja existe, e ele existe: ao
        fundir seis arquivos do mesmo personagem, `Armature|...` colide.

    Entao: nome exato, depois o miolo do `rig|animacao|faixa`, e os dois de novo
    sem o sufixo numerico.
    """
    def variantes(nm):
        yield nm
        base = nm.rsplit(".", 1)
        if len(base) == 2 and base[1].isdigit():
            nm = base[0]
            yield nm
        partes = nm.split("|")
        if len(partes) == 3:
            yield partes[1]
    for a in novas:
        if nome in variantes(a.name):
            return a
    return None


def funde_arquivos(pasta_orig, mapa):
    """Junta SEIS .glb num personagem so.

    Fica com o corpo do primeiro arquivo e traz das outras cinco importacoes
    apenas as ACOES, jogando fora o corpo repetido. Da certo porque os seis saem
    do mesmo personagem no Meshy: os ossos tem os mesmos nomes, entao uma curva
    gravada num arquivo toca no esqueleto do outro sem tradução.

    Um arquivo pode render mais de um papel (ver `pares_do_valor`): o walk.glb
    do cacador traz `Walking` e `Running`, e as duas ficam.

    As acoes precisam de `use_fake_user`: sem dono, o Blender descarta o
    data-block no momento em que eu apago o objeto que a trazia, e o export sai
    com uma animacao so — foi o que aconteceu na primeira tentativa.
    """
    itens = list(mapa.items())
    achadas, perdidas = {}, []
    papeis = set(p for v in mapa.values() for _, p in pares_do_valor(v))

    for i, (arquivo, valor) in enumerate(itens):
        caminho = os.path.join(pasta_orig, arquivo)
        if not os.path.exists(caminho):
            perdidas.append(arquivo); continue

        antes_obj = set(o.name for o in bpy.data.objects)
        antes_act = set(a.name for a in bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=caminho)
        novos_obj = [o for o in bpy.data.objects if o.name not in antes_obj]
        novas_act = [a for a in bpy.data.actions if a.name not in antes_act]

        guardadas = []
        for acao, papel in pares_do_valor(valor):
            if acao is None:
                # sem nome pedido: a primeira que ainda nao foi tomada
                act = next((a for a in novas_act if a not in guardadas), None)
            else:
                act = acha_acao(novas_act, acao)
            if act is None or act in guardadas:
                perdidas.append("%s:%s" % (arquivo, acao or "(1a acao)"))
                continue
            act.name = "papel_" + papel     # prefixo evita colidir com importado
            act.use_fake_user = True
            achadas[papel] = arquivo
            guardadas.append(act)

        # o que veio junto e nao serve sai agora: nos arquivos do cacador cada
        # importacao traz `Armature` e `baselayer` de sobra, e elas iriam parar
        # no .glb final como animacao vazia
        for extra in novas_act:
            if extra not in guardadas:
                bpy.data.actions.remove(extra)

        if i == 0:
            limpa_lixo()          # so no primeiro: e o corpo que fica
        else:
            for o in novos_obj:   # corpo repetido vai fora; a acao ja esta salva
                try: bpy.data.objects.remove(o, do_unlink=True)
                except Exception: pass

    # tira o prefixo agora que nao ha risco de colidir com nome importado
    for a in bpy.data.actions:
        if a.name.startswith("papel_"):
            a.name = a.name[len("papel_"):]
    for a in list(bpy.data.actions):
        if a.name not in papeis:
            bpy.data.actions.remove(a)

    # malha e textura repetidas ficam orfas depois de remover os objetos
    for _ in range(3):
        try: bpy.ops.outliner.orphans_purge(do_recursive=True)
        except Exception: break

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
        base = os.path.join(ORIG, pasta, pasta)
        bpy.ops.wm.read_factory_settings(use_empty=True)

        if arquivo is None:
            # personagem que veio com uma acao por arquivo: funde os seis
            if not os.path.isdir(base):
                print("FALTA:", base); continue
            achadas, perdidas = funde_arquivos(base, mapa)
            origem = os.path.join(base, list(mapa.keys())[0])
        else:
            origem = os.path.join(base, arquivo)
            if not os.path.exists(origem):
                print("FALTA:", origem); continue
            bpy.ops.import_scene.gltf(filepath=origem)
            limpa_lixo()
            achadas, perdidas = renomeia_acoes(mapa)
        ntex = reamostra_texturas()


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
