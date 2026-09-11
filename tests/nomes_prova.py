#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova da lei dos nomes — os DOIS lados no MESMO corpus.

    python tests/nomes_prova.py
    python tests/nomes_prova.py --casos minha_lista.json    # lista avulsa
    python tests/nomes_prova.py --tudo                      # imprime caso a caso
    python tests/nomes_prova.py --guilda                    # + tests/guilda*.html
    python tests/nomes_prova.py --sem-varredura             # pula os 1,1 milhão

O que ela faz:
  1. roda servidor/nomes.py sobre tests/nomes_casos.json;
  2. roda js/core/nomes.js sobre o MESMO corpus, abrindo tests/nomes.html num
     Chrome headless e lendo o despejo do DOM;
  3. reprova se algum veredito estiver errado E TAMBÉM se Python e JavaScript
     discordarem em QUALQUER caso — inclusive no normaliza() e na palavra
     reservada que cada um diz ter achado;
  4. compara as TABELAS dos dois arquivos (marcas, símbolos, homóglifos,
     leet, reservadas, acentos, espaços, motivos): é assim que a dupla não vai
     se separando calada com o tempo;
  5. SORTEIO: monta milhares de nomes com as peças do "_sorteio" do corpus (o
     mesmo gerador dos dois lados) e cobra a paridade, sem veredito;
  6. VARREDURA: o esqueleto de cada ponto de código, de U+0000 a U+10FFFF,
     resumido por faixa — um Chrome com Unicode mais novo que o Python do
     servidor aparece aqui, apontando a faixa, antes de virar brecha.

O DONO USA ESTA MÁQUINA enquanto os testes rodam: o Chrome sobe em PRIORIDADE
ABAIXO DO NORMAL, um de cada vez, com perfil descartável. A receita está aqui
dentro de propósito — teste do repositório não pode depender de scratchpad.

