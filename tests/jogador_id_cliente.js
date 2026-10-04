#!/usr/bin/env node
'use strict';
/* PROVA DO CÓDIGO DE JOGADOR ÚNICO, lado do jogo (04/10) — js/core/db.js, sessao.js e nuvem.js
 * de verdade num mundo de mentira do Node, com um servidor de mentira que guarda de quem é
 * cada código (o que o servidor/api.py faz na tabela jogador_ids).
 *
 *   node tests/jogador_id_cliente.js
 *
 * O DEFEITO: o dono entrou com a conta do Mestre no celular e com outra conta no PC e uma não
 * via a outra na praça. As duas tinham o MESMO jogador.id (a segunda nasceu com uma cópia do
 * save da primeira) e a Rede joga fora o que chega com o próprio id. Cobra:
 *   A. a conta que abre o jogo com o código de OUTRA troca de código sem perder o save (itens,
 *      séries, moedas, heróis), perde o nome copiado, recarrega, e na abertura seguinte o save
 *      sobe com o código novo e o servidor não manda trocar de novo;
 *   B. a dona do código não troca nada;
 *   C. a CAUSA: a conta trocou neste navegador e o servidor não tem save da nova — o save da
 *      anterior sai do disco e NÃO volta por uma gravação feita antes da recarga;
 *   D. o save que o servidor guarda já traz o código de outra (GET com trocarId): entra aqui
 *      com código novo e fica marcado para subir;
 *   E. o PUT que avisa trocarId (a pergunta do boot não chegou): troca e sobe de novo;
 *   F. o NOME DO MESTRE (04/10, "mude o nome do Super Admin para GM"): com a sessão da conta
 *      marcada, o DB.jogador() responde "GM" (é o que a plaquinha, a ficha e o chat usam) sem
 *      tocar no nome do save; a conta comum segue com o nome dela. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const raiz = path.join(__dirname, '..');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const MESTRE = { token: 'a'.repeat(64), conta: { id: 7, nome: 'Oda', gm: false } };
const OUTRA = { token: 'b'.repeat(64), conta: { id: 9, nome: 'Oda2', gm: false } };
const ID_VELHO = 'jvelho123abc';

function saveCopiado() {
  return {
    versao: 1,
    jogador: { id: ID_VELHO, nome: 'Oda', titulo: 'Primeiro do Fundo', avatar: null, dupla: ['guerreiro#1'],
               brasa: { pts: 1234, partidas: 9, temporada: null, galeria: {} }, poco: { recorde: 4, semanaId: null, semanaMelhor: 0 },
               criadoEm: 111 },
    carteira: { moedas: 777 },
    banco: { moedas: 50, itens: [{ itemId: 'espada', iid: 'i-abc-1', level: 3 }] },
    missoes: null, conquistas: { c1: { prog: 2, pago: false } }, mercado: null, placar: {}, chefes: {},
    mutados: [{ id: 'jchato', nome: 'Chato' }], loja: { aplicadas: [], recusadas: [] }, pvp: [], trocas: []
  };
}

/* o servidor de mentira: saves por conta e o registro código → conta */
function servidor() {
  const sv = { saves: {}, donos: {}, puts: [], perguntas: [] };
  sv.confere = (cid, jid) => {
    if (!jid) return null;
    if (!(jid in sv.donos)) { sv.donos[jid] = cid; return null; }
    return sv.donos[jid] === cid ? null : jid;
  };
  sv.responde = (sessao) => (rota, tk, p) => {
    const cid = sessao.conta.id;
    if (rota === '/api/eu') return { status: 200, corpo: { ok: true, conta: sessao.conta } };
    if (rota === '/api/jogador-id') {
      const id = JSON.parse(p.body).id;
      sv.perguntas.push({ cid, id });
      return { status: 200, corpo: { ok: true, trocar: !!sv.confere(cid, id) } };
    }
    if (rota === '/api/save' && p.method === 'GET') {
      const s = sv.saves[cid];
      if (!s) return { status: 200, corpo: { ok: true, versao: 0, progress: null, db: null } };
      const corpo = { ok: true, versao: s.versao, progress: s.progress, db: s.db };
      const jid = s.db && s.db.jogador && s.db.jogador.id;
      if (jid && sv.donos[jid] !== undefined && sv.donos[jid] !== cid) corpo.trocarId = jid;
      return { status: 200, corpo };
    }
    if (rota === '/api/save') {
      const c = JSON.parse(p.body);
      const v = ((sv.saves[cid] || {}).versao || 0) + 1;
      sv.saves[cid] = { versao: v, progress: c.progress, db: c.db };
      sv.puts.push({ cid, db: c.db });
      const corpo = { ok: true, versao: v };
      const troca = sv.semPergunta ? sv.confere(cid, c.db && c.db.jogador && c.db.jogador.id) : null;
      if (troca) corpo.trocarId = troca;
      else if (!sv.semPergunta) sv.confere(cid, c.db && c.db.jogador && c.db.jogador.id);
      return { status: 200, corpo };
    }
    return { status: 200, corpo: { ok: true } };
  };
  return sv;
}

