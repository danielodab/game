/* SOTERRA — JOGO.Palavroes: o FILTRO DE PALAVRÕES do chat (08/10 à noite, o dono: "o chat precisa
 * ter um filtro para evitar palavrões; quando alguém mandar palavrão, fica tipo %$@!#").
 *
 * Puro (sem DOM): a Rede o usa ao MANDAR (a frase já sai limpa desta aba) e ao MOSTRAR (o que chega de
 * uma aba antiga sem o filtro também sai limpo). A palavra feia vira símbolos do mesmo tamanho, no
 * molde de gibi: "merda" → "%$@!#". A régua:
 *   - por PALAVRA (separada por espaço): "pôrra!" cai, a pontuação em volta fica; "computador" não cai
 *     por carregar "puta" no meio — a lista é de palavras inteiras, mais algumas juntas ("fodase",
 *     "vaitomarnocu") que o pessoal escreve emendadas;
 *   - sem acento, sem caixa, e com o DISFARCE desfeito: p0rra → porra, m3rda → merda, pvt@ → puta,
 *     c@r@lho → caralho; letras repetidas se juntam (merdaaaa → merda, caraaalho → caralho);
 *   - a lista é só a que os jogadores usam de verdade, em pt, en e es — refinamento vem do uso.
 * `limpa(texto)` devolve o texto filtrado; `tem(texto)` diz se havia palavrão. */
(function () {
  'use strict';
  var JOGO = (typeof window !== 'undefined') ? (window.JOGO = window.JOGO || {}) : (globalThis.JOGO = globalThis.JOGO || {});
  var P = {};
  JOGO.Palavroes = P;

  var LISTA = [
    // português
    'merda', 'bosta', 'caralho', 'carai', 'karalho', 'porra', 'poha', 'puta', 'puto', 'putinha', 'putona', 'putaria',
    'fdp', 'filhodaputa', 'filhadaputa', 'foda', 'fodase', 'fodasse', 'fodido', 'fodida', 'fudido', 'fudida', 'fuder', 'foder',
    'buceta', 'boceta', 'xoxota', 'xota', 'piroca', 'rola', 'pau', 'cu', 'cuzao', 'cuzinho', 'arrombado', 'arrombada',
    'viado', 'veado', 'viadinho', 'bicha', 'bichona', 'sapatao', 'traveco', 'vagabunda', 'vagabundo', 'vadia', 'vadio',
    'desgracado', 'desgracada', 'desgraca', 'corno', 'corna', 'cornudo', 'otario', 'otaria', 'babaca', 'idiota', 'imbecil',
    'retardado', 'retardada', 'mongol', 'mongoloide', 'escroto', 'escrota', 'nojento', 'nojenta', 'lixo', 'verme',
    'krl', 'vsf', 'pqp', 'tnc', 'vtnc', 'vtmnc', 'vaitomarnocu', 'tomanocu', 'tomarnocu', 'vaisefoder', 'vaisefuder',
    'cacete', 'caceta', 'pinto', 'pica', 'siririca', 'punheta', 'punheteiro', 'brocha', 'cagar', 'cagada', 'cagado', 'mijar', 'mijao',
    'prostituta', 'rapariga', 'piranha', 'biscate', 'safado', 'safada', 'tarado', 'tarada', 'pederasta',
    'macaco', 'macaca', 'preto', 'crioulo', 'negao', 'negrao', 'judeu', 'nazista', 'hitler',
    // inglês
    'fuck', 'fucker', 'fucking', 'fucked', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bitches', 'asshole', 'ass',
    'dick', 'cock', 'pussy', 'cunt', 'whore', 'slut', 'bastard', 'retard', 'nigger', 'nigga', 'faggot', 'fag', 'damn', 'crap',
    'wtf', 'stfu', 'gtfo',
    // espanhol
    'mierda', 'puta', 'puto', 'joder', 'jodete', 'cabron', 'cabrona', 'pendejo', 'pendeja', 'gilipollas', 'maricon',
    'marica', 'cono', 'chingar', 'chingada', 'chingado', 'verga', 'culo', 'culero', 'pinche', 'hijodeputa', 'hijueputa',
    'malparido', 'malparida', 'carajo', 'cojones', 'polla', 'zorra', 'perra', 'imbecil', 'estupido', 'estupida', 'idiota'
  ];
  var TABELA = {}, TABELA_JUNTA = {};    // a lista como está e a lista com as letras repetidas juntas (porra → pora)
  for (var i = 0; i < LISTA.length; i++) { TABELA[LISTA[i]] = true; TABELA_JUNTA[junta(LISTA[i])] = true; }

  var DISFARCE = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l', '€': 'e' };
  var SIMBOLOS = '%$@!#';

  /* a palavra como a lista a guarda: minúscula, sem acento, com o disfarce desfeito e só letras e números */
  function chave(palavra) {
    var s = String(palavra || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    var fora = '';
    for (var k = 0; k < s.length; k++) {
      var c = s.charAt(k);
      fora += DISFARCE.hasOwnProperty(c) ? DISFARCE[c] : c;
    }
    return fora.replace(/[^a-z]/g, '');
  }
  /* letras repetidas se juntam: "meeerda" → "merda", "porrrra" → "pora" (a lista junta também, TABELA_JUNTA) */
  function junta(s) { return s.replace(/(.)\1+/g, '$1'); }
  function feia(palavra) {
    var c = chave(palavra);
    if (!c) return false;
    if (TABELA[c]) return true;
    var j = junta(c);
    if (TABELA_JUNTA[j]) return true;
    // a palavra "colada" com um disfarce no fim (porraaa!, merda123) já caiu acima; a plural simples também
    if (c.length > 3 && c.charAt(c.length - 1) === 's' && TABELA[c.slice(0, -1)]) return true;
    if (j.length > 3 && j.charAt(j.length - 1) === 's' && TABELA_JUNTA[j.slice(0, -1)]) return true;
    return false;
  }
  function tapa(n) {
    var out = '';
    for (var k = 0; k < n; k++) out += SIMBOLOS.charAt(k % SIMBOLOS.length);
    return out;
  }

  P.tem = function (texto) {
    var partes = String(texto || '').split(/\s+/);
    for (var k = 0; k < partes.length; k++) {
      var miolo = partes[k].replace(/^[^0-9A-Za-zÀ-ÿ@$!|€]+|[^0-9A-Za-zÀ-ÿ@$!|€]+$/g, '');
      if (miolo && feia(miolo)) return true;
    }
    return false;
  };
  P.limpa = function (texto) {
    return String(texto || '').split(/(\s+)/).map(function (tk) {
      // a pontuação só das pontas fica fora ("pôrra!" → "%$@!#!"); o "!" e o "@" do meio contam como disfarce
      var m = /^([^0-9A-Za-zÀ-ÿ@$|€]*)([\s\S]*?)([^0-9A-Za-zÀ-ÿ@$|€]*)$/.exec(tk);
      if (!m || !m[2]) return tk;
      var miolo = m[2];
      if (!feia(miolo)) return tk;
      return m[1] + tapa(miolo.length) + m[3];
    }).join('');
  };
  P._chave = chave;        // provas
  P.LISTA = LISTA;
})();
