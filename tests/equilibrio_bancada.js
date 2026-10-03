/* ============================================================================
 * SOTERRA 2.0 — tests/equilibrio_bancada.js  (03/10/2026)
 * A BANCADA DO EQUILÍBRIO: mede classes, caminhos, fusões e duelos com a MESMA
 * régua, sem navegador e sem sorte. As faixas que ela cobra e o porquê de cada
 * uma estão em docs/EQUILIBRIO.md.
 *
 * Quem usa:
 *   - tests/equilibrio.js (Node): `node tests/equilibrio.js` — a prova inteira;
 *   - tests/equilibrio_fusao.html (navegador): a mesma conta da fusão, na tela.
 * Por isso este arquivo não conhece Node nem DOM: recebe o JOGO pronto
 * (`EquilibrioBancada.cria(JOGO)`) e devolve números.
 *
 * DETERMINÍSTICA. Todo sorteio passa pelo `_rng` do estado, e todo estado nasce
 * de uma semente fixa. A mesma árvore dá o mesmo número em qualquer máquina —
 * a régua não pode mudar de humor entre a medida de antes e a de depois.
 *
 * OS QUATRO DEFEITOS DA BANCADA ANTIGA CONTINUAM PROIBIDOS (README §7.1):
 *  1. a fusão medida com a sobra de PA da declaração: aqui ela começa cada
 *     turno com o medidor CHEIO, como os dois heróis separados;
 *  2. área mirada no canto do alcance: aqui a casa-alvo é a que cobre mais
 *     inimigos (ou aliados, num feitiço de apoio) — `candidatas`;
 *  3. instantâneo que não volta tudo: aqui `salva`/`volta` copiam o estado
 *     INTEIRO (efeitos, recargas, semente, muros, armadilhas, invocações,
 *     ordem de turno, clima) — sondar um feitiço não deixa rastro no seguinte;
 *  4. "melhor feitiço repetido": aqui o turno é montado lance a lance, com
 *     limite por turno, recarga e PA conferidos pelo próprio motor.
 * E um quinto, que só aparece quando se mede MAIS de um turno: veneno, marca,
 * invocação e bônus de poder rendem DEPOIS. Medir um turno só zerava o veneno
 * do Bruxo e as marcas do Caçador. Aqui cada medida dura algumas rodadas e o
 * que ficou plantado colhe dentro dela (o potencial `fi` só orienta a escolha;
 * o número publicado é o que o motor de fato entregou).
 * ==========================================================================*/
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.EquilibrioBancada = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var ELEMS = ['fogo', 'agua', 'terra', 'ar'];
  // Os quatro níveis da régua: a escolha do elemento (5), o meio da escada (12,
  // onde estava a régua antiga), o 20 e o troféu (30).
  var NIVEIS = [5, 12, 20, 30];
  // Níveis que NÃO entram no ajuste do PAIR_TUNE — só na conferência. Um ajuste
  // de três parâmetros por dupla mede quatro níveis e é conferido em dois que
  // ele nunca viu: se passasse só onde foi ajustado, era decoreba, não regra.
  var NIVEIS_PROVA = [16, 25];

  // Arena aberta: 15×11 com borda de muro. Sem muro no meio de propósito — o
  // perfil mede o KIT, não o mapa; o mapa entra nos duelos, que rodam nas salas
  // de verdade.
  var LARG = 15, ALT = 11;

  function hash32(s) {
    var h = 2166136261 >>> 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function cria(J) {
    var E = J.Engine, P = J.Progress, F = J.Fusion, AI = J.AI, D = J.DATA;
    if (!E || !P || !F || !AI || !D) throw new Error('bancada: JOGO incompleto (Engine/Progress/Fusion/AI/DATA)');
    var CLASSES = Object.keys(D.classes).filter(function (c) { return c !== 'gm'; });

    // ------------------------------------------------------------- heróis
    /* O herói sai do MESMO caminho do jogo (Progress.battleParty): stats do
     * nível, ganho elemental, defesa por papel e os feitiços liberados até ali.
     * Sem item, sem estrela, sem pet — a régua compara corpos nus. */
    var cacheHeroi = {};
    function heroi(classe, elemento, nivel) {
      var k = classe + ':' + elemento + ':' + nivel;
      if (!cacheHeroi[k]) {
        P.reset();
        try { P.unlockClass(classe); } catch (e) { /* as iniciais já nascem livres */ }
        var h = P.hero(classe);
        if (!h) throw new Error('bancada: sem herói para ' + classe);
        h.level = nivel;
        h.element = nivel >= 5 ? elemento : 'neutro';
        var e = P.battleParty([classe])[0];
        if (!e) throw new Error('bancada: battleParty vazio para ' + classe);
        cacheHeroi[k] = JSON.stringify(e);
      }
      return JSON.parse(cacheHeroi[k]);
    }

    function boneco(nome) {
      return { heroId: nome, classId: CLASSES[0], element: 'neutro', level: 1, spells: [], name: 'Boneco',
               stats: { hp: 1000000, pa: 0, pp: 0, initiative: 0, power: 0, elemPower: 0, dodge: 0, lock: 0,
                        resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 } } };
    }

    // ----------------------------------------------------- estado e volta
    /* O instantâneo é o estado INTEIRO, em JSON (o motor só guarda dado puro no
     * estado). Mais lento que copiar meia dúzia de campos, e é de propósito: a
     * bancada antiga copiava só o que lembrava, e cada coisa esquecida — os
     * efeitos, a semente, o muro do Minotauro, a armadilha — virou um defeito
     * de medida com nome no README. Depois de `volta`, quem guardou referência
     * a uma unidade tem de buscá-la de novo pelo uid. */
    function salva(st) { return JSON.stringify(st); }
    function volta(st, s) {
      var o = JSON.parse(s), k;
      for (k in st) if (Object.prototype.hasOwnProperty.call(st, k) && !Object.prototype.hasOwnProperty.call(o, k)) delete st[k];
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) st[k] = o[k];
      E.state = st;
      E.events.length = 0;
    }
    function U(st, uid) { return E.findUnit(st, uid); }

    function gradeAberta() {
      var tiles = [];
      for (var y = 0; y < ALT; y++) {
        var row = [];
        for (var x = 0; x < LARG; x++) {
          var borda = x === 0 || y === 0 || x === LARG - 1 || y === ALT - 1;
          row.push({ type: borda ? 'wall' : 'floor', deco: false });
        }
        tiles.push(row);
      }
      return { w: LARG, h: ALT, tiles: tiles };
    }

    /* O PALCO: `lado` (1 ou 2 heróis) contra `casasBonecos.length` bonecos de
     * um milhão de PV que não agem. Monta pelo createDuel (a porta do motor
     * para dois lados de heróis) e troca o chão pela arena aberta. O mapa é o
     * da Praça para o motor (sem clima que gira e sem evento de chão — o perfil
     * não é sorteio). */
    function palco(lado, casasLado, casasBonecos) {
      var st = E.createDuel(lado.slice(0, 2), [boneco('boneco0')], { seed: 'bancada' });
      st.dungeonId = 'praca';
      st.weather = 'calmo';
      st._weatherIdx = 0;
      st.grid = gradeAberta();
      var herois = st.units.filter(function (u) { return u.side === 'player'; });
      herois.forEach(function (u, i) { u.x = casasLado[i].x; u.y = casasLado[i].y; });
      var b0 = st.units.filter(function (u) { return u.side === 'enemy'; })[0];
      b0.x = casasBonecos[0].x; b0.y = casasBonecos[0].y;
      for (var i = 1; i < casasBonecos.length; i++) {
        var c = JSON.parse(JSON.stringify(b0));
        c.uid = 'boneco' + i;
        c.x = casasBonecos[i].x; c.y = casasBonecos[i].y;
        st.units.push(c);
        st.order.push(c.uid);
      }
      E.events.length = 0;
      return st;
    }

    // ------------------------------------------------------ a contabilidade
    /* O que um lance RENDEU, lido dos eventos do motor (e não da diferença de
     * PV): o dano conta o golpe inteiro, inclusive o que o escudo segurou; a
     * cura conta o que de fato fechou; o escudo conta o que foi CONCEDIDO; o
     * controle conta o que tirou do outro lado. Invocação e pet entram pelo
     * que FAZEM (o dano deles é evento como qualquer outro), nunca pelo corpo
     * que põem no chão. Fogo amigo desconta. */
    // `heroi`: o dano que saiu do PRÓPRIO herói (sourceUid), sem o das
    // invocações — é o que o alcance mede (o Xamã parado a 8 casas "acertava"
    // com o bicho que andou até lá)
    function zera() { return { dano: 0, heroi: 0, cura: 0, escudo: 0, amigo: 0, controle: 0 }; }
    function apura(st, acc) {
      var evs = E.events;
      for (var i = 0; i < evs.length; i++) {
        var ev = evs[i], u;
        if (ev.type === 'damage' && ev.amount > 0) {
          u = U(st, ev.uid); if (!u) continue;
          if (u.side === 'enemy') {
            acc.dano += ev.amount;
            var fonte = ev.sourceUid ? U(st, ev.sourceUid) : null;
            if (fonte && (fonte.kind === 'hero' || fonte.kind === 'fusion')) acc.heroi += ev.amount;
          }
          else if (u.kind === 'hero' || u.kind === 'fusion') acc.amigo += ev.amount;
        } else if (ev.type === 'heal' && ev.amount > 0) {
          u = U(st, ev.uid);
          if (u && u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion')) acc.cura += ev.amount;
        } else if (ev.type === 'shield' && ev.amount > 0 && !ev.fusao) {
          u = U(st, ev.uid);
          if (u && u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion')) acc.escudo += ev.amount;
        } else if (ev.type === 'effectApplied' && ev.effect) {
          u = U(st, ev.uid); if (!u || u.side !== 'enemy') continue;
          var ef = ev.effect;
          // PP negado: a raiz zera o passo (3, o PP comum) por turno; o buff
          // negativo tira o que diz; PA vale o dobro, porque é a ação.
          if (ef.type === 'root') acc.controle += 3 * (ef.duration || 1);
          else if (ef.type === 'buff' && ef.value < 0 && ef.stat === 'pp') acc.controle += -ef.value * (ef.duration || 1);
          else if (ef.type === 'buff' && ef.value < 0 && ef.stat === 'pa') acc.controle += -2 * ef.value * (ef.duration || 1);
        } else if (ev.type === 'pushed') {
          u = U(st, ev.uid);
          if (u && u.side === 'enemy') acc.controle += Math.abs(ev.toX - ev.fromX) + Math.abs(ev.toY - ev.fromY);
        } else if (ev.type === 'wallRaised') {
          acc.controle += 0.5 * (ev.duration || 1);
        }
      }
      E.events.length = 0;
    }
    function soma(a, b) { for (var k in b) a[k] = (a[k] || 0) + b[k]; return a; }

    // ---------------------------------------------- o que ainda vai render
    /* O POTENCIAL `fi`: quanto do que está plantado ainda vai render ANTES de a
     * medida acabar. Só orienta a escolha gulosa (o número publicado é o que
     * os eventos contaram). Sem ele o guloso de um lance só nunca escolheria
     * veneno nem marca — o golpe rende zero na hora e tudo depois. */
    function restantes(st, uid, H) {
      var i = st.order.indexOf(uid);
      var resto = H - st.round;
      if (i > st.activeIdx) resto++;
      return Math.max(0, resto);
    }
    function mediaDano(sp) {
      var t = 0, efs = (sp && sp.effects) || [];
      for (var i = 0; i < efs.length; i++) {
        var e = efs[i];
        if (e.type === 'damage') t += (e.min + e.max) / 2;
        else if (e.type === 'chain') t += (e.min + e.max) / 2;
      }
      return t;
    }
    // dano de um turno "de referência" de uma unidade: o melhor feitiço de
    // dano repetido no que o PA e o limite por turno deixam. Só escala o valor
    // de marca e de bônus de poder no potencial; não é medida.
    function refTurno(u) {
      if (u._refTurno != null) return u._refTurno;
      var best = 0;
      for (var i = 0; i < (u.spells || []).length; i++) {
        var sp = E.spell(u.spells[i]);
        if (!sp) continue;
        var m = mediaDano(sp);
        if (m <= 0) continue;
        var custo = Math.max(1, sp.paCost || 1);
        var vezes = Math.floor((u.paMax || 6) / custo);
        if (sp.castsPerTurn > 0) vezes = Math.min(vezes, sp.castsPerTurn);
        if (sp.cooldown > 0) vezes = Math.min(vezes, 1) / Math.max(1, sp.cooldown);
        best = Math.max(best, m * vezes * (100 + E.effPower(u) + (u.elemPower || 0)) / 100);
      }
      u._refTurno = best;
      return best;
    }
    function fi(st, H, objetivo) {
      var v = 0, i, j, u, ef;
      var ativo = E.activeUnit(st);
      for (i = 0; i < st.units.length; i++) {
        u = st.units[i];
        if (!u.alive || u.offBoard) continue;
        if (u.side === 'enemy') {
          if (objetivo === 'apoio') continue;
          var mm = E.markMultiplier(u);
          var tr = restantes(st, u.uid, H);
          for (j = 0; j < u.effects.length; j++) {
            ef = u.effects[j];
            if (ef.type === 'poison') {
              var tick = (ef.min + ef.max) / 2 * (100 + (ef.sourcePower || 0)) / 100 *
                         (100 - E.effResist(u, ef.element)) / 100 * mm;
              v += tick * Math.min(ef.duration, tr);
            } else if (ef.type === 'mark') {
              // cada pilha soma o valor dela em % sobre o que o lado ainda vai
              // bater nesse alvo enquanto a marca vive
              // (o boneco joga por último na rodada: a marca vive pelas vezes
              // do lado até o fim da vez dele, `duration` rodadas adiante)
              var lados = 0;
              for (var q = 0; q < st.units.length; q++) {
                var a = st.units[q];
                if (a.side !== 'player' || !a.alive || a.offBoard) continue;
                var jaFoi = st.order.indexOf(a.uid) <= st.activeIdx ? 1 : 0;
                var vezes = Math.max(0, Math.min(ef.duration - jaFoi, restantes(st, a.uid, H)));
                if (a === ativo) vezes += (a.pa || 0) / Math.max(1, a.paMax || 6);
                lados += refTurno(a) * vezes;
              }
              v += (ef.value || 5) / 100 * lados;
            }
          }
        } else if (u.kind === 'summon') {
          if (objetivo === 'apoio') continue;
          // a invocação rende o que bater nas vezes que ainda tem
          v += 0.7 * refTurno(u) * restantes(st, u.uid, H);
        } else if (u.kind === 'hero' || u.kind === 'fusion') {
          var trH = restantes(st, u.uid, H);
          for (j = 0; j < u.effects.length; j++) {
            ef = u.effects[j];
            // o efeito no herói perde uma rodada no FIM da vez dele: posto na
            // própria vez vale o resto dela e `duration − 1` vezes seguintes;
            // posto num aliado que ainda vai jogar, `duration` vezes
            var proprio = u === ativo ? 1 : 0;
            if (ef.type === 'regen' && objetivo !== 'dano') {
              v += (ef.min + ef.max) / 2 * Math.max(0, Math.min(ef.duration - proprio, trH));
            } else if (ef.type === 'buff' && ef.stat === 'power' && ef.value > 0 && objetivo !== 'apoio') {
              var vz = Math.max(0, Math.min(ef.duration - proprio, trH)) + (proprio ? (u.pa || 0) / Math.max(1, u.paMax || 6) : 0);
              v += ef.value / 100 * refTurno(u) * vz;
            }
          }
        }
      }
      return v;
    }

    function valorDe(acc, objetivo) {
      if (objetivo === 'dano') return acc.dano - acc.amigo;
      if (objetivo === 'apoio') return acc.cura + acc.escudo;
      if (objetivo === 'controle') return acc.controle;
      return acc.dano - acc.amigo + acc.cura + acc.escudo;     // 'valor' (a régua da fusão)
    }

    // ------------------------------------------------------ onde mirar
    /* Até três casas por feitiço: a que cobre mais inimigos, a que cobre mais
     * aliados e a casa vazia mais perto do inimigo (onde muro, invocação e
     * armadilha se plantam). Quem decide entre elas é a sondagem, não palpite. */
    function candidatas(st, u, sid, alvos) {
      if (!alvos.length) return [];
      var inim = {}, ali = {}, inimigos = [];
      for (var i = 0; i < st.units.length; i++) {
        var w = st.units[i];
        if (!w.alive || w.offBoard) continue;
        if (w.side === u.side) ali[w.x + ',' + w.y] = 1;
        else { inim[w.x + ',' + w.y] = 1; inimigos.push(w); }
      }
      var cInim = null, nInim = 0, cAli = null, nAli = 0, cVazia = null, dVazia = 1e9;
      for (i = 0; i < alvos.length; i++) {
        var c = alvos[i];
        var tiles = E.aoeTiles(st, sid, u.x, u.y, c.x, c.y) || [];
        var a = 0, b = 0;
        for (var t = 0; t < tiles.length; t++) {
          var k = tiles[t].x + ',' + tiles[t].y;
          if (inim[k]) a++;
          if (ali[k]) b++;
        }
        if (a > nInim) { nInim = a; cInim = c; }
        if (b > nAli) { nAli = b; cAli = c; }
        if (!a && !b) {
          var dist = 1e9;
          for (var q = 0; q < inimigos.length; q++) {
            dist = Math.min(dist, Math.abs(c.x - inimigos[q].x) + Math.abs(c.y - inimigos[q].y));
          }
          dist = dist * 100 + Math.abs(c.x - u.x) + Math.abs(c.y - u.y);
          if (dist < dVazia) { dVazia = dist; cVazia = c; }
        }
      }
      var out = [];
      if (cInim) out.push(cInim);
      if (cAli && cAli !== cInim) out.push(cAli);
      if (cVazia) out.push(cVazia);
      return out;
    }

    /* AS OPÇÕES DE UM LANCE: para cada feitiço que sai agora, as casas boas a
     * partir de onde a unidade está; se ele não alcança ninguém dali, a casa
     * mais barata (no PP que sobra) de onde alcança. O passo é RELOCAÇÃO
     * direta: o boneco não fixa ninguém e o perfil não é sorteio de esquiva. */
    function opcoes(st, uid, semPasso) {
      var u = U(st, uid), out = [];
      var alcancaveis = null;
      for (var i = 0; i < u.spells.length; i++) {
        var sid = u.spells[i];
        if (!E.podeLancar(st, uid, sid)) continue;
        var cs = candidatas(st, u, sid, E.castTargets(st, uid, sid));
        var util = cs.length && (cs.length > 1 || E.spell(sid).targetSide !== 'enemy' || temGente(st, u, sid, cs[0]));
        if (util) { for (var c = 0; c < cs.length; c++) out.push({ sid: sid, x: cs[c].x, y: cs[c].y }); }
        // A ÁREA EM VOLTA DO CORPO (alcance 0): a casa boa não é a de agora, é
        // a que encosta em mais inimigos. Sem isto o Bárbaro girava o machado
        // pegando um boneco do L com dois ao alcance de um passo.
        var sp0 = E.spell(sid);
        if (!semPasso && u.pp > 0 && sp0 && (sp0.range && sp0.range.max === 0) && sp0.aoe && sp0.aoe.size > 0) {
          if (!alcancaveis) alcancaveis = E.reachable(st, uid).sort(function (a, b) { return a.cost - b.cost || a.y - b.y || a.x - b.x; });
          var agora = contaInimigos(st, u, sid, u.x, u.y), melhorCel = null, melhorN = agora;
          for (var r0 = 0; r0 < alcancaveis.length; r0++) {
            var n0 = contaInimigos(st, u, sid, alcancaveis[r0].x, alcancaveis[r0].y);
            if (n0 > melhorN) { melhorN = n0; melhorCel = alcancaveis[r0]; }
          }
          if (melhorCel) out.push({ sid: sid, x: melhorCel.x, y: melhorCel.y, mx: melhorCel.x, my: melhorCel.y, custo: melhorCel.cost });
        }
        if (util) continue;
        if (semPasso || u.pp <= 0) continue;
        if (!alcancaveis) alcancaveis = E.reachable(st, uid).sort(function (a, b) { return a.cost - b.cost || a.y - b.y || a.x - b.x; });
        var x0 = u.x, y0 = u.y;
        for (var r = 0; r < alcancaveis.length; r++) {
          var cel = alcancaveis[r];
          u.x = cel.x; u.y = cel.y;
          var cs2 = candidatas(st, u, sid, E.castTargets(st, uid, sid));
          if (cs2.length && temGente(st, u, sid, cs2[0])) {
            for (var c2 = 0; c2 < cs2.length; c2++) out.push({ sid: sid, x: cs2[c2].x, y: cs2[c2].y, mx: cel.x, my: cel.y, custo: cel.cost });
            break;
          }
        }
        u.x = x0; u.y = y0;
      }
      return out;
    }
    function contaInimigos(st, u, sid, cx, cy) {
      var tiles = E.aoeTiles(st, sid, cx, cy, cx, cy) || [], n = 0;
      for (var t = 0; t < tiles.length; t++) {
        var w = E.unitAt(st, tiles[t].x, tiles[t].y);
        if (w && w.alive && w !== u && w.side !== u.side) n++;
      }
      return n;
    }
    function temGente(st, u, sid, c) {
      var tiles = E.aoeTiles(st, sid, u.x, u.y, c.x, c.y) || [];
      for (var t = 0; t < tiles.length; t++) {
        var w = E.unitAt(st, tiles[t].x, tiles[t].y);
        if (w && w.alive && w.side !== u.side) return true;
      }
      return false;
    }
    function executa(st, uid, o) {
      var u = U(st, uid);
      if (o.mx != null) {
        if (u.pp < (o.custo || 0)) return false;
        u.pp -= o.custo || 0;
        u.x = o.mx; u.y = o.my;
      }
      return E.cast(st, uid, o.sid, o.x, o.y);
    }

    /* O TURNO GULOSO: a cada lance, sonda todas as opções e fica com a que
     * rende mais (realizado + potencial). Duas variantes, e vale a melhor no
     * fim: por RENDIMENTO do lance e por rendimento POR PA — sozinha, a
     * primeira gasta 6 PA num estouro quando dois golpes de 3 rendem mais. */
    function turnoGuloso(st, uid, H, objetivo, porPA, acc, semPasso) {
      var guarda = 0;
      while (guarda++ < 14) {
        var u = U(st, uid);
        if (!u || !u.alive || u.offBoard || st.phase !== 'playing') return;
        var ops = opcoes(st, uid, semPasso);
        if (!ops.length) return;
        var marco = salva(st);
        var fi0 = fi(st, H, objetivo);
        var melhor = null, melhorNota = 0;
        for (var i = 0; i < ops.length; i++) {
          var pa0 = U(st, uid).pa;
          var tmp = zera();
          if (!executa(st, uid, ops[i])) { volta(st, marco); continue; }
          apura(st, tmp);
          var ganho = valorDe(tmp, objetivo) + fi(st, H, objetivo) - fi0;
          var gasto = Math.max(1, pa0 - (U(st, uid) ? U(st, uid).pa : 0));
          volta(st, marco);
          var nota = porPA ? ganho / gasto : ganho;
          if (nota > melhorNota + 1e-9) { melhorNota = nota; melhor = ops[i]; }
        }
        if (!melhor) return;
        if (!executa(st, uid, melhor)) return;
        apura(st, acc);
      }
    }

    /* A RODADA: quem é do lado medido joga pela política; invocação e pet do
     * lado medido jogam pela IA do jogo (é como eles jogam de verdade); boneco
     * passa. `ancora` devolve cada um à sua casa no começo da vez dele — o
     * perfil mede o kit numa geometria FIXA, e não o quanto o empurrão
     * espalhou o alvo. */
    function joga(st, H, politica, ancoras) {
      var acc = zera(), guarda = 0;
      E.events.length = 0;
      while (st.phase === 'playing' && st.round <= H && guarda++ < 400) {
        var u = E.activeUnit(st);
        if (!u) break;
        if (u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion')) {
          if (ancoras) reancora(st, ancoras);
          politica(st, u.uid, acc);
        } else if (u.side === 'player') {
          var plano = null;
          try { plano = AI.planTurn(st, u.uid); } catch (e) { plano = null; }
          for (var i = 0; plano && i < plano.length && st.phase === 'playing'; i++) {
            var a = plano[i];
            if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
            else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
            else break;
          }
          apura(st, acc);
        }
        if (st.phase !== 'playing') break;
        E.endTurn(st);
        apura(st, acc);
      }
      return acc;
    }
    function reancora(st, ancoras) {
      for (var uid in ancoras) {
        var u = U(st, uid), c = ancoras[uid];
        if (!u || !u.alive || u.offBoard || (u.x === c.x && u.y === c.y)) continue;
        var o = E.unitAt(st, c.x, c.y);
        var t = st.grid.tiles[c.y][c.x];
        if (!o && t.type === 'floor') { u.x = c.x; u.y = c.y; }
      }
    }

    function politicaGulosa(H, objetivo, porPA, semPasso) {
      return function (st, uid, acc) { turnoGuloso(st, uid, H, objetivo, porPA, acc, semPasso); };
    }
    // as duas variantes, do MESMO estado inicial; vale a melhor no objetivo
    function melhorDasDuas(st, H, objetivo, ancoras, semPasso) {
      var s0 = salva(st);
      var a = joga(st, H, politicaGulosa(H, objetivo, false, semPasso), ancoras);
      volta(st, s0);
      var b = joga(st, H, politicaGulosa(H, objetivo, true, semPasso), ancoras);
      volta(st, s0);
      return valorDe(a, objetivo) >= valorDe(b, objetivo) ? a : b;
    }

    // ------------------------------------------------------ perfil da classe
    var CENTRO = { x: 7, y: 5 };
    var GRUPO = [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 6 }];    // um L: área pega 2 ou 3, alvo único pega 1
    var TURNOS_PERFIL = 4;

    function ancorasDe(st, casas) {
      var out = {}, i = 0;
      st.units.forEach(function (u) {
        if (u.side === 'enemy') out[u.uid] = { x: u.x, y: u.y };
      });
      st.units.forEach(function (u) {
        if (u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion')) out[u.uid] = casas[i++] || { x: u.x, y: u.y };
      });
      return out;
    }

    /* PERFIL de uma classe num caminho e num nível. Tudo por TURNO (média de
     * quatro turnos — o que tem recarga não sai todo turno, e o veneno
     * plantado no terceiro ainda pinga no quarto):
     *   unico    dano em UM alvo, podendo andar (o melhor de quatro distâncias)
     *   area     dano somado em TRÊS alvos encostados (um L)
     *   alcance  a maior distância, SEM andar, de onde ainda sai ≥ 50% do
     *            melhor dano em alvo único
     *   apoio    cura + escudo concedidos a um aliado ferido (sem teto de PV),
     *            ou a si mesmo quando é só isso que o kit faz
     *   proprio  cura + escudo que o herói consegue dar a SI mesmo
     *   controle PP/PA negados, casas de empurrão e muro·turno (docs/EQUILIBRIO.md)
     *   vida     PV do nível × (1 + resistência média / 100) — a parte parada
     *            da vida efetiva; `vidaEfetiva` soma quatro turnos de `proprio`. */
    function perfil(classe, elemento, nivel) {
      var h = heroi(classe, elemento, nivel);
      var H = TURNOS_PERFIL, r = {};
      var i, st, acc;

      // alvo único: o melhor de 1, 3, 5 e 7 casas, andando
      var melhorUnico = 0;
      [1, 3, 5, 7].forEach(function (d) {
        var st1 = palco([h], [{ x: CENTRO.x - d, y: CENTRO.y }], [CENTRO]);
        semTeto(st1);
        var a1 = melhorDasDuas(st1, H, 'dano', ancorasDe(st1, [{ x: CENTRO.x - d, y: CENTRO.y }]));
        melhorUnico = Math.max(melhorUnico, a1.dano / H);
      });
      r.unico = melhorUnico;

      // alcance: parado, de 1 a 10 casas (na arena de 15 cabe até 7 em linha;
      // de 8 a 10 o herói vai para a diagonal)
      var porDist = [];
      for (var d = 1; d <= 10; d++) {
        var cx = CENTRO.x - Math.min(d, 6), cy = CENTRO.y - (d - Math.min(d, 6));
        if (cy < 1) { porDist.push(0); continue; }
        var st2 = palco([h], [{ x: cx, y: cy }], [CENTRO]);
        semTeto(st2);
        var a2 = melhorDasDuas(st2, H, 'dano', ancorasDe(st2, [{ x: cx, y: cy }]), true);
        porDist.push(a2.heroi / H);
      }
      var topo = Math.max.apply(null, porDist.concat([0]));
      r.alcance = 0;
      for (i = 0; i < porDist.length; i++) if (topo > 0 && porDist[i] >= 0.5 * topo) r.alcance = i + 1;
      r.porDistancia = porDist.map(Math.round);

      // área: três bonecos em L, o melhor de 1, 3 e 5 casas
      var melhorArea = 0;
      [1, 3, 5].forEach(function (d) {
        var casa = { x: CENTRO.x - d, y: CENTRO.y };
        var st3 = palco([h], [casa], GRUPO);
        semTeto(st3);
        var a3 = melhorDasDuas(st3, H, 'dano', ancorasDe(st3, [casa]));
        melhorArea = Math.max(melhorArea, a3.dano / H);
      });
      r.area = melhorArea;

      // apoio: um aliado ferido ao lado (a mesma classe, para não emprestar kit)
      var st4 = palco([h, heroi(classe, elemento, nivel)], [{ x: 3, y: 5 }, { x: 3, y: 6 }], [{ x: 11, y: 5 }]);
      semTeto(st4);
      var a4 = melhorDasDuas(st4, H, 'apoio', ancorasDe(st4, [{ x: 3, y: 5 }, { x: 3, y: 6 }]));
      // o par joga as duas vezes: metade do que o par concedeu é a de um herói
      r.apoio = (a4.cura + a4.escudo) / H / 2;
      r.cura = a4.cura / H / 2;          // RESTAURAR, o verbo do Curandeiro
      r.escudo = a4.escudo / H / 2;      // BARRAR com escudo, o do Minotauro

      // próprio: sozinho, ferido, só ele
      var st5 = palco([h], [{ x: 3, y: 5 }], [{ x: 11, y: 5 }]);
      semTeto(st5);
      var a5 = melhorDasDuas(st5, H, 'apoio', ancorasDe(st5, [{ x: 3, y: 5 }]));
      r.proprio = (a5.cura + a5.escudo) / H;

      // controle: o grupo em L, a 3 casas
      var st6 = palco([h], [{ x: CENTRO.x - 3, y: CENTRO.y }], GRUPO);
      semTeto(st6);
      var a6 = melhorDasDuas(st6, H, 'controle', ancorasDe(st6, [{ x: CENTRO.x - 3, y: CENTRO.y }]));
      r.controle = a6.controle / H;

      var res = h.stats.resists || {}, somaR = 0, nR = 0;
      ELEMS.concat(['neutro']).forEach(function (e) { somaR += res[e] || 0; nR++; });
      r.pv = h.stats.hp;
      r.vida = h.stats.hp * (1 + somaR / nR / 100);
      r.vidaEfetiva = r.vida + 4 * r.proprio;
      r.pp = h.stats.pp;
      r.iniciativa = h.stats.initiative;
      return r;
    }
    // A cura conta o que fecha. Com o teto de PV no lugar, quatro turnos de
    // cura enchiam o herói no segundo e o resto marcava zero — media o tamanho
    // da ferida, não o kit. O teto sobe, a ferida fica.
    function semTeto(st) {
      st.units.forEach(function (u) {
        if (u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion')) {
          u.hp = Math.max(1, Math.floor(u.hpMax / 2));
          u.hpMax = u.hp + 100000;
        }
      });
    }

    // ------------------------------------------------------------- fusão
    /* FUSÃO CONTRA OS DOIS SEPARADOS, com o mesmo orçamento: TRÊS RODADAS
     * INTEIRAS de cada lado. Separados, cada herói joga as três vezes dele com o
     * PA cheio (6+6 por rodada); fundidos, a fusão joga as três vezes dela com o
     * PA cheio (o maior dos dois + 4). O custo de 2 PA da declaração é uma
     * despesa de um turno só e fica fora da conta (fusion.js: "o turno seguinte
     * já nasce cheio").
     * Valor = dano no inimigo − fogo amigo + cura + escudo concedidos (régua de
     * sempre: ponto de vida devolvido adia a mesma morte que ponto tirado do
     * inimigo). Duas cenas — um alvo só e o L de três — e vale a SOMA: a
     * fusão que só presta num dos dois casos aparece pela metade. */
    var TURNOS_FUSAO = 3;
    var CENAS_FUSAO = [
      { nome: 'unico', bonecos: [{ x: 9, y: 5 }] },
      { nome: 'grupo', bonecos: [{ x: 9, y: 5 }, { x: 10, y: 5 }, { x: 9, y: 6 }] }
    ];
    var CASA_A = { x: 6, y: 5 }, CASA_B = { x: 6, y: 6 };

    function separados(a, b) {
      var tot = 0;
      CENAS_FUSAO.forEach(function (cena) {
        var st = palco([a, b], [CASA_A, CASA_B], cena.bonecos);
        semTeto(st);
        var acc = melhorDasDuas(st, TURNOS_FUSAO, 'valor', ancorasDe(st, [CASA_A, CASA_B]));
        tot += valorDe(acc, 'valor');
      });
      return tot / TURNOS_FUSAO;
    }
    function fundidos(a, b) {
      var tot = 0, pa = 0;
      CENAS_FUSAO.forEach(function (cena) {
        var st = palco([a, b], [CASA_A, CASA_B], cena.bonecos);
        var hs = st.units.filter(function (u) { return u.side === 'player'; });
        // a fusão nasce na casa de A, com B colado: quem declara é A
        var ua = hs.filter(function (u) { return u.heroId === a.heroId; })[0] || hs[0];
        var ub = hs.filter(function (u) { return u !== ua; })[0];
        ua.pa = Math.max(ua.pa, F.FUSION_PA_COST);
        st.activeIdx = st.order.indexOf(ua.uid);
        if (!F.declare(st, ua.uid, ub.uid) || !F.resolve(st)) throw new Error('bancada: fusão recusada ' + a.classId + '+' + b.classId);
        var f = U(st, ua.uid);
        // a vez é de quem a ordem diz; a fusão começa a rodada com o medidor cheio
        st.order = st.order.filter(function (id) { return id !== ub.uid; });
        st.order.sort(function (x, y) { return (U(st, y).initiative || 0) - (U(st, x).initiative || 0); });
        st.activeIdx = st.order.indexOf(f.uid);
        st.round = 1;
        f.pa = f.paMax; f.pp = f.ppMax;
        f.castsThisTurn = {};
        E.events.length = 0;
        semTeto(st);
        pa = f.paMax;
        var acc = melhorDasDuas(st, TURNOS_FUSAO, 'valor', ancorasDe(st, [CASA_A]));
        tot += valorDe(acc, 'valor');
      });
      return { valor: tot / TURNOS_FUSAO, pa: pa };
    }

    /* A RAZÃO de uma dupla num nível: média geométrica sobre as misturas de
     * elemento (`combos`, pares [elemA, elemB]). Média geométrica porque a
     * razão é multiplicativa: um 0,5 e um 2,0 têm de dar 1, não 1,25. */
    var cacheSep = {};
    function razaoDupla(ca, cb, nivel, combos) {
      var somaLog = 0, n = 0, det = [];
      combos.forEach(function (par) {
        var a = heroi(ca, par[0], nivel), b = heroi(cb, par[1], nivel);
        var ks = [ca, par[0], cb, par[1], nivel].join(':');
        if (cacheSep[ks] == null) cacheSep[ks] = separados(a, b);
        var s = cacheSep[ks];
        var f = fundidos(a, b);
        var r = s > 0 ? f.valor / s : 0;
        det.push({ elems: par.join('+'), sep: Math.round(s), fus: Math.round(f.valor), razao: r, pa: f.pa });
        if (r > 0) { somaLog += Math.log(r); n++; }
      });
      return { razao: n ? Math.exp(somaLog / n) : 0, detalhe: det };
    }
    function todosCombos() {
      var out = [];
      ELEMS.forEach(function (x) { ELEMS.forEach(function (y) { out.push([x, y]); }); });
      return out;
    }
    // o subconjunto da prova rápida: os 4 puros e 4 mistos em rodízio — cada
    // elemento aparece 4 vezes de cada lado, nenhum par se repete
    function combosRapidos() {
      return [['fogo', 'fogo'], ['agua', 'agua'], ['terra', 'terra'], ['ar', 'ar'],
              ['fogo', 'agua'], ['agua', 'terra'], ['terra', 'ar'], ['ar', 'fogo']];
    }
    function duplas() {
      var out = [];
      for (var i = 0; i < CLASSES.length; i++) for (var j = i + 1; j < CLASSES.length; j++) {
        out.push([CLASSES[i], CLASSES[j]].sort());
      }
      return out;
    }

    // ------------------------------------------------------------- duelos
    /* O DUELO: as duas IAs do jogo, na sala sorteada do PvP (as salas dos
     * calabouços abertos, como Coop.sorteiaArena) ou na Praça (o desafio), pelo
     * createDuelSala — a mesma porta do jogo e do juiz. O plano é executado
     * como o juiz executa (servidor/juiz/sala.js): uma vez por turno, sem
     * replanejar. Teto de 40 rodadas com a regra do PvP (vence a maior fração
     * de vida; igual é empate). */
    var SALAS_PVP = null;
    function salasPvp() {
      if (SALAS_PVP) return SALAS_PVP;
      SALAS_PVP = [];
      (D.dungeons || []).forEach(function (dg) {
        if (!dg || !dg.id || dg.id === 'poco' || !dg.rooms || !dg.rooms.length) return;
        if (D.portalFechado && D.portalFechado(dg.id)) return;
        dg.rooms.forEach(function (r, i) { SALAS_PVP.push({ dg: dg.id, sala: i }); });
      });
      (D.arenas || []).forEach(function (ar) { if (ar && ar.id === 'praca') SALAS_PVP.push({ dg: 'praca', sala: 0 }); });
      return SALAS_PVP;
    }
    function duelo(duplaA, duplaB, semente, sementeSala) {
      var salas = salasPvp();
      var s = salas[hash32('sala:' + (sementeSala != null ? sementeSala : semente)) % salas.length];
      var st = E.createDuelSala(s.dg, s.sala, duplaA, duplaB, { seed: semente });
      var guarda = 0;
      while (st.phase === 'playing' && guarda++ < 2000) {
        var u = E.activeUnit(st);
        if (!u) break;
        /* REPLANEJAR QUANDO O LANCE FALHA. A IA planeja o turno inteiro do
         * estado de antes e não prevê o efeito dos próprios golpes: o Bárbaro
         * empurra o alvo com a primeira machadada e a segunda, planejada na
         * casa antiga, não acha ninguém — o jogo recusa e o PA sobra. Um
         * jogador de verdade dá o passo e bate de novo. Medida com o plano
         * cru, toda classe que empurra (Bárbaro, Minotauro, metade do Ar)
         * aparecia mais fraca do que um jogador a faz; aqui, lance recusado
         * = plano novo do estado de agora (até 4 vezes por turno). Isto é
         * da BANCADA: a IA dos monstros no jogo segue como está. */
        var replanos = 0, acabou = false;
        var plano = null;
        try { plano = AI.planTurn(st, u.uid); } catch (e) { plano = null; }
        if (!plano || !plano.length) plano = [{ action: 'end' }];
        for (var i = 0; i < plano.length && st.phase === 'playing'; i++) {
          var a = plano[i], ok = true;
          try {
            if (a.action === 'move') ok = E.move(st, u.uid, a.x, a.y);
            else if (a.action === 'cast') ok = E.cast(st, u.uid, a.spellId, a.x, a.y);
            else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
          } catch (e2) { ok = false; /* o jogo também engole erro de execução da IA */ }
          if (!ok && a.action === 'cast' && replanos < 4 && st.phase === 'playing') {
            replanos++;
            try { plano = AI.planTurn(st, u.uid); } catch (e3) { plano = null; }
            if (!plano || !plano.length) plano = [{ action: 'end' }];
            i = -1;
          }
        }
        if (!acabou && st.phase === 'playing') E.endTurn(st);
        E.events.length = 0;
      }
      return { fase: st.phase, rodada: st.round, sala: s.dg + ':' + s.sala };
    }

    /* UMA CÉLULA DA MATRIZ: X contra Y no nível, com `parceiros` (a lista de
     * classes que acompanham os dois lados; vazia = um contra um). Cada
     * semente sorteia a sala e os quatro elementos, e joga DUAS vezes com os
     * lados trocados (quem nasce nos P e quem nasce nas letras) — a casa de
     * nascer não pode decidir quem é melhor. Empate vale meio. */
    function celula(cx, cy, nivel, sementes, parceiros) {
      var pontos = 0, jogos = 0, rodadas = 0, empates = 0;
      // o placar por CAMINHO dos dois lados: o caminho fraco aparece aqui
      // mesmo quando a média da classe está boa
      var elemX = {}, elemY = {};
      function marca(t, e, p) { var r = t[e] || (t[e] = [0, 0]); r[0] += p; r[1] += 2; }
      var parc = parceiros && parceiros.length ? parceiros : [null];
      for (var p = 0; p < parc.length; p++) {
        for (var s = 0; s < sementes; s++) {
          var sem = [cx, cy, nivel, parc[p] || '-', s].join(':');
          var h = hash32(sem);
          var ex = ELEMS[h % 4], ey = ELEMS[(h >>> 2) % 4], ez1 = ELEMS[(h >>> 4) % 4], ez2 = ELEMS[(h >>> 6) % 4];
          var X = [heroi(cx, ex, nivel)], Y = [heroi(cy, ey, nivel)];
          if (parc[p]) { X.push(parceiroDe(parc[p], ez1, nivel, 'px')); Y.push(parceiroDe(parc[p], ez2, nivel, 'py')); }
          if (cx === cy) { Y[0].heroId = cy + '#2'; }
          // a MESMA sala nas duas, com os lados trocados
          var r1 = duelo(X, Y, sem + ':a', sem);
          var r2 = duelo(copia(Y), copia(X), sem + ':b', sem);
          var p1 = r1.fase === 'won' ? 1 : (r1.fase === 'empate' ? 0.5 : 0);
          var p2 = r2.fase === 'lost' ? 1 : (r2.fase === 'empate' ? 0.5 : 0);
          pontos += p1 + p2;
          marca(elemX, ex, p1 + p2); marca(elemY, ey, 2 - p1 - p2);
          empates += (r1.fase === 'empate' ? 1 : 0) + (r2.fase === 'empate' ? 1 : 0);
          rodadas += r1.rodada + r2.rodada;
          jogos += 2;
        }
      }
      return { taxa: jogos ? pontos / jogos : 0, jogos: jogos, rodadas: jogos ? rodadas / jogos : 0, empates: empates,
               elemX: elemX, elemY: elemY };
    }
    function parceiroDe(classe, elem, nivel, sufixo) {
      var p = heroi(classe, elem, nivel);
      p.heroId = classe + '#' + sufixo;     // a mesma classe dos dois lados não pode dividir heroId
      return p;
    }
    function copia(x) { return JSON.parse(JSON.stringify(x)); }

    return {
      CLASSES: CLASSES, ELEMS: ELEMS, NIVEIS: NIVEIS, NIVEIS_PROVA: NIVEIS_PROVA,
      heroi: heroi, perfil: perfil, razaoDupla: razaoDupla, separados: separados, fundidos: fundidos,
      todosCombos: todosCombos, combosRapidos: combosRapidos, duplas: duplas,
      duelo: duelo, celula: celula, salasPvp: salasPvp,
      _salva: salva, _volta: volta, _palco: palco
    };
  }

  return { cria: cria, ELEMS: ELEMS, NIVEIS: NIVEIS, NIVEIS_PROVA: NIVEIS_PROVA, hash32: hash32 };
});
