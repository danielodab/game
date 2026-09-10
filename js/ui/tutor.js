// O Tutor — as dicas de primeira vez, uma por tela (dono: designer).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * Onboarding mínimo (pacote 25/08): o jogo assumia que todo mundo já jogou
 * um tático por turnos. Agora cada TELA importante mostra UM cartão na primeira visita —
 * escolha de heróis, Acampamento, batalha, sala limpa — dispensado com
 * "Entendi" (aquela tela nunca mais pede) ou com "Não mostrar dicas" (mata
 * todas). Sem setinhas nem trilhos: o cartão diz o essencial e sai da
 * frente; quem fecha sem ler encontra o mesmo cartão na próxima vez.
 *
 * PERSISTÊNCIA POR CONTA (localStorage 'soterra-tutor-v1' + sufixo do Banco
 * de Contas): a conta 2 da mesma máquina é um jogador novo e vê as dicas.
 * O gancho é um EMBRULHO em UI.showScreen — o Tutor não conhece o miolo da
 * HUD, só o nome da tela que acabou de abrir.
 */
(function () {
  'use strict';

  var T = {};
  JOGO.Tutor = T;

  var DICAS = {
    heroSelect: {
      titulo: 'Quem desce',
      texto: 'Escolha <b>1 ou 2</b> heróis. Sozinho, a sorte de saque é máxima; ' +
             'em dupla, vocês podem <b>FUNDIR</b> no meio da luta e virar outra coisa.'
    },
    hub: {
      titulo: 'O Acampamento',
      texto: 'Toque no chão para <b>andar</b>. Chegue perto de um portal para descer, ' +
             'do banco para guardar, da arena para duelar. O <b>cais</b> aí embaixo ' +
             'abre inventário, forja e missões — e a tecla <b>I</b> abre o saco.'
    },
    battle: {
      titulo: 'A batalha',
      texto: 'Toque no chão para andar (o segundo toque <b>confirma</b>). Toque num ' +
             'feitiço e depois no alvo. O relógio de <b>30s</b> acumula o que sobrar ' +
             'para os próximos turnos.'
    },
    roomClear: {
      titulo: 'Sala limpa',
      texto: 'O saque já está no <b>saco</b> (tecla I). Os vivos curam metade do que ' +
             'perderam ao avançar — e a próxima sala vem inteira.'
    }
  };

  function chave() {
    var suf = (JOGO.Contas && JOGO.Contas.sufixo) ? JOGO.Contas.sufixo() : '';
    return 'soterra-tutor-v1' + suf;
  }
  function le() {
    try {
      var d = JSON.parse(window.localStorage.getItem(chave()) || '');
      if (d && d.vistos) return d;
    } catch (e) {}
    return { vistos: {}, off: false };
  }
  function grava(d) {
    try { window.localStorage.setItem(chave(), JSON.stringify(d)); } catch (e) {}
  }

  var caixa = null;
  function fecha() {
    if (caixa && caixa.parentNode) caixa.parentNode.removeChild(caixa);
    caixa = null;
  }

  T.aoTela = function (nome) {
    fecha();
    var d = le();
    if (d.off || d.vistos[nome] || !DICAS[nome]) return false;
    var dica = DICAS[nome];
    caixa = document.createElement('div');
    caixa.className = 'tutor-caixa';
    caixa.innerHTML = '<b>' + dica.titulo + '</b><p>' + dica.texto + '</p>';
    var acts = document.createElement('div');
    acts.className = 'tutor-acts';
    var b1 = document.createElement('button');
    b1.type = 'button';
    b1.className = 'btn btn-primary btn-mini';
    b1.textContent = 'Entendi';
    b1.addEventListener('click', function () {
      var d2 = le();
      d2.vistos[nome] = true;
      grava(d2);
      fecha();
    });
    var b2 = document.createElement('button');
    b2.type = 'button';
    b2.className = 'btn btn-ghost btn-mini';
    b2.textContent = 'Não mostrar dicas';
    b2.addEventListener('click', function () {
      var d3 = le();
      d3.off = true;
      grava(d3);
      fecha();
    });
    acts.appendChild(b1);
    acts.appendChild(b2);
    caixa.appendChild(acts);
    document.body.appendChild(caixa);
    return true;
  };

  // reservado para testes e para religar as dicas num futuro menu de opções
  T._zera = function () { grava({ vistos: {}, off: false }); };

  // o gancho: embrulha UI.showScreen assim que a HUD existir
  (function tenta() {
    var UI = JOGO.UI;
    if (!UI || typeof UI.showScreen !== 'function') { setTimeout(tenta, 150); return; }
    if (UI.__tutorWrapped) return;
    var orig = UI.showScreen;
    UI.showScreen = function (nome, dados) {
      var r = orig.apply(this, arguments);
      try { T.aoTela(nome); } catch (e) {}
      return r;
    };
    UI.__tutorWrapped = true;
  })();
})();
