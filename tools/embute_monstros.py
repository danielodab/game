# -*- coding: utf-8 -*-
"""O EMBUTIDOR GENÉRICO DE MONSTROS (10/09) — um só para todos os lotes.

Os lotes da Estufa e da Cisterna entraram por scripts próprios
(embute_monstros_jardim.py, embute_monstros_cisterna.py), cada um com a
lista dos bichos escrita à mão. Os quatro portais fechados (Fecho de Brasa,
Andaimes do Vento, Mina Trêmula, Coração Partido) vão chegar do mesmo
jeito — então o caminho virou ferramenta, dirigida por um MANIFESTO por
calabouço em tools/monstros/<calabouco>.json.

PASSO A PASSO (o mesmo dos lotes anteriores, agora sem copiar script):

  1. python tools/embute_monstros.py --calabouco emberlock --manifesto
       escreve tools/monstros/emberlock.json com TODOS os monstros daquele
       calabouço (lidos de js/core/data/monsters.js), cada um esperando uma
       pasta com o nome do bicho e seis arquivos "<prefixo> <papel>.glb".

  2. Ponha os GLBs do Meshy em
       C:\\Users\\danie\\Downloads\\assets_ok\\mapa\\<Nome do calabouço>\\monstros\\<Nome do monstro>\\
     com os nomes "<Nome do monstro> idle.glb", "... walk.glb", "... run.glb",
     "... attack.glb", "... hit.glb", "... death.glb". Se a pasta ou o prefixo
     tiverem outro nome, edite o manifesto (campos "pasta" e "prefixo").

  3. "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background
       --factory-startup --python tools/embute_monstros.py -- --calabouco emberlock --raio-x
       lê cada GLB e imprime as ações, o porte e as texturas — e DIZ qual
       arquivo guarda a reação (Slap_Reaction) e qual guarda o ataque de
       verdade. Nos DEZ lotes até hoje o Meshy trocou: attack.glb = reação,
       hit.glb = ataque. O raio-X grava a decisão no manifesto ("mapa").

  4. o mesmo comando sem --raio-x FUNDE os clipes de cada bicho num kit só
     (textura 1024, JPEG, lixo "Icosphere" removido) e escreve
     assets/embedded/models-meshy-<calabouco>.js com JOGO.MODELS[id] e
     JOGO.MESHY_CLIPS[id]. Depois:
       - index.html: acrescente 'assets/embedded/models-meshy-<calabouco>.js'
         na lista dos modelos (ao lado de models-meshy-cisterna.js);
       - python tools/reduz_texturas.py  (relevo e brilho a 512, a cor fica
         em 1024 — o Python do Blender nao tem Pillow, entao e passo a parte);
       - python tools/extrai_assets.py   (o bundle servido);
       - abra tests/bestiario.html?calabouco=<calabouco> — ele cobra kit
         próprio, clipe por papel e porte de cada monstro;
       - acerte o porte em models3d_v2.js MONSTER_LOOK (scale), se preciso —
         sem linha lá o kit veste sozinho em escala 1;
       - abra o portal: tire o id de JOGO.DATA.portaisFechados (dungeons.js).

Nenhum passo depende de o script saber o nome dos bichos de antemão.
"""
import os, sys, io, json, re, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_OK = r"C:\Users\danie\Downloads\assets_ok\mapa"
PASTA_MANIFESTOS = os.path.join(RAIZ, "tools", "monstros")
TEX_ALVO = 1024
PAPEIS = ["idle", "walk", "run", "attack", "hit", "death"]

NOMES_CALABOUCO = {
    "greenhouse": "A Estufa Soterrada", "cistern": "A Corte Afogada",
    "emberlock": "O Fecho de Brasa", "windscaffold": "Andaimes do vento",
    "quakemine": "Mina Tremula", "brokenheart": "O Coração partido",
}


def argumentos():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = {"calabouco": None, "manifesto": False, "raio_x": False}
    i = 0
    while i < len(argv):
        if argv[i] == "--calabouco": out["calabouco"] = argv[i + 1]; i += 2
        elif argv[i] == "--manifesto": out["manifesto"] = True; i += 1
        elif argv[i] == "--raio-x": out["raio_x"] = True; i += 1
        else: i += 1
    if not out["calabouco"]:
        print("uso: --calabouco <id> [--manifesto | --raio-x]"); sys.exit(2)
    return out


def caminho_manifesto(cal):
    return os.path.join(PASTA_MANIFESTOS, cal + ".json")


