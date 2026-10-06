# Revisão jurídica antes do lançamento

Os **Termos de Uso** (`site/termos.html`) e a **Política de Privacidade**
(`site/privacidade.html`) foram escritos em 02/10/2026 lendo o código do servidor:
o que eles dizem que se guarda, por quanto tempo e o que sai na exclusão da conta
é o que `servidor/` faz (e `tests/privacidade_api.py` confere os números marcados
com `data-regua` e a exclusão tabela por tabela).

**Eles não foram revisados por um advogado.** Antes de pôr o jogo no ar para o
público, um advogado (de preferência com experiência em LGPD e em consumidor) tem
de ler os dois, preencher o que falta e decidir as questões abaixo.

## O que faltava preencher (`[PREENCHER: …]` nas páginas)

**Nada mais está em branco.** Em 06/10 o dono decidiu os dados e as lacunas saíram
das duas páginas e das traduções — a lista, com o valor posto e o porquê, está na
seção **"Preenchido em 06/10 por prática de mercado — conferir"**, mais abaixo. O
que foi posto é prática comum de jogos online no Brasil, **não parecer jurídico**:
o advogado confere cada linha.

## Questões para o advogado decidir

1. **Marco Civil da Internet, art. 15** (guarda de registros de acesso a aplicações
   por 6 meses). Hoje o servidor guarda o IP só junto da sessão (até 30 dias sem uso)
   e nas contagens dos freios (1 dia); não há um registro de "IP + data e hora de
   cada acesso" guardado por 6 meses. Se for exigido, é código novo, e a Política
   muda junto. **06/10:** o dono decidiu guardar por 6 meses, mas a Política **não**
   diz isso — o código apaga antes (ver "O que o código ainda não cumpre", abaixo).
2. **Transferência internacional** (LGPD, art. 33): a hospedagem e a Google ficam
   fora do Brasil. A cláusula entrou na seção 6 da Política em 06/10 — conferir.
3. **Direito de arrependimento** (CDC, art. 49) para moeda virtual: os Termos
   oferecem 7 dias para o pacote cujas barras não foram usadas. Confirmar o texto.
4. **ECA Digital (Lei 15.211/2025)**: a roleta só aceita selos de chefe e não é
   vendida; nenhum produto da loja tem conteúdo sorteado. Mas a **forja** usa pedras
   (que também se vendem na loja, em quantidade certa) e pode falhar — avaliar se
   isso conta como mecanismo de sorte pago para o público menor de idade, e se a
   classificação indicativa e a verificação de idade pedem mais do que a caixa de
   aceite.
5. **Bases legais** escolhidas na tabela da Política (execução de contrato, legítimo
   interesse, obrigação legal): confirmar, e decidir se o legítimo interesse precisa
   de um teste de balanceamento documentado.
6. **Suspensão e banimento**: os Termos descrevem medidas graduais e o direito de
   contestar pelo e-mail; alinhar com o que o painel do Mestre de fato faz.
7. **Publicidade e menores de idade (06/10).** O aplicativo de Android ganhou a área
   opcional "Ganhar prêmios": o jogador escolhe assistir a um anúncio (Google AdMob) e
   recebe 50 vinténs ou 1 barra de ouro, até 5 de cada por dia. Não há anúncio em nenhum
   outro lugar, e o serviço de anúncios só é ligado quando o jogador entra na área. Mesmo
   assim, a partir daí a Google coleta o **identificador de publicidade**, o IP (local
   aproximado) e a interação com o anúncio. Pontos para decidir:
   - a Política ganhou três trechos (seção 4, a exceção; seção 6, "Google (AdMob)"; seção
     10, o item da propaganda e um parágrafo) **sem subir a `VERSAO_TERMOS`** nem pedir novo
     aceite. A seção 10 PROMETIA "não mostra propaganda de terceiros": o texto mudou para
     abrir a exceção. **Isso muda um compromisso** — avaliar se a versão tem de subir e o
     aceite ser pedido de novo ANTES de o aplicativo com anúncios ser publicado (se sim, é o
     passo descrito logo abaixo). **Feito em 06/10:** a versão subiu para `2026-10-06` junto
     com o preenchimento das lacunas, e a mesma exceção entrou na seção 3 dos Termos, que
     ainda dizia "não há propaganda de terceiros no jogo nem no site" sem ressalva;
   - **base legal** para o dado de publicidade (consentimento? a tela de consentimento da
     Google só aparece onde a Google a exige — Europa e Reino Unido —, não no Brasil);
   - **menores**: LGPD art. 14, ECA e a Lei 15.211/2025 (ECA Digital) quanto a publicidade
     dirigida a crianças e adolescentes e ao uso de dados deles para perfil. Hoje o anúncio
     é pedido com limite de conteúdo "adolescente" e a Play declara público de 13+, mas o
     jogo **não sabe a idade** de quem assiste: decidir se o anúncio deve ser só **não
     personalizado**, se a área deve ficar fechada a quem declarou menos de 18, ou se basta
     o que está;
   - recompensa por assistir a anúncio: confirmar que não esbarra em regra de publicidade
     infantil (incentivo a consumir publicidade);
   - **transferência internacional** (a Google) e a lista de "com quem dividimos";
   - os Termos (seção 5, barras e vinténs) não falam do prêmio por anúncio: avaliar uma
     linha dizendo que ele é um bônus, sem valor em dinheiro, que pode acabar ou mudar.

