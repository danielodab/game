#!/usr/bin/env node
'use strict';
/* PROVA DA CASCA DO APLICATIVO (04/10): js/mobile.js e js/core/sessao.js.
 *
 *   node tests/app_casca.js
 *
 * A regra do dono: "não pode afetar o jogo da web, pois lá joga o pessoal de
 * computador". Então a prova tem duas metades, sobre os MESMOS arquivos do jogo:
 *   · NA WEB nada muda: app() é falso, a classe `app` não entra no <html>, a
 *     qualidade de quem não escolheu segue 'alta', o botão voltar e o segundo
 *     plano não fazem nada, nenhum ouvinte nem relógio a mais é ligado, e a API
 *     continua na mesma origem;
 *   · NO APLICATIVO (window.Capacitor nativo, ou `?app=1` nas provas): a classe
 *     entra, a qualidade padrão é 'media' — 'baixa' no aparelho fraco e, desde
 *     26/10, no iPhone —, e a escolha gravada nas Configurações (ou o
 *     ?graficos=) vence nos dois casos; duas quedas seguidas logo ao abrir (a
 *     página morta por memória, que o Capacitor recarrega) descem um nível;
 *     com a linha que o tools/empacota_www.py grava (window.SOTERRA_APP), a API
 *     passa a ser a do servidor do jogo, mesmo com um ?api= de fora no endereço;
 *   · QUAL APLICATIVO (25/10, o iPhone — docs/APP_STORE.md §8.7): no iPhone faltam o "Sair do jogo", a compra e o
 *     anúncio (JOGO.Mobile.falta), e a compra pela Play não liga nada lá; no ANDROID — com e sem o getPlatform —
 *     e na WEB nunca falta nada, e tudo segue como era. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}
const raiz = path.join(__dirname, '..');
const MOBILE = fs.readFileSync(path.join(raiz, 'js', 'mobile.js'), 'utf8');
const SESSAO = fs.readFileSync(path.join(raiz, 'js', 'core', 'sessao.js'), 'utf8');

/* Uma janela de mentira. op: { busca, capacitor, plataforma, memoria, tela:[l,a], pref, host, appCfg, cofre, oculta } */
function janela(op) {
  op = op || {};
  const classes = new Set();
  const cofre = {};
  const sessao = {};
  if (op.pref) cofre['soterra-pref-ui'] = JSON.stringify(op.pref);
  if (op.cofre) Object.assign(cofre, op.cofre);
  const ouvintes = { doc: [], win: [] };
  const tela = op.tela || [1920, 1080];
  const ctx = {
    console, Promise, JSON, Math, Number, String, Object,
    relogios: 0,
    setInterval() { ctx.relogios++; return 1; },
    setTimeout() { return 1; }, clearTimeout() {}, clearInterval() {},
    location: { search: op.busca || '', protocol: 'https:', hostname: op.host || 'soterra.exemplo', host: op.host || 'soterra.exemplo', href: 'https://' + (op.host || 'soterra.exemplo') + '/index.html' + (op.busca || '') },
    navigator: { maxTouchPoints: 0, deviceMemory: op.memoria },
    screen: { width: tela[0], height: tela[1] },
    innerWidth: tela[0], innerHeight: tela[1],
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(cofre, k) ? cofre[k] : null),
      setItem: (k, v) => { cofre[k] = String(v); },
      removeItem: (k) => { delete cofre[k]; }
    },
    sessionStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(sessao, k) ? sessao[k] : null),
      setItem: (k, v) => { sessao[k] = String(v); },
      removeItem: (k) => { delete sessao[k]; }
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: (n) => { ouvintes.win.push(n); },
    fetch() { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); },
    document: {
      hidden: !!op.oculta,
      documentElement: { classList: {
        toggle: (n, on) => { if (on) classes.add(n); else classes.delete(n); },
        add: (n) => classes.add(n), contains: (n) => classes.has(n)
      } },
      addEventListener: (n) => { ouvintes.doc.push(n); },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} }, body: { appendChild() { ctx.pergunta = true; } }
    }
  };
  if (op.capacitor) ctx.Capacitor = { isNativePlatform: () => true };
  if (op.capacitor && op.plataforma) ctx.Capacitor.getPlatform = () => op.plataforma;
  if (op.appCfg) ctx.SOTERRA_APP = op.appCfg;
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOBILE, ctx);
  ctx._classes = classes; ctx._ouvintes = ouvintes; ctx._cofre = cofre; ctx._sessao = sessao;
  return ctx;
}

