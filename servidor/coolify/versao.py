#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOTERRA — a impressão digital de cada arquivo do jogo, gravada no BUILD.

    python3 servidor/coolify/versao.py PASTA_SERVIDA

Quem chama: o Dockerfile (PASTA = /srv/soterra) e o servidor/instala.sh do
VPS limpo (PASTA = /var/www/soterra), depois de copiar o jogo.

O QUE FAZ
---------
Escreve PASTA/js/versao.js com o hash curto do CONTEÚDO de cada .js e .css
servido (e do manifesto dos modelos):

    window.SOTERRA_VERSAO = {"versao": "...", "arquivos": {"js/main.js": "3fa2b1c9d0e1", ...}}

O index.html lê este arquivo primeiro (com carimbo novo a cada visita) e pede
cada script com o hash DELE: `js/main.js?v=3fa2b1c9d0e1`. O Caddy manda o
navegador guardar esse endereço por um ano sem perguntar (quando há a marca:
ver AS MARCAS). Arquivo que não mudou mantém o endereço de um deploy para o
outro e não desce de novo;
arquivo que mudou ganha endereço novo e desce na hora. Antes, cada visita
baixava todos os scripts de novo (o index.html carimbava tudo com o instante).

E CONFERE O BUNDLE
------------------
Os modelos têm o hash no manifesto (tools/extrai_assets.py) e descem com
`?h=<hash>`. Se um binário mudasse sem o hash mudar, o navegador ficaria um
ano com o modelo velho — então o build PARA aqui se algum binário não bater
com o manifesto. Manifesto antigo, sem hash, não tem o que conferir.

O js/versao.js do git é o padrão 'dev' (sem mapa): servido em casa sem este
passo, o jogo continua pedindo tudo com o carimbo do instante.

AS MARCAS (o rolling update do Coolify)
---------------------------------------
AO LADO da pasta servida (PASTA-marcas: /srv/soterra-marcas no contêiner,
/var/www/soterra-marcas no VPS — fora do alcance do file_server) grava uma
marca VAZIA por endereço que pode ficar um ano no navegador: js/main.js.<hash>
para cada .js/.css do mapa e assets/models/bundle/<arquivo>.<hash> para cada
modelo. O Caddyfile só manda guardar por um ano o pedido cuja marca existe —
isto é, quando o hash do endereço é o do arquivo que AQUELE servidor tem. No
rolling update o contêiner velho e o novo respondem juntos por uns segundos:
sem a marca, um pedido com o hash novo que caísse no velho levaria o conteúdo
antigo carimbado "um ano, sem perguntar", e o jogador ficaria preso a um
main.js incompatível até limpar o cache. A marca é por ARQUIVO, e não a build
inteira no endereço (&b=), porque a build muda a cada deploy e com ela todo
endereço: o navegador baixaria de novo os 142 MB a cada push. As marcas velhas
saem ANTES de tudo, e uma falha no meio deixa a pasta sem marca nenhuma: tudo
revalida — mais devagar, nunca errado. (Numa cópia do repositório com
--forca, as marcas vão para <repositório>-marcas: pode apagar.)

