#!/usr/bin/env node
'use strict';
/* PROVA DAS CRÔNICAS DO MUNDO ENTERRADO (07/10, js/core/data/cronicas.js + js/core/cronicas.js).
 *
 *   node tests/cronicas.js
 *
 * No mundo econômico do juiz (o mesmo Progress do jogo), com a lógica da página carregada por cima:
 *   · há uma crônica por portal aberto (o bestiário), uma por chefe dos seis portais, a das fusões e o prólogo —
 *     cada uma com id único, título e texto;
 *   · a conta nova só tem o prólogo aberto; o prólogo nunca é "novo";
 *   · derrubar um chefe (o bestiário o conta) abre a crônica dele, e ela é "nova" até ser marcada vista;
 *   · o bestiário completo de um portal abre a dele; as 21 fusões abrem a das duplas;
 *   · o que falta para abrir diz o nome do portal ou do chefe. */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

function mundoComCronicas() {
  const w = est.mundoEconomico({ agoraMs: Date.UTC(2026, 9, 7, 15), semente: 5 });
  est.poeEstado(w, null, null);
  const J = w.J;
  // a lógica da página, por cima do mundo do juiz: `window` e um localStorage de mentira
  const guarda = {};
  const janela = { JOGO: J, localStorage: { getItem: (k) => (k in guarda ? guarda[k] : null), setItem: (k, v) => { guarda[k] = String(v); } } };
  janela.window = janela;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'cronicas.js'), 'utf8'), janela);
  return { J, C: J.Cronicas };
}

(function () {
  const { J, C } = mundoComCronicas();
  const lista = C.lista();
  const portais = J.DATA.dungeons.filter((d) => d.id !== 'poco' && !(J.DATA.portalFechado && J.DATA.portalFechado(d.id)));
  const chefes = Object.keys(J.DATA.monsters).filter((id) => J.DATA.monsters[id].boss && portais.some((d) => d.id === J.DATA.monsters[id].dungeonId));
  check('o dado tem crônicas (' + lista.length + ')', lista.length >= 10);
  check('ids únicos, todas com título e texto', new Set(lista.map((c) => c.id)).size === lista.length &&
        lista.every((c) => typeof c.titulo === 'string' && c.titulo.length > 3 && typeof c.texto === 'string' && c.texto.length > 80));
  check('uma crônica de bestiário por portal aberto (' + portais.length + ')',
        portais.every((d) => lista.some((c) => c.gancho.tipo === 'bestiario' && c.gancho.calabouco === d.id)),
        JSON.stringify(portais.map((d) => d.id)));
  check('uma crônica por chefe dos portais (' + chefes.length + ')',
        chefes.length === 6 && chefes.every((id) => lista.some((c) => c.gancho.tipo === 'chefe' && c.gancho.chefe === id)),
        JSON.stringify(chefes));
  check('o prólogo e a das fusões existem', lista.some((c) => c.gancho.tipo === 'prologo') && lista.some((c) => c.gancho.tipo === 'fusoes'));
  check('os textos não citam nada de fora do mundo', lista.every((c) => !/dofus/i.test(c.texto + c.titulo)));

  // a conta nova
  const abertas = C.abertas();
  check('a conta nova só tem o prólogo aberto, e ele não é novo', abertas.length === 1 && abertas[0].gancho.tipo === 'prologo' && C.novas().length === 0,
        JSON.stringify(abertas.map((c) => c.id)));
  const fechada = lista.find((c) => c.gancho.tipo === 'chefe');
  check('a fechada diz o que falta (o nome do chefe)', fechada && fechada.como && fechada.como.tipo === 'chefe' &&
        fechada.como.nome === J.DATA.monsters[fechada.gancho.chefe].name, JSON.stringify(fechada && fechada.como));

  // o chefe derrubado abre a crônica dele — nova até ser lida
  const P = J.Progress;
  P.anotaBestiario('boss-gardener');
  const dep = C.porId('chefe-boss-gardener');
  check('derrubar a Jardineira abre a crônica dela, nova', !!dep && dep.aberta && dep.nova);
  check('C.novas a lista', C.novas().length === 1 && C.novas()[0].id === 'chefe-boss-gardener');
  C.marcaVista('chefe-boss-gardener');
  check('marcada vista, deixa de ser nova (e segue aberta)', C.novas().length === 0 && C.porId('chefe-boss-gardener').aberta);
  check('os outros chefes seguem fechados', lista.filter((c) => c.gancho.tipo === 'chefe' && c.id !== 'chefe-boss-gardener')
        .every((c) => !C.porId(c.id).aberta));

  // o bestiário completo de um portal
  const estufa = Object.keys(J.DATA.monsters).filter((id) => { const m = J.DATA.monsters[id]; return m.dungeonId === 'greenhouse' && !m.summonOnly && !m.colosso; });
  estufa.forEach((id) => P.anotaBestiario(id));
  check('o bestiário completo da Estufa abre a crônica dela', C.porId('bestiario-greenhouse').aberta && C.porId('bestiario-greenhouse').nova);
  check('a Cisterna segue fechada', !C.porId('bestiario-cistern').aberta);

  // as 21 fusões
  const cls = Object.keys(J.DATA.classes).filter((c) => c !== 'gm').sort();
  for (let i = 0; i < cls.length; i++) for (let j = i + 1; j < cls.length; j++) P.anotaFusaoVencida(cls[i], cls[j]);
  check('as 21 fusões vencedoras abrem a crônica das duplas', C.porId('fusoes').aberta);
  C.marcaTodasVistas();
  check('marcar todas vistas zera as novas', C.novas().length === 0);
})();

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
