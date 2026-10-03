/* banimento.js — a tela do banido no SITE (02/10).
 *
 * Pedido do dono: "o jogador banido vê uma tela clara com motivo e data de fim".
 * O servidor (servidor/moderacao.py) responde 403 {erro:'conta banida',
 * banimento:{motivo, inicio, fim, permanente}} em toda rota com conta e no login
 * (só depois da senha certa). O SITE.api (site.js) chama SITE_BANIMENTO.mostra
 * com isso; aqui só a janela — a mesma frase do jogo (js/ui/moderacao.js), com a
 * data em hora de Brasília, o relógio do servidor.
 *
 * Arquivo próprio para entrar e sair sem mexer no site.js; as páginas que falam
 * com a conta (conta, loja, mestre) o carregam depois do site.js. */
(function () {
  'use strict';
  var FUSO_S = -3 * 3600;
  var B = window.SITE_BANIMENTO = {};
  function z(n) { return (n < 10 ? '0' : '') + n; }
  B.quando = function (seg) {
    var n = Number(seg);
    if (!isFinite(n) || n <= 0) return '';
    var d = new Date((n + FUSO_S) * 1000);
    return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' às ' +
           z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
  };
  /* a frase curta (o SITE.erro a usa no aviso do formulário de entrar) */
  B.frase = function (b) {
    if (!b) return 'conta banida';
    var fim = (b.permanente || b.fim == null) ? 'para sempre' : 'até ' + B.quando(b.fim) + ' (horário de Brasília)';
    return 'Sua conta está banida ' + fim + (b.motivo ? '. Motivo: ' + b.motivo : '') + '.';
  };
  var aberta = null;
  B.mostra = function (b) {
    b = b || {};
    if (aberta && aberta.parentNode) aberta.parentNode.removeChild(aberta);
    var fundo = document.createElement('div');
    fundo.className = 'modal ban-site';
    fundo.setAttribute('role', 'alertdialog');
    fundo.setAttribute('aria-modal', 'true');
    var cx = document.createElement('div');
    cx.className = 'modal-caixa';
    function linha(tag, texto, cls) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      e.textContent = texto;
      cx.appendChild(e);
      return e;
    }
    linha('h3', 'Sua conta está banida');
    linha('p', (b.permanente || b.fim == null) ? 'O banimento é permanente.'
      : 'O banimento termina em ' + B.quando(b.fim) + ' (horário de Brasília). Depois disso, é só entrar de novo.');
    linha('p', b.motivo ? 'Motivo: ' + b.motivo : 'A Equipe não registrou o motivo deste banimento.', 'ban-motivo');
    linha('p', 'Se você acha que foi um engano, procure a Equipe do jogo.', 'apoio');
    var bt = document.createElement('div');
    bt.className = 'modal-botoes';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn-ouro';
    ok.textContent = 'Entendi';
    ok.addEventListener('click', function () {
      // a sessão de uma conta banida não serve para nada aqui: sai, e a página volta sem conta
      try { if (window.SITE && SITE.sessao && SITE.sessao()) SITE.sair(); } catch (e) {}
      if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
    });
    bt.appendChild(ok);
    cx.appendChild(bt);
    fundo.appendChild(cx);
    // a classe .modal do site.css já cobre a página; o motivo ganha um destaque leve
    if (!document.getElementById('ban-site-estilo')) {
      var s = document.createElement('style');
      s.id = 'ban-site-estilo';
      s.textContent = '.ban-site .ban-motivo{padding:10px 12px;border-radius:8px;background:rgba(122,48,48,.25);' +
        'border:1px solid rgba(255,140,120,.35);white-space:pre-wrap;word-break:break-word}';
      document.head.appendChild(s);
    }
    document.body.appendChild(fundo);
    try { ok.focus(); } catch (e2) {}
    aberta = fundo;
    return fundo;
  };
})();
