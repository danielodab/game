# Receber o lote de um portal fechado (monstros, cenário, arte)

> **21/09 — não há mais portal fechado, e o último lote entrou inteiro.** Os
> seis abriram: Estufa, Cisterna, **Fecho de Brasa** (19/09), **Andaimes do
> Vento** (noite de 19/09), **Mina Trêmula** (21/09 de manhã) e **Coração
> Partido** (21/09 de noite). `JOGO.DATA.portaisFechados` está VAZIA e cada
> calabouço solta só as peças dele — o vazamento acabou junto. O Coração
> também já tem o **catálogo de cenário** (`JOGO.CENARIO['heart']`, em
> `assets/embedded/cenario-coracao.js`) e as três salas dele foram
> redesenhadas para serem o mapa mais duro do jogo.
>
> Este documento deixou de ser lista de pendências e virou o **caminho para o
> próximo calabouço**: o que entrar depois nasce trancado e sai daqui pelo
> mesmo passo a passo. O que os seis lotes ensinaram está no fim, em *O que os
> seis lotes ensinaram*.

> **03/10 — lote que NÃO é de calabouço** (os Colossos do Poço, o Eco
> Primordial e os Ecos Menores, pedidos em `docs/PROMPTS_LANCAMENTO.md`): o
> passo 1 abaixo não serve, porque o `--manifesto` acha os monstros pelo
> `dungeonId` em `monsters.js`, e os Colossos têm `dungeonId: null` e o Eco
> mora em `js/core/data/eco.js`. O manifesto se escreve à mão (o modelo está
> naquele documento), com o `id` igual à **chave do modelo** (`colosso-fogo`,
> `boss-eco-primordial`), que é a que o corpo provisório espera. Os passos 2 a
> 4 são iguais, com `--calabouco colossos` / `eco`, mas no 4 a pasta nova
> tem de entrar no `GRUPO_DA_PASTA` do `tools/extrai_assets.py`. Pasta que não
> está lá cai no grupo `base`, que todo jogador baixa ao abrir o jogo. O passo
> 5 não serve: o bestiário também filtra pelo `dungeonId`, então reprova na
> primeira linha sem conferir nenhum bicho. O 6 e o 7 não existem aqui, porque não há cenário de
> calabouço nem portal.

Este é o caminho do lote, do mesmo jeito que os cinco anteriores entraram, só
que agora com ferramenta genérica em vez de script copiado.

Os Andaimes foram o segundo lote pela ferramenta genérica e não precisaram de
mapa: as três folhas ("itens 1/2/3.glb", sem o nome das peças) vieram com vão
suficiente para `separa_pecas.py --conta 5,4,6` achar o patamar sozinho; as
peças saíram numeradas e foram nomeadas pela folha de contato
(`tools/embute_cenario_andaimes.py` guarda o de-para). O muro veio com uma viga
em cada ponta (`alto_corpo: 'auto'`), e o pilar chegou com o nome do que é —
`viga.glb`.

## O que o lote precisa ter

```
C:\Users\danie\Downloads\assets_ok\mapa\<Nome do calabouço>\
    monstros\<Nome do monstro>\<Nome do monstro> idle.glb
                               <Nome do monstro> walk.glb
                               <Nome do monstro> run.glb      (opcional)
                               <Nome do monstro> attack.glb
                               <Nome do monstro> hit.glb
                               <Nome do monstro> death.glb
    muros\   ...   (o kit de cenário: muros altos, pilar, marco, enfeites, chão)
```

O nome de cada monstro está em `tools/monstros/<id>.json` depois do passo 1.
Se a pasta ou o prefixo saírem diferentes, é só editar o manifesto.

## Os passos

1. **O manifesto** (lista os monstros do calabouço, lido do catálogo):
   ```bash
   python tools/embute_monstros.py --calabouco emberlock --manifesto
   ```
2. **O raio-X** (lê cada GLB e decide, pelo conteúdo, qual arquivo é a
   reação e qual é o ataque — em dez lotes o Meshy trocou os dois):
   ```bash
   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/embute_monstros.py -- --calabouco emberlock --raio-x
   ```
3. **A fusão** (um kit por monstro, textura 1024, `models-meshy-<id>.js`):
   ```bash
   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/embute_monstros.py -- --calabouco emberlock
   ```
4. **Ligar no jogo**: acrescente `'assets/embedded/models-meshy-emberlock.js'`
   na lista de modelos do `index.html` (ao lado de `models-meshy-cisterna.js`),
   rode `python tools/reduz_texturas.py` (relevo e metal/rugosidade a 512 px,
   a cor fica em 1024 — ver *A textura* abaixo) e depois
   `python tools/extrai_assets.py` para o bundle servido. A fusão roda no
   Blender, cujo Python não tem Pillow, por isso a redução é um passo à parte
   aqui; no cenário (passo 6) o próprio `embute_cenario_*.py` já a chama no
   fim.