// ---------------------------------------------------------------- A WEB
let w = janela({});
let M = w.JOGO.Mobile;
check('web: app() e nativo() são falsos', M.app() === false && M.nativo() === false);
check('web: o <html> não ganha a classe app', !w._classes.has('app'));
check('web: quem não escolheu segue na qualidade alta', M.padraoGrafico() === 'alta' && M.qualidade() === 'alta');
check('web: a qualidade alta desenha na resolução cheia, com brilho', M.grafico().escala === 1 && M.grafico().bloom === true);
check('web: nenhum ouvinte de segundo plano e nenhum relógio a mais',
      w._ouvintes.doc.indexOf('visibilitychange') < 0 && w.relogios === 0, JSON.stringify(w._ouvintes) + ' ' + w.relogios);
let calou = 0;
w.JOGO.Audio = { pausa() { calou++; } };
w.JOGO.UI = { voltar() { calou += 100; return true; } };
check('web: o botão voltar não faz nada (nem fecha ficha, nem pergunta)', M.voltar() === null && !w.pergunta && calou === 0);
M.segundoPlano(true);
check('web: o segundo plano não cala o som', calou === 0 && !M.fora);

w = janela({ memoria: 1, tela: [320, 568] });
// 04/10: o telefone no navegador caía por falta de memória com a conta cheia. 06/10 (o dono: "jogo deve
// iniciar na qualidade máxima nos celulares"): o telefone começa no nível que a MEMÓRIA dele aguenta
check('web em TELEFONE fraco (1 GB): a qualidade padrão é baixa', w.JOGO.Mobile.qualidade() === 'baixa');
w = janela({ memoria: 8, tela: [360, 780] });
check('web em TELEFONE forte (8 GB, mesmo com lado curto de 360 px): começa no máximo',
      w.JOGO.Mobile.telefone() === true && w.JOGO.Mobile.qualidade() === 'alta', w.JOGO.Mobile.qualidade());
w = janela({ memoria: 4, tela: [360, 780] });
check('web em TELEFONE médio (4 a 6 GB): começa na média', w.JOGO.Mobile.qualidade() === 'media', w.JOGO.Mobile.qualidade());
w = janela({ pref: { graficos: 'baixa' } });
check('web: a escolha das Configurações segue valendo', w.JOGO.Mobile.qualidade() === 'baixa');
w = janela({ busca: '?mobile=1' });
check('web com ?mobile=1 (o perfil de celular no navegador) não é aplicativo',
      w.JOGO.Mobile.app() === false && w.JOGO.Mobile.qualidade() === 'media' && !w._classes.has('app'));
w = janela({ busca: '?app=10' });
check('?app=10 não liga o aplicativo (só ?app=1)', w.JOGO.Mobile.app() === false);

// ---------------------------------------------------------- O APLICATIVO
w = janela({ capacitor: true, memoria: 8, tela: [412, 915] });
M = w.JOGO.Mobile;
check('aplicativo (Capacitor nativo): app() e nativo() são verdadeiros', M.app() === true && M.nativo() === true);
check('aplicativo: o <html> ganha a classe app', w._classes.has('app'));
check('aplicativo num telefone forte (8 GB): quem não escolheu abre no MÁXIMO', M.qualidade() === 'alta' && M.grafico().escala === 1 && M.grafico().bloom === true, M.qualidade());
check('aplicativo: o segundo plano e o relógio da tela acesa são ligados',
      w._ouvintes.doc.indexOf('visibilitychange') >= 0 && w.relogios === 1);
