// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-cisterna.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-cisterna/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA 3.0 - cenário da CORTE AFOGADA (Cisterna), feito pelo usuário
 * no Meshy: dois muros, o aquário (papel `marco`, UM por sala) e nove
 * enfeites de baile afogado recortados de três folhas.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['cs_muro_inteiro']="Muro de pedra da cisterna";
JOGO.CENARIO_NOME['cs_muro_brecha']="Muro da cisterna com brecha";
JOGO.CENARIO_NOME['cs_pilar_a']="Pilar da corte, gêmeo primeiro";
JOGO.CENARIO_NOME['cs_pilar_b']="Pilar da corte, gêmeo segundo";
JOGO.CENARIO_NOME['cs_aquario']="Aquário da corte, com peixes";
JOGO.CENARIO_NOME['cs_estandarte']="Estandarte encharcado na lança";
JOGO.CENARIO_NOME['cs_luminaria']="Luminária tomada por algas";
JOGO.CENARIO_NOME['cs_espelho']="Espelho de baile afogado";
JOGO.CENARIO_NOME['cs_trono']="Trono de baile encharcado";
JOGO.CENARIO_NOME['cs_sal']="Formação de sal cristalizado";
JOGO.CENARIO_NOME['cs_poco_lirio']="Poço com vitórias-régias";
JOGO.CENARIO_NOME['cs_fonte']="Fonte-coração com bule";
JOGO.CENARIO_NOME['cs_lustre']="Lustre caído da corte";
JOGO.CENARIO_NOME['cs_barril']="Barril tombado vazando salmoura";
JOGO.CENARIO['cistern']={"baixo": ["cs_muro_inteiro", "cs_muro_brecha"], "alto": ["cs_muro_inteiro", "cs_muro_brecha"], "pilar": ["cs_pilar_a", "cs_pilar_b"], "marco": ["cs_aquario"], "sotaque": ["cs_trono", "cs_sal", "cs_poco_lirio", "cs_fonte"], "sotaque_alto": ["cs_estandarte", "cs_luminaria", "cs_espelho"], "chao": ["cs_lustre", "cs_barril"], "borda": ["cs_estandarte", "cs_luminaria", "cs_sal", "cs_poco_lirio"], "chao_alt": 0.5, "alto_corpo": "auto"};
