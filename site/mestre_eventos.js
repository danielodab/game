/* mestre_eventos.js — o funil de uso no painel do Mestre (site/mestre.html), 15/10.
 *
 * Lê GET /api/mestre/eventos?dias=N (servidor/eventos_uso.py) e desenha: o funil do período
 * (boot → escolha dos heróis → praça → antessala → batalha → vitória/derrota), a retenção (quantos
 * boots vieram 1, 2–3, 4–7, 8–30 ou 30+ dias depois do anterior no mesmo aparelho), a divisão por
 * plataforma e a tabela dia a dia. Não há nada de ninguém aqui: o servidor só soma.
 * Mora fora do mestre.js como o mestre_erros.js, e só olha quando o #ms-painel aparece. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  if (!$('ms-eventos-bloco') || !window.SITE) return;
  var E = SITE.esc, N = function (n) { return E(SITE.num(n || 0)); };
  var lendo = false;

  var FUNIL = [['boot', 'abriu o jogo'], ['tela:heroSelect', 'escolha dos heróis'], ['tela:hub', 'praça'],
               ['tela:antessala', 'antessala'], ['tela:battle', 'batalha'], ['tela:roomClear', 'venceu uma sala'],
               ['tela:defeat', 'perdeu']];
  var RETORNO = [['retorno_1d', 'no dia seguinte'], ['retorno_2_3d', '2–3 dias'], ['retorno_4_7d', '4–7 dias'],
                 ['retorno_8_30d', '8–30 dias'], ['retorno_30d', '30+ dias']];

  function desenha(r) {
    var res = $('ev-resumo'), box = $('ev-funil'), tab = $('ev-tabela');
    if (!r.ok || !r.porNome) {
      res.textContent = '';
      box.innerHTML = '<p class="apoio">' + E(r.status === 0 ? 'O servidor está fora.' :
        r.status === 404 ? 'O registro de eventos ainda não chegou a este servidor.' :
        SITE.erro(r, 'não deu para ler os eventos')) + '</p>';
      tab.innerHTML = '';
      return;
    }
    var boots = r.porNome.boot || 0;
    res.innerHTML = '<span><b>' + N(boots) + '</b> abertura(s) em ' + E(String(r.dias)) + ' dia(s)</span>' +
      Object.keys(r.porPlataforma || {}).map(function (p) {
        return '<span>' + E(p) + ': <b>' + N(r.porPlataforma[p]) + '</b></span>';
      }).join('');
    var html = '<table class="ev-funil"><tr><th>etapa</th><th>sessões</th><th>das aberturas</th></tr>';
    FUNIL.forEach(function (f) {
      var v = r.porNome[f[0]] || 0;
      html += '<tr><td>' + E(f[1]) + '</td><td>' + N(v) + '</td><td>' + (boots ? Math.round(100 * v / boots) + '%' : '—') + '</td></tr>';
    });
    html += '</table><table class="ev-funil"><tr><th>voltou depois de</th><th>aberturas</th></tr>';
    RETORNO.forEach(function (f) {
      html += '<tr><td>' + E(f[1]) + '</td><td>' + N(r.porNome[f[0]] || 0) + '</td></tr>';
    });
    html += '</table>';
    var outros = Object.keys(r.porNome).filter(function (k) {
      return k !== 'boot' && !/^retorno_/.test(k) && !FUNIL.some(function (f) { return f[0] === k; });
    }).sort();
    if (outros.length) {
      html += '<p class="apoio">outros: ' + outros.map(function (k) { return E(k) + ' ' + N(r.porNome[k]); }).join(' · ') + '</p>';
    }
    box.innerHTML = html;
    var dias = Object.keys(r.porDia || {}).sort().reverse();
    if (!dias.length) { tab.innerHTML = '<p class="apoio">Nenhum evento no período.</p>'; return; }
    var t = '<table class="ev-funil"><tr><th>dia</th>' + FUNIL.map(function (f) { return '<th>' + E(f[1]) + '</th>'; }).join('') + '</tr>';
    dias.forEach(function (d) {
      t += '<tr><td>' + E(d) + '</td>' + FUNIL.map(function (f) { return '<td>' + N(r.porDia[d][f[0]] || 0) + '</td>'; }).join('') + '</tr>';
    });
    tab.innerHTML = t + '</table>';
  }

  function le() {
    if (lendo) return;
    lendo = true;
    var dias = parseInt(($('ev-dias') || {}).value || '30', 10) || 30;
    SITE.api('/api/mestre/eventos?dias=' + dias).then(function (r) {
      lendo = false;
      if (r.status === 401 || r.status === 403) return;   // o portão do mestre.js cuida
      desenha(r);
    });
  }

  $('ev-atualizar').addEventListener('click', le);
  if ($('ev-dias')) $('ev-dias').addEventListener('change', le);
  var painel = $('ms-painel');
  if (painel && !painel.hidden) le();
  else if (painel && window.MutationObserver) {
    new MutationObserver(function () { if (!painel.hidden) le(); }).observe(painel, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
