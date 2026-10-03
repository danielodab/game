#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A cor fica em 1024, o relevo e o brilho caem para 512 — e nada mais muda?

    python tests/texturas_prova.py

Sem navegador (o tools/reduz_texturas.py e Python puro). Cobra a REGRA que o
dono aprovou em 02/10, nao um numero de MB:

  1. num .glb montado aqui, com cada caso que ja mordeu ou pode morder:
     - relevo e metal/rugosidade 1024 caem para 512, no MESMO formato;
     - oclusao fora do quadrado cai pelo lado maior (800x400 -> 512x256);
     - imagem que serve de brilho num material e de COR em outro NAO cai;
     - cor e relevo em imagens diferentes mas nos MESMOS bytes (o mesmo
       bufferView) nao caem: a troca e por bufferView;
     - a cor nunca cai;
     - o que ja esta em 512 nao e tocado, e rodar duas vezes da o mesmo .glb;
     - cada bufferView sai alinhado a 4 bytes, o binario dos acessores
       (posicoes) sai byte a byte igual, e o .glb continua valido;
  2. nos embutidos de verdade (assets/embedded):
     - fora das excecoes, nenhum relevo/brilho/oclusao passa de 512
       (`reduz_texturas.py --conferir` em dia — lote novo que entrar sem o
       passo reprova aqui);
     - nenhuma COR caiu junto: em todo modelo reduzido a cor e maior que o
       relevo, e nas excecoes (herois, pets, chefes, fusoes, coroas) o relevo
       segue do tamanho da cor;
  3. o bundle servido saiu dos embutidos reduzidos (extrai_assets --conferir).
