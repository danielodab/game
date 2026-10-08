#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A loja de vinténs: o site vende, o jogo entrega, o save confirma.

Entra no cartório como mixin (`class Api(ContaMixin, LojaMixin, MestreMixin,
PagamentoMixin)` no api.py).

O CAMINHO DE UM PEDIDO:
  1. o site compra (POST /api/loja/comprar): o servidor confere o saldo que o
     ÚLTIMO SAVE mostrou (só o bolso, `db.carteira.moedas`; o cofre não conta)
     mais o que está A CAMINHO (créditos ainda não entregues) menos a RESERVA
     (os pedidos pendentes e retirados), e o pedido nasce 'pendente' com a
     entrega congelada;
  2. o jogo busca (POST /api/loja/retirar): 'pendente' vira 'retirado';
  3. o jogo desconta os vinténs, entrega e anota o id em `db.loja.aplicadas`
     (ou em `db.loja.recusadas`, com o motivo);
  4. o PUT /api/save que traz a anotação confirma, NA MESMA TRANSAÇÃO do save
     (`_loja_confirma`): 'entregue' ou 'estornado'. Uma confirmação separada
     podia marcar 'entregue' e o save seguinte levar 409 de outra máquina — o
     save vencedor não teria o item, e ele se perderia.

OS CRÉDITOS DE VINTÉNS (Loja 2, 10/09): um pacote pago no Mercado Pago
(pagamento.py) ou um presente de vinténs do Mestre (mestre.py) é um pedido de
preço 0 cuja entrega é {tipo:'vintens', alvo:'carteira', qtd:N}, com uma linha
em `loja_creditos` que diz quanto vale e de onde veio. Anda pelo MESMO caminho:
o jogo soma na carteira dentro do save e o PUT fecha. Enquanto não chega, conta
no saldo do site (`aCaminho`): o jogador já pode gastar. O retirar sai em ordem
de id, então o crédito chega ao jogo antes de qualquer compra feita com ele.
Crédito de pacote não se cancela pelo site; recusado pelo jogo, é reemitido
(até 3 vezes; ver pagamento.py).

OS PRESENTES DO MESTRE (10/09, mestre.py): o pedido de preço 0 marcado em
`loja_presentes`. Fica fora dos limites do jogador (nem conta, nem gasta), vale
a mesma regra do produto (classe já liberada ou a caminho = recusa) e anda pelo
mesmo caminho de entrega. Só o Mestre cancela.

OS PREÇOS (a régua de 10/09, medida nos dados do jogo): uma descida completa da
Cisterna no normal paga ~31 vinténs, ~89 por hora (21 min por descida); a
semana típica (1 h por dia de Cisterna + as missões diárias) dá ~1.316, a
puxada (2 h por dia no difícil com desafio) ~3.087. Personagem = 1.000 por
carta do desbloqueio (um raro custa ~7,6 semanas típicas); 7 dias de bônus de
XP = 7.900 (~6 semanas típicas); pedras a ~34× o que o drop dá na mesma hora.
O preço é o freio: pedras, bônus e insígnias não têm janela de limite; ficam
os tetos contra abuso (5 abertos, 10 compras por hora, 30 linhas por hora). Ou
o jogador dropa, ou compra um pacote para adiantar. Rever a cada portal
aberto: o Fecho paga ~1,7× a Cisterna por xp, e um portal novo pode quase
dobrar a hora de referência.

Os preços moram SÓ aqui (CATALOGO e PACOTES): o site e o jogo nunca repetem um
número (o jogo espelha só o que precisa para agir: DATA.bonusXp.fator e
DATA.insignias.porGuilda; tests/loja_api.py confere).

