#!/usr/bin/env node
/* ============================================================================
   SOTERRA — tests/pedidos_duas_pontas.js                          (06/10)
   OS PEDIDOS ENTRE JOGADORES, DE PONTA A PONTA, SEM NAVEGADOR.

       node tests/pedidos_duas_pontas.js

   O dono, com dois celulares e contas diferentes: "se eu dou troca ou qualquer
   comando com outro jogador, buga e não consigo de novo. Eu mandei grupo pro
   jogador e sumiu a solicitação e não consegui mandar de novo até expirar...
   troca acontece o mesmo."

   Aqui são DOIS js/core/grupo.js e DOIS js/core/troca.js de verdade (a Ana e a
   Bia, cada uma no seu contexto), ligados por um fio de mentira que entrega o
   que um manda ao outro — na ordem, um envelope por vez, como o relé. O relógio
   é injetado. Game, Coop, Progress e DATA são de mentira, só com o que os dois
   módulos leem. A tela (o cartão que não some) é de tests/pedidos_hud.html.

   Cobra, no fio:
     - quem chamou CANCELA e chama de novo sem esperar o prazo (grupo, duelo e
       troca), e o outro lado solta na hora;
     - chamar de novo a mesma pessoa TROCA o pedido anterior nos dois lados;
     - recusar e expirar soltam os DOIS lados (a troca não tinha prazo nenhum);
     - o cliente de ANTES (que não troca o pedido nem avisa o prazo) segue
       funcionando com o de agora: nada de voz nova no fio;
     - quem volta ao acampamento sobe SOZINHO: o outro fica onde está e a
       descida dele segue só com os heróis dele; o grupo continua.
   ========================================================================== */
'use strict';
var vm = require('vm'), fs = require('fs'), path = require('path');
var RAIZ = path.join(__dirname, '..');
var FONTES = ['js/core/troca.js', 'js/core/grupo.js'].map(function (f) {
  return { nome: f, texto: fs.readFileSync(path.join(RAIZ, f), 'utf8') };
});

var total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU · ' : 'FALHOU · ') + nome + (!ok && extra !== undefined ? '   [' + extra + ']' : ''));
}
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

var relogio = 1000000;
var fila = [], fio = [];

