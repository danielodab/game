// Banco de dados local — a fundação da vida online (dono: camada de rede).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* POR QUE ISTO EXISTE, E POR QUE ASSIM
 * ====================================
 *
 * O jogo vai ganhar cara de online: mapa aberto, moeda, banco, troca, PvP.
 * Por enquanto roda local — mas TODA leitura e escrita de dado "de servidor"
 * passa por aqui, e a API é ASSÍNCRONA DE PROPÓSITO.
 *
 * O motivo é um só e vale o arquivo inteiro: quando o servidor de verdade
 * chegar, uma API síncrona obrigaria a reescrever cada chamador (rede é
 * assíncrona por natureza). Com Promise desde o primeiro dia, a troca é
 * substituir o MIOLO deste arquivo — os chamadores nem ficam sabendo.
 * Hoje o miolo é localStorage; amanhã é fetch/WebSocket. Mesma assinatura.
 *
 * POR QUE localStorage E NÃO IndexedDB: o jogo abre por file:// com dois
 * cliques, e localStorage já provou funcionar ali (o save v2 vive nele há
 * semanas). IndexedDB daria mais espaço, mas os dados daqui são pequenos
 * (moedas, itens do cofre, histórico) e a API pública já é assíncrona — se um
 * dia precisar, o miolo troca sem ninguém perceber, que é o ponto.
 *
 * O QUE MORA AQUI vs NO Progress: `Progress` é o SAVE DO JOGADOR SOLO (heróis,
 * níveis, inventário) e continua dono disso. Aqui mora o que num jogo online
 * seria conta e mundo compartilhado: identidade pública, carteira, cofre do
 * banco, histórico de PvP e de trocas. A fronteira importa: o dia em que o
 * servidor chegar, o Progress continua local e ISTO vira remoto.
 *
 * AS "TABELAS" (a forma que o servidor herdará):
 *   jogador  { id, nome, criadoEm }          — identidade pública (chat, PvP)
 *   carteira { moedas }                       — vinténs no bolso
 *   banco    { moedas, itens[{itemId,level,stars}] }  — o cofre
 *   pvp      [ { id, oponente, minhaDupla, duplaDele, resultado, clima, quando } ]
 *   trocas   [ { id, com, dei[], recebi[], quando } ]
 */
