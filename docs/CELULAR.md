# SOTERRA no celular

Este arquivo é o registro do que o SOTERRA é como aplicativo de Android (feito
com o Capacitor) e do que foi mudado no jogo para ele funcionar no telefone.

**Para publicar na Google Play** — instalar o Android Studio, assinar, a ficha
da loja, os formulários — o passo a passo é o [`GOOGLE_PLAY.md`](GOOGLE_PLAY.md).

**O estado (04/10/2026):** o projeto Android existe (`android/`, criado com
`npx cap add android`) e a `www/` é montada e sincronizada. **Nunca foi
compilado**: esta máquina tem Node, mas não tem Java nem o Android SDK.

---

## 1. O que precisa estar instalado

| o que | por quê | onde |
|---|---|---|
| **Node.js** | o Capacitor é uma ferramenta Node (já instalado) | <https://nodejs.org> |
| **Android Studio** | traz o Java, o SDK, o Gradle e o emulador | <https://developer.android.com/studio> |
| **Python 3** | monta a `www/` (já instalado) | — |

No Android Studio, abra **SDK Manager** e garanta:
*Android SDK Platform 36* e *Android SDK Build-Tools*.

---

## 2. Os comandos, em ordem

Tudo a partir da raiz do projeto.

```bash
npm install                       # uma vez: traz o Capacitor (lê o package.json)

# --- toda vez que você mexer no jogo ----------------------------------
npm run sync                      # = python tools/empacota_www.py && npx cap sync android

# --- rodar no telefone / gerar o APK de teste --------------------------
npx cap open android              # abre o Android Studio; ▶ Run, ou Build > Build APK
#   ou, sem abrir o estúdio:
cd android && ./gradlew assembleDebug
#   o APK sai em android/app/build/outputs/apk/debug/app-debug.apk
```

O AAB assinado, que é o que a loja recebe, está no `GOOGLE_PLAY.md` §1.

### O que está no Git e o que não está

| | no Git? | por quê |
|---|---|---|
| `package.json`, `package-lock.json` | sim | dizem quais versões do Capacitor instalar |
| `capacitor.config.json` | sim | a configuração de publicação |
| `android/` | **sim** | é o projeto do aplicativo: versão, ícone, manifesto, receita de assinatura |
| `node_modules/` | não | volta inteira com `npm install` |
| `www/` | não | gerada pelo `tools/empacota_www.py` |
| `android/keystore.properties`, `*.jks` | **nunca** | a chave de assinatura e as senhas |

Nada disso entra no servidor da web: o `.dockerignore` e o `tools/sobe_vps.py`
deixam `android/`, `www/`, `node_modules/` e os dois `package*.json` de fora.

### Em pé e deitado

A orientação é **livre**: o jogo tem desenho para as duas (em pé, a HUD
empilhada; deitado, o cais vira ícones no canto), e o `AndroidManifest.xml` não
prende nenhuma. Para prender, acrescente ao `<activity>`
`android:screenOrientation="portrait"` (ou `"sensorLandscape"`).

### Depurar o jogo rodando no telefone

O `capacitor.config.json` **não** tem a chave `webContentsDebuggingEnabled`, de
propósito: sem ela o Capacitor liga a depuração só no aplicativo de teste
(o "debug", que o ▶ Run e o `assembleDebug` geram) e desliga no de publicação.
Com o telefone no USB, abra `chrome://inspect` no Chrome do computador.
Escrever `true` ali abriria também o aplicativo publicado — não escreva.

---

## 3. Por que existe uma pasta `www/` — e por que ela não leva os modelos

`webDir` no `capacitor.config.json` aponta para `www/`, não para a raiz.
Apontar para a raiz empacotaria no telefone o `.git`, os `docs/`, o `unity/`, as
páginas de `tests/` e os `assets/embedded/models-*.js` que o aplicativo não usa.

**Os modelos 3D não vão no pacote.** A Google Play limita a 200 MB o que um
aplicativo baixa de início, e `assets/models/bundle` tem ~246 MB. Então o
aplicativo abre só com o código e a interface e **baixa os modelos do servidor
do jogo, sob demanda, igual à web**: a base antes do menu, cada calabouço na
hora de descer (`js/assets_bundle.js`).

MEDIDO em 04/10/2026: `www/` sai com **13,71 MB**.

| pasta | MB |
|---|---|
| `assets/embedded` (sons, ícones, efeitos — o que o `index.html` servido pede) | 4,96 |
| `js` | 4,78 |
| `site` (a porta da conta: entrar, criar, excluir) | 2,56 |
| `vendor` (three.js e os três arquivos do Capacitor) | 1,15 |
| `css` | 0,19 |
| `assets/models/bundle/tabelas` | 0,02 |
| **total** | **13,71** |

### Como o aplicativo acha o servidor

