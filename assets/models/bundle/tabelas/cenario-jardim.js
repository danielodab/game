// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-jardim.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-jardim/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA 3.0 - cenário da ESTUFA SOTERRADA, feito pelo usuário no Meshy.
 *
 * Chegaram dez folhas: cinco de enfeite, com várias peças GRUDADAS numa
 * malha só (o Meshy gera assim para não gastar um crédito por barril), e
 * cinco de alvenaria, com uma peça cada. `separa_cenario.py` corta por
 * vizinhança de ilhas de geometria — partir por 'parte solta' não serve,
 * porque cada folha e cada cogumelo é uma casca desconectada.
 *
 * `JOGO.CENARIO[tema][papel]` diz ao renderizador o que usar onde:
 *   baixo   = divisória (0,95 m, bloqueia passagem e não a visão)
 *   alto    = coluna (3,10 m, bloqueia tudo)
 *   sotaque = enfeite pontual, UMA vez no miolo de uma fileira de `baixo`
 *   chao    = enfeite de piso, sem colisão
 *   borda   = enfeite fora da arena
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['jd_regador']="Regador de cobre tombado";
JOGO.CENARIO_NOME['jd_carrinho']="Carrinho de jardim tombado";
JOGO.CENARIO_NOME['jd_tronco']="Tronco serrado com cogumelos";
JOGO.CENARIO_NOME['jd_redoma']="Redoma de vidro quebrada";
JOGO.CENARIO_NOME['jd_canteiro']="Canteiro suspenso com brotos";
JOGO.CENARIO_NOME['jd_vaso']="Vaso de barro rachado";
JOGO.CENARIO_NOME['jd_muro_pilastra']="Muro de pilastras inteiro";
JOGO.CENARIO_NOME['jd_muro_brecha']="Muro de pilastras com brecha";
JOGO.CENARIO_NOME['jd_muro_ruina']="Muro desabado em ruína";
JOGO.CENARIO_NOME['jd_muro_mato']="Muro tomado pelo mato";
JOGO.CENARIO_NOME['jd_coluna_vidro']="Coluna de vidro da estufa";
JOGO.CENARIO_NOME['jd_cipo']="Cipó grosso na estaca";
JOGO.CENARIO_NOME['jd_estatua']="Estátua de jardineiro musgosa";
JOGO.CENARIO_NOME['jd_pilar']="Pilar de pedra com entulho ao pé";
JOGO.CENARIO_NOME['jd_cristal_p']="Cristais pequenos no chão";
JOGO.CENARIO_NOME['jd_cristal_g']="Afloramento de cristais";
JOGO.CENARIO_NOME['jd_raiz']="Raiz rompendo a laje";
JOGO.CENARIO_NOME['jd_poca']="Poça de água parada";
JOGO.CENARIO_NOME['jd_escada']="Escada de podar";
JOGO.CENARIO_NOME['jd_estufa_arvore']="Estufa menor com árvore morta";
JOGO.CENARIO['garden']={"baixo": ["jd_muro_pilastra", "jd_muro_brecha", "jd_muro_ruina", "jd_muro_mato"], "alto": ["jd_muro_pilastra", "jd_muro_brecha", "jd_muro_ruina", "jd_muro_mato"], "pilar": ["jd_pilar"], "sotaque": ["jd_regador", "jd_carrinho", "jd_tronco", "jd_redoma", "jd_canteiro", "jd_vaso"], "sotaque_alto": ["jd_coluna_vidro", "jd_cipo", "jd_estatua"], "chao": ["jd_cristal_p", "jd_cristal_g", "jd_raiz", "jd_poca"], "borda": ["jd_escada", "jd_estufa_arvore"]};
