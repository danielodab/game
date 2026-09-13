#!/usr/bin/env node
'use strict';
/* PROVA DO CLIENTE DO MERCADINHO ENTRE CONTAS (js/core/mercado.js, JOGO.Mercado.servidor).
 *
 *   node tests/mercado_cliente.js
 *
 * Sem navegador e sem servidor: o mercado.js roda num contexto vm com a Sessao, a
 * Autoridade, a UI e o Game de mentira. Cobra:
 *   - a rota que muda o estado sobe a fila de ops ANTES e adota o estado que volta;
 *   - a leitura não sobe fila; o anúncio vai pela série;
 *   - o vigia: pergunta na entrada da praça, não pergunta na batalha, a confirmação
 *     só na praça e uma por vez, as notícias viram avisos e são marcadas como vistas,
 *     a confirmação fechada sem resposta é adiada e a volta à praça a traz de novo;
 *   - a taxa inteira (60 → 3, não 4). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + JSON.stringify(extra) : ''));
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function mundo() {
  const log = { pedidos: [], descarregou: 0, adotou: [], avisos: [], confirmou: [], mudou: 0 };
  const estado = { tela: 'menu', screen: 'menu', ligada: true, mostrando: false, respostas: {} };
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 1, Promise, JSON, Math, Date, encodeURIComponent,
    window: {}
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.JOGO = {
    DATA: { items: { 'gh-wasp-sting': { name: 'Ferrão de Vespa', rarity: 'comum', slot: 'punho' } } },
    Sessao: {
      api(rota, op) {
        log.pedidos.push({ rota, op, descarregouAntes: log.descarregou });
        const fn = estado.respostas[rota.split('?')[0]];
        return Promise.resolve(fn ? fn(rota, op) : { ok: true, status: 200 });
      }
    },
    Autoridade: {
      ligada: () => estado.ligada,
      descarrega: () => { log.descarregou++; return Promise.resolve(null); },
      adotaResposta: (r) => { log.adotou.push(r); return true; }
    },
    UI: { telaAtual: () => estado.tela },
    Game: { get screen() { return estado.screen; } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'mercado.js'), 'utf8'), ctx,
                  { filename: 'mercado.js' });
  const Srv = ctx.JOGO.Mercado.servidor;
  Srv.vigia({
    confirma: (p) => { log.confirmou.push(p.id); estado.mostrando = true; },
    estaMostrando: () => estado.mostrando,
    podeMostrar: () => estado.tela === 'hub',
    avisa: (t) => { log.avisos.push(...t); },
    mudou: () => { log.mudou++; }
  });
  return { ctx, M: ctx.JOGO.Mercado, Srv, log, estado };
}

(async function () {
  // ---- as rotas
  {
    const { M, Srv, log, estado } = mundo();
    check('a taxa é inteira: 60 → 3, 100 → 5, 1 → 1, 150 → 8',
          M.taxaDe(60) === 3 && M.taxaDe(100) === 5 && M.taxaDe(1) === 1 && M.taxaDe(150) === 8);
    estado.respostas['/api/mercado/comprar'] = () => ({ ok: true, status: 200, versao: 7, hash: 'abcd', progress: { a: 1 }, db: { b: 2 } });
    const r = await Srv.comprar(12);
    const p = log.pedidos[0];
    check('comprar sobe a fila antes e manda o anúncio', p.rota === '/api/mercado/comprar' && p.descarregouAntes === 1 &&
          p.op.method === 'POST' && p.op.body.anuncioId === 12, p);
    check('o estado que volta é adotado', log.adotou.length === 1 && log.adotou[0] === r);
    await Srv.item('gh-wasp-sting');
    const q = log.pedidos[1];
    check('a leitura não sobe fila e leva o id na consulta', q.rota === '/api/mercado/item?id=gh-wasp-sting' &&
          q.descarregouAntes === 1 && !q.op, q);
    await Srv.anunciar({ itemId: 'gh-wasp-sting', iid: 'jabc' }, 99.7, 3);
    check('o anúncio vai pela série', JSON.stringify(log.pedidos[2].op.body) === JSON.stringify({ preco: 99, iid: 'jabc' }),
          log.pedidos[2].op.body);
    await Srv.anunciar({ itemId: 'gh-wasp-sting' }, 10, 3);
    check('sem série, pelo índice', log.pedidos[3].op.body.invIndex === 3);
    estado.respostas['/api/mercado/propor'] = () => ({ ok: false, status: 409, erro: 'x', motivo: 'saldo' });
    const r2 = await Srv.propor(5, 40);
    check('a recusa volta inteira e não adota', r2.motivo === 'saldo' && log.adotou.length === 1);
  }

  // ---- o vigia
  {
    const { Srv, log, estado } = mundo();
    const proposta = { id: 41, anuncioId: 9, itemId: 'gh-wasp-sting', level: 1, stars: 0, preco: 200, valor: 150,
                       estado: 'aceita', vendedor: 'Fulano' };
    let avisos = { ok: true, status: 200, confirmar: [proposta, Object.assign({}, proposta, { id: 42 })],
                   desfechos: [{ id: 7, estado: 'perdida', itemId: 'gh-wasp-sting', valor: 30 }],
                   vendas: [{ id: 3, itemId: 'gh-wasp-sting', level: 0, stars: 0, valor: 100, taxa: 5, recebeu: 95,
                              comprador: 'Beltrano' }],
                   recebidas: [] };
    estado.respostas['/api/mercado/avisos'] = () => avisos;
    estado.respostas['/api/mercado/visto'] = () => ({ ok: true, status: 200 });
    const pediuAvisos = () => log.pedidos.filter((x) => x.rota === '/api/mercado/avisos').length;

    estado.screen = 'battle'; estado.tela = 'battle';
    Srv._tique();
    await espera(5);
    check('na batalha o vigia não pergunta', pediuAvisos() === 0);

    estado.screen = 'menu'; estado.tela = 'hub';
    Srv._tique();
    await espera(5);
    check('ao entrar na praça, pergunta', pediuAvisos() === 1);
    check('a confirmação aparece na praça, uma só', JSON.stringify(log.confirmou) === JSON.stringify([41]), log.confirmou);
    const visto = log.pedidos.find((x) => x.rota === '/api/mercado/visto');
    check('as notícias viram avisos e são marcadas como vistas',
          log.avisos.length === 2 && /Beltrano/.test(log.avisos[0].texto) && /perdeu essa negociação/.test(log.avisos[1].texto) &&
          visto && JSON.stringify(visto.op.body) === JSON.stringify({ desfechos: [7], vendas: [3], recebidas: [] }),
          { avisos: log.avisos, visto: visto && visto.op.body });

    Srv._tique();
    await espera(5);
    check('com uma na tela, o tique não mostra outra', log.confirmou.length === 1 && pediuAvisos() === 1);

    // o jogador respondeu a primeira: a segunda vem depois
    estado.mostrando = false;
    Srv.respondeuConfirmacao(proposta, 'feito');
    await espera(800);
    check('respondida a primeira, vem a segunda', JSON.stringify(log.confirmou) === JSON.stringify([41, 42]), log.confirmou);

    // fechou a segunda no ✕ sem responder: adiada, não volta no próximo tique
    estado.mostrando = false;
    avisos = Object.assign({}, avisos, { confirmar: [Object.assign({}, proposta, { id: 42 })], desfechos: [], vendas: [] });
    Srv._tique();
    await espera(5);
    check('fechada sem resposta, fica adiada', log.confirmou.length === 2 && Srv._vigia().adiados[42] > Date.now());

    // fora da praça não mostra; na volta à praça pergunta de novo e mostra
    estado.tela = 'antessala';
    Srv._tique();
    await espera(5);
    const antes = pediuAvisos();
    estado.tela = 'hub';
    Srv._tique();
    await espera(5);
    check('a volta à praça pergunta de novo e traz a adiada', pediuAvisos() === antes + 1 &&
          JSON.stringify(log.confirmou) === JSON.stringify([41, 42, 42]), { pedidos: pediuAvisos(), c: log.confirmou });

    // muitos avisos viram um resumo no fim
    estado.mostrando = true;
    avisos = { ok: true, status: 200, confirmar: [], desfechos: [1, 2, 3, 4, 5].map((i) => ({ id: i, estado: 'recusada',
               itemId: 'gh-wasp-sting', valor: 9, vendedor: 'Ciclano' })), vendas: [], recebidas: [] };
    log.avisos.length = 0;
    await Srv.buscaAvisos();
    check('mais de 3 avisos: 3 e um resumo', log.avisos.length === 4 && /E mais 2 avisos/.test(log.avisos[3].texto), log.avisos);

    estado.ligada = false;
    const n = pediuAvisos();
    Srv._tique();
    await espera(5);
    check('sem a autoridade ligada o vigia não pergunta', pediuAvisos() === n);
  }

  console.log(falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
