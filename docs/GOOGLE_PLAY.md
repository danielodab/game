# SOTERRA na Google Play

O caminho do jogo até a loja, do começo ao fim, para quem nunca publicou um
aplicativo. O que o aplicativo **é** e o que mudou no jogo por causa dele está
em [`CELULAR.md`](CELULAR.md); aqui é só o **como publicar**.

**O estado de hoje (04/10/2026):** o projeto Android existe (pasta `android/`),
o jogo já se comporta como aplicativo (botão voltar, segundo plano, tela acesa
na batalha, qualidade média), **abre o jogo direto do servidor** (atualiza junto
com a web — ver a seção 8) e oferece **Jogar agora** ou **Baixar tudo** para os
modelos 3D. A pasta `www/` sai com **3,3 KB**: é só a tela "sem conexão". O que
**não** foi feito nesta máquina: compilar. Ela não tem Java nem o Android SDK — o
primeiro APK e o primeiro AAB são seus, seguindo a seção 1.

> **O jogo da web não muda.** Tudo o que é do aplicativo só liga dentro dele
> (`JOGO.Mobile.app()`), e a prova `node tests/app_casca.js` cobra isso.

---

## 1. Do zero até o AAB assinado

### 1.1 O que instalar (uma vez)

| o que | para quê | onde |
|---|---|---|
| **Android Studio** | traz o Java (JDK), o Android SDK e o Gradle — não precisa instalar Java à parte | <https://developer.android.com/studio> |
| **Node.js** | já está instalado (o Capacitor é uma ferramenta Node) | — |
| **Python 3** | já está instalado (monta a `www/`) | — |

Ao abrir o Android Studio pela primeira vez, aceite a instalação padrão do SDK.
Depois, em **More Actions → SDK Manager**, confira que estão marcados
**Android SDK Platform 36** e **Android SDK Build-Tools**.

### 1.2 Preparar e testar no telefone

Tudo a partir da raiz do projeto.

```bash
npm install                      # uma vez: traz o Capacitor (lê o package.json)
npm run sync                     # monta a www/ e leva para o projeto Android
npx cap open android             # abre o Android Studio no projeto
```

No Android Studio: ligue o telefone por USB (com a **Depuração USB** ativada nas
opções de desenvolvedor do aparelho) e aperte o **▶ Run**. O jogo instala e abre.

Esse aplicativo de teste (o "debug") aceita o `chrome://inspect` do Chrome do
computador: é assim que se lê o console do jogo rodando no telefone. O de
publicação **não** aceita — o Capacitor desliga isso sozinho no AAB, e por isso
o `capacitor.config.json` não tem a chave `webContentsDebuggingEnabled`.

**Mexeu no jogo?** Basta publicar na web: o aplicativo abre o jogo do servidor.
O `npm run sync` + Run só é preciso quando muda a casca (a tela "sem conexão",
um plugin, o ícone).

> O aplicativo de teste também abre `https://soterra.viidoo.io`. Para testar no
> telefone uma mudança que ainda **não** está no ar, troque o `server.url` do
> `capacitor.config.json` pelo endereço do seu computador na rede de casa, só
> durante o teste — e **não** envie esse arquivo assim.

### 1.3 Criar a chave de assinatura (uma vez na vida)

A Play só aceita aplicativo assinado, e a chave é **sua para sempre**.

```bash
cd android
keytool -genkey -v -keystore soterra-envio.jks -keyalg RSA -keysize 2048 -validity 10000 -alias soterra
```

(O `keytool` vem com o Android Studio. Se o terminal não o achar, use o caminho
completo: `"C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"`.)

Ele pede uma senha e alguns dados (nome, cidade…). Depois:

1. copie `android/keystore.properties.exemplo` para `android/keystore.properties`
   e escreva nele as senhas que você acabou de criar;
2. **guarde uma cópia do `soterra-envio.jks` e das senhas fora do computador**
   (gerenciador de senhas, um pendrive guardado). Nenhum dos dois vai para o Git
   — o `android/.gitignore` cuida disso.

> Na primeira publicação a Play oferece a **Assinatura de apps do Google Play**:
> aceite. O Google passa a guardar a chave final e a sua vira a "chave de
> envio" — se um dia você a perder, dá para pedir outra ao suporte. Sem isso,
> perder a chave é nunca mais poder atualizar o aplicativo.

### 1.4 Gerar o AAB

O AAB é o arquivo que a Play recebe (o APK é só para instalar na mão).

```bash
npm run sync
cd android
./gradlew bundleRelease          # no PowerShell: .\gradlew.bat bundleRelease
```

O arquivo sai em `android/app/build/outputs/bundle/release/app-release.aab`,
já assinado com a chave do `keystore.properties`.

Pelo Android Studio é o mesmo: **Build → Generate Signed App Bundle / APK**.

### 1.5 A versão

Em `android/app/build.gradle`:

```
versionCode 1          // some 1 a CADA envio — a Play recusa número repetido
versionName "1.0.0"    // o que o jogador lê na loja
```

### 1.6 Onde enviar

<https://play.google.com/console> → **Criar app** → nome *SOTERRA*, idioma
*Português (Brasil)*, tipo *Jogo*, *Gratuito*. O AAB entra em
**Testar e lançar → Teste fechado** (ver a seção 6 — a conta pessoal nova não
publica direto).

O identificador do aplicativo é `br.com.soterra.jogo` e **não pode mudar**
depois do primeiro envio. Se quiser outro, troque antes (ver `CELULAR.md` §7, "Trocar o identificador").

---

## 2. O ícone e a tela de abertura

Hoje o projeto está com o ícone e a abertura **padrão do Capacitor** (um X azul).
A arte é sua; a máquina gera todos os tamanhos a partir de dois arquivos.

Crie a pasta `assets-app/` na raiz com:

| arquivo | tamanho | o que é |
|---|---|---|
| `icon-only.png` | **1024×1024** | o ícone inteiro, sem transparência |
| `icon-foreground.png` | 1024×1024 | só o desenho, com fundo transparente, **dentro do círculo central de ~66%** (o Android recorta em círculo, quadrado ou gota conforme o aparelho) |
| `icon-background.png` | 1024×1024 | o fundo liso do ícone (por exemplo o `#0b0d10` do jogo) |
| `splash.png` | **2732×2732** | a tela de abertura: o logotipo no centro, com muita margem (as bordas são cortadas) |
| `splash-dark.png` | 2732×2732 | a mesma, para o modo escuro (pode ser igual) |

