# SOTERRA na App Store (iPhone)

O caminho do jogo até a App Store da Apple, do começo ao fim, para quem usa
Windows e nunca publicou na Apple. O irmão deste documento é o
[`GOOGLE_PLAY.md`](GOOGLE_PLAY.md); o que o aplicativo **é** está no
[`CELULAR.md`](CELULAR.md). Tudo o que vale para o Android e não está repetido
aqui (o jogo vem do servidor, a tela "sem conexão", a aba do site) vale igual
para o iPhone.

**O estado de hoje (25/10/2026):** o projeto do iPhone existe (pasta `ios/`,
gerada **neste Windows** com `npx cap add ios`) e está no Git, com o ícone e a
tela de abertura do jogo, só deitado, sem barra de status, os três idiomas e o
manifesto de privacidade da Apple. A receita para compilar na nuvem está pronta
(`codemagic.yaml`). A prova é `python tests/app_ios.py` (47 itens). **Nada foi
compilado**: compilar para iPhone exige um Mac (ou um Mac na nuvem, seção 2).

**A separação entre Android e iPhone no jogo está feita (25/10, seção 8.7):** no
iPhone o "Sair do jogo", a loja (seja qual for o `SOTERRA_LOJA`) e a área de
anúncios não aparecem, e a avaliação diz "App Store"; no Android e na web nada
mudou. Ela vale quando for publicada na web (é código do jogo, não da casca). A
compra pela Apple e os anúncios no iPhone ficam para depois do primeiro envio.

> **O Android não muda.** O `android/` não foi tocado. O que é comum aos dois
> (o `capacitor.config.json`, o `package.json`) ganhou só o que o iPhone lê: a
> seção `ios`, o `@capacitor/ios` e a linha `server.allowNavigation` — que no
> Android não muda nada (seção 8.8, lido no código do Capacitor 8). O AAB
> 1.1.0 (código 3) já gerado segue valendo; o próximo AAB sai igual.

---

## 0. O caminho, em uma tela

| # | o quê | quem | quanto tempo | seção |
|---|---|---|---|---|
| 1 | Conta Apple Developer (US$ 99 por ano) | você | 1 a 2 dias para aprovar | 1 |
| 2 | ~~Separar Android e iPhone no jogo~~ — **feito em 25/10**; falta só publicar na web | você | o deploy de sempre | 8.7 |
| 3 | Registrar o identificador, criar o app no App Store Connect e a chave da API | você, no navegador | 1 hora | 3.2 |
| 4 | Codemagic: ligar o repositório, a chave, o certificado e o perfil | você, no navegador | 1 hora | 3.2 |
| 5 | Primeiro build → TestFlight → jogar no iPhone (a lista da 5.3) | Codemagic + você | 30 min + o teste | 5 |
| 6 | A ficha: textos, capturas, classificação, privacidade, conta de demonstração | você | 2 a 3 horas | 6 |
| 7 | Enviar para a revisão | você | 1 a 3 dias de espera | 7 |
| depois | A compra pela Apple (antes de abrir a loja no iPhone) e os anúncios | código + você | 3 a 5 dias | 8.2 e 8.6 |

---

## 1. A conta de desenvolvedor da Apple

### 1.1 A inscrição

<https://developer.apple.com/programs/enroll/> — ou pelo aplicativo **Apple
Developer** num iPhone (é o caminho mais rápido: ele confere a identidade pela
câmera).

| o que pedem | observação |
|---|---|
| uma **Conta Apple** com verificação em duas etapas ligada | a mesma que você usa no iPhone serve |
| ser maior de idade e usar o **nome civil** | |
| **cartão de crédito em seu nome** | cartão de outra pessoa pode fazer a Apple pedir documento com foto |
| **US$ 99 por ano** | cobrado em reais onde a Apple tem preço local; o valor exato aparece na hora de pagar (sites citam uns R$ 550, mas não é número oficial) |

A Apple não promete prazo. O normal é de algumas horas a dois dias; se em
24 horas depois de pagar não chegar a confirmação, ela manda falar com o suporte.

### 1.2 Pessoa física ou empresa: o nome que aparece na loja

Como **pessoa física**, o "vendedor" que aparece na App Store debaixo do nome do
jogo é **o seu nome civil**, não "Oda Studio". Para aparecer "Oda Studio" é
preciso conta de **organização**, que pede CNPJ e um número D-U-N-S (gratuito,
leva uns dias). Dá para começar como pessoa física e migrar depois pelo
suporte da Apple — mas é burocrático. **Decida antes de pagar.**

### 1.3 Os contratos no App Store Connect

Com a conta aprovada, entre em <https://appstoreconnect.apple.com>:

1. **Acordos, impostos e banco** (*Business*): o acordo de **apps gratuitos**
   já vem aceito. O de **apps pagos** (*Paid Apps Agreement*), com o banco e o
   formulário de impostos, só é preciso para **vender** (a compra pela Apple,
   seção 8.2) — é o equivalente ao perfil de pagamentos da Google. Pode
   preencher já: costuma levar alguns dias para valer.
2. **Situação de comerciante na União Europeia** (Lei de Serviços Digitais, DSA):
   a Apple **exige a resposta mesmo de quem não vende na Europa**. Quem ganha
   dinheiro com o aplicativo (compras, anúncios) é "comerciante", e aí o
   endereço, o telefone e o e-mail aparecem para os jogadores da UE. Se não
   quiser isso público agora, deixe os países da UE fora da disponibilidade
   (seção 6.6) e declare-se comerciante só quando for distribuir lá.
3. **Programa para Pequenas Empresas** (*App Store Small Business Program*):
   <https://developer.apple.com/app-store/small-business-program/>. Quem fatura
   menos de US$ 1 milhão por ano paga a taxa reduzida em vez da cheia. Inscreva-se
   **assim que aceitar o acordo de apps pagos** — a taxa reduzida começa 15 dias
   depois do fim do mês da aprovação. O que a Apple cobra no Brasil está na 8.2.

---

## 2. Compilar sem Mac

O `ios/` foi gerado aqui, no Windows (o Capacitor 8 usa o *Swift Package
Manager*, que dispensa o CocoaPods). Mas **compilar** e **assinar** para iPhone
só se faz em macOS com o Xcode — e, desde 28/04/2026, a Apple só aceita
aplicativo compilado com o **Xcode 26** (SDK do iOS 26).

### 2.1 As opções

Os preços foram conferidos em 25/10/2026 nas páginas de cada serviço; os marcados
com * não puderam ser confirmados na fonte oficial.

