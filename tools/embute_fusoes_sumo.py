# -*- coding: utf-8 -*-
"""Traz os CORPOS DE FUSAO do Barbaro, feitos pelo Daniel no Meshy.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_fusoes_sumo.py

O QUE MUDA NO JOGO
------------------
Ate agora o corpo fundido era COMPOSTO: `fusionLook()` pegava o modelo da classe
mais pesada e enxertava nele a cabeca, a capa e a arma da outra. Funcionava e
lia, mas era a ultima coisa no jogo que nao era arte do Daniel — e uma fusao
composta nunca vai parecer um ser proprio, so um heroi carregando peca alheia.

Estes sao cinco corpos INTEIROS, um por dupla do Barbaro, mais a criatura que a
dupla com o Xama invoca.

O EMBARALHAMENTO DO MESHY, DE NOVO E CONFERIDO
-----------------------------------------------
Nas seis pastas o `attack.glb` guarda `Slap_Reaction` — uma REACAO — e o
`hit.glb` guarda o ataque de verdade (`Attack`, `Heavy_Hammer_Swing`,
`Double_Combo_Attack`, `Punch_Combo`). E a terceira vez que isso acontece: ja
pegou o Rebanho do Xama e os nove monstros da Estufa.

Nao confiei no padrao: li o cabecalho JSON dos 35 arquivos antes de escrever
este mapa, e o nome da animacao esta anotado ao lado de cada linha.

DESTA VEZ VEIO CORRIDA
----------------------
As cinco fusoes trazem `run.glb`, ao contrario dos monstros da Estufa. Entao ela
entra — o motor prefere um clipe proprio ao substituto. So o IDOLO nao tem, e
nao faz falta: `ACTION_FALLBACK.run` cai em `walk`, e uma criatura de 1 PP nao
corre mesmo.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\sumo"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-fusoes-sumo.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_fus_sumo")

TEX_ALVO = 1024

# chave no jogo -> (pasta, prefixo do arquivo, {sufixo: papel})
#
# A chave de fusao e ALFABETICA (contrato §4), entao o Barbaro — `sumo` — cai
# sempre em segundo. O comentario ao lado de cada `attack` diz QUAL animacao
# esta ali dentro: e a prova de que o mapa foi feito pelo conteudo.
COMUM = {
    "idle":   "idle",
    "walk":   "walk",
    "run":    "run",
    "hit":    "attack",      # o ataque de verdade mora aqui
    "attack": "HitReact",    # Slap_Reaction
    "death":  "death",
}

FUSOES = [
    ("fus_arqueiro_sumo",   "sumo- caçador",    "sumo-caçador",    COMUM),   # hit: Double_Combo_Attack
    ("fus_bruxo_sumo",      "sumo - mago",      "sumo-bruxo",      COMUM),   # hit: Attack
    ("fus_curandeiro_sumo", "sumo - curandeiro", "sumo-curandeira", COMUM),  # hit: Attack
    ("fus_espadachim_sumo", "sumo - ladino",    "sumo-ladino",     COMUM),   # hit: Heavy_Hammer_Swing
    ("fus_invocador_sumo",  "sumo - xama",      "sumo-xama",       COMUM),   # hit: Double_Combo_Attack
]

# a criatura que a dupla com o Xama invoca — sem corrida, e nao precisa
IDOLO = ("fus_idolo_escora", os.path.join("sumo - xama", "Ídolo Escora"), "idolo-escora", {
    "idle":   "idle",
    "walk":   "walk",
    "hit":    "attack",      # Punch_Combo
    "attack": "HitReact",    # Slap_Reaction
    "death":  "death",
})


def limpa_lixo():
    """A `Icosphere` solta que o Meshy deixa em todo arquivo."""
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


def funde(pasta, prefixo, mapa):
    """Cada arquivo traz UMA acao; os seis viram um personagem so.

    Fica com o corpo do primeiro e traz dos outros apenas a ACAO — da certo
    porque saem todos do mesmo personagem e os ossos tem os mesmos nomes.
    `use_fake_user` e obrigatorio: sem dono, o Blender descarta a acao no
    instante em que apago o objeto que a trouxe.
    """
    achadas, perdidas = {}, []
    for i, (sufixo, papel) in enumerate(mapa.items()):
        caminho = os.path.join(pasta, "%s-%s.glb" % (prefixo, sufixo))
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
        "/* SOTERRA 3.0 - os CORPOS DE FUSAO do Barbaro, feitos pelo Daniel.",
        " *",
        " * Cinco duplas com corpo INTEIRO, contra a composicao que o jogo fazia",
        " * antes (modelo da classe mais pesada + cabeca, capa e arma da outra",
        " * enxertadas). Mais a criatura que a dupla com o Xama invoca.",
        " *",
        " * Textura reamostrada para %d px e as acoes renomeadas para os papeis" % TEX_ALVO,
        " * que `autoActions()` reconhece (Idle/Walk/Run/Attack/HitReact/Death).",
        " *",
        " * ATENCAO ao mexer: em TODAS as seis, `attack.glb` guarda a REACAO e",
        " * `hit.glb` guarda o ATAQUE. O mapa em tools/embute_fusoes_sumo.py",
        " * corrige pelo CONTEUDO, com o nome da animacao anotado ao lado.",
        " * Nao inverta confiando no nome do arquivo.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]

    rel = []
    for chave, sub, prefixo, mapa in FUSOES + [IDOLO]:
        base = os.path.join(ORIG, sub)
        if not os.path.isdir(base):
            print("FALTA A PASTA:", base); continue
        print("\n--- %s" % chave)

        bpy.ops.wm.read_factory_settings(use_empty=True)
        achadas, perdidas = funde(base, prefixo, mapa)
        ntex = reamostra()

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
        linhas.append("JOGO.MODELS['%s']='%s';"
                      % (chave, base64.b64encode(dados).decode("ascii")))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;"
                      % (chave, "['" + "','".join(sorted(achadas.keys())) + "']"))
        rel.append((chave, len(dados) / 1048576.0, tris, sorted(achadas.keys()), perdidas))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("\n\n=== CORPOS DE FUSAO DO BARBARO ===")
    print("%-22s %7s %8s  %s" % ("chave", "MB", "tris", "papeis"))
    for c, d, t, na, p in rel:
        print("%-22s %7.2f %8d  %s%s"
              % (c, d, t, ",".join(na), ("  FALTOU: " + ",".join(p)) if p else ""))
    print("\narquivo: %.2f MB" % (os.path.getsize(SAIDA) / 1048576.0))


main()