Quando qualquer um dos dois documentos mudar de um jeito que mude direito ou
dever de alguém: suba a data em `servidor/privacidade.py` (`VERSAO_TERMOS`),
`site/site.js` (`SITE.VERSAO_TERMOS`) e no `data-versao` e no "Versão de" das
duas páginas. Quem tem conta passa a ver o pedido de novo aceite na página da conta.

## Preenchido em 06/10 por prática de mercado — conferir

O dono decidiu os dados em 06/10/2026 e as lacunas `[PREENCHER: …]` saíram das duas
páginas e das traduções (inglês e espanhol). **Nada disto passou por advogado.** Cada
linha diz o que estava em branco, o que foi posto e por quê.

| Lacuna | O que foi posto | Por quê / o que conferir |
|---|---|---|
| Razão social (Termos 1 e 13; Política 1) | **Oda Studio - DOB**, "pessoa física" | É o nome que o dono usa para o estúdio. **Não é empresa registrada**: não há razão social de verdade. Conferir se o nome basta para identificar o fornecedor (CDC, art. 6º, III; Decreto 7.962/2013, art. 2º, pede nome e **CPF ou CNPJ** em lugar de destaque no site que vende) |
| CNPJ (Termos 1; Política 1) | **nada** — a frase foi reescrita sem o campo | Não há CNPJ, e CPF não se publica por decisão do dono. Conferir o Decreto 7.962/2013 (acima) e se vale abrir MEI/empresa antes de vender barras |
| E-mail de contato (Termos 1 e 16; Política 1 e 12) | **system@viidoo.io** | Um endereço só para suporte, privacidade e pedidos do titular. Conferir que a caixa existe e é lida: a Política promete resposta em 15 dias |
| Encarregado — nome e e-mail (Política 12) | "o próprio controlador, **Oda Studio - DOB**", **system@viidoo.io** | **Ponto de atenção:** a LGPD (art. 41, § 1º) e a ANPD (Resolução CD/ANPD nº 18/2024) esperam a **identidade** do encarregado divulgada — o nome de uma pessoa (ou de uma pessoa jurídica) — e aqui está o nome do estúdio, a pedido do dono, que não quer o nome completo publicado. Saídas a decidir: publicar o nome da pessoa; ou usar a dispensa de agente de pequeno porte (Resolução CD/ANPD nº 2/2022), em que não se nomeia encarregado e fica só o canal de contato — nesse caso a frase da seção 12 muda |
| Hospedagem e país (Política 6) | **Hostinger (servidores nos Estados Unidos)** | **PENDÊNCIA DO DONO:** o país saiu do registro público do endereço IP, não do contrato. Conferir no painel da Hostinger onde fica o servidor; se não for nos Estados Unidos, corrigir a seção 6 (duas frases) e as traduções |
| Provedor de e-mail (Política 6) | **Google (Google Workspace)** | Informado pelo dono; a configuração do envio (SMTP) fica fora do repositório e não foi conferida aqui |
| Transferência internacional (Política 6) | Parágrafo novo: a hospedagem nos EUA; a Google LLC (e-mail, AdMob e, quando ativada, a compra pela Google Play) nos EUA e em outros países; o Mercado Pago opera no Brasil; art. 33 da LGPD — países ou organismos com grau adequado de proteção ou cláusulas contratuais com cada prestador | Cláusula padrão. Conferir: (a) o inciso do art. 33 que de fato vale — a ANPD ainda não reconheceu os EUA como país adequado, então o que sustenta é a cláusula contratual (Resolução CD/ANPD nº 19/2024, cláusulas-padrão); (b) se os contratos da Hostinger e da Google trazem essas cláusulas; (c) a compra pela Google Play aparece aqui mas **não** está na tabela da seção 2 nem na lista da seção 6 — quando for ligada, a Política ganha a linha |
| Prazo dos registros de pagamento depois da exclusão (Política 2) | **5 anos a contar da compra**, "e depois é apagado" | Prescrição do CDC (art. 27) e guarda fiscal (CTN, arts. 173 e 174). Conferir o prazo e o marco (da compra ou da exclusão). **O código não apaga** — ver abaixo |
| Prazo do histórico da moderação (Política 2) | Denúncias e registro da Equipe: **2 anos depois de encerrado o caso**, "e então são apagados" | Prática comum; não há prazo legal específico. Punições e cartas seguem "enquanto a conta existir" (é o que o código faz). **O código não apaga** — ver abaixo |
| Idade mínima (Termos 3) | **13 anos**; menor de 18 só com autorização e acompanhamento dos pais ou responsáveis, que respondem pelas compras | Igual ao público-alvo declarado na Play (13+). Conferir com a classificação indicativa, com o ECA Digital (Lei 15.211/2025) e com a questão 7 acima: o jogo **não confere a idade** — é a palavra de quem marca a caixa |
| Cidade do foro (Termos 15) | **foro do domicílio do consumidor**, sem cidade; lei brasileira | CDC, art. 101, I. A eleição de outro foro sairia de qualquer jeito diante do consumidor |
| Os dois avisos `[PREENCHER: …]` no cabeçalho das páginas (comentário, ninguém vê) | Reescritos: dizem que os dados foram preenchidos em 06/10 e apontam para esta seção | Só para a página não carregar a marca de lacuna |

