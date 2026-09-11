#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova estática do contêiner do Coolify (esta máquina não tem Docker).

    python tests/coolify_prova.py

Cobra o que dá para cobrar sem construir a imagem:
  - o que o .dockerignore deixa entrar é o MESMO conteúdo do pacote do VPS
    (tools/sobe_vps.py), que tests/pacote_servido.py prova que abre o jogo;
  - os scripts do contêiner passam no `sh -n` e vão com fim de linha LF;
  - o Dockerfile aponta para arquivos que existem;
  - o Caddyfile de dentro separa o tráfego como o do VPS, nas mesmas portas
    que a entrada usa para a API e o Relé, e o healthcheck bate numa rota real;
  - a VELOCIDADE DE ABRIR: o build roda o versao.py (hash por arquivo em
    js/versao.js), as duas Caddyfiles mandam guardar o endereço com hash e
    revalidar o índice, o manifesto leva o hash de cada modelo, e o caminho
    servido não lê embutido nenhum que o bundle já traz (sem dobra);
  - o CACHE NO ROLLING UPDATE: "guarde por um ano" só com a marca do build
    (<pasta>-marcas/<arquivo>.<hash>) — o hash do endereço é o do arquivo que
    AQUELE servidor tem; o versao.py grava as marcas e apaga as velhas, e para
    se a lista de carga do index.html citar arquivo fora do pacote;
  - o VPS limpo: o instala.sh põe em /opt/soterra todo módulo que o api.py
    e o rele.py importam (e a API sobe só com eles), e as marcas saem antes
    do rsync;
  - as tabelas geradas não ficam DIFERENTES à toa num checkout em CRLF.