| caminho | custo | trabalho para você | serve para |
|---|---|---|---|
| **Codemagic** (Mac na nuvem, feito para aplicativo) | **grátis até 500 minutos por mês** (Mac mini M2; um build do SOTERRA deve levar 10 a 15 min → uns 30 builds por mês). Passou disso: US$ 0,095 por minuto (~US$ 1,40 por build) | **o menor**: tudo pelo navegador. A assinatura é automática com a chave da API da Apple (seção 3) e o resultado vai sozinho para o TestFlight. A receita já está no repositório (`codemagic.yaml`) | **a recomendação** |
| GitHub Actions (Mac do GitHub) | repositório privado: US$ 0,062 por minuto de Mac. Os 2.000 minutos grátis do plano gratuito valiam 10× menos no Mac (~200 min); a página de hoje não diz mais* | alto: a assinatura é toda à mão (certificado, perfil e senhas como segredos do repositório, ou o *fastlane match*) | quem já domina GitHub Actions |
| Capawesome Cloud | US$ 19 por mês (200 min), sem plano grátis | médio | alternativa ao Codemagic |
| Ionic Appflow | **não vende mais** para cliente novo desde 02/2025 | — | — |
| Mac alugado por hora | MacinCloud ~US$ 1/hora ou ~US$ 25–30/mês*; Scaleway (Paris) Mac mini M1 a €0,11/hora com **mínimo de 24 h** (~€ 2,70 por vez); AWS ~US$ 0,65/hora com mínimo de 24 h (~US$ 16 por vez)* | alto: você usa o Mac pela área de trabalho remota, instala o Xcode (~40 GB), faz tudo no Xcode | quando precisar mexer no projeto nativo com o Xcode aberto |
| Mac emprestado | grátis | alto na primeira vez (macOS 15.6 ou mais novo, Xcode 26, umas 3 horas) | a mesma coisa, de vez em quando |
| Mac mini usado (M1 ou mais novo) | compra única (no Brasil, uns R$ 2.500 a R$ 3.500 usado*; confira) | médio | se o iPhone virar parte fixa da rotina |

O que **nenhuma** opção na nuvem faz: rodar o jogo num iPhone de mentira para
você ver. O teste é no **iPhone de verdade, pelo TestFlight** (seção 5) — o seu
ou o de alguém da família. (O Appetize.io roda o simulador no navegador, mas
pede um build de simulador e o grátis dá 30 minutos por mês; não vale o esforço.)

### 2.2 A recomendação: Codemagic

1. Não precisa de Mac em momento nenhum, nem para o certificado.
2. O plano grátis cobre o ritmo do SOTERRA: o jogo vem do servidor, então
   **build novo só quando muda a casca** (um plugin, o ícone, a versão do
   Capacitor) — como o AAB do Android.
3. O `codemagic.yaml` do repositório faz os mesmos passos de casa (`npm ci`, a
   `www/`, o `npx cap sync ios`, a prova `tests/app_ios.py`) e manda o build ao
   TestFlight com o número seguinte ao último.

**Custo por mês, no caminho recomendado:** a Apple (US$ 99 por ano, ~US$ 8,25 por
mês) + Codemagic **R$ 0**. Só passa disso se fizer mais de uns 30 builds no mês.

### 2.3 Se um dia houver Mac

No Mac, com o Xcode 26 instalado e o repositório baixado:

```bash
npm ci
npm run sync:ios              # a www/ + npx cap sync ios
npx cap open ios              # abre o Xcode no projeto
```

No Xcode: **Signing & Capabilities** → marque *Automatically manage signing* e
escolha o seu *Team*. Para gerar o arquivo da loja: **Product → Archive** →
**Distribute App** → **App Store Connect**.

---

## 3. A assinatura: certificado e perfil

### 3.1 O que são, em quatro linhas

- **Identificador do app (App ID):** o `br.com.soterra.jogo`, registrado na Apple.
  É o mesmo do Android (o `appId` do `capacitor.config.json`) e **não muda depois
  do primeiro envio**.
- **Certificado de distribuição:** prova que o aplicativo é seu. Um por conta,
  vale um ano, renova-se.
- **Perfil de provisionamento (App Store):** junta o identificador e o
  certificado. Sem ele, o iPhone não instala.
- **Chave da API do App Store Connect** (um arquivo `.p8`): deixa o Codemagic
  criar e buscar os dois acima, e enviar o build — sem você digitar senha.

### 3.2 Passo a passo, tudo pelo navegador

1. **O identificador.** <https://developer.apple.com/account> → *Certificates,
   Identifiers & Profiles* → **Identifiers** → **+** → *App IDs* → *App* →
   descrição "SOTERRA", *Bundle ID* **Explicit** = `br.com.soterra.jogo`. Nas
   *Capabilities*, deixe **In-App Purchase** marcada (vem por padrão). Não
   precisa de *Push Notifications*: os avisos do jogo são locais.
2. **O app no App Store Connect.** **Apps** → **+** → *Novo app* → plataforma
   **iOS**; nome (seção 6.1); idioma principal **Português (Brasil)**; o *Bundle
   ID* acima; SKU `SOTERRA-IOS` (é só uma etiqueta sua); acesso total. Depois, em
   **Informações do app**, anote o **ID da Apple** (um número de 10 dígitos).
3. **A chave da API.** App Store Connect → **Usuários e acesso** →
   **Integrações** → *App Store Connect API* → **Chaves da equipe** → **+** →
   nome "Codemagic", acesso **App Manager**. Baixe o arquivo `.p8` (**só dá para
   baixar uma vez**) e anote o *Issuer ID* e o *Key ID* que aparecem na página.
4. **O Codemagic.** <https://codemagic.io> → entre com a conta do GitHub e dê
   acesso ao repositório `danielodab/game`.
   1. *Team settings* → **Team integrations** → *Developer Portal* → **Connect**:
      cole o *Issuer ID* e o *Key ID*, envie o `.p8`, e dê à chave o nome
      **SOTERRA** (é o nome que o `codemagic.yaml` procura).
   2. *Team settings* → **Code signing identities** → *iOS certificates* →
      **Generate certificate** → tipo *Apple Distribution*, com a chave
      SOTERRA. **Baixe a cópia** (`.p12`) e a senha que ele mostrar e guarde junto
      da chave do Android (seção 3.3).
   3. Mesma página → *iOS provisioning profiles* → **Fetch profiles** com a chave
      SOTERRA. Se não vier nenhum perfil *App Store* para `br.com.soterra.jogo`,
      crie em <https://developer.apple.com/account> → **Profiles** → **+** →
      *App Store Connect* → o identificador → o certificado do passo anterior, e
      busque de novo.
5. **O ID da Apple na receita.** No `codemagic.yaml`, troque
   `APP_STORE_APPLE_ID: 0000000000` pelo número do passo 2 e faça o commit (o
   número não é segredo).
6. **O primeiro build.** No Codemagic, abra o app → **Start new build** →
   workflow *SOTERRA iPhone para o TestFlight* → branch `main`. Uns 15 minutos
   depois o build aparece no App Store Connect → **TestFlight** (a Apple ainda o
   "processa" por uns 10 a 30 minutos).

**Se o build falhar**, o Codemagic mostra o passo e o log. Os tropeços mais
prováveis no primeiro: a chave sem o nome SOTERRA; o perfil que não existe
(passo 4.3); o ID da Apple ainda com zeros. A receita foi escrita pela
documentação do Codemagic e nunca rodou — o primeiro build é a prova dela.

### 3.3 O que guardar fora do computador

O `.p8` da chave da API, o `.p12` do certificado com a senha dele — junto do
`soterra-envio.jks` e das senhas do Android. **Nada disso vai para o Git**, e o
`codemagic.yaml` não tem nenhum deles (a prova `tests/app_ios.py` confere).
Perder o certificado não é grave como perder a chave do Android: revoga-se e
gera-se outro; o aplicativo publicado continua.

---

## 4. O ícone e a tela de abertura — prontos

O mesmo desenho do Android ("ST" e "ONLINE" em ouro sobre o preto do jogo), de
`tools/icone_app.py`:

| arquivo | o que é |
|---|---|
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | o ícone, **1024×1024 sem transparência** (a App Store recusa ícone com canal alfa). O Xcode tira dele todos os outros tamanhos, e **a App Store usa este mesmo** — não há ícone da loja à parte, como o 512 da Play |
| `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png` | a tela de abertura: um quadrado de 2732 que o iPhone mostra preenchendo a tela. Deitado, ele corta em cima e embaixo; por isso a marca vai menor que no Android (30% do lado) |

