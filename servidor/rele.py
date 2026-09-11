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
  - DIRIGIDA (tem `para`: troca, guilda, e o oi/eco da apresentação): só
    para o destino, se ele estiver ligado aqui; senão, como antes (troca e
    guilda a todos; oi e eco à sala);
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
    segundo (rajada de 10: uma pessoa digitando não alcança, um robô sim);
    oi para a sala inteira 1 a cada 5 s (rajada de 4) — e o MESMO balde
    paga toda difusão que não é pulso, alvo nem chat: o `para` que não acha
    ninguém cai na sala (oi, eco) ou no servidor inteiro (troca, guilda), o
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
  - envelope torto que passe pelo _abre (um número que não cabe num float,
    o que for) é descartado com rastro no log — nunca derruba a conexão em
    silêncio.

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
import heapq
import ipaddress
import json
import logging
import math
import os
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

log = logging.getLogger("rele")
PARES = {}                   # ws -> Par (todas as conexões vivas)
POR_ID = {}                  # id -> set(Par) (a mesma conta em duas abas = dois Par)
SALAS = {None: set()}        # sala -> set(Par); None = a praça
CONTA = {'entrada': 0, 'envios': 0, 'descartes': 0, 'recusadas': 0}
NOVAS = {}                   # chave do endereço (_chave_ip) -> Balde das conexões novas (_admite)
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
                 'conta', 'idents', 'freio_nome', 'apresentou', 'token', 'revista_em', 'falhas')

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


def _processa(par, m, agora):
    """Quem recebe o envelope `m` que `par` mandou: lista de Par (vazia =
    ninguém, sem culpa) ou None (descartado: falso, sem balde)."""
    de, t = m['de'], m['t']
    if par.id is None:
        dono = _dono(de)
        if dono is not None and dono != _conta_id(par):
            return None                              # o id é de outra conta conferida (_arruma_id)
        par.id = de
        POR_ID.setdefault(de, set()).add(par)
        if par.conta is not None:
            _arruma_id(par)                          # quem tinha o id sem conta perde a voz e o ouvido nele
    elif de != par.id:
        return None                                  # outro `de` na mesma conexão
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
    elif t == 'chat' or t == 'tchau':
        dest = _de_todos(par)
    elif para is not None:                           # troca, guilda, o que vier com destino
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


def _sai(par, agora=None):
    par.vivo = False
    PARES.pop(par.ws, None)
    s = SALAS.get(par.sala)
    if s is not None:
        s.discard(par)
        if not s and par.sala is not None:
            del SALAS[par.sala]
    if par.id is None:
        return
    ids = POR_ID.get(par.id)
    if ids is None:
        return
    ids.discard(par)
    if ids:
        return                                       # a mesma conta segue noutra aba
    del POR_ID[par.id]
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
    return True


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
    if _poe_conta(par, conta, agora):
        if conta is not None:
            log.info("identidade conferida de novo: conta #%d%s", conta['id'], " (Mestre)" if conta['gm'] else "")
        CONTA['envios'] += manda_a_todos([par.ws], rele_ident.resposta(par.conta))


async def trata(ws, path=None):                 # path: assinatura antiga
    # antes até do anúncio, o limite de conexões novas por endereço: cada
    # conexão nasce com todos os baldes cheios, e reconectar em laço com um
    # `de` novo renovava a rajada a cada volta. A que passa do balde do IP
    # fecha com 1013 ("tente mais tarde"); o cliente tenta de novo em 4 s
    if not _admite(_chave_ip(ws), time.monotonic()):
        CONTA['recusadas'] += 1
        try:
            await ws.close(1013, 'conexões novas demais deste endereço: tente de novo daqui a pouco')
        except Exception:
            pass
        return
    # o anúncio antes de tudo, com a marca que o cliente pôs no endereço: só
    # depois dele o cliente novo manda o token (rele_ident.py). O relé antigo
    # não se anuncia, e o anúncio que um par forjasse por ele não tem a marca
    await _manda(ws, rele_ident.anuncio(VERIFICADOR.ligado, rele_ident.marca_do_caminho(_caminho(ws, path))))
    par = Par(ws, time.monotonic())
    PARES[ws] = par
    SALAS[None].add(par)
    log.info("entrou %s — conectados: %d", getattr(ws, "remote_address", "?"), len(PARES))
    fechando = None
    try:
        async for msg in ws:
            if fechando is not None:
                continue                         # já está sendo desligado: só esvazia a fila
            agora = time.monotonic()
            CONTA['entrada'] += 1
            m = _abre(msg)
            ident = m is not None and m['t'] == 'ident'
            try:
                if ident:
                    # o token: conferido e respondido só a quem mandou —
                    # NUNCA repassado, e nem ele nem o envelope vão ao log
                    dest = [] if await _ident(par, m, agora) else None
                else:
                    if m is not None and par.token is not None and agora >= par.revista_em:
                        await _revista(par)              # a sessão de novo: a revogada cai (rele_ident.CACHE_S)
                        agora = time.monotonic()
                    dest = _processa(par, m, agora) if m is not None else None
                    if dest:
                        # o carimbo da identidade (rele_ident.py): o nome
                        # reservado de quem não é o Mestre conferido, o
                        # `mestre`, o `nuvem`, o emblema e o corpo do Mestre.
                        # Os textos novos passam antes pelo juiz da regra, com
                        # orçamento e fila (o laço não para por eles); o
                        # carimba só lê os veredictos. Re-serializa se mudou
                        if m['t'] in rele_ident.JULGADOS:
                            await rele_ident.prepara(m, par.conta, par.freio_nome)
                        novo = rele_ident.carimba(m, par.conta, par.freio_nome, time.monotonic(), so_cache=True)
                        if novo is not None:
                            msg = json.dumps(novo, separators=(',', ':'))
            except Exception as e:
                # envelope torto que o _abre deixou passar: descarte com
                # rastro — sem isto QUALQUER erro aqui dentro caía no
                # `except` de fora e virava desconexão muda (1000, sem log)
                if ident:
                    log.warning("o ident falhou (%s)", type(e).__name__)   # sem o envelope: ele leva o token
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
