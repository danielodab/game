# SOTERRA no celular

Este arquivo é o registro do que o SOTERRA é como aplicativo de Android (feito
com o Capacitor) e do que foi mudado no jogo para ele funcionar no telefone.

**Para publicar na Google Play** — instalar o Android Studio, assinar, a ficha
da loja, os formulários — o passo a passo é o [`GOOGLE_PLAY.md`](GOOGLE_PLAY.md).

**O estado (04/10/2026):** o projeto Android existe (`android/`, criado com
`npx cap add android`) e a `www/` é montada e sincronizada. **Nunca foi
compilado**: esta máquina tem Node, mas não tem Java nem o Android SDK.

**Duas decisões do dono, do mesmo dia** (seções 3 e 8): o aplicativo **abre o
jogo direto do servidor** — atualiza junto com a web, sem esperar a loja — e os
modelos 3D têm **duas opções** na primeira abertura: *Jogar agora* ou *Baixar
tudo*, as duas guardando no aparelho o que baixam.

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

# --- só quando mudar a CASCA (a tela "sem conexão", um plugin, o ícone) --
#     mexer no JOGO não pede nada disto: o aplicativo o abre do servidor
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
deixam `android/`, `app/`, `www/`, `node_modules/` e os dois `package*.json` de
fora. **A exceção é `vendor/capacitor/`** (quatro arquivos, 22 KB): é o servidor
que os entrega ao aplicativo, e só a ele — a web nunca os pede.

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

## 3. O aplicativo abre o jogo do servidor

**A decisão (04/10):** o código do jogo **não vai dentro do aplicativo**. O
`capacitor.config.json` tem `server.url: "https://soterra.viidoo.io"`, e a cada
abertura o WebView carrega o jogo que está no ar. Mudou uma regra na web → o
celular recebe na próxima abertura, sem AAB novo e sem revisão da loja.

| | onde | o que faz |
|---|---|---|
| `server.url` | `capacitor.config.json` | o endereço que o aplicativo abre |
| `server.errorPath: "index.html"` | idem | o que mostrar quando o servidor não responde |
| `app/index.html` | vira `www/index.html` | a tela **"Sem conexão — Tentar de novo"** |
| `vendor/capacitor/*.js` | servidos pelo servidor | a parte JS dos plugins (voltar, segundo plano, tela acesa, compra pela Google) |

**A `www/` agora é um arquivo só** — MEDIDO em 04/10/2026: **3,3 KB** (era
13,71 MB com o jogo dentro). É a tela que aparece no lugar da tela branca quando
não há internet ou o jogo está em manutenção; ela tenta de novo no toque e
sozinha quando a rede volta. Tem de ser um arquivo só: com o `server.url`
ligado, o Capacitor entrega do pacote **apenas** o endereço exato dessa página
(lido no código dele, `WebViewLocalServer.java`) — folha de estilo ou imagem à
parte seriam pedidas à rede.

**Por que o `server.url` e não outra coisa.** A alternativa seria abrir uma
página do pacote e, dela, navegar para o servidor (`allowNavigation`). Lido no
código do Capacitor 8 (`Bridge.java`): a ponte dos plugins só é posta nas
páginas da origem do aplicativo — que, com o `server.url`, **é** o servidor do
jogo. Pelo outro caminho o jogo abriria sem botão voltar, sem tela acesa e, mais
tarde, sem a compra pela Google.

**`JOGO.Mobile.app()` continua valendo:** o Capacitor põe o `window.Capacitor`
na página do servidor antes do primeiro script, como fazia na do pacote.

**A navegação fica presa ao domínio do jogo.** Não há `allowNavigation`:
qualquer link para outro domínio abre no navegador do aparelho, não dentro do
aplicativo (é o comportamento padrão do Capacitor, `Bridge.launchIntent`). O
`site/conta.html` é do mesmo domínio e abre dentro.

**O WebView não prende código velho.** É o mesmo arranjo da web: a página, o
`js/versao.js` e o manifesto dos modelos vão com `no-cache` (o WebView sempre
confere com o servidor), e todo o resto é pedido com o hash do conteúdo no
endereço — arquivo que mudou tem endereço novo. Os três arquivos de
`vendor/capacitor/` entram pelo mesmo carimbo (`window.__url`). Desde 06/10 o
aplicativo (e só ele) registra um service worker que guarda os `.js` e `.css`
no aparelho — pela mesma regra do hash no endereço, e sem nunca responder pela
página: ver a seção 9.

