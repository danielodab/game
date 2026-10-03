#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Os retratos do site, fotografados do próprio 3D do jogo (10/09).

    python tools/retratos_site.py                     # os 11 lotes (classes, fusões e bichos)
    python tools/retratos_site.py --lote classes      # só um lote (pode repetir)
    python tools/retratos_site.py --lote pets         # um dos 4 lotes dos bichos da wiki (11/09)
    python tools/retratos_site.py --obras             # soma o lote das 6 obras de fusão
    python tools/retratos_site.py --lote equipe       # o Cavaleiro Negro da caixa da equipe (ranking)
    python tools/retratos_site.py --motor gpu         # headless com a placa de vídeo
    python tools/retratos_site.py --folha folha.png   # no fim, a foto da folha de conferência
    python tools/retratos_site.py --so-confere        # não fotografa: só confere site/img/

O site mostra as 7 classes e as 21 fusões com a arte do Daniel, e a única fonte
dessa arte é o 3D do jogo. Este script serve a raiz do repositório numa porta
livre e abre tools/retratos_site.html?lote=<nome> no Chrome. A página tira as
fotos com `Models3D2.portrait` e manda cada uma pela rota local POST /__grava,
que só escreve em site/img/ e só com nome que case NOME_OK. A página avisa o
fim por POST /__fim, e o Chrome daquele lote é encerrado.

Por que um Chrome NOVO (--user-data-dir novo) por lote: cada lote carrega um
arquivo de fusões diferente (de 1,5 a 17 MB de GLB em base64), e o motor
decodifica TODOS os JOGO.MODELS carregados. Um lote por página segura a
memória; o perfil novo garante que nada de um lote vaze para o outro.

Motores (--motor). Nenhum dos dois primeiros abre janela na área de trabalho:
  swiftshader (padrão)  headless por software (--use-angle=swiftshader
                 --enable-unsafe-swiftshader). O README avisa que o headless
                 sai pálido, mas isso vale para a cena do jogo: medido em
                 10/09 na mesma fusão, o retrato por SwiftShader e o da Iris
                 Xe diferem em menos de 1 ponto de saturação média (115,3
                 contra 116,0 em 255) e têm a mesma cor média. A figura e o
                 fundo são desenhados pelo mesmo caminho nos dois.
  gpu            headless com a placa de vídeo (ANGLE D3D11 no Windows).
  janela         o Chrome com janela, como o plano pedia de início.
A página conta qual placa desenhou, e o script mostra.

No fim confere 7+7+21+21 arquivos (mais as 6 obras, se pedidas): cada um
tem de existir, ser WebP (ou PNG) de verdade, quadrado no tamanho do
contrato e dentro da faixa de peso. Sai com erro se faltar algum. O plano
pedia de 8 a 400 KB, pensando em PNG; em WebP q 0,9 o busto de 128 px de
verdade pesa 3 a 6 KB e a obra de 256 px uns 7 KB. O piso sai do tamanho: o
dobro do que pesa um fundo SEM figura (medido em 10/09: até 1,1 KB em
128 px, 1,7 em 256, 2,6 em 384 e 3,9 em 512). A trava forte contra foto
vazia é a da página, que recusa miolo liso antes de gravar. A folha
(tools/retratos_site.html?ver=1) passa pelo olho do dono antes do commit
(decisão D12).

O lote `equipe` (10/09) fotografa o corpo do Mestre (meshy_gm, de
assets/embedded/models-gm.js) para a caixa "Equipe do SOTERRA" do ranking:
equipe-cavaleiro.webp (512 px) e equipe-cavaleiro-busto.webp (128 px), no
mesmo estilo das classes. Só roda quando pedido; a conferência dele também.

Os BICHOS da wiki (11/09): os lotes bichos-estufa, bichos-cisterna,
bichos-invocacoes e pets fotografam monstros e pets com o quadro do próprio
motor (o retrato da linha do tempo da batalha; o pet, de corpo inteiro como
no inventário), 256 px: monstro-<id>.webp e pet-<id sem o "pet-">.webp. De
cada chefe sai também a capa larga da landing, monstro-<id>-capa.webp
(768×480, a moldura 16:10 dos calabouços). As invocações das fusões usam a
foto do lote obras. A conferência sabe quem esperar pelas chaves de
JOGO.MODELS dos arquivos embutidos e pelos monstros sem calabouço.