`--casos ARQUIVO.json` aceita o mesmo formato ({"bloquear": [...],
"liberar": [...]}) e imprime, caso a caso: nome, esperado, py, js. É a porta
para quem quiser atacar a regra com uma lista nova sem mexer no corpus.
"""
import argparse
import html as html_lib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.path.insert(0, os.path.join(RAIZ, 'servidor'))
import nomes as PY  # noqa: E402

CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']

FALHAS = []
CONTA = [0]


def check(nome, ok, extra=''):
    CONTA[0] += 1
    if not ok:
        FALHAS.append(nome)
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def caso(c):
    return {'nome': c} if isinstance(c, str) else dict(c)


def regua(c):
    return (c.get('minimo', 3) if isinstance(c.get('minimo'), int) else 3,
            c.get('maximo', 20) if isinstance(c.get('maximo'), int) else 20)


def vis(s):
    """o nome em ASCII para o terminal (invisível não pode sumir no relatório)"""
    if s is None:
        return 'None'
    return ''.join(ch if 32 <= ord(ch) < 127 else '<%04X>' % ord(ch) for ch in s)


# ---------------------------------------------------------------- o Chrome
def acha_chrome():
    for c in CHROMES:
        if os.path.exists(c):
            return c
    return None


def chrome_dom(chrome, url, budget=30000):
    """Abre a página no Chrome headless e devolve o despejo do DOM.
    PRIORIDADE BAIXA e perfil novo e descartável: o dono joga nesta mesma
    máquina enquanto a prova roda."""
    perfil = tempfile.mkdtemp(prefix='nomes-prova-')
    try:
        r = subprocess.run(
            [chrome, '--headless=new', '--disable-gpu', '--no-first-run',
             '--no-default-browser-check', '--user-data-dir=' + perfil,
             '--virtual-time-budget=%d' % budget, '--allow-file-access-from-files',
             '--dump-dom', url],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=900,
            creationflags=getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0))
        return r.stdout.decode('utf-8', 'replace')
    finally:
        shutil.rmtree(perfil, ignore_errors=True)


def roda_js(chrome, arquivo_na_pasta, varre):
    url = ('file:///' + os.path.join(AQUI, 'nomes.html').replace('\\', '/') +
           '?casos=' + arquivo_na_pasta + ('&varre=1' if varre else ''))
    dom = chrome_dom(chrome, url)
    m = re.search(r'(?s)<pre[^>]*\bid="dados"[^>]*>(.*?)</pre>', dom)
    if not m:
        return None, dom
    return json.loads(html_lib.unescape(m.group(1))), dom


# ------------------------------------------------------------- comparações
def compara_tabelas(tab_js):
    tab_py = PY.tabelas()
    iguais = True
    for chave in sorted(set(tab_py.keys()) | set(tab_js.keys())):
        a, b = tab_py.get(chave), tab_js.get(chave)
        if isinstance(a, list) and b is not None:
            b = [list(x) if isinstance(x, list) else x for x in b]
        if a != b:
            iguais = False
            print('    tabela "%s" difere:' % chave)
            if isinstance(a, list) and isinstance(b, list):
                so_py = [x for x in a if x not in b]
                so_js = [x for x in b if x not in a]
                print('      só no Python: %r' % (so_py[:12],))
                print('      só no JS:     %r' % (so_js[:12],))
            else:
                print('      py=%r' % (a,))
                print('      js=%r' % (b,))
    check('as tabelas dos dois arquivos são iguais (marcas, símbolos, homóglifos, '
          'leet, reservadas, acentos, espaços, motivos)', iguais)


def julga(c, esperado, ok, motivo, res, car):
    """O veredito de UM lado. Devolve None quando está certo, ou o porquê."""
    regra = c.get('regra', 'reservado' if esperado == 'bloquear' else 'livre')
    if esperado == 'liberar':
        if not ok:
            return 'devia passar e caiu (%s)' % motivo
        if res:
            return 'passou, mas reservado() disse "%s"' % res
        return None
    if ok:
        return 'devia cair e passou'
    if regra == 'reservado':
        if not res:
            return 'caiu, mas não pela reserva (%s)' % motivo
        return None
    esperados = {'caracteres': PY.MOTIVO_CARACTERES, 'pontas': PY.MOTIVO_PONTAS,
                 'letra': PY.MOTIVO_LETRA, 'vazio': PY.MOTIVO_VAZIO}
    if regra == 'tamanho':
        return None if 'caracteres' in motivo else 'motivo "%s" não é o do tamanho' % motivo
    alvo = esperados.get(regra)
    if alvo is not None and motivo != alvo:
        return 'motivo "%s" (esperado "%s")' % (motivo, alvo)
    if regra == 'caracteres' and car:
        return 'caracteres_ok devia ser falso'
    return None


def sorteia(cfg):
    """O MESMO gerador da página (MINSTD: 48271 mod 2^31-1)."""
    x = cfg['semente'] % 2147483647
    if x <= 0:
        x += 2147483646
    pecas = cfg['pecas']
    nomes = []
    for _ in range(cfg['quantos']):
        x = (x * 48271) % 2147483647
        k = 1 + x % 5
        s = ''
        for _j in range(k):
            x = (x * 48271) % 2147483647
            s += pecas[x % len(pecas)]
        nomes.append(s)
    return nomes


def compara_sorteio(cfg, js):
    nomes = sorteia(cfg)
    brigas = 0
    if len(js) != len(nomes):
        check('o JavaScript sorteou os mesmos %d nomes' % len(nomes), False,
              'veio %d' % len(js))
        return
    for i, n in enumerate(nomes):
        j = js[i]
        ok, motivo = PY.valida(n)
        py = [n, PY.normaliza(n), PY.reservado(n), PY.caracteres_ok(n), ok, motivo]
        jj = [j[0], j[1], j[2] or None, bool(j[3]), bool(j[4]), j[5] or '']
        if py != jj:
            brigas += 1
            if brigas <= 25:
                print('RUIM sorteio %d %s' % (i, vis(n)))
                for rot, a, b in zip(['nome', 'normaliza', 'reservado', 'caracteres_ok',
                                      'valida.ok', 'motivo'], py, jj):
                    if a != b:
                        print('       ! %s: py=%s js=%s' % (rot, vis(a) if isinstance(a, str) else a,
                                                         vis(b) if isinstance(b, str) else b))
    check('Python e JavaScript concordam nos %d nomes sorteados' % len(nomes), brigas == 0,
          '%d brigas' % brigas)


def varre_py():
    """o mesmo resumo da página: FNV-1a de 32 bits do esqueleto, por faixa de 256"""
    out = []
    for bl in range(0x110000 >> 8):
        h = 2166136261
        for cp in range(bl << 8, (bl << 8) + 256):
            if 0xD800 <= cp <= 0xDFFF:
                continue
            for ch in PY._cru(chr(cp)):
                h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
            h = ((h ^ 0x110000) * 16777619) & 0xFFFFFFFF
        out.append('%x' % h)
    return out


def compara_varredura(js):
    t0 = time.time()
    py = varre_py()
    ruins = [i for i in range(len(py)) if i >= len(js) or js[i] != py[i]]
    for i in ruins[:20]:
        print('       ! a faixa U+%04X..U+%04X tem esqueleto diferente nos dois lados'
              % (i << 8, (i << 8) + 255))
    check('o esqueleto de cada ponto de código (U+0000..U+10FFFF) é igual nos dois lados',
          not ruins and len(js) == len(py),
          '%d faixas diferentes (python %.1fs)' % (len(ruins), time.time() - t0))


def roda_pagina(chrome, arquivo, budget=30000):
    """Abre uma suíte DOM de tests/ e devolve a linha do #summary."""
    dom = chrome_dom(chrome, 'file:///' + os.path.join(AQUI, arquivo).replace('\\', '/'), budget)
    m = re.search(r'(?s)id="summary"[^>]*>(.*?)<', dom)
    return html_lib.unescape(m.group(1)).strip() if m else '(sem summary)'


