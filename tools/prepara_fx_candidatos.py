# -*- coding: utf-8 -*-
"""Prepara os CANDIDATOS de efeito de golpe (30/08, madrugada).

Fonte: "Weapon Slash - Effect" de Cethiel, OpenGameArt, CC0 — baixado e
conferido (só .png, 125 quadros). Cada efeito tem ~6 quadros com ALPHA;
o FX.filme da casa toca folhas 4x4, então cada efeito vira uma folha
4x4 com os quadros redistribuídos (repetição uniforme — o ritmo fica).

Saída em assets/candidatos/fx_ataque/: uma folha por efeito/cor + um
contato geral para o dono ESCOLHER — arte de golpe não entra no motor
sem o aval dele (o precedente do acervo de candidatos).
"""
import os, re
from PIL import Image

ORIG = r"C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-Documents-Jogo\a98cec71-cbbd-46b3-b1b4-426827f1537e\scratchpad\fx_dl\cethiel"
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(RAIZ, "assets", "candidatos", "fx_ataque")
CELL = 192          # cada célula da folha: 192 px -> folha 768x768
GRID = 4

os.makedirs(DEST, exist_ok=True)

# agrupa: <variacao>/<numero do efeito>/frames*.png
efeitos = {}
for raiz, _, arqs in os.walk(ORIG):
    pngs = sorted(a for a in arqs if a.lower().endswith(".png"))
    if not pngs:
        continue
    rel = os.path.relpath(raiz, ORIG)
    partes = rel.replace("\\", "/").split("/")
    if len(partes) != 2:
        continue
    variacao, numero = partes
    chave = "%s_fx%s" % (re.sub(r"\W+", "_", variacao.lower()).strip("_"), numero)
    efeitos[chave] = [os.path.join(raiz, a) for a in pngs]

print("efeitos achados:", len(efeitos))

folhas = []
for chave, frames in sorted(efeitos.items()):
    imgs = [Image.open(f).convert("RGBA") for f in frames]
    n = len(imgs)
    folha = Image.new("RGBA", (CELL * GRID, CELL * GRID), (0, 0, 0, 0))
    for i in range(GRID * GRID):
        src = imgs[min(n - 1, i * n // (GRID * GRID))]
        # encaixa mantendo proporção
        im = src.copy()
        im.thumbnail((CELL, CELL), Image.LANCZOS)
        x = (i % GRID) * CELL + (CELL - im.width) // 2
        y = (i // GRID) * CELL + (CELL - im.height) // 2
        folha.paste(im, (x, y), im)
    cam = os.path.join(DEST, chave + "_4x4.png")
    folha.save(cam, optimize=True)
    folhas.append((chave, cam, n))
    print("  %-28s %d quadro(s) -> %s" % (chave, n, os.path.basename(cam)))

# o contato: primeiro quadro cheio de cada efeito, com rótulo
from PIL import ImageDraw
COLS = 5
TAM = 160
linhas = (len(folhas) + COLS - 1) // COLS
contato = Image.new("RGBA", (COLS * TAM, linhas * (TAM + 22)), (16, 18, 22, 255))
d = ImageDraw.Draw(contato)
for i, (chave, cam, n) in enumerate(folhas):
    primeiro = sorted(efeitos[chave])[len(efeitos[chave]) // 2]   # quadro do MEIO: o golpe aberto
    im = Image.open(primeiro).convert("RGBA")
    im.thumbnail((TAM, TAM), Image.LANCZOS)
    x = (i % COLS) * TAM
    y = (i // COLS) * (TAM + 22)
    contato.paste(im, (x + (TAM - im.width) // 2, y + (TAM - im.height) // 2), im)
    d.text((x + 4, y + TAM + 4), chave[:24], fill=(232, 194, 90, 255))
contato.save(os.path.join(DEST, "_contato.png"), optimize=True)
print("contato:", os.path.join(DEST, "_contato.png"))
print("LICENCA: CC0 (Cethiel, OpenGameArt) — anotada em _licenca.txt")
with open(os.path.join(DEST, "_licenca.txt"), "w", encoding="utf-8") as f:
    f.write("Weapon Slash - Effect\nAutor: Cethiel\nFonte: https://opengameart.org/content/weapon-slash-effect\n"
            "Licenca: CC0 (dominio publico) - uso comercial livre, sem atribuicao obrigatoria.\n"
            "Baixado e conferido em 30/08/2026 (so .png no pacote).\n")
