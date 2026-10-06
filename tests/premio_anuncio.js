#!/usr/bin/env node
'use strict';
/* PROVA DA ÁREA "GANHAR PRÊMIOS" (06/10): js/core/premio_anuncio.js, o anúncio premiado do aplicativo.
 *
 *   node tests/premio_anuncio.js
 *
 * A regra do dono: "as propagandas só devem aparecer SOMENTE se o usuário for nessa área; tem que ser de
 * livre e espontânea vontade" — e o jogo da web não pode mudar. A prova roda o arquivo de verdade numa
 * janela de mentira, com um plugin de AdMob de mentira e um servidor de mentira, e conta o que foi pedido:
 *   · NA WEB a área não existe: o index.html só pede o arquivo dentro do aplicativo, as Configurações só
 *     mostram a seção com noApp(), e o arquivo, carregado por engano, não pede nada a ninguém;
 *   · NO APLICATIVO, carregar o arquivo não pede a ponte, não liga o SDK, não pergunta nada;
 *   · ENTRAR na área busca a ponte, faz a pergunta de privacidade e liga o SDK — e NENHUM anúncio é pedido;
 *   · só o TOQUE pede o bilhete e o anúncio (com o bilhete e o código da conta para a Google assinar);
 *   · o prêmio só é dado por "creditado" quando o SERVIDOR mostra o contador andando;
 *   · fechou antes do fim: nada; sem anúncio: avisa; limite: avisa; depuração: bloco de TESTE. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}
const raiz = path.join(__dirname, '..');
const le = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const FONTE = le('js', 'core', 'premio_anuncio.js');
const BLOCO = 'ca-app-pub-4989579635131748/7206484209';
const BLOCO_TESTE = 'ca-app-pub-3940256099942544/5224354917';

/* op: { busca, capacitor, debug, servidor:{...}, anuncio:'ok'|'sem'|'fecha' } */
function janela(op) {
  op = op || {};
  const srv = Object.assign({ hoje: { vintens: 0, barras: 0 }, credita: true, limite: false }, op.servidor || {});
  const reg = { scripts: [], api: [], plugin: [], relogios: 0, ouvintes: {}, nos: 0 };
  function no() {
    reg.nos++;
    const e = { style: {}, innerHTML: '', classList: { add() {} }, setAttribute() {}, addEventListener() {},
                querySelector: () => e._corpo || (e._corpo = no()), parentNode: null,
                appendChild(f) { f.parentNode = e; }, removeChild(f) { f.parentNode = null; } };
    return e;
  }
  const pluginFalso = {
    requestConsentInfo() { reg.plugin.push('requestConsentInfo'); return Promise.resolve({ status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false }); },
    showConsentForm() { reg.plugin.push('showConsentForm'); return Promise.resolve({ status: 'OBTAINED', canRequestAds: true }); },
    initialize(o) { reg.plugin.push('initialize'); reg.inicio = o; return Promise.resolve(); },
    addListener(n, f) { reg.ouvintes[n] = f; return Promise.resolve({ remove() {} }); },
    prepareRewardVideoAd(o) {
      reg.plugin.push('prepareRewardVideoAd'); reg.pedido = o;
      return op.anuncio === 'sem' ? Promise.reject(new Error('No fill')) : Promise.resolve({ adUnitId: o.adId });
    },
    showRewardVideoAd() {
      reg.plugin.push('showRewardVideoAd');
      return new Promise((resolve) => {
        setImmediate(() => {
          if (op.anuncio !== 'fecha') {
            reg.ouvintes.onRewardedVideoAdReward({ type: 'x', amount: 999 });
            if (srv.credita) srv.hoje[reg.tipo]++;          // a Google avisou o servidor
            resolve({ type: 'x', amount: 999 });
          }
          setImmediate(() => reg.ouvintes.onRewardedVideoAdDismissed());
        });
      });
    }
  };
  const ctx = {
    console, Promise, JSON, Math, Number, String, Object, Date, Array, setImmediate,
    setTimeout(f) { reg.relogios++; setImmediate(f); return 1; }, clearTimeout() {},
    setInterval() { reg.relogios++; return 1; }, clearInterval() {},
    location: { search: op.busca || '' },
    addEventListener() {},
    document: {
      getElementById: () => null,
      createElement(tag) {
        const e = no();
        e.tag = tag;
        if (tag === 'script') {
          Object.defineProperty(e, 'src', { set(v) {
            reg.scripts.push(v);
            setImmediate(() => { if (/admob\.js/.test(v)) ctx.capacitorStripe = { AdMob: pluginFalso }; if (e.onload) e.onload(); });
          } });
        }
        return e;
      },
      head: { appendChild() {} }, body: { appendChild(f) { f.parentNode = ctx.document.body; }, removeChild() {} }
    },
    JOGO: { Sessao: { api(rota, o) {
      reg.api.push((o && o.method || 'GET') + ' ' + rota);
      const premios = ['vintens', 'barras'].map((t) => ({ tipo: t, qtd: t === 'vintens' ? 50 : 1, hoje: srv.hoje[t], limite: 5, faltam: 5 - srv.hoje[t] }));
      if (rota === '/api/anuncio') {
        return Promise.resolve({ ok: true, status: 200, premios, limite: 5, zeraEm: 1800000000, bloco: BLOCO, aparelhosTeste: [], mestre: false });
      }
      if (rota === '/api/anuncio/bilhete') {
        reg.tipo = o.body.tipo;
        if (srv.limite) return Promise.resolve({ ok: false, status: 409, limite: true, premios, zeraEm: 1800000000 });
        return Promise.resolve({ ok: true, status: 201, bilhete: 'bilhete-de-prova-0123456789', conta: 'codigo-da-conta', tipo: o.body.tipo, bloco: BLOCO });
      }
      return Promise.resolve({ ok: false, status: 404 });
    } } }
  };
  if (op.capacitor) ctx.Capacitor = { isNativePlatform: () => true, DEBUG: !!op.debug };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  ctx._reg = reg;
  return ctx;
}
const calma = () => new Promise((r) => setTimeout(r, 30));

