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
 * A COMPRA VALE NA HORA (04/10): no servidor de produção a própria compra já entrega (servidor/loja.py,
 * _loja_na_hora) — a resposta traz o pedido 'entregue' (`naHora`), o saldo e as barras de depois, e a
 * página os mostra sem esperar o jogo. O pedido que ficou aberto diz por quê em `pedido.espera`: 'luta'
 * (chega quando a sala terminar), 'estado' (a conta nunca abriu o jogo) ou 'juiz' (sai em instantes).
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
 * do servidor passa pelo SITE.esc.
 *
 * AS BARRAS DE OURO (13/09, pedido do dono: "outro tipo de moeda... sem ser um
 * jogo pay to win"). A loja vende em barras de ouro, que moram na conta do site
 * (`minha.barras`: o saldo e os últimos movimentos). Cada item diz a moeda
 * (`moeda`: 'barras' ou 'vintens'; sem o campo — um servidor de antes —, é
 * vintém). No topo, os DOIS saldos: as barras da conta e os vinténs do jogo. As
 * seções chegam na ordem do servidor: os pacotes de barras (em reais) numa
 * caixa própria; "Vinténs para o jogo" (barras → vinténs); "Barras por vinténs"
 * (o caminho de quem farma, bem mais caro); e o catálogo de sempre, em barras.
 * O câmbio que a página explica vem de `catalogo.barras` — nenhum número mora
 * aqui. Todo botão de compra diz a moeda, e a falta de saldo fala da moeda
 * certa. O extrato das barras fica em "Suas barras de ouro". O ícone da barra é
 * um SVG desenhado aqui (iconeBarra), sem imagem de fora. */
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
    vintens: { titulo: Tx('Vinténs para o jogo'), sub: Tx('Troque barras de ouro por vinténs na carteira do jogo. As barras saem da conta e os vinténs entram na carteira na hora, mesmo com o jogo fechado.') },
    'barras-por-vintens': { titulo: Tx('Barras por vinténs — para quem farma'), sub: Tx('O caminho de quem desce muito: troque os vinténs que você juntou no jogo por barras de ouro e leve qualquer coisa desta loja sem gastar dinheiro. Custa bem mais que a troca de ida, de propósito. Os vinténs saem e as barras entram na hora da compra, mesmo com o jogo fechado.') },
    personagens: { titulo: Tx('Personagens'), sub: Tx('Libera a classe no jogo, e o herói chega no nível 1. As cartas que você já tem entram no desbloqueio, mas o preço é o mesmo: se faltam poucas, talvez valha esperar a queda.') },
    bonus: { titulo: Tx('Bônus de XP'), sub: Tx('Não soma com outro bônus de XP; comprar de novo soma os dias. O prazo corre a partir da entrega no jogo.') },
    pedras: { titulo: Tx('Pedras de forja'), sub: Tx('Pacotes de pedras para a Forja do Acampamento. A Âncora de Forja não está à venda: ela se conquista lá embaixo.') },
    guilda: { titulo: Tx('Guilda'), sub: Tx('Dez Insígnias fundam uma guilda.') },
    pergaminhos: { titulo: Tx('Pergaminhos'), sub: Tx('Chegam guardados no jogo; você lê quando quiser.') },
    // 04/10: as auras da praça — só aparência, e por isso podem se vender
    aparencia: { titulo: Tx('Aparência'), sub: Tx('Auras para a praça, cada uma com o seu efeito em volta do herói — chamas, ondas, folhas, vento em espiral, pedras e runas —, que todo mundo vê. Só aparência — não muda nada em batalha. A aura é sua na hora; liga, desliga e troca na ficha do Personagem, no jogo.') }
  };
  /* 04/10 — AS NOVIDADES (servidor/loja.py manda tudo; aqui não mora número nenhum):
   *   - o PACOTE DE BOAS-VINDAS (seção 'boas-vindas'): não é uma seção comum, é o destaque do topo,
   *     com as duas escolhas de quem compra (o personagem e a aura); some para quem já o comprou;
   *   - as OFERTAS DA SEMANA (catalogo.ofertas): os mesmos cartões, com o preço cheio riscado, numa
   *     seção própria no topo e também no lugar de sempre, com a contagem regressiva até `fim`;
   *   - PRESENTEAR: o botão em cada produto que o servidor deixa presentear (catalogo.presente.fora
   *     diz os tipos que não: moeda e o Pacote). */
  var bvClasse = '', bvAura = '';      // as escolhas do Pacote de Boas-Vindas (sobrevivem ao redesenho)
  var presenteAberto = null, presenteNome = '';   // o sku com o formulário de presente aberto e o nome digitado
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
  var RARIDADE = { comum: Tx('Comum'), raro: Tx('Raro'), epico: Tx('Épico'), lendario: Tx('Lendário') };
  var ELEMENTOS = ['fogo', 'agua', 'terra', 'ar', 'neutro'];
  var MOTIVO_BARRAS = { pacote: Tx('pacote pago'), loja: Tx('compra na loja'), 'estorno-loja': Tx('devolvidas: pedido cancelado ou recusado'),
                        'troca-vintens': Tx('troca com vinténs'), presente: Tx('presente do Mestre'),
                        'estorno-pagamento': Tx('pagamento estornado'), ajuste: Tx('ajuste do dono do jogo') };

  /* ---- as barras de ouro (13/09) ---- */
  /* a barra de ouro desenhada à mão: a face de cima clara, a da frente mais funda, um brilho */
  function iconeBarra(classe) {
    return '<svg class="ico-barra' + (classe ? ' ' + classe : '') + '" viewBox="0 0 32 20" aria-hidden="true" focusable="false">' +
      '<polygon points="4,9 28,9 31.5,19 0.5,19" fill="#d4921a" stroke="#7a4f08" stroke-width="0.9" stroke-linejoin="round"/>' +
      '<polygon points="8.5,1 23.5,1 28,9 4,9" fill="#ffd45e" stroke="#7a4f08" stroke-width="0.9" stroke-linejoin="round"/>' +
      '<polygon points="10.5,2.6 17.5,2.6 16.6,4.4 9.6,4.4" fill="#fff6d2" opacity="0.85"/>' +
      '<polygon points="4.5,11 12,11 11.2,13 3.8,13" fill="#f5c04a" opacity="0.7"/></svg>';
  }
  function moedaDe(it) { return it && it.moeda === 'barras' ? 'barras' : 'vintens'; }
  function temBarras() { return !!(minha && minha.barras && typeof minha.barras === 'object'); }
  function barrasNoSaldo() { return Number(((minha && minha.barras) || {}).saldo) || 0; }
  function nBarras(n) { return N(n) + (Number(n) === 1 ? Tx(' barra de ouro') : Tx(' barras de ouro')); }
  /* 04/10: a oferta da semana deste item (ou null). Vale enquanto o relógio do servidor não passou do
   * `fim`; quem decide o preço cobrado é o servidor — aqui é só o que a página mostra. */
  function oferta(it) {
    var o = catalogo && catalogo.ofertas;
    if (!o || !Array.isArray(o.itens) || !(Number(o.fim) > SITE.agora())) return null;
    for (var i = 0; i < o.itens.length; i++) {
      var x = o.itens[i];
      if (x && x.sku === it.sku && Number(x.preco) > 0 && Number(x.preco) < Number(it.preco)) return x;
    }
    return null;
  }
  function precoDe(it) { var o = oferta(it); return o ? Number(o.preco) : Number(it.preco); }
  // o preço cheio a riscar: o do catálogo quando há oferta, ou o `precoCheio` do Pacote de Boas-Vindas
  function cheioDe(it) {
    var c = oferta(it) ? Number(it.preco) : Number(it.precoCheio) || 0;
    return c > precoDe(it) ? c : 0;
  }
  function menosPorCento(it) { var c = cheioDe(it); return c ? Math.round((1 - precoDe(it) / c) * 100) : 0; }
  function precoTexto(it) { return moedaDe(it) === 'barras' ? nBarras(precoDe(it)) : Tx('{a} vinténs', { a: N(precoDe(it)) }); }
  function precoHtml(it) {
    var cheio = cheioDe(it);
    var antes = cheio ? '<s class="preco-cheio" aria-label="de ' + N(cheio) + '">' + N(cheio) + '</s>' : '';
    return moedaDe(it) === 'barras'
      ? '<span class="preco preco-barras' + (cheio ? ' em-oferta' : '') + '" data-moeda="barras">' + iconeBarra() + antes + N(precoDe(it)) + ' <small>' + Tx('barras') + '</small></span>'
      : '<span class="preco" data-moeda="vintens">' + Tx('{a} <small>vinténs</small>', { a: N(precoDe(it)) }) + '</span>';
  }
  // os segundos que faltam, por extenso: "2 d 7 h", "1 h 23 min" (DIA e HORA: nenhum número solto, a
  // prova do site lê este arquivo atrás de preço escrito à mão)
  function faltaTexto(seg) {
    var HORA = 60 * 60;
    seg = Math.max(0, Math.floor(Number(seg) || 0));
    var d = Math.floor(seg / DIA), h = Math.floor((seg % DIA) / HORA), m = Math.floor((seg % HORA) / 60);
    if (d > 0) return d + ' d' + (h ? ' ' + h + ' h' : '');
    if (h > 0) return h + ' h' + (m ? ' ' + m + ' min' : '');
    return m > 0 ? m + ' min' : Tx('menos de 1 min');
  }
  function presenteavel(it) {
    var fora = catalogo && catalogo.presente && Array.isArray(catalogo.presente.fora) ? catalogo.presente.fora : null;
    return !!fora && moedaDe(it) === 'barras' && fora.indexOf(it.tipo) < 0;
  }
  /* o câmbio que o servidor manda, em palavras (as duas seções de troca) */
  function cambio(id) {
    var b = catalogo && catalogo.barras;
    if (!b || !(Number(b.vintensPorBarra) > 0) || !(Number(b.vintensPorBarraFarmada) > 0)) return '';
    if (id === 'vintens') return Tx('Cada barra de ouro vira {a} vinténs.', { a: N(b.vintensPorBarra) });
    if (id === 'barras-por-vintens') {
      return Tx('Aqui cada barra de ouro custa {a} vinténs (na troca de ida, uma barra vira {b}).', { a: N(b.vintensPorBarraFarmada), b: N(b.vintensPorBarra) });
    }
    return '';
  }

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
    aviso(Tx('A sessão desta página tinha vencido. Entre de novo para comprar.'), 'neutro');
    desenha();
  }
  function semSave() {
    var s = (minha && minha.saldo) || {};
    return !s.semFundo && !(Number(s.saveVersao) > 0);
  }
  function aCaminhoNoSaldo() { return Number(((minha && minha.saldo) || {}).aCaminho) || 0; }
  /* 04/10: DENTRO DO APLICATIVO de Android (SITE.noApp) a Play só aceita a cobrança dela. Então ali os pacotes
   * do Mercado Pago não aparecem (nem botão, nem preço em reais, nem o nome dele): no lugar entra a tela da
   * compra pela Google (js/core/compra_play.js, que o loja.html só carrega no aplicativo). Gastar barras é igual. */
  function noApp() { return !!(SITE.noApp && SITE.noApp()); }
  function compraPlay() { return (window.JOGO && window.JOGO.CompraPlay) || null; }
  function pagamentoLigado() { return !!(catalogo && catalogo.pagamento && catalogo.pagamento.ligado === true); }

  /* ---- o que vem do servidor ---- */
  function carregaCatalogo() {
    return SITE.api('/api/loja/catalogo', { semToken: true }).then(function (r) {
      if (r.ok && Array.isArray(r.itens)) { catalogo = r; erroCatalogo = ''; }
      else {
        catalogo = null;
        erroCatalogo = r.status === 0 ? Tx('O servidor está fora — a loja volta com ele.')
          : r.status === 404 ? Tx('A loja ainda não chegou a este servidor.')
          : SITE.erro(r, Tx('não deu para ler o catálogo'));
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
        erroMinha = r.status === 0 ? Tx('O servidor está fora — o seu saldo volta com ele.') : SITE.erro(r, Tx('não deu para ler o seu saldo'));
      } else aviso(SITE.erro(r, Tx('não deu para atualizar o saldo')));
      desenha();
    });
  }
  /* "Seus pacotes": só com sessão e com os pagamentos ligados */
  function carregaPagamentos() {
    if (!SITE.sessao() || !pagamentoLigado() || noApp()) return Promise.resolve();
    return SITE.api('/api/pagamento/meus').then(function (r) {
      if (r.status === 401) { sessaoVencida(); return; }
      if (r.ok && Array.isArray(r.pagamentos)) pagamentos = r;
      desenhaPagamentos();
    });
  }

  /* ---- o desenho ---- */
  function desenha() {
    desenhaVolta(); desenhaSaldo(); desenhaPacotes(); desenhaCatalogo(); desenhaPedidos(); desenhaExtrato(); desenhaPagamentos();
  }

  function desenhaSaldo() {
    var caixa = $('lj-saldo');
    if (estadoMinha === 'fora') {
      caixa.innerHTML = (noApp()
        ? '<div class="saldo-fora">' +
        Tx('{a}<p><b>Entre para comprar.</b> A loja vende em barras de ouro, que ficam na sua conta do site: vêm dos pacotes ou da troca pelos vinténs do seu jogo.</p><a class="btn btn-ouro" href="conta.html#entrar">Entrar</a><a class="btn" href="conta.html#criar">Criar conta</a>', { a: iconeBarra('grande') }) +
        '</div>'
        : '<div class="saldo-fora">' +
        Tx('{a}<p><b>Entre para comprar.</b> A loja vende em barras de ouro, que ficam na sua conta do site: vêm dos pacotes (Pix ou cartão) ou da troca pelos vinténs do seu jogo.</p><a class="btn btn-ouro" href="conta.html#entrar">Entrar</a><a class="btn" href="conta.html#criar">Criar conta</a>', { a: iconeBarra('grande') }) +
        '</div>');
      return;
    }
    if (estadoMinha === 'carregando') { caixa.innerHTML = Tx('<div class="estado">carregando o seu saldo…</div>'); return; }
    if (estadoMinha === 'erro') { caixa.innerHTML = '<div class="estado fora">' + E(erroMinha) + '</div>'; return; }
    var s = minha.saldo || {};
    var temCaminho = proprio(s, 'aCaminho');     // um servidor de antes da loja 2 não manda o campo
    var caminho = aCaminhoNoSaldo();
    var quando = !semSave() ? Tx('Do último save que subiu{a}.', { a: Number(s.saveEm) > 0 ? ', ' + SITE.ha(s.saveEm) : '' })
      : caminho > 0 ? Tx('O servidor ainda não viu a carteira do seu jogo: por enquanto, só os vinténs a caminho contam. Abra o jogo logado nesta conta (na conta Principal).')
      : Tx('O servidor ainda não viu seus vinténs: abra o jogo logado nesta conta (na conta Principal).');
    // 13/09: os DOIS saldos — as barras de ouro da conta (se o servidor já as tem) e os vinténs do jogo
    var barras = temBarras()
      ? '<section class="saldo-bloco bloco-barras">' +
        Tx('<h3>Barras de ouro <small>da conta do site</small></h3><div class="saldo-barras">{a}<b data-saldo="barras">{b}</b></div><p class="apoio">Gastam-se só aqui na loja. Entram na hora quando um pacote é aprovado, e voltam se um pedido for cancelado ou devolvido pelo jogo.</p>', { a: iconeBarra('grande'), b: N(barrasNoSaldo()) }) +
        '</section>'
      : '';
    caixa.innerHTML = Tx('{a}<div class="saldos{b}">{barras}<section class="saldo-bloco bloco-vintens"><h3>{c} <small>{d}</small></h3><div class="saldo-numeros{e}"><div><span>Carteira do jogo</span><b data-saldo="carteira">{f}</b></div>{g}<div><span>Reservado</span><b data-saldo="reservado">{h}</b></div><div class="disponivel"><span>Disponível</span><b data-saldo="disponivel">{i}</b></div></div><p class="saldo-quando apoio">{j}</p><ul><li>Só os vinténs do bolso contam; se estão no cofre, saque no jogo.</li>{k}<li>O reservado é o que está nos pedidos pagos em vinténs que ainda não entraram.</li><li>A compra vale na hora, mesmo com o jogo fechado. No meio de uma luta, o personagem comprado chega quando ela terminar.</li></ul></section></div>', { a: s.semFundo ? Tx('<p class="selo-mestre">◆ Mestre: compra sem gastar</p>') : '', b: barras ? ' dois' : '', barras: barras, c: barras ? Tx('Vinténs do jogo') : Tx('Seu saldo'), d: barras ? Tx('para a troca por barras') : Tx('em vinténs'), e: temCaminho ? ' quatro' : '', f: N(s.carteira), g: temCaminho ? '<div class="a-caminho">' + Tx('<span>A caminho</span><b data-saldo="aCaminho">{a}</b>', { a: N(caminho) }) + '</div>' : '', h: N(s.reservado), i: N(s.disponivel), j: E(quando), k: temCaminho ? Tx('<li class="nota-caminho">A caminho: vinténs de presentes e de trocas que o jogo ainda não recebeu. Eles já contam no disponível daqui.</li>') : '' });
  }

  /* ---- os pacotes em reais (13/09: de barras de ouro; o de vinténs, de um servidor de antes, ainda desenha) ---- */
  function pacoteEmBarras(p) { return p.moeda === 'barras' || Number(p.barras) > 0; }
  function pacoteBom(p) { return !!p && typeof p.id === 'string' && !!p.id && (Number(p.barras) > 0 || Number(p.vintens) > 0); }
  function listaPacotes() { return catalogo && Array.isArray(catalogo.pacotes) ? catalogo.pacotes.filter(pacoteBom) : []; }
  function desenhaPacotes() {
    var caixa = $('lj-pacotes');
    if (noApp()) { desenhaPacotesApp(caixa); return; }
    var ps = listaPacotes();
    caixa.hidden = !ps.length;
    if (!ps.length) { caixa.innerHTML = ''; return; }
    var ligado = pagamentoLigado();
    var teste = ligado && catalogo.pagamento.teste === true;
    var emBarras = ps.some(pacoteEmBarras);
    caixa.innerHTML = (emBarras
      ? Tx('<div class="pacotes-cab">{a}<h3>Barras de Ouro</h3>{b}</div><p class="apoio">{c}</p><div class="pacotes">{d}</div>', { a: emBarras ? iconeBarra() : '', b: !ligado ? Tx('<span class="etiqueta embreve" data-em-breve>em breve</span>')
        : teste ? Tx('<span class="etiqueta modo-teste">modo de teste</span>') : '', c: emBarras
        ? (ligado ? Tx('Pix ou cartão, pelo Mercado Pago. Aprovado o pagamento, as barras de ouro entram na sua conta na hora, prontas para gastar aqui.')
                  : Tx('Pix ou cartão, pelo Mercado Pago: chegam em breve. Por enquanto, as barras vêm da troca pelos vinténs do jogo, logo abaixo.'))
        : (ligado ? Tx('Pix ou cartão, pelo Mercado Pago. Aprovado o pagamento, os vinténs entram na sua conta na hora (já dá para gastar aqui) e o jogo os recebe na próxima abertura.')
                  : Tx('Pix ou cartão, pelo Mercado Pago: chegam em breve. Por enquanto, os vinténs vêm das descidas.')), d: ps.map(cartaoPacote).join('') })
      : Tx('<div class="pacotes-cab">{a}<h3>Pacotes de vinténs</h3>{b}</div><p class="apoio">{c}</p><div class="pacotes">{d}</div>', { a: emBarras ? iconeBarra() : '', b: !ligado ? Tx('<span class="etiqueta embreve" data-em-breve>em breve</span>')
        : teste ? Tx('<span class="etiqueta modo-teste">modo de teste</span>') : '', c: emBarras
        ? (ligado ? Tx('Pix ou cartão, pelo Mercado Pago. Aprovado o pagamento, as barras de ouro entram na sua conta na hora, prontas para gastar aqui.')
                  : Tx('Pix ou cartão, pelo Mercado Pago: chegam em breve. Por enquanto, as barras vêm da troca pelos vinténs do jogo, logo abaixo.'))
        : (ligado ? Tx('Pix ou cartão, pelo Mercado Pago. Aprovado o pagamento, os vinténs entram na sua conta na hora (já dá para gastar aqui) e o jogo os recebe na próxima abertura.')
                  : Tx('Pix ou cartão, pelo Mercado Pago: chegam em breve. Por enquanto, os vinténs vêm das descidas.')), d: ps.map(cartaoPacote).join('') }));
  }
  /* No aplicativo: a tela da compra pela Google no lugar dos pacotes em reais. O elemento é um só e é
   * reaproveitado (o desenha() roda muitas vezes; a tela guarda o estado dela e se repinta sozinha). */
  var caixaPlay = null;
  function desenhaPacotesApp(caixa) {
    var cp = compraPlay();
    caixa.hidden = !cp;
    if (!cp) { caixa.innerHTML = ''; return; }
    if (caixaPlay && caixaPlay.parentNode === caixa) return;
    caixa.innerHTML = '<div class="pacotes-cab">' + Tx('{a}<h3>Barras de Ouro</h3>', { a: iconeBarra() }) + '</div>';
    caixaPlay = document.createElement('div');
    caixaPlay.id = 'lj-play';
    caixa.appendChild(caixaPlay);
    cp.painel(caixaPlay);
  }
  function cartaoPacote(p) {
    var bt;
    if (!pagamentoLigado()) bt = Tx('<button type="button" class="btn trancado" disabled>em breve</button>');
    else if (estadoMinha === 'fora') bt = Tx('<a class="btn btn-borda" href="conta.html#entrar">Entre para comprar</a>');
    else if (estadoMinha !== 'ok') bt = Tx('<button type="button" class="btn trancado" disabled>Comprar com Pix ou cartão</button>');
    else bt = '<button type="button" class="btn btn-ouro" data-pacote="' +
      E(p.id) +
      '"' +
      (ocupado ? ' disabled' : '') +
      '>' +
      Tx('Comprar com Pix ou cartão') +
      '</button>';
    var barras = pacoteEmBarras(p);
    return '<article class="pacote' + (barras ? ' p-barras' : '') + '" data-pacote-id="' + E(p.id) + '">' +
      '<div class="pacote-arte" aria-hidden="true">' + (barras ? iconeBarra('pilha') + iconeBarra('pilha') + iconeBarra('pilha')
        : '<span class="moeda"></span><span class="moeda"></span><span class="moeda"></span>') + '</div>' +
      '<div class="corpo"><h4>' + E(p.nome || p.id) + '</h4>' +
      (barras ? '<p class="pacote-vintens pacote-barras">' + Tx('<b>{a}</b> barras de ouro', { a: N(p.barras) }) + '</p>'
        : '<p class="pacote-vintens">' + Tx('<b>{a}</b> vinténs', { a: N(p.vintens) }) + '</p>') +
      '<div class="produto-pe"><span class="preco preco-reais">' + E(p.preco == null ? '' : p.preco) + '</span>' + bt + '</div>' +
      '</div></article>';
  }

  /* ---- a faixa da volta do Mercado Pago ---- */
  function textoVolta(v) {
    if (v.estado === 'fora') return { tipo: 'neutro', texto: Tx('Entre na sua conta para acompanhar o pagamento: ele aparece em "Seus pacotes".') };
    if (v.estado === 'esperando' || v.estado === 'conferindo') return { tipo: 'neutro', texto: Tx('Conferindo o pagamento com o Mercado Pago…') };
    if (v.estado === 'desligado') {
      return { tipo: 'neutro', texto: Tx('Os pacotes estão desligados agora; o pagamento continua registrado no servidor.') };
    }
    if (v.estado === 'erro') {
      return { tipo: 'erro', texto: Tx('{erro}. O pagamento aparece em "Seus pacotes" quando o Mercado Pago confirmar.', { erro: v.erro }) };
    }
    var p = v.pag || {};
    // 13/09: o pacote de barras de ouro entra direto na conta, sem esperar o jogo
    if (p.moeda === 'barras') {
      if (p.estado === 'aprovado') {
        return p.creditado === false || !(Number(p.barras) > 0)
          ? { tipo: 'neutro', texto: Tx('Pagamento aprovado e em conferência: as barras de ouro entram quando o dono do jogo liberar.') }
          : { tipo: 'certo', texto: Tx('Pagamento aprovado: {a} já estão na sua conta.', { a: nBarras(p.barras) }) };
      }
      if (p.estado === 'estornado') return { tipo: 'erro', texto: Tx('Esse pagamento foi estornado: as barras de ouro dele saíram da conta.') };
    }
    if (p.estado === 'aprovado') {
      if (p.creditado === false || !(Number(p.vintens) > 0)) {
        return { tipo: 'neutro', texto: Tx('Pagamento aprovado e em conferência: os vinténs entram quando o dono do jogo liberar.') };
      }
      var entregue = p.pedido && p.pedido.estado === 'entregue';
      return { tipo: 'certo', texto: (entregue
        ? Tx('Pagamento aprovado: {a} vinténs já entregues no jogo.', { a: N(p.vintens) })
        : Tx('Pagamento aprovado: {a} vinténs a caminho do jogo.', { a: N(p.vintens) })) };
    }
    if (p.estado === 'pendente') return { tipo: 'neutro', texto: Tx('Pagamento em análise (Pix aparece em instantes).') };
    if (p.estado === 'aberto') {
      return { tipo: 'neutro', texto: v.lidas >= VOLTAS_CONFERIR
        ? Tx('O Mercado Pago ainda não mostrou o pagamento. Se você pagou, ele aparece em "Seus pacotes" em alguns minutos.')
        : Tx('Esperando o Mercado Pago confirmar o pagamento (Pix aparece em instantes).') };
    }
    if (p.estado === 'recusado') return { tipo: 'erro', texto: Tx('O pagamento não foi aprovado; nada foi cobrado.') };
    if (p.estado === 'estornado') return { tipo: 'erro', texto: Tx('Esse pagamento foi estornado: os vinténs dele não entram.') };
    if (p.estado === 'falhou') return { tipo: 'erro', texto: Tx('O pagamento não chegou a abrir; nada foi cobrado.') };
    return { tipo: 'neutro', texto: Tx('Pagamento registrado: o estado dele aparece em "Seus pacotes".') };
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
    if (!catalogo) { volta.estado = 'erro'; volta.erro = erroCatalogo.replace(/\.$/, '') || Tx('O servidor está fora'); desenhaVolta(); return; }
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
        volta.erro = r.status === 0 ? Tx('O servidor não respondeu') : SITE.erro(r, Tx('não deu para conferir o pagamento'));
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
      caixa.innerHTML = '<div class="estado' + (erroCatalogo ? ' fora' : '') + '">' + E(erroCatalogo || Tx('carregando o catálogo…')) + '</div>';
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
    ordem = ordem.filter(function (id) { return id !== 'boas-vindas'; });   // 04/10: o Pacote é o destaque do topo
    var html = destaqueBoasVindas(itens) + secaoOfertas(itens) + ordem.map(function (id) {
      var s = proprio(SECOES, id) ? SECOES[id]
        : { titulo: id === 'outros' ? Tx('Outros') : id.charAt(0).toUpperCase() + id.slice(1), sub: '' };
      var dela = itens.filter(function (it) { return secaoDe(it) === id; });
      var sub = [s.sub, cambio(id)].filter(Boolean).join(' ');
      return '<section class="loja-secao s-' + E(id) + '" data-secao="' + E(id) + '"><h3>' + E(s.titulo) + '</h3>' +
        (sub ? '<p class="sub">' + E(sub) + '</p>' : '') +
        '<div class="catalogo">' + dela.map(function (it) { return cartao(it, itens); }).join('') + '</div></section>';
    }).join('');
    caixa.innerHTML = html || Tx('<div class="estado">A loja está vazia por enquanto.</div>');
  }

  function corClasse(id) {
    var C = (window.JOGO && JOGO.DATA && JOGO.DATA.classes) || {};
    return (proprio(C, id) && C[id].palette && C[id].palette.primary) || '';
  }
  /* 04/10: o Pacote de Boas-Vindas, no topo. Aparece para quem está de fora (é a chamada) e para a
   * conta que ainda pode comprá-lo; quem já comprou — ou já tem os dois personagens — não o vê. */
  function destaqueBoasVindas(itens) {
    var it = null;
    itens.forEach(function (x) { if (x.tipo === 'pacote' && secaoDe(x) === 'boas-vindas') it = x; });
    if (!it) return '';
    var logado = estadoMinha === 'ok';
    var bv = logado ? (minha.boasVindas || {}) : null;
    var mestre = logado && !!(minha.saldo || {}).semFundo;
    if (logado && !mestre && bv.disponivel !== true) return '';
    var esc = it.escolhas || {};
    var classes = (Array.isArray(esc.classe) ? esc.classe : []).filter(function (c) {
      return !logado || !Array.isArray(bv.classes) || bv.classes.indexOf(c) >= 0;
    });
    var minhas = logado && minha.auras && Array.isArray(minha.auras.tem) ? minha.auras.tem : [];
    var auras = (Array.isArray(esc.aura) ? esc.aura : []).filter(function (a) { return minhas.indexOf(a) < 0; });
    if (classes.indexOf(bvClasse) < 0) bvClasse = classes[0] || '';
    if (auras.indexOf(bvAura) < 0) bvAura = auras[0] || '';
    function nomeDe(sku, reserva) { var x = acha(sku); return x ? x.nome : reserva; }
    function opcoes(lista, atual, prefixo) {
      return lista.map(function (v) {
        return '<option value="' + E(v) + '"' + (v === atual ? ' selected' : '') + '>' + E(nomeDe(prefixo + v, v)) + '</option>';
      }).join('');
    }
    var motivo = null;
    if (logado && !mestre) {
      var faltaB = precoDe(it) - barrasNoSaldo();
      if (!bvClasse || !bvAura) motivo = { chave: 'sem-escolha', texto: Tx('Não há o que escolher neste pacote para a sua conta.') };
      else if (faltaB > 0) motivo = { chave: 'saldo-barras', texto: Tx('Faltam {a} na sua conta.', { a: nBarras(faltaB) }) };
    }
    var bt = estadoMinha === 'fora' ? Tx('<a class="btn btn-ouro" href="conta.html#entrar">Entre para comprar</a>')
      : '<button type="button" class="btn btn-ouro' +
        (motivo ? ' trancado' : '') +
        '" data-comprar="' +
        E(it.sku) +
        '"' +
        (!logado || motivo || ocupado ? ' disabled' : '') +
        '>' +
        Tx('Comprar com barras') +
        '</button>';
    var menos = menosPorCento(it);
    return '<section class="loja-secao s-boas-vindas destaque-bv" data-secao="boas-vindas" data-sku="' +
      E(it.sku) +
      '">' +
      Tx('<span class="bv-selo">Uma vez por conta{b}</span><h3>{c}</h3>{d}<div class="bv-escolhas"><label>O personagem <select data-bv="classe">{e}</select></label><label>A aura <select data-bv="aura">{f}</select></label></div><div class="produto-pe">{g}{bt}</div>{h}', { b: menos ? ' · −' + menos + '%' : '', c: E(it.nome), d: it.descricao ? '<p class="sub">' + E(it.descricao) + '</p>' : '', e: opcoes(classes, bvClasse, 'classe-'), f: opcoes(auras, bvAura, 'aura-'), g: precoHtml(it), bt: bt, h: motivo ? '<p class="motivo" data-motivo="' + E(motivo.chave) + '">' + E(motivo.texto) + '</p>' : '' }) +
      '</section>';
  }
  /* 04/10: as ofertas da semana — os mesmos cartões, numa seção no topo, com o tempo que falta */
  function secaoOfertas(itens) {
    var o = catalogo.ofertas;
    var dela = itens.filter(function (it) { return !!oferta(it); });
    if (!o || !dela.length) return '';
    return '<section class="loja-secao s-ofertas" data-secao="ofertas">' +
      Tx('<h3>Ofertas da semana{a}</h3><p class="sub">Produtos com desconto que mudam toda segunda-feira, iguais para todo mundo. <b class="oferta-falta" data-fim="{b}">Terminam em {c}.</b></p><div class="catalogo">{d}</div>', { a: Number(o.desconto) > 0 ? ' <span class="oferta-selo">−' + N(o.desconto) + '%</span>' : '', b: E(o.fim), c: E(faltaTexto(Number(o.fim) - SITE.agora())), d: dela.map(function (it) { return cartao(it, itens, true); }).join('') }) +
      '</section>';
  }
  // a contagem regressiva anda sozinha; passou do fim, o catálogo é lido de novo (a semana virou)
  function andaOfertas() {
    var o = catalogo && catalogo.ofertas;
    if (!o || !(Number(o.fim) > 0)) return;
    var falta = Number(o.fim) - SITE.agora();
    if (falta <= 0) { carregaCatalogo(); return; }
    var els = document.querySelectorAll('.oferta-falta');
    for (var i = 0; i < els.length; i++) els[i].textContent = Tx('Terminam em {a}.', { a: faltaTexto(falta) });
  }

  /* 04/10: cada aura é um efeito PRÓPRIO na praça (o dono: "não só mudar a cor") — e a vitrine mostrava o
   * mesmo anel cinco vezes. Agora cada produto leva o desenho da forma dela, riscado em SVG na cor do
   * elemento: labaredas, ondas, folhas e brotos, espiral, lascas e círculo de runas. */
  var AURA_FORMA = {
    fogo: '<path d="M24 60c-5-12 2-20 6-30 3 9 9 14 6 30zM44 62c-8-18 4-30 8-46 6 16 16 26 8 46zM68 60c-4-11 3-17 5-27 4 8 9 15 5 27z" fill="currentColor"/>' +
          '<circle cx="18" cy="22" r="2.2" fill="currentColor"/><circle cx="78" cy="16" r="2.2" fill="currentColor"/><circle cx="60" cy="8" r="1.8" fill="currentColor"/>',
    agua: '<ellipse cx="48" cy="52" rx="14" ry="5" fill="none" stroke="currentColor" stroke-width="3"/>' +
          '<ellipse cx="48" cy="52" rx="28" ry="10" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".7"/>' +
          '<ellipse cx="48" cy="52" rx="42" ry="15" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".4"/>' +
          '<path d="M24 12c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12zM70 6c3 5 5 7 5 10a5 5 0 0 1-10 0c0-3 2-5 5-10z" fill="currentColor"/>',
    terra: '<path d="M14 26c10-10 22-8 28 0-8 8-20 9-28 0zM56 14c9-8 20-6 26 2-8 7-18 7-26-2z" fill="currentColor"/>' +
           '<path d="M62 40c7-6 15-4 19 2-6 5-13 5-19-2z" fill="currentColor" opacity=".7"/>' +
           '<path d="M30 66c0-10 2-16 6-22M48 66c0-14-2-20-6-26M64 66c0-8 2-12 5-16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>',
    ar: '<path d="M14 60c22 8 60 4 66-6M20 44c18 8 50 4 56-6M26 28c14 7 38 4 44-5M34 14c9 5 22 3 28-3" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>',
    neutra: '<ellipse cx="48" cy="54" rx="40" ry="13" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
            '<ellipse cx="48" cy="54" rx="27" ry="8.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".7"/>' +
            '<path d="M22 22l7-12 6 12-6 10zM62 16l6-10 6 10-6 9zM78 34l4-7 4 7-4 6z" fill="currentColor"/>'
  };
  function arte(it) {
    if (it.tipo === 'aura') {
      var cor = it.alvo === 'neutra' ? 'neutro' : (ELEMENTOS.indexOf(it.alvo) >= 0 ? it.alvo : 'neutro');
      return '<div class="arte-produto arte-aura el-' + cor + '" data-aura="' + SITE.esc(it.alvo) + '">' +
        '<svg class="aura-forma" viewBox="0 0 96 72" aria-hidden="true">' + (AURA_FORMA[it.alvo] || AURA_FORMA.agua) + '</svg></div>';
    }
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
        (d > 0 ? '<span class="qtd">' + (d === 1 ? Tx('{d} dia', { d: N(d) }) : Tx('{d} dias', { d: N(d) })) + '</span>' : '') + '</div>';
    }
    if (it.tipo === 'insignias') {
      return '<div class="arte-produto arte-insignia"><span class="glifo">⚜</span>' +
        (Number(it.qtd) > 1 ? '<span class="qtd">×' + N(it.qtd) + '</span>' : '') + '</div>';
    }
    if (it.tipo === 'pergaminho') {
      return '<div class="arte-produto arte-pergaminho"><span class="glifo">' + (it.alvo === 'elemento' ? '⟲' : '✦') + '</span></div>';
    }
    // 13/09: as trocas — moedas saindo das barras, e a barra que os vinténs compram
    if (it.tipo === 'vintens') {
      return '<div class="arte-produto arte-vintens"><span class="moedas"><span class="moeda"></span><span class="moeda"></span>' +
        '<span class="moeda"></span></span><span class="qtd">' + N(it.qtd) + '</span></div>';
    }
    if (it.tipo === 'barras') {
      return '<div class="arte-produto arte-barras">' + iconeBarra('arte') + '<span class="qtd">×' + N(it.qtd) + '</span></div>';
    }
    return '<div class="arte-produto"><span class="glifo">◆</span></div>';
  }

  /* O limite em palavras: "1 a cada 30 dias", "Compra única". Os números são
   * os do servidor; `limite: null` (o preço é o freio) não diz nada. */
  function textoLimite(it, itens) {
    var l = it.limite;
    if (!l || !(Number(l.max) > 0)) return '';
    var max = Number(l.max), t;
    if (l.dias == null) t = max === 1 ? Tx('Compra única') : Tx('No máximo {a} por conta', { a: N(max) });
    else {
      var umDia = Number(l.dias) === 1;
      t = max === 1 ? (umDia ? Tx('1 a cada {d} dia', { d: N(l.dias) }) : Tx('1 a cada {d} dias', { d: N(l.dias) }))
        : (umDia ? Tx('Até {a} a cada {d} dia', { a: N(max), d: N(l.dias) }) : Tx('Até {a} a cada {d} dias', { a: N(max), d: N(l.dias) }));
      var grupo = itens.filter(function (x) { return x.limite && x.limite.grupo === l.grupo; });
      if (grupo.length > 1) {
        t += grupo.every(function (x) { return secaoDe(x) === secaoDe(it); })
          ? Tx(', somando os {length} desta seção', { length: grupo.length }) : Tx(', somando {n} produtos', { n: grupo.length });
      }
      if (estadoMinha === 'ok' && !(minha.saldo || {}).semFundo && proprio(minha.limites, l.grupo)) {
        var u = Number(minha.limites[l.grupo].usados) || 0;
        if (u > 0) t += ' ' + Tx('(você usou {a})', { a: N(u) });
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
    var emBarras = moedaDe(it) === 'barras';
    // sem save, só o crédito a caminho sustenta uma compra em VINTÉNS (as barras moram no servidor)
    if (!emBarras && semVer && !(aCaminhoNoSaldo() > 0)) {
      return { chave: 'sem-save', texto: Tx('Abra o jogo logado nesta conta primeiro: o servidor ainda não viu seus vinténs.') };
    }
    if (semVer && it.tipo === 'pergaminho' && it.alvo === 'elemento') {
      return { chave: 'sem-save', texto: Tx('A Reescrita precisa de um herói com caminho elemental: abra o jogo logado nesta conta primeiro.') };
    }
    if (it.tipo === 'classe') {
      var c = proprio(minha.classes, it.alvo) ? minha.classes[it.alvo] : null;
      if (c && c.liberada) return { chave: 'classe-liberada', texto: Tx('Essa classe já está liberada no seu jogo.') };
      var ped = pedidoACaminho(it.sku);
      if (ped) {
        return { chave: 'classe-a-caminho', texto: ped.origem === 'presente' ? Tx('Essa classe está chegando como presente do Mestre.')
                                                                              : Tx('Já há um pedido dessa classe a caminho.') };
      }
    }
    if (it.tipo === 'aura' && minha.auras && Array.isArray(minha.auras.tem) && minha.auras.tem.indexOf(it.alvo) >= 0) {
      return { chave: 'aura-ja', texto: Tx('Essa aura já é sua: ligue na ficha do Personagem, no jogo.') };
    }
    if (s.semFundo) return null;          // o Mestre pula o saldo e os limites, como no servidor
    var lim = it.limite && proprio(minha.limites, it.limite.grupo) ? minha.limites[it.limite.grupo] : null;
    if (lim && Number(lim.usados) >= Number(lim.max)) {
      if (lim.dias == null) {
        return { chave: 'limite', texto: it.tipo === 'classe' ? Tx('Essa classe já foi comprada.') : Tx('Esse produto só pode ser comprado uma vez.') };
      }
      return { chave: 'limite', texto: Tx('Limite atingido: {a}.', { a: Number(lim.liberaEm) > 0 ? SITE.deNovo(lim.liberaEm) : Tx('espere a janela passar') }) };
    }
    if (emBarras) {
      var faltaB = precoDe(it) - barrasNoSaldo();
      if (faltaB > 0) return { chave: 'saldo-barras', texto: Tx('Faltam {a} na sua conta.', { a: nBarras(faltaB) }) };
      return null;
    }
    var falta = precoDe(it) - Number(s.disponivel);
    if (falta > 0) return { chave: 'saldo', texto: Tx('Faltam {a} vinténs no disponível.', { a: N(falta) }) };
    return null;
  }

  /* 04/10: o presente a um amigo. O botão abre, no próprio cartão, o campo do nome de quem recebe;
   * o cartão repetido na seção das ofertas (`vitrine`) não o tem — um formulário só por produto. */
  function presenteHtml(it) {
    if (estadoMinha !== 'ok' || !presenteavel(it)) return '';
    if (presenteAberto !== it.sku) {
      return '<div class="presente"><button type="button" class="btn btn-mini btn-borda" data-presentear="' +
        E(it.sku) +
        '"' +
        (ocupado ? ' disabled' : '') +
        '>' +
        Tx('Presentear um amigo') +
        '</button></div>';
    }
    return '<div class="presente presente-aberto">' +
      Tx('<label>Para quem? <input type="text" data-presente-nome maxlength="60" autocomplete="off" placeholder="o nome do jogador" value="{a}"></label><div class="presente-botoes"><button type="button" class="btn btn-mini btn-ouro" data-presente-envia="{b}"{c}>Enviar o presente</button><button type="button" class="btn btn-mini" data-presente-fecha>fechar</button></div><p class="apoio">Você paga {d}; o presente chega ao jogo dele com uma carta dizendo quem mandou.</p>', { a: E(presenteNome), b: E(it.sku), c: ocupado ? ' disabled' : '', d: E(precoTexto(it)) }) +
      '</div>';
  }
  function cartao(it, itens, vitrine) {
    var logado = estadoMinha === 'ok';
    var motivo = logado ? trancado(it) : null;
    var extra = '';
    if (it.tipo === 'classe' && Number(it.cartas) > 0) {
      var c = logado && proprio(minha.classes, it.alvo) ? minha.classes[it.alvo] : null;
      extra += '<p class="cartas">' + (c && !c.liberada
        ? Tx('Você tem {a} de {b} cartas.', { a: N(c.cartas), b: N(it.cartas) })
        : Tx('Libera com {a} cartas.', { a: N(it.cartas) })) + '</p>';
    }
    var lim = textoLimite(it, itens);
    if (lim) extra += '<p class="limite">' + E(lim) + '</p>';
    var bt, rotulo = moedaDe(it) === 'barras' ? Tx('Comprar com barras') : Tx('Comprar com vinténs');   // o botão diz a moeda
    if (estadoMinha === 'fora') bt = Tx('<a class="btn btn-borda" href="conta.html#entrar">Entre para comprar</a>');
    else if (!logado) bt = '<button type="button" class="btn trancado" disabled>' + rotulo + '</button>';
    else {
      bt = '<button type="button" class="btn btn-ouro' + (motivo ? ' trancado' : '') + '" data-comprar="' + E(it.sku) + '"' +
        (motivo || ocupado ? ' disabled' : '') + '>' + rotulo + '</button>';
    }
    var menos = oferta(it) ? menosPorCento(it) : 0;
    return '<article class="produto t-' + E(it.tipo) + ' m-' + moedaDe(it) + (menos ? ' em-oferta' : '') + '" data-sku="' + E(it.sku) + '">' +
      (menos ? '<span class="oferta-selo no-cartao">−' + menos + '%</span>' : '') + arte(it) +
      '<div class="corpo"><h4>' + E(it.nome) + '</h4>' + (it.descricao ? '<p>' + E(it.descricao) + '</p>' : '') + extra +
      '<div class="produto-pe">' + precoHtml(it) + bt + '</div>' +
      (motivo ? '<p class="motivo" data-motivo="' + E(motivo.chave) + '">' + E(motivo.texto) + '</p>' : '') +
      (vitrine ? '' : presenteHtml(it)) +
      '</div></article>';
  }

  /* ---- os pedidos e os pacotes pagos ---- */
  function desenhaPedidos() {
    var caixa = $('lj-pedidos-caixa');
    caixa.hidden = estadoMinha !== 'ok';
    if (caixa.hidden) return;
    var ps = (Array.isArray(minha.pedidos) ? minha.pedidos : []).filter(function (p) { return p && p.id != null; });
    $('lj-pedidos').innerHTML = ps.length ? ps.map(linhaPedido).join('') : Tx('<li class="apoio">Nenhum pedido ainda.</li>');
  }
  function linhaPedido(p) {
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
    var pode = !pago && !presente && p.cancelavel !== false && (est === 'pendente' || preso);
    var custo = pago ? Tx('pacote pago') : deAmigo ? Tx('presente de {a}', { a: p.de || Tx('um amigo') }) : presente ? Tx('presente do Mestre')
      : emBarras ? nBarras(p.barras) : Number(p.preco) === 0 ? Tx('sem custo (Mestre)') : Tx('{a} vinténs', { a: N(p.preco) });
    var miudo = [custo,
                 Number(p.criadoEm) > 0 ? (pago ? Tx('aprovado {a}', { a: SITE.quando(p.criadoEm) }) : presente ? Tx('dado {a}', { a: SITE.quando(p.criadoEm) }) : Tx('pedido {a}', { a: SITE.quando(p.criadoEm) })) : '',
                 est === 'retirado' && !preso && !pago && !presente ? Tx('se não chegar em 24 h, dá para cancelar') : ''].filter(Boolean);
    return '<li class="pedido e-' + est + (pago ? ' o-pagamento' : presente ? ' o-presente' : '') + '" data-pedido="' + E(p.id) + '">' +
      '<div><b>' + E(p.nome || p.sku) + '</b><small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita">' +
      '<span class="estado-pedido">' + E(txt) + '</span>' +
      (pode ? '<button type="button" class="btn btn-mini" data-cancelar="' + E(p.id) + '">' + Tx('cancelar') + '</button>' : '') +
      '</div></li>';
  }
  /* "Suas barras de ouro" (13/09): o extrato que /minha traz, o mais novo antes */
  function desenhaExtrato() {
    var caixa = $('lj-extrato-caixa');
    if (!caixa) return;
    caixa.hidden = estadoMinha !== 'ok' || !temBarras();
    if (caixa.hidden) return;
    var ms = (Array.isArray(minha.barras.movimentos) ? minha.barras.movimentos : []).filter(function (m) { return m && m.id != null; });
    $('lj-extrato').innerHTML = ms.length ? ms.map(linhaMovimento).join('')
      : Tx('<li class="apoio">Nenhum movimento ainda: as barras aparecem aqui quando um pacote for aprovado ou uma troca for entregue.</li>');
  }
  function linhaMovimento(m) {
    var d = Math.floor(Number(m.delta) || 0);
    var motivo = proprio(MOTIVO_BARRAS, m.motivo) ? MOTIVO_BARRAS[m.motivo] : String(m.motivo == null ? '' : m.motivo);
    var miudo = [m.nome ? motivo : '', Number(m.criadoEm) > 0 ? SITE.quando(m.criadoEm) : '',
                 m.saldo != null ? Tx('saldo {a}', { a: N(m.saldo) }) : ''].filter(Boolean);
    return '<li class="movimento ' + (d > 0 ? 'entra' : 'sai') + '" data-movimento="' + E(m.id) + '"><div><b>' + E(m.nome || motivo) + '</b>' +
      '<small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita"><span class="delta">' + (d > 0 ? '+' : '−') +
      N(Math.abs(d)) + '</span>' + iconeBarra() + '</div></li>';
  }
  function desenhaPagamentos() {
    var caixa = $('lj-pagamentos-caixa');
    var lista = !noApp() && estadoMinha === 'ok' && pagamentos && Array.isArray(pagamentos.pagamentos)
      ? pagamentos.pagamentos.filter(function (p) { return p && p.id != null; }) : [];
    caixa.hidden = !lista.length;
    $('lj-pagamentos').innerHTML = lista.map(linhaPagamento).join('');
  }
  function linhaPagamento(p) {
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
    var bt = (est === 'aberto' || est === 'pendente')
      ? '<button type="button" class="btn btn-mini" data-conferir="' + E(p.id) + '"' + (conferindo[p.id] ? ' disabled' : '') + '>' +
        (conferindo[p.id] ? Tx('conferindo…') : Tx('conferir')) + '</button>' : '';
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
        if (e === 'aprovado') {
          aviso(r.pagamento.moeda === 'barras' ? Tx('Pagamento aprovado: as barras de ouro já estão na sua conta.')
            : Tx('Pagamento aprovado: os vinténs estão a caminho do jogo.'), 'certo');
        }
        else if (e === 'pendente') aviso(Tx('O Mercado Pago ainda está analisando esse pagamento.'), 'neutro');
        else if (e === 'aberto') aviso(Tx('O Mercado Pago ainda não mostrou esse pagamento. Se você pagou, confira de novo em alguns minutos.'), 'neutro');
        else aviso(Tx('Pagamento conferido: {a}.', { a: proprio(ESTADO_PAG, e) ? ESTADO_PAG[e] : String(e) }), 'neutro');
        if (e === 'aprovado') { avisaJogo(); carregaMinha(); }
      } else {
        aviso(r.status === 0 ? Tx('O servidor não respondeu; tente de novo.') : SITE.erro(r, Tx('não deu para conferir o pagamento')));
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
    var emBarras = moedaDe(it) === 'barras';
    var nota = mestre ? Tx('Conta do Mestre: o pedido não gasta barras de ouro nem vinténs, nem conta nos limites.')
      : it.tipo === 'vintens' && emBarras
        ? Tx('As barras de ouro saem da sua conta e os vinténs entram na carteira do jogo agora, na hora. Depois de entregue, não há devolução.')
      : it.tipo === 'barras'
        ? Tx('Os vinténs saem da carteira do jogo e as barras de ouro entram na sua conta agora, na hora. Depois de entregue, não há devolução.')
      : emBarras
        ? Tx('As barras de ouro saem da sua conta agora e a compra entra no jogo na hora. Se o jogo a devolver, as barras voltam; depois de entregue, não há devolução.')
        : Tx('Os vinténs saem da carteira do jogo agora, na hora. Depois de entregue, não há devolução.');
    // 04/10: o Pacote de Boas-Vindas leva as duas escolhas; a aura já nasce entregue (não há o que cancelar)
    var corpo = { sku: it.sku };
    var oQue = it.nome;
    if (it.tipo === 'pacote') {
      if (!bvClasse || !bvAura) return;
      corpo.classe = bvClasse;
      corpo.aura = bvAura;
      var nc = acha('classe-' + bvClasse), na = acha('aura-' + bvAura);
      oQue += ' (' + (nc ? nc.nome : bvClasse) + ' e ' + (na ? na.nome : bvAura) + ')';
      if (!mestre) nota += Tx(' Este pacote só pode ser comprado uma vez por conta.');
    }
    if (it.tipo === 'aura' && !mestre) {
      nota = Tx('As barras de ouro saem da sua conta agora e a aura já é sua, na hora: não há cancelamento nem devolução.');
    }
    SITE.confirma({
      titulo: Tx('Confirmar a compra'),
      texto: Tx('Comprar {oQue} por {a}?', { oQue: oQue, a: precoTexto(it) }),
      nota: nota + (!mestre && it.tipo === 'bonus-xp' ? Tx(' O prazo do bônus corre a partir da entrega no jogo.') : ''),
      sim: emBarras ? Tx('Comprar com barras') : Tx('Comprar com vinténs'), nao: Tx('Voltar')
    }).then(function (sim) {
      if (!sim || ocupado) return;
      var idem = chave('sku', it.sku);
      ocupa(true);
      aviso(Tx('Fazendo o pedido…'), 'neutro');
      corpo.idem = idem;
      return SITE.api('/api/loja/comprar', { method: 'POST', body: corpo }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.status === 0) {
          semResposta = { tipo: 'sku', id: it.sku, idem: idem };
          aviso(Tx('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o pedido não sai dobrado.'));
          desenha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, Tx('não deu para fazer o pedido'))); desenha(); return carregaMinha(); }
        avisaJogo();
        // 04/10: o servidor diz se a compra já entrou (`naHora`) ou por que ainda espera (`pedido.espera`)
        var espera = (r.pedido || {}).espera;
        var entrou = r.naHora === true || (r.pedido || {}).estado === 'entregue';
        aviso((entrou
          ? Tx('Compra feita: {nome}. {a}', { nome: it.nome, a: it.tipo === 'aura'
          ? Tx('A aura já é sua: ligue na ficha do Personagem, no jogo.')
          : entrou ? (it.tipo === 'barras' ? Tx('As barras de ouro já estão na sua conta.')
                      : it.tipo === 'peca' ? Tx('Já está no banco do jogo, no cofre do Acampamento.')
                      : Tx('Já está na sua conta do jogo.'))
          : espera === 'luta' ? Tx('Você está no meio de uma luta: chega quando a sala terminar. Já está pago e guardado.')
          : espera === 'juiz' ? Tx('Entra na sua conta em instantes.')
          : it.tipo === 'barras'
          ? Tx('As barras entram quando o jogo abrir logado na conta Principal e pagar os vinténs.')
          : Tx('Ele chega quando o jogo abrir logado na conta Principal.') })
          : Tx('Pedido feito: {nome}. {a}', { nome: it.nome, a: it.tipo === 'aura'
          ? Tx('A aura já é sua: ligue na ficha do Personagem, no jogo.')
          : entrou ? (it.tipo === 'barras' ? Tx('As barras de ouro já estão na sua conta.')
                      : it.tipo === 'peca' ? Tx('Já está no banco do jogo, no cofre do Acampamento.')
                      : Tx('Já está na sua conta do jogo.'))
          : espera === 'luta' ? Tx('Você está no meio de uma luta: chega quando a sala terminar. Já está pago e guardado.')
          : espera === 'juiz' ? Tx('Entra na sua conta em instantes.')
          : it.tipo === 'barras'
          ? Tx('As barras entram quando o jogo abrir logado na conta Principal e pagar os vinténs.')
          : Tx('Ele chega quando o jogo abrir logado na conta Principal.') })), 'certo');
        if (r.pedido && minha) {
          minha.pedidos = [r.pedido].concat((minha.pedidos || []).filter(function (p) { return p && p.id !== r.pedido.id; }));
          if (r.saldo && typeof r.saldo === 'object') {
            minha.saldo = minha.saldo || {};
            Object.keys(r.saldo).forEach(function (k) { minha.saldo[k] = r.saldo[k]; });
          }
          if (r.barras && typeof r.barras === 'object' && temBarras()) minha.barras.saldo = r.barras.saldo;
        }
        desenha();
        return carregaMinha();
      });
    });
  }

  /* 04/10: presentear um amigo. Quem dá paga; o servidor confere quem recebe (existe, não é você, não
   * tem o produto ainda) e o limite do dia. A chave do clique é a mesma da compra: sem resposta, repete. */
  function presenteia(sku) {
    var it = acha(sku);
    var nome = String(presenteNome || '').trim();
    if (!it || ocupado || estadoMinha !== 'ok') return;
    if (!nome) { aviso(Tx('Diga o nome do jogador que vai receber o presente.')); return; }
    var porDia = Number(((catalogo || {}).presente || {}).porDia) || 0;
    SITE.confirma({
      titulo: Tx('Confirmar o presente'),
      texto: Tx('Dar {nome} de presente para {a} por {b}?', { nome: it.nome, a: nome, b: precoTexto(it) }),
      nota: Tx('As barras de ouro saem da SUA conta agora. Presente não se cancela; se o jogo de quem recebe o devolver, as barras voltam para você.{a}', { a: porDia ? ' ' + Tx('Dá para dar até {a} presentes por dia.', { a: N(porDia) }) : '' }),
      sim: Tx('Dar o presente'), nao: Tx('Voltar')
    }).then(function (sim) {
      if (!sim || ocupado) return;
      var idem = chave('presente', it.sku + '|' + nome);
      ocupa(true);
      aviso(Tx('Mandando o presente…'), 'neutro');
      return SITE.api('/api/loja/presentear', { method: 'POST', body: { sku: it.sku, nome: nome, idem: idem } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.status === 0) {
          semResposta = { tipo: 'presente', id: it.sku + '|' + nome, idem: idem };
          aviso(Tx('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o presente não sai dobrado.'));
          desenha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, Tx('não deu para mandar o presente'))); desenha(); return carregaMinha(); }
        aviso((r.naHora === true
          ? Tx('Presente enviado: {nome} para {a}. Já está na conta de quem recebeu.', { nome: it.nome, a: (r.presente || {}).para || nome })
          : Tx('Presente enviado: {nome} para {a}.', { nome: it.nome, a: (r.presente || {}).para || nome })), 'certo');
        presenteAberto = null;
        presenteNome = '';
        if (r.barras && typeof r.barras === 'object' && temBarras()) minha.barras.saldo = r.barras.saldo;
        desenha();
        return carregaMinha();
      });
    });
  }

  function compraPacote(id) {
    var pc = achaPacote(id);
    if (!pc || ocupado || estadoMinha !== 'ok' || !pagamentoLigado()) return;
    var barras = pacoteEmBarras(pc);
    SITE.confirma({
      titulo: barras ? Tx('Comprar barras de ouro') : Tx('Comprar vinténs'),
      texto: Tx('Comprar {a} por {b}?', { a: pc.nome || pc.id, b: String(pc.preco == null ? '' : pc.preco) }),
      nota: barras ? Tx('Você vai para a página do Mercado Pago. As barras de ouro entram na sua conta quando o pagamento for aprovado.')
        : Tx('Você vai para a página do Mercado Pago. Os vinténs chegam à sua conta quando o pagamento for aprovado, e o jogo os recebe na próxima abertura.'),
      sim: Tx('Ir para o pagamento'), nao: Tx('Voltar')
    }).then(function (sim) {
      if (!sim || ocupado) return;
      var idem = chave('pacote', pc.id);
      ocupa(true);
      aviso(Tx('Preparando o pagamento…'), 'neutro');
      return SITE.api('/api/pagamento/pacote', { method: 'POST', body: { pacote: pc.id, idem: idem } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.status === 0) {
          semResposta = { tipo: 'pacote', id: pc.id, idem: idem };
          aviso(Tx('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o pagamento não sai dobrado.'));
          desenha();
          return;
        }
        if (r.status === 503 && r.pagamento === false) {
          catalogo.pagamento = { ligado: false };
          aviso((barras
            ? Tx('Os pacotes de barras de ouro chegam em breve: nada foi cobrado.')
            : Tx('Os pacotes de vinténs chegam em breve: nada foi cobrado.')), 'neutro');
          desenha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, Tx('não deu para preparar o pagamento'))); desenha(); return; }
        var ok = typeof SITE.ehMercadoPago === 'function' && SITE.ehMercadoPago(r.endereco);
        if (!ok) {
          aviso(Tx('Endereço de pagamento estranho; nada foi cobrado. A página não vai até ele: avise o dono do jogo.'));
          desenha();
          return;
        }
        aviso(Tx('Indo para o Mercado Pago…'), 'neutro');
        desenha();
        LOJA.vai(r.endereco);
      });
    });
  }

  function cancela(id) {
    var p = (minha && Array.isArray(minha.pedidos) ? minha.pedidos : []).filter(function (x) { return x && Number(x.id) === id; })[0];
    if (!p || ocupado) return;
    SITE.confirma({
      titulo: Tx('Cancelar o pedido?'),
      texto: Tx('Cancelar o pedido de {a}?', { a: p.nome || p.sku }),
      nota: p.moeda === 'barras' && Number(p.barras) > 0 ? Tx('As {a} voltam para a sua conta.', { a: nBarras(p.barras) })
        : Number(p.preco) > 0 ? Tx('A reserva de {a} vinténs volta a ficar disponível.', { a: N(p.preco) }) : '',
      sim: Tx('Cancelar o pedido'), nao: Tx('Manter')
    }).then(function (sim) {
      if (!sim || ocupado) return;
      ocupado = true;
      aviso(Tx('Cancelando…'), 'neutro');
      return SITE.api('/api/loja/cancelar', { method: 'POST', body: { id: id } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (!r.ok) { aviso(SITE.erro(r, Tx('não deu para cancelar'))); return carregaMinha(); }
        aviso(Tx('Pedido cancelado: {a}.', { a: p.nome || p.sku }), 'certo');
        return carregaMinha();
      });
    });
  }

  function inicia() {
    volta = leVolta();          // antes de qualquer pedido: o endereço sai limpo
    $('lj-catalogo').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-comprar]') : null;
      if (bt && !bt.disabled) { compra(bt.getAttribute('data-comprar')); return; }
      // 04/10: o presente — abre o campo do nome, fecha, envia
      var alvo = ev.target.closest ? ev.target.closest('button[data-presentear],button[data-presente-envia],button[data-presente-fecha]') : null;
      if (!alvo || alvo.disabled) return;
      if (alvo.hasAttribute('data-presentear')) {
        presenteAberto = alvo.getAttribute('data-presentear');
        desenhaCatalogo();
        var campo = $('lj-catalogo').querySelector('input[data-presente-nome]');
        if (campo) campo.focus();
      } else if (alvo.hasAttribute('data-presente-fecha')) {
        presenteAberto = null;
        desenhaCatalogo();
      } else presenteia(alvo.getAttribute('data-presente-envia'));
    });
    $('lj-catalogo').addEventListener('input', function (ev) {
      if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-presente-nome')) presenteNome = ev.target.value;
    });
    $('lj-catalogo').addEventListener('change', function (ev) {      // as escolhas do Pacote de Boas-Vindas
      var qual = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-bv') : null;
      if (qual === 'classe') bvClasse = ev.target.value;
      else if (qual === 'aura') bvAura = ev.target.value;
    });
    setInterval(andaOfertas, 30 * 1000);
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
    if (noApp()) {
      // o texto do topo fala do Mercado Pago: no aplicativo ele não pode aparecer
      $('lj-sub').textContent = Tx('Personagens, bônus de XP, pedras de forja, insígnias de guilda, pergaminhos e auras para a praça, por barras de ouro. Toda semana há ofertas, e dá para presentear um amigo. As barras vêm dos pacotes ou da troca pelos vinténs que você junta no jogo: quem desce muito leva tudo daqui sem gastar dinheiro; quem tem pressa, adianta.');
      // as barras compradas pela Google entraram (na hora, ou uma compra retomada): o saldo e o extrato andaram
      window.addEventListener('soterra:barras-play', function () { carregaMinha(); });
    }
    desenha();
    carregaCatalogo().then(iniciaVolta);     // sem volta, iniciaVolta só lê "Seus pacotes"
    carregaMinha();
  }

  inicia();
})();