/* uma aba: o disco (`local`) é de quem chama — a "recarga" é abrir outra aba no mesmo disco */
function aba(local, sessao, sv, op) {
  op = op || {};
  local.set('soterra-sessao', JSON.stringify(sessao));
  const adiados = [];
  const g = {
    console, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error,
    recargas: 0,
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: 'https:', hostname: 'soterra.test', host: 'soterra.test', search: '', hash: '', href: 'https://soterra.test/index.html', reload() { g.recargas++; } },
    document: { hidden: false, readyState: 'complete', addEventListener() {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: (f, ms) => { if (ms >= 3000) { adiados.push(f); return -adiados.length; } return setTimeout(f, ms); },
    clearTimeout: (id) => { if (!(typeof id === 'number' && id < 0)) clearTimeout(id); },
    setInterval: () => 1, clearInterval() {},
    fetch: (url, pedido) => {
      const tk = ((pedido.headers || {}).Authorization || '').replace(/^Bearer /, '') || null;
      const rota = url.replace(/^https?:\/\/[^/]+/, '');
      if (op.semRota && rota === op.semRota) return Promise.resolve({ status: 404, json: () => Promise.resolve({ ok: false, erro: 'não achei' }) });
      const r = sv.responde(sessao)(rota, tk, pedido);
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(JSON.parse(JSON.stringify(r.corpo))) });
    }
  };
  g.window = g;
  g.self = g;
  vm.createContext(g);
  g.JOGO = {};
  g.JOGO.Contas = { sufixo: () => '', ativa: () => 'principal', chaveSave: () => 'soterra-save-v2', chaveConta: () => 'soterra-conta-v1' };
  // o Progress de mentira grava o estado na chave de verdade: é o que a prova C vigia
  const P = { state: null, nascimentos: () => [], podaNascimentos() {}, limpaNascimentos() {},
              load() { try { P.state = JSON.parse(local.get('soterra-save-v2') || 'null') || { heroes: {} }; } catch (e) { P.state = { heroes: {} }; } },
              save() { local.set('soterra-save-v2', JSON.stringify(P.state)); } };
  P.load();
  g.JOGO.Progress = P;
  for (const arq of ['js/core/db.js', 'js/core/sessao.js', 'js/core/gm.js', 'js/core/nuvem.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, arq), 'utf8'), g, { filename: arq });
  }
  g.JOGO.Nuvem.ESPERA_MS = 5;
  if (op.semRecarga) g.JOGO.Nuvem.semRecarga = true;
  return { g, J: g.JOGO, local };
}
const noDisco = (local) => JSON.parse(local.get('soterra-conta-v1') || 'null');
const registro = (local) => JSON.parse(local.get('soterra-nuvem-v1') || 'null');

