#!/usr/bin/env node
'use strict';
/* A PROVA DO EQUILÍBRIO (03/10/2026, o dono: "isso é importantíssimo. equilibre
 * todas as classes e fusões"). As faixas e o porquê de cada uma: docs/EQUILIBRIO.md.
 *
 *   node tests/equilibrio.js                 a prova (perfis + fusão + duelos), com veredito
 *   node tests/equilibrio.js perfis          só os perfis das 7 classes × 4 caminhos × 4 níveis
 *   node tests/equilibrio.js fusao           só a fusão contra os dois separados
 *   node tests/equilibrio.js duelos          só a matriz de duelos
 *   opções: --completo (todas as 16 misturas na fusão e 11 sementes nos duelos — a
 *           medida do documento, ~35 min com 4 filhos), --trabalhadores N, --json arquivo,
 *           --ajuste arquivo (calibrar sem tocar nos dados), --niveis 5,30 · --classes x,y ·
 *           --sementes N · --sem1v1 (recortes para calibrar)
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js) + progress.js: o jogo de verdade,
 * sem navegador. Divide o trabalho em processos-filhos de prioridade BAIXA (a máquina é
 * dividida — memória maquina-compartilhada). Tudo é determinístico: a mesma árvore dá o
 * mesmo número; o veredito não pisca.
 *
 * Cobra a REGRA (as faixas do documento), não o número: nada aqui crava um dano. */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const RAIZ = path.resolve(__dirname, '..');
function baixa() {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* sem permissão: segue */ }
}

// ------------------------------------------------------------------- as faixas
/* AS FAIXAS-ALVO (docs/EQUILIBRIO.md §2). Mudar um número daqui é mudar o
 * documento junto — e dizer por quê. */
const FAIXA_FUSAO = 0.20;            // fundida dentro de ±20% dos dois separados, em CADA nível
const FAIXA_DUELO = [0.40, 0.60];    // X+Z contra Y+Z, com o mesmo parceiro Z dos dois lados
/* O PAPEL DE CADA CLASSE, como REGRA de identidade (docs/EQUILIBRIO.md §2.1).
 * Em múltiplos da MÉDIA do elenco no mesmo nível (média das sete classes, cada
 * uma pela média dos quatro caminhos) e em ORDEM entre as classes — e não em
 * número cravado: o que precisa continuar verdade depois de qualquer ajuste é
 * "o Ladino é quem mais bate num alvo só", não "o Ladino bate 83".
 *   unico  [mín, máx] do dano em alvo único sobre a média
 *   vidaEf mínimo da vida efetiva sobre a média
 *   topo   métrica em que a classe é a MAIOR do elenco (empate a 3% conta)
 *   pertoDoMago  métrica em que a classe fica a no máximo 15% atrás do mago
 *          (o Caçador divide com o Bruxo o maior alcance de quem ataca com o
 *          próprio feitiço: §5 — o alcance era o que decidia o duelo)
 *   fundo  métrica em que a classe é a MENOR do elenco
 *   abaixoDoTanque  o dano em alvo único fica abaixo desta fração do do
 *          tanque (docs/CLASSES_V3.md: "vale cuidar para o Minotauro não
 *          ganhar dano decente, senão ele vira um Sumô melhor")
 *   area   [mín, máx] do dano em área sobre a média
 *   alcance [mín, máx] em casas
 *   desde  a regra do papel só vale a partir deste nível (a área do Bruxo
 *          chega com o caminho: no nível 5 ele só tem o primeiro degrau)
 * E para todas: o dano em alvo único entre 0,30× e 2,20× da média — ninguém
 * inútil, ninguém dono do jogo. */
const PAPEL = {
  tanque:    { unico: [0.80, 1.60], vidaEf: 1.05 },
  atirador:  { unico: [0.70, 1.40], alcance: [5, 10], pertoDoMago: 'alcance' },
  mago:      { area: [1.20, 3.00], alcance: [5, 10], desde: 10 },
  assassino: { topo: 'unico', alcance: [1, 2] },
  suporte:   { unico: [0.30, 0.95], topo: 'cura' },
  invocador: { unico: [0.30, 1.05] },
  guardiao:  { abaixoDoTanque: 0.75, vidaEf: 1.25, topo: 'escudo' }
};
/* O teto geral é 2,2× porque o assassino vive SÓ de dano num alvo: alcance de
 * 1 ou 2 casas, a menor vida efetiva do elenco; os duelos em dupla (§2.4) é que
 * dizem se isso é demais, e com 1,9–2,1× ele fica em ~50%. */