**Também mudou, sem ser lacuna:** a seção 3 dos Termos dizia "não há propaganda de
terceiros no jogo nem no site" sem ressalva, e a Política já tinha a exceção da área
"Ganhar prêmios" do aplicativo. A mesma exceção entrou nos Termos, para os dois
documentos não se contradizerem. Conferir a redação.

### O que o dono decidiu e NÃO entrou no texto, porque o código faz diferente

A regra dos dois documentos é dizer o que o servidor faz. Onde o código já tem prazo
próprio, o texto ficou com o do código:

- **Registros de acesso (IP, data e hora): decidido 6 meses** (Marco Civil, art. 15).
  O servidor guarda o IP só junto da sessão e o apaga com ela, no máximo em **30 dias**
  sem uso (`SESSAO_DIAS`, `servidor/privacidade.py`, `_faxina_privacidade`), e por 1 dia
  nos freios; o registro de entradas da conta é **sem IP**. A Política continua dizendo
  30 dias. Guardar 6 meses é código novo (abaixo). Observação para o advogado: o art. 15
  fala em provedor "constituído na forma de pessoa jurídica"; o responsável é pessoa
  física — decidir se a obrigação existe.
- **Registro de erros do jogo: decidido 90 dias.** O código apaga em **30 dias** depois
  da última vez que o erro apareceu (`RETENCAO_DIAS`, `servidor/registros.py`; a prova
  confere o número). A Política continua dizendo 30. Para ir a 90 basta mudar a
  constante — a página acompanha pelo `data-regua="ERROS_DIAS"`.
- **Conta e save: decidido "apagados em até 30 dias depois do pedido".** O código apaga
  **na hora** (seção 9 da Política) e as cópias de segurança vencem em 14 dias — é mais
  do que o prometido, e o texto ficou como estava.

### O que o código ainda não cumpre (prazo escrito como compromisso)

Dois prazos novos estão na Política e **nenhuma rotina os cumpre**: o servidor guarda
esses registros para sempre. Como o jogo ainda não foi lançado, nenhum registro chega
ao prazo antes de 2028, mas a faxina tem de existir antes disso.

1. **Pagamentos, 5 anos.** Falta uma faxina que apague, passados 5 anos da compra, o
   que ficou **sem conta** (a exclusão desliga com `ON DELETE SET NULL`): `pagamentos`
   (e o `pagamentos_mp` ligado a ele), `barras_movimentos`, `contas_alertas` e os
   eventos `pagamento-%` (`servidor/pagamento.py`, `servidor/loja.py`). Enquanto a conta existe, o registro
   fica — é o que o texto diz.
2. **Moderação, 2 anos.** Falta uma faxina que apague `moderacao_denuncias` 2 anos
   depois do `fechado_em` e as linhas de `moderacao_auditoria` 2 anos depois da ação (ou
   do fechamento da denúncia a que se ligam) — `servidor/moderacao.py`. Denúncia que
   nunca é fechada não começa a contar: decidir se ela vence sozinha.
3. **Registros de acesso, 6 meses** (se o advogado disser que é devido): tabela nova com
   IP, data e hora de cada entrada, guardada por 6 meses e apagada depois; a linha
   "Sessões" da Política muda junto, e a exclusão da conta tem de dizer o que acontece
   com ela.

Quando uma dessas faxinas entrar, o número ganha `data-regua` na página e a constante
entra em `tests/privacidade_api.py`, como os outros prazos.

### A versão e o aceite

A `VERSAO_TERMOS` subiu de `2026-10-02` para **`2026-10-06`** nos quatro lugares
(`servidor/privacidade.py`, `site/site.js`, o `data-versao` e o "Versão de" das duas
páginas). O que acontece:

