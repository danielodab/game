# O Santuário dos Elementos

O calabouço especial de 03/10 (id `elementsanctum`). O pedido do dono: "um mapa dos elementos;
uma parte escura que só consegue ver quem é de inteligência [o caminho do Fogo]; e outras ideias
para os outros elementos, algo que mude no mapa relacionado a elementos".

Cinco salas, sem chefe e sem armadilha. As quatro primeiras são um quadrante cada, com **uma**
regra de terreno e os dois guardiões dele; a quinta junta os quatro quadrantes em volta do altar,
com os oito guardiões misturados.

| sala | regra | guardiões |
|---|---|---|
| 1 · A Câmara Apagada (Fogo) | escuro: quem não é do caminho do Fogo só vê e só mira uma casa escura a 2 casas; braseiro aceso clareia 2 casas em volta; golpe de Fogo acende, de Água apaga | Vigia de Pavio (`el_fogo_1`, de longe, enxerga no escuro) · Mariposa de Cinza (`el_fogo_2`, de perto, rápida) |
| 2 · A Galeria Alagada (Água) | entrar em casa alagada custa 2 PP (1 para quem é de Água); no fim da rodada a correnteza leva 1 casa quem está na água, para onde a bica que verte aponta; a ponte é seca | Caramujo-Comporta (`el_agua_1`, tanque) · Garça de Galeria (`el_agua_2`, de longe) |
| 3 · O Salão dos Pilares Vivos (Terra) | os pilares sobem e descem a cada 2 rodadas, com aviso uma rodada antes; nunca esmagam e nunca fecham o único caminho | Pilarete (`el_terra_1`, tanque, não é empurrado) · Toupeira-Sentinela (`el_terra_2`, de perto) |
| 4 · O Terraço da Ventania (Ar) | no fim da rodada a rajada empurra todo mundo 1 casa para onde o cata-vento aponta; gira a cada 2 rodadas; feitiço de Ar alcança +1; ao lado de um respiro o vento não pega | Cata-Vento (`el_ar_1`, de longe, empurra) · Arraia de Rajada (`el_ar_2`, de perto) |
| 5 · O Altar dos Quatro | as quatro de uma vez, cada uma no seu canto: escuro a noroeste, água a nordeste, pilares a sudoeste, vento a sudeste | os oito |

## Onde mora cada coisa

- **O dado** — `js/core/data/santuario.js`: os números das regras (`DATA.santuario`), o calabouço
  (`DATA.especiais`) e as cinco salas. Cada sala tem o `layout` de sempre e um `santuario.mapa`, a
  máscara do mesmo tamanho que diz o que cada casa é para a regra (braseiro, água, ponte, bica,
  pilar, respiro, cata-vento, altar), mais as zonas do escuro e do vento. O arquivo explica por que
  o Santuário **não** mora em `DATA.dungeons`: quem lê aquela lista trata o que acha como um dos
  seis portais (a praça, o Poço, a Arena, o Calabouço do Dia, a régua das três salas com chefe).
  Quem precisa achá-lo pelo id usa `DATA.calabouco(id)`.
- **A regra** — `js/core/santuario.js` (`Santuario.regras`). O motor só a chama, e só quando a sala
  tem `state.santuario` — o mesmo desenho do chão do Poço. Nada ali sorteia: tudo o que muda sai da
  rodada, então o juiz refaz a sala e chega ao mesmo hash.
- **Os guardiões** — `js/core/data/monsters.js` (o fim do arquivo), na faixa `elementsanctum` da
  régua de vida e poder.
- **O desenho** — `js/render3d/santuario3d.js`: o breu e a luz dos braseiros, a lâmina d'água e os
  veios da correnteza, os blocos dos pilares com a seta do aviso, as setas do vento, o cata-vento.
- **A porta e os textos** — `js/ui/hud.js` (a ficha `santuario`, a linha da sala na batalha, a
  porta da antessala) e `js/ui/tutor.js` (o cartão da primeira visita de cada sala). As frases das
  regras estão num lugar só (`SANT_REGRA`) e leem os números do dado.

## O relógio (o mesmo para as três regras que mudam o mapa)

Tudo troca no **começo das rodadas ímpares a partir da 3ª** (3, 5, 7…), e o aviso sai no começo da
rodada anterior: os pilares que vão trocar piscam com ▲ ou ▼, a bica que vai verter ganha um
sinal, o cata-vento mostra a seta-fantasma da próxima direção e a pílula da sala pulsa. A
correnteza e a rajada agem no **fim** de cada rodada, na direção que a tela mostra desde o começo
dela. A rodada 1 nunca tem troca.

