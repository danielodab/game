// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-fecho.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-fecho/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA 3.0 - cenário do FECHO DE BRASA (forja), feito pelo usuário
 * no Meshy: dois muros e um pilar, o forno de fundição (papel `marco`,
 * UM por sala) e quinze enfeites de forja recortados de três folhas.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['fj_muro']="Muro de tijolo refratário da forja";
JOGO.CENARIO_NOME['fj_muro_quebrado']="Muro da forja, quebrado";
JOGO.CENARIO_NOME['fj_pilar']="Pilar de ferro e tijolo";
JOGO.CENARIO_NOME['fj_forno']="Forno de fundição, boca acesa";
JOGO.CENARIO_NOME['fj_chamine']="Chaminé de forja com fuligem";
JOGO.CENARIO_NOME['fj_correntes']="Feixe de correntes com ganchos";
JOGO.CENARIO_NOME['fj_prensa']="Prensa parada no meio do golpe";
JOGO.CENARIO_NOME['fj_bigorna']="Bigorna fria no cepo";
JOGO.CENARIO_NOME['fj_calha']="Calha de têmpera, água preta";
JOGO.CENARIO_NOME['fj_lingotes']="Pilha de lingotes";
JOGO.CENARIO_NOME['fj_bancada']="Bancada com ferramentas cravadas";
JOGO.CENARIO_NOME['fj_fole']="Fole duplo de couro";
JOGO.CENARIO_NOME['fj_braseiro']="Braseiro de carvão";
JOGO.CENARIO_NOME['fj_grelha']="Grelha de piso acesa";
JOGO.CENARIO_NOME['fj_limalha']="Limalha com martelo esquecido";
JOGO.CENARIO_NOME['fj_carvao']="Carvão derramado";
JOGO.CENARIO_NOME['fj_pilao']="Martelo-pilão";
JOGO.CENARIO_NOME['fj_carrinho']="Carrinho de minério no trilho";
JOGO.CENARIO_NOME['fj_sino']="Sino de fim de turno";
JOGO.CENARIO['forge']={"baixo": ["fj_muro", "fj_muro_quebrado"], "alto": ["fj_muro", "fj_muro_quebrado"], "pilar": ["fj_pilar"], "marco": ["fj_forno"], "sotaque": ["fj_bigorna", "fj_calha", "fj_lingotes", "fj_bancada", "fj_fole", "fj_braseiro"], "sotaque_alto": ["fj_chamine", "fj_correntes", "fj_prensa"], "chao": ["fj_grelha", "fj_limalha", "fj_carvao"], "borda": ["fj_pilao", "fj_carrinho", "fj_sino", "fj_chamine", "fj_correntes"], "chao_alt": 0.4, "alto_corpo": "auto"};
