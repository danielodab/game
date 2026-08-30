# -*- coding: utf-8 -*-
"""As TRES fusoes do Xama (bruxo, curandeiro, ladino) + as TRES invocacoes
delas (Efigie Runica, Guarda-Flor, Gemeo de Breu). Com estas, as 21 duplas
tem corpo proprio — o quadro de fusoes FECHA.

Rodar:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background \\
      --factory-startup --python tools/embute_fusoes_xama.py

OS NOMES TORTOS, POR EXTENSO (a tradicao rendeu quatro):
    xam-bruxo-death.glb        (faltou o 'a' do xama)
    xala-ladino-hit.glb        (xala)
    "xama -ladino death.glb"   (espaco antes do hifen)
    "xama-ladino- walk.glb"    (espaco depois do hifen)
    "O gemeu do breu death.glb" (gemeu, com maiuscula)

O EMBARALHAMENTO DO MESHY, PELA SETIMA VEZ
------------------------------------------
`attack.glb` = `Slap_Reaction` (a reacao) em TODOS os seis kits;
o ataque de verdade mora no `hit.glb` (mage_soell_cast_*, Double/Triple
_Combo_Attack). Cabecalhos JSON lidos antes do mapa (raio_x_xama.py).

O KIT DO RATO FICA DE FORA: a pasta 'xama - curandeiro' tem DOIS corpos —
o 'jardim sagrado' (a anciã do cajado com a semente, a imagem APROVADA na
conversa) e um 'xama-curandeira-*' que e um RATO mistico de livro runico,
que nao corresponde a nada combinado (e cujo hit tem um cast de 11,4s).
Entra a anciã; o rato espera o dono dizer o que e.

GUARDA-FLOR SO TEM 3 ACOES (idle/attack/hit) DE PROPOSITO: invocacao
plantada nao anda — o mesmo contrato do Totem-Espoleta.
"""
import bpy, os, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\xama"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "models-fusoes-xama.js")
TMP = os.path.join(os.environ.get("TEMP", "."), "soterra_fus_xama")
TEX_ALVO = 1024

# corpo -> (pasta, {arquivo: papel})
CORPOS = [
    ("fus_bruxo_invocador", "xama - bruxo", {
        "xama-bruxo-idle.glb":   "idle",
        "xama-bruxo-walk.glb":   "walk",
        "xama-bruxo-run.glb":    "run",
        "xama-bruxo-hit.glb":    "attack",     # mage_soell_cast_7
        "xama-bruxo-attack.glb": "HitReact",   # Slap_Reaction
        "xam-bruxo-death.glb":   "death",      # TORTO: faltou o 'a'
    }),
    ("fus_efigie_runica", os.path.join("xama - bruxo", "a Efígie Rúnica"), {
        "a Efígie Rúnica idle.glb":   "idle",
        "a Efígie Rúnica walk.glb":   "walk",
        "a Efígie Rúnica run.glb":    "run",
        "a Efígie Rúnica hit.glb":    "attack",     # mage_soell_cast_7
        "a Efígie Rúnica attack.glb": "HitReact",   # Slap_Reaction
        "a Efígie Rúnica death.glb":  "death",
    }),
    ("fus_curandeiro_invocador", os.path.join("xama - curandeiro", "jardim sagrado"), {
        "jardim sagrado idle.glb":   "idle",
        "jardim sagrado walk.glb":   "walk",
        "jardim sagrado run.glb":    "run",
        "jardim sagrado hit.glb":    "attack",     # mage_soell_cast
        "jardim sagrado attack.glb": "HitReact",   # Slap_Reaction
        "jardim sagrado death.glb":  "death",
    }),
    ("fus_guarda_flor",
     os.path.join("xama - curandeiro", "jardim sagrado", "guarda-flor"), {
        "guarda flor idle.glb":   "idle",
        "guarda flor hit.glb":    "attack",     # mage_soell_cast_3
        "guarda flor attack.glb": "HitReact",   # Slap_Reaction
    }),
    ("fus_espadachim_invocador", "xama - ladino", {
        "xama-ladino-idle.glb":    "idle",
        "xama-ladino- walk.glb":   "walk",       # TORTO: espaco depois do hifen
        "xama-ladino-run.glb":     "run",
        "xala-ladino-hit.glb":     "attack",     # Double_Combo_Attack; TORTO: xala
        "xama-ladino-attack.glb":  "HitReact",   # Slap_Reaction
        "xama -ladino death.glb":  "death",      # TORTO: espaco antes do hifen
    }),
    ("fus_gemeo_breu", os.path.join("xama - ladino", "O gemeo de breu"), {
        "o gemeo do breu idle.glb":   "idle",
        "o gemeo do breu walk.glb":   "walk",
        "o gemeo do breu run.glb":    "run",
        "o gemeo do breu hit.glb":    "attack",   # Triple_Combo_Attack
        "o gemeo do breu attack.glb": "HitReact", # Slap_Reaction
        "O gemeu do breu death.glb":  "death",    # TORTO: gemeu, maiuscula
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
        "/* SOTERRA 3.0 - as TRES fusoes do Xama + as TRES invocacoes delas.",
        " * Com estas, as 21 duplas tem corpo proprio: o quadro FECHA.",
        " *",
        " * ATENCAO: `attack.glb` guardava a REACAO e `hit.glb` o ATAQUE",
        " * (setima vez). O mapa em tools/embute_fusoes_xama.py corrige pelo",
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