## As decisões desta frente

- **O pilar espera.** Com alguém em cima do soquete o pilar não sobe: espera e tenta de novo a
  cada começo de rodada. Deslocar à força tiraria a casa de quem está preso por raiz ou fixação e
  cobraria um dano que ninguém escolheu; esperar não fere ninguém e vira jogada (segurar um soquete
  mantém a passagem aberta).
- **Quem enxerga no escuro**: no grupo, quem é do caminho do Fogo (herói, fusão, bicho ou
  invocação de Fogo); entre os monstros, só o Vigia de Pavio. Um vê por todos do lado dele. Os
  monstros não ficam cegos para o grupo (conhecem a casa), mas **miram com a mesma régua**: fora o
  Vigia, só acertam de longe quem está na luz. O golpe que sai do breu aparece na tela — o que some
  é o corpo de quem está lá.
- **O empurrão do mapa não fere** e não joga ninguém em buraco, em parede nem em cima de outro: se
  a casa de destino não é chão livre, a unidade fica. Não mexe em quem é imune a empurrão (o
  Pilarete) nem em corpo grande.
- **A entrada de toda sala fica fora de toda regra**: ninguém nasce no escuro, na água nem no vento.
- **O saque é o do Coração Partido** (`saqueDe`): as quatro salas de quadrante sorteiam como a
  última sala comum de lá; o Altar, como a do chefe (dois sorteios, com épica e lendária). O que o
  Santuário paga a mais é **pedra do elemento de cada quadrante** (cada guardião, 75%, 2 a 5). Sem
  chefe não há selo, insígnia, âncora nem carta.
- **A porta é a oitava do cais** (como a do Eco: a praça não ganhou portal). No celular o cais
  virou duas fileiras de quatro.
- **Em dupla e em grupo pela Rede vale**, pelo mesmo caminho dos seis calabouços (a sala em grupo
  do servidor aceita o id; a prova de API abre e paga uma).

## O servidor

O juiz carrega os dois arquivos (`servidor/juiz/motor.js`) e anuncia `elementsanctum: 5` em
`GET /regras`. `Engine.VERSAO_REGRAS` subiu para **7**: sala aberta numa página antiga é recusada
na abertura, como em toda subida (`tests/regras_versao_api.py`).

## A dificuldade, medida

Nível recomendado 30. A régua foi a do Coração Partido: a dupla de nível 30 **sem item**, jogada
pela IA no normal, tira 44%, 84% e 26% da vida das três salas de lá. No Santuário tira 57% (Fogo),
50% (Água), 60% (Terra), 52% (Ar) e 27% (Altar). É conta de ponto de partida: mudar um número de
`DATA.santuario` ou a vida de um guardião muda o fim de uma sala refeita e pede outra subida de
`Engine.VERSAO_REGRAS`.

## A arte

Os modelos dos guardiões (chaves `el-fogo-1` … `el-ar-2`) e o kit do cenário (tema `santuario`,
`JOGO.CENARIO['santuario']`, peças `el_*`) entram por outras frentes. Sem eles o jogo roda: cada
guardião veste um corpo provisório do mesmo elemento (`M.CORPO_PROVISORIO`, só enquanto a chave
própria não tem kit), o tema cai no kit do Coração Partido (`temaReserva`) e as peças de mecânica
saem em primitiva. Quando a arte chega nada precisa ser religado: a chave própria vence o
provisório, e o `santuario3d.js` troca a primitiva pela peça `el_braseiro`, `el_bica`,
`el_ponte`, `el_soquete`, `el_pilar_vivo`, `el_respiro`, `el_cata_vento` e `el_marco_altar`.

## As provas

- `node tests/santuario_regras.js` — cada regra, o aviso antes do efeito, o caminho que sempre
  existe, a IA que não fica presa, o determinismo, o juiz no mesmo hash, o saque e a paga.
- `python tests/santuario_api.py` — o juiz e a API de verdade: o bilhete nas cinco salas, a sala
  vencida paga no estado do servidor, o lance adulterado, a sala em grupo.
- `python tests/santuario_navegador.py` (pela vez do Chrome) — `tests/santuario_tela.html` (as
  cinco salas no renderizador, contando o que foi desenhado) e `tests/santuario_jogo.html` (o
  `index.html` inteiro: a porta, a ficha, a descida, o cartão da regra, a recompensa), em janela de
  mesa e de celular.
- `tests/validate_world.html` §10 e `node tests/visao_mapas.js` cobram as cinco salas nas réguas de
  mapa dos seis calabouços (as salas com pilar, nas duas posições).