// 06/10: no aplicativo o "Sair do jogo" do menu (um link para o site, na web) pergunta e fecha o aplicativo
check('aplicativo: o toque no "Sair do jogo" do menu é atendido pela casca', w._ouvintes.doc.indexOf('click') >= 0);
check('web: ninguém escuta o clique do "Sair do jogo" — lá ele segue sendo o link para o site',
      janela({})._ouvintes.doc.indexOf('click') < 0);

w = janela({ busca: '?app=1', memoria: 4, tela: [1400, 900] });
M = w.JOGO.Mobile;
check('?app=1 finge a casca no navegador: app() verdadeiro, nativo() falso', M.app() === true && M.nativo() === false);
check('?app=1: qualidade média', M.qualidade() === 'media');

w = janela({ capacitor: true, memoria: 2, tela: [412, 915] });
check('aplicativo com 2 GB de memória: qualidade baixa', w.JOGO.Mobile.qualidade() === 'baixa' && w.JOGO.Mobile.grafico().bloom === false);
w = janela({ capacitor: true, memoria: 8, tela: [360, 640] });
check('aplicativo forte em tela de 360 px (o Galaxy S22): máximo — a memória decide, não a tela', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ capacitor: true, memoria: 4, tela: [412, 915] });
check('aplicativo com 4 a 6 GB: média', w.JOGO.Mobile.qualidade() === 'media');
w = janela({ capacitor: true, tela: [412, 915] });
check('aplicativo num telefone sem deviceMemory: média', w.JOGO.Mobile.qualidade() === 'media');
w = janela({ capacitor: true, tela: [320, 568] });
check('aplicativo sem deviceMemory em tela bem pequena (320 px): baixa', w.JOGO.Mobile.qualidade() === 'baixa');

w = janela({ capacitor: true, memoria: 2, tela: [360, 640], pref: { graficos: 'alta' } });
check('aplicativo fraco: a escolha ALTA do jogador vence o padrão', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ capacitor: true, memoria: 8, pref: { graficos: 'baixa' } });
check('aplicativo forte: a escolha BAIXA do jogador vence o padrão', w.JOGO.Mobile.qualidade() === 'baixa');
w = janela({ capacitor: true, busca: '?graficos=alta', pref: { graficos: 'baixa' } });
check('o ?graficos= continua mandando por cima de tudo', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ capacitor: true, pref: { graficos: 'ultra' } });
check('uma escolha que não existe cai no padrão do aplicativo', w.JOGO.Mobile.qualidade() === 'media');

// ---------------------------------------- QUAL APLICATIVO: o iPhone (25/10)
const RECURSOS = ['sair', 'compra', 'anuncio'];
const nadaFalta = (M) => RECURSOS.every((r) => M.falta(r) === false);
w = janela({});
M = w.JOGO.Mobile;
check('web: a plataforma é "web", nada falta, a loja dos textos é a Google Play e não há classe ios',
      M.plataforma() === 'web' && M.ios() === false && nadaFalta(M) && M.loja() === 'Google Play' && !w._classes.has('ios'));
check('web: nenhuma marca de plataforma na sessão da aba', !('soterra-plataforma' in w._sessao));
w = janela({ busca: '?plataforma=ios' });
check('web com ?plataforma=ios (sem ?app=1) segue sendo a web', w.JOGO.Mobile.plataforma() === 'web' && nadaFalta(w.JOGO.Mobile));

w = janela({ capacitor: true, memoria: 8, tela: [412, 915] });
M = w.JOGO.Mobile;
check('ANDROID sem o getPlatform (a casca de mentira das provas antigas): "android", nada falta',
      M.plataforma() === 'android' && nadaFalta(M) && !w._classes.has('ios'));