const UNICO_GERAL = [0.30, 2.20];
/* OS QUATRO CAMINHOS de uma classe valem o mesmo: o "poder" de cada caminho
 * (dano único + metade da área + o maior entre a sustentação própria e a cura
 * no aliado + 2× o controle — a cura no aliado entra porque o caminho de Água
 * do Curandeiro rende curando os outros, e sem ela parecia 30% mais fraco; o
 * maior e não a soma porque o roubo de vida do Caçador de Água já é as duas
 * coisas) fica a
 * ±25% da média dos quatro caminhos DAQUELA classe, no mesmo nível. Escolher o
 * elemento é escolher estilo, não escolher o forte. */
const FAIXA_CAMINHO = 0.25;

/* A FERRAMENTA DE CALIBRAGEM (`--ajuste arquivo.json`): experimenta
 * multiplicadores SEM tocar nos dados, só na memória dos filhos. Foi assim que
 * os números de docs/EQUILIBRIO.md §5 foram achados; o que ficou foi escrito
 * nos dados (spells.js, monsters.js, fusions.js, fusion.js) já multiplicado —
 * o porquê de cada ajuste mora nas tabelas de docs/EQUILIBRIO.md §5, não ao
 * lado do número. Formato:
 *   { "classes": { "<classe>": { "dano": k, "cura": k, "escudo": k, "pv": +n, "fere": k,
 *                                "tier": { "<nível>": k }, "<elemento>": k } },
 *   ("fere" multiplica os espinhos do muro — o `fere` dos efeitos de muro da classe;
 *    a potência não o toca: o muro é o verbo, não o golpe)
 *     "feiticos": { "<id>": { "dano": k, "cura": k, "escudo": k } },
 *     "pairTune": { "<dupla>": [k5, k12, k30] } } */
