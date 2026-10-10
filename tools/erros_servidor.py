# -*- coding: utf-8 -*-
"""As mensagens de erro que o servidor manda ao jogador, colhidas do código.

O servidor responde em português (`Recusa(status, 'texto')`, `{'erro': 'texto'}`) e
continua assim: as provas e os clientes antigos dependem da frase. Quem traduz é o
CLIENTE, usando a própria frase como chave (js/i18n/erros_<idioma>.js). Esta
ferramenta diz QUAIS frases existem, para o tools/i18n_falta.js cobrar a tradução.

A frase com valor dentro (f-string) vira um MOLDE: cada valor é {a}, {b}, {c}… na
ordem em que aparece — é a mesma chave que o dicionário usa, e o cliente casa a
frase recebida com o molde (JOGO.I18n.erro).

    python tools/erros_servidor.py            # JSON: {"moldes": {molde: [arquivo:linha…]}, "dinamicos": [...]}
    python tools/erros_servidor.py --resumo   # só a conta

De fora: servidor/mestre.py (o painel do Mestre não se traduz).
"""
import ast
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, 'servidor')
FORA = {'mestre.py'}
# funções que devolvem a frase numa tupla, para quem chamou levantar o Recusa
DEVOLVEM_FRASE = ('_pedidos_estourados', '_excluir_barrado')
LETRAS = 'abcdefghij'


CONSTANTES = {}          # as FRASE_* do arquivo em leitura: `Recusa(429, FRASE_IP_SENHA)`


def molde(no):
    """A frase como molde, ou None se não dá para saber sem rodar."""
    if isinstance(no, ast.Name) and no.id in CONSTANTES:
        return molde(CONSTANTES[no.id])
    if isinstance(no, ast.Constant) and isinstance(no.value, str):
        return no.value
    if isinstance(no, ast.JoinedStr):
        partes, n = [], 0
        for v in no.values:
            if isinstance(v, ast.Constant):
                partes.append(str(v.value))
            else:
                partes.append('{' + LETRAS[min(n, len(LETRAS) - 1)] + '}')
                n += 1
        return ''.join(partes)
    if isinstance(no, ast.BinOp) and isinstance(no.op, ast.Add):
        a, b = molde(no.left), molde(no.right)
        if a is None and b is None:
            return None
        # um lado fixo e o outro variável: o variável vira {a}
        return (a if a is not None else '{a}') + (b if b is not None else '{a}')
    if isinstance(no, ast.BinOp) and isinstance(no.op, ast.Mod):
        a = molde(no.left)
        if a is None:
            return None
        n = [0]

        def troca(_m):
            n[0] += 1
            return '{' + LETRAS[min(n[0] - 1, len(LETRAS) - 1)] + '}'
        import re
        return re.sub(r'%[sdr]|%\.\d+f|%\d*d', troca, a)
    if isinstance(no, ast.IfExp):
        return None          # tratado por quem chama (os dois ramos)
    return None


def ramos(no):
    if isinstance(no, ast.IfExp):
        return ramos(no.body) + ramos(no.orelse)
    if isinstance(no, ast.BoolOp):
        r = []
        for v in no.values:
            r += ramos(v)
        return r
    return [no]


