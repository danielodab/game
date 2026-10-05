# Revisão jurídica antes do lançamento

Os **Termos de Uso** (`site/termos.html`) e a **Política de Privacidade**
(`site/privacidade.html`) foram escritos em 02/10/2026 lendo o código do servidor:
o que eles dizem que se guarda, por quanto tempo e o que sai na exclusão da conta
é o que `servidor/` faz (e `tests/privacidade_api.py` confere os números marcados
com `data-regua` e a exclusão tabela por tabela).

**Eles não foram revisados por um advogado.** Antes de pôr o jogo no ar para o
público, um advogado (de preferência com experiência em LGPD e em consumidor) tem
de ler os dois, preencher o que falta e decidir as questões abaixo.

## O que falta preencher (`[PREENCHER: …]` nas páginas)

- razão social, CNPJ, e-mail de contato e cidade do foro;
- nome e e-mail do encarregado (DPO) — ou a decisão de não nomear um, se a empresa
  couber na dispensa da Resolução CD/ANPD nº 2/2022 (o canal de contato continua
  obrigatório);
- empresa de hospedagem e país do servidor; provedor de envio de e-mail;
- idade mínima para criar conta;
- prazo de guarda dos registros de pagamento depois da exclusão da conta (hoje o
  servidor não apaga esses registros sozinho).

## Questões para o advogado decidir

1. **Marco Civil da Internet, art. 15** (guarda de registros de acesso a aplicações
   por 6 meses). Hoje o servidor guarda o IP só junto da sessão (até 30 dias sem uso)
   e nas contagens dos freios (1 dia); não há um registro de "IP + data e hora de
   cada acesso" guardado por 6 meses. Se for exigido, é código novo, e a Política
   muda junto.
2. **Transferência internacional** (LGPD, art. 33), se a hospedagem ou o provedor
   de e-mail ficarem fora do Brasil.
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

Quando qualquer um dos dois documentos mudar de um jeito que mude direito ou
dever de alguém: suba a data em `servidor/privacidade.py` (`VERSAO_TERMOS`),
`site/site.js` (`SITE.VERSAO_TERMOS`) e no `data-versao` e no "Versão de" das
duas páginas. Quem tem conta passa a ver o pedido de novo aceite na página da conta.

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
