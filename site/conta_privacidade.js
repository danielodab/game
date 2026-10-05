/* conta_privacidade.js — os direitos do titular na página da conta (site/conta.html), 02/10.
 *
 * O bloco "Privacidade e dados" da Minha conta. Mora fora do conta.js de propósito:
 * a conta.js desenha o resto da página, e este arquivo só olha quando a Minha conta
 * aparece (o #minha-conta perde o `hidden`) — sem gancho no meio dela.
 *
 *   O ACEITE QUE FALTA  GET /api/conta/aceite diz se a conta aceitou a versão de agora
 *                       dos Termos e da Política (a de antes dos documentos, ou de uma
 *                       versão velha, não aceitou). Pendente, a caixa aparece; marcar e
 *                       apertar Aceitar manda POST /api/conta/aceite {versao}.
 *   BAIXAR MEUS DADOS   GET /api/conta/meus-dados devolve o JSON; a página o entrega
 *                       como arquivo (Blob + <a download>), sem passar por outro lugar.
 *   EXCLUIR A CONTA     a confirmação forte: o botão só acende com o nome EXATO da conta
 *                       digitado e uma senha; o servidor confere os dois de novo (POST
 *                       /api/conta/excluir {nome, senha}), e uma janelinha (SITE.confirma)
 *                       ainda pergunta antes de mandar. Excluída, a sessão local sai e a
 *                       página mostra #conta-excluida. Os 409 (luta em andamento,
 *                       pagamento aberto, conta do Mestre) aparecem como o servidor diz.
 *
 * A versão que a página aceita é SITE.VERSAO_TERMOS (site.js). Tudo que vem do servidor
 * entra por textContent ou SITE.esc. Senha só no corpo do POST. */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO VISITANTE (docs/IDIOMAS.md, etapa 3): a chave é o próprio português. Sem o
   * JOGO.I18n (página de prova que não carrega o js/core/i18n.js) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = window.JOGO && window.JOGO.I18n;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  function $(id) { return document.getElementById(id); }
  if (!$('bl-privacidade') || !window.SITE) return;

  var nomeConta = '';     // o nome da conta logada (da sessão; o servidor confere o de verdade)
  var ocupado = false;
  var carregado = false;  // o aceite já foi lido nesta abertura da Minha conta

  function aviso(texto, tipo) {
    var el = $('pv-aviso');
    el.className = 'aviso' + (texto ? ' ' + (tipo || 'erro') : '');
    el.textContent = texto || '';
  }
  function dd(n) { return (n < 10 ? '0' : '') + n; }
  function data(ts) {
    var d = new Date(Number(ts) * 1000);
    return isNaN(d.getTime()) ? '' : dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function versaoLegivel(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(v || '');
  }

  /* ---- o aceite ---- */
  function desenhaAceite(r) {
    var pendente = !!r.pendente;
    $('pv-aceite').hidden = !pendente;
    $('pv-aceite-ok').textContent = (!pendente && r.aceite)
      ? Tx('Você aceitou os Termos de Uso e a Política de Privacidade de {a} em {b}.', { a: versaoLegivel(r.aceite.versao), b: data(r.aceite.em) })
      : '';
  }
  function leAceite() {
    SITE.api('/api/conta/aceite').then(function (r) {
      if (r.ok) desenhaAceite(r);
      // 404: o servidor ainda é de antes desta rota; o bloco segue sem a linha do aceite
    });
  }
  $('pv-aceitar').addEventListener('click', function () {
    if (ocupado) return;
    if (!$('pv-aceite-caixa').checked) { aviso(Tx('Marque a caixa depois de ler os dois documentos.')); return; }
    ocupado = true;
    SITE.api('/api/conta/aceite', { method: 'POST', body: { versao: SITE.VERSAO_TERMOS } }).then(function (r) {
      ocupado = false;
      if (!r.ok) { aviso(SITE.erro(r, Tx('não deu para gravar o aceite'))); return; }
      aviso(Tx('Aceite gravado. Obrigado!'), 'certo');
      desenhaAceite(r);
    });
  });

  /* ---- baixar meus dados ---- */
  function nomeDoArquivo() {
    var d = new Date();
    var limpo = String(nomeConta || 'conta').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'conta';
    return 'soterra-' + limpo + '-' + d.getFullYear() + dd(d.getMonth() + 1) + dd(d.getDate()) + '.json';
  }
  $('pv-baixar').addEventListener('click', function () {
    if (ocupado) return;
    ocupado = true;
    var bt = $('pv-baixar');
    bt.disabled = true;
    aviso(Tx('Juntando os seus dados…'), 'neutro');
    SITE.api('/api/conta/meus-dados').then(function (r) {
      ocupado = false;
      bt.disabled = false;
      if (!r.ok || !r.dados) { aviso(SITE.erro(r, Tx('não deu para juntar os dados'))); return; }
      try {
        var blob = new Blob([JSON.stringify(r.dados, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nomeDoArquivo();
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 1000);
        aviso(Tx('Pronto: o arquivo {download} foi baixado.', { download: a.download }), 'certo');
      } catch (e) {
        aviso(Tx('O navegador não deixou salvar o arquivo.'));
      }
    });
  });

  /* ---- excluir a conta ---- */
  function confere() {
    var nome = $('pv-nome').value.trim(), senha = $('pv-senha').value;
    $('pv-excluir-bt').disabled = ocupado || !nomeConta || nome !== nomeConta || !senha;
  }
  function fechaExcluir() {
    $('pv-excluir').hidden = true;
    $('pv-nome').value = '';
    $('pv-senha').value = '';
    confere();
  }
  $('pv-excluir-abre').addEventListener('click', function () {
    aviso('');
    $('pv-nome-conta').textContent = nomeConta;
    $('pv-excluir').hidden = false;
    confere();
    $('pv-nome').focus();
  });
  $('pv-excluir-volta').addEventListener('click', fechaExcluir);
  $('pv-nome').addEventListener('input', confere);
  $('pv-senha').addEventListener('input', confere);
  $('pv-excluir').addEventListener('submit', function (ev) {
    ev.preventDefault();
    confere();
    if ($('pv-excluir-bt').disabled) return;
    var nome = $('pv-nome').value.trim(), senha = $('pv-senha').value;
    SITE.confirma({
      titulo: Tx('Excluir a conta {nomeConta}?', { nomeConta: nomeConta }),
      texto: Tx('O save, os itens, os personagens, as barras de ouro e os vinténs somem para sempre.'),
      nota: Tx('Quer o arrependimento de uma compra? Peça antes de excluir.'),
      sim: Tx('Excluir para sempre'), nao: Tx('Voltar')
    }).then(function (sim) {
      if (!sim) return;
      ocupado = true;
      confere();
      aviso(Tx('Excluindo a conta…'), 'neutro');
      SITE.api('/api/conta/excluir', { method: 'POST', body: { nome: nome, senha: senha } }).then(function (r) {
        ocupado = false;
        $('pv-senha').value = '';
        confere();
        if (!r.ok) { aviso(SITE.erro(r, Tx('não deu para excluir a conta'))); return; }
        SITE.esquece();
        SITE.cabecalho();
        $('minha-conta').hidden = true;
        $('conta-excluida').hidden = false;
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        window.scrollTo(0, 0);
      });
    });
  });

  /* ---- quando a Minha conta aparece (a conta.js tira o hidden) ---- */
  function olha() {
    var visivel = !$('minha-conta').hidden;
    if (!visivel) { carregado = false; fechaExcluir(); return; }
    var s = SITE.sessao();
    nomeConta = (s && s.conta && typeof s.conta.nome === 'string') ? s.conta.nome : '';
    if (!carregado) { carregado = true; leAceite(); }
  }
  new MutationObserver(olha).observe($('minha-conta'), { attributes: true, attributeFilter: ['hidden'] });
  // o aviso de conta excluída sai quando a pessoa vai para outra tela (criar, entrar)
  window.addEventListener('hashchange', function () { $('conta-excluida').hidden = true; });
  olha();
})();
