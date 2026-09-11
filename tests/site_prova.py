#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do site público — eventos do mundo, ranking por classe e fusões (10/09).

    python tests/site_prova.py              # contra a API falsa
    python tests/site_prova.py --api-real   # e, no fim, contra servidor/api.py

Serve a raiz do repositório com http.server (registrando os 404, como o
pacote_servido.py) e sobe uma API FALSA que responde /api/eventos e
/api/ranking EXATAMENTE com os exemplos do contrato (seção 1 do plano de
10/09). Três variantes: cheia (os exemplos), vazia (listas vazias) e fora
(porta fechada, ninguém escuta). Cada página abre num Chrome headless com
perfil NOVO e `?api=` apontando para a variante; o DOM final é conferido:
  - eventos.html: o evento no ar, "termina em", as 14 células, o texto da
    regra semanal, e o Calabouço do Dia nunca é portal fechado;
  - ranking.html#classe=sumo: 7 abas e a linha de Pia com 9.000;
  - fusoes.html: 21 duplas, 15 misturas, "+N PA" lido de Fusion.BONUS_PA
    (e escrito em lugar nenhum do site), e arqueiro+bruxo com água+ar mostra
    "Disparo Salgado", com números que mudam com o nível;
  - index.html: #eventos preenchida; fora, a nota e o Dia;
  - em todas: nenhum undefined/NaN/null no texto, zero 404 fora de
    /site/img/, e todo pedido a /site/img/ segue o contrato dos retratos.
Os números esperados que dependem do jogo (portais fechados, BONUS_PA) são
LIDOS dos arquivos do jogo, não copiados aqui.

Fase C (a conta por dentro e a loja): conta.html pergunta /api/saude (o
"esqueci a senha" só liga com o correio do servidor, e aqui ele vem desligado)
e loja.html lê /api/loja/catalogo, com os exemplos da seção 1.5 do plano da
Fase C; o menu de toda página tem a Loja. As provas próprias da Fase C estão
em tests/site_fase_c.html (fetch falso) e tests/site_fase_c_viva.py (ao vivo).
O Chrome roda em prioridade baixa: o dono usa a máquina enquanto a prova roda.

O cache (o que o SITE_URL pede): sem mapa (o js/versao.js 'dev', o de casa), a
folha e os scripts vão com o carimbo ?t= do instante, e duas visitas no MESMO
perfil, com o site.js editado entre elas, rodam o novo na segunda (o
http.server de casa não manda Cache-Control); no ar, esse ?t= sai no-cache
pelas regras dos dois Caddyfiles (a imitação de tests/carga_prova.py). Com o
mapa, o ?v=<hash> é conferido por tests/pacote_servido.py. E o SUBIR.md tem de
explicar o primeiro deploy com o cache por hash (o contêiner de antes não
manda Cache-Control).

