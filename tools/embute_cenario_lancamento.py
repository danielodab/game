# -*- coding: utf-8 -*-
"""Embute os três cenários do lote do lançamento em arquivos JS do jogo.

Rodar (Python puro, depois do `prepara_cenario_lancamento.py`):
    python tools/embute_cenario_lancamento.py [--trabalho <pasta>] [--so sede|eco|santuario]

Escreve, cada um com o SEU catálogo (o nome `cenario-*.js` é obrigatório: no
jogo servido o `index.html` só lê a tabela `JOGO.CENARIO` dos `cenario-*.js`):

  assets/embedded/cenario-sede.js        JOGO.CENARIO['sede']        16 peças `sd_`
  assets/embedded/cenario-eco.js         JOGO.CENARIO['eco']          5 peças `ce_`
  assets/embedded/cenario-santuario.js   JOGO.CENARIO['santuario']   17 peças `el_`

OS TRÊS CATÁLOGOS NÃO SÃO DO MESMO TIPO, e é por isso que cada um tem a sua
tabela de papéis aqui embaixo:

· SEDE — o salão não é montado pela gramática de muro dos calabouços. O mapa
  (`js/core/data/arenas.js`, 'sede') diz o que cada bloco É (`pecas`: trono,
  pilar, mesa…) e o renderizador (`montaPecaDaSede`) procura no catálogo a peça
  do MESMO nome de papel. Por isso os papéis aqui são os do mapa. A variante
  (`pilar_rack_armas`, `bau_trofeu`) é o papel + `_` + o campo `arte` da peça
  no mapa: o cavalete de armas entra no lugar de um pilar e o troféu no lugar
  de um baú, cada um na altura do que substitui.

· ECO — a Câmara usa a gramática de sempre, mas só três papéis: `alto` (os
  pares de `#`), `baixo` (os `=`) e `borda`. Lá não há fileira de 3, então
  `pilar`, `marco`, `sotaque` e `sotaque_alto` nunca seriam chamados.

· SANTUÁRIO — a gramática de sempre, mais duas coisas que só ele tem:
    `regioes`  o muro (e o enfeite) de cada QUADRANTE. O mapa diz qual casa é
               de qual elemento (`regioes: [{x, y, w, h, elemento}]` na sala) e
               o renderizador, nas casas de uma região, troca a lista do papel
               pela daquela região. Papel com lista VAZIA numa região quer
               dizer "aqui não tem": o Fogo não tem pilar, então a fileira de
               lá segue só de muro, em vez de ganhar a coluna azul da Água.
               Casa fora de toda região (o centro) usa as listas gerais.
    `mecanica` as peças que o CÓDIGO do Santuário mexe (acende, gira, sobe).
               Estão aqui para descerem junto com o tema (o carregador baixa
               toda chave que aparece numa lista do catálogo) e para a frente
               do Santuário saber que existem. O pilar vivo só mora aqui e em
               `pilar_vivo`: é muro que sobe e desce, não enfeite.
  O MARCO (o Altar dos Quatro) é um tablado de 8 cm por 42: baixo e largo. Na
  gramática dos calabouços o marco SUBSTITUI um módulo de parede, e um tablado
  de 70 cm no lugar de um muro de 3,10 m mentiria para a regra (a casa bloqueia
  a visão e pareceria aberta). `marco_no_chao` manda o renderizador pôr o marco
  numa casa de enfeite de chão: a mais perto do centro da sala, uma vez só.

AS ALTURAS do braseiro (~1,4 m) e das colunas pedidas no PROMPTS_LANCAMENTO
não entram aqui: o renderizador põe todo `sotaque` a 0,95 m e todo
`sotaque_alto` a 3,10 m. Quem quiser outra altura é o código do Santuário.
"""
import io, os, sys, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMB = os.path.join(RAIZ, 'assets', 'embedded')


def trabalho_padrao():
    import tempfile
    return os.path.join(tempfile.gettempdir(), 'soterra_cenario_lancamento')


