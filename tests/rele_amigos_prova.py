#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova dos amigos, dos inimigos e do chat da guilda no Relé (servidor/rele.py, 13/09).

    python tests/rele_amigos_prova.py

PEDIDO DO DONO: "/g manda mensagem pra guild; no menu inferior deve ter uma
lista de amigos e inimigos; os amigos mostra quando tiver online e se está em
batalha; lista de inimigos: os inimigos não podem mandar mensagem nem troca,
mas pode desafiar pvp". O relé DE VERDADE num subprocesso com --banco, contra
um banco criado pela Api do cartório (servidor/api.py) numa pasta temporária
— a guilda e as relações entram direto no banco, como a API as grava:

  - o gchat chega a TODAS as conexões das contas da guilda (a outra aba de
    quem mandou também), a mais ninguém e não volta a quem mandou; sai só com
    t, de, nome, texto aparado e `guilda`, com o nome carimbado como no chat
    (o reservado trocado, o `mestre` do cliente fora, o do Mestre conferido
    dentro); sem conta ou sem guilda, só quem mandou ouve `gchat-nao`; o texto
    torto cai sem voz; e o texto nunca vai ao log;
  - o {t:'amigos'} responde só a quem pediu, como voz (sem `de`): online ou
    não, o id do herói, a sala e a `luta` da conexão mais recente; sem conta,
    lista vazia; nunca é repassado;
  - o sussurro e a troca entre inimigos não chegam em nenhum dos dois
    sentidos (e não voltam `ausente`); o desafio de duelo chega;
  - o {t:'amigos-muda'} faz a relação recém-gravada valer na hora.

