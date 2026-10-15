# -*- coding: utf-8 -*-
"""Empacota as folhas renderizadas por tools/fx_blender.py em assets/embedded/fx-blender.js.

  python tools/embute_fx_blender.py <pasta com <tipo>/f01..f16.png> [tipo ...]

Mesmo formato do fx-anim.js (tools/embute_fx_anim.py): 4×4 quadros, JPEG, RGB já
MULTIPLICADO pelo alfa sobre preto — o jogo desenha a folha com mistura aditiva, em que
preto soma zero. A diferença: estas folhas são BRANCAS e entram com a chave `<tipo>:branco`;
quem põe a cor do elemento é o `filme()` de js/render3d/fx3d_v2.js (uma cor por filme, em vez de
uma folha por elemento — sete folhas em vez de trinta e cinco).

Os quadros vêm a 256 px e descem a 192 (LANCZOS): a folha de 768×768 cabe em ~60–120 KB e a
placa na tela mede de 60 a 240 px, então 192 é folga, não desperdício.
"""
import base64, io, os, sys
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, 'assets', 'embedded', 'fx-blender.js')
PX = 192
GRADE = 4
QUADROS = GRADE * GRADE
QUAL = 88
TIPOS = ['golpe', 'impacto', 'rachadura', 'raio', 'jato', 'pilar', 'selo',
         'helice', 'cristais', 'redemoinho', 'correntes', 'cortes', 'laminas', 'trovao',   # 15/10: as sete do gênero
         'asas', 'mao']   # 15/10, leva 2: as asas da cura e a mão do breu


def premultiplica(im):
    im = im.convert('RGBA')
    r, g, b, a = im.split()
    preto = Image.new('RGB', im.size, (0, 0, 0))
    cor = Image.merge('RGB', (r, g, b))
    return Image.composite(cor, preto, a)


def empacota(pasta):
    fl = Image.new('RGB', (PX * GRADE, PX * GRADE), (0, 0, 0))
    for i in range(QUADROS):
        q = premultiplica(Image.open(os.path.join(pasta, 'f%02d.png' % (i + 1))))
        q = q.resize((PX, PX), Image.LANCZOS)
        fl.paste(q, ((i % GRADE) * PX, (i // GRADE) * PX))
    buf = io.BytesIO()
    fl.save(buf, 'JPEG', quality=QUAL, optimize=True)
    return buf.getvalue()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    origem = sys.argv[1]
    tipos = sys.argv[2:] or TIPOS
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA — as folhas de efeito do BLENDER (12/10): golpe, impacto, rachadura, raio,",
        " * jato, pilar e selo; (15/10) hélice, cristais, redemoinho, correntes, cortes, lâminas e trovão — as do gênero.",
        " * Brancas (`tipo:branco`): filme() as tinge com o elemento.",
        " * Renderizadas por tools/fx_blender.py, empacotadas por tools/embute_fx_blender.py. */",
        "JOGO.FX_ANIM = JOGO.FX_ANIM || {};",
        "JOGO.FX_ANIM_BLENDER = %s;" % str(tipos).replace("'", "'"),
    ]
    total = 0
    for t in tipos:
        pasta = os.path.join(origem, t)
        if not os.path.isfile(os.path.join(pasta, 'f16.png')):
            print('FALTA:', pasta)
            continue
        dados = empacota(pasta)
        linhas.append("JOGO.FX_ANIM['%s:branco']='%s';" % (t, base64.b64encode(dados).decode('ascii')))
        total += len(dados)
        print('%-12s -> %6.1f KB' % (t, len(dados) / 1024.0))
    f = io.open(SAIDA, 'w', encoding='utf-8', newline='\n')
    f.write('\n'.join(linhas) + '\n')
    f.close()
    print('saida: %s (%.1f KB)' % (SAIDA, total / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
