#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova da moderação no Relé (servidor/rele.py, rele_ident.py, moderacao.py — 02/10).

    python tests/moderacao_rele_prova.py

PEDIDO DO DONO: o banimento vale "no relé (recusa/derruba a conta banida)" e o
silêncio vale no chat. O relé de verdade DENTRO deste processo (o ReleEmCasa de
tests/rele_nomes_prova.py, com a conferência de novo encurtada de 60 s para 1 s
e o cache do silêncio de 15 s para 0,5 s), contra um banco criado pela Api do
cartório — o banimento e o silêncio entram pelas rotas do Mestre (os métodos da
Api), como o painel os grava:

  - o MÓDULO: banimento_lido/silencio_lido/banida_de_fato e o rele_ident.confere
    leem o prazo da LINHA (o 0/1 de contas.banido só é zerado pela API no
    próximo pedido da conta): o banimento vencido confere, o em vigor não;
  - o token de conta BANIDA no ident: a conexão ouve {t:'banido', banimento} com
    o motivo e o fim, e fecha com 4003 (o rede.js não religa);
  - banida com a praça ABERTA: na conferência de novo cai do mesmo jeito;
  - a sessão só revogada (sem banimento) NÃO ouve 'banido': segue a regra antiga;
  - o SILENCIADO: chat, sussurro e /g não chegam a ninguém; quem falou ouve
    {t:'silenciado', silencio}; desfeito o silêncio, a fala volta a sair;
  - quem não está silenciado e a conexão sem conta falam como sempre — a sem
    conta, com o nome de troca ('Aventureiro-xxxx'), nunca com o que escolheu.
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
SERVIDOR = os.path.normpath(os.path.join(AQUI, '..', 'servidor'))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
sys.path.insert(0, SERVIDOR)
import api as cartorio  # noqa: E402
import comum  # noqa: E402
import privacidade  # noqa: E402   (03/10, a junção: o cadastro exige o aceite dos Termos)
import moderacao  # noqa: E402
import rele_ident  # noqa: E402
from rele_prova import junta, manda, recebe  # noqa: E402
from rele_nomes_prova import ReleEmCasa  # noqa: E402

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def do_tipo(lista, t):
    return [m for m in lista if isinstance(m, dict) and m.get('t') == t]


def cria_banco(pasta):
    caminho = os.path.join(pasta, 'soterra.db')
    a = cartorio.Api(caminho)
    contas = {}
    for i, rotulo in enumerate(('vigia', 'ana', 'bia', 'caio', 'duda', 'eva', 'fabio')):
        st, r = a.cadastro(None, {'nome': 'Prova %s' % rotulo.capitalize(), 'email': 'mod-%s-%d@prova.test' % (rotulo, i),
                                  'senha': 'senha-de-prova-%d' % i, 'aceiteTermos': privacidade.VERSAO_TERMOS})
        assert st == 201, (st, r)
        contas[rotulo] = (r['conta']['id'], r['token'])
    with a.tranca:
        a.con.execute("UPDATE contas SET gm = 1 WHERE id = ?", (contas['vigia'][0],))
        a.con.commit()
    return a, caminho, contas


def conta(a, cid):
    with a.tranca:
        return dict(a.con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone())


def fechou_com(ws, segundos=3.0):
    """O código com que o relé fechou a conexão (None se ela não fechou no prazo)."""
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            ws.recv(timeout=0.3)
        except TimeoutError:
            continue
        except Exception:
            break
    try:
        return ws.close_code
    except Exception:
        return None


