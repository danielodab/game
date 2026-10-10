#!/usr/bin/env node
/* ============================================================================
   SOTERRA — tests/torneio_cliente.js                               (10/10)
   O CLIENTE DO TORNEIO DA ARENA, SEM NAVEGADOR.

       node tests/torneio_cliente.js

   O js/core/torneio.js de verdade e o js/core/grupo.js de verdade (a Arena e o
   Duelo) num contexto só, com a Sessão do site de mentira: as rotas de
   docs/TORNEIO.md respondem daqui e o relógio é injetado. A Rede, o Game e o
   Progress são de mentira, só com o que os dois módulos leem.

   Cobra:
     - a lista pública (o cache curto, a ordem, os próximos de cada faixa);
     - o MEU: a consulta periódica — rara sem nada, a cada ~20 s com inscrição
       ou torneio do dia, a cada 3 s com chamada — e o desvio do relógio;
     - inscrever, sair, presente, voluntariar, desvoluntariar, representante: o
       corpo que sai e o que a resposta muda;
     - os motivos de recusa do contrato, cada um com a sua frase;
     - a ENTREGA: quando `luta.did` aparece, a Arena é consultada e o Duelo
       abre no modo 'arena' com o torneio marcado; um did é entregue UMA vez;
       fora da praça a entrega espera; a revanche (outro did) entra de novo;
     - a vida: no torneio o herói a 0 PV entra (o duelo comum segue recusando);
     - o fim: o campeão avisado uma vez, e só quem participou ou viu ao vivo.
   ========================================================================== */
'use strict';
var vm = require('vm'), fs = require('fs'), path = require('path');
var RAIZ = path.join(__dirname, '..');
function fonte(f) { return { nome: f, texto: fs.readFileSync(path.join(RAIZ, f), 'utf8') }; }
var FONTES = ['js/core/grupo.js', 'js/core/torneio.js'].map(fonte);

var total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU · ' : 'FALHOU · ') + nome + (!ok && extra !== undefined ? '   [' + extra + ']' : ''));
}
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

var relogio = 5000000;
var DESVIO = 7000;                 // o servidor está 7 s à frente do aparelho
var pedidos = [], respostas = {}, saidas = [], avisos = [];
var tela = 'hub', zerados = null, guardado = {};

var J = {};
J.Rede = {
  meuId: function () { return 'ana'; }, meuCx: function () { return 'cx-ana'; }, minhaSala: function () { return null; },
  pares: function () { return [{ id: 'bia', nome: 'Bia', sala: null, nuvem: 22 }]; },
  nomeDe: function (x) { return x === 'bia' ? 'Bia' : 'Aventureiro'; },
  ouvir: function () { return function () {}; },
  dirige: function (tipo, para, acao, dados) { saidas.push({ tipo: tipo, para: para, acao: acao, dados: clone(dados) }); return true; },
  ultimaRecusa: function () { return null; }, vigia: function () {}, solta: function () {}, cala: function () {},
  privado: function () { return true; }, transporte: function () { return 'ws'; }
};
J.UI = { telaAtual: function () { return tela; } };
J.Game = { state: null, screen: 'menu', modoRede: function () { return null; } };
J.Progress = { hero: function (h) { return (h === 'h1' || h === 'h2') ? { classId: h === 'h1' ? 'sumo' : 'arqueiro', level: 22 } : null; },
               heroIds: function () { return ['h1', 'h2']; },
               battleParty: function (ids) { return ids.map(function (h) { return { heroId: h, classId: 'sumo', level: 22, spells: [] }; }); } };
