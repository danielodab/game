/* loja.js — a loja do site (site/loja.html). Fase C; a loja 2 em 10/09.
 *
 * PÚBLICO: o catálogo de GET /api/loja/catalogo nas seções que o servidor
 * manda, NA ORDEM DELE (Personagens, Bônus de XP, Pedras de forja, Guilda,
 * Pergaminhos), com preço, descrição e limite; e a caixa dos PACOTES DE
 * VINTÉNS (dinheiro de verdade, pelo Mercado Pago), que vêm no mesmo catálogo
 * (`pacotes` e `pagamento.ligado`). NENHUM PREÇO mora no site: todo número de
 * produto e todo preço em reais vêm do servidor (servidor/loja.py, CATALOGO e
 * PACOTES); a página só formata os vinténs (SITE.num), e o preço em reais já
 * vem escrito pelo servidor.
 *
 * COM SESSÃO (GET /api/loja/minha): a caixa do saldo — a carteira do último
 * save que subiu, o que está A CAMINHO (pacotes pagos e presentes do Mestre
 * que o jogo ainda não recebeu, e que já dá para gastar aqui), o reservado nos
 * pedidos abertos e o disponível —, os botões desligados com o motivo e os
 * pedidos com o estado em português. Comprar é um PEDIDO: POST
 * /api/loja/comprar {sku, idem} com uma chave nova a cada clique (SITE.idem), e
 * a página avisa o jogo aberto neste navegador por
 * BroadcastChannel('soterra-loja') {tipo:'comprou'}. O jogo retira, entrega e
 * desconta da carteira quando abrir logado na conta Principal.
 *
 * OS PACOTES DE VINTÉNS (10/09). Com `pagamento.ligado`: "Comprar com Pix ou
 * cartão" → SITE.confirma → POST /api/pagamento/pacote {pacote, idem} (chave
 * nova a cada clique; só a que ficou SEM resposta se repete) → o `endereco`
 * só é seguido se SITE.ehMercadoPago disser que é do Mercado Pago (LOJA.vai,
 * o location.assign num lugar só). Desligado, os pacotes aparecem "em breve"
 * e a página não pede nada de /api/pagamento/*.
 * A VOLTA do Mercado Pago (loja.html?pagamento=ID&volta=…&payment_id=…): a
 * página lê SÓ o número do pagamento, limpa o endereço (history.replaceState;
 * o que o Mercado Pago pendura na URL nunca vai ao servidor) e pede que o
 * servidor CONFIRA (POST /api/pagamento/conferir {id}) — quem credita é ele,
 * depois de consultar o Mercado Pago, nunca a volta do navegador. Enquanto o
 * pagamento está aberto ou em análise, a página CONFERE de novo a cada 10 s,
 * até 6 vezes: o Pix pago depois da volta entra sem depender só do aviso do
 * Mercado Pago. "Seus pacotes" lista o que /meus devolve, com o botão
 * "conferir" no que está aberto ou em análise (a mesma conferência; o
 * servidor deixa 30 por hora).
 *
 * Quem decide é o servidor: os motivos daqui (classe liberada, limite, saldo
 * curto) só poupam um clique, e a recusa dele aparece como veio. Tudo que vem
 * do servidor passa pelo SITE.esc. */
