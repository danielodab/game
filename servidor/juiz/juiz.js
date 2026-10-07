#!/usr/bin/env node
'use strict';
/* O JUIZ — o processo que roda as regras do jogo no servidor (dono: servidor).
 *
 *   node juiz.js [--host 127.0.0.1] [--porta 8792] [--raiz /srv/soterra]
 *
 * Só escuta no 127.0.0.1: quem fala com ele é a API (servidor/api.py, pela
 * juiz_ponte.py), nunca o navegador — o Caddyfile não tem rota para cá.
 *
 * ROTAS (todas JSON):
 *   GET  /saude           { ok, versao }       — a API confere antes de confiar
 *   POST /refaz           a sala refeita da semente e dos lances (sala.js)
 *   POST /op              uma operação de economia no estado da conta (economia.js)
 *   POST /supremo/fecha   a tentativa do Eco Primordial refeita e o placar de dano (supremo.js)
 *
 * Cada pedido roda num MUNDO novo (motor.js) e tem teto de tempo: um lance
 * torto que fizesse o motor girar para sempre não pode travar o juiz — o
 * processo inteiro é um só, e a API espera a resposta. O teto é por passos
 * dentro do próprio refazer (sala.js), e aqui por tamanho do corpo. */
const http = require('http');

function arg(nome, padrao) {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}
if (arg('raiz', null)) process.env.SOTERRA_RAIZ = arg('raiz', null);

const HOST = arg('host', '127.0.0.1');
const PORTA = Number(arg('porta', '8792'));
const CORPO_MAX = 4 * 1024 * 1024;       // um log de sala longa cabe com folga

const motor = require('./motor');
const rotas = {};
function registra(metodo, caminho, fn) { rotas[metodo + ' ' + caminho] = fn; }

registra('GET', '/saude', () => ({ ok: true, versao: versaoDosDados(), regras: versaoDasRegras() }));

/* AS REGRAS que a API precisa para abrir um bilhete sem carregar o jogo: os
 * calabouços abertos e quantas salas cada um tem, e as classes. */
let regrasCache = null;
registra('GET', '/regras', () => {
  if (regrasCache) return regrasCache;
  const J = motor.mundo().JOGO;
  const ds = Array.isArray(J.DATA.dungeons) ? J.DATA.dungeons : Object.values(J.DATA.dungeons);
  const calaboucos = {};
  ds.forEach((d) => {
    if (!d || !d.id || !d.rooms || !d.rooms.length) return;
    if (J.DATA.portalFechado && J.DATA.portalFechado(d.id)) return;
    calaboucos[d.id] = d.rooms.length;
  });
  // 03/10: os calabouços ESPECIAIS (js/core/data/santuario.js — o Santuário dos Elementos) abrem bilhete
  // como os seis: a sala, o grupo e a recompensa passam pelo mesmo caminho
  (J.DATA.especiais || []).forEach((d) => {
    if (d && d.id && d.rooms && d.rooms.length) calaboucos[d.id] = d.rooms.length;
  });
  // o Poço não tem fim: cada andar nasce da semente do bilhete
  if (J.Poco && J.Poco.salaSemeada) calaboucos.poco = 9999;
  regrasCache = { ok: true, versao: versaoDosDados(), regras: versaoDasRegras(),
                  calaboucos, classes: Object.keys(J.DATA.classes || {}),
                  // 07/10: os afixos de sala que a API pode aceitar num bilhete (js/core/afixos.js)
                  afixos: (J.Afixos && J.Afixos.ids) ? J.Afixos.ids() : [] };
  return regrasCache;
});

/* O DIA (07/10): o Calabouço do Dia e o afixo dele no instante `ms` (o relógio da API), pela MESMA
 * regra da página (diario.js e afixos.js, o dia de Brasília). A API guarda a resposta por dia e grava
 * o afixo no bilhete ao abrir a sala: é o que o /sala/fecha recebe de volta para refazer. POST e não
 * GET porque o juiz não lê a query da URL — o corpo leva {ms}. */
