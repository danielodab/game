// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-santuario.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-santuario/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA - kit do SANTUARIO DOS ELEMENTOS, feito pelo dono: um muro por
 * quadrante (fogo, agua, terra, ar), o pilar vivo, o Altar dos Quatro e onze
 * pecas de identidade e de mecanica. `regioes` da a cada quadrante o muro e os
 * enfeites dele; `mecanica` lista o que o codigo do Santuario acende, gira e sobe.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['el_muro_fogo']="Muro de basalto com o símbolo da chama";
JOGO.CENARIO_NOME['el_muro_agua']="Muro de pedra azul com o símbolo da onda";
JOGO.CENARIO_NOME['el_muro_terra']="Muro de arenito com musgo e raiz";
JOGO.CENARIO_NOME['el_muro_ar']="Muro de mármore claro com respiros";
JOGO.CENARIO_NOME['el_pilar_vivo']="Pilar vivo: o bloco que sobe e desce";
JOGO.CENARIO_NOME['el_marco_altar']="Altar dos Quatro";
JOGO.CENARIO_NOME['el_estatua_cega']="Estátua vendada com a lanterna fria";
JOGO.CENARIO_NOME['el_agua_pilar']="Coluna da maré, com craca na base";
JOGO.CENARIO_NOME['el_menir']="Menir com musgo e cristais";
JOGO.CENARIO_NOME['el_ar_pilar']="Coluna de mármore gasta pelo vento";
JOGO.CENARIO_NOME['el_bica']="Bica de carranca, sem água";
JOGO.CENARIO_NOME['el_cata_vento']="Cata-vento de bronze";
JOGO.CENARIO_NOME['el_braseiro']="Braseiro de tripé, apagado";
JOGO.CENARIO_NOME['el_respiro']="Respiro de vento";
JOGO.CENARIO_NOME['el_soquete']="Soquete do pilar vivo";
JOGO.CENARIO_NOME['el_poca']="Poça de água parada";
JOGO.CENARIO_NOME['el_ponte']="Ponte de laje sobre a água";
JOGO.CENARIO['santuario']={"alto": ["el_muro_fogo", "el_muro_agua", "el_muro_terra", "el_muro_ar"], "baixo": ["el_muro_fogo", "el_muro_agua", "el_muro_terra", "el_muro_ar"], "pilar": ["el_agua_pilar", "el_ar_pilar"], "marco": ["el_marco_altar"], "sotaque_alto": ["el_estatua_cega", "el_agua_pilar", "el_menir", "el_ar_pilar", "el_bica", "el_cata_vento"], "sotaque": ["el_braseiro", "el_respiro"], "chao": ["el_soquete", "el_poca", "el_ponte"], "borda": ["el_estatua_cega", "el_agua_pilar", "el_menir", "el_ar_pilar"], "pilar_vivo": ["el_pilar_vivo"], "mecanica": ["el_braseiro", "el_pilar_vivo", "el_soquete", "el_respiro", "el_cata_vento", "el_bica", "el_poca", "el_ponte"], "regioes": {"fogo": {"alto": ["el_muro_fogo"], "baixo": ["el_muro_fogo"], "pilar": [], "sotaque_alto": ["el_estatua_cega"], "sotaque": ["el_braseiro"], "chao": [], "borda": ["el_estatua_cega"]}, "agua": {"alto": ["el_muro_agua"], "baixo": ["el_muro_agua"], "pilar": ["el_agua_pilar"], "sotaque_alto": ["el_agua_pilar", "el_bica"], "sotaque": [], "chao": ["el_poca", "el_ponte"], "borda": ["el_agua_pilar"]}, "terra": {"alto": ["el_muro_terra"], "baixo": ["el_muro_terra"], "pilar": [], "sotaque_alto": ["el_menir"], "sotaque": [], "chao": ["el_soquete"], "borda": ["el_menir"]}, "ar": {"alto": ["el_muro_ar"], "baixo": ["el_muro_ar"], "pilar": ["el_ar_pilar"], "sotaque_alto": ["el_ar_pilar", "el_cata_vento"], "sotaque": ["el_respiro"], "chao": [], "borda": ["el_ar_pilar"]}}, "chao_alt": 0.4, "marco_no_chao": true, "piso_sob_muro": true, "enfeite_sobre_piso": true};
