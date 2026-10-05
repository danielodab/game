#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova de navegador do "conta em um aparelho só" com DOIS aparelhos de verdade (04/10).

    python tests/um_aparelho_navegador.py [--porta 8151] [--conta] [--segundos 45]

Na máquina compartilhada, rode pela VEZ do Chrome:
    python .wt/_ferramentas/vez.py sessao --prazo 1200 -- python tests/um_aparelho_navegador.py

O relato do dono: a conta do Mestre aberta na aba do PC e no celular ao mesmo tempo; no celular
"o jogo ficou caindo e logando, caindo e logando" até abrir, e na praça a coroa "fica passando
entre dois modelos" e o cartão de vida "pula para cima e para baixo". A suspeita a provar ou
descartar: os dois aparelhos se derrubando em pingue-pongue, cada um retomando a sessão sozinho.

Aqui são DOIS perfis de Chrome (dois aparelhos: cada um com o seu localStorage), a API DE VERDADE
com o JUIZ (servidor/juiz/juiz.js — é com ele que o servidor devolve o estado e o jogo o adota),
o RELÉ de verdade (servidor/rele.py, lendo o mesmo banco)
e a mesma conta do Mestre nos dois:
  1. o "PC" entra pelo site e joga; o jogo é REABERTO três vezes (com a leitura do save atrasada,
     a rede do telefone): cada abertura é uma só — a página não recarrega sozinha — e a praça não
     é refeita em série nem manda operação ao servidor;
  2. UM aparelho só, `--sozinho` segundos na praça: zero recargas, zero quedas, zero reconexões
     do Relé, a mesma sessão, zero praças refeitas, zero coroas trocadas;
  3. o "celular" entra pelo site (a senha) e abre o jogo; por `--segundos` se CONTA, nos dois:
     logins da conta no servidor, sessões vivas, páginas recarregadas, pedidos à API, conexões do
     Relé, praças refeitas.
A regra: o PC cai UMA vez, numa tela clara, e nunca retoma sozinho (nenhum pedido com sessão,
nenhuma recarga, nenhum login, o Relé não religa); o celular abre e FICA (o mesmo token do começo
ao fim) e a praça dele não é refeita em laço. `--telefone` dá ao 1º aparelho tela e toque de telefone.
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

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from santuario_navegador import CHROMES, Fila, Servidor, mata, sobe_chrome  # noqa: E402
from sessao_navegador import GUARDADO, JOGO_AGORA, Nav  # noqa: E402