def prova_guilda(chrome):
    """As bancadas da guilda continuam verdes com a regra dentro (uma de cada
    vez: o dono usa esta máquina)."""
    for arquivo in sorted(a for a in os.listdir(AQUI)
                          if a.startswith('guilda') and a.endswith('.html')):
        linha = roda_pagina(chrome, arquivo)
        check('tests/%s' % arquivo, linha.startswith('tudo passou'), linha)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--casos', help='arquivo .json com {"bloquear": [...], "liberar": [...]}')
    ap.add_argument('--tudo', action='store_true', help='imprime caso a caso')
    ap.add_argument('--guilda', action='store_true',
                    help='roda também as bancadas tests/guilda*.html')
    ap.add_argument('--sem-varredura', action='store_true',
                    help='pula a varredura dos 1,1 milhão de pontos de código')
    args = ap.parse_args()

    fonte = args.casos or os.path.join(AQUI, 'nomes_casos.json')
    if not os.path.exists(fonte):
        print('não achei o corpus: ' + fonte)
        return 2
    corpus = json.load(open(fonte, encoding='utf-8'))
    if 'bloquear' not in corpus or 'liberar' not in corpus:
        print('o corpus precisa das listas "bloquear" e "liberar"')
        return 2
    porCaso = bool(args.casos) or args.tudo
    varre = not args.sem_varredura and not args.casos

    lista = ([(c, 'bloquear') for c in corpus['bloquear']] +
             [(c, 'liberar') for c in corpus['liberar']])
    print('corpus: %s — %d para bloquear, %d para liberar'
          % (os.path.basename(fonte), len(corpus['bloquear']), len(corpus['liberar'])))

    chrome = acha_chrome()
    if not chrome:
        print('sem Chrome/Edge nesta máquina: a prova precisa dos DOIS lados')
        return 2

    # o Chrome só enxerga arquivo dentro de tests/ (a página resolve o
    # ?casos= ao lado dela); lista avulsa entra como cópia temporária
    temporario = None
    if args.casos and os.path.dirname(os.path.abspath(fonte)) != AQUI:
        temporario = os.path.join(AQUI, '_casos_prova_tmp.json')
        shutil.copyfile(fonte, temporario)
        nome_na_pasta = os.path.basename(temporario)
    else:
        nome_na_pasta = os.path.basename(fonte)

    t0 = time.time()
    try:
        despejo, dom = roda_js(chrome, nome_na_pasta, varre)
    finally:
        if temporario:
            try:
                os.remove(temporario)
            except OSError:
                pass
    print('(Chrome: %.1fs)' % (time.time() - t0))

    if despejo is None:
        print('o Chrome não devolveu o bloco de dados — o DOM veio assim:')
        print(dom[:1200])
        return 2
    check('o JavaScript leu o MESMO corpus (%d casos)' % len(lista),
          despejo.get('quantos') == len(lista) and 'bolso' not in despejo.get('fonte', ''),
          'fonte: %s, %s casos' % (despejo.get('fonte'), despejo.get('quantos')))
    compara_tabelas(despejo.get('tabelas') or {})

    jsCasos = despejo.get('casos') or []
    errados_py, errados_js, brigas = 0, 0, 0
    for i in range(min(len(lista), len(jsCasos))):
        c, esperado = lista[i]
        c = caso(c)
        minimo, maximo = regua(c)
        n = c['nome']
        okp, motivop = PY.valida(n, minimo, maximo)
        resp = PY.reservado(n)
        carp = PY.caracteres_ok(n)
        normp = PY.normaliza(n)
        j = jsCasos[i]

        problemas = []
        if j.get('nome') != n:
            problemas.append('o caso %d chegou trocado no JS (%s)' % (i, vis(j.get('nome'))))
        if j.get('norm') != normp:
            problemas.append('normaliza: py=%r js=%r' % (normp, j.get('norm')))
        if (j.get('res') or None) != resp:
            problemas.append('reservado: py=%r js=%r' % (resp, j.get('res')))
        if bool(j.get('car')) != bool(carp):
            problemas.append('caracteres_ok: py=%r js=%r' % (carp, j.get('car')))
        if bool(j.get('ok')) != bool(okp):
            problemas.append('valida.ok: py=%r js=%r' % (okp, j.get('ok')))
        if (j.get('motivo') or '') != motivop:
            problemas.append('motivo: py=%r js=%r' % (motivop, j.get('motivo')))
        if problemas:
            brigas += 1

        ruimPy = julga(c, esperado, okp, motivop, resp, carp)
        ruimJs = julga(c, esperado, bool(j.get('ok')), j.get('motivo') or '',
                       j.get('res') or None, bool(j.get('car')))
        if ruimPy:
            errados_py += 1
        if ruimJs:
            errados_js += 1

        if porCaso or problemas or ruimPy or ruimJs:
            marca = 'ok  ' if not (problemas or ruimPy or ruimJs) else 'RUIM'
            print('%s %-30s esperado=%-8s py=%-5s%-16s js=%-5s%-16s'
                  % (marca, vis(n), esperado, okp, '(' + str(resp) + ')',
                     j.get('ok'), '(' + str(j.get('res')) + ')'))
            for p in problemas:
                print('       ! ' + p)
            if ruimPy:
                print('       ! Python: ' + ruimPy)
            if ruimJs:
                print('       ! JavaScript: ' + ruimJs)

    check('o JavaScript devolveu um veredito por caso',
          len(jsCasos) == len(lista), '%d de %d' % (len(jsCasos), len(lista)))
    check('nenhum caso errado no Python', errados_py == 0, '%d errados' % errados_py)
    check('nenhum caso errado no JavaScript', errados_js == 0, '%d errados' % errados_js)
    check('Python e JavaScript concordam em TODOS os casos', brigas == 0,
          '%d brigas' % brigas)

    cfg = corpus.get('_sorteio')
    if cfg and cfg.get('pecas'):
        compara_sorteio(cfg, despejo.get('sorteio') or [])
    if varre:
        compara_varredura(despejo.get('varre') or [])

    if args.guilda:
        prova_guilda(chrome)

    print('')
    if FALHAS:
        print('FALHOU — %d de %d' % (len(FALHAS), CONTA[0]))
        for f in FALHAS:
            print('  · ' + f)
        return 1
    print('tudo passou (%d checagens sobre %d casos)' % (CONTA[0], len(lista)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