Mudou o desenho? `npm run icones:ios` (o mesmo que `python tools/icone_app.py
--ios`) redesenha só os do iPhone, sem regravar nenhum arquivo do Android. Depois,
um build novo.

---

## 5. O TestFlight

O TestFlight é o "teste fechado" da Apple: o aplicativo **TestFlight** (da App
Store) instala o build no iPhone de quem você convidar.

### 5.1 Testadores internos (você e a família)

App Store Connect → o app → **TestFlight** → *Testes internos* → **+** → crie o
grupo "Casa". Interno é quem é **usuário do App Store Connect** (*Usuários e
acesso* → convide pelo e-mail da Conta Apple da pessoa, papel *Marketing* ou
*Developer*). Até 100 pessoas. **Não passa por revisão**: o build aparece no
TestFlight minutos depois de processado.

### 5.2 Testadores externos (amigos)

*Testes externos* → **+** → grupo → adicione e-mails ou gere um **link público**.
Até 10.000 pessoas. O **primeiro build** de cada versão passa por uma revisão
curta da Apple (a *Beta App Review*, normalmente menos de um dia) — e ela pede as
mesmas coisas da revisão de verdade: a conta de demonstração e as notas (6.5).

Diferente da Play, **a Apple não exige teste fechado** para liberar a produção:
pode enviar à revisão direto. O TestFlight é para você ver o jogo no iPhone antes.

### 5.3 O que conferir no iPhone (nada disto pôde ser provado aqui)

1. **Abre o jogo do servidor**, deitado, sem a barra de status, sem faixa preta
   no lado do entalhe (a câmera) — o jogo usa a área segura (`env(safe-area-inset-*)`).
2. **A entrada abre DENTRO do aplicativo.** Saia da conta: a página de entrar
   (`site/conta.html`) tem de aparecer no próprio aplicativo, **não no Safari**.
   É o que o `server.allowNavigation` resolve (8.8); se abrir o Safari, ele falta.
3. **Modo avião ao abrir:** "Sem conexão — Tentar de novo"; ligando a rede, o jogo abre.
4. **O Site e a Loja (a aba):** abrem por cima do jogo e fecham pelo "Voltar ao
   jogo". Um link para outro domínio (a comunidade) abre no **Safari**.
5. **A conta pelo site da aba**: sair e entrar de novo por ali, e voltar ao jogo.
6. **Avisos do aparelho:** a pergunta do iOS ("Permitir notificações?") sai em
   português; o aviso do prêmio diário chega.
7. **Compartilhar o cartão da fusão:** a folha do iOS abre; **Salvar imagem**
   pergunta a permissão da Fotos (a frase está no `Info.plist`) e não fecha o jogo.
8. **Avaliação:** na terceira vitória (depois de dois dias) aparece a caixa da
   Apple — no TestFlight ela **não** aparece de verdade, é normal.
9. **Tela acesa** na batalha; **segundo plano**: o som cala e volta.
10. **Memória:** uma sessão longa nos mapas mais pesados, num iPhone mais antigo.
    Se o iOS matar o WebView por memória, o Capacitor recarrega o jogo (tela
    preta e volta) — anote em qual mapa.
11. **O teclado deitado** na tela de entrar e no chat: o campo continua visível.
12. **Os "Modelos no aparelho" e o "Jogo no aparelho"** (Configurações): podem
    **não aparecer** no iPhone — o WebView da Apple não dá service worker a
    aplicativo comum e pode não ter o *Cache Storage* (8.8). Sem eles, o jogo
    baixa da rede como na web; não é defeito.
13. **A separação (8.7):** o menu **sem** "Sair do jogo" e **sem** o botão Loja;
    as Configurações **sem** "Barras de ouro" e **sem** "Ganhar prêmios", e com
    **"Avaliar na App Store"**; a praça sem a moeda "Prêmio Grátis!". Em nenhuma
    tela aparece "Google Play", "Play Store", "Android" ou Mercado Pago (só nos
    Termos e na Privacidade, 8.7).

---

## 6. A ficha no App Store Connect

### 6.1 Os textos — prontos para colar

Os limites da Apple: nome **30**, subtítulo **30**, texto promocional **170**,
descrição **4.000**, palavras-chave **100** caracteres. **Nenhum texto pode citar
Android, Google Play ou outra loja** (diretriz 2.3.10).

**Nome** (o da Play cabe: 30)

```
SOTERRA: Ecos do Mundo Enterrado
```

Se a Apple disser que o nome já existe, use `SOTERRA Online`.

**Subtítulo**

```
RPG tático por turnos em 3D
```

**Texto promocional** (dá para trocar a qualquer hora, sem revisão)

```
Forme sua dupla, funda os dois heróis num só e desça aos calabouços. Jogue com amigos na praça, na Arena e nas guerras de guilda.
```

**Descrição** — a da Play (`GOOGLE_PLAY.md` §3), com três trocas: o bloco "A
MESMA CONTA NO CELULAR E NO COMPUTADOR" diz "comece no iPhone e continue no
navegador do computador"; o "FEITO PARA O CELULAR" fica igual; e o último
parágrafo, enquanto o iPhone não guardar os modelos (5.3, item 12), fica assim:

```
SOTERRA precisa de internet para jogar. Cada mapa baixa o que precisa na primeira vez que você entra nele.
```

**Palavras-chave** (separadas por vírgula, sem espaço; não repita o que já está no
nome nem no subtítulo)

```
rpg,tático,turnos,estratégia,calabouço,dungeon,arena,guilda,multijogador,heróis,fusão,online
```

**Outros campos**

| campo | o que pôr |
|---|---|
| Categoria principal / secundária | **Jogos** → *RPG* / *Estratégia* |
| URL de suporte (obrigatória) | `https://soterra.viidoo.io/site/` (a página precisa ter um jeito de falar com você: o e-mail system@viidoo.io) |
| URL de marketing (opcional) | `https://soterra.viidoo.io/site/` |
| URL da política de privacidade (obrigatória) | `https://soterra.viidoo.io/site/privacidade.html` |
| Copyright | `2026 Oda Studio` (ou o seu nome, se a conta for de pessoa física) |
| Preço | **Grátis** |

### 6.2 As capturas de tela

As da Play (`docs/arte-loja/captura-*.png`, 2340×1170) **não servem**: a Apple
só aceita os tamanhos exatos dos iPhones. O jogo é deitado, então as capturas
são deitadas:

| tela | tamanho deitado (pixels) | no Chrome: aparelho personalizado |
|---|---|---|
| **iPhone 6,9"** (a principal) | **2868 × 1320** | largura 956, altura 440, *Device pixel ratio* **3** |
| **iPhone 6,3"** | **2622 × 1206** | largura 874, altura 402, *Device pixel ratio* **3** |

De **1 a 10** por tamanho, PNG ou JPG, sem transparência. A página da Apple hoje
dá a 6,3" como obrigatória e aceita reduzir a de 6,9" para os outros tamanhos —
ela é ambígua; **mande as duas** e acaba a dúvida. iPad não precisa: o
aplicativo é só para iPhone (seção 9).