Dentro do aplicativo a página vem de `https://localhost` (os arquivos do
pacote), então a API, o relé e os modelos precisam de um endereço inteiro. Ele
está escrito num lugar só: a constante **`SERVIDOR`** no começo do
`tools/empacota_www.py` (`https://soterra.viidoo.io`). O script grava, no
`js/versao.js` **da `www/`**, uma linha a mais:

```js
window.SOTERRA_APP = { servidor: "https://soterra.viidoo.io" };
```

É por ela que `js/core/sessao.js` e `site/site.js` (a API), `js/core/rede.js`
(o relé, `wss://…/ws`), `js/assets_bundle.js` (os modelos) e `js/core/gm.js`
(que trata o aplicativo como jogo no ar, e não como "em casa") sabem onde estão.
**Na web essa linha não existe**, e os cinco seguem como sempre foram.

Para apontar para outro servidor sem mexer no arquivo:
`python tools/empacota_www.py --servidor https://outro.dominio`.

### O que o servidor precisa ter

Buscar um `.glb` de outra origem pede licença (CORS). As duas `Caddyfile`
(`servidor/` e `servidor/coolify/`) dão essa licença **só** à origem do
aplicativo (`https://localhost`) e **só** na pasta `/assets/models/bundle/`. A
API já respondia a qualquer origem (a sessão vai no cabeçalho `Authorization`,
não em cookie), e o relé é WebSocket, que não passa por isso.
**O aplicativo só funciona depois que essa Caddyfile estiver no ar.**

### Quando o jogo muda

O código vai dentro do aplicativo; só os modelos vêm do servidor. Mudou o jogo
na web → `npm run sync`, some 1 ao `versionCode` e envie outro AAB. Ver a
decisão 10 do `GOOGLE_PLAY.md` §7.

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

4. **Ícone e tela de abertura do aplicativo** não existem (está o padrão do
   Capacitor). Tamanhos e comando: `GOOGLE_PLAY.md` §2.

5. **A loja dentro do aplicativo** ainda é a do Mercado Pago, que a Play não
   aceita para item digital. Fica para a etapa da compra pela Google
   (`GOOGLE_PLAY.md` §7, item 4).
   placeholders; trocar exige `@capacitor/assets` e uma arte de 1024×1024.

---

## 7. O que o jogo faz de diferente dentro do aplicativo (04/10)

A regra: **o jogo da web não muda**. Tudo abaixo pergunta antes
`JOGO.Mobile.app()` — verdadeiro só dentro do Capacitor (`window.Capacitor`
nativo) ou com `?app=1` no endereço, que é como as provas fingem a casca no
navegador. O `<html>` ganha a classe `app`, para o CSS que precisar.

| | o que acontece | onde |
|---|---|---|
| **Botão voltar** | fecha a ficha aberta, depois o painel da praça; sem nada aberto, pergunta "Sair do SOTERRA?"; na batalha avisa que a luta continua sem ele. Voltar de novo desfaz a pergunta — só o botão **Sair** sai | `M.voltar` em `js/mobile.js`, `UI.voltar` em `js/ui/hud.js` |
| **Segundo plano** | o som cala e volta ao retornar. O desenho para sozinho (o WebView escondido não roda `requestAnimationFrame`), igual à aba escondida da web — e é por isso que o turno e a rede se acertam na volta pelo mesmo caminho que a web já usa | `M.segundoPlano`, `Audio.pausa` |
| **Tela acesa** | só durante a batalha e com o aplicativo na frente | plugin `@capacitor-community/keep-awake` |
| **Qualidade gráfica** | quem nunca escolheu abre em **média**; em aparelho fraco (até 2 GB de memória ou tela de até 360 px no lado curto), em **baixa**. A escolha das Configurações sempre vence | `M.padraoGrafico` |
| **Sessão** | o Android não copia os dados do aplicativo para a nuvem do Google (`allowBackup="false"`): a sessão da conta não viaja para outro telefone | `AndroidManifest.xml` |

Os três arquivos do Capacitor (`vendor/capacitor/`) só existem na `www/` e são
carregados pelo `js/mobile.js` **depois** de ele confirmar que está na casca: o
`index.html` da web nunca os pede.

### As provas

```bash
node tests/app_casca.js           # web: nada muda · aplicativo: média/baixa · a escolha vence · onde mora a API
# tests/app_casca.html             # botão voltar, segundo plano e tela acesa, com eventos simulados
```

### Trocar o identificador do aplicativo

`br.com.soterra.jogo` aparece em `capacitor.config.json` (`appId`),
`android/app/build.gradle` (`namespace` e `applicationId`),
`android/app/src/main/res/values/strings.xml` e no caminho de
`android/app/src/main/java/br/com/soterra/jogo/MainActivity.java`. O jeito mais
seguro de trocar é apagar `android/`, mudar o `appId` e rodar `npx cap add
android` de novo — e refazer as três mudanças feitas à mão no projeto: a
assinatura e a versão no `android/app/build.gradle`, o `allowBackup="false"` no
manifesto e as linhas da chave no `android/.gitignore`. **Só dá para trocar
antes do primeiro envio à Play.**