"""
import ast
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.path.insert(0, os.path.join(RAIZ, 'tests'))
sys.dont_write_bytecode = True
import sobe_vps  # noqa: E402
import carga_prova  # noqa: E402  (a imitação das regras de cache do Caddyfile)
import pacote_servido  # noqa: E402  (a lista de carga do index.html e o caminho servido)

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def ler(rel):
    with open(os.path.join(RAIZ, rel), 'rb') as f:
        return f.read().decode('utf-8')


def arquivos():
    r = subprocess.run(['git', '-C', RAIZ, 'ls-files', '--cached', '--others', '--exclude-standard'],
                       capture_output=True, text=True, encoding='utf-8')
    return [l for l in r.stdout.splitlines() if l.strip()]


def regex_docker(padrao):
    """Um padrão do .dockerignore em regex: `**/` é qualquer profundidade, `*`
    não atravessa `/`, e um diretório casa com tudo o que tem dentro."""
    rx = ''
    i = 0
    while i < len(padrao):
        if padrao.startswith('**/', i):
            rx += '(?:.*/)?'
            i += 3
        elif padrao[i] == '*':
            rx += '[^/]*'
            i += 1
        elif padrao[i] == '?':
            rx += '[^/]'
            i += 1
        else:
            rx += re.escape(padrao[i])
            i += 1
    return re.compile('^' + rx + '(?:/.*)?$')


def fica_no_docker(caminho, regras):
    return not any(r.match(caminho) for r in regras)


def fica_no_pacote(caminho):
    for p in sobe_vps.FORA:
        if '*' in p:
            if fnmatch.fnmatchcase(caminho, p):
                return False
        elif caminho == p or caminho.startswith(p + '/'):
            return False
    return True


def impressao(bruto):
    return hashlib.sha256(bruto).hexdigest()[:12]


# um index.html de mentira com o que o versao.py lê dele: a lista de carga, as
# regras do caminho servido e os window.__url fora da lista (o do sandbox é de
# tests/, que o pacote não leva). %s é onde a prova põe um arquivo a mais.
INDEX_DE_MENTIRA = '''<!DOCTYPE html>
<script>
  document.write('<link rel="stylesheet" href="' + window.__url('css/b.css') + '">');
  if (sandbox) document.write('<script src="' + window.__url('tests/save_sandbox.js') + '"><\\/script>');
</script>
<script>
    var arquivos = [
      'js/a.js',                       // o script
      'assets/embedded/models-x.js',   // so modelo: o caminho servido nao pede
      'assets/embedded/cenario-y.js'%s
    ];
    var SO_MODELO = /^assets\\/embedded\\/(env-kit|models-|muro-|coroas-pvp-3d\\.js$)/;
    var COM_TABELA = /^assets\\/embedded\\/(cenario-[^\\/]+\\.js)$/;
    var TABELAS = 'assets/models/bundle/tabelas/';
</script>
'''


def prova_do_versao():
    """Roda o versao.py numa pasta de mentira (www, com as marcas em
    www-marcas ao lado) e devolve o que ele fez em cada situação."""
    versao = os.path.join(RAIZ, 'servidor', 'coolify', 'versao.py')
    res = {}
    with tempfile.TemporaryDirectory() as tmp:
        www = os.path.join(tmp, 'www')
        marcas = www + '-marcas'

        def poe(rel, dado):
            p = os.path.join(www, *rel.split('/'))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(dado)

        def roda():
            r = subprocess.run([sys.executable, '-B', versao, www], capture_output=True, text=True,
                               encoding='utf-8', errors='replace')
            return r.returncode, (r.stdout + r.stderr).strip()

        def mapa():
            txt = open(os.path.join(www, 'js', 'versao.js'), encoding='utf-8').read()
            try:
                return json.loads(txt[txt.index('SOTERRA_VERSAO = ') + len('SOTERRA_VERSAO = '):txt.rindex(';')])
            except ValueError:
                return {}

        def marcas_agora():
            if not os.path.isdir(marcas):
                return None
            return {os.path.relpath(os.path.join(b, n), marcas).replace(os.sep, '/')
                    for b, _, ns in os.walk(marcas) for n in ns}

        glb = b'glTF-de-mentira'
        poe('index.html', (INDEX_DE_MENTIRA % '').encode())
        poe('js/a.js', b'var a = 1;')
        poe('css/b.css', b'body{}')
        poe('assets/models/bundle/tabelas/cenario-y.js', b'JOGO.CENARIO = {};')
        poe('js/versao.js', b"window.SOTERRA_VERSAO = {versao: 'dev', arquivos: {}};")
        poe('assets/models/bundle/x/m.glb', glb)
        poe('assets/models/bundle/manifest.json', json.dumps(
            {'base': 'assets/models/bundle/', 'itens': [{'arquivo': 'x/m.glb', 'hash': impressao(glb)}]}).encode())
        rc, res['saida'] = roda()
        dados = mapa()
        arq = dados.get('arquivos') or {}
        res['mapa'] = (rc == 0 and dados.get('versao') not in (None, 'dev')
                       and arq.get('js/a.js') == impressao(b'var a = 1;') and arq.get('css/b.css') == impressao(b'body{}')
                       and 'assets/models/bundle/manifest.json' in arq and 'js/versao.js' not in arq
                       and 'index.html' not in arq and 'assets/models/bundle/x/m.glb' not in arq)
        # uma marca por endereço com hash (os .js/.css do mapa e os modelos),
        # e nenhuma do índice (index.html, js/versao.js)
        esperadas = {k + '.' + v for k, v in arq.items()} | {'assets/models/bundle/x/m.glb.' + impressao(glb)}
        res['marcas'] = rc == 0 and marcas_agora() == esperadas
        # o script muda: a marca do conteúdo velho sai, a do novo entra
        poe('js/a.js', b'var a = 2;')
        rc, _ = roda()
        agora = marcas_agora() or set()
        res['marcas_trocam'] = (rc == 0 and 'js/a.js.' + impressao(b'var a = 2;') in agora
                                and 'js/a.js.' + impressao(b'var a = 1;') not in agora)
        # bundle adulterado: o build para — e não deixa marca nenhuma de pé
        poe('assets/models/bundle/x/m.glb', b'outro-conteudo')
        res['para_bundle'] = roda()[0] != 0
        res['sem_marca_na_falha'] = marcas_agora() is None
        poe('assets/models/bundle/x/m.glb', glb)
        # a lista de carga cita um arquivo que não está no pacote: o build para
        poe('index.html', (INDEX_DE_MENTIRA % ",\n      'js/falta.js'").encode())
        rc, res['saida_lista'] = roda()
        res['para_lista'] = rc != 0 and 'js/falta.js' in res['saida_lista']
        # a tabela que um cenario-*.js da lista vira no caminho servido também conta
        poe('index.html', (INDEX_DE_MENTIRA % '').encode())
        os.remove(os.path.join(www, 'assets', 'models', 'bundle', 'tabelas', 'cenario-y.js'))
        rc, saida = roda()
        res['para_tabela'] = rc != 0 and 'cenario-y.js' in saida
        poe('assets/models/bundle/tabelas/cenario-y.js', b'JOGO.CENARIO = {};')
        res['volta'] = roda()[0] == 0 and marcas_agora() is not None
        os.makedirs(os.path.join(www, '.git'))
        res['recusa_git'] = roda()[0] != 0
    return res


def velocidade(df, dentro, fora, man, na_imagem):
    """A velocidade de abrir: versão por arquivo, cache no Caddy, bundle com hash, sem dobra."""
    v = prova_do_versao()
    check('o versao.py grava o hash do conteúdo de cada .js/.css (e do manifesto) em js/versao.js',
          v['mapa'], v['saida'][:200])
    check('o versao.py grava AO LADO da pasta servida uma marca por endereço com hash (<pasta>-marcas/<arquivo>.<hash>)',
          v['marcas'], v['saida'][:200])
    check('rodando de novo, a marca do conteúdo velho sai e a do novo entra (nenhuma marca velha de pé)',
          v['marcas_trocam'])
    check('o versao.py PARA o build se um binário do bundle não bater com o hash do manifesto', v['para_bundle'])
    check('e a falha não deixa marca nenhuma de pé (sem marca tudo revalida: mais devagar, nunca errado)',
          v['sem_marca_na_falha'])
    check('o versao.py PARA o build se a lista de carga do index.html citar arquivo fora do pacote',
          v['para_lista'], v['saida_lista'][:200])
    check('e também se faltar a tabela em que um cenario-*.js da lista vira no caminho servido', v['para_tabela'])
    check('com o pacote inteiro de novo, o build volta a passar (e grava as marcas)', v['volta'])
    check('o versao.py recusa rodar num repositório git (sujaria o js/versao.js padrão)', v['recusa_git'])
    padrao = ler('js/versao.js')
    check("o js/versao.js do git é o padrão 'dev', sem mapa (o jogo servido em casa segue fresco)",
          re.search(r"SOTERRA_VERSAO = \{ versao: 'dev', arquivos: \{\} \};", padrao) is not None)

    i = [df.find(s) for s in ('COPY . /srv/soterra', 'mv /srv/soterra/servidor /app/servidor',
                              'python3 /app/servidor/coolify/versao.py /srv/soterra',
                              'chmod -R a+rX /srv/soterra /srv/soterra-marcas /app',
                              'caddy validate --config /app/servidor/coolify/Caddyfile --adapter caddyfile')]
    check('o Dockerfile roda o versao.py na pasta servida (depois do COPY e de pôr o servidor em /app), '
          'abre as marcas e valida o Caddyfile ainda no BUILD', min(i) >= 0 and i == sorted(i), str(i))
    ins = ler('servidor/instala.sh')
    j = [ins.find(s) for s in ('rm -rf "$WEB-marcas"', 'rsync -a --delete', 'servidor/coolify/versao.py" "$WEB"',
                               'chmod -R u=rwX,go=rX "$WEB" "$WEB-marcas"')]
    check('o instala.sh do VPS limpo apaga as marcas ANTES de o rsync trocar o jogo, roda o versao.py '
          'depois e abre as marcas ao caddy', min(j) >= 0 and j == sorted(j), str(j))
    excl = set(re.findall(r"--exclude '/(assets/embedded/[^']+)'", ins))
    fora_emb = {p for p in sobe_vps.FORA if p.startswith('assets/embedded/')}
    check('o rsync do instala.sh deixa de fora os mesmos embutidos que o pacote (FORA)',
          excl == fora_emb, 'só no rsync: %s | só no FORA: %s' % (sorted(excl - fora_emb), sorted(fora_emb - excl)))

    for rel, texto in (('servidor/coolify/Caddyfile', dentro), ('servidor/Caddyfile', fora)):
        ruins = carga_prova.confere_caddyfile(texto)
        check('%s: endereço com hash (?v=/?h=) fica um ano SÓ com a marca do build (o hash é o DESTE servidor); '
              'hash de outro contêiner, carimbo, páginas, js/versao.js, manifesto e o resto revalidam' % rel,
              not ruins, '; '.join(ruins[:3]))
    bloco = carga_prova.bloco_de_cache(dentro)
    check('as duas Caddyfiles têm o MESMO bloco de cache (fora a pasta das marcas)',
          len(bloco) > 4 and bloco == carga_prova.bloco_de_cache(fora))
    # cada Caddyfile procura a marca onde o versao.py a grava: ao lado da pasta
    # que ele serve (o Dockerfile roda o versao.py em /srv/soterra; o
    # instala.sh, em $WEB)
    web = re.search(r'^WEB=(\S+)\s*$', ins, re.M)
    serve_dentro = re.search(r'^\s*root \* (\S+)\s*$', dentro, re.M)
    serve_fora = re.search(r'^\s*root \* (\S+)\s*$', fora, re.M)
    try:
        md, mf = carga_prova.raizes_das_marcas(dentro), carga_prova.raizes_das_marcas(fora)
    except ValueError as e:
        md = mf = ['não li: %s' % e]
    check('cada Caddyfile procura a marca onde o versao.py a grava, ao lado da pasta que serve '
          '(/srv/soterra-marcas no contêiner, $WEB-marcas no VPS)',
          bool(web and serve_dentro and serve_fora) and serve_dentro.group(1) == '/srv/soterra'
          and serve_fora.group(1) == web.group(1)
          and md == [serve_dentro.group(1) + '-marcas'] and mf == [serve_fora.group(1) + '-marcas'],
          'contêiner %s · VPS %s' % (md, mf))
    glob = re.search(r'(?ms)^\{\s*$(.*?)^\}\s*$', dentro)
    check('o Caddy de dentro confia no proxy do Coolify no bloco global (trusted_proxies static private_ranges)',
          glob is not None and re.search(r'servers\s*\{\s*trusted_proxies static private_ranges\s*\}', glob.group(1)) is not None)

    base = os.path.join(RAIZ, 'assets', 'models', 'bundle')
    ruins = []
    for it in man.get('itens', []):
        h = it.get('hash') or ''
        fis = os.path.join(base, *it['arquivo'].split('/'))
        if not re.fullmatch(r'[0-9a-f]{12}', h) or not os.path.isfile(fis) or impressao(open(fis, 'rb').read()) != h:
            ruins.append(it['arquivo'])
    check('cada modelo do manifesto tem o hash do conteúdo, e ele bate com o arquivo (é o ?h= do endereço)',
          man.get('itens') and not ruins, '%d itens, %d ruins: %s' % (len(man.get('itens', [])), len(ruins), ruins[:3]))
    r = subprocess.run([sys.executable, os.path.join(RAIZ, 'tools', 'extrai_assets.py'), '--conferir'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    check('o bundle, o manifesto e as tabelas estão em dia com os embutidos (extrai_assets.py --conferir)',
          r.returncode == 0, r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip()[:200])

    idx = ler('index.html')
    lista = pacote_servido.lista_do_index(idx)
    servida = pacote_servido.lista_servida(idx)
    fontes = {it['arquivo'].split('/')[0] + '.js' for it in man.get('itens', [])}
    dobra = [f for f in (servida or []) if f.startswith('assets/embedded/') and f.split('/')[-1] in fontes]
    check('o caminho servido não lê embutido nenhum cujos modelos o bundle já traz (sem dobra)',
          servida is not None and not dobra, ', '.join(dobra[:4]) if servida is not None else 'não li as regras do index.html')
    tabs = man.get('tabelas') or {}
    faltam = [n for n in tabs if 'assets/embedded/' + n in lista
              and 'assets/models/bundle/' + tabs[n] not in (servida or [])]
    check('cada embutido com tabela (o manifesto diz quais) vira a tabela no caminho servido',
          tabs and not faltam, ', '.join(faltam))
    sumidos = [f for f in (servida or []) if f.startswith('assets/') and f not in na_imagem]
    check('tudo o que o caminho servido pede de assets/ está na imagem', servida and not sumidos, ', '.join(sumidos[:4]))
    v = idx.find("js/versao.js?t=")
    check('o index.html lê o js/versao.js primeiro, com carimbo novo a cada visita, e só fora do file://',
          0 <= v < idx.find("window.__url('css/style.css')") < idx.find("window.__url('js/assets_bundle.js')")
          and "if (location.protocol !== 'file:')" in idx[:v])
    check('o index.html monta cada endereço pelo mapa (window.__url), sem o carimbo do instante solto',
          'window.__url(lista[i])' in idx and 'window.__url(f1)' in idx and '+ window.__V +' not in idx)
    check("o index.html carrega 'js/core/loja.js' logo depois de 'js/core/nuvem.js'",
          'js/core/loja.js' in lista and lista.index('js/core/loja.js') == lista.index('js/core/nuvem.js') + 1)
    ab = ler('js/assets_bundle.js')
    check("o assets_bundle.js pede cada modelo com ?h=<hash> e os scripts pelo window.__url",
          "'?h=' + it.hash" in ab and 'window.__url(f)' in ab)


def modulos_do_api(pasta, raiz='api'):
    """Os módulos de `pasta` que o api.py (ou `raiz`) importa, de perto ou de longe."""
    locais = {n[:-3] for n in os.listdir(pasta) if n.endswith('.py')}
    vistos, fila = set(), [raiz]
    while fila:
        mod = fila.pop()
        if mod in vistos:
            continue
        vistos.add(mod)
        with open(os.path.join(pasta, mod + '.py'), encoding='utf-8') as f:
            arvore = ast.parse(f.read())
        for no in ast.walk(arvore):
            if isinstance(no, ast.Import):
                nomes = [a.name.split('.')[0] for a in no.names]
            elif isinstance(no, ast.ImportFrom) and not no.level and no.module:
                nomes = [no.module.split('.')[0]]
            else:
                continue
            fila.extend(n for n in nomes if n in locais)
    return sorted(vistos)


def instalados_em_opt(ins):
    """Os arquivos de servidor/ que o instala.sh põe em $OPT: cada linha
    `install ... "$OPT/"` (com as continuações), com os globs expandidos."""
    pasta = os.path.join(RAIZ, 'servidor')
    prefixo = '$PACOTE/servidor/'
    saida = set()
    for linha in ins.replace('\\\n', ' ').splitlines():
        t = linha.split()
        if not t or t[0] != 'install' or t[-1] != '"$OPT/"':
            continue
        for tok in t[1:-1]:
            tok = tok.replace('"', '')
            if tok.startswith(prefixo) and '/' not in tok[len(prefixo):]:
                saida |= set(fnmatch.filter(os.listdir(pasta), tok[len(prefixo):]))
    return saida


def prova_do_vps(ins):
    """O VPS limpo: o systemd roda `python3 /opt/soterra/api.py`, e o Python só
    procura módulo na pasta do script — o que o instala.sh não copiar, falta."""
    mods = modulos_do_api(os.path.join(RAIZ, 'servidor'))
    inst = instalados_em_opt(ins)
    faltam = [m + '.py' for m in mods if m + '.py' not in inst]
    check('o instala.sh põe em /opt/soterra o relé e todo módulo que o api.py importa (%s)' % ', '.join(mods),
          'rele.py' in inst and not faltam, 'faltam: %s' % ', '.join(faltam))
    # (10/09) o relé também importa módulos ao lado (rele_ident, nomes, comum):
    # o que faltar em /opt/soterra o derruba no import, num laço de restart
    mods_rele = modulos_do_api(os.path.join(RAIZ, 'servidor'), 'rele')
    faltam = [m + '.py' for m in mods_rele if m + '.py' not in inst]
    check('o instala.sh põe em /opt/soterra todo módulo que o rele.py importa (%s)' % ', '.join(mods_rele),
          'rele_ident' in mods_rele and not faltam, 'faltam: %s' % ', '.join(faltam))
    with tempfile.TemporaryDirectory() as opt:
        for n in sorted(inst):
            shutil.copy(os.path.join(RAIZ, 'servidor', n), opt)
        r = subprocess.run([sys.executable, '-B', '-E', '-s', os.path.join(opt, 'api.py'), '--help'],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=opt)
    erro = (r.stderr.strip().splitlines() or [''])[-1]
    check('a API sobe de uma /opt/soterra só com o que o instala.sh copiou (python3 /opt/soterra/api.py, como no systemd)',
          r.returncode == 0, erro[:200])


# o --conferir do extrai_assets.py, lendo as tabelas como um checkout com
# core.autocrlf=true as deixaria (CRLF) — sem mexer nos arquivos de verdade
CRLF_NAS_TABELAS = r'''
import os, sys
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.join(sys.argv[1], 'tools'))
import extrai_assets as ea
le = ea._le
def como_no_checkout(caminho, modo='rb'):
    dado = le(caminho, modo)
    if dado is not None and 'tabelas' in caminho.replace(os.sep, '/').split('/') and caminho.endswith('.js'):
        dado = dado.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    return dado
ea._le = como_no_checkout
sys.exit(ea.principal(conferir=True))
'''


def prova_das_tabelas():
    """As tabelas geradas (assets/models/bundle/tabelas/) num checkout em CRLF."""
    alvo = 'assets/models/bundle/tabelas/cenario-jardim.js'
    eol = subprocess.run(['git', '-C', RAIZ, 'check-attr', 'eol', '--', alvo], capture_output=True, text=True).stdout
    check('as tabelas geradas ficam LF no checkout (.gitattributes), como o extrai_assets.py as escreve',
          eol.strip().endswith('lf'), eol.strip())
    r = subprocess.run([sys.executable, '-B', '-c', CRLF_NAS_TABELAS, RAIZ], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    fim = (r.stdout.strip().splitlines() or [''])[-1]
    check('o --conferir não acusa DIFERENTE numa tabela que o checkout trouxe em CRLF (o conteúdo é o mesmo)',
          r.returncode == 0 and fim.startswith('em dia'), fim[:200] or r.stderr.strip()[-200:])


def main():
    todos = arquivos()
    padroes = [l.strip() for l in ler('.dockerignore').splitlines() if l.strip() and not l.strip().startswith('#')]
    regras = [regex_docker(p) for p in padroes]
    na_imagem = {f for f in todos if fica_no_docker(f, regras)}
    no_pacote = {f for f in todos if fica_no_pacote(f)}
    so_imagem = sorted(na_imagem - no_pacote)
    so_pacote = sorted(no_pacote - na_imagem)
    check('a imagem leva o mesmo conteúdo do pacote do VPS (o que tests/pacote_servido.py prova)',
          not so_imagem and not so_pacote,
          'só na imagem: %s | só no pacote: %s' % (so_imagem[:5], so_pacote[:5]))
    check('nada de testes, ferramentas, documentação ou .git na imagem',
          not any(f.split('/')[0] in ('tests', 'tools', 'docs', '.git', '.claude') for f in na_imagem))
    check('nem os embutidos que o jogo servido não carrega (os cenario-*.js inteiros e o coroas-pvp-3d.js inclusive)',
          not any(re.match(r'^assets/embedded/(models-|env-kit|muro-|sprites-|cenario-|coroas-pvp-3d)', f) for f in na_imagem))
    check('o bundle de modelos entra (é dele que o jogo servido carrega)',
          sum(1 for f in na_imagem if f.startswith('assets/models/bundle/')) > 20)
    man = json.loads(ler('assets/models/bundle/manifest.json'))
    tabelas = ['assets/models/bundle/' + t for t in sorted((man.get('tabelas') or {}).values())]
    check('as tabelas do cenário entram na imagem e no pacote (no lugar dos cenario-*.js inteiros)',
          len(tabelas) >= 2 and all(t in na_imagem and t in no_pacote for t in tabelas), ', '.join(tabelas))
    check('o js/versao.js padrão (o do git) e o servidor/coolify/versao.py entram',
          'js/versao.js' in na_imagem and 'servidor/coolify/versao.py' in na_imagem and 'js/versao.js' in no_pacote)

    scripts = ['servidor/coolify/entrada.sh', 'servidor/coolify/admin.sh', 'servidor/coolify/backup.sh']
    for s in scripts:
        existe = os.path.isfile(os.path.join(RAIZ, s))
        cru = open(os.path.join(RAIZ, s), 'rb').read() if existe else b''
        r = subprocess.run(['sh', '-n', os.path.join(RAIZ, s)], capture_output=True, text=True) if existe else None
        check('%s existe, passa no sh -n e tem fim de linha LF' % s,
              existe and r.returncode == 0 and b'\r' not in cru and cru.startswith(b'#!/bin/sh'),
              (r.stderr.strip() if r else 'não existe'))
        eol = subprocess.run(['git', '-C', RAIZ, 'check-attr', 'eol', '--', s], capture_output=True, text=True).stdout
        check('%s fica LF no git mesmo com autocrlf (.gitattributes)' % s, eol.strip().endswith('lf'), eol.strip())
    eol = subprocess.run(['git', '-C', RAIZ, 'check-attr', 'eol', '--', 'Dockerfile'], capture_output=True, text=True).stdout
    check('o Dockerfile fica LF no git', eol.strip().endswith('lf'), eol.strip())

    df = ler('Dockerfile')
    check('o Dockerfile parte do Caddy oficial e instala python3, websockets, sqlite, su-exec e tini',
          df.startswith('#') and re.search(r'^FROM caddy:2-alpine\s*$', df, re.M) is not None and
          all(p in df for p in ['python3', 'py3-websockets', 'sqlite', 'su-exec', 'tini']))
    check('o Dockerfile roda a entrada que existe, e o admin vira comando',
          '/app/servidor/coolify/entrada.sh' in df and 'ln -s /app/servidor/coolify/admin.sh /usr/local/bin/admin' in df)
    check('o Dockerfile NÃO declara VOLUME (sem o volume do Coolify a entrada recusa subir)',
          re.search(r'^\s*VOLUME\b', df, re.M) is None)

    entrada = ler('servidor/coolify/entrada.sh')
    dentro = ler('servidor/coolify/Caddyfile')
    fora = ler('servidor/Caddyfile')
    check('a entrada recusa subir sem /dados montado', 'grep -qs " $DADOS " /proc/mounts' in entrada and 'exit 1' in entrada)
    check('a entrada põe a API na 8300 e o Relé na 8791, sem root (su-exec soterra)',
          '--porta 8300' in entrada and '--porta 8791' in entrada and 'su-exec soterra' in entrada)
    check('o Caddy de dentro escuta em :80, sem HTTPS próprio (o do Coolify manda)',
          re.search(r'^:80 \{', dentro, re.M) is not None and 'auto_https off' in dentro)
    for diretiva in ['encode zstd gzip', 'redir / /site/ 302', 'handle /api/* {', 'reverse_proxy 127.0.0.1:8300',
                     'reverse_proxy /ws 127.0.0.1:8791', 'file_server']:
        check('o Caddy de dentro tem "%s", como o do VPS' % diretiva, diretiva in dentro and diretiva in fora)
    check('o Caddy de dentro serve a pasta onde o Dockerfile põe o jogo (/srv/soterra)',
          'root * /srv/soterra' in dentro and 'COPY . /srv/soterra' in df)
    api = ler('servidor/api.py')
    check('o healthcheck bate numa rota real da API (/api/saude)',
          '/api/saude' in df and "('GET',  '/api/saude')" in api)
    admin = ler('servidor/coolify/admin.sh')
    check('o admin usa as colunas que o banco tem (contas.gm, contas.banido, eventos.criado_em)',
          all(c in api for c in ['gm         INTEGER', 'banido     INTEGER', 'criado_em INTEGER']) and
          'set $1 = $2 where nome' in admin and 'e.criado_em' in admin)

    check('o healthcheck responde rápido (o deploy do Coolify espera ~1 min)',
          '--interval=10s' in df and '--start-period=20s' in df)
    check('a pasta servida não guarda o Dockerfile nem o compose que o Coolify reescreve',
          'rm -f /srv/soterra/Dockerfile' in df and '/srv/soterra/docker-compose.yaml' in df and '/srv/soterra/.env' in df)
    check('o admin exige o NOME inteiro num argumento só', '[ $# -eq 2 ]' in admin)
    check('o backup leva data e hora (um de tarde não apaga o da madrugada)',
          'date +%F-%H%M%S' in ler('servidor/coolify/backup.sh'))

    velocidade(df, dentro, fora, man, na_imagem)
    prova_do_vps(ler('servidor/instala.sh'))
    prova_das_tabelas()
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