### O endereço do servidor

Decide-se num lugar só: a constante **`SERVIDOR`** no começo do
`tools/empacota_www.py`. O `capacitor.config.json` o repete (é de lá que o
Capacitor lê) e o script **recusa montar** se os dois não baterem. Como o jogo
agora é servido do próprio domínio, a API, o relé e os modelos são endereços da
mesma origem — a linha `window.SOTERRA_APP`, que servia para isso, só existe no
jeito antigo (abaixo).

### O jeito antigo continua guardado: `--embutida`

`python tools/empacota_www.py --embutida` monta a `www/` de 13,7 MB com o código
do jogo dentro e a linha `window.SOTERRA_APP = { servidor: … }` no
`js/versao.js`. É a saída se a loja recusar o jogo servido: tire `url` e
`errorPath` do `capacitor.config.json` e use essa opção. Nesse jeito a página
vem de `https://localhost`, e é para ele que as duas `Caddyfile` dão licença de
origem (CORS) na pasta dos modelos. Os modelos guardados no aparelho (seção 8)
funcionam nos dois jeitos.

### Quando o jogo muda

Publicou na web → o aplicativo já está atualizado. **Só se envia outro AAB**
quando muda a casca: a tela "sem conexão", um plugin do Capacitor (aí copie de
novo o `vendor/capacitor/` e publique na web **antes**), o ícone, a versão do
Android. O `tools/empacota_www.py` confere que `vendor/capacitor/` é igual ao
`node_modules/` e recusa montar se não for.

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

5. **A compra de barras pela Google Play** está pronta no código (04/10: no
   aplicativo o Mercado Pago não aparece; `js/core/compra_play.js` e
   `servidor/pagamento_play.py`), mas só liga quando a conta da Play for
   aprovada: produtos, conta de serviço e credencial estão no
   `GOOGLE_PLAY.md` §9.

| **Sessão** | o Android não copia os dados do aplicativo para a nuvem do Google (`allowBackup="false"`): a sessão da conta não viaja para outro telefone | `AndroidManifest.xml` |

| **Modelos no aparelho** | a escolha *Jogar agora* / *Baixar tudo* na primeira abertura; o modelo é procurado primeiro no aparelho (seção 8) | `js/app_modelos.js` |

Os quatro arquivos do Capacitor (`vendor/capacitor/`) são carregados pelo
`js/mobile.js` **depois** de ele confirmar que está na casca, e o
`js/app_modelos.js` e o `js/core/compra_play.js` só são escritos pelo `index.html` dentro do aplicativo: a web
não pede nenhum dos quatro.

### As provas

