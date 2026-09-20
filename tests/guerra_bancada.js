#!/usr/bin/env node
'use strict';
/* A BANCADA DA GUERRA DE GUILDA EM NODE (19/09, o dono: "dê uma revisada na guerra de guild do meu jogo e ajuste o que
 * for necessário") — quatro clientes do jogo de verdade (dados, motor, Progress, Game e Coop) em contextos vm, com uma
 * Rede de mentira por correio e o relógio daqui: o mesmo desenho do tests/guerra_motor.html, sem navegador (roda em
 * segundos). Cobre o que a prova HTML não cobria e o que a revisão de 19/09 achou:
 *
 *   node tests/guerra_bancada.js
 *
 *   B1 sanidade: os quatro abrem, jogam, fecham com o mesmo gid; a guerra entra na luta aberta da conta e o corpo do
 *      fechar fica guardado (Autoridade.anotaLuta com `fim` e `corpo`);
 *   B2 a Ana (A1, quem manda) cai e volta por outra conexão: o turno NUNCA diminui em ninguém, nenhum dos três
 *      restaura, a foto vem de quem ficou (a Bia), a Ana não volta a mandar (euCai) e o hash bate daí em diante;
 *   B3 a Ana entra ATRASADA (a ata chegou com ela fora da praça): idem — ela nasce em placing, pega a foto da Bia,
 *      nunca manda `dessinc` e não manda até o fim;
 *   B4 os DOIS adversários caem: a contagem do W.O. aparece na sessão (wo.desde) e no aviso, o W.O. vem em 60 s e o
 *      fechar vai com `wo: true` e sem o hash do fim;
 *   B5 a Bia (A2) cai e volta: UMA foto basta — a lista `ia` da foto é a verdade inteira, os quatro concordam na
 *      marca logo depois, e a Bia joga a primeira vez dela depois da volta;
 *   B6 a Duda SAI: Vida.fim com os dois heróis dela a 0, o POST /api/guerra/sair {gid} pela Autoridade, os heróis
 *      dela caem nos três com a marca `morte` no registro;
 *   B7 quem sai ANTES de o salão abrir (a carga estourou): o `sai` sem unidade derruba todos os heróis dele nos três;
 *   B8 depois do fim, "Voltar à Sede" (Game.restart('hub')) fecha a sessão: modoRede null, sem sessão de guerra;
 *   (a rodada de conserto de 19/09 — a Rede de mentira passou a entregar o `caiu` só a quem está LIGADO, como o relé,
 *    a segurar os envelopes de um destino (latência) e a aceitar DENTRO_MS diferente por cliente)
 *   B9 a Ana entra atrasada com os prazos do `dentro` DESENCONTRADOS (o dela chega depois do prazo do Cris e da
 *      Duda e antes do da Bia): a memória da queda viaja (`caidos`), a Bia responde a foto em segundos, ninguém é
 *      marcado por prazo e a Bia segue jogando;
 *   B10 queda cruzada: o Cris cai, a Ana (A1) cai enquanto ele está fora, o Cris volta sem ter visto o `caiu` dela:
 *      pela união dos caídos ele aceita a foto da Bia em segundos e ninguém marca ninguém por prazo;
 *   B11 a marca `ia` com quem recebe À FRENTE de quem marcou (a entrada da Bia segurada): a marca entra na vez do
 *      herói nos quatro — zero `dessinc`, zero restauração, o hash bate;
 *   B12 o relé reinicia (os quatro voltam por conexões novas sem `caiu` nenhum): o `dentro {religou}` apresenta a
 *      conexão nova, os quatro sincronizam em segundos e ninguém "vence" por W.O.;
 *   B13 a Ana religa ANTES de o relé anunciar o `caiu` da conexão velha: ela se acerta pela Bia, e o `caiu` velho que
 *      chega depois (o cx antigo) não a derruba de novo. */
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const { mundo } = require(path.join(RAIZ, 'servidor', 'juiz', 'motor.js'));
const nodeCrypto = require('crypto');

let total = 0, falhas = 0;
// `node tests/guerra_bancada.js B2,B5` roda só esses cenários
const SO = String(process.argv[2] || '').split(',').filter(Boolean);
function quer(n) { return !SO.length || SO.indexOf(n) >= 0; }
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && extra !== '' ? '   [' + extra + ']' : ''));
}
function secao(t) { console.log('\n== ' + t); }

const relogio = { t: 1757900000000 };
const correio = [];
const segurados = [];          // 19/09: envelopes segurados (latência de mentira) — { para, s }
const segura = {};             // para -> true enquanto seguro os envelopes daquele destino
const erros = [];
const registro = [];
const cli = {};
const IDS = ['ana', 'bia', 'cris', 'duda'];
const LADO = { ana: 'A', bia: 'A', cris: 'B', duda: 'B' };
const DUPLA = { ana: [['espadachim', 'fogo', 22], ['curandeiro', 'agua', 20]], bia: [['espadachim', 'terra', 21], ['arqueiro', 'ar', 21]],
                cris: [['minotauro', 'terra', 22], ['bruxo', 'fogo', 20]], duda: [['invocador', 'agua', 21], ['curandeiro', 'ar', 21]] };