Os clientes crus e o relé em subprocesso são os de tests/rele_prova.py e
tests/rele_nomes_prova.py. Precisa do websockets com cliente síncrono (12+).
"""
import json
import os
import shutil
import sys
import tempfile
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
SERVIDOR = os.path.join(RAIZ, 'servidor')
sys.dont_write_bytecode = True            # sem .pyc em servidor/
sys.path.insert(0, SERVIDOR)
import api as cartorio  # noqa: E402  (o banco nasce pela Api de verdade)
import comum  # noqa: E402
import rele_ident  # noqa: E402
from rele_prova import junta, manda, recebe  # noqa: E402
from rele_nomes_prova import Rele  # noqa: E402  (o relé de verdade num subprocesso de prioridade baixa)

RESULTADOS = []

# a tabela da API (servidor/amigos.py) — a prova a cria se a Api ainda não criou
ESQUEMA_RELACOES = """
CREATE TABLE IF NOT EXISTS relacoes(
  conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  alvo_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo     TEXT NOT NULL CHECK (tipo IN ('amigo', 'inimigo')),
  em       INTEGER NOT NULL,
  PRIMARY KEY (conta_id, alvo_id)
);
CREATE INDEX IF NOT EXISTS relacoes_alvo ON relacoes(alvo_id, tipo);
"""


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def cria_banco(pasta):
    """O banco pela Api, com as contas, duas guildas e nenhuma relação ainda.
    Devolve (api, caminho, {rotulo: (conta, token)})."""
    caminho = os.path.join(pasta, 'soterra.db')
    a = cartorio.Api(caminho)
    contas = {}
    neutros = {'ana': 'Prova Ana', 'bia': 'Prova Bia', 'caio': 'Prova Caio', 'duda': 'Prova Duda', 'eva': 'Prova Eva',
               'mestre': 'Prova Vigia'}                 # o cadastro recusa nome reservado ("Mestre"): o gm entra à mão
    for i, (rotulo, nome) in enumerate(neutros.items()):
        st, r = a.cadastro(None, {'nome': nome, 'email': 'amigos-%s-%d@prova.test' % (rotulo, i),
                                  'senha': 'senha-de-prova-%d' % i})
        assert st == 201, (st, r)
        contas[rotulo] = (r['conta']['id'], r['token'])
    t = comum.agora()
    with a.tranca:
        a.con.executescript(ESQUEMA_RELACOES)
        a.con.execute("UPDATE contas SET gm = 1 WHERE id = ?", (contas['mestre'][0],))
        g1 = a.con.execute("INSERT INTO guildas(nome, emblema, lider_id, criada_em) VALUES ('Os da Prova', 'x', ?, ?)",
                           (contas['ana'][0], t)).lastrowid
        g2 = a.con.execute("INSERT INTO guildas(nome, emblema, lider_id, criada_em) VALUES ('Outra Tropa', 'x', ?, ?)",
                           (contas['caio'][0], t)).lastrowid
        for rotulo, g in (('ana', g1), ('bia', g1), ('mestre', g1), ('caio', g2)):
            a.con.execute("INSERT INTO guilda_membros(conta_id, guilda_id, cargo, entrou_em) VALUES (?, ?, 'membro', ?)",
                          (contas[rotulo][0], g, t))
        a.con.commit()
    return a, caminho, contas


def relaciona(a, de_conta, alvo, tipo):
    with a.tranca:
        a.con.execute("INSERT OR REPLACE INTO relacoes(conta_id, alvo_id, tipo, em) VALUES (?, ?, ?, ?)",
                      (de_conta, alvo, tipo, comum.agora()))
        a.con.commit()


def ouve(wss, espera=0.4):
    """O que cada cliente ouviu (dict rótulo -> lista), depois de uma pausa."""
    time.sleep(espera)
    return {k: junta(w, 0.08) for k, w in wss.items()}


def do_tipo(lista, t):
    return [m for m in lista if isinstance(m, dict) and m.get('t') == t]


def prova():
    R = 'relé: '
    check(R + 'o gchat leva nome: entra no carimbo e no juiz como o chat (COM_NOME, JULGADOS)',
          'gchat' in rele_ident.COM_NOME and 'gchat' in rele_ident.JULGADOS)
    pasta = tempfile.mkdtemp(prefix='rele-amigos-')
    a = rl = None
    try:
        a, banco, contas = cria_banco(pasta)
        rl = Rele(['--banco', banco])
        if not rl.ok:
            check(R + 'o relé com --banco subiu', False, rl.log()[-300:])
            return

        # --------------------------------------------- as conexões e os idents
        heroi = {'ana1': 'hana01', 'ana2': 'hana01', 'bia1': 'hbia01', 'bia2': 'hbia01', 'caio': 'hcaio01',
                 'duda': 'hduda01', 'mestre': 'hmestre1', 'anon': 'hanon01'}
        conta_de = {'ana1': 'ana', 'ana2': 'ana', 'bia1': 'bia', 'bia2': 'bia', 'caio': 'caio', 'duda': 'duda',
                    'mestre': 'mestre'}
        ws = {}
        for k in heroi:
            ws[k], _ = rl.liga()
        idents = {}
        for k, rotulo in conta_de.items():
            manda(ws[k], t='ident', de=heroi[k], token=contas[rotulo][1])
            idents[k] = recebe(ws[k], 3)
        check(R + 'as sete conexões com conta se identificam (o Mestre com mestre:true)',
              all(idents[k] == '{"t":"ident-ok","mestre":false}' for k in idents if k != 'mestre')
              and idents['mestre'] == '{"t":"ident-ok","mestre":true}', repr(idents))
        for k in heroi:
            manda(ws[k], t='pulso', de=heroi[k], x=0, z=0, sala=None, luta=False)
        ouve(ws, 0.5)

        # -------------------------------------------------------- o gchat
        segredo = 'segredo da guilda 7f3k'
        manda(ws['ana1'], t='gchat', de='hana01', nome='Ana', texto='  ' + segredo + '  ', mestre=True, lixo={'x': 1},
              para='hcaio01')
        o = ouve(ws)
        esperado = {'t': 'gchat', 'de': 'hana01', 'nome': 'Ana', 'texto': segredo, 'guilda': 'Os da Prova'}
        membros = ('ana2', 'bia1', 'bia2', 'mestre')
        check(R + 'gchat: chega UMA vez a cada conexão das contas da guilda (a outra aba de quem mandou também)',
              all(do_tipo(o[k], 'gchat') == [esperado] for k in membros), repr({k: o[k] for k in membros})[:400])
        check(R + 'gchat: sai só com t, de, nome, texto aparado e `guilda` (o `mestre`, o `para` e o lixo do cliente caem)',
              do_tipo(o['bia1'], 'gchat') == [esperado])
        check(R + 'gchat: não volta a quem mandou, e quem não é da guilda (outra guilda, sem guilda, sem conta) não ouve nada',
              not o['ana1'] and not o['caio'] and not o['duda'] and not o['anon'],
              repr({k: o[k] for k in ('ana1', 'caio', 'duda', 'anon')}))

        manda(ws['bia1'], t='gchat', de='hbia01', nome='Administrador', texto='sou do suporte')
        o = ouve(ws)
        g = do_tipo(o['ana1'], 'gchat')
        check(R + 'gchat: nome reservado de quem não é o Mestre vira Aventureiro-ia01 (o carimbo do chat)',
              len(g) == 1 and g[0].get('nome') == 'Aventureiro-ia01' and 'mestre' not in g[0]
              and g[0].get('texto') == 'sou do suporte', repr(g))
        manda(ws['mestre'], t='gchat', de='hmestre1', nome='GM Vigia', texto='reunião')
        o = ouve(ws)
        g = do_tipo(o['bia2'], 'gchat')
        check(R + 'gchat: o Mestre conferido sai com o nome dele e mestre:true',
              len(g) == 1 and g[0].get('nome') == 'GM Vigia' and g[0].get('mestre') is True
              and g[0].get('guilda') == 'Os da Prova', repr(g))

        manda(ws['anon'], t='gchat', de='hanon01', nome='Anon', texto='alguém?')
        o = ouve(ws)
        check(R + 'gchat sem conta: só quem mandou ouve {t:gchat-nao, motivo:sem-conta}, ninguém mais ouve nada',
              o['anon'] == [{'t': 'gchat-nao', 'motivo': 'sem-conta'}]
              and not any(o[k] for k in o if k != 'anon'), repr(o)[:400])
        manda(ws['duda'], t='gchat', de='hduda01', nome='Duda', texto='alguém?')
        o = ouve(ws)
        check(R + 'gchat de conta sem guilda: só quem mandou ouve {t:gchat-nao, motivo:sem-guilda}',
              o['duda'] == [{'t': 'gchat-nao', 'motivo': 'sem-guilda'}]
              and not any(o[k] for k in o if k != 'duda'), repr(o)[:400])
        for torto in ('', '    ', 'x' * 241, 12, None):
            manda(ws['bia1'], t='gchat', de='hbia01', nome='Bia', texto=torto)
        o = ouve(ws)
        check(R + 'gchat com texto torto (vazio, só espaço, 241 caracteres, número, nulo): descartado, sem voz e sem entrega',
              not any(o.values()), repr(o)[:300])
        manda(ws['caio'], t='gchat', de='hcaio01', nome='Caio', texto='só eu aqui')
        o = ouve(ws)
        check(R + 'gchat de outra guilda (sozinho nela) não chega a ninguém da primeira',
              not any(o.values()), repr(o)[:300])

        # --------------------------------------------------------- os amigos
        ana, bia, caio, duda, eva = (contas[k][0] for k in ('ana', 'bia', 'caio', 'duda', 'eva'))
        relaciona(a, ana, bia, 'amigo')
        relaciona(a, ana, duda, 'amigo')
        relaciona(a, ana, eva, 'amigo')
        relaciona(a, ana, caio, 'inimigo')
        manda(ws['bia1'], t='pulso', de='hbia01', x=1, z=1, sala=None, luta=False)
        time.sleep(0.2)
        manda(ws['bia2'], t='pulso', de='hbia01', x=1, z=1, sala='arena-7', luta=True)   # a conexão mais recente da Bia
        ouve(ws, 0.5)
        manda(ws['ana1'], t='amigos', de='hana01')
        o = ouve(ws, 0.6)
        r = do_tipo(o['ana1'], 'amigos')
        lista = sorted((r[0].get('lista') or []) if r else [], key=lambda x: x.get('conta', 0))
        esperada = sorted([
            {'conta': bia, 'tipo': 'amigo', 'online': True, 'id': 'hbia01', 'sala': 'arena-7', 'luta': True},
            {'conta': duda, 'tipo': 'amigo', 'online': True, 'id': 'hduda01', 'sala': None, 'luta': False},
            {'conta': eva, 'tipo': 'amigo', 'online': False, 'id': None, 'sala': None, 'luta': False},
            {'conta': caio, 'tipo': 'inimigo', 'online': True, 'id': 'hcaio01', 'sala': None, 'luta': False},
        ], key=lambda x: x['conta'])
        check(R + 'amigos: a voz responde com online, id do herói, sala e luta da conexão mais recente (e o offline vazio)',
              len(r) == 1 and lista == esperada, repr(r)[:500])
        check(R + 'amigos: a resposta é voz do relé (sem `de`) e só quem pediu ouve — nem a outra aba da mesma conta',
              len(r) == 1 and 'de' not in r[0] and len(o['ana1']) == 1 and not any(o[k] for k in o if k != 'ana1'),
              repr(o)[:400])
        manda(ws['anon'], t='amigos', de='hanon01')
        o = ouve(ws)
        check(R + 'amigos sem conta: {t:amigos, lista:[], motivo:sem-conta}, só a quem pediu',
              o['anon'] == [{'t': 'amigos', 'lista': [], 'motivo': 'sem-conta'}]
              and not any(o[k] for k in o if k != 'anon'), repr(o)[:300])
        manda(ws['bia2'], t='pulso', de='hbia01', x=1, z=1, sala='arena-7', luta=False)
        ouve(ws, 0.4)
        manda(ws['ana2'], t='amigos', de='hana01')
        o = ouve(ws, 0.6)
        r = do_tipo(o['ana2'], 'amigos')
        b = [x for x in ((r[0].get('lista') or []) if r else []) if x.get('conta') == bia]
        check(R + 'amigos: a batalha acabou (pulso com luta:false) e a lista seguinte já diz luta:false',
              len(b) == 1 and b[0]['luta'] is False and b[0]['online'] is True, repr(r)[:300])

        # -------------------------------------------------------- os inimigos
        manda(ws['ana1'], t='sussurro', de='hana01', para='hbia01', nome='Ana', texto='oi, amiga')
        o = ouve(ws)
        check(R + 'controle: o sussurro entre quem não é inimigo chega',
              len(do_tipo(o['bia1'], 'sussurro')) == 1 and len(do_tipo(o['bia2'], 'sussurro')) == 1, repr(o)[:300])
        manda(ws['ana1'], t='sussurro', de='hana01', para='hcaio01', nome='Ana', texto='some daqui')
        manda(ws['caio'], t='sussurro', de='hcaio01', para='hana01', nome='Caio', texto='responde')
        o = ouve(ws)
        check(R + 'inimigos: o sussurro não chega em nenhum dos dois sentidos (Ana marcou o Caio; o Caio não marcou ninguém)',
              not do_tipo(o['caio'], 'sussurro') and not do_tipo(o['ana1'], 'sussurro')
              and not do_tipo(o['ana2'], 'sussurro'), repr(o)[:400])
        check(R + 'inimigos: e em silêncio — nenhum `ausente` volta a quem mandou',
              not do_tipo(o['ana1'], 'ausente') and not do_tipo(o['caio'], 'ausente'), repr(o)[:300])
        manda(ws['ana1'], t='troca', de='hana01', para='hcaio01', acao='convite', dados={'ref': 'tr1'})
        manda(ws['caio'], t='troca', de='hcaio01', para='hana01', acao='convite', dados={'ref': 'tr2'})
        o = ouve(ws)
        check(R + 'inimigos: a troca também não chega, nos dois sentidos, e sem `ausente`',
              not do_tipo(o['caio'], 'troca') and not do_tipo(o['ana1'], 'troca') and not do_tipo(o['ana2'], 'troca')
              and not any(do_tipo(o[k], 'ausente') for k in o), repr(o)[:400])
        manda(ws['ana1'], t='duelo', de='hana01', para='hcaio01', acao='desafio', dados={'did': 'd1'})
        manda(ws['caio'], t='duelo', de='hcaio01', para='hana01', acao='desafio', dados={'did': 'd2'})
        o = ouve(ws)
        check(R + 'inimigos: o desafio de duelo chega nos dois sentidos (o PvP entre inimigos vale)',
              len(do_tipo(o['caio'], 'duelo')) == 1 and len(do_tipo(o['ana1'], 'duelo')) == 1, repr(o)[:400])

        # ------------------------------------------- o amigos-muda vale na hora
        manda(ws['bia1'], t='sussurro', de='hbia01', para='hduda01', nome='Bia', texto='oi, Duda')
        o = ouve(ws)
        check(R + 'antes da relação: o sussurro da Bia chega à Duda (e o relé guarda que não são inimigas)',
              len(do_tipo(o['duda'], 'sussurro')) == 1, repr(o['duda']))
        relaciona(a, duda, bia, 'inimigo')
        manda(ws['bia1'], t='sussurro', de='hbia01', para='hduda01', nome='Bia', texto='de novo')
        o = ouve(ws)
        check(R + 'sem o aviso, a relação recém-gravada ainda espera o cache de 15 s (é por isso que o amigos-muda existe)',
              len(do_tipo(o['duda'], 'sussurro')) == 1, repr(o['duda']))
        manda(ws['duda'], t='amigos-muda', de='hduda01')
        o = ouve(ws)
        check(R + 'o amigos-muda nunca é repassado e não tem resposta', not any(o.values()), repr(o)[:300])
        manda(ws['bia1'], t='sussurro', de='hbia01', para='hduda01', nome='Bia', texto='e agora?')
        manda(ws['duda'], t='sussurro', de='hduda01', para='hbia01', nome='Duda', texto='nem vem')
        manda(ws['duda'], t='troca', de='hduda01', para='hbia01', acao='convite', dados={'ref': 'tr3'})
        o = ouve(ws)
        check(R + 'depois do amigos-muda a relação vale NA HORA: nem sussurro nem troca, nos dois sentidos',
              not do_tipo(o['duda'], 'sussurro') and not do_tipo(o['bia1'], 'sussurro')
              and not do_tipo(o['bia2'], 'sussurro') and not do_tipo(o['bia1'], 'troca')
              and not any(do_tipo(o[k], 'ausente') for k in o), repr(o)[:400])

        texto_log = rl.fecha()
        rl = None
        check(R + 'o texto do gchat nunca vai ao log do relé', segredo not in texto_log and 'reunião' not in texto_log)
        check(R + 'o relé não tropeçou em nada (sem Traceback no log)', 'Traceback' not in texto_log, texto_log[-400:])
    finally:
        if rl is not None:
            rl.fecha()
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


if __name__ == '__main__':
    prova()
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
