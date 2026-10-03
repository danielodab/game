# -*- coding: utf-8 -*-
"""Embute o cenário do CORAÇÃO PARTIDO (heart) num arquivo JS do jogo.

Rodar (Python puro — não precisa de Blender):
    python tools/embute_cenario_coracao.py

DE ONDE VIERAM AS PEÇAS (21/09/2026) — o caminho da Mina, agora apertado. O
dono gerou a IMAGEM no Gemini, com as peças lado a lado, e depois passou a
imagem no Meshy (imagem→3D). Só cabiam a parede e MAIS TRÊS folhas, então o
lote é de 15 peças (a Mina teve 19), com quatro por folha:

  muros\\muros e pilar.glb   → pilar, balaustrada partida, mureta de quatro materiais
  itens mapa\\folha2.glb     → bacia, caco de espelho, raiz, lampiões (os sotaques)
  itens mapa\\folha3.glb     → estátua-marco, arco partido, escadaria, coluna
  itens mapa\\folha4.glb     → mosaico, rachadura, veio de luz, cinza e gelo (o chão)

AS QUATRO SAÍRAM LIMPAS no `separa_pecas.py --recortar --conta 3` e
`--conta 4,4,4`: o separador por vértice achou o patamar sozinho em todas
(0,028 · 0,040 · 0,020 · 0,020) e as peças vieram na ordem exata do briefing,
da esquerda para a direita. Nenhum aro solto desta vez — o prompt fechou com
"no free-floating rings, no loose chain links" justamente por causa das três
argolas do silo da Mina, que contaram como peça e desarrumaram a contagem.
As 15 peças finais estão em `...\\O Coração partido\\_pecas\\`, já com o nome.

A BORDA É REAPROVEITADA, e isso é decisão de folha, não esquecimento: com uma
folha a menos, as três monumentais (arco, escadaria, coluna) entram como
`sotaque_alto` E como `borda`. Fora da arena o renderizador cresce a peça para
2,2-4,6 m, e as três aguentam esse porte — é a mesma licença que o Fecho usou
para repetir a chaminé e os Andaimes para repetir a torre, só que aqui ela
carrega o papel inteiro. O MARCO não entra na borda: ele é a peça de uma vez
por sala (a regra do aquário da Cisterna), e repeti-lo do lado de fora desfaz
a regra.

OS PAPÉIS são os mesmos da Cisterna, do Fecho, dos Andaimes e da Mina:
  alto         = MÓDULO de parede (3,10 m), o muro que se enfileira
  baixo        = MÓDULO de divisória (0,95 m) — os altos servem, achatados
  pilar        = pontuação da parede, a cada 4 casas de trecho longo
  marco        = a estátua sem cabeça, UMA vez por sala (regra do aquário)
  sotaque_alto = enfeite alto, UMA vez por trecho longo de parede
  sotaque      = enfeite baixo, UMA vez por fileira de divisória
  chao         = enfeite de piso, sem colisão · borda = fora da arena
  chao_alt     = 0,40 como no Fecho, nos Andaimes e na Mina: as peças rasteiras
                 (mosaico, rachadura, veio) a 25 cm viravam selo colado no piso.
"""
import io, os, base64, json, glob

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-coracao.js")

# a pasta do dono tem acento e a caixa dele ("O Coração partido"); o glob evita
# depender da grafia exata, que ja mudou de lote para lote
ORIGENS = [p for p in glob.glob(
    os.path.join("C:\\", "Users", "danie", "Downloads", "assets_ok", "mapa",
                 "O Cora*", "_pecas")) if os.path.isdir(p)]

