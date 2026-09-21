# -*- coding: utf-8 -*-
"""Embute o cenário da MINA TRÊMULA (mine) num arquivo JS do jogo.

Rodar (Python puro — não precisa de Blender):
    python tools/embute_cenario_mina.py

DE ONDE VIERAM AS PEÇAS (21/09/2026) — este lote mudou de caminho: o dono
gerou a IMAGEM no Gemini, com as peças lado a lado, e só depois passou a
imagem no Meshy (imagem→3D). Vieram quatro arquivos, não três:

  muros\\muros e pilar.glb      → mureta inteira, mureta com brecha, pilar
  muros\\cercas e entulho.glb   → broca na rocha (marco), escora, muro de entulho
  itens mapa\\folha2.glb        → os sete que ficam de pé
  itens mapa\\folha3.glb        → as quatro rasteiras e as duas de borda

Os dois arquivos de muro e a folha3 saíram limpos no `separa_pecas.py
--recortar --conta 3,3` e `--conta 7,6`: o separador por vértice achou
patamar sozinho.

A FOLHA2 NÃO. O Meshy soltou as TRÊS ARGOLAS de ferro do silo como objetos
independentes, e cada uma é grande demais para o filtro de caco (0,115 da
folha, acima do corte de 0,08). Com elas contando como peça, o separador
fundiu pares reais para fechar em sete: silo com estalagmite, porta com
vagonete, estéril com gaiola. Cortar pelos vãos do eixo X também não resolve
— nesta folha as peças se sobrepõem em X (o vagonete fica na frente da
porta). O que resolveu foi o caminho documentado: `--bruto 0.0035` (11
grupos), olhar a folha de contato do `contato_cenario.py`, e escrever o mapa
à mão:

  1a → estalagmite        1b+2+3+4 → silo (as argolas voltam para ele)
  5+6+7 → porta lacrada   8 → vagonete      10 → dinamite
  11a → estéril           11b → gaiola do canário

O grupo 9 é uma chapa chata avulsa entre o vagonete e o caixote — não é peça
de nada, e incluí-la na porta a deixava com 0,43 de largura para 0,32 de
altura. Ficou de fora.

As 19 peças finais estão em `...\\Mina Trêmula\\_pecas\\`, já com o nome.

OS PAPÉIS são os mesmos da Cisterna, do Fecho e dos Andaimes:
  alto         = MÓDULO de parede (3,10 m), o muro que se enfileira
  baixo        = MÓDULO de divisória (0,95 m) — os altos servem, achatados
  pilar        = pontuação da parede, a cada 4 casas de trecho longo
  marco        = a broca presa na rocha, UMA vez por sala (regra do aquário)
  sotaque_alto = enfeite alto, UMA vez por trecho longo de parede
  sotaque      = enfeite baixo, UMA vez por fileira de divisória
  chao         = enfeite de piso, sem colisão · borda = fora da arena
  chao_alt     = 0,40 como no Fecho e nos Andaimes: as peças rasteiras (trilho,
                 rachadura, pegadas) a 25 cm viravam selo colado no piso.
"""
import io, os, base64, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "embedded", "cenario-mina.js")

ORIGENS = [
    os.path.join("C:\\", "Users", "danie", "Downloads", "assets_ok", "mapa",
                 "Mina Tr\u00eamula", "_pecas"),
]

