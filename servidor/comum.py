#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O que o cartório (api.py) e os módulos dele (conta.py, loja.py) usam juntos.

POR QUE ESTE ARQUIVO EXISTE — a armadilha do `__main__`: o api.py roda como
script, então o módulo dele se chama `__main__`. Se conta.py ou loja.py
fizessem `import api`, o Python carregaria uma SEGUNDA cópia do api.py, com
outra classe `Recusa`; o `except Recusa` do atendente não pegaria o erro
levantado por eles, e todo 400 viraria 500 "erro interno". Por isso as
primitivas moram aqui, e os três importam daqui. O api.py reexporta os nomes
(`from comum import …`): quem faz `import api` continua achando tudo lá.

Só biblioteca padrão, como o resto do servidor.
"""
import hashlib
import ipaddress
import math
import re
import time
from urllib.parse import parse_qs

import nomes                     # a lei dos nomes (servidor/nomes.py), gêmea de js/core/nomes.js

# ---- as réguas da conta ----------------------------------------------------------
PBKDF2_VOLTAS = 200_000
SESSAO_DIAS = 30                 # token sem uso por 30 dias morre
LOGIN_TENTATIVAS = 10            # erros de senha por conta...
LOGIN_JANELA = 10 * 60           # ...dentro de 10 minutos, e a conta espera

# ---- as réguas do jogo que o servidor copia (o teste pega a deriva) -----------------
CLASSES_RANK = ('sumo', 'arqueiro', 'bruxo', 'espadachim', 'curandeiro', 'invocador', 'minotauro')  # ordem de classes.js
CLASSE_RENOMEADA = {'curandeira': 'curandeiro'}   # como no progress.js: save antigo ainda chama assim
XP_MAX = 28180                   # o último degrau da xpTable (progression.js); o teste pega a deriva
NIVEL_MAX = 30
ELEMENTOS = ('neutro', 'fogo', 'agua', 'terra', 'ar')

# ---- o registro de instâncias (o salvar do api.py e a autoridade do salas.py) ----------
ORIGENS = {'saque', 'roleta', 'mercador', 'caixa', 'forja', 'troca', 'banco', 'legado'}
RE_IID = re.compile(r'^[\x21-\x7e]{1,64}$')    # ASCII visível, sem espaço — o jogo gera 'j' + base36


def iid_valido(iid):
    return isinstance(iid, str) and RE_IID.match(iid) is not None


class EstadoMudou(Exception):
    """O estado econômico da conta mudou enquanto o juiz trabalhava (outra op, outra
    sala fechada, a troca de outra aba). Quem pega refaz com o estado novo ou
    devolve 409; levantada DENTRO de uma _escrita, desfaz tudo o que ela gravou."""


def agora():
    return int(time.time())


class Recusa(Exception):
    """Uma resposta de erro com status e texto em português. `extra` entra no
    JSON ao lado de ok/erro (o 409 de versão devolve o save atual por aqui)."""

    def __init__(self, status, erro, **extra):
        super().__init__(erro)
        self.status = status
        self.erro = erro
        self.extra = extra


# ---- validações miúdas ------------------------------------------------------
def nome_valido(nome):
    """O nome de uma conta NOVA: 3 a 20 caracteres, sem espaço nas pontas, e o
    conjunto de caracteres da lei dos nomes (nomes.caracteres_ok: letras
    latinas com os acentos do português e do espanhol, dígitos, espaço, _ e -,
    e o que mais a regra aceitar). O isalnum() de antes deixava passar o A
    cirílico (U+0410) de "ADMIN" e as letras de enfeite; o conjunto fechado corta os
    homóglifos pela raiz. A palavra reservada (GM, Admin…) é o passo seguinte,
    no cadastro (nomes.reservado). Quem já tem conta não passa por aqui: o
    login não confere o nome."""
    if not isinstance(nome, str) or nome != nome.strip():
        return False
    if not 3 <= len(nome) <= 20:
        return False
    return nomes.caracteres_ok(nome)


def email_valido(email):
    """A régua frouxa de sempre: vale para achar o que JÁ existe (login, esqueci)."""
    return (isinstance(email, str) and 3 <= len(email) <= 120 and '@' in email
            and email == email.strip() and not any(c.isspace() for c in email))


# caracteres que num cabeçalho To viram outro destinatário ou outro campo
_FORA_DO_EMAIL = set(',;:<>()[]"\\')


def email_novo_valido(email):
    """A régua do e-mail NOVO (cadastro e troca): a frouxa, mais um @ só, algo
    antes dele, domínio com ponto e nada que num cabeçalho de e-mail vire um
    segundo destinatário ('a@b.com,c@d.com'). Contas antigas com e-mail torto
    continuam entrando: o login e o esqueci usam a régua frouxa."""
    if not email_valido(email) or email.count('@') != 1 or any(c in _FORA_DO_EMAIL for c in email):
        return False
    local, dominio = email.split('@')
    return (bool(local) and '.' in dominio and not dominio.startswith('.') and not dominio.endswith('.')
            and '..' not in dominio)


def senha_valida(senha):
    return isinstance(senha, str) and 8 <= len(senha) <= 200


def inteiro(v):
    """Número do save vira inteiro; qualquer outra coisa (bool, texto, nulo) é 0."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    if isinstance(v, float) and not math.isfinite(v):
        return 0
    return int(v)


