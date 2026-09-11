/* loja.js — a loja de vinténs do site (site/loja.html). Fase C.
 *
 * PÚBLICO: o catálogo de GET /api/loja/catalogo em três seções (Pergaminhos,
 * Pedras de forja, Personagens), com preço, descrição e limite. NENHUM PREÇO
 * mora no site: todo número de produto vem do servidor (servidor/loja.py,
 * CATALOGO), e a página só formata (SITE.num).
 *
 * COM SESSÃO (GET /api/loja/minha): a caixa do saldo (a carteira do último save
 * que subiu, o reservado nos pedidos abertos e o disponível), os botões
 * desligados com o motivo e os pedidos com o estado em português. Comprar é um
 * PEDIDO: vai POST /api/loja/comprar {sku, idem} com uma chave nova a cada
 * clique (SITE.idem), e a página avisa o jogo aberto neste navegador por
 * BroadcastChannel('soterra-loja') {tipo:'comprou'}. O jogo retira, entrega e
 * desconta da carteira quando abrir logado na conta Principal.
 *
 * Quem decide é o servidor: os motivos daqui (classe liberada, limite, saldo
 * curto) só poupam um clique, e a recusa dele aparece como veio. Tudo que vem
 * do servidor passa pelo SITE.esc. */
(function () {
  'use strict';
  var E = SITE.esc, N = SITE.num;
  function $(id) { return document.getElementById(id); }
  function proprio(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }

  var catalogo = null, erroCatalogo = '';
  var minha = null, erroMinha = '';
  var estadoMinha = SITE.sessao() ? 'carregando' : 'fora';     // fora | carregando | ok | erro
  var ocupado = false;
  var semResposta = null;   // {sku, idem} da compra que ficou sem resposta: o próximo clique nela reusa a chave
  var lidaEm = 0;           // quando /minha foi pedida (ms): a volta à aba não repete à toa
  var DIA = 24 * 3600;      // o pedido preso: retirado há mais de um dia pode ser cancelado

  var SECOES = [
    { id: 'pergaminhos', titulo: 'Pergaminhos', sub: 'Chegam guardados no jogo; você lê quando quiser.' },
    { id: 'pedras', titulo: 'Pedras de forja', sub: 'Pacotes de pedras para a Forja do Acampamento. A Âncora de Forja não está à venda: ela se conquista lá embaixo.' },
    { id: 'personagens', titulo: 'Personagens', sub: 'Libera a classe no jogo, e o herói chega no nível 1. As cartas que você já tem entram no desbloqueio, mas o preço é o mesmo: se faltam poucas, talvez valha esperar a queda.' }
  ];
  var ESTADO = { pendente: 'esperando o jogo abrir', retirado: 'a caminho do jogo', entregue: 'entregue',
                 estornado: 'devolvido', cancelado: 'cancelado' };
  var MOTIVO = { 'sem-saldo': 'vinténs insuficientes no jogo', 'classe-ja-liberada': 'a classe já estava liberada no jogo',
                 'item-invalido': 'o jogo não reconheceu o produto', 'erro-local': 'o jogo falhou ao entregar',
                 'recusado': 'o jogo recusou o pedido' };
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
    estadoMinha = 'fora';
    aviso('A sessão desta página tinha vencido. Entre de novo para comprar.', 'neutro');
    desenha();
  }
  function semSave() {
    var s = (minha && minha.saldo) || {};
    return !s.semFundo && !(Number(s.saveVersao) > 0);
  }

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

  /* ---- o desenho ---- */
  function desenha() { desenhaSaldo(); desenhaCatalogo(); desenhaPedidos(); }

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
    var quando = semSave() ? 'O servidor ainda não viu seus vinténs: abra o jogo logado nesta conta (na conta Principal).'
      : 'Do último save que subiu' + (Number(s.saveEm) > 0 ? ', ' + SITE.ha(s.saveEm) : '') + '.';
    caixa.innerHTML = '<h3>Seu saldo <small>em vinténs</small></h3>' +
      (s.semFundo ? '<p class="selo-mestre">◆ Mestre: compra sem gastar</p>' : '') +
      '<div class="saldo-numeros">' +
        '<div><span>Carteira do jogo</span><b data-saldo="carteira">' + N(s.carteira) + '</b></div>' +
        '<div><span>Reservado</span><b data-saldo="reservado">' + N(s.reservado) + '</b></div>' +
        '<div class="disponivel"><span>Disponível</span><b data-saldo="disponivel">' + N(s.disponivel) + '</b></div>' +
      '</div>' +
      '<p class="saldo-quando apoio">' + E(quando) + '</p>' +
      '<ul><li>Só os vinténs do bolso contam; se estão no cofre, saque no jogo.</li>' +
      '<li>O reservado é o que está nos pedidos a caminho: sai da carteira quando o jogo recebe.</li>' +
      '<li>A entrega acontece quando o jogo abrir logado na conta Principal.</li></ul>';
  }

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
    // as três seções do contrato, na ordem; uma seção nova do servidor entra no fim
    var secoes = SECOES.slice(), vistas = {};
    SECOES.forEach(function (s) { vistas[s.id] = true; });
    itens.forEach(function (it) {
      var id = secaoDe(it);
      if (!proprio(vistas, id)) {
        vistas[id] = true;
        secoes.push({ id: id, titulo: id === 'outros' ? 'Outros' : id.charAt(0).toUpperCase() + id.slice(1), sub: '' });
      }
    });
    var html = secoes.map(function (s) {
      var dela = itens.filter(function (it) { return secaoDe(it) === s.id; });
      if (!dela.length) return '';
      return '<section class="loja-secao" data-secao="' + E(s.id) + '"><h3>' + E(s.titulo) + '</h3>' +
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
    if (it.tipo === 'pergaminho') {
      return '<div class="arte-produto arte-pergaminho"><span class="glifo">' + (it.alvo === 'elemento' ? '⟲' : '✦') + '</span></div>';
    }
    return '<div class="arte-produto"><span class="glifo">◆</span></div>';
  }

  /* O limite em palavras: "1 a cada 7 dias", "Até 5 a cada 7 dias, somando os
   * 5 desta seção", "Compra única". Os números são os do servidor. */
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

  function aCaminho(sku) {
    return (Array.isArray(minha.pedidos) ? minha.pedidos : []).some(function (p) {
      return p && p.sku === sku && (p.estado === 'pendente' || p.estado === 'retirado');
    });
  }
  /* por que o botão está desligado (null = pode comprar) */
  function trancado(it) {
    var s = minha.saldo || {};
    if (semSave()) return { chave: 'sem-save', texto: 'Abra o jogo logado nesta conta primeiro: o servidor ainda não viu seus vinténs.' };
    if (it.tipo === 'classe') {
      var c = proprio(minha.classes, it.alvo) ? minha.classes[it.alvo] : null;
      if (c && c.liberada) return { chave: 'classe-liberada', texto: 'Essa classe já está liberada no seu jogo.' };
      if (aCaminho(it.sku)) return { chave: 'classe-a-caminho', texto: 'Já há um pedido dessa classe a caminho.' };
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

  function desenhaPedidos() {
    var caixa = $('lj-pedidos-caixa');
    caixa.hidden = estadoMinha !== 'ok';
    if (caixa.hidden) return;
    var ps = (Array.isArray(minha.pedidos) ? minha.pedidos : []).filter(function (p) { return p && p.id != null; });
    $('lj-pedidos').innerHTML = ps.length ? ps.map(linhaPedido).join('') : '<li class="apoio">Nenhum pedido ainda.</li>';
  }
  function linhaPedido(p) {
    var est = proprio(ESTADO, p.estado) ? p.estado : 'outro';
    var txt = est === 'outro' ? String(p.estado == null ? '' : p.estado) : ESTADO[est];
    if (est === 'estornado') txt += ': ' + (proprio(MOTIVO, p.motivo) ? MOTIVO[p.motivo] : MOTIVO.recusado);
    // o pedido "preso": retirado há mais de um dia (o servidor confere de novo)
    var desde = Number(p.retiradoEm) || Number(p.criadoEm) || 0;
    var preso = est === 'retirado' && desde > 0 && SITE.agora() - desde > DIA;
    var pode = est === 'pendente' || preso;
    var miudo = [Number(p.preco) === 0 ? 'sem custo (Mestre)' : N(p.preco) + ' vinténs',
                 Number(p.criadoEm) > 0 ? 'pedido ' + SITE.quando(p.criadoEm) : '',
                 est === 'retirado' && !preso ? 'se não chegar em 24 h, dá para cancelar' : ''].filter(Boolean);
    return '<li class="pedido e-' + est + '" data-pedido="' + E(p.id) + '"><div><b>' + E(p.nome || p.sku) + '</b>' +
      '<small>' + miudo.map(E).join(' · ') + '</small></div><div class="direita">' +
      '<span class="estado-pedido">' + E(txt) + '</span>' +
      (pode ? '<button type="button" class="btn btn-mini" data-cancelar="' + E(p.id) + '">cancelar</button>' : '') +
      '</div></li>';
  }

  /* ---- comprar e cancelar ---- */
  function acha(sku) {
    var its = (catalogo && catalogo.itens) || [];
    for (var i = 0; i < its.length; i++) if (its[i] && its[i].sku === sku) return its[i];
    return null;
  }
  function avisaJogo() {
    try {
      var bc = new BroadcastChannel('soterra-loja');
      bc.postMessage({ tipo: 'comprou' });
      setTimeout(function () { try { bc.close(); } catch (e) { /* já fechado */ } }, 1000);
    } catch (e) { /* sem BroadcastChannel: o jogo busca sozinho, ao voltar à aba e de tempos em tempos */ }
  }
  function compra(sku) {
    var it = acha(sku);
    if (!it || ocupado || estadoMinha !== 'ok') return;
    var mestre = !!(minha.saldo || {}).semFundo;
    SITE.confirma({
      titulo: 'Confirmar a compra',
      texto: 'Comprar ' + it.nome + ' por ' + N(it.preco) + ' vinténs?',
      nota: mestre ? 'Conta do Mestre: o pedido não gasta vinténs nem conta nos limites.'
                   : 'Os vinténs saem da carteira do jogo quando ele receber o pedido. Depois de entregue, não há devolução.',
      sim: 'Comprar', nao: 'Voltar'
    }).then(function (sim) {
      if (!sim || ocupado) return;
      // uma chave nova a cada clique; só a compra que ficou SEM resposta repete a
      // dela, e o servidor devolve o mesmo pedido em vez de fazer outro
      var idem = semResposta && semResposta.sku === it.sku ? semResposta.idem : SITE.idem();
      semResposta = null;
      ocupado = true;
      desenhaCatalogo();
      aviso('Fazendo o pedido…', 'neutro');
      return SITE.api('/api/loja/comprar', { method: 'POST', body: { sku: it.sku, idem: idem } }).then(function (r) {
        ocupado = false;
        if (r.status === 401) { sessaoVencida(); return; }
        if (r.status === 0) {
          semResposta = { sku: it.sku, idem: idem };
          aviso('O servidor não respondeu. Tente de novo: a página repete a mesma chave, e o pedido não sai dobrado.');
          desenhaCatalogo();
          return;
        }
        if (!r.ok) { aviso(SITE.erro(r, 'não deu para fazer o pedido')); return carregaMinha(); }
        avisaJogo();
        aviso('Pedido feito: ' + it.nome + '. Ele chega quando o jogo abrir logado na conta Principal.', 'certo');
        if (r.pedido && minha) {
          minha.pedidos = [r.pedido].concat((minha.pedidos || []).filter(function (p) { return p && p.id !== r.pedido.id; }));
          if (r.saldo && typeof r.saldo === 'object') {
            minha.saldo = minha.saldo || {};
            Object.keys(r.saldo).forEach(function (k) { minha.saldo[k] = r.saldo[k]; });
          }
          desenha();
        }
        return carregaMinha();
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
    $('lj-catalogo').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-comprar]') : null;
      if (bt && !bt.disabled) compra(bt.getAttribute('data-comprar'));
    });
    $('lj-pedidos').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-cancelar]') : null;
      if (bt && !bt.disabled) cancela(Number(bt.getAttribute('data-cancelar')));
    });
    $('lj-atualizar').addEventListener('click', function () { carregaMinha(); });
    // sair pelo topo: a loja volta ao "Entre para comprar"
    window.addEventListener('site:sessao', function () { minha = null; estadoMinha = 'fora'; desenha(); });
    // voltou à aba (talvez depois de abrir o jogo): o saldo e os pedidos andaram
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && SITE.sessao() && Date.now() - lidaEm > 30 * 1000) carregaMinha();
    });
    // o relógio do servidor, para o "há 3 h" e o "de novo em 3 dias"
    SITE.api('/api/saude', { semToken: true }).then(function (r) {
      if (r.ok) { SITE.acertaRelogio(r.agora); desenha(); }
    });
    desenha();
    carregaCatalogo();
    carregaMinha();
  }

  inicia();
})();
