/* mestre_moderacao.js — a moderação no site do Mestre (02/10).
 *
 * Pedido do dono: a fila de denúncias "visível no painel do jogo e no site do
 * Mestre". O painel do jogo (js/ui/painel_mestre.js) faz tudo; aqui, ao lado do
 * painel de presentes (mestre.js), entram:
 *   - a FILA de denúncias (abertas e em análise, ou todas), com as falas
 *     marcadas como relato do cliente, e os botões em análise / procedente
 *     (com a ação: silenciar ou banir) / improcedente, mais a resposta que vai
 *     na carta ao denunciante;
 *   - os BANIMENTOS e SILÊNCIOS em vigor, com desbanir e devolver a voz;
 *   - a AUDITORIA (as últimas ações de todo Mestre);
 *   - na FICHA de uma conta (mestre.js chama MS_MODERACAO.ficha): o banimento
 *     e o silêncio em vigor, banir e silenciar com duração e motivo.
 * Quem manda é o servidor (servidor/moderacao.py): toda rota é /api/mestre/*
 * com a marca lida do banco, e toda ação vai à auditoria. Os textos de jogador
 * entram escapados (SITE.esc) ou por textContent.
 *
 * Arquivo próprio para não crescer o mestre.js: ele só ganhou o gancho da ficha. */
