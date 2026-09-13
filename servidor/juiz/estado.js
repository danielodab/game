'use strict';
/* O MUNDO ECONÔMICO DO JUIZ — o estado de UMA conta com as funções do jogo
 * (dono: servidor).
 *
 * Um mundo do motor (motor.js) com, a mais, a economia do jogo de verdade:
 * economia.js (o hash), progress.js, db.js, missoes.js, diario.js e game.js.
 * O estado da conta entra pelo armazém de mentira (as mesmas chaves do
 * navegador) e o Progress/DB o carregam pelo caminho normal — o saneamento do
 * jogo roda aqui também. Sai pelas mesmas funções de exportar.
 *
 * OS DUBLÊS (o que no navegador vem de outro módulo ou do relógio):
 *   window        o próprio contexto (o Progress e o DB só acham o armazém por window)
 *   crypto        o webcrypto do Node (o iid de cada cópia nova)
 *   Math.random   o gerador SEMEADO pelo servidor (saque, cartas, pedras, selos…)
 *   JOGO.GM       a marca de Mestre da conta, vinda do banco (não do cliente)
 *   JOGO.Agenda   os fatores dos eventos no ar, calculados pela API
 *   JOGO.Guilda   o bônus e o dízimo da guilda, lidos do banco; o XP doado é anotado
 *   JOGO.Diario   o de verdade, mas no dia de Brasília (o servidor não tem o fuso do jogador)
 * O motor não usa Math.random (a batalha tem o gerador dela); trocar o
 * Math.random do mundo só mexe no que é sorteio de recompensa e de economia. */
const nodeCrypto = require('crypto');
const { mundo } = require('./motor');

const ECONOMIA = ['js/core/economia.js', 'js/core/progress.js', 'js/core/db.js',
                  'js/core/missoes.js', 'js/core/diario.js', 'js/core/mercado.js', 'js/core/titulos.js',
                  'js/core/brasa.js',
                  'js/core/gm.js', 'js/core/loja.js', 'js/core/game.js'];
const CHAVE_SAVE = 'soterra-save-v2';
const CHAVE_CONTA = 'soterra-conta-v1';
const FUSO_BRASILIA_MIN = -180;
const TETOS_AGENDA = { xp: 10, vintem: 10, pedras: 10, saque: 10, aviso: 1 };
const GUILDA_BONUS_FATOR = 1.15;       // o JOGO.Guilda.BONUS_FATOR de js/core/guilda.js (a prova confere)