# ------------------------------------------------------------------ SEDE
SEDE = {
    'arquivo': 'cenario-sede.js', 'tema': 'sede',
    'cabecalho': [
        "/* SOTERRA - cenario da SALA DE GUERRA (o Salao da Sede, a guerra de guilda 2x2),",
        " * feito pelo dono: imagem no Gemini, depois imagem->3D no Meshy. Cinco modulos de",
        " * parede (lisa, com esteio, com tocha, cortada e a porta) e onze pecas de salao.",
        " * Os papeis sao os das `pecas` do mapa 'sede' (js/core/data/arenas.js); a variante",
        " * e papel + '_' + `arte`. O fogo, a luz, a chamine e o pano da bandeira sao do codigo.",
        " */",
    ],
    # (chave, nome, papel)
    'pecas': [
        ('sd_parede_lisa',    'Parede lisa do salão',                    'parede_salao'),
        ('sd_parede_esteio',  'Parede com esteio de carvalho',           'parede_esteio'),
        ('sd_parede_tocha',   'Parede com tocha apagada',                'parede_tocha'),
        ('sd_parede_cortada', 'Parede cortada, do lado da câmera',       'parede_cortada'),
        ('sd_porta',          'Porta do salão, de três casas',           'porta'),
        ('sd_trono',          'Trono no estrado, com o painel de carvalho', 'trono'),
        ('sd_lareira',        'Lareira de pedra com consolo, sem fogo',  'lareira'),
        ('sd_estandarte',     'Mastro do estandarte, sem o pano',        'estandarte'),
        ('sd_pilar',          'Pilar do salão',                          'pilar'),
        ('sd_rack_armas',     'Cavalete de armas',                       'pilar_rack_armas'),
        ('sd_armadura',       'Armadura no suporte, com alabarda',       'armadura'),
        ('sd_mesa',           'Mesa do conselho com o mapa de guerra em relevo', 'mesa'),
        ('sd_banco',          'Banco corrido',                           'banco_salao'),
        ('sd_estatua',        'Busto do fundador',                       'estatua'),
        ('sd_bau',            'Baú de carvalho com cintas de ferro',     'bau'),
        ('sd_trofeu',         'Pedestal de troféu com o crânio chifrudo', 'bau_trofeu'),
    ],
    'papeis': ['parede_salao', 'parede_esteio', 'parede_tocha', 'parede_cortada', 'porta',
               'trono', 'lareira', 'estandarte', 'pilar', 'pilar_rack_armas', 'armadura',
               'mesa', 'banco_salao', 'estatua', 'bau', 'bau_trofeu'],
}

# ------------------------------------------------------------------- ECO
ECO = {
    'arquivo': 'cenario-eco.js', 'tema': 'eco',
    'cabecalho': [
        "/* SOTERRA - cenario da CAMARA DO ECO (a arena do chefe supremo da semana), feito",
        " * pelo dono: a colunata partida e o entulho vestem os `#` e os `=` da camara, e tres",
        " * pecas ficam de fora, na beira do circulo. Ate 03/10 a camara vestia o kit do",
        " * Coracao Partido emprestado.",
        " */",
    ],
    'pecas': [
        ('ce_pilar_quebrado', 'Colunata partida com o lintel caído',     'alto'),
        ('ce_entulho',        'Entulho de tambores de coluna',           'baixo'),
        ('ce_borda_abismo',   'Rochedo da beira do abismo',              'borda'),
        ('ce_cristal_eco',    'Cristal com o núcleo do Eco dentro',      'borda'),
        ('ce_obelisco',       'Obelisco dos Seis, uma faixa por calabouço', 'borda'),
    ],
    'papeis': ['alto', 'baixo', 'borda'],
    # a colunata é vazada: sem ladrilho por baixo, cada casa de parede era um retângulo preto
    'extra': {'piso_sob_muro': True},
}

