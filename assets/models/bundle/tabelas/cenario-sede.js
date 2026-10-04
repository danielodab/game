// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-sede.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-sede/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA - cenario da SALA DE GUERRA (o Salao da Sede, a guerra de guilda 2x2),
 * feito pelo dono: imagem no Gemini, depois imagem->3D no Meshy. Cinco modulos de
 * parede (lisa, com esteio, com tocha, cortada e a porta) e onze pecas de salao.
 * Os papeis sao os das `pecas` do mapa 'sede' (js/core/data/arenas.js); a variante
 * e papel + '_' + `arte`. O fogo, a luz, a chamine e o pano da bandeira sao do codigo.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['sd_parede_lisa']="Parede lisa do salão";
JOGO.CENARIO_NOME['sd_parede_esteio']="Parede com esteio de carvalho";
JOGO.CENARIO_NOME['sd_parede_tocha']="Parede com tocha apagada";
JOGO.CENARIO_NOME['sd_parede_cortada']="Parede cortada, do lado da câmera";
JOGO.CENARIO_NOME['sd_porta']="Porta do salão, de três casas";
JOGO.CENARIO_NOME['sd_trono']="Trono no estrado, com o painel de carvalho";
JOGO.CENARIO_NOME['sd_lareira']="Lareira de pedra com consolo, sem fogo";
JOGO.CENARIO_NOME['sd_estandarte']="Mastro do estandarte, sem o pano";
JOGO.CENARIO_NOME['sd_pilar']="Pilar do salão";
JOGO.CENARIO_NOME['sd_rack_armas']="Cavalete de armas";
JOGO.CENARIO_NOME['sd_armadura']="Armadura no suporte, com alabarda";
JOGO.CENARIO_NOME['sd_mesa']="Mesa do conselho com o mapa de guerra em relevo";
JOGO.CENARIO_NOME['sd_banco']="Banco corrido";
JOGO.CENARIO_NOME['sd_estatua']="Busto do fundador";
JOGO.CENARIO_NOME['sd_bau']="Baú de carvalho com cintas de ferro";
JOGO.CENARIO_NOME['sd_trofeu']="Pedestal de troféu com o crânio chifrudo";
JOGO.CENARIO['sede']={"parede_salao": ["sd_parede_lisa"], "parede_esteio": ["sd_parede_esteio"], "parede_tocha": ["sd_parede_tocha"], "parede_cortada": ["sd_parede_cortada"], "porta": ["sd_porta"], "trono": ["sd_trono"], "lareira": ["sd_lareira"], "estandarte": ["sd_estandarte"], "pilar": ["sd_pilar"], "pilar_rack_armas": ["sd_rack_armas"], "armadura": ["sd_armadura"], "mesa": ["sd_mesa"], "banco_salao": ["sd_banco"], "estatua": ["sd_estatua"], "bau": ["sd_bau"], "bau_trofeu": ["sd_trofeu"]};
