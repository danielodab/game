# -*- coding: utf-8 -*-
"""Embute o lote do CAMPO DE PVP num arquivo JS do jogo (20/09).

Rodar (Python puro — não precisa de Blender):
    python tools/embute_pvp.py

O lote do dono: o PORTAL DE ESPADAS (a entrada do Campo, na praça), dois
MÓDULOS DE MURO (alto e médio) e OITO ITENS de barreira, que vieram em duas
folhas de quatro e saíram por `tools/separa_pecas.py --conta 4,4` (os muros e
o portal passaram por `tools/normaliza_pvp.py`).

O DE-PARA das folhas (elas vieram sem os nomes no arquivo, então a saída é
numerada e o nome se dá olhando os retratos de `tools/contato_cenario.py` —
o mesmo caminho dos Andaimes):

    folha1_01  muro de pedra com barra de ferro      alto
    folha1_02  muro rachado, com escombros no meio    alto
    folha1_03  paliçada de estacas                    alto
    folha1_04  pilar de pedra                         pilar
    folha2_01  sacos de areia com estaca              baixo · sotaque
    folha2_02  caixote de armas com lanças            baixo · sotaque
    folha2_03  cavalo-de-frisa                        baixo · sotaque
    folha2_04  tonel com escudos e lança              baixo · sotaque

OS PAPÉIS são os de sempre (js/render3d/renderer3d_v2.js e vesteCampo):
  alto   = MÓDULO de parede (3,10 m no tabuleiro): CORTA A LINHA DE VISÃO
  baixo  = MÓDULO de divisória (0,95 m): barra o passo, deixa ver e atirar por
           cima, e desde 19/09 dá −25% de dano a quem está colado nela
  pilar  = pontuação da parede e ponta de fileira
  sotaque = enfeite pontual no meio de uma fileira de divisória

O portal NÃO é peça de cenário: ele entra como obra da praça, com a chave
`praca_portal_pvp`, que é o que a tabela OBRAS do hub3d procura.

O NOME DO ARQUIVO é `cenario-pvp.js`, e não `models-pvp.js`, de propósito: no
jogo SERVIDO o index.html lê a TABELA (o JOGO.CENARIO) só dos embutidos que
casam com `cenario-*.js` — os `models-*.js` ele pula inteiros, porque os
binários já descem do bundle. Com o nome errado o catálogo `pvp` não existia
sobre http e o Campo voltava vestido de jardim.
"""
import io, os, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-pvp.js")

ORIGENS = [
    r"C:\Users\danie\Downloads\assets_ok\mapa e itens pvp\_separado",
    r"C:\Users\danie\Downloads\assets_ok\mapa e itens pvp\itens mapa PVP\_separado",
]

# arquivo -> (chave, nome, papel)   — papel None = não entra no catálogo
PECAS = [
    ("portal_pvp.glb",  "praca_portal_pvp", "O Portal do Campo de PvP (arco de espadas)", None),

    ("muro_alto.glb",   "pv_muro_alto",     "Muro alto do Campo",                 "alto"),
    ("folha1_01.glb",   "pv_muro_pedra",    "Muro de pedra com barra de ferro",   "alto"),
    ("folha1_02.glb",   "pv_muro_rachado",  "Muro rachado, escombros no meio",    "alto"),
    ("folha1_03.glb",   "pv_palicada",      "Paliçada de estacas",                "alto"),
    ("folha1_04.glb",   "pv_pilar",         "Pilar de pedra",                     "pilar"),

    ("muro_medio.glb",  "pv_muro_medio",    "Muro médio do Campo",                "baixo"),
    ("folha2_01.glb",   "pv_sacos",         "Sacos de areia com estaca",          "sotaque"),
    ("folha2_02.glb",   "pv_caixote",       "Caixote de armas com lanças",        "sotaque"),
    ("folha2_03.glb",   "pv_frisa",         "Cavalo-de-frisa",                    "sotaque"),
    ("folha2_04.glb",   "pv_tonel",         "Tonel com escudos e lança",          "sotaque"),
]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA — o lote do CAMPO DE PVP (20/09), feito pelo dono no Meshy: o",
        " * portal de espadas da entrada (obra da praça, chave praca_portal_pvp),",
        " * dois módulos de muro e oito barreiras táticas — quatro ALTAS, que cortam",
        " * a linha de visão, e quatro BAIXAS, que barram o passo e dão cobertura.",
        " */",
        "JOGO.MODELS = JOGO.MODELS || {};",
        "JOGO.CENARIO = JOGO.CENARIO || {};",
        "JOGO.CENARIO_NOME = JOGO.CENARIO_NOME || {};",
    ]

    papeis = {"baixo": [], "alto": [], "pilar": [], "sotaque": [], "chao": [], "borda": []}
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
        if papel:
            papeis[papel].append(chave)
            # o módulo ALTO também serve de divisória, achatado (a regra da casa)
            if papel == "alto":
                papeis["baixo"].append(chave)
            # OS QUATRO ITENS FICAM SÓ EM `sotaque`, e não em `baixo`: o módulo de
            # divisória é ESTICADO para a largura de uma casa (muroDaCasa), e um
            # tonel esticado a 2 m vira um tambor deitado. Como `sotaque` eles
            # entram pelo berço — escala pela altura, proporção intacta — e é
            # assim que aparecem tanto nas fileiras baixas do tabuleiro quanto
            # nos enfeites do Campo. A divisória de verdade é o muro MÉDIO que o
            # dono fez para isso.
        total += len(dados)

    catalogo = dict(papeis)
    # os muros do dono são uniformes (sem pilar nas pontas com corpo baixo): a
    # medida do corpo devolve ~1 e nada muda, mas deixa a porta aberta
    catalogo["alto_corpo"] = "auto"
    linhas.append("JOGO.CENARIO['pvp']=%s;" % json.dumps(catalogo, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== O LOTE DO CAMPO DE PVP ===")
    for p in ("alto", "pilar", "baixo", "sotaque"):
        print("  %-8s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binário %.2f MB · arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
