#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — relevo e brilho dos modelos a 512 px; a COR fica em 1024.

POR QUE ISTO EXISTE
-------------------
A aba do jogo passava de 2 GB, e quase tudo era TEXTURA DESCOMPACTADA: cada
modelo do Meshy traz tres imagens 1024x1024 (cor, relevo e metal/rugosidade),
que no .glb sao ~1 MB de JPEG e na memoria do navegador viram ~12 MB (o three
guarda o ImageBitmap depois de subir para a GPU, e ha tres contextos WebGL).
Medido na praca: 374 texturas, 1,57 GB decodificados.

Em 02/10 o dono comparou fotos lado a lado e APROVOU o meio-termo: a textura
de COR continua 1024 (e ela que o olho le), e as de RELEVO (normalTexture) e
METAL/RUGOSIDADE (metallicRoughnessTexture; occlusionTexture tambem, se vier
em imagem separada) caem para 512. Na mesma cena a praca foi para ~0,86 GB e
a diferenca ficou no nivel do ruido da animacao. Reduzir a cor tambem (0,50
GB) ja aparecia no zoom — por isso a cor NUNCA e tocada aqui.

O QUE FICA EM 1024 (`fica_inteiro`)
-----------------------------------
O que o jogador olha de perto o tempo todo: os herois (KayKit, os corpos das
classes `meshy_<classe>` e o `meshy_gm`), o escudo do Minotauro (e a jogada
de uma classe, nao cenario), os corpos de fusao e as invocacoes das fusoes
(grupos `fusao:*`), os pets, os chefes e as coroas. Todo o RESTO reduz:
cenario dos calabouços, construcoes da praca, Campo PvP, monstros comuns,
invocacoes do Xama. A regra e por EXCLUSAO de proposito: lote novo de
cenario ou de monstro entra reduzido sem ninguem lembrar de vir aqui.

O QUE ELE FAZ EM CADA .glb
--------------------------
  1. le o JSON e marca o PAPEL de cada imagem pelo uso: cor (baseColor,
     emissive), relevo, metal/rugosidade, oclusao, ou "outro" (textura
     pendurada numa extensao). So reduz imagem cujos usos sao TODOS relevo/
     brilho/oclusao — a mesma imagem servindo de cor fica intacta;
  2. redimensiona com Lanczos para que o lado maior fique em 512, no MESMO
     formato: JPEG com qualidade 90 e sem subamostrar o croma (4:4:4 — no
     relevo o croma E a direcao da normal), PNG/WebP sem perder canal;
  3. remonta o bloco binario na ordem original dos bufferViews, cada um
     alinhado a 4 bytes, e corrige `byteOffset`/`byteLength` e o tamanho do
     buffer. Acessores apontam para o bufferView, nao para o binario, entao
     nenhum deles muda. Todo o resto do JSON fica igual.
Imagem que ja esta em 512 ou menos fica como esta: rodar de novo nao muda
nenhum byte (idempotente), e modelo sem nada a reduzir sai identico.

USO
---
    python tools/reduz_texturas.py               # reduz os embutidos (assets/embedded/*.js)
    python tools/reduz_texturas.py --conferir    # so lista o que reduziria; sai 1 se houver algo
    python tools/reduz_texturas.py arq.glb ...   # reduz .glb soltos (lote antes de embutir)
    python tools/reduz_texturas.py --todos       # quanto as excecoes pesariam: so lista, nunca grava

Os `embute_*.py` de Python puro (cenario, praca, PvP) ja chamam
`reduz_arquivo` no fim; o `embute_monstros.py` roda dentro do Blender (sem
Pillow) e lembra o passo no AGORA. E o `extrai_assets.py` AVISA quando
encontra relevo/brilho acima de 512 fora das excecoes, e a
`tests/texturas_prova.py` reprova.

