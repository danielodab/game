# FICHA DE GERAÇÃO — o elenco de SOTERRA

Escrito em 18/08/2026, quando o elenco passou a ser **gerado**, e não montado a
partir de acervo CC0. Toda a informação de família, elemento e chefe abaixo saiu
de `js/core/data/monsters.js` — não é invenção nem lembrança.

Use como fonte para a imagem de referência de cada monstro.

---

## As regras que fazem o modelo prestar

Cada uma custou um modelo para descobrir:

1. **Uma figura por imagem.** A primeira folha tinha vista frontal, lateral,
   traseira e duas armas; o gerador virou **cinco estátuas** num arquivo só, com
   duas soldadas uma na outra. Recorte a figura antes de gerar.
2. **T-pose, braços abertos.** A conferência é simples: num T-pose correto a
   envergadura mede o mesmo que a altura. Pose de ação não encaixa em esqueleto.
3. **Avulsos ao lado, não na mão.** Arma, escudo e adereço vêm como grupos
   separados e eu isolo cada um. Na mão, viram parte do corpo.
4. **Peça o que for grande já recolhido.** Asa aberta não se dobra depois: tentei
   girar peça por peça e as camadas de pena se descolaram no ar. Asa dobrada
   precisa nascer dobrada, ou esperar o esqueleto.
5. **Peça textura.** O paladino veio com UV e mapa 4096×4096 e ficou pronto; o
   sumô veio sem nada e a cor teve que ser inventada por região geométrica.

### Tamanho — medido em células de 1 metro

| o que | altura | largura que cabe |
| --- | --- | --- |
| herói e monstro comum | 1,80 m | até ~2,0 células |
| chefe | 5,16 a 5,46 m | até 3,7 células |

O paladino saiu com **3,07 células** por causa das asas: um herói de suporte
ocupando quase a faixa de um chefe. É o defeito a evitar.

---

## As sete famílias

São **sete**, não seis: a Estufa tem duas. Gerar um representante por família e
derivar os demais por cor e porte é o mesmo caminho que o elenco antigo usou, e
é o que faz a sala parecer habitada pela mesma coisa.

### Flora Voraz

**A Estufa Soterrada** · clima `chuva` · elementos: agua, terra · 7 monstros

**CHEFE — A Jardineira-Viúva**

> A guardiã da Estufa: um vulto de três metros feito de treliça, luvas de couro e véu de viúva, com uma tesoura de poda enferrujada no lugar das mãos. Ainda cuida do jardim. Você é a erva daninha.

- **Vergasta** — Um chicote vegetal enraizado num vaso rachado, coberto de farpas e flores mortas. Não sai do lugar — não precisa.
- **Bufo-de-Pólen** — Uma bola de pólen amarelo com perninhas de graveto e um sorriso costurado. Anda na sua direção balançando. Isso deveria ser um aviso.
- **Carrapicho-Mãe** — Um novelo de farpas do tamanho de um cão, com dezenas de olhinhos pretos entre os espinhos. Ao morrer, desfia-se em dois novelos menores e igualmente rancorosos.

### Enxame da Estufa

**A Estufa Soterrada** · clima `chuva` · elementos: agua, ar · 2 monstros

- **Vespa-Lustre** — Uma vespa do tamanho de um gato cujo abdômen é uma lanterna de vidro com uma luz presa dentro. Rápida, brilhante, venenosa: chega primeiro e vai embora antes da resposta.
- **Aranha-de-Orvalho** — Uma aranha de pernas finíssimas que anda sobre a água acumulada nas folhas sem afundar um milímetro. Tece com orvalho: as teias brilham, pesam e endurecem.

### Corte Afogada

**A Cisterna dos Afogados** · clima `chuva` · elementos: agua, ar, terra · 9 monstros

**CHEFE — Baronesa Salmoura**

> A dona da cisterna: um vestido de baile do século passado preenchido por água escura e viva, com um colar de pérolas boiando onde deveria haver um pescoço. Recebe visitas puxando-as para perto — e engolindo a sala inteira.

- **Afogadiço** — Um carregador da cisterna que nunca soltou seu lampião. Pele cinza-esverdeada, inchada de água, algas no lugar do cabelo. Morde para beber o calor que perdeu.
- **Moreia-Flauta** — Uma enguia de dois metros cujo crânio perfurado assobia quando ela respira. Ergue-se da água como um ponto de interrogação, cospe jatos em linha reta e fisga presas com a língua-arpão.
- **Água-Viva-Lustre** — Uma água-viva do tamanho de um lustre, flutuando a um palmo do chão, tentáculos como franjas de cristal. Sua luz cura os afogados — apague-a primeiro.

### Prole da Fornalha

**O Fecho de Brasa** · clima `estiagem` · elementos: agua, ar, fogo, neutro, terra · 10 monstros

