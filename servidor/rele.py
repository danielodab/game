#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O Relé — o carteiro da Rede do SOTERRA (fase 2 da vida online).

    python rele.py [--host 127.0.0.1] [--porta 8791] [--banco dados/soterra.db]

O QUE ELE É: o carteiro entre os jogadores. Até 10/09 era burro de propósito
— cada mensagem ia a TODOS os outros, a semântica do BroadcastChannel que a
Rede (js/core/rede.js) usa entre abas. Com N na praça isso dá ~N²/2 envios
por segundo só de pulso (500 jogadores = 125 mil/s), e a praça só desenha os
20 fantasmas mais próximos (Hub.TETO_FANTASMAS). Agora ele ABRE o envelope e
entrega a quem precisa — sem mudar o protocolo (o texto repassado é o mesmo
que chegou; cliente antigo em cache continua falando com ele):

  - o que não é JSON (objeto com `t` e `de`) de até 8 KB é descartado;
  - por conexão ele guarda o id (o primeiro `de`; outro `de` na mesma
    conexão é falsificação e cai), a sala e a última posição;
  - DIRIGIDA (tem `para`: o oi/eco da apresentação): só para o destino, se
    ele estiver ligado aqui; senão, à sala. Os DIRIGIDOS de verdade (11/09:
    sussurro, grupo, duelo, batalha, troca e guilda) NUNCA recuam: sem
    `para`, caem; destino ausente = ninguém recebe, e quem mandou ouve a
    voz `ausente` (antes a troca e a guilda sem destino iam ao servidor
    inteiro — numa mensagem particular, vazamento). Neles o relé carimba o
    `cx` da conexão que mandou (sorteado por conexão, contado a ela no
    anúncio) por cima do que o cliente pôs, e o `paraCx` entrega a UMA
    conexão do id. O `vigia` (não repassado) anota quem quer saber quando
    uma conexão cai: fechou, com tchau ou sem, cada vigia ouve `caiu` na hora;
  - PRESENÇA (oi, pulso, alvo): só para quem está na MESMA sala. A praça é
    a sala nula; quem nunca disse a sala (cliente de antes de 03/09) está
    na praça. A primeira sala que a conexão declara é só declaração; mudar
    de sala na MESMA conexão avisa as duas;
  - o ECO é resposta: vai só a quem perguntou — o oi que o relé entregou e
    que esse par ainda não respondeu. O eco sem `para` dos clientes antigos
    segue essa conta; eco que não responde a ninguém cai (senão cada
    entrada numa praça de N custava N² envios);
  - o PULSO e o ALVO numa sala com mais de K_PERTO outros: sempre para os K
    mais próximos de quem mandou — o alvo (o clique de andar, que sai muito
    mais que o pulso) SÓ a eles, que é o dobro dos 20 fantasmas que ganham
    corpo na praça; o pulso ainda chega aos demais de vez em quando: 1 a
    cada 5 e ao menos um a cada 12 s (cliente novo, que avisa `v: 2` na
    apresentação e só dá alguém por sumido depois de 45 s — parado, ele
    pulsa a cada 6 s, e 5 pulsos eram 30 s de silêncio) ou um a cada 3,5 s
    (cliente antigo, cuja varredura derruba quem cala 8 s);
  - chat e tchau: a todos, como antes. Quem cai sem tchau (aba morta, rede
    que some) ganha o tchau do próprio relé — a praça não espera varredura —
    se tinha se apresentado (um oi ou eco que chegou a alguém) havia pelo
    menos 5 s; e esse tchau paga o balde da difusão e o leque da conexão que
    caiu. Quem não passa some pela varredura do cliente (45 s);
  - LIMITES por conexão: 20 mensagens/s com rajada de 40; chat 1 por
    segundo (rajada de 10: uma pessoa digitando não alcança, um robô sim),
    e o sussurro paga o mesmo; convite de grupo e desafio de duelo, 1 a
    cada 3 s (rajada de 3);
    oi para a sala inteira 1 a cada 5 s (rajada de 4) — e o MESMO balde
    paga toda difusão que não é pulso, alvo nem chat: o `para` que não acha
    ninguém cai na sala (oi, eco), o
    `t` que o relé não conhece vai à sala, e mudar de sala na mesma conexão
    avisa as duas salas inteiras. Sem o balde, cada uma dessas portas
    espalhava à sala inteira a 20/s (medido: 17 a 20 vezes o oi); e no
    máximo 2000 entregas/s causadas (rajada de 4000), o que põe teto em
    qualquer amplificação. O eco que responde a um oi não gasta balde:
    numa volta do relé cada um responde a centenas de uma vez — mas se
    trocar de sala, paga como qualquer um (senão nem o leque ele pagava).
    Quem estoura sem parar (200 descartes em 10 s) é desligado;
  - CONEXÕES NOVAS por endereço (o IP público do X-Forwarded-For, lido como
    no cartório; IPv6 pelo /64): 10 de uma vez, depois 1 a cada 2 s — a que
    passa disso é fechada com 1013 antes do anúncio. Cada conexão nasce com
    todos os baldes cheios, e reconectar em laço com um `de` novo renovava a
    rajada a cada volta (medido: 11.900 entregas/s de um cliente sem conta,
    numa praça de 100). IP privado ou ausente (em casa, nas provas) fica sem
    esse limite, como nos freios da API;
  - A CAIXA DE ENTRADA de cada destino (11/09, achado 21 da revisão do
    multijogador): o sussurro e o convite (de grupo, de duelo, de troca, de
    guilda) pagam também um balde DE QUEM RECEBE, por endereço de quem manda
    (o mesmo IP do limite de conexões novas; sem IP público, o id): o MESMO
    balde que quem manda já paga (o do chat: 10 de uma vez, 1 por segundo; o
    do convite: 3, depois 1 a cada 3 s) — uma conexão sozinha não sente
    diferença nenhuma. Os baldes de quem MANDA nascem cheios a cada conexão, e cada conexão
    nova vinha com um id novo — 20 conexões despejavam 200 sussurros numa
    pessoa só. E o `cala` (não repassado): quem silencia alguém cala para si,
    por 1 h, o endereço de onde vinham os sussurros e convites daquele id —
    com id novo e conexão nova, o mesmo endereço segue calado. O que é calado
    ou freado não chega e não volta como `ausente`;
  - O ID SEM CONTA É DO APARELHO (11/09, achado 17): logo depois do anúncio o
    cliente manda o segredo do aparelho ({t:'prova'}: nunca repassado, nunca
    no log; o relé guarda só o sha256). Com o id preso a um aparelho, outra
    conexão sem essa prova não fala nem ouve por ele — enquanto houver
    conexão viva e por 10 min depois da última (a queda e a volta não abrem
    brecha). O cliente antigo (sem prova) segue como antes, até um aparelho
    com prova prender o id;
  - envelope torto que passe pelo _abre (um número que não cabe num float,
    o que for) é descartado com rastro no log — nunca derruba a conexão em
    silêncio.

OS AMIGOS, OS INIMIGOS E O CHAT DA GUILDA (13/09, pedido do dono: "/g manda
mensagem pra guild", a lista de amigos com quem está online e em batalha, e
"os inimigos não podem mandar mensagem nem troca, mas pode desafiar pvp"). A
guilda (guilda_membros) e as relações (relacoes, servidor/amigos.py) são do
banco do cartório — só com --banco, lidas SÓ PARA LER numa thread (nunca no
laço), e tudo isto só vale para conexão com conta CONFERIDA:
  - `luta` no oi, eco e pulso (true = está numa batalha): o relé guarda o da
    última presença; o envelope segue como veio;
  - o GCHAT {t:'gchat', de, nome, texto} (sem `para`): a todas as conexões das
    contas da guilda de quem manda, menos a que mandou; sai só com t, de, nome
    (carimbado como o do chat), texto aparado (1 a 240) e `guilda` (o nome, do
    banco). Paga o balde do chat, o geral e o leque; o texto nunca vai ao log.
    A guilda da conta fica guardada 20 s (a falha do banco não fica: conta como
    sem guilda). Sem conta ou sem guilda, só quem mandou ouve {t:'gchat-nao',
    motivo:'sem-conta'|'sem-guilda'};
  - o {t:'amigos', de} (nunca repassado; paga o balde do oi, 1 a cada 5 s) é
    respondido só a quem pediu, como voz: {t:'amigos', lista:[{conta, tipo,
    online, id, sala, luta}]} — id, sala e luta da conexão mais recente da
    conta; sem conta, lista vazia e motivo:'sem-conta'. O {t:'amigos-muda', de}
    (idem) diz que a lista mudou: o relé esquece os inimigos guardados dela;
  - o INIMIGO (um dos dois marcou o outro) não recebe sussurro nem troca, em
    silêncio, como o calado (sem `ausente`); duelo, grupo, batalha e guilda
    passam. Os inimigos de cada conta, nos dois sentidos, ficam guardados 15 s
    e são lidos antes do _processa; banco que não responde não bloqueia nada.

A IDENTIDADE (10/09, servidor/rele_ident.py, AO LADO deste arquivo): com
--banco (o mesmo da api.py, aberto só para ler) ele se anuncia a quem conecta
({t:'rele'}, com a marca que o cliente pôs no endereço), confere o token da
sessão que o cliente manda DEPOIS disso ({t:'ident'} — nunca repassado,
nunca no log, respondido só a quem mandou) e carimba o que sai: o `mestre`
que veio do cliente cai, o Mestre conferido sai com mestre:true, o nome, o
título e a guilda reservados (servidor/nomes.py) de quem não é o Mestre são
trocados e o `nuvem` vira a conta conferida ou some. A conexão identificada é
conferida de novo a cada minuto (a sessão revogada, o banido e o Mestre tirado
perdem o carimbo com a conexão aberta), e o id do herói é de UMA conta: quem
usa o `de` de uma conta conferida sem ser ela não fala nem ouve por ele (a
troca e o convite de guilda levam o nome pelo `de`). Os textos novos passam
pela regra num juiz com orçamento de tempo (rele_ident.Juiz): nome caro não
congela a praça. Sem --banco ninguém é conferido e o resto segue igual. No
mais ele não valida jogo nenhum: a autoridade de jogo (troca, Elo) é do
cartório (api.py).

NO VPS ele fica atrás do Caddy (wss://<dominio>/ws → 127.0.0.1:8791; ver
Caddyfile e soterra-rele.service ao lado). Em casa, roda direto e o jogo
aponta com `?rede=ws://127.0.0.1:8791`.

