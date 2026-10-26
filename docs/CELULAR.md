# SOTERRA no celular

Este arquivo é o registro do que o SOTERRA é como aplicativo de Android (feito
com o Capacitor) e do que foi mudado no jogo para ele funcionar no telefone.

**Para publicar na Google Play** — instalar o Android Studio, assinar, a ficha
da loja, os formulários — o passo a passo é o [`GOOGLE_PLAY.md`](GOOGLE_PLAY.md).

**O iPhone (25/10):** o projeto `ios/` existe (gerado aqui com `npx cap add ios`)
e o caminho até a App Store — compilar sem Mac, a assinatura, a ficha, os riscos
da revisão e o que o jogo precisa separar entre Android e iPhone — está no
[`APP_STORE.md`](APP_STORE.md). Tudo o que este arquivo diz da casca vale para os
dois, salvo o que o `APP_STORE.md` §8.8 aponta. O que o iPhone ainda não tem (o
"Sair do jogo", a compra, o anúncio) o jogo pergunta a `JOGO.Mobile.falta(recurso)`
— sempre falso no Android e na web (`APP_STORE.md` §8.7).

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
| `ios/` | **sim** (25/10) | o projeto do iPhone: versão, ícone, `Info.plist`, manifesto de privacidade (`APP_STORE.md` §9) |
| `codemagic.yaml` | sim | a compilação do iPhone na nuvem, sem segredo nenhum |
| `node_modules/` | não | volta inteira com `npm install` |
| `www/` | não | gerada pelo `tools/empacota_www.py` |
| `android/keystore.properties`, `*.jks` | **nunca** | a chave de assinatura e as senhas |

Nada disso entra no servidor da web: o `.dockerignore` e o `tools/sobe_vps.py`
deixam `android/`, `app/`, `www/`, `node_modules/` e os dois `package*.json` de
fora. **A exceção é `vendor/capacitor/`** (quatro arquivos, 22 KB): é o servidor
que os entrega ao aplicativo, e só a ele — a web nunca os pede.

### Em pé e deitado

**No aplicativo, sempre deitado e em tela inteira (06/10, pedido do dono).** O
`<activity>` do `AndroidManifest.xml` tem `android:screenOrientation="sensorLandscape"`
(gira entre os dois lados deitados, nunca fica em pé), e a `MainActivity.java`
esconde a barra de status e a de navegação — elas voltam por um instante quando
o jogador desliza da borda. Na **web** a orientação continua livre: o jogo tem
desenho para as duas (em pé, a HUD empilhada; deitado, o cais vira ícones no canto).

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

**A navegação fica presa ao domínio do jogo.** O `allowNavigation` leva só o
domínio do próprio jogo: qualquer link para outro domínio abre no navegador do
aparelho, não dentro do aplicativo (é o comportamento padrão do Capacitor,
`Bridge.launchIntent`). A linha entrou em 25/10 por causa do iPhone, que sem ela
abriria a entrada (`site/conta.html`) no Safari; no Android ela não muda nada
(`APP_STORE.md` §8.8), e o `tools/empacota_www.py` recusa montar sem ela. O
`site/conta.html` é do mesmo domínio e abre dentro. Desde 24/10 o WebView inteiro **nunca é o site**: fora do
jogo ele mostra só a entrada, e o site abre numa aba dentro do jogo (seção 10).

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

**08/10 — os AVISOS do aparelho.** Um sexto arquivo, `vendor/capacitor/local-notifications.js`
(`@capacitor/local-notifications`), carregado pelo `js/core/notificacoes.js` na primeira abertura
dentro do aplicativo. São lembretes LOCAIS, sem servidor e sem Firebase: o prêmio diário às 10h, a
semana do Eco (segunda, 12h) e "três dias sem descer" (remarcado a cada abertura, só dispara se o
jogador sumir). O Android 13+ pergunta a permissão na primeira vez; o jogador liga e desliga em
Configurações → "Avisos do aparelho". É um plugin NATIVO: `npm install`, copiar o `dist/plugin.js`
para `vendor/capacitor/local-notifications.js`, `npm run sync`, somar 1 ao `versionCode` e gerar um
AAB novo (o `AndroidManifest` ganhou `POST_NOTIFICATIONS`). Um "push" de verdade (o servidor avisando
"sua guilda está em guerra") pediria o Firebase — não existe. Prova: `node tests/notificacoes.js`.

**06/10 — "Ganhar prêmios" (o anúncio premiado).** Um quinto arquivo, `vendor/capacitor/admob.js`, mora
na mesma pasta mas **não** entra na lista do `js/mobile.js`: quem o busca é o
`js/core/premio_anuncio.js`, e só quando o jogador ENTRA na área (Configurações → Ganhar prêmios). A
regra do dono é anúncio só ali e só depois do toque; o prêmio (50 vinténs ou 1 barra de ouro, 5 de cada
por dia) é dado pelo servidor com a assinatura da Google. O passo a passo está em
[`GOOGLE_PLAY.md`](GOOGLE_PLAY.md) §10.

