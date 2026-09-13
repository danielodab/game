'use strict';
/* AS OPERAÇÕES DE ECONOMIA NO SERVIDOR — POST /op (dono: servidor).
 *
 * docs/SEGURANCA.md §5.3. Com a autoridade ligada, toda operação que muda o
 * estado econômico da conta roda AQUI, no estado que o servidor guarda, com a
 * MESMA função do jogo (Progress, DB, Missoes, Mercado, Loja, GM). O cliente
 * aplica a mesma coisa na tela e compara o hash; se divergir, adota o daqui.
 *
 * O pedido é TUDO OU NADA: a primeira op com argumento torto (ou proibida)
 * derruba o pedido com 422 e o índice dela — a API não grava nada. Uma op que
 * a regra do jogo simplesmente recusa (equipar sem nível, forja sem pedra)
 * NÃO é erro: devolve o mesmo `false`/`{ok:false}` que devolveria no jogo, e
 * o estado fica igual nos dois lados.
 *
 * Três famílias:
 *   - do jogador: o que a HUD chama (equipar, forjar, roleta, cofre, mercado…);
 *   - INTERNAS: só a API pede (loja, troca, cofre da guilda) — com
 *     `contexto.interno`; um cliente que as mande cai com 'interna';
 *   - do MESTRE: a Caixa do Mestre, só com a marca da conta vinda do banco.
 * O sorteio (forja com risco, roleta) usa o gerador semeado pelo servidor. */
const { mundoEconomico, poeEstado, tiraEstado, iidsDe, diferencaIids } = require('./estado');
const { recusa } = require('./sala');

const OPS_MAX = 40;
const SLOTS = ['punho', 'passo', 'casca', 'lume'];

/* ------------------------------------------------------------ os argumentos */
function falha(msg) { return recusa(msg, 'argumento'); }
function txt(a, nome, opcional) {
  const v = a[nome];
  if (v === undefined || v === null) { if (opcional) return null; throw falha(nome + ' é obrigatório'); }
  if (typeof v !== 'string' || !v || v.length > 80) throw falha(nome + ' precisa ser um texto curto');
  return v;
}
function int(a, nome, min, max, opcional) {
  const v = a[nome];
  if (v === undefined || v === null) { if (opcional) return null; throw falha(nome + ' é obrigatório'); }
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < min || v > max) {
    throw falha(nome + ' precisa ser um inteiro de ' + min + ' a ' + max);
  }
  return v;
}
function bool(a, nome) { return a[nome] === true; }
function lista(a, nome, max) {
  const v = a[nome];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw falha(nome + ' precisa ser uma lista de até ' + max);
  return v;
}
function slot(a) {
  const s = txt(a, 'slot');
  if (SLOTS.indexOf(s) < 0) throw falha('slot desconhecido');
  return s;
}

/* o JSON que volta: sem funções nem ciclos (o resultado de uma função do jogo) */
function limpo(v) {
  if (v === undefined) return null;
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
}

