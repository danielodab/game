#!/usr/bin/env node
'use strict';
/* PROVA DOS AVISOS DO APLICATIVO (08/10, js/core/notificacoes.js) — com um plugin de mentira.
 *
 *   node tests/notificacoes.js
 *
 * Cobra, rodando o arquivo de verdade numa janela de mentira (vm):
 *   - fora do aplicativo (sem Capacitor) nada é carregado nem marcado;
 *   - no aplicativo, `liga()` carrega a ponte (capacitor.js + local-notifications.js), pede a permissão
 *     quando ela está em 'prompt', e marca as TRÊS notificações (1001 diário às 10:00 repetindo, 1002 o
 *     Eco toda segunda às 12:00, 1003 a saudade em 3 dias) depois de cancelar as antigas;
 *   - permissão negada: nada marcado; avisos desligados (localStorage): nada marcado, e `define(false)`
 *     cancela as três; `define(true)` marca de novo;
 *   - a casca: o index.html escreve o arquivo só no bloco do aplicativo, o package.json tem o plugin, o
 *     empacota_www.py e o tests/app_modelos.js conhecem o vendor/capacitor/local-notifications.js, e o
 *     AndroidManifest declara POST_NOTIFICATIONS. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'core', 'notificacoes.js'), 'utf8');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
function janela(op) {
  op = op || {};
  const reg = { scripts: [], plugin: [], marcadas: [], canceladas: [] };
  const pluginFalso = {
    checkPermissions() { reg.plugin.push('checkPermissions'); return Promise.resolve({ display: op.permissao || 'prompt' }); },
    requestPermissions() { reg.plugin.push('requestPermissions'); return Promise.resolve({ display: op.responde || 'granted' }); },
    schedule(o) { reg.plugin.push('schedule'); reg.marcadas = o.notifications; return Promise.resolve({ notifications: o.notifications.map((n) => ({ id: n.id })) }); },
    cancel(o) { reg.plugin.push('cancel'); reg.canceladas = o.notifications.map((n) => n.id); return Promise.resolve(); }
  };
  const guardado = {};
  const ctx = {
    console, Promise, JSON, Math, Number, String, Object, Date, Array, setImmediate,
    setTimeout(f) { setImmediate(f); return 1; }, clearTimeout() {},
    localStorage: { getItem: (k) => (k in guardado ? guardado[k] : (op.guardado || {})[k] || null), setItem: (k, v) => { guardado[k] = String(v); } },
    addEventListener() {},
    document: {
      createElement(tag) {
        const e = { tag };
        if (tag === 'script') {
          Object.defineProperty(e, 'src', { set(v) {
            reg.scripts.push(v);
            setImmediate(() => { if (/local-notifications\.js/.test(v)) ctx.capacitorLocalNotifications = { LocalNotifications: pluginFalso }; if (e.onload) e.onload(); });
          } });
        }
        return e;
      },
      head: { appendChild() {} }
    },
    JOGO: {}
  };
  if (op.capacitor) ctx.Capacitor = { isNativePlatform: () => true };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  ctx._reg = reg;
  return ctx;
}

(async () => {
  // ---- fora do aplicativo
  const web = janela({});
  const r0 = await web.JOGO.Notificacoes.liga();
  check('fora do aplicativo: nada é carregado nem marcado', r0.length === 0 && web._reg.scripts.length === 0 && !web.JOGO.Notificacoes.disponivel());

  // ---- no aplicativo: a ponte, a permissão e as três marcações
  const app = janela({ capacitor: true });
  const N = app.JOGO.Notificacoes;
  const r1 = await N.liga();
  check('no aplicativo a ponte é carregada (capacitor.js e local-notifications.js)',
        app._reg.scripts.length === 2 && /capacitor\.js/.test(app._reg.scripts[0]) && /local-notifications\.js/.test(app._reg.scripts[1]), JSON.stringify(app._reg.scripts));
  check('a permissão é conferida e pedida (estava em prompt)', app._reg.plugin.slice(0, 2).join() === 'checkPermissions,requestPermissions', app._reg.plugin.join());
  check('as antigas são canceladas antes de marcar', app._reg.plugin.indexOf('cancel') >= 0 && app._reg.plugin.indexOf('cancel') < app._reg.plugin.indexOf('schedule'));
  const ids = app._reg.marcadas.map((n) => n.id).sort();
  check('marca as três: 1001 diário, 1002 Eco, 1003 saudade', ids.join() === '1001,1002,1003' && r1.length === 3, ids.join());
  const porId = {}; app._reg.marcadas.forEach((n) => { porId[n.id] = n; });
  check('o diário repete todo dia às 10:00', porId[1001].schedule.repeats === true && porId[1001].schedule.on.hour === 10 && porId[1001].schedule.on.minute === 0);
  check('o Eco repete toda segunda às 12:00', porId[1002].schedule.repeats === true && porId[1002].schedule.on.weekday === 2 && porId[1002].schedule.on.hour === 12);
  const em = porId[1003].schedule.at;
  check('a saudade é marcada para daqui a 3 dias, às 19:00', em instanceof app.Date && em.getTime() - Date.now() > 2.5 * 86400000 && em.getTime() - Date.now() < 3.8 * 86400000 && em.getHours() === 19, String(em));
  check('todo aviso tem título e corpo', app._reg.marcadas.every((n) => n.title && n.body));
  check('ligar de novo não marca duas vezes (liga é uma por abertura)', (await N.liga()).length === 0);

  // ---- permissão negada
  const neg = janela({ capacitor: true, permissao: 'denied' });
  const r2 = await neg.JOGO.Notificacoes.liga();
  check('permissão negada: nada marcado e nada pedido de novo', r2.length === 0 && neg._reg.marcadas.length === 0 && neg._reg.plugin.indexOf('requestPermissions') < 0);

  // ---- desligados nas Configurações
  const off = janela({ capacitor: true, guardado: { 'soterra-avisos': '0' } });
  const r3 = await off.JOGO.Notificacoes.liga();
  check('avisos desligados: nada marcado', r3.length === 0 && !off.JOGO.Notificacoes.ativas());
  const r4 = await off.JOGO.Notificacoes.define(true);
  check('define(true) liga e marca as três', r4.length === 3 && off.JOGO.Notificacoes.ativas());
  await off.JOGO.Notificacoes.define(false);
  check('define(false) desliga e cancela as três', !off.JOGO.Notificacoes.ativas() && off._reg.canceladas.sort().join() === '1001,1002,1003');

  // ---- a casca
  const INDEX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const onde = INDEX.indexOf("__url('js/core/notificacoes.js')");
  const bloco0 = INDEX.indexOf('isNativePlatform()'), bloco1 = INDEX.indexOf('catch (eApp)');
  check('o index.html escreve o notificacoes.js só no bloco do aplicativo', onde > bloco0 && onde < bloco1 && (INDEX.match(/__url\('js\/core\/notificacoes\.js'\)/g) || []).length === 1,
        JSON.stringify({ onde, bloco0, bloco1, n: (INDEX.match(/__url\('js\/core\/notificacoes\.js'\)/g) || []).length }));
  const PKG = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  check('o package.json tem o @capacitor/local-notifications na linha ^8', /^\^8\./.test((PKG.dependencies || {})['@capacitor/local-notifications'] || ''));
  const EMP = fs.readFileSync(path.join(RAIZ, 'tools', 'empacota_www.py'), 'utf8');
  check('o empacota_www.py conhece o vendor/capacitor/local-notifications.js', /local-notifications\/dist\/plugin\.js', 'local-notifications\.js'/.test(EMP));
  const MOD = fs.readFileSync(path.join(RAIZ, 'tests', 'app_modelos.js'), 'utf8');
  check('o tests/app_modelos.js confere o sexto par', /local-notifications\.js/.test(MOD));
  const MAN = fs.readFileSync(path.join(RAIZ, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  check('o AndroidManifest declara POST_NOTIFICATIONS', /android\.permission\.POST_NOTIFICATIONS/.test(MAN));
  const MOBILE = fs.readFileSync(path.join(RAIZ, 'js', 'mobile.js'), 'utf8');
  check('o mobile.js não carrega a ponte dos avisos (ela é sob demanda, do próprio módulo)', !/local-notifications/.test(MOBILE));

  console.log('\nRESUMO: ' + (falhas ? falhas + ' falharam de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