"""
import io
import os
import struct
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
import reduz_texturas as rt  # noqa: E402
import extrai_assets as ea  # noqa: E402

from PIL import Image  # noqa: E402

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print('%s · %s%s' % ('PASSOU' if ok else 'FALHOU', nome, (' — ' + str(extra)) if extra else ''))


def _img(fmt, tam, modo='RGB', cor=(128, 128, 255)):
    im = Image.new(modo, tam)
    px = im.load()
    for y in range(tam[1]):          # um degrade: imagem lisa comprimiria a nada
        for x in range(0, tam[0], 7):
            v = (x * 3 + y * 5) % 256
            px[x, y] = (v, cor[1], (cor[2] + v) % 256, 200)[:len(modo)] if modo != 'L' else v
    o = io.BytesIO()
    im.save(o, fmt, **({'quality': 80} if fmt == 'JPEG' else {}))
    return o.getvalue()


def glb_de_teste():
    """Seis imagens, quatro materiais, uma malha com posicoes."""
    imagens = [
        ('image/jpeg', _img('JPEG', (1024, 1024))),            # 0 cor
        ('image/jpeg', _img('JPEG', (1024, 1024))),            # 1 relevo
        ('image/jpeg', _img('JPEG', (1024, 1024))),            # 2 brilho
        ('image/png', _img('PNG', (1024, 1024), 'RGBA')),      # 3 brilho num, COR noutro
        ('image/png', _img('PNG', (800, 400), 'RGBA')),        # 4 oclusao fora do quadrado
        ('image/jpeg', _img('JPEG', (512, 512))),              # 5 relevo ja em 512
    ]
    posicoes = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 1, 0)
    binario = bytearray()
    vistas = []

    def poe(dado):
        binario.extend(b'\0' * ((-len(binario)) % 4))
        vistas.append({'buffer': 0, 'byteOffset': len(binario), 'byteLength': len(dado)})
        binario.extend(dado)
        return len(vistas) - 1
    v_pos = poe(posicoes)
    js_imgs = [{'mimeType': m, 'bufferView': poe(d)} for m, d in imagens]
    js = {
        'asset': {'version': '2.0'},
        'buffers': [{'byteLength': len(binario)}],
        'bufferViews': vistas,
        'accessors': [{'bufferView': v_pos, 'componentType': 5126, 'count': 3, 'type': 'VEC3',
                       'min': [0, 0, 0], 'max': [1, 1, 0]}],
        'images': js_imgs,
        'textures': [{'source': i} for i in range(6)],
        'materials': [
            {'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 2}},
             'normalTexture': {'index': 1}},
            {'pbrMetallicRoughness': {'metallicRoughnessTexture': {'index': 3}}, 'occlusionTexture': {'index': 4},
             'normalTexture': {'index': 5}},
            {'pbrMetallicRoughness': {'baseColorTexture': {'index': 3}}},
        ],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
        'nodes': [{'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0,
    }
    return rt.escreve_glb(js, bytes(binario)), imagens, posicoes


def tamanho_da(js, binario, i):
    im = js['images'][i]
    bv = js['bufferViews'][im['bufferView']]
    d = binario[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    pil = Image.open(io.BytesIO(d))
    return pil.size, pil.format, pil.mode, d


def parte_sintetica():
    bruto, imagens, posicoes = glb_de_teste()
    novo, feitos = rt.reduz_glb(bruto)
    js, binario = rt.le_glb(novo)
    t = [tamanho_da(js, binario, i) for i in range(6)]
    check('relevo e brilho 1024 caem para 512, no mesmo formato (JPEG)',
          t[1][0] == (512, 512) and t[2][0] == (512, 512) and t[1][1] == t[2][1] == 'JPEG',
          [t[1][:2], t[2][:2]])
    check('a oclusao fora do quadrado cai pelo lado maior e segue PNG com o canal alfa',
          t[4][0] == (512, 256) and t[4][1] == 'PNG' and t[4][2] == 'RGBA', t[4][:3])
    check('a imagem que e brilho num material e COR em outro fica intacta (byte a byte)',
          t[3][3] == imagens[3][1], t[3][:3])
    check('a cor nunca cai', t[0][3] == imagens[0][1], t[0][:2])
    check('o relevo que ja estava em 512 nao e tocado', t[5][3] == imagens[5][1])
    check('o relatorio diz o que caiu, e so isso', sorted(f['imagem'] for f in feitos) == [1, 2, 4],
          [(f['imagem'], f['papel']) for f in feitos])
    alinhado = all(v['byteOffset'] % 4 == 0 for v in js['bufferViews'])
    check('cada bufferView sai alinhado a 4 bytes, e o buffer tem o tamanho do binario',
          alinhado and js['buffers'][0]['byteLength'] <= len(binario) and len(binario) % 4 == 0)
    v = js['bufferViews'][js['accessors'][0]['bufferView']]
    check('o binario dos acessores (as posicoes) sai igual',
          binario[v['byteOffset']:v['byteOffset'] + v['byteLength']] == posicoes)
    total = struct.unpack('<I', novo[8:12])[0]
    check('o cabecalho do .glb bate com o tamanho do arquivo, e os blocos tem tamanho multiplo de 4',
          total == len(novo) and struct.unpack('<I', novo[12:16])[0] % 4 == 0)
    de_novo, feitos2 = rt.reduz_glb(novo)
    check('rodar de novo nao muda nenhum byte (idempotente)', de_novo == novo and not feitos2)
    js0 = rt.le_glb(bruto)[0]
    js1 = dict(js)
    for k in ('bufferViews', 'buffers'):
        js0.pop(k, None)
        js1.pop(k, None)
    check('fora dos bufferViews e do buffer, o JSON e o mesmo', js0 == js1)


def parte_vista_partilhada():
    # um exportador que deduplica bytes iguais pode por a cor e o relevo no
    # mesmo bufferView; a reducao troca o bufferView, entao levava a cor junto
    d = _img('JPEG', (1024, 1024))
    binario = d + b'\0' * ((-len(d)) % 4)
    js = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binario)}],
          'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(d)}],
          'images': [{'mimeType': 'image/jpeg', 'bufferView': 0}, {'mimeType': 'image/jpeg', 'bufferView': 0}],
          'textures': [{'source': 0}, {'source': 1}],
          'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}}, 'normalTexture': {'index': 1}}]}
    bruto = rt.escreve_glb(js, binario)
    novo, feitos = rt.reduz_glb(bruto)
    check('cor e relevo no MESMO bufferView: nada cai (a cor mora nos mesmos bytes)',
          novo == bruto and not feitos, [f['papel'] for f in feitos])


def _papel_lados(bruto):
    js, binario = rt.le_glb(bruto)
    uso = rt.papeis(js)
    lados = {}
    for i, im in enumerate(js.get('images', [])):
        if 'bufferView' not in im:
            continue
        bv = js['bufferViews'][im['bufferView']]
        d = binario[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        lado = max(Image.open(io.BytesIO(d)).size)
        for p in uso.get(i, ()):
            lados.setdefault(p, []).append(lado)
    return lados


def parte_embutidos():
    r = subprocess.run([sys.executable, os.path.join(RAIZ, 'tools', 'reduz_texturas.py'), '--conferir'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    ultima = [l for l in r.stdout.splitlines() if l.strip()][-1:] or ['']
    check('fora das excecoes, nenhum relevo/brilho/oclusao passa de 512 (reduz_texturas --conferir)',
          r.returncode == 0, ultima[0].strip())

    cor_maior, iguais_excecao, reduzidos, excecoes = [], [], 0, 0
    for nome in ea._fontes():
        pasta = os.path.splitext(nome)[0]
        itens, _, _ = ea.le_fonte(os.path.join(ea.ORIGEM, nome))
        for alvo, chave, bruto, _ in itens:
            if bruto[:4] != b'glTF':
                continue
            lados = _papel_lados(bruto)
            cor = max(lados.get('cor', [0]))
            outros = [l for p in rt.REDUZIVEIS for l in lados.get(p, [])]
            if not outros or not cor:
                continue
            if rt.fica_inteiro(pasta, chave):
                excecoes += 1
                if max(outros) != cor:
                    iguais_excecao.append('%s/%s cor %d relevo %d' % (pasta, chave, cor, max(outros)))
            else:
                reduzidos += 1
                if not cor > max(outros):
                    cor_maior.append('%s/%s cor %d relevo %d' % (pasta, chave, cor, max(outros)))
    check('nenhuma cor caiu junto: em todo modelo reduzido a cor e maior que o relevo/brilho',
          reduzidos > 0 and not cor_maior, '%d modelos; %s' % (reduzidos, cor_maior[:4]))
    check('nas excecoes (herois, pets, chefes, fusoes, coroas) o relevo segue do tamanho da cor',
          excecoes > 0 and not iguais_excecao, '%d modelos; %s' % (excecoes, iguais_excecao[:4]))


def parte_bundle():
    r = subprocess.run([sys.executable, os.path.join(RAIZ, 'tools', 'extrai_assets.py'), '--conferir'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    ultima = [l for l in r.stdout.splitlines() if l.strip()][-1:] or ['']
    check('o bundle servido saiu dos embutidos reduzidos (extrai_assets --conferir)',
          r.returncode == 0, ultima[0].strip())


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    parte_sintetica()
    parte_vista_partilhada()
    parte_embutidos()
    parte_bundle()
    falhas = RESULTADOS.count(False)
    print('RESUMO: %s (%d)' % ('tudo passou' if not falhas else '%d FALHARAM' % falhas, len(RESULTADOS)))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