# arquivo -> (chave, nome, papel)
PECAS = [
    # os módulos que se enfileiram: o inteiro e o com brecha (a balaustrada
    # partida tem dois balaústres faltando — é ela que faz o papel do quebrado)
    ("cp_muro_inteiro.glb",      "cp_muro_inteiro",      "Mureta que muda de material a cada trecho",   "alto"),
    ("cp_muro_balaustrada.glb",  "cp_muro_balaustrada",  "Balaustrada partida, com dois balaústres a menos", "alto"),

    ("cp_pilar.glb",             "cp_pilar",             "Pilar rachado em quatro quartos",             "pilar"),
    ("cp_marco_estatua.glb",     "cp_marco_estatua",     "Estátua sem cabeça com o coração rachado",    "marco"),

    # altos e estreitos: entram no meio dos trechos longos de parede
    ("cp_arco.glb",              "cp_arco",              "Arco partido que não fecha no topo",          "sotaque_alto"),
    ("cp_escadaria.glb",         "cp_escadaria",         "Escadaria em espiral que acaba no ar",        "sotaque_alto"),
    ("cp_coluna_elementos.glb",  "cp_coluna_elementos",  "Coluna dos quatro elementos, com anéis de ouro", "sotaque_alto"),

    # baixos: pontuam as fileiras de divisória — todos volume vertical
    ("cp_bacia.glb",             "cp_bacia",             "Bacia elemental: a água congela de um lado",  "sotaque"),
    ("cp_caco_espelho.glb",      "cp_caco_espelho",      "Caco de espelho fincado num bloco rachado",   "sotaque"),
    ("cp_raiz.glb",              "cp_raiz",              "Raiz que sai da pedra e volta para dentro",   "sotaque"),
    ("cp_lampioes.glb",          "cp_lampioes",          "Poste com quatro lampiões, um por elemento",  "sotaque"),

    # piso vestido, sem colisão
    ("cp_mosaico.glb",           "cp_mosaico",           "Mosaico das quatro estações, com ladrilhos faltando", "chao"),
    ("cp_rachadura_estrela.glb", "cp_rachadura_estrela", "Rachadura em estrela nas lajes",              "chao"),
    ("cp_veio_luz.glb",          "cp_veio_luz",          "Veio de luz atravessando a laje",             "chao"),
    ("cp_cinza_gelo.glb",        "cp_cinza_gelo",        "Cinza com uma crosta de gelo por cima",       "chao"),
]

# a folha de borda nao coube no saldo: as tres monumentais fazem os dois papeis
BORDA_EXTRA = ["cp_arco", "cp_escadaria", "cp_coluna_elementos"]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - cenario do CORACAO PARTIDO (heart), feito pelo usuario:",
        " * imagem no Gemini com as pecas lado a lado, depois imagem->3D no Meshy.",
        " * Duas muretas que se enfileiram, o pilar rachado em quatro, a estatua sem",
        " * cabeca com o coracao nas maos (papel `marco`, UMA por sala) e onze",
        " * enfeites recortados de quatro folhas por tools/separa_pecas.py.",
        " * A borda reaproveita as tres monumentais: o saldo dava para 4 folhas.",
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
                caminho = tenta
                break
        if not caminho:
            faltando.append(arq)
            continue
        dados = open(caminho, "rb").read()
        b64 = base64.b64encode(dados).decode("ascii")
        linhas.append("JOGO.MODELS['%s']='%s';" % (chave, b64))
        linhas.append("JOGO.CENARIO_NOME['%s']=%s;" % (chave, json.dumps(nome, ensure_ascii=False)))
        papeis[papel].append(chave)
        # o mesmo modulo serve ALTO e BAIXO: a 3,10 m e parede, a 0,95 m e mureta
        if papel == "alto":
            papeis["baixo"].append(chave)
        total += len(dados)

    for chave in BORDA_EXTRA:
        if chave in papeis["sotaque_alto"]:
            papeis["borda"].append(chave)

    catalogo = dict(papeis)
    catalogo["chao_alt"] = 0.4
    # o renderizador mede a fracao do CORPO de cada modulo: a balaustrada tem um
    # pilarete em cada ponta subindo acima do corrimao, como a escora da Mina e o
    # muro de pilastras do Fecho. Com 'auto' ele estica ate o corpo fechar a parede.
    catalogo["alto_corpo"] = "auto"
    # a chave e 'heart' porque e o `theme`/`sceneryTheme` que o calabouco
    # brokenheart declara em dungeons.js
    linhas.append("JOGO.CENARIO['heart']=%s;" % json.dumps(catalogo, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENARIO DO CORACAO PARTIDO ===")
    for p in ("alto", "pilar", "marco", "sotaque_alto", "baixo", "sotaque", "chao", "borda"):
        print("  %-12s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binario %.2f MB - arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
# 02/10: relevo e metal/rugosidade a 512, a cor fica em 1024 (o que o dono
# aprovou na comparacao lado a lado). Sem isto, rodar este embute de novo para
# trocar uma peca devolvia o arquivo inteiro a 1024 sem ninguem notar.
import reduz_texturas  # noqa: E402  (mora ao lado, em tools/)
reduz_texturas.reduz_arquivo(SAIDA)