(function () {
  'use strict';
  var E = SITE.esc;
  var MS = window.MS_MODERACAO = {};
  var filtro = 'abertas';
  var DURACOES = [['1h', '1 hora'], ['24h', '24 horas'], ['7d', '7 dias'], ['30d', '30 dias'], ['permanente', 'para sempre']];
  function $(id) { return document.getElementById(id); }
  function aviso(texto, tipo) {
    var a = $('ms-aviso');
    if (!a) return;
    a.textContent = texto;
    a.className = 'aviso flutua ' + (tipo === 'ok' ? 'ok' : 'erro');      // as classes do aviso do mestre.js
    clearTimeout(MS._t);
    MS._t = setTimeout(function () { a.className = 'aviso flutua'; }, 4000);
  }
  function fimTexto(p) {
    if (!p) return '';
    return (p.permanente || p.fim == null) ? 'para sempre' : 'até ' + SITE.quando(p.fim);
  }
  function opcoes(lista, valor) {
    return lista.map(function (o) {
      return '<option value="' + E(o[0]) + '"' + (o[0] === valor ? ' selected' : '') + '>' + E(o[1]) + '</option>';
    }).join('');
  }
  function api(rota, op) { return SITE.api(rota, op); }

  /* ---- a fila ---- */
  MS.carregaFila = function () {
    var ul = $('ms-denuncias');
    if (!ul) return Promise.resolve(null);
    ul.innerHTML = '<li class="apoio">carregando…</li>';
    return api('/api/mestre/denuncias?estado=' + encodeURIComponent(filtro)).then(function (r) {
      if (!r.ok) { ul.innerHTML = '<li class="apoio fora">' + E(SITE.erro(r, 'a fila não abriu')) + '</li>'; return r; }
      var c = r.contagem || {};
      $('ms-denuncias-total').textContent = 'abertas ' + (c.aberta || 0) + ' · em análise ' + (c['em-analise'] || 0) +
        ' · procedentes ' + (c.procedente || 0) + ' · improcedentes ' + (c.improcedente || 0);
      ul.innerHTML = r.denuncias.length ? r.denuncias.map(linhaDenuncia).join('') : '<li class="apoio">Nenhuma denúncia aqui.</li>';
      return r;
    });
  };
  function linhaDenuncia(d) {
    var aberta = d.estado === 'aberta' || d.estado === 'em-analise';
    var falas = (d.falas || []).map(function (f) { return '<div>“' + E(f.texto) + '”</div>'; }).join('');
    return '<li class="ms-den" data-denuncia="' + E(d.id) + '">' +
      '<div><b>#' + E(d.id) + ' · ' + E(d.categoriaNome) + '</b> <span class="etiqueta">' + E(d.estado) + '</span>' +
      (d.alvo.banido ? ' <span class="etiqueta banida">banida</span>' : '') +
      (d.alvo.silenciado ? ' <span class="etiqueta">silenciada</span>' : '') + '</div>' +
      '<small class="apoio">' + E(SITE.quando(d.criadoEm)) + ' · ' + E(d.denunciante.nome || '(conta apagada)') + ' denunciou ' +
      E(d.alvo.nome || '(conta apagada)') + (d.alvo.id ? ' #' + E(d.alvo.id) : '') +
      (d.contraAlvo > 1 ? ' · ' + E(d.contraAlvo) + ' denúncias contra' : '') + '</small>' +
      (d.texto ? '<p>' + E(d.texto) + '</p>' : '') +
      (falas ? '<div class="ms-falas"><small class="apoio">Falas anexadas — relato do cliente (o servidor não guarda o chat):</small>' + falas + '</div>' : '') +
      (d.mestre ? '<small class="apoio">com ' + E(d.mestre.nome) + (d.acao ? ' · ação: ' + E(d.acao.tipo) + ' ' + E(d.acao.duracao || '') : '') + '</small>' : '') +
      (d.resposta ? '<small class="apoio"> · resposta: ' + E(d.resposta) + '</small>' : '') +
      (aberta ? '<div class="ms-den-acoes">' +
        '<textarea maxlength="500" rows="2" data-resposta placeholder="resposta ao denunciante (vai na carta; opcional)"></textarea>' +
        '<div class="ms-linha"><label>na procedente <select data-acao>' + opcoes([['', 'sem ação'], ['silenciar', 'silenciar'], ['banir', 'banir']], '') +
        '</select></label> <select data-duracao>' + opcoes(DURACOES, '24h') + '</select></div>' +
        '<div class="ms-linha">' + (d.estado === 'aberta' ? '<button type="button" class="btn btn-mini" data-estado="em-analise">em análise</button>' : '') +
        '<button type="button" class="btn btn-mini btn-ouro" data-estado="procedente">procedente</button>' +
        '<button type="button" class="btn btn-mini" data-estado="improcedente">improcedente</button></div></div>' : '') +
      '</li>';
  }
  function mudaEstado(li, estado) {
    var id = Number(li.getAttribute('data-denuncia'));
    var corpo = { id: id, estado: estado };
    var resp = li.querySelector('[data-resposta]');
    if (resp && resp.value.trim()) corpo.resposta = resp.value.trim();
    var acao = li.querySelector('[data-acao]');
    if (estado === 'procedente' && acao && acao.value) corpo.acao = { tipo: acao.value, duracao: li.querySelector('[data-duracao]').value };
    var texto = estado === 'em-analise' ? 'Marcar a denúncia #' + id + ' como em análise?'
      : 'Fechar a denúncia #' + id + ' como ' + estado + (corpo.acao ? ' e ' + corpo.acao.tipo + ' (' + corpo.acao.duracao + ')' : '') + '?';
    SITE.confirma({ titulo: 'Denúncia #' + id, texto: texto, nota: estado === 'em-analise' ? '' : 'O denunciante recebe uma carta da Equipe.',
                    sim: 'Confirmar' }).then(function (sim) {
      if (!sim) return;
      api('/api/mestre/denuncia', { method: 'POST', body: corpo }).then(function (r) {
        aviso(r.ok ? 'Denúncia #' + id + ': ' + estado + '.' : SITE.erro(r, 'não deu'), r.ok ? 'ok' : 'erro');
        if (r.ok) { MS.carregaFila(); MS.carregaBanimentos(); }
      });
    });
  }

  /* ---- os banimentos e silêncios em vigor ---- */
  MS.carregaBanimentos = function () {
    var ul = $('ms-banimentos');
    if (!ul) return Promise.resolve(null);
    return api('/api/mestre/banimentos').then(function (r) {
      if (!r.ok) { ul.innerHTML = '<li class="apoio fora">' + E(SITE.erro(r, 'a lista não abriu')) + '</li>'; return r; }
      var itens = (r.banimentos || []).filter(function (b) { return b.ativo; }).map(function (b) { return ['banir', b]; })
        .concat((r.legado || []).map(function (b) { return ['banir', b]; }))
        .concat((r.silencios || []).filter(function (b) { return b.ativo; }).map(function (b) { return ['silenciar', b]; }));
      ul.innerHTML = itens.length ? itens.map(function (x) {
        var b = x[1], ban = x[0] === 'banir';
        return '<li><div><b>' + E(b.conta.nome) + '</b> #' + E(b.conta.id) + ' <span class="etiqueta' + (ban ? ' banida' : '') + '">' +
          (ban ? 'banida' : 'silenciada') + '</span></div><small class="apoio">' + E(fimTexto(b)) +
          (b.motivo ? ' · ' + E(b.motivo) : (b.legado ? ' · de antes (sem motivo)' : '')) + (b.porNome ? ' · por ' + E(b.porNome) : '') + '</small>' +
          '<button type="button" class="btn btn-mini" data-desfaz="' + (ban ? 'desbanir' : 'dessilenciar') + '" data-conta="' + E(b.conta.id) +
          '" data-nome="' + E(b.conta.nome) + '">' + (ban ? 'desbanir' : 'devolver a voz') + '</button></li>';
      }).join('') : '<li class="apoio">Ninguém banido nem silenciado agora.</li>';
      return r;
    });
  };
  function desfaz(bt) {
    var rota = bt.getAttribute('data-desfaz'), id = Number(bt.getAttribute('data-conta')), nome = bt.getAttribute('data-nome');
    SITE.confirma({ titulo: rota === 'desbanir' ? 'Desbanir' : 'Devolver a voz',
                    texto: (rota === 'desbanir' ? 'Desbanir ' : 'Devolver a voz a ') + nome + '?', sim: 'Confirmar' }).then(function (sim) {
      if (!sim) return;
      api('/api/mestre/' + rota, { method: 'POST', body: { conta: id } }).then(function (r) {
        aviso(r.ok ? 'Feito: ' + nome + '.' : SITE.erro(r, 'não deu'), r.ok ? 'ok' : 'erro');
        if (r.ok) { MS.carregaBanimentos(); if (MS._ficha) MS._recarregaFicha(); }
      });
    });
  }

  /* ---- a auditoria ---- */
  MS.carregaAuditoria = function () {
    var ul = $('ms-auditoria');
    if (!ul) return Promise.resolve(null);
    return api('/api/mestre/auditoria?limite=50').then(function (r) {
      if (!r.ok) { ul.innerHTML = '<li class="apoio fora">' + E(SITE.erro(r, 'a auditoria não abriu')) + '</li>'; return r; }
      ul.innerHTML = r.registros.length ? r.registros.map(function (a) {
        return '<li><div><b>' + E(a.acao) + '</b>' + (a.alvo ? ' · ' + E(a.alvo.nome || '?') + ' #' + E(a.alvo.id) : '') + '</div>' +
          '<small class="apoio">' + E(SITE.quando(a.criadoEm)) + ' · ' + E((a.mestre && a.mestre.nome) || '—') + ' · ' +
          E(typeof a.dados === 'string' ? a.dados : JSON.stringify(a.dados)).slice(0, 400) + '</small></li>';
      }).join('') : '<li class="apoio">Nenhuma ação registrada ainda.</li>';
      return r;
    });
  };

  /* ---- a ficha (o gancho do mestre.js) ---- */
  MS.ficha = function (ficha, recarrega) {
    var caixa = $('ms-moderacao-conta');
    if (!caixa) return;
    MS._ficha = ficha;
    MS._recarregaFicha = recarrega || function () {};
    var c = (ficha && ficha.conta) || {}, m = (ficha && ficha.moderacao) || {};
    var html = '';
    if (m.banimento) html += '<p class="fora">Banida ' + E(fimTexto(m.banimento)) + ' — ' + E(m.banimento.motivo || 'sem motivo registrado') + '</p>';
    if (m.silencio) html += '<p>Silenciada ' + E(fimTexto(m.silencio)) + ' — ' + E(m.silencio.motivo) + '</p>';
    var den = m.denuncias || {}, total = 0;
    Object.keys(den).forEach(function (k) { total += den[k]; });
    html += '<p class="apoio">Denúncias contra: ' + (total ? E(total) : 'nenhuma') + '</p>';
    if (c.gm) html += '<p class="apoio">Conta com a marca de Mestre: tire a marca no Terminal antes de punir.</p>';
    else {
      html += '<form class="ms-linha" data-punir novalidate autocomplete="off">' +
        '<select data-tipo>' + opcoes([['silenciar', 'silenciar no chat'], ['banir', 'banir']], 'silenciar') + '</select>' +
        '<select data-duracao>' + opcoes(DURACOES, '24h') + '</select>' +
        '<input type="text" data-motivo maxlength="300" placeholder="motivo (o jogador vê)">' +
        '<button type="submit" class="btn btn-ouro">aplicar</button></form>';
      if (m.banimento) html += '<button type="button" class="btn btn-mini" data-desfaz="desbanir" data-conta="' + E(c.id) + '" data-nome="' + E(c.nome) + '">desbanir</button> ';
      if (m.silencio) html += '<button type="button" class="btn btn-mini" data-desfaz="dessilenciar" data-conta="' + E(c.id) + '" data-nome="' + E(c.nome) + '">devolver a voz</button>';
    }
    caixa.innerHTML = html;
  };
  function pune(form) {
    var c = (MS._ficha && MS._ficha.conta) || {};
    var tipo = form.querySelector('[data-tipo]').value, duracao = form.querySelector('[data-duracao]').value;
    var motivo = form.querySelector('[data-motivo]').value.trim();
    if (motivo.length < 3) { aviso('Escreva o motivo (o jogador vê).', 'erro'); return; }
    SITE.confirma({ titulo: tipo === 'banir' ? 'Banir' : 'Silenciar', sim: tipo === 'banir' ? 'Banir' : 'Silenciar',
                    texto: (tipo === 'banir' ? 'Banir ' : 'Silenciar ') + c.nome + ' ' +
                      (duracao === 'permanente' ? 'para sempre' : 'por ' + duracao) + '?', nota: 'Motivo: ' + motivo }).then(function (sim) {
      if (!sim) return;
      api('/api/mestre/' + tipo, { method: 'POST', body: { conta: c.id, duracao: duracao, motivo: motivo } }).then(function (r) {
        aviso(r.ok ? 'Feito: ' + c.nome + '.' : SITE.erro(r, 'não deu'), r.ok ? 'ok' : 'erro');
        if (r.ok) { MS._recarregaFicha(); MS.carregaBanimentos(); }
      });
    });
  }

  MS.carregaTudo = function () { MS.carregaFila(); MS.carregaBanimentos(); MS.carregaAuditoria(); };

  /* os cliques (delegados: as listas se redesenham) */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var b = t.closest('#ms-moderacao [data-estado]');
    if (b) { mudaEstado(b.closest('[data-denuncia]'), b.getAttribute('data-estado')); return; }
    var d = t.closest('[data-desfaz]');
    if (d && (d.closest('#ms-moderacao') || d.closest('#ms-moderacao-conta'))) { desfaz(d); return; }
    var f = t.closest('#ms-moderacao [data-filtro]');
    if (f) { filtro = f.getAttribute('data-filtro'); MS.carregaFila(); }
    if (t.closest('#ms-moderacao [data-atualiza]')) MS.carregaTudo();
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (f && f.matches && f.matches('#ms-moderacao-conta [data-punir]')) { ev.preventDefault(); pune(f); }
  });
  /* o painel abre quando o portão do mestre.js conclui que é o Mestre (#ms-painel visível) */
  function vigia() {
    var p = $('ms-painel');
    if (!p) return;
    var aberto = false;
    function confere() {
      if (!p.hidden && !aberto) { aberto = true; MS.carregaTudo(); }
      if (p.hidden) aberto = false;
    }
    new MutationObserver(confere).observe(p, { attributes: true, attributeFilter: ['hidden'] });
    confere();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigia);
  else vigia();
})();
