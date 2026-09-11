#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A segunda visita desce quase nada? Depois de um deploy, só o que mudou? E no
rolling update do Coolify, nada fica preso no navegador?

    python tests/carga_prova.py            # o pacote do que está no disco (o próximo commit)
    python tests/carga_prova.py --head     # o pacote do último commit

Monta o pacote como tests/pacote_servido.py (a lista do tools/sobe_vps.py),
roda nele o servidor/coolify/versao.py (o passo do build: o js/versao.js e as
MARCAS ao lado da pasta servida) e serve com um http.server que manda o
Cache-Control DAS REGRAS DO CADDYFILE — lidas de servidor/coolify/Caddyfile e
imitadas aqui, porque o http.server do Python não manda cabeçalho de cache
nenhum. A revalidação (no-cache) é pela data (If-Modified-Since -> 304), que o
http.server já sabe responder.

A REGRA: endereço com hash (?v= dos scripts e folhas, ?h= dos modelos) fica um
ano no navegador SÓ quando existe a marca <pasta>-marcas/<arquivo>.<hash> que o
versao.py grava — isto é, quando o hash pedido é o do arquivo que ESTE servidor
tem. No rolling update o contêiner velho e o novo respondem juntos por uns
segundos: sem a marca, um pedido com o hash NOVO que caísse no velho levava o
conteúdo ANTIGO carimbado "um ano, sem perguntar", e o jogador ficava preso a um
main.js incompatível até limpar o cache. Por que marca por arquivo, e não a
build inteira no endereço (&b=): a build muda a cada deploy, e com ela TODO
endereço — o navegador baixaria de novo os 142 MB a cada push.

Abre o jogo TRÊS vezes no MESMO perfil do Chrome headless (prioridade baixa):
  1. a primeira visita: desce tudo;
  2. a segunda: o que tem hash no endereço vem do cache SEM NEM PERGUNTAR; o
     índice (index.html, manifesto) pergunta e ganha 304; só o js/versao.js
     desce (tem carimbo novo a cada visita) — quase nada;
  3. depois de um DEPLOY simulado (todos os arquivos com data nova, como num
     build do Coolify, e um script com conteúdo novo; versao.py de novo): desce
     o índice e o script que mudou, e nenhum outro script nem modelo.
Antes e depois do deploy pergunta ao servidor como no rolling update: o hash
NOVO no servidor velho, e o VELHO no novo, voltam no-cache.

