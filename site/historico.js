/* historico.js — os históricos da conta, desenhados do mesmo jeito na Loja (site/loja.js) e em Minha conta
 * (site/conta.js). 26/10, o dono: "esses históricos devem ficar em minha conta e lá em cima minimizados...
 * melhor para enxergar". São três <details> fechados no alto das duas páginas — "Seus pacotes" (os pagamentos do
 * Mercado Pago), "Suas barras de ouro" (o extrato) e "Seus pedidos" —, cada um com um resumo na linha do título
 * (quantos esperam, ou o último) e, aberto, a lista de sempre. Este arquivo só DESENHA: quem pede ao servidor e
 * quem atende os botões (cancelar, conferir) é a página. Tudo que vem do servidor passa pelo SITE.esc. */
(function () {
  'use strict';
  /* o texto no idioma do visitante (docs/IDIOMAS.md): a chave é o próprio português */
  function Tx(s, v) {
    var I = window.JOGO && window.JOGO.I18n;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  var E = SITE.esc, N = SITE.num;
  function proprio(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  var DIA = 86400;          // o pedido preso: retirado há mais de um dia pode ser cancelado

  var ESTADO = { pendente: Tx('esperando o jogo abrir'), retirado: Tx('a caminho do jogo'), entregue: Tx('entregue'),
                 estornado: Tx('devolvido'), cancelado: Tx('cancelado') };
  // 04/10: por que um pedido ainda não entrou, quando a entrega é na hora (pedido.espera, do servidor)
  var ESPERA = { luta: Tx('chega quando a sala terminar'), juiz: Tx('entra em instantes'),
                 estado: Tx('esperando o jogo abrir uma vez nesta conta') };
  var MOTIVO = { 'sem-saldo': Tx('vinténs insuficientes no jogo'), 'classe-ja-liberada': Tx('a classe já estava liberada no jogo'),
                 'item-invalido': Tx('o jogo não reconheceu o produto'), 'erro-local': Tx('o jogo falhou ao entregar'),
                 'recusado': Tx('o jogo recusou o pedido') };
  var ESTADO_PAG = { aberto: Tx('esperando o pagamento'), pendente: Tx('em análise'), aprovado: Tx('aprovado'),
                     recusado: Tx('não aprovado'), estornado: Tx('estornado'), falhou: Tx('não abriu') };
  var MOTIVO_BARRAS = { pacote: Tx('pacote pago'), loja: Tx('compra na loja'), 'estorno-loja': Tx('devolvidas: pedido cancelado ou recusado'),
                        'troca-vintens': Tx('troca com vinténs'), presente: Tx('presente do Mestre'),
                        'estorno-pagamento': Tx('pagamento estornado'), ajuste: Tx('ajuste do dono do jogo'),
                        anuncio: Tx('anúncio assistido no aplicativo') };

  /* a barra de ouro desenhada à mão: a face de cima clara, a da frente mais funda, um brilho */
  function iconeBarra(classe) {
    return '<svg class="ico-barra' + (classe ? ' ' + classe : '') + '" viewBox="0 0 32 20" aria-hidden="true" focusable="false">' +
      '<polygon points="4,9 28,9 31.5,19 0.5,19" fill="#d4921a" stroke="#7a4f08" stroke-width="0.9" stroke-linejoin="round"/>' +
      '<polygon points="8.5,1 23.5,1 28,9 4,9" fill="#ffd45e" stroke="#7a4f08" stroke-width="0.9" stroke-linejoin="round"/>' +
      '<polygon points="10.5,2.6 17.5,2.6 16.6,4.4 9.6,4.4" fill="#fff6d2" opacity="0.85"/>' +
      '<polygon points="4.5,11 12,11 11.2,13 3.8,13" fill="#f5c04a" opacity="0.7"/></svg>';
  }
  function nBarras(n) { return N(n) + (Number(n) === 1 ? Tx(' barra de ouro') : Tx(' barras de ouro')); }
  function comId(lista) { return (Array.isArray(lista) ? lista : []).filter(function (x) { return x && x.id != null; }); }

  /* ---- "Seus pedidos". `botoes`: o "cancelar" do pedido que ainda espera (só a Loja atende) ---- */
  function linhaPedido(p, botoes) {
    var est = proprio(ESTADO, p.estado) ? p.estado : 'outro';
    var pago = p.origem === 'pagamento', presente = p.origem === 'presente' || p.origem === 'amigo';
    var deAmigo = p.origem === 'amigo';   // 04/10: o presente de outro jogador (as barras foram dele)
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO[est];
    if (est === 'pendente' && proprio(ESPERA, p.espera)) txt = ESPERA[p.espera];
    var emBarras = p.moeda === 'barras';
    if (est === 'estornado') {
      // o crédito de um pacote que o jogo recusou não se perde: o servidor manda de novo
      txt = pago ? Tx('não entrou no jogo: o servidor manda de novo')
                 : txt + ': ' + (proprio(MOTIVO, p.motivo) ? MOTIVO[p.motivo] : MOTIVO.recusado) + (emBarras ? Tx(' (as barras voltaram)') : '');
    }
    if (est === 'cancelado' && emBarras) txt = Tx('cancelado (as barras voltaram)');
    if (est === 'cancelado' && pago) txt = Tx('cancelado (o pagamento foi estornado)');
    // o pedido "preso": retirado há mais de um dia (o servidor confere de novo)
    var desde = Number(p.retiradoEm) || Number(p.criadoEm) || 0;
    var preso = est === 'retirado' && desde > 0 && SITE.agora() - desde > DIA;
    // crédito de pacote e presente do Mestre não se cancelam por aqui
    var pode = !!botoes && !pago && !presente && p.cancelavel !== false && (est === 'pendente' || preso);
    var custo = pago ? Tx('pacote pago') : deAmigo ? Tx('presente de {a}', { a: p.de || Tx('um amigo') }) : presente ? Tx('presente do Mestre')
      : emBarras ? nBarras(p.barras) : Number(p.preco) === 0 ? Tx('sem custo (Mestre)') : Tx('{a} vinténs', { a: N(p.preco) });
    var miudo = [custo,
                 Number(p.criadoEm) > 0 ? (pago ? Tx('aprovado {a}', { a: SITE.quando(p.criadoEm) }) : presente ? Tx('dado {a}', { a: SITE.quando(p.criadoEm) }) : Tx('pedido {a}', { a: SITE.quando(p.criadoEm) })) : '',
                 est === 'retirado' && !preso && !pago && !presente && botoes ? Tx('se não chegar em 24 h, dá para cancelar') : ''].filter(Boolean);
    return '<li class="pedido e-' + est + (pago ? ' o-pagamento' : presente ? ' o-presente' : '') + '" data-pedido="' + E(p.id) + '">' +
      '<div><b>' + E(p.nome || p.sku) + '</b><small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita">' +
      '<span class="estado-pedido">' + E(txt) + '</span>' +
      (pode ? '<button type="button" class="btn btn-mini" data-cancelar="' + E(p.id) + '">' + Tx('cancelar') + '</button>' : '') +
      '</div></li>';
  }
  function pedidos(lista, botoes) {
    var ps = comId(lista);
    return ps.length ? ps.map(function (p) { return linhaPedido(p, botoes); }).join('') : Tx('<li class="apoio">Nenhum pedido ainda.</li>');
  }

  /* ---- "Suas barras de ouro" (13/09): o extrato que /minha traz, o mais novo antes ---- */
  function linhaMovimento(m) {
    var d = Math.floor(Number(m.delta) || 0);
    var motivo = proprio(MOTIVO_BARRAS, m.motivo) ? MOTIVO_BARRAS[m.motivo] : String(m.motivo == null ? '' : m.motivo);
    var miudo = [m.nome ? motivo : '', Number(m.criadoEm) > 0 ? SITE.quando(m.criadoEm) : '',
                 m.saldo != null ? Tx('saldo {a}', { a: N(m.saldo) }) : ''].filter(Boolean);
    return '<li class="movimento ' + (d > 0 ? 'entra' : 'sai') + '" data-movimento="' + E(m.id) + '"><div><b>' + E(m.nome || motivo) + '</b>' +
      '<small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita"><span class="delta">' + (d > 0 ? '+' : '−') +
      N(Math.abs(d)) + '</span>' + iconeBarra() + '</div></li>';
  }
  function extrato(lista) {
    var ms = comId(lista);
    return ms.length ? ms.map(linhaMovimento).join('')
      : Tx('<li class="apoio">Nenhum movimento ainda: as barras aparecem aqui quando um pacote for aprovado ou uma troca for entregue.</li>');
  }

  /* ---- "Seus pacotes". `conferindo` (id → true): o botão "conferir" do aberto ou em análise, com o estado do
   * clique; sem ele (Minha conta), a lista só mostra — o servidor confere sozinho de minuto em minuto ---- */
  function linhaPagamento(p, conferindo) {
    var est = proprio(ESTADO_PAG, p.estado) ? p.estado : 'outro';
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO_PAG[est];
    var emBarras = p.moeda === 'barras';
    if (est === 'aprovado') {
      var pe = p.pedido && p.pedido.estado;
      txt += p.creditado === false ? Tx(' · em conferência') : emBarras ? Tx(' · na sua conta') : pe === 'entregue' ? Tx(' · entregue no jogo')
        : pe === 'cancelado' ? Tx(' · crédito cancelado') : Tx(' · a caminho do jogo');
    }
    var miudo = [p.preco == null ? '' : String(p.preco),
                 emBarras ? (Number(p.barras) > 0 ? nBarras(p.barras) : '') : Number(p.vintens) > 0 ? Tx('{a} vinténs', { a: N(p.vintens) }) : '',
                 Number(p.criadoEm) > 0 ? SITE.quando(p.criadoEm) : ''].filter(Boolean);
    // aberto ou em análise: o "conferir" (a mesma conferência da volta, para quem pagou e fechou a aba)
    var bt = conferindo && (est === 'aberto' || est === 'pendente')
      ? '<button type="button" class="btn btn-mini" data-conferir="' + E(p.id) + '"' + (conferindo[p.id] ? ' disabled' : '') + '>' +
        (conferindo[p.id] ? Tx('conferindo…') : Tx('conferir')) + '</button>' : '';
    return '<li class="pagamento g-' + est + '" data-pagamento="' + E(p.id) + '"><div><b>' + E(p.nome || p.pacote || 'pacote') + '</b>' +
      '<small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita"><span class="estado-pedido">' + E(txt) + '</span>' + bt +
      '</div></li>';
  }
  function pacotes(lista, conferindo) {
    return comId(lista).map(function (p) { return linhaPagamento(p, conferindo); }).join('');
  }

  /* ---- o resumo na linha do título (o <details> fechado): o que espera, ou o último ---- */
  function ultimo(nome, criadoEm) {
    return Number(criadoEm) > 0 ? Tx('último: {a} · {b}', { a: nome, b: SITE.quando(criadoEm) }) : nome;
  }
  function resumoPedidos(lista) {
    var ps = comId(lista);
    if (!ps.length) return Tx('nenhum ainda');
    var andando = ps.filter(function (p) { return p.estado === 'pendente' || p.estado === 'retirado'; }).length;
    return andando ? Tx('{a} em andamento', { a: N(andando) }) : ultimo(String(ps[0].nome || ps[0].sku || ''), ps[0].criadoEm);
  }
  function resumoExtrato(lista) {
    var ms = comId(lista);
    if (!ms.length) return Tx('nenhum ainda');
    var d = Math.floor(Number(ms[0].delta) || 0);
    return ultimo((d > 0 ? '+' : '−') + N(Math.abs(d)), ms[0].criadoEm);
  }
  function resumoPacotes(lista) {
    var ps = comId(lista);
    if (!ps.length) return Tx('nenhum ainda');
    var esperando = ps.filter(function (p) { return p.estado === 'aberto' || p.estado === 'pendente'; }).length;
    if (esperando) return Tx('{a} esperando confirmação', { a: N(esperando) });
    var est = proprio(ESTADO_PAG, ps[0].estado) ? ESTADO_PAG[ps[0].estado] : String(ps[0].estado == null ? '' : ps[0].estado);
    return ultimo(String(ps[0].nome || ps[0].pacote || '') + ' (' + est + ')', ps[0].criadoEm);
  }

  window.HISTORICO = {
    ESTADO: ESTADO, ESPERA: ESPERA, MOTIVO: MOTIVO, ESTADO_PAG: ESTADO_PAG, MOTIVO_BARRAS: MOTIVO_BARRAS,
    iconeBarra: iconeBarra, nBarras: nBarras,
    pedidos: pedidos, extrato: extrato, pacotes: pacotes,
    resumoPedidos: resumoPedidos, resumoExtrato: resumoExtrato, resumoPacotes: resumoPacotes
  };
})();