def prova_do_modulo(a, banco, contas):
    R = 'módulo: '
    m = conta(a, contas['vigia'][0])
    ana, bia = contas['ana'][0], contas['bia'][0]
    a.mestre_banir(m, {'conta': ana, 'duracao': '1h', 'motivo': 'xingou na praça'})
    t = comum.agora()
    con = moderacao._abre_leitura(banco)
    try:
        lido = moderacao.banimento_lido(con, ana, 1, t)
        check(R + 'banimento_lido: o em vigor, com motivo e fim (sem quem aplicou)',
              lido and lido['motivo'] == 'xingou na praça' and t + 3590 <= lido['fim'] <= t + 3610 and 'por' not in lido,
              repr(lido))
        check(R + 'banida_de_fato: em vigor é banida; uma hora depois, não (a linha venceu, o 0/1 ainda não)',
              moderacao.banida_de_fato(con, ana, t) and not moderacao.banida_de_fato(con, ana, t + 3700))
        check(R + 'banimento_lido com contas.banido = 0 (o admin desbanir do Terminal): não está banida',
              moderacao.banimento_lido(con, ana, 0, t) is None)
    finally:
        con.close()
    check(R + 'rele_ident.confere: o token da conta banida não confere', rele_ident.confere(banco, contas['ana'][1]) == (None, True))
    check(R + 'rele_ident.confere: uma hora depois, sem ninguém zerar o 0/1, confere de novo',
          (rele_ident.confere(banco, contas['ana'][1], agora=t + 3700)[0] or {}).get('id') == ana)
    ban, definitivo = moderacao.le_banimento_do_token(banco, contas['ana'][1])
    check(R + 'le_banimento_do_token: diz POR QUE o token não conferiu', definitivo and ban and ban['motivo'] == 'xingou na praça',
          repr(ban))
    check(R + 'le_banimento_do_token: token que não existe não é banimento',
          moderacao.le_banimento_do_token(banco, 'x' * 64) == (None, True))
    a.mestre_silenciar(m, {'conta': bia, 'duracao': '24h', 'motivo': 'spam'})
    sil, ok = moderacao.le_silencio(banco, bia)
    check(R + 'le_silencio: o silêncio em vigor', ok and sil and sil['motivo'] == 'spam' and not sil['permanente'], repr(sil))
    check(R + 'le_silencio: banco que não existe não cala ninguém (definitivo False)',
          moderacao.le_silencio(os.path.join(os.path.dirname(banco), 'nao-existe.db'), bia) == (None, False))
    # desfaz o que esta parte gravou: a parte ao vivo começa limpa
    a.mestre_desbanir(m, {'conta': ana})
    a.mestre_dessilenciar(m, {'conta': bia})