/* um lado: o grupo.js e o troca.js dele, com a Rede, o Game e a tela de mentira */
function lado(id, nome) {
  var S = { id: id, nome: nome, cx: 'cx-' + id, tela: 'hub', modo: null, outro: null, ouv: {}, avisos: [],
            corta: false, sozinho: 0, subidas: [] };
  var J = {};
  function sai(ev) {
    fio.push({ de: id, tipo: ev.tipo, acao: ev.acao, dados: clone(ev.dados) });
    if (!S.corta && S.outro && ev.para === S.outro.id) fila.push({ a: S.outro, ev: ev });
    return true;
  }
  J.Rede = {
    meuId: function () { return id; }, meuCx: function () { return S.cx; }, minhaSala: function () { return null; },
    pares: function () { return S.outro ? [{ id: S.outro.id, nome: S.outro.nome, sala: null }] : []; },
    nomeDe: function (x) { return (S.outro && x === S.outro.id) ? S.outro.nome : 'Aventureiro'; },
    ouvir: function (tipo, fn) { (S.ouv[tipo] = S.ouv[tipo] || []).push(fn); return function () {}; },
    dirige: function (tipo, para, acao, dados) {
      return sai({ tipo: tipo, para: para, de: id, cx: S.cx, nome: nome, acao: acao, dados: clone(dados || {}) });
    },
    trocaManda: function (para, acao, dados) {
      return sai({ tipo: 'troca', para: para, de: id, cx: S.cx, nome: nome, acao: acao, dados: clone(dados || null) });
    },
    ultimaRecusa: function () { return null; }, vigia: function () {}, solta: function () {}, cala: function () {},
    transporte: function () { return 'ws'; }
  };
  J.UI = { telaAtual: function () { return S.tela; } };
  J.Game = {
    state: null, dificuldade: 'normal', dungeonId: null, roomIndex: 0,
    startRun: function (ids, dg, opts) { S.tela = 'antessala'; S.modo = (opts && opts.grupo) ? 'grupo' : null; J.Game.dungeonId = dg; return true; },
    modoRede: function () { return S.modo; },
    segueSozinho: function () { if (S.modo !== 'grupo' || S.tela === 'battle') return false; S.modo = null; S.sozinho++; return true; }
  };
  Object.defineProperty(J.Game, 'screen', { get: function () { return S.tela === 'hub' ? 'menu' : S.tela; } });
  J.Progress = { hero: function () { return { classId: 'sumo', element: 'fogo', level: 10 }; },
                 heroIds: function () { return ['h1', 'h2']; } };
  J.DATA = { dungeons: [{ id: 'cisterna', name: 'A Cisterna', rooms: [{}, {}, {}] }], dificuldades: { normal: { nome: 'Normal' } } };
  J.Coop = { GRACA_MS: 15000, configura: function () {}, assinatura: function () { return 'a1'; },
             parceiroSumiu: function () {}, parceiroVoltou: function () {}, sessao: function () { return {}; } };
  var ctx = vm.createContext({ JOGO: J, console: console, setInterval: function () { return 0; }, clearInterval: function () {},
                               setTimeout: setTimeout, clearTimeout: clearTimeout });
  FONTES.forEach(function (f) { vm.runInContext(f.texto, ctx, { filename: f.nome }); });
  J.Grupo._agora = J.Duelo._agora = function () { return relogio; };
  if ('_agora' in J.Troca) J.Troca._agora = function () { return relogio; };
  J.Grupo.aoAviso = function (t) { S.avisos.push(String(t)); };
  J.Grupo.aoSubiu = function (m) { S.subidas.push(m); S.tela = 'hub'; S.modo = null; };
  J.Troca.aoMudar = function (est) { if (est && est.fase === 'cancelada' && est.motivo) S.avisos.push(String(est.motivo)); };
  J.Grupo.defineHerois(['h1', 'h2']);
  S.J = J; S.G = J.Grupo; S.D = J.Duelo; S.T = J.Troca;
  S.recebe = function (ev) {
    if (ev.tipo === 'troca') { J.Troca.aoEvento(ev); return; }
    (S.ouv[ev.tipo] || []).forEach(function (fn) { fn(clone(ev)); });
  };
  S.tique = function () { J.Grupo._tique(); if (J.Troca._tique) J.Troca._tique(); };
  S.avisou = function (re) { return S.avisos.some(function (t) { return re.test(t); }); };
  return S;
}
/* o fio anda: um envelope por vez, até esvaziar (a resposta de um entra no fim da fila) */
function anda() { var n = 0; while (fila.length && n++ < 200) { var x = fila.shift(); x.a.recebe(x.ev); } }
function passa(ms) { relogio += ms; ana.tique(); bia.tique(); anda(); }
function mandou(de, tipo, acao, desde) {
  return fio.slice(desde || 0).filter(function (m) { return m.de === de && m.tipo === tipo && m.acao === acao; });
}
function livres() {
  return ana.G.estado().fase === 'livre' && bia.G.estado().fase === 'livre' && !ana.G.estado().pendente && !bia.G.estado().pendente;
}
function trocaLivre() { return ana.T.estado() === null && bia.T.estado() === null; }
function dueloLivre() { return ana.D.estado().fase === 'livre' && bia.D.estado().fase === 'livre'; }

var ana = lado('ana', 'Ana'), bia = lado('bia', 'Bia');
ana.outro = bia; bia.outro = ana;

// ============================================================ o convite de grupo
console.log('\n== grupo: cancelar, chamar de novo, recusar, expirar');
var r = ana.G.convidar('bia'); anda();
check('o convite chega: a Ana espera e a Bia tem o pedido', r.ok && ana.G.estado().fase === 'convidei' &&
      bia.G.estado().fase === 'convidado' && bia.G.estado().pendente && !bia.G.estado().pendente.meu, JSON.stringify(bia.G.estado().pendente));
check('o estado de quem chamou diz que o pedido é dele e até quando vale',
      !!ana.G.estado().pendente && ana.G.estado().pendente.meu === true && ana.G.estado().pendente.expira === relogio + 30000);
var gid1 = bia.G.estado().pendente.gid;
passa(4000);
check('quem chamou CANCELA: os dois lados soltam na hora e a Bia é avisada',
      typeof ana.G.cancelar === 'function' && ana.G.cancelar() === true && (anda(), livres()) && bia.avisou(/Ana retirou o convite/),
      typeof ana.G.cancelar + ' · ' + ana.G.estado().fase + '/' + bia.G.estado().fase + ' · ' + JSON.stringify(bia.avisos));