SENHA = 'segredo-bom-8'
JUIZ = os.path.join(RAIZ, 'servidor', 'juiz', 'juiz.js')
# Em TODA página, antes de qualquer script dela: conta as aberturas do jogo (sobrevive à recarga,
# na sessionStorage) e anota cada pedido à API com a hora.
ESPIA_CEDO = """(function () {
  try {
    if (/\\/index\\.html$/.test(location.pathname) && location.pathname.indexOf('/site/') < 0) {
      sessionStorage.setItem('__aberturas', String((Number(sessionStorage.getItem('__aberturas')) || 0) + 1));
    }
  } catch (e) {}
  // quantas vezes a praça foi MONTADA nesta abertura (cada montagem põe um cartão de vida novo)
  window.__montagens = 0;
  try {
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        [].forEach.call(m.addedNodes || [], function (n) {
          if (n.nodeType === 1 && n.classList && (n.classList.contains('vida-praca') || (n.querySelector && n.querySelector('.vida-praca')))) window.__montagens++;
        });
      });
    }).observe(document, { childList: true, subtree: true });
  } catch (e) {}
  window.__pilhas = [];
  var espera = setInterval(function () {
    var U = window.JOGO && window.JOGO.UI;
    if (!U || !U.showScreen) return;
    clearInterval(espera);
    var s0 = U.showScreen;
    U.showScreen = function (n) {
      if (n === 'hub') window.__pilhas.push((new Error().stack || '').split('\\n').slice(2, 6).map(function (l) { return l.trim().replace(/https?:[^ )]*[/]/g, '').slice(0, 70); }).join(' < '));
      return s0.apply(this, arguments);
    };
  }, 5);
  window.__api = [];
  window.__ws = { abertas: 0, fechadas: [] };
  var W0 = window.WebSocket;
  if (W0) {
    var W = function (u, p) {
      var w = p === undefined ? new W0(u) : new W0(u, p);
      w.addEventListener('open', function () { window.__ws.abertas++; });
      w.addEventListener('close', function (ev) { window.__ws.fechadas.push(ev.code); });
      return w;
    };
    W.prototype = W0.prototype;
    W.CONNECTING = 0; W.OPEN = 1; W.CLOSING = 2; W.CLOSED = 3;
    window.WebSocket = W;
  }
  var f0 = window.fetch;
  if (!f0) return;
  window.fetch = function (u, o) {
    var caminho = String(u).replace(/^https?:..[^/]+/, '').split('?')[0];
    var ent = { t: Date.now(), m: (o && o.method) || 'GET', u: caminho,
                tok: !!(o && o.headers && o.headers.Authorization) };
    if (caminho.indexOf('/api/') === 0) window.__api.push(ent);
    var p = f0.apply(this, arguments).then(function (r) { ent.s = r.status; return r; });
    // a rede lenta do telefone, só na leitura do save (a que decide se a página recarrega)
    var lento = Number(localStorage.getItem('__lento')) || 0;
    if (lento && ent.m === 'GET' && caminho === '/api/save') {
      return p.then(function (r) { return new Promise(function (ok) { setTimeout(function () { ok(r); }, lento); }); });
    }
    return p;
  };
})()"""
# Depois de o jogo assentar: conta as praças reconstruídas (cada UI.showScreen('hub')) e as coroas
# penduradas no herói (cada Hub.nomeia que traz a coroa).
ESPIA_PRACA = """(function () {
  if (window.__praca) return true;
  window.__praca = { telas: 0, coroas: [], cartoes: 0 };
  var s0 = JOGO.UI.showScreen;
  JOGO.UI.showScreen = function (n) { if (n === 'hub') window.__praca.telas++; return s0.apply(this, arguments); };
  var n0 = JOGO.Hub.nomeia;
  JOGO.Hub.nomeia = function (nome, tit, tier) {
    if (tier !== undefined) window.__praca.coroas.push(tier ? tier.nivel : 0);
    return n0.apply(this, arguments);
  };
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      [].forEach.call(m.addedNodes || [], function (n) {
        if (n.nodeType === 1 && (n.classList.contains('vida-praca') || n.querySelector('.vida-praca'))) window.__praca.cartoes++;
      });
    });
  }).observe(document.getElementById('ui-root'), { childList: true, subtree: true });
  return true;
})()"""
MEDE = """(function () {
  var a = window.__api || [];
  return { aberturas: Number(sessionStorage.getItem('__aberturas')) || 0, origem: performance.timeOrigin,
           pedidos: a.length, comToken: a.filter(function (x) { return x.tok; }).length,
           ops: a.filter(function (x) { return x.u === '/api/op'; }).length,
           saves: a.filter(function (x) { return x.u === '/api/save'; }).length,
           praca: window.__praca || null, montagens: window.__montagens, pilhas: window.__pilhas, ws: window.__ws,
           rede: (window.JOGO && JOGO.Rede && JOGO.Rede.estado) ? JOGO.Rede.estado() : null,
           capa: (document.querySelector('.sessao-derrubada') || {}).textContent || '',
           url: location.pathname + location.hash };
})()"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--porta', type=int, default=8151)
    ap.add_argument('--segundos', type=int, default=30)
    ap.add_argument('--sozinho', type=int, default=60, help='segundos com um aparelho só na praça')
    ap.add_argument('--telefone', action='store_true', help='o 1º aparelho com tela e toque de telefone')
    ap.add_argument('--lento', type=int, default=1500, help='ms de atraso na leitura do save (a rede do telefone)')
    ap.add_argument('--conta', action='store_true', help='imprime as medidas de cada passo (para investigar)')
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
        print(('PASSOU' if ok else 'FALHOU') + ' · ' + nome + ('' if ok or extra == '' else ' — ' + str(extra)[:900]), flush=True)

    def conta(rotulo, *coisas):
        if args.conta:
            print('   [' + rotulo + '] ' + ' | '.join(json.dumps(c, ensure_ascii=False) for c in coisas)[:1500], flush=True)

    srv = Fila(('127.0.0.1', args.porta), functools.partial(Servidor, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pasta = tempfile.mkdtemp(prefix='soterra-aparelho-nav-')
    banco = os.path.join(pasta, 'dados', 'soterra.db')
    log = open(os.path.join(pasta, 'api.log'), 'w', encoding='utf-8')
    porta_juiz, porta_api = porta_livre(), porta_livre()
    base_api = 'http://127.0.0.1:%d' % porta_api
    procs, cromos = [], []
    try:
        juiz = subprocess.Popen(['node', JUIZ, '--porta', str(porta_juiz)], stdout=log, stderr=subprocess.STDOUT)
        procs.append(juiz)
        time.sleep(2)
        api = subprocess.Popen([sys.executable, API, '--porta', str(porta_api), '--banco', banco,
                                '--juiz', 'http://127.0.0.1:%d' % porta_juiz,
                                '--emails-prova', os.path.join(pasta, 'emails.jsonl')],
                               stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        procs.append(api)
        porta_rele = porta_livre()
        rele = subprocess.Popen([sys.executable, os.path.join(RAIZ, 'servidor', 'rele.py'), '--porta', str(porta_rele),
                                 '--banco', banco], stdout=log, stderr=subprocess.STDOUT,
                                env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        procs.append(rele)
        check('a API sobe (com o juiz)', espera_api(base_api, api, 30) and juiz.poll() is None)
        nome = 'Bia Prova ' + str(int(time.time()) % 100000)
        c = Cliente(base_api)
        c.cadastra(nome)
        check('a conta nasce', bool(c.conta))
        cid = c.conta['id']
        b = sqlite3.connect(banco)
        b.execute("UPDATE contas SET gm = 1 WHERE id = ?", (cid,))            # a conta do Mestre, como a do relato
        b.commit()
        b.close()

        def no_banco():
            """(logins da conta, sessões vivas) — o que o servidor viu."""
            bb = sqlite3.connect(banco)
            try:
                logins = bb.execute("SELECT COUNT(*) FROM eventos WHERE conta_id = ? AND tipo = 'login'", (cid,)).fetchone()[0]
                vivas = bb.execute("SELECT COUNT(*) FROM sessoes WHERE conta_id = ?", (cid,)).fetchone()[0]
                return logins, vivas
            finally:
                bb.close()

        site = 'http://127.0.0.1:%d/site/' % args.porta
        jogo = 'http://127.0.0.1:%d/index.html?rede=ws://127.0.0.1:%d' % (args.porta, porta_rele)
        com_api = '?api=' + urllib.parse.quote(base_api, safe='')

        def aparelho(telefone=False):
            proc, perfil, cdp = sobe_chrome(chrome)
            cromos.append((proc, perfil))
            cdp('Page.enable')
            if telefone:
                cdp('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=2, mobile=True)
                cdp('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            cdp('Page.addScriptToEvaluateOnNewDocument', source=ESPIA_CEDO)
            return Nav(cdp)

        def entra_e_joga(nav):
            nav.vai(site + 'conta.html' + com_api + '#entrar')
            nav.ate("document.getElementById('e-login') && window.SITE", 30)
            nav.js("document.getElementById('aba-entrar').click();"
                   "document.getElementById('e-login').value = %s;"
                   "document.getElementById('e-senha').value = %s;"
                   "document.getElementById('e-bt').click(); 1" % (json.dumps(nome), json.dumps(SENHA)))
            if not nav.ate("window.SITE && SITE.sessao() && SITE.sessao().conta.nome === %s" % json.dumps(nome), 30):
                return None
            tok = nav.js("SITE.sessao().token")
            nav.vai(jogo)                # o "Jogar" do site, com o relé de casa no endereço
            return tok

        # ---- 1. o PC entra, joga e fica na praça
        pc = aparelho(args.telefone)
        token_pc = entra_e_joga(pc)
        r = pc.assenta()
        check('o PC entra e o jogo abre', bool(token_pc) and bool(r) and r['jogo'] and r['sessao'], r)
        pc.js("JOGO.UI.showScreen('hub'); 1")
        check('o PC está na praça', pc.ate("!!document.querySelector('.screen-hub.is-on .vida-praca')", 30))
        time.sleep(8)                                       # as adoções da abertura passam
        # A SEGUNDA ABERTURA, com a rede lenta: é ela que recarregava em laço
        pc.js("localStorage.setItem('__lento', '%d'); 1" % args.lento)
        def versao_no_banco():
            bb = sqlite3.connect(banco)
            try:
                return bb.execute("SELECT versao FROM saves WHERE conta_id = ?", (cid,)).fetchone()[0]
            finally:
                bb.close()

        for vez in (1, 2, 3):
            ab0 = pc.js(MEDE)['aberturas']
            pc.vai(jogo)
            linha = []
            for _ in range(8):
                time.sleep(5)
                linha.append((pc.js(MEDE) or {}).get('aberturas'))
            pc.assenta()
            mm = pc.js(MEDE)
            ab1 = mm['aberturas']
            conta('reabrindo (%d) com a rede lenta' % vez, {'aberturasA cada 5 s': linha, 'antes': ab0, 'depois': ab1},
                  pc.js("JOGO.Nuvem.historico().map(function (x) { return x.tipo; }).join(',')"),
                  pc.js("localStorage.getItem('soterra-nuvem-v1')"), {'versaoNoServidor': versao_no_banco()})
            check('reabrir o jogo pela %dª vez (leitura do save com %d ms) abre UMA vez — a página não recarrega sozinha'
                  % (vez, args.lento), ab1 == ab0 + 1, (ab0, ab1, linha))
            # O jogo reabre direto na praça (a dupla lembrada). Antes, TODA abertura mandava uma operação ao
            # servidor a cada montagem da praça e refazia a tela a cada estado que voltava: 4 ou 5 montagens em
            # poucos segundos, uma op em cada (a coroa indo e voltando do bilhete ao modelo 3D, o cartão de vida
            # refeito). Agora: nenhuma op, e a praça só é refeita pelo que muda de verdade — os retratos 3D que
            # terminam de abrir (uma vez) e, no máximo, UMA adoção de estado diferente do que estava na tela
            adocoes = len([x for x in mm['pilhas'] if 'adota' in x])
            check('…a praça abre sem operação ao servidor e sem ser refeita em série (montagens: %s, por adoção: %s, ops: %s)'
                  % (mm['montagens'], adocoes, mm['ops']),
                  mm['url'] == '/index.html' and mm['ops'] == 0 and mm['montagens'] <= 3 and adocoes <= 1, mm)
        pc.js("JOGO.UI.showScreen('hub'); 1")
        pc.ate("!!document.querySelector('.screen-hub.is-on .vida-praca')", 30)
        time.sleep(8)
        pc.js(ESPIA_PRACA)
        antes_pc = pc.js(MEDE)
        logins0, vivas0 = no_banco()
        conta('PC na praça', antes_pc, [logins0, vivas0])
        time.sleep(args.sozinho)
        m = pc.js(MEDE)
        logins_s, vivas_s = no_banco()
        conta('PC %d s depois' % args.sozinho, m, pc.js("(function () { var c = {}; (window.__api || []).forEach(function (x) { c[x.u] = (c[x.u] || 0) + 1; }); return c; })()"))
        check('UM aparelho só, %d s na praça: nenhuma recarga, nenhuma queda, a mesma sessão' % args.sozinho,
              bool(m) and m['aberturas'] == antes_pc['aberturas'] and m['origem'] == antes_pc['origem'] and not m['capa']
              and (logins_s, vivas_s) == (logins0, 1) and pc.js("JOGO.Sessao.token()") == token_pc, (antes_pc, m, logins_s, vivas_s))
        check('UM aparelho só: UMA conexão com o Relé, nenhuma queda nem reconexão',
              bool(m) and m['ws']['abertas'] == 1 and m['ws']['fechadas'] == [], m and m['ws'])
        check('UM aparelho só: a praça não é reconstruída nem troca de coroa (zero trocas)',
              bool(m) and m['praca']['telas'] == 0 and m['praca']['cartoes'] == 0 and len(m['praca']['coroas']) == 0, m and m['praca'])
        check('UM aparelho só: nenhum laço de save nem de operação',
              bool(m) and m['ops'] - antes_pc['ops'] <= 1 and m['saves'] - antes_pc['saves'] <= 1, (antes_pc, m))

        # ---- 2. o celular entra com a senha e clica "Jogar"
        cel = aparelho()
        token_cel = entra_e_joga(cel)
        check('o celular entra pelo site', bool(token_cel) and token_cel != token_pc)
        t_login = time.time()
        caiu = pc.ate("window.JOGO && JOGO.Sessao.derrubadaJa() && !!document.querySelector('.sessao-derrubada')", 60)
        t_caiu = time.time() - t_login
        m_caiu = pc.js(MEDE)
        check('o PC cai, numa tela que diz por quê e tem o botão de voltar',
              bool(caiu) and 'outro aparelho' in m_caiu['capa'] and 'Entrar de novo' in m_caiu['capa'], m_caiu)
        r = cel.assenta()
        check('o celular abre o jogo', bool(r) and r['jogo'] and r['sessao'], r)
        cel.js("JOGO.UI.showScreen('hub'); 1")
        cel.ate("!!document.querySelector('.screen-hub.is-on .vida-praca')", 30)
        time.sleep(8)
        cel.js(ESPIA_PRACA)
        cel0, pc0 = cel.js(MEDE), pc.js(MEDE)
        logins1, vivas1 = no_banco()
        conta('depois do login do celular', {'pcCaiuEm': round(t_caiu, 1)}, pc0, cel0, [logins1, vivas1])
        check('o servidor viu UM login a mais, e uma sessão viva só', logins1 == logins0 + 1 and vivas1 == 1, (logins0, logins1, vivas1))

        # ---- 3. N segundos contando
        time.sleep(args.segundos)
        cel1, pc1 = cel.js(MEDE), pc.js(MEDE)
        logins2, vivas2 = no_banco()
        g_pc, g_cel = pc.js(GUARDADO), cel.js(GUARDADO)
        conta('%d s depois' % args.segundos, pc1, cel1, [logins2, vivas2])
        n = args.segundos
        check('em %d s: nenhum login novo da conta (ninguém retomou a sessão sozinho)' % n, logins2 == logins1, (logins1, logins2))
        check('em %d s: a sessão viva é a do celular, a mesma do começo' % n,
              vivas2 == 1 and bool(g_cel) and g_cel['sessao'] and g_cel['sessao']['token'] == token_cel
              and Cliente(base_api).pede('GET', '/api/eu', token=token_cel)[0] == 200, (vivas2, g_cel))
        check('em %d s: o PC não recarregou, não navegou e segue na tela da queda' % n,
              bool(pc1) and pc1['aberturas'] == pc0['aberturas'] and pc1['origem'] == pc0['origem'] and 'outro aparelho' in pc1['capa'], pc1)
        check('em %d s: o PC caído não fez NENHUM pedido com sessão' % n, bool(pc1) and pc1['comToken'] == pc0['comToken'], (pc0, pc1))
        check('em %d s: o Relé do PC caído não religou; o do celular segue na mesma conexão' % n,
              pc1['ws']['abertas'] == pc0['ws']['abertas'] == 1 and len(pc1['ws']['fechadas']) == 1
              and cel1['ws']['abertas'] == 1 and cel1['ws']['fechadas'] == [], (pc1['ws'], cel1['ws']))
        check('o token do PC segue morto', Cliente(base_api).pede('GET', '/api/eu', token=token_pc)[0] == 401)
        check('em %d s: o celular não recarregou nem caiu' % n,
              bool(cel1) and cel1['aberturas'] == cel0['aberturas'] and cel1['origem'] == cel0['origem'] and not cel1['capa'], cel1)
        check('em %d s: a praça do celular não foi reconstruída nem trocou de coroa (zero trocas)' % n,
              bool(cel1) and cel1['praca']['telas'] == 0 and cel1['praca']['cartoes'] == 0 and len(cel1['praca']['coroas']) == 0,
              cel1 and cel1['praca'])
        check('em %d s: o celular não ficou pedindo o save nem mandando operação em laço' % n,
              bool(cel1) and cel1['ops'] - cel0['ops'] <= 1 and cel1['saves'] - cel0['saves'] <= 1, (cel0, cel1))

        # ---- 4. só o clique retoma: "Entrar de novo" no PC leva à tela de entrar, sem sessão
        pc.js("document.querySelector('.sessao-derrubada button').click(); 1")
        foi = pc.ate("location.pathname.indexOf('/site/conta.html') >= 0 && !!document.getElementById('e-login')", 30)
        g = pc.js(GUARDADO)
        logins3, _ = no_banco()
        check('"Entrar de novo" no PC abre a tela de entrar (pede a senha), sem sessão e sem login sozinho',
              bool(foi) and bool(g) and g['sessao'] is None and logins3 == logins2, (g, logins3))
        check('e o celular segue jogando', Cliente(base_api).pede('GET', '/api/eu', token=token_cel)[0] == 200
              and not cel.js("JOGO.Sessao.derrubadaJa()"))
    finally:
        for proc, perfil in cromos:
            mata(proc, perfil)
        srv.shutdown()
        for p in reversed(procs):
            try:
                p.terminate()
                p.wait(10)
            except Exception:
                p.kill()
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
