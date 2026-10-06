#!/usr/bin/env node
'use strict';
/* PROVA DOS MODELOS GUARDADOS NO APARELHO (04/10): js/app_modelos.js.
 *
 *   node tests/app_modelos.js
 *
 * O aplicativo de Android oferece "Jogar agora" e "Baixar tudo". Aqui fica a
 * CONTA, sem tela (a tela está em tests/app_modelos.html):
 *   · o que baixar pelo manifesto: o novo, o que mudou de hash; o que apagar:
 *     o que saiu e a versão velha do que mudou;
 *   · a retomada: o que já está guardado não desce de novo;
 *   · os MB, o "quanto falta", a rede (Wi-Fi ou dados móveis) e o espaço;
 *   · ler primeiro do aparelho, e guardar o que veio da rede;
 *   · NA WEB nada disto existe: o index.html só escreve o arquivo dentro do
 *     aplicativo, o assets_bundle.js só desvia quando ele está lá, e a seção
 *     das Configurações só aparece com ele;
 *   · a casca: o aplicativo abre o jogo do servidor (server.url), a tela "sem
 *     conexão" é um arquivo só, e os plugins servidos são os do node_modules. */
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
const FONTE = le('js', 'app_modelos.js');

function janela() {
  const cofre = {};
  const ctx = {
    console, Promise, JSON, Math, Number, String, Object, Date, URL, setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(cofre, k) ? cofre[k] : null),
      setItem: (k, v) => { cofre[k] = String(v); },
      removeItem: (k) => { delete cofre[k]; }
    },
    navigator: {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  ctx._cofre = cofre;
  return ctx;
}
const MB = 1048576;
const it = (n, hash, mb) => ({ alvo: 'MODELS', chave: n, arquivo: 'p/' + n + '.glb', bytes: mb * MB, hash });
const nomes = (l) => l.map((x) => x.arquivo).sort().join(' ');