w = janela({ capacitor: true, plataforma: 'android', memoria: 8, tela: [412, 915] });
M = w.JOGO.Mobile;
check('ANDROID (getPlatform "android"): nada falta, a loja é a Google Play, sem classe ios e sem marca na sessão',
      M.plataforma() === 'android' && nadaFalta(M) && M.loja() === 'Google Play' && !w._classes.has('ios') &&
      w._classes.has('app') && !('soterra-plataforma' in w._sessao));
check('ANDROID: o "Sair do jogo" continua atendido pela casca (pergunta e fecha)', w._ouvintes.doc.indexOf('click') >= 0);
w = janela({ busca: '?app=1' });
check('?app=1 continua sendo o Android', w.JOGO.Mobile.plataforma() === 'android' && nadaFalta(w.JOGO.Mobile));

w = janela({ capacitor: true, plataforma: 'ios', tela: [932, 430] });
M = w.JOGO.Mobile;
check('IPHONE (getPlatform "ios"): app() verdadeiro, plataforma "ios"', M.app() === true && M.plataforma() === 'ios' && M.ios() === true);
check('IPHONE: faltam o sair, a compra e o anúncio — e só eles', RECURSOS.every((r) => M.falta(r) === true) && M.falta('avisos') === false);
check('IPHONE: os textos citam a App Store', M.loja() === 'App Store');
check('IPHONE: o <html> ganha app e ios', w._classes.has('app') && w._classes.has('ios'));
check('IPHONE: a marca da plataforma fica na sessão da aba (o site no quadro a lê)', w._sessao['soterra-plataforma'] === 'ios');
// 26/10 (o vídeo do primeiro iPhone: o jogo recomeçava sozinho a cada 3 s): o WebView do iPhone morre por memória na
// 'media' — as texturas de cor abrem do tamanho que vieram. O iPhone começa na 'baixa'
check('IPHONE: sem o deviceMemory, a qualidade padrão é a BAIXA (textura de cor até 512, sem brilho)',
      M.qualidade() === 'baixa' && M.grafico().cor === 512 && M.grafico().bloom === false, M.qualidade());
w = janela({ capacitor: true, plataforma: 'ios', tela: [932, 430], pref: { graficos: 'alta' } });
check('IPHONE: a escolha das Configurações segue vencendo o padrão', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ capacitor: true, plataforma: 'android', tela: [915, 412] });
check('ANDROID sem o deviceMemory segue na média (só o iPhone mudou)', w.JOGO.Mobile.qualidade() === 'media');
w = janela({ busca: '?app=1&plataforma=ios' });
check('?app=1&plataforma=ios finge o iPhone no navegador', w.JOGO.Mobile.plataforma() === 'ios' && w.JOGO.Mobile.falta('compra') === true);
// 26/10: a compra da Apple ligada no servidor (a vitrine e a loja do site gravam a chave): só a compra deixa de faltar
w = janela({ capacitor: true, plataforma: 'ios', tela: [932, 430] });
M = w.JOGO.Mobile;
M.appleLigada(true);
check('IPHONE com a compra da Apple ligada (26/10): a compra deixa de faltar; o sair e o anúncio seguem faltando',
      M.falta('compra') === false && M.falta('sair') === true && M.falta('anuncio') === true &&
      w.localStorage.getItem('soterra-apple-loja') === '1' && M.CHAVE_APPLE === 'soterra-apple-loja');
M.appleLigada(false);
check('IPHONE: desligada de novo, a compra volta a faltar (e a chave sai)',
      M.falta('compra') === true && w.localStorage.getItem('soterra-apple-loja') === null);
w = janela({ capacitor: true, plataforma: 'android' });
w.JOGO.Mobile.appleLigada(true);
check('ANDROID: a chave da Apple não muda nada (nada falta, com ou sem ela)', nadaFalta(w.JOGO.Mobile));
check('site.js: a mesma chave e a mesma regra da compra da Apple',
      fs.readFileSync(path.join(raiz, 'site', 'site.js'), 'utf8').indexOf("SITE.CHAVE_APPLE = 'soterra-apple-loja';") >= 0 &&
      fs.readFileSync(path.join(raiz, 'site', 'site.js'), 'utf8').indexOf("return !(recurso === 'compra' && SITE.appleLigada());") >= 0);