```bash
node tests/app_casca.js           # web: nada muda · aplicativo: média/baixa · a escolha vence · onde mora a API
# tests/app_casca.html             # botão voltar, segundo plano e tela acesa, com eventos simulados
node tests/app_modelos.js         # o que baixar/apagar pelo manifesto · retomada · MB · a web não usa · a casca
# tests/app_modelos.html           # a escolha, o progresso, a rede que cai, apagar, o Cache Storage de verdade
node tests/app_jogo.js            # o jogo guardado: o que é interceptado, hash igual/diferente, apagar, as válvulas, a web não usa
python tests/app_jogo_sw.py       # o mesmo com o service worker DE VERDADE num Chrome headless (precisa do Chrome)
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

---

## 8. Os modelos 3D no aparelho: as duas opções (04/10)

O pedido do dono: *"sim, tem que ter as duas opções"*. Na primeira abertura do
aplicativo, antes de baixar qualquer modelo, o jogador escolhe:

| | o que acontece |
|---|---|
| **Jogar agora** | abre na hora; cada mapa baixa o que precisa na primeira vez, como na web — e o que baixou **fica guardado** |
| **Baixar tudo — 246,5 MB** | baixa o pacote inteiro com barra (`123,4 de 246,5 MB · faltam … · cerca de N min`); depois os mapas abrem sem esperar e sem gastar dados |

**As regras**

- **Fora do Wi-Fi** (quando o aparelho informa — `navigator.connection.type`):
  a tela de escolha já avisa, e "Baixar tudo" pergunta de novo com o tamanho.
  *Esperar o Wi-Fi* abre o jogo e deixa o download para a próxima abertura.
- **O download continua de onde parou.** Cada arquivo é guardado assim que
  chega (são 386, o maior com 1,7 MB). Caiu a rede, ou o aplicativo fechou: na
  volta só desce o que falta. Com a rede de volta, continua sozinho.
- **A arte mudou no servidor:** a cada abertura o jogo compara o manifesto com
  o que está guardado. Desce **só** o arquivo cujo hash mudou e o que é novo;
  o que saiu do manifesto e a versão velha do que mudou são apagados.
- **Faltou espaço:** antes de começar, a tela diz quanto o pacote precisa e
  quanto há; se encher no meio, diz quanto liberar e oferece continuar.
- **Nas Configurações** (seção *Modelos no aparelho*, só no aplicativo): o
  espaço usado, **Baixar tudo** para quem escolheu jogar agora, e **Apagar**
  (pergunta antes; quem apaga volta a "jogar agora").
- **Pausar e jogar agora** durante o download: o jogo abre com o que já baixou.

**Onde fica guardado, e por quê.** No **Cache Storage do WebView**, na origem do
jogo (`soterra-modelos-1`). Ele mora nos *dados* do aplicativo — o "limpar
cache" do Android não o apaga, só "limpar dados" ou desinstalar — e é da mesma
origem do jogo servido, então ler um modelo não passa pela ponte nativa. O
plugin Filesystem obrigaria a passar 250 MB em base64 pela ponte (ou a incluir
mais um plugin nativo de download) sem que nada disso pudesse ser compilado ou
provado aqui. O ponto fraco é conhecido: com o aparelho quase sem espaço, o
WebView **pode** despejar esse armazenamento; o jogo pede que não
(`navigator.storage.persist()`) e, se acontecer, só baixa de novo o que faltar.

**Como funciona por dentro.** A chave de cada arquivo guardado leva o hash do
conteúdo (o do manifesto). `JOGO.AppModelos.plano(manifesto, guardados)` faz a
conta — o que baixar, o que apagar, quantos MB. O `js/assets_bundle.js` tem dois
desvios, e só eles: antes de baixar a base chama `AppModelos.abertura` (a
escolha), e cada modelo passa por `AppModelos.le` antes de ir à rede (o que veio
da rede vai para `AppModelos.grava`). **Na web `JOGO.AppModelos` não existe** e
os dois desvios caem no caminho de sempre.

**O que muda se o domínio mudar:** o Cache Storage é da origem. Jogo em outro
endereço = pacote baixado de novo.

---

## 9. O código do jogo no aparelho — e o jogo segue somente online (06/10)

O pedido do dono: *"o jogador pode ter a opção de salvar o jogo no celular, mas
só consegue conectar ao game com internet"*.

**O que é guardado:** os **arquivos** do jogo — os `.js` e `.css` (o código, os
dicionários de idioma, os ícones e tabelas que vão dentro deles): cerca de
**12 MB** no aparelho (MEDIDO em 06/10: 12,3 MB em 128 arquivos, sem
compressão; pela rede descem comprimidos, bem menos). Os modelos 3D continuam
na seção 8. Imagem solta de interface o jogo não tem — as do `site/` não entram.

**O que NÃO é guardado, nunca:** a página (`/`, `index.html`), o
`js/versao.js`, o manifesto dos modelos, `/api/*`, o relé, a loja, o site,
qualquer coisa de conta ou sessão, e nenhum progresso. **Sem internet o
aplicativo mostra a tela "Sem conexão" de sempre** — com ou sem jogo guardado:
a página não vem do aparelho, então não há como abrir o jogo sem o servidor.

### Como funciona

| peça | o que faz |
|---|---|
| `/sw.js` (na raiz do que é servido) | o service worker: responde do aparelho **só** por `GET` da própria origem de um `.js`/`.css` cujo endereço leva o hash do conteúdo (`?v=<12 hex>`); todo o resto ele nem toca |
| `js/app_jogo.js` | só é escrito pelo `index.html` dentro do aplicativo; registra o `/sw.js`, manda a lista do que o servidor pede agora, e tem a seção das Configurações |
| `window.__guardaJogo` no `index.html` | a válvula (abaixo) |
| `peso` no `js/versao.js` | os bytes do que será guardado, gravados no build pelo `servidor/coolify/versao.py` — é o número que a tela mostra |

**Por que nunca roda jogo velho.** Quem decide qual arquivo pedir é a página,
e a página e o `js/versao.js` vêm **sempre da rede** (`no-cache`, e o service
worker não responde por eles). Cada arquivo é pedido com o hash do conteúdo que
o servidor tem **agora**. O guardado é achado pelo endereço inteiro, hash
incluído: se o arquivo mudou, o endereço é outro, não está guardado, desce da
rede. Além disso o service worker **só guarda o que conferiu** — o sha-256 do
que chegou tem de começar pelo hash do endereço. Isso cobre o rolling update
(um pedido com o hash novo que cai no contêiner velho recebe o arquivo antigo:
esse não bate e não fica). A cada abertura a versão velha de cada arquivo é
apagada (`acerta`).

**Se algo falhar** — WebView sem service worker, cache cheio, erro no meio —,
o pedido segue para a rede e o jogo abre como antes. Em casa (o `js/versao.js`
'dev', sem hash) e no `--embutida` nada é registrado.

**A web não muda.** O `index.html` só escreve o `js/app_jogo.js` dentro do
aplicativo, e mesmo carregado ele só registra na casca de verdade (Capacitor
nativo); o `?app=1` das provas só vale em `localhost`/`127.0.0.1`, para ninguém
ganhar um service worker no navegador por um link.

### A opção do jogador

- **Na primeira abertura** (a tela das duas opções da seção 8): uma linha a
  mais — *"O jogo também fica guardado no aparelho, para abrir mais rápido.
  Mesmo assim, é preciso internet para entrar e jogar."* **Jogar agora** guarda
  cada arquivo quando o jogo o usa (como já fazia com os modelos); **Baixar
  tudo** guarda também o resto do código (os outros idiomas, o que só carrega
  mais tarde), em pano de fundo, e o número do botão soma os ~12 MB.
- **Nas Configurações** → *Jogo no aparelho*: quantos MB estão guardados e o
  botão **Apagar o jogo guardado** (tira o service worker e o cache, e lembra a
  vontade: a abertura seguinte não guarda de novo). Quem apagou vê **Guardar o
  jogo** para voltar atrás. Não pergunta antes: são 12 MB que voltam sozinhos,
  e a conta e o progresso moram no servidor — apagar não os toca.

Guardar vem **ligado** no aplicativo porque é pequeno e é o que a tela dos
modelos já prometia ("o que baixou fica guardado"); a opção é poder desligar.

### Como tirar do ar (as válvulas)

Service worker com defeito é difícil de tirar — por isso são três saídas, e
nenhuma depende de arquivo guardado:

1. **O jogador:** Configurações → *Apagar o jogo guardado*. Ou Android → Apps →
   SOTERRA → Armazenamento → *Limpar dados* (apaga também os modelos).
2. **Nós, pela página:** no `index.html`, troque `window.__guardaJogo = true`
   por `false` e publique. A página vem sempre da rede; na abertura seguinte
   ela mesma desregistra o service worker e apaga o cache, ali na linha, antes
   de qualquer script do jogo. A seção das Configurações some.
3. **Nós, pelo service worker:** no `/sw.js`, troque `DESLIGA = false` por
   `true` e publique. O aplicativo manda conferir o `/sw.js` com o servidor a
   cada abertura (`update()`, com `updateViaCache: 'none'`); a versão nova
   assume, apaga o cache e se desregistra.

Para desligar de vez, faça as duas (2 e 3) no mesmo commit.

**Precisa de AAB novo?** Não. Tudo isto é servido pela web: publicou, o
aplicativo instalado passa a guardar na abertura seguinte. A casca (`www/`,
plugins, `capacitor.config.json`) não mudou.

### O que só o aparelho prova

Provado aqui: a regra em Node (`tests/app_jogo.js`) e o service worker de
verdade num Chrome headless com uma página-sonda (`tests/app_jogo_sw.py`).
**Não provado:** o WebView do Android com o Capacitor. Confira no telefone a
lista do `docs/GOOGLE_PLAY.md` 8.4 (itens 11 a 15) — em especial o **modo
avião depois de guardar**: tem de aparecer "Sem conexão", nunca o jogo.
