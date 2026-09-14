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
 * como as pedras e os selos), com um teto por tipo.
 *
 * ONDE SE BEBE (13/09, o dono corrigiu: "a poção não é para usar na batalha.. e sim
 * para curar a vida após uma batalha na sala de espera entre as salas"): na ANTESSALA,
 * nunca na batalha. Tocar a poção cura aquele herói na hora, sem passar do PV máximo,
 * quantas o jogador quiser — é o atalho para não esperar a vida voltar sozinha
 * (DATA.vidaEntreSalas). O motor e o juiz recusam o gole como lance de batalha.
 *
 * Este arquivo é lido pelo jogo, pelo juiz do servidor (servidor/juiz/motor.js) e
 * pela wiki do site — os números moram SÓ aqui (a API em Python repete o msPorPv, ver
 * servidor/salas.py VIDA_MS_POR_PV). `tamanho` é o frasco do ícone (1 pequeno, 2
 * médio, 3 grande). */
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

/* As regras da banca. `teto`: quantas de CADA poção cabem no inventário (a banca
 * recusa passar disso). O custo em PA e o "uma por turno" saíram com a batalha (13/09). */
JOGO.DATA.consumiveisRegras = { teto: 20 };

/* A VIDA ENTRE AS SALAS (13/09, pedido do dono: "quando acaba a luta o jogador fica com
 * a vida que terminou a última luta.. carrega 1 pv a cada 2 segundos. se um personagem
 * morre ele vem com a vida zerada aumentando 1 pv a cada 2 s também").
 * `msPorPv`: quantos milissegundos de sala de espera valem 1 PV, contados do instante em
 * que a sala anterior fechou. Herói a 0 PV não entra na batalha seguinte. */
JOGO.DATA.vidaEntreSalas = { msPorPv: 2000 };