const SITE_JS = fs.readFileSync(path.join(raiz, 'site', 'site.js'), 'utf8');
const lista = (fonte, nome) => (new RegExp(nome + ' = (\\{[^}]*\\})').exec(fonte) || [])[1];
check('a lista do que falta no iPhone é a MESMA no jogo e no site',
      !!lista(MOBILE, 'M\\.FALTA_NO_IPHONE') && lista(MOBILE, 'M\\.FALTA_NO_IPHONE') === lista(SITE_JS, 'SITE\\.FALTA_NO_IPHONE'),
      lista(MOBILE, 'M\\.FALTA_NO_IPHONE') + ' x ' + lista(SITE_JS, 'SITE\\.FALTA_NO_IPHONE'));

// o que a HUD e a aba fazem com a resposta (lido no código: a HUD inteira não roda fora do navegador)
const HUD = fs.readFileSync(path.join(raiz, 'js', 'ui', 'hud.js'), 'utf8');
check('hud.js: o "Sair do jogo" só entra no menu quando não falta o sair',
      HUD.indexOf("if (!safe(function () { return JOGO.Mobile.falta('sair'); }, false)) box.appendChild(botaoSair());") >= 0 &&
      HUD.split('appendChild(botaoSair())').length === 2);
check('hud.js: no iPhone o botão é "Avaliar na App Store"; fora dele, "Avaliar na Google Play"',
      HUD.indexOf("naApple ? tr('Avaliar na App Store') : tr('Avaliar na Google Play')") >= 0);
check('hud.js: a compra de barras das Configurações pergunta à compra se ela está ligada',
      HUD.indexOf('JOGO.CompraPlay.ligada ? JOGO.CompraPlay.ligada() : JOGO.CompraPlay.noApp()') >= 0);
const ABA = fs.readFileSync(path.join(raiz, 'js', 'ui', 'site_aba.js'), 'utf8');
check('site_aba.js: a marca plataforma=ios vai só quando é o iPhone (no Android o endereço fica igual)',
      ABA.indexOf("if (ios && !/(^|&)plataforma=ios(&|$)/.test(x.search.slice(1))) x.search += '&plataforma=ios';") >= 0);
['textos_en.js', 'textos_es.js'].forEach(function (f) {
  const t = fs.readFileSync(path.join(raiz, 'js', 'i18n', f), 'utf8');
  check('js/i18n/' + f + ': as duas frases novas do iPhone traduzidas',
        t.indexOf('"Avaliar na App Store": "') >= 0 && t.indexOf('"Obrigado! Se a caixa não abriu, a Apple decide quando mostrar.": "') >= 0);
});

// ---------------------------------------- A QUEDA (26/10, o mesmo vídeo do iPhone)
// a página que passa da memória morre sem pagehide e o Capacitor a recarrega na mesma qualidade: duas quedas seguidas
// logo ao abrir descem um nível (gravado nas Configurações) e a HUD avisa
const VIVO = 'soterra-vivo';
const marca = (segAtras, n) => ({ [VIVO]: JSON.stringify({ t: Date.now() - segAtras * 1000, n: n }) });
const lida = (c) => JSON.parse(c._cofre[VIVO] || 'null');
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412] });
check('QUEDA: abrir sem marca grava a marca (quedas 0) e não mexe na qualidade',
      lida(w) && lida(w).n === 0 && w.JOGO.Mobile.qualidade() === 'media' && w.JOGO.Mobile.baixouSozinho === null &&
      !w._cofre['soterra-pref-ui']);
