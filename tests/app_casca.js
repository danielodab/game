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
 *     entra, a qualidade padrão é 'media' — 'baixa' no aparelho fraco —, e a
 *     escolha gravada nas Configurações (ou o ?graficos=) vence nos dois casos;
 *     com a linha que o tools/empacota_www.py grava (window.SOTERRA_APP), a API
 *     passa a ser a do servidor do jogo, mesmo com um ?api= de fora no endereço. */
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

/* Uma janela de mentira. op: { busca, capacitor, memoria, tela:[l,a], pref, host, appCfg } */
function janela(op) {
  op = op || {};
  const classes = new Set();
  const cofre = {};
  if (op.pref) cofre['soterra-pref-ui'] = JSON.stringify(op.pref);
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
    matchMedia: () => ({ matches: false }),
    addEventListener: (n) => { ouvintes.win.push(n); },
    fetch() { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); },
    document: {
      hidden: false,
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
  if (op.appCfg) ctx.SOTERRA_APP = op.appCfg;
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOBILE, ctx);
  ctx._classes = classes; ctx._ouvintes = ouvintes; ctx._cofre = cofre;
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
check('web em aparelho fraco: a qualidade padrão CONTINUA alta', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ pref: { graficos: 'baixa' } });
check('web: a escolha das Configurações segue valendo', w.JOGO.Mobile.qualidade() === 'baixa');
w = janela({ busca: '?mobile=1' });
check('web com ?mobile=1 (o perfil de celular no navegador) não é aplicativo',
      w.JOGO.Mobile.app() === false && w.JOGO.Mobile.qualidade() === 'alta' && !w._classes.has('app'));
w = janela({ busca: '?app=10' });
check('?app=10 não liga o aplicativo (só ?app=1)', w.JOGO.Mobile.app() === false);

// ---------------------------------------------------------- O APLICATIVO
w = janela({ capacitor: true, memoria: 8, tela: [412, 915] });
M = w.JOGO.Mobile;
check('aplicativo (Capacitor nativo): app() e nativo() são verdadeiros', M.app() === true && M.nativo() === true);
check('aplicativo: o <html> ganha a classe app', w._classes.has('app'));
check('aplicativo: quem não escolheu abre na qualidade média', M.qualidade() === 'media' && M.grafico().escala === 0.75);
check('aplicativo: o segundo plano e o relógio da tela acesa são ligados',
      w._ouvintes.doc.indexOf('visibilitychange') >= 0 && w.relogios === 1);

w = janela({ busca: '?app=1', memoria: 4, tela: [1400, 900] });
M = w.JOGO.Mobile;
check('?app=1 finge a casca no navegador: app() verdadeiro, nativo() falso', M.app() === true && M.nativo() === false);
check('?app=1: qualidade média', M.qualidade() === 'media');

w = janela({ capacitor: true, memoria: 2, tela: [412, 915] });
check('aplicativo com 2 GB de memória: qualidade baixa', w.JOGO.Mobile.qualidade() === 'baixa' && w.JOGO.Mobile.grafico().bloom === false);
w = janela({ capacitor: true, memoria: 8, tela: [360, 640] });
check('aplicativo em tela de 360 px: qualidade baixa', w.JOGO.Mobile.qualidade() === 'baixa');
w = janela({ capacitor: true, tela: [412, 915] });
check('aplicativo sem deviceMemory (WebView que não informa): média, não baixa', w.JOGO.Mobile.qualidade() === 'media');

w = janela({ capacitor: true, memoria: 2, tela: [360, 640], pref: { graficos: 'alta' } });
check('aplicativo fraco: a escolha ALTA do jogador vence o padrão', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ capacitor: true, memoria: 8, pref: { graficos: 'baixa' } });
check('aplicativo forte: a escolha BAIXA do jogador vence o padrão', w.JOGO.Mobile.qualidade() === 'baixa');
w = janela({ capacitor: true, busca: '?graficos=alta', pref: { graficos: 'baixa' } });
check('o ?graficos= continua mandando por cima de tudo', w.JOGO.Mobile.qualidade() === 'alta');
w = janela({ capacitor: true, pref: { graficos: 'ultra' } });
check('uma escolha que não existe cai no padrão do aplicativo', w.JOGO.Mobile.qualidade() === 'media');

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
check('android: orientação livre (nenhum screenOrientation preso) e sem cópia da sessão na nuvem',
      !/screenOrientation/.test(manif) && /android:allowBackup="false"/.test(manif));
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

console.log('\n' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
