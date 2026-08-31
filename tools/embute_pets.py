# -*- coding: utf-8 -*-
"""Traz os SEIS PETS do Daniel (Meshy) — e aposenta os bichos emprestados
do Quaternius que faziam as vezes deles (velociraptor, cobra, vespa...).

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_pets.py

O EMBARALHAMENTO, PELA NONA VEZ — CONFERIDO NO CABEÇALHO
--------------------------------------------------------
Nos seis, `attack.glb` guarda `Slap_Reaction` (reação) e o ataque de
verdade mora no `hit.glb` (Double_Combo, casts, Sword_Judgment,
Basic_Jump). Mapa pelo CONTEÚDO (rx_pets no scratchpad), nunca pelo nome.

AS TORTUOSIDADES DESTE LOTE
---------------------------
  * Rasga-Ar: o arquivo do hit chama "raga-ar hit.glb" (typo no prefixo)
    E o conteúdo é `Idle_03` — o ATAQUE dele NÃO VEIO. Entra sem clipe
    de ataque (exceção nomeada no teste, como o Seiveiro) até o Daniel
    re-exportar.
  * Sem `run` — de propósito: pet anda pouco e perto do dono.
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\pets"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-pets.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_pets")
TEX_ALVO = 1024

# id do jogo -> (pasta, prefixo dos arquivos, {sufixo OU nome-literal: papel})
PETS = [
    ("pet-emberling", "Brasinha", "brasinha", {
        "idle": "idle", "walk": "walk",
        "hit": "attack",        # mage_soell_cast_3: o bafo de brasa
        "attack": "HitReact",   # Slap_Reaction
        "death": "death",
    }),
    ("pet-snapvine", "Bocarra", "bocarra", {
        "idle": "idle", "walk": "walk",
        "hit": "attack",        # Double_Combo_Attack: a bocada
        "attack": "HitReact",
        "death": "death",       # Electrocuted_Fall: a murchada dramática
    }),
    ("pet-galehawk", "Rasga-Ar", "rasga-ar", {
        "idle": "idle", "walk": "walk",
        # o ataque NÃO veio ("raga-ar hit.glb" = Idle_03) — fica de fora
        "attack": "HitReact",
        "death": "death",
    }),
    ("pet-dewling", "Borbulha", "borbulha", {
        "idle": "idle", "walk": "walk",
        "hit": "attack",        # mage_soell_cast_6: o borrifo
        "attack": "HitReact",
        "death": "death",       # Strangled_and_Fall: o despejo (9,4s!)
    }),
    ("pet-lodestone", "Pedrinha Guia", "Pedrinha Guia", {
        "idle": "idle", "walk": "walk",
        "hit": "attack",        # Basic_Jump: bate as patinhas e pulsa
        "attack": "HitReact",
        "death": "death",
    }),
    ("pet-heartshard", "Caco Vivo", "Caco Vivo", {
        "idle": "idle", "walk": "walk",
        "hit": "attack",        # Sword_Judgment: as lasquinhas disparam
        "attack": "HitReact",
        "death": "death",
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
        "/* SOTERRA 3.0 - os SEIS PETS, arte do usuário (31/08). Aposentam os",
        " * bichos emprestados do Quaternius que faziam as vezes deles.",
        " *",
        " * ATENCAO: `attack.glb` guarda a REACAO e `hit.glb` o ATAQUE (nona",
        " * vez). O Rasga-Ar veio SEM ataque (o hit dele era Idle_03) — falta",
        " * conhecida ate o re-export.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]
    rel = []
    for chave, pasta, prefixo, mapa in PETS:
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
        cam = os.path.join(TMP, chave + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=cam, export_format="GLB",
                                  use_selection=True, export_animations=True,
                                  export_animation_mode="ACTIONS",
                                  export_image_format="JPEG")
        dados = open(cam, "rb").read()
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