/* ------------------------------------------------------------ as operações */
/* Cada op: (J, args, x) → resultado (ou Promise). `x` = { conta, contexto }. */
const OPS = {
  // ---- herói e equipamento
  equipar: (J, a) => J.Progress.equip(txt(a, 'heroId'), txt(a, 'itemId'), int(a, 'invIndex', 0, 9999, true)),
  desequipar: (J, a) => J.Progress.unequip(txt(a, 'heroId'), slot(a)),
  equiparPet: (J, a) => J.Progress.equipPet(txt(a, 'heroId'), txt(a, 'petId')),
  soltarPet: (J, a) => J.Progress.unequipPet(txt(a, 'heroId')),
  salvarTraje: (J, a) => J.Progress.saveTraje(txt(a, 'heroId'), int(a, 'n', 1, 9)),
  vestirTraje: (J, a) => J.Progress.wearTraje(txt(a, 'heroId'), int(a, 'n', 1, 9)),
  devolvidasPorNivel: (J) => J.Progress.devolvidasPorNivel(true),

  // ---- elementos e pergaminhos
  escolherElemento: (J, a) => J.Progress.chooseElement(txt(a, 'heroId'), txt(a, 'elemento')),
  liberarElemento: (J, a) => J.Progress.liberaElemento(txt(a, 'heroId'), txt(a, 'elemento')),
  trocarElemento: (J, a) => J.Progress.trocaElemento(txt(a, 'heroId'), txt(a, 'elemento')),
  reescreverElemento: (J, a) => J.Progress.reescreveElemento(txt(a, 'heroId'), txt(a, 'velho'), txt(a, 'novo')),
  escolherSeloElemento: (J, a) => J.Progress.escolheSeloElemento(txt(a, 'elemento')),
  lerPergaminhoXp: (J) => J.Progress.lePergaminhoXp(),

  // ---- forja, fusão de peças e roleta (sorteio do servidor)
  forjarPeca: (J, a) => J.Progress.upgradeItem(int(a, 'invIndex', 0, 9999), bool(a, 'usarGuarda')),
  forjarVestida: (J, a) => J.Progress.upgradeWorn(txt(a, 'heroId'), slot(a), bool(a, 'usarGuarda')),
  fundirPeca: (J, a) => J.Progress.fuseItem(int(a, 'invIndex', 0, 9999)),
  girarRoleta: (J) => J.Progress.giraRoleta(),

  // ---- o cofre (o mesmo passo a passo da HUD: hud.js, sheetBanco)
  depositarMoedas: (J, a) => {
    const n = int(a, 'n', 1, 1e12);
    return J.DB.depositarMoedas(n).then((r) => {
      if (!r || !r.ok || !J.Missoes) return r;
      return J.Missoes.registra({ tipo: 'deposito', valor: n, cofreTotal: r.banco || 0 }).then(() => r);
    });
  },
  sacarMoedas: (J, a) => J.DB.sacarMoedas(int(a, 'n', 1, 1e12)),
  depositarItem: (J, a) => {
    const i = int(a, 'invIndex', 0, 9999);
    const st = J.Progress.state;
    const entrada = st.inventory[i];
    if (!entrada) return { ok: false, erro: 'essa peça já saiu' };
    st.inventory.splice(i, 1);
    J.Progress.save();
    return J.DB.depositarItem(entrada);
  },
  sacarItem: (J, a) => {
    const i = int(a, 'indice', 0, 9999);
    if (!J.Progress.bagFree(1)) return { ok: false, erro: 'O saco está cheio — não cabe mais nada.' };
    return J.DB.sacarItem(i).then((r) => {
      if (!r || !r.ok) return r;
      J.Progress.state.inventory.push(J.Progress.carimba(r.item, 'banco'));
      J.Progress.save();
      return r;
    });
  },

  // ---- missões
  reivindicarMissao: (J, a) => J.Missoes.reivindicar(txt(a, 'id')),

  // ---- o mercado de antes (a oferta no db da própria conta). 13/09: o mercadinho é ENTRE
  // CONTAS e mora no servidor (servidor/mercado.py, /api/mercado/*): anunciar aqui punha a
  // oferta num balcão que ninguém mais via. A aba velha que ainda mande estas ops leva 422
  // e adota o estado do servidor; as ofertas antigas viram anúncios pela migração da API
  // (mercadoLegadoTira), com a série — nada precisa ser retirado por aqui.
  anunciarMercado: () => { throw recusa('o mercadinho agora é entre contas, pelo servidor: abra o Mercadinho de novo', 'mercado'); },
  comprarMercado: () => { throw recusa('o mercadinho agora é entre contas, pelo servidor: abra o Mercadinho de novo', 'mercado'); },
  retirarMercado: () => { throw recusa('o mercadinho agora é entre contas, pelo servidor: abra o Mercadinho de novo', 'mercado'); },

  // ---- o título: só o que a régua dá (o pódio vem do ranking do servidor)
  definirTitulo: (J, a, x) => {
    const t = txt(a, 'titulo', true);
    if (!t) return J.DB.definirTitulo(null);
    return J.DB.chefesVer().then((chefes) => {
      // 13/09: o pódio de cada classe ("Top N <classe>") — a posição vem da API, os nomes do DATA
      const nomesClasse = {};
      Object.keys(J.DATA.classes || {}).forEach((cid) => {
        const d = J.DATA.classes[cid];
        if (cid !== 'gm' && d && d.name) nomesClasse[cid] = d.name;
      });
      const pc = (x.contexto.porClasse && typeof x.contexto.porClasse === 'object') ? x.contexto.porClasse : {};
      const estado = { chefes: chefes || {}, pvm: x.contexto.pvm || null, pvp: x.contexto.pvp || null,
                       porClasse: pc, classeNomes: nomesClasse };
      if (!J.Titulos || !J.Titulos.valido(t, estado)) return { ok: false, erro: 'título não conquistado' };
      return J.DB.definirTitulo(t);
    });
  }
};

