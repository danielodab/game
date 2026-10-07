// AS CRÔNICAS DO MUNDO ENTERRADO (07/10) — a história que chega ao jogador (dono: dado).
/* O pedido do dono (07/10): "o GDD tem um mundo forte, a Grande Lousa, os Fechos, os Corações falhando.
 * Quase nada disso chega ao jogador. Crônicas curtas, uma por feito da coleção e por chefe derrubado,
 * custam texto e dão motivo para completar."
 *
 * Cada crônica é um texto curto na voz do mundo (docs/GDD.md §1 e §4, e as descrições dos portais e dos
 * chefes em dungeons.js / monsters.js), preso a um GANCHO que a abre:
 *   { tipo: 'prologo' }                       — aberta desde o começo (o dia da Grande Lousa)
 *   { tipo: 'bestiario', calabouco: id }      — o bestiário daquele portal completo (Progress.feitos)
 *   { tipo: 'chefe', chefe: defId }           — aquele chefe derrubado ao menos uma vez (o bestiário o conta)
 *   { tipo: 'fusoes' }                        — as 21 fusões vencedoras (Progress.feitos)
 * Quem lê o gancho e diz o que está aberto é js/core/cronicas.js (JOGO.Cronicas); a Coleção lista todas
 * (as fechadas com o título e o que falta) e a tela da recompensa avisa a que acabou de abrir.
 *
 * Os textos são chaves de tradução (tr): a versão em inglês e em espanhol mora em js/i18n/textos_*.js.
 * O id de cada crônica é fixo — a página guarda em localStorage quais o jogador já abriu. */