def monstros_do_calabouco(cal):
    """Lê js/core/data/monsters.js: id, name, boss, dungeonId — sem executar JS."""
    txt = io.open(os.path.join(RAIZ, "js", "core", "data", "monsters.js"), encoding="utf-8").read()
    fora = []
    # o catálogo é addMonsters({ 'id': { name: '…', …, dungeonId: '…', …, boss: true } })
    padrao = re.compile(r"'([a-z0-9-]+)':\s*\{\s*name:\s*'([^']*)'")
    achados = list(padrao.finditer(txt))
    for k, m in enumerate(achados):
        mid, nome = m.group(1), m.group(2)
        fim = achados[k + 1].start() if k + 1 < len(achados) else len(txt)
        bloco = txt[m.end(): fim]
        dg = re.search(r"dungeonId:\s*'([a-z]+)'", bloco)
        if not dg or dg.group(1) != cal:
            continue
        boss = bool(re.search(r"boss:\s*true", bloco))
        fora.append({"id": mid, "nome": nome, "boss": boss})
    return fora


def escreve_manifesto(cal):
    lista = monstros_do_calabouco(cal)
    if not lista:
        print("nenhum monstro com dungeonId", cal, "em monsters.js"); sys.exit(1)
    if not os.path.isdir(PASTA_MANIFESTOS):
        os.makedirs(PASTA_MANIFESTOS)
    man = {
        "calabouco": cal,
        "origem": os.path.join(ASSETS_OK, NOMES_CALABOUCO.get(cal, cal), "monstros"),
        "saida": "assets/embedded/models-meshy-%s.js" % cal,
        "monstros": [
            {"id": m["id"], "nome": m["nome"], "boss": m["boss"],
             "pasta": m["nome"], "prefixo": m["nome"],
             # o mapa nasce "pelo nome"; o raio-X corrige pelo conteúdo
             "mapa": {"idle": "idle", "walk": "walk", "run": "run",
                      "attack": "attack", "hit": "hit", "death": "death"}}
            for m in lista
        ],
    }
    io.open(caminho_manifesto(cal), "w", encoding="utf-8", newline="\n").write(
        json.dumps(man, ensure_ascii=False, indent=2) + "\n")
    print("manifesto:", caminho_manifesto(cal), "·", len(lista), "monstros")
    for m in lista:
        print("   %-18s %s%s" % (m["id"], m["nome"], "  (chefe)" if m["boss"] else ""))


def le_manifesto(cal):
    cam = caminho_manifesto(cal)
    if not os.path.exists(cam):
        print("sem manifesto — rode antes: --calabouco", cal, "--manifesto"); sys.exit(1)
    return json.load(io.open(cam, encoding="utf-8"))


# ------------------------------------------------------------ a parte Blender
def dentro_do_blender():
    try:
        import bpy  # noqa
        return True
    except Exception:
        return False


def arquivo_de(pasta, prefixo, papel_arquivo):
    return os.path.join(pasta, "%s %s.glb" % (prefixo, papel_arquivo))


def raio_x(man):
    import bpy
    base = man["origem"]
    for mo in man["monstros"]:
        pasta = os.path.join(base, mo["pasta"])
        print("\n=== %s (%s)%s" % (mo["nome"], mo["id"], "  CHEFE" if mo.get("boss") else ""))
        if not os.path.isdir(pasta):
            print("   FALTA A PASTA:", pasta); continue
        decisao = {}
        for papel in PAPEIS:
            cam = arquivo_de(pasta, mo["prefixo"], papel)
            if not os.path.exists(cam):
                print("   %-8s FALTA %s" % (papel, os.path.basename(cam))); continue
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=cam)
            acoes = [a.name for a in bpy.data.actions]
            alt = 0.0
            for o in bpy.data.objects:
                if o.type == 'MESH' and o.parent is not None:
                    alt = max(alt, o.dimensions.z)
            tex = ["%dx%d" % (i.size[0], i.size[1]) for i in bpy.data.images]
            print("   %-8s %-44s %.2f m  tex %s" % (papel, ",".join(acoes) or "(sem ação)", alt, ",".join(tex)))
            # a decisão pelo CONTEÚDO: "Reaction" é reação; o resto é o que o nome diz
            nome_acao = (acoes[0] if acoes else "")
            if papel in ("attack", "hit"):
                decisao[papel] = "HitReact" if re.search(r"react", nome_acao, re.I) else "attack"
        # attack.glb com Slap_Reaction e hit.glb com o golpe: o mapa troca
        if decisao.get("attack") == "HitReact" and decisao.get("hit") == "attack":
            mo["mapa"]["attack"] = "HitReact"; mo["mapa"]["hit"] = "attack"
            print("   → EMBARALHADO (como nos lotes anteriores): attack.glb = reação, hit.glb = ataque. Mapa corrigido.")
        elif decisao.get("attack") == "attack" and decisao.get("hit") == "HitReact":
            mo["mapa"]["attack"] = "attack"; mo["mapa"]["hit"] = "HitReact"
            print("   → nomes certos: attack.glb = ataque, hit.glb = reação.")
        elif decisao:
            print("   → ATENÇÃO: os dois arquivos parecem ser %s — confira à mão." % decisao)
    io.open(caminho_manifesto(man["calabouco"]), "w", encoding="utf-8", newline="\n").write(
        json.dumps(man, ensure_ascii=False, indent=2) + "\n")
    print("\nmanifesto atualizado com o mapa decidido pelo conteúdo.")