function grupoDoNivel(n) { return n >= 30 ? 'D' : n >= 15 ? 'C' : n >= 10 ? 'B' : 'A'; }
function aplicaAjuste(J, aj) {
  const D = J.DATA;
  function escala(ef, kd, kc, ks, kf) {
    if (!ef) return;
    if (ef.type === 'wall' && ef.fere > 0 && kf != null && kf !== 1) ef.fere = Math.max(1, Math.round(ef.fere * kf));
    if ((ef.type === 'damage' || ef.type === 'poison' || ef.type === 'chain') && kd !== 1) {
      ef.min = Math.max(1, Math.round(ef.min * kd)); ef.max = Math.max(ef.min, Math.round(ef.max * kd));
    }
    if ((ef.type === 'heal' || ef.type === 'regen') && kc !== 1) {
      ef.min = Math.max(1, Math.round(ef.min * kc)); ef.max = Math.max(ef.min, Math.round(ef.max * kc));
    }
    if (ef.type === 'shield' && ks !== 1) ef.value = Math.round(ef.value * ks);
  }
  // a POTÊNCIA de um grupo de degraus (A = 0 e 5, B = 10 e 12, C = 15 e 20,
  // D = 30) escala dano, cura e escudo; `exp` diz quanto de cada um ela leva
  // (o Minotauro sobe mais no escudo que no golpe)
  function fatores(c, sp) {
    const g = grupoDoNivel(sp.unlockLevel || 0);
    const k = (c.potencia && c.potencia[g] != null) ? c.potencia[g] : 1;
    const ex = c.exp || {};
    return [Math.pow(k, ex.dano != null ? ex.dano : 1), Math.pow(k, ex.cura != null ? ex.cura : 1),
            Math.pow(k, ex.escudo != null ? ex.escudo : 1)];
  }
  const filhos = [];   // cargas de armadilha e feitiços de invocação herdam o grupo de quem os arma
  Object.keys(D.spells).forEach((id) => {
    const sp = D.spells[id];
    if (!sp.classId || id.indexOf('trap-') === 0) return;
    const c = (aj.classes || {})[sp.classId] || {};
    const f = (aj.feiticos || {})[id] || {};
    const kt = (c.tier && c.tier[sp.unlockLevel] != null) ? c.tier[sp.unlockLevel] : 1;
    const ke = c[sp.element] != null ? c[sp.element] : 1;
    const fg = fatores(c, sp);
    const kd = (c.dano || 1) * kt * ke * (f.dano || 1) * fg[0];
    const kc = (c.cura || 1) * (f.cura || 1) * fg[1];
    const ks = (c.escudo || 1) * (f.escudo || 1) * fg[2];
    const kf = (c.fere != null ? c.fere : 1) * (f.fere || 1);
    (sp.effects || []).forEach((ef) => {
      escala(ef, kd, kc, ks, kf);
      if (ef.type === 'trap' && D.spells[ef.trapId]) filhos.push([D.spells[ef.trapId], kd, kc, ks]);
      if (ef.type === 'summon') {
        const m = J.Engine.monster(ef.monsterId);
        (m && m.spells || []).forEach((ms) => { const x = J.Engine.spell(ms); if (x) filhos.push([x, kd, kc, ks]); });
      }
    });
  });
  const vistos = new Set();
  filhos.forEach(([sp, kd, kc, ks]) => {
    if (vistos.has(sp)) return;          // a mesma carga armada por dois feitiços escala uma vez
    vistos.add(sp);
    (sp.effects || []).forEach((ef) => escala(ef, kd, kc, ks));
  });
  Object.keys(aj.classes || {}).forEach((c) => {
    const cc = aj.classes[c];
    if (!D.classes[c]) return;
    if (cc.pv) D.classes[c].stats.hp += cc.pv;
    if (cc.iniciativa != null) D.classes[c].stats.initiative = cc.iniciativa;
    if (cc.pp != null) D.classes[c].stats.pp = cc.pp;
    // `alcance`: soma ao alcance máximo dos feitiços de DANO da classe (nunca abaixo do mínimo)
    if (cc.alcance) Object.keys(D.spells).forEach((id) => {
      const sp = D.spells[id];
      if (sp.classId !== c || !sp.range || !(sp.effects || []).some((e) => e.type === 'damage' || e.type === 'chain')) return;
      if (sp.range.max <= 1) return;
      sp.range = Object.assign({}, sp.range, { max: Math.max(sp.range.min || 0, sp.range.max + cc.alcance) });
    });
  });
  if (aj.pairTune && J.Fusion) Object.keys(aj.pairTune).forEach((k) => { J.Fusion.PAIR_TUNE[k] = aj.pairTune[k]; });
}

// ------------------------------------------------------------------- o filho
if (!isMainThread) {
  baixa();
  const { mundo } = require(path.join(RAIZ, 'servidor', 'juiz', 'motor.js'));
  const J = mundo(['js/core/progress.js']).JOGO;
// 07/10: a bancada mede o jogo BASE — o elite de sala (js/core/elites.js) é sorte por cima e não entra na régua
if (J.Elites) J.Elites.CHANCE = 0;
  if (workerData && workerData.ajuste) aplicaAjuste(J, workerData.ajuste);
  const B = require(path.join(__dirname, 'equilibrio_bancada.js')).cria(J);
  parentPort.on('message', (job) => {
    let out;
    try {
      if (job.tipo === 'perfil') out = B.perfil(job.classe, job.elem, job.nivel);
      else if (job.tipo === 'fusao') out = B.razaoDupla(job.a, job.b, job.nivel, job.combos);
      else if (job.tipo === 'celula') out = B.celula(job.x, job.y, job.nivel, job.sementes, job.parceiros);
      parentPort.postMessage({ id: job.id, ok: true, out });
    } catch (e) {
      parentPort.postMessage({ id: job.id, ok: false, erro: String(e && e.stack || e) });
    }
  });
  return;
}

// ------------------------------------------------------------------- o pai
baixa();
const args = process.argv.slice(2);
function opt(nome, padrao) {
  const i = args.indexOf('--' + nome);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : padrao;
}
const valores = ['json', 'trabalhadores', 'ajuste', 'niveis', 'classes', 'sementes'].map((k) => opt(k, null)).filter((v) => typeof v === 'string');
const modo = (args.find((a) => !a.startsWith('--') && valores.indexOf(a) < 0) || 'prova');
const COMPLETO = !!opt('completo', false);
const NTRAB = Math.max(1, +opt('trabalhadores', Math.max(1, Math.min(4, os.cpus().length - 3))));
const SAIDA = opt('json', null);
const AJUSTE = opt('ajuste', null) ? JSON.parse(fs.readFileSync(opt('ajuste'), 'utf8')) : null;

