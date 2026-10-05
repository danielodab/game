/* A regra do "sair é sair" no Banco de Contas (js/core/contas.js), sem navegador.
 *
 *     node tests/sessao_sair_cliente.js
 *
 * O relato do dono (04/10): saiu da conta, clicou "Jogar" e o jogo abriu com os heróis da
 * outra conta. Não era sessão — era o SAVE da última conta que jogou, que ficava nas chaves
 * da conta Principal e o jogo sem sessão abria. Aqui se prova a decisão que o contas.js toma
 * ao carregar (antes de o db.js e o progress.js lerem o disco), em cada estado do navegador;
 * o caminho inteiro, com a API e o Chrome, está em tests/sessao_navegador.py. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'contas.js'), 'utf8');
var total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++; if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (ok || extra === undefined ? '' : ' — ' + JSON.stringify(extra)));
}
/* Um navegador de mentira com o disco dado; devolve {C, disco} depois de o contas.js carregar. */
function abre(disco, busca) {
  var mapa = {};
  Object.keys(disco).forEach(function (k) { mapa[k] = typeof disco[k] === 'string' ? disco[k] : JSON.stringify(disco[k]); });
  var ls = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mapa, k) ? mapa[k] : null; },
    setItem: function (k, v) { mapa[k] = String(v); },
    removeItem: function (k) { delete mapa[k]; }
  };
  var win = { localStorage: ls, location: { search: busca || '' }, JOGO: {} };
  win.window = win;
  vm.runInNewContext(FONTE, win);
  return { C: win.JOGO.Contas, disco: mapa };
}
var SESSAO = { token: 'tok', conta: { id: 7, nome: 'Dan', gm: false } };
function daConta(sujo) {
  return { 'soterra-save-v2': { heroes: { barbaro: {} } }, 'soterra-conta-v1': { jogador: { id: 'abc', nome: 'Heroi' } },
           'soterra-nuvem-v1': { versao: 5, conta: 7, sujo: !!sujo }, 'soterra-vida-v1': { x: 1 },
           'soterra-save-v2--antes-do-teste': { heroes: {} }, 'soterra-som': '1' };
}
function semDono() {
  return { 'soterra-save-v2': { heroes: { mago: {} } }, 'soterra-conta-v1': { jogador: { id: 'zzz', nome: 'Sem Conta' } } };
}
var DELA = ['soterra-save-v2', 'soterra-conta-v1', 'soterra-nuvem-v1', 'soterra-vida-v1', 'soterra-save-v2--antes-do-teste'];
function tem(d) { return DELA.filter(function (k) { return k in d; }); }

// 1. SEM sessão, save de uma conta, em dia com o servidor: sai do disco
var r = abre(daConta(false));
check('sem sessão, save de conta em dia: tudo o que é da conta sai do disco', tem(r.disco).length === 0, tem(r.disco));
check('…o que não é da conta fica (as preferências)', r.disco['soterra-som'] === '1');
check('…e a janela joga na Principal, vazia', r.C.ativa() === 'principal' && r.C.chaveSave() === 'soterra-save-v2');

// 2. SEM sessão, save de uma conta com gravação que não subiu: fica guardado e escondido
r = abre(daConta(true));
check('sem sessão, save de conta com pendência: nada é apagado', tem(r.disco).length === DELA.length, tem(r.disco));
check('…e a janela NÃO lê esse save: joga na conta local do visitante',
      r.C.ativa() === 'visitante' && r.C.chaveSave() === 'soterra-save-v2:visitante' && r.C.chaveConta() === 'soterra-conta-v1:visitante');
check('…a escolha é só desta janela (o registro segue na Principal)',
      JSON.parse(r.disco['soterra-contas-v1']).ativa === 'principal');
r = abre(daConta(true), '?conta=principal');
check('…nem pedindo a Principal pelo endereço', r.C.ativa() === 'visitante');
check('esqueceDaConta() recusa com pendência; com `true` (a conta foi excluída) tira',
      r.C.esqueceDaConta() === false && tem(r.disco).length === DELA.length &&
      r.C.esqueceDaConta(true) === true && tem(r.disco).length === 0);

// 3. COM sessão: nada muda — é a Nuvem que decide se o save é desta conta (js/core/nuvem.js)
var d = daConta(false); d['soterra-sessao'] = SESSAO;
r = abre(d);
check('com sessão: o save fica e a janela é a Principal', tem(r.disco).length === DELA.length && r.C.ativa() === 'principal');
d = daConta(true); d['soterra-sessao'] = SESSAO;
r = abre(d);
check('com sessão e pendência: idem (a Nuvem sobe)', tem(r.disco).length === DELA.length && r.C.ativa() === 'principal');

// 4. sessão estragada no disco não vale como sessão
d = daConta(false); d['soterra-sessao'] = '{"token":""}';
r = abre(d);
check('sessão sem token não segura o save de conta nenhuma', tem(r.disco).length === 0);

// 5. o jogo SEM CONTA (save que nunca subiu para conta nenhuma) não é tocado
r = abre(semDono());
check('save sem dono (o jogo sem conta): fica como está, na Principal',
      !!r.disco['soterra-save-v2'] && !!r.disco['soterra-conta-v1'] && r.C.ativa() === 'principal' && r.C.donoDoDisco() === null);
d = semDono(); d['soterra-nuvem-v1'] = { versao: 0, conta: null, sujo: true };
r = abre(d);
check('registro da Nuvem sem conta (a pendência de antes do 1º login): idem', !!r.disco['soterra-save-v2'] && r.C.ativa() === 'principal');

// 6. as contas locais de casa (?conta=) seguem como eram, e não seguram o save de uma conta
r = abre(daConta(false), '?conta=2');
check('`?conta=2` sem sessão: a conta local 2, e o save da conta do servidor sai do disco',
      r.C.ativa() === '2' && r.C.chaveSave() === 'soterra-save-v2:2' && tem(r.disco).length === 0);

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
