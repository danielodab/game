#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova de navegador de que SAIR É SAIR (04/10) e de que NO AR O JOGO EXIGE CONTA (06/10).

    python tests/sessao_navegador.py [--porta 8147] [--conta]

Na máquina compartilhada, rode pela VEZ do Chrome (uma prova de navegador por vez):
    python .wt/_ferramentas/vez.py sessao --prazo 1200 -- python tests/sessao_navegador.py

O relato do dono: "eu tava na conta admin, saí dela, cliquei em jogar e já logou na
minha outra conta... várias vezes com conta deslogada coloquei para jogar e ele abriu
uma sessão". Esta prova refaz o caminho dele, com a API DE VERDADE (servidor/api.py,
banco descartável), o site e o jogo servidos da raiz e UM perfil de Chrome para tudo
(as duas contas no mesmo navegador), dirigido pelo protocolo do DevTools — o site e o
jogo são páginas diferentes, e é a NAVEGAÇÃO entre elas que se prova:

  1. deslogado desde o começo, "Jogar" NÃO abre o jogo: cai na tela de entrar / criar conta
     sem baixar o jogo; a conta A entra ali mesmo e o jogo abre sozinho, na conta dela;
  2. A joga (o save sobe) e depois entra em outro aparelho;
  3. O RELATO: o Mestre (B) entra só no site, sai e clica "Jogar" — antes o jogo abria
     com os heróis e o nome de A; agora nem abre: é a tela de entrar;
  4. A volta (o save vem do servidor), sai, "Jogar": nada dela fica no navegador, e o
     token morreu no servidor mesmo com o "Jogar" clicado no mesmo instante do "sair";
  5. B joga (nunca com o save de A), sai, "Jogar"; o endereço do jogo direto; `?conta=2`;
  6. duas abas: sair numa encerra o jogo aberto na outra, que não regrava o save;
  7. o "Sair da conta" de dentro do jogo: sobe o que faltava, mata o token, limpa;
  8. a sessão que morre no servidor: com o jogo aberto, a capa e a volta ao jogo depois de
     entrar; antes de abrir, a tela de entrar — nunca o jogo sem conta;
  9. o save de VISITANTE que já existia neste navegador segue onde estava: ninguém o lê e
     ele não sobe para conta nenhuma.

"NO AR" EM 127.0.0.1: a regra do porteiro (index.html) é pelo endereço, e em casa não exige
conta. Esta prova serve o jogo com o js/versao.js dizendo `exigeConta: true` (a classe NoAr,
abaixo) — o campo que só o SERVIDOR manda e que só aperta a regra. Nenhum parâmetro de URL
liga nem desliga isso. A regra em si: tests/porteiro.js.