AS BARRAS DE OURO (13/09, pedido do dono: "outro tipo de moeda... sendo
possível comprar pela loja do site... pelos vinténs será possível também
comprar barras de ouro, mas será muito mais caro... assim fica possível para
todos sem ser um jogo pay to win"). A loja do site passa a vender em BARRAS:
  - o saldo é POR CONTA e mora só aqui no servidor (`barras_saldo`), fora do
    save do jogo — as barras só se gastam no site. Cada mudança é uma linha do
    extrato (`barras_movimentos`) gravada na MESMA transação que mexe no saldo
    (`barras_move`), com `idem` único por conta quando há (o crédito de um
    pagamento, o estorno de um pedido): nada entra duas vezes, e o CHECK
    (saldo >= 0) segura o que escapar;
  - os pacotes em reais (PACOTES) creditam barras NA HORA, sem esperar o jogo;
  - o catálogo inteiro custa barras, debitadas na mesma transação que cria o
    pedido (`loja_barras.custo`); o pedido anda pelo caminho de sempre com
    preço 0 em vinténs, e cancelar ou a recusa do jogo devolvem as barras;
  - BARRAS → VINTÉNS (seção 'vintens'): a entrega é o crédito de vinténs de
    sempre ({tipo:'vintens'}), pago em barras na compra;
  - VINTÉNS → BARRAS (seção 'barras-por-vintens', o caminho de quem farma): o
    pedido tem PREÇO em vinténs (reservado como qualquer pedido antigo, pago
    pelo juiz na entrega) e a entrega {tipo:'barras'} não mexe em nada no jogo;
    as barras (`loja_barras.ganho`) só entram quando o pedido vira 'entregue',
    na mesma transação que o marca — nunca antes de os vinténs saírem.
  A barra vale VINTENS_POR_BARRA na ida e custa VINTENS_POR_BARRA_FARMADA na
  volta (4× mais): não há como girar vinténs e barras e sair com mais.
  O pacote antigo de vinténs (PACOTES_RETIRADOS) saiu da venda, mas o pagamento
  criado antes do deploy e aprovado depois ainda credita os vinténs que vendeu.

A COMPRA VALE NA HORA (04/10, o dono: "comprei barras de ouro com vinténs e as barras não entraram na minha
conta.. esse lance de compra na loja e já disponibilizar precisa ser na hora; se for item vai para o jogo
(banco)"). O caminho de cima (comprar → o jogo busca → entrega → confirma) deixava a compra parada até o jogo
abrir, com a aba à vista, e vir buscar: quem trocava vinténs por barras no site via o pedido "esperando o jogo
abrir" e nenhuma barra. Com a AUTORIDADE ligada (produção) isso acabou:
  - a própria compra entrega (`_loja_fecha_na_hora` → `_loja_na_hora` → `_loja_retirar_no_servidor`): o juiz
    aplica tudo o que a conta tem aberto no estado que o servidor guarda, e o pedido vira 'entregue' na MESMA
    transação que grava o estado e credita as barras do ganho. A resposta da compra já traz o pedido fechado,
    o saldo e as barras de depois (`naHora`);
  - o presente a um amigo e o presente do Mestre seguem a mesma regra, na conta de quem recebe;
  - a PEÇA de equipamento ({tipo:'peca'}) vai sempre para o BANCO do jogo (o cofre do Acampamento), com série
    registrada (origem 'loja'): o saco cheio nunca recusa nem perde uma compra;
  - a entrega que o juiz recusa é ESTORNADA ali mesmo (as barras de volta, a reserva solta) e a compra
    responde 409 "nada foi cobrado"; o juiz fora do ar deixa o pedido aberto (`espera: 'juiz'`) e ele sai na
    busca seguinte — nunca se cobra sem entregar;
  - LUTA ABERTA: o que mexe no grupo que o juiz refaz no fim dela (TIPOS_DA_LUTA: a classe e o Pacote que a
    traz) espera — `espera: 'luta'`, "chega quando a sala terminar" — e entra no fecho da sala (salas.py,
    `_loja_depois_da_luta`) ou na busca seguinte; o resto entra já;
  - cada entrega deixa um elo em `moderacao_entregas` (tipo 'loja', os hashes de antes e de depois): o jogo
    aberto fica sabendo pelo /api/eu, adota o estado sem recarregar e sem perder a fila dele (o rebase da
    Caixa do Mestre) e avisa "Chegou da loja: …"; o jogo fechado encontra tudo pronto.
Sem a autoridade (em casa) a fila continua, mas o /api/eu conta os pedidos que esperam (`lojaAbertos`) e o
jogo aberto busca em até 30 s.

AS QUATRO NOVIDADES DE 04/10 (docs/LOJA_SUGESTOES.md, itens 2, 7, 8 e 10; o dono: "pode implantar").
Nenhuma vende poder de PvP, sorteio, equipamento, estrela, selo ou bicho, e todas se pagam em barras:
  - AS AURAS (seção 'aparencia', tipo 'aura'): cosmético que a praça inteira vê, uma por elemento e a
    neutra. A POSSE não é tabela: é o pedido vivo da conta (pendente, retirado ou entregue) com
    sku 'aura-<cor>' ou o Pacote de Boas-Vindas que a trouxe — cancelar ou estornar o pedido tira a aura
    sem nada a apagar (`_auras`). A compra nasce 'entregue' (não há nada a pôr no save do jogo). A
    ESCOLHIDA mora em `aura_escolhida` (uma linha por conta), e o Relé a carimba no oi/eco de quem a
    veste (rele_ident.py): o que o cliente disser de si mesmo não vale.
  - O PACOTE DE BOAS-VINDAS (sku 'boas-vindas', tipo 'pacote'): um pedido só, com a entrega congelada
    {itens:[10 pedras de cada, a classe rara escolhida], aura}. Um por conta para sempre (o grupo de
    limite), e o jogo o entrega inteiro ou o recusa inteiro (a classe já liberada devolve as barras).
  - AS OFERTAS DA SEMANA (`ofertas_da_semana`): OFERTAS_POR_SEMANA itens com OFERTA_DESCONTO % a menos,
    escolhidos por uma conta feita com o NÚMERO DA SEMANA (segunda 00:00 de Brasília) — nenhum sorteio
    pago, nenhum estado guardado: dois contêineres dão a mesma resposta, e a semana vira sozinha. O
    desconto vale no preço COBRADO (`preco_de`), e é esse que o pedido guarda em loja_barras.custo.
  - O PRESENTE A UM AMIGO (POST /api/loja/presentear): quem dá paga as barras; o pedido nasce na conta
    de quem recebe, marcado em `loja_amigos` (quem deu e o idem dele), anda pela fila de sempre e leva
    uma carta ao correio. O estorno devolve as barras a QUEM PAGOU. Vinténs, barras e o Pacote de
    Boas-Vindas não se presenteiam (moeda presenteada vira venda de moeda e lavagem de pacote).
"""
import hashlib
import json
import logging
import os
import re
import sqlite3

from comum import (NOME_PUBLICO_SQL, CLASSE_RENOMEADA, XP_MAX, EstadoMudou, Recusa, agora, classe_do_heroi, inteiro,  # noqa: F401
                   liberadas, limita)

log = logging.getLogger('api')

LOJA_VERSAO = 3                  # 13/09: o catálogo em barras de ouro (cada item leva `moeda`)
# espelha JOGO.DATA.pergaminhos.xp (progression.js). O Pergaminho da Sabedoria
# saiu da venda em 10/09 (o bônus por tempo o substitui); o jogo segue lendo o
# que já foi comprado, e pedido antigo ainda aberto é entregue normalmente
PERGAMINHO_XP = {'fator': 1.5, 'salas': 9}
# espelha JOGO.DATA.bonusXp (progression.js); tests/loja_api.py confere
BONUS_XP = {'fator': 1.5}
# espelha JOGO.DATA.insignias.porGuilda (items_selos.js); tests/loja_api.py confere
INSIGNIAS_POR_GUILDA = 10
ABERTOS_MAX = 5                  # pedidos pendentes + retirados por conta (créditos e presentes fora)
COMPRAS_POR_HORA = 10            # pendente, retirado e entregue: cancelar e estornar devolvem a vaga
PEDIDOS_POR_HORA = 30            # LINHAS criadas por hora, em qualquer estado, o Mestre inclusive (segura o disco)
RETIRADO_PRESO = 24 * 3600       # retirado há mais que isso e não entregue: o site deixa cancelar
PEDIDOS_LISTA = 30
ANOTACAO_MAX = 200               # ids em db.loja.aplicadas / recusadas que o save pode trazer
OPS_LOJA = 40                    # pedidos por entrega no servidor (o OPS_MAX do juiz); o resto sai no retirar seguinte
MOTIVOS = ('sem-saldo', 'classe-ja-liberada', 'item-invalido', 'erro-local')
# 04/10, a entrega na hora: o que o site diz quando o juiz recusa a compra (ela é estornada na mesma chamada)
FRASE_DO_MOTIVO = {'sem-saldo': 'faltam vinténs na carteira do jogo', 'classe-ja-liberada': 'essa classe já está liberada',
                   'item-invalido': 'o jogo não reconheceu o item'}
# o que mexe no grupo que o juiz refaz no fim de uma luta (a classe traz cartas; o Pacote traz a classe): com
# luta aberta, isso espera o fecho dela — a mesma cautela das cartas na Caixa do Mestre (moderacao.py)
TIPOS_DA_LUTA = ('classe', 'pacote')
ASSUNTO_PRESENTE = 'Você ganhou um presente'
RE_IDEM = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
CARTEIRA_TETO = 10 ** 12
ELEMENTAIS = ('fogo', 'agua', 'terra', 'ar')
SKU_PRESENTE_VINTENS = 'presente-vintens'    # o presente de vinténs do Mestre (mestre.py)
# 13/09: as barras de ouro. 1 barra vira 20 vinténs (seção 'vintens'); 80 vinténs viram 1 barra (seção
# 'barras-por-vintens'): o caminho de volta custa 4× o de ida, então girar as duas moedas só perde
VINTENS_POR_BARRA = 20
VINTENS_POR_BARRA_FARMADA = 80
BARRAS_TETO = 10 ** 9            # saldo de uma conta (o CHECK do banco só segura o piso)
MOVIMENTOS_LISTA = 20            # o extrato que o site e a ficha do Mestre mostram
MOTIVOS_BARRAS = ('pacote', 'loja', 'estorno-loja', 'troca-vintens', 'presente', 'estorno-pagamento', 'ajuste')
TIPOS_TROCA = ('vintens', 'barras')          # as trocas entre moedas: fora dos presentes do Mestre
# 04/10: o que NÃO se dá de presente — nem o Mestre, nem um amigo. Moeda presenteada é venda de moeda (e
# lavagem de pacote pago com cartão alheio); o Pacote de Boas-Vindas é a primeira compra de cada conta
FORA_DO_PRESENTE = TIPOS_TROCA + ('pacote',)
# 04/10: as auras da praça (uma por elemento e a neutra) e o preço de cada uma, em barras
AURAS = ('fogo', 'agua', 'terra', 'ar', 'neutra',
         'sombra', 'gelo', 'ouro')      # 08/10 (o dono: "crie mais auras"): a Sombra, a Geada e a Dourada
# 04/10, o dono: "quero uma aura preta com vermelho escuro e chamas, especial para o gm". Não se vende nem
# se presenteia: só a conta marcada (contas.gm = 1) a tem, e só ela consegue escolhê-la.
AURAS_MESTRE = ('mestre',)
AURA_MESTRE_NOME = {'mestre': 'Chama do Mestre'}
AURA_PRECO = 150
# 04/10 (o dono: "essa lousa é mais cara por ser mais bonita"): a Lousa custa mais que as quatro dos elementos
# e, por isso, NÃO é uma das escolhas do Pacote de Boas-Vindas — o pacote traz uma aura de elemento
AURA_PRECO_DE = {'neutra': 250, 'sombra': 250, 'gelo': 250, 'ouro': 400}   # 08/10: as três novas, premium
# 08/10: as MOLDURAS premium da plaquinha (o dono: "crie umas molduras premium") — só aparência, como a aura.
# As dos títulos (arena, Eco, chefe, classe) são de graça e automáticas (js/render3d/hub3d.js, MOLDURAS)
MOLDURAS_LOJA = ('ouro', 'rubi', 'esmeralda', 'obsidiana')
# 08/10, o dono: "uma moldura especial para o admin (só ele tem), preto e vermelho escuro". Não se vende nem se
# presenteia: só a conta marcada (contas.gm = 1) a tem — e nela é a automática (hub3d molduraEfetiva)
MOLDURAS_MESTRE = ('mestre',)
MOLDURA_MESTRE_NOME = {'mestre': 'Moldura do Mestre'}
MOLDURA_PRECO = 180
MOLDURA_PRECO_DE = {'obsidiana': 300}
MOLDURA_NOME = {'ouro': 'Moldura Dourada', 'rubi': 'Moldura de Rubi', 'esmeralda': 'Moldura de Esmeralda',
                'obsidiana': 'Moldura de Obsidiana'}
AURAS_BOAS_VINDAS = tuple(a for a in AURAS if a not in AURA_PRECO_DE)
# 04/10: o Pacote de Boas-Vindas — uma classe rara à escolha, PEDRAS_BOAS_VINDAS pedras de cada e uma aura
BOAS_VINDAS_SKU = 'boas-vindas'
BOAS_VINDAS_PRECO = 250
BOAS_VINDAS_CLASSES = ('invocador', 'bruxo')
PEDRAS_BOAS_VINDAS = 10
# 04/10: as ofertas da semana. A semana vira na segunda 00:00 de Brasília (UTC−3; o Brasil não tem horário
# de verão desde 2019): 05/01/1970 foi uma segunda, e a meia-noite de lá são 03:00 UTC
OFERTA_DESCONTO = 25             # por cento
OFERTAS_POR_SEMANA = 3
SEMANA_S = 7 * 86400
SEMANA_ZERO = 4 * 86400 + 3 * 3600
# LOJA_OFERTAS=0 no ambiente desliga as ofertas (o catálogo sai com a lista vazia e tudo custa o preço
# cheio): é a chave do dono, e é como as provas da API ficam com preços fixos (tests/servidor_api.py)
OFERTAS_LIGADAS = os.environ.get('LOJA_OFERTAS', '1').strip() != '0'
SECOES_OFERTA = ('personagens', 'bonus', 'pedras', 'guilda', 'aparencia')   # moeda, Reescrita e o Pacote ficam fora
# 04/10: o presente a um amigo
PRESENTES_AMIGO_DIA = 3          # presentes que UMA conta dá em 24 h (em qualquer estado)
PRESENTES_AMIGO_ABERTOS = 5      # presentes de amigo esperando o jogo na conta de quem recebe

ESQUEMA_LOJA = """
CREATE TABLE IF NOT EXISTS loja_pedidos(
  id          INTEGER PRIMARY KEY,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  entrega     TEXT NOT NULL,
  preco       INTEGER NOT NULL CHECK (preco >= 0),
  estado      TEXT NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente', 'retirado', 'entregue', 'estornado', 'cancelado')),
  idem        TEXT,
  motivo      TEXT,
  criado_em   INTEGER NOT NULL,
  retirado_em INTEGER,
  fechado_em  INTEGER,
  versao_save INTEGER
);
CREATE INDEX IF NOT EXISTS loja_pedidos_conta ON loja_pedidos(conta_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS loja_pedidos_idem ON loja_pedidos(conta_id, idem) WHERE idem IS NOT NULL;
-- os presentes do Mestre (10/09, mestre.py): o pedido é o de loja_pedidos (preço 0); esta linha só diz que é
-- presente. Tabela nova, e não coluna: no rolling update o contêiner velho e o novo usam o mesmo banco
CREATE TABLE IF NOT EXISTS loja_presentes(
  pedido_id     INTEGER PRIMARY KEY REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  por           INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  criado_em     INTEGER NOT NULL,
  cancelado_por INTEGER REFERENCES contas(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS loja_presentes_por ON loja_presentes(por, criado_em);
-- os créditos de vinténs (10/09): pacote pago (pagamento.py) ou presente de vinténs do Mestre. O pedido é o de
-- loja_pedidos (preço 0); esta linha diz quanto vale, para o saldo do site contar o que ainda não chegou ao jogo
CREATE TABLE IF NOT EXISTS loja_creditos(
  pedido_id INTEGER PRIMARY KEY REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  vintens   INTEGER NOT NULL CHECK (vintens > 0),
  origem    TEXT NOT NULL CHECK (origem IN ('pagamento', 'presente')),
  mp_id     TEXT,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS loja_creditos_mp ON loja_creditos(mp_id);
-- 13/09: as barras de ouro. O saldo por conta (nunca negativo) e o extrato, sempre juntos na mesma transação
-- (barras_move). O movimento sobrevive à conta (dinheiro é trilha, como em pagamentos)
CREATE TABLE IF NOT EXISTS barras_saldo(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  saldo         INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  atualizado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS barras_movimentos(
  id           INTEGER PRIMARY KEY,
  conta_id     INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  delta        INTEGER NOT NULL CHECK (delta != 0),
  motivo       TEXT NOT NULL CHECK (motivo IN ('pacote', 'loja', 'estorno-loja', 'troca-vintens', 'presente',
                                               'estorno-pagamento', 'ajuste')),
  ref          TEXT,
  saldo_depois INTEGER,
  por          INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  idem         TEXT,
  criado_em    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS barras_movimentos_idem ON barras_movimentos(conta_id, idem) WHERE idem IS NOT NULL;
CREATE INDEX IF NOT EXISTS barras_movimentos_conta ON barras_movimentos(conta_id, id);
CREATE INDEX IF NOT EXISTS barras_movimentos_por ON barras_movimentos(por, criado_em);
-- 13/09: as barras de um pedido da loja: `custo` saiu na compra (volta se o pedido cancela ou é estornado);
-- `ganho` entra quando o pedido vira 'entregue' (vinténs → barras). Tabela nova, não coluna (o rolling update)
CREATE TABLE IF NOT EXISTS loja_barras(
  pedido_id INTEGER PRIMARY KEY REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  custo     INTEGER NOT NULL DEFAULT 0 CHECK (custo >= 0),
  ganho     INTEGER NOT NULL DEFAULT 0 CHECK (ganho >= 0),
  criado_em INTEGER NOT NULL
);
-- 04/10: a aura que a conta veste na praça (a posse é o pedido da loja; ver _auras). O Relé lê daqui
CREATE TABLE IF NOT EXISTS aura_escolhida(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  aura          TEXT NOT NULL,
  atualizado_em INTEGER NOT NULL
);
-- 08/10: a MOLDURA premium escolhida para a plaquinha (a posse é o pedido 'moldura-*'; ver _molduras). O Relé lê daqui
CREATE TABLE IF NOT EXISTS moldura_escolhida(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  moldura       TEXT NOT NULL,
  atualizado_em INTEGER NOT NULL
);
-- 04/10: o presente a um amigo. O pedido mora na conta de quem RECEBE; esta linha diz quem pagou (o
-- estorno volta para ele) e guarda o idem de quem deu (o de loja_pedidos é por conta de quem recebe)
CREATE TABLE IF NOT EXISTS loja_amigos(
  pedido_id INTEGER PRIMARY KEY REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  de        INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  de_nome   TEXT NOT NULL,
  idem      TEXT,
  criado_em INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS loja_amigos_idem ON loja_amigos(de, idem) WHERE idem IS NOT NULL;
CREATE INDEX IF NOT EXISTS loja_amigos_de ON loja_amigos(de, criado_em);
"""

# os filtros dos limites do JOGADOR: créditos (pacote pago, presente de vinténs)
# e presentes do Mestre não contam nos abertos, nas compras por hora, nas
# linhas por hora nem nas janelas — cada um tem o teto dele
# 02/10: e os PRÊMIOS do Eco Primordial (supremo.py, sku 'eco-…'): o fechamento da semana não pode encher
# os 5 abertos de quem ficou no pódio e travar a compra dele até o jogo retirar
# 08/10: e os Fragmentos de Gema do anúncio premiado (preço 0, sem linha em loja_creditos)
SEM_EXTRA = ("id NOT IN (SELECT pedido_id FROM loja_presentes) "
             "AND id NOT IN (SELECT pedido_id FROM loja_creditos) "
             "AND sku NOT LIKE 'eco-%' AND sku NOT IN ('anuncio-fragmentos', 'diario')")
# 04/10: o presente de um amigo CONTA no limite do produto de quem recebe (a Reescrita do mês, a aura que
# ele já tem), mas não nos tetos de abuso dele (5 abertos, 10 compras por hora, 30 linhas por hora): quem
# dá não pode travar a loja de quem recebe. Os tetos do presente são os de quem dá (loja_presentear)
SEM_GANHO = SEM_EXTRA + " AND id NOT IN (SELECT pedido_id FROM loja_amigos)"
# um pedido com as marcas de presente e de crédito (para _loja_pedido e o retirar)
COLUNAS_PEDIDO = ("p.*, (pr.pedido_id IS NOT NULL) AS presente, cr.vintens AS credito_vintens, "
                  "cr.origem AS credito_origem, lb.custo AS barras_custo, lb.ganho AS barras_ganho, "
                  "(am.pedido_id IS NOT NULL) AS amigo, am.de_nome AS amigo_nome")
DE_PEDIDOS = ("loja_pedidos p LEFT JOIN loja_presentes pr ON pr.pedido_id = p.id "
              "LEFT JOIN loja_creditos cr ON cr.pedido_id = p.id LEFT JOIN loja_barras lb ON lb.pedido_id = p.id "
              "LEFT JOIN loja_amigos am ON am.pedido_id = p.id")


# ---- números para gente ---------------------------------------------------------------
def milhar(n):
    """12000 → '12.000'."""
    return '{:,}'.format(int(n)).replace(',', '.')


def reais(centavos):
    """1990 → 'R$ 19,90' (o site mostra como vem: nenhum número de dinheiro mora no site)."""
    inteiros, cent = divmod(int(centavos), 100)
    return 'R$ %s,%02d' % (milhar(inteiros), cent)


# ---- o catálogo ---------------------------------------------------------------------
def _classe(cid, nome, raridade, cartas, preco):
    return {'sku': 'classe-' + cid, 'secao': 'personagens', 'tipo': 'classe', 'alvo': cid, 'qtd': 1,
            'nome': nome, 'raridade': raridade, 'cartas': cartas,
            'descricao': ('Libera o %s na hora: chegam as cartas que faltam para as %d do desbloqueio (as que '
                          'você já tem contam). Chega no nível 1.' % (nome, cartas)),
            'preco': preco, 'moeda': 'barras', 'limite': {'grupo': 'classe-' + cid, 'max': 1, 'dias': None}}


def _bonus(dias, preco):
    plural = '' if dias == 1 else 's'
    return {'sku': 'bonus-xp-%d' % dias, 'secao': 'bonus', 'tipo': 'bonus-xp', 'alvo': 'xp', 'qtd': dias,
            'dias': dias, 'nome': 'Bônus de XP — %d dia%s' % (dias, plural),
            'descricao': ('+%d%% de experiência para o grupo por %d dia%s, contados no relógio do servidor a partir '
                          'da entrega no jogo. Comprar de novo soma os dias. Não se multiplica com outro bônus de XP '
                          '(nem com o Pergaminho da Sabedoria), e com um evento de XP no ar os dois juntos param em ×2.'
                          % (round((BONUS_XP['fator'] - 1) * 100), dias, plural)),
            'preco': preco, 'moeda': 'barras', 'limite': None}


def _pedras(elemento, alvo, nome, de, preco, qtd):
    palavra = {10: 'Dez', 50: 'Cinquenta'}[qtd]
    nome = '%d %s' % (qtd, nome)
    if elemento == 'neutro':
        descricao = ('%s %s, a pedra neutra da forja. Sobem as peças neutras, que aceitam qualquer pedra.'
                     % (palavra, nome[3:]))
    else:
        descricao = ('%s pedras de forja %s: sobem as peças %s (as peças neutras aceitam qualquer pedra).'
                     % (palavra, de[0], de[1]))
    return {'sku': 'pedras-' + elemento + ('' if qtd == 10 else '-%d' % qtd), 'secao': 'pedras', 'tipo': 'pedras',
            'alvo': alvo, 'qtd': qtd, 'elemento': elemento, 'nome': nome, 'descricao': descricao, 'preco': preco,
            'moeda': 'barras', 'limite': None}


def _fragmentos(qtd, preco):
    """08/10: os Fragmentos de Gema (dono: "esses fragmentos serão vendidos na loja do site"). Entram no
    jogo como 'pedras' (a mesma entrega), e 100 viram a Gema Enterrada na forja — a pedra que engasta um
    bônus a mais numa peça (+1 PA, +1 PP, dano ou vida, sorteado). A Gema inteira não se vende."""
    return {'sku': 'fragmentos-%d' % qtd, 'secao': 'gema', 'tipo': 'pedras', 'alvo': FRAGMENTO_GEMA, 'qtd': qtd,
            'elemento': 'fragmento', 'nome': '%d Fragmentos de Gema' % qtd,
            'descricao': ('%d Fragmentos de Gema. Cem fragmentos viram uma Gema Enterrada na Forja, e a gema '
                          'engastada dá à peça um bônus a mais, sorteado: +1 PA, +1 PP, dano ou vida. Cada peça '
                          'aceita uma gema só. Os fragmentos também caem nos seis portais.' % qtd),
            'preco': preco, 'moeda': 'barras', 'limite': None}


def _vintens(qtd):
    """13/09: barras → vinténs. A entrega é o crédito de vinténs de sempre; o preço, barras."""
    barras = qtd // VINTENS_POR_BARRA
    return {'sku': 'vintens-%d' % qtd, 'secao': 'vintens', 'tipo': 'vintens', 'alvo': 'carteira', 'qtd': qtd,
            'nome': '%s vinténs' % milhar(qtd),
            'descricao': ('%s vinténs para a carteira do jogo, pagos com %s barras de ouro. Entram na hora, '
                          'mesmo com o jogo fechado.' % (milhar(qtd), milhar(barras))),
            'preco': barras, 'moeda': 'barras', 'limite': None}


def _barras_por_vintens(barras):
    """13/09: vinténs → barras, o caminho de quem farma. O preço é em vinténs (pagos na entrega, como todo
    pedido antigo); a entrega {tipo:'barras'} não mexe em nada no jogo, e as barras entram quando o pedido
    vira 'entregue' — desde 04/10, na própria compra (_loja_na_hora): vinténs fora e barras dentro juntos."""
    vintens = barras * VINTENS_POR_BARRA_FARMADA
    return {'sku': 'barras-por-vintens-%d' % barras, 'secao': 'barras-por-vintens', 'tipo': 'barras',
            'alvo': 'conta', 'qtd': barras, 'nome': '%s barras de ouro' % milhar(barras),
            'descricao': ('%s barras de ouro para a sua conta do site, pagas com %s vinténs da carteira do jogo. '
                          'Os vinténs saem e as barras entram na hora da compra, mesmo com o jogo fechado.'
                          % (milhar(barras), milhar(vintens))),
            'preco': vintens, 'moeda': 'vintens', 'limite': None}


def _moldura(mid, efeito):
    """08/10: a moldura premium da plaquinha do nome. Só aparência: a placa que todo mundo vê na praça ganha
    o filete, o fundo e os cantos dela, por cima da moldura automática do título."""
    return {'sku': 'moldura-' + mid, 'secao': 'aparencia', 'tipo': 'moldura', 'alvo': mid, 'qtd': 1,
            'nome': MOLDURA_NOME[mid],
            'descricao': ('%s Vale na plaquinha do seu nome na praça e na sede, por cima da moldura que o título '
                          'dá. Só aparência — não muda nada em batalha. Escolhe em Personagem → Customizar.' % efeito),
            'preco': MOLDURA_PRECO_DE.get(mid, MOLDURA_PRECO), 'moeda': 'barras',
            'limite': {'grupo': 'moldura-' + mid, 'max': 1, 'dias': None}}


def _aura(cor, nome, efeito):
    """04/10: a aura da praça. Só aparência: nada muda em batalha, e por isso pode se vender. Cada uma é um
    efeito próprio (o dono: "não só mudar a cor") — a descrição conta o que se vê, igual ao js/render3d/hub3d.js."""
    return {'sku': 'aura-' + cor, 'secao': 'aparencia', 'tipo': 'aura', 'alvo': cor, 'qtd': 1, 'nome': nome,
            'descricao': ('%s Em volta do seu herói na praça e na sede da guilda: todo mundo vê. Só aparência — não '
                          'muda nada em batalha. Liga, desliga e troca na ficha do Personagem, no jogo.' % efeito),
            'preco': AURA_PRECO_DE.get(cor, AURA_PRECO), 'moeda': 'barras', 'limite': {'grupo': 'aura-' + cor, 'max': 1, 'dias': None}}


# (elemento, pedra, nome, (da/de), preço de 10, preço de 50), em barras de ouro (13/09). Água e terra caem na
# Cisterna; ar, fogo e a neutra valem mais. 07/10: a frase "fogo e neutra não caem em portal aberto: só a loja
# as dá" era de antes do Fecho de Brasa abrir (19/09) — hoje TODA pedra cai de monstro em portal aberto
# (fogo no Fecho e na Mina; a neutra no Fecho, nos Andaimes e no Coração: `stoneDrop` em monsters.js), e o
# Poço mistura todos. A loja só adianta; quem farma chega a tudo. Os preços mais altos ficam pela raridade
FRAGMENTO_GEMA = 'stone-gem-frag'       # 08/10: o id do fragmento (js/core/data/items.js, DATA.gema.fragmento)
# (quantidade, preço em barras): 100 = uma gema inteira. Caro de propósito — a gema é poder permanente
# numa peça, e o caminho de quem farma (os seis portais, o anúncio premiado) existe
_FRAGMENTOS = ((10, 60), (50, 270), (100, 500))
_PEDRAS = (('agua', 'stone-tear', 'Lágrimas de Cisterna', ('da água', 'de água'), 25, 110),
           ('terra', 'stone-root', 'Grãos de Rocha-Mãe', ('da terra', 'de terra'), 25, 110),
           ('ar', 'stone-breath', 'Sopros Engarrafados', ('do ar', 'de ar'), 40, 180),
           ('fogo', 'stone-ember', 'Brasas Coaguladas', ('do fogo', 'de fogo'), 40, 180),
           ('neutro', 'stone-slate', 'Lascas da Lousa', None, 40, 180))

# Fora, de propósito: a Âncora de Forja (é o +10, o "item bom" que tem de ser
# MUITO difícil) e a Gema Enterrada inteira (só os FRAGMENTOS, 08/10 — pedido do
# dono), equipamento, cartas avulsas, estrelas, selos, giros, pets,
# sorte de saque, bônus de guilda, XP direto e multiplicador de vinténs. O gm nunca
# entra; as comuns (sumo, curandeiro) entraram em 08/10, quando os dois primeiros
# heróis viraram escolha livre (quem não as escolheu as compra como as outras).
# Seções na ordem da página (13/09): vintens · barras-por-vintens · personagens · bonus · pedras · guilda ·
# pergaminhos. Os preços em barras de ouro (1 barra = 20 vinténs de pacote: a régua de antes, ÷ 20).
CATALOGO = tuple(_vintens(q) for q in (1000, 5000, 12000, 25000)) + tuple(
    _barras_por_vintens(b) for b in (10, 50, 100, 250)) + (
    # 08/10: os dois primeiros heróis são livres (qualquer classe), então as comuns também se vendem
    _classe('sumo', 'Bárbaro', 'comum', 5, 250),           # a régua de sempre: 50 barras por carta
    _classe('curandeiro', 'Curandeiro', 'comum', 5, 250),
    _classe('invocador', 'Xamã', 'raro', 10, 500),
    _classe('bruxo', 'Bruxo', 'raro', 10, 500),
    _classe('espadachim', 'Ladino', 'epico', 20, 1000),
    _classe('arqueiro', 'Caçador', 'epico', 25, 1250),
    _classe('minotauro', 'Minotauro', 'epico', 30, 1500),
    _bonus(1, 75),
    _bonus(3, 195),
    _bonus(7, 395),
) + tuple(_pedras(e, a, n, d, p10, 10) for e, a, n, d, p10, _ in _PEDRAS) + tuple(
    _pedras(e, a, n, d, p50, 50) for e, a, n, d, _, p50 in _PEDRAS) + tuple(
    _fragmentos(q, p) for q, p in _FRAGMENTOS) + (
    # "pedras de guilda" = as Insígnias de Fundação (10 fundam uma guilda; só chefe derruba, 50%)
    {'sku': 'insignia-1', 'secao': 'guilda', 'tipo': 'insignias', 'alvo': 'fundacao', 'qtd': 1,
     'nome': '1 Insígnia de Fundação',
     'descricao': 'Uma Insígnia de Fundação, a que só os chefes derrubam. Dez fundam uma guilda.',
     'preco': 25, 'moeda': 'barras', 'limite': None},
    {'sku': 'insignias-10', 'secao': 'guilda', 'tipo': 'insignias', 'alvo': 'fundacao', 'qtd': INSIGNIAS_POR_GUILDA,
     'nome': '10 Insígnias de Fundação',
     'descricao': 'Dez Insígnias de Fundação, as que só os chefes derrubam: o bastante para fundar uma guilda.',
     'preco': 225, 'moeda': 'barras', 'limite': None},
    # a janela da Reescrita é regra de desenho (um caminho por mês), não freio de preço: fica
    {'sku': 'pergaminho-elemento', 'secao': 'pergaminhos', 'tipo': 'pergaminho', 'alvo': 'elemento', 'qtd': 1,
     'nome': 'Pergaminho da Reescrita',
     'descricao': ('Troca um caminho elemental de um herói por outro que a classe tenha, sem mexer em nível, '
                   'itens e estrelas. Alternar entre os caminhos que ele já tem continua grátis.'),
     'preco': 250, 'moeda': 'barras', 'limite': {'grupo': 'pergaminho-elemento', 'max': 1, 'dias': 30}},
    _aura('fogo', 'Aura de Brasa', 'Labaredas que sobem dos pés, fagulhas que estalam e um clarão quente que pulsa no chão.'),
    _aura('agua', 'Aura de Maré', 'Anéis de água que se abrem no chão como onda, e gotas que orbitam e caem.'),
    _aura('terra', 'Aura de Raiz', 'Folhas e pétalas girando devagar em volta, e brotos que nascem do chão e recolhem.'),
    _aura('ar', 'Aura de Vento', 'Fitas de ar em espiral subindo em volta do corpo, e um rastro ao andar.'),
    _aura('neutra', 'Aura da Lousa', 'Lascas de pedra em órbita lenta, runas no ar e um círculo rúnico de luz pálida no chão.'),
    # 08/10: as três auras novas e as quatro molduras premium
    _aura('sombra', 'Aura de Sombra', 'Fumaça roxa e lenta subindo em volta do corpo, e uma mancha escura que respira no chão.'),
    _aura('gelo', 'Aura de Geada', 'Anéis de gelo que se abrem devagar no chão e cristais pálidos em órbita, subindo e sumindo.'),
    _aura('ouro', 'Aura Dourada', 'Fagulhas de ouro em espiral apertada subindo do chão e um clarão dourado que pulsa.'),
    _moldura('ouro', 'Filete dourado duplo com losangos nas quinas.'),
    _moldura('rubi', 'Filete vermelho-rubi duplo com losangos nas quinas, sobre fundo vinho.'),
    _moldura('esmeralda', 'Filete verde-esmeralda duplo com losangos nas quinas, sobre fundo de mata.'),
    _moldura('obsidiana', 'Filete violeta duplo sobre fundo quase preto, com losangos nas quinas — a mais escura.'),
)
POR_SKU = {i['sku']: i for i in CATALOGO}
# 04/10: o Pacote de Boas-Vindas. O preço cheio é a soma do que vem dentro, pelos preços do catálogo
# (a classe rara, 10 pedras de cada uma das cinco e uma aura): o desconto que o site mostra sai daqui
_BV_PEDRAS = tuple(POR_SKU['pedras-' + p[0]] for p in _PEDRAS)
BOAS_VINDAS_CHEIO = (POR_SKU['classe-' + BOAS_VINDAS_CLASSES[0]]['preco'] + sum(i['preco'] for i in _BV_PEDRAS)
                     + AURA_PRECO)
CATALOGO = ({
    'sku': BOAS_VINDAS_SKU, 'secao': 'boas-vindas', 'tipo': 'pacote', 'alvo': 'boas-vindas', 'qtd': 1,
    'nome': 'Pacote de Boas-Vindas',
    'descricao': ('Uma vez por conta: um personagem raro à sua escolha (Xamã ou Bruxo), %d pedras de forja de '
                  'cada tipo (%d ao todo) e uma aura de elemento para a praça (Brasa, Maré, Raiz ou Vento), também à sua escolha.'
                  % (PEDRAS_BOAS_VINDAS, PEDRAS_BOAS_VINDAS * len(_BV_PEDRAS))),
    'preco': BOAS_VINDAS_PRECO, 'precoCheio': BOAS_VINDAS_CHEIO, 'moeda': 'barras',
    'escolhas': {'classe': list(BOAS_VINDAS_CLASSES), 'aura': list(AURAS_BOAS_VINDAS)},
    'limite': {'grupo': BOAS_VINDAS_SKU, 'max': 1, 'dias': None}},) + CATALOGO
POR_SKU = {i['sku']: i for i in CATALOGO}
SKUS_VINTENS = tuple(i['sku'] for i in CATALOGO if i['tipo'] == 'vintens')   # os vinténs comprados com barras
# fora da venda: só o nome, para o pedido antigo ainda aberto sair com o nome certo
RETIRADOS = {'pergaminho-xp': {'sku': 'pergaminho-xp', 'nome': 'Pergaminho da Sabedoria', 'tipo': 'pergaminho',
                               'alvo': 'xp', 'qtd': 1}}
GRUPOS = {}
for _i in CATALOGO:
    if _i['limite'] is None:
        continue
    _g = GRUPOS.setdefault(_i['limite']['grupo'], {'max': _i['limite']['max'], 'dias': _i['limite']['dias'],
                                                   'skus': set()})
    _g['skus'].add(_i['sku'])
del _i, _g

# Os PACOTES DE BARRAS DE OURO (dinheiro de verdade, pagamento.py; 13/09): a tabela em reais mora SÓ aqui.
# São os pacotes de vinténs de antes ÷ 20 (R$ por 50 barras: 4,90 · 3,55 · 3,33 · 3,20). O Caçador é
# exatamente o Tesouro; um raro sai por uma Arca com 100 de troco. A taxa do Mercado Pago sai do bruto.
PACOTES = (
    {'id': 'barras-50', 'nome': 'Bolsa de 50 barras de ouro', 'barras': 50, 'centavos': 490},
    {'id': 'barras-280', 'nome': 'Saco de 280 barras de ouro', 'barras': 280, 'centavos': 1990},
    {'id': 'barras-600', 'nome': 'Arca de 600 barras de ouro', 'barras': 600, 'centavos': 3990},
    {'id': 'barras-1250', 'nome': 'Tesouro de 1.250 barras de ouro', 'barras': 1250, 'centavos': 7990},
)
# os pacotes de VINTÉNS saíram da venda em 13/09; ficam para o pagamento criado antes do deploy e aprovado
# depois (ele credita os vinténs que vendeu) e para o nome dos pedidos e pagamentos antigos
PACOTES_RETIRADOS = (
    {'id': 'pacote-1000', 'nome': 'Bolsa de 1.000 vinténs', 'vintens': 1000, 'centavos': 490},
    {'id': 'pacote-5500', 'nome': 'Saco de 5.500 vinténs', 'vintens': 5500, 'centavos': 1990},
    {'id': 'pacote-12000', 'nome': 'Arca de 12.000 vinténs', 'vintens': 12000, 'centavos': 3990},
    {'id': 'pacote-25000', 'nome': 'Tesouro de 25.000 vinténs', 'vintens': 25000, 'centavos': 7990},
)
POR_PACOTE = {p['id']: p for p in PACOTES + PACOTES_RETIRADOS}
PACOTES_A_VENDA = frozenset(p['id'] for p in PACOTES)


def moeda_do_pacote(p):
    """'barras' (os de hoje) ou 'vintens' (os retirados)."""
    return 'barras' if 'barras' in p else 'vintens'


def qtd_do_pacote(p):
    return p['barras'] if 'barras' in p else p['vintens']


def pacote_publico(p):
    """{id, nome, moeda, barras|vintens, centavos, preco} — o preço em reais já escrito."""
    saida = {'id': p['id'], 'nome': p['nome'], 'moeda': moeda_do_pacote(p), 'centavos': p['centavos'],
             'preco': reais(p['centavos'])}
    saida[saida['moeda']] = qtd_do_pacote(p)
    return saida


def entrega_de(item):
    """O que o jogo recebe, congelado no pedido: {tipo, alvo, qtd}."""
    return {'tipo': item['tipo'], 'alvo': item['alvo'], 'qtd': item['qtd']}


def entrega_boas_vindas(classe, aura):
    """04/10: a entrega do Pacote de Boas-Vindas, com as duas escolhas de quem compra congeladas. As pedras
    vão antes da classe; o jogo confere TODOS os itens antes de entregar qualquer um (js/core/loja.js): se
    a classe não puder entrar, o pacote inteiro é recusado e as barras voltam."""
    itens = [entrega_de(i) for i in _BV_PEDRAS] + [entrega_de(POR_SKU['classe-' + classe])]
    return {'tipo': 'pacote', 'alvo': 'boas-vindas', 'qtd': 1, 'itens': itens, 'aura': aura}


# ---- as ofertas da semana (04/10) --------------------------------------------------------
def semana_de(t):
    """O número da semana de Brasília em que `t` cai (vira na segunda, 00:00 de lá)."""
    return (int(t) - SEMANA_ZERO) // SEMANA_S


def _conta_da_semana(semana, texto):
    return hashlib.sha256(('soterra-oferta:%d:%s' % (semana, texto)).encode('utf-8')).hexdigest()


def ofertas_da_semana(semana):
    """Os skus em oferta numa semana, sempre os mesmos para a mesma semana: de cada seção de SECOES_OFERTA
    sai o item de menor conta (sha256 da semana com o sku), e ficam as OFERTAS_POR_SEMANA seções de menor
    conta — três itens de três seções diferentes. NÃO é sorteio pago: ninguém paga para girar, todo mundo
    vê a mesma vitrine, e nada se guarda (a semana seguinte é outra conta)."""
    if not OFERTAS_LIGADAS:
        return ()
    por_secao = {}
    for i in CATALOGO:
        if i['secao'] in SECOES_OFERTA and i['moeda'] == 'barras':
            por_secao.setdefault(i['secao'], []).append(i['sku'])
    secoes = sorted(por_secao, key=lambda s: _conta_da_semana(semana, 'secao:' + s))[:OFERTAS_POR_SEMANA]
    return tuple(min(por_secao[s], key=lambda sku: _conta_da_semana(semana, sku)) for s in secoes)


def preco_com_desconto(preco):
    """O preço da oferta, arredondado para CIMA (a barra não se parte; o desconto nunca passa do anunciado)."""
    return -(-preco * (100 - OFERTA_DESCONTO) // 100)


def preco_de(item, t):
    """O preço que o servidor COBRA de `item` no instante `t`: o do catálogo, ou o da oferta da semana."""
    if item['sku'] in ofertas_da_semana(semana_de(t)):
        return preco_com_desconto(item['preco'])
    return item['preco']


def ofertas_publico(t):
    """{semana, desconto, inicio, fim, itens:[{sku, nome, preco, precoCheio}]} — o `fim` é a contagem
    regressiva do site e do jogo (segundos do servidor)."""
    semana = semana_de(t)
    inicio = SEMANA_ZERO + semana * SEMANA_S
    return {'semana': semana, 'desconto': OFERTA_DESCONTO, 'inicio': inicio, 'fim': inicio + SEMANA_S,
            'itens': [{'sku': sku, 'nome': POR_SKU[sku]['nome'], 'preco': preco_com_desconto(POR_SKU[sku]['preco']),
                       'precoCheio': POR_SKU[sku]['preco']} for sku in ofertas_da_semana(semana)]}


def nome_do_pedido(sku, entrega=None, vintens=None):
    """O nome de um pedido: o do catálogo, o de um produto que saiu da venda, o
    de um pacote, '<N> vinténs' no presente de vinténs; senão, o próprio sku."""
    item = POR_SKU.get(sku) or RETIRADOS.get(sku) or POR_PACOTE.get(sku)
    if item is not None:
        return item['nome']
    if sku == SKU_PRESENTE_VINTENS:
        n = vintens if vintens else (entrega.get('qtd') if isinstance(entrega, dict) else None)
        if isinstance(n, int) and not isinstance(n, bool) and n > 0:
            return '%s vinténs' % milhar(n)
    # 08/10: o prêmio diário de resgate (premio_diario.py): os vinténs e as pedras/fragmentos
    if sku == 'diario-vintens':
        n = vintens if vintens else (entrega.get('qtd') if isinstance(entrega, dict) else None)
        if isinstance(n, int) and not isinstance(n, bool) and n > 0:
            return '%s vinténs (prêmio diário)' % milhar(n)
        return 'Vinténs do prêmio diário'
    if sku == 'diario':
        return 'Prêmio diário'
    # 08/10: os Fragmentos de Gema do anúncio premiado (anuncio.py)
    if sku == 'anuncio-fragmentos':
        n = entrega.get('qtd') if isinstance(entrega, dict) else None
        if isinstance(n, int) and not isinstance(n, bool) and n > 0:
            return '%d Fragmentos de Gema (anúncio)' % n
        return 'Fragmentos de Gema do anúncio'
    # 06/10: os vinténs do anúncio premiado do aplicativo (anuncio.py)
    if sku == 'anuncio-vintens':
        n = vintens if vintens else (entrega.get('qtd') if isinstance(entrega, dict) else None)
        if isinstance(n, int) and not isinstance(n, bool) and n > 0:
            return '%s vinténs (anúncio)' % milhar(n)
        return 'Vinténs do anúncio'
    # 02/10: os prêmios da semana do Eco Primordial (supremo.py)
    if isinstance(sku, str) and sku.startswith('eco-'):
        n = entrega.get('qtd') if isinstance(entrega, dict) else None
        if sku == 'eco-vintens' and isinstance(n, int) and not isinstance(n, bool) and n > 0:
            return '%s vinténs (Eco Primordial)' % milhar(n)
        return 'Prêmio do Eco Primordial'
    return sku


def _json(texto):
    try:
        v = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, dict) else None


le_json = _json


def _id_valido(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 < v < 2 ** 53


id_valido = _id_valido
_liberadas = liberadas               # (comum.py) as classes liberadas no progress, com o nome antigo corrigido


def origem_do_pedido(r):
    """'presente' (linha em loja_presentes), 'pagamento' (crédito de pacote), 'eco'
    (prêmio da semana do Eco Primordial, sku 'eco-…') ou None (compra da loja).
    `r` vem de uma consulta com COLUNAS_PEDIDO."""
    chaves = r.keys()
    # 02/10: o prêmio da semana do Eco Primordial (supremo.py) — o jogo avisa "Prêmio do Eco"
    if 'sku' in chaves and isinstance(r['sku'], str) and r['sku'].startswith('eco-'):
        return 'eco'
    # 07/10: o resgate de um degrau da trilha da temporada (trilha.py) — o jogo avisa "Prêmio da trilha"
    if 'sku' in chaves and r['sku'] == 'trilha':
        return 'trilha'
    # 08/10: o prêmio diário de resgate (premio_diario.py) — o jogo avisa "Prêmio diário"
    if 'sku' in chaves and r['sku'] in ('diario', 'diario-vintens'):
        return 'diario'
    if 'presente' in chaves and r['presente']:
        return 'presente'
    if 'amigo' in chaves and r['amigo']:              # 04/10: o presente de um amigo (loja_amigos)
        return 'amigo'
    if 'credito_origem' in chaves and r['credito_origem'] == 'pagamento':
        return 'pagamento'
    return None


def le_anotacao(db):
    """`db.loja` do save, conferido: (aplicadas, recusadas). Ids inteiros > 0,
    no máximo os 200 mais novos (o fim da lista) de cada; o motivo fora da
    lista vira 'recusado'. Nunca levanta: o save não pode cair por causa disto."""
    loja = db.get('loja') if isinstance(db, dict) else None
    if not isinstance(loja, dict):
        return [], []
    aplicadas, vistos = [], set()
    brutas = loja.get('aplicadas')
    for v in (brutas[-ANOTACAO_MAX:] if isinstance(brutas, list) else []):
        if _id_valido(v) and v not in vistos:
            vistos.add(v)
            aplicadas.append(v)
    recusadas, vistos = [], set()
    brutas = loja.get('recusadas')
    for v in (brutas[-ANOTACAO_MAX:] if isinstance(brutas, list) else []):
        pid = v.get('id') if isinstance(v, dict) else None
        if _id_valido(pid) and pid not in vistos:
            vistos.add(pid)
            motivo = v.get('motivo')
            recusadas.append((pid, motivo if motivo in MOTIVOS else 'recusado'))
    return aplicadas, recusadas


def _herois(progress):
    """[(heroi_id, ficha)] das fichas de classe do jogo (o gm e as tortas ficam de fora)."""
    herois = progress.get('heroes') if isinstance(progress, dict) else None
    if not isinstance(herois, dict):
        return []
    return [(hid, h) for hid, h in herois.items() if isinstance(h, dict) and classe_do_heroi(hid, h) is not None]


def _escolheu_caminho(h):
    if h.get('element') in ELEMENTAIS:
        return True
    lista = h.get('elements')
    return isinstance(lista, list) and any(e in ELEMENTAIS for e in lista)


# ---- o mixin --------------------------------------------------------------------------
class LojaMixin:

    # -- leituras (sempre dentro da tranca; na compra, dentro de _escrita) -----------------
    def _loja_save(self, cid):
        r = self.con.execute("SELECT progress, db, versao, atualizado_em FROM saves WHERE conta_id = ?",
                             (cid,)).fetchone()
        if r is None:
            return None
        return {'progress': _json(r['progress']), 'db': _json(r['db']), 'versao': r['versao'],
                'em': r['atualizado_em']}

    def _loja_a_caminho(self, cid):
        """Os vinténs dos créditos (pacote pago, presente de vinténs) que o jogo ainda não recebeu — e, desde
        13/09, os vinténs comprados com barras (seção 'vintens'), que ainda não chegaram."""
        creditos = self.con.execute(
            "SELECT COALESCE(SUM(cr.vintens), 0) FROM loja_creditos cr JOIN loja_pedidos p ON p.id = cr.pedido_id "
            "WHERE p.conta_id = ? AND p.estado IN ('pendente', 'retirado')", (cid,)).fetchone()[0]
        trocas = self.con.execute(
            "SELECT entrega FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') AND sku IN (%s) "
            "AND id NOT IN (SELECT pedido_id FROM loja_creditos)" % ','.join('?' * len(SKUS_VINTENS)),
            [cid] + list(SKUS_VINTENS)).fetchall()
        for r in trocas:
            ent = _json(r['entrega']) or {}
            if ent.get('tipo') == 'vintens' and _id_valido(ent.get('qtd')):
                creditos += ent['qtd']
        return creditos

    # -- as barras de ouro (13/09) ------------------------------------------------------------
    def _barras_saldo(self, cid):
        r = self.con.execute("SELECT saldo FROM barras_saldo WHERE conta_id = ?", (cid,)).fetchone()
        return r[0] if r is not None else 0

    def barras_move(self, cid, delta, motivo, ref, idem, t, por=None, parcial=False):
        """Dentro da _escrita de quem chama: um movimento no extrato e o saldo, JUNTOS.
        `idem` já usado nesta conta: nada muda e devolve None (o crédito ou o estorno
        que chega de novo). Débito maior que o saldo: 409 'barras de ouro
        insuficientes' — ou, com `parcial` (o estorno de um pacote cujas barras já
        foram gastas), tira só o que houver. Devolve o delta aplicado (0: nada a tirar)."""
        if motivo not in MOTIVOS_BARRAS or not isinstance(delta, int) or isinstance(delta, bool) or delta == 0:
            raise ValueError('movimento de barras torto: %r %r' % (motivo, delta))
        if idem is not None and self.con.execute(
                "SELECT 1 FROM barras_movimentos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone():
            return None
        saldo = self._barras_saldo(cid)
        if delta < 0 and saldo + delta < 0:
            if not parcial:
                raise Recusa(409, 'barras de ouro insuficientes', barras={'saldo': saldo})
            delta = -saldo
            if delta == 0:
                return 0
        if saldo + delta > BARRAS_TETO:
            raise Recusa(409, 'o saldo de barras de ouro passaria do teto')
        self.con.execute("INSERT OR IGNORE INTO barras_saldo(conta_id, saldo, atualizado_em) VALUES (?, 0, ?)", (cid, t))
        self.con.execute("UPDATE barras_saldo SET saldo = saldo + ?, atualizado_em = ? WHERE conta_id = ?", (delta, t, cid))
        self.con.execute("INSERT INTO barras_movimentos(conta_id, delta, motivo, ref, saldo_depois, por, idem, criado_em) "
                         "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (cid, delta, motivo, ref, saldo + delta, por, idem, t))
        return delta

    def _barras_do_pedido(self, cid, pid, estado, t):
        """Dentro da _escrita, logo depois de o pedido `pid` virar `estado`:
          - 'cancelado' ou 'estornado': as barras do custo voltam ('estorno-loja'), uma vez;
          - 'entregue': as barras do ganho entram ('troca-vintens'), uma vez — o juiz (ou o
            save antigo) já tirou os vinténs. E o pedido que tinha sido cancelado (as barras
            devolvidas) e o jogo aplicou mesmo assim: o custo sai de novo, até o que houver;
            o que faltar vira alerta para o Mestre."""
        if estado in ('cancelado', 'estornado'):
            self._aura_poda(cid)                        # 04/10: a aura que saiu com o pedido deixa de ser vestida
            self._moldura_poda(cid)                     # 08/10: idem para a moldura premium
        lb = self.con.execute("SELECT custo, ganho FROM loja_barras WHERE pedido_id = ?", (pid,)).fetchone()
        if lb is None:
            return
        # 04/10: no presente de um amigo as barras são de QUEM DEU — o estorno volta para ele, não para
        # quem recebeu. A conta de quem deu foi excluída (de NULL): não há a quem devolver
        am = self.con.execute("SELECT de FROM loja_amigos WHERE pedido_id = ?", (pid,)).fetchone()
        if am is not None:
            if am['de'] is None:
                return
            cid = am['de']
        ref = 'pedido:%d' % pid
        if estado in ('cancelado', 'estornado'):
            if lb['custo'] > 0:
                self.barras_move(cid, lb['custo'], 'estorno-loja', ref, ref + ':estorno', t)
            return
        if estado != 'entregue':
            return
        if lb['ganho'] > 0:
            self.barras_move(cid, lb['ganho'], 'troca-vintens', ref, ref + ':ganho', t)
        if lb['custo'] > 0 and self.con.execute("SELECT 1 FROM barras_movimentos WHERE conta_id = ? AND idem = ?",
                                                (cid, ref + ':estorno')).fetchone():
            tirado = self.barras_move(cid, -lb['custo'], 'loja', ref, ref + ':recobra', t, parcial=True)
            faltou = lb['custo'] + (tirado or 0) if tirado is not None else 0
            alerta = getattr(self, '_alerta', None)
            if faltou > 0 and alerta is not None:
                alerta(cid, 'barras-faltaram', {'pedido': pid, 'barras': lb['custo'], 'tirado': -(tirado or 0),
                                                'faltou': faltou, 'tardio': True}, t)

    def _barras_movimentos(self, cid, limite=MOVIMENTOS_LISTA):
        """Dentro da tranca: os últimos movimentos da conta, como o site e a ficha do Mestre veem."""
        linhas = self.con.execute(
            "SELECT m.*, c.nome AS por_nome FROM barras_movimentos m LEFT JOIN contas c ON c.id = m.por "
            "WHERE m.conta_id = ? ORDER BY m.id DESC LIMIT ?", (cid, limite)).fetchall()
        pedidos = [int(r['ref'][7:]) for r in linhas if (r['ref'] or '').startswith('pedido:') and r['ref'][7:].isdigit()]
        nomes = {}
        if pedidos:
            for p in self.con.execute("SELECT id, sku, entrega FROM loja_pedidos WHERE id IN (%s)"
                                      % ','.join('?' * len(pedidos)), pedidos):
                nomes['pedido:%d' % p['id']] = nome_do_pedido(p['sku'], _json(p['entrega']))
            # 04/10: o presente a um amigo aparece no extrato de quem pagou com o nome de quem recebeu
            # (é por aqui que o Mestre vê, na ficha da conta, para quem as barras foram)
            for a in self.con.execute(
                    "SELECT am.pedido_id, " + NOME_PUBLICO_SQL + " AS para FROM loja_amigos am "
                    "JOIN loja_pedidos p ON p.id = am.pedido_id JOIN contas c ON c.id = p.conta_id "
                    "LEFT JOIN resumos r ON r.conta_id = c.id WHERE am.pedido_id IN (%s)"
                    % ','.join('?' * len(pedidos)), pedidos):
                chave = 'pedido:%d' % a['pedido_id']
                nomes[chave] = '%s (presente para %s)' % (nomes.get(chave), a['para'])
        pags = [int(r['ref'][10:]) for r in linhas
                if (r['ref'] or '').startswith('pagamento:') and r['ref'][10:].isdigit()]
        if pags:
            for g in self.con.execute("SELECT id, pacote FROM pagamentos WHERE id IN (%s)" % ','.join('?' * len(pags)),
                                      pags):
                nomes['pagamento:%d' % g['id']] = nome_do_pedido(g['pacote'])
        # 04/10: o pacote comprado pela Google Play no aplicativo (pagamento_play.py). A tabela é de lá e
        # pode ainda não existir num banco aberto só pela loja: sem ela, o movimento sai sem nome
        plays = [int(r['ref'][5:]) for r in linhas if (r['ref'] or '').startswith('play:') and r['ref'][5:].isdigit()]
        if plays:
            try:
                for g in self.con.execute("SELECT id, pacote FROM pagamentos_play WHERE id IN (%s)"
                                          % ','.join('?' * len(plays)), plays):
                    nomes['play:%d' % g['id']] = '%s (Google Play)' % nome_do_pedido(g['pacote'])
            except sqlite3.OperationalError:
                pass
        saida = []
        for r in linhas:
            m = {'id': r['id'], 'delta': r['delta'], 'motivo': r['motivo'], 'saldo': r['saldo_depois'],
                 'criadoEm': r['criado_em'], 'nome': nomes.get(r['ref'])}
            if r['ref'] and r['ref'].startswith('pedido:'):
                m['pedido'] = int(r['ref'][7:]) if r['ref'][7:].isdigit() else None
            if r['por'] is not None:
                m['por'] = {'id': r['por'], 'nome': r['por_nome']}
            # 06/10: a barra do anúncio premiado (anuncio.py). No banco o motivo é 'presente' (o CHECK da
            # tabela não se altera no rolling update); a `ref` diz a origem, e é ela que o extrato mostra
            if (r['ref'] or '').startswith('anuncio:'):
                m['motivo'], m['nome'] = 'anuncio', 'Anúncio assistido'
            # 08/10: a barra do prêmio diário (premio_diario.py), pela mesma porta
            if (r['ref'] or '').startswith('diario:'):
                m['motivo'], m['nome'] = 'diario', 'Prêmio diário'
            saida.append(m)
        return saida

    def _barras_publico(self, cid, movimentos=True):
        saida = {'saldo': self._barras_saldo(cid)}
        if movimentos:
            saida['movimentos'] = self._barras_movimentos(cid)
        return saida

    def _loja_saldo(self, cid, conta, save):
        """Carteira do último save (só o bolso), o que está a caminho, a reserva e o disponível."""
        reservado = self.con.execute(
            "SELECT COALESCE(SUM(preco), 0) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado')",
            (cid,)).fetchone()[0]
        a_caminho = self._loja_a_caminho(cid)
        db = save['db'] if save else None
        cart = db.get('carteira') if isinstance(db, dict) else None
        carteira = limita(cart.get('moedas'), 0, CARTEIRA_TETO) if isinstance(cart, dict) else 0
        return {'carteira': carteira, 'reservado': reservado, 'aCaminho': a_caminho,
                'disponivel': carteira + a_caminho - reservado,
                'semFundo': bool(conta['gm']), 'saveVersao': save['versao'] if save else 0,
                'saveEm': save['em'] if save else None}

    def _loja_limites(self, cid, t):
        """{grupo: {usados, max, dias, liberaEm}} — só os grupos que existem (as
        classes e a Reescrita). Contam pendente, retirado e entregue; cancelado,
        estornado, presente e crédito não. liberaEm: SÓ com o grupo cheio, o
        instante em que a compra que destrava sai da janela; com vaga livre (ou
        sem janela) é null — o campo é contrato público, e uma data com vaga
        livre viraria "limite atingido" em quem o lesse."""
        linhas = self.con.execute(
            "SELECT sku, criado_em FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'entregue') "
            "AND " + SEM_EXTRA + " ORDER BY criado_em", (cid,)).fetchall()
        saida = {}
        for grupo, g in GRUPOS.items():
            janela = g['dias'] * 86400 if g['dias'] else None
            em = [r['criado_em'] for r in linhas if r['sku'] in g['skus'] and (janela is None or r['criado_em'] > t - janela)]
            libera = em[len(em) - g['max']] + janela if janela and len(em) >= g['max'] else None
            saida[grupo] = {'usados': len(em), 'max': g['max'], 'dias': g['dias'], 'liberaEm': libera}
        return saida

    @staticmethod
    def _loja_classes(progress):
        """{classe à venda: {liberada, cartas}} — o site mostra "você tem 6 de 10 cartas"."""
        lib = liberadas(progress)
        cartas = progress.get('cards') if isinstance(progress, dict) else None
        cartas = cartas if isinstance(cartas, dict) else {}
        return {i['alvo']: {'liberada': i['alvo'] in lib, 'cartas': max(0, inteiro(cartas.get(i['alvo'])))}
                for i in CATALOGO if i['tipo'] == 'classe'}

    @staticmethod
    def _loja_cancelavel(r, t):
        return r['estado'] == 'pendente' or (r['estado'] == 'retirado' and r['retirado_em'] is not None
                                             and r['retirado_em'] <= t - RETIRADO_PRESO)

    def _loja_pedido(self, r, t):
        """Um pedido como o site vê. Presente e crédito de pacote ganham `origem`
        e não se cancelam pelo site; os créditos, `vintens`. Sem as colunas de
        COLUNAS_PEDIDO, igual a antes."""
        vintens = r['credito_vintens'] if 'credito_vintens' in r.keys() else None
        saida = {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], _json(r['entrega']), vintens),
                 'preco': r['preco'], 'estado': r['estado'], 'motivo': r['motivo'], 'criadoEm': r['criado_em'],
                 'retiradoEm': r['retirado_em'], 'fechadoEm': r['fechado_em'],
                 'cancelavel': self._loja_cancelavel(r, t)}
        origem = origem_do_pedido(r)
        if origem is not None:
            saida['origem'] = origem
            saida['cancelavel'] = False
        if origem == 'amigo':                           # 04/10: quem mandou o presente
            saida['de'] = r['amigo_nome']
        if vintens:
            saida['vintens'] = vintens
        # 13/09: em que moeda o pedido foi pago — 'barras' (o custo saiu na compra), 'vintens' (o preço sai na
        # entrega) ou None (crédito, presente, Mestre); `ganhaBarras` na troca de vinténs por barras
        custo = r['barras_custo'] if 'barras_custo' in r.keys() else None
        ganho = r['barras_ganho'] if 'barras_ganho' in r.keys() else None
        if origem == 'amigo':                           # no presente, as barras são de quem deu
            custo = None
        saida['moeda'] = 'barras' if custo else ('vintens' if r['preco'] > 0 else None)
        if custo:
            saida['barras'] = custo
        if ganho:
            saida['ganhaBarras'] = ganho
        return saida

    def _loja_pedido_por_id(self, pid):
        return self.con.execute("SELECT %s FROM %s WHERE p.id = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS), (pid,)).fetchone()

    # -- GET /api/loja/catalogo (público) ---------------------------------------------------
    def loja_catalogo(self, conta, corpo):
        mp = getattr(self, 'mp', None)
        ligado = bool(mp is not None and mp.ligado)
        # 13/09: `barras` diz o câmbio para o site explicar as trocas sem repetir número nenhum
        return 200, {'ok': True, 'versao': LOJA_VERSAO,
                     'itens': [dict(i, limite=dict(i['limite']) if i['limite'] else None) for i in CATALOGO],
                     'pacotes': [pacote_publico(p) for p in PACOTES],
                     # 04/10: as ofertas da semana e o relógio do servidor (a contagem regressiva não confia
                     # no relógio do aparelho); o que não se presenteia e os tetos do presente
                     'agora': agora(), 'ofertas': ofertas_publico(agora()),
                     'presente': {'fora': list(FORA_DO_PRESENTE), 'porDia': PRESENTES_AMIGO_DIA},
                     'barras': {'nome': 'Barras de Ouro', 'vintensPorBarra': VINTENS_POR_BARRA,
                                'vintensPorBarraFarmada': VINTENS_POR_BARRA_FARMADA},
                     'pagamento': {'ligado': ligado, 'teste': bool(ligado and mp.teste)}}

    # -- GET /api/loja/minha ------------------------------------------------------------------
    def loja_minha(self, conta, corpo):
        cid, t = conta['id'], agora()
        with self.tranca:
            save = self._loja_save(cid)
            saldo = self._loja_saldo(cid, conta, save)
            limites = self._loja_limites(cid, t)
            pedidos = self.con.execute("SELECT %s FROM %s WHERE p.conta_id = ? ORDER BY p.id DESC LIMIT ?"
                                       % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid, PEDIDOS_LISTA)).fetchall()
            pedidos = [self._loja_pedido(r, t) for r in pedidos]
            # 04/10: o pedido que só não entrou porque há uma luta aberta — o site diz "chega quando a sala terminar"
            if (any(p['estado'] == 'pendente' for p in pedidos) and getattr(self, '_autoridade_ligada', lambda: False)()
                    and self._loja_em_luta(cid, t)):
                for p in pedidos:
                    if p['estado'] == 'pendente' and (POR_SKU.get(p['sku']) or {}).get('tipo') in TIPOS_DA_LUTA:
                        p['espera'] = 'luta'
            barras = self._barras_publico(cid)          # 13/09: o saldo de barras da conta e o extrato
            auras = self._auras_publico(cid)            # 04/10
            boas = self._boas_vindas_publico(cid, save['progress'] if save else None, t)
            dados = self._presentes_dados(cid, t)
        return 200, {'ok': True, 'saldo': saldo, 'barras': barras, 'limites': limites,
                     'auras': auras, 'boasVindas': boas, 'presentes': dados,
                     'classes': self._loja_classes(save['progress'] if save else None),
                     'pedidos': pedidos}

    # -- POST /api/loja/comprar ------------------------------------------------------------------
    def _loja_confere_item(self, cid, item, progress, entrega=None):
        """O que torna o produto inútil ou repetido — vale também para o Mestre
        (e para o presente dele: a classe a caminho, comprada OU presenteada, barra as duas).
        `entrega` só no Pacote de Boas-Vindas (as escolhas de quem compra)."""
        if item['tipo'] == 'aura':                      # 04/10: comprada, presenteada ou vinda no Pacote
            if item['alvo'] in self._auras(cid, so_compradas=True):
                raise Recusa(409, 'essa aura já é sua')
        elif item['tipo'] == 'pacote':
            if entrega is not None:
                for sub in entrega['itens']:
                    if sub['tipo'] == 'classe':
                        self._loja_confere_item(cid, POR_SKU['classe-' + sub['alvo']], progress)
                if entrega['aura'] in self._auras(cid, so_compradas=True):
                    raise Recusa(409, 'essa aura já é sua: escolha outra para o pacote')
        elif item['tipo'] == 'classe':
            if item['alvo'] in liberadas(progress):
                raise Recusa(409, 'essa classe já está liberada')
            estados = {r[0] for r in self.con.execute(
                "SELECT estado FROM loja_pedidos WHERE conta_id = ? AND sku = ? AND estado IN ('pendente', 'retirado', 'entregue')",
                (cid, item['sku']))}
            # 04/10: a classe que está vindo dentro de um Pacote de Boas-Vindas também está a caminho
            for r in self.con.execute("SELECT entrega FROM loja_pedidos WHERE conta_id = ? AND sku = ? "
                                      "AND estado IN ('pendente', 'retirado')", (cid, BOAS_VINDAS_SKU)):
                if any(isinstance(x, dict) and x.get('tipo') == 'classe' and x.get('alvo') == item['alvo']
                       for x in ((_json(r['entrega']) or {}).get('itens') or [])):
                    estados.add('pendente')
            if estados & {'pendente', 'retirado'}:
                raise Recusa(409, 'já há um pedido dessa classe a caminho')
            if 'entregue' in estados:
                raise Recusa(409, 'essa classe já foi comprada')
        elif item['tipo'] == 'pergaminho' and item['alvo'] == 'elemento':
            if not any(_escolheu_caminho(h) for _, h in _herois(progress)):
                raise Recusa(409, 'nenhum herói escolheu caminho elemental ainda')
        elif item['tipo'] == 'pergaminho' and item['alvo'] == 'xp':
            # só o Sabedoria (fora da venda desde a loja 2; fica para o dono que o puser de volta): ele tem
            # carga a poupar. O bônus de XP por tempo NÃO é recusado com todos no nível 30 — no jogo ele
            # ainda rende a fatia do pet e o dízimo da guilda; o preço é o freio
            xps = [limita(h.get('xp'), 0, XP_MAX) for _, h in _herois(progress)]
            if xps and all(x >= XP_MAX for x in xps):
                raise Recusa(409, 'todos os heróis já estão no nível 30')

    def _loja_confere_limites(self, cid, item, t):
        if item['limite'] is not None:                  # sem janela (pedras, bônus, insígnias): o preço é o freio
            lim = self._loja_limites(cid, t)[item['limite']['grupo']]
            if lim['usados'] >= lim['max']:
                if lim['dias']:
                    raise Recusa(429, 'limite deste produto: %d a cada %d dias' % (lim['max'], lim['dias']),
                                 liberaEm=lim['liberaEm'])
                raise Recusa(429, 'limite deste produto: %d por conta' % lim['max'])
        abertos = self.con.execute(
            "SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') AND "
            + SEM_GANHO, (cid,)).fetchone()[0]
        if abertos >= ABERTOS_MAX:
            raise Recusa(429, 'pedidos abertos demais (%d)' % ABERTOS_MAX)
        na_hora = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_pedidos WHERE conta_id = ? AND criado_em > ? "
            "AND estado IN ('pendente', 'retirado', 'entregue') AND " + SEM_GANHO + " ORDER BY criado_em",
            (cid, t - 3600))]
        if len(na_hora) >= COMPRAS_POR_HORA:
            raise Recusa(429, 'compras demais na última hora (%d)' % COMPRAS_POR_HORA,
                         liberaEm=na_hora[len(na_hora) - COMPRAS_POR_HORA] + 3600)

    def _loja_confere_teto(self, cid, t):
        """O teto de LINHAS: PEDIDOS_POR_HORA pedidos criados na última hora,
        em QUALQUER estado — cancelado e estornado inclusive — e para o Mestre
        também. COMPRAS_POR_HORA devolve a vaga de propósito quando o pedido é
        cancelado ou estornado (o jogador não perdeu nada), mas cada ciclo
        grava uma linha em loja_pedidos e duas em eventos, que ninguém poda: um
        laço de comprar-e-cancelar enchia o disco a 1 GB por dia por conta. O
        dono não compra 30 vezes por hora, e um token de Mestre roubado não
        pode encher o disco. Presentes e créditos ficam fora: têm os tetos
        deles (por Mestre, mestre.py; por conta e por pagamento, pagamento.py)."""
        criados = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_pedidos WHERE conta_id = ? AND criado_em > ? AND " + SEM_GANHO
            + " ORDER BY criado_em", (cid, t - 3600))]
        if len(criados) >= PEDIDOS_POR_HORA:
            raise Recusa(429, 'pedidos demais na última hora (%d)' % PEDIDOS_POR_HORA,
                         liberaEm=criados[len(criados) - PEDIDOS_POR_HORA] + 3600)

    def loja_comprar(self, conta, corpo):
        """A compra grava o pedido (_loja_compra_grava) e, com a autoridade ligada, o servidor já o ENTREGA
        na mesma chamada (_loja_fecha_na_hora): quem comprou não espera o jogo abrir."""
        status, resp = self._loja_compra_grava(conta, corpo)
        return self._loja_fecha_na_hora(conta, status, resp, 'pedido')

    # -- a entrega NA HORA (04/10) -------------------------------------------------------------------
    def _loja_em_luta(self, cid, t):
        """Dentro da tranca: a conta tem uma luta aberta que o servidor ainda vai refazer com o estado dela
        (a mesma régua da Caixa do Mestre, moderacao.py)?"""
        em_luta = getattr(self, '_dar_em_luta', None)
        return bool(em_luta is not None and em_luta(cid, t))

    def _loja_na_hora(self, conta):
        """FORA da tranca. O dono (04/10): "comprei barras de ouro com vinténs e as barras não entraram na
        minha conta.. esse lance de compra na loja e já disponibilizar precisa ser na hora". Com a
        autoridade ligada o servidor é o dono da economia: não há por que o pedido esperar o jogo abrir e
        vir buscá-lo. Entrega AGORA tudo o que a conta tem aberto, pelo mesmo caminho do retirar (o juiz, o
        estado e o pedido fechando na mesma transação). Devolve a resposta dele; {'falhou': frase} se o
        juiz não respondeu (o pedido fica aberto e sai na próxima busca — nada se perde); None sem a
        autoridade (em casa o jogo continua buscando a fila)."""
        if not getattr(self, '_autoridade_ligada', lambda: False)():
            return None
        try:
            return self._loja_retirar_no_servidor(conta, na_hora=True)[1]
        except Recusa as e:
            log.warning("loja: a entrega na hora de #%d ficou para a próxima busca — %s", conta['id'], e.erro)
            return {'falhou': e.erro}
        except Exception:                               # a compra já está gravada: ela não pode virar um 500
            log.exception("loja: a entrega na hora de #%d quebrou", conta['id'])
            return {'falhou': 'erro'}

    def _loja_fecha_na_hora(self, conta, status, resp, chave):
        """Depois da compra (`chave` 'pedido') ou do presente a um amigo ('presente'; `conta` é quem PAGOU e
        o pedido mora em quem recebe): entrega na hora e refaz a resposta com o que ficou — o pedido já
        'entregue', o saldo e as barras de depois. O que o juiz recusou já foi ESTORNADO (as barras de volta
        a quem pagou, a reserva solta): vira 409 dizendo que nada foi cobrado. O que ficou aberto leva
        `espera`: 'luta' (o que mexe no grupo da luta chega quando ela terminar), 'estado' (a conta nunca
        salvou: espera o jogo abrir uma vez) ou 'juiz' (sai na próxima busca)."""
        pedido = resp.get(chave) if isinstance(resp, dict) else None
        if not isinstance(pedido, dict) or pedido.get('estado') not in ('pendente', 'retirado'):
            return status, resp
        pid, t = pedido['id'], agora()
        with self.tranca:
            alvo = self.con.execute("SELECT * FROM contas WHERE id = (SELECT conta_id FROM loja_pedidos WHERE id = ?)",
                                    (pid,)).fetchone()
        if alvo is None:
            return status, resp
        feito = self._loja_na_hora(dict(alvo))
        if feito is None:
            return status, resp
        with self.tranca:
            r = self._loja_pedido_por_id(pid)
            resp[chave] = self._loja_pedido(r, t) if chave == 'pedido' else self._presente_amigo_json(r)
            resp['barras'] = self._barras_publico(conta['id'], False)
            if 'saldo' in resp:
                resp['saldo'] = self._loja_saldo(conta['id'], conta, self._loja_save(conta['id']))
            if 'presentes' in resp:                     # o presente estornado devolve a vaga do dia
                resp['presentes'] = self._presentes_dados(conta['id'], t)
        if r['estado'] == 'estornado':
            if chave == 'presente':                     # a carta do presente que não entrou não fica no correio
                with self._escrita():
                    self.con.execute("DELETE FROM moderacao_cartas WHERE conta_id = ? AND assunto = ? AND criado_em = ? "
                                     "AND lida_em IS NULL", (alvo['id'], ASSUNTO_PRESENTE, r['criado_em']))
            extra = {k: v for k, v in resp.items() if k not in ('ok', 'repetido')}
            raise Recusa(409, 'a compra não pôde ser entregue (%s): nada foi cobrado'
                         % FRASE_DO_MOTIVO.get(r['motivo'], 'o jogo recusou a entrega'),
                         estornado=True, motivo=r['motivo'], **extra)
        if r['estado'] == 'entregue':
            resp['naHora'] = True
        else:
            resp[chave]['espera'] = ('juiz' if feito.get('falhou') else 'estado' if feito.get('semEstado')
                                     else 'luta' if pid in (feito.get('esperando') or []) else 'juiz')
        return status, resp

    def _loja_depois_da_luta(self, conta):
        """FORA da tranca (salas.py chama no fecho da sala): o que a loja segurou por causa da luta entra
        agora. Devolve a resposta da entrega quando algo entrou (com o estado novo), senão None."""
        try:
            with self.tranca:
                if self.con.execute("SELECT 1 FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado')",
                                    (conta['id'],)).fetchone() is None:
                    return None
        except sqlite3.Error:
            return None
        feito = self._loja_na_hora(conta)
        return feito if feito and feito.get('entregues') else None

    def _loja_abertos_para_o_jogo(self, cid):
        """Para o /api/eu (o jogo pergunta a cada 30 s): quantos pedidos esperam o jogo vir buscar. O que
        está preso por uma luta aberta não conta — o jogo buscaria a cada 30 s sem nada para trazer."""
        try:
            with self.tranca:
                linhas = self.con.execute("SELECT entrega FROM loja_pedidos WHERE conta_id = ? AND estado = 'pendente'",
                                          (cid,)).fetchall()
                if not linhas:
                    return 0
                if getattr(self, '_autoridade_ligada', lambda: False)() and self._loja_em_luta(cid, agora()):
                    linhas = [r for r in linhas if (_json(r['entrega']) or {}).get('tipo') not in TIPOS_DA_LUTA]
                return len(linhas)
        except sqlite3.Error:
            return 0

    def _loja_compra_grava(self, conta, corpo):
        sku, idem = corpo.get('sku'), corpo.get('idem')
        item = POR_SKU.get(sku) if isinstance(sku, str) else None
        if item is None:
            raise Recusa(400, 'produto desconhecido')
        if not isinstance(idem, str) or not RE_IDEM.match(idem):
            raise Recusa(400, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        cid, t, mestre = conta['id'], agora(), bool(conta['gm'])
        em_barras = item['moeda'] == 'barras'
        entrega = entrega_de(item)
        if item['tipo'] == 'pacote':                    # 04/10: as duas escolhas do Pacote de Boas-Vindas
            classe, aura = corpo.get('classe'), corpo.get('aura')
            if classe not in BOAS_VINDAS_CLASSES:
                raise Recusa(400, 'escolha o personagem do pacote: Xamã ou Bruxo')
            if aura not in AURAS_BOAS_VINDAS:
                raise Recusa(400, 'escolha a aura do pacote: Brasa, Maré, Raiz ou Vento')
            entrega = entrega_boas_vindas(classe, aura)
        # 04/10: o preço cobrado é o de AGORA no relógio do servidor (a oferta da semana, se o item estiver nela)
        preco_hoje = preco_de(item, t)
        # tudo numa transação de escrita: saldo, reserva, barras e limites lidos
        # com a trava entre processos pega — duas compras (até em dois
        # contêineres) não gastam o mesmo vintém nem a mesma barra
        with self._escrita():
            save = self._loja_save(cid)
            ja = self.con.execute("SELECT %s FROM %s WHERE p.conta_id = ? AND p.idem = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS),
                                  (cid, idem)).fetchone()
            if ja is not None:                          # o mesmo clique chegando de novo
                if ja['sku'] != sku or origem_do_pedido(ja) is not None:
                    raise Recusa(409, 'idem já usado em outro produto')
                return 200, {'ok': True, 'pedido': self._loja_pedido(ja, t), 'saldo': self._loja_saldo(cid, conta, save),
                             'barras': self._barras_publico(cid, False)}
            # sem save o servidor não sabe da carteira; com um crédito a caminho
            # (pacote pago, presente de vinténs), sabe de pelo menos isso. As
            # barras (13/09) moram aqui: o item pago em barras não precisa do save
            if save is None and not mestre and not em_barras and self._loja_a_caminho(cid) == 0:
                raise Recusa(409, 'o servidor ainda não viu seus vinténs: abra o jogo logado nesta conta '
                                  '(na conta Principal)')
            self._loja_confere_teto(cid, t)             # o teto de linhas vale para todo mundo, Mestre inclusive
            self._loja_confere_item(cid, item, save['progress'] if save else None, entrega)
            if not mestre:                              # o Mestre pula o saldo e os limites (bolsoSemFundo)
                self._loja_confere_limites(cid, item, t)
                if em_barras:
                    if self._barras_saldo(cid) < preco_hoje:
                        raise Recusa(409, 'barras de ouro insuficientes', barras=self._barras_publico(cid, False))
                else:
                    saldo = self._loja_saldo(cid, conta, save)
                    if saldo['disponivel'] < preco_hoje:
                        raise Recusa(409, 'vinténs insuficientes', saldo=saldo)
            # o pedido anda com preço em VINTÉNS (0 se pago em barras); as barras moram em loja_barras
            preco = 0 if mestre or em_barras else preco_hoje
            custo = 0 if mestre or not em_barras else preco_hoje
            ganho = item['qtd'] if item['tipo'] == 'barras' else 0
            pid = self._loja_cria_pedido(cid, sku, entrega, preco, idem, t)
            if custo or ganho:
                self.con.execute("INSERT INTO loja_barras(pedido_id, custo, ganho, criado_em) VALUES (?, ?, ?, ?)",
                                 (pid, custo, ganho, t))
            if custo:                                   # as barras saem AGORA, na transação que cria o pedido
                self.barras_move(cid, -custo, 'troca-vintens' if item['tipo'] == 'vintens' else 'loja',
                                 'pedido:%d' % pid, 'pedido:%d:custo' % pid, t)
            r = self._loja_pedido_por_id(pid)
            evento = {'id': pid, 'sku': sku, 'preco': preco}
            if custo:
                evento['barras'] = custo
            if preco_hoje != item['preco']:
                evento['oferta'] = semana_de(t)         # 04/10: comprado na oferta desta semana
            self._evento(cid, 'loja-compra', evento)
            saldo = self._loja_saldo(cid, conta, save)
            barras = self._barras_publico(cid, False)
        log.info("loja: #%d comprou %s por %s (pedido %d)", cid, sku,
                 '%d barras' % custo if custo else '%d vinténs' % preco, pid)
        return 201, {'ok': True, 'pedido': self._loja_pedido(r, t), 'saldo': saldo, 'barras': barras}

    def _loja_cria_pedido(self, cid, sku, entrega, preco, idem, t):
        """Dentro da _escrita: a linha do pedido. A AURA nasce 'entregue' (04/10): ela não põe nada no save
        do jogo — a posse é o próprio pedido (_auras) —, então não há por que esperar o jogo abrir nem
        ocupar uma das vagas de pedido aberto. Tudo o mais nasce 'pendente', como sempre."""
        pronto = entrega.get('tipo') == 'aura'
        cur = self.con.execute(
            "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em, fechado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, sku, json.dumps(entrega, ensure_ascii=False), preco, 'entregue' if pronto else 'pendente', idem, t,
             t if pronto else None))
        return cur.lastrowid

    # -- as auras (04/10) -----------------------------------------------------------------------------
    def _auras(self, cid, so_compradas=False):
        """As auras da conta: as dos pedidos VIVOS (pendente, retirado, entregue) de aura — comprados,
        presenteados pelo Mestre ou por um amigo — e a que veio num Pacote de Boas-Vindas. Sem tabela de
        posse: pedido cancelado ou estornado deixa de contar sozinho.
        O MESTRE TEM TODAS (04/10, o dono: "o super admin tem que ter todas auras liberadas"): a conta
        marcada (contas.gm = 1) possui as cinco sem comprar — a ficha do jogo mostra todas, a escolha é
        aceita e o Relé a carimba como a de qualquer um. Vale enquanto a marca estiver ligada; tirada a
        marca, a ficha volta a mostrar só o que foi comprado (a linha da escolhida fica até a próxima escolha).
        `so_compradas`: sem esse atalho — é o que a COMPRA confere, para o Mestre poder seguir comprando
        (e testando) a aura e o Pacote como qualquer conta."""
        if not so_compradas:
            marca = self.con.execute("SELECT gm FROM contas WHERE id = ?", (cid,)).fetchone()
            if marca is not None and marca['gm']:
                return set(AURAS) | set(AURAS_MESTRE)
        tem = set()
        for r in self.con.execute(
                "SELECT entrega FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'entregue') "
                "AND (sku LIKE 'aura-%' OR sku = ?)", (cid, BOAS_VINDAS_SKU)):
            ent = _json(r['entrega']) or {}
            cor = ent.get('alvo') if ent.get('tipo') == 'aura' else ent.get('aura')
            if cor in AURAS:
                tem.add(cor)
        return tem

    def _aura_poda(self, cid):
        """Dentro da _escrita: a aura escolhida que a conta não tem mais (o pedido dela foi cancelado ou
        estornado) sai — o Relé lê a tabela sem refazer a conta da posse."""
        r = self.con.execute("SELECT aura FROM aura_escolhida WHERE conta_id = ?", (cid,)).fetchone()
        if r is not None and r['aura'] not in self._auras(cid):
            self.con.execute("DELETE FROM aura_escolhida WHERE conta_id = ?", (cid,))

    # -- as molduras premium (08/10), no molde das auras ---------------------------------------------------
    def _molduras(self, cid):
        """As molduras premium da conta: os pedidos VIVOS de 'moldura-*'. O Mestre tem todas."""
        marca = self.con.execute("SELECT gm FROM contas WHERE id = ?", (cid,)).fetchone()
        if marca is not None and marca['gm']:
            return set(MOLDURAS_LOJA) | set(MOLDURAS_MESTRE)
        tem = set()
        for r in self.con.execute(
                "SELECT entrega FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'entregue') "
                "AND sku LIKE 'moldura-%'", (cid,)):
            ent = _json(r['entrega']) or {}
            if ent.get('tipo') == 'moldura' and ent.get('alvo') in MOLDURAS_LOJA:
                tem.add(ent['alvo'])
        return tem

    def _moldura_poda(self, cid):
        try:
            r = self.con.execute("SELECT moldura FROM moldura_escolhida WHERE conta_id = ?", (cid,)).fetchone()
        except sqlite3.Error:
            return
        if r is not None and r['moldura'] not in self._molduras(cid):
            self.con.execute("DELETE FROM moldura_escolhida WHERE conta_id = ?", (cid,))

    def _molduras_publico(self, cid):
        tem = self._molduras(cid)
        r = self.con.execute("SELECT moldura FROM moldura_escolhida WHERE conta_id = ?", (cid,)).fetchone()
        do_mestre = [m for m in MOLDURAS_MESTRE if m in tem]
        return {'tem': do_mestre + [m for m in MOLDURAS_LOJA if m in tem],
                'escolhida': r['moldura'] if r is not None and r['moldura'] in tem else None,
                'todas': [{'id': m, 'sku': None, 'nome': MOLDURA_MESTRE_NOME[m]} for m in do_mestre] +
                         [{'id': m, 'sku': 'moldura-' + m, 'nome': MOLDURA_NOME[m]} for m in MOLDURAS_LOJA]}

    # -- GET /api/loja/moldura · POST /api/loja/moldura {moldura: id | null} ------------------------------
    def loja_moldura_ver(self, conta, corpo):
        with self.tranca:
            return 200, {'ok': True, 'molduras': self._molduras_publico(conta['id'])}

    def loja_moldura_escolher(self, conta, corpo):
        """A moldura premium na plaquinha: uma das que a conta TEM, ou null ('auto': a do título)."""
        mid, cid, t = corpo.get('moldura'), conta['id'], agora()
        if mid in (None, '', 'auto'):
            mid = None
        elif mid not in MOLDURAS_LOJA and mid not in MOLDURAS_MESTRE:
            raise Recusa(400, 'moldura desconhecida')
        with self._escrita():
            if mid is None:
                self.con.execute("DELETE FROM moldura_escolhida WHERE conta_id = ?", (cid,))
            else:
                if mid not in self._molduras(cid):
                    raise Recusa(409, 'você ainda não tem essa moldura')
                self.con.execute("INSERT INTO moldura_escolhida(conta_id, moldura, atualizado_em) VALUES (?, ?, ?) "
                                 "ON CONFLICT(conta_id) DO UPDATE SET moldura = excluded.moldura, "
                                 "atualizado_em = excluded.atualizado_em", (cid, mid, t))
            molduras = self._molduras_publico(cid)
        return 200, {'ok': True, 'molduras': molduras}

    def _auras_publico(self, cid):
        tem = self._auras(cid)
        r = self.con.execute("SELECT aura FROM aura_escolhida WHERE conta_id = ?", (cid,)).fetchone()
        do_mestre = [a for a in AURAS_MESTRE if a in tem]       # só aparece para quem a tem: o Mestre
        return {'tem': do_mestre + [a for a in AURAS if a in tem],
                'escolhida': r['aura'] if r is not None and r['aura'] in tem else None,
                'todas': [{'cor': a, 'sku': None, 'nome': AURA_MESTRE_NOME[a]} for a in do_mestre] +
                         [{'cor': a, 'sku': 'aura-' + a, 'nome': POR_SKU['aura-' + a]['nome']} for a in AURAS]}

    # -- GET /api/loja/aura · POST /api/loja/aura {aura: cor | null} ----------------------------------------
    def loja_aura_ver(self, conta, corpo):
        with self.tranca:
            return 200, {'ok': True, 'auras': self._auras_publico(conta['id'])}

    def loja_aura_escolher(self, conta, corpo):
        """A aura que a conta veste na praça: uma das que ela TEM, ou null (desligada). Os outros jogadores
        passam a ver na próxima conferência do Relé (até ~2 min) ou quando ela entrar de novo na praça."""
        aura, cid, t = corpo.get('aura'), conta['id'], agora()
        if aura is not None and aura not in AURAS and aura not in AURAS_MESTRE:
            raise Recusa(400, 'aura desconhecida')
        with self._escrita():
            if aura is None:
                self.con.execute("DELETE FROM aura_escolhida WHERE conta_id = ?", (cid,))
            else:
                if aura not in self._auras(cid):
                    raise Recusa(409, 'você ainda não tem essa aura')
                self.con.execute("INSERT INTO aura_escolhida(conta_id, aura, atualizado_em) VALUES (?, ?, ?) "
                                 "ON CONFLICT(conta_id) DO UPDATE SET aura = excluded.aura, "
                                 "atualizado_em = excluded.atualizado_em", (cid, aura, t))
            auras = self._auras_publico(cid)
        return 200, {'ok': True, 'auras': auras}

    # -- o Pacote de Boas-Vindas e a vitrine do jogo (04/10) ---------------------------------------------
    def _boas_vindas_publico(self, cid, progress, t):
        """{disponivel, comprado, preco, precoCheio, classes:[as que ainda dá para escolher]} — `disponivel`
        é o que acende o destaque no site e a chamada no jogo: a conta nunca comprou o pacote e ainda lhe
        falta pelo menos uma das duas classes."""
        usado = self._loja_limites(cid, t)[BOAS_VINDAS_SKU]['usados'] > 0
        classes = []
        for c in BOAS_VINDAS_CLASSES:
            try:
                self._loja_confere_item(cid, POR_SKU['classe-' + c], progress)
                classes.append(c)
            except Recusa:
                pass
        return {'disponivel': bool(not usado and classes), 'comprado': usado, 'preco': BOAS_VINDAS_PRECO,
                'precoCheio': BOAS_VINDAS_CHEIO, 'classes': classes}

    def loja_vitrine(self, conta, corpo):
        """GET /api/loja/vitrine — o que o JOGO precisa para a chamada da loja e a ficha da aura, num pedido
        só: as ofertas da semana com o fim (a contagem regressiva), o Pacote de Boas-Vindas e as auras."""
        cid, t = conta['id'], agora()
        with self.tranca:
            save = self._loja_save(cid)
            boas = self._boas_vindas_publico(cid, save['progress'] if save else None, t)
            auras = self._auras_publico(cid)
            molduras = self._molduras_publico(cid)       # 08/10
            barras = self._barras_saldo(cid)
        return 200, {'ok': True, 'agora': t, 'ofertas': ofertas_publico(t), 'boasVindas': boas, 'auras': auras,
                     'molduras': molduras, 'barras': {'saldo': barras}}

    # -- o presente a um amigo (04/10) -----------------------------------------------------------------
    def _nome_publico(self, cid):
        """O nome que a praça conhece (o do placar; sem ele, o da conta)."""
        r = self.con.execute("SELECT " + NOME_PUBLICO_SQL + " FROM contas c "
                             "LEFT JOIN resumos r ON r.conta_id = c.id WHERE c.id = ?", (cid,)).fetchone()
        return r[0] if r is not None else '#%d' % cid

    def _presentes_dados(self, cid, t):
        """Os presentes que a conta deu nas últimas 24 h e quando a próxima vaga abre."""
        em = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_amigos WHERE de = ? AND criado_em > ? ORDER BY criado_em", (cid, t - 86400))]
        cheio = len(em) >= PRESENTES_AMIGO_DIA
        return {'dados': len(em), 'max': PRESENTES_AMIGO_DIA,
                'liberaEm': em[len(em) - PRESENTES_AMIGO_DIA] + 86400 if cheio else None}

    def _presente_destino(self, cid, nome):
        """A conta de quem recebe, pelo nome (o do placar ou o da conta, como na lista de amigos): tem de
        existir, não estar banida nem ser a lápide de uma conta excluída, e não ser quem dá."""
        if not isinstance(nome, str) or not nome.strip():
            raise Recusa(400, 'diga o nome de quem vai receber')
        nome = nome.strip()[:60]
        achados = self.con.execute(
            "SELECT c.id, c.banido FROM contas c LEFT JOIN resumos r ON r.conta_id = c.id WHERE "
            "(r.nome = ? COLLATE NOCASE OR ((r.nome IS NULL OR r.nome = '') AND c.nome = ? COLLATE NOCASE)) "
            "AND c.id NOT IN (SELECT conta_id FROM contas_excluidas) LIMIT 3", (nome, nome)).fetchall()
        if not achados:
            raise Recusa(404, 'ninguém com esse nome')
        outros = [a for a in achados if a['id'] != cid]
        if not outros:
            raise Recusa(400, 'você não pode presentear a si mesmo')
        if len(outros) > 1:
            raise Recusa(409, 'há mais de uma pessoa com esse nome — peça o nome da conta dela')
        if outros[0]['banido']:
            raise Recusa(409, 'essa conta não pode receber presentes')
        return outros[0]['id']

    def loja_presentear(self, conta, corpo):
        """O presente grava o pedido na conta de quem recebe (_loja_presente_grava) e, com a autoridade
        ligada, o servidor já o entrega lá (04/10: o presente segue a mesma regra da compra)."""
        status, resp = self._loja_presente_grava(conta, corpo)
        return self._loja_fecha_na_hora(conta, status, resp, 'presente')

    def _loja_presente_grava(self, conta, corpo):
        """POST /api/loja/presentear {sku, nome, idem}: quem dá paga as barras (o preço de hoje, com a
        oferta da semana); o pedido nasce na conta de quem recebe e anda pela fila de sempre, com uma carta
        no correio dizendo quem mandou. AS TRAVAS: moeda e o Pacote de Boas-Vindas não se presenteiam; a
        conta de quem recebe existe, não está banida nem excluída e não é a de quem dá; a regra do produto e
        o limite dele valem NO DESTINATÁRIO (a classe que ele já tem, a aura que já é dele, a Reescrita do
        mês); PRESENTES_AMIGO_DIA por dia por quem dá; PRESENTES_AMIGO_ABERTOS esperando em quem recebe.
        O `idem` é de quem dá: o mesmo clique de novo devolve o mesmo presente, cobrado uma vez só."""
        sku, idem = corpo.get('sku'), corpo.get('idem')
        item = POR_SKU.get(sku) if isinstance(sku, str) else None
        if item is None:
            raise Recusa(400, 'produto desconhecido')
        if item['tipo'] in FORA_DO_PRESENTE or item['moeda'] != 'barras':
            raise Recusa(400, 'esse produto não pode ser dado de presente')
        if not isinstance(idem, str) or not RE_IDEM.match(idem):
            raise Recusa(400, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        cid, t = conta['id'], agora()
        preco_hoje = preco_de(item, t)
        with self._escrita():
            ja = self.con.execute(
                "SELECT %s FROM %s WHERE am.de = ? AND am.idem = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid, idem)).fetchone()
            if ja is not None:                          # o mesmo clique chegando de novo: nada é cobrado outra vez
                if ja['sku'] != sku:
                    raise Recusa(409, 'idem já usado em outro presente')
                return 200, {'ok': True, 'presente': self._presente_amigo_json(ja), 'repetido': True,
                             'barras': self._barras_publico(cid, False), 'presentes': self._presentes_dados(cid, t)}
            alvo = self._presente_destino(cid, corpo.get('nome'))
            dados = self._presentes_dados(cid, t)
            if dados['dados'] >= PRESENTES_AMIGO_DIA:
                raise Recusa(429, 'presentes demais nas últimas 24 h (%d)' % PRESENTES_AMIGO_DIA,
                             liberaEm=dados['liberaEm'])
            esperando = self.con.execute(
                "SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') "
                "AND id IN (SELECT pedido_id FROM loja_amigos)", (alvo,)).fetchone()[0]
            if esperando >= PRESENTES_AMIGO_ABERTOS:
                raise Recusa(429, 'essa pessoa já tem presentes demais esperando para entrar')
            save = self._loja_save(alvo)
            try:                                        # a regra do produto e o limite dele, em QUEM RECEBE
                self._loja_confere_item(alvo, item, save['progress'] if save else None)
                if item['limite'] is not None:
                    lim = self._loja_limites(alvo, t)[item['limite']['grupo']]
                    if lim['usados'] >= lim['max']:
                        raise Recusa(409, 'o limite deste produto já foi usado')
            except Recusa as e:
                raise Recusa(409, 'essa pessoa não pode receber este presente: %s' % e.erro)
            if self._barras_saldo(cid) < preco_hoje:
                raise Recusa(409, 'barras de ouro insuficientes', barras=self._barras_publico(cid, False))
            de_nome = self._nome_publico(cid)
            pid = self._loja_cria_pedido(alvo, sku, entrega_de(item), 0, None, t)
            self.con.execute("INSERT INTO loja_barras(pedido_id, custo, ganho, criado_em) VALUES (?, ?, 0, ?)",
                             (pid, preco_hoje, t))
            self.con.execute("INSERT INTO loja_amigos(pedido_id, de, de_nome, idem, criado_em) VALUES (?, ?, ?, ?, ?)",
                             (pid, cid, de_nome, idem, t))
            self.barras_move(cid, -preco_hoje, 'loja', 'pedido:%d' % pid, 'pedido:%d:custo' % pid, t)
            # a carta no correio do jogo (a mesma caixa das cartas da Equipe): diz quem mandou e o quê
            # 04/10: com a autoridade o presente entra na conta na mesma chamada (_loja_fecha_na_hora)
            chega = ('Já é sua: escolha na ficha do Personagem.' if item['tipo'] == 'aura'
                     else 'Já está na sua conta — ou chega assim que a luta em andamento terminar.'
                     if getattr(self, '_autoridade_ligada', lambda: False)()
                     else 'Chega sozinho ao jogo, logado nesta conta.')
            self.con.execute("INSERT INTO moderacao_cartas(conta_id, assunto, texto, criado_em) VALUES (?, ?, ?, ?)",
                             (alvo, ASSUNTO_PRESENTE, '%s te mandou um presente da loja: %s. %s'
                              % (de_nome, item['nome'], chega), t))
            # a trilha dos dois lados (a ficha do Mestre lê o extrato das barras, e os eventos ficam no banco)
            self._evento(cid, 'loja-presenteou', {'id': pid, 'sku': sku, 'barras': preco_hoje, 'para': alvo})
            self._evento(alvo, 'loja-presente-amigo', {'id': pid, 'sku': sku, 'de': cid})
            r = self._loja_pedido_por_id(pid)
            presente = self._presente_amigo_json(r)
            barras = self._barras_publico(cid, False)
            dados = self._presentes_dados(cid, t)
        log.info("loja: #%d presenteou #%d com %s por %d barras (pedido %d)", cid, alvo, sku, preco_hoje, pid)
        return 201, {'ok': True, 'presente': presente, 'barras': barras, 'presentes': dados}

    def _presente_amigo_json(self, r):
        """O presente como QUEM DEU o vê: de quem recebeu, só o nome que a praça já mostra."""
        return {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], _json(r['entrega'])),
                'para': self._nome_publico(r['conta_id']), 'barras': r['barras_custo'] or 0,
                'estado': r['estado'], 'criadoEm': r['criado_em']}

    # -- POST /api/loja/cancelar ------------------------------------------------------------------
    def loja_cancelar(self, conta, corpo):
        pid = corpo.get('id')
        if not _id_valido(pid):
            raise Recusa(400, 'id precisa ser o número do pedido')
        cid, t = conta['id'], agora()
        with self._escrita():
            r = self.con.execute("SELECT %s FROM %s WHERE p.id = ? AND p.conta_id = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS),
                                 (pid, cid)).fetchone()
            if r is None:                               # inclusive o de outra conta
                raise Recusa(404, 'pedido não encontrado')
            origem = origem_do_pedido(r)
            if origem == 'pagamento':
                raise Recusa(409, 'vinténs de pacote não se cancelam: eles entram sozinhos na conta')
            if origem == 'presente':
                raise Recusa(409, 'presente do Mestre: só o Mestre cancela')
            if origem == 'amigo':                       # as barras são de quem deu: quem recebe não as "cancela"
                raise Recusa(409, 'presente de um amigo não se cancela: ele entra sozinho na conta')
            if r['estado'] in ('entregue', 'estornado', 'cancelado'):
                raise Recusa(409, 'pedido já fechado')
            if not self._loja_cancelavel(r, t):
                raise Recusa(409, 'já está a caminho do jogo; espere a entrega ou 24 h')
            self.con.execute("UPDATE loja_pedidos SET estado = 'cancelado', fechado_em = ? WHERE id = ?", (t, pid))
            self._barras_do_pedido(cid, pid, 'cancelado', t)     # 13/09: as barras do custo voltam
            self._evento(cid, 'loja-cancela', {'id': pid, 'sku': r['sku'], 'de': r['estado']})
            r = self._loja_pedido_por_id(pid)
            saldo = self._loja_saldo(cid, conta, self._loja_save(cid))
            barras = self._barras_publico(cid, False)
        return 200, {'ok': True, 'pedido': self._loja_pedido(r, t), 'saldo': saldo, 'barras': barras}

    # -- POST /api/loja/retirar (o jogo) -------------------------------------------------------------
    def loja_retirar(self, conta, corpo):
        """Os pedidos abertos, em ordem de id (o crédito, que nasce na aprovação,
        chega antes de qualquer compra feita com ele). `origem` só no presente e
        no crédito de pacote; `entrega.agora` (o relógio do SERVIDOR) só no bônus
        de XP: o prazo conta da entrega. Pedido retirado que volta numa retirada
        seguinte leva o `agora` novo (o jogo aplica uma vez só: anota o id).

        13/09 (docs/SEGURANCA.md §4.5): com a autoridade ligada, o servidor ENTREGA
        aqui mesmo (_loja_retirar_no_servidor) e o PUT não confirma mais nada."""
        # 02/10: a semana do Eco que acabou fecha aqui também — o jogo retira a cada 5 min, então o prêmio
        # chega sem ninguém precisar abrir a ficha do Eco nem o ranking do site (supremo.py)
        fecha_eco = getattr(self, '_supremo_fecha_vencidas', None)
        if fecha_eco is not None:
            fecha_eco()
        if getattr(self, '_autoridade_ligada', lambda: False)():
            return self._loja_retirar_no_servidor(conta)
        cid, t = conta['id'], agora()
        with self._escrita():
            linhas = self.con.execute(
                "SELECT %s FROM %s WHERE p.conta_id = ? AND p.estado IN ('pendente', 'retirado') ORDER BY p.id"
                % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid,)).fetchall()
            self.con.execute("UPDATE loja_pedidos SET estado = 'retirado', retirado_em = ? "
                             "WHERE conta_id = ? AND estado = 'pendente'", (t, cid))
        pedidos = []
        for r in linhas:
            entrega = _json(r['entrega']) or {}
            if entrega.get('tipo') == 'bonus-xp':
                entrega['agora'] = t
            p = {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], entrega, r['credito_vintens']),
                 'preco': r['preco'], 'entrega': entrega}
            origem = origem_do_pedido(r)
            if origem is not None:
                p['origem'] = origem
            if origem == 'amigo':
                p['de'] = r['amigo_nome']
            pedidos.append(p)
        return 200, {'ok': True, 'pedidos': pedidos}

    # -- a entrega no servidor (13/09, a autoridade) ------------------------------------------------------
    def _loja_estorna(self, cid, pid, motivo, versao, t):
        """Dentro de _escrita: o pedido aberto que o juiz recusou vira 'estornado' (a vaga e
        a reserva voltam); crédito de pacote pago é reemitido como antes (pagamento.py).
        Devolve (estornou?, id do crédito reemitido ou None)."""
        n = self.con.execute(
            "UPDATE loja_pedidos SET estado = 'estornado', motivo = ?, fechado_em = ?, versao_save = ? "
            "WHERE conta_id = ? AND id = ? AND estado IN ('pendente', 'retirado')", (motivo, t, versao, cid, pid)).rowcount
        if not n:
            return False, None
        self._barras_do_pedido(cid, pid, 'estornado', t)         # 13/09: as barras do custo voltam
        self._evento(cid, 'loja-estorno', {'ids': [pid], 'versao': versao, 'motivo': motivo})
        reemite = getattr(self, '_pagamento_credito_recusado', None)
        return True, (reemite(cid, pid, motivo, versao, t) if reemite is not None else None)

    def _loja_anota_corrente(self, cid, entregues, estado, saida, na_hora, t):
        """Dentro da _escrita que gravou o estado: um elo em `moderacao_entregas` (a mesma corrente das
        entregas do Mestre). É ela que deixa a op que o jogador mandou ANTES de a compra entrar subir por
        cima dela em vez de cair no 409 (salas.py, economia_op, `_rebase_entregas`): a entrega da loja só
        acrescenta. `avisar` só na entrega NA HORA — o jogo aberto fica sabendo pelo /api/eu, adota o estado
        sem recarregar e mostra "Chegou da loja: …"; quando é o próprio jogo que busca, ele já avisa."""
        antes = saida.get('hashAntes') if isinstance(saida.get('hashAntes'), str) else estado['hash']
        if not isinstance(saida.get('hash'), str) or saida['hash'] == antes:
            return
        nomes = []
        for r, e in entregues:
            nome = nome_do_pedido(r['sku'], e, r['credito_vintens'])
            nomes.append('%s (presente de %s)' % (nome, r['amigo_nome']) if origem_do_pedido(r) == 'amigo' else nome)
        try:
            self.con.execute(
                "INSERT INTO moderacao_entregas(conta_id, mestre_id, tipo, texto, hash_antes, hash_depois, avisar, criado_em) "
                "VALUES (?, NULL, 'loja', ?, ?, ?, ?, ?)",
                (cid, ', '.join(nomes)[:400], antes, saida['hash'], 1 if na_hora and nomes else 0, t))
        except sqlite3.Error:                           # um banco de antes da tabela: sem corrente, o 409 de sempre
            pass

    def _loja_retirar_no_servidor(self, conta, na_hora=False):
        """Os pedidos abertos, em ordem de id, entregues pelo juiz (op interna
        'lojaEntregar', com a entrega e o preço CONGELADOS no banco — nada do
        cliente) no estado que o servidor guarda; 'entregue' na mesma transação
        que grava o estado. O que o juiz recusa vira 'estornado' com o motivo:
        a recusa de regra (422) sai do lote e o resto é pedido de novo; a
        recusa que volta como resultado ({ok:false, motivo}) fecha junto com as
        entregas. Sem estado no servidor ainda, nada sai: os pedidos esperam o
        primeiro save da conta.

        04/10: `na_hora` = quem chama é a própria compra (_loja_na_hora), não o jogo. E a LUTA ABERTA: o
        que mexe no grupo que o juiz refaz no fim dela (TIPOS_DA_LUTA: a classe, e o Pacote que a traz)
        espera a luta terminar — sai em `esperando`, o pedido segue aberto, e o resto é entregue já."""
        cid = conta['id']
        estornados, reemitidos, esperando = [], [], []
        for _ in range(OPS_LOJA + 3):       # cada volta entrega, estorna uma recusada ou refaz um estado que mudou
            t = agora()
            with self.tranca:
                estado = self._estado_ler(cid)
                if estado is None:
                    return 200, {'ok': True, 'pedidos': [], 'entregues': [], 'estornados': estornados,
                                 'esperando': [],
                                 'semEstado': True, 'versao': 0, 'hash': None, 'progress': None, 'db': None}
                linhas = self.con.execute(
                    "SELECT %s FROM %s WHERE p.conta_id = ? AND p.estado IN ('pendente', 'retirado') ORDER BY p.id LIMIT ?"
                    % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid, OPS_LOJA)).fetchall()
                luta = self._loja_em_luta(cid, t)
            da_luta = {r['id'] for r in linhas if (_json(r['entrega']) or {}).get('tipo') in TIPOS_DA_LUTA}
            if luta:
                esperando = sorted(da_luta)
                linhas = [r for r in linhas if r['id'] not in da_luta]
            if not linhas:
                return 200, {'ok': True, 'pedidos': [], 'entregues': [], 'estornados': estornados,
                             'esperando': esperando,
                             'reemitidos': reemitidos, 'versao': estado['versao'], 'hash': estado['hash'],
                             'progress': estado['progress'], 'db': estado['db']}
            entregas = []
            for r in linhas:
                entrega = _json(r['entrega']) or {}
                if entrega.get('tipo') == 'bonus-xp':
                    entrega['agora'] = t                # o prazo do bônus conta da entrega, no relógio do servidor
                entregas.append(entrega)
            ops = [{'nome': 'lojaEntregar', 'args': {'pedido': {'id': r['id'], 'entrega': e, 'preco': r['preco']}}}
                   for r, e in zip(linhas, entregas)]
            try:
                saida = self._juiz_op(conta, estado, ops, interno=True)
            except Recusa as e:
                i = e.extra.get('indice')
                if e.status != 422 or not isinstance(i, int) or not 0 <= i < len(linhas):
                    raise
                motivo = e.extra.get('motivo')
                with self._escrita():
                    feito, novo = self._loja_estorna(cid, linhas[i]['id'], motivo if motivo in MOTIVOS else 'recusado',
                                                     estado['versao'], t)
                if feito:
                    estornados.append(linhas[i]['id'])
                    if novo is not None:
                        reemitidos.append(novo)
                continue
            aplicadas = set(le_anotacao(saida['db'])[0])
            entregues, recusados = [], []
            for r, e, res in zip(linhas, entregas, saida.get('resultados') or []):
                motivo = res.get('motivo') if isinstance(res, dict) else None
                if isinstance(res, dict) and res.get('ok') is True:
                    entregues.append((r, e))
                elif motivo == 'ja':                    # o estado já tinha aplicado (a anistia do corte)
                    if r['id'] in aplicadas:
                        entregues.append((r, e))
                    else:
                        recusados.append((r, 'recusado'))
                elif motivo in ('sem-jogo', 'recarregando'):
                    raise Recusa(503, 'o juiz não conseguiu entregar agora — tente de novo em instantes')
                else:
                    recusados.append((r, motivo if motivo in MOTIVOS else 'recusado'))
            if len(entregues) + len(recusados) != len(linhas):
                raise Recusa(503, 'o juiz respondeu torto na entrega — tente de novo em instantes')
            ids = [r['id'] for r in linhas]
            try:
                with self._escrita():
                    abertos = {x[0] for x in self.con.execute(
                        "SELECT id FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') AND id IN (%s)"
                        % ','.join('?' * len(ids)), [cid] + ids)}
                    if abertos != set(ids):             # um cancelamento (ou o estorno do pagamento) no meio
                        raise EstadoMudou()
                    # a luta pode ter aberto enquanto o juiz trabalhava (a abertura também escreve aqui dentro)
                    if not luta and da_luta and self._loja_em_luta(cid, t):
                        raise EstadoMudou()
                    nova, db = self._estado_grava(conta, estado, saida, t)
                    self._loja_anota_corrente(cid, entregues, estado, saida, na_hora, t)
                    if entregues:
                        feitos = [r['id'] for r, _ in entregues]
                        self.con.execute(
                            "UPDATE loja_pedidos SET estado = 'entregue', retirado_em = COALESCE(retirado_em, ?), "
                            "fechado_em = ?, versao_save = ? WHERE conta_id = ? AND id IN (%s)"
                            % ','.join('?' * len(feitos)), [t, t, nova, cid] + feitos)
                        for pid in feitos:              # 13/09: vinténs → barras: as barras entram só agora
                            self._barras_do_pedido(cid, pid, 'entregue', t)
                        self._evento(cid, 'loja-entregue', {'ids': feitos, 'versao': nova, 'servidor': True})
                    for r, motivo in recusados:
                        feito, novo = self._loja_estorna(cid, r['id'], motivo, nova, t)
                        if feito:
                            estornados.append(r['id'])
                            if novo is not None:
                                reemitidos.append(novo)
            except EstadoMudou:
                continue
            pedidos = []
            for r, e in entregues:
                p = {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], e, r['credito_vintens']),
                     'preco': r['preco'], 'entrega': e}
                origem = origem_do_pedido(r)
                if origem is not None:
                    p['origem'] = origem
                if origem == 'amigo':
                    p['de'] = r['amigo_nome']
                pedidos.append(p)
            log.info("loja: #%d — %d pedidos entregues no servidor, %d estornados", cid, len(pedidos), len(estornados))
            # `pedidos` são os JÁ ENTREGUES (aplicado=true): o cliente adota progress/db, não aplica de novo
            return 200, {'ok': True, 'aplicado': True, 'pedidos': pedidos, 'entregues': [p['id'] for p in pedidos],
                         'estornados': estornados, 'reemitidos': reemitidos, 'esperando': esperando,
                         'versao': nova, 'hash': saida['hash'],
                         'progress': saida['progress'], 'db': db}
        raise Recusa(409, 'o estado da conta mudou no meio — tente de novo')

    # -- os créditos de vinténs (pagamento.py e mestre.py chamam) ----------------------------------------
    def credita(self, cid, sku, vintens, origem, idem, mp_id, t):
        """Dentro da _escrita de quem chama: um crédito de `vintens` para a conta —
        o pedido de preço 0 (entrega {tipo:'vintens', alvo:'carteira', qtd}) e a
        linha em loja_creditos. Devolve o id do pedido."""
        cur = self.con.execute(
            "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
            "VALUES (?, ?, ?, 0, 'pendente', ?, ?)",
            (cid, sku, json.dumps({'tipo': 'vintens', 'alvo': 'carteira', 'qtd': vintens}), idem, t))
        self.con.execute("INSERT INTO loja_creditos(pedido_id, vintens, origem, mp_id, criado_em) VALUES (?, ?, ?, ?, ?)",
                         (cur.lastrowid, vintens, origem, mp_id, t))
        return cur.lastrowid

    # -- dentro do salvar (PUT /api/save) -------------------------------------------------------------
    def _loja_confirma(self, cid, db, nova, t):
        """Chamada no trecho "só escrita" do salvar, na mesma transação do
        save: o que o save diz que aplicou vira 'entregue'; o que recusou,
        'estornado'. NUNCA recusa um save. Id de outra conta não casa com o
        filtro conta_id; pedido já fechado fica como está. Crédito de PACOTE
        recusado é reemitido (pagamento.py: até 3 vezes, depois vira alerta)."""
        aplicadas, recusadas = le_anotacao(db)
        entregues, estornados, reemitidos = [], [], []
        if aplicadas:
            achados = self.con.execute(
                "SELECT id, estado FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'cancelado') "
                "AND id IN (%s)" % ','.join('?' * len(aplicadas)), [cid] + aplicadas).fetchall()
            if achados:
                entregues = sorted(r['id'] for r in achados)
                self.con.execute(
                    "UPDATE loja_pedidos SET estado = 'entregue', fechado_em = ?, versao_save = ? "
                    "WHERE conta_id = ? AND id IN (%s)" % ','.join('?' * len(entregues)), [t, nova, cid] + entregues)
                self._evento(cid, 'loja-entregue', {'ids': entregues, 'versao': nova})
                for pid in entregues:                   # 13/09: as barras do ganho (e a recobra do cancelado tardio)
                    self._barras_do_pedido(cid, pid, 'entregue', t)
                for r in achados:
                    if r['estado'] == 'cancelado':      # o jogo aplicou antes de saber do cancelamento
                        self._evento(cid, 'loja-cancelamento-tardio', {'id': r['id'], 'versao': nova})
                        tardio = getattr(self, '_pagamento_entregue_tardio', None)
                        if tardio is not None:
                            tardio(cid, r['id'], nova, t)
        aplicada = set(aplicadas)
        reemite = getattr(self, '_pagamento_credito_recusado', None)
        for pid, motivo in recusadas:
            if pid in aplicada:                         # nas duas listas: vale a entrega
                continue
            n = self.con.execute(
                "UPDATE loja_pedidos SET estado = 'estornado', motivo = ?, fechado_em = ?, versao_save = ? "
                "WHERE conta_id = ? AND id = ? AND estado IN ('pendente', 'retirado')",
                (motivo, t, nova, cid, pid)).rowcount
            if n:
                estornados.append(pid)
                self._barras_do_pedido(cid, pid, 'estornado', t)
                if reemite is not None:
                    novo = reemite(cid, pid, motivo, nova, t)
                    if novo is not None:
                        reemitidos.append(novo)
        if estornados:
            self._evento(cid, 'loja-estorno', {'ids': estornados, 'versao': nova})
        saida = {'entregues': entregues, 'estornados': estornados}
        if reemitidos:                                  # só quando houve: o contrato antigo segue igual
            saida['reemitidos'] = reemitidos
        return saida
