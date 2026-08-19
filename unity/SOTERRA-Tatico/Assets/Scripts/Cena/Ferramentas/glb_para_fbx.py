"""GLB -> FBX: a ponte que deixa a Unity importar o acervo de personagens.

    blender.exe -b --python glb_para_fbx.py -- <entrada.glb> <saida.fbx>
                [--com-animacao] [--pose <banco.glb>]

POR QUE ISTO EXISTE
    A Unity 6 nao le `.glb` sem `com.unity.cloud.gltfast`, e `Packages/` nao e
    do dono deste diretorio. O Blender le glb e escreve fbx, entao a ponte e
    ele. No dia em que o pacote entrar, esta pasta inteira
    (`Assets/Resources/elenco/*.fbx`) pode sumir e o `ModelosDeResources` passa
    a apontar para os `.glb` de `Assets/Modelos/` sem mais nada mudar.

O QUE ELE NAO FAZ, DE PROPOSITO
    - Nao apaga adereco nenhum. O mesmo `mage.glb` veste o Bruxo (chapeu e
      cajado) e o Xama (grimorio e varinha): quem escolhe as pecas e a lista
      `show` do `_aparencia.json`, na Unity, em tempo de montagem.
    - Nao mexe em escala. Quem normaliza a altura e o `Elenco`, medindo a caixa
      do corpo, do mesmo jeito que o `visibleBodyBox` do jogo em JS.

ANIMACAO
    Sai DESLIGADA por padrao, e o motivo e tamanho: com as acoes baqueadas, o
    lobo do Quaternius vai de 283 KB para 3,5 MB, e os 35 personagens juntos
    passam de 12 MB para 60 MB de binario versionado. Os nove herois da KayKit
    nao perdem nada (eles nao trazem acao nenhuma). Os monstros do Quaternius
    perdem as proprias acoes ate alguem rodar isto com a opcao — o `.glb` de
    origem continua intacto em `Assets/Modelos/`.

POSE (--pose)
    Os nove humanoides da KayKit chegam em T, de bracos abertos: e a pose de
    amarracao do esqueleto, nao uma pose de jogo. `--pose _anims.glb` troca a
    pose de REPOUSO deles pelo primeiro quadro do clipe `Idle` do banco.

    A conta e um delta de MUNDO:

        delta = mundo_do_banco_com_Idle[osso] @ mundo_de_repouso[osso]^-1
        pose  = delta @ osso.matrix_local

    O `mundo_de_repouso` e lido do glb CRU, e nao perguntado ao Blender. Isso
    custou uma volta inteira para descobrir: no Blender, tirar a acao de um
    objeto NAO devolve o transform dele ao repouso — os campos ficam com o
    ultimo valor avaliado. Medindo assim, o "repouso" ja vinha com meia pose
    dentro, o delta saia quase identidade e o personagem continuava em T sem
    que nada reclamasse. No glb cru o repouso e o que esta escrito.

    A hierarquia do banco esta em T tambem: quem carrega a pose sao os canais
    de animacao, e por isso o banco PRECISA ser importado e avaliado — ler o
    glb dele daria o mesmo T do personagem.
"""
import bpy
import json
import os
import struct
import sys

from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
entrada, saida = argv[0], argv[1]
com_animacao = "--com-animacao" in argv
banco_de_pose = argv[argv.index("--pose") + 1] if "--pose" in argv else None


# =========================================================== LEITURA DO GLB CRU

def _json_do_glb(caminho):
    """O bloco JSON de um .glb, sem tocar no bloco binario."""
    with open(caminho, "rb") as f:
        dados = f.read()
    if dados[:4] != b"glTF":
        raise ValueError("%s nao e um glb" % caminho)
    pos = 12
    while pos < len(dados):
        tamanho, tipo = struct.unpack_from("<II", dados, pos)
        pos += 8
        if tipo == 0x4E4F534A:                      # 'JSON'
            return json.loads(dados[pos:pos + tamanho].decode("utf-8"))
        pos += tamanho
    raise ValueError("%s nao tem bloco JSON" % caminho)


