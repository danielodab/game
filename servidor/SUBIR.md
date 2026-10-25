# Subir o SOTERRA na Hostinger (VPS KVM)

Sobem quatro coisas de uma vez: o **jogo** (estático, abre em qualquer
navegador), o **site** (landing, ranking e conta, em `site/`), o **Relé** (os
jogadores se veem no Acampamento) e a **API** (a conta no servidor: login, o
mesmo save em qualquer máquina e o registro de cada peça, que impede item
duplicado).

Há dois caminhos:

- **O VPS já roda o Coolify** (com outras aplicações): siga a parte
  **No Coolify**, logo abaixo. NÃO rode o `instala.sh` nele — ele se recusa,
  porque disputaria as portas 80 e 443 com o proxy do Coolify.
- **VPS limpo**: siga as Partes 1 e 2 (alguns cliques no hPanel, uma vez só,
  e **um comando** no Windows a cada subida).

---

## No Coolify (VPS que já roda o Coolify)

O jogo entra como mais uma aplicação, num contêiner só (`Dockerfile` na raiz):
o Caddy de dentro separa arquivos, `/api` e `/ws`; a API e o Relé rodam como
usuário `soterra`; o banco mora em `/dados`, que TEM de ser um volume
persistente (sem ele o contêiner se recusa a subir, de propósito). Os nomes de
menu abaixo são os do Coolify v4.3.19 (setembro de 2026); versões mais velhas
mudam alguns rótulos.

### 1. O DNS (exemplo: `soterra.viidoo.io` na IONOS)

1. My IONOS → **Domains & SSL** → na linha do `viidoo.io`, o menu de três
   pontos em **Actions** → **DNS**.
2. **Add record** → **A** → **Host name** `soterra` (só o rótulo) → **Points
   to** o IP do VPS → **Save**. Não crie o subdomínio em "Subdomains" e não
   crie AAAA: o Let's Encrypt prefere o IPv6 e falha se ele apontar para outro
   lugar.
3. Confira no PowerShell (o Coolify consulta o 1.1.1.1):
   `nslookup soterra.viidoo.io 1.1.1.1` tem de responder o IP do VPS.

### 2. O acesso ao repositório privado (uma vez)

- **Sources** → **+ Add** → Name (ex.: `github-daniel`), Organization vazio →
  **Continue** → Webhook endpoint **Use an instance endpoint** → **Register
  with GitHub** → no GitHub, **Create GitHub App** → de volta ao Coolify,
  **Install repositories** → **Only select repositories** → `game` → **Install**.
- Se já existir um GitHub App das outras aplicações, não crie outro: no
  GitHub, Settings → Applications → Installed GitHub Apps → Configure →
  Repository access → acrescente o `game`.

### 3. A aplicação

1. **Projects** → **New project** `SOTERRA` → ambiente **production** →
   **+ New** → **Git Repository (with GitHub App)** → o servidor → o App →
   o repositório → **Load repository** → branch `main` → Build pack
   **Dockerfile** → **Continue**. O Continue não faz deploy: dá tempo de
   ajustar tudo antes.
2. **General**: **Ports exposes** = `80` (o padrão é 3000 e dá Bad Gateway).
   **Port mappings** VAZIO (80 e 443 são do proxy das outras aplicações).
3. **Domains**: apague o endereço `sslip.io` que o Coolify preencheu e ponha
   `https://soterra.viidoo.io` (com o `https://`: é o que faz o Coolify tirar o
   certificado).
4. **Persistent Storage** → **Add mount** → **Volume mount** → Name
   `soterra-dados`, Source Path vazio, Destination Path `/dados`. Mais seguro
   ainda contra apagar a aplicação sem querer: **Directory mount** com Source
   Path `/var/lib/soterra/dados` e Destination `/dados` (a pasta do VPS
   sobrevive a qualquer coisa que se faça com a aplicação).
5. Não mexa em **Healthcheck** (o do Dockerfile é o que vale) nem no nome de
   contêiner fixo (ele desligaria o deploy sem queda).
6. **Deploy** → acompanhe em **Deployment Logs**.

### 4. Depois do primeiro deploy

- **Backup diário**: **Scheduled Tasks** → **New scheduled task** → Name
  `backup`, Schedule `0 4 * * *`, Command `/app/servidor/coolify/backup.sh`,
  Container vazio → **Add task** → **Execute now** para testar. As cópias
  ficam em `/dados/backups`, com data e hora, as dos últimos 14 dias.
- **Ser o Mestre**: crie a sua conta pelo site; no **Terminal** da aplicação,
  `admin contas` e depois `admin mestre "SEU-NOME"`; abra o jogo de novo. A
  Nuvem confere a marca com o servidor a cada abertura: a sua conta vira o
  Mestre (Cavaleiro Negro, Panóplia, Caixa) sem chave no endereço.
- **Moderar sem sair do jogo** (02/10): logado na conta do Mestre, o botão ⚖
  (canto de baixo à direita) ou a tecla **F9** abre o painel do Mestre por cima
  de qualquer tela: buscar contas, presentear, **silenciar** e **banir** (1 h,
  24 h, 7 dias, 30 dias, permanente ou até uma data, sempre com motivo — o
  jogador vê o motivo e a data do fim), a **fila de denúncias**, quem está banido
  agora e a **auditoria** de toda ação do Mestre. O site do Mestre
  (`/site/mestre.html`) mostra a mesma fila, os banidos e a auditoria. No
  Terminal: `admin denuncias` e `admin auditoria`. Detalhes em
  `docs/SEGURANCA.md` §10.