/* As INTERNAS: só a API pede, com contexto.interno. */
const INTERNAS = {
  // a entrega de um pedido da loja, com a entrega congelada no banco
  lojaEntregar: (J, a) => {
    const p = a.pedido;
    if (!p || typeof p !== 'object' || typeof p.id !== 'number') throw falha('pedido inválido');
    return J.Loja.aplicar({ id: p.id, entrega: p.entrega, preco: p.preco });
  },
  // a troca: tira de quem dá (peças por série, bichos soltos e vinténs)…
  trocaTira: (J, a) => {
    const iids = lista(a, 'iids', 64), pets = lista(a, 'pets', 6);
    const moedas = int(a, 'moedas', 0, 1e12, true) || 0;
    const st = J.Progress.state;
    const itens = [];
    for (const iid of iids) {
      if (typeof iid !== 'string') throw falha('iid inválido');
      const i = st.inventory.findIndex((e) => e && e.iid === iid);
      if (i < 0) throw recusa('a peça ' + iid + ' não está no saco', 'falta');
      itens.push(st.inventory.splice(i, 1)[0]);
    }
    const saem = [];
    if (!st.petCards || typeof st.petCards !== 'object') st.petCards = {};
    if (!st.petXp || typeof st.petXp !== 'object') st.petXp = {};
    for (const pid of pets) {
      if (typeof pid !== 'string') throw falha('petId inválido');
      const ip = st.pets.indexOf(pid);
      if (ip < 0) throw recusa('o bicho ' + pid + ' não está solto', 'falta');
      st.pets.splice(ip, 1);
      saem.push({ petId: pid, xp: Math.floor(Number(st.petXp[pid]) || 0), cartas: Math.floor(Number(st.petCards[pid]) || 0) });
      delete st.petCards[pid];
      delete st.petXp[pid];
    }
    J.Progress.save();
    const paga = moedas > 0 ? J.DB.gastarMoedas(moedas) : Promise.resolve({ ok: true });
    return paga.then((r) => {
      if (!r || !r.ok) throw recusa('vinténs insuficientes para a troca', 'moedas');
      return { itens, pets: saem, moedas };
    });
  },
  // …e põe em quem recebe
  trocaPoe: (J, a) => {
    const itens = lista(a, 'itens', 64), pets = lista(a, 'pets', 6);
    const moedas = int(a, 'moedas', 0, 1e12, true) || 0;
    const st = J.Progress.state, P = J.Progress;
    const limite = P.bagLimit ? P.bagLimit() : Infinity;
    if (st.inventory.length + itens.length > limite) throw recusa('o saco não tem espaço para o que vem', 'saco');
    for (const e of itens) {
      if (!e || typeof e.itemId !== 'string' || !(J.DATA.items || {})[e.itemId] || typeof e.iid !== 'string') {
        throw falha('peça da troca inválida');
      }
      st.inventory.push({ itemId: e.itemId, level: Math.max(0, Math.floor(Number(e.level) || 0)),
                          stars: Math.max(0, Math.floor(Number(e.stars) || 0)), iid: e.iid });
    }
    if (!st.petCards || typeof st.petCards !== 'object') st.petCards = {};
    if (!st.petXp || typeof st.petXp !== 'object') st.petXp = {};
    const tab = P.PET_XP_TABLE || [0];
    for (const p of pets) {
      if (!p || typeof p.petId !== 'string' || !(J.DATA.pets || {})[p.petId]) throw falha('bicho da troca inválido');
      if (P.petOwned(p.petId)) throw recusa('já tem esse bicho — é um de cada', 'pet');
      st.petCards[p.petId] = Math.max(Math.floor(Number(st.petCards[p.petId]) || 0),
                                      Math.min(10000, Math.max(P.PET_UNLOCK_COST || 5, Math.floor(Number(p.cartas) || 0))));
      st.petXp[p.petId] = Math.min(Math.max(0, Math.floor(Number(p.xp) || 0)), tab[tab.length - 1] || 0);
      st.pets.push(p.petId);
    }
    P.save();
    return (moedas > 0 ? J.DB.ganharMoedas(moedas) : Promise.resolve({ ok: true })).then(() => ({ ok: true }));
  },
  // o cofre da guilda: a peça sai do saco do dono…
  bancoGuildaTira: (J, a) => {
    const iid = txt(a, 'iid');
    const st = J.Progress.state;
    const i = st.inventory.findIndex((e) => e && e.iid === iid);
    if (i < 0) throw recusa('a peça não está no saco', 'falta');
    const item = st.inventory.splice(i, 1)[0];
    J.Progress.save();
    return { item };
  },
  // …e entra no saco de quem pega (a própria série, ou uma cópia nova do empréstimo)
  bancoGuildaPoe: (J, a) => {
    const it = a.item;
    if (!it || typeof it.itemId !== 'string' || !(J.DATA.items || {})[it.itemId]) throw falha('peça inválida');
    if (!J.Progress.bagFree(1)) throw recusa('o saco está cheio', 'saco');
    const lv = Math.max(0, Math.floor(Number(it.level) || 0)), stars = Math.max(0, Math.floor(Number(it.stars) || 0));
    const iid = txt(a, 'iid', true);
    const entrada = iid ? { itemId: it.itemId, level: lv, stars, iid }
                        : J.Progress.novaCopia(it.itemId, 'banco', lv, stars);
    J.Progress.state.inventory.push(entrada);
    J.Progress.save();
    return { ok: true, iid: entrada.iid };
  },

  /* O MERCADINHO ENTRE CONTAS (13/09, servidor/mercado.py). A peça anunciada fica em
   * custódia no servidor, fora do estado de qualquer conta; a API pede estas ops e
   * grava os estados numa transação. */
  // anunciar: a peça sai do saco do vendedor pela série
  mercadoTira: (J, a) => {
    const iid = txt(a, 'iid');
    const st = J.Progress.state;
    const i = st.inventory.findIndex((e) => e && e.iid === iid);
    if (i < 0) throw recusa('a peça não está no saco', 'falta');
    const item = st.inventory.splice(i, 1)[0];
    J.Progress.save();
    return { item };
  },
  // comprar e retirar: a peça entra no saco (a própria série; o anúncio antigo sem série
  // ganha uma cópia nova cunhada aqui, origem 'mercador')
  mercadoPoe: (J, a) => {
    const it = a.item;
    if (!it || typeof it.itemId !== 'string' || !(J.DATA.items || {})[it.itemId]) throw falha('peça inválida');
    if (!J.Progress.bagFree(1)) throw recusa('o saco está cheio', 'saco');
    const lv = Math.max(0, Math.floor(Number(it.level) || 0)), stars = Math.max(0, Math.floor(Number(it.stars) || 0));
    const iid = (typeof it.iid === 'string' && it.iid) ? it.iid : null;
    if (iid && J.Progress.state.inventory.some((e) => e && e.iid === iid)) throw recusa('a série já está no saco', 'duplicada');
    const entrada = iid ? { itemId: it.itemId, level: lv, stars, iid }
                        : J.Progress.novaCopia(it.itemId, 'mercador', lv, stars);
    J.Progress.state.inventory.push(entrada);
    J.Progress.save();
    return { ok: true, iid: entrada.iid };
  },
  /* o comprador paga: PRIMEIRO do saco, o que faltar do banco (o pedido do dono: "saldo
   * no saco ou no banco, ou saco+banco"). Direto nos números do db, e não pelo
   * DB.gastarMoedas: o bolso sem fundo do Mestre não pode virar vintém de graça no saco
   * do vendedor. */
  mercadoPaga: (J, a) => {
    const valor = int(a, 'valor', 1, 1e12);
    const d = J.DB.exportar();
    const saco = Math.max(0, Math.floor(Number(d.carteira && d.carteira.moedas) || 0));
    const banco = Math.max(0, Math.floor(Number(d.banco && d.banco.moedas) || 0));
    if (saco + banco < valor) throw recusa('vinténs insuficientes (saco + banco)', 'moedas');
    const deCarteira = Math.min(saco, valor), deBanco = valor - deCarteira;
    d.carteira.moedas = saco - deCarteira;
    d.banco.moedas = banco - deBanco;
    J.DB.importar(d);
    return { ok: true, deCarteira, deBanco };
  },
  // o vendedor recebe o valor menos a taxa, no saco
  mercadoRecebe: (J, a) => J.DB.ganharMoedas(int(a, 'valor', 1, 1e12)).then((r) => ({ ok: !!(r && r.ok) })),
  // a migração: as ofertas do jogador que ainda moram no db saem (viram anúncios na API)
  mercadoLegadoTira: (J) => J.DB.mercadoLer().then((mc) => {
    const ofertas = (mc && Array.isArray(mc.ofertas)) ? mc.ofertas : [];
    const saem = ofertas.filter((o) => o && o.vendedor === 'jogador').map((o) => ({
      itemId: o.itemId, level: o.level || 0, stars: o.stars || 0,
      iid: (typeof o.iid === 'string' && o.iid) ? o.iid : null, preco: o.preco
    }));
    // a banca velha do mercador-fantasma sai junto (o JOGO.Mercado.abrir já a limpava)
    return J.DB.mercadoGravar({ dia: (mc && mc.dia) || null, ofertas: [] }).then(() => ({ ofertas: saem }));
  })
};

