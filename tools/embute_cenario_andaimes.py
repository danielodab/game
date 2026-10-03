# -*- coding: utf-8 -*-
"""Embute o cenário dos ANDAIMES DO VENTO (scaffold) num arquivo JS do jogo.

Rodar (Python puro — não precisa de Blender):
    python tools/embute_cenario_andaimes.py

As quinze peças de enfeite saíram de `separa_pecas.py --recortar --conta 5,4,6`
(três folhas do dono, "itens 1/2/3.glb", com 5, 4 e 6 peças; o separador por
vértice achou o patamar certo nas três — nenhuma peça encostada desta vez) e os
muros/viga de `normaliza_muros_andaimes.py`. As folhas vieram sem o nome das
peças no arquivo, então as peças saíram NUMERADAS (folhaN_NN) e o nome de cada
uma foi dado olhando os retratos de `contato_cenario.py` (a folha de contato
está na conversa de 19/09).

OS PAPÉIS são os mesmos da Cisterna e do Fecho:
  alto         = MÓDULO de parede (3,10 m), o muro que se enfileira
  pilar        = pontuação da parede, a cada 4 casas de trecho longo — a VIGA
  marco        = o guindaste travado, UMA vez por sala (regra do aquário)
  sotaque_alto = enfeite alto, UMA vez por trecho longo de parede
  baixo        = MÓDULO de divisória (0,95 m) — os altos servem, achatados
  sotaque      = enfeite baixo, UMA vez por fileira de divisória
  chao         = enfeite de piso · borda = fora da arena
  chao_alt     = 0,40 como no Fecho: a grade e as tábuas a 25 cm viravam selo.

A CORDA ENROLADA (folha1_03) foi pedida como sotaque (a roldana caída) e veio
como um rolo de corda CHATO — 2 cm de altura numa folha de 1 m. Como sotaque
ela esticaria até o teto de largura e ficaria a um terço do papel; como
enfeite de CHÃO ela é exatamente o que parece: corda largada no piso.
"""
import io, os, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-andaimes.js")

ORIGENS = [
    r"C:\Users\danie\Downloads\assets_ok\mapa\Andaimes do vento\itens mapa\_separado",
    r"C:\Users\danie\Downloads\assets_ok\mapa\Andaimes do vento\muros\_separado",
]

# arquivo -> (chave, nome, papel)
PECAS = [
    ("muro.glb",           "av_muro",          "Tapume de tábuas com viga em cada ponta", "alto"),
    ("muro_quebrado.glb",  "av_muro_quebrado", "Tapume de tábuas, quebrado",              "alto"),
    ("viga.glb",           "av_viga",          "Viga de andaime com o prumo pendurado",   "pilar"),

    ("folha2_04.glb",      "av_guindaste",     "Guindaste travado",                       "marco"),

    # altos e finos: entram nas fileiras altas, uma vez por trecho
    ("folha2_01.glb",      "av_chamine",       "Chaminé de ventilação",                   "sotaque_alto"),
    ("folha2_02.glb",      "av_mastro",        "Mastro com lona e bandeirola",            "sotaque_alto"),
    ("folha2_03.glb",      "av_torre",         "Torre de andaime com escada",             "sotaque_alto"),

    # baixos: pontuam as fileiras de divisória
    ("folha1_01.glb",      "av_caixa",         "Caixa de ferramentas aberta",             "sotaque"),
    ("folha1_02.glb",      "av_saco",          "Saco de brita de lastro",                 "sotaque"),
    ("folha1_04.glb",      "av_cabo",          "Rolo de cabo de aço",                     "sotaque"),
    ("folha1_05.glb",      "av_estrado",       "Estrado de tábuas amarradas",             "sotaque"),

    # piso vestido, sem colisão
    ("folha3_01.glb",      "av_grade",         "Grade de respiradouro",                   "chao"),
    ("folha3_02.glb",      "av_tabuas",        "Tábuas soltas com pregos",                "chao"),
    ("folha3_03.glb",      "av_ninho",         "Ninho de picanço na serragem",            "chao"),
    ("folha1_03.glb",      "av_corda",         "Corda enrolada no chão",                  "chao"),

    # fora da arena: o fundo que faz o campo parecer dentro de um lugar maior
    ("folha3_04.glb",      "av_elevador",      "Elevador de obra parado",                 "borda"),
    ("folha3_05.glb",      "av_passarela",     "Passarela quebrada",                      "borda"),
    ("folha3_06.glb",      "av_barraca",       "Barraca de turno",                        "borda"),
]

# a chaminé e a torre repetem na borda, como o Fecho repetiu a chaminé e as
# correntes — a 2,2-4,6 m elas leem como o poço de andaimes ao fundo
BORDA_EXTRA = ["av_chamine", "av_torre"]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - cenário dos ANDAIMES DO VENTO (scaffold), feito pelo",
        " * usuário no Meshy: muro, muro quebrado e viga, o guindaste travado (papel",
        " * `marco`, UM por sala) e catorze enfeites de obra recortados de três folhas.",
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
    # o renderizador mede a fração do CORPO de cada módulo de muro: o tapume
    # tem uma viga em cada ponta subindo acima das tábuas, então estica até o
    # corpo fechar a parede; se a medida devolver ~1 nada muda
    catalogo["alto_corpo"] = "auto"
    # a chave é 'scaffold' porque é o `theme`/`sceneryTheme` que o calabouço
    # windscaffold declara em dungeons.js — o catálogo atende pelo nome que o
    # renderizador pergunta
    linhas.append("JOGO.CENARIO['scaffold']=%s;" % json.dumps(catalogo, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENÁRIO DOS ANDAIMES DO VENTO ===")
    for p in ("alto", "pilar", "marco", "sotaque_alto", "baixo", "sotaque", "chao", "borda"):
        print("  %-12s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binário %.2f MB · arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
# 02/10: relevo e metal/rugosidade a 512, a cor fica em 1024 (o que o dono
# aprovou na comparacao lado a lado). Sem isto, rodar este embute de novo para
# trocar uma peca devolvia o arquivo inteiro a 1024 sem ninguem notar.
import reduz_texturas  # noqa: E402  (mora ao lado, em tools/)
reduz_texturas.reduz_arquivo(SAIDA)