async function cenaA() {
  const sv = servidor();
  sv.donos[ID_VELHO] = 7;                                   // o código é da conta do Mestre
  const local = new Map();
  local.set('soterra-conta-v1', JSON.stringify(saveCopiado()));
  local.set('soterra-save-v2', JSON.stringify({ heroes: { 'guerreiro#1': { xp: 900, level: 7 } } }));
  let a = aba(local, OUTRA, sv);
  await a.J.Nuvem.iniciar();
  await espera(30);
  const d = noDisco(local);
  check('A: o servidor mandou trocar e a página recarregou uma vez', a.g.recargas === 1, 'recargas ' + a.g.recargas);
  check('A: o código de jogador no disco é novo', d && d.jogador.id && d.jogador.id !== ID_VELHO, d && d.jogador.id);
  check('A: o nome copiado saiu (o Acampamento pede o batismo de novo)', d && d.jogador.nome === null);
  check('A: moedas, banco, séries, conquistas, título e arena ficaram', d && d.carteira.moedas === 777 && d.banco.moedas === 50 &&
        d.banco.itens.length === 1 && d.banco.itens[0].iid === 'i-abc-1' && d.conquistas.c1.prog === 2 &&
        d.jogador.titulo === 'Primeiro do Fundo' && d.jogador.brasa.pts === 1234 && d.mutados.length === 1, JSON.stringify(d));
  check('A: os heróis ficaram', JSON.parse(local.get('soterra-save-v2')).heroes['guerreiro#1'].level === 7);
  check('A: nada subiu com o código velho', sv.puts.every((p) => p.db.jogador.id !== ID_VELHO), JSON.stringify(sv.puts.map((p) => p.db.jogador.id)));
  // a recarga: outra aba, o mesmo disco
  const novo = d.jogador.id;
  a = aba(local, OUTRA, sv);
  await a.J.Nuvem.iniciar();
  await espera(30);
  check('A: na abertura seguinte não recarrega de novo', a.g.recargas === 0);
  check('A: o save subiu com o código novo e o conteúdo inteiro', sv.puts.length >= 1 && sv.saves[9] &&
        sv.saves[9].db.jogador.id === novo && sv.saves[9].db.carteira.moedas === 777 && sv.saves[9].db.banco.itens[0].iid === 'i-abc-1', JSON.stringify(sv.puts));
  check('A: o código novo ficou registrado para a conta nova e o velho segue do Mestre', sv.donos[novo] === 9 && sv.donos[ID_VELHO] === 7);
  const j = await a.J.DB.jogador();
  check('A: o jogo lê o código novo (é o que a praça vai usar)', j.id === novo && j.nome === null);
}

async function cenaB() {
  const sv = servidor();
  sv.donos[ID_VELHO] = 7;
  const local = new Map();
  local.set('soterra-conta-v1', JSON.stringify(saveCopiado()));
  const a = aba(local, MESTRE, sv);
  await a.J.Nuvem.iniciar();
  await espera(30);
  const d = noDisco(local);
  check('B: a dona do código não troca nada (código e nome ficam)', d.jogador.id === ID_VELHO && d.jogador.nome === 'Oda' && a.g.recargas === 0);
  check('B: e o save dela sobe como está', sv.puts.length === 1 && sv.puts[0].db.jogador.id === ID_VELHO);
}

async function cenaC() {
  const sv = servidor();
  sv.donos[ID_VELHO] = 7;
  const local = new Map();
  local.set('soterra-conta-v1', JSON.stringify(saveCopiado()));
  local.set('soterra-save-v2', JSON.stringify({ heroes: { 'guerreiro#1': { xp: 900, level: 7 } } }));
  local.set('soterra-nuvem-v1', JSON.stringify({ versao: 5, conta: 7, sujo: false }));   // este navegador era da conta 7
  let a = aba(local, OUTRA, sv);
  await a.J.DB.jogador();                                    // o jogo já leu o save antigo para a memória
  await a.J.Nuvem.iniciar();
  await espera(30);
  check('C: a conta trocou e o servidor não tem save da nova: o disco foi limpo e a página recarrega',
        a.g.recargas === 1 && !local.has('soterra-conta-v1') && !local.has('soterra-save-v2'));
  // antes de a recarga acontecer o jogo ainda roda: um relógio da HUD grava
  await a.J.DB.batizar('Fulano');
  a.J.Progress.save();
  check('C: a gravação feita antes da recarga NÃO devolve o save da conta anterior ao disco',
        !local.has('soterra-conta-v1') && !local.has('soterra-save-v2'), String(local.get('soterra-conta-v1')).slice(0, 80));
  a = aba(local, OUTRA, sv);
  await a.J.Nuvem.iniciar();
  await espera(30);
  const d = noDisco(local);
  check('C: a conta nova nasce com código próprio, sem nome e sem as moedas da outra',
        d && d.jogador.id !== ID_VELHO && d.jogador.nome === null && d.carteira.moedas === 0, JSON.stringify(d && d.jogador));
  check('C: o que sobe para a conta nova não leva o código da antiga', sv.puts.length >= 1 &&
        sv.puts.every((p) => p.db.jogador.id !== ID_VELHO), JSON.stringify(sv.puts.map((p) => p.db.jogador)));
}