**CHEFE — Magno, o Acendedor**

> O coração do último Fecho em forma de titã: um forno a lenha de quatro metros com grelha no peito, martelo-chaminé ao ombro e a primeira chama do mundo queimando lá dentro. Ele não guarda o portão. Ele É o portão.

- **Tição** — Um carvão em brasa com braços finos e um sorriso rachado de luz alaranjada. Corre até você rindo. A risada é o estopim.
- **Bigorna Ambulante** — Uma bigorna centenária que criou pernas atarracadas e um rancor proporcional ao número de marteladas que levou. Impossível de empurrar; péssima ideia de deixar chegar perto.
- **Cinzento** — O contorno de um ferreiro antigo desenhado em fuligem suspensa, com dois pontos de brasa no lugar dos olhos. Atira setas de cinza e se desmancha no ar quando ameaçado.

### Coro dos Andaimes

**Os Andaimes do Vento** · clima `vendaval` · elementos: ar, neutro, terra · 10 monstros

**CHEFE — Cambota, o Mestre-de-Obras**

> O capataz que jamais entregou a obra: um esqueleto de vigas e cordame com uma roldana no lugar da cabeça e um prumo eterno balançando do braço. Constrói o andaime enquanto luta em cima dele — e derruba a ala inteira se isso resolver mais rápido.

- **Picanço-de-Tábua** — Um pássaro cinzento de bico curvo que empala o que caça nos pregos expostos das tábuas. Vive nos vãos, desce em queda livre e some antes de você virar a cabeça.
- **Gremlin de Rajada** — Um bichinho de orelhas enormes que usa as próprias orelhas como velas. Não bate para matar: bate para ver a pessoa cair. Tem um senso de humor documentadamente ruim.
- **Enforca-Corda** — Um novelo de cordas de obra amarrado num nó que ninguém consegue desfazer, pendurado na roldana mestra. Não desce nunca. Lança laços e recolhe o que pegou como quem puxa material.

### Turno da Noite

**A Mina Trêmula** · clima `tremor` · elementos: agua, ar, fogo, terra · 10 monstros

**CHEFE — Batepedra, o Que Bate Embaixo**

> A coisa que os mineiros ouviam batendo do outro lado da parede e fingiam ser eco. É maior que a galeria em que está: um torso de rocha-mãe com dois punhos de estéril e nenhum rosto onde procurar intenção. Bate. O mundo responde.

- **Assombro de Picareta** — O turno da noite nunca subiu. Restou o gesto: um mineiro de poeira compactada que ainda bate na mesma parede, no mesmo ritmo, há mil anos. Bate em você com a mesma técnica — procurando onde racha.
- **Fogaréu de Grisu** — Uma chama azul e silenciosa boiando à altura do peito, do tamanho de uma cabeça. É o gás da mina que ganhou vontade. Não persegue: espera você entrar na galeria errada.
- **Bocarra** — Um trecho de galeria que virou bicho: dez metros de túnel com dentes de estalactite e um gosto adquirido por carne com capacete. Fica parada até você achar que é caminho.

### Guarda do Coração

**O Coração Partido** · clima `calmo` · elementos: agua, ar, fogo, neutro, terra · 10 monstros

**CHEFE — O Coração Partido**

> O último Coração do mundo enterrado, rachado em quatro quartos que ainda batem fora de compasso — um de brasa, um d'água, um de pedra, um de ar. Cada batida joga a sala inteira para um clima diferente. Ele não guarda o Fecho: ele É o que sobrou do céu, e está morrendo alto.

- **Arauto de Brasa** — Um dos quatro pedaços do Coração que ganharam corpo. Este é uma armadura vazia com uma fresta acesa no peito, que semeia brasas no chão como quem prepara a casa para visitas.
- **Arauto de Maré** — A mesma armadura, cheia de água escura em movimento. Cura os irmãos e reorganiza o campo com ressacas curtas e certeiras.
- **Arauto de Alicerce** — A armadura preenchida por fundação: pedra, cal e uma teimosia de mil anos. Fica entre você e o resto da sala e considera isso um trabalho honesto.

### Rebanho do Invocador

Invocações do Xamã (não pertence a calabouço) · 8 criaturas

- **Esporinho** — Um cogumelo-bebê com olhos grandes demais e lealdade maior ainda. Morde, envenena e, ao cair, estoura numa nuvem de esporos vingativa.
- **Familiar** — Um bicho pequeno e sem nome que o invocador chama desde o primeiro dia: quatro patas, dentes tortos e uma lealdade que ninguém pediu. Corpo a mais para morder, tancar e negar passagem.
- **Cão de Brasa** — Um cão de carvão aceso, magro e rápido, com uma costura de fogo correndo do focinho ao rabo. Morde quente e, quando cai, devolve a última brasa em quem estiver por perto.
