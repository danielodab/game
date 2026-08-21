# -*- coding: utf-8 -*-
"""Embute as peças de cenário separadas num arquivo JS do jogo.

Rodar (Python puro — não precisa de Blender):
    python tools/embute_cenario.py

As peças já saíram de `separa_cenario.py` prontas: uma por arquivo, assentadas
no chão, centradas e com a textura reamostrada. Aqui é só dar NOME e PAPEL a
cada uma e gravar em base64, como todo o resto do acervo.

O NOME IMPORTA. `itens_jardim_03` não diz nada e some na primeira vez que o
Daniel gerar outra folha; `jd_coluna_vidro` diz o que é e sobrevive a
renumeração. A tabela abaixo foi montada OLHANDO os retratos que
`contato_cenario.py` gerou — não pela altura nem pela ordem do arquivo, que já
me enganaram antes.
"""
import io, os, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\jardim\_separado"
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-jardim.js")

# arquivo -> (chave, nome, papel)
#   baixo = divisória (0,95 m) · alto = coluna (3,10 m)
#   chao  = enfeite de piso    · borda = enfeite fora da arena
PECAS = [
    ("itens_jardim2_01.glb",  "jd_regador",      "Regador de cobre tombado",          "baixo"),
    ("itens_jardim_01.glb",   "jd_carrinho",     "Carrinho de jardim tombado",        "baixo"),
    ("itens_jardim_02.glb",   "jd_tronco",       "Tronco serrado com cogumelos",      "baixo"),
    ("itens_jardmi_5_01.glb", "jd_redoma",       "Redoma de vidro quebrada",          "baixo"),
    ("itens_jardmi_5_02.glb", "jd_canteiro",     "Canteiro suspenso com brotos",      "baixo"),
    ("itens_jardmi_5_03.glb", "jd_vaso",         "Vaso de barro rachado",             "baixo"),

    ("itens_jardim_03.glb",   "jd_coluna_vidro", "Coluna de vidro da estufa",         "alto"),
    ("itens_jardim_04.glb",   "jd_cipo",         "Cipó grosso na estaca",             "alto"),
    ("itens_jardim_3_03.glb", "jd_estatua",      "Estátua de jardineiro musgosa",     "alto"),

    ("itens_jardim2_02.glb",  "jd_cristal_p",    "Cristais pequenos no chão",         "chao"),
    ("itens_jardim_4_02.glb", "jd_cristal_g",    "Afloramento de cristais",           "chao"),
    ("itens_jardim_3_01.glb", "jd_raiz",         "Raiz rompendo a laje",              "chao"),
    ("itens_jardim_3_02.glb", "jd_poca",         "Poça de água parada",               "chao"),

    ("itens_jardim2_03.glb",  "jd_escada",       "Escada de podar",                   "borda"),
    # O Meshy pôs a árvore morta com os galhos por cima da estufa menor, e as
    # duas se tocam vistas de cima — a separação por vizinhança não tem como
    # cortar aí. Ficam como UMA peça de fundo, o que para enfeite de borda
    # funciona: é um canto de cenário, não um obstáculo.
    ("itens_jardim_4_01.glb", "jd_estufa_arvore", "Estufa menor com árvore morta",    "borda"),
]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - cenário da ESTUFA SOTERRADA, feito pelo usuário no Meshy.",
        " *",
        " * Chegaram cinco folhas com várias peças GRUDADAS numa malha só (o Meshy",
        " * gera assim para não gastar um crédito por barril). `separa_cenario.py`",
        " * corta por vizinhança de ilhas de geometria — partir por 'parte solta'",
        " * não serve, porque cada folha e cada cogumelo é uma casca desconectada.",
        " *",
        " * `JOGO.CENARIO[tema][papel]` diz ao renderizador o que usar onde:",
        " *   baixo = divisória (0,95 m, bloqueia passagem e não a visão)",
        " *   alto  = coluna (3,10 m, bloqueia tudo)",
        " *   chao  = enfeite de piso, sem colisão",
        " *   borda = enfeite fora da arena",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.CENARIO = JOGO.CENARIO || {};",
        "JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};",
    ]

    papeis = {"baixo": [], "alto": [], "chao": [], "borda": []}
    total, faltando = 0, []
    for arq, chave, nome, papel in PECAS:
        caminho = os.path.join(ORIG, arq)
        if not os.path.exists(caminho):
            faltando.append(arq); continue
        dados = open(caminho, "rb").read()
        b64 = base64.b64encode(dados).decode("ascii")
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, b64))
        linhas.append("JOGO.CENARIO_NOME['%s']=%s;" % (chave, json.dumps(nome, ensure_ascii=False)))
        papeis[papel].append(chave)
        total += len(dados)

    linhas.append("JOGO.CENARIO['garden']=%s;" % json.dumps(papeis, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENÁRIO DA ESTUFA ===")
    for p in ("baixo", "alto", "chao", "borda"):
        print("  %-6s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binário %.2f MB · arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