tools/ não vai para o contêiner (.dockerignore); site/img/ vai.
"""
import argparse
import functools
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
IMG = os.path.join(RAIZ, 'site', 'img')
PAGINA = 'tools/retratos_site.html'
# 02/10: `_` também — os Colossos do Poço têm id com sublinhado (colosso_fogo...)
NOME_OK = re.compile(r'^(classe|fusao|obra|equipe|monstro|pet)-[a-z0-9_-]+(-busto)?\.(webp|png)$')
# 11/09: os bichos da wiki — monstros dos portais abertos, invocações do Xamã e pets
LOTES_BICHOS = ['bichos-estufa', 'bichos-cisterna', 'bichos-fecho', 'bichos-andaimes', 'bichos-mina',
                'bichos-coracao', 'bichos-invocacoes', 'pets']
LOTES = ['classes', 'fus-sumo', 'fus-minotauro', 'fus-cacador', 'fus-curandeira', 'fus-bruxo-ladino', 'fus-xama'] + LOTES_BICHOS
LOTE_OBRAS = 'obras'
LOTE_EQUIPE = 'equipe'           # o Cavaleiro Negro (meshy_gm): a caixa da equipe no ranking
TEMPO_LOTE = 600                 # segundos por lote, com folga: o maior lote decodifica ~30 MB de GLB
KB = 1024
PISO_KB = {128: 2, 256: 3, 384: 5, 480: 6, 512: 8}   # o mesmo da página (PISO_KB); ver o docstring
TETO_KB = 400
TAM = {'classe': 512, 'fusao': 384, 'obra': 256, 'busto': 128, 'bicho': 256}   # plano §1.8 (+ bicho, 11/09)
CAPA = (768, 480)                # a capa do chefe na landing: 16:10, como a moldura .foto
MAX_POST = 4 * 1024 * KB
CHROMES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
]
# sem isto o Chrome com janela coberta por outra (ou o headless em segundo
# plano) freia os timers, e a espera por voltas da página vira espera eterna
COMUNS = ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
          '--disable-background-networking', '--disable-component-update', '--mute-audio',
          '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows']
MOTORES = {
    'gpu': ['--headless=new', '--hide-scrollbars'] + (['--use-angle=d3d11'] if os.name == 'nt' else []),
    'swiftshader': ['--headless=new', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    'janela': ['--new-window', '--window-size=960,900'],
}


# ----------------------------------------------------------------- quem existe
def ids_das_classes():
    """As classes jogáveis, lidas de js/core/data/classes.js (sem terceira cópia).
    A classe gm só nasce com a chave do Mestre (js/core/gm.js): nunca aparece aqui."""
    with open(os.path.join(RAIZ, 'js', 'core', 'data', 'classes.js'), encoding='utf-8') as f:
        ids = re.findall(r"^    id: '([a-z0-9]+)',", f.read(), re.M)
    return [i for i in ids if i != 'gm']


def ids_das_obras():
    with open(os.path.join(RAIZ, 'js', 'core', 'data', 'fusions.js'), encoding='utf-8') as f:
        return re.findall(r"^    '(fus-[a-z0-9-]+)': summonDef\(", f.read(), re.M)


def pares(ids):
    o = sorted(ids)
    return [(o[i], o[j]) for i in range(len(o)) for j in range(i + 1, len(o))]


def esperados(com_obras, com_equipe=False):
    """[(nome sem extensão, lado em px)] — o contrato da seção 1.8 do plano."""
    ids = ids_das_classes()
    out = []
    for c in ids:
        out += [('classe-%s' % c, TAM['classe']), ('classe-%s-busto' % c, TAM['busto'])]
    for a, b in pares(ids):
        out += [('fusao-%s-%s' % (a, b), TAM['fusao']), ('fusao-%s-%s-busto' % (a, b), TAM['busto'])]
    if com_obras:
        out += [('obra-%s' % o, TAM['obra']) for o in ids_das_obras()]
    if com_equipe:
        out += [('equipe-cavaleiro', TAM['classe']), ('equipe-cavaleiro-busto', TAM['busto'])]
    return out


def chaves_modelo(arquivo):
    """As chaves de JOGO.MODELS de um arquivo embutido (o nome de cada corpo)."""
    with open(os.path.join(RAIZ, 'assets', 'embedded', arquivo), encoding='utf-8') as f:
        return sorted(set(re.findall(r"JOGO\.MODELS\['([a-z0-9_-]+)'\]\s*=", f.read())))


def invocacoes_sem_calabouco():
    """Os monstros de monsters.js sem dungeonId (as invocações do Xamã): a wiki
    mostra todos, e o lote bichos-invocacoes fotografa cada um."""
    with open(os.path.join(RAIZ, 'js', 'core', 'data', 'monsters.js'), encoding='utf-8') as f:
        fonte = f.read()
    # só bloco com ficha (stats): os golpes m-* moram no mesmo arquivo e não têm calabouço
    return [i for i, corpo in re.findall(r"(?s)\n    '([a-z0-9-]+)': \{(.*?)\n    \}", fonte)
            if re.search(r'\bstats\s*:', corpo) and 'dungeonId' not in corpo]


def esperados_bichos():
    """[(nome sem extensão, (largura, altura))] dos bichos da wiki (11/09). Os
    corpos da Estufa e da Cisterna têm o nome do monstro que os veste."""
    out = []
    donos = (chaves_modelo('models-meshy-jardim.js') + chaves_modelo('models-meshy-cisterna.js') +
             chaves_modelo('models-meshy-emberlock.js') + chaves_modelo('models-meshy-windscaffold.js') +
             chaves_modelo('models-meshy-quakemine.js') +
             chaves_modelo('models-meshy-brokenheart.js') +
             # os dois da Mina que vestem corpo emprestado nao tem chave propria
             # em nenhum arquivo: a wiki pede o retrato pelo ID DO MONSTRO
             ['ore-chip', 'crystal-chanter'])
    for i in sorted(set(donos + invocacoes_sem_calabouco())):
        out.append(('monstro-' + i, (TAM['bicho'], TAM['bicho'])))
        if i.startswith('boss-'):
            out.append(('monstro-%s-capa' % i, CAPA))
    for p in chaves_modelo('models-pets.js'):
        out.append(('pet-' + re.sub(r'^pet-', '', p), (TAM['bicho'], TAM['bicho'])))
    return out


def lista_img():
    if not os.path.isdir(IMG):
        return []
    return [{'nome': n, 'bytes': os.path.getsize(os.path.join(IMG, n))}
            for n in sorted(os.listdir(IMG)) if NOME_OK.match(n)]


def formato_ok(dados, ext):
    if ext == 'webp':
        return dados[:4] == b'RIFF' and dados[8:12] == b'WEBP'
    return dados[:8] == b'\x89PNG\r\n\x1a\n'


def dimensoes(dados):
    """(largura, altura) lidas do cabeçalho do WebP (VP8, VP8L ou VP8X) ou do
    PNG, sem biblioteca de imagem; None se o cabeçalho não for reconhecido."""
    if dados[:4] == b'RIFF' and dados[8:12] == b'WEBP' and len(dados) >= 30:
        tipo = dados[12:16]
        if tipo == b'VP8 ' and dados[23:26] == b'\x9d\x01\x2a':
            return (int.from_bytes(dados[26:28], 'little') & 0x3fff,
                    int.from_bytes(dados[28:30], 'little') & 0x3fff)
        if tipo == b'VP8L' and dados[20] == 0x2f:
            v = int.from_bytes(dados[21:25], 'little')
            return ((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1)
        if tipo == b'VP8X':
            return (int.from_bytes(dados[24:27], 'little') + 1, int.from_bytes(dados[27:30], 'little') + 1)
        return None
    if dados[:8] == b'\x89PNG\r\n\x1a\n' and len(dados) >= 24:
        return (int.from_bytes(dados[16:20], 'big'), int.from_bytes(dados[20:24], 'big'))
    return None


# ----------------------------------------------------------------- o servidor
class Estado:
    def __init__(self):
        self.trava = threading.Lock()
        self.vez = None
        self.lote = None
        self.fim = None
        self.evento = threading.Event()
        self.gravados = []
        self.nao_achados = []

    def novo(self, lote):
        with self.trava:
            self.vez = '%s-%d' % (lote, time.monotonic_ns() % 10 ** 9)
            self.lote = lote
            self.fim = None
            self.evento = threading.Event()
            self.gravados = []
            self.nao_achados = []
            return self.vez


ESTADO = Estado()


class Atendente(http.server.SimpleHTTPRequestHandler):
    def log_request(self, code='-', size='-'):
        c = str(getattr(code, 'value', code))
        caminho = self.path.split('?')[0]
        if c == '404' and caminho != '/favicon.ico':
            ESTADO.nao_achados.append(caminho)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, codigo, obj):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path.split('?')[0] == '/__lista':
            return self._json(200, {'ok': True, 'arquivos': lista_img()})
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_POST:
            return self._json(413, {'ok': False, 'erro': 'corpo grande demais'})
        corpo = self.rfile.read(n) if n else b''
        vez = (q.get('vez') or [''])[0]
        if u.path not in ('/__grava', '/__log', '/__fim'):
            return self._json(404, {'ok': False, 'erro': 'rota desconhecida'})
        # um Chrome de lote vencido (encerrado por tempo) não grava por cima do atual
        if not vez or vez != ESTADO.vez:
            return self._json(403, {'ok': False, 'erro': 'vez vencida'})

        if u.path == '/__grava':
            nome = (q.get('nome') or [''])[0]
            if not NOME_OK.match(nome) or os.path.basename(nome) != nome:
                return self._json(400, {'ok': False, 'erro': 'nome fora do padrão: %r' % nome})
            ext = nome.rsplit('.', 1)[1]
            if not formato_ok(corpo, ext):
                return self._json(400, {'ok': False, 'erro': 'o conteúdo não é %s' % ext.upper()})
            os.makedirs(IMG, exist_ok=True)
            destino = os.path.join(IMG, nome)
            tmp = destino + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(corpo)
            os.replace(tmp, destino)
            with ESTADO.trava:
                ESTADO.gravados.append((nome, len(corpo)))
            return self._json(200, {'ok': True, 'arquivo': nome, 'bytes': len(corpo)})

        try:
            dados = json.loads(corpo.decode('utf-8') or '{}')
        except ValueError:
            return self._json(400, {'ok': False, 'erro': 'JSON torto'})
        if u.path == '/__log':
            print('   [%s] %s' % (ESTADO.lote, str(dados.get('linha', ''))[:400]), flush=True)
            return self._json(200, {'ok': True})
        with ESTADO.trava:
            ESTADO.fim = dados
        ESTADO.evento.set()
        return self._json(200, {'ok': True})


# ----------------------------------------------------------------- o Chrome
def mata(proc):
    if proc.poll() is not None:
        return
    if os.name == 'nt':
        # /T leva junto os filhos (GPU, renderizador): sobra de Chrome zumbi
        # rouba CPU e derruba as provas headless seguintes
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.kill()
    try:
        proc.wait(timeout=15)
    except Exception:
        pass


def apaga_perfil(perfil):
    for _ in range(20):
        shutil.rmtree(perfil, ignore_errors=True)
        if not os.path.exists(perfil):
            return
        time.sleep(0.5)          # o Chrome ainda solta os arquivos do perfil


def roda_lote(chrome, motor, base, lote, ss):
    vez = ESTADO.novo(lote)
    perfil = tempfile.mkdtemp(prefix='soterra-retratos-')
    url = base + PAGINA + '?lote=%s&vez=%s&ss=%d' % (lote, vez, ss)
    cmd = [chrome] + MOTORES[motor] + COMUNS + ['--user-data-dir=' + perfil, url]
    print('== lote %s (%s)' % (lote, motor), flush=True)
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    erro = None
    try:
        while not ESTADO.evento.wait(1.0):
            if proc.poll() is not None:
                erro = 'o Chrome fechou antes do fim da página (código %s)' % proc.returncode
                break
            if time.time() - t0 > TEMPO_LOTE:
                erro = 'o lote passou de %d s' % TEMPO_LOTE
                break
    finally:
        mata(proc)
        apaga_perfil(perfil)
    fim = ESTADO.fim or {}
    faltou = sorted(set(ESTADO.nao_achados))
    if faltou:
        erro = (erro + '; ' if erro else '') + 'a página pediu arquivos que não existem: ' + ', '.join(faltou[:8])
    if not erro and not fim.get('ok'):
        erro = ' · '.join(fim.get('erros') or ['a página terminou sem dizer por quê'])
    motor_gl = str(fim.get('motor') or '')
    if motor_gl:
        print('   WebGL: %s' % motor_gl)
        if motor == 'gpu' and 'swiftshader' in motor_gl.lower():
            print('   AVISO: pedi a placa de vídeo e o Chrome desenhou por software (SwiftShader): as cores saem pálidas')
    for av in fim.get('avisos') or []:
        print('   AVISO: %s' % av)
    n = len(ESTADO.gravados)
    peso = sum(b for _, b in ESTADO.gravados)
    if erro:
        print('   FALHOU · %s (%d fotos gravadas antes)' % (erro, n), flush=True)
        return False
    print('   ok · %d fotos, %.1f KB, %.0f s' % (n, peso / KB, time.time() - t0), flush=True)
    return True


def foto_folha(chrome, base, destino):
    """A folha de conferência em PNG, 1400×3600 (com os bichos, 11/09), pelo Chrome headless."""
    perfil = tempfile.mkdtemp(prefix='soterra-retratos-folha-')
    destino = os.path.abspath(destino)
    os.makedirs(os.path.dirname(destino) or '.', exist_ok=True)
    if os.path.exists(destino):
        os.remove(destino)
    cmd = [chrome, '--headless=new', '--hide-scrollbars', '--window-size=1400,3600',
           '--virtual-time-budget=20000', '--screenshot=' + destino] + COMUNS + \
          ['--user-data-dir=' + perfil, base + PAGINA + '?ver=1']
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    except subprocess.TimeoutExpired:
        pass
    finally:
        apaga_perfil(perfil)
    ok = os.path.exists(destino) and os.path.getsize(destino) > 0
    print('== folha de conferência: %s' % (destino if ok else 'NÃO saiu'))
    return ok


# ----------------------------------------------------------------- a conferência
def confere(com_obras, com_equipe=False):
    faltas, fora, duplas, total, n = [], [], [], 0, 0
    lista = esperados(com_obras, com_equipe) + esperados_bichos()
    for base, lado in lista:
        larg, alt = lado if isinstance(lado, tuple) else (lado, lado)     # a capa do chefe é larga
        achados = [base + e for e in ('.webp', '.png') if os.path.exists(os.path.join(IMG, base + e))]
        if not achados:
            faltas.append(base)
            continue
        if len(achados) > 1:
            duplas.append(base)
        arq = achados[0]
        caminho = os.path.join(IMG, arq)
        tam = os.path.getsize(caminho)
        with open(caminho, 'rb') as f:
            cabeca = f.read(32)
        n += 1
        total += tam
        ext = arq.rsplit('.', 1)[1]
        dim = dimensoes(cabeca)
        if not (PISO_KB[alt] * KB <= tam <= TETO_KB * KB):
            fora.append('%s (%.1f KB; piso %d KB em %d px)' % (arq, tam / KB, PISO_KB[alt], alt))
        elif not formato_ok(cabeca, ext):
            fora.append('%s (não é %s de verdade)' % (arq, ext.upper()))
        elif dim != (larg, alt):
            fora.append('%s (%s, esperado %d×%d)' % (arq, '%d×%d' % dim if dim else 'sem medida', larg, alt))
    esp = len(lista)
    print('== conferência de site/img/: %d de %d arquivos, %.2f MB no total' % (n, esp, total / KB / KB))
    if faltas:
        print('   FALTAM %d: %s' % (len(faltas), ', '.join(faltas)))
    if fora:
        print('   FORA DO CONTRATO (peso, formato ou tamanho): %s' % ', '.join(fora))
    if duplas:
        print('   AVISO: .webp e .png do mesmo retrato (o site usa o .webp): %s' % ', '.join(duplas))
    return not faltas and not fora


def main():
    ap = argparse.ArgumentParser(description='Fotografa as classes e as fusões para o site (site/img/).')
    ap.add_argument('--lote', action='append', choices=LOTES + [LOTE_OBRAS, LOTE_EQUIPE],
                    help='só este lote (pode repetir); "equipe" é o Cavaleiro Negro do ranking')
    ap.add_argument('--obras', action='store_true', help='soma o lote das 6 obras de fusão (256 px)')
    ap.add_argument('--motor', choices=sorted(MOTORES), default='swiftshader')
    ap.add_argument('--ss', type=int, default=2, help='supersampling da foto (1 a 3; padrão 2)')
    ap.add_argument('--folha', metavar='PNG', help='no fim, grava a foto da folha de conferência neste PNG')
    ap.add_argument('--so-confere', action='store_true', help='não fotografa; só confere o que está em site/img/')
    args = ap.parse_args()

    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome and (not args.so_confere or args.folha):
        print('sem Chrome/Edge: instale o Chrome ou rode em outra máquina')
        return 2
    lotes = [] if args.so_confere else list(args.lote or LOTES)
    if args.obras and LOTE_OBRAS not in lotes and not args.so_confere:
        lotes.append(LOTE_OBRAS)
    com_obras = args.obras or LOTE_OBRAS in lotes
    com_equipe = LOTE_EQUIPE in lotes

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Atendente, directory=RAIZ))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d/' % srv.server_address[1]
    falhas = []
    try:
        for lote in lotes:
            if not roda_lote(chrome, args.motor, base, lote, max(1, min(3, args.ss))):
                falhas.append(lote)
        ok = confere(com_obras, com_equipe)
        if args.folha and not foto_folha(chrome, base, args.folha):
            falhas.append('folha')
    finally:
        srv.shutdown()
    if falhas:
        print('RESUMO: FALHOU — %s' % ', '.join(falhas))
        return 1
    if not ok:
        print('RESUMO: FALHOU — site/img/ incompleta')
        return 1
    print('RESUMO: tudo passou · a folha: %s?ver=1 (o dono aprova antes do commit)' % PAGINA)
    return 0


if __name__ == '__main__':
    sys.exit(main())
