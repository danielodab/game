# -*- coding: utf-8 -*-
"""AS FOTOS DAS FICHAS — todas as fichas da HUD em duas larguras, numa janela de Chrome só.

Por que existe (02/10, a frente dos menus): conferir o acabamento de ~25 fichas
em desktop E celular abrindo uma página por foto com `--screenshot` são 50
Chromes subindo e descendo — minutos de CPU na máquina que o dono usa para
jogar. Aqui sobe UM Chrome headless (prioridade baixa, perfil descartável), e
cada foto é só uma navegação na página leve tests/fichas_fotos.html (sem
WebGL), conduzida pelo protocolo de depuração (CDP) com a biblioteca
`websockets` que o servidor já usa.

Uso:
    python -m http.server 8142 --directory <pasta do jogo>      (em outro terminal)
    python tools/fotos_fichas.py fotos <pasta-saida> [--base http://localhost:8142/]
                                 [--fichas personagem,inventario,...] [--tamanhos 1600x900,390x844]
    python tools/fotos_fichas.py comparar <pasta-antes> <pasta-depois> <pasta-saida>
    python tools/fotos_fichas.py prova [--base http://localhost:8142/]

`fotos` grava <ficha>__<L>x<A>.png e um erros.json (o que cada página
reclamou); `comparar` monta uma folha de contato antes|depois por ficha
(desktop em cima, celular embaixo); `prova` roda a régua do sistema das fichas
(a página sem ?ficha=) numa janela de celular de 390×844 — numa janela larga
as regras de @media montariam o desktop dentro da coluna e a prova mediria um
estado que o jogo nunca mostra — e sai com o número de falhas.
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request, base64

FICHAS = ['personagem', 'heroi', 'inventario', 'forja', 'feiticos', 'colecao', 'banco', 'guilda',
          'mercado', 'loteria', 'missoes', 'placar', 'amigos', 'perfil', 'troca', 'contas', 'duelo',
          'dupla', 'quadro', 'sussurro', 'pausa', 'confirma', 'config', 'praca', 'praca-poco',
          'praca-sede', 'praca-arena']
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
BAIXA = 0x00004000          # BELOW_NORMAL_PRIORITY_CLASS: o dono joga nesta máquina


class Cdp(object):
    """O mínimo do protocolo: mandar um método e esperar a resposta dele."""
    def __init__(self, url):
        from websockets.sync.client import connect
        self.ws = connect(url, max_size=64 * 1024 * 1024)
        self.n = 0

    def __call__(self, metodo, **params):
        self.n += 1
        meu = self.n
        self.ws.send(json.dumps({'id': meu, 'method': metodo, 'params': params}))
        while True:
            m = json.loads(self.ws.recv(timeout=60))
            if m.get('id') == meu:
                if 'error' in m:
                    raise RuntimeError('%s: %s' % (metodo, m['error']))
                return m.get('result', {})

    def avalia(self, expr):
        r = self('Runtime.evaluate', expression=expr, returnByValue=True)
        return (r.get('result') or {}).get('value')


def sobe_chrome():
    perfil = tempfile.mkdtemp(prefix='fichas-fotos-')
    # --enable-unsafe-swiftshader: o WebGL por software, como o README manda — sem ele a
    # página que monta o tabuleiro (o index inteiro, o toque) fica parada em "rodando"
    proc = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
                             '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
                             '--remote-debugging-port=0', '--user-data-dir=' + perfil, 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=BAIXA if os.name == 'nt' else 0)
    arq = os.path.join(perfil, 'DevToolsActivePort')
    for _ in range(150):
        if os.path.exists(arq) and os.path.getsize(arq) > 0:
            break
        time.sleep(0.1)
    porta = open(arq).read().split()[0]
    alvos = json.loads(urllib.request.urlopen('http://127.0.0.1:%s/json/list' % porta).read())
    pagina = [a for a in alvos if a.get('type') == 'page'][0]
    return proc, perfil, Cdp(pagina['webSocketDebuggerUrl'])


def mata(proc, perfil):
    # a árvore inteira: o gpu-process e os renderizadores sobrevivem ao pai
    if os.name == 'nt':
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True)
    else:
        proc.kill()
    time.sleep(0.5)
    shutil.rmtree(perfil, ignore_errors=True)


def fotos(saida, base, fichas, tamanhos):
    os.makedirs(saida, exist_ok=True)
    proc, perfil, cdp = sobe_chrome()
    erros = {}
    try:
        cdp('Page.enable')
        for (w, h) in tamanhos:
            celular = w < 768
            cdp('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=celular)
            cdp('Emulation.setTouchEmulationEnabled', enabled=celular, maxTouchPoints=5 if celular else 1)
            for f in fichas:
                cdp('Page.navigate', url=base + 'tests/fichas_fotos.html?ficha=' + f)
                t0 = time.time()
                while time.time() - t0 < 25:
                    time.sleep(0.25)
                    try:
                        if cdp.avalia('window.__pronto === true'):
                            break
                    except Exception:
                        pass
                ev = cdp.avalia('JSON.stringify(window.__erros || ["sem __pronto"])')
                lista = json.loads(ev or '[]')
                if lista:
                    erros['%s__%dx%d' % (f, w, h)] = lista
                png = cdp('Page.captureScreenshot', format='png')['data']
                nome = os.path.join(saida, '%s__%dx%d.png' % (f, w, h))
                with open(nome, 'wb') as fh:
                    fh.write(base64.b64decode(png))
                print('%-12s %dx%d %s' % (f, w, h, ('· ' + ' | '.join(lista)[:160]) if lista else 'ok'), flush=True)
    finally:
        try:
            cdp('Browser.close')
        except Exception:
            pass
        mata(proc, perfil)
    with open(os.path.join(saida, 'erros.json'), 'w', encoding='utf-8') as fh:
        json.dump(erros, fh, ensure_ascii=False, indent=1)
    return erros


def comparar(antes, depois, saida):
    from PIL import Image, ImageDraw, ImageFont
    os.makedirs(saida, exist_ok=True)

    def fonte(t):
        for f in ('C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'DejaVuSans-Bold.ttf'):
            try:
                return ImageFont.truetype(f, t)
            except Exception:
                pass
        return ImageFont.load_default()
    grande, media = fonte(30), fonte(20)
    nomes = sorted(set(n.split('__')[0] for n in os.listdir(depois) if n.endswith('.png')) |
                   set(n.split('__')[0] for n in os.listdir(antes) if n.endswith('.png')))
    for f in nomes:
        def abre(pasta, tam):
            p = os.path.join(pasta, '%s__%s.png' % (f, tam))
            return Image.open(p).convert('RGB') if os.path.exists(p) else None
        da, dd = abre(antes, '1600x900'), abre(depois, '1600x900')
        ca, cd = abre(antes, '390x844'), abre(depois, '390x844')
        W, M, TOPO = 1660, 20, 70
        dw, dh = 800, 450
        H = TOPO + 34 + dh + 50 + 844 + 30
        fol = Image.new('RGB', (W, H), (14, 17, 22))
        d = ImageDraw.Draw(fol)
        d.text((M, 18), 'Ficha: ' + f, font=grande, fill=(255, 196, 77))
        for i, (rot, dk, cel) in enumerate((('ANTES', da, ca), ('DEPOIS', dd, cd))):
            x = M + i * (dw + M)
            d.text((x, TOPO), rot + ' — desktop 1600×900', font=media, fill=(236, 228, 212))
            if dk:
                fol.paste(dk.resize((dw, dh), Image.LANCZOS), (x, TOPO + 34))
            else:
                d.text((x + 20, TOPO + 60), '(não existia)', font=media, fill=(139, 147, 160))
            y2 = TOPO + 34 + dh + 16
            d.text((x, y2), rot + ' — celular 390×844', font=media, fill=(236, 228, 212))
            if cel:
                fol.paste(cel, (x + (dw - 390) // 2, y2 + 30))
            else:
                d.text((x + 20, y2 + 60), '(não existia)', font=media, fill=(139, 147, 160))
        fol.save(os.path.join(saida, f + '.png'), optimize=True)
        print('folha', f, flush=True)


def prova(base):
    proc, perfil, cdp = sobe_chrome()
    try:
        cdp('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=1, mobile=True)
        cdp('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
        cdp('Page.navigate', url=base + 'tests/fichas_fotos.html')
        t0 = time.time()
        while time.time() - t0 < 300:
            time.sleep(0.5)
            try:
                if cdp.avalia('window.__pronto === true'):
                    break
            except Exception:
                pass
        resumo = cdp.avalia("document.getElementById('summary').textContent") or '(sem placar)'
        ruins = cdp.avalia("[].map.call(document.querySelectorAll('#log div'), function (d) { return d.textContent; })"
                           ".filter(function (t) { return /^FALHOU/.test(t); })")
        ruins = '\n'.join(ruins or [])
        falhas = cdp.avalia('window.__fail')
    finally:
        try:
            cdp('Browser.close')
        except Exception:
            pass
        mata(proc, perfil)
    print(resumo)
    if ruins:
        print(ruins)
    return 1 if (falhas is None or falhas) else 0


def main(a):
    # o console do Windows é cp1252: o "✕" e a seta da HUD quebravam o print
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(a) >= 2 and a[0] == 'fotos':
        base, fichas, tams = 'http://localhost:8142/', FICHAS, [(1600, 900), (390, 844)]
        i = 2
        while i < len(a):
            if a[i] == '--base':
                base = a[i + 1]; i += 2
            elif a[i] == '--fichas':
                fichas = a[i + 1].split(','); i += 2
            elif a[i] == '--tamanhos':
                tams = [tuple(int(v) for v in t.split('x')) for t in a[i + 1].split(',')]; i += 2
            else:
                raise SystemExit('não entendi: ' + a[i])
        if not base.endswith('/'):
            base += '/'
        fotos(a[1], base, fichas, tams)
    elif a and a[0] == 'prova':
        base = a[a.index('--base') + 1] if '--base' in a else 'http://localhost:8142/'
        raise SystemExit(prova(base if base.endswith('/') else base + '/'))
    elif len(a) == 4 and a[0] == 'comparar':
        comparar(a[1], a[2], a[3])
    else:
        print(__doc__)
        raise SystemExit(2)


if __name__ == '__main__':
    main(sys.argv[1:])
