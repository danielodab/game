#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O Relé — o carteiro da Rede do SOTERRA (fase 2 da vida online).

    python rele.py [--host 127.0.0.1] [--porta 8791]

O QUE ELE É: um repassador burro de propósito. Cada mensagem de texto que
chega é entregue a TODOS os outros conectados — exatamente a semântica do
BroadcastChannel que a Rede (js/core/rede.js) usava entre abas, agora entre
MÁQUINAS. Quem entende o protocolo (oi/eco/alvo/pulso/chat/troca/tchau) são
os clientes; o relé não abre os envelopes.

POR QUE BURRO: nesta fase o servidor não valida nada — é o carteiro entre
amigos. A autoridade (conta no servidor, validação de troca e de Elo) chega
na fase 3, e vai morar AO LADO deste arquivo, não dentro dele.

NO VPS ele fica atrás do Caddy (wss://<dominio>/ws → 127.0.0.1:8791; ver
Caddyfile e soterra-rele.service ao lado). Em casa, roda direto e o jogo
aponta com `?rede=ws://127.0.0.1:8791`.

Precisa do pacote `websockets` (pip install websockets / apt install
python3-websockets). Aceita da 9.1 (a do Ubuntu 22.04) à atual — ver a
cadeia de import logo abaixo.
"""
import argparse
import asyncio
import logging

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

log = logging.getLogger("rele")
CLIENTES = set()


async def _manda(ws, msg):
    try:
        await ws.send(msg)
    except Exception:
        pass


def manda_a_todos(conexoes, msg):
    """O `broadcast` do websockets: entrega sem esperar ninguém, e quem está
    entupido perde a mensagem. Na 9.x ele não existe — o de casa faz o mesmo."""
    if broadcast is not None:
        broadcast(conexoes, msg)
        return
    for ws in conexoes:
        if getattr(ws, 'open', True) is False:
            continue
        tr = getattr(ws, 'transport', None)
        try:
            if tr is not None and tr.get_write_buffer_size() > LIMITE_FILA:
                continue
        except Exception:
            pass
        tarefa = asyncio.ensure_future(_manda(ws, msg))
        PENDENTES.add(tarefa)
        tarefa.add_done_callback(PENDENTES.discard)


async def trata(ws, path=None):                 # path: assinatura antiga
    CLIENTES.add(ws)
    log.info("entrou %s — na praça: %d", getattr(ws, "remote_address", "?"), len(CLIENTES))
    try:
        async for msg in ws:
            if not isinstance(msg, str) or len(msg) > LIMITE_MSG:
                continue
            outros = CLIENTES - {ws}
            if outros:
                # broadcast não espera cliente lento: quem entope, perde
                manda_a_todos(outros, msg)
    except Exception:
        pass
    finally:
        CLIENTES.discard(ws)
        log.info("saiu — na praça: %d", len(CLIENTES))


async def principal(host, porta):
    async with serve(trata, host, porta, max_size=LIMITE_MSG):
        log.info("o Relé escuta em ws://%s:%d", host, porta)
        await asyncio.Future()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="O Relé da Rede do SOTERRA")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8791)
    ap.add_argument("--broadcast-caseiro", action="store_true",
                    help="usa o envio de casa mesmo com o broadcast do websockets (é o caminho da 9.x; serve às provas)")
    args = ap.parse_args()
    if args.broadcast_caseiro:
        broadcast = None
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    try:
        asyncio.run(principal(args.host, args.porta))
    except KeyboardInterrupt:
        pass