def mundo_das_juntas(caminho):
    """Nome da junta -> matriz de MUNDO, composta da hierarquia de nos do glb."""
    gltf = _json_do_glb(caminho)
    nos = gltf.get("nodes", [])

    def local(no):
        if "matrix" in no:
            m = no["matrix"]
            # glTF grava matriz por COLUNAS; a do Blender e por linhas.
            return Matrix([[m[0], m[4], m[8], m[12]],
                           [m[1], m[5], m[9], m[13]],
                           [m[2], m[6], m[10], m[14]],
                           [m[3], m[7], m[11], m[15]]])
        t = Vector(no.get("translation", (0, 0, 0)))
        r = no.get("rotation", (0, 0, 0, 1))         # glTF: x,y,z,w
        s = Vector(no.get("scale", (1, 1, 1)))
        return (Matrix.Translation(t) @
                Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4() @
                Matrix.Diagonal(s.to_4d()))

    # O importador do Blender gira a cena inteira de Y-cima (glTF) para Z-cima.
    # Sem esta rotacao o delta viria deitado e o personagem sairia de bruco.
    para_blender = Matrix.Rotation(1.5707963267948966, 4, 'X')

    mundo = {}

    def desce(indice, pai):
        no = nos[indice]
        m = pai @ local(no)
        nome = no.get("name")
        if nome:
            mundo[nome] = m
        for filho in no.get("children", []):
            desce(filho, m)

    cenas = gltf.get("scenes", [])
    raizes = cenas[gltf.get("scene", 0)].get("nodes", []) if cenas else range(len(nos))
    for raiz in raizes:
        desce(raiz, para_blender)
    return mundo


# ================================================================== CONVERSAO

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=entrada)

CLIPE_PARADO = "Idle"


def pose_do_banco(caminho):
    """Matriz de MUNDO de cada junta do banco com o clipe `Idle` avaliado.

    Precisa passar pelo Blender: a hierarquia do banco esta em T como a do
    personagem, e quem baixa os bracos sao os canais de animacao.
    """
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=caminho)
    novos = [o for o in bpy.data.objects if o not in antes]

    acao = bpy.data.actions.get(CLIPE_PARADO)
    if acao is None:
        raise ValueError("o banco %s nao tem o clipe %s" % (caminho, CLIPE_PARADO))

    for o in novos:
        if o.animation_data is None:
            o.animation_data_create()
        o.animation_data.action = acao
        # Acao com SLOT (Blender 4.4+): uma acao so guarda a animacao de varios
        # objetos, e sem escolher o slot do objeto ele fica parado sem avisar.
        for slot in acao.slots:
            if slot.name_display == o.name:
                o.animation_data.action_slot = slot
                break

    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    pose = {o.name: o.matrix_world.copy() for o in novos}

    for o in novos:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return pose