(function () {
  'use strict';

  var DB = {};
  JOGO.DB = DB;

  var CHAVE = 'soterra-conta-v1';

  // -------------------------------------------------------------- o estado
  var dados = null;

  function agora() { return Date.now(); }

  function novoId() {
    // id local: aleatório o bastante para logs e histórico. O servidor, quando
    // chegar, emite os dele — este fica como "id de origem local".
    return 'j' + agora().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function vazio() {
    return {
      versao: 1,
      jogador: { id: novoId(), nome: null, titulo: null, criadoEm: agora() },
      carteira: { moedas: 0 },
      banco: { moedas: 0, itens: [] },
      missoes: null,                 // { dia, lista } — quem re-sorteia é JOGO.Missoes
      conquistas: {},                // { id: { prog, pago } }
      mercado: null,                 // { dia, ofertas } — quem semeia é JOGO.Mercado
      pvp: [],
      trocas: []
    };
  }

  function armazem() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) {}
    return null;
  }

  function carrega() {
    if (dados) return dados;
    var s = armazem();
    try {
      var cru = s && s.getItem(CHAVE);
      if (cru) {
        var d = JSON.parse(cru);
        // saneamento defensivo: um save mexido à mão não pode derrubar o jogo
        if (d && d.jogador && d.carteira && d.banco) {
          if (typeof d.carteira.moedas !== 'number' || !isFinite(d.carteira.moedas)) d.carteira.moedas = 0;
          if (typeof d.banco.moedas !== 'number' || !isFinite(d.banco.moedas)) d.banco.moedas = 0;
          if (!Array.isArray(d.banco.itens)) d.banco.itens = [];
          if (!Array.isArray(d.pvp)) d.pvp = [];
          if (!Array.isArray(d.trocas)) d.trocas = [];
          // contas de antes das missões ganham as tabelas sem perder nada
          if (d.missoes !== null && typeof d.missoes !== 'object') d.missoes = null;
          if (d.missoes === undefined) d.missoes = null;
          if (!d.conquistas || typeof d.conquistas !== 'object') d.conquistas = {};
          if (d.mercado !== null && typeof d.mercado !== 'object') d.mercado = null;
          if (d.mercado === undefined) d.mercado = null;
          if (d.jogador.titulo === undefined) d.jogador.titulo = null;
          dados = d;
          return dados;
        }
      }
    } catch (e) {}
    dados = vazio();
    grava();
    return dados;
  }

  function grava() {
    var s = armazem();
    try { if (s && dados) s.setItem(CHAVE, JSON.stringify(dados)); } catch (e) {}
  }

  /* Toda resposta sai por aqui: um tique de microtarefa, nunca síncrona.
   * Não é firula — chamador que funcionasse por depender de resposta síncrona
   * QUEBRARIA no dia em que o servidor chegar. Melhor que quebre hoje, no
   * primeiro teste, do que na migração. */
  function responde(valor) { return Promise.resolve(valor); }

  // ------------------------------------------------------------- identidade
  DB.jogador = function () {
    var d = carrega();
    // cópia campo a campo: TODO campo novo do jogador precisa entrar aqui —
    // o `titulo` ficou de fora um dia e sumiu sem erro nenhum (o teste pegou)
    return responde({ id: d.jogador.id, nome: d.jogador.nome,
                      titulo: d.jogador.titulo || null, criadoEm: d.jogador.criadoEm });
  };

  DB.batizar = function (nome) {
    var d = carrega();
    nome = String(nome == null ? '' : nome).trim().slice(0, 24);
    if (!nome) return responde({ ok: false, erro: 'nome vazio' });
    d.jogador.nome = nome;
    grava();
    return responde({ ok: true, nome: nome });
  };

  // -------------------------------------------------------------- a carteira
  DB.moedas = function () {
    return responde(carrega().carteira.moedas);
  };

  DB.ganharMoedas = function (n) {
    var d = carrega();
    n = Math.max(0, Math.floor(n || 0));
    d.carteira.moedas += n;
    grava();
    return responde({ ok: true, moedas: d.carteira.moedas, ganhou: n });
  };

  DB.gastarMoedas = function (n) {
    var d = carrega();
    n = Math.max(0, Math.floor(n || 0));
    if (d.carteira.moedas < n) return responde({ ok: false, erro: 'vinténs insuficientes', moedas: d.carteira.moedas });
    d.carteira.moedas -= n;
    grava();
    return responde({ ok: true, moedas: d.carteira.moedas });
  };

  // ------------------------------------------------------------------ o banco
  DB.banco = function () {
    var d = carrega();
    return responde({ moedas: d.banco.moedas, itens: d.banco.itens.slice() });
  };

  DB.depositarMoedas = function (n) {
    var d = carrega();
    n = Math.max(0, Math.floor(n || 0));
    if (d.carteira.moedas < n) return responde({ ok: false, erro: 'vinténs insuficientes' });
    d.carteira.moedas -= n;
    d.banco.moedas += n;
    grava();
    return responde({ ok: true, carteira: d.carteira.moedas, banco: d.banco.moedas });
  };

  DB.sacarMoedas = function (n) {
    var d = carrega();
    n = Math.max(0, Math.floor(n || 0));
    if (d.banco.moedas < n) return responde({ ok: false, erro: 'o cofre não tem tudo isso' });
    d.banco.moedas -= n;
    d.carteira.moedas += n;
    grava();
    return responde({ ok: true, carteira: d.carteira.moedas, banco: d.banco.moedas });
  };

  /* O item entra no cofre COMO ELE É — {itemId, level, stars} — porque é a
   * forma que o Progress.inventory já usa. Guardar só o id perderia o nível e
   * as estrelas da peça, e o jogador sacaria um item pior do que guardou. */
  DB.depositarItem = function (entrada) {
    var d = carrega();
    if (!entrada || !entrada.itemId) return responde({ ok: false, erro: 'item inválido' });
    // `|| 0`, não `|| 1`: nível 0 é UM VALOR (peça sem forja), e o `|| 1`
    // fazia o cofre devolver a peça mais forte do que entrou — forja de graça,
    // que ainda por cima quebrava o empilhamento (0 e 1 não agrupam).
    d.banco.itens.push({ itemId: entrada.itemId, level: entrada.level || 0, stars: entrada.stars || 0 });
    grava();
    return responde({ ok: true, total: d.banco.itens.length });
  };

  DB.sacarItem = function (indice) {
    var d = carrega();
    // `Number` primeiro: `undefined < 0` e `undefined >= n` são AMBOS false, e
    // um índice esquecido passaria pela guarda e sacaria o primeiro item.
    indice = Math.floor(Number(indice));
    if (!isFinite(indice) || indice < 0 || indice >= d.banco.itens.length) {
      return responde({ ok: false, erro: 'não está no cofre' });
    }
    var item = d.banco.itens.splice(indice, 1)[0];
    grava();
    return responde({ ok: true, item: item, total: d.banco.itens.length });
  };

  // ----------------------------------------------------------------- missões
  /* O DB guarda; quem SABE de missão (sorteio, alvos, prêmios) é JOGO.Missoes.
   * A fronteira importa: no servidor, estas quatro chamadas viram endpoints e
   * a validação muda de lado sem mexer no resto. */
  DB.missoes = function () {
    var d = carrega();
    return responde(d.missoes ? JSON.parse(JSON.stringify(d.missoes)) : null);
  };
  DB.salvarMissoes = function (obj) {
    var d = carrega();
    d.missoes = obj ? JSON.parse(JSON.stringify(obj)) : null;
    grava();
    return responde({ ok: true });
  };
  DB.conquistas = function () {
    var d = carrega();
    return responde(JSON.parse(JSON.stringify(d.conquistas || {})));
  };
  DB.salvarConquistas = function (obj) {
    var d = carrega();
    d.conquistas = obj ? JSON.parse(JSON.stringify(obj)) : {};
    grava();
    return responde({ ok: true });
  };
  DB.definirTitulo = function (titulo) {
    var d = carrega();
    d.jogador.titulo = (typeof titulo === 'string' && titulo.trim()) ? titulo.trim() : null;
    grava();
    return responde({ ok: true, titulo: d.jogador.titulo });
  };

  // ------------------------------------------------------------------ mercado
  /* Mesma fronteira das missões: o DB guarda o balcão inteiro, quem sabe de
   * preço, taxa e mercador-fantasma é JOGO.Mercado. */
  DB.mercadoLer = function () {
    var d = carrega();
    return responde(d.mercado ? JSON.parse(JSON.stringify(d.mercado)) : null);
  };
  DB.mercadoGravar = function (obj) {
    var d = carrega();
    d.mercado = obj ? JSON.parse(JSON.stringify(obj)) : null;
    grava();
    return responde({ ok: true });
  };

  // --------------------------------------------------------------- históricos
  DB.registrarPvp = function (partida) {
    var d = carrega();
    d.pvp.push({
      id: novoId(), quando: agora(),
      oponente: partida.oponente || '?',
      minhaDupla: partida.minhaDupla || [],
      duplaDele: partida.duplaDele || [],
      resultado: partida.resultado || '?',
      clima: partida.clima || 'calmo'
    });
    if (d.pvp.length > 200) d.pvp = d.pvp.slice(-200);   // histórico, não arquivo morto
    grava();
    return responde({ ok: true, total: d.pvp.length });
  };

  DB.historicoPvp = function () { return responde(carrega().pvp.slice()); };

  DB.registrarTroca = function (troca) {
    var d = carrega();
    d.trocas.push({
      id: novoId(), quando: agora(),
      com: troca.com || '?',
      dei: troca.dei || [], recebi: troca.recebi || []
    });
    if (d.trocas.length > 200) d.trocas = d.trocas.slice(-200);
    grava();
    return responde({ ok: true, total: d.trocas.length });
  };

  DB.historicoTrocas = function () { return responde(carrega().trocas.slice()); };

  // -------------------------------------------------------- utilidades de teste
  DB._zerar = function () {          // só páginas de teste usam; o jogo, nunca
    dados = vazio();
    grava();
    return responde(true);
  };
  DB._recarregar = function () {     // derruba o cache SEM gravar: o próximo
    dados = null;                    // acesso relê o disco como um boot faria.
    return responde(true);           // Existe para testar save corrompido —
  };                                 // `_zerar` regravaria por cima do lixo.
})();