`--api-real` sobe a API de verdade com banco temporário, semeia por HTTP (conta,
save com heróis, gm=1 gravado no sqlite como no teste da caixa, um evento e uma
regra) e abre as páginas contra ela. Precisa das rotas /api/eventos do servidor.
"""
import argparse
import functools
import hashlib
import html as html_lib
import http.server
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium']
RESULTADOS = []
PEDIDOS = []          # (caminho, código) do servidor de arquivos
CONSULTAS = []        # (caminho, query) de cada pedido ao servidor de arquivos
PEDIDOS_API = []      # (variante, método, caminho, código) das APIs falsas
PAGINAS = ['index.html', 'conta.html', 'eventos.html', 'fusoes.html', 'loja.html', 'ranking.html']


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


# ---- os exemplos do contrato (seção 1.3 e 1.7 do plano), sem tirar nem pôr ----
EVENTOS_CHEIA = json.loads(r'''
{
  "ok": true,
  "agora": 1789041600,
  "fusoMin": -180,
  "janelaDias": 14,
  "tetos": {"xp": 2.0, "vintem": 1.5, "pedras": 2.0, "saque": 1.5, "aviso": 1.0},
  "ativos": [
    {"id": "e12", "origem": "pontual", "regra": null, "tipo": "xp", "multiplicador": 2.0,
     "calabouco": null, "titulo": "Quinta do XP", "texto": "Toda sala paga o dobro de experiência.",
     "inicio": 1789038000, "fim": 1789092000}
  ],
  "proximos": [
    {"id": "r3@1789218000", "origem": "calendario", "regra": 3, "tipo": "saque", "multiplicador": 1.5,
     "calabouco": "cistern", "titulo": "Maré da Cisterna", "texto": "",
     "inicio": 1789218000, "fim": 1789261200}
  ],
  "regras": [
    {"id": 3, "tipo": "saque", "multiplicador": 1.5, "calabouco": "cistern", "titulo": "Maré da Cisterna",
     "texto": "", "dias": [6], "hora": "10:00", "duracaoMin": 720, "vigenteDe": null, "vigenteAte": null}
  ],
  "fatores": {"geral": {"xp": 2.0}, "porCalabouco": {}}
}
''')
RANKING_CHEIA = json.loads(r'''
{
  "ok": true,
  "jogadores": [{"nome": "Pia, a Forte", "xpTotal": 7000, "nivelMax": 12, "classes": 2,
                 "avatar": "fus:bruxo+sumo", "classe": "sumo"}],
  "pvp": [{"nome": "Pia, a Forte", "brasa": 1200, "partidas": 5}],
  "guildas": [{"nome": "Os Soterrados", "emblema": "⚒", "membros": 2, "xpTotal": 7300}],
  "classes": ["sumo", "arqueiro", "bruxo", "espadachim", "curandeiro", "invocador", "minotauro"],
  "porClasse": {
    "sumo": [{"nome": "Pia, a Forte", "nivel": 22, "xp": 9000, "elemento": "fogo"}],
    "arqueiro": [], "bruxo": [], "espadachim": [], "curandeiro": [], "invocador": [], "minotauro": []
  }
}
''')
EVENTOS_VAZIA = dict(EVENTOS_CHEIA, ativos=[], proximos=[], regras=[], fatores={'geral': {}, 'porCalabouco': {}})
RANKING_VAZIA = dict(RANKING_CHEIA, jogadores=[], pvp=[], guildas=[],
                     porClasse={c: [] for c in RANKING_CHEIA['classes']})
CLASSES = RANKING_CHEIA['classes']
# Fase C: a saúde (sem correio: o "esqueci a senha" fica como antes) e o catálogo
# da loja com os três exemplos da seção 1.5 do plano, sem tirar nem pôr
SAUDE = {'ok': True, 'contas': 1, 'agora': EVENTOS_CHEIA['agora'], 'correio': False}
CATALOGO_CHEIA = json.loads(r'''
{"ok": true, "versao": 1, "itens": [
 {"sku": "pergaminho-xp", "secao": "pergaminhos", "tipo": "pergaminho", "alvo": "xp", "qtd": 1,
  "nome": "Pergaminho da Sabedoria",
  "descricao": "+50% de experiência para o grupo nas próximas 9 salas vencidas. Com um evento de XP no ar, os dois juntos param em ×2.",
  "preco": 1500, "limite": {"grupo": "pergaminho-xp", "max": 1, "dias": 7}},
 {"sku": "pedras-agua", "secao": "pedras", "tipo": "pedras", "alvo": "stone-tear", "qtd": 10, "elemento": "agua",
  "nome": "10 Lágrimas de Cisterna", "descricao": "…", "preco": 300, "limite": {"grupo": "pedras", "max": 5, "dias": 7}},
 {"sku": "classe-invocador", "secao": "personagens", "tipo": "classe", "alvo": "invocador", "qtd": 1,
  "nome": "Xamã", "raridade": "raro", "cartas": 10, "descricao": "Chega no nível 1.", "preco": 8000,
  "limite": {"grupo": "classe-invocador", "max": 1, "dias": null}}
]}
''')
CATALOGO_VAZIA = {'ok': True, 'versao': 1, 'itens': []}


# ---- o que o jogo diz (lido dos arquivos dele, nunca copiado) -------------------
def le(caminho):
    with open(os.path.join(RAIZ, caminho), encoding='utf-8') as f:
        return f.read()


FECHADOS = re.findall(r"'(\w+)'", re.search(r'portaisFechados\s*=\s*\[([^\]]*)\]',
                                             le('js/core/data/dungeons.js')).group(1))
BONUS_PA = int(re.search(r'Fusion\.BONUS_PA\s*=\s*(\d+)\s*;', le('js/core/fusion.js')).group(1))


# ---- os servidores ------------------------------------------------------------
class Arquivos(http.server.SimpleHTTPRequestHandler):
    # o registro do Windows às vezes dá text/plain para .css/.js; o Chrome
    # recusa folha de estilo sem text/css
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
                             '.webp': 'image/webp', '.json': 'application/json'})

    def log_request(self, code='-', size='-'):
        caminho, _, query = self.path.split('#')[0].partition('?')
        PEDIDOS.append((caminho, str(getattr(code, 'value', code))))
        CONSULTAS.append((caminho, query))

    def log_message(self, *a):
        pass


def fabrica_api(variante, respostas):
    class ApiFalsa(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *a):
            pass

        def _cors(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')

        def _json(self, status, obj):
            corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(corpo)))
            self.send_header('Cache-Control', 'no-store')
            self._cors()
            self.end_headers()
            self.wfile.write(corpo)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            caminho = self.path.split('?')[0]
            codigo = 200 if caminho in respostas else 404
            PEDIDOS_API.append((variante, 'GET', caminho, codigo))
            self._json(codigo, respostas[caminho] if codigo == 200 else {'ok': False, 'erro': 'rota desconhecida'})

        def do_POST(self):
            PEDIDOS_API.append((variante, 'POST', self.path.split('?')[0], 404))
            self._json(404, {'ok': False, 'erro': 'a API falsa só lê'})
    return ApiFalsa


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def sobe(handler):
    p = porta_livre()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', p), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, p


def dom(chrome, pasta, url, budget=60000, perfil=None):
    perfil = perfil or tempfile.mkdtemp(prefix='perfil-', dir=pasta)   # perfil NOVO a cada página (menos em casa)
    r = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                        '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget,
                        '--dump-dom', url], capture_output=True, timeout=240,
                       creationflags=getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0))   # o dono usa a máquina
    return r.stdout.decode('utf-8', 'replace')


# ---- leitura do DOM -------------------------------------------------------------
def sem_codigo(h):
    return re.sub(r'(?is)<(script|style|noscript|template)\b.*?</\1\s*>', ' ', h)


def texto(h):
    h = re.sub(r'(?s)<!--.*?-->', ' ', sem_codigo(h))
    h = re.sub(r'(?s)<[^>]+>', ' ', h)
    return re.sub(r'\s+', ' ', html_lib.unescape(h)).strip()


def secao(h, id_):
    m = re.search(r'(?s)<section\b[^>]*\bid="%s"[^>]*>(.*?)</section>' % re.escape(id_), h)
    return m.group(1) if m else ''


def bloco(h, tag, id_):
    m = re.search(r'(?s)<%s\b[^>]*\bid="%s"[^>]*>(.*?)</%s>' % (tag, re.escape(id_), tag), h)
    return m.group(1) if m else ''


def limpo(nome, h):
    t = texto(h)
    ruins = sorted(set(re.findall(r'\b(undefined|NaN|null)\b', t)))
    check(nome + ': nenhum undefined/NaN/null no texto', not ruins, ', '.join(ruins))
    attrs = re.findall(r'="[^"]*\b(undefined|NaN|null)\b[^"]*"', sem_codigo(h))
    check(nome + ': nem nos atributos (src, style, data-…)', not attrs, ', '.join(sorted(set(attrs))))


def menu_ok(nome, h):
    m = re.search(r'(?s)<nav>(.*?)</nav>', h)
    nav = m.group(1) if m else ''
    check(nome + ': o menu tem Eventos, Fusões e Loja', 'eventos.html' in nav and 'fusoes.html' in nav and 'loja.html' in nav)


def img_no_contrato(p):
    m = re.match(r'^/site/img/fusao-([a-z]+)-([a-z]+)(-busto)?\.webp$', p)
    if m:
        return m.group(1) < m.group(2) and m.group(1) in CLASSES and m.group(2) in CLASSES
    m = re.match(r'^/site/img/classe-([a-z]+)(-busto)?\.webp$', p)
    if m:
        return m.group(1) in CLASSES
    return bool(re.match(r'^/site/img/(obra-fus(-[a-z]+)+\.webp|(capa|guildas|arena|calabouco-[a-z]+)\.jpg)$', p))


def dias_do_calabouco(h):
    return re.findall(r'data-calabouco-dia="([a-z]+)"', sem_codigo(h))


def celulas(h):
    """as células do calendário, fora do código dos scripts (o próprio script
    que as desenha tem o texto `data-dia="` dentro dele)"""
    return re.findall(r'<div class="dia( hoje)?" data-dia="([0-9-]+)"', sem_codigo(h))


def celula(h, chave):
    """o HTML de uma célula: da abertura dela até a abertura da seguinte (ou o
    fim do calendário) — as células têm divs dentro, então nada de `</div>`"""
    m = re.search(r'(?s)<div class="dia(?: hoje)?" data-dia="%s".*?(?=<div class="dia(?: hoje)?" data-dia=|</section>)'
                  % re.escape(chave), sem_codigo(h))
    return m.group(0) if m else ''


# ---- as provas contra a API falsa -------------------------------------------------
def prova_eventos(abre):
    h = abre('eventos.html', 'cheia')
    t = texto(h)
    check('eventos (cheia): o evento no ar aparece', 'Quinta do XP' in t)
    check('eventos (cheia): com a contagem', 'termina em' in t, re.search(r'termina em [^·<]{0,20}', t).group(0) if 'termina em' in t else '')
    cel = celulas(h)
    check('eventos (cheia): 14 células no calendário', len(cel) == 14, '%d células' % len(cel))
    check('eventos (cheia): a 1ª célula é hoje pelo relógio do servidor (10/09)',
          cel and cel[0] == (' hoje', '2026-9-10'), repr(cel[:1]))
    check('eventos (cheia): o evento de hoje cai na célula de hoje, com a hora',
          'Quinta do XP' in texto(celula(h, '2026-9-10')) and '08:00–23:00' in texto(celula(h, '2026-9-10')),
          texto(celula(h, '2026-9-10'))[:90])
    sab = texto(celula(h, '2026-9-12'))
    check('eventos (cheia): a ocorrência de sábado cai no sábado 12/09, e só nele',
          'Maré da Cisterna' in sab and '10:00–22:00' in sab and 'Maré da Cisterna' not in texto(celula(h, '2026-9-11')), sab[:90])
    check('eventos (cheia): o texto da regra semanal', 'Todo sábado, 10:00–22:00 (Brasília)' in t)
    ids = dias_do_calabouco(h)
    check('eventos (cheia): o Calabouço do Dia nunca é portal fechado',
          len(ids) >= 14 and not (set(ids) & set(FECHADOS)), ' '.join(sorted(set(ids))) + ' | fechados: ' + ' '.join(FECHADOS))
    check('eventos (cheia): a frase da raridade', 'nenhum evento mexe na raridade das peças' in t.lower())
    check('eventos (cheia): os tetos vêm do servidor', re.search(r'data-teto="saque"[^>]*>×1,5<', h) is not None)
    limpo('eventos (cheia)', h)
    menu_ok('eventos', h)

    h = abre('eventos.html', 'vazia')
    t = texto(h)
    check('eventos (vazia): 14 células e o aviso de nada no ar',
          len(celulas(h)) == 14 and 'Nenhum evento no ar agora.' in t)
    check('eventos (vazia): sem regra semanal, e diz isso', 'Nenhum evento semanal por enquanto.' in t)
    limpo('eventos (vazia)', h)

    h = abre('eventos.html', 'fora')
    t = texto(h)
    check('eventos (fora): a nota do servidor fora', 'servidor está fora' in t)
    ids = dias_do_calabouco(h)
    check('eventos (fora): o Dia e as 14 células continuam',
          len(celulas(h)) == 14 and len(ids) >= 14 and not (set(ids) & set(FECHADOS)))
    limpo('eventos (fora)', h)


def prova_ranking(abre):
    h = abre('ranking.html', 'cheia', '#classe=sumo')
    abas = re.findall(r'<button[^>]*data-classe="([a-z]+)"[^>]*>', bloco(h, 'div', 'abas-classe'))
    check('ranking (cheia): 7 abas por classe', len(abas) == 7, ' '.join(abas))
    bt = re.search(r'<button[^>]*data-classe="sumo"[^>]*>', h)
    check('ranking (cheia): #classe=sumo abre a aba do Bárbaro', bool(bt) and 'ligada' in bt.group(0))
    corpo = texto(bloco(h, 'tbody', 'rk-classe'))
    check('ranking (cheia): a linha de Pia com 9.000', 'Pia, a Forte' in corpo and '9.000' in corpo and '22' in corpo, corpo[:80])
    check('ranking (cheia): o elemento pelo nome do jogo', 'Fogo' in corpo)
    jog = bloco(h, 'tbody', 'rk-jogadores')
    check('ranking (cheia): a miniatura de Pia é o avatar de fusão, com o busto da classe de reserva',
          'img/fusao-bruxo-sumo-busto.webp' in jog and 'data-reserva="img/classe-sumo-busto.webp"' in jog)
    limpo('ranking (cheia)', h)
    menu_ok('ranking', h)

    h = abre('ranking.html', 'cheia', '#classe=bruxo')
    bt = re.search(r'<button[^>]*data-classe="bruxo"[^>]*>', h)
    check('ranking (cheia): #classe=bruxo abre a do Bruxo, vazia', bool(bt) and 'ligada' in bt.group(0)
          and 'ninguém ainda' in texto(h) and 'Pia' not in texto(bloco(h, 'tbody', 'rk-classe')))

    h = abre('ranking.html', 'vazia', '#classe=sumo')
    check('ranking (vazia): 7 abas e ninguém ainda',
          len(re.findall(r'data-classe="', bloco(h, 'div', 'abas-classe'))) == 7 and 'ninguém ainda' in texto(h))
    limpo('ranking (vazia)', h)

    h = abre('ranking.html', 'fora')
    check('ranking (fora): diz que o servidor está fora', 'servidor está fora' in texto(h))
    limpo('ranking (fora)', h)


def prova_fusoes(abre):
    h = abre('fusoes.html', 'cheia', '#dupla=arqueiro+bruxo&elementos=agua+ar&nivel=30')
    t = texto(h)
    duplas = set(re.findall(r'<a class="cartao dupla[^"]*" href="#dupla=[^"]+" data-dupla="([a-z]+\+[a-z]+)"', h))
    check('fusões: 21 duplas', len(duplas) == 21, '%d' % len(duplas))
    misturas = set(re.findall(r'data-mistura="([a-z]+\+[a-z]+)"', h))
    check('fusões: 15 misturas (sem as espelhadas)', len(misturas) == 15, '%d' % len(misturas))
    check('fusões: "+%d PA" lido de Fusion.BONUS_PA' % BONUS_PA, ('+%d PA' % BONUS_PA) in t)
    copiado = [f for f in ('site/fusoes.js', 'site/fusoes.html', 'site/index.html', 'site/site.js')
               if re.search(r'\+\s*%d\s*PA' % BONUS_PA, le(f))]
    check('fusões: e o número não está escrito no código do site', not copiado, ', '.join(copiado))
    det = texto(secao(h, 'duplas'))
    check('fusões: arqueiro+bruxo com água+ar mostra "Disparo Salgado"', 'Disparo Salgado' in det)
    check('fusões: no nível 30 as 7 formas estão abertas', 'Cataclismo Salgado' in det)
    m30 = re.search(r'Disparo Salgado.*?dano (\d+)–(\d+) de Água', det)
    jogo = [p for p, c in PEDIDOS if c == '200']
    check('fusões: leu os dados do próprio jogo',
          all(x in jogo for x in ('/js/core/fusion.js', '/js/core/data/fusions.js',
                                  '/js/core/data/classes.js', '/js/core/data/elements.js')))
    limpo('fusões', h)
    menu_ok('fusões', h)

    h = abre('fusoes.html', 'cheia', '#dupla=arqueiro+bruxo&elementos=agua+ar&nivel=1')
    det = texto(secao(h, 'duplas'))
    m1 = re.search(r'Disparo Salgado.*?dano (\d+)–(\d+) de Água', det)
    check('fusões: no nível 1 só a forma do início', 'Disparo Salgado' in det and 'Sigilo Salgado' not in det)
    check('fusões: os números saem do spellsFor (o nível 30 bate mais que o 1)',
          bool(m1 and m30) and int(m30.group(1)) > int(m1.group(1)),
          'nível 1: %s · nível 30: %s' % (m1 and m1.group(0)[-24:], m30 and m30.group(0)[-24:]))

    h = abre('fusoes.html', 'cheia', '#dupla=sumo+minotauro&elementos=fogo+fogo&nivel=12')
    det = texto(secao(h, 'duplas'))
    check('fusões: o par fora de ordem no link abre minotauro+sumo, e fogo+fogo dá Infernal',
          'Trombada Infernal' in det and 'Curral Infernal' in det and 'Ferrolho Infernal' not in det)
    check('fusões: elemento puro diz o bônus do jogo', 'Elemento puro: ×' in texto(h))
    limpo('fusões (minotauro+sumo)', h)


def prova_index(abre):
    h = abre('index.html', 'cheia')
    ev = secao(h, 'eventos')
    te = texto(ev)
    check('landing (cheia): #eventos com o evento no ar e a contagem', 'Quinta do XP' in te and 'termina em' in te)
    ids = dias_do_calabouco(ev)
    check('landing (cheia): o Dia de hoje e dos próximos 6, sem portal fechado',
          len(ids) == 7 and not (set(ids) & set(FECHADOS)), ' '.join(ids))
    check('landing (cheia): o próximo evento em "Em breve"', 'Maré da Cisterna' in te)
    fotos = re.findall(r'<div class="foto retrato"[^>]*data-classe="([a-z]+)"[^>]*><img src="img/classe-([a-z]+)\.webp"', h)
    check('landing (cheia): os 7 cartões de classe com o retrato quadrado pelo id',
          len(fotos) == 7 and all(a == b for a, b in fotos) and sorted(b for a, b in fotos) == sorted(CLASSES),
          ' '.join(b for a, b in fotos))
    tc = texto(secao(h, 'classes'))
    check('landing (cheia): Curandeiro (D1), e o pronome dele', 'Curandeiro' in tc and 'Curandeira' not in tc and 'O que ele faz' in tc)
    fu = secao(h, 'fusoes')
    check('landing (cheia): #fusoes com as regras lidas do jogo e 4 duplas',
          ('+%d PA' % BONUS_PA) in texto(fu) and len(re.findall(r'class="cartao dupla"', fu)) == 4)
    melhores = bloco(h, 'tbody', 'rk-classes')
    check('landing (cheia): o melhor de cada classe (7 linhas, Pia no Bárbaro)',
          len(re.findall(r'<tr', melhores)) == 7 and 'Pia, a Forte' in texto(melhores))
    limpo('landing (cheia)', h)
    menu_ok('landing', h)
    rodape = re.search(r'(?s)<footer\b.*?</footer>', h)
    check('landing (cheia): o rodapé tem a Loja', bool(rodape) and 'href="loja.html"' in rodape.group(0))

    h = abre('index.html', 'vazia')
    te = texto(secao(h, 'eventos'))
    check('landing (vazia): nada no ar, e diz isso', 'Nenhum evento no ar agora.' in te and 'nada marcado' in te)
    check('landing (vazia): as 7 classes com ninguém ainda', texto(bloco(h, 'tbody', 'rk-classes')).count('ninguém ainda') == 7)
    limpo('landing (vazia)', h)

    h = abre('index.html', 'fora')
    ev = secao(h, 'eventos')
    check('landing (fora): a nota do servidor fora e o Dia',
          'servidor está fora' in texto(ev) and len(dias_do_calabouco(ev)) == 7)
    limpo('landing (fora)', h)

    h = abre('conta.html', 'cheia')
    menu_ok('conta', h)
    limpo('conta', h)
    esq = re.search(r'<a\b[^>]*\bid="esqueci"[^>]*>', h)
    check('conta (sem correio): o "esqueci a senha" continua desligado', bool(esq) and 'desligado' in esq.group(0))


def prova_loja(abre):
    """Fase C: a loja pública (sem sessão) com o catálogo do contrato"""
    h = abre('loja.html', 'cheia')
    t = texto(h)
    secoes = re.findall(r'<section class="loja-secao" data-secao="([a-z]+)"', sem_codigo(h))
    check('loja (cheia): as três seções, na ordem', secoes == ['pergaminhos', 'pedras', 'personagens'], ' '.join(secoes))
    check('loja (cheia): os preços do servidor, com ponto de milhar', '1.500 vinténs' in t and '300 vinténs' in t and '8.000 vinténs' in t)
    check('loja (cheia): sem sessão, "Entre para comprar"', t.count('Entre para comprar') >= 4)
    check('loja (cheia): o retrato do personagem pelo id da classe', 'src="img/classe-invocador.webp"' in h)
    limpo('loja (cheia)', h)
    menu_ok('loja', h)

    h = abre('loja.html', 'vazia')
    check('loja (vazia): diz que está vazia', 'A loja está vazia por enquanto.' in texto(h))
    limpo('loja (vazia)', h)

    h = abre('loja.html', 'fora')
    check('loja (fora): diz que o servidor está fora', 'servidor está fora' in texto(h))
    limpo('loja (fora)', h)


# ---- a integração com a API de verdade (--api-real) --------------------------------
def pede(base, metodo, rota, corpo=None, token=None):
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(base + rota, data=dados, method=metodo)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}


def prova_api_real(chrome, pasta, site):
    real = os.path.join(pasta, 'real')
    os.makedirs(real)
    banco = os.path.join(real, 'dados', 'soterra.db')
    porta = porta_livre()
    base = 'http://127.0.0.1:%d' % porta
    log = open(os.path.join(real, 'api.log'), 'w', encoding='utf-8')
    proc = subprocess.Popen([sys.executable, os.path.join(RAIZ, 'servidor', 'api.py'), '--porta', str(porta),
                             '--banco', banco], stdout=log, stderr=subprocess.STDOUT)
    try:
        subiu = False
        for _ in range(100):                                   # por contagem de voltas
            if proc.poll() is not None:
                break
            try:
                with urllib.request.urlopen(base + '/api/saude', timeout=1) as r:
                    subiu = r.status == 200
                    break
            except Exception:
                time.sleep(0.15)
        check('api real: a API sobe', subiu)
        if not subiu:
            return
        st, r = pede(base, 'POST', '/api/cadastro', {'nome': 'Pia Forte', 'email': 'pia@soterra.test',
                                                     'senha': 'segredo-bom-8'})
        check('api real: a conta nasce', st == 201, str(r)[:120])
        token, cid = r.get('token'), (r.get('conta') or {}).get('id')
        herois = {'sumo': {'classId': 'sumo', 'xp': 5000, 'level': 15, 'element': 'fogo', 'items': {}, 'itemVar': {}},
                  'sumo#2': {'classId': 'sumo', 'xp': 9000, 'level': 22, 'element': 'fogo', 'items': {}, 'itemVar': {}},
                  'bruxo': {'classId': 'bruxo', 'xp': 2000, 'level': 8, 'items': {}, 'itemVar': {}}}
        db = {'versao': 1, 'jogador': {'nome': 'Pia, a Forte', 'avatar': 'fus:sumo+bruxo',
                                       'brasa': {'pts': 1200, 'partidas': 5},
                                       'guilda': {'nome': 'Os Soterrados', 'emblema': '⚒'}},
              'banco': {'moedas': 0, 'itens': []}, 'mercado': None}
        st, r = pede(base, 'PUT', '/api/save', {'versao': 0, 'progress': {'version': 22, 'inventory': [], 'heroes': herois},
                                               'db': db, 'nascimentos': []}, token)
        check('api real: o save de Pia entra', st == 200, str(r)[:120])
        con = sqlite3.connect(banco)                           # a marca de Mestre é do sqlite, como no teste da caixa
        con.execute('UPDATE contas SET gm = 1 WHERE id = ?', (cid,))
        con.commit()
        con.close()
        agora = int(time.time())
        st, r = pede(base, 'POST', '/api/eventos', {'tipo': 'xp', 'multiplicador': 2, 'calabouco': None,
                                                   'titulo': 'Quinta do XP', 'texto': 'Toda sala paga o dobro de experiência.',
                                                   'fim': agora + 14 * 3600}, token)
        check('api real: o Mestre liga um evento (201)', st == 201, '%s %s' % (st, str(r)[:120]))
        st, r = pede(base, 'POST', '/api/eventos/regras', {'tipo': 'saque', 'multiplicador': 1.5, 'calabouco': 'cistern',
                                                          'titulo': 'Maré da Cisterna', 'texto': '', 'dias': [6],
                                                          'hora': '10:00', 'duracaoMin': 720,
                                                          'vigenteDe': None, 'vigenteAte': None}, token)
        check('api real: o Mestre cria a regra semanal (201)', st == 201, '%s %s' % (st, str(r)[:120]))

        h = dom(chrome, pasta, site + 'eventos.html?api=' + base)
        t = texto(h)
        check('api real: eventos.html mostra o evento, a contagem e a regra',
              'Quinta do XP' in t and 'termina em' in t and 'Todo sábado, 10:00–22:00 (Brasília)' in t)
        check('api real: 14 células, sem portal fechado no Dia',
              len(celulas(h)) == 14 and not (set(dias_do_calabouco(h)) & set(FECHADOS)))
        limpo('api real: eventos', h)
        h = dom(chrome, pasta, site + 'ranking.html?api=' + base + '#classe=sumo')
        corpo = texto(bloco(h, 'tbody', 'rk-classe'))
        check('api real: ranking por classe com Pia e o sumo#2 (9.000)', 'Pia, a Forte' in corpo and '9.000' in corpo, corpo[:80])
        check('api real: o avatar normalizado vira o busto da fusão',
              'img/fusao-bruxo-sumo-busto.webp' in bloco(h, 'tbody', 'rk-jogadores'))
        limpo('api real: ranking', h)
        h = dom(chrome, pasta, site + 'index.html?api=' + base)
        check('api real: a landing mostra o evento no ar', 'Quinta do XP' in texto(secao(h, 'eventos')))
        limpo('api real: landing', h)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.close()


def prova_do_carimbo():
    """As seis páginas pedem a folha e os scripts pelo mapa do build (SITE_URL,
    com o hash de cada arquivo) e, sem mapa (em casa), pelo carimbo ?t= do
    instante — nunca o ?v= do instante, que o Caddy de antes das marcas guardava
    por um ano."""
    ruins = []
    for p in PAGINAS:
        t = le('site/' + p)
        if re.search(r"\?v='\s*\+\s*Date\.now\(\)", t):
            ruins.append(p + ": ainda carimba ?v=' + Date.now()")
        if '../js/versao.js?t=' not in t or "SITE_URL('site.css')" not in t or 'SITE_URL(s)' not in t:
            ruins.append(p + ': não pede pelo mapa (../js/versao.js e SITE_URL)')
        if len(re.findall(r"'\?v='\s*\+\s*mapa\[chave\]\s*:\s*'\?t='\s*\+\s*Date\.now\(\)", t)) != 1:
            ruins.append(p + ": sem mapa, o SITE_URL não cai no carimbo '?t=' + Date.now()")
    check("as seis páginas pedem a folha e os scripts pelo mapa do build (SITE_URL) e, sem mapa, pelo carimbo ?t= "
          "(nunca ?v=' + Date.now())", not ruins, '; '.join(ruins[:4]))


# ---- o cache: sem mapa (em casa), no ar (o Caddy novo) e o primeiro deploy ---------
SONDA_NOVA = b"document.documentElement.setAttribute('data-sonda','nova');\n"


def prova_sem_mapa():
    """O que as seis páginas pediram de fato ao servidor desta prova (o 'dev' do
    repositório, sem mapa, como em casa): a folha e cada script do site com o
    carimbo ?t= do instante — nunca ?v=, nunca sem carimbo. E esses mesmos
    endereços, no ar, pelas regras dos dois Caddyfiles (prova_no_ar)."""
    lidos = {c for c, q in CONSULTAS}
    folhas = [(c, q) for c, q in CONSULTAS if c.endswith(('.css', '.js')) and c != '/js/versao.js']
    sem_t = sorted({c + ('?' + q if q else '') for c, q in folhas if not re.fullmatch(r't=\d+', q or '')})
    check('as páginas leem o ../js/versao.js (o mapa do build, como o jogo)', '/js/versao.js' in lidos)
    check("sem mapa (o js/versao.js 'dev', o de casa), a folha e cada script do site vão com o carimbo ?t= do "
          'instante — nunca ?v=, nunca sem carimbo (%d pedidos)' % len(folhas),
          bool(folhas) and not sem_t, ', '.join(sem_t[:4]))
    prova_no_ar(CONSULTAS)


def prova_no_ar(consultas):
    """NO AR o mapa existe e o SITE_URL dá ?v=<hash>; o ?t= só sairia se um
    arquivo faltasse no mapa. Pelas regras dos DOIS Caddyfiles (a imitação de
    tests/carga_prova.py), cada ?t= que as páginas pediram sai no-cache — nunca
    "um ano" —, mesmo com a marca do hash de verdade do arquivo na pasta de
    marcas; e o mesmo arquivo com ?v=<hash> sai por um ano (a pasta de marcas
    da prova funciona: o no-cache não é de graça)."""
    if AQUI not in sys.path:
        sys.path.insert(0, AQUI)
    import carga_prova as cp
    carimbados = sorted({(c, q) for c, q in consultas
                         if c.endswith(('.css', '.js')) and c != '/js/versao.js' and re.fullmatch(r't=\d+', q or '')
                         and os.path.isfile(os.path.join(RAIZ, *c.strip('/').split('/')))})
    ruins, hashes = [], {}
    with tempfile.TemporaryDirectory(prefix='soterra-marcas-') as marcas:
        for c, q in carimbados:
            with open(os.path.join(RAIZ, *c.strip('/').split('/')), 'rb') as f:
                hashes[c] = hashlib.sha256(f.read()).hexdigest()[:12]      # o hash do versao.py
            fis = os.path.join(marcas, *(c.strip('/') + '.' + hashes[c]).split('/'))
            os.makedirs(os.path.dirname(fis), exist_ok=True)
            open(fis, 'wb').close()
        for rel in ('servidor/coolify/Caddyfile', 'servidor/Caddyfile'):
            regra = cp.regras_do_caddy(le(rel), marcas=marcas)
            for c, q in carimbados:
                if regra(c + '?' + q) != cp.NO_CACHE:
                    ruins.append('%s: %s?%s dá %r' % (rel, c, q, regra(c + '?' + q)))
                if regra(c + '?v=' + hashes[c]) != cp.IMUTAVEL:
                    ruins.append('%s: %s?v=%s (com a marca) dá %r' % (rel, c, hashes[c], regra(c + '?v=' + hashes[c])))
    pedidos = {c for c, q in carimbados}
    base = {'/site/site.css', '/site/site.js'}
    check('no ar (os dois Caddyfiles): cada ?t= que as páginas pediram sai no-cache, nunca "um ano", mesmo com a '
          'marca do arquivo; e o mesmo arquivo com ?v=<hash> sai um ano (%d endereços)' % len(carimbados),
          base <= pedidos and not ruins,
          '; '.join(ruins[:3]) or ('' if base <= pedidos else 'nenhum ?t= da folha e do site.js'))


def prova_em_casa(chrome, pasta, api):
    """EM CASA (o http.server do .claude/launch.json manda Last-Modified e nenhum
    Cache-Control), o site.js editado entre duas visitas no MESMO perfil roda na
    segunda. Sem carimbo, o Chrome dava ao site.js de 10 dias um dia de frescor
    heurístico (10% da idade) e rodava o velho sem nem perguntar ao servidor."""
    casa = tempfile.mkdtemp(prefix='casa-', dir=pasta)
    sitejs = os.path.join(casa, 'site.js')
    shutil.copyfile(os.path.join(RAIZ, 'site', 'site.js'), sitejs)
    dez_dias = time.time() - 10 * 86400
    os.utime(sitejs, (dez_dias, dez_dias))
    fase, pedidos = ['1'], []

    class Casa(Arquivos):
        def translate_path(self, path):
            if path.split('?', 1)[0].split('#', 1)[0] == '/site/site.js':
                return sitejs
            return Arquivos.translate_path(self, path)

        def log_request(self, code='-', size='-'):
            caminho, _, query = self.path.split('#')[0].partition('?')
            pedidos.append((fase[0], caminho, query))

    srv, porta = sobe(functools.partial(Casa, directory=RAIZ))
    perfil = os.path.join(casa, 'perfil')                  # o MESMO perfil nas duas visitas
    url = 'http://127.0.0.1:%d/site/index.html?api=%s' % (porta, api)
    try:
        dom(chrome, pasta, url, 15000, perfil=perfil)
        with open(sitejs, 'rb') as f:
            velho = f.read()
        with open(sitejs, 'wb') as f:
            f.write(SONDA_NOVA + velho)                     # a edição entre as visitas
        fase[0] = '2'
        h2 = dom(chrome, pasta, url, 15000, perfil=perfil)
    finally:
        srv.shutdown()
    q1 = ['site.js' + ('?' + q if q else '') for f, c, q in pedidos if f == '1' and c == '/site/site.js']
    q2 = ['site.js' + ('?' + q if q else '') for f, c, q in pedidos if f == '2' and c == '/site/site.js']
    check('em casa (sem Cache-Control): o site.js editado entre duas visitas no mesmo perfil roda na 2ª',
          'data-sonda="nova"' in h2,
          'visita 1 pediu %s; visita 2 pediu %s' % (q1 or 'nada', q2 or 'NADA (rodou o do cache)'))
    check('em casa: cada visita pede o site.js com um carimbo ?t= novo',
          len(q1) == 1 and len(q2) == 1 and all(re.fullmatch(r'site\.js\?t=\d+', q) for q in q1 + q2) and q1 != q2,
          'visita 1: %s · visita 2: %s' % (q1, q2))


def prova_primeiro_deploy():
    """O PRIMEIRO deploy com o cache por hash não é coberto pela regra das
    marcas: o contêiner que está no ar antes dele não manda Cache-Control, e o
    Chrome usa sem perguntar, por um décimo da idade do arquivo, o que ele
    responder. O SUBIR.md tem de dizer o que acontece, quanto dura, como
    conferir e o que fazer."""
    t = le('servidor/SUBIR.md')
    m = re.search(r'(?m)^- \*\*Uma vez só, no primeiro deploy com o cache por hash.*(?:\n[ \t]+\S.*)*', t)
    nota = m.group(0) if m else ''
    faltam = [k for k in ('Cache-Control', 'um décimo', 'se cura sozinh', 'F5', 'Ctrl+Shift+R', 'curl.exe -sI')
              if k not in nota]
    check('o SUBIR.md explica o primeiro deploy com o cache por hash: o que acontece, quanto dura, como conferir e '
          'o que fazer', bool(nota) and not faltam, ('falta: ' + ', '.join(faltam) if faltam else '') if nota else 'sem a nota no SUBIR.md')


def main():
    ap = argparse.ArgumentParser(description='Prova do site público do SOTERRA')
    ap.add_argument('--api-real', action='store_true', help='no fim, sobe servidor/api.py e prova contra ela')
    args = ap.parse_args()
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2
    pasta = tempfile.mkdtemp(prefix='soterra-site-')
    servidores = []
    try:
        srv, porta = sobe(functools.partial(Arquivos, directory=RAIZ))
        servidores.append(srv)
        site = 'http://127.0.0.1:%d/site/' % porta
        apis = {}
        for nome, respostas in (('cheia', {'/api/eventos': EVENTOS_CHEIA, '/api/ranking': RANKING_CHEIA,
                                           '/api/saude': SAUDE, '/api/loja/catalogo': CATALOGO_CHEIA}),
                                ('vazia', {'/api/eventos': EVENTOS_VAZIA, '/api/ranking': RANKING_VAZIA,
                                           '/api/saude': SAUDE, '/api/loja/catalogo': CATALOGO_VAZIA})):
            s, p = sobe(fabrica_api(nome, respostas))
            servidores.append(s)
            apis[nome] = 'http://127.0.0.1:%d' % p
        apis['fora'] = 'http://127.0.0.1:%d' % porta_livre()   # ninguém escuta nesta porta

        def abre(pagina, variante, ancora=''):
            return dom(chrome, pasta, site + pagina + '?api=' + apis[variante] + ancora)

        print('portais fechados (dungeons.js): %s · BONUS_PA (fusion.js): %d' % (' '.join(FECHADOS), BONUS_PA))
        prova_do_carimbo()
        prova_primeiro_deploy()
        prova_eventos(abre)
        prova_ranking(abre)
        prova_fusoes(abre)
        prova_index(abre)
        prova_loja(abre)

        faltas = sorted({p for p, c in PEDIDOS if c == '404' and not p.startswith('/site/img/') and p != '/favicon.ico'})
        check('nenhum arquivo pedido pelas páginas falta (0 × 404 fora de /site/img/)', not faltas, ', '.join(faltas[:6]))
        imgs = sorted({p for p, c in PEDIDOS if p.startswith('/site/img/')})
        tortas = [p for p in imgs if not img_no_contrato(p)]
        check('todo pedido a /site/img/ segue o contrato dos retratos', not tortas, ', '.join(tortas[:6]))
        if imgs:
            print('  (%d fotos pedidas em site/img/, %d ainda sem arquivo: a moldura mostra a inicial)'
                  % (len(imgs), len({p for p, c in PEDIDOS if c == '404' and p.startswith('/site/img/')})))
        rotas = sorted({(m, c) for v, m, c, cod in PEDIDOS_API if cod != 200})
        check('as páginas só pedem à API rotas que ela conhece (eventos, ranking, saude, loja/catalogo)', not rotas, repr(rotas[:4]))
        # o site lê o mapa do build (../js/versao.js) como o jogo; sem mapa (o
        # 'dev' do repositório, que é o servido aqui, como em casa), a folha e
        # os scripts vão com o carimbo ?t= do instante, e no ar esse ?t= sai
        # no-cache pelos dois Caddyfiles (prova_sem_mapa); e em casa, com o
        # site.js editado entre duas visitas, a segunda roda o novo
        prova_sem_mapa()
        prova_em_casa(chrome, pasta, apis['fora'])

        if args.api_real:
            prova_api_real(chrome, pasta, site)
    finally:
        for s in servidores:
            s.shutdown()
        shutil.rmtree(pasta, ignore_errors=True)
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