function fakeRede(id) {
  const R = {}, ouv = {}, visto = {}, ident = { id: id, cx: 'cx' + id };
  R._ident = (i, cx) => { ident.id = i; ident.cx = cx; };
  R.meuId = () => ident.id;
  R.meuCx = () => ident.cx;
  R.privado = () => true;
  R.estadoConexao = () => 'ws';
  R.transporte = () => 'ws';
  R.nomeDe = (i, s) => s || (i ? ('Jogador ' + i) : '?');
  R.visto = (i) => visto[i] || 0;
  R.vigia = () => true;
  R.solta = () => true;
  R.pares = () => [];
  R.ultimaRecusa = () => null;
  R.ouvir = (tipo, fn) => { (ouv[tipo] = ouv[tipo] || []).push(fn); return () => { const l = ouv[tipo] || [], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; };
  R.dirige = (tipo, para, acao, dados, opts) => {
    const env = { t: tipo, de: ident.id, cx: ident.cx, para: para, paraCx: (opts && opts.cx) || null, acao: acao, dados: dados };
    correio.push({ de: ident.id, s: JSON.stringify(env) });
    return true;
  };
  R._recebe = (env) => {
    visto[env.de] = relogio.t;
    const ev = { tipo: env.t, de: env.de, cx: env.cx, acao: env.acao, dados: env.dados };
    (ouv[env.t] || []).slice().forEach((f) => { try { f(ev); } catch (e) { erros.push(ident.id + ' ouvinte ' + env.acao + ': ' + e.message + ' ' + String(e.stack).split('\n')[1]); } });
  };
  R._sinal = (ev) => { (ouv[ev.tipo] || []).slice().forEach((f) => { try { f(ev); } catch (e) { erros.push('sinal: ' + e.message); } }); };
  return R;
}

/* os dublês do que a guerra toca fora do Coop: a fila (JOGO.Guerra), a autoridade do servidor e a vida única */
function dubles(c) {
  c.fechou = []; c.vidaFim = []; c.saidas = []; c.lutas = [];
  c.J.Guerra = {
    fechar: (corpo) => { c.fechou.push({ t: relogio.t, corpo: JSON.parse(JSON.stringify(corpo)) }); return Promise.resolve({ ok: true, gid: corpo.gid, fase: 'won', xp: 40 }); },
    sairDaPartida: (gid) => { c.saidas.push({ via: 'guerra', gid }); return Promise.resolve({ ok: true }); }
  };
  c.J.Autoridade = {
    ligada: () => true,
    abreLuta: (tipo, ref) => { c.lutas.push({ op: 'abre', tipo, ref }); },
    anotaLuta: (ref, lances, fim, corpo) => { c.lutas.push({ op: 'anota', ref, n: (lances || []).length, fim: !!fim, corpo: corpo ? JSON.parse(JSON.stringify(corpo)) : null }); },
    esqueceLuta: (ref) => { c.lutas.push({ op: 'esquece', ref }); },
    lutaAberta: () => null,
    saiDaGuerra: (gid) => { c.saidas.push({ via: 'autoridade', gid }); return Promise.resolve({ ok: true }); },
    fechaGuerra: (corpo) => Promise.resolve({ ok: true, gid: corpo.gid, fase: 'won', xp: 40 })
  };
  c.J.Vida = { fim: (m, mx) => { c.vidaFim.push({ t: relogio.t, fim: JSON.parse(JSON.stringify(m)), max: JSON.parse(JSON.stringify(mx || {})) }); return true; },
               sincroniza() {} };
}
function cliente(id) {
  const telas = [], avisos = [];
  const ctx = mundo(['js/core/progress.js', 'js/core/game.js', 'js/core/coop.js'], (c) => {
    c.window = c;
    c.crypto = nodeCrypto.webcrypto;
    c.location = { search: '', protocol: 'https:', hostname: 'x', href: 'https://x/' };
    c.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', hidden: false };
    c.addEventListener = () => {}; c.removeEventListener = () => {}; c.dispatchEvent = () => true;
    c.CustomEvent = function (t, o) { this.type = t; this.detail = o && o.detail; };
    c.JOGO = {
      Rede: fakeRede(id),
      UI: { showScreen: (n, d) => { telas.push({ n: n, d: d, t: relogio.t }); }, toast() {} },
      DB: { registrarPvp() {}, ganharMoedas() {} }
    };
  });
  const J = ctx.JOGO;
  J.Coop._semIntervalo = true;
  J.Coop._agora = () => relogio.t;
  J.Coop.aoAviso = (t) => { avisos.push({ t: relogio.t, m: t }); };
  const P = J.Progress;
  P.reset();
  DUPLA[id].forEach((h) => {
    P.unlockClass(h[0]);
    const he = P.hero(h[0]) || P.hero(P.createHero(h[0]));
    he.level = h[2]; he.element = h[1];
    const tab = (J.DATA.leveling || {}).xpTable || [];
    he.xp = tab[h[2] - 1] != null ? tab[h[2] - 1] : he.xp;
    he.spells = P.spellsFor(h[0]);
  });
  P.save();
  const c = { id, J, cx: 'cx' + id, vivo: true, telas, avisos };
  dubles(c);
  return c;
}

function entrega() {
  let n = 0;
  while (correio.length && n++ < 40000) {
    const it = correio.shift();
    const env = JSON.parse(it.s);
    const alvo = cli[env.para], de = cli[env.de];
    if (!alvo || !alvo.vivo || (de && !de.vivo)) continue;
    if (env.paraCx && env.paraCx !== alvo.cx) continue;
    if (segura[env.para]) { segurados.push({ para: env.para, s: it.s }); continue; }
    if (env.t === 'batalha') registro.push({ t: relogio.t, de: env.de, para: env.para, acao: env.acao, dados: env.dados });
    alvo.J.Rede._recebe(env);
  }
}
/* solta os envelopes segurados de um destino (a latência acabou) */
function solta(para) {
  delete segura[para];
  const fica = [];
  segurados.forEach((it) => { if (it.para === para) correio.push({ de: JSON.parse(it.s).de, s: it.s }); else fica.push(it); });
  segurados.length = 0; segurados.push(...fica);
  entrega();
}
const turnoMax = {};   // o maior turno já visto em cada cliente (o turno nunca pode diminuir)
const diminuiu = [];
function passo(ms, quem) {
  relogio.t += (ms || 50);
  entrega();
  IDS.forEach((id) => {
    const c = cli[id];
    if (!c || !c.vivo || (quem && quem.indexOf(id) < 0)) return;
    try { c.J.Game.update(0.05); c.J.Coop._tique(); }
    catch (e) { erros.push(id + ': ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' ')); }
    c.J.Engine.events.length = 0;
    const T = turno(id);
    if (turnoMax[id] != null && T >= 0 && T < turnoMax[id]) diminuiu.push(id + ':' + turnoMax[id] + '>' + T);
    if (T >= 0) turnoMax[id] = Math.max(turnoMax[id] || 0, T);
    entrega();
  });
}
function ate(cond, max, ms, quem) {
  for (let i = 0; i < (max || 4000); i++) { if (cond()) return true; passo(ms, quem); }
  return cond();
}
const tela = (id) => cli[id].J.Game.screen;
const turno = (id) => (cli[id].J.Game.state ? cli[id].J.Game.state.turno : -1);
const ses = (id) => cli[id].J.Coop.sessao();
function unid(id, dono) {
  const st = cli[id].J.Game.state;
  return st ? st.units.filter((u) => u.kind === 'hero' && u.dono === dono) : [];
}
function hashesIguais(ids, desde) {
  const base = cli[ids[0]].J.Coop._hashes(); let n = 0; const dif = [];
  Object.keys(base).forEach((T) => {
    if (+T < (desde || 0)) return;
    let todos = true;
    for (let i = 1; i < ids.length; i++) {
      const h = cli[ids[i]].J.Coop._hashes()[T];
      if (h === undefined) { todos = false; break; }
      if (h !== base[T]) dif.push(ids[i] + '@' + T);
    }
    if (todos) n++;
  });
  return { n, dif };
}
let nGuerra = 0;
function montaAta() {
  nGuerra++;
  const gid = 'guerra-' + ('00000000000000000000' + (1234567 + nGuerra).toString(16)).slice(-20);
  const A = [], B = [];
  IDS.forEach((id) => {
    const ps = cli[id].J.Coop.payloadMeus(DUPLA[id].map((h) => h[0]));
    (LADO[id] === 'A' ? A : B).push(...ps);
  });
  const ata = { mapa: 'sede', sala: 0, semente: 31337 + nGuerra * 7919, A, B, carry: null };
  const jogadores = IDS.map((id, i) => ({ conta: 100 + i, nome: id[0].toUpperCase() + id.slice(1), dono: id, lado: LADO[id], ordem: (id === 'ana' || id === 'cris') ? 0 : 1 }));
  const guildas = { A: { id: 1, nome: 'Lanças do Norte', emblema: '⚔' }, B: { id: 2, nome: 'Raízes Fundas', emblema: '☘' } };
  return { gid, ata, jogadores, guildas };
}
function abre(id, m, op) {
  const c = cli[id];
  c.vivo = true; c.cx = 'cx' + id; c.avisos.length = 0; c.telas.length = 0;
  dubles(c);
  delete turnoMax[id];
  c.J.Rede._ident(id, c.cx);
  c.J.Coop._reset();
  c.J.Coop._semIntervalo = true;
  c.J.Coop._agora = () => relogio.t;
  ['GRACA_MS', 'WO_MS', 'SILENCIO_MS', 'DENTRO_MS'].forEach((k) => { c.J.Coop[k] = (op && op[k]) || { GRACA_MS: 15000, WO_MS: 60000, SILENCIO_MS: 30000, DENTRO_MS: 15000 }[k]; });
  // 19/09: prazos diferentes por cliente (o salão de cada um carrega num tempo)
  if (op && op.porCliente && op.porCliente[id]) Object.keys(op.porCliente[id]).forEach((k) => { c.J.Coop[k] = op.porCliente[id][k]; });
  c.J.Coop.aoAviso = (t) => { c.avisos.push({ t: relogio.t, m: t }); };
  c.J.Game.init();
  return c.J.Coop.iniciaGuerra({ gid: m.gid, ata: JSON.parse(JSON.stringify(m.ata)), jogadores: m.jogadores, guildas: m.guildas, eu: id });
}
function abreTodos(op, menos) {
  registro.length = 0; correio.length = 0; diminuiu.length = 0; erros.length = 0;
  segurados.length = 0; Object.keys(segura).forEach((k) => delete segura[k]);
  const m = montaAta();
  const oks = IDS.filter((id) => !menos || menos.indexOf(id) < 0).map((id) => abre(id, m, op));
  return { m, oks };
}
function pilota(quem) { IDS.forEach((id) => { cli[id].J.Coop._piloto((!quem || quem.indexOf(id) >= 0) ? { joga: true } : null); }); }
/* 19/09: o `caiu` do relé só chega a quem está LIGADO naquele instante (o relé de verdade avisa os vigias vivos) —
 * quem estava fora quando outro caiu volta sem essa memória, e é isso que a união dos `caidos` cobre */
function cai(id) {
  cli[id].vivo = false;
  IDS.filter((x) => x !== id && cli[x].vivo).forEach((x) => cli[x].J.Rede._sinal({ tipo: 'caiu', id: id, cx: cli[id].cx }));
}
const autoridades = () => IDS.map((id) => id + '→' + (ses(id).guerra ? ses(id).guerra.autoridade : '-')).join(' ');
function marcasPrazo() {
  const donoDe = (uid) => { const u = cli.bia.J.Game.state && cli.bia.J.Game.state.units.find((x) => x.uid === uid); return u ? u.dono : '?'; };
  return [...new Set(registro.filter((m) => m.acao === 'ia' && m.dados.mot === 'prazo').map((m) => m.de + '→' + donoDe(m.dados.u)))];
}
function volta(id) {
  const c = cli[id];
  c.vivo = true; c.cx = 'cx' + id + '2';
  c.J.Rede._ident(id, c.cx);
  c.J.Rede._sinal({ tipo: 'religou', cx: c.cx });
}
function iaDe(id, dono) { return unid(id, dono).map((u) => (u.alive ? (u.ia ? 'i' : 'v') : 'x')).join(''); }
const outros = (id) => IDS.filter((x) => x !== id);

IDS.forEach((id) => { cli[id] = cliente(id); });

// ---------------------------------------------------------------- B1
if (quer('B1')) (function B1() {
  secao('B1 · sanidade: os quatro abrem, jogam e fecham com o mesmo gid; a guerra é luta aberta');
  const g = abreTodos();
  check('os quatro abrem a guerra da ata', g.oks.every(Boolean), g.oks.join(','));
  check('a guerra entra na luta aberta da conta assim que abre (Autoridade.abreLuta guerra)',
        IDS.every((id) => cli[id].lutas.some((l) => l.op === 'abre' && l.tipo === 'guerra' && l.ref === g.m.gid)));
  ate(() => IDS.every((id) => !cli[id].J.Coop.bloqueado()), 200);
  check('quem manda é a Ana (A1) na conta dos quatro', IDS.every((id) => ses(id).autoridade === 'ana'));
  pilota();
  ate(() => IDS.every((id) => tela(id) !== 'battle'), 60000, 50);
  const hs = hashesIguais(IDS, 0);
  check('a guerra termina nos quatro com o mesmo hash em todo turno', IDS.every((id) => tela(id) === 'duelFim') && !hs.dif.length && hs.n > 8,
        IDS.map(tela).join(',') + ' · ' + hs.n + ' turnos · dif ' + hs.dif.slice(0, 4).join(' '));
  check('os quatro fecham com o mesmo gid, o hash do fim e sem `wo`',
        IDS.every((id) => cli[id].fechou[0] && cli[id].fechou[0].corpo.gid === g.m.gid && typeof cli[id].fechou[0].corpo.hashFinal === 'number' && !cli[id].fechou[0].corpo.wo));
  check('o corpo do fechar fica guardado na luta aberta antes de sair (anotaLuta com fim e o corpo)',
        IDS.every((id) => cli[id].lutas.some((l) => l.op === 'anota' && l.fim && l.corpo && l.corpo.gid === g.m.gid && typeof l.corpo.hashFinal === 'number')));
  check('o turno nunca diminuiu em ninguém', !diminuiu.length, diminuiu.slice(0, 3).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B2
if (quer('B2')) (function B2() {
  secao('B2 · a Ana (A1, quem manda) cai; a Bia marca; a Ana volta por outra conexão');
  abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 6), 3000);
  registro.length = 0;
  cai('ana');
  ate(() => unid('bia', 'ana').every((u) => u.ia || !u.alive) && unid('cris', 'ana').some((u) => u.ia), 3000, 100, outros('ana'));
  const marcas = registro.filter((m) => m.acao === 'ia');
  check('quem marca a Ana é a Bia (o parceiro de guilda)', marcas.length > 0 && marcas.every((m) => m.de === 'bia'), [...new Set(marcas.map((m) => m.de))].join(','));
  check('os três passam a ver a Bia como quem manda', outros('ana').every((id) => ses(id).autoridade === 'bia'), outros('ana').map((id) => ses(id).autoridade).join(','));
  ate(() => false, 60, 100, outros('ana'));
  const tAntes = Math.max(...outros('ana').map(turno)), tAna = turno('ana');
  check('com a Ana fora a guerra anda (os três à frente dela)', tAntes > tAna + 10, tAntes + ' contra ' + tAna);
  if (tela('bia') !== 'battle') { check('(a guerra acabou antes da volta — o cenário não rodou)', false); return; }
  registro.length = 0;
  const restA = {}; IDS.forEach((id) => { restA[id] = ses(id).restauracoes; });
  volta('ana');
  ate(() => ses('ana').restauracoes > 0, 400);
  ate(() => false, 40, 100);
  check('a Ana volta e se acerta pela foto (uma restauração só)', ses('ana').restauracoes === 1, ses('ana').restauracoes);
  check('nenhum dos três restaura por causa da volta dela', outros('ana').every((id) => ses(id).restauracoes === restA[id]),
        outros('ana').map((id) => id + '=' + (ses(id).restauracoes - restA[id])).join(' '));
  const fotos = registro.filter((m) => m.acao === 'foto'), dess = registro.filter((m) => m.acao === 'dessinc');
  check('a foto veio de quem ficou (a Bia), nunca da Ana', fotos.length > 0 && fotos.every((m) => m.de === 'bia'), fotos.map((m) => m.de + '@T' + m.dados.T).join(' '));
  check('ninguém mandou `dessinc` (a volta não desfaz nada)', !dess.length, dess.map((m) => m.de).join(','));
  check('o turno NUNCA diminuiu em ninguém', !diminuiu.length, diminuiu.slice(0, 4).join(' '));
  check('a Ana não volta a mandar: quem manda segue a Bia na conta dos quatro (euCai)',
        IDS.every((id) => ses(id).autoridade === 'bia') && ses('ana').guerra.euCai === true, IDS.map((id) => ses(id).autoridade).join(','));
  check('a marca da Ana é igual nos quatro motores', new Set(IDS.map((id) => iaDe(id, 'ana'))).size === 1, IDS.map((id) => iaDe(id, 'ana')).join(' '));
  check('a Ana sincronizou com a Bia (o aviso tem o nome de quem manda)', cli.ana.avisos.some((a) => /Sincronizando com Bia/.test(a.m)),
        cli.ana.avisos.map((a) => a.m).slice(-3).join(' | '));
  const tV = Math.max(...IDS.map(turno));
  ate(() => IDS.every((id) => tela(id) !== 'battle' || turno(id) >= tV + 16), 20000);
  const hs = hashesIguais(IDS, tV + 1);
  check('daí em diante o hash bate nos quatro', !hs.dif.length && hs.n > 0, hs.n + ' turnos · dif ' + hs.dif.slice(0, 4).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B3
if (quer('B3')) (function B3() {
  secao('B3 · a Ana (A1) entra 25 s atrasada (a ata chegou com ela fora da praça)');
  const g = abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000 }, ['ana']);
  cli.ana.vivo = false;
  pilota(outros('ana'));
  ate(() => outros('ana').every((id) => !cli[id].J.Coop.bloqueado()), 600, 100, outros('ana'));
  check('os três soltam a guerra sem ela (o prazo do `dentro`)', outros('ana').every((id) => !cli[id].J.Coop.bloqueado()));
  ate(() => turno('bia') >= 8, 3000, 100, outros('ana'));
  check('a Ana é dada por caída desde o começo e a Bia a marca; quem manda é a Bia',
        outros('ana').every((id) => unid(id, 'ana').some((u) => u.ia) && ses(id).autoridade === 'bia'));
  registro.length = 0;
  const restA = {}; outros('ana').forEach((id) => { restA[id] = ses(id).restauracoes; });
  abre('ana', g.m, { GRACA_MS: 1500, SILENCIO_MS: 60000 });
  cli.ana.J.Coop._piloto({ joga: true });
  ate(() => ses('ana').restauracoes > 0, 600);
  ate(() => false, 40, 100);
  check('a Ana entra, sabe que chegou atrasada (tarde) e pega a foto da Bia (uma só)', ses('ana').guerra.tarde === true && ses('ana').restauracoes === 1,
        'tarde=' + ses('ana').guerra.tarde + ' restaurações=' + ses('ana').restauracoes);
  check('nenhum dos três restaura por causa da entrada dela', outros('ana').every((id) => ses(id).restauracoes === restA[id]));
  const fotos = registro.filter((m) => m.acao === 'foto'), dess = registro.filter((m) => m.acao === 'dessinc');
  check('a foto veio da Bia e ninguém mandou `dessinc`', fotos.length > 0 && fotos.every((m) => m.de === 'bia') && !dess.length,
        fotos.map((m) => m.de + '@T' + m.dados.T).join(' ') + ' · dessinc ' + dess.length);
  check('o turno nunca diminuiu em ninguém (a Ana sobe do 0 para o turno deles)', !diminuiu.length, diminuiu.slice(0, 4).join(' '));
  check('a Ana não manda até o fim; a marca dela é igual nos quatro', IDS.every((id) => ses(id).autoridade === 'bia') && new Set(IDS.map((id) => iaDe(id, 'ana'))).size === 1,
        IDS.map((id) => ses(id).autoridade + ':' + iaDe(id, 'ana')).join(' '));
  const tV = Math.max(...IDS.map(turno));
  ate(() => IDS.every((id) => tela(id) !== 'battle' || turno(id) >= tV + 16), 20000);
  const hs = hashesIguais(IDS, tV + 1);
  check('daí em diante o hash bate nos quatro', !hs.dif.length && hs.n > 0, hs.n + ' turnos · dif ' + hs.dif.slice(0, 4).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B4
if (quer('B4')) (function B4() {
  secao('B4 · os dois adversários caem: a contagem do W.O., o W.O. em 60 s e o fechar com `wo`');
  abreTodos({ GRACA_MS: 1500, WO_MS: 60000, SILENCIO_MS: 60000 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 4), 3000);
  pilota(['ana', 'bia']);
  const t0 = relogio.t;
  cai('cris'); cai('duda');
  ate(() => !!(ses('ana').guerra && ses('ana').guerra.wo), 50, 100, ['ana', 'bia']);
  const wo = ses('ana').guerra.wo;
  check('com os dois fora a sessão traz a contagem (wo.desde e o prazo de 60 s)', !!wo && wo.prazo === 60000 && wo.desde >= t0 - 1, JSON.stringify(wo));
  check('e o aviso diz quanto o lado deles tem para voltar', cli.ana.avisos.some((a) => /o lado deles tem 60 s para voltar/.test(a.m)),
        cli.ana.avisos.map((a) => a.m).slice(-2).join(' | '));
  ate(() => tela('ana') !== 'battle', 1400, 100, ['ana', 'bia']);
  const d = (cli.ana.telas.filter((t) => t.n === 'duelFim').pop() || {}).d || {};
  // (o silêncio de 60 s conta desde o ÚLTIMO sinal deles, um tique antes do `caiu`: por isso ~60 s, não ≥ 60 s cravado)
  check('a guilda que ficou vence por W.O. em ~60 s', d.guerra === true && d.wo === true && d.venci === true && relogio.t - t0 >= 58000 && relogio.t - t0 < 75000,
        JSON.stringify({ wo: d.wo, venci: d.venci, s: Math.round((relogio.t - t0) / 1000) }));
  const f = cli.ana.fechou[0];
  check('o fechar vai com `wo: true` e sem o hash do fim (o servidor confere a queda dos dois no relé)', !!f && f.corpo.wo === true && f.corpo.hashFinal === null,
        f && JSON.stringify({ wo: f.corpo.wo, h: f.corpo.hashFinal }));
  check('ninguém do lado A marcou os adversários', !registro.some((m) => m.acao === 'ia' && (m.de === 'ana' || m.de === 'bia') && m.dados.mot !== 'volta'));
  // 19/09: o aviso não diz mais "sem XP" — o servidor confere a queda no relé e o W.O. rende (antes o toast contradizia a tela de fim)
  check('o aviso do W.O. diz que o servidor confere a queda para valer o XP (e não "sem XP")',
        cli.ana.avisos.some((a) => /vitória por W\.O\.: o servidor confere a queda deles para valer o XP/.test(a.m)) && !cli.ana.avisos.some((a) => /sem XP/.test(a.m)),
        cli.ana.avisos.map((a) => a.m).slice(-2).join(' | '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B5
if (quer('B5')) (function B5() {
  secao('B5 · a Bia (A2) cai e volta: uma foto basta e a marca é igual nos quatro logo depois');
  abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 6), 3000);
  cai('bia');
  ate(() => unid('ana', 'bia').every((u) => u.ia || !u.alive), 3000, 100, outros('bia'));
  ate(() => false, 20, 100, outros('bia'));
  if (tela('ana') !== 'battle') { check('(acabou antes — o cenário não rodou)', false); return; }
  registro.length = 0;
  volta('bia');
  ate(() => ses('bia').restauracoes > 0, 600);
  const tVolta = turno('bia');
  const logoDepois = IDS.map((id) => iaDe(id, 'bia'));
  // (19/09: a desmarca da Ana entra na VEZ do herói da Bia — até lá a marca fica, igual nos quatro; a lista `ia` e
  // `iaPend` da foto são a verdade inteira, então os quatro concordam desde a primeira foto)
  check('logo depois da PRIMEIRA foto os quatro concordam na marca da Bia (a lista `ia` da foto é a verdade inteira)',
        new Set(logoDepois).size === 1, logoDepois.join(' '));
  ate(() => false, 40, 100);
  check('uma restauração só na Bia; nenhuma nos outros', ses('bia').restauracoes === 1 && outros('bia').every((id) => ses(id).restauracoes === 0),
        IDS.map((id) => id + '=' + ses(id).restauracoes).join(' '));
  check('ninguém mandou `dessinc` depois da volta', !registro.some((m) => m.acao === 'dessinc'));
  ate(() => registro.some((m) => m.acao === 'lance' && m.de === 'bia' && m.dados.T >= tVolta) || tela('bia') !== 'battle', 4000);
  check('a Bia joga a primeira vez dela depois da volta', registro.some((m) => m.acao === 'lance' && m.de === 'bia' && m.dados.T >= tVolta) || iaDe('bia', 'bia') === 'xx',
        'ia ' + iaDe('bia', 'bia') + ' · tela ' + tela('bia'));
  check('e daí os heróis dela estão sem marca nos quatro (a desmarca entrou na vez dela, no mesmo ponto)',
        IDS.every((id) => !/i/.test(iaDe(id, 'bia'))), IDS.map((id) => iaDe(id, 'bia')).join(' '));
  check('quem manda segue a Ana (a Bia caiu; a Ana não)', IDS.every((id) => ses(id).autoridade === 'ana'));
  const tV = Math.max(...IDS.map(turno));
  ate(() => IDS.every((id) => tela(id) !== 'battle' || turno(id) >= tV + 12), 20000);
  const hs = hashesIguais(IDS, tVolta + 1);
  check('daí em diante o hash bate nos quatro', !hs.dif.length, hs.n + ' turnos · dif ' + hs.dif.slice(0, 4).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B6
if (quer('B6')) (function B6() {
  secao('B6 · a Duda sai: a vida dela a 0 aqui, a saída declarada ao servidor, a morte nos três');
  const g = abreTodos();
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 4), 3000);
  cli.duda.J.Coop.sairDaGuerra('saiu');
  entrega();
  cli.duda.vivo = false;
  const vf = cli.duda.vidaFim[0];
  check('Vida.fim com os DOIS heróis dela a 0 (e o máximo de cada um)', !!vf && Object.keys(vf.fim).length === 2 && Object.keys(vf.fim).every((k) => vf.fim[k] === 0 && vf.max[k] > 0),
        JSON.stringify(vf));
  check('a saída vai ao servidor pela Autoridade (POST /api/guerra/sair {gid})', cli.duda.saidas.length === 1 && cli.duda.saidas[0].via === 'autoridade' && cli.duda.saidas[0].gid === g.m.gid,
        JSON.stringify(cli.duda.saidas));
  check('quem saiu volta à praça sem sessão de guerra', tela('duda') === 'hub' && cli.duda.J.Game.modoRede() === null && !cli.duda.J.Coop.ativo());
  ate(() => outros('duda').every((id) => unid(id, 'duda').every((u) => !u.alive)), 400, 50, outros('duda'));
  check('os dois heróis dela caem nos três motores', outros('duda').every((id) => unid(id, 'duda').length === 2 && unid(id, 'duda').every((u) => !u.alive)));
  check('e a marca `morte` entra no registro dos três (a prova é a saída declarada)',
        outros('duda').every((id) => cli[id].J.Coop.logServidor().lances.filter((l) => l.a === 'x' && l.ev === 'morte').length === 2));
  check('ela não fecha a guerra (quem sai não fecha: os outros fecham)', cli.duda.fechou.length === 0);
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B7
if (quer('B7')) (function B7() {
  secao('B7 · quem sai antes de o salão abrir (a carga estourou): o `sai` sem unidade derruba todos os heróis dele');
  const g = abreTodos();
  ate(() => IDS.every((id) => !cli[id].J.Coop.bloqueado()), 200);
  cli.duda.J.Game.state = null;                    // o salão da Duda nunca abriu
  cli.duda.J.Coop.sairDaGuerra('carga');
  entrega();
  cli.duda.vivo = false;
  check('a saída por carga também é declarada ao servidor', cli.duda.saidas.length === 1 && cli.duda.saidas[0].gid === g.m.gid);
  check('e o aviso diz que os dois heróis ficam sem vida', cli.duda.avisos.some((a) => /os seus dois heróis ficam sem vida/.test(a.m)), cli.duda.avisos.map((a) => a.m).slice(-1).join(''));
  const sais = registro.filter((m) => m.acao === 'sai' && m.de === 'duda');
  check('o `sai` vai aos três sem unidade (todos: true)', sais.length === 3 && sais.every((m) => m.dados.todos === true), JSON.stringify(sais.map((m) => m.dados)));
  pilota(outros('duda'));
  ate(() => outros('duda').every((id) => unid(id, 'duda').every((u) => !u.alive)), 400, 50, outros('duda'));
  check('os dois heróis dela caem nos três motores', outros('duda').every((id) => unid(id, 'duda').length === 2 && unid(id, 'duda').every((u) => !u.alive)),
        outros('duda').map((id) => iaDe(id, 'duda')).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B8
if (quer('B8')) (function B8() {
  secao('B8 · depois do fim, "Voltar à Sede" fecha a sessão (Game.restart(\'hub\'))');
  abreTodos();
  pilota();
  ate(() => IDS.every((id) => tela(id) !== 'battle'), 60000, 50);
  check('a tela de fim é a da guerra e o Coop ainda guarda a sessão (o fechar está a caminho)',
        tela('ana') === 'duelFim' && ses('ana').tipo === 'guerra' && !!ses('ana').fim);
  cli.ana.J.Game.restart('hub');
  check('depois do restart: sem modo de rede, sem sessão de guerra, Coop inativo',
        cli.ana.J.Game.modoRede() === null && ses('ana').tipo !== 'guerra' && !cli.ana.J.Coop.ativo() && tela('ana') === 'hub',
        cli.ana.J.Game.modoRede() + ' · ' + ses('ana').tipo + ' · ' + tela('ana'));
  check('o fechar da Ana já tinha saído com o gid', cli.ana.fechou.length === 1);
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B9
if (quer('B9')) (function B9() {
  secao('B9 · a Ana entra atrasada com os prazos do `dentro` DESENCONTRADOS (depois do prazo do Cris/Duda, antes do da Bia)');
  const g = abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000, porCliente: { bia: { DENTRO_MS: 30000 } } }, ['ana']);
  cli.ana.vivo = false;
  pilota(outros('ana'));
  const t0 = relogio.t;
  ate(() => relogio.t - t0 >= 20000, 400, 100, outros('ana'));
  check('(cenário) aos 20 s o Cris e a Duda já soltaram a guerra e a Bia (30 s) ainda não',
        !cli.cris.J.Coop.bloqueado() && !cli.duda.J.Coop.bloqueado() && cli.bia.J.Coop.bloqueado());
  registro.length = 0;
  abre('ana', g.m, { GRACA_MS: 1500, SILENCIO_MS: 60000 });
  cli.ana.J.Coop._piloto({ joga: true });
  const tEntrou = relogio.t;
  ate(() => ses('ana').restauracoes > 0, 50, 100);
  const respostas = registro.filter((m) => m.acao === 'dentro' && m.para === 'ana' && m.dados.viu === true).map((m) => m.de + ':' + m.dados.tarde);
  check('(cenário) a Ana é "tarde" para o Cris e a Duda e não para a Bia', respostas.indexOf('cris:true') >= 0 && respostas.indexOf('duda:true') >= 0 && respostas.indexOf('bia:false') >= 0, respostas.join(' '));
  check('a Ana se acerta pela foto da Bia em menos de 5 s (a Bia soube pelos `caidos` que a Ana chegou atrasada)',
        ses('ana').restauracoes === 1 && relogio.t - tEntrou < 5000 && !cli.ana.J.Coop.bloqueado(),
        'restaurações ' + ses('ana').restauracoes + ' · ' + Math.round((relogio.t - tEntrou) / 1000) + ' s · bloqueado ' + cli.ana.J.Coop.bloqueado());
  check('quem manda é a Bia na conta dos quatro', IDS.every((id) => ses(id).guerra.autoridade === 'bia'), autoridades());
  ate(() => false, 60, 100);
  check('ninguém marca ninguém por PRAZO (o relógio do motor congelado não estoura a vez de quem está ali)', !marcasPrazo().length, marcasPrazo().join(' '));
  check('nenhum dos três restaura', outros('ana').every((id) => ses(id).restauracoes === 0), outros('ana').map((id) => id + '=' + ses(id).restauracoes).join(' '));
  ate(() => IDS.every((id) => tela(id) !== 'battle'), 60000, 100);
  const lancesBia = registro.filter((m) => m.acao === 'lance' && m.de === 'bia' && m.t > tEntrou).length;
  check('a Bia (presente o tempo todo) segue jogando depois da entrada da Ana, e a guerra acaba nos quatro',
        lancesBia > 0 && IDS.every((id) => tela(id) === 'duelFim'), 'lances da Bia ' + lancesBia + ' · telas ' + IDS.map(tela).join(','));
  check('marcas por prazo na guerra inteira: nenhuma', !marcasPrazo().length, marcasPrazo().join(' '));
  check('o turno nunca diminuiu em ninguém', !diminuiu.length, diminuiu.slice(0, 3).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B10
if (quer('B10')) (function B10() {
  secao('B10 · queda cruzada: o Cris cai; a Ana (A1) cai enquanto ele está fora; o Cris volta sem ter visto o `caiu` dela');
  abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 6), 3000);
  cai('cris');
  ate(() => false, 10, 100, outros('cris'));
  cai('ana');
  ate(() => unid('bia', 'ana').every((u) => u.ia || !u.alive), 3000, 100, ['bia', 'duda']);
  ate(() => false, 5, 100, ['bia', 'duda']);
  if (tela('bia') !== 'battle') { check('(acabou antes — o cenário não rodou)', false, 'turnos ' + IDS.map(turno).join(',')); return; }
  registro.length = 0;
  volta('cris');
  const tC = relogio.t;
  ate(() => ses('cris').restauracoes > 0, 50, 100, ['bia', 'cris', 'duda']);
  check('o Cris volta e aceita a foto da Bia em menos de 5 s (os `caidos` dela dizem que a Ana caiu: quem manda é a Bia)',
        ses('cris').restauracoes === 1 && relogio.t - tC < 5000 && !cli.cris.J.Coop.bloqueado() && ses('cris').guerra.autoridade === 'bia',
        'restaurações ' + ses('cris').restauracoes + ' · ' + Math.round((relogio.t - tC) / 1000) + ' s · ' + autoridades());
  volta('ana');
  ate(() => ses('ana').restauracoes > 0, 50, 100);
  check('a Ana volta (euCai) e se acerta pela Bia', ses('ana').restauracoes === 1 && ses('ana').guerra.autoridade === 'bia', autoridades());
  const tA = relogio.t, T0 = Math.max(...IDS.map(turno));
  ate(() => IDS.some((id) => tela(id) !== 'battle') || relogio.t - tA > 60000, 600, 100);
  check('a guerra anda para os quatro (ninguém travado, o turno sobe)', IDS.every((id) => tela(id) !== 'battle' || (!cli[id].J.Coop.bloqueado() && turno(id) > T0 + 6)),
        'turnos ' + IDS.map((id) => id + '=' + turno(id)).join(' ') + ' · telas ' + IDS.map(tela).join(','));
  check('a marca do Cris e a da Duda são iguais nos quatro (a `volta` que chegou antes da foto entrou depois dela)',
        new Set(IDS.map((id) => iaDe(id, 'cris'))).size === 1 && new Set(IDS.map((id) => iaDe(id, 'duda'))).size === 1,
        'cris ' + IDS.map((id) => iaDe(id, 'cris')).join(' ') + ' · duda ' + IDS.map((id) => iaDe(id, 'duda')).join(' '));
  check('ninguém marcou ninguém por PRAZO', !marcasPrazo().length, marcasPrazo().join(' '));
  check('uma restauração só em cada um que voltou; nenhuma na Bia e na Duda', ses('cris').restauracoes === 1 && ses('ana').restauracoes === 1 && ses('bia').restauracoes === 0 && ses('duda').restauracoes === 0,
        IDS.map((id) => id + '=' + ses(id).restauracoes).join(' '));
  check('o turno nunca diminuiu em ninguém', !diminuiu.length, diminuiu.slice(0, 3).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B11
if (quer('B11')) (function B11() {
  secao('B11 · a marca `ia` com quem recebe À FRENTE de quem marcou (a entrada da Bia segurada)');
  abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 6), 3000);
  cai('ana');
  segura.bia = true;                                   // a Bia deixa de RECEBER (o que ela manda segue)
  const tB = turno('bia');
  ate(() => turno('cris') > tB + 1 && registro.some((m) => m.acao === 'ia' && m.de === 'bia'), 60, 100, outros('ana'));
  const marca = registro.filter((m) => m.acao === 'ia' && m.de === 'bia' && m.dados.mot !== 'volta');
  check('(cenário) quando a marca da Bia saiu, o Cris e a Duda já estavam num turno À FRENTE do dela',
        marca.length > 0 && outros('ana').some((id) => turno(id) > marca[0].dados.T), 'marca em T' + (marca[0] && marca[0].dados.T) + ' · turnos ' + outros('ana').map((id) => id + '=' + turno(id)).join(' '));
  const rest0 = {}; IDS.forEach((id) => { rest0[id] = ses(id).restauracoes; });
  registro.length = 0;
  solta('bia');
  ate(() => false, 60, 100, outros('ana'));
  const dess = registro.filter((m) => m.acao === 'dessinc');
  check('a marca fora de ordem não custa divergência: zero `dessinc`, zero restauração (ela entra na VEZ do herói nos três)',
        !dess.length && outros('ana').every((id) => ses(id).restauracoes === rest0[id]),
        'dessinc ' + dess.map((m) => m.de + '@T' + m.dados.T).join(' ') + ' · restaurações ' + outros('ana').map((id) => id + '=' + (ses(id).restauracoes - rest0[id])).join(' '));
  const hs = hashesIguais(outros('ana'), tB);
  check('o hash bate nos três desde o turno da marca', !hs.dif.length && hs.n > 4, hs.n + ' turnos · dif ' + hs.dif.slice(0, 4).join(' '));
  check('a marca da Ana é igual nos três', new Set(outros('ana').map((id) => iaDe(id, 'ana'))).size === 1, outros('ana').map((id) => iaDe(id, 'ana')).join(' '));
  check('o turno nunca diminuiu em ninguém', !diminuiu.length, diminuiu.slice(0, 3).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B12
if (quer('B12')) (function B12() {
  secao('B12 · o relé reinicia: os quatro caem e voltam por conexões novas, sem `caiu` nenhum');
  abreTodos({ GRACA_MS: 1500 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 6), 3000);
  const t0 = relogio.t, T0 = Math.max(...IDS.map(turno));
  IDS.forEach((id) => { cli[id].vivo = false; });
  relogio.t += 3000;
  registro.length = 0;
  IDS.forEach(volta);
  // (a conexão nova só se apresenta no tique seguinte ao `religou`; quem manda depois disso é a Ana, e os três se acertam por ela)
  ate(() => outros('ana').every((id) => ses(id).restauracoes > 0) && IDS.every((id) => !cli[id].J.Coop.bloqueado()), 100, 100);
  check('cada conexão nova se apresenta aos três com `dentro {religou}` sem cx', IDS.every((id) => registro.filter((m) => m.acao === 'dentro' && m.de === id && m.dados.religou === true && m.dados.viu === false).length >= 3),
        IDS.map((id) => id + '=' + registro.filter((m) => m.acao === 'dentro' && m.de === id && m.dados.religou === true && m.dados.viu === false).length).join(' '));
  check('em menos de 10 s os quatro estão sincronizados e jogando', IDS.every((id) => !cli[id].J.Coop.bloqueado()) && relogio.t - t0 < 13000,
        IDS.map((id) => id + '=' + cli[id].J.Coop.bloqueado()).join(' ') + ' · ' + Math.round((relogio.t - t0) / 1000) + ' s');
  check('os quatro caíram alguma vez: quem manda volta a ser a primeira da ordem presente (a Ana) na conta de todos', IDS.every((id) => ses(id).guerra.autoridade === 'ana'), autoridades());
  check('quem manda não restaura; os outros três, uma vez cada', ses('ana').restauracoes === 0 && outros('ana').every((id) => ses(id).restauracoes === 1),
        IDS.map((id) => id + '=' + ses(id).restauracoes).join(' '));
  ate(() => IDS.every((id) => tela(id) !== 'battle') || relogio.t - t0 > 130000, 1300, 100);
  const fins = IDS.map((id) => (cli[id].telas.filter((t) => t.n === 'duelFim').pop() || {}).d || null);
  check('a guerra segue até o fim para os quatro, sem W.O. (ninguém "venceu" contra gente que está ali)',
        IDS.every((id) => tela(id) === 'duelFim') && fins.every((f) => f && !f.wo) && IDS.every((id) => turno(id) > T0 + 6),
        'telas ' + IDS.map(tela).join(',') + ' · fins ' + fins.map((f) => (f ? (f.wo ? 'wo' : (f.venci ? 'venci' : 'perdi')) : '-')).join(','));
  check('os quatro fecham com o mesmo hash do fim e sem `wo`', IDS.every((id) => cli[id].fechou[0] && !cli[id].fechou[0].corpo.wo && cli[id].fechou[0].corpo.hashFinal === cli.ana.fechou[0].corpo.hashFinal),
        IDS.map((id) => cli[id].fechou[0] ? cli[id].fechou[0].corpo.hashFinal : '-').join(','));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

// ---------------------------------------------------------------- B13
if (quer('B13')) (function B13() {
  secao('B13 · a Ana religa ANTES de o relé anunciar o `caiu` da conexão velha (o `caiu` velho chega depois)');
  abreTodos({ GRACA_MS: 1500, SILENCIO_MS: 60000 });
  pilota();
  ate(() => IDS.every((id) => turno(id) >= 6), 3000);
  const cxVelho = cli.ana.cx;
  cli.ana.vivo = false;
  ate(() => false, 20, 100, outros('ana'));
  registro.length = 0;
  volta('ana');
  const tV = relogio.t;
  ate(() => ses('ana').restauracoes > 0, 50, 100);
  check('sem o `caiu`, a conexão nova se apresenta (`dentro {religou}`) e a Ana se acerta pela Bia em menos de 5 s',
        ses('ana').restauracoes === 1 && relogio.t - tV < 5000 && !cli.ana.J.Coop.bloqueado() && IDS.every((id) => ses(id).guerra.autoridade === 'bia'),
        'restaurações ' + ses('ana').restauracoes + ' · ' + Math.round((relogio.t - tV) / 1000) + ' s · ' + autoridades());
  outros('ana').forEach((x) => cli[x].J.Rede._sinal({ tipo: 'caiu', id: 'ana', cx: cxVelho }));
  ate(() => false, 30, 100);
  check('o `caiu` atrasado da conexão VELHA não a derruba de novo: sem segunda foto, sem marca por prazo, ninguém a dá por fora',
        ses('ana').restauracoes === 1 && !marcasPrazo().length && outros('ana').every((id) => ses(id).guerra.jogadores.find((j) => j.id === 'ana').on),
        'restaurações ' + ses('ana').restauracoes + ' · on ' + outros('ana').map((id) => ses(id).guerra.jogadores.find((j) => j.id === 'ana').on).join(','));
  const tA = Math.max(...IDS.map(turno));
  ate(() => IDS.every((id) => tela(id) !== 'battle' || turno(id) >= tA + 12), 20000);
  const hs = hashesIguais(IDS, tA + 1);
  check('daí em diante o hash bate nos quatro', !hs.dif.length && hs.n > 0, hs.n + ' turnos · dif ' + hs.dif.slice(0, 4).join(' '));
  check('nenhum erro de script', !erros.length, erros.slice(0, 2).join(' | '));
})();

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
