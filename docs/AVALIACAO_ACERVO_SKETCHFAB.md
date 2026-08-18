# AVALIAÇÃO — os 15 links do Sketchfab

Data: 2026-08-18. Toda licença aqui foi **lida da fonte**, nunca deduzida do
botão de download nem do estilo do modelo.

A regra que decide: **este repositório versiona e redistribui os modelos** (hoje
embutidos em base64 em `assets/embedded/`, na Unity como arquivo em
`Assets/`). Então não basta "poder usar num jogo" — a licença precisa permitir
**redistribuir o arquivo**. O usuário confirmou nesta sessão: **só CC0, ou o que
for livre e redistribuível.**

O que já foi decidido antes e **não** se repete aqui:
[`PROPOSTA_MODELOS.md`](PROPOSTA_MODELOS.md) §II.1 já reprovou Mixamo ("licença
Adobe não permite redistribuir o asset"), KayKit Mystery Monthly (pago) e os
avulsos de Sketchfab ("cada um com rig próprio"); §II.3 fixou as quatro amarras
técnicas (banco único de animação, nomes de osso, peças separáveis, fusão).
Nada nos 15 links altera aquilo.

---

## 0. Como estes dados foram lidos (importa, porque muda a confiança)

As páginas do Sketchfab são aplicação de página única atrás de mitigação de bot:
`curl` e busca de texto simples devolvem **HTTP 202 com corpo vazio**. Duas
fontes foram usadas, e as duas concordam em todos os 15 casos:

1. **API pública v3** (`api.sketchfab.com/v3/models/<uid>`) — é a mesma origem
   que a página consome; devolve `license`, `isDownloadable`, `price`,
   `animationCount`, `faceCount`, `vertexCount`.
2. **A página renderizada de verdade**, aberta no navegador e lida do DOM —
   para conferir se existe linha "License:" e botão "Download 3D Model".

**Sem login em conta nenhuma. Nenhum arquivo baixado.**

### A descoberta que resolve o problema de leitura

No Sketchfab, **a linha "License" só existe quando o modelo é baixável**. Medi
isso em vez de supor: numa busca de 12 resultados não-baixáveis, **nenhum**
trazia licença CC (só vazio ou licença de loja); numa busca de 8 baixáveis,
**todos os 8** traziam licença CC declarada.

Consequência prática, e é ela que fecha 13 dos 15 links:

> **Modelo que não oferece download não concede licença nenhuma.** Não é
> "licença desconhecida" nem "provavelmente dá" — é vitrine. O autor publicou
> para ser visto no visualizador 3D, e não deu permissão de uso.

Nesses casos a coluna de licença abaixo diz **"nenhuma declarada — modelo só de
visualização"**. Isso é fato observado na página, não presunção.

### A armadilha em que quase se cai

Nenhum destes 15 é CC0. Nenhum. O título da aba do navegador denuncia o tipo
antes de qualquer clique — Sketchfab escreve `"… - Download Free 3D model by …"`
quando há download e `"… - 3D model by …"` quando não há. **Catorze dos quinze
links têm o título sem "Download Free".**

---

## 1. Tabela-veredito

Ordenada por utilidade para o projeto (o que resolveria mais primeiro), não por
nota. Contagem de triângulos e de animação vêm da API; nenhum número foi
estimado.

| # | nome | autor | licença exata (transcrita) | redistribuível? | animado? | formato | serviria para | veredito |
|---|---|---|---|---|---|---|---|---|
| 10 | Stylized Fantasy Prop Pack Hand Painted Low Poly | Sami Ullah (@mascotboy) | **"CC Attribution / Creative Commons Attribution"** — `creativecommons.org/licenses/by/4.0/`, "Author must be credited. Commercial use is allowed." | **SIM**, com crédito obrigatório | não (0 clipes) | não informado (a lista só aparece no diálogo de download) | 5 props de mapa: machado, maça, lanterna, cogumelos, barril | **USAR** |
| 2 | Hero Series - Adventurers | Downrain DC (@downraindc3d) | **nenhuma declarada — modelo só de visualização** (sem linha "License", sem botão de download). Marcado **NoAI** | **NÃO** | não (0) | nenhum oferecido | cobriria as 6 classes (§3 de SISTEMAS) | **REPROVADO** |
| 6 | Cartoon Characters - Evolution Mega Pack | notfun (@notfun) | **nenhuma declarada — modelo só de visualização** | **NÃO** | 1 clipe (Idle) | nenhum oferecido | 9 monstros × 3 formas = 27 corpos, e o degrau 3 serve de chefe | **REPROVADO** |
| 4 | SD RPG Monsters - Volume01 | wasabisnow | **nenhuma declarada — modelo só de visualização** | **NÃO** | não (0) | nenhum oferecido | monstros comuns | **REPROVADO** |
| 12 | coleção "Tokens" (209 modelos) | curadoria de lukalockstreams (**publica 0 modelos próprios**) | 186 autores diferentes, 6 licenças diferentes — detalhe em §4 | **31 de 207**, todos CC-BY; **zero CC0** | 9 dos 31 | variado | garimpo avulso, não fonte | **REPROVADO como fonte** |
| 8 | Cartoon Characters - Evolution Pack vol.2 | notfun (@notfun) | **nenhuma declarada — modelo só de visualização** | **NÃO** | 1 clipe (Idle) | nenhum oferecido | 3 monstros × 3 formas (subconjunto do #6) | **REPROVADO** |
| 9 | Cartoon Characters - Evolution Pack vol.3 | notfun (@notfun) | **nenhuma declarada — modelo só de visualização** | **NÃO** | 1 clipe (Idle) | nenhum oferecido | 3 monstros × 3 formas (subconjunto do #6) | **REPROVADO** |
| 7 | Stylized Weapons Pack - Cartoon Assets | Toyamon-Studio | **nenhuma declarada — modelo só de visualização**. A descrição diz, verbatim: "Available on unity store, gumroad, artstation store, itch io, fab, cgtrader" | **NÃO** pelo Sketchfab; fora dele, não verifiquei | não (0) | nenhum oferecido | 20 armas com pivô no punho | **CONFIRMAR** |
| 3 | Fantasy Weapons Pack | GamePoly (@triix3d) | registro de loja: **"Standard"** — "Under basic restrictions, use worldwide, on all types of media, commercially or not, and in all types of derivative works". Preço 1500 (**US$ 15,00**) | **NÃO** (licença de compra, não de redistribuição) | não (0) | nenhum oferecido | 37 armas: 15 espadas, 7 adagas, 6 machados, 5 escudos | **PAGO** |
| 13 | Skeletons | cattleya | registro de loja: **"Editorial"** — "Use only in connection with events that are newsworthy or of public interest". Preço 1500 (**US$ 15,00**) | **NÃO** — "Editorial" nem em jogo entra | **sim, 12 clipes** | `.fbx` (dito na descrição) | esqueletos arqueiro e guerreiro | **PAGO** |
| 1 | stylized mushrooms bundle (PBR) | Jakob Klooth (@JakobKlo) | **nenhuma declarada — modelo só de visualização** | **NÃO** | não (0) | nenhum oferecido | props de cenário da Estufa | **REPROVADO** |
| 11 | Harpooner_pose | unicornwaystudio | **nenhuma declarada — modelo só de visualização** | **NÃO** | não (0) | nenhum oferecido | seria padrão de personagem | **REPROVADO** |
| 14 | Varangian | Splodeman | **nenhuma declarada — modelo só de visualização** | **NÃO** | 2 clipes | nenhum oferecido | guerreiro humano avulso | **REPROVADO** |
| 15 | Foxboy | Sasha Forman | **nenhuma declarada — modelo só de visualização** | **NÃO** | não (0) | nenhum oferecido | classe animal (o Ecaflip que o acervo não tem) | **REPROVADO** |
| 5 | The Librarian - Stylized Character (Kisekimura) | P3D (@PelpesElSabio) | **nenhuma declarada — modelo só de visualização** | **NÃO** | não (0) | nenhum oferecido | chefe avulso | **REPROVADO** |

**Contagem de triângulos, para referência** (da API, número cheio): #10 18.234 ·
#2 42.385 · #6 61.753 · #4 6.760 · #8 15.890 · #9 20.301 · #7 9.420 · #3 19.754
· #13 6.504 · #1 8.840 · #11 13.306 · #14 7.150 · #15 12.658 · #5 4.744.

### O número que resume tudo

**1 de 15 é redistribuível.** É o #10, e ele exige crédito. **Nenhum é CC0.**

Se contar a coleção #12 por dentro, entram mais 31 modelos CC-BY avulsos — mas
são 31 modelos de 31 autores diferentes, não um pacote.

---

## 2. Os aprovados e os duvidosos, um a um

### #10 — Stylized Fantasy Prop Pack (Sami Ullah) — **USAR**

É o único com licença de verdade: CC Attribution 4.0, botão de download aberto,
39 downloads registrados. Redistribuir é permitido; o preço é uma linha em
[`CREDITS_3D.md`](CREDITS_3D.md), que o projeto já paga para todo mundo.

**O que ele resolve que o acervo não resolve: quase nada.** São 5 peças — machado
de batalha, maça de espinhos, lanterna, cacho de cogumelos, barril. O KayKit
Dungeon Remastered já entrega 49 peças de cenário, **incluindo barril**, e as
armas do KayKit já vêm no pacote de personagens. A lanterna e o cacho de
cogumelos são os dois itens genuinamente novos, e o cogumelo serviria à Estufa
Soterrada.

**O que ele cobra em troca:** estilo. É textura **pintada à mão** — sombra e
volume desenhados dentro do mapa — contra a **cor chapada** do KayKit e do
Quaternius. Numa cena iluminada pela URP, o prop pintado chega com sombra
própria e briga com a sombra que a luz projeta. E são 18.234 triângulos para 5
objetos: ~3,6 mil por peça, contra barris KayKit de algumas centenas. Para um
barril que já existe, é caro em polígono e errado em linguagem.

**Recomendação honesta:** aproveitar **a lanterna e o cacho de cogumelos**, e
só se alguém aceitar repintar as texturas em cor chapada. Se ninguém for
repintar, não vale — o crédito e o descasamento custam mais do que dois props.

### #7 — Stylized Weapons Pack (Toyamon-Studio) — **CONFIRMAR**

Reprovado como link do Sketchfab: nenhuma licença, nenhum download. Mas é **o
único dos 15 cujo autor diz onde mais o pacote existe**, e disse com todas as
letras na descrição: "Available on unity store, gumroad, artstation store, itch
io, fab, cgtrader". Então há um endereço concreto para checar, e não um palpite.

**O que resolveria:** 20 armas com "all pivot points aligned to the handle
grips" — pivô no punho é exatamente o que a fusão precisa, porque `fusionLook()`
acopla a arma-assinatura a um osso da mão. Cobre corpo a corpo, à distância
(arco, besta, aljava) e magia (cajados, varinha, grimório) — a tabela "o que
cada uma veste" de [`SISTEMAS.md`](SISTEMAS.md) §3 inteira, com uma exceção.

**O que cobra:** textura pintada à mão em 2k, de novo contra a cor chapada do
acervo. E, sobretudo, **a probabilidade é alta de que em qualquer dessas lojas a
licença seja de uso, não de redistribuição** — que é o mesmo muro em que a Asset
Store e a Fab já bateram em `PROPOSTA_MODELOS.md`. Não afirmo isso: **não
verifiquei**, e por isso o veredito é CONFIRMAR e não REPROVADO.

**Antes de gastar esse tempo, vale lembrar:** o KayKit Adventurers **já traz as
armas em CC0** e no mesmo estilo do elenco. A pendência registrada em
`CREDITS_3D.md` §7 é só embutir `Skeleton_Blade/Axe/Staff/Crossbow/Shield_*`.
Isso é trabalho de meia hora com o `glbtool.py` que já existe, custa zero em
licença e casa perfeito. **É melhor negócio que investigar o #7.**

### #3 e #13 — os dois de loja — **PAGO**

Os dois carregam registro da antiga Sketchfab Store: preço 1500 (US$ 15,00) e
licença de loja. **Hoje a página não mostra mais botão de compra nenhum** — só o
registro na API sobreviveu. Ou seja: além de não serem redistribuíveis, agora
provavelmente nem compráveis por ali.

O #13 é o pior caso e merece ser dito em voz alta: a licença declarada é
**"Editorial"**, cujo requisito é "Use only in connection with events that are
newsworthy or of public interest". Isso **proíbe uso em jogo**, comprado ou não.
Um esqueleto de arqueiro com 12 animações é tentador, mas está fora por dois
motivos independentes.

O #3 é "Standard", que permite obra derivada mas é licença de **compra por
projeto** — nada nela autoriza subir o `.fbx` num repositório público. **Não
consegui transcrever o texto integral** dessas licenças: `sketchfab.com/licenses`
devolve página vazia à leitura automática. O que está entre aspas acima é a
string de requisito declarada na própria API, verbatim.

E os dois são redundantes: as armas o KayKit já dá, e os **esqueletos o projeto
já tem em CC0** — `Skeleton_Warrior`, `Skeleton_Rogue`, `Skeleton_Mage`,
`Skeleton_Minion`, todos no rig de 41 ossos com o banco de 30 animações já
embutido. Pagar US$ 15 por um esqueleto pior licenciado é regressão.

### #2 — Hero Series - Adventurers — a pergunta direta do usuário

**Não, não podemos usar.** A página não tem linha de licença, não tem botão de
download e ainda carrega a marca **NoAI** ("This model may not be used in
datasets for, in the development of, or as inputs to generative AI programs").
Não há arquivo para pegar e não há permissão concedida. É vitrine de portfólio —
o autor vende pacotes por fora.

Dói dizer, porque **seria o melhor achado dos 15**: é chibi de cabeça grande,
cobre guerreiro, mago, arqueiro, espadachim, assassino e clérigo — as **seis
classes** de `SISTEMAS.md` §3 de uma vez — e é o único do lote que cairia ao lado
do KayKit sem ninguém notar a costura. Utilidade máxima, licença zero.

### #6, #8 e #9 — os "Evolution" da notfun — o usuário duvidou do estilo

**A dúvida do usuário está invertida: são os que MELHOR combinam com o acervo.**
A descrição entrega o motivo técnico, verbatim: "1 gradient base texture 32x32
pixels", "No Vertex colors", "Low Poly", "Standart/URP materials". Textura de
gradiente de 32×32 pixels **é** a linguagem de cor chapada do Quaternius e do
KayKit — é o oposto do pintado à mão. Riggados, com URP, e a decisão de fase 3
do [`PLANO_UNITY.md`](PLANO_UNITY.md) pede exatamente material fosco com cor
lida, não brilho.

E resolveriam o buraco maior do acervo. `CREDITS_3D.md` §7 confessa que os 66
monstros hoje são esqueletos KayKit e bichos Quaternius **variando por tinta e
porte**, e que a Flora Voraz usa "serpente/aranha/sapo tingidos de verde — é o
que existe em CC0". O #6 traz 9 criaturas × 3 estágios = 27 corpos distintos,
com o terceiro estágio maior servindo de chefe — encaixe direto na exigência de
`SISTEMAS.md` §6 de que "os chefes têm de ser maiores que qualquer herói".

**O que cobram:** 1 clipe de animação só (Idle) nos três pacotes. O projeto
precisa de andar, atacar, apanhar e morrer. Isso seria contornável — a §II.3
já provou que dá para reaproveitar banco de animação entre espécies de mesma
pose de bind — mas é trabalho, não presente.

**Nada disso importa, porque não há licença.** Os três são vitrine: sem linha
"License", sem download, sem preço. O veredito de estilo fica registrado só para
o dia em que alguém procurar um pacote CC0 com essas características —
**é este o perfil a procurar.**

### #12 — a coleção "Tokens" — avaliação do criador como fonte

**Não é fonte. É prancha de referência.** O dono, `lukalockstreams`, tem
**0 modelos publicados** e 450 coleções — não é autor, é curador. Os 209 modelos
declarados são de **186 autores diferentes**. Enumerei 207 pela API; os 2 que
faltam são conteúdo restrito, e a própria página avisa: "Restricted models in
this collection are not displayed".

A quebra por licença dos 207:

| licença | quantos |
|---|---|
| nenhuma declarada (só visualização) | 133 |
| Standard (loja, pago) | 34 |
| **CC Attribution** | **31** |
| Editorial (loja, pago) | 4 |
| CC Attribution-NonCommercial | 4 |
| CC Attribution-NonCommercial-ShareAlike | 1 |
| **CC0** | **0** |

Os **31 redistribuíveis** (CC-BY, baixáveis) — nome, autor, animações, triângulos:

Bulky Knight (@OptiCube, 0, 60.190) · Tentacle Event Super Showdown - Fortnite
(@GatoBugadoBR, 44, 40.888) · Deep One (@coremort, 0, 4.316) · The Hooded
Wanderer (@Ikk1, 0, 10.000) · FREE Magical Assassin (@Axinovium, 0, 30.000) ·
Skeleton animated (@danielmclogan, 1, 6.821) · "Epic armor-clad fish warrior"
(@klrxyz, 0, 1.834) · Naga (@lktung611, 1, 19.464) · Celtic Chieftain
(@Andywoodhead, 0, 1.623.535) · Halfling Monk (@andreja-ck, 0, 21.666) · Elven
Archer (@jakatoa, 0, 324.456) · Сrash-test dummy (@evgenytvidov, 0, 12.458) ·
Swamp Witch (@Blue-Spirit, 0, 105.202) · FREE Battlemage Wizard (@Axinovium, 0,
29.999) · Old Wizard (@XiaoBuBu80, 0, 57.188) · Modron DuoDrone (@np-dev, 0,
510.330) · Modron Quadrone (@np-dev, 0, 783.040) · Clockwork Warriors Group 2
(@np-dev, 0, 709.816) · DesertGirl_Low (@ulbabrab94, 0, 66.037) · Porcelain
(@JohnMesplay, 0, 84.118) · WARRIOR WOMAN FREE MODEL (@oscar_creativo, 1,
373.839) · JUMPSUIT Low Poly (@1799danly, 0, 26.870) · Robot Walk Cycle
(@rukh3d, 1, 48.450) · Bangalore Apex Legends (@hasanraza0077, 0, 63.252) ·
Alleyana (@Vasian-Digital3D, 1, 48.291) · Robot Explorer (@artygalop, 1,
105.653) · Amahle (@Vasian-Digital3D, 1, 25.792) · vampire huntress posed
(@BourgoignieDavid, 0, 27.360) · WOMAN POSING GUIDE (@DEPERIERS, 0, 774.936) ·
Treeman (@bumstrum, 1, 8.616) · Pumpkin Reaper (@sodsender, 0, 487.646).

**Por que isso não vira elenco**, mesmo com 31 licenças boas:

- **Só 9 dos 31 têm alguma animação**, e a maioria tem 1 clipe. Amarra 1 reprova.
- **Cada um tem rig próprio.** É exatamente o que `PROPOSTA_MODELOS.md` §II.1 já
  registrou sobre avulsos de Sketchfab: "cada um com rig próprio, o que daria 6
  bancos de animação e 15 fusões atravessando 6 convenções". Amarras 1 e 2
  reprovam.
- **Só 13 dos 31 ficam abaixo de 30 mil triângulos.** Tem peça de 1,6 milhão e de
  3,7 milhões — são miniaturas de impressão 3D e fotogrametria, não asset de
  jogo. O orçamento embutido do projeto é 25 MB (`CREDITS_3D.md` §6) e hoje usa
  15,7 MB.
- **Dois são fan art de propriedade alheia** (Fortnite, Apex Legends). Licença
  CC do autor não limpa a marca de terceiro. Ficam fora por si.
- **Zero coerência de estilo entre eles.** Ver §3.

Como prancha de humor visual, a coleção é ótima e mostra bem o gosto do usuário:
tokens de mesa, monstro aquático, esqueleto, naga, mago. **Como acervo, é
inaproveitável.** O único que eu olharia com carinho é **Treeman** (@bumstrum,
CC-BY, 8.616 triângulos, 1 animação) — 8 mil triângulos e animado é a única
linha da lista que passa nas amarras técnicas, e um ent resolveria a Flora Voraz
da Estufa melhor do que a "serpente tingida de verde" que está lá hoje.

---

## 3. O que combina com o quê

Isto pesa tanto quanto a licença. O acervo de hoje é **KayKit + Quaternius**:
low-poly, chibi, **cor chapada**, sem PBR, alguns milhares de triângulos por
personagem. Toda a decisão da fase 3 do `PLANO_UNITY.md` se apoia nisso —
"material fosco (metálico 0, brilho 0)", "cor lida, não brilho". Textura que já
traz sombra pintada dentro dela luta contra essa decisão, não colabora com ela.

Os 15 se separam em **três escolas que não conversam**:

### Escola A — chibi de cor chapada (é a do jogo)

**#2 Hero Series · #6, #8, #9 Evolution · #4 SD RPG Monsters.**

Cinco links. Caem ao lado do KayKit sem retoque: proporção de cabeça grande,
paleta chapada, poucos milhares de triângulos por corpo. O #6 é o mais próximo
tecnicamente (gradiente de 32×32 pixels é literalmente a mesma técnica do
Quaternius); o #2 é o mais próximo visualmente.

**Redistribuíveis nesta escola: 0 de 5.**

### Escola B — pintado à mão, proporção quase realista (é outro jogo)

**#10 Prop Pack · #7 Stylized Weapons · #3 Fantasy Weapons · #13 Skeletons ·
#11 Harpooner · #14 Varangian · #15 Foxboy · #1 Mushrooms (PBR).**

Oito links. É a escola *World of Warcraft* / *Torchlight*: sombra e volume
desenhados na textura, silhueta de adulto e não de boneco, mapas de 1k a 4k. São
bonitos — o Varangian é trabalho de estúdio de verdade, o Foxboy tem o carisma
que o elenco atual não tem. E **nenhum deles cabe ao lado de um bárbaro KayKit**:
lado a lado, um parece maquete e o outro parece ilustração.

**Redistribuível nesta escola: 1 de 8** — o #10, e são 5 props.

### Escola C — anime

**#5 The Librarian.** Sozinho. Proporção anime, vindo de um RPG adulto de
terceiros. Não conversa nem com A nem com B.

### Escola D — a coleção #12

Nem é escola. Dos 207 modelos convivem token de mesa, fotogrametria de pessoa
real, fan art de Fortnite, miniatura de impressão 3D de 1,6 milhão de
triângulos e robô geométrico. **Não existe recorte coerente dentro dela.**

### A resposta franca

**Nenhum conjunto coerente sai destes 15 links.** Não porque o gosto seja ruim,
mas porque a escola que combina (A) não tem licença nenhuma, e a escola que tem
a única licença (B) não combina.

**E se o jogo INTEIRO mudasse de estilo?** Vale responder, porque a pergunta é
legítima. O novo estilo seria **"pintado à mão, proporção heroica"** — a linha
*Torchlight* / *Warcraft 3*: mapa de difusa desenhado com luz embutida, sem PBR,
personagem adulto de 7 cabeças em vez do chibi de 3.

Nesse mundo, **8 dos 15 sobreviveriam** (a Escola B inteira). Só que:

1. **A conta de licença não melhora — piora em proporção.** Continuariam sendo
   1 usável em 8. Trocar de estilo para poder usar 5 props é absurdo.
2. **O acervo inteiro seria jogado fora.** KayKit e Quaternius são cor chapada:
   personagens, os 4 esqueletos, as 12 criaturas e as 49 peças de cenário. São
   ~15,7 MB embutidos e o único banco de animação que o jogo tem.
3. **A fusão morre.** Toda a receita de `PROPOSTA_MODELOS.md` §II.3 — recortar
   malha por peso de osso, transplantar cabeça, acoplar arma no punho — depende
   de **pose de bind idêntica entre os modelos**. Isso é propriedade de um
   pacote coeso, não de oito modelos de oito autores.
4. **A leitura a 40 px se perde.** §II.3 mediu: no tabuleiro, "quem carrega a
   identificação é a PALETA da classe, e a forma confirma no retrato". Textura
   pintada à mão vira ruído nesse tamanho; cor chapada continua legível. **A
   escola A não é só o que existe — é o que funciona no tamanho em que o jogo é
   visto.**

**Não mude o estilo.** Não por estes 15.

---

## 4. O que fazer em vez disso

Sai desta avaliação uma lista curta, e nenhuma linha dela depende de licença
nova:

1. **Embutir as armas KayKit que já são CC0.** `CREDITS_3D.md` §7 já registra a
   pendência: `Skeleton_Blade/Axe/Staff/Crossbow/Shield_*` vêm em `.gltf`+`.bin`
   e ainda não foram embutidos, e por isso as listas `show` das famílias
   humanoides "ainda não têm efeito". Isso resolve o mesmo que os links #3 e #7
   prometiam, de graça, no estilo certo. **É o passo de melhor retorno do
   documento inteiro.**
2. **Se quiser um ent para a Flora Voraz**, o único candidato tecnicamente viável
   destes 15 links é o Treeman de @bumstrum, dentro da coleção #12 — CC-BY,
   8.616 triângulos, 1 animação. Modelo avulso com rig próprio, então entra como
   decoração animada, não como monstro de bestiário.
3. **Se quiser mais monstros de verdade**, o perfil a procurar está descrito em
   §2 (#6): pacote coeso, low-poly, textura de gradiente pequena, riggado, um só
   esqueleto para todo o pacote — **e CC0**. `PROPOSTA_MODELOS.md` §II.2 já achou
   um que atende: o **Quaternius Ultimate Monsters**, 14 espécies bípedes no
   mesmo rig de 43 ossos, CC0 com licença transcrita da fonte. Essa proposta está
   pendente de decisão do usuário, e **ela responde ao mesmo desejo que os 15
   links tentaram responder**.

---

## 5. O que não consegui confirmar, e por quê

Registro para não passar por certeza o que é limite de método:

- **O texto integral das licenças de loja "Standard" e "Editorial".**
  `sketchfab.com/licenses` devolve página vazia à leitura automática. Usei a
  string de requisito da própria API, transcrita entre aspas. A leitura de que
  licença de compra não cobre redistribuição em repositório público é **conclusão
  minha por analogia** com Mixamo/Asset Store/Fab (`PROPOSTA_MODELOS.md` §II.1),
  não citação do contrato.
- **Formatos de arquivo de qualquer um dos 15.** A lista de formatos só aparece
  no diálogo de download, que exige login — e **não faço login em conta nenhuma**
  (`PLANO_UNITY.md`, "Limites que não mudam"). A única exceção é o #13, cuja
  descrição diz `.fbx` em texto.
- **A licença do pacote #7 fora do Sketchfab** (Unity Store, Gumroad, ArtStation,
  itch.io, Fab, CGTrader). Não visitei essas lojas. É o único CONFIRMAR da
  tabela.
- **2 dos 209 modelos da coleção #12** não aparecem na enumeração: são conteúdo
  restrito, e a página declara que não os exibe.
- **Contagem de modelos por pacote** nos casos em que a página não diz. Onde a
  descrição do autor dá número (#3: 37 armas; #7: 20 armas; #6: 9 criaturas × 3
  formas; #10: 5 peças), o número é dele e está transcrito. Onde não dá (#2, #4),
  **não contei** — só existe uma foto do visualizador, e contar boneco em imagem
  seria chute.

Nenhuma licença foi presumida. Onde não havia licença, escrevi que não havia —
que é coisa diferente de "não achei".