(function () {
  'use strict';
  var E = SITE.esc, N = SITE.num;
  function $(id) { return document.getElementById(id); }
  function proprio(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }

  /* a ida ao Mercado Pago num lugar só: a prova troca por um dublê */
  var LOJA = window.LOJA = { vai: function (url) { location.assign(url); } };

  var catalogo = null, erroCatalogo = '';
  var minha = null, erroMinha = '';
  var estadoMinha = SITE.sessao() ? 'carregando' : 'fora';     // fora | carregando | ok | erro
  var pagamentos = null;    // a última resposta boa de GET /api/pagamento/meus
  var ocupado = false;
  var semResposta = null;   // {tipo:'sku'|'pacote', id, idem}: o próximo clique nele reusa a chave
  var lidaEm = 0;           // quando /minha foi pedida (ms): a volta à aba não repete à toa
  var DIA = 86400;          // o pedido preso: retirado há mais de um dia pode ser cancelado
  var ESPERA_CONFERIR = 10 * 1000;   // ms entre as conferências depois da volta do Mercado Pago
  var VOLTAS_CONFERIR = 6;
  var conferindo = {};      // id do pagamento → true enquanto o "conferir" dele está a caminho
  var volta = null;         // a volta do Mercado Pago: {id, estado, pag, erro, lidas}

  /* as seções que a página conhece (o título e a frase de apoio); a ORDEM é a
   * do catálogo do servidor, e uma seção nova dele entra com o próprio id */
  var SECOES = {
    personagens: { titulo: 'Personagens', sub: 'Libera a classe no jogo, e o herói chega no nível 1. As cartas que você já tem entram no desbloqueio, mas o preço é o mesmo: se faltam poucas, talvez valha esperar a queda.' },
    bonus: { titulo: 'Bônus de XP', sub: 'Não soma com outro bônus de XP; comprar de novo soma os dias. O prazo corre a partir da entrega no jogo.' },
    pedras: { titulo: 'Pedras de forja', sub: 'Pacotes de pedras para a Forja do Acampamento. A Âncora de Forja não está à venda: ela se conquista lá embaixo.' },
    guilda: { titulo: 'Guilda', sub: 'Dez Insígnias fundam uma guilda.' },
    pergaminhos: { titulo: 'Pergaminhos', sub: 'Chegam guardados no jogo; você lê quando quiser.' }
  };
  var ESTADO = { pendente: 'esperando o jogo abrir', retirado: 'a caminho do jogo', entregue: 'entregue',
                 estornado: 'devolvido', cancelado: 'cancelado' };
  var MOTIVO = { 'sem-saldo': 'vinténs insuficientes no jogo', 'classe-ja-liberada': 'a classe já estava liberada no jogo',
                 'item-invalido': 'o jogo não reconheceu o produto', 'erro-local': 'o jogo falhou ao entregar',
                 'recusado': 'o jogo recusou o pedido' };
  var ESTADO_PAG = { aberto: 'esperando o pagamento', pendente: 'em análise', aprovado: 'aprovado',
                     recusado: 'não aprovado', estornado: 'estornado', falhou: 'não abriu' };
  var RARIDADE = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário' };
  var ELEMENTOS = ['fogo', 'agua', 'terra', 'ar', 'neutro'];

  function aviso(texto, tipo) {
    var el = $('lj-aviso');
    el.className = 'aviso flutua' + (texto ? ' ' + (tipo || 'erro') : '');
    el.textContent = texto || '';
  }
  function sessaoVencida() {
    SITE.esquece();
    SITE.cabecalho();
    minha = null;
    pagamentos = null;
    estadoMinha = 'fora';
    if (volta && volta.estado !== 'ok') volta.estado = 'fora';
    aviso('A sessão desta página tinha vencido. Entre de novo para comprar.', 'neutro');
    desenha();
  }
  function semSave() {
    var s = (minha && minha.saldo) || {};
    return !s.semFundo && !(Number(s.saveVersao) > 0);
  }
  function aCaminhoNoSaldo() { return Number(((minha && minha.saldo) || {}).aCaminho) || 0; }
  function pagamentoLigado() { return !!(catalogo && catalogo.pagamento && catalogo.pagamento.ligado === true); }

  /* ---- o que vem do servidor ---- */
  function carregaCatalogo() {
    return SITE.api('/api/loja/catalogo', { semToken: true }).then(function (r) {
      if (r.ok && Array.isArray(r.itens)) { catalogo = r; erroCatalogo = ''; }
      else {
        catalogo = null;
        erroCatalogo = r.status === 0 ? 'O servidor está fora — a loja volta com ele.'
          : r.status === 404 ? 'A loja ainda não chegou a este servidor.'
          : SITE.erro(r, 'não deu para ler o catálogo');
      }
      desenha();
    });
  }
  function carregaMinha() {
    if (!SITE.sessao()) { minha = null; estadoMinha = 'fora'; desenha(); return Promise.resolve(); }
    if (!minha) estadoMinha = 'carregando';
    lidaEm = Date.now();
    return SITE.api('/api/loja/minha').then(function (r) {
      if (r.status === 401) { sessaoVencida(); return; }
      if (r.ok) { minha = r; estadoMinha = 'ok'; erroMinha = ''; }
      else if (!minha) {
        estadoMinha = 'erro';
        erroMinha = r.status === 0 ? 'O servidor está fora — o seu saldo volta com ele.' : SITE.erro(r, 'não deu para ler o seu saldo');
      } else aviso(SITE.erro(r, 'não deu para atualizar o saldo'));
      desenha();
    });
  }
  /* "Seus pacotes": só com sessão e com os pagamentos ligados */
  function carregaPagamentos() {
    if (!SITE.sessao() || !pagamentoLigado()) return Promise.resolve();
    return SITE.api('/api/pagamento/meus').then(function (r) {
      if (r.status === 401) { sessaoVencida(); return; }
      if (r.ok && Array.isArray(r.pagamentos)) pagamentos = r;
      desenhaPagamentos();
    });
  }

  /* ---- o desenho ---- */
  function desenha() { desenhaVolta(); desenhaSaldo(); desenhaPacotes(); desenhaCatalogo(); desenhaPedidos(); desenhaPagamentos(); }

  function desenhaSaldo() {
    var caixa = $('lj-saldo');
    if (estadoMinha === 'fora') {
      caixa.innerHTML = '<div class="saldo-fora"><p><b>Entre para comprar.</b> A loja usa os vinténs da carteira do seu jogo, ' +
        'na conta do site.</p><a class="btn btn-ouro" href="conta.html#entrar">Entrar</a>' +
        '<a class="btn" href="conta.html#criar">Criar conta</a></div>';
      return;
    }
    if (estadoMinha === 'carregando') { caixa.innerHTML = '<div class="estado">carregando o seu saldo…</div>'; return; }
    if (estadoMinha === 'erro') { caixa.innerHTML = '<div class="estado fora">' + E(erroMinha) + '</div>'; return; }
    var s = minha.saldo || {};
    var temCaminho = proprio(s, 'aCaminho');     // um servidor de antes da loja 2 não manda o campo
    var caminho = aCaminhoNoSaldo();
    var quando = !semSave() ? 'Do último save que subiu' + (Number(s.saveEm) > 0 ? ', ' + SITE.ha(s.saveEm) : '') + '.'
      : caminho > 0 ? 'O servidor ainda não viu a carteira do seu jogo: por enquanto, só os vinténs a caminho contam. ' +
                      'Abra o jogo logado nesta conta (na conta Principal).'
      : 'O servidor ainda não viu seus vinténs: abra o jogo logado nesta conta (na conta Principal).';
    caixa.innerHTML = '<h3>Seu saldo <small>em vinténs</small></h3>' +
      (s.semFundo ? '<p class="selo-mestre">◆ Mestre: compra sem gastar</p>' : '') +
      '<div class="saldo-numeros' + (temCaminho ? ' quatro' : '') + '">' +
        '<div><span>Carteira do jogo</span><b data-saldo="carteira">' + N(s.carteira) + '</b></div>' +
        (temCaminho ? '<div class="a-caminho"><span>A caminho</span><b data-saldo="aCaminho">' + N(caminho) + '</b></div>' : '') +
        '<div><span>Reservado</span><b data-saldo="reservado">' + N(s.reservado) + '</b></div>' +
        '<div class="disponivel"><span>Disponível</span><b data-saldo="disponivel">' + N(s.disponivel) + '</b></div>' +
      '</div>' +
      '<p class="saldo-quando apoio">' + E(quando) + '</p>' +
      '<ul><li>Só os vinténs do bolso contam; se estão no cofre, saque no jogo.</li>' +
      (temCaminho ? '<li class="nota-caminho">A caminho: pacotes pagos e presentes que o jogo ainda não recebeu. Eles já contam no disponível daqui.</li>' : '') +
      '<li>O reservado é o que está nos pedidos a caminho: sai da carteira quando o jogo recebe.</li>' +
      '<li>A entrega acontece quando o jogo abrir logado na conta Principal.</li></ul>';
  }

  /* ---- os pacotes de vinténs ---- */
  function pacoteBom(p) { return !!p && typeof p.id === 'string' && !!p.id && Number(p.vintens) > 0; }
  function listaPacotes() { return catalogo && Array.isArray(catalogo.pacotes) ? catalogo.pacotes.filter(pacoteBom) : []; }
  function desenhaPacotes() {
    var caixa = $('lj-pacotes');
    var ps = listaPacotes();
    caixa.hidden = !ps.length;
    if (!ps.length) { caixa.innerHTML = ''; return; }
    var ligado = pagamentoLigado();
    var teste = ligado && catalogo.pagamento.teste === true;
    caixa.innerHTML = '<div class="pacotes-cab"><h3>Pacotes de vinténs</h3>' +
      (!ligado ? '<span class="etiqueta embreve" data-em-breve>em breve</span>'
        : teste ? '<span class="etiqueta modo-teste">modo de teste</span>' : '') + '</div>' +
      '<p class="apoio">' + (ligado
        ? 'Pix ou cartão, pelo Mercado Pago. Aprovado o pagamento, os vinténs entram na sua conta na hora (já dá para gastar aqui) e o jogo os recebe na próxima abertura.'
        : 'Pix ou cartão, pelo Mercado Pago: chegam em breve. Por enquanto, os vinténs vêm das descidas.') + '</p>' +
      '<div class="pacotes">' + ps.map(cartaoPacote).join('') + '</div>';
  }
  function cartaoPacote(p) {
    var bt;
    if (!pagamentoLigado()) bt = '<button type="button" class="btn trancado" disabled>em breve</button>';
    else if (estadoMinha === 'fora') bt = '<a class="btn btn-borda" href="conta.html#entrar">Entre para comprar</a>';
    else if (estadoMinha !== 'ok') bt = '<button type="button" class="btn trancado" disabled>Comprar com Pix ou cartão</button>';
    else bt = '<button type="button" class="btn btn-ouro" data-pacote="' + E(p.id) + '"' + (ocupado ? ' disabled' : '') + '>Comprar com Pix ou cartão</button>';
    return '<article class="pacote" data-pacote-id="' + E(p.id) + '">' +
      '<div class="pacote-arte" aria-hidden="true"><span class="moeda"></span><span class="moeda"></span><span class="moeda"></span></div>' +
      '<div class="corpo"><h4>' + E(p.nome || p.id) + '</h4>' +
      '<p class="pacote-vintens"><b>' + N(p.vintens) + '</b> vinténs</p>' +
      '<div class="produto-pe"><span class="preco preco-reais">' + E(p.preco == null ? '' : p.preco) + '</span>' + bt + '</div>' +
      '</div></article>';
  }

  /* ---- a faixa da volta do Mercado Pago ---- */
  function textoVolta(v) {
    if (v.estado === 'fora') return { tipo: 'neutro', texto: 'Entre na sua conta para acompanhar o pagamento: ele aparece em "Seus pacotes".' };
    if (v.estado === 'esperando' || v.estado === 'conferindo') return { tipo: 'neutro', texto: 'Conferindo o pagamento com o Mercado Pago…' };
    if (v.estado === 'desligado') {
      return { tipo: 'neutro', texto: 'Os pacotes de vinténs estão desligados agora; o pagamento continua registrado no servidor.' };
    }
    if (v.estado === 'erro') {
      return { tipo: 'erro', texto: v.erro + '. O pagamento aparece em "Seus pacotes" quando o Mercado Pago confirmar.' };
    }
    var p = v.pag || {};
    if (p.estado === 'aprovado') {
      if (p.creditado === false || !(Number(p.vintens) > 0)) {
        return { tipo: 'neutro', texto: 'Pagamento aprovado e em conferência: os vinténs entram quando o dono do jogo liberar.' };
      }
      var entregue = p.pedido && p.pedido.estado === 'entregue';
      return { tipo: 'certo', texto: 'Pagamento aprovado: ' + N(p.vintens) + ' vinténs ' + (entregue ? 'já entregues no jogo.' : 'a caminho do jogo.') };
    }
    if (p.estado === 'pendente') return { tipo: 'neutro', texto: 'Pagamento em análise (Pix aparece em instantes).' };
    if (p.estado === 'aberto') {
      return { tipo: 'neutro', texto: v.lidas >= VOLTAS_CONFERIR
        ? 'O Mercado Pago ainda não mostrou o pagamento. Se você pagou, ele aparece em "Seus pacotes" em alguns minutos.'
        : 'Esperando o Mercado Pago confirmar o pagamento (Pix aparece em instantes).' };
    }
    if (p.estado === 'recusado') return { tipo: 'erro', texto: 'O pagamento não foi aprovado; nada foi cobrado.' };
    if (p.estado === 'estornado') return { tipo: 'erro', texto: 'Esse pagamento foi estornado: os vinténs dele não entram.' };
    if (p.estado === 'falhou') return { tipo: 'erro', texto: 'O pagamento não chegou a abrir; nada foi cobrado.' };
    return { tipo: 'neutro', texto: 'Pagamento registrado: o estado dele aparece em "Seus pacotes".' };
  }
  function desenhaVolta() {
    var el = $('lj-volta');
    if (!volta) { el.hidden = true; return; }
    var t = textoVolta(volta);
    el.hidden = false;
    el.className = 'volta-pagamento ' + t.tipo;
    el.setAttribute('data-volta', volta.estado === 'ok' && volta.pag ? String(volta.pag.estado) : volta.estado);
    el.textContent = t.texto;
  }
  /* O endereço da volta: SÓ o número do pagamento interessa. Todo o resto (o
   * que o Mercado Pago pendura: payment_id, status, preference_id…) sai da
   * barra de endereço sem ir a lugar nenhum; o ?api= de casa fica. */
  function leVolta() {
    var q = location.search || '';
    if (!/[?&](pagamento|volta)=/.test(q)) return null;
    var m = /[?&]pagamento=(\d{1,15})(?=&|$)/.exec(q);
    var fica = q.replace(/^\?/, '').split('&').filter(function (par) { return /^api=/.test(par); });
    try {
      history.replaceState(null, '', location.href.split('#')[0].split('?')[0] +
        (fica.length ? '?' + fica.join('&') : '') + (location.hash || ''));
    } catch (e) { /* o endereço fica como está; nada dele vai ao servidor */ }
    return m ? { id: Number(m[1]), estado: 'esperando', pag: null, erro: '', lidas: 0 } : null;
  }
  function poeNaLista(p) {
    if (!pagamentos) pagamentos = { ok: true, ligado: true, pagamentos: [] };
    pagamentos.pagamentos = [p].concat(pagamentos.pagamentos.filter(function (x) { return !x || Number(x.id) !== Number(p.id); }));
  }
  /* A conferência vem ANTES da lista de "Seus pacotes": a lista chega depois
   * dela, com o pagamento conferido por cima (a resposta mais nova). */
  function iniciaVolta() {
    if (!volta || volta.estado !== 'esperando') return carregaPagamentos();
    if (!SITE.sessao()) { volta.estado = 'fora'; desenhaVolta(); return; }
    if (!catalogo) { volta.estado = 'erro'; volta.erro = erroCatalogo.replace(/\.$/, '') || 'O servidor está fora'; desenhaVolta(); return; }
    if (!pagamentoLigado()) { volta.estado = 'desligado'; desenhaVolta(); return; }
    volta.estado = 'conferindo';
    desenhaVolta();
    return SITE.api('/api/pagamento/conferir', { method: 'POST', body: { id: volta.id } }).then(function (r) {
      if (r.status === 401) { sessaoVencida(); return; }
      if (r.ok && r.pagamento && typeof r.pagamento === 'object') {
        volta.estado = 'ok';
        volta.pag = r.pagamento;
      } else {
        volta.estado = 'erro';
        volta.erro = r.status === 0 ? 'O servidor não respondeu' : SITE.erro(r, 'não deu para conferir o pagamento');
      }
      desenhaVolta();
      return carregaPagamentos().then(function () {
        if (volta.pag) { poeNaLista(volta.pag); desenhaPagamentos(); }
        segueVolta();
      });
    });
  }
  /* aprovado: o saldo andou (o crédito já conta no disponível) e o jogo aberto
   * neste navegador pode ir buscar; aberto, em análise ou sem resposta: CONFERE
   * de novo daqui a pouco (conserto 11/09: a mesma consulta ao Mercado Pago da
   * volta, e não só a releitura de /meus — o Pix pago DEPOIS de voltar entra
   * mesmo sem o aviso), até VOLTAS_CONFERIR vezes. O freio do servidor (429)
   * ou os pagamentos desligados (503) param a insistência. */
  function segueVolta() {
    var e = volta.pag && volta.pag.estado;
    if (e === 'aprovado') { avisaJogo(); carregaMinha(); return; }
    if (volta.estado !== 'erro' && e !== 'aberto' && e !== 'pendente') return;
    if (volta.lidas >= VOLTAS_CONFERIR) { desenhaVolta(); return; }
    setTimeout(function () {
      volta.lidas++;
      SITE.api('/api/pagamento/conferir', { method: 'POST', body: { id: volta.id } }).then(function (r) {
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.ok && r.pagamento && typeof r.pagamento === 'object') {
          volta.pag = r.pagamento;
          volta.estado = 'ok';
          poeNaLista(r.pagamento);
        } else if (r.status === 429 || r.status === 503) {
          volta.lidas = VOLTAS_CONFERIR;
        }
        desenhaVolta();
        desenhaPagamentos();
        segueVolta();
      });
    }, ESPERA_CONFERIR);
  }

  /* ---- o catálogo ---- */
  function secaoDe(it) { return String(it.secao == null ? 'outros' : it.secao); }
  function desenhaCatalogo() {
    var caixa = $('lj-catalogo');
    if (!catalogo) {
      caixa.innerHTML = '<div class="estado' + (erroCatalogo ? ' fora' : '') + '">' + E(erroCatalogo || 'carregando o catálogo…') + '</div>';
      return;
    }
    var itens = catalogo.itens.filter(function (it) {
      return it && typeof it.sku === 'string' && it.sku && isFinite(Number(it.preco)) && Number(it.preco) >= 0;
    });
    // as seções na ordem em que aparecem no catálogo do servidor
    var ordem = [], vistas = {};
    itens.forEach(function (it) {
      var id = secaoDe(it);
      if (!proprio(vistas, id)) { vistas[id] = true; ordem.push(id); }
    });
    var html = ordem.map(function (id) {
      var s = proprio(SECOES, id) ? SECOES[id]
        : { titulo: id === 'outros' ? 'Outros' : id.charAt(0).toUpperCase() + id.slice(1), sub: '' };
      var dela = itens.filter(function (it) { return secaoDe(it) === id; });
      return '<section class="loja-secao" data-secao="' + E(id) + '"><h3>' + E(s.titulo) + '</h3>' +
        (s.sub ? '<p class="sub">' + E(s.sub) + '</p>' : '') +
        '<div class="catalogo">' + dela.map(function (it) { return cartao(it, itens); }).join('') + '</div></section>';
    }).join('');
    caixa.innerHTML = html || '<div class="estado">A loja está vazia por enquanto.</div>';
  }

  function corClasse(id) {
    var C = (window.JOGO && JOGO.DATA && JOGO.DATA.classes) || {};
    return (proprio(C, id) && C[id].palette && C[id].palette.primary) || '';
  }
  function arte(it) {
    if (it.tipo === 'classe') {
      var src = SITE.img('classe', it.alvo);
      var rar = proprio(RARIDADE, it.raridade) ? it.raridade : '';
      return '<div class="foto retrato' + (src ? '' : ' sem-foto') + '" data-letra="' + E(SITE.inicial(it.nome)) + '"' +
        SITE.estiloCores(corClasse(it.alvo)) + '>' +
        (rar ? '<span class="etiqueta selo-raridade r-' + rar + '">' + RARIDADE[rar] + '</span>' : '') +
        (src ? '<img src="' + E(src) + '" alt="' + E(it.nome) + '" loading="lazy" onerror="SITE.semFoto(this)">' : '') +
        '</div>';
    }
    if (it.tipo === 'pedras') {
      var el = ELEMENTOS.indexOf(it.elemento) >= 0 ? it.elemento : 'neutro';
      return '<div class="arte-produto el-' + el + '"><span class="pedra"></span>' +
        (Number(it.qtd) > 1 ? '<span class="qtd">×' + N(it.qtd) + '</span>' : '') + '</div>';
    }
    if (it.tipo === 'bonus-xp') {
      var d = Math.floor(Number(it.dias != null ? it.dias : it.qtd)) || 0;
      return '<div class="arte-produto arte-bonus"><span class="glifo">✦</span>' +
        (d > 0 ? '<span class="qtd">' + N(d) + (d === 1 ? ' dia' : ' dias') + '</span>' : '') + '</div>';
    }
    if (it.tipo === 'insignias') {
      return '<div class="arte-produto arte-insignia"><span class="glifo">⚜</span>' +
        (Number(it.qtd) > 1 ? '<span class="qtd">×' + N(it.qtd) + '</span>' : '') + '</div>';
    }
    if (it.tipo === 'pergaminho') {
      return '<div class="arte-produto arte-pergaminho"><span class="glifo">' + (it.alvo === 'elemento' ? '⟲' : '✦') + '</span></div>';
    }
    return '<div class="arte-produto"><span class="glifo">◆</span></div>';
  }

  /* O limite em palavras: "1 a cada 30 dias", "Compra única". Os números são
   * os do servidor; `limite: null` (o preço é o freio) não diz nada. */
  function textoLimite(it, itens) {
    var l = it.limite;
    if (!l || !(Number(l.max) > 0)) return '';
    var max = Number(l.max), t;
    if (l.dias == null) t = max === 1 ? 'Compra única' : 'No máximo ' + N(max) + ' por conta';
    else {
      t = (max === 1 ? '1 a cada ' : 'Até ' + N(max) + ' a cada ') + N(l.dias) + (Number(l.dias) === 1 ? ' dia' : ' dias');
      var grupo = itens.filter(function (x) { return x.limite && x.limite.grupo === l.grupo; });
      if (grupo.length > 1) {
        t += grupo.every(function (x) { return secaoDe(x) === secaoDe(it); })
          ? ', somando os ' + grupo.length + ' desta seção' : ', somando ' + grupo.length + ' produtos';
      }
      if (estadoMinha === 'ok' && !(minha.saldo || {}).semFundo && proprio(minha.limites, l.grupo)) {
        var u = Number(minha.limites[l.grupo].usados) || 0;
        if (u > 0) t += ' (você usou ' + N(u) + ')';
      }
    }
    return t + '.';
  }

  function pedidoACaminho(sku) {
    var ps = Array.isArray(minha.pedidos) ? minha.pedidos : [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p && p.sku === sku && (p.estado === 'pendente' || p.estado === 'retirado')) return p;
    }
    return null;
  }
  /* por que o botão está desligado (null = pode comprar) */
  function trancado(it) {
    var s = minha.saldo || {};
    var semVer = semSave();
    // sem save, só o crédito a caminho sustenta uma compra
    if (semVer && !(aCaminhoNoSaldo() > 0)) {
      return { chave: 'sem-save', texto: 'Abra o jogo logado nesta conta primeiro: o servidor ainda não viu seus vinténs.' };
    }
    if (semVer && it.tipo === 'pergaminho' && it.alvo === 'elemento') {
      return { chave: 'sem-save', texto: 'A Reescrita precisa de um herói com caminho elemental: abra o jogo logado nesta conta primeiro.' };
    }
    if (it.tipo === 'classe') {
      var c = proprio(minha.classes, it.alvo) ? minha.classes[it.alvo] : null;
      if (c && c.liberada) return { chave: 'classe-liberada', texto: 'Essa classe já está liberada no seu jogo.' };
      var ped = pedidoACaminho(it.sku);
      if (ped) {
        return { chave: 'classe-a-caminho', texto: ped.origem === 'presente' ? 'Essa classe está chegando como presente do Mestre.'
                                                                              : 'Já há um pedido dessa classe a caminho.' };
      }
    }
    if (s.semFundo) return null;          // o Mestre pula o saldo e os limites, como no servidor
    var lim = it.limite && proprio(minha.limites, it.limite.grupo) ? minha.limites[it.limite.grupo] : null;
    if (lim && Number(lim.usados) >= Number(lim.max)) {
      if (lim.dias == null) {
        return { chave: 'limite', texto: it.tipo === 'classe' ? 'Essa classe já foi comprada.' : 'Esse produto só pode ser comprado uma vez.' };
      }
      return { chave: 'limite', texto: 'Limite atingido: ' + (Number(lim.liberaEm) > 0 ? SITE.deNovo(lim.liberaEm) : 'espere a janela passar') + '.' };
    }
    var falta = Number(it.preco) - Number(s.disponivel);
    if (falta > 0) return { chave: 'saldo', texto: 'Faltam ' + N(falta) + ' vinténs no disponível.' };
    return null;
  }

  function cartao(it, itens) {
    var logado = estadoMinha === 'ok';
    var motivo = logado ? trancado(it) : null;
    var extra = '';
    if (it.tipo === 'classe' && Number(it.cartas) > 0) {
      var c = logado && proprio(minha.classes, it.alvo) ? minha.classes[it.alvo] : null;
      extra += '<p class="cartas">' + (c && !c.liberada
        ? 'Você tem ' + N(c.cartas) + ' de ' + N(it.cartas) + ' cartas.'
        : 'Libera com ' + N(it.cartas) + ' cartas.') + '</p>';
    }
    var lim = textoLimite(it, itens);
    if (lim) extra += '<p class="limite">' + E(lim) + '</p>';
    var bt;
    if (estadoMinha === 'fora') bt = '<a class="btn btn-borda" href="conta.html#entrar">Entre para comprar</a>';
    else if (!logado) bt = '<button type="button" class="btn trancado" disabled>Comprar</button>';
    else {
      bt = '<button type="button" class="btn btn-ouro' + (motivo ? ' trancado' : '') + '" data-comprar="' + E(it.sku) + '"' +
        (motivo || ocupado ? ' disabled' : '') + '>Comprar</button>';
    }
    return '<article class="produto t-' + E(it.tipo) + '" data-sku="' + E(it.sku) + '">' + arte(it) +
      '<div class="corpo"><h4>' + E(it.nome) + '</h4>' + (it.descricao ? '<p>' + E(it.descricao) + '</p>' : '') + extra +
      '<div class="produto-pe"><span class="preco">' + N(it.preco) + ' <small>vinténs</small></span>' + bt + '</div>' +
      (motivo ? '<p class="motivo" data-motivo="' + E(motivo.chave) + '">' + E(motivo.texto) + '</p>' : '') +
      '</div></article>';
  }

  /* ---- os pedidos e os pacotes pagos ---- */
  function desenhaPedidos() {
    var caixa = $('lj-pedidos-caixa');
    caixa.hidden = estadoMinha !== 'ok';
    if (caixa.hidden) return;
    var ps = (Array.isArray(minha.pedidos) ? minha.pedidos : []).filter(function (p) { return p && p.id != null; });
    $('lj-pedidos').innerHTML = ps.length ? ps.map(linhaPedido).join('') : '<li class="apoio">Nenhum pedido ainda.</li>';
  }
  function linhaPedido(p) {
    var est = proprio(ESTADO, p.estado) ? p.estado : 'outro';
    var pago = p.origem === 'pagamento', presente = p.origem === 'presente';
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO[est];
    if (est === 'estornado') {
      // o crédito de um pacote que o jogo recusou não se perde: o servidor manda de novo
      txt = pago ? 'não entrou no jogo: o servidor manda de novo'
                 : txt + ': ' + (proprio(MOTIVO, p.motivo) ? MOTIVO[p.motivo] : MOTIVO.recusado);
    }
    if (est === 'cancelado' && pago) txt = 'cancelado (o pagamento foi estornado)';
    // o pedido "preso": retirado há mais de um dia (o servidor confere de novo)
    var desde = Number(p.retiradoEm) || Number(p.criadoEm) || 0;
    var preso = est === 'retirado' && desde > 0 && SITE.agora() - desde > DIA;
    // crédito de pacote e presente do Mestre não se cancelam por aqui
    var pode = !pago && !presente && p.cancelavel !== false && (est === 'pendente' || preso);
    var custo = pago ? 'pacote pago' : presente ? 'presente do Mestre'
      : Number(p.preco) === 0 ? 'sem custo (Mestre)' : N(p.preco) + ' vinténs';
    var miudo = [custo,
                 Number(p.criadoEm) > 0 ? (pago ? 'aprovado ' : presente ? 'dado ' : 'pedido ') + SITE.quando(p.criadoEm) : '',
                 est === 'retirado' && !preso && !pago && !presente ? 'se não chegar em 24 h, dá para cancelar' : ''].filter(Boolean);
    return '<li class="pedido e-' + est + (pago ? ' o-pagamento' : presente ? ' o-presente' : '') + '" data-pedido="' + E(p.id) + '">' +
      '<div><b>' + E(p.nome || p.sku) + '</b><small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita">' +
      '<span class="estado-pedido">' + E(txt) + '</span>' +
      (pode ? '<button type="button" class="btn btn-mini" data-cancelar="' + E(p.id) + '">cancelar</button>' : '') +
      '</div></li>';
  }
  function desenhaPagamentos() {
    var caixa = $('lj-pagamentos-caixa');
    var lista = estadoMinha === 'ok' && pagamentos && Array.isArray(pagamentos.pagamentos)
      ? pagamentos.pagamentos.filter(function (p) { return p && p.id != null; }) : [];
    caixa.hidden = !lista.length;
    $('lj-pagamentos').innerHTML = lista.map(linhaPagamento).join('');
  }
  function linhaPagamento(p) {
    var est = proprio(ESTADO_PAG, p.estado) ? p.estado : 'outro';
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO_PAG[est];
    if (est === 'aprovado') {
      var pe = p.pedido && p.pedido.estado;
      txt += p.creditado === false ? ' · em conferência' : pe === 'entregue' ? ' · entregue no jogo'
        : pe === 'cancelado' ? ' · crédito cancelado' : ' · a caminho do jogo';
    }
    var miudo = [p.preco == null ? '' : String(p.preco), Number(p.vintens) > 0 ? N(p.vintens) + ' vinténs' : '',
                 Number(p.criadoEm) > 0 ? SITE.quando(p.criadoEm) : ''].filter(Boolean);
    // aberto ou em análise: o "conferir" (a mesma conferência da volta, para quem pagou e fechou a aba)
    var bt = (est === 'aberto' || est === 'pendente')
      ? '<button type="button" class="btn btn-mini" data-conferir="' + E(p.id) + '"' + (conferindo[p.id] ? ' disabled' : '') + '>' +
        (conferindo[p.id] ? 'conferindo…' : 'conferir') + '</button>' : '';
    return '<li class="pagamento g-' + est + '" data-pagamento="' + E(p.id) + '"><div><b>' + E(p.nome || p.pacote || 'pacote') + '</b>' +
      '<small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita"><span class="estado-pedido">' + E(txt) + '</span>' + bt +
      '</div></li>';
  }
  /* O botão "conferir" de "Seus pacotes" (conserto 11/09): o jogador que pagou
   * o Pix no app do banco e fechou a aba não volta pelo endereço do Mercado
   * Pago, e a lista sozinha não consulta ninguém. O servidor só CONSULTA o
   * Mercado Pago e processa o que ele disser: nunca credita pelo clique. */
  function confere(id) {
    if (!(id > 0) || conferindo[id]) return;
    conferindo[id] = true;
    desenhaPagamentos();
    SITE.api('/api/pagamento/conferir', { method: 'POST', body: { id: id } }).then(function (r) {
      delete conferindo[id];
      if (r.status === 401) { sessaoVencida(); return; }
      if (r.ok && r.pagamento && typeof r.pagamento === 'object') {
        poeNaLista(r.pagamento);
        if (volta && Number(volta.id) === id) { volta.pag = r.pagamento; volta.estado = 'ok'; desenhaVolta(); }
        var e = r.pagamento.estado;
        if (e === 'aprovado') aviso('Pagamento aprovado: os vinténs estão a caminho do jogo.', 'certo');
        else if (e === 'pendente') aviso('O Mercado Pago ainda está analisando esse pagamento.', 'neutro');
        else if (e === 'aberto') aviso('O Mercado Pago ainda não mostrou esse pagamento. Se você pagou, confira de novo em alguns minutos.', 'neutro');
        else aviso('Pagamento conferido: ' + (proprio(ESTADO_PAG, e) ? ESTADO_PAG[e] : String(e)) + '.', 'neutro');
        if (e === 'aprovado') { avisaJogo(); carregaMinha(); }
      } else {
        aviso(r.status === 0 ? 'O servidor não respondeu; tente de novo.' : SITE.erro(r, 'não deu para conferir o pagamento'));
      }
      desenhaPagamentos();
    });
  }

  /* ---- comprar, cancelar e os pacotes ---- */
  function acha(sku) {
    var its = (catalogo && catalogo.itens) || [];
    for (var i = 0; i < its.length; i++) if (its[i] && its[i].sku === sku) return its[i];
    return null;
  }
  function achaPacote(id) {
    var ps = listaPacotes();
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }
  function avisaJogo() {
    try {
      var bc = new BroadcastChannel('soterra-loja');
      bc.postMessage({ tipo: 'comprou' });
      setTimeout(function () { try { bc.close(); } catch (e) { /* já fechado */ } }, 1000);
    } catch (e) { /* sem BroadcastChannel: o jogo busca sozinho, ao voltar à aba e de tempos em tempos */ }
  }
  /* uma chave nova a cada clique; só o clique que ficou SEM resposta repete a
   * dele, e o servidor devolve o mesmo pedido em vez de fazer outro */
  function chave(tipo, id) {
    var idem = semResposta && semResposta.tipo === tipo && semResposta.id === id ? semResposta.idem : SITE.idem();
    semResposta = null;
    return idem;
  }
  function ocupa(sim) { ocupado = sim; desenhaPacotes(); desenhaCatalogo(); }

  function compra(sku) {
    var it = acha(sku);
    if (!it || ocupado || estadoMinha !== 'ok') return;
    var mestre = !!(minha.saldo || {}).semFundo;
    SITE.confirma({
      titulo: 'Confirmar a compra',
      texto: 'Comprar ' + it.nome + ' por ' + N(it.preco) + ' vinténs?',
      nota: mestre ? 'Conta do Mestre: o pedido não gasta vinténs nem conta nos limites.'
        : 'Os vinténs saem da carteira do jogo quando ele receber o pedido. Depois de entregue, não há devolução.' +
          (it.tipo === 'bonus-xp' ? ' O prazo do bônus corre a partir da entrega no jogo.' : ''),
      sim: 'Comprar', nao: 'Voltar'
    }).then(function (sim) {
      if (!sim || ocupado) return;
      var idem = chave('sku', it.sku);
      ocupa(true);
      aviso('Fazendo o pedido…', 'neutro');
      return SITE.api('/api/loja/comprar', { method: 'POST', body: { sku: it.sku, idem: idem } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.status === 0) {
          semResposta = { tipo: 'sku', id: it.sku, idem: idem };
          aviso('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o pedido não sai dobrado.');
          desenha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, 'não deu para fazer o pedido')); desenha(); return carregaMinha(); }
        avisaJogo();
        aviso('Pedido feito: ' + it.nome + '. Ele chega quando o jogo abrir logado na conta Principal.', 'certo');
        if (r.pedido && minha) {
          minha.pedidos = [r.pedido].concat((minha.pedidos || []).filter(function (p) { return p && p.id !== r.pedido.id; }));
          if (r.saldo && typeof r.saldo === 'object') {
            minha.saldo = minha.saldo || {};
            Object.keys(r.saldo).forEach(function (k) { minha.saldo[k] = r.saldo[k]; });
          }
        }
        desenha();
        return carregaMinha();
      });
    });
  }

  function compraPacote(id) {
    var pc = achaPacote(id);
    if (!pc || ocupado || estadoMinha !== 'ok' || !pagamentoLigado()) return;
    SITE.confirma({
      titulo: 'Comprar vinténs',
      texto: 'Comprar ' + (pc.nome || pc.id) + ' por ' + String(pc.preco == null ? '' : pc.preco) + '?',
      nota: 'Você vai para a página do Mercado Pago. Os vinténs chegam à sua conta quando o pagamento for aprovado, ' +
            'e o jogo os recebe na próxima abertura.',
      sim: 'Ir para o pagamento', nao: 'Voltar'
    }).then(function (sim) {
      if (!sim || ocupado) return;
      var idem = chave('pacote', pc.id);
      ocupa(true);
      aviso('Preparando o pagamento…', 'neutro');
      return SITE.api('/api/pagamento/pacote', { method: 'POST', body: { pacote: pc.id, idem: idem } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.status === 0) {
          semResposta = { tipo: 'pacote', id: pc.id, idem: idem };
          aviso('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o pagamento não sai dobrado.');
          desenha();
          return;
        }
        if (r.status === 503 && r.pagamento === false) {
          catalogo.pagamento = { ligado: false };
          aviso('Os pacotes de vinténs chegam em breve: nada foi cobrado.', 'neutro');
          desenha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, 'não deu para preparar o pagamento')); desenha(); return; }
        var ok = typeof SITE.ehMercadoPago === 'function' && SITE.ehMercadoPago(r.endereco);
        if (!ok) {
          aviso('Endereço de pagamento estranho; nada foi cobrado. A página não vai até ele: avise o dono do jogo.');
          desenha();
          return;
        }
        aviso('Indo para o Mercado Pago…', 'neutro');
        desenha();
        LOJA.vai(r.endereco);
      });
    });
  }

  function cancela(id) {
    var p = (minha && Array.isArray(minha.pedidos) ? minha.pedidos : []).filter(function (x) { return x && Number(x.id) === id; })[0];
    if (!p || ocupado) return;
    SITE.confirma({
      titulo: 'Cancelar o pedido?',
      texto: 'Cancelar o pedido de ' + (p.nome || p.sku) + '?',
      nota: Number(p.preco) > 0 ? 'A reserva de ' + N(p.preco) + ' vinténs volta a ficar disponível.' : '',
      sim: 'Cancelar o pedido', nao: 'Manter'
    }).then(function (sim) {
      if (!sim || ocupado) return;
      ocupado = true;
      aviso('Cancelando…', 'neutro');
      return SITE.api('/api/loja/cancelar', { method: 'POST', body: { id: id } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (!r.ok) { aviso(SITE.erro(r, 'não deu para cancelar')); return carregaMinha(); }
        aviso('Pedido cancelado: ' + (p.nome || p.sku) + '.', 'certo');
        return carregaMinha();
      });
    });
  }

  function inicia() {
    volta = leVolta();          // antes de qualquer pedido: o endereço sai limpo
    $('lj-catalogo').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-comprar]') : null;
      if (bt && !bt.disabled) compra(bt.getAttribute('data-comprar'));
    });
    $('lj-pacotes').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-pacote]') : null;
      if (bt && !bt.disabled) compraPacote(bt.getAttribute('data-pacote'));
    });
    $('lj-pedidos').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-cancelar]') : null;
      if (bt && !bt.disabled) cancela(Number(bt.getAttribute('data-cancelar')));
    });
    $('lj-pagamentos').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-conferir]') : null;
      if (bt && !bt.disabled) confere(Number(bt.getAttribute('data-conferir')));
    });
    $('lj-atualizar').addEventListener('click', function () { carregaMinha(); carregaPagamentos(); });
    // sair pelo topo: a loja volta ao "Entre para comprar"
    window.addEventListener('site:sessao', function () {
      minha = null;
      pagamentos = null;
      estadoMinha = 'fora';
      if (volta && volta.estado !== 'ok') volta.estado = 'fora';
      desenha();
    });
    // voltou à aba (talvez depois de abrir o jogo): o saldo e os pedidos andaram
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && SITE.sessao() && Date.now() - lidaEm > 30 * 1000) { carregaMinha(); carregaPagamentos(); }
    });
    // o relógio do servidor, para o "há 3 h" e o "de novo em 3 dias"
    SITE.api('/api/saude', { semToken: true }).then(function (r) {
      if (r.ok) { SITE.acertaRelogio(r.agora); desenha(); }
    });
    desenha();
    carregaCatalogo().then(iniciaVolta);     // sem volta, iniciaVolta só lê "Seus pacotes"
    carregaMinha();
  }

  inicia();
})();