**Como fazer sem iPhone:** no Chrome do computador, abra o jogo, aperte **F12** →
o ícone do celular (*Toggle device toolbar*) → no menu dos aparelhos, **Edit…** →
**Add custom device** com os números da tabela (agente de usuário *Mobile*).
Escolha o aparelho, monte a cena, e no menu **⋮** da barra do aparelho →
**Capture screenshot**: o PNG sai no tamanho exato. As mesmas cenas das capturas
da Play servem.

**Não mostre nas capturas:** preço em reais, Mercado Pago, Google Play, botão do
Android, nem a loja enquanto ela estiver fechada no iPhone.

O **vídeo de prévia** é opcional (até 3, de 15 a 30 s, 1920×886 deitado). Pode ficar para depois.

### 6.3 A classificação etária

O questionário mudou em 2025 (faixas **4+, 9+, 13+, 16+, 18+**). As respostas do
SOTERRA, tiradas do jogo como ele é hoje:

| grupo | pergunta | resposta |
|---|---|---|
| Controles no app | controle parental; verificação de idade | Não; Não |
| Recursos | acesso livre à web | **Não** (link de fora abre no Safari; a aba só mostra o site do jogo) |
| | conteúdo gerado por usuários | **Sim** (chat, mural da guilda, nomes de jogador) |
| | recursos de rede social (feed que espalha conteúdo) | Não |
| | mensagens e chat | **Sim** |
| | publicidade | **Não** nesta versão (Sim quando o anúncio premiado chegar ao iPhone, 8.6) |
| Violência | violência de desenho ou fantasia | **Frequente/intensa** — a batalha é o jogo inteiro, ainda que sem sangue |
| | violência realista; prolongada ou sádica; armas de fogo | Não; Não; Não |
| Temas | terror ou medo | **Infrequente/leve** (monstros, calabouços) |
| | palavrões, sexualidade, nudez, drogas, álcool, temas médicos | Não (o chat tem filtro de palavrões) |
| Sorte | jogo de azar com dinheiro; jogo de azar simulado; concursos | Não; Não; Não |
| | **caixas de recompensa (loot boxes)** | **leia a 8.5 antes de responder** |

O resultado esperado é **13+** (pela violência de fantasia frequente), igual à
idade mínima dos Termos (13 anos). **No Brasil** a Apple aplica a régua do
ClassInd: o chat leva a **12 anos** — e caixa de recompensa leva a **18**.

### 6.4 A privacidade do app (os "rótulos")

App Store Connect → o app → **Privacidade do app**. As respostas saem da mesma
`site/privacidade.html` do formulário da Play (`GOOGLE_PLAY.md` §4), e batem com
o manifesto do aplicativo (`ios/App/App/PrivacyInfo.xcprivacy`).

- **Rastreamento:** **Não** (sem anúncio, nada é usado para rastrear).
- **Dados vinculados a você** — todos com a finalidade **Funcionalidade do app**:

| categoria da Apple | o que é no SOTERRA |
|---|---|
| Informações de contato → **E-mail** | o e-mail da conta |
| Identificadores → **ID do usuário** | o nome de jogador e o número da conta |
| Compras → **Histórico de compras** | pacote, valor e datas (entra quando a compra pela Apple existir; marcar desde já não faz mal) |
| Conteúdo do usuário → **Outro conteúdo do usuário** | as falas anexadas a uma denúncia e o mural da guilda (o chat em si não é gravado) |
| Conteúdo do usuário → **Conteúdo de jogo** | o progresso: heróis, itens, salas, duelos, amigos, guilda |
| Diagnóstico → **Dados de falhas** e **Outros dados de diagnóstico** | a mensagem do erro, a versão, a tela e o navegador — também com a finalidade **Análise** |

- **Dados não vinculados a você:** Dados de uso → **Interação com o produto**
  (o funil somado por dia, sem conta — `js/core/eventos_uso.js`), finalidade **Análise**.
- **Não se marca:** localização (o IP não é usado para localizar), contatos,
  fotos, arquivos, histórico de navegação, identificadores de publicidade,
  dados financeiros (cartão e Pix não passam pelo jogo).

Com o anúncio premiado no iPhone isto muda (8.6). **Confira com o advogado** junto
da Play (`REVISAO_JURIDICA.md`).

### 6.5 A conta de demonstração e as notas para o revisor

O jogo exige entrar numa conta, então a Apple **exige** uma conta para o
revisor (*Informações da revisão do app* → *É necessário iniciar sessão*):

1. Crie, pelo site, uma conta de jogador comum só para isso (por exemplo
   `RevisaoApple`), com senha forte. **Não pode expirar nem ser apagada**:
   cuidado na faxina das contas de teste (`admin excluir`, `servidor/SUBIR.md`).
2. Jogue com ela a primeira luta, para o revisor já cair na praça.
3. Não use a conta do Mestre.

**Notas** (em inglês: a equipe de revisão lê inglês; cole como está):

```
SOTERRA is an online turn-based tactical RPG with 3D battles. Progress is kept on our server, so the same
account plays on iPhone and on the web. Please sign in with the demo account above on the first screen.

- The game is landscape-only. It follows the device language; English is available in
  Menu > Settings > "Idioma · Language · Idioma" (first section).
- Account deletion inside the app: Menu > "Conta: <name>" > "Excluir conta…" (Delete account), confirmed
  with the account name and password. It is also on the account page of our site, which opens inside the
  game (globe icon "Site").
- Player safety (chat): messages pass through a profanity filter; on a player's profile you can mute
  ("Silenciar"), block private messages and trades ("Marcar inimigo") and report to our moderators
  ("Denunciar"). Contact: system@viidoo.io.
- This version has no in-app purchases and no ads.
- Native features: local notifications (daily reward reminder), the iOS share sheet for the fusion card,
  the in-app rating prompt, the screen stays awake during battles, and an offline screen when there is
  no connection.
```

Se a Apple perguntar como o jogo funciona por dentro, a resposta está na 8.1.

### 6.6 Os outros campos

| campo | resposta |
|---|---|
| **Criptografia** | já respondida no `Info.plist` (`ITSAppUsesNonExemptEncryption = false`: só HTTPS) — a pergunta não aparece a cada envio |
| **Direitos de conteúdo** (*o app mostra conteúdo de terceiros?*) | **Sim**, e você tem os direitos: os pacotes de arte e de som, com as licenças em [`CREDITOS.md`](CREDITOS.md) |
| **Disponibilidade** | todos os países, ou sem os da União Europeia se não quiser publicar o endereço (1.3) |
| **Iniciar sessão com a Apple** | **não é exigido**: a diretriz 4.8 dispensa quem usa só o próprio sistema de contas (o SOTERRA não oferece entrar com Google nem Facebook) |
| **Rótulos de acessibilidade** | opcionais por enquanto; pode pular |
| **Liberação da versão** | **Manualmente**: aprovada, você escolhe a hora de soltar |

---

## 7. Enviar para a revisão

1. App Store Connect → o app → a versão **1.1.0** (a da esquerda, *Preparar para
   envio*).
2. Em **Build**, escolha o build que passou pelo TestFlight.
3. Confira a ficha (6.1 a 6.6). O botão **Adicionar para revisão** só acende
   com tudo preenchido; ele aponta o que falta.
4. **Enviar para a revisão.** A Apple costuma responder em **um a três dias**.
5. **Recusou?** A mensagem chega na *Central de resoluções*, com a diretriz e,
   muitas vezes, uma captura. Responda ali mesmo: se for mal-entendido, explique
   (a 8.1 tem o texto da recusa mais provável); se for defeito, conserte, gere um
   build novo e envie de novo. Recusa não é castigo: é a rotina da Apple.