E CONFERE A LISTA DE CARGA
--------------------------
Com o mapa, o index.html só pede o que está nele (window.__noPacote): um
arquivo da lista de carga que não esteja no pacote (esquecido no commit, ou
barrado pelo .gitignore/.dockerignore) seria PULADO em silêncio, e o jogo
subiria incompleto — sem save na nuvem, se o que faltasse fosse o nuvem.js.
Então o build lê a lista do index.html com as regras escritas nele (SO_MODELO
sai, COM_TABELA vira a tabela) e PARA se ela citar algo que não recebeu hash.
"""
import hashlib
import json
import os
import re
import shutil
import sys
import time

EXTENSOES = ('.js', '.css')
MANIFESTO = 'assets/models/bundle/manifest.json'
SAIDA = 'js/versao.js'
# pastas que nunca são servidas (ou nem existem na pasta do jogo)
PULA = {'__pycache__', 'node_modules', 'servidor', 'www', 'android', 'ios', 'unity'}


def impressao(bruto):
    """O hash curto do conteúdo — o mesmo formato do manifesto dos modelos."""
    return hashlib.sha256(bruto).hexdigest()[:12]


def le(caminho):
    with open(caminho, 'rb') as f:
        return f.read()


def mapa_de(raiz):
    arquivos = {}
    for base, pastas, nomes in os.walk(raiz):
        pastas[:] = sorted(p for p in pastas if not p.startswith('.') and p not in PULA)
        for nome in sorted(nomes):
            fis = os.path.join(base, nome)
            rel = os.path.relpath(fis, raiz).replace(os.sep, '/')
            if rel == SAIDA:
                continue
            if nome.endswith(EXTENSOES) or rel == MANIFESTO:
                arquivos[rel] = impressao(le(fis))
    return arquivos


def confere_bundle(raiz):
    """Cada binário do bundle bate com o hash que o manifesto promete?"""
    fis = os.path.join(raiz, *MANIFESTO.split('/'))
    if not os.path.isfile(fis):
        return 0, []
    with open(fis, encoding='utf-8') as f:
        man = json.load(f)
    base = man.get('base', 'assets/models/bundle/')
    errados = []
    conferidos = 0
    for it in man.get('itens', []):
        if not it.get('hash'):
            continue
        bin_fis = os.path.join(raiz, *(base + it['arquivo']).split('/'))
        if not os.path.isfile(bin_fis):
            errados.append(it['arquivo'] + ' (falta)')
        elif impressao(le(bin_fis)) != it['hash']:
            errados.append(it['arquivo'] + ' (conteúdo não bate com o manifesto)')
        conferidos += 1
    return conferidos, errados


RE_LISTA = re.compile(r'var arquivos = \[(.*?)\];', re.S)
HASH = re.compile(r'[0-9a-f]{12}')


def lista_de_carga(raiz):
    """O que o index.html pede no caminho SERVIDO, pelas regras escritas nele
    (a mesma leitura de tests/pacote_servido.py: lista_do_index e
    lista_servida): a lista `var arquivos` — SO_MODELO sai, COM_TABELA vira a
    tabela —, mais o que ele pede pelo window.__url fora dela (a folha, o
    carregador), menos o de tests/ (só com ?sandbox=1; o pacote não o leva).
    Devolve (lista, erro)."""
    with open(os.path.join(raiz, 'index.html'), encoding='utf-8', errors='replace') as f:
        idx = f.read()
    m = RE_LISTA.search(idx)
    if not m:
        return None, 'não achei a lista de carga (var arquivos = [...]) no index.html'
    regras = {}
    for nome in ('SO_MODELO', 'COM_TABELA'):
        r = re.search(r'var %s = /(.+?)/;' % nome, idx)
        if not r:
            return None, 'não achei a regra %s no index.html' % nome
        regras[nome] = re.compile(r.group(1).replace('\\/', '/'))
    t = re.search(r"var TABELAS = '([^']+)';", idx)
    if not t:
        return None, "não achei var TABELAS = '...' no index.html"
    lista = []
    for f in re.findall(r"'([^']+)'", re.sub(r'//[^\n]*', '', m.group(1))):
        tabela = regras['COM_TABELA'].match(f)
        if tabela:
            lista.append(t.group(1) + tabela.group(1))
        elif not regras['SO_MODELO'].match(f):
            lista.append(f)
    for f in re.findall(r"window\.__url\('([^']+)'\)", idx):
        if not f.startswith('tests/') and f not in lista:
            lista.append(f)
    return lista, None


def pasta_de_marcas(raiz):
    """Onde moram as marcas: ao lado da pasta servida (/srv/soterra ->
    /srv/soterra-marcas), fora do alcance do file_server. Os dois Caddyfiles
    procuram a marca aí."""
    return os.path.normpath(os.path.abspath(raiz)) + '-marcas'


def grava_marcas(raiz, arquivos):
    """Uma marca vazia <arquivo>.<hash> por endereço que pode ficar um ano no
    navegador: cada .js/.css do mapa e cada modelo do manifesto (o bundle já
    foi conferido contra ele). Monta numa pasta ao lado e troca de uma vez.
    Devolve quantas gravou."""
    pares = sorted(arquivos.items())
    fis = os.path.join(raiz, *MANIFESTO.split('/'))
    if os.path.isfile(fis):
        with open(fis, encoding='utf-8') as f:
            man = json.load(f)
        base = man.get('base', 'assets/models/bundle/')
        pares += sorted((base + it['arquivo'], it['hash']) for it in man.get('itens', []) if it.get('hash'))
    destino = pasta_de_marcas(raiz)
    novo = destino + '.novo'
    shutil.rmtree(novo, ignore_errors=True)
    os.makedirs(novo)
    n = 0
    for rel, h in pares:
        if not HASH.fullmatch(h):
            continue                     # sem marca: revalida (nunca errado)
        marca = os.path.join(novo, *(rel + '.' + h).split('/'))
        os.makedirs(os.path.dirname(marca), exist_ok=True)
        open(marca, 'wb').close()
        n += 1
    shutil.rmtree(destino, ignore_errors=True)
    os.rename(novo, destino)
    return n


def do_jogo(rel):
    """O que o aplicativo de Android guarda no aparelho (sw.js, js/app_jogo.js):
    os .js e .css do jogo. O site, o próprio sw.js e o js/versao.js ficam de
    fora. A MESMA regra está em js/app_jogo.js (doJogo) — mude as duas."""
    return rel.endswith(EXTENSOES) and not rel.startswith('site/') and rel != 'sw.js'


def peso_do_jogo(raiz, arquivos):
    """Os bytes (sem compressão) do que o aplicativo guarda: é o número que a
    tela mostra ao jogador antes de ele escolher."""
    return sum(os.path.getsize(os.path.join(raiz, *rel.split('/'))) for rel in arquivos if do_jogo(rel))


def escreve(raiz, arquivos):
    versao = impressao('\n'.join('%s %s' % kv for kv in sorted(arquivos.items())).encode('utf-8'))
    dados = {'versao': versao, 'gerado': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
             'arquivos': arquivos, 'peso': peso_do_jogo(raiz, arquivos)}
    texto = ('// GERADO no build por servidor/coolify/versao.py — não edite nem versione.\n'
             '// O index.html pede cada arquivo com o hash dele: o que não mudou mantém\n'
             '// o endereço entre deploys e fica no cache do navegador.\n'
             "(typeof window !== 'undefined' ? window : globalThis).SOTERRA_VERSAO = "
             + json.dumps(dados, ensure_ascii=True, indent=1, sort_keys=True) + ';\n')
    destino = os.path.join(raiz, *SAIDA.split('/'))
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)
    return versao, len(texto.encode('utf-8'))


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        print(__doc__)
        return 2
    raiz = os.path.abspath(args[0])
    if not os.path.isfile(os.path.join(raiz, 'index.html')):
        print('versao.py: não achei o jogo em %s (falta o index.html)' % raiz)
        return 1
    # Numa cópia do repositório isto sujaria o js/versao.js versionado (o
    # padrão 'dev'): o lugar dele é a pasta SERVIDA, que o build monta.
    if os.path.exists(os.path.join(raiz, '.git')) and '--forca' not in argv:
        print('versao.py: %s é um repositório git — rode na pasta servida (ou use --forca)' % raiz)
        return 1

    # As marcas velhas saem PRIMEIRO: daqui até o fim um endereço com hash
    # revalida em vez de ficar um ano — e, se algo abaixo falhar, fica assim.
    marcas = pasta_de_marcas(raiz)
    shutil.rmtree(marcas, ignore_errors=True)
    if os.path.exists(marcas):
        print('versao.py: não consegui apagar as marcas velhas em %s' % marcas)
        return 1

    conferidos, errados = confere_bundle(raiz)
    if errados:
        print('versao.py: o bundle dos modelos não bate com o manifesto (%d): %s'
              % (len(errados), ', '.join(errados[:5])))
        print('           rode python tools/extrai_assets.py e commite o que ele mudar')
        return 1

    arquivos = mapa_de(raiz)
    pedidos, erro = lista_de_carga(raiz)
    if erro:
        print('versao.py: ' + erro)
        return 1
    faltam = [f for f in pedidos if f not in arquivos]
    if faltam:
        print('versao.py: a lista de carga do index.html cita %d arquivo(s) que NÃO estão no pacote: %s'
              % (len(faltam), ', '.join(faltam[:5])))
        print('           (esqueceu de commitar? o .gitignore ou o .dockerignore o deixou de fora?)')
        print('           o jogo subiria sem ele, calado — o build para aqui')
        return 1
    versao, tam = escreve(raiz, arquivos)
    n_marcas = grava_marcas(raiz, arquivos)
    print('versao.py: %s — %d arquivos com hash, %d modelos conferidos, %d da lista de carga no pacote, '
          '%d marcas em %s, %s com %d bytes'
          % (versao, len(arquivos), conferidos, len(pedidos), n_marcas, marcas, SAIDA, tam))
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(main(sys.argv))