r = ana.G.convidar('bia'); anda();
check('...e chama de novo sem esperar o prazo', r.ok && bia.G.estado().fase === 'convidado' && bia.G.estado().pendente.gid !== gid1,
      JSON.stringify(r) + ' · ' + bia.G.estado().fase);
var gid2 = bia.G.estado().pendente && bia.G.estado().pendente.gid;
passa(5000);
var n0 = fio.length;
r = ana.G.convidar('bia'); anda();
var gid3 = bia.G.estado().pendente && bia.G.estado().pendente.gid;
check('chamar de novo a MESMA pessoa troca o pedido nos dois lados (um só, o novo, com o prazo cheio)',
      r.ok && ana.G.estado().fase === 'convidei' && bia.G.estado().fase === 'convidado' && !!gid3 && gid3 !== gid2 &&
      ana.G.estado().pendente.gid === gid3 && bia.G.estado().pendente.expira === relogio + 30000,
      JSON.stringify(r) + ' · ' + gid2 + ' → ' + gid3);
check('...e no fio foi a voz de sempre: o "sair" do convite velho e o convite novo',
      mandou('ana', 'grupo', 'sair', n0).length === 1 && mandou('ana', 'grupo', 'convite', n0).length === 1,
      JSON.stringify(fio.slice(n0)));
// o `sair` do convite velho se perde no caminho: o convite novo de quem já chamou troca o que estava na tela
passa(3000);
ana.corta = true; ana.G.cancelar(); ana.corta = false;
r = ana.G.convidar('bia'); anda();
check('o cancelar que se perdeu não prende ninguém: o convite novo de quem já tinha chamado vale',
      r.ok && bia.G.estado().fase === 'convidado' && bia.G.estado().pendente.gid === ana.G.estado().pendente.gid &&
      bia.G.estado().pendente.gid !== gid3, bia.G.estado().fase + ' · ' + JSON.stringify(ana.G.estado().pendente));
bia.avisos.length = 0; ana.avisos.length = 0;
bia.G.responder(false); anda();
check('RECUSAR solta os dois lados e avisa quem chamou', livres() && ana.avisou(/Bia recusou o convite/), JSON.stringify(ana.avisos));
r = ana.G.convidar('bia'); anda();
check('(depois da recusa, chamar de novo é na hora)', r.ok && bia.G.estado().fase === 'convidado');
ana.avisos.length = 0; bia.avisos.length = 0;
// o prazo: a Bia está com a aba em segundo plano (o relógio dela não anda) — o aviso de quem chamou a solta
relogio += 30001; n0 = fio.length; ana.tique(); anda();
check('EXPIRAR: quem chamou solta e avisa o outro lado, que solta sem depender do relógio dele',
      livres() && ana.avisou(/convite expirou/) && bia.avisou(/convite de Ana expirou/) && mandou('ana', 'grupo', 'sair', n0).length === 1,
      ana.G.estado().fase + '/' + bia.G.estado().fase + ' · ' + JSON.stringify(bia.avisos));
// e o contrário: quem RECEBEU vê o prazo acabar primeiro
r = ana.G.convidar('bia'); anda();
ana.avisos.length = 0;
relogio += 30001; bia.tique(); anda();
check('EXPIRAR do lado de quem recebeu: ele avisa e quem chamou solta na hora', livres() && ana.avisou(/expirou/),
      ana.G.estado().fase + '/' + bia.G.estado().fase + ' · ' + JSON.stringify(ana.avisos));
r = ana.G.convidar('bia'); anda();
check('(e o convite seguinte sai)', r.ok && bia.G.estado().fase === 'convidado');
bia.G.responder(true); anda();
check('ACEITAR forma o grupo nos dois lados, a Ana liderando', ana.G.emGrupo() && bia.G.emGrupo() && ana.G.souLider() && !bia.G.souLider());
ana.G.sair(); anda();
check('(sair desfaz nos dois)', !ana.G.emGrupo() && !bia.G.emGrupo() && livres());

