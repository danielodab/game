# -*- coding: utf-8 -*-
"""Do lote do dono até as peças com nome: Sala de Guerra, Câmara do Eco e Santuário.

Rodar (Python puro; ele chama o Blender em prioridade baixa):
    python tools/prepara_cenario_lancamento.py [--trabalho <pasta>] [--so sede|eco|santuario]
    python tools/embute_cenario_lancamento.py  [--trabalho <pasta>]

POR QUE UM SCRIPT A MAIS (03/10/2026). Nos seis calabouços o caminho era rodar
o separador DENTRO da pasta do dono, que ganhava um `_separado\\` e depois um
`_pecas\\` montado à mão. Neste lote a regra mudou: **a pasta do dono só se lê**
(`Downloads\\assets_ok\\mapa\\`), nada é gravado, movido ou renomeado lá. Então o
primeiro passo é COPIAR as folhas para uma pasta de trabalho, e tudo o que os
outros scripts gravam cai nela. A pasta de trabalho é descartável: apagada, este
script a refaz inteira a partir dos originais.

O QUE VEIO, E COMO VEIO (os nomes saíram um pouco fora do combinado no
`docs/PROMPTS_LANCAMENTO.md`, e este script é quem se adapta):

  A Sala de Guerra\\
      muros\\parede_lisa.glb, parede_cortada.glb, porta.glb   um muro por arquivo
      muros\\paredes esteio-tocha.glb       folha de 2 MUROS (esteio | tocha): separador
      trono-lareira-estandarte.glb                    3 itens   } na RAIZ do lote, não
      pilar-armadura-rack de armas-estatua.glb        4 itens   } em `itens mapa\\`
      mesa do conselho-banco-bau-trofeu.glb           4 itens   }
  Eco Primordial\\      (é ESTA; `O eco primordial\\` chegou vazia)
      muro\\pilar quebrado-entulho.glb      folha de 2 MUROS
      itens mapa\\borda do abismo-cristal do eco-obelisco dos seis.glb   3 itens
  O Santuario dos Elementos\\
      muros\\muro fogo|agua|terra|ar.glb    um muro por arquivo
      pilar vivo.glb                        muro, na RAIZ
      estatua cega-braseiro-pilar da mare-bica.glb                4 itens
      altar dos quatro-menir-pilar de marmore-cata vento.glb      4 itens
      soquete do pilar-poca-ponte-respiro de vento.glb            4 itens

AS 8 FOLHAS SAÍRAM LIMPAS no `separa_pecas.py`: o nome do arquivo deu a contagem
e o separador achou o patamar sozinho em todas, sem `--conta`, sem `--bruto`,
sem mapa. A ordem conferiu com o nome em sete delas (folha de contato, uma foto
por peça). A oitava é a armadilha deste lote:

  **"pilar quebrado-entulho.glb" veio com as peças na ordem INVERSA do nome.**
  O separador nomeia da esquerda para a direita, e no modelo o monte baixo e
  comprido (o entulho, 0,56 × 0,22) está à esquerda e a colunata de dois
  fustes com o lintel caído (o pilar quebrado, 0,39 × 0,48) à direita. Lido
  pelo nome, o `alto` da Câmara seria o entulho esticado a 3,10 m. O de-para
  abaixo desfaz a troca, e a altura medida confere: o alto tem de ser o mais
  alto dos dois (o script cobra isso e para se não for).

A PAREDE SAI ENXUTA (`enxuga_muros_lancamento.py`, tabela `ENXUGA` abaixo): malha
baixa nova com a cor e o relevo assados da alta. Sem isso o salão desenhava 1,74
milhão de triângulos por quadro.

O MURO NÃO PASSA PELO SEPARADOR (`normaliza_muros_lancamento.py`): o separador
recorta por ilhas e jogaria fora parte solta legítima. As duas folhas de dois
muros são a exceção forçada, e saíram inteiras.
"""
import os, sys, shutil, subprocess, glob

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DONO = os.path.join('C:\\', 'Users', 'danie', 'Downloads', 'assets_ok', 'mapa')
BLENDER = r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
BAIXA = 0x00004000          # BELOW_NORMAL_PRIORITY_CLASS: a máquina é do dono


def trabalho_padrao():
    import tempfile
    return os.path.join(tempfile.gettempdir(), 'soterra_cenario_lancamento')


# lote -> a pasta do dono (achada sem olhar a caixa: a grafia já mudou de lote para lote)
PASTA = {
    'sede': 'A Sala de Guerra',
    'eco': 'Eco Primordial',
    'santuario': 'O Santuario dos Elementos',
}

