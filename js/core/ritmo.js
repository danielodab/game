/* SOTERRA — JOGO.Ritmo: A VELOCIDADE DA BATALHA (09/10; o dono: "queria ter um modo de colocar a velocidade
 * mais rápida um pouco dos monstros de cada luta, para agilizar as lutas").
 *
 * É coisa de TELA, por aparelho: o motor só conhece os lances e o juiz refaz a sala pelos lances, então
 * acelerar a animação não muda regra nenhuma, nem o relógio de 30 s da vez do jogador, nem a vez de quem caiu.
 * Em dupla cada um escolhe a sua — quem acelera só espera o parceiro um pouco mais cedo.
 *
 * O fator vale em três lugares: a pausa entre os passos da IA (game.js, AI_ACTION_DELAY / fator), o tempo das
 * animações de andar/golpear e das pausas da fila (renderer3d_v2, updateAnims e o mixer das unidades) e a
 * trava do clipe de golpe (animLock). Três níveis: normal ×1, rápida ×1,5, muito rápida ×2.
 *
 *   Ritmo.NIVEIS            { normal: 1, rapida: 1.5, muito: 2 }
 *   Ritmo.nivel()           a chave guardada ('normal' sem nada)
 *   Ritmo.fator()           o número (1, 1.5 ou 2)
 *   Ritmo.define(nivel)     grava por aparelho (localStorage 'soterra-ritmo-v1'); devolve o fator
 *   Ritmo.nome(nivel)       o rótulo em português (a HUD passa pelo tr())
 *
 * Puro: sem DOM, sem outros módulos. O juiz não o carrega e não precisa. */
(function () {
  'use strict';
  var JOGO = (typeof window !== 'undefined') ? (window.JOGO = window.JOGO || {}) : (globalThis.JOGO = globalThis.JOGO || {});
  var R = {};
  JOGO.Ritmo = R;
  R.CHAVE = 'soterra-ritmo-v1';
  R.NIVEIS = { normal: 1, rapida: 1.5, muito: 2 };
  R.ORDEM = ['normal', 'rapida', 'muito'];
  var NOMES = { normal: 'Normal', rapida: 'Rápida (×1,5)', muito: 'Muito rápida (×2)' };
  var cache = null;
  function armario() { try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; } }
  function le() {
    if (cache) return cache;
    var v = null;
    try { var a = armario(); v = a ? a.getItem(R.CHAVE) : null; } catch (e) { v = null; }
    cache = (v && R.NIVEIS.hasOwnProperty(v)) ? v : 'normal';
    return cache;
  }
  R.nivel = function () { return le(); };
  R.fator = function () { return R.NIVEIS[le()] || 1; };
  R.define = function (nivel) {
    var n = R.NIVEIS.hasOwnProperty(nivel) ? nivel : 'normal';
    cache = n;
    try { var a = armario(); if (a) { if (n === 'normal') a.removeItem(R.CHAVE); else a.setItem(R.CHAVE, n); } } catch (e) {}
    return R.NIVEIS[n];
  };
  R.nome = function (nivel) { return NOMES[nivel] || NOMES.normal; };
  R._zera = function () { cache = null; };     // provas
})();