const { mundo } = require(path.join(RAIZ, 'servidor', 'juiz', 'motor.js'));
const J = mundo(['js/core/progress.js']).JOGO;
// 07/10: a bancada mede o jogo BASE — o elite de sala (js/core/elites.js) é sorte por cima e não entra na régua
if (J.Elites) J.Elites.CHANCE = 0;
const BA = require(path.join(__dirname, 'equilibrio_bancada.js'));
const B = BA.cria(J);
const D = J.DATA;
// recortes para calibrar (a prova de verdade roda sem eles)
const SO_NIVEIS = typeof opt('niveis', null) === 'string' ? opt('niveis').split(',').map(Number) : null;
const SO_CLASSES = typeof opt('classes', null) === 'string' ? opt('classes').split(',') : null;
const NIVEIS = SO_NIVEIS || B.NIVEIS;
const SEM_1V1 = !!opt('sem1v1', false);

function rodaTudo(jobs, rotulo) {
  return new Promise((resolve, reject) => {
    const res = new Array(jobs.length);
    let prox = 0, feitos = 0, t0 = Date.now(), ultimo = 0;
    const ws = [];
    const n = Math.min(NTRAB, jobs.length);
    if (!jobs.length) return resolve(res);
    for (let k = 0; k < n; k++) {
      const w = new Worker(__filename, { workerData: { ajuste: AJUSTE } });
      ws.push(w);
      w.on('message', (m) => {
        if (!m.ok) { ws.forEach((x) => x.terminate()); return reject(new Error(m.erro)); }
        res[m.id] = m.out; feitos++;
        if (Date.now() - ultimo > 15000) {
          ultimo = Date.now();
          process.stderr.write('[' + rotulo + '] ' + feitos + '/' + jobs.length + ' em ' + Math.round((Date.now() - t0) / 1000) + ' s\n');
        }
        if (prox < jobs.length) w.postMessage(Object.assign({ id: prox }, jobs[prox++]));
        else if (feitos === jobs.length) { ws.forEach((x) => x.terminate()); resolve(res); }
      });
      w.on('error', (e) => { ws.forEach((x) => x.terminate()); reject(e); });
      w.postMessage(Object.assign({ id: prox }, jobs[prox++]));
    }
  });
}

let total = 0, falhas = 0;
const linhasFalha = [];
function check(nome, ok, extra) {
  total++;
  if (!ok) { falhas++; linhasFalha.push(nome + (extra ? ' — ' + extra : '')); }
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}
const pct = (x) => (x * 100).toFixed(0) + '%';
const r1 = (x) => Math.round(x);