J.DATA = { dungeons: [{ id: 'cisterna', name: 'A Cisterna', rooms: [{}, {}] }], classes: { sumo: {}, arqueiro: {} }, leveling: { maxLevel: 30 } };
J.Coop = { GRACA_MS: 15000, configura: function () {}, sessao: function () { return {}; } };
J.Vida = { zerado: function () { return zerados; }, carry: function () { return null; } };
J.Sessao = {
  ativa: function () { return true; }, contaId: function () { return 11; },
  api: function (rota, op) {
    pedidos.push({ rota: rota, metodo: (op && op.method) || 'GET', corpo: op && op.body !== undefined ? clone(op.body) : null, semToken: !!(op && op.semToken) });
    var r = respostas[rota];
    r = typeof r === 'function' ? r(op || {}) : r;
    return Promise.resolve(r ? clone(r) : { ok: false, status: 404, erro: 'rota de mentira' });
  }
};
var ctx = vm.createContext({
  JOGO: J, console: console, setInterval: function () { return 0; }, clearInterval: function () {},
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  window: { JOGO: J, location: { protocol: 'https:' },
            localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(guardado, k) ? guardado[k] : null; },
                            setItem: function (k, v) { guardado[k] = String(v); }, removeItem: function (k) { delete guardado[k]; } } }
});
FONTES.forEach(function (f) { vm.runInContext(f.texto, ctx, { filename: f.nome }); });
var To = J.Torneio, Ar = J.Arena, Du = J.Duelo;
To._agora = Ar._agora = Du._agora = J.Grupo._agora = function () { return relogio; };
J.Grupo.aoAviso = function (t) { avisos.push(String(t)); };
J.Grupo.defineHerois(['h1', 'h2']);

function srv() { return relogio + DESVIO; }
function espera() { return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }); }
function conta(rota, desde) { return pedidos.slice(desde || 0).filter(function (p) { return p.rota === rota; }).length; }
function ult(rota) { for (var i = pedidos.length - 1; i >= 0; i--) if (pedidos[i].rota === rota) return pedidos[i]; return null; }
/* anda `ms` no relógio em passos de 1 s, com o tique de cada módulo (o setInterval das páginas) */
function passa(ms) {
  var p = Promise.resolve();
  for (var i = 0; i < Math.ceil(ms / 1000); i++) {
    p = p.then(function () { relogio += 1000; To._tique(); J.Grupo._tique(); return espera(); });
  }
  return p;
}

function P(conta, nome) { return { conta: conta, nome: nome, guilda: null }; }
function inscrito(conta, nome, nivel) {
  return { conta: conta, nome: nome, nivel: nivel, classes: [{ classId: 'sumo', nivel: nivel }, { classId: 'arqueiro', nivel: nivel - 1 }], guilda: null };
}
function torneio(id, extra) {
  var t = { id: id, tipo: 'pvp', faixa: '20-25', nivelMin: 20, nivelMax: 25, titulo: 'Torneio da Arena · 20 a 25', origem: 'semanal',
            inicioMs: srv() + 3 * 3600000, inscricaoAteMs: srv() + 3 * 3600000 - 600000, estado: 'inscricoes', vagas: 2,
            inscritos: [], chave: null, campeao: null,
            premio: { barras: 2, vintens: 600, gemas: 0, conquista: false, moldura: false, xpGuilda: 0 } };
  Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
  return t;
}
var meuServidor = { inscricoes: [], luta: null, conquistas: { pvp: 0, guilda: 0 }, moldura: false, vigente: false, guilda: null };
var listaServidor = [];
respostas['/api/torneios'] = function () { return { ok: true, status: 200, agoraMs: srv(), torneios: listaServidor }; };
respostas['/api/torneio/meu'] = function () {
  var r = clone(meuServidor); r.ok = true; r.status = 200; r.agoraMs = srv(); return r;
};

