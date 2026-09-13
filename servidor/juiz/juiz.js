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

registra('GET', '/saude', () => ({ ok: true, versao: versaoDosDados() }));

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
  // o Poço não tem fim: cada andar nasce da semente do bilhete
  if (J.Poco && J.Poco.salaSemeada) calaboucos.poco = 9999;
  regrasCache = { ok: true, versao: versaoDosDados(), calaboucos, classes: Object.keys(J.DATA.classes || {}) };
  return regrasCache;
});

/* A VERSÃO DAS REGRAS: um hash dos arquivos que o juiz carrega. O cliente manda
 * a dele (o mesmo cálculo não cabe no navegador, então a API compara com o
 * js/versao.js do build); aqui ela serve para a API saber se o juiz subiu com
 * os arquivos do mesmo deploy. */
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
for (const mod of ['./sala', './recompensa', './economia']) {
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
  console.log('[juiz] ouvindo em ' + HOST + ':' + PORTA + ' · regras ' + versaoDosDados() + ' · raiz ' + motor.RAIZ);
});