check('QUEDA: o aplicativo escuta o pagehide (a recarga de propósito apaga a marca)', w._ouvintes.win.indexOf('pagehide') >= 0);
w.JOGO.Mobile.naTela(false);
check('QUEDA: sair da tela (segundo plano, central de controle, troca de aplicativo) apaga a marca', !(VIVO in w._cofre));
w.JOGO.Mobile.naTela(true);
check('QUEDA: voltar à tela grava a marca de novo', lida(w) && lida(w).n === 0);
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412], cofre: marca(3, 0) });
check('QUEDA: a 1ª queda logo ao abrir só conta (quedas 1), sem descer',
      lida(w).n === 1 && w.JOGO.Mobile.qualidade() === 'media' && w.JOGO.Mobile.baixouSozinho === null);
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412], cofre: marca(3, 1) });
check('QUEDA: a 2ª seguida desce da média para a baixa, grava nas Configurações e zera a conta',
      w.JOGO.Mobile.qualidade() === 'baixa' && JSON.parse(w._cofre['soterra-pref-ui']).graficos === 'baixa' &&
      w.JOGO.Mobile.baixouSozinho && w.JOGO.Mobile.baixouSozinho.de === 'media' && w.JOGO.Mobile.baixouSozinho.para === 'baixa' &&
      lida(w).n === 0, JSON.stringify([w.JOGO.Mobile.qualidade(), w._cofre]));
w = janela({ capacitor: true, plataforma: 'ios', tela: [932, 430], pref: { graficos: 'alta', som: 0.5 }, cofre: marca(3, 1) });
check('QUEDA: no iPhone que subiu para a alta, desce para a média — e o resto das preferências fica',
      w.JOGO.Mobile.qualidade() === 'media' && JSON.parse(w._cofre['soterra-pref-ui']).graficos === 'media' &&
      JSON.parse(w._cofre['soterra-pref-ui']).som === 0.5);
w = janela({ capacitor: true, plataforma: 'ios', tela: [932, 430], cofre: marca(3, 1) });
check('QUEDA: já na baixa não há para onde descer — segue contando, sem aviso',
      w.JOGO.Mobile.qualidade() === 'baixa' && w.JOGO.Mobile.baixouSozinho === null && lida(w).n === 2);
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412], cofre: marca(120, 1) });
check('QUEDA: marca de mais de 1 minuto (fechou depois de jogar) não conta como queda',
      lida(w).n === 0 && w.JOGO.Mobile.qualidade() === 'media');
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412], cofre: { [VIVO]: '{lixo' } });
check('QUEDA: marca estragada é ignorada', lida(w).n === 0 && w.JOGO.Mobile.qualidade() === 'media');
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412], cofre: marca(3, 1), busca: '?graficos=alta' });
check('QUEDA: com o ?graficos= no endereço, desce a partir dele', w.JOGO.Mobile.qualidade() === 'media');
w = janela({ capacitor: true, plataforma: 'android', memoria: 4, tela: [915, 412], cofre: marca(3, 0), oculta: true });
check('QUEDA: abrir já fora da tela não deixa marca', !(VIVO in w._cofre));
w = janela({ memoria: 4, tela: [1920, 1080], cofre: marca(3, 1) });
check('QUEDA: na WEB nada disto roda — a marca nem é lida, a qualidade segue a alta, nenhum pagehide',
      lida(w).n === 1 && w.JOGO.Mobile.qualidade() === 'alta' && w.JOGO.Mobile.baixouSozinho === null &&
      w._ouvintes.win.indexOf('pagehide') < 0);
w = janela({ busca: '?app=1', memoria: 4, tela: [915, 412], cofre: marca(3, 1) });
w.JOGO.Mobile.naTela(true);
check('QUEDA: o ?app=1 das provas (várias páginas do jogo ao mesmo tempo) também não roda',
      lida(w).n === 1 && w.JOGO.Mobile.qualidade() === 'media' && w._ouvintes.win.indexOf('pagehide') < 0);
check('hud.js: o aviso da queda sai uma vez, já na praça',
      HUD.indexOf("if (!quedaAvisada && current === 'hub') avisaQueda();") >= 0 &&
      HUD.indexOf("if (!safe(function () { return JOGO.Mobile.baixouSozinho; }, null)) return;") >= 0);