- **cadastro novo:** aceita a versão de 06/10 (o servidor recusa outra);
- **quem já tem conta:** nada é trancado. `GET /api/conta/aceite` passa a responder
  `pendente: true` e a **página da conta** mostra o pedido de novo aceite, com a caixa e
  o botão Aceitar (`site/conta_privacidade.js`). Nenhuma rota do servidor recusa quem
  não aceitou: a pessoa continua entrando e jogando. O pedido **só aparece no site** —
  o jogo e o aplicativo não mostram nada. Decidir se isso basta como aviso de mudança
  (LGPD, art. 8º, § 6º, e art. 9º, § 2º) ou se o jogo tem de avisar também.

## Traduções dos Termos e da Política (05/10) — revisar

Os dois documentos ganharam versão em **inglês** e **espanhol** (`site/i18n_juridico_en.js`,
`site/i18n_juridico_es.js`), mostradas quando o visitante escolhe o idioma no topo do site.
O que foi combinado com o dono e está no ar:

- é **tradução de cortesia**: a página traduzida abre com o aviso "a versão em português é a
  única que vale: se houver diferença entre as duas, vale o que está escrito em português", com
  o link para o original (`?lang=pt`);
- o texto em português, a `VERSAO_TERMOS` e o aceite **não mudaram**; o aceite continua sendo da
  versão em português (a caixa de aceite aparece traduzida, com os links para as páginas);
- a tradução foi feita por máquina e conferida por máquina (mesmas tags, mesmos números e
  datas, lacunas `[PREENCHER: …]` intactas). **Ninguém com formação jurídica a leu.**

Pontos que a própria tradução marcou como duvidosos, para o advogado (ou um tradutor
jurídico) decidir:

1. **"encarregado"** (LGPD, art. 41): en "data protection officer"; es "encargado" — em
   espanhol pode ser confundido com o "encargado del tratamiento" (o operador) do RGPD;
   talvez "delegado de protección de datos".
2. **"arrependimento"** (CDC, art. 49): en "withdrawal" / "withdraw from a purchase"; es
   "arrepentimiento" / "desistimiento" (os dois aparecem). Uniformizar.
3. **"estorno"**: saiu como "refund", "chargeback" e "reversed" conforme o trecho (es
   "reembolso", "contracargo", "revertido"). São coisas diferentes em inglês; escolher uma por
   sentido (devolução pedida a nós × contestação no cartão).
4. **"foro da comarca" / "fica eleito o foro"**: tradução literal; não há equivalente exato.
5. **"embaralhada"** (a senha e os códigos guardados): en "hashed" num trecho e "scrambled"
   em outro; es "mezclada" e "codificada". O original não diz "hash" nem "cifrada".
6. **Nomes de lei**: "Código de Defesa do Consumidor", "LGPD", "ANPD", "Estatuto Digital da
   Criança e do Adolescente (Lei 15.211/2025)" ficaram em português, alguns com glosa entre
   parênteses na primeira menção. "art. 7º, V" ficou como está.
7. **"interesse legítimo"** e **"portabilidade"**: literais (legitimate interest / interés
   legítimo; portability / portabilidad).
8. **"roleta" e "sortear"** (seção dos sorteios): en "wheel" e "draw"; es "ruleta" e
   "sortear". A distinção entre sorteio e saque aleatório tem peso (ECA Digital).
9. **"barras trocadas por vinténs (80 vinténs por barra)"**: o original é ambíguo quanto ao
   sentido da troca, e a tradução ficou literal.
10. **"Freios contra abuso"**: literal ("Brakes against abuse" / "Frenos contra el abuso").
11. A marca **"excluída#número"** da conta excluída foi traduzida no texto ("deleted#number");
    o servidor grava a marca em português.

Quando o texto em português mudar: a frase mudada **volta a aparecer em português** nas
páginas traduzidas até a tradução ser refeita (`node tools/i18n_falta.js --lista` mostra quais).
Os e-mails automáticos (código de senha, avisos, conta excluída) também existem nos três
idiomas (`servidor/conta.py`, `EMAILS`; `servidor/privacidade.py`, `EXCLUIDA`).

As três frases novas da Política sobre publicidade (06/10) também foram traduzidas por máquina
para o inglês e o espanhol, no fim de `site/i18n_juridico_en.js` e `_es.js`: revisar junto.

As **13 frases mexidas no preenchimento de 06/10** (as das lacunas e a da propaganda, na seção 3
dos Termos) foram retraduzidas por máquina nos dois idiomas, no lugar das antigas; a `VERSAO_TERMOS`
subiu, e as páginas traduzidas mostram a data nova. "Pessoa física" ficou "an individual (natural
person)" em inglês e "persona física" em espanhol: revisar junto.