- **Desfazer uma guilda** (04/10): no jogo, o painel do Mestre (F9), aba
  **Guildas** — lista TODAS as guildas (até a da equipe, que os jogadores não
  veem), com líder, membros e peças no banco; **Desfazer…** pede o nome da
  guilda digitado. As peças do banco voltam aos donos (saco, ou cofre do
  Acampamento se o saco estiver cheio), o empréstimo é recolhido de quem pegou,
  cada membro recebe uma carta e o nome fica livre. No Terminal: `admin guildas`
  e `admin desfazer-guilda "NOME"` (pede o nome de novo; é o mesmo caminho do
  painel, pelo juiz — nunca um `delete` direto no banco).
- **Outros comandos** no Terminal: `admin` (a ajuda), `admin banir "NOME"`,
  `admin eventos 50`, `admin agenda`, `admin backup`, `admin email-teste
  SEU@gmail.com`, `admin trocar-email "NOME" certo@exemplo.com`, `admin loja`
  e `admin loja-cancelar ID` (ver as partes 5 e 6, logo abaixo).
- **Excluir contas de teste** (25/10): `admin excluir "NOME" "OUTRO NOME"`.
  O nome pode ser o da conta (o de `admin contas`) ou o que aparece no
  ranking. O comando lista as contas, pede **EXCLUIR** digitado e usa a MESMA
  exclusão da página da conta: o save, os itens, as barras, os amigos e a
  guilda saem juntos, e a conta vira lápide. Não manda e-mail. A conta do
  Mestre não sai por aqui (`admin tirar-mestre` antes), e um nome que case com
  duas contas é recusado. Não tem volta: rode `admin backup` antes.
- **Nome reservado à equipe** (GM, Admin, Moderador, Mestre do Fundo…): o site
  recusa no cadastro; quem dá é você, no Terminal: `admin renomear "VELHO" "NOVO"`.
- **Eventos do mundo** (XP em dobro, Maré da Cisterna…): quem liga é o
  Mestre, no jogo, em Painel do Mestre → **Eventos do mundo**: ligar agora,
  agendar, ou uma regra semanal do calendário automático, sempre em hora de
  Brasília. O servidor confere a marca de Mestre da conta a cada pedido
  (`POST /api/eventos…`); nenhuma outra conta cria nada. Todo mundo vê em
  `/site/eventos.html`, na faixa do Acampamento e no painel do portal (a
  leitura, `GET /api/eventos`, é pública). O multiplicador é o que você quiser, de
  ×1,01 até ×10 (XP, vinténs, pedras e saque; o aviso não multiplica), dois eventos do mesmo
  tipo não se somam (vale o maior) e nenhum mexe na raridade das peças; o
  saque do evento também não soma com o Calabouço do Dia. Cancelar não apaga
  (fica a trilha). No Terminal, `admin agenda` lista o que está marcado e as
  regras vigentes, com hora de Brasília; `admin eventos` mostra quem ligou e
  quem cancelou (`agenda-evento`, `agenda-regra`, `agenda-cancela`).
- **Atualizar**: todo push no `main` refaz o deploy sozinho (Advanced → Auto
  deploy = Deploy on push). O contêiner velho só sai quando o novo está
  saudável; se o novo falhar, o velho continua no ar.
- **Uma vez só, no primeiro deploy com o cache por hash** (o que leva o
  `js/versao.js`, as marcas e as regras de cache do `servidor/coolify/Caddyfile`):
  o contêiner que está no ar antes dele não manda `Cache-Control` (confira no
  PowerShell: `curl.exe -sI https://soterra.viidoo.io/index.html` não tem essa
  linha, e o `Last-Modified` é a hora do deploy anterior). Sem ela, o Chrome
  usa o que guardou, sem perguntar, por um décimo da idade do arquivo. Então,
  só nesse deploy, um navegador pode misturar o velho e o novo de dois jeitos:
  quem abriu o jogo ou o site pouco antes do push pode receber do cache a
  página velha, rodando com os scripts novos (um F5 resolve); e quem abrir o
  jogo nos segundos em que os dois contêineres dividem o tráfego pode guardar o
  arquivo velho no endereço novo (o F5 não resolve; o Ctrl+Shift+R resolve).
  Dura no máximo um décimo do tempo desde o deploy anterior (10 horas depois
  dele, 1 hora; 5 dias depois, 12 horas) e se cura sozinho: passado o prazo, o
  navegador pergunta de novo e desce o arquivo novo. O jogo no ar tem uma conta
  só: basta subir num horário em que ninguém está jogando (feche o jogo e o
  site antes do push e espere o deploy terminar) e, depois dele, apertar
  Ctrl+Shift+R uma vez no jogo e uma vez no site, o que resolve os dois casos.
  Limpar o cache do Chrome também resolve, mas só "Imagens e arquivos
  armazenados em cache": "Cookies e outros dados do site" levam junto o save do
  jogo. Desligar o Rolling Update nesse deploy tira o segundo caso, ao custo de
  uns segundos fora do ar, mas não é preciso. Do segundo deploy em diante nada
  disso vale: as páginas saem com `no-cache`, e só fica um ano o endereço com o
  hash do arquivo que o próprio contêiner tem.