# lote -> { subpasta de trabalho: [(caminho relativo na pasta do dono, nome na cópia)] }
#   folhas, folhas_muro → separa_pecas.py (o nome da CÓPIA dá os nomes das peças, na ordem)
#   muros               → normaliza_muros_lancamento.py
ORIGEM = {
    'sede': {
        'folhas': [('trono-lareira-estandarte.glb', None),
                   ('pilar-armadura-rack de armas-estatua.glb', None),
                   ('mesa do conselho-banco-bau-trofeu.glb', None)],
        'folhas_muro': [('muros/paredes esteio-tocha.glb', 'esteio-tocha.glb')],
        'muros': [('muros/parede_lisa.glb', None), ('muros/parede_cortada.glb', None),
                  ('muros/porta.glb', None)],
    },
    'eco': {
        'folhas': [('itens mapa/borda do abismo-cristal do eco-obelisco dos seis.glb', None)],
        'folhas_muro': [('muro/pilar quebrado-entulho.glb', None)],
    },
    'santuario': {
        'folhas': [('estatua cega-braseiro-pilar da mare-bica.glb', None),
                   ('altar dos quatro-menir-pilar de marmore-cata vento.glb', None),
                   ('soquete do pilar-poca-ponte-respiro de vento.glb', None)],
        'muros': [('muros/muro fogo.glb', None), ('muros/muro agua.glb', None),
                  ('muros/muro terra.glb', None), ('muros/muro ar.glb', None),
                  ('pilar vivo.glb', None)],
    },
}

# lote -> { "subpasta/arquivo separado": chave do jogo }
DE_PARA = {
    'sede': {
        'folhas/trono': 'sd_trono', 'folhas/lareira': 'sd_lareira', 'folhas/estandarte': 'sd_estandarte',
        'folhas/pilar': 'sd_pilar', 'folhas/armadura': 'sd_armadura',
        'folhas/rack_de_armas': 'sd_rack_armas', 'folhas/estatua': 'sd_estatua',
        'folhas/mesa_do_conselho': 'sd_mesa', 'folhas/banco': 'sd_banco', 'folhas/bau': 'sd_bau',
        'folhas/trofeu': 'sd_trofeu',
        'folhas_muro/esteio': 'sd_parede_esteio', 'folhas_muro/tocha': 'sd_parede_tocha',
        'muros/parede_lisa': 'sd_parede_lisa', 'muros/parede_cortada': 'sd_parede_cortada',
        'muros/porta': 'sd_porta',
    },
    'eco': {
        # A TROCA: na folha o entulho está à ESQUERDA (ver o cabeçalho)
        'folhas_muro/pilar_quebrado': 'ce_entulho',
        'folhas_muro/entulho': 'ce_pilar_quebrado',
        'folhas/borda_do_abismo': 'ce_borda_abismo', 'folhas/cristal_do_eco': 'ce_cristal_eco',
        'folhas/obelisco_dos_seis': 'ce_obelisco',
    },
    'santuario': {
        'muros/muro_fogo': 'el_muro_fogo', 'muros/muro_agua': 'el_muro_agua',
        'muros/muro_terra': 'el_muro_terra', 'muros/muro_ar': 'el_muro_ar',
        'muros/pilar_vivo': 'el_pilar_vivo',
        'folhas/estatua_cega': 'el_estatua_cega', 'folhas/braseiro': 'el_braseiro',
        'folhas/pilar_da_mare': 'el_agua_pilar', 'folhas/bica': 'el_bica',
        'folhas/altar_dos_quatro': 'el_marco_altar', 'folhas/menir': 'el_menir',
        'folhas/pilar_de_marmore': 'el_ar_pilar', 'folhas/cata_vento': 'el_cata_vento',
        'folhas/soquete_do_pilar': 'el_soquete', 'folhas/poca': 'el_poca',
        'folhas/ponte': 'el_ponte', 'folhas/respiro_de_vento': 'el_respiro',
    },
}


# lote -> { chave: alvo }: os módulos de PAREDE que saem enxutos (malha baixa nova e
# textura reassada da alta, `tools/enxuga_muros_lancamento.py`). O módulo do Meshy tem
# ~16 mil triângulos e é a peça que mais se repete: com os cheios, o salão desenhava
# 1,74 milhão de triângulos por quadro e a sala de prova do Santuário passava de 2 milhões.
#   'caixa'  a baixa é a caixa da peça (12 triângulos): a parede de tijolo do salão, que
#            só mostra a face;
#   número   casca derrubada até esse tanto de triângulos: os muros do Santuário, que
#            têm recorte (os respiros do muro de Ar, as pedras do de Terra) e são vistos
#            dos dois lados.
# Ficam CHEIOS de propósito: a parede com esteio e a com tocha (pedra roliça com vãos e
# peça saliente; são ~20 cópias, não 80), a porta (uma cópia) e a colunata e o entulho da
# Câmara do Eco (18 cópias ao todo).
ENXUGA = {
    'sede': {'sd_parede_lisa': 'caixa', 'sd_parede_cortada': 'caixa'},
    'santuario': {'el_muro_fogo': 2000, 'el_muro_agua': 2000, 'el_muro_terra': 2000,
                  'el_muro_ar': 2000, 'el_pilar_vivo': 2000},
}


def blender(script, *args):
    cmd = [BLENDER, '--background', '--factory-startup', '--python',
           os.path.join(RAIZ, 'tools', script), '--'] + list(args)
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       creationflags=BAIXA)
    return r.stdout or ''