/* mulberry32: o mesmo gerador pequeno que o jogo já usa nas missões */
function gerador(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* uma semente de 32 bits a partir de um texto (FNV-1a) */
function sementeDe(txt) {
  let h = 0x811c9dc5;
  const s = String(txt);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/* opts = { gm, agoraMs, semente, fatores: {geral, porCalabouco}, guilda: {bonusXp, bonusDrop, dizimo} } */
function mundoEconomico(opts) {
  const o = opts || {};
  const agoraMs = (typeof o.agoraMs === 'number' && isFinite(o.agoraMs)) ? o.agoraMs : Date.now();
  const fatores = o.fatores || {};
  const guilda = o.guilda || {};
  const anotado = { guildaXp: 0 };
  const rng = gerador(typeof o.semente === 'number' ? o.semente : sementeDe(agoraMs));

  const ctx = mundo(ECONOMIA, (c) => {
    c.window = c;
    c.crypto = nodeCrypto.webcrypto;
    const m = Object.create(Math);
    m.random = rng;
    c.Math = m;
    // o que a loja e o Mestre tocam do navegador ao carregar: sem efeito aqui
    c.location = { search: '', protocol: 'https:', hostname: 'servidor', href: 'https://servidor/' };
    c.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', hidden: false };
    c.addEventListener = () => {};
    c.removeEventListener = () => {};
    c.dispatchEvent = () => true;
    c.CustomEvent = function (tipo, op) { this.type = tipo; this.detail = op && op.detail; };
    c.JOGO = {
      // a sessão do servidor: a marca de Mestre é a do banco, nunca a do cliente
      Sessao: {
        ativa: () => true,
        conta: () => ({ id: o.contaId || 0, gm: !!o.gm }),
        ehLocal: () => false,
        api: () => Promise.resolve({ ok: false, status: 0 })
      },
      GM: { ativo: () => !!o.gm, noAr: () => true, contaMestre: () => !!o.gm, mestreDoServidor: () => !!o.gm },
      Agenda: {
        TETOS: TETOS_AGENDA,
        TETO_XP_COMPRADO: 2.0,
        agora: () => agoraMs,
        medido: () => true,
        fator(tipo, dungeonId) {
          const g = fatores.geral || {};
          const p = (fatores.porCalabouco || {})[dungeonId] || {};
          const f = (typeof p[tipo] === 'number') ? p[tipo] : g[tipo];
          return (typeof f === 'number' && isFinite(f) && f > 1) ? Math.min(TETOS_AGENDA[tipo] || 1, f) : 1;
        },
        vencedor: () => null
      },
      Guilda: {
        BONUS_FATOR: GUILDA_BONUS_FATOR,
        bonusAtivo: (tipo) => (tipo === 'xp' ? !!guilda.bonusXp : tipo === 'drop' ? !!guilda.bonusDrop : false),
        dizimoAtual: () => (typeof guilda.dizimo === 'number' ? guilda.dizimo : 0),
        doarXp: (n) => { const v = Math.floor(Number(n)); if (v > 0) anotado.guildaXp += v; return true; }
      }
    };
  });
  const J = ctx.JOGO;
  // o gm.js de verdade substituiu o dublê: no servidor a marca vem do banco
  if (J.GM) J.GM._noAr = true;
  if (J.Loja) J.Loja._semTrava = true;
  // o Calabouço do Dia e as missões usam o dia de Brasília nos dois lados
  // (diario.js e missoes.js); aqui só se fixa o INSTANTE, que é o do servidor
  if (J.Diario && J.Diario.ehHoje) {
    const ehHoje = J.Diario.ehHoje;
    J.Diario.ehHoje = (dungeonId) => ehHoje(dungeonId, agoraMs);
  }
  if (J.Missoes) {
    const m = J.Missoes;
    const diaBr = (() => {
      const d = new Date(agoraMs + FUSO_BRASILIA_MIN * 60000);
      const mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
      return d.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
    })();
    for (const nome of ['carregar', 'registra', 'reivindicar']) {
      const orig = m[nome];
      if (typeof orig !== 'function') continue;
      if (nome === 'carregar') m[nome] = (dia) => orig(dia || diaBr);
      else m[nome] = (a, dia) => orig(a, dia || diaBr);
    }
  }
  return { ctx, J, anotado, agoraMs, rng };
}

/* põe o estado da conta no mundo, pelo caminho normal de carga do jogo */
function poeEstado(w, progress, db) {
  const J = w.J;
  if (progress && typeof progress === 'object') {
    w.ctx.localStorage.setItem(CHAVE_SAVE, JSON.stringify(progress));
  } else {
    w.ctx.localStorage.removeItem(CHAVE_SAVE);
  }
  J.Progress.load();
  if (db && typeof db === 'object') J.DB.importar(db);
  else if (J.DB.recarregar) J.DB.recarregar();
}

/* o estado como sai: cópias puras (JSON), sem a fila de nascimentos */
function tiraEstado(w) {
  const J = w.J;
  const progress = JSON.parse(JSON.stringify(J.Progress.state));
  const db = J.DB.exportar();
  progress.nascimentos = [];
  return { progress, db, hash: J.Economia.hash(progress, db) };
}

/* Todo iid do estado: saco, peças vestidas, cofre e ofertas do jogador no mercado. */
function iidsDe(progress, db) {
  const fora = new Map();
  const p = progress || {}, d = db || {};
  (p.inventory || []).forEach((e) => { if (e && e.iid) fora.set(e.iid, e.itemId); });
  Object.keys(p.heroes || {}).forEach((hid) => {
    const h = p.heroes[hid] || {};
    Object.keys(h.itemVar || {}).forEach((slot) => {
      const v = h.itemVar[slot];
      if (v && v.iid) fora.set(v.iid, h.items ? h.items[slot] : null);
    });
  });
  ((d.banco && d.banco.itens) || []).forEach((e) => { if (e && e.iid) fora.set(e.iid, e.itemId); });
  ((d.mercado && d.mercado.ofertas) || []).forEach((e) => {
    if (e && e.iid && e.vendedor === 'jogador') fora.set(e.iid, e.itemId);
  });
  return fora;
}

/* O que nasceu e o que saiu entre dois estados. A origem de cada nascimento
 * vem da fila do Progress (registraNascimento); sem ela, 'saque'. */
function diferencaIids(antes, depois, fila) {
  const origem = new Map();
  (fila || []).forEach((n) => { if (n && n.iid) origem.set(n.iid, n.origem || 'saque'); });
  const novos = [], fora = [];
  depois.forEach((itemId, iid) => {
    if (!antes.has(iid)) novos.push({ iid, itemId, origem: origem.get(iid) || 'saque' });
  });
  antes.forEach((_, iid) => { if (!depois.has(iid)) fora.push(iid); });
  return { novos, fora };
}

module.exports = { mundoEconomico, poeEstado, tiraEstado, iidsDe, diferencaIids, gerador, sementeDe,
                   GUILDA_BONUS_FATOR, CHAVE_SAVE, CHAVE_CONTA };