// ============================================================ o desafio amistoso
console.log('\n== duelo: cancelar, desafiar de novo, recusar, expirar');
r = ana.D.desafiar('bia'); anda();
check('o desafio chega', r.ok && ana.D.estado().fase === 'desafiei' && bia.D.estado().fase === 'desafiado');
var did1 = bia.D.estado().did;
bia.avisos.length = 0;
ana.D.cancelar('retirou'); anda();
check('quem desafiou CANCELA: os dois soltam e o outro é avisado', dueloLivre() && bia.avisou(/desafio de Ana foi retirado/), JSON.stringify(bia.avisos));
r = ana.D.desafiar('bia'); anda();
var did2 = bia.D.estado().did;
passa(2000);
r = ana.D.desafiar('bia'); anda();
check('desafiar de novo a mesma pessoa troca o desafio nos dois lados',
      r.ok && ana.D.estado().fase === 'desafiei' && bia.D.estado().fase === 'desafiado' && bia.D.estado().did === ana.D.estado().did &&
      bia.D.estado().did !== did2 && did2 !== did1, JSON.stringify(r) + ' · ' + did2 + ' → ' + bia.D.estado().did);
ana.avisos.length = 0;
bia.D.responder(false); anda();
check('RECUSAR o desafio solta os dois', dueloLivre() && ana.avisou(/Bia recusou o duelo/));
r = ana.D.desafiar('bia'); anda();
ana.avisos.length = 0; bia.avisos.length = 0;
relogio += 30001; ana.tique(); anda();
check('o desafio EXPIRA em quem desafiou e o outro lado solta junto', dueloLivre() && ana.avisou(/desafio expirou/) && bia.avisos.length === 1,
      ana.D.estado().fase + '/' + bia.D.estado().fase + ' · ' + JSON.stringify(bia.avisos));

// ============================================================ a troca
console.log('\n== troca: o prazo que não existia, cancelar, propor de novo');
check('propor a troca: a Ana espera, a Bia tem o pedido — e os dois com prazo',
      ana.T.convidar('bia') === true && (anda(), ana.T.estado().fase === 'convidei' && bia.T.estado().fase === 'convidado') &&
      ana.T.estado().expira === relogio + 30000 && bia.T.estado().expira === relogio + 30000,
      JSON.stringify([ana.T.estado() && ana.T.estado().expira, bia.T.estado() && bia.T.estado().expira]));
bia.avisos.length = 0;
ana.T.cancelar(); anda();
check('quem propôs CANCELA: a mesa some dos dois lados e a Bia é avisada', trocaLivre() && bia.avisou(/Ana retirou o pedido de troca/), JSON.stringify(bia.avisos));
ana.T.convidar('bia'); anda();
passa(3000);
n0 = fio.length;
check('propor de novo à MESMA pessoa troca o pedido (antes: "já há uma troca aberta")',
      ana.T.convidar('bia') === true && (anda(), ana.T.estado().fase === 'convidei' && bia.T.estado().fase === 'convidado') &&
      bia.T.estado().expira === relogio + 30000, JSON.stringify(fio.slice(n0)));
ana.avisos.length = 0;
bia.T.responder(false); anda();
check('RECUSAR a troca solta os dois e diz a quem propôs', trocaLivre() && ana.avisou(/Bia recusou a troca/), JSON.stringify(ana.avisos));
ana.T.convidar('bia'); anda();
ana.avisos.length = 0; bia.avisos.length = 0;
relogio += 30001; ana.tique(); anda();
check('o pedido de troca EXPIRA (antes ficava para sempre) e solta os dois lados',
      trocaLivre() && ana.avisou(/pedido de troca expirou/) && bia.avisou(/pedido de troca de Ana expirou/),
      JSON.stringify([ana.T.estado() && ana.T.estado().fase, bia.T.estado() && bia.T.estado().fase, ana.avisos, bia.avisos]));
ana.T.convidar('bia'); anda();
ana.avisos.length = 0;
relogio += 30001; bia.tique(); anda();
check('...e do lado de quem recebeu também: ele avisa, e quem propôs solta', trocaLivre() && ana.avisou(/expirou/), JSON.stringify(ana.avisos));
// a troca presa travava o resto: com um pedido de troca esquecido, o convite de grupo era recusado ("está numa troca")
ana.T.convidar('bia'); anda();
relogio += 30001; ana.tique(); bia.tique(); anda();
r = ana.G.convidar('bia'); anda();
check('depois do prazo da troca, o convite de grupo passa (a troca esquecida recusava todo pedido)',
      r.ok && bia.G.estado().fase === 'convidado', JSON.stringify(r) + ' · ' + bia.G.estado().fase + ' · ' + JSON.stringify(ana.avisos));
