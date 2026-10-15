# -*- coding: utf-8 -*-
"""A COMPRESSÃO DOS MODELOS SERVIDOS (15/10) — meshopt (EXT_meshopt_compression) pelo gltfpack.

O bundle (assets/models/bundle) tinha 247 MB de .glb, e 174 MB disso era MALHA E ANIMAÇÃO (os corpos do
Meshy com esqueleto), não textura. O gltfpack com `-cc` (meshopt) desce cada .glb para 43–57% do tamanho
sem trocar arte — medido: rogue 337 → 193 KB, colosso-agua 1,76 → 1,00 MB, as animações 1,43 → 0,62 MB.
Sem quantização (`-noq`): com ela o gltfpack pendura a malha num nó NOVO sem nome e o jogo, que acha
malha e osso pelo NOME (`show`, os enxertos da fusão, /_Head/), perdia tudo. `-kn -km -ke` guardam os
nomes dos nós e dos materiais e os extras.

Quem chama é o tools/extrai_assets.py, ao escrever cada .glb do bundle. O decodificador no jogo é o
vendor/meshopt_decoder.js (meshoptimizer 0.22), ligado ao GLTFLoader por setMeshoptDecoder em
js/render3d/models3d.js e models3d_v2.js.

O executável: a variável GLTFPACK (o caminho do cli.js ou do .cmd), senão `gltfpack` no PATH, senão
`npx -y gltfpack@1.3.0` (baixa na primeira vez). Sem nenhum, `comprime()` devolve None e o extrator
escreve o .glb como veio — o jogo abre os dois.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

VERSAO_GLTFPACK = '1.3.0'
FLAGS = ['-cc', '-noq', '-kn', '-km', '-ke']
_comando = None


def comando():
    """A linha de comando do gltfpack, ou None."""
    global _comando
    if _comando is not None:
        return _comando or None
    env = os.environ.get('GLTFPACK')
    if env:
        _comando = [sys.executable, env] if env.endswith('.py') else (['node', env] if env.endswith('.js') else [env])
        return _comando
    exe = shutil.which('gltfpack')
    if exe:
        _comando = [exe]
        return _comando
    npx = shutil.which('npx')
    if npx:
        _comando = [npx, '-y', 'gltfpack@' + VERSAO_GLTFPACK]
        return _comando
    _comando = []
    return None


def comprimido(bruto):
    """O .glb já traz EXT_meshopt_compression?"""
    try:
        if bruto[:4] != b'glTF':
            return False
        ln, ty = struct.unpack('<II', bruto[12:20])
        js = json.loads(bruto[20:20 + ln])
        return 'EXT_meshopt_compression' in (js.get('extensionsRequired') or [])
    except Exception:
        return False


def comprime(bruto, so_se_menor=True):
    """Os bytes comprimidos do .glb, ou None (sem gltfpack, erro, ou já comprimido)."""
    if comprimido(bruto):
        return None
    cmd = comando()
    if not cmd:
        return None
    pasta = tempfile.mkdtemp(prefix='soterra-glb-')
    try:
        entrada = os.path.join(pasta, 'in.glb')
        saida = os.path.join(pasta, 'out.glb')
        with open(entrada, 'wb') as f:
            f.write(bruto)
        r = subprocess.run(cmd + FLAGS + ['-i', entrada, '-o', saida], capture_output=True, timeout=300,
                           shell=(os.name == 'nt' and cmd[0].lower().endswith(('.cmd', '.bat'))))
        if r.returncode != 0 or not os.path.isfile(saida):
            return None
        with open(saida, 'rb') as f:
            novo = f.read()
        if not comprimido(novo):
            return None
        if so_se_menor and len(novo) >= len(bruto):
            return None
        return novo
    except Exception:
        return None
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


if __name__ == '__main__':
    # python tools/comprime_glb.py <entrada.glb> <saida.glb>
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    with open(sys.argv[1], 'rb') as f:
        bruto = f.read()
    novo = comprime(bruto)
    if novo is None:
        print('nao comprimiu (sem gltfpack, ja comprimido ou nao ficou menor)')
        sys.exit(1)
    with open(sys.argv[2], 'wb') as f:
        f.write(novo)
    print('%d -> %d bytes (%d%%)' % (len(bruto), len(novo), 100 * len(novo) // len(bruto)))
