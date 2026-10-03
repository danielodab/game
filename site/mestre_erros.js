/* mestre_erros.js — o registro de erros no painel do Mestre (site/mestre.html), 02/10.
 *
 * Mora fora do mestre.js de propósito (outro trabalho mexe nele): este arquivo só
 * olha quando o #ms-painel aparece (o portão do mestre.js tira o `hidden` dele só
 * para a conta com a marca de Mestre) e então lê GET /api/mestre/erros. Um 401 ou
 * 403 aqui não decide nada — quem fecha o painel é o portão do mestre.js.
 *
 * A LISTA: um grupo por erro distinto (servidor/registros.py), do mais recente para
 * o mais velho — a mensagem, quantas vezes, quantas contas, a primeira e a última vez,
 * as versões do jogo, as telas e os navegadores em que apareceu, e a pilha cortada
 * (num <details>). "resolvido" manda POST /api/mestre/erros/apagar {chave}: o grupo
 * sai (se o erro voltar, nasce de novo com contagem nova). Nada de nome nem e-mail:
 * o servidor só guarda o número das contas.
 *
 * Tudo que vem do servidor passa pelo SITE.esc (a mensagem veio de um navegador
 * qualquer: é texto de fora). */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  if (!$('ms-erros-bloco') || !window.SITE) return;
  var E = SITE.esc;
  var lendo = false, aberto = false;

  function quando(ts) { return SITE.quando ? SITE.quando(ts) : new Date(ts * 1000).toLocaleString('pt-BR'); }
  function lista(v) { return Array.isArray(v) ? v.map(function (x) { return E(String(x)); }).join(', ') : ''; }

  function desenha(r) {
    var res = $('er-resumo'), ul = $('er-lista');
    if (!r.ok || !Array.isArray(r.erros)) {
      res.textContent = '';
      ul.innerHTML = '<li class="apoio">' + E(r.status === 0 ? 'O servidor está fora.' :
        r.status === 404 ? 'O registro de erros ainda não chegou a este servidor.' :
        SITE.erro(r, 'não deu para ler os erros')) + '</li>';
      return;
    }
    res.innerHTML = '<span><b>' + E(SITE.num(r.total)) + '</b> erro(s) distinto(s)</span>' +
      '<span><b>' + E(SITE.num(r.vezes)) + '</b> ocorrência(s)</span>' +
      '<span><b>' + E(SITE.num(r.ultimas24h)) + '</b> nas últimas 24 h</span>' +
      (r.mais ? '<span>mostrando os ' + r.erros.length + ' mais recentes</span>' : '');
    if (!r.erros.length) { ul.innerHTML = '<li class="apoio">Nenhum erro registrado.</li>'; return; }
    ul.innerHTML = r.erros.map(function (e) {
      var contas = Number(e.contas) || 0;
      return '<li data-chave="' + E(e.chave) + '">' +
        '<div class="er-cab"><span class="er-msg"><span class="etiqueta er-origem">' +
          E(e.origem === 'api' ? 'API' : e.tipo === 'promessa' ? 'jogo · promessa' : 'jogo') + '</span>' +
          E(e.mensagem) + '</span>' +
          '<span><span class="er-conta">×' + E(SITE.num(e.contagem)) + '</span>' +
          '<button type="button" class="btn btn-mini" data-resolver>resolvido</button></span></div>' +
        '<small class="er-meta">' + (e.onde ? E(e.onde) + ' · ' : '') +
          'última ' + E(quando(e.ultimaEm)) + ' · primeira ' + E(quando(e.primeiraEm)) + ' · ' +
          (contas ? contas + (e.contasNoTeto ? ' ou mais' : '') + ' conta(s)' : 'sem conta') + '</small>' +
        ((e.versoes && e.versoes.length) || (e.telas && e.telas.length) || (e.navegadores && e.navegadores.length)
          ? '<small class="er-meta">' +
            (e.versoes && e.versoes.length ? 'versões: ' + lista(e.versoes) + ' · ' : '') +
            (e.telas && e.telas.length ? 'telas: ' + lista(e.telas) + ' · ' : '') +
            (e.navegadores && e.navegadores.length ? 'navegadores: ' + lista(e.navegadores) : '') + '</small>' : '') +
        (e.pilha ? '<details><summary>pilha</summary><pre class="er-pilha">' + E(e.pilha) + '</pre></details>' : '') +
        '</li>';
    }).join('');
  }

  function le() {
    if (lendo) return;
    lendo = true;
    SITE.api('/api/mestre/erros').then(function (r) {
      lendo = false;
      if (r.status === 401 || r.status === 403) return;   // o portão do mestre.js cuida
      desenha(r);
    });
  }

  $('er-atualizar').addEventListener('click', le);
  $('er-lista').addEventListener('click', function (ev) {
    var bt = ev.target.closest && ev.target.closest('[data-resolver]');
    if (!bt || bt.disabled) return;
    var li = bt.closest('li[data-chave]');
    bt.disabled = true;
    SITE.api('/api/mestre/erros/apagar', { method: 'POST', body: { chave: li.getAttribute('data-chave') } })
      .then(function (r) {
        if (!r.ok) { bt.disabled = false; return; }
        le();
      });
  });

  // o painel aparece quando o portão do mestre.js abre; só então a lista é lida
  function olha() {
    var painel = $('ms-painel');
    var agora = !!painel && !painel.hidden;
    if (agora && !aberto) le();
    aberto = agora;
  }
  if ($('ms-painel')) new MutationObserver(olha).observe($('ms-painel'), { attributes: true, attributeFilter: ['hidden'] });
  olha();
})();
