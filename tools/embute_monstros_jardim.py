# -*- coding: utf-8 -*-
"""Traz os NOVE MONSTROS DA ESTUFA, feitos pelo Daniel no Meshy.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_monstros_jardim.py

POR QUE UMA FERRAMENTA SEPARADA
-------------------------------
Mesma razao de `embute_invocacoes_meshy.py`: acervos com vidas diferentes. O
Daniel vai refazer monstro sem tocar em heroi nem em invocacao, e juntar tudo
obrigaria a reprocessar 24 personagens para mudar um carrapicho. Sao scripts de
build, e um pouco de duplicacao aqui e mais barata que um acoplamento.

O EMBARALHAMENTO SE REPETE — E FOI CONFERIDO, NAO SUPOSTO
---------------------------------------------------------
Em OITO das nove criaturas o `attack.glb` guarda `Slap_Reaction` — uma REACAO a
dano — e o `hit.glb` guarda o ataque de verdade (`Heavy_Hammer_Swing`,
`Triple_Combo_Attack`, `Elbow_Strike`, `Punch_Combo`, `Basic_Jump`, `Attack`).
E o mesmo que aconteceu no Rebanho do Xama.

Nao confiei no padrao: li o cabecalho JSON dos 45 arquivos antes de escrever
este mapa. Um monstro que APANHA quando manda atacar e um defeito silencioso —
nao da erro, so fica errado, e meses depois ninguem lembra de olhar.

O SEIVEIRO VEIO QUEBRADO
------------------------
`attack.glb`, `hit.glb` e `idle.glb` do Seiveiro tem o MESMO md5: sao o mesmo
arquivo exportado tres vezes, os tres com `Idle_Turn_Right`. Ele nao tem ataque
nem reacao a dano. Entra so com idle/walk/death, que e o que existe.

Nao inventei um ataque para ele com o clipe de virar: um toco que gira quando
rega seria mentira visual, e mentira visual e pior que ausencia — a ausencia o
Daniel percebe e conserta, a mentira passa. A reacao a dano cai em `idle`
sozinha (ver `ACTION_FALLBACK.hit` em models3d_v2.js).

NAO VEIO `run.glb`, E ESTA TUDO BEM
-----------------------------------
O Daniel avisou: "so nao tem o run, mas use o walk somente". Nao precisa de
nada — `ACTION_FALLBACK.run = ['walk', ...]` ja faz exatamente isso, de graca.
Duplicar o clipe de andar sob o nome `Run` custaria bytes para produzir o mesmo
resultado que o motor entrega sozinho.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\jardim\monstros"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-meshy-jardim.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_jardim")

TEX_ALVO = 1024

# id do monstro no jogo -> (pasta, {sufixo do arquivo: papel})
#
# O arquivo real e "<pasta> <sufixo>.glb" — o Meshy carimba o nome da criatura
# em cada exportacao. Monto o nome na hora para nao repetir nove vezes.
#
# O comentario ao lado de cada `attack` diz QUAL animacao esta ali dentro: e a
# prova de que o mapa foi feito pelo conteudo e nao pelo nome do arquivo, e e o
# que permite conferir de novo sem reabrir 45 GLBs.
MONSTROS = [
    ("boss-gardener", "A Jardineira-Viúva", {
        "idle":   "idle",        # Idle_02
        "walk":   "walk",        # walking_man
        "hit":    "attack",      # Heavy_Hammer_Swing: a tesourada de poda
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",       # Jump_to_Catch_and_Fall
    }),
    ("dew-strider", "Aranha-de-Orvalho", {
        "idle":   "idle",        # Idle_02
        "walk":   "walk",
        "hit":    "attack",      # Punch_Combo
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
    # BROTINHO: o idle dele e `Alert`, nao `Idle_02` — uma muda em guarda, de
    # orelha em pe. Combina com "so folhas, pressa e dentes"; mantive.
    ("sprout-feral", "Brotinho-Voraz", {
        "idle":   "idle",        # Alert
        "walk":   "walk",
        "hit":    "attack",      # Punch_Combo
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
    ("pollen-puff", "Bufo-de-Pólen", {
        "idle":   "idle",        # Idle_02
        "walk":   "walk",
        "hit":    "attack",      # Attack
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
    # CARRAPICHINHO: o ataque dele e `Basic_Jump` — ele PULA em cima. E o gesto
    # certo para "gruda e nao solta", entao entra como ataque mesmo sendo pulo.
    ("burrlet", "Carrapichinho", {
        "idle":   "idle",        # Idle_02
        "walk":   "walk",
        "hit":    "attack",      # Basic_Jump
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
    # CARRAPICHO-MAE: idle e `Combat_Stance`, postura de briga. Ela e a que
    # se desfia em dois ao morrer; nascer ja em guarda combina.
    ("burr-mother", "Carrapicho-Mãe", {
        "idle":   "idle",        # Combat_Stance
        "walk":   "walk",
        "hit":    "attack",      # Punch_Combo
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
    # SEIVEIRO INCOMPLETO. attack.glb, hit.glb e idle.glb sao o MESMO arquivo
    # (md5 igual), os tres com `Idle_Turn_Right`. Sem ataque e sem reacao.
    # Falta re-exportar essas duas do Meshy.
    ("sap-shaman", "Seiveiro", {
        "idle":   "idle",        # Idle_Turn_Right
        "walk":   "walk",
        "death":  "death",       # Fall_Dead_from_Abdominal_Injury
    }),
    ("thorn-lasher", "Vergasta", {
        "idle":   "idle",        # Idle_02
        "walk":   "walk",
        "hit":    "attack",      # Elbow_Strike: o chicote batendo
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
    ("lantern-wasp", "Vespa-Lustre", {
        "idle":   "idle",        # Idle_02
        "walk":   "walk",
        "hit":    "attack",      # Triple_Combo_Attack: chega e sai antes da resposta
        "attack": "HitReact",    # Slap_Reaction
        "death":  "death",
    }),
]


def limpa_lixo():
    """A `Icosphere` solta que o Meshy deixa em todo arquivo."""
    fora = []
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            fora.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    if fora:
        print("   lixo removido:", ", ".join(fora))


def reamostra_texturas():
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n += 1
    return n


def funde(pasta, nome, mapa):
    """Cada arquivo traz UMA acao; os cinco viram um monstro so.

    Fica com o corpo do primeiro e traz dos outros apenas a ACAO — da certo
    porque os cinco saem do mesmo personagem e os ossos tem os mesmos nomes.
    `use_fake_user` e obrigatorio: sem dono, o Blender descarta a acao no
    instante em que apago o objeto que a trouxe.
    """
    achadas, perdidas = {}, []
    for i, (sufixo, papel) in enumerate(mapa.items()):
        arquivo = "%s %s.glb" % (nome, sufixo)
        caminho = os.path.join(pasta, arquivo)
        if not os.path.exists(caminho):
            perdidas.append(sufixo); continue

        antes_obj = set(o.name for o in bpy.data.objects)
        antes_act = set(a.name for a in bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=caminho)
        novos_obj = [o for o in bpy.data.objects if o.name not in antes_obj]
        novas_act = [a for a in bpy.data.actions if a.name not in antes_act]

        if not novas_act:
            perdidas.append(sufixo + " (sem acao)")
        else:
            act = novas_act[0]
            act.name = "papel_" + papel
            act.use_fake_user = True
            achadas[papel] = act.name
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
        "/* SOTERRA 3.0 - os nove monstros da ESTUFA, feitos pelo Daniel no Meshy.",
        " *",
        " * Substituem os emprestados (sapo, aranha e cobra do Quaternius, esqueleto",
        " * mago do KayKit). Aqueles eram bichos de quatro patas vestindo o papel de",
        " * outra criatura; estes SAO as criaturas do bestiario.",
        " *",
        " * Textura reamostrada para %d px e as acoes renomeadas para os papeis que" % TEX_ALVO,
        " * `autoActions()` reconhece (Idle/Walk/Attack/HitReact/Death).",
        " *",
        " * ATENCAO ao mexer: em oito das nove, `attack.glb` guarda a REACAO e",
        " * `hit.glb` guarda o ATAQUE. O mapa em tools/embute_monstros_jardim.py",
        " * corrige pelo CONTEUDO, com o nome da animacao anotado ao lado de cada",
        " * linha. Nao inverta confiando no nome do arquivo.",
        " *",
        " * SEM `run`: nenhum monstro veio com corrida, e nao precisa —",
        " * `ACTION_FALLBACK.run` cai em `walk` sozinho.",
        " *",
        " * SEIVEIRO INCOMPLETO: sem ataque e sem reacao a dano (os tres arquivos",
        " * vieram identicos, so com `Idle_Turn_Right`). Falta re-exportar.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]

    rel = []
    for chave, nome, mapa in MONSTROS:
        base = os.path.join(ORIG, nome)
        if not os.path.isdir(base):
            print("FALTA A PASTA:", base); continue
        print("\n--- %s (%s)" % (nome, chave))

        bpy.ops.wm.read_factory_settings(use_empty=True)
        achadas, perdidas = funde(base, nome, mapa)
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
        rel.append((chave, len(dados) / 1048576.0, tris, sorted(achadas.keys()), perdidas, ntex))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n\n=== MONSTROS DA ESTUFA ===")
    print("%-16s %7s %8s  %s" % ("chave", "MB", "tris", "papeis"))
    for c, d, t, na, p, nt in rel:
        print("%-16s %7.2f %8d  %s%s"
              % (c, d, t, ",".join(na), ("  FALTOU: " + ",".join(p)) if p else ""))
    print("\narquivo: %.2f MB" % (os.path.getsize(SAIDA) / 1048576.0))


main()
