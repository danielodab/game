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
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-jardim.js")

# DUAS PASTAS, e não uma. As folhas de MURO chegaram depois, e reprocessá-las
# junto com as antigas renumeraria as quinze peças que a tabela abaixo já cita
# pelo número do arquivo. Então elas foram separadas numa subpasta própria e
# cada uma tem o seu `_separado`. Procura-se nas duas, na ordem.
ORIGENS = [
    r"C:\Users\danie\Downloads\assets_ok\mapa\jardim\_separado",
    r"C:\Users\danie\Downloads\assets_ok\mapa\jardim\muros\_separado",
]

# arquivo -> (chave, nome, papel)
#   alto         = MÓDULO de parede (3,10 m), o muro que se enfileira
#   pilar        = pontuação da parede: entra a cada 4 casas, nunca constrói
#   sotaque_alto = enfeite alto que entra UMA vez por trecho longo de parede
#   baixo        = MÓDULO de divisória (0,95 m)
#   sotaque      = enfeite baixo, UMA vez por fileira de divisória
#   chao         = enfeite de piso · borda = fora da arena
#
# OS MÓDULOS DE MURO CHEGARAM. Enquanto não havia nenhum, as seis peças
# decorativas eram duplicadas em `baixo` — alguma coisa tinha de segurar a
# fileira, e um regador tombado repetido cinco vezes segurava mal, mas segurava.
# Agora `baixo` tem quatro muros de verdade, feitos para enfileirar, e a
# duplicação saiu: as decorativas voltaram a ser SÓ `sotaque`, que é o papel
# definitivo delas — o enfeite pontual no meio de um muro corrido.
PECAS = [
    ("itens_jardim2_01.glb",  "jd_regador",      "Regador de cobre tombado",          "sotaque"),
    ("itens_jardim_01.glb",   "jd_carrinho",     "Carrinho de jardim tombado",        "sotaque"),
    ("itens_jardim_02.glb",   "jd_tronco",       "Tronco serrado com cogumelos",      "sotaque"),
    ("itens_jardmi_5_01.glb", "jd_redoma",       "Redoma de vidro quebrada",          "sotaque"),
    ("itens_jardmi_5_02.glb", "jd_canteiro",     "Canteiro suspenso com brotos",      "sotaque"),
    ("itens_jardmi_5_03.glb", "jd_vaso",         "Vaso de barro rachado",             "sotaque"),

    # OS MÓDULOS DE MURO. Cada folha veio com UMA peça só — o Meshy desta vez
    # não empilhou várias — e cada uma já nasce como um trecho de alvenaria de
    # ponta a ponta, larga o dobro da altura. É o que `baixo` sempre quis: cinco
    # cópias lado a lado leem como uma barreira, não como cinco objetos.
    ("muro_com_pilastra_inteiro_01.glb", "jd_muro_pilastra", "Muro de pilastras inteiro",    "alto"),
    ("muro_com_pilastra_furado_01.glb",  "jd_muro_brecha",   "Muro de pilastras com brecha", "alto"),
    ("muro_sem_pilastra_furado_01.glb",  "jd_muro_ruina",    "Muro desabado em ruína",       "alto"),
    ("muros_com_mato_01.glb",            "jd_muro_mato",     "Muro tomado pelo mato",        "alto"),

    ("itens_jardim_03.glb",   "jd_coluna_vidro", "Coluna de vidro da estufa",         "sotaque_alto"),
    ("itens_jardim_04.glb",   "jd_cipo",         "Cipó grosso na estaca",             "sotaque_alto"),
    ("itens_jardim_3_03.glb", "jd_estatua",      "Estátua de jardineiro musgosa",     "sotaque_alto"),
    # o pilar sai da folha com o entulho que caiu ao pé dele, e fica: o vão entre
    # a coluna e as pedras é menor que a folga, e a ruína ao pé combina com a
    # Estufa Soterrada. O preço é a caixa mais larga, que rouba um pouco da
    # altura na normalização — 2,8 m em vez de 3,1 m, ainda bem acima do herói.
    ("pilar_01.glb",          "jd_pilar",        "Pilar de pedra com entulho ao pé",  "pilar"),

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
        " * Chegaram dez folhas: cinco de enfeite, com várias peças GRUDADAS numa",
        " * malha só (o Meshy gera assim para não gastar um crédito por barril), e",
        " * cinco de alvenaria, com uma peça cada. `separa_cenario.py` corta por",
        " * vizinhança de ilhas de geometria — partir por 'parte solta' não serve,",
        " * porque cada folha e cada cogumelo é uma casca desconectada.",
        " *",
        " * `JOGO.CENARIO[tema][papel]` diz ao renderizador o que usar onde:",
        " *   baixo   = divisória (0,95 m, bloqueia passagem e não a visão)",
        " *   alto    = coluna (3,10 m, bloqueia tudo)",
        " *   sotaque = enfeite pontual, UMA vez no miolo de uma fileira de `baixo`",
        " *   chao    = enfeite de piso, sem colisão",
        " *   borda   = enfeite fora da arena",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.CENARIO = JOGO.CENARIO || {};",
        "JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};",
    ]

    papeis = {"baixo": [], "alto": [], "pilar": [], "sotaque": [],
              "sotaque_alto": [], "chao": [], "borda": []}
    total, faltando = 0, []
    for arq, chave, nome, papel in PECAS:
        caminho = None
        for pasta in ORIGENS:
            tenta = os.path.join(pasta, arq)
            if os.path.exists(tenta):
                caminho = tenta; break
        if not caminho:
            faltando.append(arq); continue
        dados = open(caminho, "rb").read()
        b64 = base64.b64encode(dados).decode("ascii")
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, b64))
        linhas.append("JOGO.CENARIO_NOME['%s']=%s;" % (chave, json.dumps(nome, ensure_ascii=False)))
        papeis[papel].append(chave)
        # O MESMO MÓDULO SERVE ALTO E BAIXO, e isso não é muleta: é como se faz
        # arte de fase. Um "muro de pilastras" a 3,10 m é parede; o mesmo módulo
        # a 0,95 m é MURETA, que é exatamente o que a casa de divisória pede.
        # Sem isso, `baixo` ficaria vazio e as divisórias voltariam para os
        # barris emprestados — que é do que o Daniel reclamou no começo.
        if papel == "alto":
            papeis["baixo"].append(chave)
        # Aqui havia um `if papel == "sotaque": papeis["baixo"].append(chave)`.
        # Era muleta enquanto `baixo` estava vazio, e saiu com a chegada dos
        # muros: enfeite repetido casa a casa não é divisória, é entulho.
        total += len(dados)

    linhas.append("JOGO.CENARIO['garden']=%s;" % json.dumps(papeis, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENÁRIO DA ESTUFA ===")
    for p in ("alto", "pilar", "sotaque_alto", "baixo", "sotaque", "chao", "borda"):
        print("  %-6s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binário %.2f MB · arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