ana.G.cancelar && ana.G.cancelar(); anda();
// a troca aberta de verdade (os dois na mesa) não expira nem é trocada por um pedido novo
ana.T.convidar('bia'); anda(); bia.T.responder(true); anda();
relogio += 120000; ana.tique(); bia.tique(); anda();
check('a mesa ABERTA não tem prazo: os dois seguem nela', ana.T.estado().fase === 'aberta' && bia.T.estado().fase === 'aberta');
check('...e propor outra com a mesa aberta segue recusado', ana.T.convidar('bia') === false && ana.T.estado().fase === 'aberta');
ana.T.cancelar(); anda();
check('(cancelar a mesa aberta solta os dois)', trocaLivre());
// quem está numa batalha não vê o pedido: recusa na hora, em vez de guardá-lo sem tela
bia.tela = 'battle';
ana.avisos.length = 0;
ana.T.convidar('bia'); anda();
check('quem está em batalha recusa o pedido de troca na hora (antes guardava um pedido que ninguém via)',
      trocaLivre() && ana.avisou(/Bia está ocupad/), JSON.stringify([bia.T.estado() && bia.T.estado().fase, ana.avisos]));
bia.tela = 'hub';

// ============================================================ voltar ao acampamento
console.log('\n== voltar ao acampamento é de cada um');
/* O dono: "se um dos membros do grupo volta ao acampamento, os outros voltam também.. essa decisão deve ser
 * individual." O Game de mentira guarda o modo da descida ('grupo' ou null) e conta o Game.segueSozinho. */
function formaGrupo() {
  ana.tela = 'hub'; bia.tela = 'hub'; ana.modo = null; bia.modo = null;
  passa(1100);
  ana.G.convidar('bia'); anda(); bia.G.responder(true); anda();
  ana.avisos.length = 0; bia.avisos.length = 0; ana.subidas.length = 0; bia.subidas.length = 0;
  return ana.G.emGrupo() && bia.G.emGrupo() && ana.G.souLider();
}
function descem() { var x = ana.G.descer('cisterna'); anda(); return x.ok && ana.tela === 'antessala' && bia.tela === 'antessala'; }
check('(o grupo se forma e as duas descem juntas: antessala, descida de grupo)', formaGrupo() && descem() &&
      ana.modo === 'grupo' && bia.modo === 'grupo' && ana.G.estado().descidaGrupo === 'cisterna');
n0 = fio.length;
var so0 = ana.sozinho;
bia.G.subir('saiu'); anda();
check('quem volta sobe SOZINHO: a Bia vai para a praça', bia.tela === 'hub' && bia.subidas.length === 1, bia.tela);
check('a Ana NÃO é levada: segue na antessala (antes: "vocês voltaram ao Acampamento")', ana.tela === 'antessala' && ana.subidas.length === 0,
      ana.tela + ' · ' + JSON.stringify(ana.avisos));
check('a descida da Ana virou só dela (Game.segueSozinho) e deixou de contar como descida de grupo',
      ana.sozinho === so0 + 1 && ana.modo === null && ana.G.estado().descidaGrupo === null && !ana.G.estado().descidaAcabou,
      ana.sozinho + ' · ' + ana.modo + ' · ' + JSON.stringify(ana.G.estado().descidaGrupo));
check('a Ana é avisada, e o estado guarda a escolha para a tela', ana.avisou(/Bia voltou ao acampamento/) &&
      !!ana.G.estado().ficouSo && ana.G.estado().ficouSo.nome === 'Bia', JSON.stringify(ana.avisos));
check('o GRUPO continua nos dois lados, a Ana liderando', ana.G.emGrupo() && bia.G.emGrupo() && ana.G.souLider());
check('no fio foi o `subir` de sempre, uma vez', mandou('bia', 'grupo', 'subir', n0).length === 1 && fio.length === n0 + 1, JSON.stringify(fio.slice(n0)));
check('decidir ficar tira a escolha do estado', ana.G.cienteSozinho() === true && !ana.G.estado().ficouSo);
// a Ana, sozinha, sai quando quiser: não chama mais ninguém
n0 = fio.length;
ana.tela = 'hub'; ana.modo = null; passa(1100);
check('quando ela volta depois, sozinha, ninguém mais é avisado nem levado', fio.length === n0 && bia.tela === 'hub' && ana.G.emGrupo());
ana.G.sair(); anda();

