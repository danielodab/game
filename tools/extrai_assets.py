#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — tira os modelos de dentro do JavaScript.

POR QUE ISTO EXISTE
-------------------
O jogo abre por `file://`, onde `fetch` de `.glb` falha. A saida foi embutir
todo modelo como base64 dentro de `assets/embedded/*.js`. Funciona — e custa:

  · base64 e ~33% MAIOR que o binario;
  · o motor de JS tem de INTERPRETAR o arquivo inteiro como codigo-fonte
    antes de a primeira linha rodar;
  · a string vive em UTF-16 na memoria, entao 28 MB de texto viram ~56 MB de
    heap, e o `atob` cria mais uma copia binaria por cima.

Num celular isso e uma tela preta de varios segundos. Este script escreve os
`.glb`/`.png` DE VERDADE em `assets/models/bundle/`, e `js/assets_bundle.js`
os busca por `fetch` quando o jogo esta servido (http:// ou dentro do APK),
caindo para o embutido quando o usuario abre o `index.html` com dois cliques.

O QUE ELE LE
------------
Os arquivos `assets/embedded/*.js` que tem `JOGO.ALVO['chave']='base64';`
(os outros devolvem zero itens e sao pulados sozinhos).

O QUE ELE ESCREVE
-----------------
  · `assets/models/bundle/<embutido>/<chave>.glb` — um binario por modelo;
  · `assets/models/bundle/manifest.json` — a lista, com o HASH do conteudo
    de cada item. O jogo pede cada modelo com `?h=<hash>`: modelo que nao
    mudou mantem o endereco de um deploy para o outro, e o navegador (o Caddy
    manda guardar por um ano) nao o baixa de novo. Antes era um carimbo
    `gerado` so para todos: qualquer extracao jogava os 134 MB fora do cache
    de todo jogador;
  · o GRUPO de cada item (`grupo`) e a soma por grupo (`grupos`): o jogo
    servido baixa so o grupo `base` antes do menu, e o resto na hora de
    descer (js/assets_bundle.js — CARGA SOB DEMANDA). Ver `grupo_de`;
  · `assets/models/bundle/tabelas/<embutido>.js` — o que um embutido define
    ALEM dos modelos (hoje: `JOGO.CENARIO` e `JOGO.CENARIO_NOME` dos
    `cenario-*.js`). Sem isto o jogo servido tinha de ler o `cenario-*.js`
    INTEIRO so pelas tabelas, e os modelos do cenario desciam em dobro — 16 MB
    de base64 da Estufa e 12 MB da Cisterna, alem dos binarios do bundle. A
    tabela e o embutido MENOS as atribuicoes de modelo, entao roda igual.

USO
---
    python tools/extrai_assets.py            # extrai e escreve o manifesto
    python tools/extrai_assets.py --conferir # so confere se esta em dia
"""

import base64
import binascii
import hashlib
import json
import os
import re
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEM = os.path.join(RAIZ, 'assets', 'embedded')
DESTINO = os.path.join(RAIZ, 'assets', 'models', 'bundle')
MANIFESTO = os.path.join(DESTINO, 'manifest.json')
TABELAS = 'tabelas'                       # subpasta de DESTINO

# Os arquivos que participam. `fx-atlas.js` e `fx-placas.js` ficam de fora de
# proposito: sao 0,8 MB somados, tem outro dono, e o ganho nao paga o conflito.
# A LISTA SE DERIVA DA PASTA, e nao e escrita a mao.
#
# Ela ERA escrita a mao, e o modo de falhar era silencioso e caro: quem
# acrescentasse um embutido novo tinha de lembrar de vir aqui, e esquecer nao
# dava erro nenhum — o modelo simplesmente caia no substituto generico quando o
# jogo rodasse SERVIDO, enquanto continuava certo em `file://` e em toda pagina
# de teste (que carregam o embutido direto). Foi exatamente o que aconteceu com
# os nove monstros da Estufa: implantados, testados, aprovados, e invisiveis no
# jogo servido por meio dia.
#
# Varrer a pasta e seguro: quem nao tiver `JOGO.MODELS`/`JOGO.ASSETS` dentro
# devolve zero itens e e pulado sozinho (`sons.js`, `fx-atlas.js`, `fx-anim.js`
# e `fx-placas.js` caem nesse caso).
def _fontes():
    todos = [f for f in os.listdir(ORIGEM) if f.endswith('.js')] if os.path.isdir(ORIGEM) else []
    return sorted(todos)

# JOGO.MODELS['barbarian']='Z2xU...';   /   JOGO.ASSETS['barrel'] = 'Z2xU...';
RE_ITEM = re.compile(
    r"JOGO\.(MODELS|ASSETS)\[\s*'([^']+)'\s*\]\s*=\s*'([A-Za-z0-9+/=\s']*?)'\s*;",
    re.S)
# JOGO.MESHY_CLIPS['meshy_sumo']=['idle','walk'];
RE_CLIPS = re.compile(r"JOGO\.MESHY_CLIPS\[\s*'([^']+)'\s*\]\s*=\s*\[([^\]]*)\]\s*;")

# Alguns embutidos quebram a string em pedacos concatenados com ' + ' para nao
# estourar o limite de linha do editor. Juntar e so tirar as aspas e o mais.
RE_COLA = re.compile(r"'\s*\+\s*'")

# A CASCA de todo embutido: o que sobra dele sem os modelos e NAO e tabela.
# Os clipes do Meshy tambem nao contam: o manifesto ja os leva (meshyClips) e
# o assets_bundle.js os aplica.
CASCA = {
    "var JOGO = (typeof window !== 'undefined')",
    "? (window.JOGO = window.JOGO || {})",
    ": (globalThis.JOGO = globalThis.JOGO || {});",
    "JOGO.MODELS = JOGO.MODELS || {};",
    "JOGO.ASSETS = JOGO.ASSETS || {};",
    "JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};",
}


# ------------------------------------------------------------------ os grupos
# CARGA SOB DEMANDA (10/09, "porque demora tanto?"): os 212 modelos desciam
# TODOS antes do menu. O grupo diz QUANDO cada um desce no jogo servido:
#   base              — antes do menu: o que o menu e o Acampamento mostram
#                       (herois, corpos das classes, pets, a praca, o kit do
#                       cenario, o banco de animacoes) e as 8 pecas do jardim
#                       que enfeitam a praca (hub3d.js, montaEnfeites);
#   calabouco:<id>    — o cenario e os monstros de um calabouco: descem na hora
#                       de descer, ou antes, na pre-busca dos ABERTOS;
#   classe:invocador  — o rebanho do Xama: desce com a dupla que o leva;
#   fusao:<a>+<b>     — o corpo da fusao do par (e o escudo, no Minotauro);
#   fusao:invocacoes  — as invocacoes das fusoes;
#   coroas            — as coroas 3D do ranking (o PNG segura o lugar);
#   fechados          — os bichos emprestados dos portais FECHADOS.
# O grupo e so o PRIMEIRO passo: o que uma descida baixa, o jogo decide lendo
# os dados de verdade (js/assets_bundle.js, B.plano). Embutido novo que nao
# esteja aqui cai na BASE — mais pesado, nunca invisivel.
GRUPO_DA_PASTA = {
    'env-kit': 'base', 'models-anims': 'base', 'models-heroes': 'base',
    'models-meshy': 'base', 'models-gm': 'base', 'models-pets': 'base',
    'models-praca': 'base', 'muro-escudo': 'base',
    'cenario-jardim': 'calabouco:greenhouse', 'models-meshy-jardim': 'calabouco:greenhouse',
    'cenario-cisterna': 'calabouco:cistern', 'models-meshy-cisterna': 'calabouco:cistern',
    'coroas-pvp-3d': 'coroas', 'models-meshy-sum': 'classe:invocador',
    'models-monsters': 'fechados', 'models-bosses': 'fechados', 'models-summons': 'fechados',
}
# as pecas do jardim que a PRACA planta (hub3d.js, montaEnfeites): sem elas o
# Acampamento abriria pelado
PRACA = {'jd_estufa_arvore', 'jd_vaso', 'jd_carrinho', 'jd_canteiro',
         'jd_escada', 'jd_tronco', 'jd_regador', 'jd_redoma'}
CLASSES = {'arqueiro', 'bruxo', 'curandeiro', 'espadachim', 'invocador', 'minotauro', 'sumo'}
RE_FUSAO = re.compile(r'^(?:fus|muro)_([a-z]+)_([a-z]+)$')


def grupo_de(pasta, chave):
    """O grupo de um modelo — quando ele desce no jogo servido."""
    if chave in PRACA:
        return 'base'
    if pasta.startswith('models-fus'):
        m = RE_FUSAO.match(chave)
        if m and m.group(1) in CLASSES and m.group(2) in CLASSES:
            a, b = sorted([m.group(1), m.group(2)])
            return 'fusao:%s+%s' % (a, b)
        return 'fusao:invocacoes'
    return GRUPO_DA_PASTA.get(pasta, 'base')


def impressao(bruto):
    """O hash curto do conteudo — o mesmo formato de servidor/coolify/versao.py."""
    return hashlib.sha256(bruto).hexdigest()[:12]


def extensao(bruto):
    """Descobre o formato pelo cabecalho — nao confia no nome."""
    if bruto[:4] == b'glTF':
        return '.glb'
    if bruto[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if bruto[:3] == b'\xff\xd8\xff':
        return '.jpg'
    if bruto[:1] == b'{':
        return '.gltf'
    return '.bin'


def sem_modelos(texto):
    """O embutido MENOS as atribuicoes de modelo: o que ele define alem deles.
    A linha que era so um modelo some inteira (nada de mil linhas em branco)."""
    marcado = RE_ITEM.sub('\0', texto)
    linhas = [l for l in marcado.split('\n') if l.strip() != '\0']
    return '\n'.join(linhas).replace('\0', '')


def tem_tabela(resto):
    """Sobrou alguma instrucao que nao e casca, comentario ou clipe do Meshy?"""
    s = re.sub(r'/\*.*?\*/', '', resto, flags=re.S)
    s = re.sub(r'(?m)^\s*//.*$', '', s)
    for linha in s.splitlines():
        linha = linha.strip()
        if not linha or linha in CASCA or RE_CLIPS.fullmatch(linha):
            continue
        return True
    return False


def texto_da_tabela(nome, resto):
    cabeca = (
        '// GERADO por tools/extrai_assets.py a partir de assets/embedded/%s — nao edite.\n'
        '// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle\n'
        '// (assets/models/bundle/%s/), e o index.html le daqui so as tabelas.\n'
        '// Em casa (file://) ele continua lendo o embutido inteiro.\n' % (nome, os.path.splitext(nome)[0]))
    corpo = resto.strip('\n') + '\n'
    return cabeca + corpo


def le_fonte(caminho):
    with open(caminho, 'r', encoding='utf-8') as f:
        texto = f.read()
    itens = []
    for m in RE_ITEM.finditer(texto):
        alvo, chave, b64 = m.group(1), m.group(2), m.group(3)
        limpo = RE_COLA.sub('', b64)
        limpo = re.sub(r'\s+', '', limpo)
        try:
            bruto = base64.b64decode(limpo)
        except (binascii.Error, ValueError) as e:
            raise SystemExit('base64 invalido em %s[%r]: %s' % (alvo, chave, e))
        itens.append((alvo, chave, bruto, len(limpo)))
    clipes = {}
    for m in RE_CLIPS.finditer(texto):
        clipes[m.group(1)] = re.findall(r"'([^']*)'", m.group(2))
    tabela = None
    if itens:
        resto = sem_modelos(texto)
        if tem_tabela(resto):
            tabela = resto
    return itens, clipes, tabela


def _le(caminho, modo='rb'):
    if not os.path.isfile(caminho):
        return None
    with open(caminho, modo) as f:
        return f.read()


def _bate_texto(caminho, texto):
    """O arquivo em disco tem este texto? Compara SEM o fim de linha, como o
    manifesto ja era conferido: com core.autocrlf=true um checkout pode trazer
    as tabelas (escritas em LF) em CRLF — o conteudo e o mesmo, e um .js em
    CRLF roda igual. (O .gitattributes tambem as fixa em LF.)"""
    atual = _le(caminho)
    return (atual is not None and
            atual.decode('utf-8', 'replace').replace('\r\n', '\n') == texto.replace('\r\n', '\n'))


def _manifesto_antigo():
    try:
        with open(MANIFESTO, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def principal(conferir=False):
    if not os.path.isdir(ORIGEM):
        raise SystemExit('nao achei %s' % ORIGEM)

    manifesto = {
        'gerado': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'ferramenta': 'tools/extrai_assets.py',
        'base': 'assets/models/bundle/',
        'itens': [],
        'meshyClips': {},
        'tabelas': {},
    }
    total_b64 = 0
    total_bin = 0
    escritos = 0
    faltando = []
    tabelas = {}                 # caminho relativo -> texto

    for nome in _fontes():
        caminho = os.path.join(ORIGEM, nome)
        if not os.path.isfile(caminho):
            print('  (pulando %s — nao existe)' % nome)
            continue
        pasta = os.path.splitext(nome)[0]
        itens, clipes, tabela = le_fonte(caminho)
        manifesto['meshyClips'].update(clipes)
        if tabela is not None:
            rel_tab = TABELAS + '/' + nome
            manifesto['tabelas'][nome] = rel_tab
            tabelas[rel_tab] = texto_da_tabela(nome, tabela)
        destino_pasta = os.path.join(DESTINO, pasta)
        if not conferir and itens:
            os.makedirs(destino_pasta, exist_ok=True)
        for alvo, chave, bruto, n_b64 in itens:
            ext = extensao(bruto)
            # a chave vira nome de arquivo: so o que sobrevive a qualquer sistema
            seguro = re.sub(r'[^A-Za-z0-9._-]', '_', chave)
            rel = pasta + '/' + seguro + ext
            fis = os.path.join(DESTINO, pasta, seguro + ext)
            total_b64 += n_b64
            total_bin += len(bruto)
            manifesto['itens'].append({
                'alvo': alvo, 'chave': chave, 'arquivo': rel, 'bytes': len(bruto),
                'hash': impressao(bruto), 'grupo': grupo_de(pasta, chave),
            })
            if conferir:
                if _le(fis) != bruto:
                    faltando.append(rel)
                continue
            if _le(fis) != bruto:
                with open(fis, 'wb') as f:
                    f.write(bruto)
                escritos += 1
        if itens:
            print('  %-28s %3d itens%s' % (nome, len(itens), '  + tabela' if tabela is not None else ''))

    manifesto['totalBytes'] = total_bin
    manifesto['totalBase64'] = total_b64
    grupos = {}
    for it in manifesto['itens']:
        g = grupos.setdefault(it['grupo'], {'itens': 0, 'bytes': 0})
        g['itens'] += 1
        g['bytes'] += it['bytes']
    manifesto['grupos'] = dict(sorted(grupos.items()))

    # O carimbo `gerado` so muda quando o CONTEUDO do manifesto muda: rodar de
    # novo sem mexer em nada nao deixa o manifest.json sujo no git.
    antigo = _manifesto_antigo()
    if antigo:
        a = dict(antigo)
        n = dict(manifesto)
        a.pop('gerado', None)
        n.pop('gerado', None)
        if a == n and antigo.get('gerado'):
            manifesto['gerado'] = antigo['gerado']

    if conferir:
        for rel_tab, texto in sorted(tabelas.items()):
            fis = os.path.join(DESTINO, *rel_tab.split('/'))
            if not _bate_texto(fis, texto):
                faltando.append(rel_tab)
        if antigo != manifesto:
            faltando.append('manifest.json')
        if faltando:
            print('FALTANDO/DIFERENTE %d arquivo(s): %s — rode python tools/extrai_assets.py'
                  % (len(faltando), ', '.join(faltando[:5])))
            return 1
        print('em dia — %d itens, %.2f MB, %d tabela(s)' % (
            len(manifesto['itens']), total_bin / 1048576.0, len(tabelas)))
        return 0

    # as tabelas: escreve as de agora e apaga as que nao nascem mais
    pasta_tab = os.path.join(DESTINO, TABELAS)
    if tabelas:
        os.makedirs(pasta_tab, exist_ok=True)
    for rel_tab, texto in sorted(tabelas.items()):
        fis = os.path.join(DESTINO, *rel_tab.split('/'))
        if not _bate_texto(fis, texto):
            with open(fis, 'wb') as f:
                f.write(texto.encode('utf-8'))
            escritos += 1
    if os.path.isdir(pasta_tab):
        for velho in os.listdir(pasta_tab):
            if (TABELAS + '/' + velho) not in tabelas:
                os.remove(os.path.join(pasta_tab, velho))
                print('  (tabela velha apagada: %s)' % velho)

    novo = json.dumps(manifesto, ensure_ascii=False, indent=1)
    cru = _le(MANIFESTO)
    if cru is None or cru.decode('utf-8', 'replace').replace('\r\n', '\n') != novo:
        # o fim de linha fica como estava no disco (o git normaliza sozinho)
        fim = '\r\n' if cru is not None and b'\r\n' in cru else '\n'
        with open(MANIFESTO, 'w', encoding='utf-8', newline=fim) as f:
            f.write(novo)

    print('')
    print('  itens ................ %d' % len(manifesto['itens']))
    print('  tabelas .............. %d (%s)' % (len(tabelas), ', '.join(sorted(manifesto['tabelas'])) or '-'))
    print('  arquivos reescritos .. %d' % escritos)
    print('  base64 no .js ........ %.2f MB' % (total_b64 / 1048576.0))
    print('  binario em disco ..... %.2f MB' % (total_bin / 1048576.0))
    print('  economia ............. %.2f MB (%.0f%%)' % (
        (total_b64 - total_bin) / 1048576.0,
        100.0 * (total_b64 - total_bin) / total_b64 if total_b64 else 0))
    print('  manifesto ............ %s' % os.path.relpath(MANIFESTO, RAIZ))
    for g, v in manifesto['grupos'].items():
        print('    grupo %-26s %3d itens %7.2f MB' % (g, v['itens'], v['bytes'] / 1048576.0))
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(principal('--conferir' in sys.argv))
