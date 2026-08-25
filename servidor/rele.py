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
python3-websockets). Aceita as duas gerações da API (>=13 e 10-12).
"""
import argparse
import asyncio
import logging

try:                                            # websockets >= 13
    from websockets.asyncio.server import serve
    from websockets import broadcast
except ImportError:                             # websockets 10-12
    from websockets.server import serve
    from websockets import broadcast

LIMITE_MSG = 8 * 1024        # o protocolo é miúdo; envelope maior é lixo/abuso

log = logging.getLogger("rele")
CLIENTES = set()


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
                broadcast(outros, msg)
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
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    try:
        asyncio.run(principal(args.host, args.porta))
    except KeyboardInterrupt:
        pass