```bash
npm install -D @capacitor/assets
npx @capacitor/assets generate --android --assetPath assets-app
npm run sync
```

Só com o `icon-only.png` e o `splash.png` já funciona; os outros melhoram o
recorte do ícone nos aparelhos novos.

Para a **ficha da loja** a Play pede, à parte (envia-se pelo Play Console):

| o quê | tamanho |
|---|---|
| ícone da loja | 512×512 PNG |
| imagem de destaque | 1024×500 PNG ou JPG |
| capturas de tela do telefone | de 2 a 8, entre 320 e 3840 px de lado; para jogos, pelo menos 3 em 16:9 (deitado) ou 9:16 (em pé) com no mínimo 1080 px |

---

## 3. A ficha da loja — pronta para colar

**Nome do app** (até 30 letras)

```
SOTERRA: Ecos do Mundo Enterrado
```

**Descrição curta** (até 80 letras)

```
RPG tático por turnos: forme sua dupla, funda heróis e desça aos calabouços.
```

**Descrição completa** (até 4.000 letras)

```
O mundo de cima acabou. O que sobrou dele está enterrado — e alguém precisa descer.

SOTERRA é um RPG tático por turnos em 3D. Você monta uma dupla de heróis, entra
pelos portais do Acampamento e enfrenta, sala por sala, o que vive lá embaixo.
Cada casa do tabuleiro conta: onde você pisa, quem você empurra, o que fica entre
você e o inimigo.

MONTE A SUA DUPLA
Escolha entre classes com jeitos de lutar bem diferentes — quem aguenta a
pancada, quem cura, quem invoca, quem ataca de longe, quem some e reaparece
pelas costas. Cada herói segue um caminho elemental e ganha feitiços novos a
cada nível.

FUNDA OS HERÓIS
No meio da batalha os dois heróis podem virar um só: uma fusão com corpo,
feitiços e poder próprios. Cada par de classes dá uma fusão diferente.

DESÇA AOS CALABOUÇOS
Cada portal leva a um lugar com monstros, armadilhas e um chefe só dele. Há
desafios em cada sala para quem quer prêmio melhor — e heróis de vida única
para quem quer risco de verdade.

JOGUE COM OUTRAS PESSOAS
O Acampamento é uma praça viva: converse, forme grupo e desça junto. Desafie
outros jogadores na Arena, suba no ranking, entre numa guilda e dispute as
guerras entre guildas.

FORJE, TROQUE, COLECIONE
Itens raros, pedras para forjar e melhorar o equipamento, mascotes que
acompanham a dupla e um mercado entre jogadores.

FEITO PARA O CELULAR
Toque uma vez para mirar e ver a área do feitiço, toque de novo para confirmar.
Joga-se em pé ou deitado, e a qualidade gráfica se ajusta ao aparelho — dá para
trocar nas Configurações.

A MESMA CONTA NO CELULAR E NO COMPUTADOR
O progresso fica guardado no servidor: comece no telefone e continue no
navegador do computador, com a mesma conta.

SOTERRA precisa de internet para jogar. Na primeira abertura você escolhe:
jogar agora, baixando cada mapa quando entra nele, ou baixar tudo de uma vez
(cerca de 250 MB, de preferência no Wi-Fi) para os mapas abrirem sem esperar.
```

Confira os números antes de colar: se for citar quantas classes, calabouços ou
fusões existem, escreva o que estiver valendo no dia. O texto acima não cita
nenhum de propósito, para não envelhecer.

**Outros campos da ficha**

| campo | o que pôr |
|---|---|
| Categoria | Jogos → RPG (ou Estratégia) |
| Tags | Tático, RPG por turnos, Multijogador |
| E-mail de contato | o mesmo da Política de Privacidade (seção 12 dela) |
| Política de privacidade | `https://soterra.viidoo.io/site/privacidade.html` |
| Contém anúncios | Não |

---

## 4. Segurança dos dados (o formulário da Play)

As respostas saem da [`site/privacidade.html`](../site/privacidade.html) (versão
de 06/10/2026). Se a política mudar, este formulário muda junto.

**As três primeiras perguntas**

| pergunta | resposta |
|---|---|
| O app coleta ou compartilha dados do usuário? | **Sim** |
| Todos os dados são criptografados em trânsito? | **Sim** (tudo vai por HTTPS; seção 7 da política) |
| Há como o usuário pedir a exclusão dos dados? | **Sim** |

**Exclusão de conta** (a Play pede os dois caminhos)