(async function () {
  // ============================================================ a lista pública
  console.log('\n== a lista pública');
  listaServidor = [
    torneio(5, { estado: 'encerrado', inicioMs: srv() - 7 * 86400000, campeao: P(40, 'Davi') }),
    torneio(8, { tipo: 'guilda', faixa: null, nivelMin: 20, nivelMax: 30, titulo: 'Torneio das Guildas', inicioMs: srv() + 27 * 3600000 }),
    torneio(7, { faixa: '25-30', nivelMin: 25, nivelMax: 30, titulo: 'Torneio da Arena · 25 a 30' }),
    torneio(6, { inscritos: [inscrito(22, 'Bia', 23)] }),
    torneio(9, { inicioMs: srv() + 8 * 86400000, titulo: 'o do sábado seguinte' })
  ];
  var r = await To.busca();
  check('a lista vem de GET /api/torneios, sem o token da conta (é pública)', r.ok && ult('/api/torneios').metodo === 'GET' && ult('/api/torneios').semToken === true);
  check('a ordem: os que vêm (o mais próximo primeiro), depois os encerrados', To.torneios().map(function (t) { return t.id; }).join() === '6,7,8,9,5',
        To.torneios().map(function (t) { return t.id; }).join());
  check('os próximos da aba: um por faixa de PvP e o de guilda (o do sábado seguinte fica de fora)',
        To.proximos().map(function (t) { return t.id; }).join() === '6,7,8', To.proximos().map(function (t) { return t.id; }).join());
  check('o relógio do servidor: To.agora() acompanha o agoraMs (o desvio medido)', Math.abs(To.agora() - srv()) < 5, To.agora() - srv());
  var n0 = conta('/api/torneios');
  await To.busca();
  check('o cache curto: a segunda leitura na mesma hora não pede de novo', conta('/api/torneios') === n0);
  await To.busca(true);
  check('forçada, pede de novo', conta('/api/torneios') === n0 + 1);
  check('há torneio do dia (começa em 3 h)', !!To.torneioDoDia() && To.torneioDoDia().id === 6);
  check('o tamanho da chave com N inscritos: 1→2, 3→4, 5→8, 9→16, 40→16',
        [1, 3, 5, 9, 40].map(To.tamanhoCom).join() === '2,4,8,16,16');
  check('o prêmio do torneio cheio (16) e o de 4: a tabela do contrato',
        To.premioDe(16).barras === 20 && To.premioDe(16).vintens === 5000 && To.premioDe(16).gemas === 2 && To.premioDe(16).moldura &&
        To.premioDe(4).barras === 5 && To.premioDe(4).conquista && !To.premioDe(4).moldura && !To.premioDe(2).conquista);
  check('os graus da moldura pelas conquistas: 0→0, 1→I, 2→I, 3→II, 4→II, 5→III, 10→III',
        [0, 1, 2, 3, 4, 5, 10].map(To.grau).join() === '0,1,1,2,2,3,3');

  // ============================================================ a consulta periódica
  console.log('\n== o MEU e o ritmo da consulta');
  check('antes da primeira leitura o MEU é vazio (e não quebra quem lê)', To.meu().inscricoes.length === 0 && To.meu().conquistas.pvp === 0 && To.luta() === null);
  var m0 = conta('/api/torneio/meu');
  await passa(1000);
  check('na praça, a primeira leitura sai no primeiro tique', conta('/api/torneio/meu') === m0 + 1 && To.lido());
  m0 = conta('/api/torneio/meu');
  await passa(19000);
  check('com torneio do dia: nada antes dos 20 s', conta('/api/torneio/meu') === m0, conta('/api/torneio/meu') - m0);
  await passa(2000);
  check('… e uma consulta aos ~20 s (é também o "ainda estou aqui")', conta('/api/torneio/meu') === m0 + 1, conta('/api/torneio/meu') - m0);
  // sem torneio do dia e sem inscrição: rara
  var guardaLista = listaServidor;
  listaServidor = [torneio(9, { inicioMs: srv() + 8 * 86400000 })];
  await To.busca(true);
  m0 = conta('/api/torneio/meu');
  await passa(60000);
  check('sem inscrição e sem torneio do dia a consulta é rara (nenhuma em 1 min)', conta('/api/torneio/meu') === m0, conta('/api/torneio/meu') - m0);
  listaServidor = guardaLista;
  await To.busca(true);
  tela = 'battle';
  m0 = conta('/api/torneio/meu');
  await passa(45000);
  check('fora da praça (numa batalha) sem chamada: nenhuma consulta', conta('/api/torneio/meu') === m0);
  tela = 'hub';

  // ============================================================ inscrever e sair
  console.log('\n== inscrever, sair e os motivos de recusa');
  respostas['/api/torneio/inscrever'] = function (op) {
    meuServidor.inscricoes = [{ torneio: op.body.torneio, herois: op.body.herois, classes: [{ classId: 'sumo', nivel: 22 }, { classId: 'arqueiro', nivel: 22 }], nivel: 22 }];
    listaServidor[3] = torneio(6, { vagas: 4, inscritos: [inscrito(22, 'Bia', 23), inscrito(11, 'Ana', 22)],
                                    premio: { barras: 2, vintens: 600, gemas: 0, conquista: false, moldura: false, xpGuilda: 0 } });
    return { ok: true, status: 200, torneio: listaServidor[3] };
  };
  var mudancas = 0;
  To.aoMudar = function () { mudancas++; };
  r = await To.inscrever(6, ['h2', 'h1', 'h1', 'h3']);
  var pi = ult('/api/torneio/inscrever');
  check('inscrever: o POST leva o torneio e a dupla em ordem, sem repetir e no máximo dois',
        r.ok && pi.metodo === 'POST' && pi.corpo.torneio === 6 && pi.corpo.herois.join() === 'h2,h1', JSON.stringify(pi && pi.corpo));
  check('a resposta troca o torneio na lista: 2 inscritos e as vagas dobraram para 4', To.torneio(6).inscritos.length === 2 && To.torneio(6).vagas === 4);
  check('o MEU é relido: a inscrição aparece com a dupla', !!To.inscricao(6) && To.inscricao(6).herois.join() === 'h2,h1' && To.inscricao(7) === null);
  check('a HUD é avisada da mudança', mudancas >= 1, mudancas);
  r = await To.inscrever(6, []);
  check('sem dupla nem pede: motivo "n"', !r.ok && r.motivo === 'n' && /um ou dois/.test(To.textoRecusa(r)));
  var RECUSAS = [
    [{ motivo: 'fechado' }, /já fecharam/],
    [{ motivo: 'cheio' }, /16 lugares/],
    [{ motivo: 'nivel', nivel: 27, nivelMin: 20, nivelMax: 25 }, /nível 27.*20 ao 25/],
    [{ motivo: 'outra-chave' }, /outra chave/],
    [{ motivo: 'mestre' }, /Mestre não entra/],
    [{ motivo: 'tipo' }, /de guilda/]
  ];
  for (var i = 0; i < RECUSAS.length; i++) {
    (function (caso) {
      respostas['/api/torneio/inscrever'] = function () {
        var x = clone(caso[0]); x.ok = false; x.status = 409; x.erro = 'a frase do servidor'; return x;
      };
    })(RECUSAS[i]);
    r = await To.inscrever(7, ['h1', 'h2']);
    var txt = To.textoRecusa(r);
    check('recusa "' + RECUSAS[i][0].motivo + '": o motivo chega e vira frase clara', !r.ok && r.motivo === RECUSAS[i][0].motivo && RECUSAS[i][1].test(txt), txt);
  }
  respostas['/api/torneio/inscrever'] = function () { return { ok: false, status: 409, motivo: 'coisa-nova', erro: 'A frase que só o servidor sabe.' }; };
  r = await To.inscrever(7, ['h1']);
  check('motivo que o cliente não conhece: vale a frase do servidor', To.textoRecusa(r) === 'A frase que só o servidor sabe.');
  respostas['/api/torneio/inscrever'] = function () { return { ok: false, status: 0 }; };
  r = await To.inscrever(7, ['h1']);
  check('o servidor fora: "não respondeu"', r.motivo === 'servidor' && /não respondeu/.test(To.textoRecusa(r)));
  respostas['/api/torneio/sair'] = function (op) {
    meuServidor.inscricoes = [];
    listaServidor[3] = torneio(6, { vagas: 4, inscritos: [inscrito(22, 'Bia', 23)] });
    return { ok: true, status: 200, torneio: listaServidor[3] };
  };
  r = await To.sair(6);
  check('sair: o POST leva o torneio, a inscrição some e a lista perde o nome',
        r.ok && ult('/api/torneio/sair').corpo.torneio === 6 && To.inscricao(6) === null && To.torneio(6).inscritos.length === 1);

  // ============================================================ a guilda
  console.log('\n== o torneio de guilda');
  var guildaSrv = { torneio: 8, voluntarios: [], representante: null, souVoluntario: false, possoEscolher: true };
  meuServidor.guilda = guildaSrv;
  respostas['/api/torneio/voluntariar'] = function (op) {
    guildaSrv.voluntarios = [{ conta: 11, nome: 'Ana', nivel: 22, classes: [{ classId: 'sumo', nivel: 22 }], desdeMs: srv() }];
    guildaSrv.souVoluntario = true;
    return { ok: true, status: 200 };
  };
  respostas['/api/torneio/desvoluntariar'] = function () { guildaSrv.voluntarios = []; guildaSrv.souVoluntario = false; guildaSrv.representante = null; return { ok: true, status: 200 }; };
  respostas['/api/torneio/representante'] = function (op) { guildaSrv.representante = op.body.conta; return { ok: true, status: 200 }; };
  r = await To.voluntariar(8, ['h1', 'h2']);
  check('voluntariar: o POST leva o torneio e a dupla; o MEU passa a me listar',
        r.ok && ult('/api/torneio/voluntariar').corpo.herois.join() === 'h1,h2' && To.meu().guilda.souVoluntario && To.meu().guilda.voluntarios.length === 1);
  r = await To.representante(8, 11);
  check('representante: o POST leva a conta escolhida', r.ok && ult('/api/torneio/representante').corpo.conta === 11 && To.meu().guilda.representante === 11);
  r = await To.representante(8, null);
  check('representante com null desfaz a escolha (o null viaja)', r.ok && ult('/api/torneio/representante').corpo.conta === null && To.meu().guilda.representante === null);
  r = await To.desvoluntariar(8);
  check('desvoluntariar tira da lista', r.ok && !To.meu().guilda.souVoluntario && To.meu().guilda.voluntarios.length === 0);
  // o servidor de verdade responde o corpo do MEU nestas três rotas (docs/TORNEIO.md §4.3): adota-se sem outra ida
  respostas['/api/torneio/voluntariar'] = function (op) {
    guildaSrv.voluntarios = [{ conta: 11, nome: 'Ana', nivel: 22, classes: [{ classId: 'sumo', nivel: 22 }], desdeMs: srv() }];
    guildaSrv.souVoluntario = true;
    var x = clone(meuServidor); x.ok = true; x.status = 200; x.agoraMs = srv(); x.torneio = listaServidor[1];
    return x;
  };
  m0 = conta('/api/torneio/meu');
  r = await To.voluntariar(8, ['h1', 'h2']);
  check('a resposta com o corpo do MEU é adotada direto (sem um GET /api/torneio/meu a mais)',
        r.ok && To.meu().guilda.souVoluntario && conta('/api/torneio/meu') === m0 && r.torneio && r.torneio.id === 8, conta('/api/torneio/meu') - m0);
  var MAIS = [[{ motivo: 'dois' }, /os dois/], [{ motivo: 'sem-guilda' }, /numa guilda/], [{ motivo: 'cargo' }, /líder ou um oficial/],
              [{ motivo: 'sem-voluntario' }, /voluntários/], [{ motivo: 'equipe' }, /guilda da equipe/], [{ motivo: 'sem-inscricao' }, /não está inscrito/]];
  check('os motivos a mais do servidor (dois, sem-guilda, cargo, sem-voluntario, equipe, sem-inscricao) têm cada um a sua frase',
        MAIS.every(function (c) { return c[1].test(To.textoRecusa(c[0])); }), MAIS.map(function (c) { return To.textoRecusa(c[0]); }).join(' | '));
  meuServidor.guilda = null;

  // ============================================================ a chamada e a entrega
  console.log('\n== a chamada, o "estou aqui" e a entrega à Arena');
  meuServidor.inscricoes = [{ torneio: 6, herois: ['h1', 'h2'], classes: [{ classId: 'sumo', nivel: 22 }], nivel: 22 }];
  await To.consulta();
  var chamadas = [], prontas = [];
  To.aoChamada = function (l) { chamadas.push(l); };
  To.aoPronta = function (l) { prontas.push(l); };
  meuServidor.luta = { torneio: 6, rodada: 0, pos: 1, lado: 'A', adversario: { conta: 22, nome: 'Bia', nivel: 23, classes: [{ classId: 'arqueiro', nivel: 23 }] },
                       prazoMs: srv() + 180000, presente: false, elePresente: false };
  await passa(21000);
  check('a chamada aparece na consulta de 20 s e a HUD é avisada uma vez', chamadas.length === 1 && chamadas[0].adversario.nome === 'Bia', chamadas.length);
  check('a luta do MEU: o lado, o adversário e o prazo no relógio do servidor',
        To.luta().lado === 'A' && To.luta().adversario.conta === 22 && Math.abs((To.luta().prazoMs - To.agora()) - 180000) < 22000);
  m0 = conta('/api/torneio/meu');
  await passa(9000);
  check('com chamada a consulta vira de 3 em 3 s', conta('/api/torneio/meu') - m0 === 3, conta('/api/torneio/meu') - m0);
  respostas['/api/torneio/presente'] = function (op) {
    meuServidor.luta.presente = true;
    var x = clone(meuServidor); x.ok = true; x.status = 200; x.agoraMs = srv(); return x;
  };
  r = await To.presente(6);
  check('"estou aqui": o POST leva o torneio e a resposta (o MEU inteiro) já marca a presença',
        r.ok && ult('/api/torneio/presente').corpo.torneio === 6 && To.luta().presente === true && To.luta().elePresente === false);
  check('sem did ninguém mexe na Arena', conta('/api/arena/estado') === 0 && Ar.estado().fase === 'livre');
  // o outro lado confirma: a partida nasce PRONTA na Arena, com o did do torneio
  var prontaArena = function (did) {
    return { ok: true, status: 200, agoraMs: srv(), fase: 'pronta', did: did, lado: 'A', papel: 'inscrito', torneio: 6,
             herois: ['h1', 'h2'], classes: [{ classId: 'sumo', nivel: 22 }], nivel: 22,
             adversario: { conta: 22, nome: 'Bia', nivel: 23, herois: ['x1'], classes: [{ classId: 'arqueiro', nivel: 23 }] } };
  };
  respostas['/api/arena/estado'] = function () { return prontaArena('tor-6-0-1'); };
  meuServidor.luta.elePresente = true;
  meuServidor.luta.did = 'tor-6-0-1';
  tela = 'battle';                                    // ainda numa sala: a entrega espera
  await passa(22000);
  check('fora da praça a luta pronta NÃO é entregue: a Arena não é consultada e a tela sabe o porquê',
        conta('/api/arena/estado') === 0 && To.luta().did === 'tor-6-0-1' && To.luta().bloqueio === 'fora-da-praca' && !To.luta().entregue,
        JSON.stringify(To.luta()));
  check('a HUD soube que a partida ficou pronta (uma vez)', prontas.length === 1 && prontas[0].did === 'tor-6-0-1', prontas.length);
  tela = 'hub';
  var a0 = conta('/api/arena/estado');
  await passa(4000);
  var de = Du.estado();
  check('de volta à praça: a Arena é consultada e o Duelo abre no modo "arena" com o did do torneio',
        conta('/api/arena/estado') >= a0 + 1 && de.modo === 'arena' && de.did === 'tor-6-0-1' && de.fase === 'desafiei', JSON.stringify(de));
  check('o Duelo sabe que é do torneio (a vida cheia sai daí)', Du._st().arena.torneio === 6);
  check('o lado A manda a chamada do duelo pela Rede ao adversário (a Bia, pela conta 22)',
        saidas.some(function (s) { return s.tipo === 'duelo' && s.acao === 'arena' && s.para === 'bia' && s.dados.did === 'tor-6-0-1'; }));
  check('a luta consta como entregue (e a tela do fim do duelo pode perguntar)',
        To.luta().entregue === true && To.ehDoTorneio('tor-6-0-1') && To.lutaEntregue('tor-6-0-1').torneio === 6 && To.lutaEntregue('outro') === null);
  // a vida: com o duelo do torneio aberto, o herói a 0 PV entra
  Du._st().fase = 'escolhendo';
  Du._st().op = { id: 'bia', cx: 'cx-bia', nome: 'Bia' };
  zerados = { heroId: 'h1', esperaS: 90 };
  var re = Du.escolher(['h1', 'h2']);
  check('no torneio o herói a 0 PV entra na luta (a vida começa cheia)', re.ok === true, JSON.stringify(re));
  var dupla = JSON.parse(Du._st().minha.str);
  check('… e a dupla comprometida vai sem `vida` (sem ele = cheio)', dupla.length === 2 && dupla.every(function (p) { return p.vida === undefined; }));
  // o duelo acaba e a Arena volta a livre; o MEU ainda traz o mesmo did por uns segundos
  Du._reset();
  a0 = conta('/api/arena/estado');
  await passa(12000);
  check('o mesmo did NÃO é entregue duas vezes (o Duelo segue livre)', Du.estado().fase === 'livre' && conta('/api/arena/estado') === a0, conta('/api/arena/estado') - a0);
  // fora do torneio a vida única segue valendo
  Du.iniciaArena({ did: 'arena-comum-1', lado: 'A', conta: 22, nome: 'Bia', herois: ['h1', 'h2'], heroisDele: ['x1'] });
  Du._st().fase = 'escolhendo';
  Du._st().op = { id: 'bia', cx: 'cx-bia', nome: 'Bia' };
  re = Du.escolher(['h1', 'h2']);
  check('no duelo comum da Arena o herói a 0 PV continua recusado ("vida-zero")', re.ok === false && re.motivo === 'vida-zero', JSON.stringify(re));
  Du._reset(); Ar._reset();
  zerados = null;
  // a REVANCHE: o servidor abre outro did para a mesma luta
  respostas['/api/arena/estado'] = function () { return prontaArena('tor-6-0-1-r'); };
  meuServidor.luta.did = 'tor-6-0-1-r';
  await passa(8000);
  meuServidor.luta.revanche = true;
  await passa(8000);
  check('a revanche (outro did) é entregue de novo', Du.estado().did === 'tor-6-0-1-r' && Du.estado().modo === 'arena' && prontas.length === 2, Du.estado().did);
  check('… e a luta diz que é revanche', To.luta().revanche === true);
  check('… e a chamada não é anunciada outra vez (é a mesma luta da chave)', chamadas.length === 1, chamadas.length);
  Du._reset(); Ar._reset();
  // passou de rodada: outra luta, outra chamada
  meuServidor.luta = { torneio: 6, rodada: 1, pos: 0, lado: 'B', adversario: { conta: 33, nome: 'Caio', nivel: 24, classes: [] },
                       prazoMs: srv() + 180000, presente: false, elePresente: true };
  await passa(4000);
  check('a rodada seguinte é outra chamada', chamadas.length === 2 && chamadas[1].adversario.nome === 'Caio' && To.luta().lado === 'B' && To.luta().elePresente);
  meuServidor.luta = null;
  await passa(4000);
  check('a luta some do MEU: sem chamada, sem bloqueio', To.luta() === null);

  // ============================================================ o fim: o campeão
  console.log('\n== o fim do torneio');
  var fins = [];
  To.aoCampeao = function (t, quem) { fins.push({ id: t.id, eu: quem.eu, participei: quem.participei }); };
  check('o encerrado que já estava na lista quando o jogo abriu (e eu não joguei) não vira aviso', fins.length === 0);
  listaServidor[3] = torneio(6, { estado: 'andamento', vagas: 4, inscritos: [inscrito(22, 'Bia', 23), inscrito(11, 'Ana', 22)] });
  await To.busca(true);
  listaServidor[3] = torneio(6, { estado: 'encerrado', vagas: 4, inscritos: [inscrito(22, 'Bia', 23), inscrito(11, 'Ana', 22)], campeao: P(11, 'Ana'),
                                  premio: { barras: 5, vintens: 1250, gemas: 0, conquista: true, moldura: false, xpGuilda: 0 } });
  meuServidor.conquistas = { pvp: 1, guilda: 0 };
  meuServidor.vigente = true;
  await To.busca(true);
  check('o torneio encerra comigo campeã: a tela do campeão é chamada uma vez', fins.length === 1 && fins[0].id === 6 && fins[0].eu === true, JSON.stringify(fins));
  await To.busca(true);
  check('… e não de novo na leitura seguinte', fins.length === 1);
  await To.consulta();
  check('as conquistas e o vigente chegam ao que a plaquinha lê', To.arenaDoPerfil().n === 1 && To.arenaDoPerfil().vigente === true && To.arenaDoPerfil().moldura === false);
  // a página recarrega: o "já vi" mora no armário, o aviso não volta
  To._reset();
  To.aoCampeao = function (t, quem) { fins.push({ id: t.id, eu: quem.eu, participei: quem.participei }); };
  await To.busca(true);
  check('depois de recarregar a página o campeão não é avisado de novo (o "já vi" é do armário da conta)', fins.length === 1, JSON.stringify(fins));
  // quem não viu e participou: é avisado ao abrir o jogo
  guardado = {};
  To._reset();
  To.aoCampeao = function (t, quem) { fins.push({ id: t.id, eu: quem.eu, participei: quem.participei }); };
  listaServidor[3].campeao = P(22, 'Bia');
  await To.busca(true);
  check('quem participou e não estava com o jogo aberto no fim é avisado ao abrir (e não é o campeão)',
        fins.length === 2 && fins[1].id === 6 && fins[1].eu === false && fins[1].participei === true, JSON.stringify(fins));

  // ============================================================ a chave e os nomes
  console.log('\n== a chave');
  var chave = { tamanho: 4, rodada: 1, rodadas: [
    [{ pos: 0, a: P(11, 'Ana'), b: P(22, 'Bia'), estado: 'decidida', vencedor: 'a', como: 'luta', previstoMs: 1 },
     { pos: 1, a: P(33, 'Caio'), b: null, estado: 'decidida', vencedor: 'a', como: 'bye', previstoMs: 1 }],
    [{ pos: 0, a: P(11, 'Ana'), b: P(33, 'Caio'), estado: 'chamada', vencedor: null, como: null, previstoMs: 2 }]] };
  listaServidor = [torneio(10, { estado: 'andamento', vagas: 4, chave: chave, inscritos: [inscrito(11, 'Ana', 22), inscrito(22, 'Bia', 23), inscrito(33, 'Caio', 24)] })];
  await To.busca(true);
  var t10 = To.torneio(10);
  check('a chave chega inteira: rodadas, passe marcado, a rodada em curso', t10.chave.rodadas.length === 2 && t10.chave.rodadas[0][1].como === 'bye' && t10.chave.rodada === 1);
  var lin = To.linhaDe(t10, 11);
  check('a minha linha é a da rodada mais avançada em que estou', lin && lin.rodada === 1 && lin.pos === 0 && lin.lado === 'a', JSON.stringify(lin));
  check('quem caiu fica na linha em que caiu', To.linhaDe(t10, 22).rodada === 0 && To.linhaDe(t10, 99) === null);
  check('os nomes das rodadas: chave de 16 → Oitavas, Quartas, Semifinal, Final',
        [0, 1, 2, 3].map(function (i) { return To.nomeDaRodada(16, i); }).join() === 'Oitavas,Quartas,Semifinal,Final' && To.nomeDaRodada(2, 0) === 'Final');

  // ============================================================ servidor de antes do torneio
  console.log('\n== o servidor de antes do torneio');
  To._reset();
  respostas['/api/torneios'] = function () { return { ok: false, status: 404, erro: 'não achei' }; };
  r = await To.busca(true);
  check('404 na lista: nada quebra, a aba diz que o torneio ainda não chegou', !r.ok && To.estado().semRota && /ainda não chegou/.test(To.estado().erro) && To.torneios().length === 0);
  m0 = conta('/api/torneio/meu');
  await passa(30000);
  check('… e o MEU nem é pedido', conta('/api/torneio/meu') === m0);
  J.Sessao.ativa = function () { return false; };
  check('sem a conta do site: desligado, com o porquê', !To.disponivel().ok && /conta do site/.test(To.estado().desligado));
  r = await To.inscrever(6, ['h1']);
  check('… e inscrever responde o motivo sem pedir nada', !r.ok && r.motivo === 'sem-sessao');

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch(function (e) { console.log('ERRO: ' + (e && e.stack || e)); process.exit(1); });
