var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA — os IDIOMAS (JOGO.I18n). 05/10, o dono: "quero que o jogo tenha os
// principais idiomas para poder mudar: inglês, espanhol ou português."
//
// O QUE ISTO É. O jogo nasceu escrito em português DIRETO no código e nos
// dados. Este módulo não muda isso: o português continua sendo o texto de
// verdade, e a tradução é uma camada por cima, só de EXIBIÇÃO.
//
//   · I18n.t('Texto em português', { nome: valor })  — estilo gettext: a CHAVE
//     É O PRÓPRIO TEXTO EM PORTUGUÊS. Sem tradução, devolve o português (nunca
//     chave crua, nunca vazio). É o que a interface usa (js/ui/*).
//   · I18n.aplicaDados(DATA) — troca nomes e descrições do DATA pelos do
//     idioma escolhido, por tabela/registro/campo (js/i18n/dados_<idioma>.js).
//     Roda UMA vez na carga, depois dos arquivos de dados e antes de qualquer
//     tela ler. Em português não roda nada: o DATA fica como saiu do arquivo.
//
// O QUE ISTO NÃO É. Não é regra. Nada daqui entra no motor, no save, no hash
// da batalha nem vai ao servidor: o JUIZ (servidor/juiz/motor.js) nem carrega
// este arquivo — ele lê os js/core/data/*.js crus, em português, sempre. Por
// isso só se troca campo que é TEXTO de mostrar; campo que alguém usa como
// chave fica fora (ver FORA, mais abaixo) e é traduzido na hora de desenhar.
//
// SEM DOM: quem põe o <html lang> é o index.html. Abre em file:// e em Node.
// O manual de quem vai traduzir o resto está em docs/IDIOMAS.md.
// ============================================================================
(function () {
  'use strict';

  var I = JOGO.I18n = {};

  I.IDIOMAS = ['pt', 'en', 'es'];
  I.PADRAO = 'pt';
  // cada idioma escrito NELE MESMO: é assim que quem não lê português o acha
  I.NOMES = { pt: 'Português', en: 'English', es: 'Español' };
  // o que vai no <html lang> (leitor de tela, hifenização, corretor do teclado)
  I.TAG = { pt: 'pt-BR', en: 'en', es: 'es' };
  // por NAVEGADOR, como o som e os gráficos: não entra no save nem vai ao servidor
  I.CHAVE = 'soterra-idioma';

  function valido(l) { return I.IDIOMAS.indexOf(l) >= 0; }

  function armazem() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  }

  /* QUEM JÁ JOGA NÃO VÊ NADA MUDAR. Antes deste módulo todo mundo jogava em
   * português, inclusive quem tem o navegador em inglês. Se a primeira abertura
   * depois da atualização fosse pelo idioma do aparelho, essa pessoa abriria o
   * jogo de sempre e o acharia em outra língua. Então: havendo QUALQUER rastro
   * de jogo neste navegador (save, conta local, registro de contas, sessão do
   * site ou o registro da nuvem), o idioma é português até a pessoa trocar nas
   * Configurações. Só o navegador virgem é decidido pelo aparelho. */
  var RASTRO = /^soterra-(save-v2|conta-v1|contas-v1|sessao|nuvem-v1)/;
  function jaJoga(s) {
    try {
      for (var i = 0; i < s.length; i++) if (RASTRO.test(String(s.key(i)))) return true;
    } catch (e) {}
    return false;
  }

  // pt* → pt, es* → es, o resto do mundo → en
  function doAparelho() {
    var l = '';
    try { l = String((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || ''); } catch (e) {}
    l = l.toLowerCase();
    if (!l || l.indexOf('pt') === 0) return 'pt';       // sem resposta do aparelho: fica como sempre foi
    if (l.indexOf('es') === 0) return 'es';
    return 'en';
  }

  /* A ordem de quem manda:
   *   1. `?lang=en` na URL — para prova e para mostrar a alguém. Vale só para
   *      aquela abertura: NÃO grava, senão um link de teste trocaria o idioma
   *      de quem o abriu.
   *   2. o que a pessoa escolheu (ou o que foi decidido na primeira abertura).
   *   3. primeira abertura: português se já joga aqui, senão o do aparelho. A
   *      decisão É GRAVADA na hora — sem isso o navegador virgem decidido "en"
   *      viraria "pt" na segunda abertura, quando o save dele já existisse. */
  function decide() {
    try {
      if (typeof location !== 'undefined') {
        var m = /[?&]lang=([a-z]{2})/i.exec(String(location.search || ''));
        if (m && valido(m[1].toLowerCase())) { I.origem = 'url'; return m[1].toLowerCase(); }
      }
    } catch (e0) {}
    var s = armazem();
    if (!s) { I.origem = 'padrao'; return I.PADRAO; }
    var g = null;
    try { g = s.getItem(I.CHAVE); } catch (e1) {}
    if (valido(g)) { I.origem = 'escolha'; return g; }
    var l = jaJoga(s) ? I.PADRAO : doAparelho();
    I.origem = 'primeira';
    try { s.setItem(I.CHAVE, l); } catch (e2) {}
    return l;
  }

  I.origem = 'padrao';
  I.idioma = decide();

  /* Trocar de idioma. Só GRAVA: quem chama recarrega a página (a ficha das
   * Configurações faz isso). Recarregar é de propósito — o DATA já foi lido por
   * metade das telas, e trocar texto a quente deixaria a tela meio a meio. A
   * conta não sai: a sessão e o save moram em outras chaves. */
  I.escolhe = function (l) {
    if (!valido(l)) return false;
    var s = armazem();
    try { if (s) s.setItem(I.CHAVE, l); } catch (e) { return false; }
    return true;
  };

  /* Para prova em Node: troca o idioma em uso SEM gravar. Não retraduz o que já
   * foi aplicado ao DATA — a prova monta um mundo novo por idioma. */
  I.usa = function (l) { if (valido(l)) I.idioma = l; return I.idioma; };

  // ---- os dicionários: { en: { textos: {pt: en}, dados: {tabela: {registro: {campo: en}}} } }
  var DIC = {};
  function dic(l) { return DIC[l] || (DIC[l] = { textos: {}, dados: {} }); }

  /* Cada arquivo de js/i18n/ se registra por aqui. Pode haver vários por
   * idioma (dados, textos da interface, e o que a etapa 2 e a 3 criarem): as
   * entradas se SOMAM. Dados do idioma em uso são aplicados na hora, se o DATA
   * já estiver carregado — é a posição do arquivo na lista do index.html
   * (depois do último js/core/data/*.js) que garante isso. */
  I.registra = function (l, pacote) {
    if (!valido(l) || !pacote) return;
    var d = dic(l), k, t;
    if (pacote.textos) for (k in pacote.textos) if (has(pacote.textos, k)) d.textos[k] = pacote.textos[k];
    if (pacote.dados) {
      for (t in pacote.dados) if (has(pacote.dados, t)) {
        d.dados[t] = d.dados[t] || {};
        for (k in pacote.dados[t]) if (has(pacote.dados[t], k)) d.dados[t][k] = pacote.dados[t][k];
      }
      if (l === I.idioma && JOGO.DATA) I.aplicaDados(JOGO.DATA);
    }
  };
  I.dicionario = function (l) { return dic(l || I.idioma); };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // {nome} → vars.nome. Chave que não veio fica como está (aparece o erro, não some o texto).
  // Valor nulo vira "null"/"undefined", igual à concatenação que o tr() substituiu na etapa 2:
  // em português o texto tem de sair byte a byte o que saía antes.
  function troca(s, vars) {
    if (!vars) return s;
    return s.replace(/\{([A-Za-z_][\w]*)\}/g, function (m, k) {
      return has(vars, k) ? String(vars[k]) : m;
    });
  }

  /* I18n.t('Faltam {n} vinténs.', { n: 3 })
   * A chave é o texto em português, INTEIRO e igual ao do código (o que
   * tools/i18n_falta.js confere). Em português, e em qualquer idioma sem a
   * entrada, devolve o próprio texto — o jogo nunca mostra chave nem vazio. */
  I.t = function (pt, vars) {
    if (pt == null) return '';
    pt = String(pt);
    var out = pt;
    if (I.idioma !== I.PADRAO) {
      var tx = DIC[I.idioma] && DIC[I.idioma].textos;
      var v = tx && has(tx, pt) ? tx[pt] : null;
      if (typeof v === 'string' && v) out = v;
    }
    return troca(out, vars);
  };

  /* Plural simples (os três idiomas só têm um e muitos):
   *   I18n.n(qtd, '{n} sala', '{n} salas')  →  "1 sala" / "3 rooms"
   * As DUAS formas são chaves do dicionário; {n} já vem preenchido. */
  I.n = function (qtd, um, muitos, vars) {
    var v = {}, k;
    if (vars) for (k in vars) if (has(vars, k)) v[k] = vars[k];
    v.n = qtd;
    return I.t(Number(qtd) === 1 ? um : muitos, v);
  };

  // ------------------------------------------------------------------ os DADOS
  /* As tabelas do DATA que têm texto para o jogador, e os campos que SÃO texto.
   * É uma lista fechada de propósito: tabela ou campo novo não é traduzido por
   * acidente — entra aqui, e o tools/i18n_falta.js passa a cobrar a tradução. */
  I.TABELAS = [
    'elementInfo', 'weathers', 'classes', 'dificuldades',
    'spells', 'monsterSpells', 'itemSpells', 'petSpells', 'fusionSpells',
    'monsters', 'ecoMonstros', 'fusionSummons',
    'dungeons', 'especiais', 'arenas', 'tileEvents',
    'fusionIdentities', 'fusionBlends', 'fusionForms',
    'pets', 'items', 'sets', 'stones', 'consumiveis', 'eco'
  ];
  I.CAMPOS = { name: 1, description: 1, flavor: 1, lore: 1, affix: 1, formName: 1, line: 1,
               text: 1, nome: 1, resumo: 1 };
  /* O QUE FICA DE FORA DE PROPÓSITO (tem cara de texto, mas alguém usa de chave):
   *   · `family` dos monstros — o 3D escolhe o visual por ela
   *     (js/render3d/models3d_v2.js, M.FAMILY_LOOK[md.family]);
   *   · DATA.upgrade.tiers[].name ("Comum", "Raro"…) — a HUD faz a classe de
   *     CSS com ele (hud.js, tierClass);
   *   · os títulos (js/core/titulos.js) — o texto do título É o que o save e o
   *     relé guardam e comparam.
   * Esses três são traduzidos NA HORA DE MOSTRAR, com I18n.t (as traduções já
   * estão em js/i18n/textos_*.js). `role`, `cardRarity`, `rarity`, `slot`,
   * `element` e parecidos são ids. */

  /* Anda uma tabela e chama fn(registro, campo, texto, dono) para cada texto.
   * `registro` é o caminho até o objeto dono do campo: o id de quem tem id, a
   * chave do mapa, ou o índice da lista — 'greenhouse/rooms/0', 'sumo',
   * 'arqueiro+bruxo/3'. É a chave do dicionário. Objeto repetido em dois
   * lugares é visitado nos dois: a troca é por caminho, não por texto atual,
   * então aplicar duas vezes dá no mesmo. */
  function anda(no, caminho, fn, pilha) {
    if (!no || typeof no !== 'object' || pilha.indexOf(no) >= 0) return;
    pilha.push(no);
    var k, v, i;
    if (Array.isArray(no)) {
      for (i = 0; i < no.length; i++) {
        v = no[i];
        if (v && typeof v === 'object') {
          anda(v, junta(caminho, (typeof v.id === 'string' && v.id) ? v.id : String(i)), fn, pilha);
        }
      }
    } else {
      for (k in no) if (has(no, k)) {
        v = no[k];
        if (typeof v === 'string') { if (I.CAMPOS[k] === 1 && v) fn(caminho, k, v, no); }
        else if (v && typeof v === 'object') anda(v, junta(caminho, k), fn, pilha);
      }
    }
    pilha.pop();
  }
  function junta(a, b) { return a ? a + '/' + b : b; }

  /* Uma tabela é um MAPA por id (spells, items…) ou uma LISTA de quem tem id
   * (dungeons, arenas, especiais). Nos dois casos o primeiro pedaço do caminho
   * é o id do registro. */
  I.percorre = function (DATA, fn) {
    if (!DATA) return;
    for (var i = 0; i < I.TABELAS.length; i++) {
      var t = I.TABELAS[i], tab = DATA[t];
      if (!tab || typeof tab !== 'object') continue;
      (function (t) {
        anda(tab, '', function (reg, campo, texto, dono) { fn(t, reg, campo, texto, dono); }, []);
      })(t);
    }
  };

  /* Troca os textos do DATA pelos do idioma. Devolve { trocados, faltam }.
   * Campo sem tradução fica em português. NUNCA cria campo, nunca mexe em
   * número, id ou ordem: só reescreve string que já era string. */
  /* O PORTUGUÊS de um campo que o aplicaDados trocou (etapa 2). Serve a quem usa o nome como CHAVE
   * — o título "Top 1 Bárbaro" é montado com o nome da classe, e o save e o relé o guardam em
   * português: I18n.pt('classes', 'barbarian', 'name', atual). Sem troca, devolve o `atual`. */
  var ORIG = {};
  I.pt = function (tabela, reg, campo, atual) {
    var k = tabela + '|' + reg + '|' + campo;
    return has(ORIG, k) ? ORIG[k] : atual;
  };

  I.aplicaDados = function (DATA, idioma) {
    var l = idioma || I.idioma, r = { trocados: 0, faltam: 0 };
    if (l === I.PADRAO || !DIC[l]) return r;
    var dd = DIC[l].dados;
    I.percorre(DATA, function (t, reg, campo, texto, dono) {
      var e = dd[t] && has(dd[t], reg) ? dd[t][reg] : null;
      var v = e && has(e, campo) ? e[campo] : null;
      if (typeof v === 'string' && v) { ORIG[t + '|' + reg + '|' + campo] = texto; dono[campo] = v; r.trocados++; }
      else r.faltam++;
    });
    I.aplicado = r;
    return r;
  };
})();
