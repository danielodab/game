// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-mina.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-mina/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA 3.0 - cenario da MINA TREMULA (mine), feito pelo usuario:
 * imagem no Gemini com as pecas lado a lado, depois imagem->3D no Meshy.
 * Quatro muretas que se enfileiram, o escoramento de galeria, a broca presa
 * na rocha (papel `marco`, UMA por sala) e treze enfeites de mina
 * recortados de quatro folhas por tools/separa_pecas.py.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['mt_muro_inteiro']="Mureta de pedra bruta";
JOGO.CENARIO_NOME['mt_muro_brecha']="Mureta de pedra bruta, com brecha";
JOGO.CENARIO_NOME['mt_muro_entulho']="Entulho de mina contido por tábuas";
JOGO.CENARIO_NOME['mt_muro_escora']="Escora de galeria: dois postes e uma viga";
JOGO.CENARIO_NOME['mt_pilar']="Escoramento de galeria com lanterna apagada";
JOGO.CENARIO_NOME['mt_marco_broca']="Broca de perfuração presa na rocha";
JOGO.CENARIO_NOME['mt_estalagmite']="Estalagmite com cristais na base";
JOGO.CENARIO_NOME['mt_silo']="Silo de minério com aros de ferro";
JOGO.CENARIO_NOME['mt_porta_lacrada']="Porta de galeria lacrada com tábuas";
JOGO.CENARIO_NOME['mt_vagonete']="Vagonete tombado, minério derramado";
JOGO.CENARIO_NOME['mt_dinamite']="Caixote de dinamite com o estopim de fora";
JOGO.CENARIO_NOME['mt_esteril']="Monte de estéril com a pá fincada";
JOGO.CENARIO_NOME['mt_gaiola_canario']="Gaiola de canário vazia no poste";
JOGO.CENARIO_NOME['mt_trilho']="Trilho de vagonete sobre dormentes";
JOGO.CENARIO_NOME['mt_rachadura']="Rachadura no piso, com brilho no fundo";
JOGO.CENARIO_NOME['mt_cristal_aflorando']="Cristais aflorando da rocha do piso";
JOGO.CENARIO_NOME['mt_pegadas']="Poeira com o rastro do turno da noite";
JOGO.CENARIO_NOME['mt_boca_galeria']="Boca de galeria escorada";
JOGO.CENARIO_NOME['mt_guindaste_poco']="Guindaste de poço com o balde no cabo";
JOGO.CENARIO['mine']={"baixo": ["mt_muro_inteiro", "mt_muro_brecha", "mt_muro_entulho", "mt_muro_escora"], "alto": ["mt_muro_inteiro", "mt_muro_brecha", "mt_muro_entulho", "mt_muro_escora"], "pilar": ["mt_pilar"], "marco": ["mt_marco_broca"], "sotaque": ["mt_vagonete", "mt_dinamite", "mt_esteril", "mt_gaiola_canario"], "sotaque_alto": ["mt_estalagmite", "mt_silo", "mt_porta_lacrada"], "chao": ["mt_trilho", "mt_rachadura", "mt_cristal_aflorando", "mt_pegadas"], "borda": ["mt_boca_galeria", "mt_guindaste_poco", "mt_silo", "mt_estalagmite"], "chao_alt": 0.4, "alto_corpo": "auto"};
