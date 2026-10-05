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
 *
 * O SANTUÁRIO DOS ELEMENTOS (03/10): a batalha numa sala dele mostra, na
 * primeira visita de CADA sala, o cartão da regra de terreno dela (escuro,
 * água, pilares, vento, e o Altar com as quatro) em vez do cartão genérico da
 * batalha — quem chega lá já sabe jogar, o que não sabe é a regra do mapa. O
 * texto é o MESMO da ficha e da linha da sala (UI.santuarioTexto, no hud.js):
 * uma frase só para cada regra. `reveSantuario` esquece os cinco "Entendi".
 */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (o juiz do servidor e as provas em Node não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

  var T = {};
  JOGO.Tutor = T;

  var DICAS = {
    heroSelect: {
      titulo: Tx('Quem desce'),
      texto: Tx('Escolha <b>1 ou 2</b> heróis. Sozinho, a sorte de saque é máxima; em dupla, vocês podem <b>FUNDIR</b> no meio da luta e virar outra coisa.')
    },
    hub: {
      titulo: Tx('O Acampamento'),
      texto: Tx('Toque no chão para <b>andar</b>. Chegue perto de um portal para descer, do banco para guardar, da arena para duelar. O <b>cais</b> aí embaixo abre inventário, forja e missões — e a tecla <b>I</b> abre o saco.')
    },
    battle: {
      titulo: Tx('A batalha'),
      texto: Tx('Toque no chão para andar (o segundo toque <b>confirma</b>). Toque num feitiço e depois no alvo. O relógio de <b>30s</b> acumula o que sobrar para os próximos turnos.')
    },
    roomClear: {
      titulo: Tx('Sala limpa'),
      texto: Tx('O saque já está no <b>saco</b> (tecla I). Os vivos curam metade do que perderam ao avançar — e a próxima sala vem inteira.')
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

  // a dica de uma tela: as fixas e, na batalha de uma sala do Santuário, a da regra dela
  var REGRAS_SANTUARIO = ['fogo', 'agua', 'terra', 'ar', 'altar'];
  function dicaDe(nome) {
    if (nome === 'battle') {
      var st = JOGO.Game && JOGO.Game.state, room = null;
      try {
        var dg = (st && st.santuario && JOGO.Engine.calabouco) ? JOGO.Engine.calabouco(st.dungeonId) : null;
        room = dg && dg.rooms ? dg.rooms[st.roomIndex] : null;
      } catch (e) { room = null; }
      var regra = room && room.santuario && room.santuario.regra;
      var tx = (regra && JOGO.UI && JOGO.UI.santuarioTexto) ? JOGO.UI.santuarioTexto(regra) : null;
      if (tx) return { chave: 'santuario-' + regra, titulo: tx.sala, texto: tx.texto };
    }
    return DICAS[nome] ? { chave: nome, titulo: DICAS[nome].titulo, texto: DICAS[nome].texto } : null;
  }
  T.reveSantuario = function () {
    var d = le();
    if (d.off) return 0;
    REGRAS_SANTUARIO.forEach(function (r) { delete d.vistos['santuario-' + r]; });
    grava(d);
    return REGRAS_SANTUARIO.length;
  };

  T.aoTela = function (tela) {
    fecha();
    var d = le(), dica = dicaDe(tela);
    if (!dica) return false;
    var nome = dica.chave;
    if (d.off || d.vistos[nome]) return false;
    caixa = document.createElement('div');
    caixa.className = 'tutor-caixa';
    caixa.innerHTML = '<b>' + dica.titulo + '</b><p>' + dica.texto + '</p>';
    var acts = document.createElement('div');
    acts.className = 'tutor-acts';
    var b1 = document.createElement('button');
    b1.type = 'button';
    b1.className = 'btn btn-primary btn-mini';
    b1.textContent = Tx('Entendi');
    b1.addEventListener('click', function () {
      var d2 = le();
      d2.vistos[nome] = true;
      grava(d2);
      fecha();
    });
    var b2 = document.createElement('button');
    b2.type = 'button';
    b2.className = 'btn btn-ghost btn-mini';
    b2.textContent = Tx('Não mostrar dicas');
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