JOGO.DATA.cronicas = [
  { id: 'lousa', gancho: { tipo: 'prologo' },
    titulo: 'O dia da Grande Lousa',
    texto: 'Há mil anos, o céu virou pedra. Ninguém sabe se foi castigo, acidente ou misericórdia: num único dia o firmamento coagulou, desceu e se assentou sobre o mundo como a tampa de um sarcófago. Tudo o que estava sob céu aberto foi apagado. Só sobreviveu o que já estava embaixo — adegas, cisternas, estufas, forjas. Os últimos construtores selaram essas bolsas de mundo em Fechos, cada um mantido vivo por um Coração. Mil anos é muito tempo para um coração bater sozinho. Quando um para, o Fecho escurece — e a Lousa desce mais um palmo. É por isso que você desce.' },

  // ---- o bestiário de cada portal
  { id: 'bestiario-greenhouse', gancho: { tipo: 'bestiario', calabouco: 'greenhouse' },
    titulo: 'O jardim que aprendeu a caçar',
    texto: 'A estufa real foi selada com o jardim ainda vivo. Sem sol, as plantas fizeram o que todo faminto faz: aprenderam a andar até a comida. Vagalumes presos em redomas viraram o sol de mentira; a água que a Lousa prendeu lá em cima pinga pelas rachaduras do vidro a noite inteira, e o jardim adora. Quem conhece cada bufo, cada vergasta e cada vespa desta estufa sabe por onde o chão morde — e por onde ele floresce.' },
  { id: 'bestiario-cistern', gancho: { tipo: 'bestiario', calabouco: 'cistern' },
    titulo: 'A corte que a água bebeu',
    texto: 'O reservatório matou a sede do mundo antigo e depois bebeu os donos. A corte afogada nunca soube que o baile acabou: pérolas no lodo, lampiões ainda acesos debaixo d\'água, lustres de águas-vivas. Afogadiços, moreias-flauta e gotas-gordas são os convidados que ficaram. Tudo reflete aqui — e quem já viu a corte inteira sabe que, às vezes, o reflexo se mexe primeiro.' },
  { id: 'bestiario-emberlock', gancho: { tipo: 'bestiario', calabouco: 'emberlock' },
    titulo: 'A prole da fornalha',
    texto: 'O Fecho de Brasa foi forjado ao redor da primeira chama do mundo, e a chama não quis ficar sozinha. Tições que correm pelos vãos, cinzentos, bigornas que andam, montes de escória e o Ferreiro Sem-Rosto temperando os seus: a forja fabricou a própria guarda. Aqui o calor não é clima, é arquitetura. Conhecer a prole inteira é saber onde cada um deles morre — porque onde morrem importa.' },
  { id: 'bestiario-windscaffold', gancho: { tipo: 'bestiario', calabouco: 'windscaffold' },
    titulo: 'Os que nunca entregaram a obra',
    texto: 'Quinze andares de andaime amarrado com corda, pendurados sobre um vazio que ninguém mediu. Os construtores não terminaram o poço de manutenção; a obra terminou os construtores. O vento que sobe pelos respiradouros faz as tábuas cantarem a noite inteira, e tudo o que mora nos Andaimes aprendeu a lutar sem olhar para baixo. Quem conhece a equipe inteira sabe que cair não é derrota tática: é o chão da sala não existir.' },
  { id: 'bestiario-quakemine', gancho: { tipo: 'bestiario', calabouco: 'quakemine' },
    titulo: 'O turno que não subiu',
    texto: 'A Mina Trêmula cavava para cima, tentando furar a Grande Lousa por baixo. Parou no dia em que o turno da noite não voltou. Desde então a rocha bate sozinha, e a poeira desce em cortinas: é a Lousa se acomodando mais um palmo. Os mineiros continuam trabalhando. Ninguém teve coragem de dizer a eles que o turno acabou — e quem conhece cada um deles pelo nome já desistiu de tentar.' },
  { id: 'bestiario-brokenheart', gancho: { tipo: 'bestiario', calabouco: 'brokenheart' },
    titulo: 'O que vive no Coração',
    texto: 'O Coração Partido sustentava o mundo inteiro, e não só um Fecho. Rachou em quatro quartos que batem fora de compasso, e cada batida joga as salas para um clima diferente. O que mora aqui nasceu dessa arritmia: criaturas de brasa, de água, de pedra e de ar que não sabem que são de elementos inimigos. Conhecer todas é entender a regra do lugar: não existe elemento seguro, e a Lousa está ouvindo.' },

  // ---- cada chefe derrubado
  { id: 'chefe-boss-gardener', gancho: { tipo: 'chefe', chefe: 'boss-gardener' },
    titulo: 'A Jardineira-Viúva',
    texto: 'Três metros de treliça, luvas de couro e um véu de viúva; uma tesoura de poda enferrujada onde deveriam estar as mãos. Ela foi a guardiã da estufa real e nunca largou o cargo. Mil anos cuidando de um jardim que aprendeu a caçar a transformaram na jardineira perfeita: ninguém poda com mais amor. Você entrou no coreto dela, e para a Viúva toda Descida é erva daninha. Ela caiu — e, por um instante, o jardim parou de gotejar.' },
  { id: 'chefe-boss-baroness', gancho: { tipo: 'chefe', chefe: 'boss-baroness' },
    titulo: 'Baronesa Salmoura',
    texto: 'Um vestido de baile do século passado, cheio de água escura e viva; um colar de pérolas boiando onde deveria haver um pescoço. A Baronesa recebe toda visita do mesmo jeito: puxa para perto e engole a sala. Foi dona da cisterna quando a cisterna ainda matava sede, e segue dando bailes para uma corte que afogou. Derrubá-la não seca o trono. Mas, por uma noite, o reflexo na água parou de se mexer primeiro.' },
  { id: 'chefe-boss-heartforge', gancho: { tipo: 'chefe', chefe: 'boss-heartforge' },
    titulo: 'Magno, o Acendedor',
    texto: 'O coração do último Fecho em forma de titã: um forno de quatro metros com grelha no peito, martelo-chaminé ao ombro e a primeira chama do mundo queimando lá dentro. Magno não guarda o portão — ele é o portão, e acordou com ciúme do próprio fogo. Apagá-lo seria matar o Fecho; vencê-lo é só lembrá-lo de que a chama foi acesa para alguém. Ele dobrou o joelho, e a grelha do Coração ficou vermelha de novo.' },
  { id: 'chefe-boss-windwright', gancho: { tipo: 'chefe', chefe: 'boss-windwright' },
    titulo: 'Cambota, o Mestre-de-Obras',
    texto: 'O capataz que jamais entregou a obra: um esqueleto de vigas e cordame com uma roldana no lugar da cabeça e um prumo eterno balançando do braço. Cambota constrói o andaime enquanto luta em cima dele, e derruba a ala inteira se isso tirar você do caminho. Mil anos de prazo vencido fizeram dele o único mestre-de-obras que nunca para. Quando caiu, o vento subiu pelo poço como sempre — mas as tábuas, por uma noite, não cantaram.' },
  { id: 'chefe-boss-deepknock', gancho: { tipo: 'chefe', chefe: 'boss-deepknock' },
    titulo: 'Batepedra, o Que Bate Embaixo',
    texto: 'Os mineiros ouviam alguma coisa batendo do outro lado da parede e fingiam que era eco. Não era. Batepedra é maior que a galeria em que está: um torso de rocha-mãe com dois punhos de estéril e nenhum rosto onde procurar intenção. Bate. O mundo responde. Quem o derruba não ganha silêncio — a Lousa segue se acomodando lá em cima —, mas pela primeira vez em mil anos o turno da noite ouviu alguém bater de volta.' },
  { id: 'chefe-boss-riftheart', gancho: { tipo: 'chefe', chefe: 'boss-riftheart' },
    titulo: 'O Coração Partido',
    texto: 'O último Coração do mundo enterrado, rachado em quatro quartos que batem fora de compasso: brasa, água, pedra, ar. Cada batida muda o clima da sala; o que curava você há três rodadas está te matando agora. Ele não guarda Fecho nenhum: ele é o que resta do mundo que a Lousa cobriu. Derrubá-lo não o conserta. Mas quem chega até aqui e volta sabe uma coisa que os povos lá em cima esqueceram — que o Coração ainda bate, e que alguém o ouviu.' },

  // ---- as 21 fusões vencedoras
  { id: 'fusoes', gancho: { tipo: 'fusoes' },
    titulo: 'Dois que viram um',
    texto: 'Sete ofícios descem juntos porque nenhum sobrevive sozinho: o braço que aguenta, a flecha que espera, a runa que queima, a sombra que some, a mão que cura, o espírito que chama, o chifre que avança. A fusão é esse pacto levado ao limite — dois corpos, uma vontade, por uma luta. Quem já venceu com todas as vinte e uma duplas provou o que os construtores suspeitavam ao selar os Fechos: o que a Lousa não apagou foi o que estava junto.' }
];
