# SOTERRA no celular

Este arquivo é o passo a passo para transformar o SOTERRA num aplicativo de
Android (ou iOS) com o Capacitor, e o registro do que foi mudado no jogo para
que ele funcione no telefone.

**Nada aqui foi instalado ou construído nesta máquina** — Node não está
instalado. O que existe é a estrutura pronta (`capacitor.config.json`,
`tools/empacota_www.py`) e as instruções abaixo, que você roda quando quiser.

---

## 1. O que precisa estar instalado

| o que | por quê | onde |
|---|---|---|
| **Node.js 20 LTS** | o Capacitor é uma ferramenta Node; é o único jeito | <https://nodejs.org> |
| **Java JDK 21** | o Gradle do Android precisa | <https://adoptium.net> |
| **Android Studio** | traz o SDK, o Gradle e o emulador | <https://developer.android.com/studio> |
| **Python 3** | já está instalado; monta a `www/` | — |

No Android Studio, abra **SDK Manager** e garanta:
*Android SDK Platform 34* (ou mais recente) e *Android SDK Build-Tools*.

---

## 2. Os comandos, em ordem

Tudo a partir da raiz do projeto (`C:\Users\danie\Documents\Jogo`).

```bash
# --- uma vez só, para criar o projeto ---------------------------------
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android

# --- toda vez que você mexer no jogo ----------------------------------
python tools/extrai_assets.py     # 1. .glb de verdade a partir do base64
python tools/empacota_www.py      # 2. monta a www/ (~25 MB)
npx cap sync android              # 3. leva a www/ para o projeto Android

# --- gerar o APK ------------------------------------------------------
npx cap open android              # abre o Android Studio; Build > Build APK
#   ou, sem abrir o estúdio:
cd android && ./gradlew assembleDebug
#   o APK sai em android/app/build/outputs/apk/debug/app-debug.apk
```

> `npm init -y` cria um `package.json`. Ele **não existe** no repositório de
> propósito: o jogo não tem dependências de Node e não deve passar a ter. O
> `package.json` que o Capacitor cria é ferramenta de empacotamento, não do jogo.

### Deixar em pé (retrato)

O jogo foi desenhado para retrato. Depois do `npx cap add android`, abra
`android/app/src/main/AndroidManifest.xml` e acrescente ao `<activity>`:

```xml
android:screenOrientation="portrait"
```

---

## 3. Por que existe uma pasta `www/`

`webDir` no `capacitor.config.json` aponta para `www/`, não para a raiz.
Apontar para a raiz funcionaria — e empacotaria no telefone o `.git`, os
`docs/`, o `unity/`, as 55 páginas de `tests/`, os 42 MB de modelos originais
em `assets/models/kaykit_*` e, o pior, os **28 MB de
`assets/embedded/models-*.js` que o aplicativo não usa**.

Não usa porque dentro do APK o Capacitor serve os arquivos por
`https://localhost` — ou seja, **servido**. E nesse caso
`js/assets_bundle.js` busca os `.glb` de verdade em `assets/models/bundle/`.
O base64 embutido existe só para o caso `file://`, que é o duplo clique no
computador, e esse caso não existe dentro do telefone.

MEDIDO: `www/` sai com **25,01 MB**.

| pasta | MB |
|---|---|
| `assets/models/bundle` | 20,93 |
| `js` | 2,08 |
| `vendor` | 1,14 |
| `assets/embedded` (só os dois atlas de efeito) | 0,80 |
| `css` | 0,06 |
| **total** | **25,01** |

`www/` fica fora do Git: é gerada, e versioná-la seria guardar 25 MB de cópia.

---

## 4. O que mudou no jogo por causa do celular

### 4.1 O base64 saiu do caminho

O jogo carregava **30,84 MB, dos quais 27,89 MB eram modelos `.glb` escritos
como base64 dentro de arquivos `.js`**. Isso é caro três vezes: base64 é 33%
maior que o binário, o motor de JavaScript tem de **interpretar** os 27,89 MB
como código-fonte antes da primeira linha do jogo rodar, e a string fica em
UTF-16 na memória (o dobro dos bytes).

Agora `tools/extrai_assets.py` escreve os 88 arquivos de verdade em
`assets/models/bundle/`, e `js/assets_bundle.js` decide o caminho pelo endereço:

| endereço | o que acontece |
|---|---|
| `file://` (duplo clique) | o embutido, exatamente como sempre foi |
| `http://`, `https://localhost` (APK) | busca os `.glb` por XHR |

MEDIDO, mesma máquina:

| | antes (embutido) | depois (servido) |
|---|---|---|
| total que desce | 30,84 MB | 23,87 MB |
| **JavaScript que o motor tem de compilar** | **30,84 MB** | **2,94 MB** |

O duplo clique no `index.html` continua abrindo o jogo. Isso não foi negociado.

> **Os dois caminhos têm de mostrar o MESMO modelo.** Se alguém regerar um
> `assets/embedded/models-*.js` (é o que `tools/embute_meshy.py` faz) e esquecer
> de rodar `tools/extrai_assets.py`, o duplo clique e o aplicativo passam a
> mostrar bonecos diferentes — e ninguém percebe, porque cada um funciona.
> Por isso `assets/models/bundle/` está no Git, e não gerado na hora: a
> divergência aparece no `git status`. Para conferir sem escrever nada:
>
> ```bash
> python tools/extrai_assets.py --conferir
> ```

### 4.2 A ponte do bilhete

