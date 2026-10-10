/* A RÉGUA dos títulos do Torneio da Arena (10/10; js/core/titulos.js, docs/TORNEIO.md §1 e §3), lida como o juiz a
 * lê (em Node, sem o JOGO.I18n). tests/juiz_economia.js a chama; sozinha: node tests/juiz_titulos_regua.js */
'use strict';
const path = require('path');
const antes = globalThis.JOGO;
globalThis.JOGO = {};
const arq = path.join(__dirname, '..', 'js', 'core', 'titulos.js');
delete require.cache[require.resolve(arq)];
require(arq);
const T = globalThis.JOGO.Titulos;
globalThis.JOGO = antes;

const falhas = [];
function confere(nome, ok, detalhe) { if (!ok) falhas.push(nome + (detalhe ? ' — ' + detalhe : '')); }

confere('T.ARENA é a escada do contrato',
        JSON.stringify(T.ARENA) === JSON.stringify([
          { n: 1, titulo: 'Campeão da Arena' }, { n: 2, titulo: 'Bicampeão da Arena' }, { n: 3, titulo: 'Tricampeão da Arena' },
          { n: 5, titulo: 'Lenda da Arena' }, { n: 10, titulo: 'Imortal da Arena' }]), JSON.stringify(T.ARENA));
confere('T.ARENA_GUILDA', T.ARENA_GUILDA === 'Campeão das Guildas', T.ARENA_GUILDA);
confere('nenhum título passa de 23 letras (o teto da plaquinha)',
        T.ARENA.every((d) => d.titulo.length <= 23) && T.ARENA_GUILDA.length <= 23);
const cat = T.catalogo({ arena: { pvp: 3, guilda: 0 } }).filter((x) => x.fonte === 'arena');
confere('o catálogo traz os 6 da fonte arena, com prog/alvo e para sempre',
        cat.length === 6 && cat.every((x) => x.emprestado === false && typeof x.alvo === 'number' && typeof x.comoGanhar === 'string'),
        JSON.stringify(cat));
confere('com 3 conquistas: os três primeiros ganhos, a Lenda em 3 de 5',
        cat.filter((x) => x.ganho).map((x) => x.titulo).join('|') === 'Campeão da Arena|Bicampeão da Arena|Tricampeão da Arena' &&
        cat[3].prog === 3 && cat[3].alvo === 5, JSON.stringify(cat.map((x) => [x.titulo, x.ganho, x.prog, x.alvo])));
confere('sem estado.arena nada da arena está ganho',
        T.catalogo({}).filter((x) => x.fonte === 'arena' && x.ganho).length === 0 && T.valido('Campeão da Arena', {}) === false);
confere('T.valido lê estado.arena', T.valido('Lenda da Arena', { arena: { pvp: 5 } }) === true &&
        T.valido('Lenda da Arena', { arena: { pvp: 4 } }) === false &&
        T.valido('Campeão das Guildas', { arena: { guilda: 1 } }) === true &&
        T.valido('Campeão das Guildas', { arena: { pvp: 9 } }) === false);
confere('o grau da moldura: 1-2 = I, 3-4 = II, 5+ = III; as marcas vão até 5',
        [0, 1, 2, 3, 4, 5, 10].map(T.grauDaArena).join('') === '0112233' &&
        [0, 1, 4, 5, 12].map(T.marcasDaArena).join('') === '01455');

module.exports = { ok: falhas.length === 0, detalhe: falhas.join(' · ') };
if (require.main === module) {
  console.log(falhas.length ? 'FALHOU: ' + falhas.join(' · ') : 'a régua dos títulos da Arena: tudo passou (8)');
  process.exit(falhas.length ? 1 : 0);
}