### As provas

```bash
node tests/app_casca.js           # web: nada muda · aplicativo: média/baixa (iPhone: baixa) · a escolha vence · a queda desce um nível · onde mora a API
# tests/app_casca.html             # botão voltar, segundo plano e tela acesa, com eventos simulados
node tests/premio_anuncio.js     # anúncio só na área e só depois do toque · a web não carrega nada · depuração usa bloco de teste
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

---

## 10. O aplicativo não é o site: a entrada e a aba do site (24/10)

**O pedido do dono:** "preciso que meu app não seja o site ao fechar o jogo —
seja somente página de login. O site é a parte se o usuário quiser navegar:
dentro do jogo deve ter um ícone de um globo com nome Site, que leva pro site
do jogo e abre uma aba do site no próprio jogo."

**O que acontecia.** No aplicativo, sair da conta, cair por inatividade ou por
outro aparelho levava o WebView para `site/conta.html` — com o menu inteiro do
site (Início, Eventos, Torneio, Wiki, Ranking, Loja, Jogar). E todo link do jogo
para o site (a loja, o calendário, o ranking do Eco, os Termos) tinha
`target=_blank`, que no WebView sem várias janelas vira navegação da página
inteira: o jogo sumia e o aplicativo virava o site.

**Agora são duas situações, e o `site/site.js` decide qual:**

| | quando | o que o site faz |
|---|---|---|
| **a porta** (`SITE.portaDoApp`) | no aplicativo, fora da aba — o WebView inteiro é a página | só a ENTRADA: a página da conta sem o menu e sem a sessão do topo (ficam a marca e o idioma); os Termos e a Privacidade, que o cadastro pede para ler, com um "← Voltar"; qualquer outra página manda para a entrada (sem sessão) ou para o jogo (com). Entrar, criar conta ou abrir a conta com a sessão boa leva direto ao jogo, com `location.replace` (o voltar do Android não reabre a entrada) |
| **a aba** (`SITE.naAba`) | no quadro da aba do site, dentro do jogo | o site de sempre, menos três coisas: o "Jogar" (todo link para `../index.html`) fecha a aba; link para fora do jogo ganha `target=_blank` (o navegador do aparelho); link nosso com `target=_blank` fica no quadro |

A porta só existe no aplicativo; a aba existe no aplicativo e, desde a loja
dentro do jogo (24/10, mais abaixo), também na web. "No aplicativo" é o mesmo
`SITE.noApp()` de 04/10 (o Capacitor nativo, o `?app=1` das provas ou a marca
`soterra-app` na sessão da aba). A `site/conta.html` põe a classe `porta-app`
já no topo, para o menu nem piscar; as outras páginas a recebem do `site.js`.

**A aba: `js/ui/site_aba.js` (`JOGO.SiteAba`).** Liga no aplicativo e na
web; a marca do aplicativo (`?app=1`) só vai quando é o aplicativo.

- O botão **Loja** com o saco (`IconesUI.svg('loja')`) e o botão **Site** com o
  globo (`IconesUI.svg('globo')`) ficam no menu, depois das Configurações, e na
  praça, antes do Menu. São LINKS (para `site/loja.html` e `site/index.html`,
  com `target=_blank`: Ctrl+clique ou botão do meio ainda abrem uma aba do
  navegador) que o ouvinte abre na aba de dentro do jogo.
- UM ouvinte de clique no `document` pega todo link do jogo
  para uma página do site (o globo, a pílula da loja, o sino, a faixa de
  eventos, o ranking do Eco, os Termos da ficha Contas, o "Ir para o site" da
  inatividade) e abre a aba. O "Sair do jogo" fica de fora: no aplicativo é da
  casca (pergunta e fecha o aplicativo — `js/mobile.js`); na web é a saída para
  o site.
- A aba é um quadro (`iframe`) da mesma origem por cima do jogo: a mesma
  sessão, e o jogo segue de pé embaixo. No aplicativo o quadro abre a
  primeira página com `?app=1`, para o site saber que está no aplicativo mesmo
  se o Capacitor não entrar no quadro.
- **Fechar:** o "Voltar ao jogo" do topo, o "Jogar" do site (postMessage
  `{soterra: 'site-aba', acao: 'jogo'}`, aceito só da mesma origem e só do
  quadro da aba), o Esc, ou a batalha que começa (`UI.showScreen('battle')`).
- **O voltar do Android** (`UI.voltar`, logo depois da compra pela Play): anda
  uma página para trás dentro da aba e, na primeira, fecha. Anda pela PRÓPRIA
  pilha com `location.replace`, nunca com `history.back()` — o histórico é um
  só para a página e o quadro, e um passo a mais levaria o jogo inteiro para
  trás.
- **O desenho para** enquanto a aba cobre a tela (`JOGO.Mobile.desenhoPausado`,
  que o `pulaQuadro` dos dois laços respeita) — fora da batalha, que corre.
- **Os 15 minutos.** O relógio da inatividade (`js/core/sessao.js`) só ouve a
  página do jogo; o toque dentro do quadro não sobe até ela. A aba repassa o
  toque (`Sessao.tocou`): sem isso, quem lê a wiki por 15 minutos perderia a
  sessão — e o site junto.
- **A conta que muda lá dentro.** Saiu da conta ou entrou em outra pelo site da
  aba: ao voltar ao jogo pelo "Jogar" (ou entrando de novo na aba), o jogo vai
  pelo mesmo caminho da capa "Entrar de novo" — token novo recarrega, sem token
  vai para a entrada.

**A loja na aba compra pela Play do JOGO.** A compra pela Google
(`js/core/compra_play.js`) é carregada pelo `index.html` do jogo, no quadro de
cima, onde a ponte do Capacitor está provada. Na aba, a `site/loja.js` usa esse
`JOGO.CompraPlay` (o `window.parent`) e o `site/loja.html` nem pede o seu: o
painel desenha no quadro (a folha de estilo vai para o documento do painel), o
clique roda no jogo, e a loja ouve o aviso `soterra:barras-play` na janela do
jogo (o ouvinte sai com a página). Assim não importa se o Capacitor entra ou
não num quadro.

**Precisa de AAB novo?** Não. Tudo é servido pela web.

**A loja dentro do jogo (24/10).** O dono: "onde o usuário consegue abrir a
loja dentro do jogo e já comprar ali, pagando pela Google ou pelo Mercado Pago".
O botão **Loja** abre a aba direto na loja do site, e a compra acontece ali:

| onde | como paga | o que acontece |
|---|---|---|
| aplicativo | Google Play, a do jogo (acima) | a tela da Google abre por cima, e o saldo da loja anda quando a Play confirma |
| web | Mercado Pago | a página do Mercado Pago não aceita ser posta num quadro: ela abre numa ABA NOVA do navegador, nascida no toque de "Ir para o pagamento" (o navegador barra a janela aberta depois de uma espera de rede), e recebe o endereço quando o servidor o devolve; deu errado, a aba nova fecha. De volta ao jogo, a loja relê o saldo e os pacotes na hora |

No aplicativo **não** há Mercado Pago: a Play não aceita pagamento de item
digital por fora da cobrança dela. Se o navegador barrar a aba nova mesmo assim,
o pagamento vai na página inteira (o jogo sai, e o que estava salvo fica).
Fora da aba do jogo (a loja como página do site) nada muda.

**O que liga cada caminho** (é do dono, no Coolify e nos painéis):

- **Mercado Pago:** `SOTERRA_MP_TOKEN` e `SOTERRA_MP_SEGREDO` no Coolify.
  Sem eles, os pacotes aparecem "em breve" (conferido no ar em 24/10:
  `pagamento.ligado` falso). Pendência jurídica antes de vender pela web: o site
  que vende precisa mostrar CNPJ ou CPF (`GOOGLE_PLAY.md` §7, item 6).
- **Google Play:** os quatro produtos na Play Console, a conta de serviço e a
  credencial no Coolify — `GOOGLE_PLAY.md` §9. Não depende da produção: a Play
  deixa cadastrar os produtos assim que recebe um AAB com a cobrança, e o 1.1.0
  já tem.

Prova: `tests/loja_na_aba.html` (15) — a aba na web sem a marca do aplicativo;
a aba nova do Mercado Pago aberta no toque, antes da resposta do servidor; o
endereço indo para ela com o quadro parado; a releitura do saldo na volta; a
aba nova fechando na recusa e no endereço que não é do Mercado Pago.

**As provas:**

```bash
# tests/site_aba.html     a aba de verdade com as páginas do site dentro (40): o globo, os links do jogo,
#                         o voltar do Android, o Esc, o "Jogar", a conta trocada, a loja pela Play do jogo, a web sem nada
# tests/site_porta.html   a entrada do aplicativo (19): a conta sem o menu, os jurídicos com o "← Voltar",
#                         as outras páginas mandadas embora, e a web igual
# tests/compra_play.html  33: a loja do aplicativo agora é a da aba, comprando pela Play do jogo
```

As duas primeiras precisam de um servidor na raiz (`python -m http.server`).

**Armadilha medida.** O `tests/compra_play.html` escreve a loja num quadro em
branco com `document.open()`, e o quadro HERDA o endereço da página que
escreve (`…/tests/compra_play.html?app=1`). Sem a marca da aba, o `site.js`
via "aplicativo fora da aba" e mandava a página para o jogo — a prova passou a
pôr a marca `JOGO.SiteAba` (é o jogo com a aba) e a tirá-la na metade da web.

**O que só o aparelho prova:** que o link para fora do jogo com
`target=_blank`, de dentro do quadro, abre o navegador do aparelho (o
Capacitor intercepta a navegação da página; dentro do quadro o esperado é o
mesmo); o botão voltar na entrada (sem ouvinte ali, o Capacitor volta no
histórico ou fecha o aplicativo); e a compra de verdade pela loja da aba.