/* As do MESTRE: a Caixa, só com a marca da conta vinda do banco. */
const MESTRE = {
  gmAparelha: (J) => J.GM.aparelha(),
  gmPegaItem: (J, a) => J.GM.pegaItem(txt(a, 'itemId')),
  gmPegaSet: (J, a) => J.GM.pegaSet(txt(a, 'setId')),
  gmPegaPet: (J, a) => J.GM.pegaPet(txt(a, 'petId'), bool(a, 'topo')),
  gmPegaPedras: (J, a) => J.GM.pegaPedras(txt(a, 'stoneId'), int(a, 'n', 1, 99999)),
  gmPegaSelos: (J, a) => J.GM.pegaSelos(txt(a, 'elemento'), int(a, 'n', 1, 99999)),
  gmPegaInsignias: (J, a) => J.GM.pegaInsignias(int(a, 'n', 1, 99999)),
  gmPegaCartas: (J, a) => J.GM.pegaCartas(txt(a, 'classId'), int(a, 'n', 1, 99999)),
  gmPegaPergaminho: (J, a) => J.GM.pegaPergaminho(txt(a, 'tipo'), int(a, 'n', 1, 99)),
  gmPegaBonusXp: (J, a) => J.GM.pegaBonusXp(int(a, 'dias', 1, 365))
};

