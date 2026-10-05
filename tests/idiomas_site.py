#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova de navegador dos IDIOMAS no SITE e nas mensagens do servidor (05/10, etapa 3 — docs/IDIOMAS.md).

    python .wt/_ferramentas/vez.py idiomas3 --prazo 1200 -- python tests/idiomas_site.py [--fotos PASTA] [--sem-jogo]

Sobe o site (http.server da raiz) e a API de verdade (banco temporário, e-mails em arquivo de prova)
e abre um Chrome headless de perfil NOVO. Confere:
  1. EM PORTUGUÊS NADA MUDA: com o aparelho em português, o site abre em português, sem baixar
     dicionário nenhum, com o seletor no topo; e quem já tem rastro de jogo fica em português mesmo
     com o aparelho em outra língua.
  2. NAVEGADOR VIRGEM segue o aparelho (es-MX → espanhol) e grava a decisão na chave do jogo
     (`soterra-idioma`); `?lang=` vale sem gravar.
  3. O SELETOR: escolher English no site grava a chave, recarrega e a página sai em inglês
     (<html lang>, título, menu), sem frase estática sem tradução (SITE_I18N.falta vazio) em
     nenhuma página.
  4. O SERVIDOR: a recusa do login volta em inglês (o português fica em `erroPt`); a loja mostra
     os produtos em inglês com os mesmos preços; o e-mail do "esqueci a senha" pedido pela página
     em inglês sai em inglês, e o pedido em português segue em português.
  5. TERMOS e PRIVACIDADE traduzidos abrem com o aviso de que vale o português; em português, não.
  6. O CAMINHO COMBINADO: depois de escolher English no site, o JOGO abre com <html lang="en"> e a
     ficha das Configurações em inglês (pulado com --sem-jogo: o jogo leva minutos para abrir).