- **Não perca o banco**: nunca apague a aplicação com "delete volumes"
  marcado (o banco e as cópias vão juntos). Em Servers → Docker Cleanup,
  deixe **Keep unused volumes**. Baixe uma cópia de `/dados/backups` de vez em
  quando, ou ligue Automation → Backups com destino S3.
- **Logs**: Runtime Logs (o jogo, a API, o Relé), Deployment Logs (o build),
  Servers → Proxy → Logs (o certificado).

### 5. O e-mail do servidor (a conta no site)

Sem isto o jogo funciona igual: a API responde 503 nas rotas que mandam
e-mail (trocar o e-mail e "esqueci a senha") e o site esconde o "esqueci".
Trocar a senha, ver e encerrar sessões e a loja não precisam de e-mail.

O remetente é `system@viidoo.io`, pelo SMTP do Google (o Google Workspace já
recebe o e-mail do `viidoo.io`), com uma **senha de app**. A senha nasce e
fica com você: é gerada no Google e colada no Coolify, e em nenhum outro
lugar. Se aparecer por engano num chat, revogue essa senha de app no Google
e gere outra.

1. **A senha de app**, na Conta do Google de `system@viidoo.io` →
   Segurança: com a verificação em duas etapas ligada, aparece "Senhas de
   app". Gere uma (são 16 letras) e guarde só até colar no Coolify. Se a
   opção não aparecer, o administrador do Workspace precisa permitir. Os
   nomes dos menus mudam de vez em quando: na dúvida, a ajuda do Google.
2. **O DNS do `viidoo.io`** (na IONOS, Domains → DNS):
   - **SPF**: um ÚNICO TXT no `@`: `v=spf1 include:_spf.google.com ~all`. Se
     já existir um TXT começando com `v=spf1`, edite esse: dois registros
     SPF invalidam os dois.
   - **DKIM**: o `google._domainkey` já está publicado; confira no Admin do
     Google (Gmail → Autenticar e-mail) que ele está autenticando.
   - **DMARC**: um TXT com nome `_dmarc`:
     `v=DMARC1; p=none; rua=mailto:<uma caixa que você lê>`. Depois de umas
     semanas passando, suba para `p=quarantine`.
   - Confira no PowerShell: `nslookup -type=txt viidoo.io 1.1.1.1`,
     `nslookup -type=txt _dmarc.viidoo.io 1.1.1.1`, e que o MX continua o do
     Google: `nslookup -type=mx viidoo.io 1.1.1.1`.
3. **O VPS alcança o Google?** No Terminal da aplicação:
   `python3 -c "import smtplib,ssl;s=smtplib.SMTP('smtp.gmail.com',587,timeout=10);s.starttls(context=ssl.create_default_context());print('587 ok')"`.
   Se não passar, teste a 465:
   `python3 -c "import smtplib,ssl;smtplib.SMTP_SSL('smtp.gmail.com',465,timeout=10,context=ssl.create_default_context());print('465 ok')"`,
   e use `PORTA` 465 e `SEGURANCA` ssl no passo 4.
4. **As variáveis no Coolify**: Application → **Environment Variables**, uma por vez:

   | Nome | Valor |
   |---|---|
   | `SOTERRA_SMTP_HOST` | `smtp.gmail.com` |
   | `SOTERRA_SMTP_PORTA` | `587` |
   | `SOTERRA_SMTP_SEGURANCA` | `starttls` |
   | `SOTERRA_SMTP_USUARIO` | `system@viidoo.io` |
   | `SOTERRA_SMTP_REMETENTE` | `system@viidoo.io` |
   | `SOTERRA_SMTP_SENHA` | a senha de app, colada por você |
   | `SOTERRA_ENDERECO` (opcional) | `https://soterra.viidoo.io` |

   - Em **todas**: a opção de build DESMARCADA ("Build Variable" ou
     "Available at Buildtime", conforme a versão) e a de Runtime ligada.
     Num deploy por Dockerfile a variável de build vira ARG, e a senha iria
     para a imagem.
   - Na `SOTERRA_SMTP_SENHA`: marque **Is Literal** (o Coolify expande `$`
     dentro dos valores).
   - **Nunca** crie `SOTERRA_EMAIL_PROVA` no Coolify: é o modo de prova dos
     testes, e os e-mails iriam para um arquivo em vez de sair.
   - Salve e faça **Redeploy**: as variáveis só valem num contêiner novo (e
     o Redeploy fecha o Terminal aberto).
5. **Depois do deploy**:
   - Runtime Logs: tem de aparecer
     `correio: smtp.gmail.com:587 starttls como system@viidoo.io`, sem senha.
     `correio: DESLIGADO (falta …)` diz qual variável faltou.
   - Terminal: `admin email-teste SEU@gmail.com` e confira a caixa de entrada
     e o spam; em "Mostrar original", SPF, DKIM e DMARC têm de dizer PASS.
   - Em `/site/conta.html`, o "esqueci a senha" aparece ligado.
   - Quem se cadastrou com o e-mail errado não recebe código nenhum:
     `admin trocar-email "NOME" certo@exemplo.com`, só depois de você
     confirmar por conta própria quem é a pessoa.

