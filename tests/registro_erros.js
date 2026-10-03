#!/usr/bin/env node
'use strict';
/* PROVA DO REGISTRO DE ERROS NO CLIENTE (02/10): js/core/registro_erros.js.
 *
 *   node tests/registro_erros.js
 *
 * Carrega o arquivo do jogo num contexto do Node (o mesmo arquivo que o index.html
 * põe primeiro na lista) e cobra:
 *   · o navegador vira "família versão · sistema" (nada do User-Agent inteiro);
 *   · a pilha perde o domínio e a consulta (?v=, ?api=), fica com 8 quadros, e o
 *     "Uncaught " do Chrome sai da mensagem;
 *   · o erro de extensão do navegador e o "Script error." vazio ficam de fora;
 *   · o coletor junta repetidos num lote só (com `vezes`), respeita o teto de erros
 *     distintos por sessão, o teto por minuto e o de pedidos por sessão, e desliga
 *     com um 429 ou um 404 do servidor;
 *   · a conta NUNCA vai no corpo (o servidor a tira do token);
 *   · `liga` numa janela de mentira: em file:// não escuta nada; servida, o evento
 *     'error' e o 'unhandledrejection' viram um POST /api/registro/erros pelo
 *     JOGO.Sessao.api, com keepalive; em casa sem API (localhost sem ?api=), não manda. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}
const FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'registro_erros.js'), 'utf8');

function carrega() {
  const ctx = { console, Promise, setTimeout, clearTimeout };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  return ctx.JOGO.RegistroErros;
}

// um relógio e uma agenda de mentira: o tempo anda só quando a prova manda
function ambiente(respostas) {
  const amb = { t: 1000000, fila: [], corpos: [] };
  amb.agora = () => amb.t;
  amb.agenda = (fn, ms) => amb.fila.push({ fn, quando: amb.t + ms });
  amb.anda = (ms) => {
    amb.t += ms;
    const prontos = amb.fila.filter((x) => x.quando <= amb.t);
    amb.fila = amb.fila.filter((x) => x.quando > amb.t);
    prontos.forEach((x) => x.fn());
  };
  amb.envia = (corpo) => { amb.corpos.push(corpo); return Promise.resolve((respostas && respostas.shift()) || { ok: true, status: 200 }); };
  amb.contexto = () => ({ versao: 'abc123', tela: 'hub', navegador: 'Chrome 120 · Windows' });
  return amb;
}
const espera = () => new Promise((r) => setTimeout(r, 0));

(async function () {
  const R = carrega();

  // ---- o navegador resumido
  const UAS = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Safari/537.36', 'Chrome 120 · Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.61', 'Edge 120 · Windows'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36', 'Samsung 23 · Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1', 'Safari 17 · iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox 121 · Linux'],
  ];
  UAS.forEach(([ua, esperado]) => check('navegador: ' + esperado, R.navegador(ua) === esperado, R.navegador(ua)));
  check('navegador: sem User-Agent', R.navegador(undefined) === '? · ?');

  // ---- a normalização
  const pilha = ['TypeError: x is undefined',
    ...Array.from({ length: 12 }, (_, i) => '    at f' + i + ' (https://soterra.viidoo.io/js/ui/hud.js?v=3fa2b1c9d0e1:' + (100 + i) + ':7)')].join('\n');
  const n = R.normaliza({ mensagem: 'Uncaught TypeError: x is undefined', pilha, arquivo: 'https://soterra.viidoo.io/js/ui/hud.js?v=3fa2b1c9d0e1', linha: 100, coluna: 7 });
  check('normaliza: o "Uncaught " sai da mensagem', n.mensagem === 'TypeError: x is undefined', n.mensagem);
  check('normaliza: a pilha sem a 1ª linha repetida, sem domínio e sem ?v=, com 8 quadros',
        n.pilha.split('\n').length === R.PILHA_LINHAS && n.pilha.split('\n')[0] === 'at f0 (/js/ui/hud.js:100:7)' &&
        !/viidoo|\?v=/.test(n.pilha), n.pilha);
  check('normaliza: onde = arquivo:linha:coluna sem domínio', n.onde === '/js/ui/hud.js:100:7', n.onde);
  check('normaliza: mensagem cortada', R.normaliza({ mensagem: 'x'.repeat(1000) }).mensagem.length === R.MSG_MAX);
  check('normaliza: a consulta ?api= some da pilha',
        !/api=/.test(R.normaliza({ mensagem: 'm', pilha: 'at a (http://localhost:8137/js/core/sessao.js?api=http://127.0.0.1:8300:5:1)' }).pilha));
  check('normaliza: erro de extensão fica de fora',
        R.normaliza({ mensagem: 'm', pilha: 'at x (chrome-extension://abcdef/conteudo.js:1:1)' }) === null);
  check('normaliza: "Script error." sem nada fica de fora', R.normaliza({ mensagem: 'Script error.' }) === null);
  check('normaliza: mensagem vazia fica de fora', R.normaliza({ mensagem: '   ' }) === null);
  check('normaliza: a promessa é "promessa"', R.normaliza({ tipo: 'promessa', mensagem: 'm' }).tipo === 'promessa');

  // ---- o coletor: repetidos num lote só
  let amb = ambiente();
  let c = R.cria(amb);
  for (let i = 0; i < 5; i++) c.anota({ mensagem: 'TypeError: repetido', arquivo: 'http://x/js/a.js?v=1', linha: 3 });
  c.anota({ mensagem: 'RangeError: outro' });
  check('coletor: nada sai antes da espera', amb.corpos.length === 0);
  amb.anda(R.ESPERA_MS);
  await espera();
  check('coletor: um pedido só, com os dois distintos', amb.corpos.length === 1 && amb.corpos[0].erros.length === 2,
        JSON.stringify(amb.corpos));
  const rep = amb.corpos[0].erros.find((e) => e.mensagem === 'TypeError: repetido');
  check('coletor: o repetido vai uma vez, com vezes = 5', rep && rep.vezes === 5, JSON.stringify(rep));
  check('coletor: versão, tela e navegador no corpo',
        amb.corpos[0].versao === 'abc123' && amb.corpos[0].tela === 'hub' && amb.corpos[0].navegador === 'Chrome 120 · Windows');
  check('coletor: a conta NÃO vai no corpo', !/conta/i.test(JSON.stringify(Object.keys(amb.corpos[0]))) &&
        amb.corpos[0].erros.every((e) => !('conta' in e)));
  c.anota({ mensagem: 'TypeError: repetido', arquivo: 'http://x/js/a.js?v=2', linha: 3 });
  amb.anda(R.ESPERA_MS);
  await espera();
  check('coletor: o mesmo erro depois do envio volta com vezes = 1 (outro deploy, mesma chave)',
        amb.corpos.length === 2 && amb.corpos[1].erros.length === 1 && amb.corpos[1].erros[0].vezes === 1,
        JSON.stringify(amb.corpos[1]));

  // ---- o teto por minuto
  amb = ambiente(); c = R.cria(amb);
  let aceitos = 0;
  for (let i = 0; i < R.MAX_POR_MINUTO + 7; i++) if (c.anota({ mensagem: 'm ' + (i % 3) })) aceitos++;
  check('coletor: no máximo MAX_POR_MINUTO ocorrências por minuto', aceitos === R.MAX_POR_MINUTO && c.estado().descartados === 7,
        aceitos + ' / ' + JSON.stringify(c.estado()));
  amb.anda(60001);
  await espera();
  check('coletor: passado o minuto, aceita de novo', c.anota({ mensagem: 'm 0' }) === true);

  // ---- o teto de distintos por sessão
  amb = ambiente(); c = R.cria(amb);
  for (let i = 0; i < R.MAX_DISTINTOS; i++) { c.anota({ mensagem: 'distinto ' + i }); amb.t += 7000; }
  check('coletor: o distinto além do teto da sessão não entra', c.anota({ mensagem: 'distinto novo' }) === false &&
        c.estado().distintos === R.MAX_DISTINTOS, JSON.stringify(c.estado()));
  check('coletor: um já visto ainda soma', c.anota({ mensagem: 'distinto 0' }) === true);

  // ---- o teto de pedidos por sessão
  amb = ambiente(); c = R.cria(amb);
  for (let i = 0; i < R.MAX_ENVIOS + 5; i++) {
    c.anota({ mensagem: 'envio ' + (i % 4) });
    amb.anda(60001);
    await espera();
  }
  check('coletor: no máximo MAX_ENVIOS pedidos por sessão', amb.corpos.length === R.MAX_ENVIOS && c.estado().desligado,
        amb.corpos.length + ' pedidos');

  // ---- 429 e 404 desligam
  for (const st of [429, 404]) {
    amb = ambiente([{ ok: false, status: st }]); c = R.cria(amb);
    c.anota({ mensagem: 'antes do ' + st });
    amb.anda(R.ESPERA_MS);
    await espera(); await espera();
    const depois = c.anota({ mensagem: 'depois do ' + st });
    amb.anda(R.ESPERA_MS);
    await espera();
    check('coletor: um ' + st + ' desliga o registro da aba', !depois && amb.corpos.length === 1 && c.estado().desligado);
  }

  // ---- o envio que quebra não vira erro
  amb = ambiente(); amb.envia = () => { throw new Error('rede'); };
  c = R.cria(amb);
  c.anota({ mensagem: 'x' });
  let quebrou = false;
  try { amb.anda(R.ESPERA_MS); await espera(); } catch (e) { quebrou = true; }
  check('coletor: o envio que lança não derruba ninguém', !quebrou);

  // ---- liga, numa janela de mentira
  function janela(protocolo, host, opcoes) {
    const ouvintes = {}, pedidos = [];
    const w = {
      location: { protocol: protocolo, hostname: host },
      navigator: { userAgent: UAS[0][0] },
      SOTERRA_VERSAO: { versao: 'b1c2d3' },
      setTimeout: (fn) => { w._agenda = fn; return 1; },
      addEventListener: (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
      dispara: (tipo, ev) => (ouvintes[tipo] || []).forEach((fn) => fn(ev)),
      ouvintes, pedidos,
      JOGO: {
        Sessao: {
          ehLocal: (p, h) => p === 'file:' || h === 'localhost' || h === '127.0.0.1',
          base: () => (opcoes && opcoes.base) || '',
          api: (rota, op) => { pedidos.push({ rota, op }); return Promise.resolve({ ok: true, status: 200 }); }
        },
        UI: { telaAtual: () => 'sala' }
      }
    };
    return w;
  }
  const wDisco = janela('file:', '');
  check('liga: em file:// não faz nada', R.liga(wDisco) === null && Object.keys(wDisco.ouvintes).length === 0);

  const w = janela('https:', 'soterra.viidoo.io');
  const col = R.liga(w);
  check('liga: servido, escuta error, unhandledrejection e pagehide',
        !!col && ['error', 'unhandledrejection', 'pagehide'].every((t) => (w.ouvintes[t] || []).length === 1));
  w.dispara('error', { message: 'Uncaught TypeError: boom', filename: 'https://soterra.viidoo.io/js/main.js?v=9', lineno: 5, colno: 2,
                       error: { stack: 'TypeError: boom\n    at q (https://soterra.viidoo.io/js/main.js?v=9:5:2)' } });
  w.dispara('unhandledrejection', { reason: { name: 'Error', message: 'promessa quebrou', stack: 'Error: promessa quebrou\n    at p (x.js:1:1)' } });
  w.dispara('unhandledrejection', { reason: 'só um texto' });
  w.dispara('error', { type: 'error', target: {} });          // carga de imagem: não é ErrorEvent
  w._agenda();
  await espera();
  const p = w.pedidos[0];
  check('liga: um POST /api/registro/erros pelo Sessao.api, com keepalive',
        w.pedidos.length === 1 && p.rota === '/api/registro/erros' && p.op.method === 'POST' && p.op.keepalive === true,
        JSON.stringify(w.pedidos));
  const es = p ? p.op.body.erros : [];
  check('liga: os três erros (a falha de carga de imagem fica de fora)', es.length === 3, JSON.stringify(es));
  check('liga: o erro de script com onde e pilha limpos',
        es.some((e) => e.tipo === 'erro' && e.mensagem === 'TypeError: boom' && e.onde === '/js/main.js:5:2' && e.pilha === 'at q (/js/main.js:5:2)'),
        JSON.stringify(es));
  check('liga: a promessa com o nome do erro', es.some((e) => e.tipo === 'promessa' && e.mensagem === 'Error: promessa quebrou'));
  check('liga: a promessa rejeitada com um texto', es.some((e) => e.tipo === 'promessa' && e.mensagem === 'só um texto'));
  check('liga: a versão do js/versao.js, a tela da HUD e o navegador resumido',
        p && p.op.body.versao === 'b1c2d3' && p.op.body.tela === 'sala' && p.op.body.navegador === 'Chrome 120 · Windows',
        p && JSON.stringify(p.op.body));

  const wCasa = janela('http:', 'localhost');
  const colCasa = R.liga(wCasa);
  colCasa.anota({ mensagem: 'em casa' });
  wCasa._agenda();
  await espera();
  check('liga: em casa sem API (localhost sem ?api=), não manda', wCasa.pedidos.length === 0);
  const wCasaApi = janela('http:', 'localhost', { base: 'http://127.0.0.1:8300' });
  const colApi = R.liga(wCasaApi);
  colApi.anota({ mensagem: 'em casa com API' });
  wCasaApi._agenda();
  await espera();
  check('liga: em casa com ?api=, manda', wCasaApi.pedidos.length === 1);

  // ---- o index.html carrega o registro PRIMEIRO
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const lista = /var arquivos = \[\s*'([^']+)'/.exec(index);
  check('index.html: js/core/registro_erros.js é o primeiro da lista', !!lista && lista[1] === 'js/core/registro_erros.js',
        lista && lista[1]);

  console.log('\n' + (total - falhas) + ' passaram / ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})();
