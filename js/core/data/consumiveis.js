// Os CONSUMÍVEIS — as poções de vida da banca do mercador (dono: dados).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
JOGO.DATA = JOGO.DATA || {};

/* O QUE ISTO É (13/09, pedido do dono: "no mercadinho do jogo deve ter poções à
 * venda por vinténs. poções que carregam a vida vão para consumíveis no inventário")
 * ============
 * Três poções de vida, vendidas pela BANCA DO MERCADOR dentro do Mercadinho:
 * estoque infinito, preço fixo em vinténs do SACO (o banco não conta, como toda
 * compra do jogo) e sem taxa — a taxa é o ralo da venda ENTRE jogadores.
 *
 * Não são peças com série (iid): são contadores na conta (Progress.state.consumiveis,
 * como as pedras e os selos), com um teto por tipo. Usar é uma ação do herói na vez
 * dele, na batalha (Engine.usePotion): custa PA, uma por turno por herói, cura o
 * próprio herói, não passa do PV máximo e não levanta quem caiu. No duelo não entra.
 *
 * Este arquivo é lido pelo jogo, pelo juiz do servidor (servidor/juiz/motor.js) e
 * pela wiki do site — os números moram SÓ aqui. `tamanho` é o frasco do ícone
 * (1 pequeno, 2 médio, 3 grande). */
JOGO.DATA.consumiveis = {
  'pocao-pequena': {
    id: 'pocao-pequena', tipo: 'vida', name: 'Poção de Vida Pequena',
    cura: 30, preco: 40, tamanho: 1,
    description: 'Um gole de xarope vermelho. Cura 30 PV de quem bebe.'
  },
  'pocao-media': {
    id: 'pocao-media', tipo: 'vida', name: 'Poção de Vida Média',
    cura: 70, preco: 110, tamanho: 2,
    description: 'O frasco que o mercador mais vende. Cura 70 PV de quem bebe.'
  },
  'pocao-grande': {
    id: 'pocao-grande', tipo: 'vida', name: 'Poção de Vida Grande',
    cura: 150, preco: 260, tamanho: 3,
    description: 'Garrafa bojuda para a sala do chefe. Cura 150 PV de quem bebe.'
  }
};

/* As regras de uso. `teto`: quantas de CADA poção cabem no inventário (a banca
 * recusa passar disso). `pa`: o custo de beber na batalha. `porTurno`: quantas um
 * herói bebe na mesma vez (o motor guarda a marca em castsThisTurn, que entra no hash). */
JOGO.DATA.consumiveisRegras = { teto: 20, pa: 2, porTurno: 1 };