Como a API usa o e-mail: o código tem 6 dígitos, vale 15 minutos e 5
tentativas; cada conta pede no máximo 3 por hora, com 1 minuto entre um e
outro. O "esqueci" responde sempre a mesma frase (não conta quem tem conta),
aceita 10 pedidos por IP por hora e manda no máximo 60 e-mails por hora no
servidor todo (o Gmail também tem um teto diário). O código nunca vai para o
log; no banco fica só um hmac dele, com o segredo de `/dados/segredo` (criado
sozinho na primeira subida) ou de `SOTERRA_SEGREDO`. O limite por IP lê o
X-Forwarded-For da direita para a esquerda, e só vale se o Caddy de dentro
confiar no proxy do Coolify (`trusted_proxies` no `servidor/coolify/Caddyfile`);
sem isso a API só vê IP privado e o limite por IP fica desligado (valem o da
conta e o global).

### 6. A loja de vinténs

**Fechar a loja (25/10).** Para lançar o jogo sem loja, enquanto a Google
aprova a conta de pagamentos, ponha no Coolify `SOTERRA_LOJA` = `0`, com
Runtime ligado e Build desligado, e faça **Redeploy**. Nos Runtime Logs aparece
`loja: FECHADA (SOTERRA_LOJA=0)`. Com a loja fechada:

- o botão "Loja" some do menu e da praça, a compra de barras some das
  Configurações do aplicativo, a chamada de ofertas da praça não aparece, e as
  frases que mandam à "loja do site" saem;
- a página `/site/loja.html` diz que a loja abre em breve, e o link "Loja" do
  menu do site some;
- comprar, presentear e começar um pagamento respondem 503;
- o que já está em andamento **segue**: os prêmios do anúncio e do diário, os
  presentes do Mestre e os convites continuam chegando ao jogo, e um pagamento
  já feito continua sendo conferido e entregue.

Para abrir: apague a variável (ou ponha `1`) e faça Redeploy. O jogo guarda no
aparelho a última resposta, então o botão volta na abertura seguinte. Prova:
`python tests/loja_fechada_api.py`, `node tests/loja_fechada.js` e
`tests/loja_na_aba.html`.