def caixa_do_glb(caminho):
    """(largura, altura, fundo) de um .glb pelos min/max do POSITION, sem Blender.
    Vale para as peças que os dois scripts exportam: uma malha, sem nó girado."""
    import json, struct
    with open(caminho, 'rb') as f:
        d = f.read()
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n].decode('utf-8'))
    lo, hi = [1e9] * 3, [-1e9] * 3
    for m in j.get('meshes', []):
        for p in m.get('primitives', []):
            a = j['accessors'][p['attributes']['POSITION']]
            for i in range(3):
                lo[i] = min(lo[i], a['min'][i]); hi[i] = max(hi[i], a['max'][i])
    return hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]


def main():
    a = sys.argv[1:]
    trab = a[a.index('--trabalho') + 1] if '--trabalho' in a else trabalho_padrao()
    so = a[a.index('--so') + 1] if '--so' in a else None
    print('pasta de trabalho:', trab)
    falhas = []
    for lote in ('sede', 'eco', 'santuario'):
        if so and so != lote:
            continue
        achadas = [p for p in glob.glob(os.path.join(DONO, '*')) if os.path.isdir(p)
                   and os.path.basename(p).lower() == PASTA[lote].lower()]
        if not achadas:
            print('FALTA a pasta do dono:', PASTA[lote]); falhas.append(lote); continue
        dono = achadas[0]
        base = os.path.join(trab, lote)
        if os.path.isdir(base):
            shutil.rmtree(base)
        print('\n=== %s  (%s)' % (lote, dono))
        # 1. copiar: a pasta do dono só se lê
        for sub, arqs in ORIGEM[lote].items():
            os.makedirs(os.path.join(base, sub))
            for rel, nome in arqs:
                de = os.path.join(dono, *rel.split('/'))
                if not os.path.exists(de):
                    print('  FALTA:', de); falhas.append(rel); continue
                shutil.copyfile(de, os.path.join(base, sub, nome or os.path.basename(de)))
        # 2. separar as folhas, normalizar os muros
        for sub in ORIGEM[lote]:
            pasta = os.path.join(base, sub)
            if sub == 'muros':
                saida = blender('normaliza_muros_lancamento.py', pasta, os.path.join(pasta, '_separado'))
                for l in saida.splitlines():
                    if l.startswith('MURO|'):
                        print('  ' + l)
            else:
                saida = blender('separa_pecas.py', pasta, '--recortar')
                for l in saida.splitlines():
                    if l.startswith('===') or l.strip().startswith(('patamar', 'sem patamar', 'fundindo',
                                                                    'dividindo', 'NÃO', '(contagem')):
                        print('  ' + l.strip())
        # 3. juntar com o nome do jogo
        pecas = os.path.join(trab, 'pecas', lote)
        if os.path.isdir(pecas):
            shutil.rmtree(pecas)
        os.makedirs(pecas)
        for origem, chave in sorted(DE_PARA[lote].items(), key=lambda kv: kv[1]):
            sub, nome = origem.split('/')
            de = os.path.join(base, sub, '_separado', nome + '.glb')
            if not os.path.exists(de):
                print('  FALTA a peça:', origem); falhas.append(chave); continue
            shutil.copyfile(de, os.path.join(pecas, chave + '.glb'))
            w, h, p = caixa_do_glb(de)
            print('  %-20s %.2f MB   larg %.3f  alt %.3f  fundo %.3f'
                  % (chave, os.path.getsize(de) / 1048576.0, w, h, p))
        # 4. enxugar os módulos de parede (a cheia fica guardada em pecas/<lote>/_cheio)
        if ENXUGA.get(lote):
            pares = ['%s:%s' % (c, a) for c, a in sorted(ENXUGA[lote].items())
                     if os.path.exists(os.path.join(pecas, c + '.glb'))]
            saida = blender('enxuga_muros_lancamento.py', pecas, *pares)
            feitas = [l for l in saida.splitlines() if l.startswith('ENXUTA|')]
            for l in saida.splitlines():
                if l.startswith('ENXUTA'):
                    print('  ' + l)
            if len(feitas) != len(pares):
                print('  ERRO: %d de %d paredes enxutas' % (len(feitas), len(pares)))
                falhas.append(lote + ': enxugar')
        # a trava da folha invertida: o `alto` da Câmara é o mais alto dos dois
        if lote == 'eco':
            alto = os.path.join(pecas, 'ce_pilar_quebrado.glb')
            baixo = os.path.join(pecas, 'ce_entulho.glb')
            if os.path.exists(alto) and os.path.exists(baixo):
                if caixa_do_glb(alto)[1] <= caixa_do_glb(baixo)[1]:
                    print('  ERRO: ce_pilar_quebrado saiu mais baixo que ce_entulho: a folha '
                          'veio na outra ordem; confira o DE_PARA do eco')
                    falhas.append('eco: ordem da folha')
    print('\npeças em:', os.path.join(trab, 'pecas'))
    if falhas:
        print('FALHAS:', ', '.join(falhas))
        sys.exit(1)
    print('agora: python tools/embute_cenario_lancamento.py --trabalho "%s"' % trab)


if __name__ == '__main__':
    main()
