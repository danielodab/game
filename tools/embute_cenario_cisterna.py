# -*- coding: utf-8 -*-
"""Embute o cenário da CORTE AFOGADA (Cisterna) num arquivo JS do jogo.

Rodar (Python puro — não precisa de Blender):
    python tools/embute_cenario_cisterna.py

As nove peças de enfeite saíram de `separa_cenario.py --recortar` (três folhas
de três) e os muros/aquário de `normaliza_muros_cisterna.py` — estes NÃO
passam pelo separador porque o aquário tem peixes soltos que o recorte
descartaria como caco.

A tabela foi montada OLHANDO os retratos de `contato_cenario.py`, como sempre.

DOIS PAPÉIS NOVOS NESTE TEMA:
  marco    = a peça que entra UMA VEZ POR SALA, cravada. Regra do Daniel para o
             aquário: "deve ficar em somente um por sala". O renderizador trava
             o marco na primeira casa de sotaque da varredura.
  chao_alt = altura do enfeite de piso deste tema (lustre caído e barril
             tombado a 25 cm viravam miniatura; aqui pedem meio metro).
"""
import io, os, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-cisterna.js")

ORIGENS = [
    r"C:\Users\danie\Downloads\assets_ok\mapa\A Corte Afogada\itens salas\_separado",
    r"C:\Users\danie\Downloads\assets_ok\mapa\A Corte Afogada\muros\_separado",
]

# arquivo -> (chave, nome, papel)
#   alto         = MÓDULO de parede (3,10 m), o muro que se enfileira
#   pilar        = pontuação da parede, a cada 4 casas de trecho longo. A
#                  dívida do `pilares.crdownload` FOI PAGA (30/08): o arquivo
#                  chegou inteiro e a folha trazia DOIS pilares gêmeos,
#                  recortados pelo separa_cenario em PASTA ISOLADA — rodá-lo
#                  na pasta dos muros regravaria o _separado inteiro e
#                  renumeraria peças que a tabela já cita pelo nome.
#   marco        = o aquário, UMA vez por sala
#   sotaque_alto = enfeite alto, UMA vez por trecho longo de parede
#   baixo        = MÓDULO de divisória (0,95 m) — os altos servem, achatados
#   sotaque      = enfeite baixo, UMA vez por fileira de divisória
#   chao         = enfeite de piso · borda = fora da arena
PECAS = [
    ("muro_inteiro.glb", "cs_muro_inteiro", "Muro de pedra da cisterna",        "alto"),
    ("muro_furado.glb",  "cs_muro_brecha",  "Muro da cisterna com brecha",      "alto"),

    ("pilar_01.glb",     "cs_pilar_a",      "Pilar da corte, gêmeo primeiro",   "pilar"),
    ("pilar_02.glb",     "cs_pilar_b",      "Pilar da corte, gêmeo segundo",    "pilar"),

    ("aquario.glb",      "cs_aquario",      "Aquário da corte, com peixes",     "marco"),

    # finos e altos: encostam na parede sem roubar a casa vizinha
    ("itens_7a9_01.glb", "cs_estandarte",   "Estandarte encharcado na lança",   "sotaque_alto"),
    ("itens_7a9_02.glb", "cs_luminaria",    "Luminária tomada por algas",       "sotaque_alto"),
    ("itens_1a3_01.glb", "cs_espelho",      "Espelho de baile afogado",         "sotaque_alto"),

    # baixos e largos: pontuam as fileiras de divisória
    ("itens_1a3_02.glb", "cs_trono",        "Trono de baile encharcado",        "sotaque"),
    ("itens_4a6_01.glb", "cs_sal",          "Formação de sal cristalizado",     "sotaque"),
    ("itens_4a6_03.glb", "cs_poco_lirio",   "Poço com vitórias-régias",         "sotaque"),
    ("itens_7a9_03.glb", "cs_fonte",        "Fonte-coração com bule",           "sotaque"),

    # tombados: enfeite de piso, sem colisão
    ("itens_1a3_03.glb", "cs_lustre",       "Lustre caído da corte",            "chao"),
    ("itens_4a6_02.glb", "cs_barril",       "Barril tombado vazando salmoura",  "chao"),
]

# fora da arena os mesmos enfeites fazem o fundo — a 2,2-4,6 m eles leem como
# cenário de um salão maior, e a Cisterna não tem folha própria de borda
BORDA = ["cs_estandarte", "cs_luminaria", "cs_sal", "cs_poco_lirio"]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - cenário da CORTE AFOGADA (Cisterna), feito pelo usuário",
        " * no Meshy: dois muros, o aquário (papel `marco`, UM por sala) e nove",
        " * enfeites de baile afogado recortados de três folhas.",
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

    for chave in BORDA:
        papeis["borda"].append(chave)

    catalogo = dict(papeis)
    catalogo["chao_alt"] = 0.5
    # os módulos têm PILAR nas pontas e corpo baixo (o inteiro: corpo a 52% da
    # caixa) — com 'auto' o renderizador mede a fração de cada peça e estica
    # até o CORPO fechar a altura da parede, senão o herói vê por cima
    catalogo["alto_corpo"] = "auto"
    # a chave e 'cistern' porque e o `theme`/`sceneryTheme` que o calabouco ja
    # declara em dungeons.js — o catalogo tem de atender pelo nome que o
    # renderizador pergunta, nao pelo nome em portugues da pasta
    linhas.append("JOGO.CENARIO['cistern']=%s;" % json.dumps(catalogo, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENÁRIO DA CISTERNA ===")
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
