// GERADO por tools/extrai_assets.py a partir de assets/embedded/cenario-andaimes.js — nao edite.
// E o embutido MENOS os modelos: no jogo servido os modelos descem do bundle
// (assets/models/bundle/cenario-andaimes/), e o index.html le daqui so as tabelas.
// Em casa (file://) ele continua lendo o embutido inteiro.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
/* SOTERRA 3.0 - cenário dos ANDAIMES DO VENTO (scaffold), feito pelo
 * usuário no Meshy: muro, muro quebrado e viga, o guindaste travado (papel
 * `marco`, UM por sala) e catorze enfeites de obra recortados de três folhas.
 */
JOGO.MODELS = JOGO.MODELS || {};
JOGO.CENARIO = JOGO.CENARIO || {};
JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};
JOGO.CENARIO_NOME['av_muro']="Tapume de tábuas com viga em cada ponta";
JOGO.CENARIO_NOME['av_muro_quebrado']="Tapume de tábuas, quebrado";
JOGO.CENARIO_NOME['av_viga']="Viga de andaime com o prumo pendurado";
JOGO.CENARIO_NOME['av_guindaste']="Guindaste travado";
JOGO.CENARIO_NOME['av_chamine']="Chaminé de ventilação";
JOGO.CENARIO_NOME['av_mastro']="Mastro com lona e bandeirola";
JOGO.CENARIO_NOME['av_torre']="Torre de andaime com escada";
JOGO.CENARIO_NOME['av_caixa']="Caixa de ferramentas aberta";
JOGO.CENARIO_NOME['av_saco']="Saco de brita de lastro";
JOGO.CENARIO_NOME['av_cabo']="Rolo de cabo de aço";
JOGO.CENARIO_NOME['av_estrado']="Estrado de tábuas amarradas";
JOGO.CENARIO_NOME['av_grade']="Grade de respiradouro";
JOGO.CENARIO_NOME['av_tabuas']="Tábuas soltas com pregos";
JOGO.CENARIO_NOME['av_ninho']="Ninho de picanço na serragem";
JOGO.CENARIO_NOME['av_corda']="Corda enrolada no chão";
JOGO.CENARIO_NOME['av_elevador']="Elevador de obra parado";
JOGO.CENARIO_NOME['av_passarela']="Passarela quebrada";
JOGO.CENARIO_NOME['av_barraca']="Barraca de turno";
JOGO.CENARIO['scaffold']={"baixo": ["av_muro", "av_muro_quebrado"], "alto": ["av_muro", "av_muro_quebrado"], "pilar": ["av_viga"], "marco": ["av_guindaste"], "sotaque": ["av_caixa", "av_saco", "av_cabo", "av_estrado"], "sotaque_alto": ["av_chamine", "av_mastro", "av_torre"], "chao": ["av_grade", "av_tabuas", "av_ninho", "av_corda"], "borda": ["av_elevador", "av_passarela", "av_barraca", "av_chamine", "av_torre"], "chao_alt": 0.4, "alto_corpo": "auto"};