def limita(v, lo, hi):
    """Número do save preso em [lo, hi]; bool, texto, nulo, NaN e infinito
    viram `lo` (o json do Python aceita Infinity, e o int() dele estouraria)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return lo
    if isinstance(v, float) and not math.isfinite(v):
        return lo
    return int(max(lo, min(hi, v)))


def classe_do_heroi(hid, h):
    """A classe de uma ficha: `classId`; sem ele, a chave antes do '#' ('sumo#2'
    é a segunda ficha do Bárbaro), renomeada como no progress.js. None para
    'gm' (o Mestre do Fundo não disputa ranking nem conta na loja) e para
    classe que o jogo não tem."""
    c = h.get('classId')
    if not isinstance(c, str) or not c:
        c = hid.split('#', 1)[0] if isinstance(hid, str) else ''
    c = CLASSE_RENOMEADA.get(c, c)
    return c if c in CLASSES_RANK else None


def pica_senha(senha, sal):
    # pbkdf2 com 200 mil voltas: ~0,1 s por tentativa — barato para quem entra,
    # caro para quem chuta. O sal é por conta, então tabelas prontas não servem.
    return hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), sal.encode('utf-8'), PBKDF2_VOLTAS).hex()


# ---- o IP de quem pediu ---------------------------------------------------------------
def le_ip(texto):
    """Um endereço do X-Forwarded-For (ou do socket) como ipaddress, ou None.
    Tira colchetes e porta ('[::1]:80', '1.2.3.4:5678'); IPv4 dentro de IPv6
    ('::ffff:1.2.3.4') vira o IPv4."""
    if not isinstance(texto, str):
        return None
    t = texto.strip().strip('"')
    if t.startswith('['):
        t = t[1:].split(']', 1)[0]
    elif t.count(':') == 1:
        t = t.split(':', 1)[0]
    try:
        ip = ipaddress.ip_address(t)
    except ValueError:
        return None
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip


def ip_e_publico(ip):
    """Endereço da internet de verdade: nem privado, nem loopback, nem link-local,
    nem reservado. (O Python conta as redes de documentação, 203.0.113.0/24 e
    irmãs, como privadas.)"""
    return ip is not None and not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                                   or ip.is_multicast or ip.is_unspecified)


def chave_do_ip(ip):
    """A chave de um freio por IP: o IPv4 inteiro; do IPv6, o prefixo /64
    ('2804:14c:abcd:1234::/64'). O provedor entrega a cada casa (e a cada
    celular) um /64 inteiro — 2^64 endereços — e o aparelho troca de endereço
    dentro dele quando quer: com a chave no endereço inteiro, cada pedido caía
    num balde novo e nenhum freio (login, cadastro, esqueci, confirmações)
    freava. Aceita texto (lido como no le_ip) ou ipaddress; None se não for
    endereço."""
    if not isinstance(ip, (ipaddress.IPv4Address, ipaddress.IPv6Address)):
        ip = le_ip(ip)
    if ip is None:
        return None
    if ip.version == 6:
        return str(ipaddress.IPv6Network((int(ip) >> 64 << 64, 64)))
    return str(ip)


def ip_do_pedido(xff, endereco_socket):
    """O IP de quem pediu, lido do X-Forwarded-For DA DIREITA PARA A ESQUERDA:
    o primeiro endereço público. Cada proxy acrescenta à direita quem falou com
    ele, então um cliente pode forjar entradas à esquerda, mas não à direita
    (Traefik do Coolify → Caddy de dentro com trusted_proxies → aqui). Sem
    cabeçalho, ou sem nenhum público nele, vale o endereço do socket. Devolve
    texto ('' se nada fizer sentido)."""
    if isinstance(xff, str) and xff:
        for parte in reversed(xff.split(',')):
            ip = le_ip(parte)
            if ip_e_publico(ip):
                return str(ip)
    ip = le_ip(endereco_socket)
    return str(ip) if ip is not None else ''


# ---- a Loja 2 (10/09) -----------------------------------------------------------------
# as classes que já nascem liberadas (startsUnlocked em classes.js; tests/servidor_api.py
# confere): o retrato delas é de toda conta (conta.py, o retrato do ranking)
INICIAIS = ('sumo', 'curandeiro')
CONSULTA_MAX = 2000              # caracteres da consulta da URL (?id=, ?data.id=…)


def liberadas(progress):
    """As classes liberadas no progress do save (`unlockedClasses`), com o nome antigo corrigido."""
    lista = progress.get('unlockedClasses') if isinstance(progress, dict) else None
    if not isinstance(lista, list):
        return set()
    return {CLASSE_RENOMEADA.get(c, c) for c in lista if isinstance(c, str)}


def le_consulta(q):
    """A consulta da URL (o que vem depois do '?') como {chave: primeiro valor}. O
    painel do Mestre (GET ?id=N) e o aviso do Mercado Pago (?data.id=…&type=…) a
    usam; o atendente a põe em corpo['_query'] DEPOIS de ler o corpo (o cliente
    não a escolhe pelo JSON). Mais de 2000 caracteres ou 20 campos: 400."""
    if not q:
        return {}
    if len(q) > CONSULTA_MAX:
        raise Recusa(400, 'consulta grande demais')
    try:
        pares = parse_qs(q, keep_blank_values=True, max_num_fields=20)
    except ValueError:
        raise Recusa(400, 'consulta inválida')
    return {k: v[0] for k, v in pares.items()}