# arquivo -> (chave, nome, papel)
PECAS = [
    # os módulos que se enfileiram: dois obrigatórios e duas variantes
    ("mt_muro_inteiro.glb",     "mt_muro_inteiro",     "Mureta de pedra bruta",                        "alto"),
    ("mt_muro_brecha.glb",      "mt_muro_brecha",      "Mureta de pedra bruta, com brecha",            "alto"),
    ("mt_muro_entulho.glb",     "mt_muro_entulho",     "Entulho de mina contido por tábuas",           "alto"),
    ("mt_muro_escora.glb",      "mt_muro_escora",      "Escora de galeria: dois postes e uma viga",    "alto"),

    ("mt_pilar.glb",            "mt_pilar",            "Escoramento de galeria com lanterna apagada",  "pilar"),
    ("mt_marco_broca.glb",      "mt_marco_broca",      "Broca de perfuração presa na rocha",           "marco"),

    # altos e estreitos: entram no meio dos trechos longos de parede
    ("mt_estalagmite.glb",      "mt_estalagmite",      "Estalagmite com cristais na base",             "sotaque_alto"),
    ("mt_silo.glb",             "mt_silo",             "Silo de minério com aros de ferro",            "sotaque_alto"),
    ("mt_porta_lacrada.glb",    "mt_porta_lacrada",    "Porta de galeria lacrada com tábuas",          "sotaque_alto"),

    # baixos: pontuam as fileiras de divisória — todos volume vertical
    ("mt_vagonete.glb",         "mt_vagonete",         "Vagonete tombado, minério derramado",          "sotaque"),
    ("mt_dinamite.glb",         "mt_dinamite",         "Caixote de dinamite com o estopim de fora",    "sotaque"),
    ("mt_esteril.glb",          "mt_esteril",          "Monte de estéril com a pá fincada",            "sotaque"),
    ("mt_gaiola_canario.glb",   "mt_gaiola_canario",   "Gaiola de canário vazia no poste",             "sotaque"),

    # piso vestido, sem colisão
    ("mt_trilho.glb",           "mt_trilho",           "Trilho de vagonete sobre dormentes",           "chao"),
    ("mt_rachadura.glb",        "mt_rachadura",        "Rachadura no piso, com brilho no fundo",       "chao"),
    ("mt_cristal_aflorando.glb","mt_cristal_aflorando","Cristais aflorando da rocha do piso",          "chao"),
    ("mt_pegadas.glb",          "mt_pegadas",          "Poeira com o rastro do turno da noite",        "chao"),

    # fora da arena: o fundo que faz o campo parecer dentro de um lugar maior
    ("mt_boca_galeria.glb",     "mt_boca_galeria",     "Boca de galeria escorada",                     "borda"),
    ("mt_guindaste_poco.glb",   "mt_guindaste_poco",   "Guindaste de poço com o balde no cabo",        "borda"),
]

# o silo e a estalagmite repetem na borda, como o Fecho repetiu a chaminé e os
# Andaimes a torre: a 2,2-4,6 m eles leem como a mina continuando ao fundo
BORDA_EXTRA = ["mt_silo", "mt_estalagmite"]


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - cenario da MINA TREMULA (mine), feito pelo usuario:",
        " * imagem no Gemini com as pecas lado a lado, depois imagem->3D no Meshy.",
        " * Quatro muretas que se enfileiram, o escoramento de galeria, a broca presa",
        " * na rocha (papel `marco`, UMA por sala) e treze enfeites de mina",
        " * recortados de quatro folhas por tools/separa_pecas.py.",
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
    # o renderizador mede a fracao do CORPO de cada modulo: a escora tem um
    # poste em cada ponta subindo acima da viga, como o muro de pilastras do
    # Fecho. Com 'auto' ele estica ate o corpo fechar a parede.
    catalogo["alto_corpo"] = "auto"
    # a chave e 'mine' porque e o `theme`/`sceneryTheme` que o calabouco
    # quakemine declara em dungeons.js
    linhas.append("JOGO.CENARIO['mine']=%s;" % json.dumps(catalogo, ensure_ascii=False))
    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== CENARIO DA MINA TREMULA ===")
    for p in ("alto", "pilar", "marco", "sotaque_alto", "baixo", "sotaque", "chao", "borda"):
        print("  %-12s %d: %s" % (p, len(papeis[p]), ", ".join(papeis[p])))
    print("  binario %.2f MB - arquivo %.2f MB"
          % (total / 1048576.0, os.path.getsize(SAIDA) / 1048576.0))
    if faltando:
        print("  FALTANDO:", ", ".join(faltando))


main()