// ------------------------------------------------------------------ perfis
async function perfis() {
  const jobs = [];
  NIVEIS.forEach((nivel) => B.CLASSES.forEach((classe) => B.ELEMS.forEach((elem) => jobs.push({ tipo: 'perfil', classe, elem, nivel }))));
  const res = await rodaTudo(jobs, 'perfis');
  const P = {};
  jobs.forEach((j, i) => { ((P[j.nivel] = P[j.nivel] || {})[j.classe] = P[j.nivel][j.classe] || {})[j.elem] = res[i]; });
  const MET = ['unico', 'area', 'apoio', 'cura', 'escudo', 'proprio', 'controle', 'alcance', 'vidaEf'];
  const resumo = {};
  console.log('\n== PERFIS (por turno, média de 4 turnos; vida efetiva = vida + 4 turnos de sustentação própria)');
  NIVEIS.forEach((nivel) => {
    const media = {}, porClasse = {};
    B.CLASSES.forEach((c) => {
      const m = {};
      MET.forEach((k) => {
        m[k] = B.ELEMS.reduce((s, e) => s + (k === 'vidaEf' ? P[nivel][c][e].vidaEfetiva : P[nivel][c][e][k]), 0) / B.ELEMS.length;
      });
      porClasse[c] = m;
    });
    MET.forEach((k) => { media[k] = B.CLASSES.reduce((s, c) => s + porClasse[c][k], 0) / B.CLASSES.length; });
    resumo[nivel] = { media, porClasse };
    console.log('\nNível ' + nivel + '   (entre parênteses: × a média do elenco)');
    console.log('classe       papel       único        área         cura    escudo  próprio  controle  alcance  vida ef.');
    B.CLASSES.forEach((c) => {
      const m = porClasse[c], papel = D.classes[c].role;
      const x = (k) => (media[k] > 0 ? (m[k] / media[k]).toFixed(2) : '-');
      console.log(c.padEnd(12) + ' ' + papel.padEnd(10) + ' ' +
        (r1(m.unico) + ' (' + x('unico') + ')').padEnd(12) + ' ' + (r1(m.area) + ' (' + x('area') + ')').padEnd(12) + ' ' +
        String(r1(m.cura)).padEnd(7) + ' ' + String(r1(m.escudo)).padEnd(7) + ' ' + String(r1(m.proprio)).padEnd(8) + ' ' + m.controle.toFixed(1).padEnd(9) + ' ' +
        m.alcance.toFixed(1).padEnd(8) + ' ' + r1(m.vidaEf) + ' (' + x('vidaEf') + ')');
    });
    console.log('caminhos (poder = único + área/2 + o maior entre próprio e cura no aliado + 2×controle; × a média da classe):');
    B.CLASSES.forEach((c) => {
      const pod = B.ELEMS.map((e) => poder(P[nivel][c][e]));
      const mp = pod.reduce((s, v) => s + v, 0) / pod.length;
      console.log('  ' + c.padEnd(12) + B.ELEMS.map((e, i) => e + ' ' + (mp > 0 ? (pod[i] / mp).toFixed(2) : '-')).join('  '));
    });
  });
  return { P, resumo };
}
function poder(p) { return p.unico + p.area / 2 + Math.max(p.proprio, p.cura || 0) + 2 * p.controle; }

function julgaPerfis(r) {
  const NOME = { unico: 'dano em alvo único', area: 'dano em área', apoio: 'sustentação de aliado', alcance: 'alcance', vidaEf: 'vida efetiva',
                 cura: 'cura num aliado', escudo: 'escudo num aliado' };
  Object.keys(r.resumo).map(Number).forEach((nivel) => {
    const { media, porClasse } = r.resumo[nivel];
    B.CLASSES.forEach((c) => {
      const papel = D.classes[c].role, fx = PAPEL[papel];
      if (!fx) { check('nível ' + nivel + ' · ' + c + ': o papel "' + papel + '" tem regra', false); return; }
      const m = porClasse[c], pre = 'nível ' + nivel + ' · ' + c + ' (' + papel + '): ';
      const xu = m.unico / media.unico;
      check(pre + 'dano em alvo único ' + xu.toFixed(2) + '× a média (geral ' + UNICO_GERAL.join('–') + ')',
        xu >= UNICO_GERAL[0] && xu <= UNICO_GERAL[1], xu.toFixed(2) + '×');
      const vale = !(fx.desde && nivel < fx.desde);   // a regra do papel ainda não vale neste nível
      if (vale && fx.area) {
        const xa = m.area / media.area;
        check(pre + 'dano em área ' + xa.toFixed(2) + '× a média (faixa do papel ' + fx.area.join('–') + ')',
          xa >= fx.area[0] && xa <= fx.area[1], xa.toFixed(2) + '×');
      }
      if (vale && fx.unico) check(pre + 'dano em alvo único ' + xu.toFixed(2) + '× na faixa do papel ' + fx.unico.join('–'),
        xu >= fx.unico[0] && xu <= fx.unico[1], xu.toFixed(2) + '×');
      if (vale && fx.vidaEf) {
        const xv = m.vidaEf / media.vidaEf;
        check(pre + 'vida efetiva ' + xv.toFixed(2) + '× a média (mínimo ' + fx.vidaEf + ')', xv >= fx.vidaEf, xv.toFixed(2) + '×');
      }
      if (vale && fx.alcance) check(pre + 'alcance ' + m.alcance.toFixed(1) + ' casas (faixa ' + fx.alcance.join('–') + ')',
        m.alcance >= fx.alcance[0] && m.alcance <= fx.alcance[1], m.alcance.toFixed(1));
      if (vale && fx.topo) {
        const k = fx.topo, maior = Math.max.apply(null, B.CLASSES.map((o) => porClasse[o][k]));
        check(pre + 'é quem tem o maior ' + NOME[k] + ' do elenco (' + m[k].toFixed(1) + '; o maior é ' + maior.toFixed(1) + ')',
          m[k] >= maior * 0.97 - 1e-9, m[k].toFixed(1));
      }
      if (vale && fx.pertoDoMago) {
        const k = fx.pertoDoMago, mg = B.CLASSES.filter((o) => D.classes[o].role === 'mago')[0];
        const ref = mg ? porClasse[mg][k] : 0;
        check(pre + NOME[k] + ' a no máximo 15% atrás do mago (' + m[k].toFixed(1) + ' contra ' + ref.toFixed(1) + ')',
          m[k] >= ref * 0.85 - 1e-9, m[k].toFixed(1));
      }
      if (vale && fx.abaixoDoTanque) {
        const tq = B.CLASSES.filter((o) => D.classes[o].role === 'tanque')[0];
        const lim = tq ? fx.abaixoDoTanque * porClasse[tq].unico : Infinity;
        check(pre + 'bate menos que ' + Math.round(fx.abaixoDoTanque * 100) + '% do tanque num alvo só (' + m.unico.toFixed(1) +
          ' contra ' + (tq ? porClasse[tq].unico.toFixed(1) : '?') + ')', m.unico <= lim + 1e-9, m.unico.toFixed(1));
      }
      if (vale && fx.fundo) {
        const k = fx.fundo, menor = Math.min.apply(null, B.CLASSES.map((o) => porClasse[o][k]));
        check(pre + 'é quem tem o menor ' + NOME[k] + ' do elenco (' + m[k].toFixed(1) + '; o menor é ' + menor.toFixed(1) + ')',
          m[k] <= menor * 1.03 + 1e-9, m[k].toFixed(1));
      }
      const pod = B.ELEMS.map((e) => poder(r.P[nivel][c][e]));
      const mp = pod.reduce((s, v) => s + v, 0) / pod.length;
      B.ELEMS.forEach((e, i) => {
        const x = mp > 0 ? pod[i] / mp : 0;
        check('nível ' + nivel + ' · ' + c + ' caminho ' + e + ': poder ' + x.toFixed(2) + '× a média da classe (±' + pct(FAIXA_CAMINHO) + ')',
          Math.abs(x - 1) <= FAIXA_CAMINHO, x.toFixed(2) + '×');
      });
    });
  });
}

