# -*- coding: utf-8 -*-
"""Traz o CAVALEIRO NEGRO do Daniel (Meshy) — o corpo do Mestre do Fundo,
a classe `gm` que so existe com a chave do dono (js/core/gm.js). Ate aqui
o Mestre andava com um esqueleto emprestado.

Rodar:
  "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background \
      --factory-startup --python tools/embute_gm.py

O EMBARALHAMENTO, PELA DECIMA VEZ — CONFERIDO NO CABECALHO
----------------------------------------------------------
`GM attack.glb` guarda `Slap_Reaction` (a reacao) e o ataque de verdade
mora em `GM hit.glb` (`mage_soell_cast_6`, 2,3 s — o gesto de quem fecha o
livro; casa com o Julgamento). Mapa pelo CONTEUDO (raio_x_gm no
scratchpad), nunca pelo nome.

AS TORTUOSIDADES DESTE LOTE
---------------------------
  * cada arquivo pesa 66 MB: e UMA textura de 8192x8192. Reamostra a 1024.
  * cada arquivo traz uma `Icosphere` solta (sem pai) — lixo do Meshy,
    removida pelo limpa_lixo (malha sem pai depois do primeiro arquivo).
  * o corpo mede 1,67 m cru; a escala fica no CLASS_LOOK (models3d_v2).
"""
import bpy, os, base64, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\GM"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-gm.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_gm")
TEX_ALVO = 1024

# id do modelo -> (pasta, prefixo dos arquivos, {sufixo: papel})
KITS = [
    ("meshy_gm", ORIG, "GM", {
        "idle": "idle", "walk": "walk", "run": "run",
        "hit": "attack",        # mage_soell_cast_6: o fechar do livro
        "attack": "HitReact",   # Slap_Reaction
        "death": "death",       # falling_down
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
        "/* SOTERRA 3.0 - o CAVALEIRO NEGRO, corpo do Mestre do Fundo (classe",
        " * `gm`, so com a chave do dono). Arte do usuario, Meshy (03/09).",
        " *",
        " * ATENCAO: `attack.glb` guarda a REACAO e `hit.glb` o ATAQUE (decima",
        " * vez). O mapa em tools/embute_gm.py corrige pelo CONTEUDO.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]
    rel = []
    for chave, base, prefixo, mapa in KITS:
        if not os.path.isdir(base):
            print("FALTA A PASTA:", base); continue
        print("\n--- %s (%s)" % (base, chave))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        achadas, perdidas = funde(base, prefixo, mapa)
        ntex = reamostra()
        tris = 0
        alt = 0.0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
                alt = max(alt, o.dimensions.z)
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
        rel.append((chave, len(dados) / 1048576.0, tris, alt, ntex, sorted(achadas.keys()), perdidas))

    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas) + "\n")

    print("\n================= RELATORIO =================")
    for chave, mb, tris, alt, ntex, acoes, perdidas in rel:
        print("%-12s %6.2f MB  %6d tris  %.2f m  %d tex reamostrada(s)  %s%s" % (
            chave, mb, tris, alt, ntex, ",".join(acoes),
            ("  FALTOU: " + "; ".join(perdidas)) if perdidas else ""))
    print("saida:", SAIDA)


main()