function acha(nome, x) {
  if (Object.prototype.hasOwnProperty.call(OPS, nome)) return OPS[nome];
  if (Object.prototype.hasOwnProperty.call(INTERNAS, nome)) {
    if (!x.contexto.interno) throw recusa('a operação ' + nome + ' é só do servidor', 'interna');
    return INTERNAS[nome];
  }
  if (Object.prototype.hasOwnProperty.call(MESTRE, nome)) {
    if (!x.conta.gm) throw recusa('a operação ' + nome + ' é só do Mestre', 'gm');
    return MESTRE[nome];
  }
  throw recusa('operação desconhecida: ' + String(nome), 'desconhecida');
}

/* corpo = { conta: {id, gm}, progress, db, ops: [{nome, args}], semente, contexto: {agoraMs, pvm, pvp, interno} } */
async function executa(corpo) {
  const c = corpo || {};
  const ops = Array.isArray(c.ops) ? c.ops : null;
  if (!ops || !ops.length || ops.length > OPS_MAX) throw recusa('ops precisa ser uma lista de 1 a ' + OPS_MAX, 'entrada');
  const conta = { id: (c.conta && c.conta.id) || 0, gm: !!(c.conta && c.conta.gm) };
  const contexto = Object.assign({ pvm: null, pvp: null, interno: false }, c.contexto || {});
  const w = mundoEconomico({ gm: conta.gm, contaId: conta.id, agoraMs: contexto.agoraMs,
                             semente: (typeof c.semente === 'number') ? c.semente : undefined });
  poeEstado(w, c.progress, c.db);
  const J = w.J;
  J.Progress._forjaRng = w.rng;
  J.Progress._roletaRng = w.rng;
  const antes = tiraEstado(w);
  const iidsAntes = iidsDe(antes.progress, antes.db);
  const fila = [];
  const x = { conta, contexto };
  const resultados = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (!op || typeof op !== 'object' || typeof op.nome !== 'string') throw recusa('op torta', 'entrada');
      const args = (op.args && typeof op.args === 'object' && !Array.isArray(op.args)) ? op.args : {};
      const fn = acha(op.nome, x);
      const r = await fn(J, args, x);
      resultados.push(limpo(r));
      // a fila de nascimentos guarda a origem de cada série nova; o saneamento a esvazia
      const q = J.Progress.state && J.Progress.state.nascimentos;
      if (Array.isArray(q)) { fila.push(...q); q.length = 0; }
    } catch (e) {
      if (e && e.juiz) { e.indice = i; throw e; }
      const r2 = recusa('a operação ' + i + ' falhou: ' + (e && e.message), 'erro');
      r2.indice = i;
      throw r2;
    }
  }
  const depois = tiraEstado(w);
  const iids = diferencaIids(iidsAntes, iidsDe(depois.progress, depois.db), fila);
  /* A CÓPIA EMPRESTADA DO BANCO DA GUILDA (13/09): ela some na devolução, então
   * nenhuma op do jogador pode fazê-la sair do estado antes (a fusão consome
   * cópias e cunharia uma peça nova e SUA com ela). A API manda a lista em
   * contexto.bloqueados; as internas (a própria devolução) passam. */
  if (!contexto.interno && Array.isArray(contexto.bloqueados) && contexto.bloqueados.length) {
    const presas = new Set(contexto.bloqueados.filter((x) => typeof x === 'string'));
    const saiu = iids.fora.find((iid) => presas.has(iid));
    if (saiu) throw recusa('peça emprestada do banco da guilda não sai do saco: devolva primeiro', 'emprestada');
  }
  return {
    ok: true,
    progress: depois.progress,
    db: depois.db,
    hash: depois.hash,
    hashAntes: antes.hash,
    resultados,
    iids,
    guildaXp: w.anotado.guildaXp
  };
}

function rotas(registra) {
  registra('POST', '/op', (corpo) => executa(corpo));
}

module.exports = { executa, rotas, OPS, INTERNAS, MESTRE };
