# -*- coding: utf-8 -*-
"""Exporta JOGO.DATA (a linha JS) para JSON que a Unity lê por Resources.Load.

Dono: Criativo/Dados (CONTRATO_UNITY_F1 §4).

POR QUE EXECUTAR O JS EM VEZ DE CONVERTER O TEXTO
    `fusions.js`, `items.js`, `items_extra.js`, `monsters.js` e `pets.js` geram
    conteudo em laco: espelham as misturas elementais, derivam `element`/`setId`
    a partir do conjunto no rodape do arquivo, montam as formas de fusao uma a
    uma. Um conversor de texto entregaria so os literais e perderia a maior
    parte do acervo — calada, sem erro nenhum.

POR QUE CHROME HEADLESS
    Nao ha Node nesta maquina. O Chrome carrega `tests/dump_dados.html`, que
    puxa os dez `js/core/data/*.js` na ordem do `v2.html`, serializa e devolve
    tudo em base64 pelo `--dump-dom`.

USO
    python tools/exporta_dados_unity.py
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGINA = os.path.join(RAIZ, "tests", "dump_dados.html")
SAIDA = os.path.join(RAIZ, "unity", "SOTERRA-Tatico", "Assets", "Resources", "dados")

# Ancoras de CONTRATO_UNITY_F1 §4, tiradas de SISTEMAS.md. Sao conferencia, nao
# meta: se o dado real divergir, o DADO ganha e a divergencia vai para o
# relatorio. Nada aqui corrige contagem.
ANCORAS = {
    "spells": 171,
    "classes": 6,
    "dungeons": 6,
    "fusionForms": 105,
    "fusionBlends": 16,
    "elements": 5,
    "weathers": 5,
}

# Marcas com `#` e nao com `<`/`>`: o `--dump-dom` devolve HTML serializado e
# escaparia os sinais para `&lt;`/`&gt;`, que nao casariam mais. `#` atravessa
# intacto e nao existe no alfabeto base64.
MARCA_B64 = re.compile(r"#B64INI#([A-Za-z0-9+/=\s]*?)#B64FIM#", re.S)
MARCA_ERRO = re.compile(r"#ERROINI#(.*?)#ERROFIM#", re.S)


def roda_chrome():
    """Devolve o DOM impresso pelo Chrome headless, como texto."""
    if not os.path.isfile(CHROME):
        raise SystemExit("Chrome nao encontrado em %s" % CHROME)
    if not os.path.isfile(PAGINA):
        raise SystemExit("pagina de dump nao encontrada em %s" % PAGINA)

    # Perfil descartavel e obrigatorio: com o perfil normal do usuario o
    # chrome.exe apenas repassa a URL para a janela ja aberta, devolve na hora e
    # nao imprime DOM nenhum ("Abrindo em uma sessao de navegador existente").
    perfil = tempfile.mkdtemp(prefix="soterra-dump-")
    try:
        argv = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--dump-dom",
            # Os dez scripts sao sincronos, mas o orcamento de tempo virtual da
            # folga para o parse dos ~480 KB de JS antes do DOM ser impresso.
            "--virtual-time-budget=15000",
            "--user-data-dir=" + perfil,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            # A pagina esta em file://; sem isto o Chrome trata cada arquivo como
            # origem opaca em algumas versoes e os `<script src>` irmaos falham.
            "--allow-file-access-from-files",
            _url_arquivo(PAGINA),
        ]
        proc = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
        # stderr do Chrome headless e ruido de GPU/DBus mesmo quando tudo deu
        # certo; so interessa se a saida veio vazia.
        texto = proc.stdout.decode("utf-8", errors="replace")
        if not texto.strip():
            raise SystemExit(
                "Chrome nao imprimiu DOM (codigo %d). stderr:\n%s"
                % (proc.returncode, proc.stderr.decode("utf-8", errors="replace")[:2000])
            )
        return texto
    finally:
        shutil.rmtree(perfil, ignore_errors=True)


def _url_arquivo(caminho):
    return "file:///" + os.path.abspath(caminho).replace("\\", "/")


def extrai_pacote(dom):
    erro = MARCA_ERRO.search(dom)
    if erro:
        raise SystemExit("a pagina de dump reportou: " + erro.group(1).strip())

    achado = MARCA_B64.search(dom)
    if not achado:
        raise SystemExit(
            "marca de inicio ausente no DOM — os dados nao chegaram a serializar.\n"
            "Inicio do que veio:\n" + dom[:1500]
        )

    bruto = re.sub(r"\s+", "", achado.group(1))
    return json.loads(base64.b64decode(bruto).decode("utf-8"))


def escreve(pacote):
    os.makedirs(SAIDA, exist_ok=True)

    # Limpa os JSON antigos antes de escrever: chave removida no JS deixaria um
    # arquivo orfao aqui, e a Unity carregaria dado morto sem ninguem perceber.
    # Os `.meta` ficam — sao da Unity, e apagar troca o GUID a cada exportacao.
    for nome in os.listdir(SAIDA):
        if nome.endswith(".json"):
            os.remove(os.path.join(SAIDA, nome))

    escritos = []
    for chave, texto in sorted(pacote["dados"].items()):
        if texto is None:
            continue
        destino = os.path.join(SAIDA, chave + ".json")
        # newline="\n" explicito: sem isso o Python no Windows troca cada \n por
        # \r\n e o diff de 1 MB vira ruido de fim de linha na primeira geracao.
        with open(destino, "w", encoding="utf-8", newline="\n") as f:
            f.write(texto)
            f.write("\n")
        escritos.append((chave, os.path.getsize(destino)))

    manifesto = {
        "gerado": pacote["gerado"],
        "fonte": pacote["fonte"],
        "chaves": {k: pacote["chaves"][k] for k in sorted(pacote["chaves"])},
    }
    with open(os.path.join(SAIDA, "_manifesto.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifesto, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    return escritos


def relata(pacote, escritos):
    chaves = pacote["chaves"]

    print("chave                     contagem      bytes")
    print("-" * 46)
    total = 0
    for chave, tam in escritos:
        total += tam
        print("%-24s %9s %10s" % (chave, chaves.get(chave), "{:,}".format(tam)))
    manifesto = os.path.getsize(os.path.join(SAIDA, "_manifesto.json"))
    total += manifesto
    print("%-24s %9s %10s" % ("_manifesto.json", len(chaves), "{:,}".format(manifesto)))
    print("-" * 46)
    print("total em disco: {:,} bytes ({:.1f} KB)".format(total, total / 1024.0))

    print("\nancoras (SISTEMAS.md) x dado real:")
    divergencias = []
    for chave, esperado in sorted(ANCORAS.items()):
        real = chaves.get(chave)
        if real == esperado:
            print("  OK        %-14s %s" % (chave, real))
        else:
            divergencias.append((chave, esperado, real))
            print("  DIVERGE   %-14s ancora %s, real %s" % (chave, esperado, real))

    if pacote["avisos"]:
        print("\navisos de serializacao (perda silenciosa de JSON.stringify):")
        for a in pacote["avisos"]:
            print("  - " + a)
    else:
        print("\nnenhuma perda de serializacao: sem funcao, undefined, NaN ou ciclo no acervo.")

    # Codigo de saida 0 mesmo divergindo: o contrato manda relatar a divergencia,
    # nao esconder o dado. Quebrar aqui empurraria alguem a "ajustar" o numero.
    return divergencias


def main():
    dom = roda_chrome()
    pacote = extrai_pacote(dom)
    escritos = escreve(pacote)
    relata(pacote, escritos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