O Chrome roda em prioridade baixa e morre no fim (a árvore inteira), dê certo ou não.
"""
import argparse
import functools
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from santuario_navegador import CHROMES, Cdp, Fila, Servidor, mata, sobe_chrome  # noqa: E402

SENHA = 'segredo-bom-8'
# o save de um VISITANTE (o jogo sem conta de antes de 06/10), plantado no navegador
VISITA_CONTA = json.dumps({'jogador': {'id': 'J-VISITA', 'nome': 'Sem Conta'}})
VISITA_SAVE = json.dumps({'v': 2, 'visitante': True})
# O que o navegador guarda. `nome`, `codigo`, `save` e `nuvem` são os da conta local que ESTA
# página lê (no jogo, a do JOGO.Contas; no site, a Principal) — é o que o jogo mostra. `bruto` é
# o que está nas chaves da Principal, lido ou não: o save de uma conta com gravação que não
# subiu fica lá guardado, e o jogo sem sessão joga em outra conta local (js/core/contas.js).
GUARDADO = """(function () {
  function le(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return 'lixo'; } }
  function de(suf) {
    var c = le('soterra-conta-v1' + suf), n = le('soterra-nuvem-v1' + suf);
    return { save: !!localStorage.getItem('soterra-save-v2' + suf), nome: c && c.jogador ? (c.jogador.nome || null) : null,
             codigo: c && c.jogador ? c.jogador.id : null, nuvem: n ? n.conta : null, sujo: !!(n && n.sujo), versao: n ? n.versao : null };
  }
  var C = window.JOGO && window.JOGO.Contas, s = le('soterra-sessao'), chaves = [];
  for (var i = 0; i < localStorage.length; i++) chaves.push(localStorage.key(i));
  var r = de(C ? C.sufixo() : '');
  r.sessao = s ? { id: s.conta && s.conta.id, nome: s.conta && s.conta.nome, token: s.token } : null;
  r.local = C ? C.ativa() : null;
  r.bruto = de('');
  r.chaves = chaves.sort();
  return r;
})()"""
# o jogo desta página: está de pé? com que conta e com que nome?
JOGO_AGORA = """(function () {
  var J = window.JOGO || {};
  var tela = document.querySelector('#ui-root .is-on');
  var h = (J.Nuvem && J.Nuvem.historico) ? J.Nuvem.historico().map(function (x) { return x.tipo; }) : [];
  return { url: location.pathname + location.search + location.hash, origem: performance.timeOrigin,
           jogo: !!(J.UI && J.UI.openSheet && tela), sessao: !!(J.Sessao && J.Sessao.ativa && J.Sessao.ativa()),
           hist: h,
           derrubada: !!(J.Sessao && J.Sessao.derrubadaJa && J.Sessao.derrubadaJa()),
           portao: !!document.querySelector('[data-portao-conta]') };
})()"""


class NoAr(Servidor):
    """O servidor de arquivos desta prova: o mesmo de sempre, mas o js/versao.js que ele manda diz
    ao porteiro do index.html que este endereço EXIGE conta (como um domínio de verdade). E anota o
    que foi pedido, para se provar que quem não entrou não baixa o jogo."""
    pedidos = []
    VERSAO = (b"(typeof window !== 'undefined' ? window : globalThis).SOTERRA_VERSAO = "
              b"{ versao: 'dev', arquivos: {}, exigeConta: true };\n")

    def do_GET(self):
        caminho = self.path.split('?')[0]
        NoAr.pedidos.append(caminho)
        if caminho == '/js/versao.js':
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(self.VERSAO)))
            self.end_headers()
            self.wfile.write(self.VERSAO)
            return
        super().do_GET()


# o que só o JOGO pede: nada disto pode descer para quem não entrou
# (só o que a ABERTURA pede: o site também lê tabelas de js/core/, e um jogo que acabou de ser fechado ainda
# tem modelo sob demanda chegando — nada disso é o jogo abrindo)
PESADO = ('/js/assets_bundle.js', '/js/main.js', '/vendor/three.min.js', '/js/ui/hud.js', '/js/core/contas.js',
          '/js/core/nuvem.js', '/assets/models/bundle/manifest.json')


def pesados(desde=0):
    return [c for c in NoAr.pedidos[desde:] if c.startswith(PESADO)]


class Nav(object):
    """Uma aba do Chrome dirigida pelo DevTools."""
    def __init__(self, cdp):
        self.cdp = cdp
        cdp('Page.enable')
        cdp('Runtime.enable')

    def js(self, expr):
        # a página pode estar no meio de uma navegação: sem contexto, não há resposta
        try:
            return self.cdp.avalia(expr)
        except Exception:
            return None

    def vai(self, url):
        self.cdp('Page.navigate', url=url)
        self.ate("document.readyState === 'complete'", 60)

    def ate(self, expr, prazo=30):
        fim = time.time() + prazo
        while time.time() < fim:
            if self.js(expr):
                return True
            time.sleep(0.25)
        return False

    def assenta(self, prazo=240, quieto=5):
        """Espera a página PARAR: o jogo (ou o site) de pé, a mesma página por `quieto` s — a
        Nuvem recarrega o jogo ao adotar o save do servidor — e, com sessão, a Nuvem já
        conversada com o servidor. Devolve o JOGO_AGORA do fim."""
        fim = time.time() + prazo
        igual, desde, r = None, 0, None
        while time.time() < fim:
            time.sleep(0.5)
            r = self.js(JOGO_AGORA)
            if not r or self.js("document.readyState") != 'complete':
                igual = None
                continue
            marca = (r['origem'], r['url'])
            if marca != igual:
                igual, desde = marca, time.time()
                continue
            no_jogo = r['url'].split('?')[0].split('#')[0].endswith('/index.html') and '/site/' not in r['url']
            pronto = (not no_jogo) or r['portao'] or r['derrubada'] or (r['jogo'] and (
                not r['sessao'] or any(t in r['hist'] for t in ('emdia', 'subiu', 'erro'))))
            if pronto and time.time() - desde >= quieto:
                return r
        return r


def nova_aba(porta, url='about:blank'):
    req = urllib.request.Request('http://127.0.0.1:%s/json/new?%s' % (porta, url), method='PUT')
    alvo = json.loads(urllib.request.urlopen(req).read())
    return Nav(Cdp(alvo['webSocketDebuggerUrl']))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--porta', type=int, default=8147)
    ap.add_argument('--conta', action='store_true', help='imprime o estado de cada passo (para investigar)')
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
        print(('PASSOU' if ok else 'FALHOU') + ' · ' + nome + ('' if ok or extra == '' else ' — ' + str(extra)), flush=True)

    def conta(rotulo, *coisas):
        if args.conta:
            print('   [' + rotulo + '] ' + ' | '.join(json.dumps(c, ensure_ascii=False) for c in coisas), flush=True)

    srv = Fila(('127.0.0.1', args.porta), functools.partial(NoAr, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pasta = tempfile.mkdtemp(prefix='soterra-sessao-nav-')
    banco = os.path.join(pasta, 'dados', 'soterra.db')
    porta_api = porta_livre()
    base_api = 'http://127.0.0.1:%d' % porta_api
    log = open(os.path.join(pasta, 'api.log'), 'w', encoding='utf-8')
    api = subprocess.Popen([sys.executable, API, '--porta', str(porta_api), '--banco', banco,
                            '--emails-prova', os.path.join(pasta, 'emails.jsonl')],
                           stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    proc = perfil = None
    try:
        check('a API sobe', espera_api(base_api, api))
        sufixo = str(int(time.time()) % 100000)
        nome_a, nome_b = 'Ana Prova ' + sufixo, 'Bia Prova ' + sufixo
        ca, cb = Cliente(base_api), Cliente(base_api)
        ra, rb = ca.cadastra(nome_a), cb.cadastra(nome_b)
        check('as duas contas nascem', bool(ca.conta and cb.conta), (ra, rb))
        b = sqlite3.connect(banco)
        b.execute("UPDATE contas SET gm = 1 WHERE id = ?", (cb.conta['id'],))      # B é a conta do Mestre
        b.commit()
        b.close()
        ida, idb = ca.conta['id'], cb.conta['id']
        fora = Cliente(base_api)

        def vale(token):
            return fora.pede('GET', '/api/eu', token=token)[0] == 200

        marca = 0
        site = 'http://127.0.0.1:%d/site/' % args.porta
        jogo = 'http://127.0.0.1:%d/index.html' % args.porta
        com_api = '?api=' + urllib.parse.quote(base_api, safe='')
        proc, perfil, cdp = sobe_chrome(chrome)
        porta_cdp = open(os.path.join(perfil, 'DevToolsActivePort')).read().split()[0]
        nav = Nav(cdp)

        def preenche(nome):
            nav.ate("document.getElementById('e-login') && window.SITE", 30)
            nav.js("document.getElementById('aba-entrar').click();"
                   "document.getElementById('e-login').value = %s;"
                   "document.getElementById('e-senha').value = %s;"
                   "document.getElementById('e-bt').click(); 1" % (json.dumps(nome), json.dumps(SENHA)))

        def entra(nome):
            """Entra pela página da conta, aberta por conta própria: fica nela (a marca de volta ao
            jogo, que o porteiro deixa na aba, é de quem veio do jogo — aqui ela sai antes)."""
            nav.js("sessionStorage.removeItem('soterra-volta-jogo'); 1")
            nav.vai('about:blank')                        # da tela de entrar para ela mesma não recarregaria
            nav.vai(site + 'conta.html' + '#entrar')
            preenche(nome)
            ok = nav.ate("window.SITE && SITE.sessao() && SITE.sessao().conta.nome === %s" % json.dumps(nome), 30)
            return ok and nav.js("SITE.sessao().token")

        def clica_jogar():
            nav.js("document.querySelector('header.topo a.jogar').click(); 1")
            return nav.assenta()

        def sai_e_joga(antes=''):
            """O "sair" do topo e o "Jogar" no MESMO instante — o caminho do relato."""
            nonlocal marca
            nav.vai(site + 'index.html')
            nav.ate("document.getElementById('bt-sair')", 30)
            marca = len(NoAr.pedidos)
            nav.js(antes + "document.getElementById('bt-sair').click(); document.querySelector('header.topo a.jogar').click(); 1")
            return nav.assenta()

        def na_porta(r):
            return bool(r) and not r['jogo'] and r['url'].split('#')[0].endswith('/site/conta.html')

        def nada_de(r, g, quem, desde):
            """Depois de sair: nenhuma sessão, e o jogo NÃO abre — é a tela de entrar, sem nada do
            jogo baixado."""
            check(quem + ': o navegador não guarda sessão', bool(g) and g['sessao'] is None, g)
            check(quem + ': "Jogar" não abre o jogo — cai na tela de entrar', na_porta(r), r)
            check(quem + ': nada do jogo desce para quem não entrou', not pesados(desde), pesados(desde)[:6])

        def sobe(nome):
            nav.js("JOGO.DB.batizar(%s); JOGO.Nuvem.empurrar(); 1" % json.dumps(nome))
            return nav.ate("JOGO.Nuvem.historico().filter(function (x) { return x.tipo === 'subiu'; }).length > 0 && "
                           "!JOGO.Nuvem.estado().pendente && JOGO.Nuvem.estado().erro === null", 60)

        # ---- 1. deslogado desde o começo: o jogo não abre — a tela de entrar, e de lá para o jogo
        nav.vai(site + 'index.html' + com_api)            # a API de casa fica lembrada (só em 127.0.0.1)
        # um save de VISITANTE de antes da regra (o jogo sem conta que existia): fica onde está
        nav.js("localStorage.setItem('soterra-conta-v1:visitante', %s);"
               "localStorage.setItem('soterra-save-v2:visitante', %s); 1" % (json.dumps(VISITA_CONTA), json.dumps(VISITA_SAVE)))
        marca = len(NoAr.pedidos)
        r = clica_jogar()
        g = nav.js(GUARDADO)
        conta('1 deslogado', r, g)
        check('deslogado, "Jogar" não abre o jogo: cai na tela de entrar / criar conta', na_porta(r) and r['url'].endswith('#entrar'), r)
        check('deslogado, nenhuma sessão nasce', bool(g) and g['sessao'] is None, g)
        check('deslogado, nada do jogo desce (nem o carregador de modelos, nem o código)', not pesados(marca), pesados(marca)[:6])
        check('a tela diz por que está ali', 'Para jogar' in (nav.js("document.getElementById('e-aviso').textContent") or ''))
        check('a marca de volta não foi para o endereço (fica na aba, lida uma vez pela página)',
              'volta' not in r['url'] and nav.js("sessionStorage.getItem('soterra-volta-jogo')") is None)
        preenche(nome_a)                                  # A entra ALI MESMO: o jogo abre sozinho
        r = nav.assenta()
        g = nav.js(GUARDADO)
        conta('1 A entrou pela porta', r, g)
        token_a = g and g['sessao'] and g['sessao']['token']
        check('depois de entrar, o jogo abre sozinho na conta de A',
              bool(r) and r['jogo'] and r['sessao'] and bool(g) and bool(g['sessao']) and g['sessao']['id'] == ida
              and g['local'] == 'principal', (r, g))
        check('A não recebe o save do visitante', bool(g) and g.get('nome') != 'Sem Conta', g)

        # ---- 2. A joga; depois a conta dela entra em OUTRO aparelho (o celular)
        check('A entrou', bool(token_a))
        check('o save de A sobe', sobe('Heroi de A'))
        g = nav.js(GUARDADO)
        codigo_a = g and g['codigo']
        check('o save no disco é o de A', bool(g) and g['nuvem'] == ida and g['nome'] == 'Heroi de A', g)
        celular = Cliente(base_api)
        check('A entra no celular', celular.pede('POST', '/api/login', {'login': nome_a, 'senha': SENHA})[0] == 200)
        nav.vai(site + 'conta.html')
        check('no computador a sessão de A cai (a conta fica em um aparelho só)',
              nav.ate("window.SITE && !SITE.sessao()", 30) and not vale(token_a))

        # ---- 3. O RELATO: o Mestre entra só no site, sai, e clica "Jogar"
        token_b = entra(nome_b)
        check('B (o Mestre) entra no site', bool(token_b))
        r = sai_e_joga()
        g = nav.js(GUARDADO)
        conta('3 B saiu sem jogar e clicou Jogar', r, g)
        nada_de(r, g, 'o Mestre saiu', marca)
        time.sleep(1.5)
        check('o Mestre saiu: o token dele morreu no servidor (mesmo com o "Jogar" no mesmo clique)', not vale(token_b))

        # ---- 4. A volta, reencontra o save, sai, "Jogar"
        token_a = entra(nome_a)
        check('A entra de novo', bool(token_a))
        r = clica_jogar()
        g = nav.js(GUARDADO)
        conta('4 A de volta', r, g)
        check('A de volta: o save dela veio do servidor (o nome e o código de jogador)',
              bool(r) and r['jogo'] and r['sessao'] and bool(g) and g['nome'] == 'Heroi de A'
              and g['codigo'] == codigo_a and g['nuvem'] == ida, (r, g))
        r = sai_e_joga()
        g = nav.js(GUARDADO)
        conta('4 A saiu e clicou Jogar', r, g)
        nada_de(r, g, 'A saiu', marca)
        time.sleep(1.5)
        check('A saiu: o save dela (em dia com o servidor) saiu do disco',
              bool(g) and not g['bruto']['save'] and g['bruto']['nome'] is None and g['bruto']['nuvem'] is None, g)
        check('A saiu: o token dela morreu no servidor', not vale(token_a))

        # ---- 5. B entra e joga: nunca o save de A; sai, "Jogar"; o endereço direto; ?conta=
        token_b = entra(nome_b)
        check('B entra no site', bool(token_b))
        r = clica_jogar()
        g = nav.js(GUARDADO)
        conta('5 B joga', r, g)
        check('B logada: o jogo abre com a sessão de B', bool(r) and r['jogo'] and r['sessao'] and g['sessao']['id'] == idb, (r, g))
        check('B não recebe o save de A (nem o nome, nem o código de jogador)',
              bool(g) and g['nome'] != 'Heroi de A' and g['codigo'] != codigo_a and g['nuvem'] == idb, g)
        check('o save de B sobe', sobe('Heroi de B'))
        codigo_b = nav.js(GUARDADO)['codigo']
        # a Nuvem quieta antes de sair: uma subida no meio do caminho chegaria ao servidor sem o navegador
        # saber (a página indo embora), e na volta o servidor mandaria — outro caminho, que não é o deste passo
        nav.ate("(function () { var n = JSON.parse(localStorage.getItem('soterra-nuvem-v1') || 'null'), e = JOGO.Nuvem.estado();"
                " return !!n && !n.sujo && !e.pendente && !e.subindo; })()", 30)
        conta('5 B subiu', nav.js(GUARDADO), fora.pede('GET', '/api/save', token=token_b)[1].get('versao'))
        # B sai com gravação que NÃO subiu (o servidor estava fora na hora): o save fica guardado
        # para ela, e ninguém sem sessão o lê (o jogo nem abre)
        r = sai_e_joga("var n = JSON.parse(localStorage.getItem('soterra-nuvem-v1')); n.sujo = true;"
                       "localStorage.setItem('soterra-nuvem-v1', JSON.stringify(n));")
        g = nav.js(GUARDADO)
        conta('5 B saiu e clicou Jogar', r, g)
        nada_de(r, g, 'A saiu, B entrou e saiu', marca)
        check('B saiu com gravação pendente: o save fica guardado para ela',
              bool(g) and g['bruto']['nome'] == 'Heroi de B' and g['bruto']['nuvem'] == idb and g['bruto']['sujo']
              and g['bruto']['codigo'] == codigo_b, g)
        time.sleep(1.5)
        check('B saiu: o token dela morreu no servidor', not vale(token_b))
        nav.vai(jogo)
        r = nav.assenta()
        g = nav.js(GUARDADO)
        conta('5 jogo direto', r, g)
        nada_de(r, g, 'deslogado, o endereço do jogo direto', marca)
        nav.vai(jogo + '?conta=2&sandbox=1&app=1')
        r = nav.assenta()
        g = nav.js(GUARDADO)
        conta('5 ?conta=2', r, g)
        nada_de(r, g, 'deslogado, `?conta=2&sandbox=1&app=1` (parâmetro nenhum abre)', marca)
        check('a conta local 2 nem nasceu', bool(g) and not any(c.endswith(':2') for c in g['chaves']), g and g['chaves'])

        # ---- 6. duas abas: o jogo aberto numa, o sair na outra
        token_b2 = entra(nome_b)
        conta('6 B entrou no site', nav.js(GUARDADO), fora.pede('GET', '/api/save', token=token_b2)[1].get('versao'))
        marca = len(NoAr.pedidos)
        r = clica_jogar()
        g = nav.js(GUARDADO)
        conta('6 B de novo', r, g, [c for c in NoAr.pedidos[marca:] if c.endswith('.html')])
        check('B de novo: o jogo abre com o save dela, e o que estava pendente sobe',
              bool(r) and r['jogo'] and r['sessao'] and g.get('nome') == 'Heroi de B' and g['local'] == 'principal'
              and 'subiu' in r['hist'], (r, g))
        outra = nova_aba(porta_cdp)
        outra.vai(site + 'index.html')
        outra.ate("document.getElementById('bt-sair')", 30)
        outra.js("document.getElementById('bt-sair').click(); 1")
        caiu = nav.ate("window.JOGO && JOGO.Sessao.derrubadaJa() && !!document.querySelector('.sessao-derrubada')", 45)
        nav.js("JOGO.DB.batizar('Fantasma'); JOGO.Progress.save(); 1")       # a aba caída não regrava o save
        time.sleep(1)
        r = nav.js(JOGO_AGORA)
        g = nav.js(GUARDADO)
        conta('6 duas abas', r, g)
        check('sair numa aba encerra o jogo aberto na outra (a capa "Você saiu desta conta")',
              bool(caiu) and 'saiu desta conta' in (nav.js("document.querySelector('.sessao-derrubada').textContent") or ''), r)
        # em dia, o save saiu do disco; se o jogo gravou algo no último instante, fica guardado (pendente)
        check('duas abas: a sessão saiu do navegador, e a aba caída não regrava o save',
              bool(g) and g['sessao'] is None and g['bruto']['nome'] != 'Fantasma'
              and (not g['bruto']['save'] or g['bruto']['sujo']), g)
        time.sleep(1.5)
        check('duas abas: o token morreu no servidor', not vale(token_b2))

        # ---- 7. o "Sair da conta" de dentro do jogo (a ficha Contas)
        token_a = entra(nome_a)
        r = clica_jogar()
        g = nav.js(GUARDADO)
        check('A de novo: o jogo abre com o save dela', bool(r) and r['jogo'] and r['sessao'] and g.get('nome') == 'Heroi de A', (r, g))
        nav.js("JOGO.DB.batizar('Heroi de A2'); JOGO.Nuvem.sair().then(function () { window.__saiu = true; }); 1")   # sai com gravação pendente
        check('o sair do jogo termina', nav.ate("window.__saiu === true", 30))
        g = nav.js(GUARDADO)
        conta('7 sair do jogo', g)
        check('sair pelo jogo: a sessão e o save saem do navegador',
              bool(g) and g['sessao'] is None and not g['bruto']['save'] and g['bruto']['nome'] is None, g)
        check('sair pelo jogo: o token morreu no servidor', not vale(token_a))
        check('A entra de novo (a gravação pendente subiu antes do sair)', bool(entra(nome_a)))
        r = clica_jogar()
        g = nav.js(GUARDADO)
        conta('7 A de volta', r, g)
        check('o que A jogou até o sair está no servidor', bool(g) and g['nome'] == 'Heroi de A2' and g['codigo'] == codigo_a, g)

        # ---- 8. a sessão morre NO SERVIDOR (venceu, foi encerrada): o jogo não segue sem conta
        token_a = nav.js(GUARDADO)['sessao']['token']
        fora.pede('POST', '/api/logout', token=token_a)
        check('o token de A morreu no servidor (com o jogo aberto)', not vale(token_a))
        nav.js("JOGO.Sessao.confereAparelho(); 1")        # a olhada de 30 s, já
        caiu = nav.ate("JOGO.Sessao.derrubadaJa() && !!document.querySelector('.sessao-derrubada')", 45)
        check('com o jogo aberto, a sessão morta derruba o jogo com a capa (não se joga sem conta)',
              bool(caiu) and 'sessão acabou' in (nav.js("document.querySelector('.sessao-derrubada').textContent") or ''))
        nav.js("document.querySelector('.sessao-derrubada button').click(); 1")
        r = nav.assenta()
        check('"Entrar de novo" leva à tela de entrar, com a frase', na_porta(r)
              and 'sessão acabou' in (nav.js("document.getElementById('e-aviso').textContent") or ''), r)
        preenche(nome_a)
        r = nav.assenta()
        g = nav.js(GUARDADO)
        conta('8 A entrou de novo', r, g)
        check('e entrar devolve A ao jogo, com o save dela',
              bool(r) and r['jogo'] and r['sessao'] and bool(g) and g['nome'] == 'Heroi de A2', (r, g))
        token_a = g['sessao']['token']
        nav.vai(site + 'index.html')
        fora.pede('POST', '/api/logout', token=token_a)   # agora a sessão morre com o jogo FECHADO
        r = clica_jogar()
        g = nav.js(GUARDADO)
        conta('8 token morto ao abrir', r, g)
        check('sessão guardada que já morreu no servidor: "Jogar" cai na tela de entrar, e a sessão sai do navegador',
              na_porta(r) and bool(g) and g['sessao'] is None, (r, g))

        # ---- 9. o save de visitante de antes da regra: onde estava, sem leitor
        check('o save de visitante segue no navegador, intocado',
              nav.js("localStorage.getItem('soterra-conta-v1:visitante')") == VISITA_CONTA
              and nav.js("localStorage.getItem('soterra-save-v2:visitante')") == VISITA_SAVE)
        visto = Cliente(base_api)
        entrou = visto.pede('POST', '/api/login', {'login': nome_a, 'senha': SENHA})[1]
        salvo = visto.pede('GET', '/api/save', token=entrou.get('token'))
        check('…e não subiu para a conta de A',
              salvo[0] == 200 and 'Heroi de A2' in json.dumps(salvo, ensure_ascii=False)
              and 'Sem Conta' not in json.dumps(salvo, ensure_ascii=False), salvo[0])
        check('em nenhum passo o token foi para o endereço', 'token' not in (r or {}).get('url', '') and token_a not in json.dumps(r or {}))
        for linha in cdp.console[:8]:
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