(async function () {
  let w = janela();
  let A = w.JOGO.AppModelos;

  // ------------------------------------------------------------ o plano
  const man = { gerado: 'g1', itens: [it('a', 'h1', 10), it('b', 'h1', 20), it('c', 'h1', 30)] };
  let p = A.plano(man, []);
  check('aparelho vazio: tudo é novo e desce', nomes(p.baixar) === 'p/a.glb p/b.glb p/c.glb' && p.apagar.length === 0);
  check('a conta em bytes: total 60 MB, nada feito, faltam 60', p.total === 60 * MB && p.feitos === 0 && p.faltam === 60 * MB && p.nTotal === 3);

  p = A.plano(man, [{ arquivo: 'p/a.glb', hash: 'h1' }, { arquivo: 'p/c.glb', hash: 'h1' }]);
  check('retomada: o que já está guardado NÃO desce de novo', nomes(p.baixar) === 'p/b.glb' && p.apagar.length === 0);
  check('retomada: 40 de 60 MB feitos, faltam 20', p.feitos === 40 * MB && p.faltam === 20 * MB && p.nFeitos === 2);

  p = A.plano(man, [{ arquivo: 'p/a.glb', hash: 'h1' }, { arquivo: 'p/b.glb', hash: 'VELHO' }, { arquivo: 'p/c.glb', hash: 'h1' }]);
  check('hash mudou: desce só esse arquivo, e a versão velha é apagada',
        nomes(p.baixar) === 'p/b.glb' && p.apagar.length === 1 && p.apagar[0].hash === 'VELHO');

  p = A.plano(man, [{ arquivo: 'p/a.glb', hash: 'h1' }, { arquivo: 'p/b.glb', hash: 'h1' }, { arquivo: 'p/c.glb', hash: 'h1' },
                    { arquivo: 'p/saiu.glb', hash: 'h9' }]);
  check('saiu do manifesto: é apagado, e nada desce', p.baixar.length === 0 && nomes(p.apagar) === 'p/saiu.glb' && p.faltam === 0);

  p = A.plano({ itens: [it('a', 'h1', 10), Object.assign(it('a', 'h1', 10), { chave: 'outra' })] }, []);
  check('dois itens que apontam o mesmo arquivo contam uma vez só', p.nTotal === 1 && p.total === 10 * MB && p.baixar.length === 1);

  p = A.plano({ gerado: 'g2', itens: [{ arquivo: 'p/x.glb', bytes: MB }] }, [{ arquivo: 'p/x.glb', hash: 'vg1' }]);
  check('manifesto antigo, sem hash: vale o carimbo da extração (mudou o carimbo, desce de novo)',
        p.baixar.length === 1 && p.apagar.length === 1);
  check('manifesto vazio ou ausente não derruba a conta', A.plano(null, []).nTotal === 0 && A.plano({}, null).faltam === 0);

  // o manifesto de verdade
  const real = JSON.parse(le('assets', 'models', 'bundle', 'manifest.json'));
  p = A.plano(real, []);
  const soma = real.itens.reduce((s, x) => s + x.bytes, 0);
  check('manifesto de verdade: todo arquivo tem hash e a conta fecha com a soma dos bytes',
        real.itens.every((x) => x.hash && x.arquivo) && p.total === soma && p.baixar.length === p.nTotal,
        p.total + ' x ' + soma);
  console.log('         (o pacote hoje: ' + p.nTotal + ' arquivos, ' + A.mb(p.total) + ' MB; o maior tem ' +
              A.mb(Math.max(...real.itens.map((x) => x.bytes))) + ' MB)');
  const meio = real.itens.slice(0, 200).map((x) => ({ arquivo: x.arquivo, hash: x.hash }));
  const p2 = A.plano(real, meio);
  check('manifesto de verdade, download interrompido: feitos + faltam = total',
        p2.feitos + p2.faltam === p2.total && p2.baixar.length + p2.nFeitos === p2.nTotal && p2.apagar.length === 0);

  // ------------------------------------------------------------ MB, tempo, rede, espaço
  check('MB com uma casa e vírgula', A.mb(258489884) === '246,5' && A.mb(0) === '0,0' && A.mb(1.25 * MB) === '1,3');
  check('quanto falta: sem velocidade medida não chuta', A.resta(100 * MB, 0) === '' && A.resta(0, 5) === '');
  check('quanto falta: minutos, ou "menos de 1 min"',
        A.resta(120 * MB, MB) === 'cerca de 2 min' && A.resta(30 * MB, MB) === 'menos de 1 min');
  check('rede: dados móveis, Wi-Fi, e "não sei" quando o aparelho não informa',
        A.rede({ type: 'cellular' }) === 'movel' && A.rede({ type: 'wifi' }) === 'wifi' &&
        A.rede({ effectiveType: '4g' }) === '?' && A.rede(null) === '?');
  check('espaço: sem estimativa, não sabe', A.cabe(100 * MB, null) === null && A.cabe(100 * MB, {}) === null);
  check('espaço: cabe com folga; não cabe quando o livre é menor que o pacote',
        A.cabe(100 * MB, { quota: 500 * MB, usage: 100 * MB }).cabe === true &&
        A.cabe(100 * MB, { quota: 150 * MB, usage: 60 * MB }).cabe === false &&
        A.cabe(100 * MB, { quota: 150 * MB, usage: 60 * MB }).livre === 90 * MB);

  // ------------------------------------------------------------ ler do aparelho, guardar o que veio da rede
  const disco = new Map();
  A._guarda = {
    lista: async () => Array.from(disco.keys()).map((k) => ({ arquivo: k.split('|')[0], hash: k.split('|')[1] })),
    le: async (a, h) => disco.get(a + '|' + h) || null,
    grava: async (a, h, b) => { disco.set(a + '|' + h, b); },
    apaga: async (a, h) => { disco.delete(a + '|' + h); },
    limpa: async () => { disco.clear(); }
  };
  disco.set('p/a.glb|h1', 'AAA');
  disco.set('p/b.glb|VELHO', 'velho');
  disco.set('p/saiu.glb|h9', 'lixo');
  A.escolhe('agora');
  let seguiu = 0;
  A.abertura({ man, url: (x) => 'srv/' + x.arquivo, segue: () => { seguiu++; } });
  await new Promise((ok) => setTimeout(ok, 20));
  check('abertura de quem escolheu "jogar agora": segue sem tela, uma vez', seguiu === 1);
  check('abertura: apaga o que saiu e a versão velha, guarda o que vale',
        Array.from(disco.keys()).join(' ') === 'p/a.glb|h1', Array.from(disco.keys()).join(' '));
  const ler = (x) => new Promise((ok) => A.le(x, ok));
  check('modelo guardado: sai do aparelho', (await ler(man.itens[0])) === 'AAA');
  check('modelo que não está guardado: devolve nada (vai para a rede)', (await ler(man.itens[1])) === null);
  A.grava(man.itens[1], 'BBB');
  await new Promise((ok) => setTimeout(ok, 5));
  check('o que veio da rede fica guardado com o hash do manifesto',
        disco.get('p/b.glb|h1') === 'BBB' && (await ler(man.itens[1])) === 'BBB');
  await A.apagaTudo();
  check('apagar: o aparelho fica vazio, a leitura volta a ir para a rede e a escolha vira "jogar agora"',
        disco.size === 0 && (await ler(man.itens[0])) === null && A.escolha() === 'agora');

  w = janela();
  A = w.JOGO.AppModelos;
  seguiu = 0;
  A.abertura({ man, url: () => '', segue: () => { seguiu++; } });
  check('WebView sem Cache Storage: nada de tela, o jogo segue pela rede como a web',
        A.ativo() === false && seguiu === 1);
  let cb = 'x';
  A.le(man.itens[0], (b) => { cb = b; });
  check('… e a leitura devolve nada na hora', cb === null);

  // ------------------------------------------------------------ A WEB não usa nada disto
  const INDEX = le('index.html');
  const escreve = INDEX.split(/\r?\n/).filter((l) => /app_modelos\.js/.test(l));
  const bloco = (/if \((\/\[\?&\]app=1[\s\S]{0,200}?)\{\s*document\.write\([^\n]*app_modelos\.js/.exec(INDEX) || [])[1] || '';
  check('index.html: o app_modelos.js é escrito num lugar só, dentro da pergunta "é o aplicativo?"',
        escreve.length === 1 && /isNativePlatform\(\)/.test(bloco), JSON.stringify(escreve));
  // a mesma pergunta, rodada: na web é falsa
  const pergunta = (busca, cap) => vm.runInNewContext('(' + bloco.trim().replace(/\)\s*$/, '') + ')',
    { location: { search: busca }, window: { Capacitor: cap } });
  check('a pergunta do index.html: falsa na web, verdadeira no Capacitor nativo e com ?app=1',
        !pergunta('', undefined) && !pergunta('?mobile=1', undefined) && !pergunta('?app=10', undefined) &&
        !pergunta('', { isNativePlatform: () => false }) &&
        !!pergunta('', { isNativePlatform: () => true }) && !!pergunta('?app=1', undefined));
  const BUNDLE = le('js', 'assets_bundle.js');
  check('assets_bundle.js: sem JOGO.AppModelos o modelo desce pelo `pega` de sempre, com o mesmo prazo',
        /var G = JOGO\.AppModelos, url = enderecoModelo\(it\);\s*if \(!G\) return pega\(url, 'arraybuffer', ok, falha, B\.prazos\.parado\);/.test(BUNDLE));
  check('assets_bundle.js: sem JOGO.AppModelos a base desce direto, sem pergunta',
        /if \(G && G\.abertura\) G\.abertura\(\{[^}]*\}\);\s*else baixaBase\(\);/.test(BUNDLE));
  check('assets_bundle.js: só esses dois pontos conhecem o aplicativo', (BUNDLE.match(/JOGO\.AppModelos/g) || []).length === 2 + 1,
        String((BUNDLE.match(/JOGO\.AppModelos/g) || []).length));   // 2 no código + 1 no comentário
  const HUD = le('js', 'ui', 'hud.js');
  check('hud.js: a seção "Modelos no aparelho" só entra quando JOGO.AppModelos existe',
        /JOGO\.AppModelos && JOGO\.AppModelos\.secaoConfig\(\)/.test(HUD) && (HUD.match(/AppModelos/g) || []).length === 3);
  check('o app_modelos.js não está na lista de arquivos da web (a que o index.html sempre carrega)',
        !/'js\/app_modelos\.js',/.test(INDEX));

  // ------------------------------------------------------------ A CASCA: o jogo vem do servidor
  const cfg = JSON.parse(le('capacitor.config.json'));
  const servidor = (/^SERVIDOR = '(https:\/\/[a-z0-9.-]+)'\r?$/m.exec(le('tools', 'empacota_www.py')) || [])[1];
  check('capacitor.config.json: o aplicativo abre o jogo do servidor (o SERVIDOR do empacota_www.py + /index.html: a raiz leva ao site)',
        !!servidor && cfg.server.url === servidor + '/index.html' && cfg.server.androidScheme === 'https', cfg.server.url + ' x ' + servidor);
  check('capacitor.config.json: sem resposta do servidor, mostra a tela do pacote (errorPath), não a tela branca',
        cfg.server.errorPath === 'sem-conexao.html' && cfg.webDir === 'www');
  check('capacitor.config.json: nenhum outro domínio abre dentro do aplicativo (links de fora vão para o navegador)',
        !cfg.server.allowNavigation && cfg.server.cleartext !== true);
  const CASCA = le('app', 'index.html');
  check('a tela "sem conexão" é um arquivo só e leva a marca do servidor para o empacota trocar',
        !/<(script|img|link)[^>]+(src|href)=/.test(CASCA) && CASCA.split("'__SERVIDOR__'").length === 2);
  check('a tela "sem conexão" diz o que houve e oferece tentar de novo',
        /Sem conexão/.test(CASCA) && /Tentar de novo/.test(CASCA) && /addEventListener\('online'/.test(CASCA));
  const pares = [['@capacitor/core/dist/capacitor.js', 'capacitor.js'], ['@capacitor/app/dist/plugin.js', 'app.js'],
                 ['@capacitor-community/keep-awake/dist/plugin.js', 'keep-awake.js'],
                 ['@capgo/native-purchases/dist/plugin.js', 'native-purchases.js'],
                 ['@capacitor-community/admob/dist/plugin.js', 'admob.js']];
  const lf = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  if (fs.existsSync(path.join(raiz, 'node_modules', '@capacitor', 'core'))) {
    check('vendor/capacitor/ (o que o servidor entrega ao aplicativo) é igual ao node_modules (a parte nativa)',
          pares.every(([o, n]) => lf(path.join(raiz, 'node_modules', o)) === lf(path.join(raiz, 'vendor', 'capacitor', n))));
  } else {
    check('vendor/capacitor/ tem os cinco arquivos (sem node_modules aqui, a comparação fica para o empacota_www.py)',
          pares.every(([, n]) => fs.existsSync(path.join(raiz, 'vendor', 'capacitor', n))));
  }
  const MOBILE = le('js', 'mobile.js');
  check('mobile.js: os plugins são pedidos com o carimbo do build (o WebView não prende versão velha)',
        /url\('vendor\/capacitor\/capacitor\.js'\)/.test(MOBILE) && /window\.__url/.test(MOBILE));
  // o que impede o WebView de prender código velho: a página e o mapa de versões sempre conferem com o servidor
  ['servidor/Caddyfile', 'servidor/coolify/Caddyfile'].forEach(function (f) {
    const t = le(...f.split('/'));
    check(f + ': a página, o mapa de versões e o manifesto vão com no-cache; o resto carimbado é imutável',
          /@indice path \/ \*\.html \/js\/versao\.js \/assets\/models\/bundle\/manifest\.json/.test(t) &&
          /header @indice Cache-Control "no-cache"/.test(t) && /immutable/.test(t));
  });

  console.log('\n' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
