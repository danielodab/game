# -*- coding: utf-8 -*-
"""Traz as QUATRO fusoes do Cacador e o Totem-Espoleta (invocacao do Xama).

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_fusoes_cacador.py

O LOTE
------
  · 4 CORPOS de fusao (bruxo, curandeira, ladino, xama), seis acoes cada;
  · 1 INVOCACAO — o Totem-Espoleta, a torre-espingarda que a dupla com o
    Xama finca no chao. Sem walk E SEM PRECISAR: a criatura tem 0 PP.

DOIS DEFEITOS DESTE LOTE, TRATADOS UM A UM
------------------------------------------
    caçardor-xama-invocacao-*.glb   <- "caçardor", com R a mais, nos 4 arquivos
    ...-invocacao-idle.glb          <- SEM ANIMACAO E SEM ARMATURE (lista de
                                       animations vazia no cabecalho JSON).
                                       O arquivo NAO entra: a malha solta dele
                                       e "sem pai" e a regra do lixo a comeria
                                       — a primeira rodada saiu 0 tris por
                                       isso. A malha vem do hit.glb (skinned)
                                       e o idle e SINTETIZADO aqui: dois
                                       quadros iguais ao quadro zero do
                                       ataque (a pose de descanso). Sem ele,
                                       o padrao do autoActions ("sem idle?
                                       usa o primeiro clipe") poria o totem
                                       agachando em loop no descanso.

Como sempre: nome torto escrito por extenso, nada de regex esperta que
conserta nome errado e esconde o dia em que um arquivo faltar.

O EMBARALHAMENTO DO MESHY, PELA QUINTA VEZ
------------------------------------------
Nas quatro pastas de corpo o `attack.glb` guarda a REACAO (`Slap_Reaction`)
e o `hit.glb` guarda o ataque de verdade (`mage_soell_cast`,
`Archery_Aim_with_Lateral_Scan`, `mage_soell_cast_7`). Na invocacao idem:
`attack` = `Hit_Reaction_1`, `hit` = `air_squat` (o coice do tiro). Li o
cabecalho JSON dos 28 arquivos antes de escrever este mapa.
"""
import bpy, os, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = "C:\\Users\\danie\\Downloads\\assets_ok\\ca\u00e7ador"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-fusoes-cacador.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_fus_cac")
TEX_ALVO = 1024

CA = "ca\u00e7ador"          # caçador
CARD = "ca\u00e7ardor"       # o typo dos arquivos da invocacao
INVO = "invoca\u00e7\u00e3o" # invocação

# corpo -> (pasta, {arquivo: papel})
CORPOS = [
    ("fus_arqueiro_bruxo", CA + " - bruxo", {
        CA + "-bruxo-idle.glb":   "idle",
        CA + "-bruxo-walk.glb":   "walk",
        CA + "-bruxo-run.glb":    "run",
        CA + "-bruxo-hit.glb":    "attack",     # mage_soell_cast
        CA + "-bruxo-attack.glb": "HitReact",   # Slap_Reaction
        CA + "-bruxo-death.glb":  "death",
    }),
    # ATENCAO: a PASTA diz "curandeiro", os ARQUIVOS dizem "curandeira"
    ("fus_arqueiro_curandeiro", CA + " - curandeiro", {
        CA + "-curandeira-idle.glb":   "idle",
        CA + "-curandeira-walk.glb":   "walk",
        CA + "-curandeira-run.glb":    "run",
        CA + "-curandeira-hit.glb":    "attack",   # Archery_Aim_with_Lateral_Scan
        CA + "-curandeira-attack.glb": "HitReact",
        CA + "-curandeira-death.glb":  "death",    # Shot_and_Fall_Backward
    }),
    ("fus_arqueiro_espadachim", CA + " - ladino", {
        CA + "-ladino-idle.glb":   "idle",
        CA + "-ladino-walk.glb":   "walk",
        CA + "-ladino-run.glb":    "run",
        CA + "-ladino-hit.glb":    "attack",       # mage_soell_cast_7
        CA + "-ladino-attack.glb": "HitReact",
        CA + "-ladino-death.glb":  "death",
    }),
    ("fus_arqueiro_invocador", CA + " - xama", {
        CA + "-xama-idle.glb":   "idle",
        CA + "-xama-walk.glb":   "walk",
        CA + "-xama-run.glb":    "run",
        CA + "-xama-hit.glb":    "attack",         # mage_soell_cast
        CA + "-xama-attack.glb": "HitReact",
        CA + "-xama-death.glb":  "death",
    }),
]