DEPOIS de reduzir os embutidos, rode `python tools/extrai_assets.py`: o
bundle servido (`assets/models/bundle/`) sai dos embutidos, e o manifesto
leva o hash novo de cada modelo — o navegador baixa o modelo novo sozinho.
Os originais em 1024 ficam no historico do git (commit anterior a reducao).
"""

import base64
import io
import json
import os
import re
import struct
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEM = os.path.join(RAIZ, 'assets', 'embedded')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extrai_assets as ea  # noqa: E402  (a mesma leitura e os mesmos grupos)

LADO = 512
# Os originais do Meshy/Blender vem em JPEG ~75 com croma 4:2:0. Aqui sai 90
# e 4:4:4, e o porque e o que a imagem guarda: no metal/rugosidade o verde e a
# rugosidade e o azul e o metal, e no relevo as cores SAO a direcao da normal —
# subamostrar o croma mistura canais que nao sao cor. Medido em 18 imagens:
# 4:4:4 a 90 erra em media 0,6-1,0 nivel de 255 contra a reamostragem pura, e
# o .glb ainda cai (relevo 786 -> 353 KB, brilho 1514 -> 1120 KB). A 95 o
# brilho sairia MAIOR que o original de 1024.
QUALIDADE_JPEG = 90

# os papeis que podem cair para 512. 'cor' e 'outro' nunca caem.
REDUZIVEIS = {'relevo', 'brilho', 'oclusao'}

# Pastas (embutidos) que ficam inteiras, com o MOTIVO — sai no relatorio.
FICA_PASTA = {
    'models-heroes': 'heroi (KayKit)',
    'models-meshy': 'heroi (corpo da classe)',
    'models-gm': 'heroi (GM)',
    'muro-escudo': 'heroi (escudo do Minotauro)',
    'models-pets': 'pet',
    'models-bosses': 'chefe',
    'coroas-pvp-3d': 'coroa',
    'models-anims': 'banco de animacao',
}


def fica_inteiro(pasta, chave):
    """O motivo de o modelo ficar em 1024, ou None se ele reduz."""
    if pasta in FICA_PASTA:
        return FICA_PASTA[pasta]
    if ea.grupo_de(pasta, chave).startswith('fusao:'):
        return 'fusao'
    if chave.startswith('boss-'):
        return 'chefe'
    if chave.startswith('pet-'):
        return 'pet'
    if chave.startswith('coroa'):
        return 'coroa'
    if chave.startswith('meshy_'):
        return 'heroi'
    return None


# ------------------------------------------------------------------ o .glb
GLB_JSON = 0x4E4F534A
GLB_BIN = 0x004E4942


class NaoSei(Exception):
    """O .glb tem algo que esta ferramenta nao remonta com seguranca."""


def _alinha(n, a=4):
    return (n + a - 1) // a * a


def le_glb(bruto):
    if bruto[:4] != b'glTF':
        raise NaoSei('nao e glb')
    versao, total = struct.unpack('<II', bruto[4:12])
    if versao != 2:
        raise NaoSei('glb versao %d' % versao)
    pos, js, binario = 12, None, None
    while pos + 8 <= min(total, len(bruto)):
        n, tipo = struct.unpack('<II', bruto[pos:pos + 8])
        dado = bruto[pos + 8:pos + 8 + n]
        if tipo == GLB_JSON and js is None:
            js = json.loads(dado.decode('utf-8'))
        elif tipo == GLB_BIN and binario is None:
            binario = dado
        else:
            raise NaoSei('chunk extra 0x%08x' % tipo)
        pos += 8 + n
    if js is None:
        raise NaoSei('sem JSON')
    return js, binario


def escreve_glb(js, binario):
    texto = json.dumps(js, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    texto += b' ' * (_alinha(len(texto)) - len(texto))      # o JSON se completa com espaco
    partes = [struct.pack('<II', len(texto), GLB_JSON), texto]
    if binario is not None:
        b = binario + b'\0' * (_alinha(len(binario)) - len(binario))  # o BIN com zero
        partes += [struct.pack('<II', len(b), GLB_BIN), b]
    corpo = b''.join(partes)
    return b'glTF' + struct.pack('<II', 2, 12 + len(corpo)) + corpo


def papeis(js):
    """{indice da imagem: set(papeis)} pelo uso nos materiais."""
    texturas = js.get('textures', [])

    def fonte(info):
        if not isinstance(info, dict) or 'index' not in info:
            return None
        t = texturas[info['index']]
        if 'source' in t:
            return t['source']
        # textura so por extensao (webp/basisu): nao mexe
        return None

    uso = {}
    usadas = set()         # indices de textura que algum material usa

    def marca(info, papel):
        if isinstance(info, dict) and 'index' in info:
            usadas.add(info['index'])
        s = fonte(info)
        if s is not None:
            uso.setdefault(s, set()).add(papel)

    def varre_extensoes(no):
        # qualquer textura dentro de uma extensao (specular, clearcoat...) e
        # 'outro': nao sabemos o que o olho espera dela, entao ela segura a
        # imagem em 1024.
        if isinstance(no, dict):
            for k, v in no.items():
                if k.endswith('Texture') and isinstance(v, dict) and 'index' in v:
                    marca(v, 'outro')
                else:
                    varre_extensoes(v)
        elif isinstance(no, list):
            for v in no:
                varre_extensoes(v)

    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        marca(pbr.get('baseColorTexture'), 'cor')
        marca(m.get('emissiveTexture'), 'cor')
        marca(pbr.get('metallicRoughnessTexture'), 'brilho')
        marca(m.get('normalTexture'), 'relevo')
        marca(m.get('occlusionTexture'), 'oclusao')
        varre_extensoes(m.get('extensions', {}))
        varre_extensoes(pbr.get('extensions', {}))
    # textura que nenhum material usa: nao sabemos quem a le (o codigo do
    # jogo pode pegar pelo indice), entao ela segura a imagem em 1024
    for i, t in enumerate(texturas):
        if 'source' in t and i not in usadas:
            uso.setdefault(t['source'], set()).add('outro')
        if t.get('extensions'):
            for v in t['extensions'].values():
                if isinstance(v, dict) and 'source' in v:
                    uso.setdefault(v['source'], set()).add('outro')
    return uso


def _reamostra(dados, mime):
    """(bytes novos, (w,h) antes, (w,h) depois) ou None se ja esta <= LADO."""
    from PIL import Image
    im = Image.open(io.BytesIO(dados))
    w, h = im.size
    if max(w, h) <= LADO:
        return None
    escala = LADO / float(max(w, h))
    nw, nh = max(1, round(w * escala)), max(1, round(h * escala))
    im.load()
    saida = io.BytesIO()
    if mime == 'image/jpeg':
        if im.mode not in ('RGB', 'L', 'CMYK'):
            raise NaoSei('jpeg em modo %s' % im.mode)
        novo = im.resize((nw, nh), Image.LANCZOS)
        novo.save(saida, 'JPEG', quality=QUALIDADE_JPEG, subsampling=0, optimize=True)
    elif mime == 'image/png':
        if im.mode not in ('RGB', 'RGBA', 'L', 'LA'):
            # paleta, 16 bits... Lanczos nesses modos troca o que o canal
            # significa; melhor deixar em 1024 do que estragar o relevo
            raise NaoSei('png em modo %s' % im.mode)
        novo = im.resize((nw, nh), Image.LANCZOS)
        novo.save(saida, 'PNG', optimize=True)
    elif mime == 'image/webp':
        novo = im.resize((nw, nh), Image.LANCZOS)
        novo.save(saida, 'WEBP', lossless=True, exact=True)
    else:
        raise NaoSei('formato %s' % mime)
    return saida.getvalue(), (w, h), (nw, nh)


def pendentes_no_glb(pasta, chave, bruto):
    """Quantas imagens deste modelo a reducao ainda pegaria. So le o
    cabecalho de cada imagem (o Pillow nao decodifica no `open`): e o aviso
    barato que o extrai_assets.py da a cada extracao."""
    if bruto[:4] != b'glTF' or fica_inteiro(pasta, chave):
        return 0
    from PIL import Image
    try:
        js, binario = le_glb(bruto)
    except (NaoSei, ValueError):
        return 0
    uso = papeis(js)
    n = 0
    for i, im in enumerate(js.get('images', [])):
        p = uso.get(i, set())
        if not p or not p <= REDUZIVEIS or 'bufferView' not in im:
            continue
        bv = js['bufferViews'][im['bufferView']]
        ini = bv.get('byteOffset', 0)
        try:
            if max(Image.open(io.BytesIO(binario[ini:ini + bv['byteLength']])).size) > LADO:
                n += 1
        except Exception:
            pass
    return n


def reduz_glb(bruto):
    """(bytes novos, lista do que reduziu). Sem nada a reduzir devolve os
    MESMOS bytes — nem o JSON e reescrito."""
    js, binario = le_glb(bruto)
    imagens = js.get('images', [])
    if not imagens:
        return bruto, []
    uso = papeis(js)
    trocas = {}            # indice do bufferView -> bytes novos
    feitos = []
    for i, im in enumerate(imagens):
        p = uso.get(i, set())
        if not p or not p <= REDUZIVEIS:
            continue
        if 'bufferView' not in im:
            continue                       # imagem por uri: nao ha no jogo
        bv = js['bufferViews'][im['bufferView']]
        ini = bv.get('byteOffset', 0)
        dados = binario[ini:ini + bv['byteLength']]
        r = _reamostra(dados, im.get('mimeType', ''))
        if r is None:
            continue
        novo, antes, depois = r
        if im['bufferView'] in trocas:
            continue
        trocas[im['bufferView']] = novo
        feitos.append({'imagem': i, 'papel': '+'.join(sorted(p)), 'antes': antes,
                       'depois': depois, 'bytes_antes': len(dados), 'bytes_depois': len(novo)})
    if not trocas:
        return bruto, []

    buffers = js.get('buffers', [])
    if len(buffers) != 1 or 'uri' in buffers[0] or binario is None:
        raise NaoSei('buffer fora do bloco binario')
    vistas = js['bufferViews']
    if any(v.get('buffer', 0) != 0 for v in vistas):
        raise NaoSei('bufferView de outro buffer')
    ordem = sorted(range(len(vistas)), key=lambda k: (vistas[k].get('byteOffset', 0), k))
    # vistas que se sobrepoem nao se remontam uma a uma sem desfazer a partilha
    fim = 0
    for k in ordem:
        ini = vistas[k].get('byteOffset', 0)
        if ini < fim:
            raise NaoSei('bufferViews sobrepostos')
        fim = ini + vistas[k]['byteLength']
    saida = bytearray()
    for k in ordem:
        v = vistas[k]
        ini = v.get('byteOffset', 0)
        dado = trocas.get(k, binario[ini:ini + v['byteLength']])
        saida += b'\0' * (_alinha(len(saida)) - len(saida))
        v['byteOffset'] = len(saida)
        v['byteLength'] = len(dado)
        saida += dado
    buffers[0]['byteLength'] = len(saida)
    return escreve_glb(js, bytes(saida)), feitos


# ------------------------------------------------------------------ os embutidos
def _mb(n):
    return n / 1048576.0


def processa_embutido(caminho, conferir, todos, relatorio):
    """Reduz os modelos de um embutido. Devolve (n modelos mudados, n imagens)."""
    pasta = os.path.splitext(os.path.basename(caminho))[0]
    with open(caminho, 'rb') as f:
        texto = f.read().decode('utf-8')
    pedacos, ultimo = [], 0
    mudou_modelos = mudou_imgs = 0
    for m in ea.RE_ITEM.finditer(texto):
        chave = m.group(2)
        limpo = re.sub(r'\s+', '', ea.RE_COLA.sub('', m.group(3)))
        bruto = base64.b64decode(limpo)
        if bruto[:4] != b'glTF':
            continue
        motivo = None if todos else fica_inteiro(pasta, chave)
        if motivo:
            relatorio['fica'].setdefault(motivo, 0)
            relatorio['fica'][motivo] += 1
            continue
        try:
            novo, feitos = reduz_glb(bruto)
        except NaoSei as e:
            relatorio['pulados'].append('%s/%s: %s' % (pasta, chave, e))
            continue
        if not feitos:
            continue
        mudou_modelos += 1
        mudou_imgs += len(feitos)
        relatorio['linhas'].append((pasta, chave, len(bruto), len(novo), feitos))
        if not conferir:
            pedacos.append(texto[ultimo:m.start(3)])
            pedacos.append(base64.b64encode(novo).decode('ascii'))
            ultimo = m.end(3)
    if not conferir and mudou_modelos:
        pedacos.append(texto[ultimo:])
        with open(caminho, 'wb') as f:
            f.write(''.join(pedacos).encode('utf-8'))
    return mudou_modelos, mudou_imgs


def imprime(relatorio, conferir):
    linhas = relatorio['linhas']
    total_a = total_d = 0
    for pasta, chave, a, d, feitos in linhas:
        total_a += a
        total_d += d
        imgs = ', '.join('%s %dx%d->%dx%d' % (f['papel'], f['antes'][0], f['antes'][1],
                                              f['depois'][0], f['depois'][1]) for f in feitos)
        print('  %-26s %-24s %7.2f -> %5.2f MB  %s' % (pasta, chave, _mb(a), _mb(d), imgs))
    n_img = sum(len(l[4]) for l in linhas)
    verbo = 'reduziria' if conferir else 'reduziu'
    print('')
    print('  %s %d imagem(ns) em %d modelo(s): %.2f -> %.2f MB de .glb (-%.2f MB)' % (
        verbo, n_img, len(linhas), _mb(total_a), _mb(total_d), _mb(total_a - total_d)))
    if relatorio['fica']:
        print('  ficam em 1024 (nao entram): %s' % ', '.join(
            '%s %d' % (k, v) for k, v in sorted(relatorio['fica'].items())))
    for p in relatorio['pulados']:
        print('  PULADO %s' % p)


def reduz_arquivo(caminho):
    """O passo dos `embute_*.py`: reduz o embutido que eles acabaram de
    escrever e imprime o relatorio. Sem ele, rodar o embute de novo (para
    trocar uma peca, por exemplo) devolvia o lote inteiro a 1024 calado."""
    relatorio = {'linhas': [], 'fica': {}, 'pulados': []}
    processa_embutido(caminho, False, False, relatorio)
    print('')
    print('=== relevo e brilho a %d px (tools/reduz_texturas.py) ===' % LADO)
    imprime(relatorio, False)
    return relatorio


def principal(args):
    todos = '--todos' in args
    # --todos e so medida: gravar com ele reduziria os herois que o dono quer em 1024
    conferir = '--conferir' in args or todos
    soltos = [a for a in args if not a.startswith('--')]
    relatorio = {'linhas': [], 'fica': {}, 'pulados': []}
    if soltos:
        for caminho in soltos:
            with open(caminho, 'rb') as f:
                bruto = f.read()
            try:
                novo, feitos = reduz_glb(bruto)
            except NaoSei as e:
                relatorio['pulados'].append('%s: %s' % (caminho, e))
                continue
            if feitos:
                relatorio['linhas'].append(('(solto)', os.path.basename(caminho), len(bruto), len(novo), feitos))
                if not conferir:
                    with open(caminho, 'wb') as f:
                        f.write(novo)
    else:
        for nome in ea._fontes():
            processa_embutido(os.path.join(ORIGEM, nome), conferir, todos, relatorio)
    imprime(relatorio, conferir)
    if conferir:
        if relatorio['linhas']:
            print('  -> rode python tools/reduz_texturas.py e depois python tools/extrai_assets.py')
            return 1
        print('  em dia: nenhum relevo/brilho acima de %d px fora das excecoes' % LADO)
        return 0
    if relatorio['linhas'] and not soltos:
        print('  AGORA: python tools/extrai_assets.py (o bundle servido sai dos embutidos)')
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(principal(sys.argv[1:]))
