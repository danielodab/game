#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova do UM APARELHO SÓ no relé (13/09): servidor/rele.py e servidor/rele_ident.py.

    python tests/rele_aparelho_prova.py

PEDIDO DO DONO: "uma conta só pode estar logada em um dispositivo.. se outro
tentar logar, no que estava logado cai o jogo". O login certo apaga as outras
sessões da conta e anota o sha256 de cada token em sessoes_derrubadas
(servidor/conta.py). O relé, que só LÊ o banco, derruba a conexão do token que
caiu: {t:'derrubado', motivo:'outro-aparelho'} e fechamento 4001.

O relé de verdade DENTRO do processo (ReleEmCasa, de rele_nomes_prova.py), com a
conferência de novo encurtada de 60 s para 1 s, contra um banco criado pela Api
de verdade (cria_banco). Prova:
  1. o módulo: rele_ident.derrubadas lê a tabela (e o banco antigo sem ela
     responde "nenhum"; o ausente, None);
  2. duas conexões com o token velho (duas abas) + login em outro aparelho +
     a conexão nova se identifica: as DUAS velhas ouvem o aviso e fecham com
     4001, sem mandar nada; a nova segue;
  3. duas conexões com o MESMO token: ninguém cai;
  4. uma sessão velha que ainda VALE (aberta antes da regra) se identifica: a
     do token atual não cai — quem decide é o banco;
  5. o login em outro aparelho sem ident neste relé (o do outro contêiner do
     rolling update): as conexões caem na conferência de novo, e o que elas
     mandaram depois não chega a ninguém;
  6. o logout NÃO derruba: a conexão só perde a conta (ident-nao) e segue aberta;
  7. nenhuma linha de log nova fala do token.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from rele_nomes_prova import ReleEmCasa, cria_banco, logs_com_token  # noqa: E402  (põe servidor/ no sys.path)
from rele_prova import junta, manda, recebe  # noqa: E402
import comum  # noqa: E402
import rele_ident  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RESULTADOS = []
DERRUBADO = {'t': 'derrubado', 'motivo': 'outro-aparelho'}


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def ate_fechar(ws, segundos=4.0):
    """(o que chegou, o código de fechamento) até a conexão fechar ou o prazo acabar (código None)."""
    fora, fim = [], time.time() + segundos
    while time.time() < fim:
        try:
            s = ws.recv(timeout=0.3)
        except TimeoutError:
            continue
        except ConnectionClosed as e:
            rc = getattr(e, 'rcvd', None)
            return fora, (rc.code if rc is not None else getattr(ws, 'close_code', None))
        try:
            fora.append(json.loads(s))
        except Exception:
            fora.append(s)
    return fora, None


def aberta(ws):
    try:
        ws.ping().wait(2)
        return True
    except Exception:
        return False


def prova_do_modulo():
    R = 'módulo: '
    pasta = tempfile.mkdtemp(prefix='rele-aparelho-mod-')
    a = None
    try:
        a, banco, contas = cria_banco(pasta)
        _, t1 = contas['joana']
        st, r = a.login(None, {'login': 'Prova Joana', 'senha': 'senha-de-prova-0'})
        t2 = r['token']
        check(R + 'o login certo derruba o token de antes: derrubadas() acha só ele',
              st == 200 and rele_ident.derrubadas(banco, [t1, t2, 'x' * 10]) == {t1})
        antigo = os.path.join(pasta, 'antigo.db')
        b = sqlite3.connect(antigo)
        b.execute("CREATE TABLE sessoes(token TEXT)")
        b.commit()
        b.close()
        check(R + 'o banco de antes de 13/09 (sem a tabela) responde "nenhum", não "não sei"',
              rele_ident.derrubadas(antigo, [t1]) == set())
        check(R + 'banco ausente: None (não derruba ninguém)',
              rele_ident.derrubadas(os.path.join(pasta, 'nao-existe.db'), [t1]) is None)
        check(R + 'o aviso não leva token: {"t":"derrubado","motivo":"outro-aparelho"}',
              rele_ident.derrubado() == '{"t":"derrubado","motivo":"outro-aparelho"}')
    finally:
        if a is not None:
            a.con.close()
        shutil.rmtree(pasta, ignore_errors=True)


