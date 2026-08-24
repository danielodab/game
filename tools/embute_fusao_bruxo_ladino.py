# -*- coding: utf-8 -*-
"""Traz a fusao do Bruxo com o Ladino. Com ela, 18 das 21 tem corpo proprio.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_fusao_bruxo_ladino.py

Restam APENAS as tres do Xama (bruxo, ladino, curandeira) — todas com
invocacao propria por criar.

UM NOME TORTO, POR EXTENSO: a pasta e "mago ladino", os arquivos sao
bruxo-ladino-*.glb... menos o run, que se chama `bruxo-mago-run.glb`.

O EMBARALHAMENTO DO MESHY, PELA SETIMA VEZ: attack.glb = Slap_Reaction
(reacao), hit.glb = mage_soell_cast_4 (ataque). Cabecalhos lidos antes.
"""
import bpy, os, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\bruxo"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-fusao-bruxo-ladino.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_fus_bl")
TEX_ALVO = 1024

CORPOS = [
    ("fus_bruxo_espadachim", "mago ladino", {
        "bruxo-ladino-idle.glb":   "idle",
        "bruxo-ladino-walk.glb":   "walk",
        "bruxo-mago-run.glb":      "run",         # o nome torto: "mago" no run
        "bruxo-ladino-hit.glb":    "attack",      # mage_soell_cast_4
        "bruxo-ladino-attack.glb": "HitReact",    # Slap_Reaction
        "bruxo-ladino-death.glb":  "death",
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
        "/* SOTERRA 3.0 - a fusao do Bruxo com o Ladino (18 de 21).",
        " * ATENCAO: attack.glb = REACAO, hit.glb = ATAQUE (setima vez). O run",
        " * veio com nome torto (bruxo-mago-run.glb) — mapa pelo CONTEUDO em",
        " * tools/embute_fusao_bruxo_ladino.py. */",
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
        reamostra()
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
        print("%-24s %6.2f MB  %6d tris  %s%s" % (
            chave, mb, tris, ",".join(acoes),
            ("  FALTOU: " + "; ".join(perdidas)) if perdidas else ""))
    print("saida:", SAIDA)


main()