if banco_de_pose:
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if arm is None:
        print("[SOTERRA] %s nao tem esqueleto; a pose foi ignorada" % os.path.basename(entrada))
    else:
        repouso = mundo_das_juntas(entrada)
        parado = pose_do_banco(banco_de_pose)

        bpy.ops.object.select_all(action='DESELECT')
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='POSE')

        # Pai antes de filho: `pose_bone.matrix` e absoluta, e mexer no pai
        # depois do filho arrastaria o filho de novo.
        def em_ordem(ossos):
            saida, vistos = [], set()

            def entra(o):
                if o.name in vistos:
                    return
                if o.parent:
                    entra(o.parent)
                vistos.add(o.name)
                saida.append(o)

            for o in ossos:
                entra(o)
            return saida

        posados = 0
        for osso in em_ordem(list(arm.pose.bones)):
            if osso.name not in repouso or osso.name not in parado:
                continue
            delta = parado[osso.name] @ repouso[osso.name].inverted()
            osso.matrix = delta @ arm.data.bones[osso.name].matrix_local
            bpy.context.view_layer.update()
            posados += 1

        bpy.ops.object.mode_set(mode='OBJECT')
        bpy.context.view_layer.update()

        # Esqueleto que nao e o da KayKit nao casa nome nenhum, e ai nao ha pose
        # para assar. Sem esta saida, os bichos do Quaternius passariam pelo
        # ciclo de aplicar-e-devolver modificador a troco de nada.
        if posados < 5:
            print("[SOTERRA] %s nao usa o esqueleto do banco (%d ossos casaram); pose ignorada"
                  % (os.path.basename(entrada), posados))
            banco_de_pose = None

    if banco_de_pose and arm is not None:
        # ASSA a deformacao na malha ANTES de mexer no repouso.
        #
        # "Aplicar pose como repouso" sozinho nao resolve, e isso custou uma
        # volta: por definicao ele nao mexe em NADA visivel — troca o repouso e
        # corrige a malha na mesma medida, justamente para o personagem ficar
        # onde estava. O braco continuava aberto.
        #
        # Entao: aplica o modificador (as posicoes de vertice viram as da pose),
        # depois troca o repouso, depois devolve o modificador. No fim o corpo
        # esta parado, o esqueleto esta parado, e os dois concordam — o que
        # deixa o rig utilizavel na rodada em que a animacao entrar.
        peles = [o for o in bpy.data.objects
                 if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
        for malha in peles:
            bpy.ops.object.select_all(action='DESELECT')
            malha.select_set(True)
            bpy.context.view_layer.objects.active = malha
            for m in list(malha.modifiers):
                if m.type == 'ARMATURE':
                    bpy.ops.object.modifier_apply(modifier=m.name)

        bpy.ops.object.select_all(action='DESELECT')
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.pose.armature_apply()
        bpy.ops.object.mode_set(mode='OBJECT')

        for malha in peles:
            mod = malha.modifiers.new(name="Armature", type='ARMATURE')
            mod.object = arm

        bpy.context.view_layer.update()
        print("[SOTERRA] pose de repouso trocada em %d ossos, %d peles reassadas"
              % (posados, len(peles)))

pasta = os.path.dirname(saida)
os.makedirs(pasta, exist_ok=True)

# DESEMPACOTA as texturas para arquivos ao lado do fbx.
#
# Dentro do glb a imagem vive empacotada, sem caminho em disco, e nesse estado o
# exportador nao tem o que copiar: o FBX sai sem textura nenhuma e a Unity
# importa o personagem BRANCO. Branco sob sol forte e um vulto — sem rosto, sem
# barba, sem capa —, e foi assim que a primeira foto desta rodada saiu.
for imagem in bpy.data.images:
    if imagem.packed_file is None or imagem.size[0] == 0:
        continue
    nome = imagem.name
    if not nome.lower().endswith(".png"):
        nome = os.path.splitext(nome)[0] + ".png"
    imagem.filepath_raw = os.path.join(pasta, nome)
    imagem.file_format = 'PNG'
    imagem.save()
    # REMOVE, e nao WRITE_ORIGINAL: o arquivo ja foi gravado pelo `save()` acima,
    # e "original" quer dizer o caminho que veio DENTRO do glb — que e relativo
    # e cai no diretorio de trabalho de quem chamou. Com WRITE_ORIGINAL as seis
    # texturas do acervo apareceram soltas na raiz do repositorio.
    imagem.unpack(method='REMOVE')

bpy.ops.export_scene.fbx(
    filepath=saida,
    use_selection=False,
    apply_unit_scale=True,
    apply_scale_options='FBX_SCALE_NONE',
    # Convencao da Unity: de pe em +Y, olhando para +Z.
    axis_forward='-Z',
    axis_up='Y',
    object_types={'ARMATURE', 'MESH', 'EMPTY'},
    # O modificador Armature E o esqueleto: aplicar congelaria todo mundo na
    # pose de repouso e nao sobraria o que animar.
    use_mesh_modifiers=False,
    mesh_smooth_type='FACE',
    # Osso-folha extra vira um transform sem dono na Unity, e ele aparece no
    # caminho das curvas de animacao — o clipe deixaria de casar com o corpo.
    add_leaf_bones=False,
    primary_bone_axis='Y',
    secondary_bone_axis='X',
    bake_anim=com_animacao,
    bake_anim_use_all_actions=com_animacao,
    bake_anim_use_nla_strips=False,
    # Sem simplificar, o exportador grava uma chave por osso por quadro.
    bake_anim_simplify_factor=1.0,
    # A textura vem empacotada dentro do glb e sai daqui como arquivo AO LADO
    # do fbx, nao embutida dentro dele.
    #
    # Embutida era o caminho obvio e nao funciona: o importador da Unity 6 nao
    # desempacota textura de FBX sozinho — e preciso mandar "Extract Textures"
    # pela janela do Inspector, que e exatamente o que este projeto nao faz. O
    # personagem chegava branco, e branco sob sol forte vira um vulto sem rosto,
    # sem barba e sem capa. Como arquivo solto, a Unity importa a imagem como
    # qualquer outra e o material a encontra pelo nome.
    # RELATIVE e nao COPY: COPY faz uma SEGUNDA copia da imagem dentro de
    # `<nome>.fbm/`, e ficariam duas do mesmo atlas no repositorio. Relativo, o
    # FBX aponta para o png que acabou de ser gravado ao lado dele.
    path_mode='RELATIVE',
    embed_textures=False,
)

print("[SOTERRA] %s -> %s%s%s" % (os.path.basename(entrada), os.path.basename(saida),
                                  " (com animacao)" if com_animacao else "",
                                  " (posado)" if banco_de_pose else ""))
