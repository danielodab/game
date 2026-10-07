'use strict';
/* O MOTOR DO JUIZ — o jogo de verdade, sem navegador (dono: servidor).
 *
 * O QUE ISTO É (12/09, a segurança: "evite hackers de duplicação de itens ou
 * aumento de rate e dano"). O servidor não pode confiar no que o navegador diz
 * que aconteceu. Em vez de reescrever as regras em Python (e ter duas cópias
 * que divergem), o juiz carrega OS MESMOS arquivos JS do jogo num contexto
 * isolado do Node e roda a regra ali: a sala refeita a partir da semente e dos
 * lances, o saque sorteado com o gerador do servidor, a forja, a roleta.
 *
 * Cada `mundo()` é um contexto novo (vm): o motor guarda estado de módulo
 * (Engine.state, Engine._genSpells, Engine.events), e uma conta não pode vazar
 * na outra. Criar um mundo custa alguns milissegundos; o juiz reaproveita um
 * por pedido e joga fora.
 *
 * Sem dependência nenhuma de npm: só `vm`, `fs` e `path` do próprio Node. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* A raiz do jogo: no contêiner o Dockerfile copia o repositório em
 * /srv/soterra; em casa é a pasta acima de servidor/. SOTERRA_RAIZ manda. */
const RAIZ = process.env.SOTERRA_RAIZ || path.resolve(__dirname, '..', '..');

/* A ordem é a do index.html: dados, depois motor, fusão e IA. */
const DADOS = [
  'js/core/data/elements.js', 'js/core/data/classes.js', 'js/core/data/spells.js',
  'js/core/data/progression.js', 'js/core/data/monsters.js', 'js/core/data/dungeons.js', 'js/core/data/arenas.js',
  'js/core/data/fusions.js', 'js/core/data/pets.js', 'js/core/data/items.js',
  'js/core/data/items_extra.js', 'js/core/data/items_selos.js',
  // 13/09: as poções de vida — o motor cura com o número daqui e a banca cobra o preço daqui
  'js/core/data/consumiveis.js',
  // 02/10: o Eco Primordial (o elenco, os feitiços e as fases): o juiz refaz a tentativa com eles
  'js/core/data/eco.js',
  // 03/10: o Santuário dos Elementos (o calabouço especial: as cinco salas e os números das quatro regras)
  'js/core/data/santuario.js'
];
// o poco.js entra com o combate: o andar do Poço é montado da semente antes da batalha
// 03/10: o santuario.js também — é a regra dos quadrantes (escuro, água, pilares, vento) que o motor chama;
// sem ele o juiz refaria a sala do Santuário sem regra nenhuma e acusaria o jogador honesto
// 07/10: e o afixos.js — a regra do Calabouço do Dia que o bilhete guarda (o motor recusa nascer uma sala com
// afixo sem ele: refazê-la sem a regra acusaria o jogador honesto de 'divergiu')
// 07/10: e o elites.js — o elite da sala sai do rng da sala; sem ele o juiz refaria a sala sem o elite e acusaria
// o jogador honesto de 'divergiu'
const COMBATE = ['js/core/engine.js', 'js/core/fusion.js', 'js/core/ai.js', 'js/core/poco.js', 'js/core/santuario.js',
                 'js/core/afixos.js', 'js/core/elites.js'];

const cache = new Map();
/* O texto de cada arquivo é lido UMA vez por processo e compilado uma vez: o
 * `vm.Script` roda em quantos contextos precisar. Arquivo que falta não é
 * erro calado — o juiz não pode julgar com metade das regras. */
function script(rel) {
  let s = cache.get(rel);
  if (s) return s;
  const arq = path.join(RAIZ, rel);
  const buf = fs.readFileSync(arq);
  // os arquivos são UTF-8 (o progress.js tem um NUL DENTRO de uma string — o
  // marcador '\0nada' do saque — e ele tem de chegar intacto). O latin1 fica só
  // de rede para um arquivo que um dia venha em outra codificação
  const txt = buf.toString(ehUtf8(buf) ? 'utf8' : 'latin1');
  s = new vm.Script(txt, { filename: rel });
  cache.set(rel, s);
  return s;
}
function ehUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch (e) { return false; }
}

/* Um armazém de mentira no lugar do localStorage: o juiz nunca grava em disco
 * pelo jogo — o estado entra e sai por parâmetro. */
function armazem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
}

/* Um mundo: um contexto com `globalThis.JOGO` e os arquivos pedidos já
 * carregados. `extra` são arquivos a mais (progress.js, db.js…), na ordem.
 * `prepara(ctx)` roda com o contexto criado e ANTES de qualquer arquivo: é
 * onde entram os dublês (window, crypto, o sorteio semeado, JOGO.GM…). */
function mundo(extra, prepara) {
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: armazem(),
    Math, Date, JSON, Promise, Object, Array, Number, String, Boolean, Symbol, Map, Set,
    WeakMap, Error, TypeError, RangeError, parseInt, parseFloat, isFinite, isNaN,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  if (typeof prepara === 'function') prepara(ctx);
  const lista = DADOS.concat(COMBATE, extra || []);
  for (const rel of lista) script(rel).runInContext(ctx);
  return ctx;
}

module.exports = { mundo, RAIZ, DADOS, COMBATE };
