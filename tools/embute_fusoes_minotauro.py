# -*- coding: utf-8 -*-
"""Traz as SEIS FUSOES DO MINOTAURO, seus escudos e a invocacao do Muro Vivo.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_fusoes_minotauro.py

TRES COISAS DIFERENTES NUM ARQUIVO SO
-------------------------------------
  · 6 CORPOS de fusao, com as seis acoes cada (veio corrida);
  · 6 ESCUDOS, um por dupla — sao PROPS, sem animacao nenhuma;
  · 1 INVOCACAO, a criatura que a dupla com o Xama chama.

O escudo ate agora era UM SO para o jogo inteiro (`MURO_MODELO` era constante
em renderer3d_v2.js). Com seis, a constante vira tabela — ver `MURO_POR_FUSAO`
la. Isso muda o codigo, nao so a arte, e por isso esta anotado nos dois lugares.

TRES NOMES DE ARQUIVO COM DEFEITO, TRATADOS UM A UM
---------------------------------------------------
    minotauro-bruxo death.glb      <- ESPACO onde devia ser traco
    minotauro-ladino.attack.glb    <- PONTO onde devia ser traco
    mnotauro-sumo-escudo.glb       <- falta o "i" de minotauro

Poderia ter normalizado com expressao regular e seguido em frente. Nao fiz: um
padrao esperto que "conserta" nome errado tambem esconde o dia em que um arquivo
faltar de verdade — e faltar em silencio e o pior modo de falhar deste projeto.
Cada nome torto esta escrito abaixo, visivel.

O EMBARALHAMENTO DO MESHY, PELA QUARTA VEZ
------------------------------------------
Em TODAS as sete pastas o `attack.glb` guarda a REACAO (`Slap_Reaction`,
`Crouch_and_Step_Back`) e o `hit.glb` guarda o ataque de verdade
(`Triple_Combo_Attack`, `Double_Combo_Attack`, `mage_soell_cast_6`). Li o
cabecalho JSON dos 46 arquivos antes de escrever este mapa.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\minotauro"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-fusoes-minotauro.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_fus_mino")
TEX_ALVO = 1024

# corpo -> (pasta, {arquivo: papel})
# O nome do arquivo esta INTEIRO, sem montagem por padrao: tres deles estao
# tortos, e um padrao que os "consertasse" esconderia o dia em que um faltar.
CORPOS = [
    ("fus_arqueiro_minotauro", "minotauro caçador", {
        "minotauro-caçador-idle.glb":   "idle",
        "minotauro-caçador-walk.glb":   "walk",
        "minotauro-caçador-run.glb":    "run",
        "minotauro-caçador-hit.glb":    "attack",     # Double_Combo_Attack
        "minotauro-caçador-attack.glb": "HitReact",   # Slap_Reaction
        "minotauro-caçador-death.glb":  "death",
    }),
    ("fus_bruxo_minotauro", "minotauro - bruxo", {
        "minotauro-bruxo-idle.glb":   "idle",
        "minotauro-bruxo-walk.glb":   "walk",
        "minotauro-bruxo-run.glb":    "run",
        "minotauro-bruxo-hit.glb":    "attack",       # Double_Combo_Attack
        "minotauro-bruxo-attack.glb": "HitReact",     # Crouch_and_Step_Back
        "minotauro-bruxo death.glb":  "death",        # ESPACO no nome
    }),
    ("fus_curandeiro_minotauro", "minotauro - curandeiro", {
        "minotauro-curandeiro-idle.glb":   "idle",
        "minotauro-curandeiro-walk.glb":   "walk",
        "minotauro-curandeiro-run.glb":    "run",
        "minotauro-curandeiro-hit.glb":    "attack",   # Double_Combo_Attack
        "minotauro-curandeiro-attack.glb": "HitReact",
        "minotauro-curandeiro-death.glb":  "death",
    }),
    ("fus_espadachim_minotauro", "minotauro - ladino", {
        "minotauro-ladino-idle.glb":   "idle",
        "minotauro-ladino-walk.glb":   "walk",
        "minotauro-ladino-run.glb":    "run",
        "minotauro-ladino-hit.glb":    "attack",       # Triple_Combo_Attack
        "minotauro-ladino.attack.glb": "HitReact",     # PONTO no nome
        "minotauro-ladino-death.glb":  "death",
    }),
    ("fus_invocador_minotauro", "minotauro - xamã", {
        "minotauro-xama-idle.glb":   "idle",
        "minotauro-xama-walk.glb":   "walk",
        "minotauro-xama-run.glb":    "run",
        "minotauro-xama-hit.glb":    "attack",         # mage_soell_cast_6
        "minotauro-xama-attack.glb": "HitReact",
        "minotauro-xama-death.glb":  "death",
    }),
    ("fus_minotauro_sumo", "minotauro - sumo", {
        "minotauro-sumo-idle.glb":   "idle",
        "minotauro-sumo-walk.glb":   "walk",
        "minotauro-sumo-run.glb":    "run",
        "minotauro-sumo-hit.glb":    "attack",         # Triple_Combo_Attack
        "minotauro-sumo-attack.glb": "HitReact",
        "minotauro-sumo-death.glb":  "death",
    }),
]

# a invocacao do Muro Vivo — sem corrida, e nao precisa
INVOCACAO = ("fus_muro_vigia", os.path.join("minotauro - xamã", "invocação"), {
    "minotauro-xama-invocacao-idle.glb":   "idle",
    "minotauro-xama-invocacao-walk.glb":   "walk",
    "minotauro-xama-invocacao-hit.glb":    "attack",   # mage_soell_cast_3
    "minotauro-xama-invocacao-attack.glb": "HitReact",
    "minotauro-xama-invocacao-death.glb":  "death",
})

# escudo -> (pasta, arquivo). Sao PROPS: nenhuma animacao, um arquivo cada.
ESCUDOS = [
    ("muro_arqueiro_minotauro",   "minotauro caçador",     "minotauro-caçador-escudo.glb"),
    ("muro_bruxo_minotauro",      "minotauro - bruxo",     "minotauro-bruxo-escudo.glb"),
    ("muro_curandeiro_minotauro", "minotauro - curandeiro", "minotauro-curandeiro-escudo.glb"),
    ("muro_espadachim_minotauro", "minotauro - ladino",    "minotauro-ladino-escudo.glb"),
    ("muro_invocador_minotauro",  "minotauro - xamã",      "minotauro-xama-escudo.glb"),
    ("muro_minotauro_sumo",       "minotauro - sumo",      "mnotauro-sumo-escudo.glb"),  # falta o "i"
]


def limpa_lixo():
    fora = []
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            fora.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    if fora:
        print("   lixo removido:", ", ".join(fora))


def reamostra():
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n += 1
    return n


def funde(pasta, mapa):
    """Cada arquivo traz UMA acao; os seis viram um personagem so."""
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


def exporta(chave, com_anim):
    destino = os.path.join(TMP, chave + ".glb")
    bpy.ops.object.select_all(action="SELECT")
    if com_anim:
        bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                                  use_selection=True, export_animations=True,
                                  export_animation_mode="ACTIONS",
                                  export_image_format="JPEG")
    else:
        bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                                  use_selection=True, export_animations=False,
                                  export_image_format="JPEG")
    return open(destino, "rb").read()


def main():
    if not os.path.isdir(TMP):
        os.makedirs(TMP)

    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - as SEIS fusoes do Minotauro, seus escudos e a invocacao.",
        " *",
        " * Tres coisas num arquivo so: 6 corpos de fusao (com as seis acoes), 6",
        " * ESCUDOS (props, sem animacao — um por dupla) e a criatura que a dupla",
        " * com o Xama invoca.",
        " *",
        " * O escudo era UM SO para o jogo inteiro. Com seis, `MURO_MODELO` deixou",
        " * de ser constante e virou a tabela `MURO_POR_FUSAO` em renderer3d_v2.js.",
        " *",
        " * ATENCAO: em todas as sete pastas, `attack.glb` guarda a REACAO e",
        " * `hit.glb` guarda o ATAQUE. O mapa em tools/embute_fusoes_minotauro.py",
        " * corrige pelo CONTEUDO. Nao inverta confiando no nome do arquivo.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]

    rel = []
    for chave, sub, mapa in CORPOS + [INVOCACAO]:
        base = os.path.join(ORIG, sub)
        if not os.path.isdir(base):
            print("FALTA A PASTA:", base); continue
        print("\n--- %s" % chave)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        achadas, perdidas = funde(base, mapa)
        ntex = reamostra()
        tris = 0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
        dados = exporta(chave, True)
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;"
                      % (chave, "['" + "','".join(sorted(achadas.keys())) + "']"))
        rel.append((chave, len(dados) / 1048576.0, tris, sorted(achadas.keys()), perdidas))

    for chave, sub, arquivo in ESCUDOS:
        caminho = os.path.join(ORIG, sub, arquivo)
        if not os.path.isfile(caminho):
            print("FALTA O ESCUDO:", caminho); continue
        print("\n--- %s (escudo)" % chave)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=caminho)
        # Aqui o lixo do Meshy e removido pela CONTAGEM de vertices, nao por
        # "nao tem pai": um escudo E uma malha sem pai, e a regra dos corpos
        # apagaria o proprio escudo.
        for o in list(bpy.data.objects):
            if o.type == 'MESH' and o.parent is None and len(o.data.vertices) < 600:
                print("   lixo removido:", o.name)
                bpy.data.objects.remove(o, do_unlink=True)
        ntex = reamostra()
        tris = 0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
        dados = exporta(chave, False)
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        rel.append((chave, len(dados) / 1048576.0, tris, ["(prop)"], []))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n\n=== FUSOES DO MINOTAURO ===")
    print("%-26s %7s %8s  %s" % ("chave", "MB", "tris", "papeis"))
    for c, d, t, na, p in rel:
        print("%-26s %7.2f %8d  %s%s"
              % (c, d, t, ",".join(na), ("  FALTOU: " + ",".join(p)) if p else ""))
    print("\narquivo: %.2f MB" % (os.path.getsize(SAIDA) / 1048576.0))


main()
