# -*- coding: utf-8 -*-
"""SOTERRA — a música de fundo: mede, nivela e recodifica (assets/musica/).

POR QUE ISTO EXISTE
-------------------
As faixas vêm do OpenGameArt (docs/CREDITOS.md) em WAV de 10 MB ou em Ogg a
256 kbps, e cada uma numa altura: de -23 dB a -13 dB de média. O jogo toca a
música "bem de leve", num volume só para todas — então elas têm de sair daqui
na MESMA altura média, e leves (Ogg Vorbis ~96 kbps, com um MP3 de reserva).

A máquina não tem ffmpeg. Quem codifica é o `aud` (Audaspace) que vem DENTRO do
Blender — por isso este arquivo roda pelo Blender, não pelo Python do sistema:

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
        --python tools/musica_converte.py -- <pasta dos originais> <pasta de saída>

Sem a pasta de saída ele só MEDE (duração, média, pico, e a média do primeiro e
do último meio segundo — faixa em laço não pode começar nem acabar em silêncio).

Faixa nova: acrescente a linha em FAIXAS (nome de saída, arquivo de origem),
rode, copie o .ogg e o .mp3 para assets/musica/ e aponte o nome no js/audio.js.
"""
import math
import os
import sys

import aud
import numpy as np

# nome em assets/musica/ (sem extensão) <- o arquivo como veio do OpenGameArt
FAIXAS = [
    ('praca-bards-tale', 'Loop_The_Bards_Tale.wav'),
    ('luta-heartfelt-battle', 'heartfelt-battle_loop.ogg'),
    ('luta-heavy-battle-2', 'heavy_battle_2_bpm185.ogg'),
    ('chefe-heavy-boss-battle-1', 'heavy_boss_battle_1_bpm200_0.ogg'),
]
ALVO_RMS = 0.10          # a altura média de todas (cerca de -20 dB)
TETO_PICO = 0.98         # nivelar nunca estoura o pico
OGG_BPS = 96000
MP3_BPS = 112000


def rms(d):
    return float(np.sqrt(np.mean(np.square(d, dtype=np.float64))))


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not args:
        print(__doc__)
        return 2
    entrada = args[0]
    saida = args[1] if len(args) > 1 else None
    if saida:
        os.makedirs(saida, exist_ok=True)
    for nome, arq in FAIXAS:
        caminho = os.path.join(entrada, arq)
        if not os.path.isfile(caminho):
            print('FALTA %s (%s)' % (nome, caminho))
            continue
        som = aud.Sound(caminho)
        d = som.data()
        taxa = som.specs[0]
        media, pico, meio = rms(d), float(np.max(np.abs(d))), int(taxa * 0.5)
        print('MEDE %s: %.1f s, média %.4f (%.1f dB), pico %.3f, começo %.4f, fim %.4f'
              % (nome, d.shape[0] / taxa, media, 20 * math.log10(media), pico, rms(d[:meio]), rms(d[-meio:])))
        if not saida:
            continue
        k = min(ALVO_RMS / media, TETO_PICO / pico)
        nivelada = som.volume(k)
        ogg, mp3 = os.path.join(saida, nome + '.ogg'), os.path.join(saida, nome + '.mp3')
        nivelada.write(ogg, 44100, 2, aud.FORMAT_S16, aud.CONTAINER_OGG, aud.CODEC_VORBIS, OGG_BPS)
        nivelada.write(mp3, 44100, 2, aud.FORMAT_S16, aud.CONTAINER_MP3, aud.CODEC_MP3, MP3_BPS)
        print('GRAVA %s: ganho %.3f, ogg %d bytes, mp3 %d bytes'
              % (nome, k, os.path.getsize(ogg), os.path.getsize(mp3)))
    return 0


if __name__ == '__main__':
    main()
