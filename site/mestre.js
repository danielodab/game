/* mestre.js — o painel do Mestre do Fundo no site (site/mestre.html), 10/09.
 *
 * PEDIDO DO DONO: "na conta admin posso pesquisar qualquer usuario e fazer
 * essas liberações". A página busca qualquer conta, mostra a ficha e dá de
 * PRESENTE uma classe, um item do catálogo da loja ou vinténs. O presente é um
 * pedido da loja com preço 0 e anda pelo mesmo caminho da compra: espera o
 * jogo daquela conta abrir logado na conta Principal, e o save confirma a
 * entrega. Os vinténs de presente contam na hora no saldo do site da conta.
 *
 * O PORTÃO: sem sessão, "entre com a conta do Mestre" e nenhum pedido. Com
 * sessão, GET /api/eu diz se a conta é a do Mestre (contas.gm, lida do banco a
 * cada pedido); a marca da sessão local é só cópia, e a página a acerta com a
 * resposta (o link "Mestre" do menu some — SITE.cabecalho). Qualquer 403 de
 * /api/mestre/* fecha o painel; 401 é sessão vencida.
 *
 * AS ROTAS (todas só do Mestre): POST /api/mestre/contas {q} — a busca vai no
 * CORPO: o e-mail nunca entra na URL nem no log do proxy —, GET
 * /api/mestre/conta?id=N (a ficha: dados, classes, o que pode ser dado, os
 * presentes, os pacotes pagos e os alertas da conta), POST
 * /api/mestre/presentear {conta, sku | vintens, idem}, POST
 * /api/mestre/presente/cancelar {id}, GET /api/mestre/presentes, GET
 * /api/mestre/alertas e POST /api/mestre/alerta/visto {id}. Busca e ficha
 * têm limite por hora no servidor: a busca só sai no enviar, nunca a cada
 * tecla. O presente leva uma chave nova a cada clique (SITE.idem); só o que
 * ficou SEM resposta repete a dele, e o servidor não o dobra.
 *
 * Quem decide é o servidor: o que pode ser dado a cada conta vem pronto na
 * ficha (`catalogo[].pode/motivo`), e a recusa dele aparece como veio. O
 * endereço guarda só #conta=N (o F5 reabre a ficha). Nenhum preço mora aqui.
 * Tudo que vem do servidor passa pelo SITE.esc (ou entra por textContent). */