(async function () {
  // ------------------------------------------------------------------ A WEB
  const INDEX = le('index.html');
  const blocoApp = /isNativePlatform\(\)\)\) \{[\s\S]*?\} catch \(eApp\)/.exec(INDEX);
  check('web: o index.html pede o premio_anuncio.js UMA vez, por document.write, e não na lista de scripts',
        INDEX.split("__url('js/core/premio_anuncio.js')").length === 2 && !/<script[^>]*src="[^"]*premio_anuncio/.test(INDEX) && /document\.write\([^\n]*premio_anuncio\.js/.test(INDEX));
  check('web: esse pedido mora no mesmo bloco "só no aplicativo" da compra pela Play',
        !!blocoApp && /premio_anuncio\.js/.test(blocoApp[0]) &&
        INDEX.indexOf('compra_play.js') < INDEX.indexOf('premio_anuncio.js') && INDEX.indexOf('premio_anuncio.js') < INDEX.indexOf('catch (eApp)'));
  check('web: nada de AdMob no index.html, no mobile.js nem na lista de pontes que o aplicativo carrega ao abrir',
        !/admob/i.test(INDEX) && !/admob/i.test(le('js', 'mobile.js')));
  const HUD = le('js', 'ui', 'hud.js');
  check('web: as Configurações só mostram a seção com JOGO.PremioAnuncio.noApp()',
        /if \(JOGO\.PremioAnuncio && JOGO\.PremioAnuncio\.noApp\(\)\) \{[\s\S]{0,700}JOGO\.PremioAnuncio\.abre\(\)/.test(HUD) &&
        HUD.split('PremioAnuncio.abre(').length === 2);
  const fora = [].concat(fs.readdirSync(path.join(raiz, 'js', 'core')), fs.readdirSync(path.join(raiz, 'js', 'ui')))
    .filter((f) => /\.js$/.test(f) && f !== 'premio_anuncio.js')
    .filter((f) => { const p = fs.existsSync(path.join(raiz, 'js', 'core', f)) ? ['js', 'core', f] : ['js', 'ui', f]; return /admob|prepareRewardVideoAd|showBanner|prepareInterstitial/i.test(le(...p)); });
  check('nenhum outro arquivo do jogo fala com o plugin de anúncio', fora.length === 0, fora.join(','));
  check('o arquivo só usa o anúncio PREMIADO: nada de banner, intersticial ou anúncio de abertura',
        !/showBanner|prepareInterstitial|showInterstitial|AppOpen|RewardInterstitial/.test(FONTE));

  let w = janela({});
  let P = w.JOGO.PremioAnuncio;
  check('web: noApp() é falso', P.noApp() === false);
  P.abre();
  await P._assiste('barras');
  await calma();
  check('web: abrir e assistir não fazem NADA (nenhum script, nenhum pedido, nenhum elemento, nenhum relógio)',
        w._reg.scripts.length === 0 && w._reg.api.length === 0 && w._reg.plugin.length === 0 && w._reg.nos === 0 &&
        w._reg.relogios === 0 && !P.aberto(), JSON.stringify(w._reg));

  // ---------------------------------------------------------- O APLICATIVO
  w = janela({ capacitor: true });
  P = w.JOGO.PremioAnuncio;
  await calma();
  check('aplicativo: carregar o arquivo não pede ponte, não liga SDK, não pergunta nada, não chama o servidor',
        P.noApp() === true && w._reg.scripts.length === 0 && w._reg.api.length === 0 && w._reg.plugin.length === 0 &&
        w._reg.relogios === 0 && w._reg.nos === 0, JSON.stringify(w._reg));
  check('aplicativo: assistir sem ter entrado na área é recusado', (await P._assiste('barras')) === 'recusado' && w._reg.api.length === 0);

  P.abre();
  await calma();
  check('entrar na área: o estado vem do servidor e a ponte do AdMob é buscada AGORA',
        w._reg.api.join() === 'GET /api/anuncio' && w._reg.scripts.some((s) => /vendor\/capacitor\/admob\.js/.test(s)));
  check('entrar na área: a pergunta de privacidade aparece aqui (e só aqui) e o SDK liga depois dela',
        w._reg.plugin.join() === 'requestConsentInfo,showConsentForm,initialize', w._reg.plugin.join());
  check('entrar na área NÃO pede anúncio nenhum (nada de pré-carregamento)',
        w._reg.plugin.indexOf('prepareRewardVideoAd') < 0 && P._st.fase === 'ok');
  check('sem aparelho de teste cadastrado, o SDK não liga em modo de teste', !w._reg.inicio.initializeForTesting);

  let fim = await P._assiste('barras');
  check('o toque: bilhete do tipo escolhido, depois o anúncio, depois a espera pelo servidor',
        fim === 'creditado' && w._reg.api[1] === 'POST /api/anuncio/bilhete' && w._reg.tipo === 'barras' &&
        w._reg.plugin.slice(3).join() === 'prepareRewardVideoAd,showRewardVideoAd', fim + ' ' + w._reg.plugin.join());
  check('o anúncio leva o bilhete e o código da conta para a Google assinar, no bloco do dono',
        w._reg.pedido.adId === BLOCO && w._reg.pedido.isTesting === false &&
        w._reg.pedido.ssv.customData === 'bilhete-de-prova-0123456789' && w._reg.pedido.ssv.userId === 'codigo-da-conta');
  check('o contador da tela é o do servidor (1 de 5 nas barras, 0 de 5 nos vinténs)',
        P._st.premios.barras.hoje === 1 && P._st.premios.vintens.hoje === 0 && P._st.recado.tipo === 'bom');
  fim = await P._assiste('vintens');
  check('o outro prêmio tem o contador dele', fim === 'creditado' && w._reg.tipo === 'vintens' && P._st.premios.vintens.hoje === 1 &&
        P._st.premios.barras.hoje === 1);

  w = janela({ capacitor: true, servidor: { credita: false } });
  P = w.JOGO.PremioAnuncio; P.abre(); await calma();
  fim = await P._assiste('barras');
  check('anúncio visto mas o servidor ainda não creditou: a tela NÃO diz que o prêmio entrou',
        fim === 'demora' && P._st.recado.tipo === 'neutro' && P._st.premios.barras.hoje === 0 &&
        w._reg.api.filter((a) => a === 'GET /api/anuncio').length >= 15, fim);

  w = janela({ capacitor: true, anuncio: 'fecha' });
  P = w.JOGO.PremioAnuncio; P.abre(); await calma();
  fim = await P._assiste('barras');
  check('fechou antes do fim: nada ganho, nada perdido, e a tela nem espera o servidor',
        fim === 'fechou' && w._reg.api.filter((a) => a === 'GET /api/anuncio').length === 1 && P._st.ocupado === null, fim);

  w = janela({ capacitor: true, anuncio: 'sem' });
  P = w.JOGO.PremioAnuncio; P.abre(); await calma();
  fim = await P._assiste('vintens');
  check('sem anúncio disponível: avisa e não mostra nada', fim === 'sem-anuncio' && w._reg.plugin.indexOf('showRewardVideoAd') < 0, fim);

  w = janela({ capacitor: true, servidor: { limite: true } });
  P = w.JOGO.PremioAnuncio; P.abre(); await calma();
  fim = await P._assiste('barras');
  check('limite do dia: o servidor recusa o bilhete e nenhum anúncio é pedido',
        fim === 'limite' && w._reg.plugin.indexOf('prepareRewardVideoAd') < 0 && /\d\d:\d\d/.test(P._st.recado.texto), fim);

  w = janela({ capacitor: true, debug: true });
  P = w.JOGO.PremioAnuncio; P.abre(); await calma();
  await P._assiste('barras');
  check('compilação de DEPURAÇÃO: o bloco é o de TESTE da Google, nunca o do dono',
        w._reg.pedido.adId === BLOCO_TESTE && w._reg.pedido.isTesting === true && w._reg.pedido.adId !== BLOCO);

  w = janela({ busca: '?app=1' });
  P = w.JOGO.PremioAnuncio; P.abre(); await calma();
  check('?app=1 no navegador (sem casca): a área abre, mas não há ponte nem SDK — e diz isso',
        P._st.fase === 'sem-app' && w._reg.scripts.length === 0 && w._reg.plugin.length === 0, P._st.fase);

  // ------------------------------------------------------------- A CASCA
  const manif = le('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  check('android: o manifesto leva o id do aplicativo no AdMob e adia a medição até o SDK ser ligado',
        /com\.google\.android\.gms\.ads\.APPLICATION_ID"\s+android:value="ca-app-pub-4989579635131748~7013903357"/.test(manif) &&
        /DELAY_APP_MEASUREMENT_INIT"\s+android:value="true"/.test(manif) && /com\.google\.android\.gms\.permission\.AD_ID/.test(manif));
  const pacote = JSON.parse(le('package.json'));
  check('package.json: o plugin de AdMob da linha 8 (a do Capacitor 8)', /^\^8\./.test(pacote.dependencies['@capacitor-community/admob'] || ''));
  check('vendor/capacitor/admob.js existe (é ele que o servidor entrega quando a área abre)',
        /registerPlugin\('AdMob'/.test(le('vendor', 'capacitor', 'admob.js')));
  check('o bloco real do dono não está escrito no cliente (vem do servidor); o de teste está',
        FONTE.indexOf('4989579635131748') < 0 && FONTE.indexOf(BLOCO_TESTE) >= 0);

  console.log('\n' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