**Depois de aprovado:** tudo o que for publicado na web aparece no iPhone na
mesma hora — e as regras da Apple passam a valer para isso também. A regra é a
mesma da Play (`GOOGLE_PLAY.md` §8.2): nada de "compre pelo site" dentro do
aplicativo, e a ficha e a classificação acompanham o jogo quando ele ganhar
chat, compra ou conteúdo novo.

---

## 8. Os riscos da revisão — e o que o código precisa mudar

Tamanhos: **P** = até meio dia de trabalho com as provas; **M** = 1 a 2 dias;
**G** = 3 a 5 dias.

### 8.0 O quadro

| # | risco | diretriz | chance de recusa | o que fazer | tamanho | quando |
|---|---|---|---|---|---|---|
| 1 | "é só um site embrulhado" — o jogo vem do servidor | 4.2 e 2.5.2 | **alta** | 8.1 | P (notas) · M (recursos nativos) · G (o jogo dentro do app) | antes do 1º envio: as notas; o resto se recusarem |
| 2 | compra de item digital por fora da Apple, e "Google Play" na tela | 3.1.1, 3.1.3(b), 2.3.10 | **baixa** desde 25/10: a loja fica fechada no iPhone | 8.2 | ~~P (loja fechada no iPhone)~~ **feito** · G (a compra pela Apple) | o G antes de abrir a loja no iPhone |
| 3 | partes do jogo que só sabem de Android ("Sair do jogo" que não sai, anúncio que manda à Play Store) | 2.1 e 2.3.10 | **baixa** desde 25/10 | 8.7 | ~~M~~ **feito** | — |
| 4 | caixa de recompensa (o bônus sorteado da Gema, que se compra em fragmentos) | 3.1.1 e a classificação | média (e 18 anos no Brasil se marcada) | 8.5 | P (mostrar as chances) | antes do 1º envio |
| 5 | excluir a conta dentro do app | 5.1.1(v) | baixa — **já existe** | 8.3 | — | — |
| 6 | chat sem filtro, denúncia ou bloqueio | 1.2 | baixa — **já existe** | 8.4 | — | — |
| 7 | anúncio sem o aviso de rastreamento (ATT) | 5.1.2 | nenhuma hoje: o AdMob **não entra** no iPhone | 8.6 | M | quando quiser anúncio no iPhone |

**Os três maiores riscos de recusa eram o 1, o 2 e o 3.** O 2 e o 3 foram
resolvidos com a mesma mudança, a separação por plataforma (8.7, feita em 25/10),
servida pela web — sem build novo do Android. Sobra o 1, que se ataca com as notas
da revisão (6.5) e, se preciso, com os reforços da 8.1.

### 8.1 Diretriz 4.2 — o jogo vem do servidor

**O que a Apple diz.** A 4.2 pede que o aplicativo vá "além de um site
reempacotado"; a 2.5.2 proíbe baixar código que acrescente ou mude funções. O
contrato do programa (*Apple Developer Program License Agreement*, 3.3.1(B))
abre a porta: código **interpretado** pode ser baixado se não mudar o propósito
principal do aplicativo, não criar uma loja de outros apps e não contornar a
segurança do sistema. O SOTERRA é JavaScript num WebView, sempre o mesmo jogo —
é esse o argumento, o mesmo que vale na Play (`GOOGLE_PLAY.md` §8.1).

**Por que a chance é alta.** A Apple é bem mais dura que a Play com aplicativo
WebView, e a primeira tela do SOTERRA é um formulário de entrar com cara de
página. O revisor não vê que por trás há um jogo 3D inteiro até entrar.

**O que já pesa a favor:** é um jogo 3D de verdade (WebGL), deitado, em tela
cheia; avisos do aparelho; folha de compartilhar nativa; caixa de avaliação
nativa; tela acesa na batalha; a tela "sem conexão" no lugar da tela branca; a
conta de demonstração que já cai na praça.

**O que fazer, em ordem:**

1. **As notas da 6.5** e a conta de demonstração já jogada — **P**, antes do
   primeiro envio.
2. **Se recusarem pela 4.2**, responda na Central de resoluções:

   ```
   SOTERRA is a full 3D tactical RPG, not a website: turn-based battles rendered with WebGL, a shared online
   world, local notifications, native sharing and rating. The game client runs in WKWebView and comes from our
   own server, the same client our web players use, so everyone shares the same rules and matchmaking. This is
   interpreted code under section 3.3.1(B) of the Developer Program License Agreement: it never changes the
   app's primary purpose, it does not offer other apps, and all native code ships in the binary we submitted.
   ```

3. **Se recusarem de novo**, os reforços, do menor ao maior:
   - **toque nativo** (`@capacitor/haptics`: vibração ao confirmar um golpe, ao
     vencer) e a entrada com cara de jogo (a arte do jogo atrás do formulário) —
     **M**, um build novo;
   - a **compra pela Apple** (8.2), que por si só é recurso nativo — **G**;
   - **o jogo dentro do aplicativo**: `python tools/empacota_www.py --embutida`
     e tirar `url` e `errorPath` do `capacitor.config.json` (só no build do
     iPhone). Some o "código baixado"; o preço é **build novo e revisão a cada
     mudança do jogo**, e no iPhone a página passa a vir de `capacitor://localhost`
     — as duas `Caddyfile` teriam de dar licença (CORS) a essa origem também,
     como dão hoje a `https://localhost` — **G**.

### 8.2 Diretriz 3.1.1 — a compra de item digital tem de ser pela Apple

Dentro do aplicativo do iPhone, **todo item digital** (as barras de ouro) só pode
ser vendido pela compra da Apple (*In-App Purchase*). Nem Mercado Pago, nem
Google Play, nem link para pagar fora. E a 3.1.3(b) diz que barras compradas na
web ou no Android só podem ser **usadas** no iPhone se as barras **também** forem
vendidas ali pela Apple.

**O que acontece hoje no iPhone.**

- O `SITE.noApp()` e o `JOGO.Mobile.app()` já são verdadeiros no iPhone (o
  Capacitor diz "nativo" nos dois sistemas), então o **Mercado Pago não aparece** — certo.
- No lugar dele entraria a "compra pela Google Play" (`js/core/compra_play.js`).
  O plugin dela (`@capgo/native-purchases`) **funciona no iPhone**, mas lá fala com
  a loja da **Apple**: pediria os pacotes `barras_50`… à Apple, não acharia nada e
  diria **"Os pacotes ainda não estão disponíveis na Google Play"**.
- **Hoje a loja está fechada para todos** (`SOTERRA_LOJA=0`): nada disso aparece.
  O risco é o dia em que ela abrir para o Android e a web.

**Feito em 25/10:** a loja fica **fechada no iPhone**, sempre, até a compra da
Apple existir — independente do `SOTERRA_LOJA`: o `L.fechada()` do
`js/core/loja.js` e o `SITE.lojaFechada()` da loja do site aberta na aba
respondem "fechada" no iPhone, e a compra pela Play (`js/core/compra_play.js`) não
liga nada lá — nem a retomada na abertura (8.7). Com a loja fechada no mundo inteiro, ninguém compra
barras em lugar nenhum, e a 3.1.3(b) fica de pé. **Quando a loja abrir no Android
e na web, a compra da Apple tem de estar pronta junto** — senão quem joga no
iPhone gastaria barras compradas fora, sem poder comprá-las no iPhone.

**A compra pela Apple — o que fazer quando for a hora** (não foi feito):

