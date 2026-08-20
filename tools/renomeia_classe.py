# -*- coding: utf-8 -*-
"""Renomeia o id de uma classe em todo o projeto, com cuidado.

  python tools/renomeia_classe.py curandeira curandeiro

POR QUE UMA FERRAMENTA E NAO UM SED
-----------------------------------
O id da classe aparece em ids DERIVADOS — `curandeira-fogo-12`,
`fus:arqueiro+curandeira:...` — e num sed descuidado `curandeira` vira
`curandeiro` dentro de `curandeirax` ou de uma palavra em portugues no meio de
uma descricao. Aqui a troca respeita fronteira de identificador.

E o SAVE do jogador guarda o id da classe de cada heroi. Sem migracao, o heroi
existente aponta para uma classe que nao existe mais e some da lista sem aviso.
A migracao entra em progress.js e roda uma vez.
"""
import io, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# tudo menos o que e gerado ou externo
PASTAS = ["js", "tests", "docs"]
SOLTOS = ["index.html", "README.md"]
PULAR = ("assets/embedded", "assets/candidatos", "assets/models",
         "node_modules", ".git", "www")


def arquivos():
    for p in PASTAS:
        for raiz, _, nomes in os.walk(os.path.join(RAIZ, p)):
            rel = os.path.relpath(raiz, RAIZ).replace("\\", "/")
            if any(rel.startswith(x) for x in PULAR):
                continue
            for n in nomes:
                if n.endswith((".js", ".html", ".md", ".css")):
                    yield os.path.join(raiz, n)
    for n in SOLTOS:
        c = os.path.join(RAIZ, n)
        if os.path.exists(c):
            yield c


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return
    velho, novo = sys.argv[1], sys.argv[2]
    # fronteira de identificador: nao pega `curandeirax` nem `xcurandeira`
    padrao = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(velho) + r"(?![A-Za-z0-9_])")

    tocados, total = [], 0
    for cam in arquivos():
        try:
            s = io.open(cam, encoding="utf-8").read()
        except Exception:
            continue
        n = len(padrao.findall(s))
        if not n:
            continue
        io.open(cam, "w", encoding="utf-8", newline="\n").write(padrao.sub(novo, s))
        tocados.append((os.path.relpath(cam, RAIZ), n))
        total += n

    tocados.sort(key=lambda x: -x[1])
    print("%s -> %s" % (velho, novo))
    for c, n in tocados[:14]:
        print("  %-42s %3d" % (c, n))
    if len(tocados) > 14:
        print("  ... e mais %d arquivos" % (len(tocados) - 14))
    print("TOTAL: %d trocas em %d arquivos" % (total, len(tocados)))


main()