5. **A régua**: abra `tests/bestiario.html?calabouco=emberlock`. Ela cobra kit
   próprio para todo monstro **gerado**, clipe por papel, porte entre 0,8 e
   3,6 m e o chefe como o maior.
   *Se o lote vier incompleto por saldo* (a Mina Trêmula, 21/09, foi o
   primeiro 8-para-10): declare cada faltante em `window.EMPRESTADOS` no topo
   da página — id do monstro, o corpo que ele veste e o pacote onde esse corpo
   mora. A régua então cobra que o emprestado vista **exatamente** o corpo
   declarado e que o conjunto dos emprestados seja **exatamente** o dos sem
   kit, de modo que gerar um deles depois e esquecer de tirar da tabela
   reprova. Monstro sem pernas cujo `walk` é o próprio `idle` de propósito
   (ele se arrasta) vai em `window.ARRASTA`.
   Declare os mesmos empréstimos em `tools/monstros/<id>.json` (chave
   `emprestados`), em `MONSTER_LOOK` e no lote de retratos
   (`tools/retratos_site.html` precisa carregar também o pacote do doador,
   senão o emprestado fica sem foto na wiki). Sem linha no `MONSTER_LOOK` o kit já veste sozinho em
   escala 1; o porte se acerta depois em `js/render3d/models3d_v2.js`
   (`MONSTER_LOOK`, campo `scale`), como foi feito na Cisterna.
6. **O cenário** (muros e enfeites do tema, para a batalha e para o
   cantinho do portal na praça): o Fecho de Brasa (19/09) é o modelo mais
   novo — `tools/normaliza_muros_fecho.py` (muros e pilar, sem separar),
   `tools/separa_pecas.py` (as folhas de enfeite) e
   `tools/embute_cenario_fecho.py` (o catálogo). Copie os dois de nome
   próprio trocando a pasta e o tema (`scaffold`, `mine`, `heart`) e
   registre `JOGO.CENARIO[tema]` com os papéis `alto`, `pilar`, `marco`,
   `sotaque`, `sotaque_alto`, `chao`, `borda` (+ `chao_alt`, `alto_corpo`).
   A cópia herda as duas linhas do fim que chamam
   `reduz_texturas.reduz_arquivo(SAIDA)` — não as tire.

   O separador: `separa_pecas.py -- <pasta>` (ensaio) agrupa por
   proximidade de VÉRTICE e lê no nome do arquivo quantas peças a folha tem
   ("A-B-C.glb" = três; `--conta 4,5,7` quando o Meshy gerou objeto a mais).
   Quando peças vêm ENCOSTADAS (grelha na limalha, sino no carrinho), nenhuma
   distância separa: `--bruto 0.02,0.007,0.007` exporta cada grupo e as duas
   metades dele numerados, `tools/contato_cenario.py` fotografa, e um mapa
   diz o que junta com o quê — `--mapa mapa.json` monta e nomeia as peças
   (`{"folha2": {"g": 0.007, "Forno de fundição": ["7b"], "Prensa": ["7a",
   "5"]}}`). O `separa_cenario.py` antigo (por caixa) segue valendo para
   folha com vão largo entre as peças.
7. **Abrir o portal**: tire o id de `JOGO.DATA.portaisFechados` em
   `js/core/data/dungeons.js`. O X vermelho some, a descida volta, o
   Calabouço do Dia e o Poço passam a contar com ele, e as peças dele
   deixam de vazar para os outros calabouços. Repare no que mais volta
   junto: o **pet** daquele calabouço (`dropDungeon` é o id dele, então sem
   descida ele era inalcançável) e o **selo** do elemento do chefe dele — foi
   o que segurou o Traje do Colecionador enquanto o Coração esteve trancado,
   porque o `boss-riftheart` é o ÚNICO chefe neutro do jogo.
8. **Conferir**: `tests/bateria.html` (portais_fechados vai cobrar a lista
   nova — ajuste a contagem no teste) e uma foto da praça
   (`tests/prova_praca.html?dist=26&tilt=1.1&ang=0`).

   Desde 21/09 o `tests/portais_fechados.html` tem DUAS partes, porque a lista
   ficou vazia: a primeira cobra o estado de hoje (nada fechado, os seis
   descíveis, nada vazando) e a segunda **simula** um portal fechado —
   injeta `D.portaisFechados`, cobra a recusa da descida, o Dia, o Poço e o
   vazamento de peça como antes, e devolve a lista no fim. É assim que o
   mecanismo continua coberto sem fingir que há portal trancado.