Precisa do pacote `websockets` (pip install websockets / apt install
python3-websockets). Aceita da 9.1 (a do Ubuntu 22.04) à atual — ver a
cadeia de import logo abaixo.
"""
import argparse
import asyncio
import hashlib
import heapq
import ipaddress
import json
import logging
import math
import os
import secrets
import sqlite3
import time

import rele_ident                               # a identidade na praça (10/09): o token, o Mestre e os nomes
from comum import ip_do_pedido, ip_e_publico, le_ip   # o IP de quem conectou, lido como no cartório (api.py)

# O websockets muda de casa a cada geração, e o Ubuntu empacota versões
# velhas: o 24.04 traz a 10.4 e o 22.04 a 9.1, que ainda nem tinha
# `broadcast` — o relé morria no import e o systemd o reiniciava a cada 3 s,
# para sempre. A cadeia pega a melhor que houver; sem `broadcast`, usa o de
# casa (`manda_a_todos`).
try:                                            # >= 13: a implementação nova
    from websockets.asyncio.server import serve, broadcast
except ImportError:
    try:                                        # 9 a 12 (e o legado do 13+)
        from websockets.legacy.server import serve
    except ImportError:                         # antes da 9
        from websockets.server import serve
    try:                                        # 10 a 12
        from websockets.legacy.protocol import broadcast
    except ImportError:
        try:
            from websockets import broadcast
        except ImportError:                     # 9.x: não existe
            broadcast = None

LIMITE_MSG = 8 * 1024        # o protocolo é miúdo; envelope maior é lixo/abuso
LIMITE_FILA = 64 * 1024      # quem tem isto parado no buffer está entupido: perde a mensagem
PENDENTES = set()            # os envios do broadcast caseiro (a referência segura a tarefa viva)

# ---------------------------------------------------------------- roteamento
K_PERTO = 40                 # o pulso e o alvo sempre chegam aos 40 mais próximos de quem mandou
UM_EM = 5                    # aos demais (cliente novo): 1 pulso a cada 5...
VAO_NOVOS = 12.0             # ...e ao menos um a cada 12 s (parado, o cliente pulsa a cada 6 s: 5 pulsos eram 30 s, contra a varredura de 45 s)
VAO_ANTIGOS = 3.5            # aos demais (cliente antigo, varredura de 8 s): vão máximo em s
VERSAO_RALA = 2              # o `v` da apresentação a partir do qual o cliente aguenta o pulso ralo
DIVIDA_S = 30.0              # o oi entregue espera o eco por até 30 s
ID_MAX = 80
SALA_MAX = 80
TIPO_MAX = 24

# ------------------------------------------------------ limites por conexão
TAXA, RAJADA = 20.0, 40.0                # mensagens por segundo
CHAT_TAXA, CHAT_RAJADA = 1.0, 10.0       # chat: 1 por segundo, rajada de 10 (uma pessoa não alcança; 20x abaixo do geral)
OI_TAXA, OI_RAJADA = 0.2, 4.0            # oi para a sala inteira: 1 a cada 5 s (e todo recuo para difusão)
LEQUE_TAXA, LEQUE_RAJADA = 2000.0, 4000.0  # entregas causadas por segundo
ABUSO_DESCARTES, ABUSO_JANELA = 200, 10.0  # tantos descartes nesta janela: desliga

# ---------------------------------------------- limites por endereço (IP)
# Conexões NOVAS por IP público (IPv6: pelo /64). A taxa é a maior que não
# deixa reconectar render mais que ficar ligado: cada conexão nasce com o
# leque cheio (LEQUE_RAJADA, 4000 entregas), e 0,5 por segundo x 4000 dá
# 2000/s, o LEQUE_TAXA de quem fica. A rajada deixa uma casa ou uma turma
# atrás do mesmo IP entrar junta; o cliente (js/core/rede.js) tenta de novo a cada 4 s
NOVAS_TAXA, NOVAS_RAJADA = 0.5, 10.0
NOVAS_MAX = 8192                         # endereços lembrados (cheio: saem os de balde cheio; se ainda cheio, todos)
TCHAU_APOS_S = 1.0 / OI_TAXA             # o tchau do relé só por quem se apresentou há 5 s: o tempo de repor uma ficha do balde_oi

PRESENCA = ('oi', 'eco', 'pulso')        # os tipos que carregam a sala

# -------------------------------- os dirigidos (11/09: o grupo, o duelo, a batalha em dupla)
DIRIGIDOS = ('sussurro', 'grupo', 'duelo', 'batalha', 'troca', 'guilda')   # só ao destino, e NUNCA recuam
CONVITE_TAXA, CONVITE_RAJADA = 1.0 / 3.0, 3.0   # convite de grupo e desafio de duelo: 1 a cada 3 s, rajada de 3
VIGIA_MAX = 4                # alvos que uma conexão vigia (o 5º tira o mais antigo)
VIGIAS_MAX = 16              # vigias de uma conexão (o 17º não entra)
CX_MAX = 16                  # o `paraCx` (o relé sorteia 8 hex; no canal de abas a página sorteia 'l' + 7)
REF_MAX = 24                 # o `ref` e a `acao` que voltam na voz `ausente` (e a acao no log)

# ------------------- o id sem conta é do APARELHO (11/09, achado 17 da revisão do multijogador)
PROVA_MIN, PROVA_LEN_MAX = 16, 64        # o segredo do aparelho (o rede.js manda 32 hex)
PROVA_MEMORIA_S = 600.0                  # o relé lembra o aparelho do id por 10 min depois da última conexão
PROVA_IDS_MAX = 65536                    # ids lembrados (cheio: saem os soltos mais antigos; os vivos nunca)

# ------------------- a caixa de ENTRADA de cada destino e o `cala` (11/09, achado 21)
# por destino e por endereço de quem manda, o MESMO balde que quem manda já
# paga: a conversa de UMA conexão passa igual, e só a enxurrada de muitas
# conexões (um id novo em cada) é que para. A proposta da revisão (5 e 2) era
# mais apertada que o balde de quem manda — freava calada a conversa normal
ENTRADA = {'sussurro': (CHAT_TAXA, CHAT_RAJADA),         # 10 de uma vez, 1 por segundo
           'convite': (CONVITE_TAXA, CONVITE_RAJADA)}    # convite de grupo/troca/guilda e desafio: 3, depois 1 a cada 3 s
ENTRADA_MAX = 64                         # remetentes com balde próprio por conexão (cheio: os novos dividem um)
REMETENTES_MAX = 32                      # quem mandou sussurro/convite a esta conexão (id -> endereço), para o `cala`
CALA_S = 3600.0                          # o silêncio por endereço dura 1 h (o IP muda de dono; o do cliente, por id, fica)
CALA_MAX = 64                            # ids calados por pessoa (o 65º tira o que vence primeiro)
CALADOS_MAX = 8192                       # pessoas com silêncio guardado no relé

# ------------------- os amigos, os inimigos e o chat da guilda (13/09)
GCHAT_MAX = 240                          # o texto do chat da guilda, depois de aparado
GUILDA_S = 20.0                          # a guilda (e os membros) lida de uma conta vale tanto
INIMIGOS_S = 15.0                        # os inimigos de uma conta (nos dois sentidos) são lidos de novo depois de tanto...
INIMIGOS_VELHO_S = 300.0                 # ...mas, se o banco não responde, os de antes ainda valem até tanto (o zelador tira)
AMIGOS_MAX = 200                         # relações lidas por {t:'amigos'} (a API guarda até 100 de cada lista)
MEMBROS_MAX = 2000                       # membros lidos de uma guilda
INIMIGOS_LIDOS_MAX = 4096                # ids lidos em cada sentido (quem é marcado por muitos)
CONTAS_CACHE_MAX = 8192                  # contas com guilda ou inimigos guardados (cheio: saem os vencidos; se ainda cheio, todos)
LEITURAS_MAX = 16                        # leituras do banco ao mesmo tempo; as outras esperam a vez...
LEITURA_VEZ_S = 3.0                      # ...até tanto: depois, "o banco não respondeu"
LEITURA_PRAZO_S = 3.0                    # a thread que passa disso não é esperada (o SQLite espera o trancado 1 s)
SEM_INIMIGOS = ('sussurro', 'troca')     # os dirigidos que o inimigo não entrega (o desafio de duelo passa: é o PvP)
AMIGOS_TIPOS = ('amigos', 'amigos-muda') # nunca repassados: quem responde é o próprio relé

log = logging.getLogger("rele")
PARES = {}                   # ws -> Par (todas as conexões vivas)
POR_ID = {}                  # id -> set(Par) (a mesma conta em duas abas = dois Par)
SALAS = {None: set()}        # sala -> set(Par); None = a praça
CONTA = {'entrada': 0, 'envios': 0, 'descartes': 0, 'recusadas': 0}
NOVAS = {}                   # chave do endereço (_chave_ip) -> Balde das conexões novas (_admite)
PROVA = {}                   # 11/09 (achado 17): id sem conta -> sha256 da prova do aparelho que o prendeu
SOLTOS = {}                  # id preso sem conexão viva -> quando a última saiu (a memória de PROVA_MEMORIA_S)
CALADOS = {}                 # 11/09 (achado 21): id de quem silenciou -> {id calado: (até quando, endereços)}
POR_CONTA = {}               # 13/09: id da conta conferida -> set(Par) (as abas da mesma conta)
GUILDA = {}                  # 13/09: id da conta -> (lida em, (gid, nome, frozenset dos membros) ou None = sem guilda)
INIMIGOS = {}                # 13/09: id da conta -> (lida em, frozenset das contas inimigas, nos dois sentidos)
_LEITURAS = 0                # 13/09: leituras do banco em voo (_le_banco)
_NADA = object()
VERIFICADOR = rele_ident.Verificador(None)   # liga_banco(--banco); sem banco ninguém é conferido


def liga_banco(caminho):
    """Liga (com o caminho do banco do cartório) ou desliga (None) a
    conferência de identidade; o anúncio de cada conexão nova passa a dizer isso."""
    global VERIFICADOR
    VERIFICADOR = rele_ident.Verificador(caminho)


class Balde:
    """Balde de fichas: `rajada` de uma vez, repõe `taxa` por segundo."""
    __slots__ = ('taxa', 'rajada', 'saldo', 't')

    def __init__(self, taxa, rajada, agora):
        self.taxa, self.rajada, self.saldo, self.t = taxa, rajada, rajada, agora

    def tira(self, agora, custo=1.0):
        s = self.saldo + (agora - self.t) * self.taxa
        self.saldo = s if s < self.rajada else self.rajada
        self.t = agora
        custo = min(float(custo), self.rajada)
        if self.saldo < custo:
            return False
        self.saldo -= custo
        return True


class Par:
    """Uma conexão e o que o relé sabe dela."""
    __slots__ = ('ws', 'id', 'sala', 'declarou', 'x', 'z', 'versao', 'vivo',
                 'balde', 'balde_chat', 'balde_oi', 'leque', 'devendo',
                 'n_pulsos', 'ult_novos', 'ult_antigos', 'despediu', 'descartes', 'descartes_t0',
                 'conta', 'idents', 'freio_nome', 'apresentou', 'token', 'revista_em', 'falhas',
                 'cx', 'vigias', 'vigio', 'balde_convite',
                 'prova_h', 'ipk', 'entrada', 'remetentes', 'derrubado', 'luta', 'visto')

    def __init__(self, ws, agora):
        self.ws = ws
        self.id = None
        self.sala = None             # None = a praça (onde toda conexão nasce)
        self.declarou = False        # já disse a sala? a primeira vez não é "mudança"
        self.x = self.z = None
        self.versao = 0              # 0 = cliente antigo (sem `v` na apresentação)
        self.vivo = True
        self.balde = Balde(TAXA, RAJADA, agora)
        self.balde_chat = Balde(CHAT_TAXA, CHAT_RAJADA, agora)
        self.balde_oi = Balde(OI_TAXA, OI_RAJADA, agora)
        self.leque = Balde(LEQUE_TAXA, LEQUE_RAJADA, agora)
        self.devendo = {}            # Par que perguntou (oi entregue) -> quando; o eco responde
        self.n_pulsos = 0
        self.ult_novos = -1e9        # o último pulso que chegou aos de longe (cliente novo)
        self.ult_antigos = -1e9      # idem, cliente antigo
        self.despediu = False
        self.descartes = 0
        self.descartes_t0 = agora
        self.conta = None            # a conta que o ident conferiu (rele_ident), ou None
        self.idents = 0
        self.freio_nome = Balde(rele_ident.FREIO_TAXA, rele_ident.FREIO_RAJADA, agora)  # textos novos julgados
        self.apresentou = None       # quando um oi/eco dele chegou a alguém pela 1ª vez (o tchau do relé depende disso)
        self.token = None            # o token conferido, SÓ na memória (nunca no log): a conferência de novo
        self.revista_em = 0.0        # quando conferir de novo (rele_ident.CACHE_S depois da última)
        self.falhas = 0              # conferências seguidas em que o banco não respondeu
        self.cx = secrets.token_hex(4)   # 11/09: o id DESTA conexão (8 hex): o anúncio conta, os dirigidos levam carimbado
        self.vigias = set()          # as conexões que querem saber quando esta cair (a voz `caiu`)
        self.vigio = []              # as que esta vigia (até VIGIA_MAX, a mais antiga primeiro)
        self.balde_convite = Balde(CONVITE_TAXA, CONVITE_RAJADA, agora)
        self.prova_h = None          # 11/09 (achado 17): o sha256 da prova do aparelho ({t:'prova'}), se veio
        self.ipk = None              # 11/09 (achado 21): o endereço de quem conectou (_chave_ip), para a caixa de entrada
        self.entrada = {}            # (classe, remetente) -> Balde: a caixa de ENTRADA desta conexão
        self.remetentes = {}         # id -> remetente de quem mandou sussurro/convite a ela (o `cala` acha por aqui)
        self.derrubado = False       # 13/09: a conta entrou em outro aparelho — avisada e fechando (_derruba)
        self.luta = False            # 13/09: a última presença disse `luta: true` (está numa batalha) — o {t:'amigos'} conta
        self.visto = agora           # 13/09: o último envelope que chegou dela (o {t:'amigos'} mostra a conexão mais recente)


# ------------------------------------------------------------------ envelope
def _abre(msg):
    """O envelope, se for um: objeto JSON pequeno com `t` e `de` de texto."""
    if not isinstance(msg, str) or len(msg) > LIMITE_MSG:
        return None
    try:
        m = json.loads(msg)
    except Exception:                            # ValueError, RecursionError...
        return None
    if not isinstance(m, dict):
        return None
    t, de = m.get('t'), m.get('de')
    if not isinstance(t, str) or not t or len(t) > TIPO_MAX:
        return None
    if not isinstance(de, str) or not de or len(de) > ID_MAX:
        return None
    return m


def _num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        v = float(v)
    except (OverflowError, ValueError):          # inteiro JSON de 400 dígitos: passa pelo json, não cabe num float
        return None
    return v if math.isfinite(v) else None


def _sala_de(m):
    s = m.get('sala')
    return s if isinstance(s, str) and 0 < len(s) <= SALA_MAX else None


def _para(m):
    p = m.get('para')
    return p if isinstance(p, str) and p and len(p) <= ID_MAX else None


def _poe_na_sala(par, sala):
    antiga = SALAS.get(par.sala)
    if antiga is not None:
        antiga.discard(par)
        if not antiga and par.sala is not None:
            del SALAS[par.sala]
    par.sala = sala
    SALAS.setdefault(sala, set()).add(par)


def _da_sala(par):
    return [p for p in SALAS.get(par.sala, ()) if p is not par]


def _de_todos(par):
    return [p for p in PARES.values() if p is not par]


def _conexoes_do(id_, menos):
    """As conexões de um id (menos a de quem manda), ou None se ninguém tem esse id."""
    s = POR_ID.get(id_)
    if not s:
        return None
    return [p for p in s if p is not menos]


def _conta_id(p):
    return p.conta['id'] if p.conta is not None else None


def _dono(id_, menos=None):
    """A conta conferida que fala por um id (None: nenhuma)."""
    for p in POR_ID.get(id_, ()):
        if p is not menos and p.conta is not None:
            return p.conta['id']
    return None


def _despeja(p):
    """Tira a conexão do id que ela usava: ela não fala nem ouve mais por ele."""
    s = POR_ID.get(p.id)
    if s is not None:
        s.discard(p)
        if not s:
            del POR_ID[p.id]
            _solta_id(p.id, time.monotonic())
    p.id = None


def _arruma_id(par):
    """O ID DO HERÓI É DE UMA CONTA (10/09). O relé aceita várias conexões com
    o mesmo `de` (as duas abas da mesma pessoa), mas o `de` do Mestre vai em
    todo pulso: quem o copiasse — sem conta, ou com a de outra pessoa — mandava
    o convite de troca e de guilda que a vítima lê com o nome DELE (a Rede e a
    Troca tiram o nome do registro pelo `de`) e ainda ouvia o que era para ele.
    Agora todas as conexões de um id têm a MESMA identidade: com uma conta
    conferida no id, quem não é ela sai dele (é despejado). Vale nas duas
    ordens: o que chegou antes sem conta também sai quando o dono chega."""
    if par.id is None:
        return
    meu = _conta_id(par)
    dono = _dono(par.id, par)
    if dono is not None and dono != meu:
        _despeja(par)
    elif meu is not None:
        for p in list(POR_ID.get(par.id, ())):
            if p is not par and _conta_id(p) != meu:
                _despeja(p)


def _deve(par, a, agora):
    t0 = par.devendo.get(a)
    return t0 is not None and a.vivo and agora - t0 <= DIVIDA_S


def _perto(par, outros):
    """Os K_PERTO mais próximos de `par` entre `outros` (todos, se cabem).
    Devolve lista nova quando corta — quem chama pode acrescentar nela."""
    if len(outros) <= K_PERTO:
        return outros
    x0 = par.x if par.x is not None else 0.0
    z0 = par.z if par.z is not None else 0.0
    longe = float('inf')

    def d2(p):
        if p.x is None:
            return longe                             # sem posição: fica com os de longe
        dx, dz = p.x - x0, p.z - z0
        return dx * dx + dz * dz

    return heapq.nsmallest(K_PERTO, outros, key=d2)


def _pulso(par, agora):
    """Quem recebe o pulso: todos da sala, ou — sala cheia — os K mais
    próximos sempre e os demais de vez em quando (1 em 5, e ao menos um a
    cada VAO_NOVOS, para o cliente novo; vão de no máximo VAO_ANTIGOS para
    o antigo, cuja varredura é de 8 s). O piso de TEMPO é o que segura o
    jogador parado: ele pulsa a cada 6 s, e só a conta de 1 em 5 dava 30 s
    de silêncio contra os 45 s da varredura do cliente novo — uma entrega
    perdida e o par sumia; quem anda pulsa a cada 2 s e nem chega nos 12 s."""
    outros = _da_sala(par)
    if len(outros) <= K_PERTO:
        return outros
    par.n_pulsos += 1
    geral_novos = (par.n_pulsos % UM_EM == 1) or (agora - par.ult_novos >= VAO_NOVOS)
    if geral_novos:                                  # o 1º, o 6º, o 11º... ou 12 s depois do último
        par.ult_novos = agora
    geral_antigos = (agora - par.ult_antigos >= VAO_ANTIGOS)
    if geral_antigos:
        par.ult_antigos = agora
    if geral_novos and geral_antigos:
        return outros
    perto = _perto(par, outros)
    if not (geral_novos or geral_antigos):
        return perto
    ja = set(perto)
    for p in outros:
        if p in ja:
            continue
        if (geral_novos if p.versao >= VERSAO_RALA else geral_antigos):
            perto.append(p)
    return perto


# ------------------------------------------------------------ os dirigidos (11/09)
def _para_cx(m):
    """O `paraCx` do envelope: None (qualquer conexão do id), o texto, ou
    _NADA quando veio torto (o envelope cai)."""
    c = m.get('paraCx')
    if c is None or c == '':
        return None
    if isinstance(c, str) and len(c) <= CX_MAX:
        return c
    return _NADA


def _curto(v):
    return v[:REF_MAX] if isinstance(v, str) and v else None


def _voz(par, obj):
    """Uma voz do relé (sem `de`) a UMA conexão: o `ausente`."""
    CONTA['envios'] += manda_a_todos([par.ws], json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def _ausente(par, m, t, para, para_cx):
    """Quem mandou fica sabendo que o destino não está — e qual conversa
    falhou: o `ref`, o gid, o did ou o bid dos dados, e a `acao`."""
    d = m.get('dados')
    ref = None
    if isinstance(d, dict):
        for k in ('ref', 'gid', 'did', 'bid'):
            ref = _curto(d.get(k))
            if ref:
                break
    _voz(par, {'t': 'ausente', 'para': para, 'paraCx': para_cx, 'tipo': t,
               'acao': _curto(m.get('acao')), 'ref': ref})


def _dirigido(par, m, t, agora):
    """Os DIRIGIDOS (11/09) — o sussurro (a mensagem particular), o grupo, o
    duelo, a batalha em dupla, a troca e a guilda — e o `vigia`, que nem é
    repassado. Só ao destino (à conexão `paraCx`, se veio), NUNCA recuando
    para a sala nem para o servidor: sem `para` o envelope cai; destino
    ausente = ninguém recebe, e quem mandou ouve a voz `ausente`. Antes, a
    troca e a guilda sem destino iam ao servidor inteiro. O sussurro paga o
    balde do chat; o convite de grupo e o desafio de duelo, o do convite; e
    todos o geral. O carimbo do `cx` sai no trata, junto do da identidade."""
    para = _para(m)
    if para is None:
        return None
    para_cx = _para_cx(m)
    if para_cx is _NADA:
        return None
    acao = m.get('acao')
    if t == 'sussurro':
        if not par.balde_chat.tira(agora):
            return None
    elif (t == 'grupo' and acao == 'convite') or (t == 'duelo' and acao in ('desafio', 'ataque')):   # 14/09: o ataque do Campo
        if not par.balde_convite.tira(agora):
            return None
    if not par.balde.tira(agora):
        return None
    alvos = _conexoes_do(para, par) or []
    if para_cx is not None:
        alvos = [p for p in alvos if p.cx == para_cx]
    if t == 'vigia':
        if m.get('solta') is True:
            for p in alvos:
                p.vigias.discard(par)
                if p in par.vigio:
                    par.vigio.remove(p)
            return []
        if not alvos:
            _ausente(par, m, t, para, para_cx)
            return []
        for p in alvos:
            if p in par.vigio or len(p.vigias) >= VIGIAS_MAX:
                continue                             # já vigia; ou o alvo está cheio (o 17º não entra)
            if len(par.vigio) >= VIGIA_MAX:
                velho = par.vigio.pop(0)             # o 5º alvo tira o mais antigo
                velho.vigias.discard(par)
            par.vigio.append(p)
            p.vigias.add(par)
        return []
    if not alvos:
        _ausente(par, m, t, para, para_cx)
        return []
    if t in SEM_INIMIGOS and par.conta is not None:
        # 13/09: o inimigo não manda mensagem nem troca (o desafio de duelo
        # passa: é o PvP que o dono quer). Não chega e não volta `ausente`,
        # como o calado — e antes da caixa de entrada, que ele nem gasta. Só lê
        # o que o trata já trouxe do banco (_busca): aqui o laço não espera nada
        alvos = [p for p in alvos if not _inimigos(par, p)]
        if not alvos:
            return []
    classe = _classe_entrada(t, acao)
    if classe is not None:
        # 11/09 (achado 21): o que chega sem ser pedido paga também a caixa de
        # ENTRADA de quem recebe, por endereço de quem manda (conexão nova e id
        # novo não renovam), e o endereço que quem recebe calou não chega.
        # Calado ou freado não volta como `ausente`: quem insiste não fica sabendo
        chave = _remetente(par)
        vivos = []
        for p in alvos:
            if _calado(p.id, chave, agora) or not _entrada(p, classe, chave, agora):
                continue
            _anota_remetente(p, par.id, chave)
            vivos.append(p)
        if not vivos:
            return []
        alvos = vivos
    if not par.leque.tira(agora, len(alvos)):
        return None
    return alvos


# ----------------------------- o id sem conta é do aparelho (11/09, achado 17)
def _hash_prova(pv):
    """O sha256 do segredo do aparelho (16 a 64 caracteres), ou None."""
    if not isinstance(pv, str) or not (PROVA_MIN <= len(pv) <= PROVA_LEN_MAX):
        return None
    return hashlib.sha256(pv.encode('utf-8', 'replace')).hexdigest()


def _prova(par, m, agora):
    """O {t:'prova', de, prova}: o segredo do APARELHO, que o cliente guarda ao
    lado do id (localStorage) e manda logo depois do anúncio, antes de
    qualquer envelope. Nunca é repassado nem vai ao log: o relé guarda só o
    sha256, na conexão (vale o primeiro). Quem já falou sem ele (o anúncio
    chegou atrasado e a fila saiu antes) e está SOZINHO no id prende o id
    agora. False = descartado (o segundo, o torto, sem balde)."""
    if par.prova_h is not None or not par.balde.tira(agora):
        return False
    h = _hash_prova(m.get('prova'))
    if h is None:
        return False
    par.prova_h = h
    if (par.id is not None and par.conta is None and _dono(par.id) is None and PROVA.get(par.id) is None
            and all(p is par for p in POR_ID.get(par.id, ()))):
        _prende(par.id, h)
    return True


def _prende(id_, h):
    if id_ not in PROVA and len(PROVA) >= PROVA_IDS_MAX:
        _poda_provas(time.monotonic(), cheia=True)
    PROVA[id_] = h
    SOLTOS.pop(id_, None)


def _aparelho_ok(par, de):
    """O ID SEM CONTA É DO APARELHO (achado 17). O relé só amarrava um id a uma
    conta quando alguém se identificava; o id de quem joga sem sessão (o do DB
    local, que vai em todo oi e pulso) aceitava qualquer conexão nova com o
    mesmo `de` — e o que ia a esse id sem paraCx ia a ela também: quem o
    copiasse lia os sussurros, respondia o convite antes do dono e recebia a
    `volta`. Agora o primeiro aparelho com prova prende o id: outra conexão
    (com a prova de outro aparelho, ou sem prova) não entra nele enquanto
    houver conexão viva, nem por PROVA_MEMORIA_S depois da última — a queda e
    a volta em 3 a 5,5 s não abrem brecha. Id que nenhum aparelho prendeu (só
    clientes antigos, sem prova) segue aberto, como antes."""
    preso = PROVA.get(de)
    if preso is None:
        if par.prova_h is not None:
            _prende(de, par.prova_h)
        return True
    return par.prova_h == preso


def _solta_id(id_, agora):
    """A última conexão do id saiu: o aparelho preso fica lembrado por PROVA_MEMORIA_S."""
    if id_ in PROVA:
        SOLTOS[id_] = agora


def _poda_provas(agora, cheia=False):
    """Esquece o aparelho do id solto há mais de PROVA_MEMORIA_S; cheia, também
    a metade mais antiga dos soltos (os presos a conexões vivas nunca saem)."""
    for k in [k for k, t0 in SOLTOS.items() if agora - t0 > PROVA_MEMORIA_S]:
        del SOLTOS[k]
        PROVA.pop(k, None)
    if cheia and len(PROVA) >= PROVA_IDS_MAX and SOLTOS:
        for k, _ in sorted(SOLTOS.items(), key=lambda kv: kv[1])[:max(1, len(SOLTOS) // 2)]:
            del SOLTOS[k]
            PROVA.pop(k, None)


# --------------- a caixa de entrada de cada destino e o `cala` (11/09, achado 21)
def _remetente(par):
    """De onde vem um sussurro ou convite, para a caixa de entrada e o `cala`:
    o endereço público de quem manda (o mesmo do limite de conexões novas;
    IPv6 pelo /64) — trocar de conexão e de id não troca de endereço —, ou o
    id, quando não há endereço público (em casa, nas provas)."""
    return ('ip', par.ipk) if par.ipk else ('id', par.id)


def _classe_entrada(t, acao):
    """O que chega sem ser pedido paga a caixa de entrada de quem recebe."""
    if t == 'sussurro':
        return 'sussurro'
    if (acao == 'convite' and t in ('grupo', 'troca', 'guilda')) or (t == 'duelo' and acao in ('desafio', 'ataque')):
        return 'convite'
    return None


def _entrada(p, classe, chave, agora):
    """Cabe mais um desta classe, deste remetente, na conexão `p`? O balde é
    de QUEM RECEBE, por remetente — conexão nova não o renova. Cheio de
    remetentes (ENTRADA_MAX), saem os de balde cheio (quem parou de mandar);
    se ainda cheio, os novos dividem UM balde da classe: trocar de endereço
    em rodízio não esvazia a caixa de ninguém."""
    k = (classe, chave)
    b = p.entrada.get(k)
    if b is None:
        if len(p.entrada) >= ENTRADA_MAX:
            for kk in [kk for kk, x in p.entrada.items() if _cheio(x, agora)]:
                del p.entrada[kk]
        if len(p.entrada) >= ENTRADA_MAX:
            k = (classe, '*')
            b = p.entrada.get(k)
        if b is None:
            taxa, rajada = ENTRADA[classe]
            b = p.entrada[k] = Balde(taxa, rajada, agora)
    return b.tira(agora)


def _anota_remetente(p, id_, chave):
    """Quem mandou sussurro ou convite a esta conexão (id -> endereço): é por
    aqui que o `cala` acha o endereço de um id que já nem está ligado."""
    r = p.remetentes
    r.pop(id_, None)
    if len(r) >= REMETENTES_MAX:
        del r[next(iter(r))]
    r[id_] = chave


def _calado(vitima, chave, agora):
    """`vitima` (um id) calou este remetente, e o silêncio ainda vale?"""
    c = CALADOS.get(vitima)
    if not c:
        return False
    achou = False
    for alvo in list(c):
        ate, chaves = c[alvo]
        if ate <= agora:
            del c[alvo]
        elif chave in chaves:
            achou = True
    if not c:
        del CALADOS[vitima]
    return achou


def _cala(par, m, agora):
    """O {t:'cala', de, para, solta?} (achado 21). O Silenciar do cliente é por
    id, e quem abre uma conexão nova a cada envio tem um id novo a cada vez.
    Então quem silencia alguém avisa o relé, e o ENDEREÇO de onde vinham os
    sussurros e convites daquele id — o que chegou a esta pessoa (em qualquer
    aba dela) e o das conexões vivas dele — fica calado para ela por CALA_S:
    id novo e conexão nova, do mesmo endereço, seguem calados. O `solta`
    devolve a voz. Nunca é repassado, e quem silencia não fica sabendo o
    endereço de ninguém. Quem divide o endereço com o calado (a mesma casa, a
    mesma rede do celular) também não chega a quem calou, durante a hora."""
    alvo = _para(m)
    if alvo is None or alvo == par.id or not par.balde.tira(agora):
        return None
    c = CALADOS.get(par.id)
    if m.get('solta') is True:
        if c and alvo in c:
            del c[alvo]
            if not c:
                del CALADOS[par.id]
        return []
    chaves = {('id', alvo)}
    for p in POR_ID.get(par.id, ()):
        ch = p.remetentes.get(alvo)
        if ch is not None:
            chaves.add(ch)
    for p in POR_ID.get(alvo, ()):
        chaves.add(_remetente(p))
    if c is None:
        if len(CALADOS) >= CALADOS_MAX:
            _poda_calados(agora)
            if len(CALADOS) >= CALADOS_MAX:
                return []                            # cheio: fica o silêncio por id do cliente
        c = CALADOS[par.id] = {}
    if alvo not in c and len(c) >= CALA_MAX:
        del c[min(c, key=lambda a: c[a][0])]         # o que vence primeiro sai
    c[alvo] = (agora + CALA_S, frozenset(chaves))
    return []


def _poda_calados(agora):
    for v in list(CALADOS):
        c = CALADOS[v]
        for a in [a for a, (ate, _) in c.items() if ate <= agora]:
            del c[a]
        if not c:
            del CALADOS[v]


# ------------------------- os amigos, os inimigos e o chat da guilda (13/09)
def _abre_banco(caminho):
    """O banco do cartório SÓ PARA LER — a mesma abertura da conferência de
    identidade (rele_ident.uri_so_leitura: nunca cria nem escreve o arquivo)."""
    return sqlite3.connect(rele_ident.uri_so_leitura(caminho), uri=True, timeout=rele_ident.ESPERA_BANCO)


def le_guilda(caminho, conta_id):
    """(guilda, definitivo): (gid, nome, frozenset das contas membro) da guilda
    da conta, ou None se ela não tem guilda. Síncrona: roda numa thread
    (_le_banco). definitivo False = o banco não respondeu (ausente, trancado,
    sem as tabelas da guilda) — essa resposta não vai para o cache."""
    try:
        con = _abre_banco(caminho)
    except (sqlite3.Error, ValueError, OSError):
        return None, False
    try:
        g = con.execute("SELECT g.id, g.nome FROM guilda_membros m JOIN guildas g ON g.id = m.guilda_id "
                        "WHERE m.conta_id = ?", (conta_id,)).fetchone()
        if g is None:
            return None, True
        ms = con.execute("SELECT conta_id FROM guilda_membros WHERE guilda_id = ? LIMIT ?",
                         (g[0], MEMBROS_MAX)).fetchall()
    except sqlite3.Error:
        return None, False
    finally:
        con.close()
    return (int(g[0]), str(g[1]), frozenset(r[0] for r in ms if isinstance(r[0], int))), True


def le_relacoes(caminho, conta_id):
    """(lista, definitivo): as relações que a conta marcou, [(conta, 'amigo' |
    'inimigo')], até AMIGOS_MAX. Sem a tabela (a API de antes de 13/09), vazia."""
    try:
        con = _abre_banco(caminho)
    except (sqlite3.Error, ValueError, OSError):
        return [], False
    try:
        rs = con.execute("SELECT alvo_id, tipo FROM relacoes WHERE conta_id = ? LIMIT ?",
                         (conta_id, AMIGOS_MAX)).fetchall()
    except sqlite3.Error:
        return [], False
    finally:
        con.close()
    return [(a, t) for a, t in rs if isinstance(a, int) and t in ('amigo', 'inimigo')], True


def le_inimigos(caminho, contas):
    """({conta: frozenset}, definitivo): para cada conta, quem ela marcou inimigo
    E quem a marcou — basta um dos dois lados para o sussurro e a troca não
    chegarem (quem foi marcado também não fala com quem o marcou)."""
    try:
        con = _abre_banco(caminho)
    except (sqlite3.Error, ValueError, OSError):
        return {}, False
    fora = {}
    try:
        for c in contas:
            ids = {r[0] for r in con.execute("SELECT alvo_id FROM relacoes WHERE conta_id = ? AND tipo = 'inimigo' "
                                             "LIMIT ?", (c, INIMIGOS_LIDOS_MAX))}
            ids.update(r[0] for r in con.execute("SELECT conta_id FROM relacoes WHERE alvo_id = ? AND tipo = 'inimigo' "
                                                 "LIMIT ?", (c, INIMIGOS_LIDOS_MAX)))
            fora[c] = frozenset(ids)
    except sqlite3.Error:
        return {}, False
    finally:
        con.close()
    return fora, True


async def _le_banco(fn, *args):
    """Uma leitura do banco (le_guilda, le_relacoes, le_inimigos) numa thread,
    FORA do laço — o _processa é síncrono, e um banco trancado não pode
    congelar a praça. Como a conferência de identidade (rele_ident.Verificador):
    LEITURAS_MAX ao mesmo tempo, as outras esperam a vez até LEITURA_VEZ_S, e
    a thread que passa de LEITURA_PRAZO_S não é esperada. Sem --banco, sem vez
    ou sem resposta: (None, False)."""
    global _LEITURAS
    caminho = VERIFICADOR.caminho
    if caminho is None:
        return None, False
    fim = time.monotonic() + LEITURA_VEZ_S
    while _LEITURAS >= LEITURAS_MAX:
        if time.monotonic() >= fim:
            return None, False
        await asyncio.sleep(0.05)
    _LEITURAS += 1
    try:
        loop = asyncio.get_running_loop()
        return await asyncio.wait_for(loop.run_in_executor(None, fn, caminho, *args), LEITURA_PRAZO_S)
    except Exception as e:                           # o prazo, a thread que morreu...
        log.warning("a leitura do banco (%s) falhou (%s): segue como se ele não respondesse", fn.__name__,
                    type(e).__name__)
        return None, False
    finally:
        _LEITURAS -= 1


def _guarda_da_conta(cache, conta_id, valor, agora, validade):
    """Guarda (agora, valor) da conta; cheio, saem os que passaram da validade
    e, se ainda cheio, todos (a próxima leitura enche de novo)."""
    if conta_id not in cache and len(cache) >= CONTAS_CACHE_MAX:
        for k in [k for k, (t0, _) in cache.items() if agora - t0 >= validade]:
            del cache[k]
        if len(cache) >= CONTAS_CACHE_MAX:
            cache.clear()
    cache[conta_id] = (agora, valor)


def _poda_contas(agora):
    for k in [k for k, (t0, _) in GUILDA.items() if agora - t0 >= GUILDA_S]:
        del GUILDA[k]
    for k in [k for k, (t0, _) in INIMIGOS.items() if agora - t0 >= INIMIGOS_VELHO_S]:
        del INIMIGOS[k]


def _indexa_conta(par, antes, depois):
    """POR_CONTA: as conexões de cada conta conferida — o chat da guilda entrega
    por conta, e o {t:'amigos'} acha por aqui quem está online. A conexão que
    caiu enquanto o banco conferia (o ident espera) não volta ao índice."""
    if antes == depois:
        return
    if antes is not None:
        s = POR_CONTA.get(antes)
        if s is not None:
            s.discard(par)
            if not s:
                del POR_CONTA[antes]
    if depois is not None and par.vivo:
        POR_CONTA.setdefault(depois, set()).add(par)


def _tem_ficha(b, agora):
    """O balde tem uma ficha agora? Sem tirar: o relé só vai ao banco pelo
    envelope que ainda pode passar (quem estoura não o faz ler nada)."""
    return b.saldo + (agora - b.t) * b.taxa >= 1.0


async def _busca(par, m, agora):
    """ANTES do _processa (que é síncrono e não espera banco nenhum), traz para
    o cache o que o envelope vai consultar: a guilda de quem manda o gchat, e os
    inimigos de quem manda e de quem recebe um sussurro ou uma troca. Só com
    conta conferida (a do destino também), só se o balde do envelope tem ficha
    e só o que venceu: a conversa normal vai ao banco uma vez a cada 15-20 s."""
    if par.conta is None or VERIFICADOR.caminho is None:
        return
    t, cid = m['t'], par.conta['id']
    if t == 'gchat':
        achado = GUILDA.get(cid)
        if not _tem_ficha(par.balde_chat, agora) or (achado is not None and agora - achado[0] < GUILDA_S):
            return
        g, definitivo = await _le_banco(le_guilda, cid)
        if definitivo:
            _guarda_da_conta(GUILDA, cid, g, time.monotonic(), GUILDA_S)
        else:
            GUILDA.pop(cid, None)                    # sem resposta não fica guardado: sai como sem guilda, e o próximo tenta de novo
    elif t in SEM_INIMIGOS:
        if not _tem_ficha(par.balde_chat if t == 'sussurro' else par.balde, agora):
            return
        para = _para(m)
        contas = {cid}
        for p in POR_ID.get(para, ()) if para is not None else ():
            if p.conta is not None:
                contas.add(p.conta['id'])
        if len(contas) < 2:
            return                                   # destino sem conta conferida (ou a mesma conta): nada a bloquear
        faltam = [c for c in contas if c not in INIMIGOS or agora - INIMIGOS[c][0] >= INIMIGOS_S]
        if not faltam:
            return
        lidos, definitivo = await _le_banco(le_inimigos, faltam)
        if definitivo:                               # sem resposta, fica o de antes (até INIMIGOS_VELHO_S)
            agora = time.monotonic()
            for c, s in lidos.items():
                _guarda_da_conta(INIMIGOS, c, s, agora, INIMIGOS_VELHO_S)


def _inimigos(a, b):
    """As conexões `a` e `b` são de contas em que uma marcou a outra inimiga?
    Só lê o cache (_busca): o que não está nele não bloqueia."""
    ca, cb = _conta_id(a), _conta_id(b)
    if ca is None or cb is None or ca == cb:
        return False
    agora = time.monotonic()
    for c, outra in ((ca, cb), (cb, ca)):
        achado = INIMIGOS.get(c)
        if achado is not None and agora - achado[0] < INIMIGOS_VELHO_S and outra in achado[1]:
            return True
    return False


def _gchat(par, m, agora):
    """O CHAT DA GUILDA: {t:'gchat', de, nome, texto}, o /g do cliente. Sem
    `para`: vai a TODAS as conexões das contas da guilda de quem manda (lida do
    banco pelo _busca), menos a que mandou — e só a elas; nunca recua para a
    sala. Precisa de conta conferida: a guilda é de contas, e o id do herói não
    diz de quem é. Sem conta ou sem guilda, só quem mandou ouve a voz
    `gchat-nao` e ninguém recebe (não é descarte). Paga o balde do chat, o
    geral e o leque. Sai só com os campos do protocolo, o texto aparado e
    `guilda` (o nome do banco); o nome de quem manda passa pelo carimbo no
    trata, como o do chat. O texto nunca vai ao log."""
    if par.conta is None:
        if not par.balde.tira(agora):
            return None
        _voz(par, {'t': 'gchat-nao', 'motivo': 'sem-conta'})
        return []
    if not par.balde_chat.tira(agora) or not par.balde.tira(agora):
        return None
    texto = m.get('texto')
    if not isinstance(texto, str):
        return None
    texto = texto.strip()
    if not texto or len(texto) > GCHAT_MAX:
        return None
    achado = GUILDA.get(par.conta['id'])
    g = achado[1] if achado is not None else None
    if g is None:
        _voz(par, {'t': 'gchat-nao', 'motivo': 'sem-guilda'})
        return []
    _, nome_guilda, membros = g
    dest = [p for c in membros for p in POR_CONTA.get(c, ()) if p is not par and p.vivo]
    if dest and not par.leque.tira(agora, len(dest)):
        return None
    de, nome = m['de'], m.get('nome')
    m.clear()                                        # o que o cliente pôs a mais (e o `mestre`) não sai
    m.update({'t': 'gchat', 'de': de, 'nome': nome, 'texto': texto, 'guilda': nome_guilda})
    return dest


def _mais_recente(conta_id):
    """A conexão viva mais recente da conta, que já disse o id do herói (ou None)."""
    melhor = None
    for p in POR_CONTA.get(conta_id, ()):
        if p.vivo and p.id is not None and (melhor is None or p.visto > melhor.visto):
            melhor = p
    return melhor


async def _amigos(par, m, agora):
    """O {t:'amigos', de} e o {t:'amigos-muda', de} — NUNCA repassados; pagam o
    balde do oi (1 a cada 5 s, rajada de 4) e o geral. O `amigos` responde SÓ a
    quem pediu, como voz do relé: as relações da conta (lidas do banco numa
    thread) com quem está online — a conexão mais recente da conta: o id do
    herói, a sala e se está em batalha (`luta` da última presença). Só o relé
    sabe quem está ligado; a lista com os nomes é da API. O `amigos-muda` diz
    que o cliente mexeu nas listas: os inimigos guardados desta conta saem, e
    o próximo sussurro ou troca já lê o banco (basta um dos lados estar
    fresco). False = descartado."""
    if par.id is not None and m['de'] != par.id:
        return False                                 # outro `de` na mesma conexão
    if not par.balde_oi.tira(agora) or not par.balde.tira(agora):
        return False
    if m['t'] == 'amigos-muda':
        if par.conta is not None:
            INIMIGOS.pop(par.conta['id'], None)
        return True
    if par.conta is None:
        _voz(par, {'t': 'amigos', 'lista': [], 'motivo': 'sem-conta'})
        return True
    rels, _ = await _le_banco(le_relacoes, par.conta['id'])
    lista = []
    for alvo, tipo in rels or ():
        p = _mais_recente(alvo)
        lista.append({'conta': alvo, 'tipo': tipo, 'online': p is not None,
                      'id': p.id if p is not None else None, 'sala': p.sala if p is not None else None,
                      'luta': bool(p.luta) if p is not None else False})
    if par.vivo:
        _voz(par, {'t': 'amigos', 'lista': lista})
    return True


def _processa(par, m, agora):
    """Quem recebe o envelope `m` que `par` mandou: lista de Par (vazia =
    ninguém, sem culpa) ou None (descartado: falso, sem balde)."""
    de, t = m['de'], m['t']
    if par.id is None:
        dono = _dono(de)
        if dono is not None and dono != _conta_id(par):
            return None                              # o id é de outra conta conferida (_arruma_id)
        if dono is None and par.conta is None and not _aparelho_ok(par, de):
            return None                              # 11/09 (achado 17): o id sem conta está preso a OUTRO aparelho
        par.id = de
        POR_ID.setdefault(de, set()).add(par)
        SOLTOS.pop(de, None)
        if par.conta is not None:
            _arruma_id(par)                          # quem tinha o id sem conta perde a voz e o ouvido nele
    elif de != par.id:
        return None                                  # outro `de` na mesma conexão
    if t == 'cala':
        return _cala(par, m, agora)                  # 11/09 (achado 21): o silêncio por endereço; nunca é repassado
    if t == 'gchat':
        return _gchat(par, m, agora)                 # 13/09: só às contas da guilda, sem recuo nenhum
    if t in DIRIGIDOS or t == 'vigia':
        return _dirigido(par, m, t, agora)           # 11/09: só ao destino, sem recuo nenhum
    para = _para(m)

    # o eco que responde a um oi entregue não gasta balde nenhum
    isento = False
    if t == 'eco':
        if para is not None:
            isento = any(_deve(par, a, agora) for a in POR_ID.get(para, ()))
        else:
            isento = any(_deve(par, a, agora) for a in par.devendo)
    pagou_difusao = False                            # o balde_oi já foi cobrado deste envelope?
    if not isento:
        if t == 'chat' and not par.balde_chat.tira(agora):
            return None
        if t == 'oi' and para is None:
            if not par.balde_oi.tira(agora):
                return None
            pagou_difusao = True
        if not par.balde.tira(agora):
            return None
    if t == 'tchau' and par.despediu:
        return []                                    # um tchau basta

    # o que o relé guarda: posição, versão e sala
    if t in PRESENCA or t == 'alvo':
        x, z = _num(m.get('x')), _num(m.get('z'))
        if x is not None and z is not None:
            par.x, par.z = x, z
    if t == 'oi' or t == 'eco':
        v = _num(m.get('v'))
        par.versao = int(v) if v is not None else 0
    if t in PRESENCA:
        par.luta = m.get('luta') is True             # 13/09: está numa batalha? (só o true vale; o cliente antigo nunca está)
    mudou_de = _NADA
    if t in PRESENCA:
        sala = _sala_de(m)
        if not par.declarou:
            par.declarou = True
            if sala != par.sala:
                _poe_na_sala(par, sala)
        elif sala != par.sala:
            # mudar de sala avisa as DUAS salas inteiras: é difusão e paga o
            # balde dela, até o eco isento (senão alternar a sala a cada
            # envelope espalhava a 20/s — e o eco nem o leque pagava). O oi
            # da apresentação, que já pagou lá em cima, não paga de novo
            if not pagou_difusao:
                if not par.balde_oi.tira(agora):
                    return None                      # segue na sala de antes; o próximo sinal tenta de novo
                pagou_difusao = True
            mudou_de = par.sala
            _poe_na_sala(par, sala)

    # quem recebe. O `para` que não acha ninguém RECUA para a difusão (a
    # sala, ou o servidor inteiro) — e todo recuo paga o balde do fan-out
    # (balde_oi), senão bastava um `para` inventado para espalhar a 20/s
    # gastando só o balde geral: medido, 17 a 20 vezes o que o balde permite
    if t == 'eco':
        if para is not None:
            dest = _conexoes_do(para, par)
            if dest is None:
                if not pagou_difusao and not par.balde_oi.tira(agora):
                    return None
                dest = _da_sala(par)                 # quem perguntou não está aqui: a sala
            else:
                for a in dest:
                    par.devendo.pop(a, None)
        else:
            # eco de cliente antigo: a quem perguntou e ainda não ouviu
            dest = [a for a in par.devendo if _deve(par, a, agora)]
            par.devendo.clear()
    elif t == 'oi':
        dest = _conexoes_do(para, par) if para is not None else None
        if dest is None:
            if not pagou_difusao and not par.balde_oi.tira(agora):  # sem `para` já pagou lá em cima
                return None
            dest = _da_sala(par)
    elif t == 'pulso':
        dest = _pulso(par, agora)
    elif t == 'alvo':
        dest = _perto(par, _da_sala(par))            # o clique de andar: só aos K mais próximos (o pulso ralo cuida dos distantes)
    elif t == 'tchau':
        # 11/09 (revisão): o tchau de UMA aba com outra conexão do mesmo id
        # viva não se espalha — a pessoa segue ali pela outra (a mesma regra
        # do tchau do relé no _sai). Antes, fechar a aba extra tirava o jogador
        # vivo do grupo e da batalha dos outros
        if any(p is not par and p.vivo for p in POR_ID.get(par.id, ())):
            par.despediu = True
            return []
        dest = _de_todos(par)
    elif t == 'chat':
        dest = _de_todos(par)
    elif para is not None:                           # o que vier com destino (os DIRIGIDOS já foram, sem recuo)
        dest = _conexoes_do(para, par)
        if dest is None:
            if not par.balde_oi.tira(agora):
                return None
            dest = _de_todos(par)                    # destino desconhecido: como antes
    else:
        # tipo que o relé não conhece, sem destino: a sala — e paga o balde
        # da difusão, senão bastava inventar um `t` para espalhar a 20/s
        if not par.balde_oi.tira(agora):
            return None
        dest = _da_sala(par)

    if mudou_de is not _NADA:
        # mudou de sala na mesma conexão: as DUAS salas ficam sabendo
        ja = set(dest)
        for s in (mudou_de, par.sala):
            for p in SALAS.get(s, ()):
                if p is not par and p not in ja:
                    ja.add(p)
                    dest.append(p)

    if dest and not isento and not par.leque.tira(agora, len(dest)):
        return None
    if t == 'oi':
        for p in dest:
            p.devendo[par] = agora                   # cada um que ouviu deve um eco
    elif t == 'tchau':
        par.despediu = True
    if dest and par.apresentou is None and (t == 'oi' or t == 'eco'):
        par.apresentou = agora                       # alguém já o conhece: se cair sem tchau, o relé despede por ele
    return dest


def _abusou(par, agora):
    if agora - par.descartes_t0 > ABUSO_JANELA:
        par.descartes, par.descartes_t0 = 0, agora
    par.descartes += 1
    return par.descartes > ABUSO_DESCARTES


# ------------------------------------------------------------------- entrega
async def _manda(ws, msg):
    try:
        await ws.send(msg)
    except Exception:
        pass


def _entupido(ws):
    tr = getattr(ws, 'transport', None)
    try:
        return tr is not None and tr.get_write_buffer_size() > LIMITE_FILA
    except Exception:
        return False


def manda_a_todos(conexoes, msg):
    """Entrega sem esperar ninguém, e quem está entupido (mais de 64 KB
    parados no buffer) perde a mensagem. O `broadcast` do websockets não tem
    freio — empilha no buffer até a conexão cair —, então o filtro vem antes
    dele; na 9.x ele nem existe, e o de casa faz o mesmo. Devolve quantas
    entregas saíram."""
    vivas = [ws for ws in conexoes if not _entupido(ws)]
    if not vivas:
        return 0
    if broadcast is not None:
        broadcast(vivas, msg)
        return len(vivas)
    n = 0
    for ws in vivas:
        if getattr(ws, 'open', True) is False:
            continue
        tarefa = asyncio.ensure_future(_manda(ws, msg))
        PENDENTES.add(tarefa)
        tarefa.add_done_callback(PENDENTES.discard)
        n += 1
    return n


def _despede_por_ele(par, agora):
    """O tchau que o relé manda por quem caiu sem tchau vai ao servidor
    inteiro, e não pagava balde nenhum: conectar, dizer oi e cair, em laço e
    com um `de` novo a cada volta, custava 2 entregas por par da praça a cada
    ciclo (medido: 11.900/s numa praça de 100, de um cliente sem conta).
    Agora ele só despede quem se APRESENTOU (um oi ou eco que chegou a
    alguém: só esse tem quem o conheça) há pelo menos TCHAU_APOS_S, e esse
    tchau paga o balde da difusão e o leque DA CONEXÃO QUE CAIU, como
    qualquer difusão dela. Quem não passa some pela varredura do cliente
    (R.SUMICO_RELE_MS, 45 s; 8 s no cliente antigo)."""
    if par.apresentou is None or agora - par.apresentou < TCHAU_APOS_S:
        return False
    return par.balde_oi.tira(agora) and par.leque.tira(agora, len(PARES))


def _solta_vigias(par):
    """A conexão caiu (11/09), com tchau ou sem: quem a vigiava ouve `caiu`
    {id, cx} na hora — sem esperar varredura, nem o tchau, que só sai quando
    cai a ÚLTIMA conexão do id e se ela se apresentou —, e ela sai da lista
    de quem ela vigiava."""
    for p in par.vigio:
        p.vigias.discard(par)
    par.vigio = []
    vivos = [p for p in par.vigias if p.vivo]
    par.vigias = set()
    if vivos and par.id is not None:
        msg = json.dumps({'t': 'caiu', 'id': par.id, 'cx': par.cx}, ensure_ascii=False, separators=(',', ':'))
        CONTA['envios'] += manda_a_todos([p.ws for p in vivos], msg)


def _sai(par, agora=None):
    par.vivo = False
    PARES.pop(par.ws, None)
    _indexa_conta(par, _conta_id(par), None)         # 13/09: a guilda e os amigos não a acham mais
    s = SALAS.get(par.sala)
    if s is not None:
        s.discard(par)
        if not s and par.sala is not None:
            del SALAS[par.sala]
    _solta_vigias(par)                               # 11/09: quem vigiava ouve `caiu` (com tchau ou sem)
    if par.id is None:
        return
    ids = POR_ID.get(par.id)
    if ids is None:
        return
    ids.discard(par)
    if ids:
        return                                       # a mesma conta segue noutra aba
    del POR_ID[par.id]
    _solta_id(par.id, time.monotonic() if agora is None else agora)   # 11/09 (achado 17): o aparelho fica lembrado
    if not par.despediu and PARES and _despede_por_ele(par, time.monotonic() if agora is None else agora):
        # caiu sem tchau (aba morta, rede que some): o relé despede por ele
        msg = json.dumps({'t': 'tchau', 'de': par.id}, ensure_ascii=False, separators=(',', ':'))
        CONTA['envios'] += manda_a_todos([p.ws for p in PARES.values()], msg)


def _caminho(ws, path):
    """O endereço pedido na abertura ('/ws?n=...'): `path` na assinatura
    antiga, ws.path no legado, ws.request.path na implementação nova."""
    if isinstance(path, str):
        return path
    p = getattr(ws, 'path', None)
    if isinstance(p, str):
        return p
    return getattr(getattr(ws, 'request', None), 'path', None)


def _cabecalho(ws, nome):
    """Um cabeçalho do pedido de abertura (as linhas repetidas juntas por
    vírgula, como no HTTP), ou None: ws.request_headers no legado (9 a 12),
    ws.request.headers na implementação nova."""
    h = getattr(ws, 'request_headers', None)
    if h is None:
        h = getattr(getattr(ws, 'request', None), 'headers', None)
    if h is None:
        return None
    try:
        v = h.get_all(nome)
    except Exception:
        try:
            v = [h.get(nome)]
        except Exception:
            return None
    v = [x for x in v if isinstance(x, str)]
    return ', '.join(v) if v else None


def _chave_ip(ws):
    """De onde vem a conexão, para o limite de conexões novas: o IP público
    de quem conectou, ou None (sem limite). Atrás do Caddy o socket é o
    127.0.0.1 dele, e o IP de verdade vem no X-Forwarded-For, lido como no
    cartório (comum.ip_do_pedido: da direita para a esquerda, o primeiro
    público; o cliente forja à esquerda, não à direita). Com o relé exposto
    direto (socket público) vale o socket, e o cabeçalho, que qualquer um
    escreve, nem é lido. IPv6 conta pelo /64, que é o que cada cliente
    recebe: trocar de endereço dentro dele não dá balde novo. IP privado ou
    ausente (em casa, nas provas) = None, como nos freios da API — senão
    todos atrás do mesmo proxy dividiriam um balde só."""
    sock = getattr(ws, 'remote_address', None)
    if isinstance(sock, (tuple, list)):
        sock = sock[0] if sock else None
    sock = sock if isinstance(sock, str) else None
    ip = le_ip(sock)
    if not ip_e_publico(ip):
        ip = le_ip(ip_do_pedido(_cabecalho(ws, 'X-Forwarded-For'), sock))
    if not ip_e_publico(ip):
        return None
    if ip.version == 6:
        return str(ipaddress.ip_network('%s/64' % ip, strict=False))
    return str(ip)


def _cheio(b, agora):
    return b.saldo + (agora - b.t) * b.taxa >= b.rajada


def _admite(chave, agora):
    """Cabe mais uma conexão nova deste endereço (a chave do _chave_ip)? A
    que não tem endereço público (None) sempre cabe. O balde de quem está
    sendo freado nunca é esquecido: cheio, o mapa perde só os baldes cheios."""
    if chave is None:
        return True
    b = NOVAS.get(chave)
    if b is None:
        if len(NOVAS) >= NOVAS_MAX:
            for k in [k for k, x in NOVAS.items() if _cheio(x, agora)]:
                del NOVAS[k]
            if len(NOVAS) >= NOVAS_MAX:
                NOVAS.clear()
        b = NOVAS[chave] = Balde(NOVAS_TAXA, NOVAS_RAJADA, agora)
    return b.tira(agora)


def _chave(conta):
    return None if conta is None else (conta['id'], bool(conta.get('gm')))


def _poe_conta(par, conta, agora):
    """A conta que o banco disse desta conexão (o ident, ou a conferência de
    novo); devolve se mudou (a conta ou o Mestre). Se a conexão PERDEU o
    Mestre — a sessão revogada, o banido, o Mestre tirado —, a praça esquece a
    apresentação dela: o tchau do relé derruba o registro que os outros guardam
    pelo `de` (o nome e o mestre:true, que a troca e o convite de guilda leem
    de lá), e o próximo pulso dela provoca a apresentação de novo, já
    carimbada. Sem isto, quem roubou a sessão do Mestre seguia na praça com o
    selo depois do "encerrar sessões". Só o Mestre perdido paga esse tchau (é
    raro: precisa de uma sessão de Mestre); a conta comum que cai não deixa
    nada reservado no registro dos outros."""
    antes = par.conta
    par.conta = conta
    _indexa_conta(par, None if antes is None else antes['id'], None if conta is None else conta['id'])   # 13/09
    if conta is None:
        par.token = None
    else:
        par.revista_em = agora + rele_ident.CACHE_S
    _arruma_id(par)
    if _chave(antes) == _chave(conta):
        return False
    perdeu = bool(antes is not None and antes.get('gm') and (conta is None or not conta.get('gm')))
    if perdeu and par.id is not None and len(PARES) > 1:
        msg = json.dumps({'t': 'tchau', 'de': par.id}, ensure_ascii=False, separators=(',', ':'))
        CONTA['envios'] += manda_a_todos([p.ws for p in PARES.values() if p is not par], msg)
    return True


async def _ident(par, m, agora):
    """O {t:'ident', de, token}: confere o token no banco (rele_ident, numa
    thread) e responde SÓ a quem mandou. Nunca é repassado, e nem o token nem
    o envelope vão ao log. Vale o último ident (um token que não confere tira
    a conta que havia). O token conferido fica na memória da conexão (nunca no
    log) para a conferência de novo a cada rele_ident.CACHE_S (_revista); se o
    banco não respondeu a tempo (trancado, a rajada do religar depois de um
    deploy), a conexão não fica sem conta por isso: guarda o token e confere de
    novo daqui a pouco. False = descartado: passou do IDENT_MAX da conexão ou
    do balde geral (e conta como descarte, como qualquer abuso)."""
    if par.idents >= rele_ident.IDENT_MAX or not par.balde.tira(agora):
        return False
    par.idents += 1
    token = m.get('token')
    conta, definitivo = await VERIFICADOR.consulta(token)
    agora = time.monotonic()
    _poe_conta(par, conta, agora)
    if conta is not None:
        par.token, par.falhas = token, 0
        log.info("identidade conferida: conta #%d%s", conta['id'], " (Mestre)" if conta['gm'] else "")
    elif not definitivo and rele_ident.token_ok(token):
        par.token, par.falhas = token, 1
        par.revista_em = agora + rele_ident.REVISTA_FALHA_S
    CONTA['envios'] += manda_a_todos([par.ws], rele_ident.resposta(par.conta))
    if conta is not None:
        # 13/09 (um aparelho só): depois da resposta, as OUTRAS conexões desta
        # conta com outro token — o aparelho de antes — caem, se o banco diz que
        # o login deste as derrubou. Numa tarefa: o ident não espera por elas
        _em_tarefa(_derruba_outros(par))
    return True


def _em_tarefa(coro):
    tarefa = asyncio.ensure_future(coro)
    PENDENTES.add(tarefa)                        # a referência segura a tarefa viva
    tarefa.add_done_callback(PENDENTES.discard)
    return tarefa


async def _derruba_outros(par):
    """UM APARELHO SÓ (13/09, pedido do dono: "uma conta só pode estar logada
    em um dispositivo.. se outro tentar logar, no que estava logado cai o
    jogo"). A conexão `par` acabou de se identificar: as outras conexões
    identificadas com a MESMA conta e token DIFERENTE são o aparelho de antes.
    O banco decide quem cai (rele_ident.derrubadas, sem cache, uma ida só por
    ident): só o token que um login derrubou — a mesma conta em duas abas do
    mesmo navegador tem o mesmo token e não cai, e a sessão que ainda vale
    (aberta antes desta regra) também não. Banco que não responde não derruba
    ninguém: a conferência de novo (_revista) decide depois."""
    conta, token = par.conta, par.token
    if conta is None or token is None:
        return
    alvos = [p for p in PARES.values()
             if p is not par and p.vivo and not p.derrubado and p.conta is not None
             and p.conta['id'] == conta['id'] and p.token is not None and p.token != token]
    if not alvos:
        return
    fora = await VERIFICADOR.derrubadas([p.token for p in alvos])
    if not fora:
        return
    for p in alvos:
        if p.vivo and not p.derrubado and p.token in fora:
            _derruba(p)


def _derruba(par):
    """A conexão cuja sessão um login em outro aparelho derrubou: perde a
    identidade na hora (nada mais sai com o carimbo da conta), ouve
    {t:'derrubado', motivo:'outro-aparelho'} e fecha com
    rele_ident.FECHA_DERRUBADO — o rede.js não religa depois disso. O que ela
    ainda mandar até fechar é ignorado (trata)."""
    cid = par.conta['id'] if par.conta is not None else None
    par.derrubado = True
    _poe_conta(par, None, time.monotonic())
    log.info("sessão derrubada por um login em outro aparelho: conta #%s", cid)
    _em_tarefa(_despede_derrubado(par.ws))


async def _despede_derrubado(ws):
    await _manda(ws, rele_ident.derrubado())
    try:
        await ws.close(rele_ident.FECHA_DERRUBADO, 'sua conta entrou em outro aparelho')
    except Exception:
        pass


async def _revista(par):
    """A CONFERÊNCIA DE NOVO (10/09): vencido o prazo, a sessão desta conexão
    volta ao banco (pelo cache de rele_ident.CACHE_S) — a revogada cai, o
    Mestre tirado perde o selo, e o que o banco só conferiu atrasado passa a
    valer. A resposta nova vai só a quem se identificou, quando mudou. O banco
    que não responde não derruba ninguém de cara: tenta de novo a cada
    REVISTA_FALHA_S, e só depois de REVISTA_TENTATIVAS vezes seguidas a conexão
    fica sem conta (fecha por padrão)."""
    conta, definitivo = await VERIFICADOR.consulta(par.token)
    agora = time.monotonic()
    if not definitivo:
        par.falhas += 1
        if par.falhas <= rele_ident.REVISTA_TENTATIVAS:
            par.revista_em = agora + rele_ident.REVISTA_FALHA_S
            return
        conta = None
    par.falhas = 0
    if conta is None and definitivo and par.conta is not None and par.token is not None:
        # 13/09: a sessão sumiu do banco. Se foi um login em outro aparelho —
        # inclusive o que se identificou no relé do OUTRO contêiner, que este
        # não vê —, a conexão cai com o aviso, em vez de só perder a conta
        fora = await VERIFICADOR.derrubadas([par.token])
        if fora and par.token in fora and par.vivo and not par.derrubado:
            _derruba(par)
            return
    if _poe_conta(par, conta, agora):
        if conta is not None:
            log.info("identidade conferida de novo: conta #%d%s", conta['id'], " (Mestre)" if conta['gm'] else "")
        CONTA['envios'] += manda_a_todos([par.ws], rele_ident.resposta(par.conta))


async def trata(ws, path=None):                 # path: assinatura antiga
    # antes até do anúncio, o limite de conexões novas por endereço: cada
    # conexão nasce com todos os baldes cheios, e reconectar em laço com um
    # `de` novo renovava a rajada a cada volta. A que passa do balde do IP
    # fecha com 1013 ("tente mais tarde"); o cliente tenta de novo em 4 s
    chave_ip = _chave_ip(ws)
    if not _admite(chave_ip, time.monotonic()):
        CONTA['recusadas'] += 1
        try:
            await ws.close(1013, 'conexões novas demais deste endereço: tente de novo daqui a pouco')
        except Exception:
            pass
        return
    # o anúncio antes de tudo, com a marca que o cliente pôs no endereço: só
    # depois dele o cliente novo manda o token (rele_ident.py). O relé antigo
    # não se anuncia, e o anúncio que um par forjasse por ele não tem a marca
    par = Par(ws, time.monotonic())                  # antes do anúncio: ele conta à conexão o `cx` dela (11/09)
    par.ipk = chave_ip                               # 11/09 (achado 21): o endereço, para a caixa de entrada de quem recebe
    await _manda(ws, rele_ident.anuncio(VERIFICADOR.ligado, rele_ident.marca_do_caminho(_caminho(ws, path)), par.cx))
    PARES[ws] = par
    SALAS[None].add(par)
    log.info("entrou %s — conectados: %d", getattr(ws, "remote_address", "?"), len(PARES))
    fechando = None
    try:
        async for msg in ws:
            if fechando is not None or par.derrubado:
                continue                         # já está sendo desligado (ou foi derrubado, 13/09): só esvazia a fila
            agora = time.monotonic()
            CONTA['entrada'] += 1
            m = _abre(msg)
            if m is not None:
                par.visto = agora                    # 13/09: a conexão mais recente da conta é a que o {t:'amigos'} mostra
            ident = m is not None and m['t'] == 'ident'
            prova = m is not None and m['t'] == 'prova'
            try:
                if ident:
                    # o token: conferido e respondido só a quem mandou —
                    # NUNCA repassado, e nem ele nem o envelope vão ao log
                    dest = [] if await _ident(par, m, agora) else None
                elif prova:
                    # 11/09 (achado 17): o segredo do aparelho — nunca
                    # repassado, e nem ele nem o envelope vão ao log
                    dest = [] if _prova(par, m, agora) else None
                else:
                    if m is not None and par.token is not None and agora >= par.revista_em:
                        await _revista(par)              # a sessão de novo: a revogada cai (rele_ident.CACHE_S)
                        agora = time.monotonic()
                    if par.derrubado:
                        dest = []                        # 13/09: derrubada na revista — nada mais sai dela
                    elif m is None:
                        dest = None
                    elif m['t'] in AMIGOS_TIPOS:
                        # 13/09: quem está online, respondido só a quem pediu —
                        # nunca repassado (dest é [] ou None: nada a entregar)
                        dest = [] if await _amigos(par, m, agora) else None
                    else:
                        if par.conta is not None and (m['t'] == 'gchat' or m['t'] in SEM_INIMIGOS):
                            # 13/09: a guilda e os inimigos vêm do banco numa thread
                            # ANTES do _processa, que só lê o cache (o laço não espera)
                            await _busca(par, m, agora)
                            agora = time.monotonic()
                        dest = _processa(par, m, agora)
                    if dest:
                        # o carimbo da identidade (rele_ident.py): o nome
                        # reservado de quem não é o Mestre conferido, o
                        # `mestre`, o `nuvem`, o emblema e o corpo do Mestre.
                        # Os textos novos passam antes pelo juiz da regra, com
                        # orçamento e fila (o laço não para por eles); o
                        # carimba só lê os veredictos. Re-serializa se mudou
                        if m['t'] in rele_ident.JULGADOS:
                            await rele_ident.prepara(m, par.conta, par.freio_nome)
                        dirigido = m['t'] in DIRIGIDOS
                        if dirigido:
                            m['cx'] = par.cx             # 11/09: a conexão que mandou, por cima do que o cliente pôs
                        novo = rele_ident.carimba(m, par.conta, par.freio_nome, time.monotonic(), so_cache=True)
                        if novo is not None or dirigido or m['t'] == 'gchat':   # o gchat sempre sai refeito (_gchat)
                            msg = json.dumps(m, separators=(',', ':'))
            except Exception as e:
                # envelope torto que o _abre deixou passar: descarte com
                # rastro — sem isto QUALQUER erro aqui dentro caía no
                # `except` de fora e virava desconexão muda (1000, sem log)
                if ident:
                    log.warning("o ident falhou (%s)", type(e).__name__)   # sem o envelope: ele leva o token
                elif prova:
                    log.warning("a prova do aparelho falhou (%s)", type(e).__name__)   # sem o envelope: ele leva o segredo
                elif m is not None and m['t'] in ('sussurro', 'gchat'):
                    # a mensagem particular (e a da guilda, 13/09) nunca vai ao log: nem o texto, nem o nome, nem o erro
                    log.warning("envelope derrubou o _processa (%s): t=%s", type(e).__name__, m['t'])
                elif m is not None and m['t'] in DIRIGIDOS:
                    log.warning("envelope derrubou o _processa (%s): t=%s acao=%r, %d caracteres",
                                type(e).__name__, m['t'], str(m.get('acao'))[:REF_MAX], len(msg))
                else:
                    log.exception("envelope derrubou o _processa: %.200s", msg)
                dest = None
            if dest is None:
                CONTA['descartes'] += 1
                if _abusou(par, agora):
                    log.info("desligado por excesso: %s", par.id)
                    # fecha SEM parar de ler: a resposta ao fechamento vem
                    # atrás do que ainda está na fila, e esperá-la aqui dentro
                    # travava a conexão até o prazo do websockets (10 s)
                    fechando = asyncio.ensure_future(ws.close(1008, 'mensagens demais'))
                    PENDENTES.add(fechando)          # a referência segura a tarefa viva
                    fechando.add_done_callback(PENDENTES.discard)
                continue
            if dest:
                CONTA['envios'] += manda_a_todos([p.ws for p in dest], msg)
    except Exception:
        pass
    finally:
        _sai(par)
        log.info("saiu — conectados: %d", len(PARES))


async def zelador(relatorio):
    """A faxina das dívidas vencidas (oi sem eco, quem já saiu) a cada 30 s,
    e — se `relatorio` > 0 — uma linha de números a cada tantos segundos."""
    passo = min(10.0, relatorio) if relatorio > 0 else 10.0
    ult_poda = ult_log = time.monotonic()
    antes = dict(CONTA)
    while True:
        await asyncio.sleep(passo)
        agora = time.monotonic()
        if agora - ult_poda >= DIVIDA_S:
            ult_poda = agora
            for par in list(PARES.values()):
                d = par.devendo
                if d:
                    for a in [a for a, t0 in d.items() if not a.vivo or agora - t0 > DIVIDA_S]:
                        del d[a]
            for k in [k for k, b in NOVAS.items() if _cheio(b, agora)]:
                del NOVAS[k]                         # endereço que parou de conectar: o balde já encheu
            _poda_provas(agora)                      # 11/09: o aparelho do id solto há mais de 10 min
            _poda_calados(agora)                     # 11/09: e o silêncio que venceu
            _poda_contas(agora)                      # 13/09: a guilda e os inimigos guardados que venceram
        if relatorio > 0 and agora - ult_log >= relatorio:
            dt = agora - ult_log
            ent = CONTA['entrada'] - antes['entrada']
            env = CONTA['envios'] - antes['envios']
            desc = CONTA['descartes'] - antes['descartes']
            rec = CONTA['recusadas'] - antes['recusadas']
            if PARES or ent or rec:
                log.info("conectados: %d (praça %d, %d salas) · entrada %.0f msg/s · saída %.0f envios/s · %d descartadas%s",
                         len(PARES), len(SALAS.get(None, ())), len(SALAS) - 1,
                         ent / dt, env / dt, desc,
                         (" · %d conexões recusadas (novas demais do mesmo endereço)" % rec) if rec else "")
            antes, ult_log = dict(CONTA), agora


async def principal(host, porta, compressao=False, relatorio=60.0):
    opcoes = {'max_size': LIMITE_MSG}
    if not compressao:
        # mensagem miúda (pulso ~60 bytes): o deflate por conexão custava CPU
        # a cada entrega e quase não poupava banda
        opcoes['compression'] = None
    async with serve(trata, host, porta, **opcoes):
        log.info("o Relé escuta em ws://%s:%d", host, porta)
        faxina = asyncio.ensure_future(zelador(relatorio))
        try:
            await asyncio.Future()
        finally:
            faxina.cancel()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="O Relé da Rede do SOTERRA")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8791)
    ap.add_argument("--broadcast-caseiro", action="store_true",
                    help="usa o envio de casa mesmo com o broadcast do websockets (é o caminho da 9.x; serve às provas)")
    ap.add_argument("--compressao", action="store_true",
                    help="liga o permessage-deflate (desligado por padrão; serve à medição de carga)")
    ap.add_argument("--relatorio", type=float, default=60.0,
                    help="segundos entre as linhas de números no log (0 = nenhuma)")
    ap.add_argument("--banco", default=None,
                    help="o banco do cartório (o --banco da api.py), aberto SÓ PARA LER: confere a sessão de "
                         "quem se identifica e quem é o Mestre (rele_ident.py). Sem ele ninguém é conferido")
    args = ap.parse_args()
    if args.broadcast_caseiro:
        broadcast = None
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    liga_banco(args.banco)
    if args.banco:
        log.info("identidade: conferida no banco %s (só leitura)%s", args.banco,
                 "" if os.path.exists(args.banco) else " — ainda não existe: ninguém é conferido até ele aparecer")
    else:
        log.info("identidade: sem --banco, ninguém é conferido (nome reservado sempre sai trocado)")
    try:
        asyncio.run(principal(args.host, args.porta, args.compressao, args.relatorio))
    except KeyboardInterrupt:
        pass
