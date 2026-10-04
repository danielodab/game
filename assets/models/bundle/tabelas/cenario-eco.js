// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-eco.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-eco/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA - cenario da CAMARA DO ECO (a arena do chefe supremo da semana), feito
 * pelo dono: a colunata partida e o entulho vestem os `#` e os `=` da camara, e tres
 * pecas ficam de fora, na beira do circulo. Ate 03/10 a camara vestia o kit do
 * Coracao Partido emprestado.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['ce_pilar_quebrado']="Colunata partida com o lintel caído";
JOGO.CENARIO_NOME['ce_entulho']="Entulho de tambores de coluna";
JOGO.CENARIO_NOME['ce_borda_abismo']="Rochedo da beira do abismo";
JOGO.CENARIO_NOME['ce_cristal_eco']="Cristal com o núcleo do Eco dentro";
JOGO.CENARIO_NOME['ce_obelisco']="Obelisco dos Seis, uma faixa por calabouço";
JOGO.CENARIO['eco']={"alto": ["ce_pilar_quebrado"], "baixo": ["ce_entulho"], "borda": ["ce_borda_abismo", "ce_cristal_eco", "ce_obelisco"], "piso_sob_muro": true};
