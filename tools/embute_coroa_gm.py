# -*- coding: utf-8 -*-
"""A COROA DO MESTRE (08/10 à noite) — a arte do dono, embutida ao lado das dez do ranking.

O dono: "fiz a arte da coroa do GM que deve ser liberada somente para ele.. e o brilho no
meio deve ser vermelho. implante no jogo". O .glb cru pesa 8,6 MB: três texturas JPEG de
2048×2048 (7,5 MB) e 26 mil triângulos (1,3 MB). As dez coroas do ranking pesam ~0,65 MB
cada (1024 de textura, ~5 mil triângulos), e a do Mestre desce SOB DEMANDA pela mesma
porta (grupo `coroas` do manifesto, Bundle.pede quando um Mestre está à vista) — então ela
tem de caber no mesmo bolso. Este script a põe no tamanho da casa:

  1. DENTRO DO BLENDER (lançado daqui mesmo, em segundo plano): importa o .glb, aplica um
     Decimate (colapso, RAZAO = 0.3 → ~8 mil triângulos; a coroa é vista a três passos e
     girando, o relevo baked segura o detalhe), reamostra as texturas a 1024 e exporta em
     GLB com JPEG q90 — o mesmo funil de tools/embute_gm.py e embute_monstros.py;
  2. as três texturas FICAM em 1024 — cor, relevo e metal/rugosidade — como nas dez do
     ranking (`fica_inteiro` do reduz_texturas.py poupa a pasta coroas-pvp-3d inteira, e a
     tests/texturas_prova.py cobra que nas exceções o relevo siga do tamanho da cor). Com
     `--relevo-512` o relevo e o brilho caem a 512 pelo redutor da casa (0,07 MB a menos;
     reprova a prova das texturas — só para medir);
  3. grava JOGO.MODELS['coroa_gm'] em assets/embedded/coroas-pvp-3d.js (troca a linha se
     já existe; senão acrescenta) — o embutido das coroas, que o extrai_assets.py vira
     assets/models/bundle/coroas-pvp-3d/coroa_gm.glb no grupo `coroas`.

Rodar (Python puro; ele chama o Blender sozinho):
    python tools/embute_coroa_gm.py "<caminho do coroa GM.glb>"
    python tools/embute_coroa_gm.py "<caminho>" --razao 0.5     # decima menos
    python tools/embute_coroa_gm.py "<caminho>" --relevo-512    # só para medir (reprova a prova)
Depois:
    python tools/extrai_assets.py          # o bundle servido (e o manifesto)
    tests/foto_coroa_gm.html               # a foto: a coroa vermelha acima do Mestre

Por que não o reduz_texturas.py sozinho: ele nunca mexe na COR (ficaria 2048, 2,9 MB) nem
na geometria — e poupa a pasta das coroas de propósito. Por que não o embute_coroas_3d.py: ele lê a pasta das dez recortadas da
folha e reescreve o arquivo inteiro — a coroa do Mestre é uma só e chega pronta.
"""
import io, os, re, sys, base64, subprocess, tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "coroas-pvp-3d.js")
CHAVE = "coroa_gm"
BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
TEX_ALVO = 1024
RAZAO = 0.3


# ------------------------------------------------------------ dentro do Blender
def no_blender(origem, destino, razao):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=origem)
    dg = bpy.context.evaluated_depsgraph_get()
    tris_antes = tris_depois = 0
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        o.data.calc_loop_triangles()
        tris_antes += len(o.data.loop_triangles)
        if razao < 1.0:
            mod = o.modifiers.new("decimar", 'DECIMATE')
            mod.ratio = razao
            mod.use_collapse_triangulate = True
            dg.update()
            nova = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
            antiga = o.data
            o.modifiers.clear()
            o.data = nova
            try:
                bpy.data.meshes.remove(antiga)
            except Exception:
                pass
        o.data.calc_loop_triangles()
        tris_depois += len(o.data.loop_triangles)
    n_img = 0
    for img in bpy.data.images:
        if img.size[0] > TEX_ALVO or img.size[1] > TEX_ALVO:
            img.scale(TEX_ALVO, TEX_ALVO)
            img.pack()
            n_img += 1
    bpy.ops.export_scene.gltf(filepath=destino, export_format='GLB', export_animations=False,
                              export_image_format='JPEG', export_jpeg_quality=90, export_apply=True)
    print("BLENDER: %d -> %d triangulos, %d textura(s) reamostradas a %d, %.2f MB"
          % (tris_antes, tris_depois, n_img, TEX_ALVO, os.path.getsize(destino) / 1048576.0))