# ------------------------------------------------------------- SANTUÁRIO
SANTUARIO = {
    'arquivo': 'cenario-santuario.js', 'tema': 'santuario',
    'cabecalho': [
        "/* SOTERRA - kit do SANTUARIO DOS ELEMENTOS, feito pelo dono: um muro por",
        " * quadrante (fogo, agua, terra, ar), o pilar vivo, o Altar dos Quatro e onze",
        " * pecas de identidade e de mecanica. `regioes` da a cada quadrante o muro e os",
        " * enfeites dele; `mecanica` lista o que o codigo do Santuario acende, gira e sobe.",
        " */",
    ],
    # (chave, nome, [papéis])
    'pecas': [
        ('el_muro_fogo',    'Muro de basalto com o símbolo da chama',     ['alto', 'baixo']),
        ('el_muro_agua',    'Muro de pedra azul com o símbolo da onda',   ['alto', 'baixo']),
        ('el_muro_terra',   'Muro de arenito com musgo e raiz',           ['alto', 'baixo']),
        ('el_muro_ar',      'Muro de mármore claro com respiros',         ['alto', 'baixo']),
        ('el_pilar_vivo',   'Pilar vivo: o bloco que sobe e desce',       ['pilar_vivo']),
        ('el_marco_altar',  'Altar dos Quatro',                           ['marco']),
        ('el_estatua_cega', 'Estátua vendada com a lanterna fria',        ['sotaque_alto', 'borda']),
        ('el_agua_pilar',   'Coluna da maré, com craca na base',          ['pilar', 'sotaque_alto', 'borda']),
        ('el_menir',        'Menir com musgo e cristais',                 ['sotaque_alto', 'borda']),
        ('el_ar_pilar',     'Coluna de mármore gasta pelo vento',         ['pilar', 'sotaque_alto', 'borda']),
        ('el_bica',         'Bica de carranca, sem água',                 ['sotaque_alto']),
        ('el_cata_vento',   'Cata-vento de bronze',                       ['sotaque_alto']),
        ('el_braseiro',     'Braseiro de tripé, apagado',                 ['sotaque']),
        ('el_respiro',      'Respiro de vento',                           ['sotaque']),
        ('el_soquete',      'Soquete do pilar vivo',                      ['chao']),
        ('el_poca',         'Poça de água parada',                        ['chao']),
        ('el_ponte',        'Ponte de laje sobre a água',                 ['chao']),
    ],
    'papeis': ['alto', 'baixo', 'pilar', 'marco', 'sotaque_alto', 'sotaque', 'chao', 'borda',
               'pilar_vivo'],
    # o que o CÓDIGO do Santuário mexe (PROMPTS_LANCAMENTO, "peça de mecânica")
    'mecanica': ['el_braseiro', 'el_pilar_vivo', 'el_soquete', 'el_respiro', 'el_cata_vento',
                 'el_bica', 'el_poca', 'el_ponte'],
    # por elemento da região. Lista vazia = "este quadrante não tem este papel"
    'regioes': {
        'fogo':  {'alto': ['el_muro_fogo'], 'baixo': ['el_muro_fogo'], 'pilar': [],
                  'sotaque_alto': ['el_estatua_cega'], 'sotaque': ['el_braseiro'],
                  'chao': [], 'borda': ['el_estatua_cega']},
        'agua':  {'alto': ['el_muro_agua'], 'baixo': ['el_muro_agua'], 'pilar': ['el_agua_pilar'],
                  'sotaque_alto': ['el_agua_pilar', 'el_bica'], 'sotaque': [],
                  'chao': ['el_poca', 'el_ponte'], 'borda': ['el_agua_pilar']},
        'terra': {'alto': ['el_muro_terra'], 'baixo': ['el_muro_terra'], 'pilar': [],
                  'sotaque_alto': ['el_menir'], 'sotaque': [],
                  'chao': ['el_soquete'], 'borda': ['el_menir']},
        'ar':    {'alto': ['el_muro_ar'], 'baixo': ['el_muro_ar'], 'pilar': ['el_ar_pilar'],
                  'sotaque_alto': ['el_ar_pilar', 'el_cata_vento'], 'sotaque': ['el_respiro'],
                  'chao': [], 'borda': ['el_ar_pilar']},
    },
    # piso_sob_muro: os muros são lajes finas (15 a 30 cm numa casa de 2 m) e sem ladrilho
    #   por baixo a casa de parede lia como poço. enfeite_sobre_piso: a casa de enfeite fica
    #   com o ladrilho comum (o do kit é a grelha com brasa, que desmente a poça e a ponte).
    'extra': {'chao_alt': 0.4, 'marco_no_chao': True, 'piso_sob_muro': True,
              'enfeite_sobre_piso': True},
}