def limpa_lixo():
    import bpy
    fora = []
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            fora.append(o.name); bpy.data.objects.remove(o, do_unlink=True)
    if fora: print("   lixo removido:", ", ".join(fora))


def reamostra():
    import bpy
    n = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO); img.pack(); n += 1
    return n


def funde(pasta, prefixo, mapa):
    """Importa os seis GLBs, guarda uma ação por PAPEL (renomeada pelo papel),
    mantém a malha do primeiro e apaga as repetidas — o mesmo funil dos lotes."""
    import bpy
    achadas, perdidas = {}, []
    for i, (arquivo_papel, papel) in enumerate(mapa.items()):
        cam = arquivo_de(pasta, prefixo, arquivo_papel)
        if not os.path.exists(cam):
            perdidas.append(os.path.basename(cam)); continue
        antes_obj = set(o.name for o in bpy.data.objects)
        antes_act = set(a.name for a in bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=cam)
        novos_obj = [o for o in bpy.data.objects if o.name not in antes_obj]
        novas_act = [a for a in bpy.data.actions if a.name not in antes_act]
        if not novas_act:
            perdidas.append(os.path.basename(cam) + " (sem ação)")
        else:
            act = novas_act[0]; act.name = "papel_" + papel; act.use_fake_user = True
            achadas[papel] = act.name
            for extra in novas_act[1:]: bpy.data.actions.remove(extra)
        if i == 0: limpa_lixo()
        else:
            for o in novos_obj:
                try: bpy.data.objects.remove(o, do_unlink=True)
                except Exception: pass
    for a in bpy.data.actions:
        if a.name.startswith("papel_"): a.name = a.name[len("papel_"):]
    for a in list(bpy.data.actions):
        if a.name not in mapa.values(): bpy.data.actions.remove(a)
    for _ in range(3):
        try: bpy.ops.outliner.orphans_purge(do_recursive=True)
        except Exception: break
    return achadas, perdidas


def embute(man):
    import bpy
    cal = man["calabouco"]
    tmp = os.path.join(os.environ.get("TEMP", "."), "soterra_" + cal)
    if not os.path.isdir(tmp): os.makedirs(tmp)
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - os monstros de %s, arte do usuario (Meshy)." % NOMES_CALABOUCO.get(cal, cal),
        " * Fundidos por tools/embute_monstros.py a partir de tools/monstros/%s.json;" % cal,
        " * o mapa attack/hit foi decidido pelo CONTEUDO (raio-X), nunca pelo nome. */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
    ]
    rel = []
    for mo in man["monstros"]:
        pasta = os.path.join(man["origem"], mo["pasta"])
        if not os.path.isdir(pasta):
            rel.append((mo["id"], 0, 0, 0, [], ["PASTA INTEIRA"])); continue
        print("\n--- %s (%s)" % (mo["nome"], mo["id"]))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        achadas, perdidas = funde(pasta, mo["prefixo"], mo["mapa"])
        reamostra()
        tris, alt = 0, 0.0
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
                alt = max(alt, o.dimensions.z)
        cam = os.path.join(tmp, mo["id"] + ".glb")
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=cam, export_format="GLB", use_selection=True,
                                  export_animations=True, export_animation_mode="ACTIONS",
                                  export_image_format="JPEG")
        dados = open(cam, "rb").read()
        linhas.append("JOGO.MODELS['%s']='%s';" % (mo["id"], base64.b64encode(dados).decode("ascii")))
        linhas.append("JOGO.MESHY_CLIPS['%s']=%s;" % (mo["id"], json.dumps(sorted(achadas.keys()))))
        rel.append((mo["id"], len(dados) / 1048576.0, tris, alt, sorted(achadas.keys()), perdidas))
    saida = os.path.join(RAIZ, man["saida"].replace("/", os.sep))
    io.open(saida, "w", encoding="utf-8", newline="\n").write("\n".join(linhas) + "\n")
    print("\n================= RELATORIO =================")
    for mid, mb, tris, alt, acoes, perdidas in rel:
        print("%-18s %6.2f MB  %6d tris  %.2f m  %s%s" % (
            mid, mb, tris, alt, ",".join(acoes), ("  FALTOU: " + "; ".join(perdidas)) if perdidas else ""))
    print("saida:", saida)
    print("\nAGORA: index.html (models-meshy-%s.js), tools/reduz_texturas.py, tools/extrai_assets.py, "
          "tests/bestiario.html?calabouco=%s" % (cal, cal))


def main():
    a = argumentos()
    if a["manifesto"]:
        escreve_manifesto(a["calabouco"]); return
    man = le_manifesto(a["calabouco"])
    if not dentro_do_blender():
        print("este passo roda DENTRO do Blender:\n"
              '  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background '
              "--factory-startup --python tools/embute_monstros.py -- --calabouco %s%s"
              % (a["calabouco"], " --raio-x" if a["raio_x"] else ""))
        sys.exit(2)
    if a["raio_x"]: raio_x(man)
    else: embute(man)


main()
