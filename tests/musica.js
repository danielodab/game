#!/usr/bin/env node
'use strict';
/* PROVA DA MÚSICA DE FUNDO (06/10): a parte de música do js/audio.js.
 *
 *   node tests/musica.js
 *
 * O pedido do dono: "algumas músicas de ação (só sonoro de fundo nas lutas) e uma para a praça, mas
 * bem de leve". Aqui o navegador é de mentira — o <audio>, o AudioContext e o relógio do fade — e a
 * prova confere o que a camada PEDE e o que deixa SOANDO:
 *   · nada é pedido no boot nem antes do primeiro toque;
 *   · praça → luta → chefe → praça escolhe a faixa certa e, depois do fade, só UMA toca;
 *   · o volume da música não é o dos efeitos; o mudo cala os dois; "sem música" cala só ela;
 *   · economia de dados começa desligada (e a escolha gravada vence);
 *   · segundo plano (o aplicativo e a aba) pausa e volta de onde parou;
 *   · arquivo que falha vira silêncio, sem novo pedido — nem com toque, nem com relógio;
 *   · `play()` recusado só tenta de novo num toque; sem Ogg vai de MP3; por file:// sem a ponte. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + JSON.stringify(extra) : ''));
}
const AUDIO = fs.readFileSync(path.join(__dirname, '..', 'js', 'audio.js'), 'utf8');
const perto = (a, b) => Math.abs(a - b) < 1e-6;

/* Uma janela de mentira. op: { protocolo, semOgg, semMp3, semAC, recusa, economia, cofre } */
function janela(op) {
  op = op || {};
  const reg = { pedidos: [], elementos: [], plays: 0, pontes: 0, erros: [], relogios: {}, prox: 1, agora: 1e6, ouv: { win: {}, doc: {} } };
  const cofre = {};
  if (op.cofre) cofre['soterra-som'] = JSON.stringify(op.cofre);
  function elemento() {
    const e = { paused: true, loop: false, preload: '', volume: 1, currentTime: 0, _src: '', ouv: {},
      addEventListener(n, f) { (e.ouv[n] = e.ouv[n] || []).push(f); },
      canPlayType(t) { return (op.semOgg && /ogg/.test(t)) || (op.semMp3 && /mpeg/.test(t)) ? '' : 'probably'; },
      play() { reg.plays++; if (reg.recusa) return Promise.reject(new Error('NotAllowedError')); e.paused = false; return Promise.resolve(); },
      pause() { e.paused = true; },
      erro() { (e.ouv.error || []).forEach((f) => f({ type: 'error' })); } };
    Object.defineProperty(e, 'src', { get: () => e._src, set: (v) => { e._src = v; reg.pedidos.push(v); } });
    reg.elementos.push(e);
    return e;
  }
  function AC() { this.state = 'running'; this.currentTime = 0; this.destination = {}; reg.ctx = this; }
  AC.prototype.createGain = () => ({ gain: { value: 1 }, connect() {} });
  AC.prototype.createMediaElementSource = () => { reg.pontes++; return { connect() {} }; };
  AC.prototype.resume = function () { this.state = 'running'; };
  AC.prototype.suspend = function () { this.state = 'suspended'; };
  const w = {
    console, Promise, JSON, Math, Number, String, Object, Error,
    Date: { now: () => reg.agora },                 // o relógio da página é o da prova (o fade anda por ele)
    setInterval(fn, ms) { const id = reg.prox++; reg.relogios[id] = { fn, ms, em: reg.agora + ms }; return id; },
    clearInterval(id) { delete reg.relogios[id]; },
    setTimeout() { return 0; }, clearTimeout() {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { protocol: op.protocolo || 'https:' },
    localStorage: { getItem: (k) => (k in cofre ? cofre[k] : null), setItem: (k, v) => { cofre[k] = String(v); } },
    addEventListener(n, f) { (reg.ouv.win[n] = reg.ouv.win[n] || []).push(f); },
    document: { hidden: false,
      createElement(t) { if (t !== 'audio') throw new Error('só <audio>'); return elemento(); },
      addEventListener(n, f) { (reg.ouv.doc[n] = reg.ouv.doc[n] || []).push(f); } }
  };
  if (!op.semAC) w.AudioContext = AC;
  w.window = w;
  w.JOGO = { SONS: {}, DATA: { monsters: { rato: {}, colosso_fogo: { colosso: true } } },
             Bundle: { economiaDeDados: () => !!op.economia },
             Game: { state: null, salaInfo: () => ({ regra: reg.regra || null }) } };
  reg.recusa = !!op.recusa;
  vm.createContext(w);
  try { vm.runInContext(AUDIO, w, { filename: 'js/audio.js' }); } catch (e) { reg.erros.push(String(e)); }
  const A = w.JOGO.Audio, M = A && A.musica;
  return {
    w, reg, cofre, A, M, G: w.JOGO.Game,
    toque(n) { (reg.ouv.win[n || 'pointerdown'] || []).forEach((f) => f({ type: n || 'pointerdown' })); },
    doc(escondida) { w.document.hidden = escondida; (reg.ouv.doc.visibilitychange || []).forEach((f) => f({ type: 'visibilitychange' })); },
    /* anda o relógio da página, 10 ms por vez; `engasgo` atrasa os relógios (a página pesada) */
    anda(ms, engasgo) {
      for (let t = 0; t < ms; t += 10) {
        reg.agora += 10;
        Object.keys(reg.relogios).forEach((id) => {
          const r = reg.relogios[id];
          if (r && reg.agora >= r.em) { r.em = reg.agora + Math.max(r.ms, engasgo || 0); r.fn(); }
        });
      }
    },
    tocando() { const c = M.estado().canais; return Object.keys(c).filter((k) => c[k].tocando); },
    soando() { const c = M.estado().canais; return Object.keys(c).filter((k) => c[k].vol > 0); },
    el(arq) { return reg.elementos.find((e) => e._src.indexOf(arq) >= 0); },
    pedidosDe(arq) { return reg.pedidos.filter((p) => p.indexOf(arq) >= 0).length; }
  };
}
const comuns = () => ({ phase: 'playing', units: [{ side: 'player', boss: true }, { side: 'enemy', defId: 'rato' }] });
const ARQ = { 'luta-1': 'luta-heartfelt-battle', 'luta-2': 'luta-heavy-battle-2' };

(async function () {
  // ---------------------------------------------------------------- boot e primeira nota
  let j = janela();
  check('o js/audio.js carrega sem erro e expõe JOGO.Audio.musica', !j.reg.erros.length && !!j.M, j.reg.erros);
  j.M.tela('menu'); j.M.tela('hub');
  j.anda(3000);
  check('no boot, com a praça na tela e sem toque: nenhum arquivo pedido, nenhum relógio ligado',
    j.reg.pedidos.length === 0 && Object.keys(j.reg.relogios).length === 0, j.reg.pedidos);
  j.toque();
  check('o primeiro toque pede SÓ a faixa da praça, em Ogg, e ela toca em laço',
    j.reg.pedidos.length === 1 && /assets\/musica\/praca-bards-tale\.ogg$/.test(j.reg.pedidos[0]) && j.tocando().join() === 'praca' && j.el('praca').loop === true,
    j.reg.pedidos);
  check('servido por https, o volume é um ganho do AudioContext (a ponte)', j.M.estado().canais.praca.ponte === true && j.reg.pontes === 1);
  j.anda(600);
  check('a entrada é um fade: no meio dele o volume ainda não chegou', j.M.estado().canais.praca.vol > 0 && j.M.estado().canais.praca.vol < 0.15);
  j.anda(1000);
  check('"bem de leve": a praça fica em 0,15 (régua 40% × teto 0,5 × 0,75), com os efeitos em 0,7',
    perto(j.M.estado().canais.praca.vol, 0.15) && j.A.getVolume() === 0.7, j.M.estado());
  check('fade acabado, o relógio dele é desligado', Object.keys(j.reg.relogios).length === 0);

  // ---------------------------------------------------------------- praça → luta (preparação) → turno
  j.el('praca').currentTime = 33;
  j.G.state = Object.assign(comuns(), { phase: 'placing' });
  j.M.tela('battle');
  check('entrar na batalha pede a faixa de luta (a primeira é a Heartfelt Battle) e a cena é "luta"',
    j.M.estado().cena === 'luta' && j.pedidosDe('luta-heartfelt-battle.ogg') === 1 && j.reg.pedidos.length === 2, j.reg.pedidos);
  j.anda(1500);
  check('depois do fade só UMA toca: a da luta; a da praça foi pausada', j.tocando().join() === 'luta-1' && j.el('praca').paused === true, j.tocando());
  check('na preparação a faixa da luta entra mais baixa (0,11)', perto(j.M.estado().canais['luta-1'].vol, 0.2 * 0.55), j.M.estado().canais['luta-1']);
  j.A.handleEvent({ type: 'turnStart', uid: 'u1' });
  j.anda(1500);
  check('no primeiro turno ela sobe para 0,20 — ainda bem abaixo dos efeitos', perto(j.M.estado().canais['luta-1'].vol, 0.2));
  j.A.handleEvent({ type: 'turnStart', uid: 'u2' });
  check('os turnos seguintes não pedem nada nem religam o fade', j.reg.pedidos.length === 2 && Object.keys(j.reg.relogios).length === 0);

  // ---------------------------------------------------------------- luta → recompensa → antessala
  j.M.tela('roomClear');
  j.anda(600);
  check('no meio da troca as duas se cruzam (fade), sem corte seco', j.soando().length === 2, j.soando());
  j.anda(1000);
  check('recompensa: volta a da praça, de onde tinha parado, e a da luta é pausada',
    j.tocando().join() === 'praca' && j.el('praca').currentTime === 33 && perto(j.M.estado().canais.praca.vol, 0.15), j.tocando());
  j.M.tela('antessala');
  check('antessala não troca a música nem pede arquivo', j.tocando().join() === 'praca' && j.reg.pedidos.length === 2 && Object.keys(j.reg.relogios).length === 0);

  // ---------------------------------------------------------------- página engasgada
  j.G.state = comuns();
  j.M.tela('battle');
  j.anda(1800, 400);                                   // o relógio de 50 ms só consegue rodar a cada 400
  check('página engasgada (relógio a cada 400 ms): o fade ainda acaba em ~1,3 s e sobra UMA tocando',
    j.tocando().length === 1 && /^luta-/.test(j.tocando()[0]) && j.soando().length === 1 && Object.keys(j.reg.relogios).length === 0, j.M.estado().canais);
  j.M.tela('hub'); j.anda(1500);

  // ---------------------------------------------------------------- chefe
  j.G.state = { phase: 'playing', units: [{ side: 'player' }, { side: 'enemy', boss: true }] };
  j.M.tela('battle');
  j.anda(1500);
  check('sala com chefe: toca a faixa de chefe, e só ela',
    j.M.estado().cena === 'chefe' && j.tocando().join() === 'chefe' && j.pedidosDe('chefe-heavy-boss-battle-1.ogg') === 1, j.tocando());
  j.G.state.units = [{ side: 'enemy', defId: 'rato' }];              // o chefe caiu, ficaram os lacaios
  j.A.handleEvent({ type: 'turnStart', uid: 'u3' }); j.M.tela('battle');
  j.anda(1500);
  check('o chefe morrer no meio da luta não troca a faixa', j.M.estado().cena === 'chefe' && j.tocando().join() === 'chefe', j.tocando());
  j.M.tela('dungeonComplete');
  j.anda(1500);
  check('fim do calabouço: de volta à praça, uma só', j.tocando().join() === 'praca');
  [['Colosso do Poço', { phase: 'playing', units: [{ side: 'enemy', defId: 'colosso_fogo' }] }, null],
   ['Eco Primordial', { phase: 'playing', eco: { uid: 'u9' }, units: [] }, null],
   ['Altar do Santuário', { phase: 'playing', santuario: { br: [] }, units: [{ side: 'enemy', defId: 'rato' }] }, 'altar']
  ].forEach(function (c) {
    j.G.state = c[1]; j.reg.regra = c[2];
    j.M.tela('battle');
    check(c[0] + ' é luta de chefe', j.M.estado().cena === 'chefe');
    j.M.tela('hub');
  });
  j.reg.regra = 'fogo';
  j.G.state = { phase: 'playing', santuario: { br: [] }, units: [{ side: 'player', boss: true }, { side: 'enemy', defId: 'rato' }] };
  j.M.tela('battle');
  check('quadrante comum do Santuário e chefe do MEU lado não contam: luta comum', j.M.estado().cena === 'luta');
  j.M.tela('hub'); j.reg.regra = null;
  j.anda(1500);

  // ---------------------------------------------------------------- as lutas alternam e recomeçam
  j.G.state = comuns();
  j.M.tela('battle'); j.anda(1500);
  const a1 = j.tocando().join();
  j.M.tela('hub'); j.anda(1500);
  j.M.tela('battle'); j.anda(1500);
  const a2 = j.tocando().join();
  check('as lutas comuns alternam entre as duas faixas, cada arquivo pedido uma vez só',
    /^luta-[12]$/.test(a1) && /^luta-[12]$/.test(a2) && a1 !== a2 && j.pedidosDe('luta-heartfelt-battle') === 1 && j.pedidosDe('luta-heavy-battle-2') === 1,
    [a1, a2, j.reg.pedidos]);
  j.M.tela('hub'); j.anda(1500);
  j.el(ARQ[a1]).currentTime = 50;
  j.G.state = null;                                    // a tela chega antes do estado...
  j.M.tela('battle');
  check('batalha nova recomeça a faixa do início', j.el(ARQ[a1]).currentTime === 0 && j.M.estado().canais[a1].tocando, j.tocando());
  j.G.state = { phase: 'playing', units: [{ side: 'enemy', boss: true }] };
  j.A.handleEvent({ type: 'battleStart' });            // ...e o battleStart confere de novo
  j.anda(1500);
  check('o battleStart corrige a faixa quando o estado chegou depois da tela', j.M.estado().cena === 'chefe' && j.tocando().join() === 'chefe', j.tocando());

  // ---------------------------------------------------------------- PvP e guerra de guilda: sempre a faixa pesada
  j.M.tela('hub'); j.anda(1500);
  j.G.state = null;
  j.M.tela('battle'); j.anda(1500);
  j.G.state = { phase: 'playing', pvp: true, units: [{ side: 'player' }, { side: 'enemy' }] };
  j.A.handleEvent({ type: 'battleStart' }); j.anda(1500);
  check('luta entre jogadores (state.pvp): toca a faixa pesada, só ela', j.M.estado().cena === 'luta' && j.tocando().join() === 'luta-2', j.tocando());
  j.M.tela('hub'); j.anda(1500);
  j.M.tela('battle'); j.A.handleEvent({ type: 'battleStart' }); j.anda(1500);
  check('outra luta PvP em seguida: a pesada de novo, sem alternar', j.tocando().join() === 'luta-2', j.tocando());
  j.M.tela('hub'); j.anda(1500);
  j.G.state = { phase: 'playing', units: [{ side: 'enemy', boss: true }] };
  j.M.tela('battle'); j.A.handleEvent({ type: 'battleStart' }); j.anda(1500);

  // ---------------------------------------------------------------- volumes, mudo, sem música
  j.M.setVolume(1);
  check('a régua da música vale na hora e para no teto (0,5); a dos efeitos não se mexe', perto(j.M.estado().canais.chefe.vol, 0.5) && j.A.getVolume() === 0.7);
  j.A.setVolume(0.3);
  check('a régua dos efeitos não mexe na música', perto(j.M.estado().canais.chefe.vol, 0.5) && j.M.getVolume() === 1);
  const gravado = JSON.parse(j.cofre['soterra-som']);
  check('as duas preferências moram juntas na chave soterra-som', gravado.vol === 0.3 && gravado.mus === 1 && gravado.mudo === false, gravado);
  j.M.setVolume(0.4);
  j.A.setMudo(true);
  check('o mudo cala os DOIS na hora: nada tocando, volume zero', j.tocando().length === 0 && j.soando().length === 0 && j.A.isMudo());
  j.M.tela('hub'); j.anda(1500);
  check('mudo, trocar de tela não toca nada', j.tocando().length === 0);
  j.A.setMudo(false); j.anda(1500);
  check('tirar o mudo devolve a faixa da tela atual', j.tocando().join() === 'praca' && perto(j.M.estado().canais.praca.vol, 0.15));
  j.M.setLigada(false);
  check('"sem música" cala só a música: os efeitos seguem ligados',
    j.tocando().length === 0 && !j.A.isMudo() && j.M.isLigada() === false && JSON.parse(j.cofre['soterra-som']).musOn === false);
  j.M.setLigada(true); j.anda(1500);
  check('ligar de novo volta a tocar', j.tocando().join() === 'praca');
  j.M.setVolume(0);
  check('régua no zero também é "sem música": pausa', j.tocando().length === 0);
  j.M.setVolume(0.4); j.anda(1500);

  // ---------------------------------------------------------------- segundo plano
  j.G.state = comuns(); j.M.tela('battle'); j.anda(1500);
  const lutaEl = j.reg.elementos.find((e) => !e.paused);
  lutaEl.currentTime = 41;
  j.A.pausa(true);
  check('aplicativo minimizado: a música PAUSA na hora', j.tocando().length === 0 && j.reg.ctx.state === 'suspended');
  j.anda(5000);
  check('...e não volta sozinha enquanto está fora', j.tocando().length === 0);
  j.A.pausa(false); j.anda(1500);
  check('de volta: a mesma faixa retoma de onde parou', j.tocando().length === 1 && !lutaEl.paused && lutaEl.currentTime === 41);
  j.doc(true);
  check('aba escondida: pausa', j.tocando().length === 0);
  j.doc(false); j.anda(1500);
  check('aba de volta: toca', j.tocando().length === 1 && !lutaEl.paused);
  check('em tudo isso cada arquivo foi pedido uma única vez (4 faixas, 4 pedidos)', j.reg.pedidos.length === 4 && new Set(j.reg.pedidos).size === 4, j.reg.pedidos);

  // ---------------------------------------------------------------- economia de dados
  j = janela({ economia: true });
  j.M.tela('hub'); j.toque(); j.anda(2000);
  check('economia de dados: começa DESLIGADA — nenhum pedido, nenhuma faixa', j.M.isLigada() === false && j.reg.pedidos.length === 0 && j.tocando().length === 0);
  j.M.setLigada(true);
  check('...até a pessoa ligar nas Configurações', j.reg.pedidos.length === 1 && j.tocando().join() === 'praca');
  j = janela({ economia: true, cofre: { vol: 0.7, mudo: false, mus: 0.6, musOn: true } });
  j.M.tela('hub'); j.toque();
  check('a escolha gravada vence a economia (ligada) e traz o volume dela', j.M.isLigada() && j.tocando().join() === 'praca' && j.M.getVolume() === 0.6);
  j = janela({ cofre: { vol: 0.7, mudo: false, musOn: false } });
  j.M.tela('hub'); j.toque();
  check('...e vence o padrão ligado (desligada)', !j.M.isLigada() && j.reg.pedidos.length === 0);
  j = janela({ cofre: { vol: 0.5, mudo: true } });
  j.M.tela('hub'); j.toque(); j.anda(2000);
  check('quem já tinha o jogo no mudo não baixa música nenhuma', j.reg.pedidos.length === 0 && j.M.getVolume() === 0.4);

  // ---------------------------------------------------------------- falhas
  j = janela();
  j.M.tela('hub'); j.toque();
  j.el('praca').erro();
  check('arquivo que falha vira silêncio', j.M.estado().canais.praca.falhou && j.tocando().length === 0 && j.soando().length === 0);
  for (let i = 0; i < 20; i++) { j.toque(); j.toque('touchend'); j.M.tela('hub'); j.doc(true); j.doc(false); j.A.pausa(true); j.A.pausa(false); j.anda(3000); }
  check('...sem novo pedido: nem com toque, nem trocando de tela, nem voltando do segundo plano, nem com o tempo',
    j.reg.pedidos.length === 1 && j.reg.plays === 1 && Object.keys(j.reg.relogios).length === 0, { pedidos: j.reg.pedidos.length, plays: j.reg.plays });
  j.G.state = comuns(); j.M.tela('battle');
  j.el('luta-heartfelt').erro();
  j.anda(1500);
  check('uma faixa de luta falhou: entra a outra do mesmo papel', j.tocando().join() === 'luta-2' && j.pedidosDe('/luta-') === 2, j.tocando());
  j.el('luta-heavy-battle-2').erro();
  for (let i = 0; i < 10; i++) { j.toque(); j.M.tela('hub'); j.M.tela('battle'); j.anda(2000); }
  check('as duas falharam: luta em silêncio, e ninguém é pedido de novo', j.tocando().length === 0 && j.reg.pedidos.length === 3, j.reg.pedidos);

  j = janela({ recusa: true });
  j.M.tela('hub'); j.toque();
  await new Promise((r) => setImmediate(r));
  j.anda(10000);
  check('play() recusado não levanta nada e o TEMPO não tenta de novo', j.reg.plays === 1 && j.tocando().length === 0, j.reg.plays);
  j.reg.recusa = false;
  j.toque('touchend');
  check('...o toque seguinte tenta, e toca (sem pedir o arquivo outra vez)', j.reg.plays === 2 && j.tocando().join() === 'praca' && j.reg.pedidos.length === 1, j.reg.plays);

  // ---------------------------------------------------------------- formatos e file://
  j = janela({ semOgg: true });
  j.M.tela('hub'); j.toque();
  check('navegador sem Ogg toca o MP3 de reserva', j.reg.pedidos.length === 1 && /praca-bards-tale\.mp3$/.test(j.reg.pedidos[0]), j.reg.pedidos);
  j = janela({ semOgg: true, semMp3: true });
  j.M.tela('hub'); j.toque(); j.G.state = comuns(); j.M.tela('battle');
  check('sem nenhum dos dois: silêncio, sem pedido e sem erro', j.reg.pedidos.length === 0 && j.tocando().length === 0);
  j = janela({ protocolo: 'file:' });
  j.M.tela('hub'); j.toque(); j.anda(1500);
  check('por file:// não há ponte: o volume é o do próprio elemento (0,15)',
    j.reg.pontes === 0 && j.M.estado().canais.praca.ponte === false && perto(j.el('praca').volume, 0.15) && j.tocando().join() === 'praca');
  j = janela({ semAC: true });
  j.M.tela('hub'); j.toque(); j.anda(1500);
  check('sem WebAudio a música ainda toca, pelo volume do elemento', j.tocando().join() === 'praca' && perto(j.el('praca').volume, 0.15));
  j = janela();
  j.w.document.createElement = () => { throw new Error('quebrou'); };
  let caiu = null;
  try {
    j.M.tela('hub'); j.toque(); j.G.state = comuns(); j.M.tela('battle');
    j.A.handleEvent({ type: 'turnStart' }); j.A.setMudo(true); j.A.pausa(true); j.doc(true);
  } catch (e) { caiu = String(e); }
  check('com o <audio> quebrado nada levanta exceção', caiu === null, caiu);

  console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
  process.exit(falhas ? 1 : 0);
})();