`models3d.js` e `models3d_v2.js` leem `JOGO.ASSETS` / `JOGO.MODELS` esperando
base64, e os dois fazem a mesma coisa: `atob` seguido de um laço de
`charCodeAt` byte a byte. Devolver base64 fabricado a partir do binário seria
pior que o problema — medimos: 21 milhões de `charCodeAt` custam mais do que
tudo o que economizamos.

Então a chave guarda um **bilhete de 20 bytes** (`SOTERRA-GLB:00000042`, em
base64 de verdade). O código dos outros dois arquivos roda igual, só que sobre
20 bytes. Na outra ponta, `GLTFLoader.parse` está embrulhado: ao ver um
bilhete, troca pelo binário e segue.

É uma **ponte, não um destino**. Ver §6.

### 4.3 Toque: mirar e confirmar

O jogo mostrava a área do feitiço com o **mouse por cima**. No telefone isso
não existe — o dedo não paira, e o primeiro contato já é o clique.

Agora, quando o ponteiro é dedo: **o primeiro toque mira** (acende alcance,
alvos, área e caminho, exatamente o que o mouse acendia) e **o segundo toque na
mesma casa confirma**. Tocar em outra casa só muda a mira. É a solução clássica
dos táticos no celular, e está em `js/render3d/renderer3d_v2.js` (`doTap` / `R.mira`).

Com mouse, um clique continua agindo de primeira — `tests/toque.html` prova as
duas coisas.

### 4.4 A moldura da HUD

Em retrato, a HUD come **97 px em cima e 230 px embaixo** de 844 — e o
tabuleiro continuava sendo enquadrado no centro do *canvas*, 67 px abaixo do
centro da faixa que sobra. A fileira de baixo do mapa nascia atrás da barra de
feitiços.

`R.setMoldura(topo, base)` resolve com `camera.setViewOffset`: a câmera passa a
enquadrar uma imagem maior e desenhamos só a janela visível, deslocada. O HUD
mede e avisa (`avisaMoldura` em `js/ui/hud.js`). Fora do celular, nada muda.

### 4.5 Desempenho

MEDIDO com `tests/perf.html`, mesma sala, 7 unidades:

| | antes | desktop (agora) | celular (agora) |
|---|---|---|---|
| chamadas de desenho / quadro | 341 | 200 | **193** |
| triângulos / quadro | 334 602 | 313 546 | **239 788** |
| malhas do grupo `board` | 149 | 29 | **28** |
| triângulos do `board` | 184 772 | 184 676 | **109 708** |

O que mudou:

* **fusão de verdade do cenário** — o agrupamento era por `material.uuid`, e o
  kit KayKit vem em 49 `.glb` separados, cada um com sua própria cópia do mesmo
  atlas. Agora a textura é comparada pelo **conteúdo** e a **cor vai para os
  vértices**, então tudo o que divide textura vira uma malha só;
* **32 marcadores de obstáculo e 18 discos de contato** viraram duas
  `InstancedMesh` — eram 50 chamadas para 100 triângulos;
* **bloom desligado no celular** — 7% das chamadas, mas cinco desfoques de tela
  cheia por quadro, que é onde o GPU de telefone se afoga. `tests/celular.html`
  mede o tom da imagem com e sem: **1,00x**, não escurece;
* **traço de contorno fora no celular** — 24% dos triângulos do quadro;
* **resolução do canvas a 1,25x** em vez de 1,5x — 31% menos pixels por quadro
  num aparelho com dpr 3. A HUD é DOM e continua nítida.

---

## 5. As páginas de teste do celular

```bash
python -m http.server 8137 --directory .
```

| página | o que prova |
|---|---|
| `tests/carga.html` | quanto pesa e quanto demora o boot; `?embutido=1` força o caminho antigo para comparar |
| `tests/toque.html` | mirar em dois toques com o dedo, agir em um clique com o mouse |
| `tests/celular.html` | abre o `index.html` de verdade num quadro de 390×844 e mede a interface |
| `tests/perf.html` | chamadas de desenho, triângulos, custo do bloom e do traço; `?mobile=1` para o perfil de celular |

Em headless:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --enable-unsafe-swiftshader --virtual-time-budget=180000 --window-size=1000,860 \
  --dump-dom "http://localhost:8137/tests/celular.html"
```

`?mobile=1` liga o perfil de celular numa máquina de mesa; `?mobile=0` desliga.
`?bloom=1` / `?bloom=0` mandam por cima do brilho.

---

## 6. O que ficou pendente

1. **`models3d_v2.js` aceitar binário direto.** Hoje ele faz
   `atob(b64)` + laço de `charCodeAt`. Se `JOGO.MODELS` pudesse guardar um
   `ArrayBuffer`/`Uint8Array`, a ponte do bilhete (§4.2) morre e o
   `GLTFLoader.parse` deixa de ser embrulhado. São três linhas em
   `M.load`. O arquivo tem outro dono — o pedido está no relatório.

2. **As unidades são 75 malhas para 7 bichos** (`units` em `tests/perf.html`) —
   dez malhas por criatura mais o contorno. É o maior peso que sobrou depois de
   o cenário cair de 149 para 28, e mora em `models3d_v2.js`.

3. **`fx-atlas.js` e `fx-placas.js` continuam embutidos** (0,80 MB somados). Tem
   outro dono; o ganho não pagava o conflito. `tools/extrai_assets.py` já sabe
   lidar com `.png`, é só acrescentar os dois à lista `FONTES`.

4. **Ícone e tela de abertura do aplicativo** não existem. O Capacitor gera
   placeholders; trocar exige `@capacitor/assets` e uma arte de 1024×1024.
