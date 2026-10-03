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
