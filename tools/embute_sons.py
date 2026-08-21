# -*- coding: utf-8 -*-
"""Traz o KIT DE SOM do jogo. Roda com Python puro, sem Blender.

  python tools/embute_sons.py

POR QUE EMBUTIR EM BASE64
-------------------------
Mesma razao dos modelos: o jogo abre por `file://`, e ali `fetch()` de um
arquivo local falha. Um `.ogg` solto em `assets/` funcionaria servido e ficaria
mudo no duplo-clique. Base64 num `.js` funciona nos dois.

O peso disso e aceitavel: o kit inteiro da menos de 1 MB, contra os 83 MB de
modelo que o jogo ja carrega. Som de efeito e curto por natureza.

POR QUE QUASE TUDO E .OGG E NAO PRECISOU CONVERTER
--------------------------------------------------
Nao ha ffmpeg nesta maquina e nenhum codificador Ogg em Python. Isso teria sido
um problema serio se eu tivesse escolhido o acervo pelo tamanho do catalogo —
mas o `80 CC0 RPG SFX` e o Kenney ja entregam `.ogg`, que e exatamente o que a
web quer. So a CURA veio em `.wav`, e essa eu encolho aqui (44 kHz estereo ->
22 kHz mono), o que derruba 191 KB para uns 48 KB sem diferenca audivel num
efeito curto.

A ESCOLHA DOS JINGLES NAO FOI POR NOME
--------------------------------------
Sao 86 jingles no pacote do Kenney e nenhum nome diz qual e vitoria e qual e
derrota. Eu nao consigo OUVIR os arquivos, entao medi: `tests/ouve_candidatos.html`
decodifica cada um pela WebAudio e compara o centroide espectral do primeiro
terco com o do ultimo. Vitoria SOBE de brilho, derrota DESCE.

  jingles_PIZZI02  brilho 301 -> 473  (+57%)  -> vitoria
  jingles_PIZZI01  brilho 429 -> 267  (-38%)  -> derrota

Os dois sairam da mesma familia, entao dividem a instrumentacao — um par
casado, coisa que escolher por nome nao teria acertado.

O RESTO DA ESCOLHA E POR NOME, E ISSO E UM LIMITE REAL
------------------------------------------------------
`spell_fire_02.ogg` e `creature_die_01.ogg` sao nomes descritivos, dados pelo
autor justamente para isso, mas continuam sendo nome e nao som. Por isso existe
`tests/som.html`: o Daniel ouve cada papel, ouve as variantes, e troca o que
nao gostar. Trocar e mexer numa linha desta tabela e rodar de novo.
"""
import os, glob, base64, io, wave, struct

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(RAIZ, "assets", "candidatos", "som")
SAIDA = os.path.join(RAIZ, "assets", "embedded", "sons.js")

# papel no jogo -> lista de arquivos (as VARIANTES)
#
# Por que variante e nao um som so: um ataque em area acerta seis unidades e
# dispara seis vezes o mesmo arquivo. Com um som so isso vira metralhadora; com
# tres, vira briga. A camada de audio sorteia e nunca repete a mesma duas vezes
# seguidas.
KIT = [
    # --- combate corpo a corpo
    ("golpe",    ["blade_01", "blade_02", "blade_03"],
     "a lamina que acerta — familias `corte` e `investida`"),
    ("impacto",  ["wood_02", "stones_02", "metal_02"],
     "o ponto final de qualquer familia de efeito"),

    # --- magia
    ("magia",    ["spell_01", "spell_02"],
     "lancamento generico — `bola`, `feixe`, `flecha`"),
    ("fogo",     ["spell_fire_02", "spell_fire_05", "spell_fire_07"],
     "`meteoro`, `estouro`, `anel`"),
    ("cura",     ["Cure4"],
     "a unica peca que veio em WAV; encolhida aqui"),
    ("teleporte", ["misc_01"], "`piscar`"),

    # --- corpo
    ("dano",     ["creature_hurt_01", "creature_hurt_02"],
     "levar dano"),
    ("morte",    ["creature_die_01"], "cair"),
    ("rugido",   ["creature_roar_02"], "o chefe entrando"),
    ("passo",    ["footstep00", "footstep02", "footstep04", "footstep06"],
     "quatro variantes porque passo e o som que mais repete no jogo"),

    # --- interface
    ("botao",    ["click1", "click2"], "tocar num botao"),
    ("confirma", ["switch2"], "confirmar uma jogada"),
    ("tesouro",  ["item_gem_02"], "ganho"),

    # --- fim de combate (escolhidos por MEDIDA, ver o cabecalho)
    ("vitoria",  ["jingles_PIZZI02"], "brilho sobe 301->473"),
    ("derrota",  ["jingles_PIZZI01"], "brilho cai 429->267"),
]

