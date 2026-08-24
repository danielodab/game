# -*- coding: utf-8 -*-
"""Traz as DUAS fusoes da Curandeira: com a Bruxa e com a Ladina.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_fusoes_curandeira.py

O LOTE: 2 corpos, seis acoes cada, sem invocacao e sem escudo. Com estes,
17 das 21 duplas tem corpo proprio — restam bruxo+ladino, bruxo+xama,
ladino+xama e curandeira+xama (compostas por enquanto).

UM NOME TORTO, TRATADO POR EXTENSO
----------------------------------
    pasta "curandeira - bruxa"  com arquivos  curandeira-bruxo-*.glb
    (a pasta fala dela, os arquivos falam dele — entram os DOIS literais)

O EMBARALHAMENTO DO MESHY, PELA SEXTA VEZ
-----------------------------------------
`attack.glb` = `Slap_Reaction` (a reacao); `hit.glb` = `mage_soell_cast_4`
(o ataque de verdade), nas duas pastas. Cabecalhos JSON lidos antes do mapa.
"""
import bpy, os, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\curandeira"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-fusoes-curandeira.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_fus_cur")
TEX_ALVO = 1024

# corpo -> (pasta, {arquivo: papel})
CORPOS = [
    # pasta diz BRUXA, arquivos dizem BRUXO — os dois literais, sem regex
    ("fus_bruxo_curandeiro", "curandeira - bruxa", {
        "curandeira-bruxo-idle.glb":   "idle",
        "curandeira-bruxo-walk.glb":   "walk",
        "curandeira-bruxo-run.glb":    "run",
        "curandeira-bruxo-hit.glb":    "attack",     # mage_soell_cast_4
        "curandeira-bruxo-attack.glb": "HitReact",   # Slap_Reaction
        "curandeira-bruxo-death.glb":  "death",
    }),
    ("fus_curandeiro_espadachim", "curandeira - ladina", {
        "curandeira-ladina-idle.glb":   "idle",
        "curandeira-ladina-walk.glb":   "walk",
        "curandeira-ladina-run.glb":    "run",
        "curandeira-ladina-hit.glb":    "attack",     # mage_soell_cast_4
        "curandeira-ladina-attack.glb": "HitReact",   # Slap_Reaction
        "curandeira-ladina-death.glb":  "death",
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
        "/* SOTERRA 3.0 - as DUAS fusoes da Curandeira (bruxa e ladina).",
        " *",
        " * Com estas, 17 das 21 duplas tem corpo proprio do usuario.",
        " *",
        " * ATENCAO: `attack.glb` guarda a REACAO e `hit.glb` o ATAQUE (sexta",
        " * vez). O mapa em tools/embute_fusoes_curandeira.py corrige pelo",
        " * CONTEUDO. Nao inverta confiando no nome do arquivo.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]

    rel = []
    for chave, sub, mapa in CORPOS:
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
        dados = exporta(chave)
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode("ascii")))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;"
                      % (chave, "['" + "','".join(sorted(achadas.keys())) + "']"))
        rel.append((chave, len(dados) / 1048576.0, tris, sorted(achadas.keys()), perdidas))

    import io as _io
    f = _io.open(SAIDA, "w", encoding="utf-8", newline="\n")
    f.write("\n".join(linhas) + "\n")
    f.close()

    print("\n================= RELATORIO =================")
    for chave, mb, tris, acoes, perdidas in rel:
        print("%-28s %6.2f MB  %6d tris  %s%s" % (
            chave, mb, tris, ",".join(acoes),
            ("  FALTOU: " + "; ".join(perdidas)) if perdidas else ""))
    print("saida:", SAIDA)


main()