// ------------------------------------------------------------------- fusão
async function fusao() {
  const combos = COMPLETO ? B.todosCombos() : B.combosRapidos();
  const niveis = SO_NIVEIS || B.NIVEIS.concat(B.NIVEIS_PROVA);
  const jobs = [];
  niveis.forEach((nivel) => B.duplas().forEach(([a, b]) => {
    if (SO_CLASSES && SO_CLASSES.indexOf(a) < 0 && SO_CLASSES.indexOf(b) < 0) return;
    jobs.push({ tipo: 'fusao', a, b, nivel, combos });
  }));
  const res = await rodaTudo(jobs, 'fusão');
  const R = {};
  jobs.forEach((j, i) => { (R[j.a + '+' + j.b] = R[j.a + '+' + j.b] || {})[j.nivel] = res[i]; });
  console.log('\n== FUSÃO contra os dois separados (3 rodadas inteiras de cada lado; ' + combos.length + ' misturas; ' +
    'média geométrica da razão)');
  console.log('dupla'.padEnd(24) + niveis.map((n) => ('nv' + n + (B.NIVEIS_PROVA.indexOf(n) >= 0 ? '*' : '')).padStart(8)).join(''));
  Object.keys(R).sort().forEach((k) => {
    console.log(k.padEnd(24) + niveis.map((n) => pct(R[k][n].razao).padStart(8)).join(''));
  });
  console.log('(* = nível de conferência, fora do ajuste do PAIR_TUNE)');
  return { R, niveis };
}
function julgaFusao(r) {
  Object.keys(r.R).sort().forEach((k) => r.niveis.forEach((n) => {
    const x = r.R[k][n].razao;
    check('fusão ' + k + ' nível ' + n + ': ' + pct(x) + ' dos dois separados (±' + pct(FAIXA_FUSAO) + ')',
      Math.abs(x - 1) <= FAIXA_FUSAO + 1e-9, pct(x));
  }));
}

