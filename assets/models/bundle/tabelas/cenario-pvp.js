// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-pvp.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-pvp/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA — o lote do CAMPO DE PVP (20/09), feito pelo dono no Meshy: o
 * portal de espadas da entrada (obra da praça, chave praca_portal_pvp),
 * dois módulos de muro e oito barreiras táticas — quatro ALTAS, que cortam
 * a linha de visão, e quatro BAIXAS, que barram o passo e dão cobertura.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['praca_portal_pvp']="O Portal do Campo de PvP (arco de espadas)";
JOGO.CENARIO_NOME['pv_muro_alto']="Muro alto do Campo";
JOGO.CENARIO_NOME['pv_muro_pedra']="Muro de pedra com barra de ferro";
JOGO.CENARIO_NOME['pv_muro_rachado']="Muro rachado, escombros no meio";
JOGO.CENARIO_NOME['pv_palicada']="Paliçada de estacas";
JOGO.CENARIO_NOME['pv_pilar']="Pilar de pedra";
JOGO.CENARIO_NOME['pv_muro_medio']="Muro médio do Campo";
JOGO.CENARIO_NOME['pv_sacos']="Sacos de areia com estaca";
JOGO.CENARIO_NOME['pv_caixote']="Caixote de armas com lanças";
JOGO.CENARIO_NOME['pv_frisa']="Cavalo-de-frisa";
JOGO.CENARIO_NOME['pv_tonel']="Tonel com escudos e lança";
JOGO.CENARIO['pvp']={"baixo": ["pv_muro_alto", "pv_muro_pedra", "pv_muro_rachado", "pv_palicada", "pv_muro_medio"], "alto": ["pv_muro_alto", "pv_muro_pedra", "pv_muro_rachado", "pv_palicada"], "pilar": ["pv_pilar"], "sotaque": ["pv_sacos", "pv_caixote", "pv_frisa", "pv_tonel"], "chao": [], "borda": [], "alto_corpo": "auto"};
