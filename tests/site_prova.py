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
  - ranking.html: a caixa "Equipe do SOTERRA" (10/09) com o nome de cada
    membro, escapado, e o retrato do Cavaleiro Negro; sem equipe, escondida;
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

Loja 2 e painel do Mestre (10/09): o catálogo da API falsa é o v2 (as seções
na ordem do servidor, os pacotes de vinténs "em breve" com os pagamentos
desligados — e aí nenhum pedido a /api/pagamento/*); site/mestre.html entra
nas páginas conferidas: sem sessão, o portão pede para entrar, nenhum pedido
à API, o link "Mestre" sai do menu, nada de undefined/NaN nem 404. As provas
próprias estão em tests/site_loja2.html e tests/site_mestre.html.

`--api-real` sobe a API de verdade com banco temporário, semeia por HTTP (conta,
save com heróis, gm=1 gravado no sqlite como no teste da caixa, um evento e uma
regra) e abre as páginas contra ela. Precisa das rotas /api/eventos do servidor.
"""
import argparse
import base64
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
PAGINAS = ['index.html', 'conta.html', 'eventos.html', 'fusoes.html', 'loja.html', 'ranking.html', 'mestre.html', 'wiki.html']


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
  "tetos": {"xp": 10.0, "vintem": 10.0, "pedras": 10.0, "saque": 10.0, "aviso": 1.0},
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
  },
  "equipe": [{"nome": "GM-ODA", "avatar": "gm"}, {"nome": "Tia <b>Nena</b> & Cia", "avatar": "gm"}]
}
''')
EVENTOS_VAZIA = dict(EVENTOS_CHEIA, ativos=[], proximos=[], regras=[], fatores={'geral': {}, 'porCalabouco': {}})
# 10/09: a equipe (contas.gm = 1) sai à parte, só com nome e avatar; o 2º nome,
# com HTML, prova que a página passa tudo pelo SITE.esc
# 02/10: o placar semanal do Eco Primordial (servidor/supremo.py, GET /api/supremo/ranking)
SUPREMO_CHEIA = {'ok': True, 'agora': 1789041600, 'atual': 40, 'fechada': False, 'semanasFechadas': [39],
                 'semana': {'id': 40, 'inicio': 1788836400, 'fim': 1789441199},
                 'faixas': [{'id': 'podio', 'de': 1, 'ate': 3, 'nome': '1º ao 3º', 'vintens': 5000, 'selos': 20,
                             'titulo': 'Voz do Eco'},
                            {'id': 'participacao', 'de': 101, 'ate': None, 'nome': 'participação', 'vintens': 150,
                             'selos': 0, 'titulo': None}],
                 'ranking': [{'posicao': 1, 'nome': 'Ana <i>Brava</i>', 'pontos': 7500, 'dano': 6000, 'derrubou': True,
                              'rodada': 11},
                             {'posicao': 2, 'nome': 'Bruno', 'pontos': 4100, 'dano': 4100, 'derrubou': False,
                              'rodada': 12}]}
SUPREMO_VAZIA = dict(SUPREMO_CHEIA, ranking=[], semanasFechadas=[])
RANKING_VAZIA = dict(RANKING_CHEIA, jogadores=[], pvp=[], guildas=[], equipe=[],
                     porClasse={c: [] for c in RANKING_CHEIA['classes']})
CLASSES = RANKING_CHEIA['classes']
# Fase C: a saúde (sem correio: o "esqueci a senha" fica como antes) e o catálogo
# da loja com os três exemplos da seção 1.5 do plano, sem tirar nem pôr
SAUDE = {'ok': True, 'contas': 1, 'agora': EVENTOS_CHEIA['agora'], 'correio': False}
# 13/09: o catálogo v3, em barras de ouro (cada item com `moeda`), com as duas trocas no começo e os pacotes de barras
CATALOGO_CHEIA = json.loads(r'''
{"ok": true, "versao": 3, "itens": [
 {"sku": "vintens-1000", "secao": "vintens", "tipo": "vintens", "alvo": "carteira", "qtd": 1000,
  "nome": "1.000 vinténs", "descricao": "Vinténs para a carteira do jogo, pagos com barras de ouro.", "preco": 50,
  "moeda": "barras", "limite": null},
 {"sku": "barras-por-vintens-10", "secao": "barras-por-vintens", "tipo": "barras", "alvo": "conta", "qtd": 10,
  "nome": "10 barras de ouro", "descricao": "Barras de ouro pagas com os vinténs do jogo.", "preco": 800,
  "moeda": "vintens", "limite": null},
 {"sku": "classe-invocador", "secao": "personagens", "tipo": "classe", "alvo": "invocador", "qtd": 1,
  "nome": "Xamã", "raridade": "raro", "cartas": 10, "descricao": "Libera o Xamã na hora. Chega no nível 1.", "preco": 500,
  "moeda": "barras", "limite": {"grupo": "classe-invocador", "max": 1, "dias": null}},
 {"sku": "bonus-xp-1", "secao": "bonus", "tipo": "bonus-xp", "alvo": "xp", "qtd": 1, "dias": 1,
  "nome": "Bônus de XP — 1 dia",
  "descricao": "+50% de experiência para o grupo por 1 dia, contado no relógio do servidor a partir da entrega no jogo.",
  "preco": 75, "moeda": "barras", "limite": null},
 {"sku": "pedras-agua", "secao": "pedras", "tipo": "pedras", "alvo": "stone-tear", "qtd": 10, "elemento": "agua",
  "nome": "10 Lágrimas de Cisterna", "descricao": "…", "preco": 25, "moeda": "barras", "limite": null},
 {"sku": "insignias-10", "secao": "guilda", "tipo": "insignias", "alvo": "fundacao", "qtd": 10,
  "nome": "10 Insígnias de Fundação", "descricao": "Dez Insígnias de Fundação: o bastante para fundar uma guilda.",
  "preco": 225, "moeda": "barras", "limite": null},
 {"sku": "pergaminho-elemento", "secao": "pergaminhos", "tipo": "pergaminho", "alvo": "elemento", "qtd": 1,
  "nome": "Pergaminho da Reescrita", "descricao": "Troca um caminho elemental de um herói por outro.", "preco": 250,
  "moeda": "barras", "limite": {"grupo": "pergaminho-elemento", "max": 1, "dias": 30}}
],
 "pacotes": [
  {"id": "barras-50", "nome": "Bolsa de 50 barras de ouro", "moeda": "barras", "barras": 50, "centavos": 490, "preco": "R$ 4,90"},
  {"id": "barras-280", "nome": "Saco de 280 barras de ouro", "moeda": "barras", "barras": 280, "centavos": 1990, "preco": "R$ 19,90"}
 ],
 "barras": {"nome": "Barras de Ouro", "vintensPorBarra": 20, "vintensPorBarraFarmada": 80},
 "pagamento": {"ligado": false, "teste": false}}
''')
CATALOGO_VAZIA = {'ok': True, 'versao': 3, 'itens': [], 'pacotes': [], 'pagamento': {'ligado': False, 'teste': False}}


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


def abertura(h, tag, id_):
    """a tag de abertura do elemento, fora do código dos scripts (para ler o hidden)"""
    m = re.search(r'<%s\b[^>]*\bid="%s"[^>]*>' % (tag, re.escape(id_)), sem_codigo(h))
    return m.group(0) if m else ''


def escondida(tag):
    return bool(re.search(r'\shidden(=|\s|>)', tag))


def limpo(nome, h):
    # 21/09: o \b sozinho acusava id LEGÍTIMO. O Zelador Nulo é `null-warden`,
    # e o hífen conta como fronteira de palavra, então `data-monstro="null-warden"`
    # caía como buraco de dado assim que o Coração Partido abriu. A borda agora
    # exclui letra, dígito, _ e hífen dos dois lados — `src="undefined"` e
    # `data-x="null"` seguem reprovando.
    SUJO = r'(?<![\w-])(undefined|NaN|null)(?![\w-])'
    t = texto(h)
    ruins = sorted(set(re.findall(SUJO, t)))
    check(nome + ': nenhum undefined/NaN/null no texto', not ruins, ', '.join(ruins))
    attrs = re.findall(r'="[^"]*' + SUJO + r'[^"]*"', sem_codigo(h))
    check(nome + ': nem nos atributos (src, style, data-…)', not attrs, ', '.join(sorted(set(attrs))))


def menu_ok(nome, h):
    m = re.search(r'(?s)<nav>(.*?)</nav>', h)
    nav = m.group(1) if m else ''
    check(nome + ': o menu tem Eventos, Wiki e Loja', 'eventos.html' in nav and 'wiki.html' in nav and 'loja.html' in nav)
    # 11/09 (pedido do dono): classes, fusões e calabouços moram na wiki e na
    # landing — fora do menu do topo
    check(nome + ': o menu não tem Classes, Fusões nem Calabouços',
          not re.search(r'href="(?:index\.html)?#(?:classes|calaboucos)"|href="fusoes\.html"', nav))


def img_no_contrato(p):
    m = re.match(r'^/site/img/fusao-([a-z]+)-([a-z]+)(-busto)?\.webp$', p)
    if m:
        return m.group(1) < m.group(2) and m.group(1) in CLASSES and m.group(2) in CLASSES
    m = re.match(r'^/site/img/classe-([a-z]+)(-busto)?\.webp$', p)
    if m:
        return m.group(1) in CLASSES
    # 11/09: as miniaturas da wiki (tools/icones_site.py) — e nunca a Panóplia do Mestre
    m = re.match(r'^/site/img/(item|extra)-([a-z0-9]+(-[a-z0-9]+)*)\.webp$', p)
    if m:
        return not m.group(2).startswith('gm-')
    # 11/09: os retratos dos bichos (tools/retratos_site.py): monstro, capa do chefe e pet.
    # 02/10: o id do monstro pode ter `_` (os Colossos do Poço: colosso_fogo...)
    if re.match(r'^/site/img/(monstro|pet)-[a-z0-9]+([-_][a-z0-9]+)*\.webp$', p):
        return True
    return bool(re.match(r'^/site/img/(obra-fus(-[a-z]+)+\.webp|equipe-cavaleiro(-busto)?\.webp|'
                         r'(capa|guildas|arena|calabouco-[a-z]+)\.jpg)$', p))


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
    check('eventos (cheia): os tetos vêm do servidor', re.search(r'data-teto="saque"[^>]*>×10<', h) is not None)
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
    # a equipe (10/09): caixa própria, fora das tabelas, só o nome e o retrato
    eq, tag = bloco(h, 'aside', 'equipe'), abertura(h, 'aside', 'equipe')
    t_eq = texto(eq)
    check('ranking (cheia): a caixa "Equipe do SOTERRA" aparece, com os dois nomes',
          bool(tag) and not escondida(tag) and 'Equipe do SOTERRA' in t_eq and 'GM-ODA' in t_eq
          and 'Tia <b>Nena</b> & Cia' in t_eq, t_eq[:120])
    check('ranking (cheia): o nome da equipe passa pelo SITE.esc (o HTML do servidor vira texto)',
          '&lt;b&gt;Nena&lt;/b&gt; &amp; Cia' in eq and '<b>' not in eq)
    fotos = re.findall(r'<img[^>]*\ssrc="img/equipe-cavaleiro(?:-busto)?\.webp"', eq)
    check('ranking (cheia): cada membro com o retrato do Cavaleiro Negro', len(fotos) == 2, '%d fotos' % len(fotos))
    tem = all(os.path.exists(os.path.join(RAIZ, 'site', 'img', n))
              for n in ('equipe-cavaleiro.webp', 'equipe-cavaleiro-busto.webp'))
    check('ranking (cheia): o retrato existe em site/img e abriu (sem cair na moldura do ◆)',
          tem and 'sem-foto' not in eq, 'arquivos: %s' % ('sim' if tem else 'FALTAM'))
    tabelas = ' '.join(texto(bloco(h, 'tbody', 'rk-' + i)) for i in ('jogadores', 'pvp', 'guildas', 'classe'))
    check('ranking (cheia): a equipe fica fora das tabelas', 'GM-ODA' not in tabelas and 'Nena' not in tabelas)
    # 02/10: o placar semanal do Eco Primordial
    eco = texto(bloco(h, 'tbody', 'rk-eco'))
    check('ranking (cheia): o placar do Eco com os pontos, o dano e a estrela de quem derrubou',
          '7.500' in eco and '6.000' in eco and '★' in eco and 'Bruno' in eco, eco[:120])
    check('ranking (cheia): o nome do placar do Eco passa pelo SITE.esc', '&lt;i&gt;Brava&lt;/i&gt;' in bloco(h, 'tbody', 'rk-eco'))
    check('ranking (cheia): a semana de agora e a fechada em abas, e as faixas com o título',
          'esta semana' in texto(bloco(h, 'div', 'eco-semanas')) and 'semana de 05/10–11/10' in texto(bloco(h, 'div', 'eco-semanas'))
          and 'Voz do Eco' in texto(bloco(h, 'ul', 'eco-faixas')))
    # 03/10 (revisão): as datas no relógio de Brasília, não no fuso de quem olha
    ini_br, fim_br = (time.strftime('%d/%m', time.gmtime(SUPREMO_CHEIA['semana'][k] - 3 * 3600)) for k in ('inicio', 'fim'))
    check('ranking (cheia): a semana do Eco em datas de Brasília', 'Semana de %s a %s' % (ini_br, fim_br) in texto(h),
          ini_br + ' ' + fim_br)

    h = abre('ranking.html', 'cheia', '#classe=bruxo')
    bt = re.search(r'<button[^>]*data-classe="bruxo"[^>]*>', h)
    check('ranking (cheia): #classe=bruxo abre a do Bruxo, vazia', bool(bt) and 'ligada' in bt.group(0)
          and 'ninguém ainda' in texto(h) and 'Pia' not in texto(bloco(h, 'tbody', 'rk-classe')))

    h = abre('ranking.html', 'vazia', '#classe=sumo')
    check('ranking (vazia): o placar do Eco diz que o primeiro lugar está livre', 'primeiro lugar está livre' in texto(h))
    check('ranking (vazia): 7 abas e ninguém ainda',
          len(re.findall(r'data-classe="', bloco(h, 'div', 'abas-classe'))) == 7 and 'ninguém ainda' in texto(h))
    limpo('ranking (vazia)', h)
    tag = abertura(h, 'aside', 'equipe')
    check('ranking (vazia): sem equipe, a caixa não aparece',
          bool(tag) and escondida(tag) and 'membro' not in bloco(h, 'aside', 'equipe'), tag)

    h = abre('ranking.html', 'fora')
    check('ranking (fora): diz que o servidor está fora', 'servidor está fora' in texto(h))
    limpo('ranking (fora)', h)
    check('ranking (fora): a caixa da equipe fica escondida', escondida(abertura(h, 'aside', 'equipe')))


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
    # 03/10 (a junção com o equilíbrio): o coeficiente da dupla passou a variar com o nível
    # (Fusion.PAIR_TUNE = [k5, k12, k30]) e em várias duplas o número de BASE desce do 1 para o 30
    # (o poder do herói, que sobe, entra depois, na batalha) — a régua é "o número muda com o nível",
    # que é o que prova que ele sai do spellsFor e não de um texto fixo
    check('fusões: os números saem do spellsFor (mudam do nível 1 para o 30)',
          bool(m1 and m30) and (m30.group(1), m30.group(2)) != (m1.group(1), m1.group(2)),
          'nível 1: %s · nível 30: %s' % (m1 and m1.group(0)[-24:], m30 and m30.group(0)[-24:]))

    h = abre('fusoes.html', 'cheia', '#dupla=sumo+minotauro&elementos=fogo+fogo&nivel=12')
    det = texto(secao(h, 'duplas'))
    check('fusões: o par fora de ordem no link abre minotauro+sumo, e fogo+fogo dá Infernal',
          'Trombada Infernal' in det and 'Curral Infernal' in det and 'Ferrolho Infernal' not in det)
    check('fusões: elemento puro diz o bônus do jogo', 'Elemento puro: ×' in texto(h))
    limpo('fusões (minotauro+sumo)', h)


def conta_itens_dados():
    """quantas peças os arquivos de dados declaram, pelo id: o prefixo de calabouço
    (gh- ci- em- av- mt- cp-) ou do Colecionador (sl-), fora os conjuntos (-set-).
    Pelo id, e não pela fábrica: items_extra.js tem item() e loose() (as avulsas),
    e items_selos.js tem peca()."""
    ids = set()
    for f in ('js/core/data/items.js', 'js/core/data/items_extra.js', 'js/core/data/items_selos.js'):
        ids |= set(re.findall(r"\bid:\s*'((?:gh|ci|em|av|mt|cp|sl)-(?!set-)[a-z0-9-]+)'", le(f)))
    return len(ids)


def prova_wiki(abre):
    """11/09: a wiki — tudo lido dos arquivos do jogo; os números esperados aqui
    também saem deles, nunca copiados."""
    textos = []

    def pega(ancora=''):
        h = abre('wiki.html', 'cheia', ancora)
        textos.append(texto(h))
        return h

    h = pega()
    check('wiki: o início abre com as seções', 'Wiki do SOTERRA' in texto(h) and 'href="#/classes"' in h and 'href="#/sistemas"' in h)
    limpo('wiki (início)', h)
    menu_ok('wiki', h)
    lidos = {p for p, c in PEDIDOS if c == '200'}
    faltam = [f for f in ('/js/core/data/spells.js', '/js/core/data/monsters.js', '/js/core/data/dungeons.js',
                          '/js/core/data/items.js', '/js/core/data/items_extra.js', '/js/core/data/items_selos.js',
                          '/js/core/data/pets.js', '/js/core/engine.js', '/js/core/brasa.js') if f not in lidos]
    check('wiki: leu os dados do próprio jogo', not faltam, ', '.join(faltam))

    h = pega('#/classes')
    cls = set(re.findall(r'data-classe="([a-z]+)"', sem_codigo(h)))
    check('wiki: as %d classes' % len(CLASSES), cls == set(CLASSES), ' '.join(sorted(cls)))

    fonte = le('js/core/data/classes.js')
    bloco_sumo = re.search(r"(?s)\n  sumo: \{(.*?)\n  \},", fonte).group(1)
    ids_sumo = set(re.findall(r"'(sumo-[a-z]+-\d+)'", bloco_sumo))
    h = pega('#/classe/sumo')
    feit = set(re.findall(r'<article class="wk-feitico" data-feitico="(sumo-[a-z]+-\d+)"', h))
    check('wiki: o Bárbaro com os %d feitiços da classe (os neutros e os 4 caminhos)' % len(ids_sumo),
          feit == ids_sumo and 'Machadada de Ferro' in texto(h), '%d de %d' % (len(feit), len(ids_sumo)))
    check('wiki: o Bárbaro mostra as fusões da classe (uma por outra classe)',
          len(set(re.findall(r'href="fusoes\.html#dupla=([a-z]+\+[a-z]+)"', h))) == len(CLASSES) - 1)
    limpo('wiki (Bárbaro)', h)

    h = pega('#/calabouco/greenhouse')
    t = texto(h)
    mapas = re.findall(r'<div class="wk-mapa" data-mapa="', h)
    check('wiki: a Estufa com as 3 salas desenhadas e o chefe', len(mapas) == 3 and 'O Vestíbulo das Heras' in t and 'A Jardineira-Viúva' in t,
          '%d mapas' % len(mapas))
    check('wiki: nenhuma chance de saque à vista (MOSTRA_CHANCES desligado)', 'peso no sorteio' not in t)
    limpo('wiki (Estufa)', h)
    # 21/09: com o Coração Partido aberto NÃO SOBROU portal fechado, e a régua
    # vira do avesso — em vez de cobrar o "Em breve" de um trancado, cobra que
    # o último a abrir desenhe as três salas como os outros cinco. Se um
    # calabouço novo entrar trancado, o ramo de cima volta a valer sozinho.
    if FECHADOS:
        h = pega('#/calabouco/' + FECHADOS[0])
        check('wiki: calabouço de portal fechado sai "Em breve", sem salas', 'Em breve' in texto(h) and 'data-mapa=' not in sem_codigo(h))
    else:
        h = pega('#/calabouco/brokenheart')
        mapas_cp = re.findall(r'<div class="wk-mapa" data-mapa="', h)
        check('wiki: sem portal fechado, o Coração Partido abre com as 3 salas e o chefe',
              len(mapas_cp) == 3 and 'Em breve' not in texto(h) and 'O Coração Partido' in texto(h),
              '%d mapas' % len(mapas_cp))

    h = pega('#/bestiario')
    grupos = set(re.findall(r'<h2><a href="#/calabouco/([a-z]+)"', h))
    check('wiki: o bestiário só abre os calabouços abertos', bool(grupos) and not (grupos & set(FECHADOS)), ' '.join(sorted(grupos)))
    if not FECHADOS:
        check('wiki: com tudo aberto, os SEIS calabouços aparecem no bestiário',
              len(grupos) == 6, ' '.join(sorted(grupos)))
    limpo('wiki (bestiário)', h)
    # 11/09: o retrato de cada bicho vem do 3D do jogo (tools/retratos_site.py);
    # a invocação de fusão usa a foto da obra. Todo arquivo pedido existe.
    corpo = sem_codigo(h)
    # 02/10: `_` no id — sem ele os quatro Colossos do Poço (colosso_fogo...)
    # ficavam fora da conta e o "cada monstro com retrato" passava sem vê-los
    fotos = re.findall(r'data-monstro="([a-z0-9_-]+)"><span class="busto[^"]*"[^>]*><img src="img/((?:monstro|obra)-[a-z0-9_-]+\.webp)"', corpo)
    cartoes = re.findall(r'data-monstro="([a-z0-9_-]+)"', corpo)
    sem_arq = [f for _, f in fotos if not os.path.exists(os.path.join(RAIZ, 'site', 'img', f))]
    check('wiki: cada monstro do bestiário com o retrato do jogo, e o arquivo existe',
          bool(cartoes) and len(fotos) == len(cartoes) and not sem_arq,
          '%d fotos em %d cartões%s' % (len(fotos), len(cartoes), ('; faltam ' + ', '.join(sem_arq[:5])) if sem_arq else ''))
    golpes = re.search(r"(?s)'boss-gardener':\s*\{.*?spells:\s*\[([^\]]*)\]", le('js/core/data/monsters.js')).group(1)
    n_golpes = len(re.findall(r"'m-[a-z0-9-]+'", golpes))
    h = pega('#/monstro/boss-gardener')
    t = texto(h)
    check('wiki: a Jardineira-Viúva com a ficha, os traços e os %d golpes' % n_golpes,
          'A Jardineira-Viúva' in t and 'não pode ser empurrado' in t and 'fúria' in t and
          len(re.findall(r'data-feitico="m-', h)) == n_golpes)
    check('wiki: a Jardineira-Viúva com o retrato do jogo no cabeçalho', 'src="img/monstro-boss-gardener.webp"' in h)
    limpo('wiki (chefe)', h)

    esperado = conta_itens_dados()
    h = pega('#/itens')
    itens = set(re.findall(r'data-item="([a-z0-9-]+)"', sem_codigo(h)))
    check('wiki: a lista de itens tem as %d peças dos dados' % esperado, len(itens) == esperado, '%d' % len(itens))
    check('wiki: nada da Panóplia do Mestre', not any(i.startswith('gm-') for i in itens))
    limpo('wiki (itens)', h)
    h = pega('#/itens?espaco=passo&raridade=raro')
    filtrados = set(re.findall(r'data-item="([a-z0-9-]+)"', sem_codigo(h)))
    check('wiki: o filtro do endereço (passo, raro) corta a lista', 0 < len(filtrados) < len(itens), '%d' % len(filtrados))
    nivel = re.search(r'greenhouse:\s*\{\s*comum:\s*\d+,\s*raro:\s*\d+,\s*epico:\s*(\d+)', le('js/core/data/items.js')).group(1)
    h = pega('#/item/gh-widow-shears')
    t = texto(h)
    check('wiki: o Tesourão da Viúva: +1 PA, o conjunto e o nível de uso %s' % nivel,
          'Tesourão da Viúva' in t and '+1 PA' in t and 'Traje da Flora Voraz' in t and ('nível ' + nivel) in t)
    check('wiki: o ícone do item vem da miniatura (img/item-<id>.webp)', 'src="img/item-gh-widow-shears.webp"' in h)
    limpo('wiki (item)', h)

    h = pega('#/pets')
    corpo = sem_codigo(h)
    fotos = re.findall(r'data-pet="([a-z0-9-]+)"><span class="busto[^"]*"[^>]*><img src="img/(pet-[a-z0-9-]+\.webp)"', corpo)
    cartoes = re.findall(r'data-pet="([a-z0-9-]+)"', corpo)
    sem_arq = [f for _, f in fotos if not os.path.exists(os.path.join(RAIZ, 'site', 'img', f))]
    check('wiki: cada pet com o retrato do jogo, e o arquivo existe',
          bool(cartoes) and len(fotos) == len(cartoes) and not sem_arq,
          '%d fotos em %d cartões%s' % (len(fotos), len(cartoes), ('; faltam ' + ', '.join(sem_arq[:5])) if sem_arq else ''))
    limpo('wiki (pets)', h)
    # 11/09: o selo do Calabouço do Dia usava a classe .dia, que o site.css já
    # dá às células do calendário (min-height 128 px) — virou um balão oval no
    # ar. Nenhum modificador dos selos da wiki pode ter regra solta no site.css.
    css = le('site/site.css')
    mods = set(re.findall(r'wk-(?:selo|el|rar|nivel) ([a-z][a-z0-9-]*)', le('site/wiki.js')))
    colide = sorted(m for m in mods if re.search(r'(?:^|[\s,>+~}])\.' + re.escape(m) + r'(?![\w-])', css, re.M))
    check('wiki: nenhum selo da wiki pega regra do site.css pela classe (o .dia virou balão)', bool(mods) and not colide, ', '.join(colide))

    h = pega('#/busca/jardineira')
    check('wiki: a busca acha a Jardineira-Viúva', 'A Jardineira-Viúva' in texto(h) and 'data-tipo="Chefe"' in h)

    tique = re.search(r'Engine\.WEATHER_TICK\s*=\s*(\d+)', le('js/core/engine.js')).group(1)
    teto = re.search(r'(?s)DATA\.upgrade\s*=\s*\{\s*maxLevel:\s*(\d+)', le('js/core/data/items.js')).group(1)
    h = pega('#/sistemas')
    t = texto(h)
    check('wiki: o clima diz o tique lido do motor (%s PV)' % tique, ('ganha %s PV' % tique) in t)
    check('wiki: a forja com a última batida (+%d → +%s)' % (int(teto) - 1, teto), ('+%d → +%s' % (int(teto) - 1, teto)) in t)
    check('wiki: as coroas da Arena, da primeira à última', 'Coroa I ' in t + ' ' and 'Coroa X' in t)
    limpo('wiki (regras)', h)
    check('wiki: o número do clima não está escrito no código da wiki', not re.search(r'ganha\s*%s\s*PV' % tique, le('site/wiki.js')))
    # o nome do outro jogo vem codificado: a regra do dono vale até para a prova que o procura
    outro = base64.b64decode('ZG9mdXM=').decode()
    check('wiki: nenhum outro jogo citado', not any(outro in x.lower() for x in textos) and
          not any(outro in le(f).lower() for f in ('site/wiki.js', 'site/wiki.html', 'site/wiki.css')))


def prova_index(abre):
    h = abre('index.html', 'cheia')
    ev = secao(h, 'eventos')
    te = texto(ev)
    check('landing (cheia): #eventos com o evento no ar e a contagem', 'Quinta do XP' in te and 'termina em' in te)
    ids = dias_do_calabouco(ev)
    # 11/09 (pedido do dono): só o Dia de HOJE; a semana fica no calendário de eventos.html
    check('landing (cheia): só o Calabouço do Dia de hoje, de portal aberto e com o link da wiki',
          len(ids) == 1 and ids[0] not in FECHADOS and ('href="wiki.html#/calabouco/%s"' % ids[0]) in ev, ' '.join(ids))
    check('landing (cheia): o próximo evento em "Em breve"', 'Maré da Cisterna' in te)
    fotos = re.findall(r'<a class="cartao" href="wiki\.html#/classe/([a-z]+)">\s*<div class="foto retrato"[^>]*data-classe="([a-z]+)"'
                       r'[^>]*><img src="img/classe-([a-z]+)\.webp"', h)
    check('landing (cheia): os 7 cartões de classe com o retrato quadrado pelo id, e cada um leva à wiki',
          len(fotos) == 7 and all(a == b == c for a, b, c in fotos) and sorted(c for a, b, c in fotos) == sorted(CLASSES),
          ' '.join(c for a, b, c in fotos))
    # 11/09: o portal aberto mostra o chefe (a capa larga do retratos_site) e leva à wiki
    ca = secao(h, 'calaboucos')
    abertos = [d for d in re.findall(r"^    id: '([a-z]+)',", le('js/core/data/dungeons.js'), re.M) if d not in FECHADOS]
    capas = re.findall(r'<a class="cartao" href="wiki\.html#/calabouco/([a-z]+)">\s*<div class="foto"[^>]*>\s*'
                       r'<span class="etiqueta aberto">[^<]*</span>\s*<img src="img/(monstro-boss-[a-z0-9-]+-capa\.webp)"', ca)
    sem = [f for _, f in capas if not os.path.exists(os.path.join(RAIZ, 'site', 'img', f))]
    check('landing (cheia): cada portal aberto com a capa do chefe e o link da wiki',
          bool(abertos) and sorted(c for c, _ in capas) == sorted(abertos) and not sem,
          'capas: %s · abertos: %s%s' % (' '.join(c for c, _ in capas), ' '.join(abertos), ('; faltam ' + ', '.join(sem)) if sem else ''))
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
    check('landing (fora): a nota do servidor fora e o Dia de hoje',
          'servidor está fora' in texto(ev) and len(dias_do_calabouco(ev)) == 1)
    limpo('landing (fora)', h)

    h = abre('conta.html', 'cheia')
    menu_ok('conta', h)
    limpo('conta', h)
    esq = re.search(r'<a\b[^>]*\bid="esqueci"[^>]*>', h)
    check('conta (sem correio): o "esqueci a senha" continua desligado', bool(esq) and 'desligado' in esq.group(0))


def prova_loja(abre):
    """Fase C e loja 2: a loja pública (sem sessão) com o catálogo v2 do contrato"""
    h = abre('loja.html', 'cheia')
    t = texto(h)
    secoes = re.findall(r'<section class="loja-secao[^"]*" data-secao="([a-z-]+)"', sem_codigo(h))
    check('loja (cheia): as sete seções, na ordem do servidor (13/09: as duas trocas antes)',
          secoes == ['vintens', 'barras-por-vintens', 'personagens', 'bonus', 'pedras', 'guilda', 'pergaminhos'],
          ' '.join(secoes))
    check('loja (cheia): os preços do servidor, cada um na sua moeda (barras de ouro; a troca por barras em vinténs)',
          '500 barras' in t and '75 barras' in t and '25 barras' in t and '225 barras' in t and '250 barras' in t
          and '800 vinténs' in t and '50 barras' in t)
    check('loja (cheia): sem sessão, "Entre para comprar"', t.count('Entre para comprar') >= 7)
    check('loja (cheia): a barra de ouro é um SVG da página, sem imagem de fora',
          h.count('class="ico-barra') >= 6 and 'barra' not in ' '.join(re.findall(r'<img[^>]+src="([^"]+)"', h)))
    check('loja (cheia): "Barras por vinténs" explica o caminho de quem farma com o câmbio do servidor',
          'para quem farma' in t and 'cada barra de ouro custa 80 vinténs' in t)
    pac = bloco(h, 'section', 'lj-pacotes')
    check('loja (cheia): os pacotes de barras de ouro "em breve", com o preço em reais do servidor',
          'em breve' in texto(pac) and 'R$ 4,90' in texto(pac) and 'Bolsa de 50 barras de ouro' in texto(pac)
          and 'Barras de Ouro' in texto(pac))
    check('loja (cheia): com os pagamentos desligados, nenhum pedido a /api/pagamento/*',
          not [c for v, m, c, cod in PEDIDOS_API if c.startswith('/api/pagamento/')])
    check('loja (cheia): o retrato do personagem pelo id da classe', 'src="img/classe-invocador.webp"' in h)
    limpo('loja (cheia)', h)
    menu_ok('loja', h)

    h = abre('loja.html', 'vazia')
    check('loja (vazia): diz que está vazia', 'A loja está vazia por enquanto.' in texto(h))
    limpo('loja (vazia)', h)

    h = abre('loja.html', 'fora')
    check('loja (fora): diz que o servidor está fora', 'servidor está fora' in texto(h))
    limpo('loja (fora)', h)


def prova_mestre(abre):
    """10/09: o painel do Mestre sem sessão — o portão, e nenhum pedido à API"""
    antes = len(PEDIDOS_API)
    h = abre('mestre.html', 'cheia')
    t = texto(h)
    check('mestre (sem sessão): o portão pede para entrar com a conta do Mestre',
          'Entre com a conta do Mestre' in t and 'data-portao="fora"' in h)
    check('mestre (sem sessão): nenhum pedido à API (nem /api/eu, nem /api/mestre/*)', len(PEDIDOS_API) == antes,
          repr(PEDIDOS_API[antes:][:3]))
    m = re.search(r'(?s)<nav>(.*?)</nav>', h)
    check('mestre (sem sessão): o link "Mestre" sai do menu', bool(m) and 'mestre.html' not in m.group(1))
    check('mestre: fora dos buscadores (noindex)', 'name="robots" content="noindex, nofollow"' in h)
    limpo('mestre', h)
    menu_ok('mestre', h)


# ---- a integração com a API de verdade (--api-real) --------------------------------
def versao_termos():
    """02/10: a versão dos Termos de Uso que o cadastro exige aceitar (servidor/privacidade.py)."""
    with open(os.path.join(RAIZ, 'servidor', 'privacidade.py'), encoding='utf-8') as f:
        return re.search(r"VERSAO_TERMOS = '([^']+)'", f.read()).group(1)


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
                                                     'senha': 'segredo-bom-8', 'aceiteTermos': versao_termos()})
        check('api real: a conta nasce', st == 201, str(r)[:120])
        token = r.get('token')
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
        # o Mestre é OUTRA conta: desde 10/09 a equipe fica fora do ranking, e
        # Pia tem de continuar nas tabelas. A marca é do sqlite, como no teste da caixa
        st, r = pede(base, 'POST', '/api/cadastro', {'nome': 'Guia Firme', 'email': 'guia.firme@soterra.test',
                                                     'senha': 'segredo-bom-8', 'aceiteTermos': versao_termos()})
        check('api real: a conta do Mestre nasce', st == 201, str(r)[:120])
        token_m, cid_m = r.get('token'), (r.get('conta') or {}).get('id')
        con = sqlite3.connect(banco)
        con.execute('UPDATE contas SET gm = 1 WHERE id = ?', (cid_m,))
        con.commit()
        con.close()
        agora = int(time.time())
        st, r = pede(base, 'POST', '/api/eventos', {'tipo': 'xp', 'multiplicador': 2, 'calabouco': None,
                                                   'titulo': 'Quinta do XP', 'texto': 'Toda sala paga o dobro de experiência.',
                                                   'fim': agora + 14 * 3600}, token_m)
        check('api real: o Mestre liga um evento (201)', st == 201, '%s %s' % (st, str(r)[:120]))
        st, r = pede(base, 'POST', '/api/eventos/regras', {'tipo': 'saque', 'multiplicador': 1.5, 'calabouco': 'cistern',
                                                          'titulo': 'Maré da Cisterna', 'texto': '', 'dias': [6],
                                                          'hora': '10:00', 'duracaoMin': 720,
                                                          'vigenteDe': None, 'vigenteAte': None}, token_m)
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
        eq = texto(bloco(h, 'aside', 'equipe'))
        check('api real: o Mestre sai na caixa da equipe, e só nela',
              'Guia Firme' in eq and not escondida(abertura(h, 'aside', 'equipe'))
              and 'Guia Firme' not in texto(bloco(h, 'tbody', 'rk-jogadores')), eq[:80])
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
    """As páginas do site pedem a folha e os scripts pelo mapa do build (SITE_URL,
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
    check("as %d páginas pedem a folha e os scripts pelo mapa do build (SITE_URL) e, sem mapa, pelo carimbo ?t= "
          "(nunca ?v=' + Date.now())" % len(PAGINAS), not ruins, '; '.join(ruins[:4]))


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
                                           '/api/saude': SAUDE, '/api/loja/catalogo': CATALOGO_CHEIA,
                                           '/api/supremo/ranking': SUPREMO_CHEIA}),
                                ('vazia', {'/api/eventos': EVENTOS_VAZIA, '/api/ranking': RANKING_VAZIA,
                                           '/api/saude': SAUDE, '/api/loja/catalogo': CATALOGO_VAZIA,
                                           '/api/supremo/ranking': SUPREMO_VAZIA})):
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
        prova_wiki(abre)
        prova_index(abre)
        prova_loja(abre)
        prova_mestre(abre)

        faltas = sorted({p for p, c in PEDIDOS if c == '404' and not p.startswith('/site/img/') and p != '/favicon.ico'})
        check('nenhum arquivo pedido pelas páginas falta (0 × 404 fora de /site/img/)', not faltas, ', '.join(faltas[:6]))
        imgs = sorted({p for p, c in PEDIDOS if p.startswith('/site/img/')})
        tortas = [p for p in imgs if not img_no_contrato(p)]
        check('todo pedido a /site/img/ segue o contrato dos retratos', not tortas, ', '.join(tortas[:6]))
        if imgs:
            print('  (%d fotos pedidas em site/img/, %d ainda sem arquivo: a moldura mostra a inicial)'
                  % (len(imgs), len({p for p, c in PEDIDOS if c == '404' and p.startswith('/site/img/')})))
        rotas = sorted({(m, c) for v, m, c, cod in PEDIDOS_API if cod != 200})
        check('as páginas só pedem à API rotas que ela conhece (eventos, ranking, saude, loja/catalogo, supremo/ranking)',
              not rotas, repr(rotas[:4]))
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