registra('POST', '/dia', (corpo) => {
  const ms = (corpo && typeof corpo.ms === 'number' && isFinite(corpo.ms)) ? corpo.ms : Date.now();
  const J = motor.mundo(['js/core/diario.js']).JOGO;
  const dia = (J.Diario && J.Diario.hoje) ? J.Diario.hoje(ms) : null;
  return { ok: true, chave: J.Afixos ? J.Afixos.chaveDoDia(ms) : null,
           dungeonId: dia ? dia.dungeonId : null,
           afixo: (J.Afixos && J.Afixos.doDia) ? J.Afixos.doDia(ms) : null };
});

/* A VERSÃO DOS DADOS: um hash dos arquivos que o juiz carrega. O cálculo não
 * cabe no navegador; serve para a API saber se o juiz subiu com os arquivos do
 * mesmo deploy. A VERSÃO DAS REGRAS (19/09) é outra coisa: o número que o
 * próprio engine.js declara (Engine.VERSAO_REGRAS) e sobe só quando uma regra
 * muda o fim de uma sala refeita. É esse que o bilhete guarda ao abrir e que a
 * sala confere ao fechar (sala.js, 'regras-mudaram'): cliente velho e juiz
 * novo não podem refazer a mesma sala com resultado diferente sem o servidor
 * saber — e sem o jogador honesto ser tratado como fraude. */
let regrasNumCache = null;
function versaoDasRegras() {
  if (regrasNumCache == null) {
    const E = motor.mundo().JOGO.Engine;
    regrasNumCache = (E && typeof E.VERSAO_REGRAS === 'number') ? E.VERSAO_REGRAS : 1;
  }
  return regrasNumCache;
}
let versaoCache = null;
function versaoDosDados() {
  if (versaoCache) return versaoCache;
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');
  const h = crypto.createHash('sha256');
  for (const rel of motor.DADOS.concat(motor.COMBATE)) h.update(fs.readFileSync(path.join(motor.RAIZ, rel)));
  versaoCache = h.digest('hex').slice(0, 16);
  return versaoCache;
}

// os módulos das rotas grandes se registram sozinhos (existem a partir das fases seguintes)
for (const mod of ['./sala', './recompensa', './economia', './duelo', './guerra',   // 15/09: a guerra de guilda
                   './supremo']) {   // 02/10: a tentativa do Eco Primordial
  try {
    const m = require(mod);
    if (m && typeof m.rotas === 'function') m.rotas(registra);
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
  }
}

function responde(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
                          'Content-Length': Buffer.byteLength(corpo) });
  res.end(corpo);
}

const servidor = http.createServer((req, res) => {
  const chave = req.method + ' ' + String(req.url || '').split('?')[0];
  const fn = rotas[chave];
  if (!fn) return responde(res, 404, { ok: false, erro: 'rota desconhecida no juiz' });
  const pedacos = [];
  let tam = 0;
  req.on('data', (c) => {
    tam += c.length;
    if (tam > CORPO_MAX) { responde(res, 413, { ok: false, erro: 'corpo grande demais' }); req.destroy(); return; }
    pedacos.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let corpo = {};
    if (pedacos.length) {
      try { corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8')); }
      catch (e) { return responde(res, 400, { ok: false, erro: 'JSON inválido' }); }
    }
    // erro de regra é 422 com o porquê; erro de programa é 500 e vai para o log
    const falhou = (e) => {
      if (res.writableEnded) return;
      if (e && e.juiz) {
        return responde(res, 422, { ok: false, erro: e.message, motivo: e.motivo || null,
                                    indice: (typeof e.indice === 'number') ? e.indice : null });
      }
      console.error('[juiz] erro:', e && e.stack || e);
      responde(res, 500, { ok: false, erro: 'o juiz falhou' });
    };
    // a rota pode devolver um valor ou uma Promise (o DB do jogo responde por Promise)
    let saida;
    try { saida = fn(corpo || {}); } catch (e) { return falhou(e); }
    Promise.resolve(saida).then((s) => {
      if (!res.writableEnded) responde(res, s && s.status ? s.status : 200, s);
    }, falhou);
  });
});

servidor.listen(PORTA, HOST, () => {
  console.log('[juiz] ouvindo em ' + HOST + ':' + PORTA + ' · dados ' + versaoDosDados() +
              ' · regras v' + versaoDasRegras() + ' · raiz ' + motor.RAIZ);
});