# ------------------------------------------------------------ em Python puro
def reduz_relevo_e_brilho(bruto):
    """O relevo e o metal/rugosidade a 512 (a cor fica), pelo redutor da casa."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import reduz_texturas as rt
    novo, feitos = rt.reduz_glb(bruto)
    for f in feitos:
        print("   %s %dx%d -> %dx%d (%.2f -> %.2f MB)" % (
            f['papel'], f['antes'][0], f['antes'][1], f['depois'][0], f['depois'][1],
            f['bytes_antes'] / 1048576.0, f['bytes_depois'] / 1048576.0))
    return novo


def grava_no_embutido(dados):
    texto = io.open(SAIDA, encoding="utf-8").read()
    linha = "JOGO.MODELS['%s']='%s';" % (CHAVE, base64.b64encode(dados).decode("ascii"))
    padrao = re.compile(r"^JOGO\.MODELS\['%s'\]='[^']*';\n?" % re.escape(CHAVE), re.M)
    if padrao.search(texto):
        texto = padrao.sub(lambda m: linha + "\n", texto, count=1)
    else:
        if not texto.endswith("\n"):
            texto += "\n"
        texto += linha + "\n"
    nota = " * 08/10: a COROA DO MESTRE (coroa_gm) mora aqui também — tools/embute_coroa_gm.py."
    if nota not in texto:
        texto = texto.replace(" * O bilhete PNG (coroas-pvp.js) segue vivo: perfil 2D e fallback.\n",
                              " * O bilhete PNG (coroas-pvp.js) segue vivo: perfil 2D e fallback.\n" + nota + "\n", 1)
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write(texto)


def main():
    argv = sys.argv[1:]
    if "--" in sys.argv and "--blender" in argv:          # o passo que roda dentro do Blender
        a = sys.argv[sys.argv.index("--") + 1:]
        no_blender(a[1], a[2], float(a[3]))
        return
    razao = RAZAO
    relevo_512 = "--relevo-512" in argv
    if relevo_512:
        argv.remove("--relevo-512")
    if "--razao" in argv:
        i = argv.index("--razao")
        razao = float(argv[i + 1])
        del argv[i:i + 2]
    if not argv or not os.path.exists(argv[0]):
        print('uso: python tools/embute_coroa_gm.py "<caminho do coroa GM.glb>" [--razao 0.3]')
        sys.exit(2)
    origem = os.path.abspath(argv[0])
    if not os.path.exists(BLENDER):
        print("sem o Blender em", BLENDER)
        sys.exit(1)
    tmp = os.path.join(tempfile.gettempdir(), "soterra_coroa_gm")
    if not os.path.isdir(tmp):
        os.makedirs(tmp)
    meio = os.path.join(tmp, CHAVE + ".glb")
    print("1/3 Blender: decima (razao %.2f) e reamostra a %d..." % (razao, TEX_ALVO))
    r = subprocess.run([BLENDER, "--background", "--factory-startup", "--python", os.path.abspath(__file__),
                        "--", "--blender", origem, meio, str(razao)], capture_output=True, text=True)
    for l in r.stdout.splitlines():
        if l.startswith("BLENDER:"):
            print("   " + l)
    if r.returncode != 0 or not os.path.exists(meio):
        print(r.stdout[-3000:]); print(r.stderr[-3000:])
        print("o Blender nao escreveu", meio)
        sys.exit(1)
    dados = open(meio, "rb").read()
    if relevo_512:
        print("2/3 relevo e brilho a 512 (a cor fica em %d) — fora da regra das coroas, so para medir..." % TEX_ALVO)
        dados = reduz_relevo_e_brilho(dados)
    else:
        print("2/3 as tres texturas ficam em %d, como nas dez coroas do ranking" % TEX_ALVO)
    print("3/3 grava JOGO.MODELS['%s'] em %s" % (CHAVE, os.path.relpath(SAIDA, RAIZ)))
    grava_no_embutido(dados)
    print("coroa do Mestre: %.2f MB cru -> %.2f MB embutido (%d bytes)"
          % (os.path.getsize(origem) / 1048576.0, len(dados) / 1048576.0, len(dados)))
    print("AGORA: python tools/extrai_assets.py  e  tests/foto_coroa_gm.html")


main()