| parte | o que é | tamanho |
|---|---|---|
| App Store Connect | o acordo de apps pagos, o banco e os impostos (1.3); os quatro produtos **consumíveis** com os mesmos IDs da Play (`barras_50`, `barras_280`, `barras_600`, `barras_1250` — a Apple aceita o sublinhado; o ID não se reaproveita nunca); os preços nas faixas da Apple mais próximas de R$ 4,90 / 19,90 / 39,90 / 79,90; uma **chave de compra no app** (`.p8`, em *Usuários e acesso → Integrações → Compra no app*) para o servidor conferir | você, 1 hora + a espera do contrato |
| o jogo (`js/core/compra_play.js` vira a compra **da loja do aparelho**) | o mesmo caminho de hoje — pede, o servidor confere e credita, só então a compra é encerrada — com três diferenças no iPhone: o recibo é o `transactionId` mais a assinatura da Apple (`jwsRepresentation`), não o `purchaseToken`; o código da conta (`appAccountToken`) **tem de ser um UUID** (hoje é um hmac); e "encerrar" a compra é o `acknowledgePurchase` do plugin (o `finish` da Apple). Os textos dizem App Store. A retomada (compra paga e não confirmada) segue igual: a Apple entrega de novo a transação não encerrada | M |
| o servidor (um `servidor/pagamento_apple.py` ao lado do `pagamento_play.py`) | conferir a transação assinada pela Apple (a cadeia de certificados até a raiz da Apple; a biblioteca `cryptography` já está no `Dockerfile`, por causa do AdMob) ou perguntar à **App Store Server API** com a chave do servidor; o app, o produto, o ambiente (as de teste, *Sandbox*, só com uma `SOTERRA_APPLE_TESTE=1`), a conta; creditar **uma vez** por transação; o teto de R$ 400 em 24 h somando tudo; o **reembolso** pelos avisos da Apple (*App Store Server Notifications V2*: `REFUND`, `REVOKE`) numa rota nova, com o mesmo "faltou" no painel do Mestre. As provas com uma Apple de mentira, como as da Google | G |
| os Termos e a Privacidade | a Apple como meio de pagamento; o reembolso é pedido à Apple | P + advogado |

