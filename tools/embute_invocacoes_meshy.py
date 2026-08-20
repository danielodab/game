# -*- coding: utf-8 -*-
"""Traz o REBANHO DO INVOCADOR feito no Meshy para o jogo.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_invocacoes_meshy.py

POR QUE UMA FERRAMENTA SEPARADA DE `embute_meshy.py`
----------------------------------------------------
A dos personagens le `assets_ok/<classe>/<classe>/` e escreve um arquivo; esta
le `assets_ok/xama/xama/<Nome da Criatura>/` e escreve outro. Sao acervos com
vidas diferentes — o Daniel vai refazer invocacao sem tocar em heroi e
vice-versa —, e juntar as duas obrigaria a reprocessar 15 personagens para
mudar um sapo. As duas funcoes de fusao/renomeacao sao pequenas e estao
duplicadas de proposito: sao script de build, nao codigo de jogo.

O EMBARALHAMENTO DOS NOMES DE ARQUIVO
-------------------------------------
Em OITO das nove criaturas o `attack.glb` guarda uma REACAO (`Slap_Reaction`,
`Crouch_and_Step_Back`) e o `hit.glb` guarda um ATAQUE (`Attack`,
`Punch_Combo`, `Axe_Spin_Attack`, `mage_soell_cast_4`). Mapeio pelo que a
animacao E, nao pelo nome do arquivo — uma criatura que apanha quando manda
atacar seria um defeito silencioso, dificil de achar meses depois.

O Cao de Brasa veio no formato ANTIGO (arquivos redundantes, cada um com todas
as acoes), entao ele usa o caminho de arquivo unico, como os herois.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\xama\xama"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-meshy-sum.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_meshy_sum")

TEX_ALVO = 1024

# chave do modelo -> (pasta, arquivo unico ou None, mapa)
#   arquivo = None  -> mapa e {arquivo: papel} e os seis sao FUNDIDOS
#   arquivo = 'x'   -> mapa e {nome-da-acao: papel} dentro daquele arquivo
INVOCACOES = [
    ("sum_familiar", "Chamado Menor", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",     # Female_Crouch_Pick_Throw_Forward: pega e arremessa
        "attack.glb": "HitReact",   # Crouch_and_Step_Back: recua agachado
        "death.glb":  "death",
    }),
    # CAO DE BRASA: veio no formato antigo, com os seis arquivos redundantes.
    # O `attack.glb` e o mais completo (seis acoes); os outros trazem menos.
    ("sum_ember_hound", "Cão de Brasa", "attack.glb", {
        "Idle_03":       "idle",
        "Walking":       "walk",
        "Running":       "run",
        "Punch_Combo":   "attack",
        "Slap_Reaction": "HitReact",
        "Knock_Down":    "death",
    }),
    ("sum_magma_colossus", "Colosso de Magma", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",     # Attack
        "attack.glb": "HitReact",   # Crouch_and_Step_Back
        "death.glb":  "death",
    }),
    ("sum_tide_nymph", "ninfa da maré", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        # Crouch_Charge_and_Throw: o gesto de juntar e LANCAR. Ela nunca fere —
        # e este mesmo clipe que o jogo usa para a cura, porque `cast` cai em
        # `attack` quando nao existe. Agachar, juntar e dar: serve.
        "hit.glb":    "attack",
        "attack.glb": "HitReact",   # Slap_Reaction
        "death.glb":  "death",
    }),
    ("sum_stone_sentinel", "sentinela de pedra", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",     # Punch_Combo
        "attack.glb": "HitReact",   # Crouch_and_Step_Back
        "death.glb":  "death",
    }),
    ("sum_mountain_golem", "Golem da montanha", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",     # Attack
        "attack.glb": "HitReact",   # Slap_Reaction
        "death.glb":  "death",
    }),
    # FALCAO: nao veio `run.glb`; a corrida esta no arquivo com o nome que o
    # Meshy deu ao exportar. E o `attack.glb` traz `Block6` — defesa, nao golpe —
    # entao ele serve de reacao a dano, e o ataque de verdade vem do `hit.glb`.
    ("sum_storm_falcon", "Falcão da tormenta", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "Meshy_AI_Animation_Running_withSkin.glb": "run",
        "hit.glb":    "attack",     # Female_Crouch_Pick_Throw_Forward
        "attack.glb": "HitReact",   # Block6
        "death.glb":  "death",
    }),
    ("sum_drowned_cistern", "Afogado da Cisterna", None, {
        "idle.glb":   "idle",       # Combat_Stance
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",     # Axe_Spin_Attack
        "attack.glb": "HitReact",   # Slap_Reaction
        "death.glb":  "death",      # Electrocuted_Fall
    }),
    ("sum_storm_eye", "olho da tormenta", None, {
        "idle.glb":   "idle",
        "walk.glb":   "walk",
        "run.glb":    "run",
        "hit.glb":    "attack",     # mage_soell_cast_4: conjuracao
        "attack.glb": "HitReact",   # Slap_Reaction
        "death.glb":  "death",
    }),
]


def limpa_lixo():
    """Tira a `Icosphere` solta que o Meshy deixa em todo arquivo."""
    fora = []
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            fora.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    if fora:
        print("LIXO REMOVIDO|", ", ".join(fora))


def reamostra_texturas():
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n += 1
    return n


def renomeia_acoes(mapa):
    """Um arquivo, varias acoes: da a cada uma o papel e joga o resto fora."""
    achadas, perdidas = {}, []
    for orig, papel in mapa.items():
        a = bpy.data.actions.get(orig)
        if a:
            a.name = "papel_" + papel
            achadas[papel] = orig
        else:
            perdidas.append(orig)
    for a in bpy.data.actions:
        if a.name.startswith("papel_"):
            a.name = a.name[len("papel_"):]
    for a in list(bpy.data.actions):
        if a.name not in mapa.values():
            bpy.data.actions.remove(a)
    return achadas, perdidas


def funde_arquivos(pasta, mapa):
    """Seis arquivos de uma acao cada viram um personagem so.

    Fica com o corpo do primeiro e traz dos outros apenas a ACAO. Da certo
    porque os seis saem do mesmo personagem: os ossos tem os mesmos nomes.
    `use_fake_user` e obrigatorio — sem dono, o Blender descarta a acao no
    instante em que apago o objeto que a trouxe.
    """
    achadas, perdidas = {}, []
    for i, (arquivo, papel) in enumerate(mapa.items()):
        caminho = os.path.join(pasta, arquivo)
        if not os.path.exists(caminho):
            perdidas.append(arquivo); continue

        antes_obj = set(o.name for o in bpy.data.objects)
        antes_act = set(a.name for a in bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=caminho)
        novos_obj = [o for o in bpy.data.objects if o.name not in antes_obj]
        novas_act = [a for a in bpy.data.actions if a.name not in antes_act]

        if not novas_act:
            perdidas.append(arquivo + " (sem acao)")
        else:
            act = novas_act[0]
            act.name = "papel_" + papel
            act.use_fake_user = True
            achadas[papel] = arquivo
            for extra in novas_act[1:]:
                bpy.data.actions.remove(extra)

        if i == 0:
            limpa_lixo()
        else:
            for o in novos_obj:
                try: bpy.data.objects.remove(o, do_unlink=True)
                except Exception: pass

    for a in bpy.data.actions:
        if a.name.startswith("papel_"):
            a.name = a.name[len("papel_"):]
    for a in list(bpy.data.actions):
        if a.name not in mapa.values():
            bpy.data.actions.remove(a)
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
        "/* SOTERRA 3.0 - o Rebanho do Invocador, feito pelo usuario no Meshy.",
        " *",
        " * As nove invocacoes do Xama, todas HUMANOIDES: a biblioteca de animacao",
        " * dele e de esqueleto humanoide, e um bicho de quatro patas so conseguiria",
        " * um clipe de andar — no tabuleiro, deslizar parado a batalha inteira.",
        " *",
        " * Textura reamostrada para %d px e as seis acoes renomeadas para os papeis" % TEX_ALVO,
        " * que `autoActions()` reconhece (Idle/Walk/Run/Attack/HitReact/Death).",
        " *",
        " * ATENCAO ao mexer: em oito das nove, `attack.glb` guarda a REACAO e",
        " * `hit.glb` guarda o ATAQUE. O mapa em `tools/embute_invocacoes_meshy.py`",
        " * corrige isso pelo conteudo, nao pelo nome do arquivo.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]

    rel = []
    for chave, pasta, arquivo, mapa in INVOCACOES:
        base = os.path.join(ORIG, pasta)
        if not os.path.isdir(base):
            print("FALTA:", base); continue

        bpy.ops.wm.read_factory_settings(use_empty=True)
        if arquivo is None:
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
        rel.append((chave, len(dados) / 1048576.0, tris, len(achadas), perdidas, ntex))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n=== REBANHO DO INVOCADOR ===")
    print("%-22s %10s %8s %7s %s" % ("chave", "MB", "tris", "acoes", "perdidas"))
    for c, d, t, na, p, nt in rel:
        print("%-22s %10.2f %8d %7d %s" % (c, d, t, na, ",".join(p) or "-"))
    print("arquivo: %.2f MB" % (os.path.getsize(SAIDA) / 1048576.0))


main()