(function () {
  'use strict';
  var E = SITE.esc, N = SITE.num;
  function $(id) { return document.getElementById(id); }
  function proprio(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function idBom(v) { v = Number(v); return v > 0 && v < 9007199254740992 && Math.floor(v) === v; }

  var portao = 'carregando';     // fora | nao-mestre | carregando | erro | aberto
  var resultados = null;         // a última busca que voltou
  var buscando = false;
  var fichaId = null, ficha = null, erroFicha = '';
  var presentes = null, erroPresentes = '';
  var alertas = null, erroAlertas = '';
  var cartasDe = {};             // sku da classe → cartas do desbloqueio (o catálogo público da loja)
  var ocupado = false;           // um presente, um cancelamento ou um "visto" a caminho
  var semResposta = null;        // {chave, conta, idem}: o presente que ficou sem resposta repete a chave

  var ESTADO = { pendente: 'esperando o jogo abrir', retirado: 'a caminho do jogo', entregue: 'entregue',
                 estornado: 'devolvido', cancelado: 'cancelado' };
  var MOTIVO = { 'sem-saldo': 'vinténs insuficientes no jogo', 'classe-ja-liberada': 'a classe já estava liberada no jogo',
                 'item-invalido': 'o jogo não reconheceu o produto', 'erro-local': 'a entrega falhou no jogo',
                 'recusado': 'o jogo recusou o pedido' };
  var ESTADO_PAG = { aberto: 'esperando o pagamento', pendente: 'em análise', aprovado: 'aprovado',
                     recusado: 'não aprovado', estornado: 'estornado', falhou: 'não abriu' };
  var ALERTA = {
    'estorno': 'Estorno: o dinheiro voltou ao comprador',
    'contestacao': 'Contestação no cartão',
    'estorno-antes-da-entrega': 'Estorno antes da entrega: o crédito foi cancelado',
    'valor-diferente': 'Pagamento com valor diferente do pacote: não creditado',
    'conta-banida': 'Pagamento aprovado numa conta banida: creditado',
    'credito-recusado': 'O jogo recusou o crédito de um pacote várias vezes',
    'teto-diario': 'Pagamento acima do teto de 24 h: não creditado (confira depois das 24 h, ou estorne)',
    'barras-faltaram': 'Barras de ouro que já tinham sido gastas: faltou tirar'
  };
  // 13/09: as barras de ouro nos dados do alerta (quanto o pacote valia, quanto saiu, quanto faltou)
  var DADO = { barras: 'barras de ouro', tirado: 'barras tiradas', faltou: 'barras que faltaram', vintens: 'vinténs',mp: 'pagamento no Mercado Pago', play: 'compra na Google Play', pedidoGoogle: 'pedido da Google',
               apple: 'compra na App Store', transacao: 'transação da Apple', teste: 'compra de teste',   // 26/10 pedido: 'pedido', estadoPedido: 'estado do pedido',
               pagamento: 'pagamento', pacote: 'pacote', status: 'estado no Mercado Pago', aberta: 'disputa aberta',
               cancelado: 'crédito cancelado', tardio: 'chegou depois do estorno', centavos: 'valor',
               pagoEm24h: 'pago em 24 h', esperado: 'esperado', recebido: 'recebido', moeda: 'moeda', motivo: 'motivo',
               versao: 'versão do save', reemissoes: 'reemissões' };
  var DADO_REAIS = { centavos: true, pagoEm24h: true, esperado: true, recebido: true };   // vêm em centavos
  function valorDoDado(k, v) {
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if ((k === 'vintens' || k === 'barras' || k === 'tirado' || k === 'faltou') && isFinite(Number(v))) return N(v);
    if (proprio(DADO_REAIS, k) && isFinite(Number(v))) return 'R$ ' + (Number(v) / 100).toFixed(2).replace('.', ',');
    return String(v);
  }
  var SECAO = { personagens: 'Personagens', bonus: 'Bônus de XP', pedras: 'Pedras de forja', guilda: 'Guilda',
                pergaminhos: 'Pergaminhos' };
  var RARIDADE = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário' };
  var ELEMENTO = { fogo: 'Fogo', agua: 'Água', terra: 'Terra', ar: 'Ar', neutro: 'Neutro' };

  function aviso(texto, tipo) {
    var el = $('ms-aviso');
    el.className = 'aviso flutua' + (texto ? ' ' + (tipo || 'erro') : '');
    el.textContent = texto || '';
  }
  function classes() { return (window.JOGO && JOGO.DATA && JOGO.DATA.classes) || {}; }
  function nomeClasse(id) {
    var C = classes();
    return (proprio(C, id) && C[id].name) || String(id == null ? '' : id);
  }
  function corClasse(id) {
    var C = classes();
    return (proprio(C, id) && C[id].palette && C[id].palette.primary) || '';
  }

  /* ---- o portão ---- */
  function mostraPortao(qual, texto) {
    portao = qual;
    var el = $('ms-portao');
    $('ms-painel').hidden = qual !== 'aberto';
    el.hidden = qual === 'aberto';
    el.setAttribute('data-portao', qual);
    if (qual === 'fora') {
      el.innerHTML = '<p><b>Entre com a conta do Mestre.</b> ' + E(texto || 'Este painel é só da conta do Mestre do Fundo.') + '</p>' +
        '<a class="btn btn-ouro" href="conta.html#entrar">Entrar</a>';
    } else if (qual === 'nao-mestre') {
      el.innerHTML = '<p><b>Esta página é só do Mestre do Fundo.</b>' + (texto ? ' <span class="apoio">(' + E(texto) + ')</span>' : '') + '</p>' +
        '<a class="btn" href="index.html">Voltar ao início</a>';
    } else if (qual === 'erro') {
      el.innerHTML = '<p class="fora">' + E(texto) + '</p><button type="button" class="btn" data-tentar>Tentar de novo</button>';
    } else el.innerHTML = '<p>' + E(texto || 'conferindo a conta…') + '</p>';
  }
  function limpaPainel() {
    resultados = null; ficha = null; fichaId = null; presentes = null; alertas = null; semResposta = null;
  }
  function sessaoVencida(texto) {
    SITE.esquece();
    SITE.cabecalho();
    limpaPainel();
    mostraPortao('fora', texto || 'A sessão desta página tinha vencido. Entre de novo.');
  }
  /* a conta não é (ou deixou de ser) a do Mestre: a cópia local da marca cai
   * junto, e o link do menu some */
  function naoMestre(r) {
    var s = SITE.sessao();
    if (s && s.conta && s.conta.gm) { s.conta.gm = false; SITE.guarda(s); }
    SITE.cabecalho();
    limpaPainel();
    mostraPortao('nao-mestre', r && r.erro ? String(r.erro) : '');
  }
  /* 401 e 403 fecham o painel; true = a resposta já foi tratada */
  function portaoDe(r) {
    if (r.status === 401) { sessaoVencida(); return true; }
    if (r.status === 403) { naoMestre(r); return true; }
    return false;
  }
  function abre() {
    if (!SITE.sessao()) { mostraPortao('fora'); return; }
    mostraPortao('carregando', 'conferindo a conta…');
    SITE.api('/api/eu').then(function (r) {
      if (r.status === 401) { sessaoVencida(); return; }
      if (!r.ok || !r.conta) {
        mostraPortao('erro', r.status === 0 ? 'O servidor está fora — o painel volta com ele.' : SITE.erro(r, 'não deu para conferir a conta'));
        return;
      }
      var s = SITE.sessao();
      if (s && s.conta) { s.conta.gm = !!r.conta.gm; SITE.guarda(s); }
      SITE.cabecalho();
      if (!r.conta.gm) { naoMestre(); return; }
      mostraPortao('aberto');
      desenhaTudo();
      SITE.api('/api/saude', { semToken: true }).then(function (x) { if (x.ok) { SITE.acertaRelogio(x.agora); desenhaTudo(); } });
      SITE.api('/api/loja/catalogo', { semToken: true }).then(function (x) {
        (x.ok && Array.isArray(x.itens) ? x.itens : []).forEach(function (it) {
          if (it && it.tipo === 'classe' && typeof it.sku === 'string' && Number(it.cartas) > 0) cartasDe[it.sku] = Number(it.cartas);
        });
        desenhaFicha();
      });
      carregaPresentes();
      carregaAlertas();
      var id = contaDoEndereco();
      if (id) abreFicha(id);
    });
  }

  /* ---- a busca ---- */
  function buscaValida(q) {
    if (!q || q.length > 120) return false;
    if (/^#?\d{1,15}$/.test(q) || q.indexOf('@') >= 0) return true;
    return Array.from(q).length >= 3;
  }
  function busca() {
    var q = String($('ms-q').value || '').trim();
    if (!buscaValida(q)) {
      aviso('Busque por 3 letras ou mais do nome, pelo e-mail inteiro ou pelo #número da conta.');
      return;
    }
    if (buscando) return;
    buscando = true;
    $('ms-buscar').disabled = true;
    aviso('Buscando…', 'neutro');
    SITE.api('/api/mestre/contas', { method: 'POST', body: { q: q } }).then(function (r) {
      buscando = false;
      $('ms-buscar').disabled = false;
      if (portaoDe(r)) return;
      if (!r.ok) { aviso(SITE.erro(r, 'não deu para buscar')); return; }
      aviso('');
      resultados = r;
      desenhaResultados();
    });
  }
  function desenhaResultados() {
    var ul = $('ms-resultados');
    var lista = resultados && Array.isArray(resultados.contas)
      ? resultados.contas.filter(function (c) { return c && idBom(c.id); }) : null;
    $('ms-mais').hidden = !(resultados && resultados.mais === true);
    if (!lista) { ul.innerHTML = ''; return; }
    ul.innerHTML = lista.length ? lista.map(function (c) {
      var marcas = (c.banido ? ' <span class="etiqueta banida">banida</span>' : '') +
                   (c.gm ? ' <span class="etiqueta marca-gm">◆ Mestre</span>' : '');
      var miudo = [c.email ? String(c.email) : '', Number(c.criadoEm) > 0 ? 'criada ' + SITE.quando(c.criadoEm) : '']
        .filter(Boolean).map(E).join(' · ');
      return '<li data-conta="' + E(c.id) + '"' + (Number(c.id) === fichaId ? ' class="aberta"' : '') + '><div><b>' + E(c.nome) +
        '</b> <span class="apoio">#' + E(c.id) + '</span>' + marcas + (miudo ? '<small>' + miudo + '</small>' : '') + '</div>' +
        '<button type="button" class="btn btn-mini" data-abrir="' + E(c.id) + '">abrir</button></li>';
    }).join('') : '<li class="apoio">Nenhuma conta achada.</li>';
  }

  /* ---- a ficha ---- */
  function contaDoEndereco() {
    var m = /^#conta=(\d{1,15})$/.exec(location.hash || '');
    return m && idBom(m[1]) ? Number(m[1]) : null;
  }
  function gravaEndereco(id) {
    if (!history.replaceState) return;
    // o endereço inteiro (com um <base> na página, o '#x' sozinho apontaria para outro arquivo)
    try { history.replaceState(null, '', location.href.split('#')[0] + (id ? '#conta=' + id : '')); } catch (e) { /* segue */ }
  }
  function abreFicha(id) {
    id = Number(id);
    if (!idBom(id)) return Promise.resolve();
    if (fichaId !== id) { ficha = null; erroFicha = ''; }
    fichaId = id;
    gravaEndereco(id);
    desenhaFicha();
    desenhaResultados();
    return SITE.api('/api/mestre/conta?id=' + id).then(function (r) {
      if (portaoDe(r)) return;
      if (fichaId !== id) return;          // outra ficha foi pedida no meio
      if (!r.ok || !r.conta) {
        ficha = null;
        erroFicha = r.status === 0 ? 'O servidor está fora — a ficha volta com ele.' : SITE.erro(r, 'não deu para abrir a ficha');
      } else { ficha = r; erroFicha = ''; }
      desenhaFicha();
    });
  }
  function fechaFicha() {
    fichaId = null; ficha = null; erroFicha = '';
    gravaEndereco(null);
    desenhaFicha();
    desenhaResultados();
  }
  function desenhaFicha() {
    var sec = $('ms-ficha');
    sec.hidden = fichaId == null;
    if (fichaId == null) return;
    var est = $('ms-ficha-estado'), corpo = $('ms-ficha-corpo');
    if (!ficha) {
      $('ms-ficha-nome').textContent = 'Conta #' + fichaId;
      est.hidden = false;
      est.className = 'estado' + (erroFicha ? ' fora' : '');
      est.textContent = erroFicha || 'abrindo a ficha…';
      corpo.hidden = true;
      return;
    }
    est.hidden = true;
    corpo.hidden = false;
    var c = ficha.conta || {}, s = ficha.save;
    $('ms-ficha-nome').textContent = String(c.nome == null ? '' : c.nome) + ' · #' + String(c.id);
    desenhaDados(c, s);
    desenhaClasses(s);
    desenhaLiberar();
    $('ms-vintens').disabled = ocupado || !!c.banido;
    $('ms-dar-vintens').disabled = ocupado || !!c.banido;
    $('ms-vintens-nota').textContent = c.banido ? 'Conta banida: o presente não entra.'
      : 'Os vinténs contam na hora no saldo do site dessa conta e chegam à carteira do jogo quando ele abrir logado.';
    desenhaBarras(c);
    lista('ms-presentes-conta', ficha.presentes, function (p) { return linhaPresente(p, false); }, 'Nenhum presente para esta conta.');
    lista('ms-pagamentos', ficha.pagamentos, linhaPagamento, Array.isArray(ficha.pagamentos) ? 'Nenhum pacote comprado.' : '');
    lista('ms-alertas-conta', ficha.alertas, function (a) { return linhaAlerta(a, false); },
          Array.isArray(ficha.alertas) ? 'Nenhum alerta desta conta.' : '');
    // 02/10: o banimento, o silêncio e as denúncias da conta (mestre_moderacao.js)
    if (window.MS_MODERACAO) MS_MODERACAO.ficha(ficha, function () { abreFicha(fichaId); });
  }
  /* 13/09: as barras de ouro da conta — o saldo, o formulário do presente e os últimos movimentos */
  var MOTIVO_BARRAS = { pacote: 'pacote pago', loja: 'compra na loja', 'estorno-loja': 'devolvidas (pedido cancelado ou recusado)',
                        'troca-vintens': 'troca com vinténs', presente: 'presente do Mestre',
                        'estorno-pagamento': 'pagamento estornado', ajuste: 'ajuste do dono', anuncio: 'anúncio assistido' };
  function desenhaBarras(c) {
    var b = (ficha.barras && typeof ficha.barras === 'object') ? ficha.barras : null;
    $('ms-barras').disabled = ocupado || !!c.banido || !b;
    $('ms-dar-barras').disabled = ocupado || !!c.banido || !b;
    $('ms-barras-saldo').textContent = b ? 'Saldo: ' + N(b.saldo) + ' barras de ouro.' : 'Este servidor ainda não tem as barras de ouro.';
    $('ms-barras-nota').textContent = c.banido ? 'Conta banida: o presente não entra.'
      : 'As barras entram na hora na conta do site dessa conta, e não se cancelam.';
    var ms = b && Array.isArray(b.movimentos) ? b.movimentos.filter(function (m) { return m && m.id != null; }) : [];
    lista('ms-barras-extrato', ms, function (m) {
      var d = Math.floor(Number(m.delta) || 0);
      var motivo = proprio(MOTIVO_BARRAS, m.motivo) ? MOTIVO_BARRAS[m.motivo] : String(m.motivo == null ? '' : m.motivo);
      var miudo = [m.nome ? motivo : '', m.por && m.por.nome ? 'por ' + m.por.nome : '',
                   Number(m.criadoEm) > 0 ? SITE.quando(m.criadoEm) : '', m.saldo != null ? 'saldo ' + N(m.saldo) : ''].filter(Boolean);
      return '<li data-movimento="' + E(m.id) + '"><div><b>' + E(m.nome || motivo) + '</b><small>' + miudo.map(E).join(' · ') +
        '</small></div><div class="direita"><span class="estado-pedido">' + (d > 0 ? '+' : '−') + E(N(Math.abs(d))) + '</span></div></li>';
    }, b ? 'Nenhum movimento de barras nesta conta.' : '');
  }
  function desenhaDados(c, s) {
    var sd = ficha.saldo;
    var linhas = [
      ['Nome', E(c.nome) + (c.gm ? ' <span class="marca-gm">◆ Mestre do Fundo</span>' : '')],
      ['Conta', '#' + E(c.id)],
      ['E-mail', E(c.email)],
      ['Criada em', E(SITE.quando(c.criadoEm))],
      ['Último save', s ? E(SITE.ha(s.em) + ' · versão ' + N(s.versao))
        : '<span class="apoio">nunca subiu save — o presente espera o jogo abrir logado nesta conta</span>'],
      ['Visto por último', E(Number(c.ultimaSessao) > 0 ? SITE.ha(c.ultimaSessao) : 'nunca')],
      ['Nível', s ? E(N(s.nivelMax)) + ' <span class="apoio">(o maior)</span>' : '—'],
      ['Vinténs no bolso', s ? E(N(s.vintens)) : '—']
    ];
    if (sd && typeof sd === 'object') {
      linhas.push(['Saldo no site', E(N(sd.disponivel) + ' disponível · ' + N(sd.aCaminho) + ' a caminho · ' + N(sd.reservado) + ' reservado')]);
    }
    linhas.push(['Banida', c.banido ? '<b class="ms-banida">sim</b>' : 'não']);
    $('ms-dados').innerHTML = linhas.map(function (l) { return '<dt>' + l[0] + '</dt><dd>' + l[1] + '</dd>'; }).join('');
  }
  function desenhaClasses(s) {
    var cls = Array.isArray(ficha.classes) ? ficha.classes.filter(function (k) { return k && typeof k.id === 'string'; }) : [];
    $('ms-classes').innerHTML = cls.length ? cls.map(function (k) {
      var nome = nomeClasse(k.id);
      return '<li data-classe="' + E(k.id) + '">' +
        SITE.busto({ src: SITE.img('classe', k.id, true), letra: SITE.inicial(nome), cor: corClasse(k.id) }) +
        '<span><b>' + E(nome) + '</b>' + (k.nivel != null ? ' · nível ' + E(N(k.nivel)) : '') +
        (k.elemento ? ' · ' + E(proprio(ELEMENTO, k.elemento) ? ELEMENTO[k.elemento] : k.elemento) : '') + '</span></li>';
    }).join('') : '<li class="apoio">' + (s ? 'Nenhuma classe no último save.' : 'Sem save ainda: as classes aparecem quando o jogo subir o primeiro.') + '</li>';
  }
  function desenhaLiberar() {
    var cat = Array.isArray(ficha.catalogo) ? ficha.catalogo.filter(function (it) { return it && typeof it.sku === 'string' && it.sku; }) : [];
    var cartas = (ficha.cartas && typeof ficha.cartas === 'object') ? ficha.cartas : {};
    function item(it) {
      var sub = [];
      if (it.tipo === 'classe') {
        if (proprio(RARIDADE, it.raridade)) sub.push(RARIDADE[it.raridade]);
        var k = proprio(cartas, it.alvo) ? cartas[it.alvo] : null;
        if (k && !k.liberada) {
          sub.push('tem ' + N(k.cartas) + (cartasDe[it.sku] ? ' de ' + N(cartasDe[it.sku]) : '') + ' cartas');
        }
      }
      var pode = it.pode === true;
      return '<li class="ms-item" data-item="' + E(it.sku) + '"><div><b>' + E(it.nome || it.sku) + '</b>' +
        (sub.length ? '<small>' + E(sub.join(' · ')) + '</small>' : '') +
        (pode ? '' : '<span class="motivo">' + E(it.motivo || 'não pode agora') + '</span>') + '</div>' +
        '<button type="button" class="btn btn-mini' + (pode ? ' btn-ouro' : ' trancado') + '" data-presentear="' + E(it.sku) + '"' +
        (pode && !ocupado ? '' : ' disabled') + '>Dar de presente</button></li>';
    }
    var html = '';
    var dasClasses = cat.filter(function (it) { return it.tipo === 'classe'; });
    if (dasClasses.length) html += '<div class="ms-grupo"><h4>Classes</h4><ul class="lista-pedidos">' + dasClasses.map(item).join('') + '</ul></div>';
    var resto = cat.filter(function (it) { return it.tipo !== 'classe'; });
    if (resto.length) {
      var ordem = [], vistas = {};
      resto.forEach(function (it) { var s = String(it.secao || 'outros'); if (!proprio(vistas, s)) { vistas[s] = true; ordem.push(s); } });
      html += '<div class="ms-grupo"><h4>Itens da loja</h4>' + ordem.map(function (s) {
        return '<h5>' + E(proprio(SECAO, s) ? SECAO[s] : s) + '</h5><ul class="lista-pedidos">' +
          resto.filter(function (it) { return String(it.secao || 'outros') === s; }).map(item).join('') + '</ul>';
      }).join('') + '</div>';
    }
    $('ms-liberar').innerHTML = html || '<p class="apoio">O catálogo da loja veio vazio.</p>';
  }

  /* ---- as listas ---- */
  function lista(id, itens, linha, vazio) {
    var ul = $(id);
    if (!Array.isArray(itens)) { ul.innerHTML = vazio ? '<li class="apoio">' + E(vazio) + '</li>' : ''; ul.hidden = !vazio; return; }
    ul.hidden = false;
    var bons = itens.filter(function (x) { return x && x.id != null; });
    ul.innerHTML = bons.length ? bons.map(linha).join('') : '<li class="apoio">' + E(vazio) + '</li>';
  }
  function linhaPresente(p, comConta) {
    var est = proprio(ESTADO, p.estado) ? p.estado : 'outro';
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO[est];
    if (est === 'estornado') txt += ': ' + (proprio(MOTIVO, p.motivo) ? MOTIVO[p.motivo] : MOTIVO.recusado);
    if (est === 'cancelado' && p.canceladoPor && p.canceladoPor.nome) txt += ' por ' + p.canceladoPor.nome;
    var conta = (p.conta && typeof p.conta === 'object') ? p.conta : {};
    var miudo = [Number(p.criadoEm) > 0 ? SITE.quando(p.criadoEm) : '', p.por && p.por.nome ? 'dado por ' + p.por.nome : '']
      .filter(Boolean).map(E).join(' · ');
    return '<li class="pedido e-' + est + '" data-presente="' + E(p.id) + '"><div><b>' + E(p.nome || p.sku) + '</b>' +
      (comConta && idBom(conta.id) ? ' <span class="apoio">para</span> <button type="button" class="link" data-abrir="' + E(conta.id) + '">' +
        E(conta.nome || '#' + conta.id) + '</button>' : '') +
      (miudo ? '<small>' + miudo + '</small>' : '') + '</div><div class="direita"><span class="estado-pedido">' + E(txt) + '</span>' +
      (p.cancelavel === true ? '<button type="button" class="btn btn-mini" data-cancelar="' + E(p.id) + '">cancelar</button>' : '') +
      '</div></li>';
  }
  function linhaPagamento(p) {
    var est = proprio(ESTADO_PAG, p.estado) ? p.estado : 'outro';
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO_PAG[est];
    if (est === 'aprovado') {
      var pe = p.pedido && p.pedido.estado;
      txt += p.creditado === false ? ' · sem crédito' : pe === 'entregue' ? ' · entregue no jogo'
        : pe === 'cancelado' ? ' · crédito cancelado' : ' · a caminho do jogo';
    }
    var miudo = [p.preco == null ? '' : String(p.preco), Number(p.vintens) > 0 ? N(p.vintens) + ' vinténs' : '',
                 Number(p.criadoEm) > 0 ? SITE.quando(p.criadoEm) : '', 'pagamento #' + p.id].filter(Boolean).map(E).join(' · ');
    // conserto 11/09: "conferir no Mercado Pago" (o aviso perdido, o servidor mal configurado, o teto de 24 h)
    var bt = est !== 'falhou' && idBom(p.id)
      ? '<button type="button" class="btn btn-mini" data-conferir-pag="' + E(p.id) + '"' + (ocupado ? ' disabled' : '') +
        '>conferir no Mercado Pago</button>' : '';
    return '<li class="pagamento g-' + est + '" data-pagamento="' + E(p.id) + '"><div><b>' + E(p.nome || p.pacote || 'pacote') + '</b>' +
      '<small>' + miudo + '</small></div><div class="direita"><span class="estado-pedido">' + E(txt) + '</span>' + bt + '</div></li>';
  }
  function linhaAlerta(a, comConta) {
    var nome = proprio(ALERTA, a.tipo) ? ALERTA[a.tipo] : String(a.tipo == null ? 'alerta' : a.tipo);
    var dados = (a.dados && typeof a.dados === 'object') ? Object.keys(a.dados).slice(0, 8).map(function (k) {
      var v = a.dados[k];
      if (v === null || typeof v === 'object') return '';
      return (proprio(DADO, k) ? DADO[k] : k) + ': ' + valorDoDado(k, v);
    }).filter(Boolean) : [];
    var conta = (a.conta && typeof a.conta === 'object') ? a.conta : {};
    var miudo = [Number(a.criadoEm) > 0 ? SITE.quando(a.criadoEm) : ''].concat(dados).filter(Boolean).map(E).join(' · ');
    var visto = Number(a.vistoEm) > 0;
    return '<li class="alerta ' + (visto ? 'visto' : 'aberto') + '" data-alerta="' + E(a.id) + '"><div><b>' + E(nome) + '</b>' +
      (comConta && idBom(conta.id) ? ' <span class="apoio">·</span> <button type="button" class="link" data-abrir="' + E(conta.id) + '">' +
        E(conta.nome || '#' + conta.id) + '</button>' : '') +
      (miudo ? '<small>' + miudo + '</small>' : '') + '</div><div class="direita">' +
      (visto ? '<span class="estado-pedido">visto ' + E(SITE.ha(a.vistoEm)) + (a.vistoPor && a.vistoPor.nome ? ' por ' + E(a.vistoPor.nome) : '') + '</span>'
             : '<button type="button" class="btn btn-mini" data-alerta-visto="' + E(a.id) + '">marcar como visto</button>') +
      '</div></li>';
  }
  function carregaPresentes() {
    return SITE.api('/api/mestre/presentes').then(function (r) {
      if (portaoDe(r)) return;
      if (r.ok && Array.isArray(r.presentes)) { presentes = r.presentes; erroPresentes = ''; }
      else erroPresentes = r.status === 0 ? 'O servidor está fora.' : SITE.erro(r, 'não deu para ler os presentes');
      desenhaPresentes();
    });
  }
  function desenhaPresentes() {
    if (!presentes && erroPresentes) { $('ms-presentes').innerHTML = '<li class="apoio">' + E(erroPresentes) + '</li>'; return; }
    lista('ms-presentes', presentes || [], function (p) { return linhaPresente(p, true); },
          presentes ? 'Nenhum presente dado ainda.' : 'carregando…');
  }
  function carregaAlertas() {
    return SITE.api('/api/mestre/alertas').then(function (r) {
      if (portaoDe(r)) return;
      if (r.ok && Array.isArray(r.alertas)) { alertas = r.alertas; erroAlertas = ''; }
      else erroAlertas = r.status === 0 ? 'O servidor está fora.' : SITE.erro(r, 'não deu para ler os alertas');
      desenhaAlertas();
    });
  }
  function desenhaAlertas() {
    var abertos = (alertas || []).filter(function (a) { return a && !(Number(a.vistoEm) > 0); }).length;
    $('ms-alertas-total').textContent = alertas ? (abertos ? abertos + (abertos === 1 ? ' aberto' : ' abertos') : 'nenhum aberto') : '';
    if (!alertas && erroAlertas) { $('ms-alertas').innerHTML = '<li class="apoio">' + E(erroAlertas) + '</li>'; return; }
    lista('ms-alertas', alertas || [], function (a) { return linhaAlerta(a, true); },
          alertas ? 'Nenhum alerta de pagamento.' : 'carregando…');
  }
  function desenhaTudo() { desenhaResultados(); desenhaFicha(); desenhaPresentes(); desenhaAlertas(); }
  function recarrega() {
    carregaPresentes();
    carregaAlertas();
    if (fichaId != null) abreFicha(fichaId);
  }

  /* ---- os presentes ---- */
  function achaNoCatalogo(sku) {
    var cat = ficha && Array.isArray(ficha.catalogo) ? ficha.catalogo : [];
    for (var i = 0; i < cat.length; i++) if (cat[i] && cat[i].sku === sku) return cat[i];
    return null;
  }
  function presenteia(extra, rotulo, chave, confirmacao) {
    if (!ficha || ocupado) return;
    var conta = ficha.conta;
    SITE.confirma(confirmacao).then(function (sim) {
      if (!sim || ocupado || !ficha || ficha.conta.id !== conta.id) return;
      var idem = semResposta && semResposta.chave === chave && semResposta.conta === conta.id ? semResposta.idem : SITE.idem();
      semResposta = null;
      var corpo = { conta: conta.id };
      Object.keys(extra).forEach(function (k) { corpo[k] = extra[k]; });
      corpo.idem = idem;
      ocupado = true;
      desenhaFicha();
      aviso('Mandando o presente…', 'neutro');
      return SITE.api('/api/mestre/presentear', { method: 'POST', body: corpo }).then(function (r) {
        ocupado = false;
        if (portaoDe(r)) return;
        if (r.status === 0) {
          semResposta = { chave: chave, conta: conta.id, idem: idem };
          aviso('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o presente não sai dobrado.');
          desenhaFicha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, 'não deu para dar o presente')); desenhaFicha(); return; }
        aviso('Presente enviado: ' + rotulo + ' para ' + conta.nome + '.' +
              (r.semSave ? ' Essa conta nunca subiu save: o presente espera o jogo abrir logado nela.' : ''), 'certo');
        if (extra.vintens) $('ms-vintens').value = '';
        abreFicha(conta.id);
        carregaPresentes();
      });
    });
  }
  function presenteItem(sku) {
    var it = achaNoCatalogo(sku);
    if (!it || it.pode !== true || !ficha) return;
    var nome = it.nome || it.sku;
    presenteia({ sku: it.sku }, nome, 'sku:' + it.sku, {
      titulo: 'Dar de presente',
      texto: 'Dar ' + nome + ' de presente a ' + ficha.conta.nome + '?',
      nota: 'Presente do Mestre: não gasta vinténs nem conta nos limites da loja. Entra na conta na hora, mesmo com o jogo ' +
            'dela fechado; se ela nunca abriu o jogo, espera a primeira vez (até lá, dá para cancelar).',
      sim: 'Dar de presente', nao: 'Voltar'
    });
  }
  function presenteVintens() {
    if (!ficha) return;
    var bruto = String($('ms-vintens').value == null ? '' : $('ms-vintens').value).trim();
    var v = /^\d{1,9}$/.test(bruto) ? Number(bruto) : NaN;
    if (!(v >= 1)) { aviso('Diga quantos vinténs dar: um número inteiro, 1 ou mais.'); return; }
    var rotulo = N(v) + ' vinténs';
    presenteia({ vintens: v }, rotulo, 'vintens:' + v, {
      titulo: 'Dar vinténs de presente',
      texto: 'Dar ' + rotulo + ' de presente a ' + ficha.conta.nome + '?',
      nota: 'Presente do Mestre: os vinténs contam na hora no saldo do site dessa conta e chegam à carteira do jogo ' +
            'quando ele abrir logado na conta Principal; até lá, dá para cancelar.',
      sim: 'Dar os vinténs', nao: 'Voltar'
    });
  }
  /* 13/09: o presente de barras de ouro (POST /api/mestre/barras): entra na hora, com a mesma chave
   * por clique (a que ficou sem resposta se repete) */
  function presenteBarras() {
    if (!ficha || ocupado) return;
    var bruto = String($('ms-barras').value == null ? '' : $('ms-barras').value).trim();
    var v = /^\d{1,9}$/.test(bruto) ? Number(bruto) : NaN;
    if (!(v >= 1)) { aviso('Diga quantas barras de ouro dar: um número inteiro, 1 ou mais.'); return; }
    var conta = ficha.conta, chave = 'barras:' + v;
    SITE.confirma({
      titulo: 'Dar barras de ouro de presente',
      texto: 'Dar ' + N(v) + ' barras de ouro de presente a ' + conta.nome + '?',
      nota: 'Presente do Mestre: as barras entram na hora na conta do site dessa conta e não se cancelam.',
      sim: 'Dar as barras', nao: 'Voltar'
    }).then(function (sim) {
      if (!sim || ocupado || !ficha || ficha.conta.id !== conta.id) return;
      var idem = semResposta && semResposta.chave === chave && semResposta.conta === conta.id ? semResposta.idem : SITE.idem();
      semResposta = null;
      ocupado = true;
      desenhaFicha();
      aviso('Mandando as barras…', 'neutro');
      return SITE.api('/api/mestre/barras', { method: 'POST', body: { conta: conta.id, barras: v, idem: idem } }).then(function (r) {
        ocupado = false;
        if (portaoDe(r)) return;
        if (r.status === 0) {
          semResposta = { chave: chave, conta: conta.id, idem: idem };
          aviso('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o presente não sai dobrado.');
          desenhaFicha();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, 'não deu para dar as barras')); desenhaFicha(); return; }
        aviso('Presente enviado: ' + N(v) + ' barras de ouro para ' + conta.nome + '.', 'certo');
        $('ms-barras').value = '';
        abreFicha(conta.id);
      });
    });
  }
  function achaPresente(id) {
    var todos = [].concat(presentes || [], (ficha && Array.isArray(ficha.presentes)) ? ficha.presentes : []);
    for (var i = 0; i < todos.length; i++) if (todos[i] && Number(todos[i].id) === id) return todos[i];
    return null;
  }
  function cancela(id) {
    var p = achaPresente(id);
    if (!p || ocupado || p.cancelavel !== true) return;
    var para = (p.conta && p.conta.nome) || (ficha && ficha.conta && ficha.conta.nome) || 'essa conta';
    SITE.confirma({
      titulo: 'Cancelar o presente?',
      texto: 'Cancelar ' + (p.nome || p.sku) + ' para ' + para + '?',
      nota: 'O presente não chega mais ao jogo dessa conta.',
      sim: 'Cancelar o presente', nao: 'Manter'
    }).then(function (sim) {
      if (!sim || ocupado) return;
      ocupado = true;
      aviso('Cancelando…', 'neutro');
      return SITE.api('/api/mestre/presente/cancelar', { method: 'POST', body: { id: id } }).then(function (r) {
        ocupado = false;
        if (portaoDe(r)) return;
        if (!r.ok) aviso(SITE.erro(r, 'não deu para cancelar'));
        else aviso('Presente cancelado: ' + (p.nome || p.sku) + '.', 'certo');
        recarrega();
      });
    });
  }
  /* "conferir no Mercado Pago" (conserto 11/09): consulta de novo um pagamento
   * da ficha — o aviso que se perdeu, o que chegou com o servidor mal
   * configurado (SOTERRA_MP_TESTE trocado), o crédito que esperava o teto de
   * 24 h. O servidor só consulta o Mercado Pago e processa o que ele disser. */
  function conferePagamento(id) {
    if (ocupado || !idBom(id)) return;
    ocupado = true;
    desenhaFicha();
    aviso('Conferindo o pagamento #' + id + ' no Mercado Pago…', 'neutro');
    SITE.api('/api/mestre/pagamento/conferir', { method: 'POST', body: { id: id } }).then(function (r) {
      ocupado = false;
      if (portaoDe(r)) return;
      if (!r.ok || !r.pagamento || typeof r.pagamento !== 'object') {
        aviso(r.status === 0 ? 'O servidor não respondeu.' : SITE.erro(r, 'não deu para conferir o pagamento'));
        desenhaFicha();
        return;
      }
      var p = r.pagamento, est = proprio(ESTADO_PAG, p.estado) ? ESTADO_PAG[p.estado] : String(p.estado);
      var ign = Array.isArray(r.ignorados) && r.ignorados.length ? ' O servidor ignorou: ' + r.ignorados.join(', ') + '.' : '';
      aviso('Pagamento #' + p.id + ' conferido: ' + est + (p.creditado ? ' · creditado' : ' · sem crédito') + ' (' +
            (Number(r.achados) || 0) + ' no Mercado Pago).' + ign, 'certo');
      if (fichaId != null) abreFicha(fichaId);
      carregaAlertas();
    });
  }
  function visto(id) {
    if (ocupado) return;
    ocupado = true;
    SITE.api('/api/mestre/alerta/visto', { method: 'POST', body: { id: id } }).then(function (r) {
      ocupado = false;
      if (portaoDe(r)) return;
      if (!r.ok) aviso(SITE.erro(r, 'não deu para marcar o alerta'));
      else aviso('Alerta marcado como visto.', 'certo');
      carregaAlertas();
      if (fichaId != null) abreFicha(fichaId);
    });
  }

  function inicia() {
    $('ms-portao').addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('[data-tentar]')) abre();
    });
    $('ms-busca').addEventListener('submit', function (ev) { ev.preventDefault(); busca(); });
    $('ms-vintens-form').addEventListener('submit', function (ev) { ev.preventDefault(); presenteVintens(); });
    $('ms-barras-form').addEventListener('submit', function (ev) { ev.preventDefault(); presenteBarras(); });
    $('ms-atualizar').addEventListener('click', recarrega);
    $('ms-fechar').addEventListener('click', fechaFicha);
    // um clique só para a página inteira: abrir ficha, dar, cancelar, visto
    $('ms-painel').addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target : null;
      if (!t) return;
      var bt = t.closest('button');
      if (!bt || bt.disabled) return;
      if (bt.hasAttribute('data-abrir')) { abreFicha(bt.getAttribute('data-abrir')); return; }
      if (bt.hasAttribute('data-presentear')) { presenteItem(bt.getAttribute('data-presentear')); return; }
      if (bt.hasAttribute('data-cancelar')) { cancela(Number(bt.getAttribute('data-cancelar'))); return; }
      if (bt.hasAttribute('data-conferir-pag')) { conferePagamento(Number(bt.getAttribute('data-conferir-pag'))); return; }
      if (bt.hasAttribute('data-alerta-visto')) visto(Number(bt.getAttribute('data-alerta-visto')));
    });
    window.addEventListener('hashchange', function () {
      var id = contaDoEndereco();
      if (portao === 'aberto' && id && id !== fichaId) abreFicha(id);
    });
    // sair pelo topo: o painel fecha
    window.addEventListener('site:sessao', function () { limpaPainel(); mostraPortao('fora', 'Você saiu desta conta neste navegador.'); });
    abre();
  }

  inicia();
})();