Em `/site/loja.html` o jogador troca vinténs por personagens, bônus de XP
(1, 3 e 7 dias), pedras de forja, Insígnias de Fundação (as "pedras de
guilda": 10 fundam uma guilda) e o Pergaminho da Reescrita. O servidor confere
o saldo que o último save mostrou (só o bolso; o cofre não conta) mais o que
está **a caminho** (pacotes pagos e presentes de vinténs que o jogo ainda não
recebeu), reserva os vinténs e guarda o pedido. O jogo busca o pedido quando
abre logado na conta Principal, desconta e entrega, e o save seguinte
confirma ("entregue"). Se na hora da entrega faltarem vinténs no jogo, o
pedido volta ("devolvido"). O Mestre compra sem gastar.

- **Preços** moram só em `servidor/loja.py` (`CATALOGO` e `PACOTES`, com a
  conta da régua no comentário do topo): o site e o jogo leem do servidor, sem
  repetir número. Para mudar, edite ali, commit e push (o deploy leva). Reveja
  a cada portal aberto: a renda por hora pode quase dobrar.
- **Sem janela de limite** nas pedras, no bônus de XP e nas insígnias: o preço
  é o freio. Ficam os tetos contra abuso (5 pedidos abertos, 10 compras por
  hora, 30 pedidos por hora), a compra única de cada classe e a Reescrita 1 a
  cada 30 dias. Pacotes pagos e presentes do Mestre não contam nesses tetos.
- **O bônus de XP** vale ×1,5 para o grupo; o prazo corre no relógio do
  servidor a partir da ENTREGA no jogo, e comprar de novo soma os dias. Não se
  multiplica com o Pergaminho da Sabedoria (que saiu da venda: o bônus o
  substitui; quem já tem continua usando) e, com evento de XP, para em ×2.
- **Fora da loja, de propósito**: a Âncora de Forja, equipamento, cartas
  avulsas, estrelas, selos, giros, pets, sorte de saque, bônus de guilda,
  XP direto e multiplicador de vinténs.
- **No Terminal**: `admin loja` (os 30 últimos pedidos; `admin loja 100`
  para mais), `admin loja-cancelar ID` (só pedido pendente ou retirado: a
  reserva sai e ele não vai mais para o jogo; **não** cancele o crédito de um
  pacote pago — o sku começa com `pacote-` — senão o jogador perde o que
  pagou) e `admin eventos` (a trilha: `loja-compra`, `loja-cancela`,
  `loja-entregue`, `loja-estorno`, `presente-admin`, `pagamento-credito`,
  `pagamento-estorno`, `avatar`).
- **Pedido preso** (o jogo retirou e não confirmou em 24 h): o próprio
  jogador pode cancelar no site (menos o crédito de pacote e o presente).
- **O painel do Mestre** (`/site/mestre.html`, só para a conta com a marca de
  Mestre): busca qualquer conta (pelo nome, pelo e-mail inteiro ou pelo
  `#número`), mostra a ficha e dá de **presente** uma classe, um item da loja
  ou vinténs (até 100.000 por presente; 500.000 por dia). O presente é um
  pedido de preço 0 que anda pelo mesmo caminho da compra; dá para cancelar
  até o jogo buscar. Lá também aparecem os pagamentos (cada um com o botão
  **conferir no Mercado Pago**) e os **alertas** de cada conta.
- **O retrato no ranking**: na página da conta, o jogador escolhe o retrato
  entre as classes que tem e as fusões delas; a conta do Mestre veste o
  Cavaleiro Negro.

### 7. Os pacotes de vinténs (Mercado Pago)

Sem isto o jogo funciona igual: na loja os pacotes aparecem "em breve" e as
rotas de pagamento respondem 503. Com isto, o jogador paga no Mercado Pago
(Pix ou cartão; boleto e lotérica ficam fora), o servidor confere o pagamento
na API do Mercado Pago e credita os vinténs UMA vez; eles aparecem "a caminho"
no site (já dá para gastar) e entram na carteira quando o jogo abrir.

Os pacotes (em `servidor/loja.py`, `PACOTES`): Bolsa de 1.000 vinténs por
R$ 4,90 · Saco de 5.500 por R$ 19,90 · Arca de 12.000 por R$ 39,90 · Tesouro
de 25.000 por R$ 79,90. Por conta: no máximo 10 pedidos de pacote por hora e
R$ 400,00 em 24 h — no que se pede E no que credita. O link de pagamento vale
2 h e aceita mais de um pagamento; o que passar do teto NÃO credita e vira o
alerta "Pagamento acima do teto de 24 h" no painel do Mestre: você estorna no Mercado Pago ou,
passadas as 24 h, aperta **conferir no Mercado Pago** na ficha e ele entra.

1. **A conta de VENDEDOR** no Mercado Pago é a sua (CPF ou CNPJ e a conta
   bancária que recebe). Nada disso passa pelo assistente.
2. **Painel de desenvolvedor** (Suas integrações) → Criar aplicação
   ("SOTERRA", Checkout Pro, pagamentos online).
3. **Credenciais de TESTE primeiro**: o Access Token de teste e os usuários de
   teste (vendedor e comprador) que o painel cria. As de PRODUÇÃO só depois de
   ativar a conta e a aplicação (o painel pede os dados do negócio).
4. **Webhooks** → Configurar notificações: URL
   `https://soterra.viidoo.io/api/pagamento/aviso`, evento "Pagamentos" (e
   "Contestações", se aparecer) → Salvar → copie a **assinatura secreta**. O
   botão "Simular" do painel manda um aviso de mentira: a Runtime Logs tem de
   mostrar `pagamento: aviso do Mercado Pago` e, com o id da simulação,
   "não conhece o pagamento" (está certo). A preferência não leva
   `notification_url`: todo aviso chega por este caminho, assinado.
5. **As variáveis no Coolify** (Environment Variables; Runtime ligado, Build
   DESLIGADO em todas; no token e na assinatura, marque **Is Literal**):

   | Nome | Valor |
   |---|---|
   | `SOTERRA_MP_TOKEN` | o Access Token (o de produção começa com `APP_USR-`), colado por você |
   | `SOTERRA_MP_SEGREDO` | a assinatura secreta do webhook, colada por você |
   | `SOTERRA_ENDERECO` | `https://soterra.viidoo.io` (aqui é obrigatório: é a volta do navegador) |
   | `SOTERRA_MP_TESTE` | `1`, só na fase de teste |

   Salve e faça **Redeploy** (fecha o Terminal aberto). Se o token ou a
   assinatura aparecerem por engano num chat, gere outros no painel do
   Mercado Pago.
6. **Conferir**: a Runtime Logs tem de mostrar
   `pagamento: Mercado Pago (teste), volta em https://soterra.viidoo.io`
   (`pagamento: DESLIGADO (falta …)` diz qual variável faltou); na loja, os
   pacotes sem "em breve"; compre a Bolsa com o comprador de teste; os vinténs
   aparecem "a caminho"; abra o jogo logado; a carteira sobe. No painel do
   Mestre, a ficha da conta mostra o pagamento.
7. **Produção**: troque o token pelo de produção, APAGUE `SOTERRA_MP_TESTE`,
   Redeploy, faça UMA compra real da Bolsa (R$ 4,90) e estorne pelo painel do
   Mercado Pago: tem de aparecer o alerta "estorno" no painel do Mestre.
8. Sem as variáveis, tudo volta a "em breve" sem quebrar nada. Nunca deixe
   `SOTERRA_MP_TESTE` junto com o token de produção por esquecimento: o
   servidor não creditaria os pagamentos reais (e logaria `live_mode=True, e
   o servidor está em modo teste: não credita`). Ele responde 503 a esses
   avisos, e o Mercado Pago avisa de novo por um tempo: corrigida a variável
   (Redeploy), os reenvios creditam. O que tiver passado disso, confira pelo
   botão **conferir no Mercado Pago** da ficha da conta.

Como o servidor segura o dinheiro: nunca credita pela volta do navegador nem
pelo corpo do aviso — confere a assinatura e CONSULTA o pagamento na API do
Mercado Pago; um crédito por pagamento (o id do Mercado Pago é a chave),
mesmo com o aviso repetido ou chegando nos dois contêineres do deploy; nenhum
dado pessoal vai ao Mercado Pago; o token e a assinatura nunca vão para o log.
Se o jogo recusar um crédito pago, ele volta sozinho (até 3 vezes; depois vira
alerta). **Estorno e contestação** não tiram vinténs do jogo: o crédito que o
jogo ainda não confirmou é cancelado; o que já entrou vira **alerta** no painel
do Mestre (e na Runtime Logs), e você decide (conversar, banir, `admin`). Uma
**disputa aberta** no Mercado Pago (a reclamação ainda sem desfecho) só vira
alerta: o crédito fica, e o desfecho chega depois (o estorno, que segue a regra
acima, ou o pagamento de volta a aprovado). **Pago e sem vintém** (o aviso não
chegou): o jogador tem o botão "conferir" em "Seus pacotes", e você, o
**conferir no Mercado Pago** da ficha; os dois só consultam o Mercado Pago.

**O que você decide, fora do código**: os termos da loja e a política de
reembolso (o direito de arrependimento de 7 dias do CDC em compra pela
internet; e o vintém já gasto ou entregue), nota fiscal/MEI, a idade mínima de
quem compra, e o que fazer com uma conta de alerta.

---

## Parte 1 — no hPanel (uma vez)

### 1. O VPS

- VPS → **Sistema operacional** → o **puro, sem painel**: **Ubuntu 24.04**.
  Nada de CloudPanel, cPanel, Docker ou "Ubuntu com …": o instalador cuida de
  tudo, e um painel disputaria as portas 80 e 443 com ele. (O 22.04 também
  funciona com o instalador, mas o 24.04 é o recomendado.)
- Defina a **senha de root** quando o hPanel pedir. É ela que o Windows vai pedir.
- Em VPS → **Visão geral**, anote o **IP** (ex.: `181.215.1.2`) e o
  **hostname** (ex.: `srv123456.hstgr.cloud`).
- Teste o acesso no PowerShell: `ssh root@IP-DO-VPS`. Na primeira vez ele
  pergunta se confia no servidor (responda `yes`) e depois pede a senha.
  `exit` para sair.

### 2. O firewall (se você criar um)

O firewall do hPanel (VPS → **Segurança** → **Firewall**) fica fora do VPS e,
depois de ativado, **bloqueia tudo o que não tiver regra**. Um firewall vazio
derruba o SSH, o site e o certificado.

Se for usar (é recomendado), crie antes três regras **Aceitar**, protocolo
**TCP**, origem **qualquer**, nas portas **22**, **80** e **443**, e ative.
Mudou uma regra depois? Clique em **Sincronizar**. Não abra mais nada: a API
(8300) e o Relé (8791) só escutam dentro do VPS e chegam pelo Caddy.

Sem firewall criado, nada é bloqueado.

### 3. O endereço

Escolha por onde o jogo vai abrir:

| Você tem | Endereço | O que fazer no DNS |
|---|---|---|
| um domínio, e quer um subdomínio | `jogo.seudominio.com.br` | criar um registro **A**, nome `jogo`, apontando para o IP |
| um domínio, e quer ele inteiro | `seudominio.com.br` e `www.seudominio.com.br` | apagar os registros A, AAAA e CNAME de `@` e de `www` (são o estacionamento da Hostinger) e criar **A** `@` → IP e **A** `www` → IP |
| nenhum domínio ainda | o hostname `srv123456.hstgr.cloud` | nada: a Hostinger já publica esse nome, e ele tem HTTPS de verdade |
| só o IP | `181.215.1.2` | nada, mas fica **sem HTTPS** (sem cadeado). Provisório |

O DNS fica em **Domínios** → seu domínio → **Gerenciar** → **DNS /
Nameservers**. Isso vale quando o domínio usa os nameservers da Hostinger, que
é o padrão de domínio comprado lá.

Antes de subir, confira no PowerShell contra um resolvedor público:

```powershell
nslookup jogo.seudominio.com.br 8.8.8.8
```

A resposta tem de ser o IP do VPS. Pode levar de minutos a algumas horas.
Se subir antes, não tem problema: o instalador avisa, e o HTTPS sai sozinho
quando o DNS chegar.

---

## Parte 2 — no Windows (toda vez que subir)

O pacote é o **último commit**. O que não foi commitado não vai, e o script avisa.

No PowerShell, na pasta do jogo:

```powershell
python tools/sobe_vps.py IP-DO-VPS jogo.seudominio.com.br
```

Com o domínio inteiro, passe o `www` também. Ele passa a levar ao endereço
principal, porque a sessão do site e do jogo mora num endereço só:

```powershell
python tools/sobe_vps.py IP-DO-VPS seudominio.com.br www.seudominio.com.br
```

Sem domínio:

```powershell
python tools/sobe_vps.py IP-DO-VPS srv123456.hstgr.cloud
```

O que acontece (de 5 a 10 minutos na primeira vez):

1. **Monta o pacote**, de uns 133 MB: o jogo, o site e o servidor. Ficam de
   fora os testes, as ferramentas, a arte fora do git e os embutidos que o
   jogo servido não usa.
2. **Manda por `scp`**, que já vem no Windows. Pede a senha de root.
3. **Roda `servidor/instala.sh` no VPS**, que pede a senha de novo e:
   - instala Python, websockets, sqlite3 e o Caddy (do repositório oficial do Caddy);
   - põe o jogo e o site em `/var/www/soterra`;
   - sobe o Relé e a API como serviços do systemd, que renascem sozinhos e
     voltam quando o VPS reinicia;
   - escreve o Caddyfile com o seu endereço, confere e recarrega;
   - agenda o backup diário do banco;
   - no fim, diz se está tudo de pé e se o DNS já aponta para o VPS.

Quando terminar, o site abre em `https://SEU-ENDERECO` e o jogo em
`https://SEU-ENDERECO/index.html`. O certificado HTTPS sai no primeiro acesso,
em até um minuto.

**Atualizar depois**: commit e o **mesmo comando**. Jogo, site, API e relé
são trocados; o banco (`/var/lib/soterra`) nunca é tocado.

**Sem digitar senha** (opcional). No PowerShell, uma vez só:

```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP-DO-VPS "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

---

## Se algo der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `ssh: connect ... timed out` | IP errado, ou o firewall do hPanel sem a porta 22 | conferir o IP na Visão geral; regra 22 e Sincronizar |
| o passo 1/6 fica parado ("o apt está ocupado" ou "Waiting for cache lock") | VPS recém-criado: o Ubuntu está se atualizando sozinho | esperar; o instalador tenta de novo sozinho por uns 15 minutos |
| o instalador termina com "Algo não subiu" | um serviço caiu; o log aparece logo acima | rodar de novo; se repetir, guardar o log |
| "AVISO: … ainda não existe no DNS" ou "aponta para outro IP" | o registro A não propagou, ou está errado | `nslookup ENDERECO 8.8.8.8`; o HTTPS sai sozinho depois |
| o site não abre em https | DNS, ou o firewall sem 80 e 443 | no VPS: `journalctl -u caddy -n 50 --no-pager` |
| o jogo abre, mas ninguém se vê no Acampamento | o Relé | no VPS: `systemctl status soterra-rele` |

Para ver tudo de uma vez, no VPS (`ssh root@IP-DO-VPS`):

```bash
systemctl status soterra-api soterra-rele caddy --no-pager
journalctl -u soterra-api -f        # cadastros, trocas, saves recusados
curl -s https://SEU-ENDERECO/api/saude
```

---

## Administrar (no VPS limpo; no Coolify, use o comando `admin` no Terminal)

- **Backup**: todo dia, sozinho, em `/var/backups/soterra/`, com os últimos 14
  guardados. Para fazer um na hora: `/etc/cron.daily/soterra-backup`. Para
  trazer um para o seu PC, no PowerShell:
  `scp root@IP-DO-VPS:/var/backups/soterra/soterra-AAAA-MM-DD.db .`
  O hPanel também guarda cópias do VPS inteiro, no menu de backups do VPS.
- **O banco** é um arquivo SQLite só: `/var/lib/soterra/soterra.db` (mais os
  companheiros `-wal` e `-shm`). Senhas nunca ficam em claro (pbkdf2-sha256,
  200 mil voltas, sal por conta). Mexa nele sempre como o usuário `soterra`,
  como nos comandos abaixo: o root criaria arquivos que a API não consegue gravar.
- **O modo Mestre no ar**. A chave de `js/core/gm.js` fica legível para
  qualquer um (o arquivo é servido a todo mundo), então no ar ela sozinha não
  vale: com sessão do site, o modo Mestre só liga na conta que o servidor
  marcou, e o servidor recusa peça da Caixa de qualquer outra conta. Para ser
  o Mestre:
  1. crie a sua conta pelo site;
  2. no VPS, marque-a:
     `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db "update contas set gm=1 where nome='SEU-NOME'"`
  3. no site, **saia e entre de novo** (a sessão pega a marca no login);
  4. abra uma vez `https://SEU-ENDERECO/index.html?gm=SUA-CHAVE` (`?gm=off` desliga).
  Para tirar a marca, o mesmo comando com `gm=0`.
- **Banir** uma conta: de preferência pelo painel do Mestre (F9 no jogo), que
  guarda o motivo e o prazo. Pelo banco, para sempre (a sessão dela passa a
  levar 403). NÃO basta o `update contas set banido=1`: se a conta tiver uma
  linha de banimento com prazo ainda aberta (um banimento do Mestre desfeito
  só pelo 0/1), a API mostra o motivo e o fim DELA e, quando o prazo vence,
  zera o banimento sozinha. O comando abaixo fecha a linha velha e grava a
  permanente, como o `admin banir` do Coolify (a tabela existe depois que a
  API nova subiu uma vez):
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db "begin; update moderacao_banimentos set encerrado_em = cast(strftime('%s','now') as integer), encerrado_como = 'trocado' where encerrado_em is null and conta_id = (select id from contas where nome='NOME'); insert into moderacao_banimentos(conta_id, motivo, inicio) select id, 'banida pelo banco', cast(strftime('%s','now') as integer) from contas where nome='NOME'; update contas set banido=1 where nome='NOME'; commit;"`
  Para **desbanir** pelo banco, feche as linhas abertas junto (senão elas
  aparecem como "em vigor" na lista do Mestre e voltam no próximo `banido=1`):
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db "begin; update moderacao_banimentos set encerrado_em = cast(strftime('%s','now') as integer), encerrado_como = 'desfeito', encerrado_motivo = 'pelo banco' where encerrado_em is null and conta_id = (select id from contas where nome='NOME'); update contas set banido=0 where nome='NOME'; commit;"`
- **Olhar a trilha de auditoria** (cadastros, logins, peças nascidas, saves recusados):
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db 'select tipo, dados from eventos order by id desc limit 20'`

---

## O jogo e a Nuvem (o lado do cliente)

- **Uma sessão só**: o site grava `localStorage['soterra-sessao']` ao entrar
  ou criar conta; o jogo (`js/core/sessao.js`) lê a mesma chave. Como site e
  jogo vivem no mesmo endereço (o Caddy serve os dois), logar em
  `/site/conta.html` já deixa `/index.html` logado.
- **O que a Nuvem faz** (`js/core/nuvem.js`): ao abrir, GET `/api/save`. Se o
  servidor tem versão mais nova (ou a conta é outra), o save de lá entra e a
  página recarrega uma vez; senão o local sobe. Depois, toda gravação local
  sobe 3 s depois num PUT com `versao` e `nascimentos`. Nada sobe antes de o
  servidor responder o primeiro GET: com a API fora do ar no boot, o jogo
  continua local e sobe quando ela voltar. Um 409 de versão (outra máquina
  gravou antes) faz o servidor mandar. Um 409 de instância (linha duplicada,
  peça consumida que voltou) para a subida, e a Ficha de Contas mostra a
  mensagem com o botão "Tentar de novo". O 502 do Caddy (API reiniciando) é
  tratado como "fora": tenta de novo sozinho.
- **O número de série**: toda cópia de item tem `iid`. O progress.js cunha em
  saque, roleta, forja, Caixa do Mestre, balcão do mercador e cofre da guilda;
  equipar, devolver, cofre pessoal, balcão do jogador e troca carregam a
  mesma série. Save antigo ganha carimbo `legado` uma vez; série repetida
  colada à mão no save some no saneamento, em vez de ganhar número novo.
- **Conta trocada na mesma máquina**: se o registro local é de outra conta e o
  servidor não tem nada da nova, o disco é limpo e a nova começa do zero. O
  save da conta anterior continua no servidor, na conta dela.
- **Só a conta Principal sobe**: as outras contas locais do jogo ("Criar conta
  nova", `?conta=2`, a conta local do Mestre) ficam só na máquina. A sessão do
  site vale para o navegador inteiro, e subir duas contas locais na mesma conta
  do servidor faria uma apagar o jogo da outra.
- **Na Ficha de Contas** (menu → Contas) fica a caixa "Nuvem": logado como
  quem, versão do save, "em dia" / "subindo…" / erro, "Sincronizar agora",
  "Sair da nuvem", ou o botão "Entrar ou criar conta", que abre o site.

---

## Testar em casa, sem VPS

```bash
python servidor/rele.py              # ws://127.0.0.1:8791
python servidor/api.py               # http://127.0.0.1:8300, banco em servidor/dados/
python tests/servidor_api.py         # a API por dentro
python tests/conta_api.py            # a conta no site: senha, e-mail com código, esqueci, sessões
python tests/loja_api.py             # a loja: catálogo, reserva, retirada, confirmação no save
python servidor/api.py --emails-prova emails.jsonl   # o correio de prova: os e-mails vão para o arquivo
python tests/nuvem_viva.py           # o jogo contra a API de verdade (conta descartável)
python tests/rele_prova.py           # o relé, nos dois caminhos do websockets
python tests/pacote_servido.py       # o pacote do VPS, servido sozinho, abre o jogo e o site
python tools/sobe_vps.py --so-pacote # só monta e mede o pacote
```

Abra `site/conta.html` do disco: o site descobre que está em `file://` e fala
com `http://127.0.0.1:8300` sozinho (ou force com `?api=http://host:porta`).
O jogo em `http://127.0.0.1:8200/index.html?api=http://127.0.0.1:8300` fala
com a API de casa (a base fica lembrada em `localStorage['soterra-api-base']`).
Em duas janelas com `?rede=ws://127.0.0.1:8791` (contas diferentes), prova o relé.

---

## Notas

- O relé é um carteiro **burro de propósito** (não valida nada), certo para
  jogar entre amigos. A API é a autoridade das contas e das instâncias de
  item. O que ainda **não** é validado no servidor é o sorteio do saque: o
  cliente diz o que nasceu, e o servidor só garante que nasceu uma vez.
- Freios por endereço (10/09, noite): o cadastro aceita 10 por hora por IP; o login
  conta só as senhas ERRADAS por IP (quem acerta nunca é trancado) e tem teto por
  conta (60 logins certos e 10 trocas de senha por hora); o "esqueci" tem o seu; o
  relé aceita 10 conexões novas de uma vez por IP e depois 1 a cada 2 s. O IPv6
  conta pela faixa /64. IP privado (em casa) não tem freio. Tudo depende do
  trusted_proxies do Caddy de dentro, que lê o IP real pelo X-Forwarded-For.
- Ainda de fora: o log de acesso do Caddy vem desligado (não fica o IP de quem
  entrou) e o relé roda sem a jaula do systemd que a API tem.
- No Coolify, a subida É o push: cada push no `main` do GitHub monta e troca
  o contêiner sozinho (e fecha o Terminal que estiver aberto no painel).
- A landing do site tem 16 molduras esperando fotos em `site/img/` (a lista de
  nomes está no começo de `site/index.html`). Enquanto não existirem, aparece
  a inicial num fundo dourado.
- O peso: a primeira visita de cada jogador baixa os modelos do bundle
  (`assets/models/bundle/`). A migração para um service worker que guarde
  isso é o próximo passo natural depois desta subida.
