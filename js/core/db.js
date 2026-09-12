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
 *   loja     { aplicadas[id], recusadas[{id, motivo}] } — os pedidos da loja
 *            do site que ESTE save já tratou (Fase C; ver "a loja" abaixo)
 */
(function () {
  'use strict';

  var DB = {};
  JOGO.DB = DB;

  /* A chave é DA CONTA DA JANELA: o Banco de Contas (contas.js, carregado
   * antes) decide — 'principal' usa a chave nua de sempre, as outras ganham
   * ':<id>'. Sem ele (páginas de teste que só carregam o db), a nua. */
  var CHAVE = (JOGO.Contas && JOGO.Contas.chaveConta)
    ? JOGO.Contas.chaveConta() : 'soterra-conta-v1';

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
      jogador: { id: novoId(), nome: null, titulo: null, avatar: null,
                 coroaOculta: false,     // 11/09: o troféu acima da cabeça é opcional
                 brasa: { pts: 1000, partidas: 0, temporada: null, galeria: {} },
                 poco: { recorde: 0, semanaId: null, semanaMelhor: 0 },
                 criadoEm: agora() },
      carteira: { moedas: 0 },
      banco: { moedas: 0, itens: [] },
      missoes: null,                 // { dia, lista } — quem re-sorteia é JOGO.Missoes
      conquistas: {},                // { id: { prog, pago } }
      mercado: null,                 // { dia, ofertas } — quem semeia é JOGO.Mercado
      placar: {},                    // id -> última foto de cada vizinho visto
      mutados: [],                   // [{id, nome}] — silenciados no chat (25/08)
      loja: { aplicadas: [], recusadas: [] },   // Fase C: pedidos da loja do site já tratados
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
          if (!d.placar || typeof d.placar !== 'object') d.placar = {};
          if (!Array.isArray(d.mutados)) d.mutados = [];
          // a anotação da LOJA (Fase C): contas de antes ganham as listas
          // vazias, e lixo/duplicata/excesso sai (teto de 200 em cada)
          d.loja = saneiaLoja(d.loja);
          if (d.jogador.titulo === undefined) d.jogador.titulo = null;
          if (d.jogador.avatar === undefined) d.jogador.avatar = null;
          if (!d.jogador.brasa || typeof d.jogador.brasa.pts !== 'number') {
            d.jogador.brasa = { pts: 1000, partidas: 0, temporada: null, galeria: {} };
          }
          // contas de antes das TEMPORADAS (25/08) ganham os campos novos
          if (d.jogador.brasa.temporada === undefined) d.jogador.brasa.temporada = null;
          if (!d.jogador.brasa.galeria || typeof d.jogador.brasa.galeria !== 'object') {
            d.jogador.brasa.galeria = {};
          }
          // e as de antes do POÇO (25/08) ganham o recorde zerado
          if (!d.jogador.poco || typeof d.jogador.poco.recorde !== 'number') {
            d.jogador.poco = { recorde: 0, semanaId: null, semanaMelhor: 0 };
          }
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
    // A NUVEM (10/09) pendura aqui: toda gravação local agenda a subida
    try { if (typeof DB.aoGravar === 'function') DB.aoGravar(); } catch (e2) {}
  }

  /* A FOTO INTEIRA da conta, para a Nuvem subir; e o caminho de volta, quando
   * o servidor tem uma mais nova (passa pelo mesmo saneamento de `carrega`). */
  DB.exportar = function () {
    var d = carrega();
    try { return JSON.parse(JSON.stringify(d)); } catch (e) { return null; }
  };
  DB.recarregar = function () { dados = null; return carrega(); };
  DB.importar = function (obj) {
    if (!obj || typeof obj !== 'object') return false;
    var s = armazem();
    try { if (s) s.setItem(CHAVE, JSON.stringify(obj)); } catch (e) { return false; }
    dados = null;
    carrega();
    return true;
  };

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
                      titulo: d.jogador.titulo || null,
                      avatar: d.jogador.avatar || null,
                      coroaOculta: d.jogador.coroaOculta === true,
                      criadoEm: d.jogador.criadoEm });
  };

  /* O BATISMO E A LEI DOS NOMES (10/09 — pedido do dono: "ninguem conseguir
   * colocar o nome com GM Gm Admin Administrador etc.."). Com js/core/nomes.js
   * na página (o index carrega antes deste arquivo), o nome NOVO passa pela
   * mesma régua da conta do site: JOGO.Nomes.valida(nome, 3, 20).
   *   - 3 a 20 caracteres, os MESMOS do cadastro no servidor. Antes o batismo
   *     cortava calado em 24: um nome que não cabe na conta não devia caber na
   *     plaquinha, e cortar calado esconde do jogador o que foi gravado.
   *   - as pontas são aparadas ANTES de validar ("  Ana  " é "Ana"; a régua
   *     recusa espaço na ponta, e ninguém o digita de propósito).
   *   - a recusa volta {ok:false, erro:<motivo da régua, em pt-BR>} e a HUD
   *     mostra o motivo no toast.
   * O Mestre do Fundo (GM.ativo) pode tudo — o título é dele: vale a regra de
   * antes (apara, corta em 24, só o vazio é recusado). Sem JOGO.Nomes
   * (bancada de teste que só carrega o db), idem: como sempre foi.
   * O nome JÁ guardado não muda aqui; quem cobra o reservado antigo é a HUD
   * (pede batismo novo ao entrar no Acampamento). */
  var NOME_MIN = 3, NOME_MAX = 20;
  DB.NOME_MIN = NOME_MIN;
  DB.NOME_MAX = NOME_MAX;
  function mestreAtivo() {
    try { return !!(JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()); } catch (e) { return false; }
  }
  DB.batizar = function (nome) {
    var d = carrega();
    nome = String(nome == null ? '' : nome).trim();
    var Nm = JOGO.Nomes;
    if (Nm && typeof Nm.valida === 'function' && !mestreAtivo()) {
      var v = Nm.valida(nome, NOME_MIN, NOME_MAX);
      if (!v || !v.ok) {
        // quem se passa pela equipe ouve ISSO, e não o tamanho ou o caractere:
        // "GM" é curto demais E reservado, "G.M" tem ponto E é reservado — o
        // motivo que ensina é o da equipe (senão o próximo palpite é "GM1")
        var erro = (v && v.motivo) || 'nome recusado';
        if (nome && typeof Nm.reservado === 'function' && Nm.reservado(nome)) {
          erro = Nm.MOTIVO_RESERVADO || erro;
        }
        return responde({ ok: false, erro: erro });
      }
    } else {
      nome = nome.slice(0, 24);
      if (!nome) return responde({ ok: false, erro: 'nome vazio' });
    }
    d.jogador.nome = nome;
    grava();
    return responde({ ok: true, nome: nome });
  };

  // -------------------------------------------------------------- a carteira
  /* O GAME MASTER (31/08) tem o cofre sem fundo: com a chave do GM virada,
   * o saldo responde alto e o gasto nunca falha nem desconta. Sem a chave,
   * nada muda — e no servidor este privilégio migra para a conta assinada. */
  function bolsoSemFundo() {
    return !!(JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo());
  }
  DB.moedas = function () {
    if (bolsoSemFundo()) return responde(999999);
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
    if (bolsoSemFundo()) return responde({ ok: true, moedas: 999999 });
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
    var dep = { itemId: entrada.itemId, level: entrada.level || 0, stars: entrada.stars || 0 };
    if (typeof entrada.iid === 'string' && entrada.iid) dep.iid = entrada.iid;   // a série viaja junto (10/09)
    d.banco.itens.push(dep);
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
  /* A BRASA: os pontos de arena. O DB guarda; a conta de Elo, os degraus e
   * a regra da Coroa moram em JOGO.Brasa. */
  DB.brasaVer = function () {
    var d = carrega();
    // cópia campo a campo: temporada e galeria entraram em 25/08 — campo
    // novo da brasa TEM de entrar aqui, senão some calado (a armadilha)
    var g = {}, b = d.jogador.brasa;
    for (var k in b.galeria) if (b.galeria.hasOwnProperty(k)) g[k] = b.galeria[k];
    return responde({ pts: b.pts, partidas: b.partidas,
                      temporada: b.temporada, galeria: g });
  };

  /* A VIRADA DE TEMPORADA (25/08). Quem faz a CONTA é JOGO.Brasa (comprime,
   * temporadaDe); o DB só grava o que o chamador decidiu: o carimbo da
   * temporada nova, os pontos (comprimidos ou não) e, quando houve coroa,
   * a entrada na GALERIA — permanente, uma por temporada fechada. */
  DB.brasaVirar = function (v) {
    if (!v || typeof v.temporada !== 'number') return responde({ ok: false });
    var d = carrega();
    var b = d.jogador.brasa;
    if (b.temporada === v.temporada) return responde({ ok: true, virou: false });
    if (typeof v.pts === 'number' && isFinite(v.pts)) b.pts = Math.round(v.pts);
    if (v.galeriaDe != null && typeof v.nivel === 'number') {
      b.galeria[String(v.galeriaDe)] = v.nivel;
    }
    b.temporada = v.temporada;
    grava();
    return responde({ ok: true, virou: true, pts: b.pts });
  };
  DB.definirBrasa = function (pts, partidas) {
    var d = carrega();
    if (typeof pts === 'number' && isFinite(pts)) d.jogador.brasa.pts = Math.round(pts);
    if (typeof partidas === 'number' && isFinite(partidas)) {
      d.jogador.brasa.partidas = Math.max(0, Math.floor(partidas));
    }
    grava();
    return responde({ ok: true, pts: d.jogador.brasa.pts,
                      partidas: d.jogador.brasa.partidas });
  };

  /* O AVATAR do Acampamento: null = o corpo do líder da dupla; senão um
   * defId de fusão ('fus:a+b'). Quem valida se as classes estão liberadas é
   * a FICHA (que sabe de Progress); o DB só guarda a escolha. */
  DB.definirAvatar = function (avatar) {
    var d = carrega();
    d.jogador.avatar = (typeof avatar === 'string' && avatar.indexOf('fus:') === 0)
      ? avatar : null;
    grava();
    return responde({ ok: true, avatar: d.jogador.avatar });
  };

  /* A COROA ESCONDIDA (11/09 — a ficha do personagem: "se ele quer esconder
   * a coroa ou mostrar"). Guarda só a vontade; quem deixa de pendurar o
   * troféu é a praça, e o resumo que viaja pela Rede leva o recado para que
   * ela suma também na tela dos outros. Os PONTOS continuam no placar: o que
   * se esconde é o enfeite, não o resultado. */
  DB.definirCoroaOculta = function (oculta) {
    var d = carrega();
    d.jogador.coroaOculta = !!oculta;
    grava();
    return responde({ ok: true, coroaOculta: d.jogador.coroaOculta });
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

  // ------------------------------------------------------------------- poço
  /* O POÇO SEM FUNDO (25/08): o andar mais fundo — da SEMANA (o placar que
   * reabre toda segunda de época) e da vida da conta. Quem sabe que semana é
   * hoje é JOGO.Poco; o DB só compara e guarda. */
  DB.pocoVer = function () {
    var d = carrega();
    var p = d.jogador.poco;
    return responde({ recorde: p.recorde, semanaId: p.semanaId,
                      semanaMelhor: p.semanaMelhor });
  };
  DB.pocoAnota = function (andar, semanaId) {
    if (typeof andar !== 'number' || !isFinite(andar) || andar < 1) {
      return responde({ ok: false });
    }
    var d = carrega();
    var p = d.jogador.poco;
    if (semanaId != null && p.semanaId !== semanaId) {
      p.semanaId = semanaId;                 // semana nova: o placar reabre
      p.semanaMelhor = 0;
    }
    andar = Math.floor(andar);
    if (andar > p.semanaMelhor) p.semanaMelhor = andar;
    if (andar > p.recorde) p.recorde = andar;
    grava();
    return responde({ ok: true, recorde: p.recorde, semanaMelhor: p.semanaMelhor });
  };

  // ---------------------------------------------------------------- mutados
  /* OS SILENCIADOS (moderação mínima, 25/08): quem você calou no chat, por
   * id de conta — sobrevive à sessão. A HUD guarda um espelho síncrono para
   * não consultar Promise a cada mensagem. */
  DB.mutados = function () {
    var d = carrega();
    return responde(d.mutados.map(function (m) { return { id: m.id, nome: m.nome || '' }; }));
  };
  DB.mutar = function (id, nome, sim) {
    if (!id) return responde({ ok: false });
    var d = carrega();
    var i = -1;
    for (var k = 0; k < d.mutados.length; k++) if (d.mutados[k].id === id) i = k;
    if (sim && i < 0) d.mutados.push({ id: id, nome: String(nome || '') });
    if (!sim && i >= 0) d.mutados.splice(i, 1);
    grava();
    return responde({ ok: true, total: d.mutados.length });
  };

  // ------------------------------------------------------------------- placar
  /* A última FOTO de cada vizinho que a Rede já viu: nome, título e o resumo
   * da conta (classes com níveis, total). É o que faz o placar funcionar
   * antes do servidor — e quando ele chegar, esta tabela vira a resposta
   * dele, com a mesma cara. */
  DB.placarAnota = function (id, dados) {
    if (!id || !dados) return responde({ ok: false, erro: 'foto vazia' });
    var d = carrega();
    d.placar[String(id)] = {
      nome: dados.nome || '?', titulo: dados.titulo || '',
      resumo: dados.resumo ? JSON.parse(JSON.stringify(dados.resumo)) : null,
      visto: agora()
    };
    grava();
    return responde({ ok: true });
  };
  DB.placarLista = function () {
    var d = carrega();
    var fora = [];
    Object.keys(d.placar).forEach(function (id) {
      var e = d.placar[id];
      fora.push({ id: id, nome: e.nome, titulo: e.titulo,
                  resumo: e.resumo ? JSON.parse(JSON.stringify(e.resumo)) : null,
                  visto: e.visto });
    });
    return responde(fora);
  };

  // -------------------------------------------------------------------- a loja
  /* A LOJA DE VINTÉNS DO SITE (Fase C, 10/09). O jogador compra no site; o
   * jogo retira os pedidos no cartório e os aplica (js/core/loja.js). Aqui
   * mora a ANOTAÇÃO do que este save já tratou:
   *   aplicadas  [id]            entregues aqui: os vinténs saíram do bolso
   *                              e o item entrou no Progress (num CRÉDITO de
   *                              vinténs — loja 2, `lojaCredita` —, entraram)
   *   recusadas  [{id, motivo}]  devolvidos (o servidor estorna)
   * A foto sobe no PUT /api/save de sempre, e o SERVIDOR fecha os pedidos no
   * mesmo BEGIN IMMEDIATE que grava o save — a entrega nunca se separa da
   * versão do save que a contém. Por isso a anotação NÃO se poda pela
   * resposta do PUT: o servidor ignora id já fechado, e com os limites de
   * compra 200 ids levam anos. Passou de 200, sai o mais velho.
   *
   * `lojaAplica` DECIDE E GRAVA de forma síncrona por dentro, como
   * `gastarMoedas`: quem chega segundo com o mesmo id recebe {ja:true},
   * sem janela entre olhar e gravar. Só o bolso paga (o cofre não entra),
   * e o cofre sem fundo do Mestre anota sem descontar. */
  function lojaTeto() { return 200; }
  function idLoja(v) {
    return (typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v) ? v : 0;
  }
  function motivoLoja(m) {
    var aceitos = { 'sem-saldo': 1, 'classe-ja-liberada': 1, 'item-invalido': 1, 'erro-local': 1 };
    return aceitos[m] === 1 ? m : 'erro-local';
  }
  function saneiaLoja(l) {
    var fora = { aplicadas: [], recusadas: [] }, vistos = {}, i;
    if (!l || typeof l !== 'object') return fora;
    var ap = Array.isArray(l.aplicadas) ? l.aplicadas : [];
    for (i = 0; i < ap.length; i++) {
      var a = idLoja(ap[i]);
      if (a && !vistos[a]) { vistos[a] = 1; fora.aplicadas.push(a); }
    }
    var re = Array.isArray(l.recusadas) ? l.recusadas : [];
    for (i = 0; i < re.length; i++) {
      var rid = (re[i] && typeof re[i] === 'object') ? idLoja(re[i].id) : 0;
      if (rid && !vistos[rid]) { vistos[rid] = 1; fora.recusadas.push({ id: rid, motivo: motivoLoja(re[i].motivo) }); }
    }
    if (fora.aplicadas.length > lojaTeto()) fora.aplicadas = fora.aplicadas.slice(-lojaTeto());
    if (fora.recusadas.length > lojaTeto()) fora.recusadas = fora.recusadas.slice(-lojaTeto());
    return fora;
  }
  function lojaDe(d) {
    if (!d.loja || !Array.isArray(d.loja.aplicadas) || !Array.isArray(d.loja.recusadas)) d.loja = saneiaLoja(d.loja);
    return d.loja;
  }
  function lojaTratou(l, id) {
    if (l.aplicadas.indexOf(id) >= 0) return true;
    for (var i = 0; i < l.recusadas.length; i++) if (l.recusadas[i].id === id) return true;
    return false;
  }
  function lojaAnota(lista, v) {
    lista.push(v);
    if (lista.length > lojaTeto()) lista.splice(0, lista.length - lojaTeto());
  }
  DB.lojaVer = function () {
    var l = lojaDe(carrega());
    return responde({ aplicadas: l.aplicadas.slice(),
                      recusadas: l.recusadas.map(function (r) { return { id: r.id, motivo: r.motivo }; }) });
  };
  DB.lojaAplica = function (id, preco) {
    var d = carrega(), l = lojaDe(d);
    id = idLoja(id);
    if (!id) return responde({ ok: false, erro: 'pedido inválido' });
    if (lojaTratou(l, id)) return responde({ ok: false, ja: true });
    preco = Math.max(0, Math.floor(Number(preco) || 0));
    if (bolsoSemFundo()) {                       // o Mestre: anota sem descontar
      lojaAnota(l.aplicadas, id);
      grava();
      return responde({ ok: true, moedas: 999999, semFundo: true });
    }
    if (d.carteira.moedas < preco) {
      return responde({ ok: false, semSaldo: true, moedas: d.carteira.moedas });
    }
    d.carteira.moedas -= preco;
    lojaAnota(l.aplicadas, id);
    grava();
    return responde({ ok: true, moedas: d.carteira.moedas });
  };
  DB.lojaRecusa = function (id, motivo) {
    var d = carrega(), l = lojaDe(d);
    id = idLoja(id);
    if (!id) return responde({ ok: false, erro: 'pedido inválido' });
    if (lojaTratou(l, id)) return responde({ ok: false, ja: true });
    lojaAnota(l.recusadas, { id: id, motivo: motivoLoja(motivo) });
    grava();
    return responde({ ok: true });
  };
  /* A entrega LANÇOU depois do débito: os vinténs voltam e o id passa de
   * aplicadas para recusadas (o servidor estorna no próximo PUT). */
  DB.lojaDesfaz = function (id, preco, motivo) {
    var d = carrega(), l = lojaDe(d);
    id = idLoja(id);
    var i = id ? l.aplicadas.indexOf(id) : -1;
    if (i < 0) return responde({ ok: false, erro: 'pedido não aplicado aqui' });
    l.aplicadas.splice(i, 1);
    if (!bolsoSemFundo()) d.carteira.moedas += Math.max(0, Math.floor(Number(preco) || 0));
    lojaAnota(l.recusadas, { id: id, motivo: motivoLoja(motivo || 'erro-local') });
    grava();
    return responde({ ok: true, moedas: d.carteira.moedas });
  };
  /* O CRÉDITO DE VINTÉNS (loja 2, 10/09): um pacote pago no site (Mercado
   * Pago) ou um presente de vinténs do Mestre chega como pedido de preço 0 com
   * a entrega {tipo:'vintens', alvo:'carteira', qtd}. Como `lojaAplica`, DECIDE
   * E GRAVA de uma vez por dentro: o id já tratado recebe {ja:true}; senão os
   * vinténs entram no BOLSO e o id vai para `aplicadas` no MESMO grava() — um
   * crédito nunca entra duas vezes, nem pela metade. Quantia torta (fora de
   * 1..10.000.000, não inteira) volta {ok:false, erro} sem anotar. O cofre sem
   * fundo do Mestre só anota (o bolso dele já responde 999999). */
  DB.lojaCredita = function (id, qtd) {
    var d = carrega(), l = lojaDe(d);
    id = idLoja(id);
    if (!id) return responde({ ok: false, erro: 'pedido inválido' });
    if (lojaTratou(l, id)) return responde({ ok: false, ja: true });
    if (!(typeof qtd === 'number' && isFinite(qtd) && Math.floor(qtd) === qtd && qtd >= 1 && qtd <= 10000000)) {
      return responde({ ok: false, erro: 'quantia inválida' });
    }
    if (bolsoSemFundo()) {
      lojaAnota(l.aplicadas, id);
      grava();
      return responde({ ok: true, moedas: 999999, semFundo: true });
    }
    d.carteira.moedas += qtd;
    lojaAnota(l.aplicadas, id);
    grava();
    return responde({ ok: true, moedas: d.carteira.moedas, creditou: qtd });
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