LOTES = {'sede': SEDE, 'eco': ECO, 'santuario': SANTUARIO}


def embute(nome_lote, lote, pasta):
    saida = os.path.join(EMB, lote['arquivo'])
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
    ] + lote['cabecalho'] + [
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.CENARIO = JOGO.CENARIO || {};",
        "JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};",
    ]
    papeis = dict((p, []) for p in lote['papeis'])
    total, faltando, presentes = 0, [], set()
    for chave, nome, papel in lote['pecas']:
        caminho = os.path.join(pasta, chave + '.glb')
        if not os.path.exists(caminho):
            faltando.append(chave)
            continue
        dados = open(caminho, 'rb').read()
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, base64.b64encode(dados).decode('ascii')))
        linhas.append("JOGO.CENARIO_NOME['%s']=%s;" % (chave, json.dumps(nome, ensure_ascii=False)))
        for p in (papel if isinstance(papel, list) else [papel]):
            papeis[p].append(chave)
        presentes.add(chave)
        total += len(dados)

    catalogo = dict(papeis)
    if 'mecanica' in lote:
        catalogo['mecanica'] = [c for c in lote['mecanica'] if c in presentes]
    if 'regioes' in lote:
        # peça que não chegou sai da região também: lista nunca aponta para o vazio
        catalogo['regioes'] = dict(
            (el, dict((p, [c for c in l if c in presentes]) for p, l in tab.items()))
            for el, tab in lote['regioes'].items())
    catalogo.update(lote.get('extra', {}))
    linhas.append("JOGO.CENARIO['%s']=%s;" % (lote['tema'], json.dumps(catalogo, ensure_ascii=False)))
    linhas.append("")
    io.open(saida, 'w', encoding='utf-8', newline='\n').write("\n".join(linhas))

    print("=== %s -> %s" % (nome_lote.upper(), lote['arquivo']))
    for p in lote['papeis']:
        print("  %-18s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binario %.2f MB - arquivo %.2f MB" % (total / 1048576.0, os.path.getsize(saida) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))
    # relevo e metal/rugosidade a 512, a cor fica em 1024 (docs/RECEBER_LOTE.md,
    # "A textura"). Sem isto, embutir de novo devolvia o arquivo inteiro a 1024.
    import reduz_texturas  # mora ao lado, em tools/
    reduz_texturas.reduz_arquivo(saida)
    return faltando


def main():
    a = sys.argv[1:]
    trab = a[a.index('--trabalho') + 1] if '--trabalho' in a else trabalho_padrao()
    so = a[a.index('--so') + 1] if '--so' in a else None
    faltou = []
    for nome_lote in ('sede', 'eco', 'santuario'):
        if so and so != nome_lote:
            continue
        pasta = os.path.join(trab, 'pecas', nome_lote)
        if not os.path.isdir(pasta):
            print("FALTA a pasta das pecas: %s (rode tools/prepara_cenario_lancamento.py)" % pasta)
            faltou.append(nome_lote)
            continue
        faltou += embute(nome_lote, LOTES[nome_lote], pasta)
    if faltou:
        sys.exit(1)


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