def prova_ao_vivo(a, banco, contas):
    R = 'ao vivo: '
    import rele
    casa = ReleEmCasa(banco, 1.0)
    guardado = rele.SILENCIO_S
    rele.SILENCIO_S = 0.5
    try:
        if not casa.inicia():
            check(R + 'o relé dentro do processo subiu', False)
            return
        m = conta(a, contas['vigia'][0])
        ana, bia, caio, duda, eva, fabio = (contas[k][0] for k in ('ana', 'bia', 'caio', 'duda', 'eva', 'fabio'))

        # 1) banida ANTES de entrar: o ident ouve o motivo e a conexão fecha com 4003
        a.mestre_banir(m, {'conta': caio, 'duracao': '7d', 'motivo': 'trapaça comprovada'})
        w, _ = casa.liga('marcabanida01')
        manda(w, t='ident', de='jcaio001', token=contas['caio'][1])
        r = recebe(w, 3)
        try:
            msg = json.loads(r) if r else {}
        except Exception:
            msg = {}
        check(R + 'token de conta banida: ouve {t:banido} com o motivo e o fim, e nunca ident-ok',
              msg.get('t') == 'banido' and msg['banimento']['motivo'] == 'trapaça comprovada'
              and msg['banimento']['fim'] > time.time() + 6 * 86400, repr(r))
        check(R + 'e a conexão fecha com 4003 (o rede.js não religa)', fechou_com(w) == rele.FECHA_BANIDO)

        # 2) a sessão só revogada (sem banimento) segue como antes: ident-nao, sem 'banido'
        w2, _ = casa.liga('marcarevoga02')
        manda(w2, t='ident', de='jfab0001', token='f' * 64)
        r2 = recebe(w2, 3)
        check(R + 'token que não existe: ident-nao, sem banido e sem fechar', r2 == '{"t":"ident-nao"}', repr(r2))

        # 3) banida com a praça ABERTA: cai na conferência de novo
        wd, _ = casa.liga('marcaduda0001')
        manda(wd, t='ident', de='jduda001', token=contas['duda'][1])
        r3 = recebe(wd, 3)
        a.mestre_banir(m, {'conta': duda, 'duracao': 'permanente', 'motivo': 'golpe na troca'})
        time.sleep(1.3)
        manda(wd, t='pulso', de='jduda001', x=0, z=0, sala=None)
        ouvido = junta(wd, 0.8)
        b = do_tipo(ouvido, 'banido')
        check(R + 'banida com a praça aberta: na conferência de novo ouve {t:banido} (permanente) e cai com 4003',
              r3 == '{"t":"ident-ok","mestre":false}' and len(b) == 1 and b[0]['banimento']['permanente'] is True
              and fechou_com(wd) == rele.FECHA_BANIDO, '%r %r' % (r3, ouvido))

        # 4) o silêncio: quem fala não chega a ninguém e ouve o porquê
        we, _ = casa.liga('marcaeva00001')
        manda(we, t='ident', de='jeva0001', token=contas['eva'][1])
        wf, _ = casa.liga('marcafabio001')
        manda(wf, t='ident', de='jfab0002', token=contas['fabio'][1])
        wn, _ = casa.liga('marcaanon0001')           # sem conta: o anônimo da praça
        idents = (recebe(we, 3), recebe(wf, 3))
        for w_, de_ in ((we, 'jeva0001'), (wf, 'jfab0002'), (wn, 'janon001')):
            manda(w_, t='oi', de=de_, nome='X', classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.4)
        for w_ in (we, wf, wn):
            junta(w_, 0.2)
        a.mestre_silenciar(m, {'conta': eva, 'duracao': '1h', 'motivo': 'flood de propaganda'})
        manda(we, t='chat', de='jeva0001', nome='Eva', texto='compre ouro aqui')
        manda(we, t='sussurro', de='jeva0001', para='jfab0002', nome='Eva', texto='psiu')
        manda(we, t='gchat', de='jeva0001', nome='Eva', texto='guilda?')
        oe, of, on = junta(we, 0.6), junta(wf, 0.6), junta(wn, 0.6)
        vozes = do_tipo(oe, 'silenciado')
        check(R + 'silenciada: o chat, o sussurro e o /g não chegam a ninguém',
              not do_tipo(of, 'chat') and not do_tipo(of, 'sussurro') and not do_tipo(on, 'chat'),
              '%r %r' % (of, on))
        check(R + 'silenciada: quem falou ouve {t:silenciado} com o motivo (uma voz por fala)',
              idents[0] == '{"t":"ident-ok","mestre":false}' and len(vozes) == 3
              and vozes[0]['silencio']['motivo'] == 'flood de propaganda', repr(oe))
        manda(wf, t='chat', de='jfab0002', nome='Fabio', texto='bom dia')
        manda(wn, t='chat', de='janon001', nome='Anon', texto='oi gente')
        oe = junta(we, 0.6)
        check(R + 'quem não está silenciado (com conta ou sem) fala como sempre — e a silenciada ouve',
              sorted(x['texto'] for x in do_tipo(oe, 'chat')) == ['bom dia', 'oi gente'], repr(oe))   # a ordem é da thread do banco
        # 03/10 (revisão): a conexão sem conta não fala com o nome que escolheu — senão a conta
        # silenciada ou banida voltava com o PRÓPRIO nome (ou com o de outro jogador)
        manda(wn, t='chat', de='janon001', nome='Prova Fabio', texto='sou o fabio')
        manda(wn, t='sussurro', de='janon001', para='jfab0002', nome='Prova Eva', texto='psiu, sou a eva')
        of = junta(wf, 0.6)
        falas = [x for x in of if isinstance(x, dict) and x.get('de') == 'janon001' and x.get('t') in ('chat', 'sussurro')
                 and x.get('texto') in ('sou o fabio', 'psiu, sou a eva')]
        check(R + 'sem conta: o chat e o sussurro saem com o nome de troca, nunca com o nome escolhido',
              len(falas) == 2 and all(x['nome'] == 'Aventureiro-n001' and 'nuvem' not in x for x in falas)
              and sorted(x['t'] for x in falas) == ['chat', 'sussurro'], repr(of))
        a.mestre_dessilenciar(m, {'conta': eva})
        time.sleep(0.7)                               # o cache do silêncio (encurtado para 0,5 s) vence
        manda(we, t='chat', de='jeva0001', nome='Eva', texto='voltei')
        of = junta(wf, 0.6)
        check(R + 'desfeito o silêncio, a fala volta a sair',
              [x['texto'] for x in do_tipo(of, 'chat') if x['de'] == 'jeva0001'] == ['voltei'],
              repr(of))
        # 5) o banimento vencido (a linha) confere no ident mesmo com o 0/1 ainda em 1
        a.mestre_banir(m, {'conta': ana, 'duracao': '1h', 'motivo': 'teste do prazo'})
        with a.tranca:
            a.con.execute("UPDATE moderacao_banimentos SET fim = ? WHERE conta_id = ? AND encerrado_em IS NULL",
                          (comum.agora() - 5, ana))
            a.con.commit()
        wa, _ = casa.liga('marcaana00001')
        manda(wa, t='ident', de='jana0001', token=contas['ana'][1])
        r5 = recebe(wa, 3)
        check(R + 'banimento vencido (contas.banido ainda 1): o ident confere', r5 == '{"t":"ident-ok","mestre":false}', repr(r5))
    finally:
        rele.SILENCIO_S = guardado
        casa.fecha()


def prova():
    pasta = tempfile.mkdtemp(prefix='rele-moderacao-')
    a = None
    try:
        a, banco, contas = cria_banco(pasta)
        prova_do_modulo(a, banco, contas)
        prova_ao_vivo(a, banco, contas)
    finally:
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