def prova_ao_vivo():
    R = 'ao vivo: '
    pasta = tempfile.mkdtemp(prefix='rele-aparelho-')
    a = casa = None
    try:
        a, banco, contas = cria_banco(pasta)
        joana_id, t1 = contas['joana']
        _, tb = contas['bento']
        casa = ReleEmCasa(banco, 1.0)
        if not casa.inicia():
            check(R + 'o relé dentro do processo subiu', False)
            return
        obs, _ = casa.liga('marcaobs00001')
        manda(obs, t='pulso', de='obs', x=0, z=0, sala=None)

        # 2) duas abas com o token velho; login em outro aparelho; a nova se identifica
        a1, _ = casa.liga('marcaapa00001')
        manda(a1, t='ident', de='japa01', token=t1)
        r1 = recebe(a1, 3)
        a2, _ = casa.liga('marcaapa00002')
        manda(a2, t='ident', de='japa01', token=t1)
        r2 = recebe(a2, 3)
        check(R + 'duas conexões (duas abas) com o mesmo token se identificam',
              r1 == r2 == '{"t":"ident-ok","mestre":false}', '%r %r' % (r1, r2))
        st, r = a.login(None, {'login': 'Prova Joana', 'senha': 'senha-de-prova-0'})
        t2 = r['token']
        b1, _ = casa.liga('marcaapb00001')
        manda(b1, t='ident', de='japb01', token=t2)
        rb = recebe(b1, 3)
        m1, c1 = ate_fechar(a1)
        m2, c2 = ate_fechar(a2)
        check(R + 'o aparelho novo se identifica (ident-ok)', st == 200 and rb == '{"t":"ident-ok","mestre":false}', repr(rb))
        check(R + 'as DUAS conexões do token velho ouvem {t:derrubado, motivo:outro-aparelho} e fecham com 4001, sem mandar nada',
              DERRUBADO in m1 and DERRUBADO in m2 and c1 == c2 == rele_ident.FECHA_DERRUBADO, '%r %r %r %r' % (m1, c1, m2, c2))
        rb2 = junta(b1, 0.8)
        check(R + 'a conexão nova segue aberta e não ouve aviso nenhum', aberta(b1) and DERRUBADO not in rb2, repr(rb2))

        # 3) o MESMO token em duas conexões: ninguém cai
        b2, _ = casa.liga('marcaapb00002')
        manda(b2, t='ident', de='japb01', token=t2)
        rb2 = recebe(b2, 3)
        time.sleep(0.8)
        manda(b1, t='chat', de='japb01', nome='Joana', texto='as duas abas')
        vistos = junta(obs, 0.8)
        q1, q2 = junta(b1, 0.4), junta(b2, 0.4)
        check(R + 'duas abas com o MESMO token: ninguém cai e o chat de uma chega à praça',
              rb2 == '{"t":"ident-ok","mestre":false}' and aberta(b1) and aberta(b2)
              and DERRUBADO not in q1 + q2 and any(isinstance(x, dict) and x.get('t') == 'chat' for x in vistos),
              '%r %r %r' % (rb2, q1, q2))

        # 4) a sessão velha que ainda VALE (de antes da regra) se identifica: quem decide é o banco
        t3 = '%064x' % int.from_bytes(os.urandom(32), 'big')
        with a.tranca:
            a.con.execute("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES (?, ?, ?, ?)",
                          (t3, joana_id, comum.agora(), comum.agora()))
            a.con.commit()
        d1, _ = casa.liga('marcaapd00001')
        manda(d1, t='ident', de='japd01', token=t3)
        rd = recebe(d1, 3)
        q1, q2 = junta(b1, 1.0), junta(b2, 0.3)
        check(R + 'uma sessão velha que ainda vale se identifica: o token atual (que o banco diz vivo) não cai',
              rd == '{"t":"ident-ok","mestre":false}' and aberta(b1) and aberta(b2) and DERRUBADO not in q1 + q2,
              '%r %r %r' % (rd, q1, q2))

        # 5) login em outro aparelho SEM ident neste relé (o outro contêiner): a conferência de novo derruba
        st, r = a.login(None, {'login': 'Prova Joana', 'senha': 'senha-de-prova-0'})
        time.sleep(1.3)
        junta(obs, 0.3)
        for w, quem in ((b1, 'japb01'), (d1, 'japd01')):
            manda(w, t='chat', de=quem, nome='Joana', texto='ainda aqui?')
        mb, cb = ate_fechar(b1)
        md, cd = ate_fechar(d1)
        vistos = junta(obs, 0.6)
        check(R + 'login no outro contêiner: na conferência de novo (1 s aqui, 60 s no ar) as conexões caem com o aviso e 4001',
              st == 200 and DERRUBADO in mb and DERRUBADO in md and cb == cd == rele_ident.FECHA_DERRUBADO,
              '%r %r %r %r' % (mb, cb, md, cd))
        check(R + '...e o chat que elas mandaram depois da queda não chegou a ninguém',
              not [x for x in vistos if isinstance(x, dict) and x.get('t') == 'chat'], repr(vistos)[:300])
        pares = [p for p in list(casa.rele.PARES.values()) if p.id in ('japb01', 'japd01')]
        check(R + '...e a conexão derrubada não guarda token nem conta',
              all(p.token is None and p.conta is None for p in pares), repr([(p.id, p.derrubado) for p in pares]))

        # 6) o logout não derruba
        f1, _ = casa.liga('marcaapf00001')
        manda(f1, t='ident', de='japf01', token=tb)
        rf = recebe(f1, 3)
        a.logout(None, {'_token': tb})
        time.sleep(1.3)
        manda(f1, t='pulso', de='japf01', x=1, z=1, sala=None)
        mf, cf = ate_fechar(f1, 2.0)
        check(R + 'logout (sair por vontade própria) NÃO derruba: ident-nao, sem aviso, a conexão segue aberta',
              rf == '{"t":"ident-ok","mestre":false}' and {'t': 'ident-nao'} in mf and DERRUBADO not in mf
              and cf is None and aberta(f1), '%r %r %r' % (rf, mf, cf))
    finally:
        if casa is not None:
            casa.fecha()
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


def prova_do_log():
    fontes = ''
    for arq in ('rele.py', 'rele_ident.py'):
        with open(os.path.join(AQUI, '..', 'servidor', arq), encoding='utf-8') as f:
            fontes += f.read() + '\n'
    fora = logs_com_token(fontes)
    check('log: nenhuma chamada de log do relé fala do token', not fora, repr(fora))


if __name__ == '__main__':
    prova_do_modulo()
    prova_ao_vivo()
    prova_do_log()
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