Com --fotos, grava as páginas em inglês (1280×720) e em espanhol (390×844, celular) e o texto de
cada uma (para olhar o que sobrou em português). O Chrome roda em prioridade baixa.
"""
import argparse
import base64
import functools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from santuario_navegador import CHROMES, Fila, Servidor, mata, sobe_chrome  # noqa: E402
from sessao_navegador import Nav  # noqa: E402

PAGINAS = ('index', 'conta', 'loja', 'termos', 'privacidade', 'eventos', 'ranking', 'fusoes', 'wiki')
FOTOS = ('index', 'conta', 'loja', 'termos')
# palavras que só o português tem (o espanhol divide muitas): servem para achar o que sobrou
SO_PT = re.compile(r'\b(você|não|são|está|estão|também|já|então|até|vinténs|calabouço|calabouços|feitiço|feitiços|senha|'
                   r'carregando|ainda|depois|quando|onde|aqui|seu|sua|seus|suas|pelo|pela|uma|com o|com a|para o|para a|'
                   r'do jogo|da conta|na conta|no jogo|nível|sessão|sessões|compra|presente|preço|grátis|saque|chefe|praça)\b', re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--porta', type=int, default=8149)
    ap.add_argument('--fotos', default='')
    ap.add_argument('--sem-jogo', action='store_true')
    args = ap.parse_args()
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome nesta máquina')
        return 2
    total = falhas = 0

    def check(nome, ok, extra=''):
        nonlocal total, falhas
        total += 1
        falhas += 0 if ok else 1
        print(('PASSOU' if ok else 'FALHOU') + ' · ' + nome + ('' if ok or extra == '' else ' — ' + str(extra)[:600]), flush=True)

    if args.fotos:
        os.makedirs(args.fotos, exist_ok=True)
    srv = Fila(('127.0.0.1', args.porta), functools.partial(Servidor, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pasta = tempfile.mkdtemp(prefix='soterra-idiomas-site-')
    banco = os.path.join(pasta, 'dados', 'soterra.db')
    emails = os.path.join(pasta, 'emails.jsonl')
    porta_api = porta_livre()
    base_api = 'http://127.0.0.1:%d' % porta_api
    log = open(os.path.join(pasta, 'api.log'), 'w', encoding='utf-8')
    api = subprocess.Popen([sys.executable, API, '--porta', str(porta_api), '--banco', banco, '--emails-prova', emails],
                           stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    proc = perfil = None
    try:
        check('a API sobe', espera_api(base_api, api))
        sufixo = str(int(time.time()) % 100000)
        nome = 'Lia Idioma ' + sufixo
        c = Cliente(base_api)
        c.cadastra(nome, email='lia%s@prova.test' % sufixo)
        check('a conta de prova nasce', bool(c.conta))
        site = 'http://127.0.0.1:%d/site/' % args.porta
        com_api = '?api=' + urllib.parse.quote(base_api, safe='')
        proc, perfil, cdp = sobe_chrome(chrome)
        nav = Nav(cdp)
        ua = None

        def aparelho(lingua):
            nonlocal ua
            if ua is None:
                nav.vai(site + 'termos.html?lang=pt')
                ua = nav.js('navigator.userAgent')
            cdp('Emulation.setUserAgentOverride', userAgent=ua, acceptLanguage=lingua)

        def limpa():
            nav.js("try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}; 1")

        def abre(pagina, extra=''):
            nav.vai(site + pagina + '.html' + com_api + extra)
            nav.ate("window.SITE && window.SITE_I18N && document.getElementById('idioma-sel')", 30)
            time.sleep(1.5)

        ESTADO = ("JSON.stringify({lang: document.documentElement.lang, idioma: window.JOGO && JOGO.I18n && JOGO.I18n.idioma,"
                  " origem: window.JOGO && JOGO.I18n && JOGO.I18n.origem, gravado: localStorage.getItem('soterra-idioma'),"
                  " titulo: document.title, menu: (document.querySelector('header.topo nav') || {}).innerText || '',"
                  " sel: (document.getElementById('idioma-sel') || {}).value || null,"
                  " opcoes: [].map.call(document.querySelectorAll('#idioma-sel option'), function (o) { return o.textContent; }),"
                  " falta: (window.SITE_I18N && SITE_I18N.falta) || [],"
                  " dic: [].filter.call(document.scripts, function (s) { return /i18n_(en|es)|erros_(en|es)|textos_|dados_/.test(s.src); }).length})")

        def estado():
            try:
                return json.loads(nav.js(ESTADO) or '{}')
            except Exception:
                return {}

        # ---- 1. em português nada muda
        aparelho('pt-BR')
        limpa()
        abre('index')
        e = estado()
        check('aparelho em português: o site abre em português, sem dicionário, com o seletor',
              e.get('lang') == 'pt-BR' and e.get('idioma') == 'pt' and e.get('dic') == 0 and e.get('sel') == 'pt' and
              e.get('opcoes') == ['Português', 'English', 'Español'] and 'Loja' in e.get('menu', '') and e.get('gravado') == 'pt', e)
        aparelho('en-US')
        limpa()
        nav.js("localStorage.setItem('soterra-save-v2', '{}'); 1")
        abre('index')
        e = estado()
        check('quem já joga neste navegador fica em português, mesmo com o aparelho em inglês',
              e.get('idioma') == 'pt' and e.get('lang') == 'pt-BR' and e.get('origem') == 'primeira', e)

        # ---- 2. navegador virgem segue o aparelho
        aparelho('es-MX')
        limpa()
        abre('index')
        e = estado()
        check('navegador virgem com o aparelho em espanhol: o site abre em espanhol e grava a chave do jogo',
              e.get('idioma') == 'es' and e.get('lang') == 'es' and e.get('gravado') == 'es' and 'Tienda' in e.get('menu', '') and
              e.get('falta') == [], e)
        abre('index', '&lang=en')
        e = estado()
        check('`?lang=en` vale para aquela abertura e não grava', e.get('idioma') == 'en' and e.get('gravado') == 'es' and e.get('origem') == 'url', e)

        # ---- 3. o seletor
        abre('index')
        nav.js("var s = document.getElementById('idioma-sel'); s.value = 'en'; s.dispatchEvent(new Event('change')); 1")
        time.sleep(2)
        nav.ate("document.readyState === 'complete' && window.SITE_I18N && document.getElementById('idioma-sel')", 30)
        time.sleep(1)
        e = estado()
        check('escolher English no seletor grava a chave, recarrega e a página sai em inglês',
              e.get('gravado') == 'en' and e.get('idioma') == 'en' and e.get('lang') == 'en' and e.get('origem') == 'escolha' and
              'Play' in e.get('menu', '') and 'Shop' in e.get('menu', '') and 'Loja' not in e.get('menu', ''), e)

        textos = {}

        def colhe(lg, movel):
            for pg in PAGINAS:
                abre(pg)
                if pg in ('loja', 'conta', 'ranking', 'eventos'):
                    time.sleep(2.5)
                st = estado()
                check('[%s] %s.html: <html lang>, e nenhuma frase estática sem tradução' % (lg, pg),
                      st.get('idioma') == lg and st.get('lang') == lg and st.get('falta') == [], st.get('falta') or st)
                txt = nav.js("document.body.innerText") or ''
                textos[lg + ':' + pg] = txt
                ruim = nav.js("document.body.innerText.match(/undefined|NaN|\\[object /) ? document.body.innerText.match(/.{0,40}(undefined|NaN|\\[object ).{0,20}/)[0] : ''")
                check('[%s] %s.html: sem undefined/NaN no texto' % (lg, pg), not ruim, ruim)
                if movel:
                    larga = nav.js("document.documentElement.scrollWidth > window.innerWidth + 2 ? document.documentElement.scrollWidth : 0")
                    check('[%s] %s.html no celular (390): a página não estoura para o lado' % (lg, pg), not larga, larga)
                if args.fotos and pg in FOTOS:
                    r = cdp('Page.captureScreenshot', format='png')
                    open(os.path.join(args.fotos, 'site_%s_%s.png' % (pg, lg)), 'wb').write(base64.b64decode(r['data']))

        cdp('Emulation.setDeviceMetricsOverride', width=1280, height=720, deviceScaleFactor=1, mobile=False)
        colhe('en', False)

        # ---- 4. o servidor em inglês
        def pede(rota, corpo):
            # o avalia do DevTools não espera promessa: o resultado fica numa variável da página
            nav.js("window.__r = null; SITE.api(%s, { method: 'POST', body: %s, semToken: true })"
                   ".then(function (r) { window.__r = JSON.stringify(r); }); 1" % (json.dumps(rota), json.dumps(corpo)))
            nav.ate("!!window.__r", 20)
            return json.loads(nav.js("window.__r") or '{}')

        r = pede('/api/login', {'login': nome, 'senha': 'senha-errada-99'})
        check('a recusa do login chega em inglês, e o português fica em erroPt',
              r.get('erroPt') == 'login ou senha errados' and r.get('erro') not in (None, '', r.get('erroPt')), r)
        abre('loja')
        time.sleep(3)
        loja = nav.js("JSON.stringify({nomes: [].map.call(document.querySelectorAll('#lj-catalogo h3, #lj-catalogo h4'), function (h) { return h.textContent; }),"
                      " precos: [].map.call(document.querySelectorAll('#lj-catalogo [data-moeda]'), function (p) { return p.textContent.replace(/\\D+/g, ''); })})")
        loja = json.loads(loja or '{}')
        cat = c.pede('GET', '/api/loja/catalogo', token=None)[1]
        precos_pt = sorted(str(i.get('preco')) for i in cat.get('itens', []))
        check('a loja em inglês mostra os produtos traduzidos (nenhum nome do catálogo em português)',
              len(loja.get('nomes', [])) > 10 and 'Welcome Pack' in loja['nomes'] and 'Warlock' in loja['nomes'] and
              not [n for n in loja['nomes'] if n in ('Pacote de Boas-Vindas', 'Bruxo', 'Caçador', 'Pergaminho da Reescrita', 'Aura de Brasa')] and
              len(cat.get('itens', [])) > 10, loja.get('nomes'))
        check('os preços da loja em inglês são os do servidor', bool(precos_pt) and all(p in loja.get('precos', []) for p in set(precos_pt)), (precos_pt[:8], loja.get('precos', [])[:8]))
        r = pede('/api/esqueci', {'email': 'lia%s@prova.test' % sufixo})
        time.sleep(2)
        linhas = [json.loads(x) for x in open(emails, encoding='utf-8').read().splitlines() if x.strip()] if os.path.exists(emails) else []
        check('o "esqueci a senha" pedido pela página em inglês: a resposta e o e-mail saem em inglês',
              r.get('ok') and 'code' in (r.get('mensagem') or '').lower() and linhas and
              linhas[-1]['assunto'] == 'SOTERRA: code to reset your password' and 'Hello, ' + nome in linhas[-1]['texto'], (r, linhas[-1:] ))
        c2 = Cliente(base_api)                    # outra conta: o servidor segura dois códigos seguidos para a mesma
        nome2 = 'Rui Idioma ' + sufixo
        c2.cadastra(nome2, email='rui%s@prova.test' % sufixo)
        c2.pede('POST', '/api/esqueci', {'email': 'rui%s@prova.test' % sufixo}, token=None)
        time.sleep(2)
        linhas = [json.loads(x) for x in open(emails, encoding='utf-8').read().splitlines() if x.strip()]
        check('o mesmo pedido sem idioma segue em português, como sempre', linhas[-1]['assunto'] == 'SOTERRA: código para redefinir a senha' and
              ('Olá, ' + nome2) in linhas[-1]['texto'], linhas[-1:])

        # ---- 5. os Termos
        abre('termos')
        av = nav.js("(document.getElementById('aviso-traducao') || {}).innerText || ''") or ''
        check('os Termos em inglês abrem com o aviso da tradução de cortesia e o caminho para o português',
              'Courtesy translation' in av and 'Portuguese' in av and bool(nav.js("!!document.querySelector('#aviso-traducao a[href*=\"lang=pt\"]')")), av)
        abre('termos', '&lang=pt')
        check('em português os Termos não têm aviso nenhum', not nav.js("!!document.getElementById('aviso-traducao')") and
              nav.js("document.documentElement.lang") == 'pt-BR')

        # ---- 6. o caminho combinado: English no site → o jogo em inglês
        if not args.sem_jogo:
            nav.vai('http://127.0.0.1:%d/index.html?graficos=baixa' % args.porta + '&api=' + urllib.parse.quote(base_api, safe=''))
            ok = nav.ate("!!(window.JOGO && JOGO.UI && JOGO.UI.openSheet && JOGO.I18n)", 300)
            j = json.loads(nav.js("JSON.stringify({lang: document.documentElement.lang, idioma: window.JOGO && JOGO.I18n && JOGO.I18n.idioma,"
                                  " origem: window.JOGO && JOGO.I18n && JOGO.I18n.origem,"
                                  " erros: window.JOGO && JOGO.I18n ? Object.keys(JOGO.I18n.dicionario().erros).length : 0})") or '{}')
            check('depois de escolher English no site, o jogo abre em inglês (<html lang="en">, sem perguntar)',
                  ok and j.get('lang') == 'en' and j.get('idioma') == 'en' and j.get('origem') == 'escolha' and j.get('erros', 0) > 400, j)
            nav.js("try { JOGO.UI.openSheet('config'); } catch (e) {}; 1")
            time.sleep(4)
            ficha = nav.js("(document.querySelector('.sheet.is-on, .sheet, #sheet, [data-sheet]') || document.body).innerText") or ''
            check('a ficha das Configurações do jogo está em inglês', 'Settings' in ficha and 'Game language' in ficha and 'Configurações' not in ficha, ficha[:200])
            check('no jogo, a recusa do servidor também chega traduzida', (nav.js("JOGO.I18n.erro('login ou senha errados')") or '') not in ('', 'login ou senha errados'))
            if args.fotos:
                r = cdp('Page.captureScreenshot', format='png')
                open(os.path.join(args.fotos, 'jogo_config_en.png'), 'wb').write(base64.b64decode(r['data']))

        # ---- o espanhol no celular
        nav.vai(site + 'termos.html?lang=pt')
        nav.js("localStorage.setItem('soterra-idioma', 'es'); 1")
        cdp('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=2, mobile=True)
        colhe('es', True)

        if args.fotos:
            with open(os.path.join(args.fotos, 'textos.json'), 'w', encoding='utf-8') as f:
                json.dump(textos, f, ensure_ascii=False, indent=1)
            # o que ainda tem cara de português na página em INGLÊS (para olhar; não reprova)
            with open(os.path.join(args.fotos, 'sobra_pt_en.txt'), 'w', encoding='utf-8') as f:
                for k in sorted(textos):
                    if not k.startswith('en:'):
                        continue
                    for linha in textos[k].split('\n'):
                        if SO_PT.search(linha):
                            f.write(k + '\t' + linha.strip()[:200] + '\n')
        for linha in cdp.console[:12]:
            print('   ' + linha)
    finally:
        try:
            if proc:
                cdp('Browser.close')
        except Exception:
            pass
        if proc:
            mata(proc, perfil)
        srv.shutdown()
        try:
            api.terminate()
            api.wait(10)
        except Exception:
            api.kill()
        log.close()
        shutil.rmtree(pasta, ignore_errors=True)
    print('\nRESUMO: ' + ('FALHOU %d de %d' % (falhas, total) if falhas else 'tudo passou (%d)' % total))
    return 1 if falhas else 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    sys.exit(main())
