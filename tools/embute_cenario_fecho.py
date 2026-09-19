# -*- coding: utf-8 -*-
"""Embute o cenário do FECHO DE BRASA (forja) num arquivo JS do jogo.

Rodar (Python puro — não precisa de Blender):
    python tools/embute_cenario_fecho.py

As dezesseis peças de enfeite saíram de `separa_pecas.py --mapa` (três folhas
de 4, 5 e 7 — o separador por caixa colava vizinhas e o Meshy pôs um braseiro
a mais na terceira; o mapa que diz o que junta com o quê foi escrito olhando
os retratos brutos, `--bruto`, e conferido nos retratos das peças montadas) e
os muros/pilar de `normaliza_muros_fecho.py`. Os nomes dos arquivos vêm do
nome de cada peça no briefing (docs/FECHO_DE_BRASA.html).

OS PAPÉIS são os mesmos da Cisterna:
  alto         = MÓDULO de parede (3,10 m), o muro que se enfileira
  pilar        = pontuação da parede, a cada 4 casas de trecho longo
  marco        = o forno de fundição, UMA vez por sala (regra do aquário)
  sotaque_alto = enfeite alto, UMA vez por trecho longo de parede
  baixo        = MÓDULO de divisória (0,95 m) — os altos servem, achatados
  sotaque      = enfeite baixo, UMA vez por fileira de divisória
  chao         = enfeite de piso · borda = fora da arena
  chao_alt     = 0,40: a grelha e o carvão a 25 cm viravam selo; a 0,5 da
                 Cisterna o martelo esquecido ficava do tamanho de um herói.
"""
import io, os, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-fecho.js")

ORIGENS = [
    r"C:\Users\danie\Downloads\assets_ok\mapa\O fecho de Brasa\itens mapa\_separado",
    r"C:\Users\danie\Downloads\assets_ok\mapa\O fecho de Brasa\muros\_separado",
]

# arquivo -> (chave, nome, papel)
PECAS = [
    ("muro.glb",           "fj_muro",          "Muro de tijolo refratário da forja",   "alto"),
    ("muro_quebrado.glb",  "fj_muro_quebrado", "Muro da forja, quebrado",              "alto"),
    ("pilar.glb",          "fj_pilar",         "Pilar de ferro e tijolo",              "pilar"),

    ("forno_de_fundicao.glb", "fj_forno",      "Forno de fundição, boca acesa",        "marco"),

    # altos e finos: entram nas fileiras altas, uma vez por trecho
    ("chamine_de_forja.glb",              "fj_chamine",   "Chaminé de forja com fuligem",      "sotaque_alto"),
    ("feixe_de_correntes_com_ganchos.glb","fj_correntes", "Feixe de correntes com ganchos",    "sotaque_alto"),
    ("prensa_parada_no_meio_do_golpe.glb","fj_prensa",    "Prensa parada no meio do golpe",    "sotaque_alto"),

    # baixos: pontuam as fileiras de divisória
    ("bigorna_fria_no_cepo.glb",            "fj_bigorna",  "Bigorna fria no cepo",              "sotaque"),
    ("calha_de_tempera.glb",                "fj_calha",    "Calha de têmpera, água preta",      "sotaque"),
    ("pilha_de_lingotes.glb",               "fj_lingotes", "Pilha de lingotes",                 "sotaque"),
    ("bancada_com_ferramentas_cravadas.glb","fj_bancada",  "Bancada com ferramentas cravadas",  "sotaque"),
    ("fole_duplo_de_couro.glb",             "fj_fole",     "Fole duplo de couro",               "sotaque"),
    # o Meshy pôs SETE objetos na folha de seis: o braseiro sobrou e serve
    ("braseiro_de_carvao.glb",              "fj_braseiro", "Braseiro de carvão",                "sotaque"),

    # piso vestido, sem colisão
    ("grelha_de_piso_acesa.glb",          "fj_grelha",  "Grelha de piso acesa",             "chao"),
    ("limalha_com_martelo_esquecido.glb", "fj_limalha", "Limalha com martelo esquecido",    "chao"),
    ("carvao_derramado.glb",              "fj_carvao",  "Carvão derramado",                 "chao"),

    # fora da arena: o fundo que faz o campo parecer dentro de um lugar maior
    ("martelo_pilao.glb",                 "fj_pilao",    "Martelo-pilão",                    "borda"),
    ("carrinho_de_minerio_no_trilho.glb", "fj_carrinho", "Carrinho de minério no trilho",    "borda"),
    ("sino_de_fim_de_turno.glb",          "fj_sino",     "Sino de fim de turno",             "borda"),
]

# a chaminé e as correntes repetem na borda, como a Cisterna repetiu o
# estandarte e a luminária — a 2,2-4,6 m elas leem como o fundo da forja
BORDA_EXTRA = ["fj_chamine", "fj_correntes"]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - cenário do FECHO DE BRASA (forja), feito pelo usuário",
        " * no Meshy: dois muros e um pilar, o forno de fundição (papel `marco`,",
        " * UM por sala) e quinze enfeites de forja recortados de três folhas.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.CENARIO = JOGO.CENARIO || {};",
        "JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};",
    ]

    papeis = {"baixo": [], "alto": [], "pilar": [], "marco": [], "sotaque": [],
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
        # o mesmo módulo serve ALTO e BAIXO: a 3,10 m é parede, a 0,95 m é mureta
        if papel == "alto":
            papeis["baixo"].append(chave)
        total += len(dados)

    for chave in BORDA_EXTRA:
        if chave in papeis["sotaque_alto"]:
            papeis["borda"].append(chave)

    catalogo = dict(papeis)
    catalogo["chao_alt"] = 0.4
    # o renderizador mede a fração do CORPO de cada módulo de muro: se o muro
    # tiver pilar nas pontas e corpo baixo, estica até o corpo fechar a
    # parede; se for uniforme, a medida devolve ~1 e nada muda
    catalogo["alto_corpo"] = "auto"
    # a chave é 'forge' porque é o `theme`/`sceneryTheme` que o calabouço
    # emberlock declara em dungeons.js — o catálogo atende pelo nome que o
    # renderizador pergunta
    linhas.append("JOGO.CENARIO['forge']=%s;" % json.dumps(catalogo, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENÁRIO DO FECHO DE BRASA ===")
    for p in ("alto", "pilar", "marco", "sotaque_alto", "baixo", "sotaque", "chao", "borda"):
        print("  %-12s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binário %.2f MB · arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