// o parceiro volta ao acampamento da recompensa, com a minha sala ainda em curso
check('(outra descida de grupo)', formaGrupo() && descem());
ana.tela = 'battle'; bia.tela = 'roomClear';
so0 = ana.sozinho;
bia.G.subir('voltou'); anda();
check('com a minha sala em curso nada muda agora: fico na batalha, só avisada', ana.tela === 'battle' && ana.sozinho === so0 &&
      ana.subidas.length === 0 && ana.avisou(/Bia voltou ao acampamento\./), JSON.stringify(ana.avisos));
ana.tela = 'roomClear'; passa(1000);
check('ao sair da sala a descida vira só minha, na recompensa', ana.tela === 'roomClear' && ana.sozinho === so0 + 1 && !!ana.G.estado().ficouSo &&
      !ana.G.estado().descidaAcabou && ana.G.emGrupo());
ana.tela = 'hub'; ana.modo = null; passa(1100);
ana.G.sair(); anda();

// a descida que nem começou do lado de quem lidera: aí quem desceu volta, como sempre
check('(o grupo de novo)', formaGrupo());
ana.G.descer('cisterna');
var preso = fila.splice(0);                 // o "descer" demora no caminho
relogio += 5001; ana.tique();               // quem lidera não espera mais de 5 s
fila.push.apply(fila, preso); anda();
check('o "desci" atrasado: a líder manda subir (expirou) e quem desceu volta à praça — não há descida onde ficar',
      bia.tela === 'hub' && bia.subidas.length === 1 && ana.tela === 'hub' && bia.avisou(/não esperou/), bia.tela + ' · ' + JSON.stringify(bia.avisos));
ana.G.sair(); anda();

// o parceiro sai do GRUPO na antessala: eu também não sou levada
check('(e mais uma descida de grupo)', formaGrupo() && descem());
so0 = ana.sozinho;
bia.G.sair(); anda();
check('quem sai do grupo na antessala vai sozinho para a praça; quem fica segue a descida só com os heróis dela',
      bia.tela === 'hub' && ana.tela === 'antessala' && ana.subidas.length === 0 && ana.sozinho === so0 + 1 && !ana.G.emGrupo() &&
      ana.avisou(/Bia saiu do grupo — a descida segue/) && !!ana.G.estado().ficouSo && ana.G.estado().ficouSo.saiu === true,
      bia.tela + '/' + ana.tela + ' · ' + JSON.stringify(ana.avisos));
ana.tela = 'hub'; ana.modo = null; bia.tela = 'hub'; passa(1100);

// ============================================================ o cliente de antes
console.log('\n== o cliente de antes do conserto do outro lado');
/* a Cris joga com o grupo.js e o troca.js do commit anterior? Não há como carregá-los aqui; o que se prova é o fio:
 * tudo o que o cliente de agora manda é voz que o de antes já entendia (git show 1d98b83:js/core/grupo.js):
 * grupo: convite · resposta · sair · estado · descer · desci · subir   duelo: desafio · resposta · cancela
 * troca: convite · aceite · recusa · cancela. O `subir` de quem volta ao acampamento é o mesmo: o cliente de antes que
 * o ouve ainda volta junto (era a regra dele); o de agora fica. */
var vozes = {};
fio.forEach(function (m) { vozes[m.tipo + ':' + m.acao] = 1; });
var conhecidas = ['grupo:convite', 'grupo:resposta', 'grupo:sair', 'grupo:estado', 'grupo:descer', 'grupo:desci', 'grupo:subir',
                  'duelo:desafio', 'duelo:resposta', 'duelo:cancela', 'troca:convite', 'troca:aceite', 'troca:recusa', 'troca:cancela'];
var novas = Object.keys(vozes).filter(function (v) { return conhecidas.indexOf(v) < 0; });
check('nenhuma voz nova no fio: só as que o cliente de antes já entendia', novas.length === 0, novas.join(', '));

module.exports = { ana: ana, bia: bia, check: check, anda: anda, passa: passa, mandou: mandou, fio: fio,
                   relogio: function (d) { if (d) relogio += d; return relogio; }, fim: fim };
function fim() {
  console.log('\n' + (falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
}
if (require.main === module) fim();
