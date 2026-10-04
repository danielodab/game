# Loja — o que acrescentar para chamar atenção

> Pedido do dono (02/10/2026): "a compra será somente da maneira que já está, em barra de ouro.
> Para a loja quero sugestões de mais coisas que chamem atenção." A roleta continua só com selos de
> chefe — nada aqui vende giro, sorteio ou caixa de recompensa.

## O que a loja vende hoje

Classes (personagens), bônus de XP por dias, pedras de forja em lote, vinténs, barras por vinténs
(o caminho de volta, 4× mais caro), insígnias de guilda e o pergaminho de elemento.

## A regra que protege o jogo

**Vender aparência, conveniência e tempo — nunca vitória no ranqueado.** A coroa da Brasa e o placar
do Eco Primordial só valem enquanto não se compram. As pedras de forja já vendidas dão poder; vale
ficar de olho para que quem compra não atropele a paridade do PvP.

## As sugestões, em ordem de retorno por esforço

| # | o quê | por que chama atenção | esforço |
|---|---|---|---|
| 1 | **Vitrine com prova no herói** — o item gira em 3D vestido no SEU herói antes de comprar | é o que mais converte em loja de jogo: a pessoa se vê bonita e compra | médio (o retrato 3D já existe) |
| 2 | **Auras e rastros na praça** (brasa, gota, folha, vento), um por elemento | todo mundo na praça vê; propaganda viva de quem comprou | baixo (a aura do Colecionador já é esse caminho) |
| 3 | **Passe da Temporada** atrelado às temporadas de 42 dias da Brasa: trilha grátis + trilha paga (barras), com trajes, auras, títulos e vinténs | dá motivo para jogar todo dia e não é sorteio | médio |
| 4 | **Trajes cosméticos por classe** (variações de cor e acabamento por elemento, e um traje por temporada) | é o item mais desejado nesse gênero; entra pelo mesmo caminho de trajes que já existe | alto (arte no Meshy) |
| 5 | **Decoração da Sede** (estandartes, troféus, tapetes que aparecem na sala de guerra) comprada por membros para a guilda | orgulho de grupo; aparece para o adversário na guerra | médio (aproveita as peças sd_ que estão saindo) |
| 6 | **Plaquinha e balão de fala** (moldura do nome, cor do título, estilo do balão do chat) | barato de fazer, visível o tempo todo | baixo |
| 7 | **Pacote de boas-vindas** (uma vez por conta, com desconto: uma classe + pedras + uma aura) | primeira compra é a mais difícil; depois dela as outras vêm | baixo |
| 8 | **Ofertas da semana** que giram, com contagem regressiva | cria o hábito de abrir a loja | baixo |
| 9 | **Gestos na praça** (acenar, comemorar, sentar, provocar) | social, aparece em vídeo e captura de tela | médio (animações) |
| 10 | **Presentear um amigo** (comprar qualquer item da loja para outra conta) | traz gente nova e movimenta a economia social | baixo (o correio já entrega) |
| 11 | **Conveniência**: mais espaço no banco e no inventário, mais trajes salvos, trocar nome | sem poder, mas muito pedido | baixo |
| 12 | **Pose e efeito de vitória** no fim da batalha | momento de exibição; cuidado para não atrapalhar a leitura do PvP | médio |

## O que deixar de fora de propósito

- **Títulos do Eco Primordial, do Poço e da Brasa:** só se ganham, nunca se compram — é o que dá valor a eles.
- **Qualquer sorteio pago** (caixa, roleta, pacote surpresa): além de proibido para menores pela Lei 15.211/2025
  (ECA Digital), quebra a confiança que a roleta só de selos construiu.

## O que já entrou (04/10/2026)

Os itens 2, 7, 8 e 10 da tabela, todos em barras de ouro e com o servidor mandando em preço, posse,
limite e entrega (`servidor/loja.py`; o porquê de cada trava em `docs/SEGURANCA.md` §4.5):

| o quê | preço | limite |
|---|---|---|
| **Auras na praça** (Brasa, Maré, Raiz, Vento e a neutra, da Lousa) | 150 barras cada | uma de cada por conta |
| **Pacote de Boas-Vindas** (Xamã ou Bruxo + 10 pedras de cada tipo + uma aura) | 250 barras (o conteúdo avulso soma 820: −70%) | 1 por conta, para sempre |
| **Ofertas da semana** (3 itens de 3 seções diferentes) | −25%, arredondado para cima | giram toda segunda, 00:00 de Brasília |
| **Presentear um amigo** | o preço do produto no dia | 3 presentes por dia; moeda e o Pacote não se presenteiam |

O Pacote cabe no Saco de 280 barras (R$ 19,90), com 30 de troco: a primeira compra é uma só.
