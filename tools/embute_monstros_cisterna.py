# -*- coding: utf-8 -*-
"""Traz os NOVE da CORTE AFOGADA (a Cisterna), feitos pelo Daniel no Meshy —
a Baronesa Salmoura inclusa. Substituem os esqueletos emprestados do KayKit
que vestiam a familia inteira (FAMILY_LOOK 'Corte Afogada').

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_monstros_cisterna.py

O EMBARALHAMENTO, PELA OITAVA VEZ — CONFERIDO NO CABECALHO
----------------------------------------------------------
Nos NOVE, `attack.glb` guarda `Slap_Reaction` (reacao) e o ataque de verdade
mora no `hit.glb` (casts, combos, Axe_Spin, Basic_Jump, air_squat da
Baronesa). Mapa feito pelo CONTEUDO (raio_x_cisterna.py), nunca pelo nome.

AS TORTUOSIDADES DESTE LOTE, POR EXTENSO
----------------------------------------
  * pasta "Salmourão", arquivos "salmorão *.glb" (prefixo proprio);
  * Caranguejo veio SEM "attack.glb": a reacao esta no arquivo cru
    "Meshy_AI_Animation_Slap_Reaction_withSkin.glb" (nome literal no mapa).

DESTA VEZ VEIO `run` — os nove com corrida propria, entra.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\A Corte Afogada\monstros"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-meshy-cisterna.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_cisterna")
TEX_ALVO = 1024

# id -> (pasta, prefixo dos arquivos, {sufixo OU nome-literal.glb: papel})
MONSTROS = [
    ("drowned-porter", "Afogadiço", "Afogadiço", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # mage_soell_cast_7: a mordida que bebe calor
        "attack": "HitReact",   # Slap_Reaction
        "death": "death",
    }),
    ("moray-piper", "Moreia-Flauta", "Moreia-Flauta", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # mage_soell_cast: o jato assobiado
        "attack": "HitReact",
        "death": "death",
    }),
    ("lantern-jelly", "Água-Viva-Lustre", "Água-Viva-Lustre", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # mage_soell_cast_5 (11,4s — o pulso de luz)
        "attack": "HitReact",
        "death": "death",
    }),
    ("brine-golem", "Salmourão", "salmorão", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # Punch_Combo: o soco de sal
        "attack": "HitReact",
        "death": "death",       # Jump_to_Catch_and_Fall
    }),
    ("fat-drop", "Gota-Gorda", "Gota-Gorda", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # Axe_Spin_Attack: o peso girando
        "attack": "HitReact",
        "death": "death",
    }),
    ("droplet", "Gotinha", "Gotinha", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # Axe_Spin_Attack, versao miuda
        "attack": "HitReact",
        "death": "death",       # Shot_and_Fall_Forward
    }),
    ("sump-crab", "Caranguejo de Sumidouro", "Caranguejo de Sumidouro", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # Basic_Jump: ele PULA com a pinça
        "Meshy_AI_Animation_Slap_Reaction_withSkin.glb": "HitReact",  # cru
        "death": "death",
    }),
    ("mist-warbler", "Cantarola-de-Névoa", "Cantarola-de-Névoa", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # Double_Combo_Attack: o sopro em dois tempos
        "attack": "HitReact",
        "death": "death",
    }),
    ("boss-baroness", "Baronesa Salmoura", "Baronesa Salmoura", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # air_squat: o vestido AFUNDA antes do gole
        "attack": "HitReact",
        "death": "death",       # Fall_Dead_from_Abdominal_Injury
    }),
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


def funde(pasta, prefixo, mapa):
    achadas, perdidas = {}, []
    for i, (chave, papel) in enumerate(mapa.items()):
        arquivo = chave if chave.lower().endswith(".glb") else "%s %s.glb" % (prefixo, chave)
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


def main():
    if not os.path.isdir(TMP):
        os.makedirs(TMP)
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - os NOVE da Corte Afogada (Cisterna), com a Baronesa.",
        " * Substituem os esqueletos emprestados; estes SAO as criaturas.",
        " *",
        " * ATENCAO: `attack.glb` guarda a REACAO e `hit.glb` o ATAQUE (oitava",
        " * vez). O mapa em tools/embute_monstros_cisterna.py corrige pelo",
        " * CONTEUDO. Nao inverta confiando no nome do arquivo.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]
    rel = []
    for chave, pasta, prefixo, mapa in MONSTROS:
        base = os.path.join(ORIG, pasta)
        if not os.path.isdir(base):
            print("FALTA A PASTA:", base); continue
        print("\n--- %s (%s)" % (pasta, chave))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        achadas, perdidas = funde(base, prefixo, mapa)
        ntex = reamostra()
        tris = 0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
        dados_cam = os.path.join(TMP, chave + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=dados_cam, export_format="GLB",
                                  use_selection=True, export_animations=True,
                                  export_animation_mode="ACTIONS",
                                  export_image_format="JPEG")
        dados = open(dados_cam, "rb").read()
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;"
                      % (chave, "['" + "','".join(sorted(achadas.keys())) + "']"))
        rel.append((chave, len(dados) / 1048576.0, tris, sorted(achadas.keys()), perdidas))

    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas) + "\n")

    print("\n================= RELATORIO =================")
    for chave, mb, tris, acoes, perdidas in rel:
        print("%-18s %6.2f MB  %6d tris  %s%s" % (
            chave, mb, tris, ",".join(acoes),
            ("  FALTOU: " + "; ".join(perdidas)) if perdidas else ""))
    print("saida:", SAIDA)


main()
