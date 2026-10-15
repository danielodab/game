#!/usr/bin/env node
/* PROVA DO REGISTRO DE EVENTOS DE USO NO CLIENTE (15/10): js/core/eventos_uso.js.
 *
 *   node tests/eventos_uso.js
 *
 * O coletor é puro (cria(amb)): aqui ele roda com um relógio, um agendador e um "servidor" de
 * mentira. O que se cobra: os eventos se somam por nome e vão num lote só depois da espera; nome
 * inválido cai; o teto por sessão segura; 404 e 429 desligam a aba; as faixas do retorno; o lote
 * nunca passa do LOTE_MAX; o corpo leva versão, plataforma e tela e NUNCA conta, nome ou e-mail. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'eventos_uso.js'), 'utf8');
const sandbox = { globalThis: null, console };
sandbox.globalThis = sandbox;
vm.runInNewContext(FONTE, sandbox);
const U = sandbox.JOGO.EventosUso;

let ok = 0, falhas = [];
function check(nome, cond, det) {
  if (cond) ok++; else falhas.push(nome + (det ? ' — ' + det : ''));
  console.log((cond ? 'PASSOU · ' : 'FALHOU · ') + nome + (det ? ' — ' + det : ''));
}

function ambiente(resposta) {
  const amb = { t: 0, fila: [], envios: [] };
  amb.agora = () => amb.t;
  amb.agenda = (fn, ms) => { amb.fila.push({ em: amb.t + ms, fn }); };
  amb.envia = (corpo) => { amb.envios.push(corpo); return Promise.resolve(resposta || { ok: true, status: 200 }); };
  amb.contexto = () => ({ versao: 'v-prova', plataforma: 'pc', tela: 'hub' });
  amb.avanca = (ms) => {
    amb.t += ms;
    const prontos = amb.fila.filter(x => x.em <= amb.t);
    amb.fila = amb.fila.filter(x => x.em > amb.t);
    prontos.forEach(x => x.fn());
  };
  return amb;
}

(async function () {
  // 1. soma por nome, um lote só depois da espera
  let amb = ambiente(), c = U.cria(amb);
  check('anota aceita um nome válido', c.anota('boot') && c.anota('tela:hub') && c.anota('tela:hub'));
  check('antes da espera não manda nada', amb.envios.length === 0);
  amb.avanca(U.ESPERA_MS);
  await Promise.resolve();
  check('depois da espera vai um lote só', amb.envios.length === 1, amb.envios.length + ' envio(s)');
  const lote = amb.envios[0];
  const hub = lote.eventos.find(e => e.nome === 'tela:hub');
  check('o evento repetido vai somado (n = 2)', hub && hub.n === 2, JSON.stringify(lote.eventos));
  check('o corpo leva versão, plataforma e tela', lote.versao === 'v-prova' && lote.plataforma === 'pc' && lote.tela === 'hub');
  check('o corpo não leva conta, nome nem e-mail', !('conta' in lote) && !('nome' in lote) && !('email' in lote) && !('token' in lote));

  // 2. nome inválido cai
  amb = ambiente(); c = U.cria(amb);
  check('nome com espaço ou acento cai', !c.anota('tela do hub') && !c.anota('vitória') && !c.anota('') && c.estado().descartadas === 3);
  check('nome longo demais cai', !c.anota('a'.repeat(41)));

  // 3. o teto por sessão
  amb = ambiente(); c = U.cria(amb);
  let aceitos = 0;
  for (let i = 0; i < U.POR_SESSAO + 20; i++) if (c.anota('ev' + i)) aceitos++;
  check('o teto por sessão segura (' + U.POR_SESSAO + ')', aceitos === U.POR_SESSAO, aceitos + ' aceitos');
  // 4. o lote nunca passa do LOTE_MAX; o resto vai no próximo
  amb.avanca(U.ESPERA_MS); await Promise.resolve();
  check('o primeiro lote tem no máximo LOTE_MAX', amb.envios.length === 1 && amb.envios[0].eventos.length === U.LOTE_MAX,
        amb.envios[0] && amb.envios[0].eventos.length);
  amb.avanca(U.ESPERA_MS); await Promise.resolve();
  check('o resto vai no lote seguinte', amb.envios.length === 2);

  // 5. 404 e 429 desligam
  for (const st of [404, 429]) {
    amb = ambiente({ ok: false, status: st }); c = U.cria(amb);
    c.anota('boot'); amb.avanca(U.ESPERA_MS); await new Promise(r => setTimeout(r, 0));   // a resposta chega num microtask a mais
    check('o ' + st + ' desliga a aba', c.estado().desligado && !c.anota('boot'));
  }

  // 6. as faixas do retorno
  check('faixas do retorno', U.faixaRetorno(0.5) === null && U.faixaRetorno(1) === 'retorno_1d' && U.faixaRetorno(2.5) === 'retorno_2_3d' &&
        U.faixaRetorno(5) === 'retorno_4_7d' && U.faixaRetorno(20) === 'retorno_8_30d' && U.faixaRetorno(45) === 'retorno_30d');

  // 7. em file:// não liga
  check('em file:// não liga nada', U.liga({ location: { protocol: 'file:' }, addEventListener() {} }) === null);

  console.log((falhas.length ? 'FALHAS — ' : 'TUDO PASSOU — ') + ok + ' ok, ' + falhas.length + ' falharam');
  process.exit(falhas.length ? 1 : 0);
})();