# o Totem-Espoleta: sem walk (0 PP) e SEM O IDLE — o idle.glb veio sem
# animacao E sem armature, entao a malha dele nao tem pai e a regra do lixo
# a comeria (primeira rodada saiu 0 tris; relatorio no historico). A malha
# vem do hit.glb, que e skinned; a pose de descanso e o proprio bind pose,
# certo para um objeto fincado no chao.
INVOCACAO = ("fus_totem_espoleta", os.path.join(CA + " - xama", INVO), {
    CARD + "-xama-invocacao-hit.glb":    "attack",    # air_squat = coice do tiro; TAMBEM da a malha
    CARD + "-xama-invocacao-attack.glb": "HitReact",  # Hit_Reaction_1
    CARD + "-xama-invocacao-death.glb":  "death",     # Jump_to_Catch_and_Fall
})


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
    """Cada arquivo traz UMA acao; todos viram um personagem so."""
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


def exporta(chave):
    destino = os.path.join(TMP, chave + ".glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=destino, export_format="GLB",
                              use_selection=True, export_animations=True,
                              export_animation_mode="ACTIONS",
                              export_image_format="JPEG")
    return open(destino, "rb").read()


def main():
    if not os.path.isdir(TMP):
        os.makedirs(TMP)

    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - as QUATRO fusoes do Cacador e o Totem-Espoleta.",
        " *",
        " * 4 corpos de fusao (bruxo, curandeira, ladino, xama) com as seis",
        " * acoes, e a invocacao da dupla com o Xama: o totem-espingarda que",
        " * atira sozinho (fus-arrow-turret nos dados).",
        " *",
        " * O idle do totem e SINTETICO: o idle.glb veio sem animacao e sem",
        " * armature, entao o embutidor grava dois quadros parados no quadro",
        " * zero do ataque (ver tools/embute_fusoes_cacador.py). Sem isso o",
        " * autoActions cairia no primeiro clipe e o totem agacharia em loop.",
        " *",
        " * ATENCAO: em todas as pastas `attack.glb` guarda a REACAO e `hit.glb`",
        " * o ATAQUE. O mapa em tools/embute_fusoes_cacador.py corrige pelo",
        " * CONTEUDO. Nao inverta confiando no nome do arquivo.",
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
        if chave == "fus_totem_espoleta" and "idle" not in achadas:
            # IDLE SINTETICO: dois quadros iguais ao quadro zero do ataque —
            # a pose de descanso de um objeto fincado no chao. Nasce DEPOIS do
            # funde() porque ele apaga qualquer acao fora do mapa.
            # Blender 5.2 nao tem mais Action.fcurves (acoes em camadas);
            # o caminho robusto e por POSE: aplica o quadro 0 do ataque no
            # esqueleto, guarda a pose, e grava keyframes num action novo.
            src = bpy.data.actions.get("attack")
            arm = None
            for o in bpy.data.objects:
                if o.type == 'ARMATURE': arm = o; break
            if src and arm:
                if not arm.animation_data: arm.animation_data_create()
                arm.animation_data.action = src
                bpy.context.scene.frame_set(int(src.frame_range[0]))
                bpy.context.view_layer.update()
                poses = {}
                for pb in arm.pose.bones:
                    poses[pb.name] = (pb.location.copy(),
                                      pb.rotation_quaternion.copy(),
                                      pb.rotation_euler.copy(),
                                      pb.scale.copy())
                idle = bpy.data.actions.new("idle")
                idle.use_fake_user = True
                arm.animation_data.action = idle
                for pb in arm.pose.bones:
                    loc, rq, re_, sc = poses[pb.name]
                    pb.location, pb.scale = loc, sc
                    if pb.rotation_mode == 'QUATERNION': pb.rotation_quaternion = rq
                    else: pb.rotation_euler = re_
                for f in (0, 40):
                    for pb in arm.pose.bones:
                        pb.keyframe_insert('location', frame=f)
                        if pb.rotation_mode == 'QUATERNION':
                            pb.keyframe_insert('rotation_quaternion', frame=f)
                        else:
                            pb.keyframe_insert('rotation_euler', frame=f)
                        pb.keyframe_insert('scale', frame=f)
                achadas["idle"] = "idle"
                print("   idle sintetico: 2 quadros na pose do quadro 0 do ataque")
        ntex = reamostra()
        tris = 0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
        dados = exporta(chave)
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;"
                      % (chave, "['" + "','".join(sorted(achadas.keys())) + "']"))
        rel.append((chave, len(dados) / 1048576.0, tris, sorted(achadas.keys()), perdidas))

    with io_open(SAIDA, linhas):
        pass

    print("\n================= RELATORIO =================")
    for chave, mb, tris, acoes, perdidas in rel:
        print("%-28s %6.2f MB  %6d tris  %s%s" % (
            chave, mb, tris, ",".join(acoes),
            ("  FALTOU: " + "; ".join(perdidas)) if perdidas else ""))
    print("saida:", SAIDA)


def io_open(caminho, linhas):
    import io as _io
    f = _io.open(caminho, "w", encoding="utf-8", newline="\n")
    f.write("\n".join(linhas) + "\n")
    f.close()
    class _Nulo:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    return _Nulo()


main()