**O que a Apple cobra no Brasil.** Desde junho de 2026, por um acordo com o CADE,
o Brasil tem regra própria: a comissão é de **21%**, ou **10%** para quem está no
Programa para Pequenas Empresas, e a compra pela Apple soma uma **taxa de
processamento de 5%** — no programa, cerca de **15% no total** (a soma é nossa,
a página da Apple dá as partes). O acordo também
permite, com regras (a compra da Apple ao lado, com o mesmo destaque, e nada para
menores de 18), oferecer outro meio de pagamento ou um link para pagar fora — por
uma comissão menor sobre a venda, não zero. Para o SOTERRA, **a compra da Apple é
o caminho simples**. Confira os números na página da Apple
(<https://developer.apple.com/support/payment-options-on-the-app-store-in-brazil>)
na hora de ligar a loja: eles mudam.

### 8.3 Diretriz 5.1.1(v) — excluir a conta dentro do app: conferido, já existe

- **No jogo:** Menu → **Conta: <nome>** (ou Configurações → *Contas e nuvem*) →
  **Excluir conta…** → o nome exato e a senha (`js/ui/hud.js`, `sheetExcluirConta`;
  servidor: `/api/conta/excluir`). A exclusão é a de verdade (`servidor/privacidade.py`):
  não depende de mandar e-mail a ninguém, que é o que a Apple proíbe.
- **Pelo site, na aba do jogo:** a página da conta (`site/conta.html`) tem o
  mesmo botão.
- O caminho vai nas notas da revisão (6.5). **Nada a mudar.**

### 8.4 Diretriz 1.2 — o chat entre jogadores: conferido, já existe

A Apple pede quatro coisas, e o jogo tem as quatro: **filtro** (`js/core/palavroes.js`,
na hora de mandar e de mostrar); **denúncia** à equipe com resposta
(`js/ui/moderacao.js`, o painel do Mestre); **bloquear** quem incomoda
(*Silenciar* no perfil do jogador, e *Marcar inimigo*, que corta mensagem
particular e troca); **contato** publicado (system@viidoo.io, nos Termos e na
Privacidade). **Nada a mudar.**

### 8.5 O bônus sorteado da Gema — a "caixa de recompensa"

A Gema Enterrada dá à peça um bônus **sorteado** com pesos fixos
(`DATA.gema.pesos` em `js/core/data/items.js`): **+1 PA 10%**, **+1 PP 20%**,
**dano 30%**, **vida 40%**. Os **Fragmentos de Gema** se compram na loja **por
barras** (`servidor/loja.py`, `_FRAGMENTOS`), e 100 viram uma Gema. Comprar o
caminho para um resultado sorteado é o que a Apple chama de *loot box*.

- **A diretriz 3.1.1** não proíbe: exige mostrar **as chances de cada resultado
  antes da compra**. O conserto é **P**: escrever as quatro chances na descrição
  dos fragmentos (loja) e na forja, ao engastar. (A forja depois do +5, que pode
  falhar, vale a mesma lembrança se as pedras que ela gasta forem vendidas por
  barras: mostrar a chance de cada batida.)
- **A classificação:** no Brasil, marcar "caixas de recompensa" leva o
  aplicativo a **18 anos** — e, desde fevereiro de 2026 (segundo a imprensa), o
  iPhone no Brasil barra app de 18 anos para quem não confirmou ser adulto. Não
  marcar, sendo, é declarar errado.
- **A lei brasileira:** o ECA Digital (Lei 15.211/2025) restringe caixas de
  recompensa em jogos acessados por menores. Isso vale para o jogo inteiro, web e
  Android também.

**Decida com o advogado** (`REVISAO_JURIDICA.md`) se a Gema vendida em fragmentos
é caixa de recompensa. Os dois caminhos limpos: **parar de vender os fragmentos
por barras** (eles continuam caindo nos portais, no prêmio diário e no anúncio)
ou **mostrar as chances e responder "Sim"** — e viver com os 18 anos no Brasil.

### 8.6 O anúncio premiado (AdMob) no iPhone — fica para depois

**Hoje o AdMob NÃO entra no iPhone, e a área "Ganhar prêmios" e a moeda da praça
não aparecem lá** (25/10, `JOGO.Mobile.falta('anuncio')`, 8.7). O `ios.includePlugins` do
`capacitor.config.json` lista os plugins do iPhone, e ele fica de fora de
propósito. Motivo: com o SDK de anúncios da Google dentro, o `Info.plist` precisa
do id do aplicativo no AdMob (**sem ele o aplicativo fecha ao abrir**), dos
identificadores SKAdNetwork e da frase do aviso de rastreamento — e a ficha
precisa declarar o que o SDK coleta. A prova `tests/app_ios.py` cobra essa amarra:
plugin no iPhone sem as três chaves não passa.

**O que fazer quando for a hora** (tamanho **M** no total):

1. **AdMob:** **Apps → Adicionar app → iOS** (é outro app, com outro id
   `ca-app-pub-…~…`) e um **bloco premiado** novo para ele, com a mesma URL de
   verificação (`GOOGLE_PLAY.md` §10.2).
2. **Servidor** (`servidor/anuncio.py`): o bloco por plataforma (uma
   `SOTERRA_ANUNCIO_BLOCO_IOS`) e a verificação aceitando os dois blocos.
3. **Jogo** (`js/core/premio_anuncio.js`): no iPhone, o bloco de teste é outro
   (`ca-app-pub-3940256099942544/1712485313`); e **ao entrar na área**, antes de
   ligar o SDK, o pedido de rastreamento da Apple (`requestTrackingAuthorization()`
   do plugin) — a regra do dono continua: nada antes de o jogador entrar na área.
   Quem negar ainda vê anúncio, só que sem personalização.
4. **`Info.plist`:** `GADApplicationIdentifier` (o id do passo 1), os
   `SKAdNetworkItems` (a lista da Google:
   <https://developers.google.com/admob/ios/3p-skadnetworks>) e
   `NSUserTrackingUsageDescription` ("O SOTERRA usa este identificador para
   mostrar anúncios mais relevantes na área Ganhar prêmios").
5. **`capacitor.config.json`:** o AdMob no `includePlugins`; `npx cap sync ios`;
   build novo.
6. **Ficha:** classificação "publicidade: Sim"; privacidade com o que o SDK coleta
   — **Identificadores → ID do dispositivo** (rastreamento, se o jogador aceitar),
   **Localização aproximada** (pelo IP), **Dados de uso → Interação com o produto e
   Dados de publicidade**, **Diagnóstico → Desempenho e Falhas** — confira a página
   da Google na hora (<https://developers.google.com/admob/ios/privacy/data-disclosure>).
7. **Termos e Privacidade:** hoje dizem "a área Ganhar prêmios do aplicativo de
   **Android**" — passam a falar dos dois.

### 8.7 Os pontos do jogo que supõem Android — a separação por plataforma (feita em 25/10)

**A regra:** `JOGO.Mobile.app()` (`js/mobile.js`), `JOGO.CompraPlay.noApp()`
e `SITE.noApp()` (`site/site.js`) perguntam "estou no aplicativo?" — e a resposta é
**sim** no Android e no iPhone. O que é comum aos dois (o botão Loja sem Mercado
Pago, a aba do site, a qualidade gráfica, os avisos) continua igual. O que o iPhone
ainda não tem responde a uma segunda pergunta: **qual aplicativo?**

**UMA pergunta, num lugar só** (`js/mobile.js`; a mesma no `site/site.js`):

| função | o que responde |
|---|---|
| `JOGO.Mobile.plataforma()` | `'android'`, `'ios'` ou `'web'` — o Capacitor diz pelo `getPlatform()`; casca sem `getPlatform` é o Android |
| `JOGO.Mobile.ios()` | é o iPhone? |
| `JOGO.Mobile.falta(recurso)` | o aplicativo deste aparelho **não tem** este recurso? No Android e na web, **sempre falso** |
| `JOGO.Mobile.FALTA_NO_IPHONE` | `{ sair, compra, anuncio }` — a lista. Quando a compra da Apple ficar pronta, sai `compra` daqui e o resto do jogo acompanha |
| `JOGO.Mobile.loja()` | "App Store" ou "Google Play", para os textos |
| `SITE.plataforma()`, `SITE.faltaNoAparelho(recurso)`, `SITE.FALTA_NO_IPHONE` | o mesmo, no site. No quadro da aba o Capacitor do iPhone **não entra** (8.8): o site lê a marca `soterra-plataforma` que o jogo deixa na sessão da aba, ou o `plataforma=ios` que a aba põe na primeira página |

Cada ponto do jogo pergunta pelo **recurso**, não pelo sistema:

| arquivo | o que acontecia no iPhone | o que faz agora |
|---|---|---|
| `js/ui/hud.js` (o menu) | o **"Sair do jogo"** chamava `App.exitApp()`, que no iPhone **não está implementado** (lido no plugin): tocar em "Sair" não fazia nada. E a Apple não quer aplicativo que se fecha sozinho | com `falta('sair')`, o botão nem entra no menu (o iPhone fecha pelo gesto do sistema) |
| `js/core/loja.js` | a loja seguia só o `SOTERRA_LOJA` do servidor | com `falta('compra')`, `L.fechada()` é verdadeiro e o `<html>` leva `loja-fechada` (somem o botão Loja, a compra de barras das Configurações e as frases que mandam à loja), sem tocar na chave guardada, que é a resposta do servidor |
| `js/core/compra_play.js` | a "compra pela Google Play" falaria com a loja da Apple (8.2) | `JOGO.CompraPlay.ligada()` = `noApp()` menos o iPhone: lá não liga a retomada na abertura, não prepara nem compra |
| `js/core/premio_anuncio.js` | sem o plugin no iPhone, a área diria **"Atualize o aplicativo pela Play Store"**; e a moeda "Prêmio Grátis!" da praça chamaria para ela | com `falta('anuncio')`, `noApp()` é falso: a seção das Configurações e a moeda da praça não aparecem, e nada é pedido |
| `js/ui/hud.js` (Configurações) | **"Avaliar na Google Play"** — no iPhone a caixa que abre é a da Apple | "Avaliar na App Store" e "a Apple decide quando mostrar" (as duas frases em en/es) |
| `js/ui/site_aba.js` | a aba já funcionava (quadro da mesma origem) | no iPhone, a primeira página leva também `plataforma=ios`; no Android o endereço fica igual |
| `site/site.js` · `site/loja.js` | a loja da aba mostraria a compra do jogo — a "Google Play" | `SITE.lojaFechada()` e o `fechada()` da loja respondem "fechada" no iPhone: "A loja abre em breve", e o link "Loja" do menu do site some |

**O que ficou como está, de propósito:**

- `site/termos.html` e `site/privacidade.html` dizem "no aplicativo de Android, pela
  Google Play" e "a área Ganhar prêmios do aplicativo de Android" — **continua
  verdade** (o iPhone não compra nem mostra anúncio). Mudam junto com a compra da
  Apple e o AdMob do iPhone, com o advogado.
- As frases da compra pela Play e da área de anúncios citam a Google Play — no iPhone
  elas não aparecem mais.
- `js/core/avaliacao.js` (a caixa nativa no iPhone é a da Apple), `js/core/notificacoes.js`
  (os avisos funcionam igual) e `js/core/eventos_uso.js` (o iPhone conta como "app",
  junto do Android; separar seria mudar o servidor também).

**As provas:** `node tests/app_casca.js` (71: a metade nova põe um Capacitor falso
com `getPlatform` — `'ios'`, `'android'` e sem ele — e cobra a lista, a classe `ios`,
a marca na sessão, a compra que não liga no iPhone e **liga igual no Android**, a
lista igual no jogo e no site, e o que a HUD e a aba fazem com a resposta);
`node tests/loja_fechada.js` (18: no iPhone a loja segue fechada com a vitrine
aberta, e a chave do servidor não é tocada; o Android abre e fecha como antes);
`node tests/premio_anuncio.js` (46: no iPhone nada de área, de moeda nem de pedido;
no Android, igual). Visto no navegador com `?app=1&plataforma=ios` (a casca fingida
do iPhone) contra uma API de verdade com a loja **aberta**: sem "Sair do jogo", sem
Loja, sem barras, sem "Ganhar prêmios", "Avaliar na App Store", e a loja da aba
dizendo "abre em breve"; e com `?app=1`, o Android igual a antes. As provas de
navegador da aba e da compra seguem passando (`site_aba.html` 39, `loja_na_aba.html`
20, `compra_play.html` 33, `site_porta.html` 19, `app_casca.html` 25).

**Precisa de AAB novo?** Não: é tudo do jogo, servido pela web. Publicou, o
Android segue igual e o iPhone já abre certo.

### 8.8 O que o iPhone muda por baixo (lido no código do Capacitor 8)

- **A entrada abriria no Safari — consertado em 25/10.** O Capacitor do iPhone só
  chama de "do aplicativo" o endereço que **começa pelo `server.url` inteiro**
  (`https://soterra.viidoo.io/index.html`); a página da conta (`/site/conta.html`)
  não começa assim, então ele a mandaria para o Safari e o aplicativo ficaria sem
  entrada. O Android compara só o domínio, por isso nunca se viu.
  **O conserto:** `"allowNavigation": ["soterra.viidoo.io"]` no `server` do
  `capacitor.config.json`. **No Android não muda nada:** lá esse domínio já é o
  do aplicativo (`Bridge.java`: ele já está na lista de endereços servidos, na
  máscara de navegação e nas origens da ponte). O `tools/empacota_www.py` recusa
  montar sem a linha — se o domínio do jogo mudar, ela muda junto.
- **Todo `target=_blank` e todo `window.open` vão para o Safari** no iPhone, até
  os do próprio domínio (no Android a página inteira navegava). O jogo já trata
  os links do site pela aba; ao acrescentar link novo, use a aba.
- **A ponte do Capacitor só entra na página principal**, nunca no quadro da aba
  (`forMainFrameOnly`). A aba já foi feita assim: a loja dela usa a compra do jogo
  de cima, e a marca `?app=1` diz ao site que ele está no aplicativo.
- **Sem service worker** (o WebView da Apple só o dá com *App-Bound Domains*, que
  bloqueiam a ponte fora dos domínios listados) e talvez **sem Cache Storage**: o
  "Jogo no aparelho" e o "Baixar tudo" não aparecem, e o jogo baixa da rede como na
  web (`js/app_jogo.js` e `js/app_modelos.js` já caem nesse caminho sozinhos). Se um
  dia o iPhone precisar guardar os 159 MB de modelos, o caminho é o plugin
  Filesystem — um projeto à parte.
- **Memória:** o iOS mata o WebView que passa do limite; o Capacitor recarrega
  sozinho (5.3, item 10). O iPhone não informa a memória ao jogo, então a qualidade
  padrão nele é a **média** (`JOGO.Mobile.padraoGrafico`).

---

## 9. A estrutura no repositório (25/10)

| arquivo | o quê |
|---|---|
| `package.json` · `package-lock.json` | `@capacitor/ios` **8.5.2**, a mesma do core e do android (a prova cobra); os atalhos `npm run sync:ios` e `npm run icones:ios` |
| `capacitor.config.json` | `server.allowNavigation` (8.8); a seção `ios`: o fundo preto, `contentInset: "never"` (o jogo cuida da área segura), `preferredContentMode: "mobile"`, sem pré-visualização de link no toque longo, e o `includePlugins` (todos os plugins menos o AdMob, 8.6) |
| `ios/` | o projeto do Xcode, **versionado** como o `android/` (abaixo) |
| `ios/App/App/Info.plist` | só deitado; sem barra de status; os três idiomas (as perguntas do sistema saem na língua do jogador); `ITSAppUsesNonExemptEncryption = false`; a frase da Fotos (sem ela, "Salvar imagem" do compartilhar **fecha o aplicativo**) |
| `ios/App/App/PrivacyInfo.xcprivacy` | o manifesto de privacidade que a Apple exige desde 2024: o UserDefaults (CA92.1) que o Capacitor usa, sem rastreamento, e os dados da 6.4 |
| `ios/App/App.xcodeproj/project.pbxproj` | `br.com.soterra.jogo`; **só iPhone** (`TARGETED_DEVICE_FAMILY = 1`: sem capturas e revisão de iPad); versão **1.1.0**; o manifesto dentro do app; iOS mínimo 15 |
| `codemagic.yaml` | a compilação na nuvem (seção 2 e 3) — sem segredo nenhum |
| `tools/icone_app.py --ios` | o ícone e a abertura do iPhone |
| `tools/empacota_www.py` | a mesma `www/` (a tela "sem conexão", que o iPhone também mostra pelo `errorPath`); passa a conferir o `allowNavigation` |
| `tests/app_ios.py` | **a prova da casca do iPhone** (47): versões, configuração, plugins, o projeto, o Info.plist, o manifesto, o ícone, o Git, a receita da nuvem |
| `.gitignore` · `.gitattributes` · `.dockerignore` · `tools/sobe_vps.py` | o `ios/` entra no Git (em LF) e **não** vai para o servidor; o `codemagic.yaml` também não |

**Versionar o `ios/`: sim.** É o projeto do aplicativo — a versão, o `Info.plist`,
o manifesto, o ícone moram nele, e é dele que a nuvem compila. O `ios/.gitignore`
do Capacitor deixa de fora o que se gera de novo a cada `npx cap sync ios` (a
cópia da `www/` em `App/App/public`, a cópia da configuração, o `config.xml`, o
build). O `Package.swift` do `CapApp-SPM` é reescrito pelo `sync` com os plugins
do `includePlugins`, e fica no Git porque o Xcode o lê; a prova confere que ele
está em dia.

**Gerar de novo do zero** (por exemplo, para trocar o identificador): apague
`ios/`, rode `npx cap add ios`, e refaça o que foi feito à mão — o `Info.plist`
inteiro (copie o de hoje), o `PrivacyInfo.xcprivacy` e a entrada dele no
`project.pbxproj`, `TARGETED_DEVICE_FAMILY = 1` e a versão, e `npm run icones:ios`.
A prova aponta o que faltar.

**Quando rodar o quê:** mudou o jogo → nada, ele vem do servidor. Mudou um
plugin, o ícone ou a versão → `npm run sync:ios`, commit, e um build no
Codemagic.

---

## 10. As versões

A versão (`MARKETING_VERSION`) mora no `project.pbxproj`; o número do build, o
Codemagic acerta sozinho (o último do TestFlight + 1). A Apple recusa build com
número repetido **dentro da mesma versão**.

| versão | build | gerado em | o que a casca tem |
|---|---|---|---|
| 1.1.0 | — | ainda não | o primeiro: o jogo do servidor, os avisos, compartilhar, avaliação, tela acesa; **sem** compra e **sem** anúncio |

---

## 11. O que não pôde ser provado aqui

Esta máquina é Windows: **nada foi compilado, assinado nem aberto num iPhone.** O
que foi provado: o `npx cap add ios` e o `npx cap sync ios` rodam aqui e um
`sync` não desfaz as mudanças feitas à mão; o `project.pbxproj` editado abre num
leitor de projetos do Xcode (a biblioteca `pbxproj`) com o manifesto nos recursos
do app; a prova `tests/app_ios.py` (47) reprova o ícone e a abertura padrão do
Capacitor e um projeto com objeto faltando. O que só o Mac (ou o Codemagic) e o
iPhone mostram:

1. **O projeto compila** com o Xcode 26 e os sete plugins pelo Swift Package
   Manager.
2. **A receita do Codemagic roda** — o primeiro build é a prova dela (3.2).
3. **A lista da 5.3**, em especial a entrada dentro do aplicativo (o
   `allowNavigation`), a área segura deitado e a memória.
4. **Os nomes dos menus** do App Store Connect e do Codemagic mudam de tempos em
   tempos: se um caminho acima não existir, procure pelo nome da função.
5. **Os preços e as regras** da seção 2 e da 8.2 foram conferidos em 25/10/2026
   e mudam.