- **Dentro do app:** ficha **Contas** → **Excluir conta** (pede o nome e a senha).
- **Pela web:** `https://soterra.viidoo.io/site/conta.html` (o botão "Excluir
  conta" da página da conta). É este o endereço que vai no campo "URL de
  exclusão de conta".
- O que fica depois da exclusão (a Play pergunta): o registro dos pagamentos,
  sem nome e sem e-mail, pelo prazo da lei; e o histórico da moderação, com o
  nome de jogador da época (seção 9 da política).

**Os tipos de dado** — em todos: *Coletado* **Sim**, *Compartilhado* **Não**,
*Processado de forma temporária* **Não**.

| tipo (nome da Play) | o que é no SOTERRA | obrigatório? | finalidades |
|---|---|---|---|
| Informações pessoais → **Endereço de e-mail** | o e-mail da conta | obrigatório | Gerenciamento de contas; Funcionalidade do app |
| Informações pessoais → **IDs de usuário** | o nome de jogador e o número da conta | obrigatório | Gerenciamento de contas; Funcionalidade do app |
| Informações financeiras → **Histórico de compras** | pacote, valor, situação e datas das compras | opcional (só quem compra) | Funcionalidade do app; Prevenção de fraudes, segurança e conformidade |
| Mensagens → **Outras mensagens no app** | só as falas do chat que um jogador **anexa a uma denúncia**, e a mensagem do mural da guilda. O chat em si **não é gravado** (seção 3 da política) | opcional | Funcionalidade do app; Prevenção de fraudes, segurança e conformidade |
| Atividade no app → **Interações no app** | o progresso (heróis, itens, salas, duelos), amigos, guilda, mercado | obrigatório | Funcionalidade do app; Prevenção de fraudes, segurança e conformidade |
| Informações e desempenho do app → **Registros de falhas** e **Diagnóstico** | a mensagem do erro, a versão do jogo, a tela e o tipo de navegador | obrigatório | Análise; Funcionalidade do app |

> **06/10 — com o anúncio premiado (seção 10) este formulário MUDA:** o SDK de
> anúncios da Google coleta o identificador de publicidade e deduz o local
> aproximado. O que acrescentar está na seção 10.4.

**O que NÃO se marca** (seção 3 da política; ver o aviso acima): localização, contatos, fotos e
vídeos, arquivos, agenda, áudio, saúde, navegação na web, identificadores do
aparelho ou de publicidade. Dados de cartão, Pix e CPF não passam pelo jogo.

**Sobre "compartilhado":** a Play não conta como compartilhamento o que vai para
um prestador que trabalha para você (a hospedagem, o provedor de e-mail). Por
isso tudo está como "Não". **Confira com o advogado** junto com o que foi
preenchido na política em 06/10 (a Play lê a página; ela não tem mais campo em
branco — a lista do que conferir está em
[`REVISAO_JURIDICA.md`](REVISAO_JURIDICA.md), "Preenchido em 06/10").

**O endereço IP:** o servidor o guarda nas sessões e nos freios contra abuso
(seção 2). A Play não tem um tipo "IP"; ele não é usado para localizar ninguém,
então **não** se marca "Localização".

---

## 5. Classificação indicativa

O Play Console tem um questionário (IARC) que dá a classificação de todos os
países de uma vez — no Brasil, a do ClassInd. As respostas do SOTERRA:

| pergunta | resposta |
|---|---|
| Categoria | Jogo |
| Violência | **Sim, leve e fantasiosa**: batalhas por turnos contra monstros, sem sangue nem mutilação |
| Sexualidade, nudez | Não |
| Linguagem imprópria | Não no conteúdo do jogo |
| Drogas, álcool, tabaco | Não |
| Jogos de azar com dinheiro real | Não |
| **Os usuários podem interagir ou trocar conteúdo?** | **Sim** — há chat entre jogadores (praça, mensagem particular, guilda), com denúncia e moderação |
| **O app compartilha a localização do usuário com outros?** | Não |
| **O app permite comprar itens digitais?** | **Sim** — as barras de ouro, pela cobrança da Google (seção 9) |

O resultado esperado é **Livre ou 10 anos**, com os avisos "Interação entre
usuários" e "Compras no app". Com a área "Ganhar prêmios" (seção 10) entra também
o aviso **"Contém anúncios"**.

À parte, a Play pergunta o **público-alvo**. Marque **13 anos ou mais** (ou só
18+): marcar faixas abaixo de 13 põe o aplicativo no programa "Feito para
famílias", que tem regras bem mais duras para jogos com chat. Confira com a
idade mínima dos seus Termos de Uso — as duas têm de combinar.

---

## 6. O teste fechado que a conta pessoal exige

A sua conta ("Oda Studio", pessoal, em verificação) é do tipo que **não publica
direto**. Para liberar a produção a Google exige:

- um **teste fechado** com pelo menos **12 testadores**
- que fiquem **inscritos por 14 dias seguidos**.

> **Confira o número atual no Play Console** (Painel → "Solicitar acesso de
> produção"): a regra já foi de 20 testadores e pode mudar de novo.

Como fazer:

1. Espere a verificação da conta terminar (identidade e, às vezes, um aparelho
   Android de verdade conferido pelo app Play Console).
2. **Testar e lançar → Teste fechado → Criar faixa**. Envie o AAB.
3. Em **Testadores**, crie uma lista com os e-mails (contas Google) das 12
   pessoas — peça uns 15 a 20, porque sempre alguém não entra.
4. Mande a cada um o **link de participação** que o console mostra. A pessoa
   precisa **aceitar o convite e instalar pela Play**. Só conta quem aceitou.
5. Os 14 dias contam a partir do momento em que há 12 inscritos. Quem sair
   antes derruba a contagem — avise o pessoal para não desinstalar.
6. Passados os 14 dias, **Solicitar acesso de produção**. A Google faz algumas
   perguntas sobre o teste (o que os testadores acharam, o que você mudou).
   Responda com fatos: ajuda ter enviado ao menos uma atualização no período.

O teste **interno** (até 100 pessoas, sai em minutos) não conta para essa regra,
mas é o melhor jeito de você mesmo instalar pela Play antes de chamar os outros.

---

## 7. O que ainda falta — e depende de você

**Antes do primeiro envio**

1. **Instalar o Android Studio e gerar o primeiro APK** (seção 1). Nada foi
   compilado até agora: o projeto `android/` nunca passou pelo Gradle. Se algo
   falhar no primeiro `Run`, é ali que aparece.
2. **Jogar no telefone de verdade.** O botão voltar, o segundo plano, a tela
   acesa, a escolha dos modelos e a tela "sem conexão" foram provados no
   navegador (`tests/app_casca.html`, `tests/app_modelos.html`); o aparelho é a
   prova que falta. A lista do que conferir nele está na seção 8.4.
3. **Publicar este lote na web ANTES de instalar o aplicativo.** O aplicativo
   abre `https://soterra.viidoo.io`: enquanto o servidor estiver com o código
   antigo, ele abre o jogo **sem** a escolha dos modelos e **sem** botão voltar
   (o servidor ainda não entrega `js/app_modelos.js` nem `vendor/capacitor/`).
4. **A compra de barras pela Google Play.** O código está pronto (04/10): dentro
   do aplicativo o Mercado Pago não aparece e as barras são compradas pela
   cobrança da Google. Falta o que só a conta aprovada permite: cadastrar os
   quatro produtos, criar a conta de serviço e pôr a credencial no servidor. O
   passo a passo é a **seção 9**. Enquanto isso não for feito, a tela da compra
   no aplicativo diz "chega em breve" e nada mais quebra.
5. **A arte:** ícone 1024×1024, tela de abertura, ícone da loja 512×512, imagem
   de destaque 1024×500 e as capturas de tela (seção 2).
6. **Os `[PREENCHER]` da Política de Privacidade e dos Termos: preenchidos em
   06/10** (responsável Oda Studio - DOB, pessoa física, sem CNPJ; contato e
   encarregado em system@viidoo.io; Hostinger; Google Workspace; idade mínima de
   13 anos; foro do domicílio do consumidor; prazos de guarda). A Play abre o
   link e não acha mais campo em branco. **Resta conferir** (a lista inteira
   está em [`REVISAO_JURIDICA.md`](REVISAO_JURIDICA.md), "Preenchido em 06/10"):
   - o **país da hospedagem** — "Estados Unidos" saiu do registro público do
     endereço IP; confirme no painel da Hostinger;
   - o **encarregado** está pelo nome do estúdio, não de uma pessoa — a ANPD
     costuma esperar a identidade;
   - **sem CNPJ nem CPF** na página: o decreto do comércio eletrônico pede um
     dos dois no site que vende;
   - os prazos de **5 anos** (pagamentos) e **2 anos** (moderação) são
     compromisso: o servidor ainda não apaga sozinho;
   - o **e-mail de contato da ficha** (seção 3) e o do formulário de segurança
     dos dados têm de ser o mesmo system@viidoo.io;
   - a revisão do advogado, que continua valendo para os dois documentos.
7. **A chave de assinatura** (seção 1.3) — e a cópia dela fora do computador.

**Para decidir**

8. **O domínio.** O aplicativo abre `https://soterra.viidoo.io` (a constante
   `SERVIDOR` em `tools/empacota_www.py` e o `server.url` do
   `capacitor.config.json` — o script recusa montar se diferirem). Se o jogo
   for mudar de endereço, mude **antes** de publicar: aplicativo já instalado
   continua abrindo o endereço antigo até o jogador atualizar, e os modelos
   guardados no aparelho são do endereço antigo (baixam de novo).
9. **O identificador `br.com.soterra.jogo`.** Depois do primeiro envio não muda
   mais. O costume é usar um domínio que seja seu ao contrário (por exemplo
   `io.viidoo.soterra`).
10. **O jogo vem do servidor — decidido em 04/10.** Mudou a web, mudou o
    celular, sem AAB novo. O preço e o que a Play pode perguntar estão na seção 8.
11. **iOS** não foi tocado.

---

## 8. O jogo vem do servidor: o que isso é e o que a Play pode questionar

**O que foi decidido (04/10):** o aplicativo não leva o código do jogo. A cada
abertura ele carrega o jogo de `https://soterra.viidoo.io` (o `server.url` do
Capacitor). Assim a web e o celular têm sempre as mesmas regras, na hora, sem
esperar a revisão da loja. O lado técnico está no `CELULAR.md` §3.

### 8.1 É permitido?

**Sim, com cuidados.** A regra da Play contra "baixar código de fora da loja"
fala de código executável nativo (dex, JAR, `.so`) e **abre exceção, por
escrito, para código que roda numa máquina virtual ou interpretador com acesso
indireto às APIs do Android — "como JavaScript num WebView ou navegador"**
(política *Abuso de dispositivo e rede*). É o caso: o jogo é JavaScript num
WebView, e a parte nativa (o Capacitor e os plugins) vai inteira no AAB.

### 8.2 O que a revisão pode perguntar — e a resposta

| o que a Play olha | o risco | o que já está feito / o que responder |
|---|---|---|
| **"É só um site embrulhado"** (*Funcionalidade mínima*, *Webviews*) | recusa de aplicativo que só mostra uma página da web sem nada de aplicativo | é um jogo, não uma página de conteúdo; tem botão voltar próprio, tela acesa na batalha, segundo plano, modelos guardados no aparelho, tela de "sem conexão". O site é **seu** — se pedirem, comprove a posse do domínio (Play Console → verificação do site, ou o arquivo `assetlinks.json`) |
| **Tela branca ou travada sem internet** (*Funcionalidade quebrada*) | o revisor abre em modo avião e vê nada | a tela "Sem conexão — Tentar de novo" (`app/index.html`) |
| **O aplicativo muda depois da revisão** (*Comportamento enganoso*) | usar o servidor para ligar algo que a revisão não viu | **tudo o que for publicado na web passa a valer para o aplicativo, e as regras da Play valem para tudo isso.** Não publique na web nada que a Play proíbe (ver 8.3) sem antes esconder do aplicativo |
| **Pagamento** | vender item digital por fora da cobrança da Google | ver 8.3 — é o ponto mais sério |
| **A ficha e a classificação continuam verdadeiras** | o jogo ganha chat, compra ou conteúdo novo e a ficha não acompanha | mudou algo assim na web → refaça o questionário de classificação e a *Segurança dos dados* no Play Console, mesmo sem enviar AAB |
| **Links para fora** | — | qualquer domínio que não seja o do jogo abre no navegador do aparelho, não dentro do aplicativo |

**O jogo guardado no aparelho (06/10) não muda nada disto.** São arquivos do
próprio jogo num cache do aplicativo, para abrir mais rápido; o jogo continua
somente online e a tela "Sem conexão" continua valendo. **O formulário de
*Segurança dos dados* não muda:** nada novo é coletado nem enviado — o que se
guarda são arquivos públicos do jogo, no aparelho, e nenhum dado do jogador.
Nenhuma permissão nova do Android, nenhum plugin novo, **nenhum AAB novo**.
Se a ficha da loja disser "jogue offline", está errada: não diga.

O próprio Capacitor escreve, na documentação do `server.url`, que ele foi
pensado para desenvolvimento e "não para produção". **Não é uma proibição da
loja**; é um aviso de que o aplicativo passa a depender do servidor: sem
internet não abre (por isso a tela "sem conexão"), e um servidor fora do ar
derruba o celular junto com a web.

**Se a Play recusar** esse modelo, a volta é curta e está guardada: tire `url`
e `errorPath` do `capacitor.config.json` e monte a `www/` com
`python tools/empacota_www.py --embutida` (o código vai dentro do aplicativo,
13,7 MB, como era antes). O preço volta a ser um AAB a cada mudança do jogo.

### 8.3 A compra de item digital tem de ser pela Google

Dentro do aplicativo da Play, **todo item digital do jogo** (moedas, pacotes,
qualquer coisa que se usa dentro do jogo) só pode ser vendido pela **cobrança
do Google Play** (Play Billing). Hoje a loja do jogo usa o Mercado Pago. Isso
vale mesmo com o jogo vindo do servidor — **e fica mais delicado**, porque a
loja da web aparece no aplicativo no instante em que for publicada.

- **Feito em 04/10:** dentro do aplicativo (`JOGO.Mobile.app()` no jogo,
  `SITE.noApp()` no site) a loja **não mostra** o Mercado Pago: nem botão, nem
  preço em reais, nem o nome dele, nem "Seus pacotes". No lugar entra a compra
  pela Google (`js/core/compra_play.js`), no jogo (Configurações → *Barras de
  ouro*) e na loja do site aberta dentro do aplicativo. **Gastar** barras
  (personagens, auras, pedras, presente) continua igual. A prova é
  `tests/compra_play.html`.
- **A regra que fica para sempre:** dentro do aplicativo, **nunca** escreva
  "compre pelo site", "mais barato no site", nem ponha link para pagar fora. A
  Play proíbe levar o jogador a outro meio de pagamento — vale para tela, aviso,
  correio do jogo e mensagem de evento. Como o jogo vem do servidor, um texto
  assim publicado na web aparece no aplicativo na mesma hora.
- A Google fica com uma parte de cada venda (seção 9.6).
- A loja da web, para quem joga no computador, **continua como está** (Mercado
  Pago).

### 8.4 O que conferir no aparelho (nada disto pôde ser provado aqui)

Esta máquina não compila. Tudo abaixo foi lido no código do Capacitor 8 ou
provado no Chrome com a casca fingida — falta o telefone:

1. **Abre do servidor** e o `JOGO.Mobile.app()` é verdadeiro (a qualidade abre
   em média, o `<html>` tem a classe `app`).
2. **Botão voltar e tela acesa** funcionam com o jogo servido (a ponte do
   Capacitor na página do servidor).
3. **Modo avião ao abrir:** aparece "Sem conexão"; ligando a rede, o jogo abre.
   Confira também o botão voltar **nessa** tela (lá o jogo não está carregado).
4. **A escolha dos modelos:** aparece na primeira abertura; "Baixar tudo" mostra
   a barra em MB.
5. **A retomada:** no meio do download, feche o aplicativo (tire da lista de
   recentes) e abra de novo — a barra tem de recomeçar de onde parou.
6. **Dados móveis:** com o Wi-Fi desligado, a tela avisa antes de baixar.
7. **O espaço:** Configurações → *Modelos no aparelho* mostra os MB; em
   Android → Apps → SOTERRA → Armazenamento, o número aparece em **Dados** (não
   em Cache). "Limpar cache" do Android **não** pode apagar os modelos.
8. **Depois de um deploy na web:** feche e abra o aplicativo — o jogo novo tem
   de aparecer sem reinstalar.
9. **A loja do site aberta dentro do aplicativo** (a pílula da praça, o link da
   aura) abre no próprio aplicativo e **não** mostra Mercado Pago: mostra os
   quatro pacotes com o preço da Google.
10. **A compra pela Google** (seção 9.5): a tela da Google abre, as barras
    entram, e o mesmo pacote pode ser comprado de novo em seguida (sinal de que
    a compra foi consumida).

**O jogo guardado no aparelho (06/10 — `docs/CELULAR.md`, seção 9).** O
aplicativo passou a registrar um service worker que guarda os `.js`/`.css`.
Provado num Chrome; no WebView com o Capacitor, falta:

11. **Guarda:** abra o jogo duas vezes. Em `chrome://inspect` → Application →
    *Service Workers* aparece o `/sw.js` ativo, e em *Cache Storage* o
    `soterra-jogo-1` com os arquivos. Configurações → *Jogo no aparelho* mostra
    os MB (uns 12 depois de "Baixar tudo").
12. **Modo avião DEPOIS de guardar:** feche o aplicativo, ligue o modo avião,
    abra. Tem de aparecer **"Sem conexão"** — nunca o jogo. (O service worker
    não responde pela página; se o jogo abrir, feche as válvulas.)
13. **Depois de um deploy na web:** feche e abra — o jogo novo aparece, e em
    *Network* só o que mudou vem da rede (o resto diz *ServiceWorker*).
14. **Apagar:** Configurações → *Apagar o jogo guardado* → o `/sw.js` some da
    lista e o cache também; abrir de novo não registra. *Guardar o jogo* volta.
15. **Botão voltar, tela acesa e compra pela Google** continuam funcionando com
    o service worker ativo (a ponte do Capacitor não passa por ele, mas é a
    primeira vez que os dois convivem).

---

## 9. A compra de barras pela Google Play — o que fazer quando a conta for aprovada

**O que já está pronto (04/10):** o aplicativo já fala com a cobrança da Google
(plugin `@capgo/native-purchases`, Play Billing 9), o servidor já confere cada
compra na Google antes de creditar (`servidor/pagamento_play.py`) e a loja de
dentro do aplicativo já não mostra o Mercado Pago. **O que falta é só o que
depende da sua conta:** os produtos, a conta de serviço e a credencial.

**Como funciona, em quatro linhas.** O jogador toca em "Comprar" e a Google
cobra. O aplicativo manda o recibo (o *purchaseToken*) ao servidor do jogo. O
servidor pergunta à Google se aquele recibo é de uma compra paga, deste
aplicativo e deste pacote — e só então põe as barras na conta, uma vez. Aí o
aplicativo "consome" a compra na Google, o que libera comprar o mesmo pacote de
novo. Se o aplicativo fechar no meio, ele retoma sozinho na próxima abertura.

### 9.1 Antes: um AAB novo e o perfil de pagamentos

1. Rode `npm install` e `npm run sync` e gere um AAB novo (seção 1.4): o
   aplicativo ganhou a biblioteca de cobrança, e a Play só deixa criar produto
   depois de receber um AAB que a tenha. Suba-o no teste interno ou fechado.
2. No Play Console, crie o **perfil de pagamentos** (*Configuração → Perfil de
   pagamentos*): é a conta que recebe o dinheiro. Sem ele não há produto.

### 9.2 Cadastrar os quatro produtos

Play Console → o aplicativo → *Monetizar com o Google Play → Produtos →
Produtos de compra única* (antes chamava "Produtos no app") → *Criar produto*.

| ID do produto (exatamente assim) | Nome | Preço no Brasil | Barras |
|---|---|---|---|
| `barras_50` | Bolsa de 50 barras de ouro | R$ 4,90 | 50 |
| `barras_280` | Saco de 280 barras de ouro | R$ 19,90 | 280 |
| `barras_600` | Arca de 600 barras de ouro | R$ 39,90 | 600 |
| `barras_1250` | Tesouro de 1.250 barras de ouro | R$ 79,90 | 1.250 |

- **O ID é com sublinhado**, não com hífen: a Play só aceita letra minúscula,
  número, sublinhado e ponto. No jogo o pacote chama `barras-50`; o servidor
  troca o hífen pelo sublinhado num lugar só (`produto_play`, em
  `servidor/pagamento_play.py`). **O ID não pode ser mudado nem reaproveitado
  depois de criado.**
- É produto de **compra única**, do tipo que se compra várias vezes
  (consumível). **Não** é assinatura. Deixe a opção de **comprar várias
  unidades de uma vez desligada**.
- O preço no aplicativo é **o que você cadastrar aqui** (a Google converte para
  os outros países). Use os mesmos do site. Se um dia mudar o preço no site
  (`PACOTES`, em `servidor/loja.py`), mude aqui também — o teto de R$ 400 por
  dia é contado pelo preço do site.
- **Ative** cada produto. Produto inativo não aparece no aplicativo (a tela diz
  "os pacotes ainda não estão disponíveis").

### 9.3 Criar a conta de serviço (a chave que deixa o servidor perguntar à Google)

1. Entre em <https://console.cloud.google.com> com a mesma conta Google. Crie
   um projeto (por exemplo "soterra-servidor").
2. *APIs e serviços → Biblioteca* → procure **Google Play Android Developer
   API** → **Ativar**.
3. *IAM e administrador → Contas de serviço → Criar conta de serviço*. Dê um
   nome (por exemplo "soterra-compras"). Não precisa dar papel nenhum no
   projeto. Anote o e-mail dela (termina em `.iam.gserviceaccount.com`).
4. Abra a conta de serviço → aba *Chaves → Adicionar chave → Criar nova chave →
   JSON*. Um arquivo `.json` é baixado. **Esse arquivo é uma senha**: não mande
   por chat, não ponha no Git. Se vazar, apague a chave aqui e crie outra.
5. No **Play Console** → *Usuários e permissões → Convidar novos usuários* →
   cole o e-mail da conta de serviço. Em *Permissões do app*, escolha o SOTERRA
   e marque:
   - **Ver dados financeiros, pedidos e respostas à pesquisa de cancelamento**;
   - **Gerenciar pedidos e assinaturas**.

   Convide. (É esse "acesso financeiro" que deixa o servidor conferir as
   compras e ver os reembolsos.)
6. **Paciência:** a Google pode levar **até um dia** para a permissão valer.
   Enquanto isso o servidor recebe "não autorizado" e o jogador vê "a Google
   Play não respondeu"; nada é creditado errado.

### 9.4 Pôr a credencial no servidor (Coolify)

No Coolify, em *Environment Variables* do jogo (Runtime **ligado**, Build
**desligado**, **Is Literal** marcado):

| Nome | Valor |
|---|---|
| `SOTERRA_PLAY_CREDENCIAL` | o conteúdo **inteiro** do arquivo `.json` da conta de serviço, colado (começa com `{` e termina com `}`). Também serve o caminho de um arquivo dentro do contêiner, por exemplo `/dados/play.json` |
| `SOTERRA_PLAY_TESTE` | `1`, **só na fase de teste** (aceita compra de teste, que não cobra nada). Tire antes de abrir ao público |
| `SOTERRA_PLAY_PACOTE` | só se o identificador do aplicativo deixar de ser `br.com.soterra.jogo` |

Salve e faça **Redeploy**. Nos *Runtime Logs* tem de aparecer
`pagamento: Google Play ligada (br.com.soterra.jogo…)`. Se aparecer
`Google Play desligada (…)`, o texto entre parênteses diz o que faltou. A chave
nunca é escrita no log.

Sem a variável, tudo continua funcionando: a tela do aplicativo diz "chega em
breve" e as rotas respondem 503.

### 9.5 Testar sem gastar dinheiro

1. Play Console → *Configurações → Teste de licença* → adicione o seu Gmail (e o
   de quem for testar). Deixe a resposta em `RESPOND_NORMALLY`.
2. Esses mesmos Gmails têm de ser **testadores** da faixa onde o AAB está
   (teste interno ou fechado) e instalar o aplicativo **pela Play** (o link de
   participação), no telefone logado com esse Gmail.
3. Com `SOTERRA_PLAY_TESTE=1` no servidor, abra o aplicativo → Configurações →
   *Barras de ouro* → *Comprar barras de ouro*. A tela da Google mostra
   "Cartão de teste, sempre aprovado": nada é cobrado.
4. O que conferir:
   - as barras entram e o extrato da loja mostra "… (Google Play)";
   - dá para comprar **o mesmo pacote de novo** em seguida (a compra foi consumida);
   - com "Cartão de teste, sempre recusado", nada entra;
   - com a forma de pagamento de teste **lenta** ("aprovado depois de alguns
     minutos"), a tela diz que a Google ainda espera o pagamento e, minutos
     depois, ao voltar ao aplicativo, as barras entram sozinhas;
   - **a retomada:** compre e, assim que a Google confirmar, feche o aplicativo
     à força; ao abrir de novo aparece "Chegaram N barras de ouro…";
   - **o reembolso:** no Play Console → *Gerenciamento de pedidos*, reembolse o
     pedido de teste **marcando para remover o direito**. No painel do Mestre
     aparece o alerta de estorno em até 6 horas, e as barras saem.
5. **Tire** o `SOTERRA_PLAY_TESTE` e faça Redeploy antes de abrir ao público: sem
   ela, compra de teste não vale barras.

### 9.6 O que a Play cobra

A Google fica com **15%** de cada venda até o primeiro US$ 1 milhão por ano —
**desde que a conta entre no programa de taxa de serviço de 15%** (no Play
Console, na configuração da conta de desenvolvedor; é um formulário, uma vez).
Sem a inscrição, a taxa é **30%**. Do pacote de R$ 19,90 sobram cerca de
R$ 16,90 antes dos impostos. O pagamento cai uma vez por mês no perfil de
pagamentos. Confira a taxa vigente no Play Console: a Google muda essas regras
de tempos em tempos.

### 9.7 Reembolso, arrependimento e fraude

- **Quem reembolsa é a Google** (o jogador pede na Play, ou você reembolsa em
  *Gerenciamento de pedidos*). O servidor pergunta à Google **de 6 em 6 horas**
  o que foi reembolsado, cancelado ou contestado nos últimos 30 dias, e tira da
  conta as barras daquela compra que ainda estiverem lá. O que já foi gasto
  vira **alerta no painel do Mestre** ("faltou"), como no estorno do Mercado
  Pago — você decide o que fazer.
- **O aviso na hora** (a Google chama de *Notificações do desenvolvedor em tempo
  real*) **não foi ligado**: ele exige criar um tópico no Google Cloud Pub/Sub e
  conferir a assinatura de cada aviso. A pergunta de 6 em 6 horas cobre o mesmo
  caso com atraso; se um dia o atraso incomodar, é a evolução natural.
- **Compra que o servidor não confirmou** (o jogador pagou e o servidor estava
  fora, ou a conta bateu no teto de R$ 400 em 24 h, ou a conta foi banida): o
  aplicativo tenta de novo a cada abertura. Se em **3 dias** ninguém confirmar,
  **a Google devolve o dinheiro sozinha**. Ninguém paga sem receber.
- O teto de **R$ 400 por conta em 24 h** vale somando o site e o aplicativo.
- A compra feita logado numa conta do jogo só vale **naquela** conta.

### 9.8 O que não pôde ser provado sem a conta e sem aparelho

Tudo o que é do servidor e da tela foi provado com uma Google de mentira
(`tests/pagamento_play_api.py`, `tests/compra_play.html`). Falta, e só o
aparelho mostra:

1. **O projeto compila** com o plugin de cobrança (nada foi compilado aqui).
2. **A ponte do plugin na página do servidor** e na loja do site aberta dentro
   do aplicativo (mesma origem; lido no código do Capacitor, não visto rodar).
3. **A conversa de verdade com a Google:** o servidor assina o pedido de acesso
   sem biblioteca externa (a assinatura foi comparada com a do `openssl` e
   bateu), mas nunca falou com a Google real.
4. **Os textos de erro do plugin** ("cancelado", "pendente", "você já tem este
   item") foram lidos no código dele; um aparelho pode mostrar outro caso.
5. **Os nomes dos menus do Play Console** mudam de tempos em tempos: se um
   caminho acima não existir, procure pelo nome da função.

---

## 10. "Ganhar prêmios": o anúncio premiado (AdMob) — o que fazer

**O que é (06/10/2026).** Uma área **opcional**, só no aplicativo, nas
Configurações → **Ganhar prêmios**. O jogador entra, escolhe o prêmio e toca em
**Assistir anúncio**. Visto até o fim, ganha:

| prêmio | por anúncio | limite por conta, por dia (vira à 00:00 de Brasília) |
|---|---|---|
| vinténs | **50** | **5** |
| barra de ouro | **1** | **5** |

Os dois limites são separados (até 10 anúncios por dia, 5 de cada). Fechou antes
do fim: não ganha nem perde. Os números moram em `servidor/anuncio.py`
(`ANUNCIO_VINTENS`, `ANUNCIO_BARRAS`, `ANUNCIO_MAX_DIA`): mudar é mexer ali e
publicar o servidor — não precisa de AAB novo. A troca de vinténs por barras da
loja não mudou.

**A regra que não se quebra** (sua, e cobrada por `node tests/premio_anuncio.js`):
anúncio **só** nessa área e **só** depois do toque. Não há banner, intersticial
nem anúncio de abertura; nada de anúncio é carregado, ligado ou perguntado antes
de o jogador **entrar** na área (nem a tela de privacidade da Google); na web a
área não existe e nenhum código de anúncio é pedido.

**Quem dá o prêmio é o servidor**, e só quando a **Google** o avisa com a
assinatura dela (a "verificação pelo servidor", SSV). O aplicativo nunca credita
nada. Ver [`SEGURANCA.md`](SEGURANCA.md), "O anúncio premiado".

### 10.1 Antes de tudo: é preciso um AAB novo

O plugin de anúncio (`@capacitor-community/admob` 8.2.0) é código **nativo**: ele
só existe no aplicativo depois de **recompilar**. Na pasta onde você compila:

```
git pull
npm install
npm run sync          (monta a www/ e roda o npx cap sync android)
```

Depois, o de sempre (seção 1.4): subir o `versionCode`, gerar o AAB assinado,
enviar. Quem está com o aplicativo antigo **não vê nada quebrar**: a tela da
área diz "Atualize o aplicativo pela Play Store". O `AndroidManifest.xml` já leva
o id do aplicativo no AdMob (`ca-app-pub-4989579635131748~7013903357`) e a
permissão `AD_ID`.

O servidor precisa da biblioteca `cryptography` (para conferir a assinatura): o
`Dockerfile` já a instala (`py3-cryptography`); basta **reimplantar** no Coolify.
Sem ela a área responde "não disponível" e nada é creditado.

### 10.2 Colar a URL de verificação no bloco premiado (AdMob)

1. Abra **https://admob.google.com** → **Apps** → SOTERRA → **Blocos de anúncios**
   → o bloco premiado (`ca-app-pub-4989579635131748/7206484209`).
2. Em **Configurações avançadas** → **Verificação pelo servidor** (Server-side
   verification), cole exatamente:

   ```
   https://soterra.viidoo.io/api/anuncio/premio
   ```

3. Clique em **Verificar URL**. O servidor responde 200 (com
   `"creditado": false`, porque o teste da Google não traz bilhete) — é o
   esperado. Salve.
4. A "recompensa" cadastrada no bloco (nome e quantidade) **não importa**: o
   servidor ignora o que vem ali e dá o prêmio do bilhete. Pode deixar "1 premio".

A mudança leva até **algumas horas** para valer nos anúncios.

### 10.3 Cadastrar o SEU telefone como aparelho de teste

**Clicar no próprio anúncio de verdade suspende a conta do AdMob.** Proteções
que já existem:

- o APK de **depuração** (o do `Run` no Android Studio) usa sempre o bloco de
  **teste** da Google (`ca-app-pub-3940256099942544/5224354917`), nunca o seu.
  Ali o anúncio aparece com a faixa "Test Ad" e **o prêmio não chega** (o bloco
  de teste é da Google e não avisa o seu servidor) — a tela diz isso;
- a conta do **Mestre** não recebe bilhete: logado como Mestre, os botões ficam
  apagados.

Para testar o caminho inteiro (AAB de verdade, conta de jogador comum) sem risco,
cadastre o telefone:

1. No telefone: **Configurações → Google → Anúncios** e copie o **ID de
   publicidade** (se estiver apagado, crie um novo ali).
2. No AdMob: **Configurações → Dispositivos de teste → Adicionar dispositivo de
   teste** → Android → cole o ID → dê um nome → Salvar.
3. Espere uns 15 minutos. Abra o jogo, vá em **Ganhar prêmios**: o anúncio tem de
   vir com a faixa **"Test Ad" / "Anúncio de teste"**. **Sem a faixa, não toque no
   anúncio** e feche.

(Outro caminho, se o painel não bastar: a variável
`SOTERRA_ANUNCIO_APARELHOS_TESTE` no Coolify, com o código do aparelho que o SDK
escreve no Logcat — a linha "Use RequestConfiguration.Builder().setTestDeviceIds" —,
separados por vírgula.)

### 10.4 O que muda no Play Console

| onde | o que marcar |
|---|---|
| **Conteúdo do app → Anúncios** | **Sim, meu app contém anúncios.** A ficha da loja passa a mostrar "Contém anúncios" |
| **Conteúdo do app → ID de publicidade** | **Sim, usa o ID de publicidade** — finalidade: **Publicidade ou marketing** (o manifesto leva `com.google.android.gms.permission.AD_ID`) |
| **Segurança dos dados** (seção 4) | acrescentar o que o **SDK da Google** coleta (abaixo) |
| **Público-alvo** (seção 5) | segue **13 anos ou mais**. Com anúncio, marcar faixa abaixo de 13 obrigaria a anúncios certificados para famílias — **não marque** |
| **Classificação indicativa** | no questionário, responder **Sim** a "o app exibe anúncios" se perguntado |

**Segurança dos dados — o que acrescentar** (a Google publica a lista do SDK na
página "Preparar-se para os requisitos de divulgação de dados do Google Play" da
ajuda do AdMob; confira lá na hora de preencher, porque ela muda):

| tipo (nome da Play) | coletado | compartilhado | finalidades |
|---|---|---|---|
| Identificadores do aparelho ou outros → **IDs do dispositivo ou outros IDs** (o ID de publicidade) | Sim | **Sim** (com a Google, para anúncio) | Publicidade ou marketing; Análise; Prevenção de fraudes |
| Atividade no app → **Interações no app** (ver e tocar no anúncio) | Sim | Sim | Publicidade ou marketing; Análise |
| Informações e desempenho do app → **Diagnóstico** e **Registros de falhas** | Sim | Sim | Análise |
| Local → **Local aproximado** (deduzido do IP pelo SDK) | Sim | Sim | Publicidade ou marketing |

Em todos: *opcional* (só para quem entra na área e assiste). O parágrafo "O que
NÃO se marca" da seção 4 deixa de valer para o **identificador de publicidade** e
para o **local aproximado** — os dois passam a ser marcados por causa do SDK.
**Confira com o advogado** (`REVISAO_JURIDICA.md`).

O anúncio é pedido com classificação máxima **"T" (adolescente)** — combina com
o público de 13 anos ou mais. Está em `js/core/premio_anuncio.js`
(`maxAdContentRating`).

### 10.5 Depois de publicado: vincular o app à loja e o app-ads.txt

1. No AdMob → **Apps** → SOTERRA → **Configurações do app** → **Loja de apps** →
   **Adicionar** → procure `br.com.soterra.jogo`. Só aparece depois que o
   aplicativo estiver **publicado** na Play. Sem o vínculo o AdMob limita a
   veiculação.
2. O AdMob pede o **app-ads.txt** no site que consta na ficha da Play como "site
   do desenvolvedor". O conteúdo é a linha que o AdMob mostra em **Apps →
   app-ads.txt** (algo como `google.com, pub-4989579635131748, DIRECT,
   f08c47fec0942fa0` — copie a de lá). Ela tem de responder em
   `https://<o site da ficha>/app-ads.txt`. **Este arquivo ainda não existe no
   repositório**: crie-o quando decidir o domínio da ficha.
3. **Pagamentos** do AdMob: preencher os dados fiscais e a forma de recebimento.
4. **Privacidade e mensagens** (AdMob): se o jogo for oferecido na Europa ou no
   Reino Unido, crie ali a **mensagem de consentimento**. O aplicativo já mostra
   a tela da Google quando ela é exigida — e só ao entrar na área.

### 10.6 Ligar e desligar

- `SOTERRA_ANUNCIOS=0` no Coolify desliga a área (a tela diz "não disponível").
- `SOTERRA_ANUNCIO_BLOCO` troca o bloco sem AAB novo (o aplicativo lê o bloco do
  servidor).

### 10.7 O que não pôde ser provado sem aparelho e sem a Google

O servidor foi provado com um par de chaves de prova fazendo o papel da Google
(`python tests/anuncio_api.py`), e a tela com um plugin de mentira
(`node tests/premio_anuncio.js`). Falta, e só o aparelho mostra:

1. **O projeto compila** com o plugin (o `npx cap update android` passou aqui;
   nada foi compilado). Se o Gradle reclamar de versão, olhe primeiro o `minSdk`
   (24) e o `compileSdk` (36) em `android/variables.gradle`.
2. **A Google chamando o servidor de verdade**: o formato do pedido e a conta da
   assinatura foram escritos pela documentação do AdMob e nunca viram um pedido
   real. O botão **Verificar URL** (10.2) é a primeira prova; a segunda é um
   anúncio visto até o fim num aparelho cadastrado, com o contador andando. Se a
   Google **não avisar o servidor em anúncio de teste** no seu bloco, a tela vai
   dizer "a confirmação ainda não chegou" — aí só um jogador comum, com anúncio
   de verdade, fecha a prova.
3. **A tela de privacidade da Google** e o anúncio em tela cheia por cima do
   jogo; o botão voltar durante o anúncio.
4. **Quanto tempo a Google leva** para avisar: a tela espera até uns 30 s e
   depois diz que o prêmio entra sozinho.
5. **Os nomes dos menus** do AdMob e do Play Console mudam de tempos em tempos.
