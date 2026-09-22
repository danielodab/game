// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-coracao.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-coracao/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA 3.0 - cenario do CORACAO PARTIDO (heart), feito pelo usuario:
 * imagem no Gemini com as pecas lado a lado, depois imagem->3D no Meshy.
 * Duas muretas que se enfileiram, o pilar rachado em quatro, a estatua sem
 * cabeca com o coracao nas maos (papel `marco`, UMA por sala) e onze
 * enfeites recortados de quatro folhas por tools/separa_pecas.py.
 * A borda reaproveita as tres monumentais: o saldo dava para 4 folhas.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['cp_muro_inteiro']="Mureta que muda de material a cada trecho";
JOGO.CENARIO_NOME['cp_muro_balaustrada']="Balaustrada partida, com dois balaústres a menos";
JOGO.CENARIO_NOME['cp_pilar']="Pilar rachado em quatro quartos";
JOGO.CENARIO_NOME['cp_marco_estatua']="Estátua sem cabeça com o coração rachado";
JOGO.CENARIO_NOME['cp_arco']="Arco partido que não fecha no topo";
JOGO.CENARIO_NOME['cp_escadaria']="Escadaria em espiral que acaba no ar";
JOGO.CENARIO_NOME['cp_coluna_elementos']="Coluna dos quatro elementos, com anéis de ouro";
JOGO.CENARIO_NOME['cp_bacia']="Bacia elemental: a água congela de um lado";
JOGO.CENARIO_NOME['cp_caco_espelho']="Caco de espelho fincado num bloco rachado";
JOGO.CENARIO_NOME['cp_raiz']="Raiz que sai da pedra e volta para dentro";
JOGO.CENARIO_NOME['cp_lampioes']="Poste com quatro lampiões, um por elemento";
JOGO.CENARIO_NOME['cp_mosaico']="Mosaico das quatro estações, com ladrilhos faltando";
JOGO.CENARIO_NOME['cp_rachadura_estrela']="Rachadura em estrela nas lajes";
JOGO.CENARIO_NOME['cp_veio_luz']="Veio de luz atravessando a laje";
JOGO.CENARIO_NOME['cp_cinza_gelo']="Cinza com uma crosta de gelo por cima";
JOGO.CENARIO['heart']={"baixo": ["cp_muro_inteiro", "cp_muro_balaustrada"], "alto": ["cp_muro_inteiro", "cp_muro_balaustrada"], "pilar": ["cp_pilar"], "marco": ["cp_marco_estatua"], "sotaque": ["cp_bacia", "cp_caco_espelho", "cp_raiz", "cp_lampioes"], "sotaque_alto": ["cp_arco", "cp_escadaria", "cp_coluna_elementos"], "chao": ["cp_mosaico", "cp_rachadura_estrela", "cp_veio_luz", "cp_cinza_gelo"], "borda": ["cp_arco", "cp_escadaria", "cp_coluna_elementos"], "chao_alt": 0.4, "alto_corpo": "auto"};
