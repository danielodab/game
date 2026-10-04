# SOTERRA na Google Play

O caminho do jogo até a loja, do começo ao fim, para quem nunca publicou um
aplicativo. O que o aplicativo **é** e o que mudou no jogo por causa dele está
em [`CELULAR.md`](CELULAR.md); aqui é só o **como publicar**.

**O estado de hoje (04/10/2026):** o projeto Android existe (pasta `android/`),
o jogo já se comporta como aplicativo (botão voltar, segundo plano, tela acesa
na batalha, qualidade média), e a pasta `www/` sai com **13,7 MB**. O que **não**
foi feito nesta máquina: compilar. Ela não tem Java nem o Android SDK — o
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

**Toda vez que mexer no jogo:** `npm run sync` e Run de novo.

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

SOTERRA precisa de internet para jogar. Na primeira abertura o jogo baixa os
modelos 3D; os de cada calabouço descem quando você entra nele.
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
de 02/10/2026). Se a política mudar, este formulário muda junto.

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

**O que NÃO se marca** (seção 3 da política): localização, contatos, fotos e
vídeos, arquivos, agenda, áudio, saúde, navegação na web, identificadores do
aparelho ou de publicidade. Dados de cartão, Pix e CPF não passam pelo jogo.

**Sobre "compartilhado":** a Play não conta como compartilhamento o que vai para
um prestador que trabalha para você (a hospedagem, o provedor de e-mail). Por
isso tudo está como "Não". **Confira com o advogado** junto com os
`[PREENCHER]` que ainda estão na política — a Play lê a página, e ela não pode
ir ao ar com esses campos em branco.

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
| **O app permite comprar itens digitais?** | **Sim** — depois que a compra pela Google entrar; se o aplicativo for enviado sem loja, responda Não e refaça o questionário quando ela entrar |

O resultado esperado é **Livre ou 10 anos**, com os avisos "Interação entre
usuários" e "Compras no app".

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
2. **Jogar no telefone de verdade.** O botão voltar, o segundo plano e a tela
   acesa foram provados com eventos simulados no navegador
   (`tests/app_casca.html`); o aparelho é a prova que falta.
3. **Publicar na web a mudança do servidor.** O aplicativo baixa os modelos de
   `https://soterra.viidoo.io`, e isso só funciona depois que o
   `servidor/coolify/Caddyfile` deste lote estiver no ar (ele dá ao aplicativo a
   licença de buscar os modelos). **Sem esse deploy o aplicativo para na tela de
   carga.** O build do contêiner confere o Caddyfile (`caddy validate`) antes de
   trocar o que está no ar.
4. **A loja dentro do aplicativo.** A Play **não aceita** que um aplicativo
   venda itens digitais por outro meio que não a cobrança dela — e hoje a loja
   do jogo usa o Mercado Pago. Enquanto a compra pela Google não entrar (é a
   próxima etapa), a loja precisa ficar **escondida dentro do aplicativo**, ou a
   revisão recusa. Isto ainda **não** foi feito: é a primeira coisa da etapa da
   cobrança.
5. **A arte:** ícone 1024×1024, tela de abertura, ícone da loja 512×512, imagem
   de destaque 1024×500 e as capturas de tela (seção 2).
6. **Os `[PREENCHER]` da Política de Privacidade e dos Termos** (razão social,
   CNPJ, e-mails, hospedagem, prazos). A Play abre o link.
7. **A chave de assinatura** (seção 1.3) — e a cópia dela fora do computador.

**Para decidir**

8. **O domínio.** O aplicativo aponta para `https://soterra.viidoo.io` (a
   constante `SERVIDOR` em `tools/empacota_www.py`, o único lugar). Se o jogo
   for mudar de endereço, mude **antes** de publicar: aplicativo já instalado
   continua procurando o endereço antigo até o jogador atualizar.
9. **O identificador `br.com.soterra.jogo`.** Depois do primeiro envio não muda
   mais. O costume é usar um domínio que seja seu ao contrário (por exemplo
   `io.viidoo.soterra`).
10. **Quando o jogo muda, o aplicativo tem de ser enviado de novo.** O código do
    jogo vai **dentro** do aplicativo; só os modelos vêm do servidor. Se a web
    receber uma mudança de regra (a `VERSAO_REGRAS`) e o aplicativo não, quem
    está no celular e quem está no computador ficam com regras diferentes até a
    atualização passar pela revisão da Play (de horas a alguns dias). A saída,
    se isso incomodar, é o aplicativo abrir o jogo direto do servidor (o
    `server.url` do Capacitor): atualiza junto com a web, mas não abre sem
    internet nem na primeira tela. É uma decisão sua — hoje está do primeiro jeito.
11. **iOS** não foi tocado.