// ------------------------------------------------------------------ duelos
/* QUANTOS JOGOS. Cada célula são 7 parceiros × S sementes × 2 lados. Com S = 2
 * (a prova rápida) são 28 jogos, e o desvio de uma taxa de 50% é de ~9
 * pontos: uma célula certa cai fora de 40–60% uma vez em quatro só por
 * sorteio. Por isso a prova rápida cobra a MÉDIA de cada classe contra as
 * outras seis (168 jogos, ~4 pontos de desvio) dentro de 45–55%, e só acusa a
 * célula quando o intervalo de 90% dela inteiro fica fora de 40–60%. A medida
 * completa (`--completo`, S = 11: 154 jogos por célula, ~4 pontos) julga cada
 * célula pelo número dela, sem intervalo — é a tabela do documento. */
const FAIXA_MEDIA_DUELO = [0.45, 0.55];
async function duelos() {
  const sementes = typeof opt('sementes', null) === 'string' ? +opt('sementes') : (COMPLETO ? 11 : 2);
  const parceiros = B.CLASSES.slice();
  const jobs = [];
  const pares = [];
  for (let i = 0; i < B.CLASSES.length; i++) for (let j = i + 1; j < B.CLASSES.length; j++) {
    const x = B.CLASSES[i], y = B.CLASSES[j];
    if (SO_CLASSES && SO_CLASSES.indexOf(x) < 0 && SO_CLASSES.indexOf(y) < 0) continue;
    pares.push([x, y]);
  }
  NIVEIS.forEach((nivel) => pares.forEach(([x, y]) => jobs.push({ tipo: 'celula', x, y, nivel, sementes, parceiros })));
  // um contra um, sem cobrança: mostra o kit cru (docs/EQUILIBRIO.md §4)
  const jobs1 = [];
  if (!SEM_1V1) NIVEIS.forEach((nivel) => pares.forEach(([x, y]) => jobs1.push({ tipo: 'celula', x, y, nivel, sementes: COMPLETO ? 24 : 8, parceiros: [] })));
  const res = await rodaTudo(jobs.concat(jobs1), 'duelos');
  const M = {}, M1 = {};
  jobs.forEach((j, i) => { ((M[j.nivel] = M[j.nivel] || {})[j.x] = M[j.nivel][j.x] || {})[j.y] = res[i]; });
  jobs1.forEach((j, i) => { ((M1[j.nivel] = M1[j.nivel] || {})[j.x] = M1[j.nivel][j.x] || {})[j.y] = res[jobs.length + i]; });
  function celDe(T, nivel, x, y) {
    const a = T[nivel] && T[nivel][x] && T[nivel][x][y];
    if (a) return { taxa: a.taxa, jogos: a.jogos };
    const b = T[nivel] && T[nivel][y] && T[nivel][y][x];
    return b ? { taxa: 1 - b.taxa, jogos: b.jogos } : null;
  }
  function mostra(T, titulo) {
    if (!Object.keys(T).length) return;
    console.log('\n== ' + titulo);
    NIVEIS.forEach((nivel) => {
      console.log('\nNível ' + nivel + ' — vitória da LINHA contra a COLUNA');
      console.log(''.padEnd(12) + B.CLASSES.map((c) => c.slice(0, 7).padStart(8)).join('') + '   média');
      B.CLASSES.forEach((x) => {
        let s = 0, n = 0;
        const cel = B.CLASSES.map((y) => {
          if (x === y) return '   —    ';
          const c = celDe(T, nivel, x, y);
          if (!c) return '    ·   ';
          s += c.taxa * c.jogos; n += c.jogos;
          return pct(c.taxa).padStart(8);
        });
        console.log(x.padEnd(12) + cel.join('') + '   ' + (n ? pct(s / n) : '·'));
      });
    });
  }
  // o placar por caminho (elemento) de cada classe, somando todas as células
  function porCaminho(T) {
    const out = {};
    NIVEIS.forEach((nivel) => Object.keys(T[nivel] || {}).forEach((x) => Object.keys(T[nivel][x]).forEach((y) => {
      const c = T[nivel][x][y];
      [[x, c.elemX], [y, c.elemY]].forEach(([cl, tab]) => Object.keys(tab || {}).forEach((e) => {
        const k = nivel + ':' + cl + ':' + e;
        const r = out[k] || (out[k] = [0, 0]);
        r[0] += tab[e][0]; r[1] += tab[e][1];
      }));
    })));
    return out;
  }
  mostra(M, 'DUELOS EM DUPLA: X+Z contra Y+Z, o mesmo parceiro Z dos dois lados (' + parceiros.length + ' parceiros × ' + sementes + ' sementes × 2 lados)');
  const PC = porCaminho(M);
  console.log('\ncaminhos nos duelos em dupla (vitória por caminho fogo/água/terra/ar, todas as células somadas):');
  NIVEIS.forEach((nivel) => {
    console.log('  nível ' + nivel + ': ' + B.CLASSES.map((c) => c.slice(0, 6) + ' ' + B.ELEMS.map((e) => {
      const r = PC[nivel + ':' + c + ':' + e]; return r ? Math.round(100 * r[0] / r[1]) : '·';
    }).join('/')).join('  '));
  });
  mostra(M1, 'DUELOS UM CONTRA UM (sem cobrança — o kit cru)');
  return { M, M1, sementes, PC };
}
// intervalo de Wilson (90%): na prova rápida a célula só é acusada quando ele
// inteiro fica fora da faixa
function wilson(p, n, z) {
  if (!n) return [0, 1];
  const d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [c - m, c + m];
}
function julgaDuelos(r) {
  const niveis = Object.keys(r.M).map(Number);
  niveis.forEach((nivel) => {
    const soma = {}, jogos = {};
    Object.keys(r.M[nivel]).forEach((x) => Object.keys(r.M[nivel][x]).forEach((y) => {
      const c = r.M[nivel][x][y];
      soma[x] = (soma[x] || 0) + c.taxa * c.jogos; jogos[x] = (jogos[x] || 0) + c.jogos;
      soma[y] = (soma[y] || 0) + (1 - c.taxa) * c.jogos; jogos[y] = (jogos[y] || 0) + c.jogos;
      const ic = wilson(c.taxa, c.jogos, 1.645);
      const ok = COMPLETO ? (c.taxa >= FAIXA_DUELO[0] - 1e-9 && c.taxa <= FAIXA_DUELO[1] + 1e-9)
                          : (ic[1] >= FAIXA_DUELO[0] && ic[0] <= FAIXA_DUELO[1]);
      check('duelo nível ' + nivel + ' · ' + x + ' contra ' + y + ': ' + pct(c.taxa) + ' em ' + c.jogos +
        (COMPLETO ? '' : ' (90%: ' + pct(ic[0]) + '–' + pct(ic[1]) + ')') + ' — faixa ' + pct(FAIXA_DUELO[0]) + '–' + pct(FAIXA_DUELO[1]),
        ok, pct(c.taxa));
    }));
    if (SO_CLASSES) return;
    B.CLASSES.forEach((c) => {
      if (!jogos[c]) return;
      const m = soma[c] / jogos[c];
      check('duelo nível ' + nivel + ' · média de ' + c + ' contra as outras: ' + pct(m) + ' em ' + jogos[c] +
        ' (faixa ' + pct(FAIXA_MEDIA_DUELO[0]) + '–' + pct(FAIXA_MEDIA_DUELO[1]) + ')',
        m >= FAIXA_MEDIA_DUELO[0] - 1e-9 && m <= FAIXA_MEDIA_DUELO[1] + 1e-9, pct(m));
    });
  });
}

(async function () {
  const t0 = Date.now();
  const saida = {};
  try {
    if (modo === 'perfis' || modo === 'prova') { saida.perfis = await perfis(); }
    if (modo === 'fusao' || modo === 'prova') { saida.fusao = await fusao(); }
    if (modo === 'duelos' || modo === 'prova') { saida.duelos = await duelos(); }
  } catch (e) {
    console.error('ERRO: ' + (e && e.stack || e));
    process.exit(2);
  }
  console.log('');
  if (saida.perfis) julgaPerfis(saida.perfis);
  if (saida.fusao) julgaFusao(saida.fusao);
  if (saida.duelos) julgaDuelos(saida.duelos);
  if (SAIDA) fs.writeFileSync(SAIDA, JSON.stringify(saida));
  console.log('\n' + (falhas ? 'FALHOU' : 'TUDO PASSOU') + ' — ' + (total - falhas) + ' de ' + total + ' na faixa · ' +
    Math.round((Date.now() - t0) / 1000) + ' s');
  process.exitCode = falhas ? 1 : 0;
})();