Também confere a imitação nas duas Caddyfiles (a do contêiner e a do VPS),
com o hash deste servidor, o do outro contêiner, o carimbo e o índice.
"""
import argparse
import fnmatch
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.dont_write_bytecode = True
import pacote_servido as ps  # noqa: E402

IMUTAVEL = 'public, max-age=31536000, immutable'
NO_CACHE = 'no-cache'
MB = ps.MB

H = '3fa2b1c9d0e1'          # o hash que a pasta de marcas de mentira dos CASOS tem
OUTRO = '0123456789ab'      # um hash que não é o daqui (o do outro contêiner)
# as marcas da pasta de mentira dos CASOS; o índice também ganha marca, para
# provar que a regra dele vence mesmo assim
MARCAS_DOS_CASOS = ['js/main.js', 'vendor/three.min.js', 'css/style.css', 'site/site.css',
                    'assets/models/bundle/models-heroes/barbarian.glb',
                    'assets/models/bundle/tabelas/cenario-jardim.js',
                    'js/versao.js', 'assets/models/bundle/manifest.json', 'index.html']

# cada tipo de endereço e o cabeçalho que ele TEM de ganhar
CASOS = [
    # o hash é o do arquivo DESTE servidor (tem marca): um ano, sem perguntar
    ('/js/main.js?v=' + H, IMUTAVEL),
    ('/vendor/three.min.js?v=' + H, IMUTAVEL),
    ('/css/style.css?v=' + H, IMUTAVEL),
    ('/site/site.css?v=' + H, IMUTAVEL),
    ('/assets/models/bundle/models-heroes/barbarian.glb?h=' + H, IMUTAVEL),
    ('/assets/models/bundle/tabelas/cenario-jardim.js?v=' + H, IMUTAVEL),
    # o hash NÃO é o daqui — o rolling update (o mapa de um contêiner, o
    # arquivo do outro): revalida, e a visita seguinte se cura
    ('/js/main.js?v=' + OUTRO, NO_CACHE),
    ('/css/style.css?v=' + OUTRO, NO_CACHE),
    ('/assets/models/bundle/models-heroes/barbarian.glb?h=' + OUTRO, NO_CACHE),
    ('/js/main.js?h=' + OUTRO, NO_CACHE),
    # o carimbo do instante (o site mandava um novo a cada visita): não fica um ano
    ('/site/site.css?v=1757520000000', NO_CACHE),
    ('/js/main.js?v=1757520000000', NO_CACHE),
    # arquivo que este servidor nem tem (seria um 404 guardado por um ano)
    ('/js/core/nao-existe.js?v=' + H, NO_CACHE),
    # o índice sempre pergunta — mesmo com marca
    ('/index.html', NO_CACHE),
    ('/index.html?v=' + H, NO_CACHE),
    ('/index.html?conta=ana&gm=1', NO_CACHE),
    ('/js/versao.js?t=1757520000000', NO_CACHE),
    ('/js/versao.js?v=' + H, NO_CACHE),
    ('/assets/models/bundle/manifest.json?v=' + H, NO_CACHE),
    ('/site/', NO_CACHE),
    ('/site/ranking.html', NO_CACHE),
    ('/site/img/classe-sumo.webp', NO_CACHE),
    ('/js/main.js', NO_CACHE),
    ('/', NO_CACHE),
]


# ------------------------------------------------------ a imitação do Caddyfile
def _sem_comentario(linha):
    return re.sub(r'(^|\s)#.*$', '', linha).strip()


def _placeholders_ok(padrao):
    for nome in re.findall(r'\{([^{}]*)\}', padrao):
        if nome != 'path' and not re.fullmatch(r'query\.[\w-]+', nome):
            raise ValueError('placeholder que a imitação não conhece: {%s}' % nome)


def _matchers(texto):
    """Os matchers nomeados: {nome: [condição, ...]} — as condições de um nome
    valem juntas (E), como no Caddy. Entende a linha única `@nome query|path
    args...` e o bloco `@nome { query/path args... ; file { root X ; try_files
    P... } }`. O que não conhece é ValueError: melhor falhar que imitar errado."""
    linhas = [_sem_comentario(l) for l in texto.splitlines()]
    ms, i, n = {}, 0, len(linhas)

    def proxima(i):
        if i >= n:
            raise ValueError('bloco sem "}" no Caddyfile')
        return linhas[i].split()

    while i < n:
        m = re.match(r'^@(\w+)(?:\s+(.*))?$', linhas[i])
        i += 1
        if not m:
            continue
        nome, resto = m.group(1), (m.group(2) or '').strip()
        if resto != '{':
            t = resto.split()
            if not t or t[0] not in ('query', 'path'):
                raise ValueError('matcher que a imitação não conhece: @%s %s' % (nome, resto))
            ms[nome] = [(t[0], t[1:])]
            continue
        conds = []
        while True:
            t = proxima(i)
            i += 1
            if t == ['}']:
                break
            if not t:
                continue
            if t[0] in ('query', 'path') and len(t) > 1:
                conds.append((t[0], t[1:]))
            elif t == ['file', '{']:
                opcoes = {}
                while True:
                    u = proxima(i)
                    i += 1
                    if u == ['}']:
                        break
                    if not u:
                        continue
                    if u[0] not in ('root', 'try_files') or len(u) < 2:
                        raise ValueError('opção do file que a imitação não conhece: ' + ' '.join(u))
                    opcoes[u[0]] = u[1:]
                # sem root, o Caddy procuraria a marca na pasta SERVIDA
                if 'root' not in opcoes or 'try_files' not in opcoes:
                    raise ValueError('@%s: o file precisa de root e de try_files' % nome)
                for p in opcoes['try_files']:
                    _placeholders_ok(p)
                conds.append(('file', opcoes))
            else:
                raise ValueError('matcher que a imitação não conhece em @%s: %s' % (nome, ' '.join(t)))
        if not conds:
            raise ValueError('@%s vazio' % nome)
        ms[nome] = conds
    return ms


def raizes_das_marcas(texto):
    """As pastas (root) em que os matchers `file` do Caddyfile procuram a marca."""
    return sorted({c[1]['root'][0] for conds in _matchers(texto).values() for c in conds if c[0] == 'file'})


def _troca(padrao, caminho, query):
    def um(m):
        nome = m.group(1)
        return caminho if nome == 'path' else query.get(nome[len('query.'):], [''])[0]
    return re.sub(r'\{([^{}]*)\}', um, padrao)


def _casa(cond, caminho, query, marcas):
    tipo, args = cond
    if tipo == 'query':
        # chaves iguais: OU; chaves diferentes: E (a regra do Caddy)
        por_chave = {}
        for a in args:
            k, _, v = a.partition('=')
            por_chave.setdefault(k, []).append(v)
        for k, vals in por_chave.items():
            if k not in query:
                return False
            if not any(v == '*' or v in query[k] for v in vals):
                return False
        return True
    if tipo == 'path':
        c = caminho.lower()
        for p in args:
            p = p.lower()
            if '*' not in p:
                if c == p:
                    return True
            elif p.startswith('*') and '*' not in p[1:]:
                if c.endswith(p[1:]):
                    return True
            elif p.endswith('*') and '*' not in p[:-1]:
                if c.startswith(p[:-1]):
                    return True
            elif fnmatch.fnmatchcase(c, p):
                return True
        return False
    # file: a marca existe? O Caddy troca os placeholders ({path} decodificado,
    # {query.v}), limpa o caminho (path.Clean) e junta com a root sem deixar
    # sair dela. A root do Caddyfile é a pasta do servidor de verdade; aqui é
    # `marcas`, a pasta local que faz o papel dela.
    if marcas is None:
        return False
    for p in args['try_files']:
        rel = posixpath.normpath('/' + _troca(p, urllib.parse.unquote(caminho), query))
        if os.path.isfile(os.path.join(marcas, *[x for x in rel.split('/') if x])):
            return True
    return False


def regras_do_caddy(texto, marcas=None):
    """A imitação do Caddy para o bloco de cache de um Caddyfile.

    Os matchers nomeados (ver _matchers) e um `route { header [@nome]
    Cache-Control "valor" }`, executado na ordem escrita — vale o último header
    que casar. `marcas` é a pasta local que faz o papel da root do matcher
    `file` (sem ela, o file nunca casa). Devolve uma função caminho_com_query ->
    Cache-Control (ou None). Linha que a imitação não conhece é ValueError."""
    matchers = _matchers(texto)
    rota = re.search(r'(?ms)^\s*route\s*\{\s*$(.*?)^\s*\}\s*$', texto)
    if not rota:
        raise ValueError('não achei o route { } do cache')
    passos = []
    for linha in rota.group(1).splitlines():
        linha = _sem_comentario(linha)
        if not linha:
            continue
        m = re.match(r'^header\s+(?:@(\w+)\s+)?Cache-Control\s+"([^"]*)"$', linha)
        if not m:
            raise ValueError('linha do route que a imitação não conhece: ' + linha)
        if m.group(1) and m.group(1) not in matchers:
            raise ValueError('matcher sem definição: @' + m.group(1))
        passos.append((m.group(1), m.group(2)))

    def cabecalho(caminho_com_query):
        caminho, _, q = caminho_com_query.partition('?')
        query = {}
        for k, v in urllib.parse.parse_qsl(q, keep_blank_values=True):
            query.setdefault(k, []).append(v)
        valor = None
        for nome, v in passos:
            if nome is None or all(_casa(c, caminho, query, marcas) for c in matchers[nome]):
                valor = v
        return valor

    return cabecalho


def confere_caddyfile(texto):
    """Os casos em que a regra do Caddyfile dá o cabeçalho errado (lista vazia =
    certa), contra uma pasta de marcas de mentira com as MARCAS_DOS_CASOS."""
    with tempfile.TemporaryDirectory(prefix='soterra-marcas-') as marcas:
        for rel in MARCAS_DOS_CASOS:
            fis = os.path.join(marcas, *(rel + '.' + H).split('/'))
            os.makedirs(os.path.dirname(fis), exist_ok=True)
            open(fis, 'wb').close()
        try:
            regra = regras_do_caddy(texto, marcas=marcas)
        except ValueError as e:
            return ['não li: %s' % e]
        return ['%s dá %r (devia %r)' % (u, regra(u), esperado) for u, esperado in CASOS if regra(u) != esperado]


def bloco_de_cache(texto):
    """Os matchers e o route do cache, sem comentários e com a pasta das marcas
    trocada por <marcas> (cada Caddyfile tem a sua) — para comparar as duas."""
    saida, fundo = [], 0
    for l in texto.splitlines():
        l = _sem_comentario(l)
        if not l or not (fundo or re.match(r'^@\w+', l)):
            continue
        if fundo >= 2 and re.match(r'^root\s', l):
            l = 'root <marcas>'
        saida.append(l)
        fundo += l.count('{') - l.count('}')
    rota = re.search(r'(?ms)^\s*route\s*\{\s*$(.*?)^\s*\}\s*$', texto)
    corpo = [_sem_comentario(l) for l in rota.group(1).splitlines() if _sem_comentario(l)] if rota else []
    return saida + ['route'] + corpo


# ------------------------------------------------------------ as marcas do build
def pasta_de_marcas(raiz):
    """Onde o versao.py grava as marcas: ao lado da pasta servida."""
    return os.path.normpath(os.path.abspath(raiz)) + '-marcas'


def marcas_em(pasta):
    saida = set()
    for base, _, nomes in os.walk(pasta):
        for n in nomes:
            saida.add(os.path.relpath(os.path.join(base, n), pasta).replace(os.sep, '/'))
    return saida


def marcas_esperadas(raiz):
    """<arquivo>.<hash> de cada .js/.css do mapa e de cada modelo do manifesto."""
    man = json.loads(ps.ler(ps.MANIFESTO, raiz))
    return ({k + '.' + v for k, v in ps.mapa_do_build(raiz).items()} |
            {man['base'] + it['arquivo'] + '.' + it['hash'] for it in man['itens'] if it.get('hash')})


def cabecalho_de(base, caminho):
    """O Cache-Control que o servidor da prova manda num GET de verdade."""
    with urllib.request.urlopen(base.rstrip('/') + caminho, timeout=60) as r:
        r.read()
        return r.headers.get('Cache-Control')


def main():
    ap = argparse.ArgumentParser(description='a segunda visita e o deploy descem quase nada')
    ap.add_argument('--head', action='store_true', help='o pacote do último commit (não o do disco)')
    ap.add_argument('--budget', type=int, default=90000, help='tempo virtual do Chrome em ms')
    ap.add_argument('--por-cima', action='append', default=[], metavar='CAMINHO=ARQUIVO',
                    help='troca um arquivo do pacote antes do build (com --head: o commit mais SO '
                         'uma mudanca, sem as edicoes em andamento de outras rodadas); repetivel')
    a = ap.parse_args()

    for rel in ('servidor/coolify/Caddyfile', 'servidor/Caddyfile'):
        ruins = confere_caddyfile(ps.ler(rel))
        ps.check('a imitação de %s dá o cabeçalho certo a cada endereço — hash daqui, hash do outro contêiner, '
                 'carimbo, índice (%d casos)' % (rel, len(CASOS)), not ruins, '; '.join(ruins[:3]))

    chrome = ps.acha_chrome()
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2
    pasta = tempfile.mkdtemp(prefix='soterra-carga-')
    try:
        raiz, _, _, sv = ps.prepara(pasta, arvore=not a.head)
        if sv:
            print('  ' + sv)
        okc, svc = ps.por_cima(raiz, a.por_cima)
        if a.por_cima:
            print('  ' + svc[:300])
            if not okc:
                return 1
        marcas = pasta_de_marcas(raiz)
        esperadas = marcas_esperadas(raiz)
        tem = marcas_em(marcas) if os.path.isdir(marcas) else set()
        ps.check('o build gravou, ao lado da pasta servida, uma marca por endereço com hash (scripts, folhas, modelos)',
                 esperadas and tem == esperadas,
                 '%d marcas, %d esperadas; sobra %s; falta %s'
                 % (len(tem), len(esperadas), sorted(tem - esperadas)[:3], sorted(esperadas - tem)[:3]))
        regra = regras_do_caddy(ps.ler('servidor/coolify/Caddyfile'), marcas=marcas)
        registro = ps.Registro()
        srv, base = ps.servidor(raiz, registro, cache=regra)
        perfil = os.path.join(pasta, 'perfil')          # o MESMO perfil nas três visitas
        mudado = 'js/main.js'
        fis_mudado = os.path.join(raiz, *mudado.split('/'))
        cc = {}
        try:
            registro.fase = '1'
            i1 = ps.visita(chrome, perfil, base, a.budget)
            registro.fase = '2'
            i2 = ps.visita(chrome, perfil, base, a.budget)

            # ---- o ROLLING UPDATE, do lado do contêiner VELHO: o mapa novo já
            # saiu (o js/versao.js é no-cache) e o pedido com o hash novo caiu
            # no contêiner que ainda tem o arquivo antigo
            mapa1 = ps.mapa_do_build(raiz)
            with open(fis_mudado, 'rb') as f:
                novo = f.read() + b'\n// deploy simulado pela tests/carga_prova.py\n'
            h_velho, h_novo = mapa1.get(mudado), ps.impressao(novo)
            parado = next(k for k in sorted(mapa1) if k.startswith('js/core/') and k.endswith('.js'))
            registro.fase = 'sonda'
            cc['novo no velho'] = cabecalho_de(base, '/%s?v=%s' % (mudado, h_novo))
            cc['velho no velho'] = cabecalho_de(base, '/%s?v=%s' % (mudado, h_velho))

            # ---- o DEPLOY simulado: o build do Coolify clona o repositório de
            # novo, então TODO arquivo ganha data nova; e um script mudou
            with open(fis_mudado, 'wb') as f:
                f.write(novo)
            futuro = time.time() + 120
            for pasta_, _, nomes in os.walk(raiz):
                for n in nomes:
                    os.utime(os.path.join(pasta_, n), (futuro, futuro))
            r = subprocess.run([sys.executable, os.path.join(raiz, 'servidor', 'coolify', 'versao.py'), raiz],
                               capture_output=True, text=True, encoding='utf-8', errors='replace')
            ps.check('o versao.py roda de novo depois do "deploy"', r.returncode == 0, (r.stdout + r.stderr).strip()[:200])
            mapa2 = ps.mapa_do_build(raiz)

            # ---- e do lado do contêiner NOVO: um navegador que ainda leu o mapa
            # velho pede o hash velho
            cc['velho no novo'] = cabecalho_de(base, '/%s?v=%s' % (mudado, h_velho))
            cc['novo no novo'] = cabecalho_de(base, '/%s?v=%s' % (mudado, h_novo))
            cc['parado'] = cabecalho_de(base, '/%s?v=%s' % (parado, mapa2.get(parado)))
            registro.fase = '3'
            i3 = ps.visita(chrome, perfil, base, a.budget)
        finally:
            srv.shutdown()

        ps.check('rolling update: o contêiner VELHO que recebe o hash NOVO responde no-cache '
                 '(não guarda por um ano o main.js antigo no endereço novo)',
                 cc.get('novo no velho') == NO_CACHE, str(cc.get('novo no velho')))
        ps.check('rolling update: o contêiner NOVO que recebe o hash VELHO responde no-cache',
                 cc.get('velho no novo') == NO_CACHE, str(cc.get('velho no novo')))
        ps.check('cada contêiner guarda um ano o hash que é dele (o velho o velho, o novo o novo)',
                 cc.get('velho no velho') == IMUTAVEL and cc.get('novo no novo') == IMUTAVEL and mapa2.get(mudado) == h_novo,
                 'velho %s · novo %s' % (cc.get('velho no velho'), cc.get('novo no novo')))
        ps.check('o que não mudou mantém endereço E marca de um deploy para o outro (%s)' % parado,
                 mapa1.get(parado) == mapa2.get(parado) and cc.get('parado') == IMUTAVEL, str(cc.get('parado')))
        tem2 = marcas_em(marcas) if os.path.isdir(marcas) else set()
        ps.check('as marcas acompanham o deploy: as do build novo, e nenhuma do velho sobrando',
                 tem2 == marcas_esperadas(raiz) and (mudado + '.' + str(h_velho)) not in tem2,
                 '%d marcas' % len(tem2))

        for n, info in (('1', i1), ('2', i2), ('3', i3)):
            ps.check('visita %s: o jogo chega ao menu, com os modelos prontos' % n,
                     info.get('descer') and info.get('modelos_prontos'),
                     'boot %s ms' % info.get('boot_ms') if info.get('descer') else str(info)[:300])
        f1, f2, f3 = registro.da_fase('1'), registro.da_fase('2'), registro.da_fase('3')
        c1, c2, c3 = ps.contas(f1), ps.contas(f2), ps.contas(f3)
        print('  visita   desceu         200    304   pedidos')
        for n, c in (('1', c1), ('2', c2), ('3', c3)):
            print('  %-7s %9.2f MB %6d %6d %8d' % (n, c['total'] / MB, c['n200'], c['n304'], c['pedidos']))

        indice = ('/index.html', '/js/versao.js', '/' + ps.MANIFESTO)

        def marcados(fase):
            return sorted({p['caminho'] for p in fase if not p['caminho'].startswith('/__')
                           and p['caminho'] not in indice and re.search(r'(^|&)(v|h)=', p['query'])})

        ps.check('a primeira visita desce o jogo inteiro', c1['total'] > 50 * MB, '%.1f MB' % (c1['total'] / MB))
        ps.check('segunda visita: quase nada desce (menos de 1% da primeira e de 1 MB)',
                 c2['total'] < min(0.01 * c1['total'], MB), '%.1f KB' % (c2['total'] / 1024.0))
        m2 = marcados(f2)
        ps.check('segunda visita: nenhum endereço com hash nem foi pedido (veio do cache sem perguntar)',
                 not m2, ', '.join(m2[:5]))
        cod2 = {p['caminho']: p['codigo'] for p in f2}
        ps.check('segunda visita: o índice pergunta e ganha 304 (index.html e manifesto)',
                 cod2.get('/index.html') == '304' and cod2.get('/' + ps.MANIFESTO) == '304',
                 'index %s, manifesto %s' % (cod2.get('/index.html'), cod2.get('/' + ps.MANIFESTO)))

        desceu3 = [p for p in f3 if p['codigo'] == '200' and not p['caminho'].startswith('/__')]
        mudou = [p for p in desceu3 if p['caminho'] == '/' + mudado]
        ps.check('depois do deploy: o script que mudou desce, com endereço novo (o hash novo)',
                 mudou and ps._query(mudou[0]['query']).get('v') == h_novo,
                 mudou[0]['query'] if mudou else 'não desceu')
        outros = sorted({p['caminho'] for p in desceu3 if p['caminho'] not in indice and p['caminho'] != '/' + mudado
                         and (p['caminho'].endswith(('.js', '.css')) or p['caminho'].startswith('/assets/models/bundle/'))})
        ps.check('depois do deploy: nenhum outro script nem modelo desce (o que não mudou manteve o endereço)',
                 not outros, ', '.join(outros[:5]))
        ps.check('depois do deploy: desce pouco (menos de 2% da primeira visita)',
                 c3['total'] < 0.02 * c1['total'], '%.1f KB' % (c3['total'] / 1024.0))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    return ps.resumo()


if __name__ == '__main__':
    sys.exit(main())