['textos_en.js', 'textos_es.js'].forEach(function (f) {
  const t = fs.readFileSync(path.join(raiz, 'js', 'i18n', f), 'utf8');
  check('js/i18n/' + f + ': o aviso da queda traduzido',
        t.indexOf('"O jogo fechou por falta de memória, então a qualidade gráfica baixou um nível. Dá para mudar em Configurações → Gráficos.": "') >= 0);
});

// ---------------------------------------------- ONDE MORA A API (sessao.js)
function sessao(op) {
  const c = janela(op);
  vm.runInContext(SESSAO, c);
  return c;
}
w = sessao({});
check('web no ar: a API é a mesma origem', w.JOGO.Sessao.base() === '' && w.JOGO.Sessao.servidorDoApp() === '');
w = sessao({ host: 'localhost' });
check('em casa (localhost, sem a linha do aplicativo): a API segue a de sempre', w.JOGO.Sessao.base() === '');
w = sessao({ host: 'localhost', busca: '?api=http://127.0.0.1:8300' });
check('em casa: o ?api= das provas continua valendo', w.JOGO.Sessao.base() === 'http://127.0.0.1:8300');
w = sessao({ host: 'localhost', capacitor: true, appCfg: { servidor: 'https://jogo.exemplo/' } });
check('aplicativo: a API é a do servidor gravado pelo empacota_www.py', w.JOGO.Sessao.base() === 'https://jogo.exemplo');
w = sessao({ host: 'localhost', capacitor: true, appCfg: { servidor: 'https://jogo.exemplo' }, busca: '?api=https://outro.exemplo' });
check('aplicativo: um ?api= de fora NÃO desvia a senha nem fica gravado',
      w.JOGO.Sessao.base() === 'https://jogo.exemplo' && !w._cofre['soterra-api-base']);

// ------------------------------------- A CASCA: o que vai para a loja
const cfg = JSON.parse(fs.readFileSync(path.join(raiz, 'capacitor.config.json'), 'utf8'));
// 04/10: o aplicativo abre o jogo do SERVIDOR (server.url) — o que isso exige está em tests/app_modelos.js
check('capacitor.config.json: a www/ é o pacote, o endereço de dentro é https e o jogo vem por https',
      cfg.webDir === 'www' && cfg.server && cfg.server.androidScheme === 'https' && /^https:\/\//.test(cfg.server.url || ''));
// sem a chave, o Capacitor liga a depuração do WebView só no APK de teste (debug) e
// desliga no AAB de publicação; `true` escrito aqui abriria o jogo publicado ao chrome://inspect
check('capacitor.config.json: a depuração do WebView não vai ligada para a loja',
      !(cfg.android && cfg.android.webContentsDebuggingEnabled === true) && cfg.android.allowMixedContent === false);
const grad = fs.readFileSync(path.join(raiz, 'android', 'variables.gradle'), 'utf8');
const alvo = Number((/targetSdkVersion\s*=\s*(\d+)/.exec(grad) || [])[1]);
check('android: o targetSdk é o que a Play aceita hoje (35 ou mais)', alvo >= 35, String(alvo));
const manif = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
// 06/10 (o dono, no aparelho): "no mobile precisa ser padrão em modo paisagem", e as barras do sistema somem
check('android: o aplicativo fica deitado (sensorLandscape) e sem cópia da sessão na nuvem',
      /android:screenOrientation="sensorLandscape"/.test(manif) && /android:allowBackup="false"/.test(manif));
const ativ = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'java', 'br', 'com', 'soterra', 'jogo', 'MainActivity.java'), 'utf8');
check('android: a atividade esconde a barra de status e a de navegação (tela inteira), e de novo ao voltar o foco',
      /hide\(WindowInsetsCompat\.Type\.systemBars\(\)\)/.test(ativ) && /onWindowFocusChanged/.test(ativ));