async function cenaD() {
  const sv = servidor();
  sv.donos[ID_VELHO] = 7;
  sv.saves[9] = { versao: 4, progress: { heroes: { 'mago#1': { xp: 5, level: 2 } } }, db: saveCopiado() };   // a cópia já no servidor
  const local = new Map();
  let a = aba(local, OUTRA, sv);
  await a.J.Nuvem.iniciar();
  await espera(30);
  const d = noDisco(local);
  check('D: o save do servidor entra aqui já com código novo e sem o nome copiado',
        a.g.recargas === 1 && d && d.jogador.id !== ID_VELHO && d.jogador.nome === null && d.carteira.moedas === 777, JSON.stringify(d && d.jogador));
  check('D: e fica marcado para subir', registro(local).sujo === true && registro(local).versao === 4);
  a = aba(local, OUTRA, sv);
  await a.J.Nuvem.iniciar();
  await espera(30);
  check('D: na abertura seguinte o save sobe com o código novo e ninguém manda trocar de novo',
        a.g.recargas === 0 && sv.puts.length === 1 && sv.puts[0].db.jogador.id === d.jogador.id && sv.donos[d.jogador.id] === 9,
        JSON.stringify({ rec: a.g.recargas, puts: sv.puts.length }));
}

async function cenaE() {
  const sv = servidor();
  sv.donos[ID_VELHO] = 7;
  sv.semPergunta = true;                                     // só o PUT confere
  const local = new Map();
  local.set('soterra-conta-v1', JSON.stringify(saveCopiado()));
  const a = aba(local, OUTRA, sv, { semRota: '/api/jogador-id', semRecarga: true });
  await a.J.Nuvem.iniciar();
  await espera(80);
  const d = noDisco(local);
  check('E: sem a pergunta do boot, o PUT avisa e o jogo troca de código', d.jogador.id !== ID_VELHO && d.carteira.moedas === 777);
  check('E: e sobe de novo com o código novo', sv.puts.length >= 2 && sv.puts[sv.puts.length - 1].db.jogador.id === d.jogador.id,
        JSON.stringify(sv.puts.map((p) => p.db.jogador.id)));
}

async function cenaF() {
  const sv = servidor();
  let local = new Map();
  local.set('soterra-conta-v1', JSON.stringify(saveCopiado()));
  let a = aba(local, { token: 'd'.repeat(64), conta: { id: 7, nome: 'Oda', gm: true } }, sv);
  let j = await a.J.DB.jogador();
  check('F: na conta do Mestre (sessão com a marca do servidor) o jogo responde o nome "GM"', j.nome === 'GM' && j.id === ID_VELHO, j.nome);
  check('F: o nome do save não é tocado (se a marca sair, ele volta)', a.J.DB.exportar().jogador.nome === 'Oda' && noDisco(local).jogador.nome === 'Oda');
  local = new Map();
  local.set('soterra-conta-v1', JSON.stringify(saveCopiado()));
  a = aba(local, MESTRE, sv);                                // a mesma conta SEM a marca
  j = await a.J.DB.jogador();
  check('F: a conta comum segue com o nome dela', j.nome === 'Oda', j.nome);
}

(async function () {
  await cenaF();
  await cenaA();
  await cenaB();
  await cenaC();
  await cenaD();
  await cenaE();
  console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
