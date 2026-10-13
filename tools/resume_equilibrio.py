# -*- coding: utf-8 -*-
"""Resume o JSON de tests/equilibrio.js: a matriz de duelos em dupla (por nível, classe contra classe e a média),
o um contra um, a fusão contra os dois separados, o perfil contra a média do elenco e a taxa por CAMINHO (classe ×
elemento), que a prova não cobra mas diz onde o desequilíbrio mora."""
import json, sys, io
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
j = json.load(io.open(sys.argv[1], encoding='utf-8'))
CL = ['sumo', 'arqueiro', 'bruxo', 'espadachim', 'curandeiro', 'invocador', 'minotauro']
NOME = {'sumo': 'Bárbaro', 'arqueiro': 'Caçador', 'bruxo': 'Bruxo', 'espadachim': 'Ladino', 'curandeiro': 'Curandeiro',
        'invocador': 'Xamã', 'minotauro': 'Minotauro'}
ELS = ['fogo', 'agua', 'terra', 'ar']

def pct(x):
    return '%3d%%' % round(x * 100)

def matriz(M, titulo, faixa=(0.40, 0.60), faixaMedia=(0.45, 0.55)):
    print('\n### ' + titulo)
    for nv in sorted(M.keys(), key=int):
        linhas = M[nv]
        print('\nnível %s   (linha = X, coluna = Y; a célula é a taxa de X)   ' % nv + '  '.join('%10s' % NOME[c][:9] for c in CL) + '      média')
        medias = {}
        for x in CL:
            cels, soma, jogos = [], 0.0, 0
            for y in CL:
                if x == y:
                    cels.append('     —    '); continue
                c = linhas.get(x, {}).get(y)
                esp = False
                if not c:   # a matriz guarda só um triângulo: o outro lado é o espelho (o empate vale meio dos dois lados)
                    c = linhas.get(y, {}).get(x); esp = True
                if not c:
                    cels.append('     ?    '); continue
                t = (1 - c['taxa']) if esp else c['taxa']; soma += t * c['jogos']; jogos += c['jogos']
                marca = ' ' if faixa[0] <= t <= faixa[1] else '*'
                cels.append('   %s%s   ' % (pct(t), marca))
            med = soma / jogos if jogos else 0
            medias[x] = med
            marcaM = ' ' if faixaMedia[0] <= med <= faixaMedia[1] else '*'
            print('%-12s' % NOME[x] + ''.join(cels) + '   %s%s (%d jogos)' % (pct(med), marcaM, jogos))
        yield nv, medias

d = j['duelos']
print('# DUELOS EM DUPLA (X+Z contra Y+Z, o mesmo parceiro) — sementes: %s' % d.get('sementes'))
mediasDupla = {}
for nv, medias in matriz(d['M'], 'matriz em dupla (* = célula fora de 40–60% / média fora de 45–55%)'):
    mediasDupla[nv] = medias
print('\n# UM CONTRA UM (o kit cru, sem cobrança)')
for nv, medias in matriz(d['M1'], 'matriz um contra um', faixa=(0.0, 1.0), faixaMedia=(0.0, 1.0)):
    pass

print('\n# POR CAMINHO (classe × elemento): vitórias / jogos em dupla, por nível — onde o desequilíbrio mora')
PC = d.get('PC', {})
por = {}
for k, v in PC.items():
    nv, cl, el = k.split(':')
    por.setdefault(nv, {}).setdefault(cl, {})[el] = v
for nv in sorted(por.keys(), key=int):
    print('\nnível %s        ' % nv + ''.join('%12s' % e for e in ELS))
    for cl in CL:
        fila = por[nv].get(cl, {})
        cels = []
        for e in ELS:
            v = fila.get(e)
            if not v or not v[1]:
                cels.append('      ?     '); continue
            t = v[0] / v[1]
            cels.append('   %s %-3s ' % (pct(t), ('(%d)' % v[1]).ljust(3)))
        print('%-12s' % NOME[cl] + ''.join(cels))

print('\n# FUSÃO contra os dois separados (razão; ±20% nos níveis de ajuste, 16 e 25 só conferem)')
R = j['fusao']['R']
nivs = [str(n) for n in j['fusao']['niveis']]
print('%-24s' % 'dupla' + ''.join('%8s' % ('nv' + n) for n in nivs))
fora = []
for par in sorted(R.keys()):
    cels = []
    for n in nivs:
        r = R[par].get(n)
        if not r:
            cels.append('       ?'); continue
        z = r['razao']
        marca = ' ' if 0.8 <= z <= 1.2 else '*'
        if marca == '*':
            fora.append((par, n, z))
        cels.append('%7d%%%s' % (round(z * 100), marca))
    print('%-24s' % par + ''.join(cels))
print('\nfora de ±20%%: %d — %s' % (len(fora), ', '.join('%s nv%s %d%%' % (p, n, round(z * 100)) for p, n, z in fora)))

print('\n# PERFIL contra a média do elenco no mesmo nível (dano único / área / apoio / vida efetiva / alcance)')
P = j['perfis']['resumo']
for nv in sorted(P.keys(), key=int):
    m = P[nv]['media']
    print('\nnível %s  (média do elenco: único %.0f, área %.0f, apoio %.0f, vidaEf %.0f, alcance %.1f)' % (nv, m['unico'], m['area'], m['apoio'], m['vidaEf'], m['alcance']))
    for cl in CL:
        c = P[nv]['porClasse'].get(cl)
        if not c:
            continue
        print('%-12s único %4d%%   área %4d%%   apoio %4d%%   vidaEf %4d%%   alcance %.1f' % (
            NOME[cl], round(c['unico'] / m['unico'] * 100), round(c['area'] / m['area'] * 100),
            round(c['apoio'] / max(1e-9, m['apoio']) * 100), round(c['vidaEf'] / m['vidaEf'] * 100), c['alcance']))