## A textura: cor em 1024, relevo e brilho em 512 (02/10)

Cada modelo do Meshy traz três imagens 1024: cor, relevo (`normalTexture`) e
metal/rugosidade. No `.glb` são ~1 MB de JPEG; no navegador viram ~12 MB de
textura descompactada, e era isso que levava a aba a 2 GB. O dono comparou
fotos lado a lado e aprovou: **a cor fica em 1024, relevo e metal/rugosidade
(e oclusão, se vier em imagem separada) caem para 512**. Medido no jogo
servido, mesma praça e mesma vitrine (143 modelos): 1,58 GB → 0,88 GB de
textura decodificada, e a foto difere da anterior menos que duas fotos
seguidas da MESMA versão (o ruído da animação). Os `.glb` reduzidos caíram
de 106,1 para 99,0 MB.

- Quem faz é `tools/reduz_texturas.py` (Lanczos, mesmo formato; JPEG a 90 com
  croma 4:4:4, porque no relevo e no brilho os canais não são cor). Imagem que
  serve de cor em algum material nunca cai. Rodar de novo não muda nada.
- **Ficam em 1024**: heróis (KayKit, `meshy_<classe>`, `meshy_gm`, o escudo
  do Minotauro), corpos e invocações de fusão (`fusao:*`), pets, chefes
  (`boss-*` e os do Quaternius) e coroas. Todo o resto reduz — é por exclusão,
  então lote novo de cenário ou de monstro entra reduzido sem lista nova.
- `python tools/reduz_texturas.py --conferir` lista o que reduziria; o
  `extrai_assets.py` avisa quando sobrou algo, e `tests/texturas_prova.py`
  reprova. `tests/texturas_abrem.html` (jogo servido) abre cada `.glb` no three
  e desenha um quadro.
- Os originais em 1024 ficam no histórico do git (o commit anterior à
  redução); para voltar um modelo, tire-o do git velho e ponha-o na lista de
  exceções (`FICA_PASTA`/`fica_inteiro`).

## O que NÃO precisa mudar

- Itens: as 91 peças dos seis calabouços já caem, e 90 delas já têm ícone —
  a Couraça do Arauto de Pedra (`cp-herald-stone`, entrou em 21/09 para o
  Coração deixar de ter 0% de terra) ainda usa o ícone procedural.
- Pets: as cartas do pet de cada calabouço já caem do chefe dele.
- Salas, layouts, feitiços e IA dos monstros: já existem para os seis.

## O que os seis lotes ensinaram

- **Imagem→3D (Gemini → Meshy) é o caminho desde a Mina.** O prompt passa a
  ser de IMAGEM: câmera, fundo branco liso, sem sombra projetada, bases
  alinhadas e vão claro entre as peças. Peça rasteira pede câmera mais alta
  (~40°), senão sai com 7 cm; muro pede vista frontal reta, senão a ponta não
  emenda em fileira.
- **NADA SOLTO na folha.** As três argolas do silo da Mina viraram "peça",
  contaram na separação e fizeram o separador fundir pares reais. No Coração o
  prompt fechou com *no free-floating rings, no loose chain links* e as quatro
  folhas saíram limpas no `separa_pecas.py --conta 3` e `--conta 4,4,4`, na
  ordem exata do briefing.
- **Papel pode ser reaproveitado quando o saldo aperta.** No Coração só
  couberam quatro folhas, então a `borda` são as MESMAS três peças do
  `sotaque_alto` (arco, escadaria, coluna). O que não se reaproveita é o
  `marco`: ele é a peça de uma vez por sala, e repeti-lo fora da arena desfaz
  a regra do aquário.
- **O enfeite por sala é DENSIDADE, não número cru** (8% das casas, piso 36) —
  e quem o estoura é o LAYOUT, não o catálogo: sala com muitos trechos curtos
  de parede ganha um `sotaque_alto` em cada um. Quando uma sala reprovar aí, o
  conserto é no desenho da sala.
- **O raio-X sempre teve razão:** nos seis lotes o Meshy entregou `attack.glb`
  com a reação e `hit.glb` com o golpe. Rodar `--raio-x` antes da fusão não é
  zelo, é o passo.
- **Lote completo é o normal; lote curto é decisão.** Só a Mina veio 8-para-10,
  e os dois faltantes foram declarados em `EMPRESTADOS` (bestiário), em
  `MONSTER_LOOK` e no lote de retratos. O Coração veio 10-de-10 e não tem
  nenhuma dessas declarações — se um dia vier curto de novo, o caminho está
  no passo 5.