const empacota = fs.readFileSync(path.join(raiz, 'tools', 'empacota_www.py'), 'utf8');
check('o servidor do jogo está escrito num lugar só (SERVIDOR, no empacota_www.py), em https',
      /^SERVIDOR = 'https:\/\/[a-z0-9.-]+'\r?$/m.test(empacota) && !/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.[a-z]/.test(MOBILE + SESSAO));
// a licença de origem para os modelos: só a do aplicativo, só na pasta dos modelos
['servidor/Caddyfile', 'servidor/coolify/Caddyfile'].forEach(function (f) {
  const t = fs.readFileSync(path.join(raiz, f), 'utf8');
  const bloco = (/@do_aplicativo \{([^}]*)\}/.exec(t) || [])[1] || '';
  check(f + ': os modelos aceitam a origem do aplicativo (https://localhost) e nenhuma outra',
        /path \/assets\/models\/bundle\/\*/.test(bloco) && /header Origin https:\/\/localhost\s/.test(bloco) &&
        /header @do_aplicativo \{\s*Access-Control-Allow-Origin "https:\/\/localhost"/.test(t) &&
        !/Access-Control-Allow-Origin\s+"?\*/.test(t));
});

// a compra pela Play (js/core/compra_play.js) no iPhone não liga nada; no Android, como sempre
const COMPRA = fs.readFileSync(path.join(raiz, 'js', 'core', 'compra_play.js'), 'utf8');
function comCompra(op) {
  const c = janela(op);
  c.pedidos = 0;
  c.JOGO.Sessao = { token: () => 'tk', api() { c.pedidos++; return Promise.resolve({ ok: true, pacotes: [], compras: [] }); } };
  const antes = c._ouvintes.doc.length;
  vm.runInContext(COMPRA, c);
  c._ouvintesDaCompra = c._ouvintes.doc.length - antes;
  return c;
}
(async function () {
  let c = comCompra({ capacitor: true, plataforma: 'ios' });
  check('IPHONE: a compra pela Play está no aplicativo (noApp) mas não ligada (ligada falso)',
        c.JOGO.CompraPlay.noApp() === true && c.JOGO.CompraPlay.ligada() === false);
  // 26/10: fica de olho na volta ao aplicativo (a loja pode abrir DEPOIS da carga, quando a vitrine diz que a compra
  // da Apple está ligada), mas a retomada confere `ligada` na hora: sem a Apple ligada, nada é pedido
  check('IPHONE: ao abrir, a compra fica de olho na volta ao aplicativo (26/10: a loja pode abrir depois)', c._ouvintesDaCompra === 1);
  const r = await c.JOGO.CompraPlay.retoma(true);
  check('IPHONE: sem a compra da Apple ligada, a retomada não pergunta nada ao servidor nem à loja', r.creditadas === 0 && c.pedidos === 0);
  await c.JOGO.CompraPlay.prepara();
  check('IPHONE: preparar a tela também não pergunta nada', c.pedidos === 0);
  c.JOGO.Mobile.appleLigada(true);
  check('IPHONE com a compra da Apple ligada (26/10): a compra liga', c.JOGO.CompraPlay.ligada() === true &&
        c.JOGO.CompraPlay.ios() === true);
  c = comCompra({ capacitor: true, plataforma: 'android' });
  check('ANDROID: a compra pela Play segue ligada e de olho na volta ao aplicativo',
        c.JOGO.CompraPlay.ligada() === true && c._ouvintesDaCompra === 1);
  c = comCompra({ capacitor: true });
  check('ANDROID sem o getPlatform: idem', c.JOGO.CompraPlay.ligada() === true && c._ouvintesDaCompra === 1);
  c = comCompra({});
  check('WEB: nada da compra pela Play (como sempre)', c.JOGO.CompraPlay.ligada() === false && c._ouvintesDaCompra === 0);

  console.log('\n' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHOU · a prova quebrou — ' + (e && e.stack || e)); process.exit(1); });