TAXA_ALVO = 22050


def acha(nome):
    """Procura o arquivo em qualquer pacote extraido, .ogg antes de .wav."""
    for ext in (".ogg", ".wav"):
        achados = glob.glob(os.path.join(ORIG, "_*", "**", nome + ext), recursive=True)
        if achados:
            return achados[0]
    return None


def encolhe_wav(caminho):
    """44 kHz estereo -> 22 kHz mono, 16 bits. Devolve os bytes de um WAV novo.

    A media dos dois canais antes de decimar NAO e enfeite: jogar fora um a cada
    dois quadros sem filtrar dobra o agudo para baixo (aliasing). A media de
    vizinhos e um filtro passa-baixa pobre, mas e um filtro — e num efeito de
    menos de dois segundos ninguem ouve a diferenca do que seria um filtro bom.
    """
    w = wave.open(caminho, "rb")
    canais, larg, taxa, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    cru = w.readframes(n)
    w.close()
    if larg != 2:
        return open(caminho, "rb").read()      # formato incomum: passa direto

    amostras = struct.unpack("<%dh" % (len(cru) // 2), cru)
    if canais == 2:
        mono = [(amostras[i] + amostras[i + 1]) // 2 for i in range(0, len(amostras) - 1, 2)]
    else:
        mono = list(amostras)

    passo = max(1, int(round(taxa / float(TAXA_ALVO))))
    if passo > 1:
        saida = []
        for i in range(0, len(mono) - passo, passo):
            saida.append(sum(mono[i:i + passo]) // passo)
        mono = saida
        taxa = int(taxa / passo)

    buf = io.BytesIO()
    nw = wave.open(buf, "wb")
    nw.setnchannels(1); nw.setsampwidth(2); nw.setframerate(taxa)
    nw.writeframes(struct.pack("<%dh" % len(mono), *mono))
    nw.close()
    return buf.getvalue()


def main():
    linhas = [
        "var JOGO = (typeof window !== 'undefined')",
        "  ? (window.JOGO = window.JOGO || {})",
        "  : (globalThis.JOGO = globalThis.JOGO || {});",
        "/* SOTERRA 3.0 - o kit de som, embutido em base64.",
        " *",
        " * Embutido e nao solto em assets/ pela mesma razao dos modelos: o jogo",
        " * abre por file://, e ali fetch() de arquivo local falha. Um .ogg solto",
        " * tocaria servido e ficaria MUDO no duplo-clique.",
        " *",
        " * Cada papel tem VARIANTES e quem toca sorteia: um ataque em area dispara",
        " * seis vezes o mesmo papel, e com um arquivo so isso vira metralhadora.",
        " *",
        " * Tudo CC0 (OpenGameArt + Kenney). Gerado por tools/embute_sons.py, onde",
        " * fica a tabela de escolha e o porque de cada peca.",
        " */",
        "JOGO.SONS = JOGO.SONS || {};",
        "JOGO.SONS_INFO = JOGO.SONS_INFO || {};",
    ]

    rel, faltando, total = [], [], 0
    for papel, nomes, porque in KIT:
        pecas, usados = [], []
        for nome in nomes:
            p = acha(nome)
            if not p:
                faltando.append(papel + "/" + nome); continue
            if p.lower().endswith(".wav"):
                dados = encolhe_wav(p)
                tipo = "audio/wav"
            else:
                dados = open(p, "rb").read()
                tipo = "audio/ogg"
            pecas.append((tipo, base64.b64encode(dados).decode("ascii")))
            usados.append(os.path.basename(p))
            total += len(dados)
        if not pecas:
            continue
        corpo = ",".join("['%s','%s']" % (t, b) for t, b in pecas)
        linhas.append("JOGO.SONS['%s']=[%s];" % (papel, corpo))
        linhas.append("JOGO.SONS_INFO['%s']=%s;" % (papel, "['" + "','".join(usados) + "']"))
        rel.append((papel, len(pecas), sum(len(b) for _, b in pecas) / 1024.0, porque))

    linhas.append("")
    io.open(SAIDA, "w", encoding="utf-8", newline="\n").write("\n".join(linhas))

    print("=== KIT DE SOM ===")
    print("%-11s %5s %9s  %s" % ("papel", "vars", "KB(b64)", "para que serve"))
    for p, n, kb, porque in rel:
        print("%-11s %5d %9.1f  %s" % (p, n, kb, porque))
    if faltando:
        print("\nNAO ACHEI:", ", ".join(faltando))
    print("\naudio cru: %.0f KB · arquivo final: %.0f KB"
          % (total / 1024.0, os.path.getsize(SAIDA) / 1024.0))


main()