def colhe():
    moldes, dinamicos = {}, []
    for nome in sorted(os.listdir(PASTA)):
        if not nome.endswith('.py') or nome in FORA:
            continue
        with open(os.path.join(PASTA, nome), encoding='utf-8') as f:
            arvore = ast.parse(f.read())
        for no in arvore.body:
            if isinstance(no, ast.Assign) and len(no.targets) == 1 and isinstance(no.targets[0], ast.Name):
                CONSTANTES[no.targets[0].id] = no.value
        # a frase guardada em constante que sai por outro caminho (`'mensagem': FRASE_ESQUECI`, o aviso do pagamento)
        for nm, v in list(CONSTANTES.items()):
            if nm.startswith('FRASE_') or nm in ('SEM_CORREIO', 'MUITAS_TENTATIVAS', 'SEM_ESTADO'):
                m = molde(v)
                if m and m.strip():
                    moldes.setdefault(m, []).append('%s:%d' % (nome, v.lineno))
        for no in ast.walk(arvore):
            alvos = []
            if isinstance(no, ast.Call):
                fn = no.func
                nm = fn.id if isinstance(fn, ast.Name) else (fn.attr if isinstance(fn, ast.Attribute) else '')
                if nm == 'Recusa' and len(no.args) >= 2:
                    alvos.append(no.args[1])
                for kw in no.keywords:
                    if kw.arg in ('erro', 'motivo') and nm != 'Recusa':
                        alvos.append(kw.value)
            elif isinstance(no, ast.Dict):
                chaves = [k.value for k in no.keys if isinstance(k, ast.Constant)]
                for k, v in zip(no.keys, no.values):
                    if isinstance(k, ast.Constant) and k.value in ('erro', 'motivo'):
                        alvos.append(v)
                    # o evento que o próprio servidor escreve na agenda do mundo: o Eco da semana (supremo.py, com
                    # `origem`) e, desde 09/10, os sete dias de PROGRAMA_SEMANAL (api.py, com `dia`) — o cliente os
                    # traduz pelo título (JOGO.I18n.resposta); o que o Mestre escreve é dele e não passa aqui
                    elif isinstance(k, ast.Constant) and k.value in ('titulo', 'texto') and ('origem' in chaves or 'dia' in chaves):
                        alvos.append(v)
                # a frase que entra por argumento e sai num Recusa lá dentro (`_confere_senha(conta, s, 'senha errada', …)`)
                if nm == '_confere_senha':
                    alvos += [x for x in no.args if isinstance(x, (ast.Constant, ast.JoinedStr, ast.BinOp))]
            elif isinstance(no, ast.FunctionDef) and no.name in DEVOLVEM_FRASE:
                # (código, frase) ou (frase, liberaEm): a frase é o pedaço que tem espaço
                for r in ast.walk(no):
                    if isinstance(r, ast.Return) and isinstance(r.value, ast.Tuple):
                        for x in r.value.elts:
                            m = molde(x)
                            if m and ' ' in m.strip():
                                moldes.setdefault(m, []).append('%s:%d' % (nome, x.lineno))
            for alvo in alvos:
                for r in ramos(alvo):
                    m = molde(r)
                    onde = '%s:%d' % (nome, getattr(r, 'lineno', 0))
                    if m is None:
                        if not (isinstance(r, ast.Constant) and not isinstance(r.value, str)):
                            dinamicos.append(onde)
                    elif m.strip():
                        moldes.setdefault(m, []).append(onde)
    return moldes, dinamicos


def juiz():
    """O JUIZ (servidor/juiz/*.js, em Node) também recusa em português, e a recusa dele chega ao
    jogador pelo juiz_ponte.py como veio: `recusa('texto')` e `{ ok: false, erro: 'texto' }`. Só as
    frases escritas inteiras; a montada com valor fica para a conta dos dinâmicos."""
    import re
    achadas, montadas = {}, []
    pasta = os.path.join(PASTA, 'juiz')
    lit = r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)\""""
    re_frase = re.compile(r'(?:\brecusa\(|\berro:)\s*(?:' + lit + r')\s*([,)}+]?)')
    for nome in sorted(os.listdir(pasta)):
        if not nome.endswith('.js') or nome == 'motor.js':
            continue
        with open(os.path.join(pasta, nome), encoding='utf-8') as f:
            txt = f.read()
        for m in re_frase.finditer(txt):
            frase = m.group(1) if m.group(1) is not None else m.group(2)
            frase = frase.replace("\\'", "'").replace('\\"', '"')
            onde = 'juiz/%s:%d' % (nome, txt.count('\n', 0, m.start()) + 1)
            if m.group(3) == '+':
                montadas.append(onde)
            elif frase.strip():
                achadas.setdefault(frase, []).append(onde)
    return achadas, montadas


def loja():
    """O que a loja do servidor escreve para o jogador ler: nome e descrição de cada produto e de
    cada pacote (servidor/loja.py). Vai ao cliente em português e é traduzido lá, pela frase."""
    sys.path.insert(0, PASTA)
    try:
        import loja as L
    except Exception:                                   # noqa: BLE001 — sem o módulo, a conta fica sem a loja
        return []
    vistos = set()

    def anda(o, k=None):
        if isinstance(o, dict):
            for a, b in o.items():
                anda(b, a)
        elif isinstance(o, (list, tuple)):
            for x in o:
                anda(x, k)
        elif isinstance(o, str) and k in ('nome', 'descricao') and o.strip():
            vistos.add(o)
    for n in ('CATALOGO', 'PACOTES', 'PACOTES_RETIRADOS', 'RETIRADOS', 'AURA_MESTRE_NOME', 'FRASE_DO_MOTIVO'):
        v = getattr(L, n, None)
        if n in ('AURA_MESTRE_NOME', 'FRASE_DO_MOTIVO') and isinstance(v, dict):
            vistos.update(x for x in v.values() if isinstance(x, str))
        else:
            anda(v)
    return sorted(vistos)


if __name__ == '__main__':
    moldes, dinamicos = colhe()
    do_juiz, montadas = juiz()
    for k, v in do_juiz.items():
        moldes.setdefault(k, []).extend(v)
    dinamicos += montadas
    if '--resumo' in sys.argv:
        print('%d frases distintas (%d com valor dentro), %d montadas em tempo de execução'
              % (len(moldes), sum(1 for m in moldes if '{' in m), len(dinamicos)))
    else:
        sys.stdout.reconfigure(encoding='utf-8')
        json.dump({'moldes': moldes, 'dinamicos': dinamicos, 'loja': loja()}, sys.stdout, ensure_ascii=False, indent=0)
