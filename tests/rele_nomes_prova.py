#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova da identidade na praça: servidor/rele_ident.py, o que o servidor/rele.py
faz com ela e o que o js/core/rede.js manda e aceita.

    python tests/rele_nomes_prova.py [--so-modulo] [--sem-navegador]

PEDIDO DO DONO: "ninguem conseguir colocar o nome com GM Gm Admin Administrador
etc.." — na praça, o nome viaja no envelope da Rede, e o relé é a porta do
servidor por onde ele passa. Três partes:

1. O MÓDULO, sem relé no ar, contra um banco DE VERDADE criado pela Api do
   cartório (servidor/api.py) numa pasta temporária: a sessão boa confere; a
   do Mestre vem com gm; token falso, vencido (e o da borda dos 30 dias, que
   ainda vale), de conta banida e torto não conferem; o banco é aberto SÓ PARA
   LER (não cria o arquivo ausente, não escreve, não mexe no ultimo_uso);
   banco ausente ou trancado = não verificado e fora do cache; o cache de 60 s
   por token (a chave é o sha256, não o token); e o CARIMBO — nome, título e
   guilda reservados trocados, `mestre` do cliente jogado fora, o do Mestre
   carimbado, o `nuvem` virando o id conferido ou sumindo, o envelope sem nada
   a mudar saindo como chegou, o texto torto ou comprido demais fechando por
   padrão sem custo, e o nome de troca que nunca é, ele mesmo, reservado.
2. O RELÉ AO VIVO (subprocesso com --banco; ver prova_ao_vivo) — e, da revisão
   de 10/09: o id do herói amarrado à conta (quem copia o `de` do Mestre não
   fala nem ouve por ele), o emblema e o corpo do Mestre, a rajada de idents
   do religar e o laço que não congela com nomes caros; e, com o relé DENTRO
   do processo e o prazo encurtado (prova_da_revogacao), a sessão revogada
   que perde o carimbo com a conexão aberta. O orçamento e o juiz da regra
   têm prova própria (prova_do_orcamento).
3. O CLIENTE — o js/core/rede.js no Chrome headless (ver prova_no_navegador),
   também contra um relé "de fora" (?rede= no ar) e um que muda de ideia.

--so-modulo roda só a parte 1 (e a 4, estática: o relé no ar lê o mesmo banco
da API, como o mesmo usuário, e nenhum log fala do token); --sem-navegador
pula a 3 (e diz que pulou); --so-navegador roda só a 3. O Chrome da parte 3
roda em prioridade baixa, perfil descartável, um por vez; --chrome-baixa
CAMINHO (ou SOTERRA_CHROME_BAIXA) entrega a abertura a esse lançador.
Precisa do websockets com cliente síncrono (12+) na máquina de testes.
"""
import asyncio
import html
import json
import os
import pathlib
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
SERVIDOR = os.path.join(RAIZ, 'servidor')
RELE = os.path.join(SERVIDOR, 'rele.py')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)     # o dono usa a máquina enquanto a prova roda
CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
sys.dont_write_bytecode = True            # sem .pyc em servidor/
sys.path.insert(0, SERVIDOR)
import api as cartorio  # noqa: E402  (o banco nasce pela Api de verdade)
import privacidade  # noqa: E402  (02/10: o cadastro exige o aceite dos Termos)
import comum  # noqa: E402
import nomes  # noqa: E402
import rele_ident  # noqa: E402
from rele_prova import de, espera_porta, junta, manda, porta_livre, recebe  # noqa: E402  (os clientes crus de lá)
from websockets.asyncio.server import serve as serve_ws  # noqa: E402
from websockets.sync.client import connect  # noqa: E402

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


# ---------------------------------------------------------------- o banco de verdade
def cria_banco(pasta):
    """Um banco criado pela Api do cartório, com as contas da prova. Os nomes
    nascem neutros pelo cadastro e o do dono é trocado à mão depois — como a
    conta "Administrator" que já existe no ar (o cadastro recusa nome
    reservado novo). Devolve (api, caminho, {rotulo: (id, token)})."""
    caminho = os.path.join(pasta, 'soterra.db')
    a = cartorio.Api(caminho)
    contas = {}
    nomes_neutros = {'joana': 'Prova Joana', 'dono': 'Prova Vigia', 'banido': 'Prova Banida',
                     'vencido': 'Prova Vencida', 'borda': 'Prova Borda', 'cache': 'Prova Cache',
                     'bento': 'Prova Bento'}
    for i, (rotulo, nome) in enumerate(nomes_neutros.items()):
        st, r = a.cadastro(None, {'nome': nome, 'email': 'prova-%s-%d@prova.test' % (rotulo, i),
                                  'senha': 'senha-de-prova-%d' % i, 'aceiteTermos': privacidade.VERSAO_TERMOS})
        assert st == 201, (st, r)
        contas[rotulo] = (r['conta']['id'], r['token'])
    t = comum.agora()
    dia = comum.SESSAO_DIAS * 86400
    with a.tranca:
        a.con.execute("UPDATE contas SET nome = 'Administrator', gm = 1 WHERE id = ?", (contas['dono'][0],))
        a.con.execute("UPDATE contas SET banido = 1 WHERE id = ?", (contas['banido'][0],))
        a.con.execute("UPDATE sessoes SET ultimo_uso = ? WHERE token = ?", (t - dia - 5, contas['vencido'][1]))
        a.con.execute("UPDATE sessoes SET ultimo_uso = ? WHERE token = ?", (t - dia + 120, contas['borda'][1]))
        a.con.commit()
    return a, caminho, contas


class Freio:
    """O freio de mentira: `n` fichas e nenhuma reposição."""

    def __init__(self, n):
        self.n, self.gastas = n, 0

    def tira(self, agora):
        if self.n <= 0:
            return False
        self.n -= 1
        self.gastas += 1
        return True


def prova_do_modulo():
    R = 'módulo: '
    pasta = tempfile.mkdtemp(prefix='rele-nomes-')
    a = None
    try:
        a, banco, contas = cria_banco(pasta)
        joana_id, joana = contas['joana']
        dono_id, dono = contas['dono']

        # ------------------------------------------------------ a conferência
        c, definitivo = rele_ident.confere(banco, joana)
        check(R + 'a sessão de uma conta comum confere (id, nome, gm falso)',
              definitivo and c == {'id': joana_id, 'nome': 'Prova Joana', 'gm': False}, repr(c))
        c, definitivo = rele_ident.confere(banco, dono)
        check(R + 'a do Mestre (a conta "Administrator" do dono, gm = 1) confere com gm',
              definitivo and c == {'id': dono_id, 'nome': 'Administrator', 'gm': True}, repr(c))
        falso = ''.join(random.choice('0123456789abcdef') for _ in range(64))
        check(R + 'token falso (64 hex que ninguém recebeu) não confere — e é resposta definitiva',
              rele_ident.confere(banco, falso) == (None, True))
        check(R + 'token de sessão vencida (sem uso há 30 dias e 5 s) não confere',
              rele_ident.confere(banco, contas['vencido'][1]) == (None, True))
        c, _ = rele_ident.confere(banco, contas['borda'][1])
        check(R + 'a sessão na borda (30 dias menos 2 min) ainda confere — a mesma régua da API',
              c is not None and c['id'] == contas['borda'][0])
        check(R + 'token de conta banida não confere', rele_ident.confere(banco, contas['banido'][1]) == (None, True))
        tortos = [None, 123, '', 'curto', 'x' * 200, 'com espaco ' * 3, '\ud800' * 20, joana + '\n']
        ausente = os.path.join(pasta, 'nao-existe.db')
        check(R + 'token torto (não-texto, curto, longo, com espaço, surrogate, quebra de linha) nem vai ao banco',
              all(rele_ident.confere(ausente, t) == (None, True) for t in tortos))

        # ------------------------------------------------- só para ler
        check(R + 'banco ausente: não verificado e NÃO definitivo (fica fora do cache)',
              rele_ident.confere(ausente, joana) == (None, False))
        check(R + 'e o arquivo ausente não é criado (mode=ro)', not os.path.exists(ausente))
        marca = comum.agora() - 1000
        with a.tranca:
            a.con.execute("UPDATE sessoes SET ultimo_uso = ? WHERE token = ?", (marca, joana))
            a.con.commit()
        rele_ident.confere(banco, joana)
        uso = a.con.execute("SELECT ultimo_uso FROM sessoes WHERE token = ?", (joana,)).fetchone()[0]
        check(R + 'conferir não mexe no ultimo_uso da sessão', uso == marca, '%r -> %r' % (marca, uso))
        escreveu = True
        try:
            ro = sqlite3.connect(rele_ident.uri_so_leitura(banco), uri=True)
            try:
                ro.execute("UPDATE contas SET gm = 1")
                ro.commit()
            finally:
                ro.close()
        except sqlite3.OperationalError:
            escreveu = False
        check(R + 'a conexão do relé é só-leitura de verdade (um UPDATE por ela é recusado)', not escreveu)

        trancado = os.path.join(pasta, 'trancado.db')
        orig, copia = sqlite3.connect(banco), sqlite3.connect(trancado)
        orig.backup(copia)
        orig.close()
        copia.execute("PRAGMA journal_mode=DELETE")          # no WAL o leitor não espera ninguém
        copia.commit()
        copia.execute("BEGIN EXCLUSIVE")
        t0 = time.time()
        r = rele_ident.confere(trancado, joana)
        dt = time.time() - t0
        copia.rollback()
        copia.close()
        check(R + 'banco trancado: não verificado, não definitivo e sem pendurar (espera ~1 s e desiste)',
              r == (None, False) and dt < 3.0, '%r em %.2f s' % (r, dt))

        # ------------------------------------------------- o cache de 60 s
        relogio = [1000.0]
        v = rele_ident.Verificador(banco, relogio=lambda: relogio[0])
        cache_id, cache_tok = contas['cache']

        async def rodada_cache():
            c1 = await v.confere(cache_tok)
            n1 = v.consultas
            with a.tranca:                               # a pessoa saiu (logout): a sessão some do banco
                a.con.execute("DELETE FROM sessoes WHERE token = ?", (cache_tok,))
                a.con.commit()
            c2 = await v.confere(cache_tok)
            n2 = v.consultas
            relogio[0] += 61.0
            c3 = await v.confere(cache_tok)
            return c1, n1, c2, n2, c3, v.consultas

        c1, n1, c2, n2, c3, n3 = asyncio.run(rodada_cache())
        check(R + 'Verificador: a primeira conferência vai ao banco (numa thread) e confere',
              c1 is not None and c1['id'] == cache_id and n1 == 1)
        check(R + 'dentro de 60 s a resposta vem do cache, sem ir ao banco (o logout leva até 1 min para valer)',
              c2 == c1 and n2 == 1)
        check(R + 'passados 60 s ele pergunta de novo e a sessão apagada não confere mais', c3 is None and n3 == 2)
        chaves = list(v.cache)
        check(R + 'o cache guarda o sha256 do token, nunca o token',
              v.chave(cache_tok) in v.cache and cache_tok not in v.cache
              and all(re.fullmatch(r'[0-9a-f]{64}', k) for k in chaves))

        sem = rele_ident.Verificador(ausente)

        async def rodada_ausente():
            return [await sem.confere(joana), await sem.confere(joana)]
        check(R + 'banco ausente pelo Verificador: None, e cada ident tenta de novo (não guarda o erro)',
              asyncio.run(rodada_ausente()) == [None, None] and sem.consultas == 2 and not sem.cache)
        nada = rele_ident.Verificador(None)

        async def rodada_sem_banco():
            return [await nada.confere(joana)] + [await v.confere(t) for t in tortos]
        antes = v.consultas
        check(R + 'sem --banco ninguém é verificado; token torto não gasta ida ao banco',
              asyncio.run(rodada_sem_banco()) == [None] * (1 + len(tortos)) and not nada.ligado
              and nada.consultas == 0 and v.consultas == antes)

        # ------------------------- a rajada do religar (depois de um deploy)
        # 100 sessões VÁLIDAS se identificam de uma vez: antes, as que passavam de
        # EM_VOO_MAX ouviam "não conferido" na hora (a revisão mediu 68 de 100) e
        # o cliente não pergunta de novo; agora esperam a vez
        t = comum.agora()
        rajada = ['%064x' % random.getrandbits(256) for _ in range(100)]
        with a.tranca:
            a.con.executemany("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES (?, ?, ?, ?)",
                              [(tk, joana_id, t, t) for tk in rajada])
            a.con.commit()
        rv = rele_ident.Verificador(banco)

        async def rodada_rajada():
            return await asyncio.gather(*[rv.consulta(tk) for tk in rajada])
        t0 = time.time()
        rs = asyncio.run(rodada_rajada())
        dt = time.time() - t0
        ok = sum(1 for c, d in rs if d and c is not None and c['id'] == joana_id)
        check(R + 'a rajada do religar: 100 sessões válidas de uma vez, todas conferidas (%d por vez, as outras esperam)'
              % rele_ident.EM_VOO_MAX, ok == 100 and rv.em_voo == 0, '%d de 100 em %.2f s' % (ok, dt))
        sem_vez = rele_ident.Verificador(banco)
        sem_vez.em_voo = rele_ident.EM_VOO_MAX              # todas as vagas tomadas, e ninguém devolve
        espera0 = rele_ident.ESPERA_VEZ
        rele_ident.ESPERA_VEZ = 0.3
        try:
            r = asyncio.run(sem_vez.consulta(rajada[0]))
        finally:
            rele_ident.ESPERA_VEZ = espera0
        check(R + 'sem vaga até o fim da espera: "não verificado" e NÃO definitivo (a conexão tenta de novo depois)',
              r == (None, False) and sem_vez.consultas == 0, repr(r))

        # ------------------------------------------------- o aperto de mão
        check(R + 'o anúncio do relé: {t:rele, v:1, ident} sem `de` (o cliente antigo ignora)',
              rele_ident.anuncio(True) == '{"t":"rele","v":1,"ident":true}'
              and rele_ident.anuncio(None) == '{"t":"rele","v":1,"ident":false}')
        check(R + 'com a marca que o cliente pôs no endereço, o anúncio a devolve em `n` (é a prova de que veio do relé)',
              rele_ident.anuncio(True, 'k3x9ab12qq') == '{"t":"rele","v":1,"ident":true,"n":"k3x9ab12qq"}')
        marcas = {'/ws?n=k3x9ab12qq': 'k3x9ab12qq', '/?n=abcdefgh&x=1': 'abcdefgh', '/ws': None, '/ws?x=1': None,
                  '/ws?n=curta': None, '/ws?n=' + 'a' * 41: None, '/ws?n=MAIUSCULA1': None,
                  '/ws?n=abc%22defgh': None, '/ws?n=abcdefgh%00': None, None: None, 7: None}
        ruins = {k: rele_ident.marca_do_caminho(k) for k in marcas if rele_ident.marca_do_caminho(k) != marcas[k]}
        check(R + 'a marca do endereço: só 8 a 40 letras minúsculas e dígitos; o resto é ignorado (anúncio sem `n`)',
              not ruins and rele_ident.anuncio(True, 'x"y') == '{"t":"rele","v":1,"ident":true}', repr(ruins))
        check(R + 'a resposta do ident: ident-ok com mestre, ou ident-nao — nunca o token',
              rele_ident.resposta({'id': 1, 'nome': 'X', 'gm': True}) == '{"t":"ident-ok","mestre":true}'
              and rele_ident.resposta({'id': 2, 'nome': 'Y', 'gm': False}) == '{"t":"ident-ok","mestre":false}'
              and rele_ident.resposta(None) == '{"t":"ident-nao"}')
    finally:
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)

    # ----------------------------------------------------------- o carimbo
    # o orçamento de tempo da regra tem prova própria (prova_do_orcamento):
    # aqui ele não pode fechar nada por padrão
    rele_ident.ORCAMENTO = rele_ident.Orcamento(1e9, 1e9)
    comum_ = {'id': 7, 'nome': 'Joana', 'gm': False}
    mestre = {'id': 1, 'nome': 'Administrator', 'gm': True}

    def oi(**campos):
        m = {'t': 'oi', 'de': 'jabc123', 'nome': 'Joana', 'titulo': 'o Fundido', 'classe': 'sumo',
             'resumo': {'classes': {'sumo': 3}, 'total': 3, 'guilda': {'nome': 'Os Lobos', 'emblema': 'x'}},
             'x': 1, 'z': 2, 'sala': None, 'v': 2}
        m.update(campos)
        return m

    check(R + 'carimbo: oi sem nada a mudar (sem conta, sem nuvem, nome comum) sai como chegou',
          rele_ident.carimba(oi(), None) is None)
    m = rele_ident.carimba(oi(nome='GM Joana', mestre=True, nuvem=7), None)
    check(R + 'sem conta conferida: nome reservado vira Aventureiro-xxxx, o mestre do cliente e o nuvem caem',
          m is not None and m['nome'] == 'Aventureiro-c123' and 'mestre' not in m and 'nuvem' not in m, repr(m))
    m = rele_ident.carimba(oi(nome='Administrador', mestre=True, nuvem=1), comum_)
    check(R + 'conta comum conferida com nome reservado: trocado, sem mestre, e o nuvem é o id CONFERIDO (não o 1 que ela disse)',
          m is not None and m['nome'] == 'Aventureiro-c123' and 'mestre' not in m and m['nuvem'] == 7, repr(m))
    m = rele_ident.carimba(oi(nuvem=7), comum_)
    check(R + 'conta comum com o nuvem certo e nome comum: sai como chegou', m is None)
    m = rele_ident.carimba(oi(nuvem=True), {'id': 1, 'nome': 'Um', 'gm': False})
    check(R + 'o nuvem `true` (que o Python acha igual a 1) também é trocado pelo id', m is not None and m['nuvem'] == 1
          and type(m['nuvem']) is int)
    m = rele_ident.carimba(oi(nome='GM Vigia', titulo='Mestre do Fundo',
                              resumo={'guilda': {'nome': 'Staff', 'emblema': 'x'}}), mestre)
    check(R + 'o Mestre conferido passa com o nome, o título e a guilda que escolheu, carimbado mestre:true e com o nuvem dele',
          m is not None and m['nome'] == 'GM Vigia' and m['titulo'] == 'Mestre do Fundo'
          and m['resumo']['guilda']['nome'] == 'Staff' and m['mestre'] is True and m['nuvem'] == 1, repr(m))
    m = rele_ident.carimba(oi(titulo='Administrador', resumo={'guilda': {'nome': 'Os Admins', 'emblema': '⚑'},
                                                              'total': 9}), None)
    check(R + 'título reservado vira vazio e guilda reservada vira "Guilda" (o emblema e o resto do resumo ficam)',
          m is not None and m['titulo'] == '' and m['resumo']['guilda'] == {'nome': 'Guilda', 'emblema': '⚑'}
          and m['resumo']['total'] == 9 and m['nome'] == 'Joana', repr(m))
    m = rele_ident.carimba({'t': 'eco', 'de': 'jxyz999', 'para': 'a', 'nome': 'Sistema', 'nuvem': 3}, None)
    check(R + 'o eco passa pelo mesmo carimbo (nome e nuvem)',
          m is not None and m['nome'] == 'Aventureiro-z999' and 'nuvem' not in m, repr(m))
    m = rele_ident.carimba({'t': 'chat', 'de': 'jxyz999', 'nome': 'G.M.', 'texto': 'oi, sou o GM'}, None)
    check(R + 'o chat também: o nome reservado é trocado e o texto segue intacto (é conversa, não nome)',
          m is not None and m['nome'] == 'Aventureiro-z999' and m['texto'] == 'oi, sou o GM', repr(m))
    m = rele_ident.carimba({'t': 'chat', 'de': 'jxyz999', 'nome': 'Vigia', 'texto': 'oi'}, mestre)
    check(R + 'o chat do Mestre sai carimbado', m is not None and m.get('mestre') is True and m['nome'] == 'Vigia')
    m = rele_ident.carimba({'t': 'guilda', 'de': 'jxyz999', 'para': 'b', 'acao': 'convite',
                            'dados': {'gid': 'g1', 'nome': 'Suporte Oficial', 'emblema': 'x'}}, comum_)
    check(R + 'o convite de guilda com nome reservado chega como "Guilda"',
          m is not None and m['dados'] == {'gid': 'g1', 'nome': 'Guilda', 'emblema': 'x'}, repr(m))
    m = rele_ident.carimba({'t': 'pulso', 'de': 'jxyz999', 'x': 0, 'z': 0, 'mestre': True}, None)
    check(R + 'o `mestre` que o cliente pôs em QUALQUER envelope cai (um pulso aqui)',
          m is not None and 'mestre' not in m and m['x'] == 0)
    check(R + 'pulso, alvo e troca sem nada a mudar saem como chegaram',
          rele_ident.carimba({'t': 'pulso', 'de': 'j1', 'x': 0, 'z': 0}, None) is None
          and rele_ident.carimba({'t': 'alvo', 'de': 'j1', 'x': 1, 'z': 1}, mestre) is None
          and rele_ident.carimba({'t': 'troca', 'de': 'j1', 'para': 'j2', 'acao': 'oferta', 'dados': {'nome': 'GM'}}, None) is None)
    m = rele_ident.carimba(oi(nome=['G', 'M'], titulo=7, resumo={'guilda': {'nome': ['A', 'D', 'M']}}), None)
    check(R + 'nome, título e guilda que não são texto (o navegador junta ["G","M"] em "G,M") fecham por padrão',
          m is not None and m['nome'] == 'Aventureiro-c123' and m['titulo'] == ''
          and m['resumo']['guilda']['nome'] == 'Guilda', repr(m))
    # --------------------------- da revisão: o emblema e o corpo do Mestre
    m = rele_ident.carimba(oi(resumo={'total': 3, 'guilda': {'nome': 'Os Lobos', 'emblema': 'STAFF'}}), None)
    check(R + 'o EMBLEMA reservado ("STAFF") vira "⚑" e o nome limpo da guilda fica (a placa é emblema + nome)',
          m is not None and m['resumo']['guilda'] == {'nome': 'Os Lobos', 'emblema': '⚑'}, repr(m))
    passam = [e for e in ('GM', 'ADM', 'ADMINISTRADOR', '[GM]', '\U0001F1EC\U0001F1F2') if not rele_ident.reservado(e)]
    caem = [e for e in ('⚑', '🛡️', '🔥', '💧', '🌿', '🌪️', '⭐', '💀', '⚔️', '🐺', '🦅', '🐍', '👑', '⚒️', '🌙', '⚓')
            if rele_ident.reservado(e)]
    check(R + 'emblema: GM, ADM, ADMINISTRADOR, [GM] e a bandeira que se lê G M caem; os 16 da ficha da HUD passam',
          not passam and not caem, repr((passam, caem)))
    m = rele_ident.carimba({'t': 'guilda', 'de': 'jxyz999', 'para': 'b', 'acao': 'convite',
                            'dados': {'gid': 'g1', 'nome': 'Tropa do Fundo', 'emblema': 'GM'}}, comum_)
    check(R + 'o convite de guilda com emblema reservado chega com "⚑" (o nome limpo fica)',
          m is not None and m['dados'] == {'gid': 'g1', 'nome': 'Tropa do Fundo', 'emblema': '⚑'}, repr(m))
    m = rele_ident.carimba(oi(classe='gm', resumo={'classes': {'gm': 30, 'sumo': 3}, 'total': 33}), comum_)
    check(R + 'o corpo do Mestre (classe "gm") de quem não é o Mestre vira "sumo", e a ficha "gm" sai do placar',
          m is not None and m['classe'] == 'sumo' and m['resumo']['classes'] == {'sumo': 3}, repr(m))
    m = rele_ident.carimba(oi(classe='fus:sumo+gm'), None)
    check(R + '...e a fusão com ele também ("fus:sumo+gm" compõe o corpo do Cavaleiro Negro)',
          m is not None and m['classe'] == 'sumo', repr(m))
    check(R + 'as fusões de verdade e as classes comuns passam como vieram',
          rele_ident.carimba(oi(classe='fus:bruxo+sumo'), None) is None
          and rele_ident.carimba(oi(classe='minotauro'), None) is None)
    m = rele_ident.carimba(oi(classe='gm', resumo={'classes': {'gm': 30}, 'guilda': {'nome': 'Staff', 'emblema': 'GM'}}),
                           mestre)
    check(R + 'o Mestre conferido veste o corpo dele e a placa que quiser',
          m is not None and m['classe'] == 'gm'
          and m['resumo'] == {'classes': {'gm': 30}, 'guilda': {'nome': 'Staff', 'emblema': 'GM'}}, repr(m))
    check(R + 'nome ausente, nulo ou vazio não é mexido (o jogo mostra "?")',
          rele_ident.carimba({'t': 'oi', 'de': 'j1', 'x': 0, 'z': 0}, None) is None
          and rele_ident.carimba({'t': 'oi', 'de': 'j1', 'nome': None}, None) is None
          and rele_ident.carimba({'t': 'chat', 'de': 'j1', 'nome': '', 'texto': 'a'}, None) is None)

    rele_ident._VEREDITOS.clear()
    t0 = time.perf_counter()
    m = rele_ident.carimba(oi(nome='a' * 8000), None, Freio(6))
    dt = time.perf_counter() - t0
    check(R + 'nome de 8 mil caracteres: trocado sem passar pela regra (fecha por padrão, sem custo)',
          m is not None and m['nome'] == 'Aventureiro-c123' and dt < 0.05, '%.1f ms' % (dt * 1e3))
    longo_legitimo = 'Joana ' * 6                    # 36 caracteres de nome "limpo"
    m = rele_ident.carimba(oi(nome=longo_legitimo), None)
    check(R + 'nome acima de %d caracteres (nenhum nome do jogo passa de 24) também é trocado' % rele_ident.TEXTO_MAX,
          m is not None and m['nome'] == 'Aventureiro-c123')

    rele_ident._VEREDITOS.clear()
    freio = Freio(6)
    saidas = []
    for i in range(10):
        m = rele_ident.carimba({'t': 'chat', 'de': 'jfreio1', 'nome': 'Joana %d' % i, 'texto': 'a'}, None, freio)
        saidas.append(m['nome'] if m else 'Joana %d' % i)
    check(R + 'freio: os 6 primeiros nomes NOVOS passam pela regra (comuns, saem como chegaram)...',
          saidas[:6] == ['Joana %d' % i for i in range(6)], repr(saidas[:6]))
    check(R + '...e com o freio vazio, nome novo sai trocado sem custo (quem inventa um nome por envelope)',
          all(s == 'Aventureiro-eio1' for s in saidas[6:]), repr(saidas[6:]))
    antes = freio.gastas
    m = rele_ident.carimba({'t': 'chat', 'de': 'jfreio1', 'nome': 'Joana 3', 'texto': 'a'}, None, freio)
    check(R + 'nome já julgado não gasta ficha (o cliente de verdade repete sempre os mesmos 2 ou 3 textos)',
          m is None and freio.gastas == antes)

    # ---------------------------------------------------- o nome de troca
    # o que a prova espera sai da PRÓPRIA regra: servidor/nomes.py muda (às
    # 22:02 'xxgm' passou a cair e '8075' deixou de cair), e a prova de antes,
    # que fixava os dois resultados à mão, ficou vermelha sem furo nenhum
    def sufixo(i):
        return re.sub(r'[^0-9a-z]', '', str(i or '').lower())[-4:]
    check(R + 'o nome de troca: "Aventureiro-" e as 4 últimas letras/dígitos do id, em minúsculas',
          rele_ident.nome_de_troca('jabc123') == 'Aventureiro-c123'
          and rele_ident.nome_de_troca('xxAB') == 'Aventureiro-xxab'
          and rele_ident.nome_de_troca('a-b_c.D') == 'Aventureiro-abcd')
    candidatos = ('xxGM', 'heroi-gm', 'j8075', 'jbots', 'xadm', 'j0mod', 'jcm', 'ydev', 'zbot', 'jstaff', 'xroot')
    caidos = [i for i in candidatos if nomes.reservado('Aventureiro-' + sufixo(i))]
    check(R + 'se o sufixo cair na regra, fica só "Aventureiro" (hoje: %s)' % ', '.join(caidos),
          bool(caidos) and all(rele_ident.nome_de_troca(i) == 'Aventureiro' for i in caidos)
          and all(rele_ident.nome_de_troca(i) == 'Aventureiro-' + sufixo(i) for i in candidatos if i not in caidos)
          and rele_ident.nome_de_troca('') == 'Aventureiro' and rele_ident.nome_de_troca(None) == 'Aventureiro',
          repr(caidos))
    rnd = random.Random(1009)
    alfabeto = '0123456789abcdefghijklmnopqrstuvwxyz'
    ids = ['j' + ''.join(rnd.choice(alfabeto) for _ in range(12)) for _ in range(1500)]
    ids += ['j' + ''.join(rnd.choice('0123456789') for _ in range(8)) for _ in range(500)]
    ruins = [i for i in ids if nomes.reservado(rele_ident.nome_de_troca(i))]
    check(R + 'o nome de troca NUNCA é reservado (2000 ids, 500 só de dígitos)', not ruins, repr(ruins[:3]))
    check(R + '"Aventureiro" e "Guilda" não são reservados',
          not nomes.reservado('Aventureiro') and not nomes.reservado('Guilda'))

    # ------------------------------------------- nada de token no log (estático)
    fonte = open(os.path.join(SERVIDOR, 'rele_ident.py'), encoding='utf-8').read()
    check(R + 'nenhuma linha de log do rele_ident.py fala do token', not logs_com_token(fonte),
          repr(logs_com_token(fonte)[:2]))


def prova_do_orcamento():
    """O TEMPO DA REGRA (a revisão de 10/09 mediu 15 conexões com nomes caros
    segurando a praça inteira por 1,4 s): o Orcamento do laço, o fecha-por-
    padrão que não guarda, o cache que joga fora primeiro o que ninguém usa, e
    o Juiz — a fila única, no ritmo do orçamento, a conta conferida na frente."""
    R = 'orçamento: '
    antes = rele_ident.ORCAMENTO
    try:
        relogio = [100.0]
        o = rele_ident.Orcamento(100, 250, relogio=lambda: relogio[0])
        o.gasta(300)
        falta = o.falta()
        check(R + 'gastou além da rajada: fica devendo, e a falta é o tempo de pagar à taxa (100 ms por s)',
              not o.tem() and abs(falta - 0.505) < 0.01, '%.3f s' % falta)
        relogio[0] += 0.6
        check(R + 'pago esse tempo, volta a ter saldo', o.tem() and o.saldo <= 250)
        relogio[0] += 100
        check(R + '...e parado muito tempo, nunca guarda mais que a rajada', o.tem() and o.saldo == 250)

        rele_ident._VEREDITOS.clear()
        rele_ident.ORCAMENTO = rele_ident.Orcamento(100, 0.001, relogio=lambda: relogio[0])
        rele_ident.ORCAMENTO.gasta(1.0)                      # devendo, e o relógio parado
        check(R + 'orçamento gasto: o texto novo fecha por padrão, SEM passar pela regra e SEM ir para o cache',
              rele_ident.reservado('Joana Silva') is True and 'Joana Silva' not in rele_ident._VEREDITOS)
        rele_ident.ORCAMENTO = rele_ident.Orcamento(1e9, 1e9)
        check(R + '...e com saldo de novo, o mesmo texto é julgado de verdade (limpo)',
              rele_ident.reservado('Joana Silva') is False and rele_ident._VEREDITOS.get('Joana Silva') is False)
        check(R + 'so_cache (o caminho do relé): o que o juiz não julgou fecha por padrão; o julgado vale',
              rele_ident.reservado('Bento Sá', so_cache=True) is True and 'Bento Sá' not in rele_ident._VEREDITOS
              and rele_ident.reservado('Joana Silva', so_cache=True) is False)

        maximo0 = rele_ident.VEREDITOS_MAX
        rele_ident.VEREDITOS_MAX = 8
        try:
            rele_ident._VEREDITOS.clear()
            for s in ('Ana', 'Bia', 'Caio', 'Duda', 'Edu', 'Fabi', 'Gil', 'Hugo'):
                rele_ident.reservado(s)
            rele_ident.reservado('Ana')                       # a Ana é usada de novo: vai para o fim
            rele_ident.reservado('Iara')                      # cheio: saem os 4 que ninguém usa há mais tempo
            fica = list(rele_ident._VEREDITOS)
        finally:
            rele_ident.VEREDITOS_MAX = maximo0
        check(R + 'cache cheio: sai a metade que ninguém usa há mais tempo (não tudo) — o texto usado de novo fica',
              fica == ['Fabi', 'Gil', 'Hugo', 'Ana', 'Iara'], repr(fica))

        # o Juiz no ritmo do orçamento: nunca começa um julgamento devendo
        rele_ident._VEREDITOS.clear()
        rele_ident.ORCAMENTO = rele_ident.Orcamento(100, 60)
        caros = ['a1' * 11 + '%02d' % i for i in range(6)]   # 24 caracteres: dezenas de ms cada na regra de hoje
        saldos = []

        async def rodada_juiz():
            j = rele_ident.Juiz()
            orig = rele_ident._julga

            def espia(texto):
                saldos.append(rele_ident.ORCAMENTO.tem())
                return orig(texto)
            rele_ident._julga = espia
            try:
                t0 = time.perf_counter()
                fora = await asyncio.gather(*[j.pede(s, prazo=30) for s in caros])
                return fora, time.perf_counter() - t0, j.julgados
            finally:
                rele_ident._julga = orig
        fora, dt, n = asyncio.run(rodada_juiz())
        gasto = rele_ident.ORCAMENTO.gasto
        check(R + 'o juiz julga tudo o que pediram, um por vez, e só começa um julgamento com saldo no orçamento',
              all(fora) and n == len(caros) and saldos == [True] * len(caros),
              '%.0f ms de regra em %.2f s de parede (rajada 60 ms, taxa 100 ms/s)' % (gasto, dt))

        rele_ident._VEREDITOS.clear()
        rele_ident.ORCAMENTO = rele_ident.Orcamento(1e9, 1e9)
        ordem = []

        async def rodada_ordem():
            j = rele_ident.Juiz(maximo=3)
            orig = rele_ident._julga

            def espia(texto):
                ordem.append(texto)
                return orig(texto)
            rele_ident._julga = espia
            try:
                p1 = asyncio.ensure_future(j.pede('Comum Um'))
                p2 = asyncio.ensure_future(j.pede('Comum Dois'))
                p3 = asyncio.ensure_future(j.pede('Conferida', prioridade=True))
                await asyncio.sleep(0)                        # os três entram na fila
                cheia = await j.pede('Sobrou Fora', prazo=0.5)
                mesmo = asyncio.ensure_future(j.pede('Comum Um'))
                r = await asyncio.gather(p1, p2, p3, mesmo)
                return cheia, r
            finally:
                rele_ident._julga = orig
        cheia, r = asyncio.run(rodada_ordem())
        check(R + 'fila cheia: o texto novo fecha por padrão na hora, sem esperar o prazo', cheia is False)
        check(R + 'a conta conferida passa na frente, e o mesmo texto pedido duas vezes é julgado uma vez só',
              all(r) and ordem and ordem[0] == 'Conferida' and ordem.count('Comum Um') == 1
              and 'Sobrou Fora' not in ordem, repr(ordem))

        # o caminho do relé: o prepara julga pelo juiz, o carimba só lê
        rele_ident._VEREDITOS.clear()

        async def rodada_prepara(freio, m):
            j = rele_ident.Juiz()
            await rele_ident.prepara(m, None, freio, juiz=j)
            return rele_ident.carimba(m, None, None, None, so_cache=True), j.julgados
        m, n = asyncio.run(rodada_prepara(Freio(6), {
            't': 'oi', 'de': 'jprep01', 'nome': 'Administradora', 'titulo': 'o Fundido', 'classe': 'sumo',
            'resumo': {'guilda': {'nome': 'Tropa Nova', 'emblema': 'STAFF'}}}))
        check(R + 'o caminho do relé: o prepara julga os textos novos (e o nome de troca) pelo juiz, e o carimba só lê',
              m is not None and m['nome'] == 'Aventureiro-ep01' and m['titulo'] == 'o Fundido'
              and m['resumo']['guilda'] == {'nome': 'Tropa Nova', 'emblema': '⚑'} and n == 5, '%r (%d julgados)' % (m, n))
        m, n = asyncio.run(rodada_prepara(Freio(0), {'t': 'chat', 'de': 'jprep02', 'nome': 'Rosa Nova', 'texto': 'oi'}))
        check(R + 'freio da conexão vazio: o prepara nem pede ao juiz, e o carimba fecha por padrão sem regra',
              m is not None and m['nome'] == 'Aventureiro' and n == 0 and 'Rosa Nova' not in rele_ident._VEREDITOS, repr(m))
    finally:
        rele_ident.ORCAMENTO = antes


def logs_com_token(fonte):
    """As chamadas de log que mencionam o token (o comentário no fim da linha
    — dois espaços e # — não conta; o '#' de "conta #%d" dentro do texto fica)."""
    fora = []
    for l in fonte.splitlines():
        codigo = re.sub(r'\s{2,}#.*$', '', l)
        if re.search(r'\blog\.\w+\(', codigo) and 'token' in codigo:
            fora.append(l.strip())
    return fora


# ================================================================ 2. o relé ao vivo
class Rele:
    """O relé DE VERDADE num subprocesso (prioridade baixa), numa porta livre;
    o log vai para um arquivo (num PIPE que ninguém lê o relé trava)."""

    def __init__(self, extra):
        self.porta = porta_livre()
        self.registro = tempfile.TemporaryFile()
        self.proc = subprocess.Popen([sys.executable, RELE, '--porta', str(self.porta), '--relatorio', '0'] + extra,
                                     stdout=subprocess.DEVNULL, stderr=self.registro, creationflags=BAIXA)
        self.abertos = []
        self.url = 'ws://127.0.0.1:%d' % self.porta
        self.ok = espera_porta(self.porta)

    def liga(self, marca=None):
        """Um cliente cru; devolve (ws, a primeira coisa que ele ouviu)."""
        ws = connect(self.url + ('/ws?n=' + marca if marca else ''), max_queue=None)
        self.abertos.append(ws)
        return ws, recebe(ws, 3)

    def log(self):
        self.registro.flush()
        self.registro.seek(0)
        return self.registro.read().decode('utf-8', 'replace')

    def fecha(self):
        for ws in self.abertos:
            try:
                ws.close()
            except Exception:
                pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        texto = self.log()
        self.registro.close()
        return texto


def crus(ws, espera=0.4):
    """Tudo o que chegar, como texto cru (para comparar byte a byte)."""
    fora = []
    while True:
        s = recebe(ws, espera)
        if s is None:
            return fora
        fora.append(s)


def primeiro(lista, t, quem):
    achados = de(lista, t, quem)
    return achados[0] if achados else {}


def sem_cx(an):
    """O anúncio sem o `cx` (11/09: o id da conexão, sorteado pelo relé — 8
    hex), para comparar com o texto fixo de antes; None se o cx faltou ou veio torto."""
    try:
        a = json.loads(an)
    except Exception:
        return None
    if not isinstance(a, dict) or not re.fullmatch(r'[0-9a-f]{8}', str(a.pop('cx', ''))):
        return None
    return json.dumps(a, separators=(',', ':'))


def _prova_com_banco(R, banco, contas):
    rl = Rele(['--banco', banco])
    texto_log = ''
    try:
        if not rl.ok:
            check(R + 'o relé com --banco subiu', False, rl.log()[-300:])
            return
        joana_id, joana = contas['joana']
        dono_id, dono = contas['dono']
        falso = ''.join(random.choice('0123456789abcdef') for _ in range(64))

        obs, an = rl.liga()
        check(R + 'com --banco o relé se anuncia com ident:true, antes de qualquer outra coisa',
              sem_cx(an) == '{"t":"rele","v":1,"ident":true}', repr(an))
        manda(obs, t='pulso', de='obs', x=0, z=0, sala=None)
        jw, an = rl.liga('marcajoana01')
        check(R + 'e devolve em `n` a marca que o cliente pôs no endereço',
              sem_cx(an) == '{"t":"rele","v":1,"ident":true,"n":"marcajoana01"}', repr(an))
        time.sleep(0.2)
        junta(obs, 0.1)

        # ------------------------------------------------ o ident não vaza
        manda(jw, t='ident', de='jjoana01', token=joana)
        r = recebe(jw, 3)
        ro = crus(obs, 0.5)
        check(R + 'o ident da Joana (conta comum) volta só para ela: ident-ok com mestre falso',
              r == '{"t":"ident-ok","mestre":false}', repr(r))
        check(R + 'o ident NÃO vaza: quem está na praça não ouve nada (nem o envelope, nem o token)',
              not ro and not any(joana in s for s in ro), repr(ro)[:200])

        # ----------------------- o nuvem conferido; o mestre do cliente cai
        manda(jw, t='oi', de='jjoana01', nome='Joana', classe='sumo', x=1, z=1, sala=None, v=2, nuvem=999, mestre=True)
        oi = primeiro(junta(obs, 0.5), 'oi', 'jjoana01')
        check(R + 'conta comum conferida: o `nuvem` que ela disse (999) vira o id dela e o `mestre` que ela pôs cai',
              oi.get('nuvem') == joana_id and 'mestre' not in oi and oi.get('nome') == 'Joana', repr(oi))
        manda(jw, t='chat', de='jjoana01', nome='Administrador', texto='sou do suporte')
        ch = primeiro(junta(obs, 0.5), 'chat', 'jjoana01')
        check(R + 'conferida, mas comum, com nome reservado: sai Aventureiro-na01 (só o Mestre veste nome reservado)',
              ch.get('nome') == 'Aventureiro-na01' and ch.get('texto') == 'sou do suporte', repr(ch))

        # ------------------------------------------------------- o Mestre
        vw, _ = rl.liga('marcavigia01')
        manda(vw, t='ident', de='jvigia01', token=dono)
        r = recebe(vw, 3)
        check(R + 'o Mestre (a conta "Administrator", gm = 1) ouve ident-ok com mestre verdadeiro',
              r == '{"t":"ident-ok","mestre":true}', repr(r))
        manda(vw, t='oi', de='jvigia01', nome='GM Vigia', titulo='Mestre do Fundo', classe='sumo', x=2, z=2,
              sala=None, v=2, resumo={'guilda': {'nome': 'Staff', 'emblema': 'E'}})
        oi = primeiro(junta(obs, 0.5), 'oi', 'jvigia01')
        check(R + 'o Mestre conferido passa com o nome, o título e a guilda que escolheu, mestre:true e o nuvem dele',
              oi.get('nome') == 'GM Vigia' and oi.get('titulo') == 'Mestre do Fundo' and oi.get('mestre') is True
              and oi.get('nuvem') == dono_id and (oi.get('resumo') or {}).get('guilda', {}).get('nome') == 'Staff',
              repr(oi))
        manda(vw, t='chat', de='jvigia01', nome='GM Vigia', texto='bem-vindos')
        ch = primeiro(junta(obs, 0.5), 'chat', 'jvigia01')
        check(R + 'e o chat do Mestre sai com mestre:true', ch.get('mestre') is True and ch.get('nome') == 'GM Vigia',
              repr(ch))

        # ---------------------------------- o cliente antigo, sem ident
        bw, _ = rl.liga()
        cru = json.dumps({'t': 'oi', 'de': 'bento', 'nome': 'Bento Sá', 'classe': 'sumo', 'x': 3, 'z': 3},
                         ensure_ascii=False)
        bw.send(cru)
        ro = crus(obs, 0.5)
        check(R + 'cliente antigo (sem ident) com nome comum: o envelope sai IGUAL, byte a byte (não re-serializa)',
              cru in ro, repr(ro)[:200])
        manda(jw, t='chat', de='jjoana01', nome='Joana', texto='oi, Bento')
        check(R + 'e o cliente antigo segue vendo os outros (o chat da Joana chega a ele)',
              len(de(junta(bw, 0.5), 'chat', 'jjoana01')) == 1)
        manda(bw, t='oi', de='bento', nome='GM Bento', mestre=True, titulo='Administrador', classe='sumo', x=3, z=3,
              nuvem=5, resumo={'total': 3, 'guilda': {'nome': 'Os Admins', 'emblema': 'E'}})
        oi = primeiro(junta(obs, 0.5), 'oi', 'bento')
        check(R + 'sem ident: nome reservado vira Aventureiro-ento, título some, guilda vira "Guilda", o mestre e o nuvem dele caem',
              oi.get('nome') == 'Aventureiro-ento' and oi.get('titulo') == '' and 'mestre' not in oi
              and 'nuvem' not in oi and oi.get('resumo') == {'total': 3, 'guilda': {'nome': 'Guilda', 'emblema': 'E'}},
              repr(oi))
        manda(bw, t='guilda', de='bento', para='obs', acao='convite', dados={'gid': 'g1', 'nome': 'Suporte', 'emblema': 'E'})
        gv = primeiro(junta(obs, 0.5), 'guilda', 'bento')
        check(R + 'o convite de guilda com nome reservado chega ao destino como "Guilda"',
              (gv.get('dados') or {}).get('nome') == 'Guilda' and (gv.get('dados') or {}).get('gid') == 'g1', repr(gv))

        # ------------------ da revisão: o emblema e o corpo do Mestre na praça
        manda(bw, t='eco', de='bento', para='obs', nome='Bento Sá', classe='gm', x=3, z=3,
              resumo={'classes': {'gm': 30, 'sumo': 3}, 'guilda': {'nome': 'Tropa do Fundo', 'emblema': 'STAFF'}})
        ec = primeiro(junta(obs, 0.5), 'eco', 'bento')
        check(R + 'sem conta: o corpo do Mestre vira "sumo", a ficha "gm" sai do placar e o emblema "STAFF" vira "⚑"',
              ec.get('classe') == 'sumo' and (ec.get('resumo') or {}).get('classes') == {'sumo': 3}
              and (ec.get('resumo') or {}).get('guilda') == {'nome': 'Tropa do Fundo', 'emblema': '⚑'}, repr(ec))

        # ----------------------- da revisão: o id do herói é de UMA conta
        imp, _ = rl.liga('marcaimpostor1')                  # sem ident, com o `de` do Mestre (vai em todo pulso)
        manda(imp, t='guilda', de='jvigia01', para='obs', acao='convite',
              dados={'gid': 'g9', 'nome': 'Os Bons', 'emblema': '⚑'})
        manda(imp, t='troca', de='jvigia01', para='obs', acao='convite', dados=None)
        jw2, _ = rl.liga('marcajoana02')                    # com o ident da Joana (conta comum)
        manda(jw2, t='ident', de='jvigia01', token=joana)
        r_jw2 = recebe(jw2, 3)
        manda(jw2, t='troca', de='jvigia01', para='obs', acao='oferta', dados={'itens': [], 'moedas': 1})
        ro = junta(obs, 0.6)
        check(R + 'quem copia o `de` do Mestre (sem conta, ou com a conta da Joana) não fala por ele: nem troca nem convite de guilda chegam',
              r_jw2 == '{"t":"ident-ok","mestre":false}'
              and not [x for x in ro if isinstance(x, dict) and x.get('de') == 'jvigia01'], repr(ro)[:300])
        manda(obs, t='troca', de='obs', para='jvigia01', acao='aceite', dados=None)
        pv, pi, pj = junta(vw, 0.6), junta(imp, 0.3), junta(jw2, 0.3)
        check(R + '...nem ouve por ele: o aceite dirigido ao Mestre chega só à conexão do Mestre',
              len(de(pv, 'troca', 'obs')) == 1 and not de(pi, 'troca', 'obs') and not de(pj, 'troca', 'obs'),
              '%r | %r | %r' % (pv[:2], pi[:2], pj[:2]))
        pre, _ = rl.liga('marcapre00001')                   # pega ANTES, sem conta, o id que o Mestre vai usar
        manda(pre, t='pulso', de='jdono02', x=9, z=9, sala=None)
        junta(obs, 0.4)
        vw2, _ = rl.liga('marcavigia02')
        manda(vw2, t='ident', de='jdono02', token=dono)
        r_vw2 = recebe(vw2, 3)
        manda(vw2, t='oi', de='jdono02', nome='GM Vigia', classe='gm', x=2, z=2, sala=None, v=2)
        oi2 = primeiro(junta(obs, 0.5), 'oi', 'jdono02')
        manda(pre, t='guilda', de='jdono02', para='obs', acao='convite',
              dados={'gid': 'g8', 'nome': 'Os Bons', 'emblema': '⚑'})
        ro = junta(obs, 0.5)
        manda(obs, t='troca', de='obs', para='jdono02', acao='convite', dados=None)
        pv2, pp = junta(vw2, 0.5), junta(pre, 0.3)
        check(R + 'nas duas ordens: quem pegou o id antes, sem conta, perde a voz e o ouvido quando o Mestre conferido chega com ele',
              r_vw2 == '{"t":"ident-ok","mestre":true}' and oi2.get('mestre') is True and oi2.get('classe') == 'gm'
              and not de(ro, 'guilda', 'jdono02') and len(de(pv2, 'troca', 'obs')) == 1 and not de(pp, 'troca', 'obs'),
              '%r | %r | %r | %r' % (oi2, ro[:2], pv2[:2], pp[:2]))

        # ------------------------------------- a rajada do religar, ao vivo
        t = comum.agora()
        rajada = ['%064x' % random.getrandbits(256) for _ in range(80)]
        b = sqlite3.connect(banco)
        try:
            b.executemany("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES (?, ?, ?, ?)",
                          [(tk, joana_id, t, t) for tk in rajada])
            b.commit()
        finally:
            b.close()
        conns = [rl.liga('marcaraj%05d' % i)[0] for i in range(len(rajada))]
        for i, w in enumerate(conns):
            manda(w, t='ident', de='jraj%03d' % i, token=rajada[i])
        rs = [recebe(w, 15) for w in conns]
        ok = sum(1 for r in rs if r == '{"t":"ident-ok","mestre":false}')
        check(R + 'a rajada do religar, ao vivo: 80 sessões válidas se identificam de uma vez e as 80 são conferidas',
              ok == len(rajada), '%d de %d' % (ok, len(rajada)))
        for w in conns:
            try:
                w.close()
            except Exception:
                pass

        # ------------------------------------ os tokens que não conferem
        for rotulo, token in (('falso', falso), ('vencido', contas['vencido'][1])):
            w, _ = rl.liga('marca' + rotulo + '1')
            manda(w, t='ident', de='j' + rotulo, token=token)
            r = recebe(w, 3)
            manda(w, t='chat', de='j' + rotulo, nome='GM ' + rotulo.capitalize(), texto='x')
            ch = primeiro(junta(obs, 0.5), 'chat', 'j' + rotulo)
            check(R + 'token %s: ident-nao, e o nome reservado dele sai trocado' % rotulo,
                  r == '{"t":"ident-nao"}' and ch.get('nome', '').startswith('Aventureiro') and 'mestre' not in ch,
                  '%r %r' % (r, ch))
        # 02/10 (servidor/moderacao.py, pedido do dono: "o relé recusa/derruba a conta banida"): o token
        # de conta BANIDA não vira mais anônimo da praça — ouve o porquê ({t:'banido'}; aqui o banimento
        # de antes da tabela, pelo SQL: permanente e sem motivo) e a conexão fecha; a fala dele não sai
        w, _ = rl.liga('marcabanido1')
        manda(w, t='ident', de='jbanido', token=contas['banido'][1])
        r = recebe(w, 3)
        # 03/10 (a junção): o relé FECHA a conexão do banido logo depois do {t:'banido'}; se o
        # fechamento chega antes desta fala, o envio levanta ConnectionClosed — o que a prova
        # quer (a fala não sai) vale do mesmo jeito, então a corrida não derruba a prova inteira
        try:
            manda(w, t='chat', de='jbanido', nome='GM Banido', texto='x')
        except Exception:
            pass
        ch = primeiro(junta(obs, 0.5), 'chat', 'jbanido')
        try:
            rb = json.loads(r) if r else {}
        except Exception:
            rb = {}
        check(R + 'token banido: ouve {t:banido} (permanente) em vez de ident-nao, e a fala dele não chega a ninguém',
              rb.get('t') == 'banido' and (rb.get('banimento') or {}).get('permanente') is True and not ch,
              '%r %r' % (r, ch))
        w, _ = rl.liga()
        for _ in range(rele_ident.IDENT_MAX + 2):
            manda(w, t='ident', de='jteimoso', token=falso)
        rs = junta(w, 1.0)
        n = sum(1 for m in rs if isinstance(m, dict) and m.get('t') == 'ident-nao')
        check(R + 'cada conexão tem %d idents: os seguintes são descartados sem resposta' % rele_ident.IDENT_MAX,
              n == rele_ident.IDENT_MAX and len(rs) == n, '%d respostas: %r' % (n, rs[:3]))
        w, _ = rl.liga()
        w.send(json.dumps({'t': 'ident', 'token': joana}))           # sem `de`: envelope torto
        rw, ro = junta(w, 0.5), crus(obs, 0.3)
        check(R + 'ident torto (sem `de`) não é respondido nem repassado', not rw and not ro, '%r %r' % (rw, ro))
    finally:
        texto_log = rl.fecha()
    tokens = [t for _, t in contas.values()]
    check(R + 'o log do relé não tem token nenhum (nem os que conferiram, nem os que não)',
          texto_log and not any(t in texto_log for t in tokens))
    check(R + 'e registra só o número da conta conferida (e que o banco é lido só para ler)',
          ('identidade conferida: conta #%d (Mestre)' % contas['dono'][0]) in texto_log
          and 'identidade: conferida no banco' in texto_log, texto_log[-300:].replace('\n', ' | '))


def _prova_sem_banco(R):
    rl = Rele([])
    try:
        if not rl.ok:
            check(R + 'o relé sem --banco subiu', False, rl.log()[-300:])
            return
        obs, an = rl.liga()
        w, an2 = rl.liga('marcasemb01')
        check(R + 'sem --banco o anúncio diz ident:false (o cliente novo nem manda o token)',
              sem_cx(an) == '{"t":"rele","v":1,"ident":false}' and sem_cx(an2) == '{"t":"rele","v":1,"ident":false,"n":"marcasemb01"}',
              '%r %r' % (an, an2))
        manda(obs, t='pulso', de='obs', x=0, z=0, sala=None)
        time.sleep(0.2)
        junta(w, 0.2)                                  # o pulso do obs chega a ele também
        manda(w, t='ident', de='jsem01', token='a' * 64)
        r = recebe(w, 3)
        check(R + 'sem --banco, um ident que chegue mesmo assim ouve ident-nao e não vaza',
              r == '{"t":"ident-nao"}' and not crus(obs, 0.3), repr(r))
        manda(w, t='oi', de='jsem01', nome='Moderador', classe='sumo', x=0, z=0, sala=None, nuvem=3)
        oi = primeiro(junta(obs, 0.5), 'oi', 'jsem01')
        check(R + 'sem --banco ninguém é conferido: o nome reservado sai trocado e o nuvem some',
              oi.get('nome') == 'Aventureiro-em01' and 'nuvem' not in oi, repr(oi))
        cru = '{"t":"chat","de":"jsem01","nome":"Rui","texto":"segue igual"}'
        w.send(cru)
        check(R + 'e o resto segue igual (o chat comum passa byte a byte)', cru in crus(obs, 0.5))
    finally:
        texto_log = rl.fecha()
    check(R + 'sem --banco o log diz que ninguém é conferido', 'sem --banco, ninguém é conferido' in texto_log)


def _prova_banco_ausente(R, pasta, contas):
    ausente = os.path.join(pasta, 'sumiu', 'soterra.db')
    rl = Rele(['--banco', ausente])
    try:
        if not rl.ok:
            check(R + 'o relé com --banco ausente subiu', False, rl.log()[-300:])
            return
        obs, an = rl.liga()
        w, _ = rl.liga()
        manda(obs, t='pulso', de='obs', x=0, z=0, sala=None)
        time.sleep(0.2)
        junta(w, 0.2)                                  # o pulso do obs chega a ele também
        manda(w, t='ident', de='jausente', token=contas['joana'][1])
        r = recebe(w, 3)
        cru = '{"t":"chat","de":"jausente","nome":"Rui","texto":"ainda de pé"}'
        w.send(cru)
        chegou = cru in crus(obs, 0.5)
        vivo = rl.proc.poll() is None
    finally:
        texto_log = rl.fecha()
    check(R + 'banco ausente: o anúncio diz ident:true (há --banco), o ident ouve ident-nao',
          sem_cx(an) == '{"t":"rele","v":1,"ident":true}' and r == '{"t":"ident-nao"}', '%r %r' % (an, r))
    check(R + 'e nada cai: o relé segue de pé e repassando', chegou and vivo)
    check(R + 'o arquivo ausente não é criado, e o log avisa que ele ainda não existe',
          not os.path.exists(ausente) and 'ainda não existe' in texto_log)


B36 = '0123456789abcdefghijklmnopqrstuvwxyz'


def _prova_do_laco(R):
    """A regra no laço (a revisão de 10/09: 15 conexões com nomes caros
    seguravam o chat de outro jogador por 1,4 s): 16 conexões mandam 6 textos
    novos e caros cada; o chat de uma sentinela que já estava na praça tem de
    seguir chegando rápido. Num relé só dela (o juiz fica com fila)."""
    rl = Rele([])
    try:
        if not rl.ok:
            check(R + 'o relé da prova do laço subiu', False, rl.log()[-300:])
            return
        obs, _ = rl.liga('marcaobs0001')
        sen, _ = rl.liga('marcasen0001')
        manda(obs, t='pulso', de='olho', x=0, z=0, sala=None)
        manda(sen, t='chat', de='sent', nome='Sentinela', texto='aquecendo')   # o nome dela já julgado
        time.sleep(0.6)
        junta(obs, 0.3)
        junta(sen, 0.2)

        def caro(i):
            return 'a1' * 11 + B36[(i // 36) % 36] + B36[i % 36]
        atk = [rl.liga()[0] for _ in range(16)]
        n = 0
        for i, w in enumerate(atk):
            for _ in range(2):                            # 2 oi x 3 textos = as 6 fichas do freio da conexão
                w.send(json.dumps({'t': 'oi', 'de': 'atk%03d' % i, 'v': 2, 'x': 0, 'z': 0, 'sala': None,
                                   'nome': caro(n), 'titulo': caro(n + 1),
                                   'resumo': {'guilda': {'nome': caro(n + 2), 'emblema': 'E'}}}))
                n += 3
        lat = []
        for k in range(8):
            t0 = time.perf_counter()
            manda(sen, t='chat', de='sent', nome='Sentinela', texto='ping %d' % k)
            while True:
                s = recebe(obs, 5)
                if s is None:
                    lat.append(5.0)
                    break
                try:
                    mm = json.loads(s)
                except Exception:
                    continue
                if mm.get('t') == 'chat' and mm.get('texto') == 'ping %d' % k:
                    lat.append(time.perf_counter() - t0)
                    break
            time.sleep(0.25)
        pior = max(lat)
        check(R + 'o laço não congela: com 16 conexões mandando %d textos novos e caros, o chat de outro jogador chega em até 300 ms (pior: %.0f ms; antes do juiz, 1,4 s)'
              % (n, pior * 1000), pior < 0.3, repr([round(x * 1000) for x in lat]))
    finally:
        rl.fecha()


class ReleEmCasa:
    """O relé de verdade DENTRO deste processo (numa thread com o laço dele):
    para a prova que encurta o prazo da conferência de novo (rele_ident.CACHE_S)."""

    def __init__(self, banco, prazo):
        import rele
        self.rele, self.banco, self.prazo = rele, banco, prazo
        self.porta = porta_livre()
        self.url = 'ws://127.0.0.1:%d' % self.porta
        self.pronto = threading.Event()
        self.loop = self.parar = self.fio = None
        self.guardado = rele_ident.CACHE_S
        self.abertos = []

    def inicia(self):
        rele_ident.CACHE_S = self.prazo
        self.rele.liga_banco(self.banco)
        self.rele.VERIFICADOR.validade = self.prazo
        self.fio = threading.Thread(target=lambda: asyncio.run(self._principal()), daemon=True)
        self.fio.start()
        return self.pronto.wait(10)

    async def _principal(self):
        self.loop = asyncio.get_running_loop()
        self.parar = asyncio.Event()
        async with serve_ws(self.rele.trata, '127.0.0.1', self.porta, compression=None, max_size=self.rele.LIMITE_MSG):
            self.pronto.set()
            await self.parar.wait()

    def liga(self, marca):
        ws = connect(self.url + '/ws?n=' + marca, max_queue=None)
        self.abertos.append(ws)
        return ws, recebe(ws, 3)

    def fecha(self):
        for ws in self.abertos:
            try:
                ws.close()
            except Exception:
                pass
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self.parar.set)
        if self.fio is not None:
            self.fio.join(10)
        rele_ident.CACHE_S = self.guardado
        self.rele.liga_banco(None)


def prova_da_revogacao():
    """A SESSÃO REVOGADA COM A CONEXÃO ABERTA (revisão de 10/09): antes, a
    conexão que já se identificou seguia Mestre até cair — o "encerrar
    sessões", o "trocar senha: quem roubou sai", o banir e o tirar-mestre não
    tiravam o selo de quem já estava na praça. O relé de verdade, dentro do
    processo, com o prazo de 60 s encurtado para 1 s."""
    R = 'revogação: '
    pasta = tempfile.mkdtemp(prefix='rele-nomes-revoga-')
    a = casa = None
    try:
        a, banco, contas = cria_banco(pasta)
        dono_id, dono = contas['dono']
        casa = ReleEmCasa(banco, 1.0)
        if not casa.inicia():
            check(R + 'o relé dentro do processo subiu', False)
            return
        gm, _ = casa.liga('marcarevoga01')
        manda(gm, t='ident', de='jmestre1', token=dono)
        r0 = recebe(gm, 3)
        vi, _ = casa.liga('marcavitima01')
        manda(vi, t='oi', de='jvitima1', nome='Vitima', classe='sumo', x=0, z=0, sala=None, v=2)
        junta(gm, 0.4)
        manda(gm, t='eco', de='jmestre1', para='jvitima1', nome='Administrator', classe='gm', x=1, z=1, sala=None, v=2)
        e0 = primeiro(junta(vi, 0.5), 'eco', 'jmestre1')
        check(R + 'o ponto de partida: o Mestre se identifica e a vítima o vê como Mestre',
              r0 == '{"t":"ident-ok","mestre":true}' and e0.get('mestre') is True and e0.get('nome') == 'Administrator',
              '%r %r' % (r0, e0))

        # 1) tiram o Mestre (admin tirar-mestre): a sessão segue válida, o selo não
        with a.tranca:
            a.con.execute("UPDATE contas SET gm = 0 WHERE id = ?", (dono_id,))
            a.con.commit()
        time.sleep(1.3)
        manda(gm, t='chat', de='jmestre1', nome='Administrator', texto='aqui é o GM, me passa a senha')
        rg, rv = junta(gm, 0.6), junta(vi, 0.6)
        ch = primeiro(rv, 'chat', 'jmestre1')
        tchau = de(rv, 'tchau', 'jmestre1')
        check(R + 'Mestre tirado com a conexão ABERTA: o chat seguinte já sai sem mestre e com o nome trocado',
              ch and 'mestre' not in ch and ch.get('nome', '').startswith('Aventureiro'), repr(ch))
        check(R + '...antes dele a vítima ouve o tchau do relé por ele (cai o registro com o nome e o mestre:true)',
              len(tchau) == 1 and ch and rv.index(tchau[0]) < rv.index(ch), repr(rv)[:300])
        check(R + '...e só a conexão dele ouve a resposta nova: ident-ok com mestre falso',
              {'t': 'ident-ok', 'mestre': False} in rg, repr(rg))

        # 2) o Mestre volta, sem reconectar; depois encerram as sessões dele
        with a.tranca:
            a.con.execute("UPDATE contas SET gm = 1 WHERE id = ?", (dono_id,))
            a.con.commit()
        time.sleep(1.3)
        manda(gm, t='pulso', de='jmestre1', x=1, z=1, sala=None)
        rg = junta(gm, 0.6)
        junta(vi, 0.4)
        check(R + 'o Mestre posto de volta vale sem reconectar (ident-ok com mestre, só para ele)',
              {'t': 'ident-ok', 'mestre': True} in rg, repr(rg))
        with a.tranca:
            a.con.execute("DELETE FROM sessoes WHERE conta_id = ?", (dono_id,))   # sair / encerrar sessões / trocar senha
            a.con.commit()
        time.sleep(1.3)
        manda(gm, t='chat', de='jmestre1', nome='Administrator', texto='ainda sou eu')
        rg, rv = junta(gm, 0.6), junta(vi, 0.6)
        ch = primeiro(rv, 'chat', 'jmestre1')
        check(R + 'sessão encerrada com a conexão aberta: ident-nao, o tchau do relé, e o chat sem mestre e com o nome trocado',
              {'t': 'ident-nao'} in rg and len(de(rv, 'tchau', 'jmestre1')) == 1
              and ch and 'mestre' not in ch and ch.get('nome', '').startswith('Aventureiro'), '%r %r' % (rg, ch))
        try:
            pares = [p for p in list(casa.rele.PARES.values()) if p.id == 'jmestre1']
        except RuntimeError:
            pares = []
        check(R + 'e a conexão revogada não guarda mais nem o token nem a conta',
              pares and all(p.token is None and p.conta is None for p in pares),
              repr([(p.token is None, p.conta) for p in pares]))
    finally:
        if casa is not None:
            casa.fecha()
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


def prova_ao_vivo():
    R = 'ao vivo: '
    pasta = tempfile.mkdtemp(prefix='rele-nomes-vivo-')
    a = None
    try:
        a, banco, contas = cria_banco(pasta)
        _prova_com_banco(R, banco, contas)
        _prova_sem_banco(R)
        _prova_banco_ausente(R, pasta, contas)
        _prova_do_laco(R)
    finally:
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


# ================================================================ 3. o cliente no navegador
class ReleAntigo:
    """O relé de antes de 10/09, de mentira: repassa tudo a todos (o texto como
    veio, sem abrir) — e a cada conexão nova entrega de cara o que um par
    mal-intencionado mandaria por ele: um anúncio forjado sem marca, outro com
    marca chutada e um ident-ok de Mestre. Guarda tudo, em ordem."""
    FORJADOS = ['{"t":"rele","v":1,"ident":true}', '{"t":"rele","v":1,"ident":true,"n":"chutechute12"}',
                '{"t":"ident-ok","mestre":true}']

    def __init__(self):
        self.porta = porta_livre()
        self.eventos = []            # (tipo 'entrega'|'recebe', n da conexão, texto)
        self.caminhos = {}           # n -> o endereço pedido
        self.conexoes = {}
        self.pronto = threading.Event()
        self.loop = self.parar = None

    def inicia(self):
        threading.Thread(target=lambda: asyncio.run(self._principal()), daemon=True).start()
        return self.pronto.wait(10)

    async def _principal(self):
        self.loop = asyncio.get_running_loop()
        self.parar = asyncio.Event()
        async with serve_ws(self._trata, '127.0.0.1', self.porta):
            self.pronto.set()
            await self.parar.wait()

    async def _trata(self, ws):
        n = len(self.caminhos) + 1
        self.caminhos[n] = getattr(getattr(ws, 'request', None), 'path', '')
        self.conexoes[n] = ws
        try:
            for f in self.FORJADOS:
                self.eventos.append(('entrega', n, f))
                await ws.send(f)
            async for msg in ws:
                self.eventos.append(('recebe', n, msg))
                for k, outro in list(self.conexoes.items()):
                    if k != n:
                        self.eventos.append(('entrega', k, msg))
                        try:
                            await outro.send(msg)
                        except Exception:
                            pass
        except Exception:
            pass
        finally:
            self.conexoes.pop(n, None)

    def para(self):
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self.parar.set)


class ReleDeFora(ReleAntigo):
    """Um relé que se ANUNCIA com a marca (ela vem no endereço dele):
    'estrangeiro' é o de um ?rede= de fora, no ar — diz "ident-ok, mestre" sem
    ninguém perguntar e repassa tudo; 'tarde' é o que muda de ideia — ao ident
    responde ident-nao e, 1,5 s depois, ident-ok (como a conferência de novo
    do relé de verdade). Nunca repassa o ident. Guarda tudo, em ordem."""

    def __init__(self, modo):
        ReleAntigo.__init__(self)
        self.modo = modo
        self.tarefas = set()

    async def _trata(self, ws):
        n = len(self.caminhos) + 1
        caminho = getattr(getattr(ws, 'request', None), 'path', '') or ''
        self.caminhos[n] = caminho
        self.conexoes[n] = ws
        try:
            primeiras = [rele_ident.anuncio(True, rele_ident.marca_do_caminho(caminho))]
            if self.modo == 'estrangeiro':
                primeiras.append('{"t":"ident-ok","mestre":true}')
            for f in primeiras:
                self.eventos.append(('entrega', n, f))
                await ws.send(f)
            async for msg in ws:
                self.eventos.append(('recebe', n, msg))
                try:
                    t = json.loads(msg).get('t')
                except Exception:
                    t = None
                if t == 'ident':
                    if self.modo == 'tarde':
                        await ws.send('{"t":"ident-nao"}')

                        async def depois(w=ws):
                            await asyncio.sleep(1.5)
                            try:
                                await w.send('{"t":"ident-ok","mestre":false}')
                            except Exception:
                                pass
                        tarefa = asyncio.ensure_future(depois())
                        self.tarefas.add(tarefa)
                        tarefa.add_done_callback(self.tarefas.discard)
                    continue
                for k, outro in list(self.conexoes.items()):
                    if k != n:
                        self.eventos.append(('entrega', k, msg))
                        try:
                            await outro.send(msg)
                        except Exception:
                            pass
        except Exception:
            pass
        finally:
            self.conexoes.pop(n, None)


class Dorme(BaseHTTPRequestHandler):
    """O servidorzinho que "dorme" por pedido: o fetch pendente segura o
    relógio virtual do headless enquanto o WebSocket anda de verdade."""

    def do_GET(self):
        try:
            ms = max(0, min(int(parse_qs(urlparse(self.path).query).get('ms', ['40'])[0]), 1000))
        except ValueError:
            ms = 40
        time.sleep(ms / 1000.0)
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *a):
        pass


PAGINA = r"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>A identidade na praça (prova)</title></head>
<body>
<div id="summary">rodando…</div>
<div id="log"></div>
<script src="__NOMES__"></script>
<script src="__REDE__"></script>
<script>
(function () {
  'use strict';
  var log = document.getElementById('log');
  var falhas = 0, total = 0;
  function check(nome, ok, extra) {
    total++; if (!ok) falhas++;
    var d = document.createElement('div');
    d.textContent = (ok ? 'PASSOU · ' : 'FALHOU · ') + nome + (extra ? ' — ' + extra : '');
    log.appendChild(d);
  }
  function fim() {
    document.getElementById('summary').textContent = falhas ? ('FALHOU — ' + falhas + ' de ' + total)
                                                            : ('tudo passou (' + total + ')');
  }
  function arg(nome) {
    var m = new RegExp('[?&]' + nome + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  var modo = arg('modo'), url = arg('rede'), dorme = arg('dorme');
  var TOKEN = arg('token'), CONTA = Number(arg('conta')), OUTRO = arg('outro'), OUTRO_ID = Number(arg('outroid'));
  var R = JOGO.Rede;
  JOGO.Sessao = { ativa: function () { return !!TOKEN; }, token: function () { return TOKEN; },
                  contaId: function () { return CONTA; } };
  var eventos = [];
  R.aoEvento = function (ev) { eventos.push(ev); };

  function respira() {
    return fetch(dorme + '/dorme?ms=40').then(function (r) { return r.text(); }, function () {});
  }
  function espera(cond, ms) {
    var voltas = Math.ceil(ms / 40);
    return new Promise(function (res) {
      (function volta() {
        if (cond() || voltas-- <= 0) return res(cond());
        respira().then(volta);
      })();
    });
  }
  // sem fetch pendente o relógio virtual pula direto para o próximo prazo
  function pausaVirtual(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function parCru(id, marca) {
    var ws = new WebSocket(url + (marca ? '?n=' + marca : '')), caixa = [], crus = [];
    ws.onmessage = function (ev) {
      crus.push(String(ev.data));
      try { caixa.push(JSON.parse(ev.data)); } catch (e) {}
    };
    return { ws: ws, caixa: caixa, crus: crus,
             manda: function (o) { o.de = id; ws.send(JSON.stringify(o)); },
             dele: function (t, quem) { return caixa.filter(function (m) { return m.t === t && m.de === quem; }); },
             voz: function (t) { return caixa.filter(function (m) { return m.t === t && !m.de; }); } };
  }
  function aberto(p) { return espera(function () { return p.ws.readyState === 1; }, 8000); }
  function par(id) { var a = null; R.pares().forEach(function (p) { if (p.id === id) a = p; }); return a; }
  function vazou(p) {
    return p.crus.some(function (s) { return (TOKEN && s.indexOf(TOKEN) >= 0) || (OUTRO && s.indexOf(OUTRO) >= 0); });
  }
  function semIdent(p) { return p.caixa.every(function (m) { return m.t !== 'ident'; }); }

  function modoAntigo() {
    var no_ar = { protocol: 'https:', hostname: 'soterra.viidoo.io', host: 'soterra.viidoo.io' };
    check('no ar, o token não vai a um ?rede= de outro servidor', R._identPermitido('wss://outro.exemplo/ws', no_ar) === false);
    check('...nem a um endereço que só COMEÇA com o do jogo',
          R._identPermitido('wss://soterra.viidoo.io.outro.exemplo/ws', no_ar) === false);
    check('no ar, vai ao relé da própria origem', R._identPermitido('wss://soterra.viidoo.io/ws', no_ar) === true);
    check('em casa (localhost, file://) vai ao ?rede= das provas',
          R._identPermitido('ws://127.0.0.1:8791', { protocol: 'http:', hostname: 'localhost', host: 'localhost:8200' }) === true &&
          R._identPermitido('ws://127.0.0.1:8791', { protocol: 'file:', hostname: '', host: '' }) === true);
    var vilao = parCru('vilao'), bento = parCru('bento'), carla = parCru('carla'), dora = parCru('dora');
    return Promise.all([aberto(vilao), aberto(bento), aberto(carla), aberto(dora)]).then(function () {
      check('entrar liga pelo relé (o antigo)', R.entrar({ id: 'ana', nome: 'Ana', classe: 'bruxo', x: 3, z: 7 }) === true);
      // os anúncios forjados chegam de cara (é o que um par manda por um relé que repassa tudo)
      return espera(function () { return false; }, 600);
    }).then(function () {
      check('com o anúncio forjado (sem a marca desta conexão) a fila não sai: nada da Ana ainda',
            vilao.dele('oi', 'ana').length === 0 && vilao.caixa.every(function (m) { return m.de !== 'ana'; }));
      return pausaVirtual(R.ANUNCIO_MS + 500);
    }).then(function () {
      return espera(function () { return vilao.dele('oi', 'ana').length > 0; }, 8000);
    }).then(function (ok) {
      check('passado o prazo sem anúncio de verdade, o jogo segue: o oi chega pelo relé antigo', ok);
      check('o anúncio forjado e o ident-ok forjado não valem: nenhuma identidade', R.identidade() === null,
            JSON.stringify(R.identidade()));
      check('nenhum par ouviu o token (o relé antigo repassa tudo — e ele nunca o recebeu)',
            !vazou(vilao) && !vazou(bento) && !vazou(carla));
      check('...nem um envelope ident', semIdent(vilao) && semIdent(bento) && semIdent(carla));
      bento.manda({ t: 'oi', nome: 'GM Bento', mestre: true, titulo: 'Administrador', classe: 'sumo',
                    resumo: { total: 3, guilda: { nome: 'Os Admins', emblema: 'E' } }, x: 1, z: 1, sala: null, v: 2, nuvem: 5 });
      carla.manda({ t: 'oi', nome: 'Carla', titulo: 'o Fundido', classe: 'sumo', x: 2, z: 2, sala: null, v: 2 });
      dora.manda({ t: 'oi', nome: 'Dora', classe: 'fus:gm+sumo', x: 4, z: 4, sala: null, v: 2,
                   resumo: { total: 32, classes: { gm: 30, sumo: 2 }, guilda: { nome: 'Tropa', emblema: 'STAFF' } } });
      return espera(function () { return !!par('bento') && !!par('carla') && !!par('dora'); }, 8000);
    }).then(function () {
      var b = par('bento') || {}, c = par('carla') || {};
      check('pelo relé antigo o nome reservado chega cru e a Rede troca na chegada: Aventureiro-ento',
            b.nome === 'Aventureiro-ento', JSON.stringify(b));
      check('o mestre:true que o próprio par pôs não vale (relé que não se anunciou)', b.mestre === false);
      check('título reservado some e a guilda reservada vira "Guilda" (o emblema fica)',
            b.titulo === '' && !!b.resumo && b.resumo.guilda.nome === 'Guilda' && b.resumo.guilda.emblema === 'E');
      check('o evento de entrada já traz o nome trocado', eventos.some(function (e) {
        return e.tipo === 'entrou' && e.id === 'bento' && e.nome === 'Aventureiro-ento' && e.mestre === false; }));
      check('nome comum passa como veio', c.nome === 'Carla' && c.titulo === 'o Fundido', JSON.stringify(c));
      var d = par('dora') || {};
      check('o corpo do Mestre (a fusão com a classe "gm") de quem não é o Mestre vira "sumo" na chegada',
            d.classe === 'sumo' && d.nome === 'Dora', JSON.stringify(d));
      check('...a ficha "gm" sai do placar e o emblema "STAFF" vira "⚑" (o nome limpo da guilda fica)',
            !!d.resumo && !('gm' in d.resumo.classes) && d.resumo.classes.sumo === 2 &&
            d.resumo.guilda.nome === 'Tropa' && d.resumo.guilda.emblema === '⚑', JSON.stringify(d));
      bento.manda({ t: 'chat', nome: 'Staff', texto: 'sou da equipe' });
      bento.manda({ t: 'guilda', para: 'ana', acao: 'convite', dados: { gid: 'g1', nome: 'Suporte', emblema: 'E' } });
      carla.manda({ t: 'chat', nome: ['G', 'M'], texto: 'oi' });
      dora.manda({ t: 'guilda', para: 'ana', acao: 'convite', dados: { gid: 'g2', nome: 'Tropa', emblema: 'GM' } });
      return espera(function () {
        return eventos.filter(function (e) { return e.tipo === 'chat'; }).length >= 2 &&
               eventos.filter(function (e) { return e.tipo === 'guilda'; }).length >= 2;
      }, 8000);
    }).then(function () {
      var chats = eventos.filter(function (e) { return e.tipo === 'chat'; });
      var cb = chats.filter(function (e) { return e.id === 'bento'; })[0] || {};
      var cc = chats.filter(function (e) { return e.id === 'carla'; })[0] || {};
      check('no chat, o nome reservado também é trocado (o texto fica)',
            cb.nome === 'Aventureiro-ento' && cb.texto === 'sou da equipe', JSON.stringify(cb));
      check('nome que não é texto (["G","M"] viraria "G,M" na tela) sai trocado', cc.nome === 'Aventureiro-arla',
            JSON.stringify(cc));
      var g = eventos.filter(function (e) { return e.tipo === 'guilda' && e.de === 'bento'; })[0] || {};
      check('o convite de guilda com nome reservado chega como "Guilda"',
            !!g.dados && g.dados.nome === 'Guilda' && g.dados.gid === 'g1', JSON.stringify(g));
      var g2 = eventos.filter(function (e) { return e.tipo === 'guilda' && e.de === 'dora'; })[0] || {};
      check('o convite de guilda com emblema reservado ("GM") chega com "⚑" (o nome limpo fica)',
            !!g2.dados && g2.dados.emblema === '⚑' && g2.dados.nome === 'Tropa', JSON.stringify(g2));
      R.sair();
    });
  }

  function modoNovo() {
    var caio = parCru('caio', 'marcacaio01'), joana = parCru('joana', 'marcajoana1'), bento = parCru('bento');
    return Promise.all([aberto(caio), aberto(joana), aberto(bento)]).then(function () {
      return espera(function () { return caio.voz('rele').length > 0 && bento.voz('rele').length > 0; }, 8000);
    }).then(function () {
      var a = caio.voz('rele')[0] || {};
      check('o relé novo se anuncia a quem conecta, com a marca do endereço', a.ident === true && a.n === 'marcacaio01',
            JSON.stringify(caio.voz('rele')));
      caio.manda({ t: 'pulso', x: 0, z: 0, sala: null });
      bento.manda({ t: 'pulso', x: 0, z: 0, sala: null });
      joana.manda({ t: 'ident', token: OUTRO });
      return espera(function () { return joana.voz('ident-ok').length > 0; }, 8000);
    }).then(function () {
      check('uma conta comum que se identifica ouve ident-ok com mestre falso',
            (joana.voz('ident-ok')[0] || {}).mestre === false, JSON.stringify(joana.voz('ident-ok')));
      check('R.entrar liga pelo relé novo',
            R.entrar({ id: 'ana', nome: 'GM Ana', titulo: 'Mestre do Fundo', classe: 'bruxo', x: 3, z: 7 }) === true);
      return espera(function () {
        return R.identidade() !== null && caio.dele('oi', 'ana').some(function (m) { return m.mestre === true; });
      }, 8000);
    }).then(function () {
      var ois = caio.dele('oi', 'ana');
      check('com a sessão do Mestre, a Rede se identifica depois do anúncio: ident-ok com mestre',
            !!R.identidade() && R.identidade().mestre === true, JSON.stringify(R.identidade()));
      check('o oi do Mestre chega aos outros com o nome dele, mestre:true e o nuvem da conta dele',
            ois.some(function (m) { return m.nome === 'GM Ana' && m.mestre === true && m.nuvem === CONTA; }),
            JSON.stringify(ois).slice(0, 300));
      check('e já o PRIMEIRO oi saiu carimbado: o ident foi na frente da fila',
            ois.length > 0 && ois[0].mestre === true && ois[0].nome === 'GM Ana', JSON.stringify(ois[0]));
      check('o token não passou por ninguém (nem o do Mestre, nem o da Joana)',
            !vazou(caio) && !vazou(bento) && !vazou(joana));
      check('nenhum par ouviu um envelope ident', semIdent(caio) && semIdent(bento) && semIdent(joana));
      joana.manda({ t: 'oi', nome: 'Administrador', mestre: true, classe: 'sumo', x: 4, z: 4, sala: null, v: 2, nuvem: 1 });
      bento.manda({ t: 'oi', nome: 'GM Bento', mestre: true, classe: 'sumo',
                    resumo: { guilda: { nome: 'Staff', emblema: 'E' } }, x: 5, z: 5, sala: null, v: 2 });
      return espera(function () { return !!par('joana') && !!par('bento') && caio.dele('oi', 'bento').length > 0; }, 8000);
    }).then(function () {
      var j = par('joana') || {}, b = par('bento') || {}, viu = caio.dele('oi', 'bento')[0] || {};
      check('conta comum conferida com nome reservado: chega trocada, sem mestre, com o nuvem DELA (não o 1 que ela disse)',
            j.nome === 'Aventureiro-oana' && j.mestre === false && j.nuvem === OUTRO_ID, JSON.stringify(j));
      check('sem ident: nome reservado trocado, mestre dele ignorado, guilda "Guilda", sem nuvem',
            b.nome === 'Aventureiro-ento' && b.mestre === false && !!b.resumo && b.resumo.guilda.nome === 'Guilda' && !b.nuvem,
            JSON.stringify(b));
      check('o relé já trocou antes de chegar (o texto que o Caio ouviu)',
            viu.nome === 'Aventureiro-ento' && !('mestre' in viu) && viu.resumo.guilda.nome === 'Guilda', JSON.stringify(viu));
      R.sair();
    });
  }

  /* NO AR, UM ?rede= DE FORA (revisão de 10/09): a página em soterra.viidoo.io
   * (o _identPermitido vê a origem do jogo) e um link com ?rede= para um relé
   * de fora, que se anuncia com a marca (ela está no endereço dele), diz
   * "ident-ok, mestre" sem pergunta e repassa um par que se diz Mestre */
  function modoEstrangeiro() {
    var permitido = R._identPermitido;
    R._identPermitido = function (u) {
      return permitido(u, { protocol: 'https:', hostname: 'soterra.viidoo.io', host: 'soterra.viidoo.io' });
    };
    var vil = parCru('vilao', 'marcavilao01');
    return aberto(vil).then(function () {
      check('entrar liga pelo relé de fora', R.entrar({ id: 'ana', nome: 'Ana', classe: 'bruxo', x: 3, z: 7 }) === true);
      return espera(function () { return vil.dele('oi', 'ana').length > 0; }, 8000);
    }).then(function (ok) {
      check('o relé de fora se anunciou com a marca: a fila saiu (o oi da Ana chegou a ele)', ok);
      check('o "ident-ok, mestre" que ninguém pediu não vale: nenhuma identidade', R.identidade() === null,
            JSON.stringify(R.identidade()));
      check('e o token não foi a ele (nem um envelope ident)', !vazou(vil) && semIdent(vil));
      vil.manda({ t: 'oi', nome: 'Administrator', titulo: 'Mestre do Fundo', mestre: true, classe: 'gm', x: 1, z: 1,
                  sala: null, v: 2, resumo: { classes: { gm: 30 }, guilda: { nome: 'Staff', emblema: 'GM' } } });
      vil.manda({ t: 'chat', nome: 'GM Suporte', mestre: true, texto: 'me passa a senha' });
      return espera(function () {
        return !!par('vilao') && eventos.some(function (e) { return e.tipo === 'chat' && e.id === 'vilao'; });
      }, 8000);
    }).then(function () {
      var v = par('vilao') || {};
      check('no ar, o mestre:true de um relé de ?rede= de fora NÃO vale: sem selo, nome e título trocados',
            v.mestre === false && v.nome === 'Aventureiro-ilao' && v.titulo === '', JSON.stringify(v));
      check('...o corpo do Mestre vira "sumo", a ficha "gm" sai, e a placa "GM Staff" vira "⚑ Guilda"',
            v.classe === 'sumo' && !!v.resumo && !('gm' in (v.resumo.classes || {})) &&
            v.resumo.guilda.nome === 'Guilda' && v.resumo.guilda.emblema === '⚑', JSON.stringify(v));
      var c = eventos.filter(function (e) { return e.tipo === 'chat' && e.id === 'vilao'; })[0] || {};
      check('...e o chat dele sai com o nome trocado', c.nome === 'Aventureiro-ilao', JSON.stringify(c));
      R.sair();
    });
  }

  /* O RELÉ QUE MUDA DE IDEIA (revisão de 10/09): responde ident-nao (o banco
   * não respondeu a tempo) e, depois, ident-ok — como a conferência de novo do
   * relé de verdade. A Rede tem de se APRESENTAR de novo: o oi novo sai com o
   * carimbo novo (o nuvem, o mestre) */
  function modoTarde() {
    var ouve = parCru('ouvinte', 'marcaouvinte1');
    return aberto(ouve).then(function () {
      check('entrar liga (em casa, com sessão: o ident sai)',
            R.entrar({ id: 'ana', nome: 'Ana', classe: 'bruxo', x: 3, z: 7 }) === true);
      return espera(function () { return R.identidade() === false; }, 8000);
    }).then(function (ok) {
      check('primeiro o relé diz ident-nao', ok, JSON.stringify(R.identidade()));
      var n0 = ouve.dele('oi', 'ana').length;
      return espera(function () { return !!R.identidade() && ouve.dele('oi', 'ana').length > n0; }, 8000)
        .then(function (ok2) {
          check('depois ele confere (ident-ok) e a Rede se apresenta de novo: sai um oi novo, com o carimbo novo',
                ok2 && n0 >= 1 && R.identidade().mestre === false,
                JSON.stringify(R.identidade()) + ' · ois: ' + n0 + ' → ' + ouve.dele('oi', 'ana').length);
          R.sair();
        });
    });
  }

  var modos = { antigo: modoAntigo, novo: modoNovo, estrangeiro: modoEstrangeiro, tarde: modoTarde };
  var corrente = (modos[modo] || modoNovo)();
  corrente.catch(function (e) { check('a corrente não estoura', false, e && (e.message || e)); }).then(fim);
})();
</script>
</body>
</html>
"""


def limita_nucleos():
    """O dono usa a máquina: este processo (e o Chrome, que herda a afinidade)
    fica em no máximo um quarto dos núcleos lógicos, com piso de 2."""
    try:
        import ctypes
        n = os.cpu_count() or 2
        k = max(2, n // 4)
        mascara = 0
        for i in range(max(0, n - k), n):
            mascara |= 1 << i
        k32 = ctypes.windll.kernel32
        k32.SetProcessAffinityMask(k32.GetCurrentProcess(), ctypes.c_size_t(mascara))
    except Exception:
        pass


def roda_chrome(url, saida, baixa=None, budget=120000):
    """Um Chrome headless por vez, em prioridade baixa e perfil descartável. Com
    `baixa` (--chrome-baixa CAMINHO, ou SOTERRA_CHROME_BAIXA), quem abre o
    Chrome é esse lançador; sem ele, o daqui faz o mesmo. None = sem Chrome."""
    if baixa:
        subprocess.run([sys.executable, baixa, url, saida, str(budget)], capture_output=True, timeout=900,
                       creationflags=BAIXA)
    else:
        chrome = next((c for c in CHROMES if os.path.exists(c)), None)
        if not chrome:
            return None
        limita_nucleos()
        perfil = tempfile.mkdtemp(prefix='rele-nomes-chrome-')
        try:
            with open(saida, 'wb') as f:
                subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                                '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget,
                                '--allow-file-access-from-files', '--dump-dom', url],
                               stdout=f, stderr=subprocess.DEVNULL, timeout=900, creationflags=BAIXA)
        finally:
            shutil.rmtree(perfil, ignore_errors=True)
    try:
        return open(saida, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def le_pagina(R, dom):
    """As linhas PASSOU/FALHOU da página viram checks daqui."""
    m = re.search(r'id="summary"[^>]*>([^<]*)<', dom or '')
    resumo = html.unescape(m.group(1)) if m else '(sem página)'
    linhas = [html.unescape(l) for l in re.findall(r'<div>((?:PASSOU|FALHOU) · [^<]*)</div>', dom or '')]
    for l in linhas:
        ok = l.startswith('PASSOU')
        corpo = l.split(' · ', 1)[1]
        nome, _, extra = corpo.partition(' — ')
        check(R + nome, ok, extra)
    check(R + 'a página chegou ao fim (%s)' % resumo, bool(linhas) and not resumo.startswith('rodando'))


def prova_no_navegador(argumentos):
    R = 'navegador: '
    baixa = os.environ.get('SOTERRA_CHROME_BAIXA')
    if '--chrome-baixa' in argumentos:
        i = argumentos.index('--chrome-baixa')
        baixa = argumentos[i + 1] if i + 1 < len(argumentos) else None
    if not baixa and not any(os.path.exists(c) for c in CHROMES):
        check(R + 'há um Chrome para a prova do rede.js (ou rode com --sem-navegador)', False)
        return
    pasta = tempfile.mkdtemp(prefix='rele-nomes-nav-')
    a = rl = antigo = relogio = fora = tarde = None
    try:
        a, banco, contas = cria_banco(pasta)
        rl = Rele(['--banco', banco])
        antigo = ReleAntigo()
        relogio = ThreadingHTTPServer(('127.0.0.1', 0), Dorme)
        threading.Thread(target=relogio.serve_forever, daemon=True).start()
        if not (rl.ok and antigo.inicia()):
            check(R + 'o relé novo e o antigo de mentira subiram', False)
            return
        pagina = os.path.join(pasta, 'identidade.html')
        with open(pagina, 'w', encoding='utf-8') as f:
            f.write(PAGINA.replace('__NOMES__', pathlib.Path(RAIZ, 'js', 'core', 'nomes.js').as_uri())
                          .replace('__REDE__', pathlib.Path(RAIZ, 'js', 'core', 'rede.js').as_uri()))
        base = pathlib.Path(pagina).as_uri()
        dorme = 'http://127.0.0.1:%d' % relogio.server_address[1]
        joana_id, joana = contas['joana']
        dono_id, dono = contas['dono']

        # ---------- A: o relé antigo (repasse cego) com anúncios forjados
        # ':' e '/' sem escapar: o urlDoRele do rede.js procura 'rede=ws://' ao pé da letra
        q = urlencode({'modo': 'antigo', 'rede': 'ws://127.0.0.1:%d' % antigo.porta, 'dorme': dorme,
                       'token': joana, 'conta': joana_id}, safe=':/')
        dom = roda_chrome(base + '?' + q, os.path.join(pasta, 'antigo.dom.html'), baixa)
        le_pagina(R + 'relé antigo: ', dom)
        eventos = list(antigo.eventos)
        recebidas = [t for tipo, n, t in eventos if tipo == 'recebe']
        check(R + 'relé antigo: ele NUNCA recebeu o token, de ninguém (%d mensagens)' % len(recebidas),
              recebidas and not any(joana in t for t in recebidas))
        idents = []
        for t in recebidas:
            try:
                if json.loads(t).get('t') == 'ident':
                    idents.append(t)
            except Exception:
                pass
        check(R + 'relé antigo: nem um envelope ident', not idents, repr(idents[:1]))
        da_ana = None
        for tipo, n, t in eventos:
            if tipo == 'recebe' and '"de":"ana"' in t:
                da_ana = n
                break
        antes = []
        for tipo, n, t in eventos:
            if n != da_ana:
                continue
            if tipo == 'recebe':
                break
            antes.append(t)
        check(R + 'relé antigo: a conexão do jogo ouviu os anúncios forjados ANTES de mandar qualquer coisa — e não mandou ident',
              da_ana is not None and all(f in antes for f in ReleAntigo.FORJADOS), '%d entregas antes' % len(antes))
        check(R + 'relé antigo: o jogo pôs a marca dele no endereço (?n=), que o anúncio forjado não tinha',
              da_ana is not None and re.search(r'[?&]n=[0-9a-z]{16,20}(&|$)', antigo.caminhos.get(da_ana) or '') is not None
              and 'chutechute12' not in (antigo.caminhos.get(da_ana) or ''), repr(antigo.caminhos.get(da_ana)))

        # ---------- B: o relé novo, com o Mestre na sessão da página
        q = urlencode({'modo': 'novo', 'rede': rl.url, 'dorme': dorme, 'token': dono, 'conta': dono_id,
                       'outro': joana, 'outroid': joana_id}, safe=':/')
        dom = roda_chrome(base + '?' + q, os.path.join(pasta, 'novo.dom.html'), baixa)
        le_pagina(R + 'relé novo: ', dom)

        # ---------- C: no ar, um ?rede= de fora que se anuncia com a marca
        fora = ReleDeFora('estrangeiro')
        if not fora.inicia():
            check(R + 'o relé de fora de mentira subiu', False)
            return
        q = urlencode({'modo': 'estrangeiro', 'rede': 'ws://127.0.0.1:%d' % fora.porta, 'dorme': dorme,
                       'token': joana, 'conta': joana_id}, safe=':/')
        dom = roda_chrome(base + '?' + q, os.path.join(pasta, 'fora.dom.html'), baixa)
        le_pagina(R + 'relé de fora: ', dom)
        recebidas = [t for tipo, n, t in fora.eventos if tipo == 'recebe']
        idents = []
        for t in recebidas:
            try:
                if json.loads(t).get('t') == 'ident':
                    idents.append(t)
            except Exception:
                pass
        check(R + 'relé de fora: ele NUNCA recebeu o token nem um ident (%d mensagens)' % len(recebidas),
              recebidas and not idents and not any(joana in t for t in recebidas))

        # ---------- D: o relé que muda de ideia (ident-nao, depois ident-ok)
        tarde = ReleDeFora('tarde')
        if not tarde.inicia():
            check(R + 'o relé que muda de ideia subiu', False)
            return
        q = urlencode({'modo': 'tarde', 'rede': 'ws://127.0.0.1:%d' % tarde.porta, 'dorme': dorme,
                       'token': joana, 'conta': joana_id}, safe=':/')
        dom = roda_chrome(base + '?' + q, os.path.join(pasta, 'tarde.dom.html'), baixa)
        le_pagina(R + 'relé que muda de ideia: ', dom)
    finally:
        texto_log = rl.fecha() if rl is not None else ''
        for mock in (antigo, fora, tarde):
            if mock is not None:
                mock.para()
        if relogio is not None:
            relogio.shutdown()
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)
    check(R + 'relé novo: o log dele não tem o token do Mestre nem o da Joana',
          texto_log and contas['dono'][1] not in texto_log and contas['joana'][1] not in texto_log)
    check(R + 'relé novo: e registra as duas identidades conferidas (só o número da conta)',
          ('conta #%d (Mestre)' % contas['dono'][0]) in texto_log and ('conta #%d' % contas['joana'][0]) in texto_log)


# ================================================================ 4. o deploy (estático)
def prova_do_deploy():
    """O relé no ar lê o MESMO banco que a API, como o mesmo usuário; e nenhuma
    linha de log do relé fala do token."""
    R = 'deploy: '

    def ler(rel):
        with open(os.path.join(RAIZ, rel), encoding='utf-8') as f:
            return f.read()

    entrada = ler('servidor/coolify/entrada.sh')
    api_linha = next((l for l in entrada.splitlines() if l.startswith('vigia api')), '')
    rele_linha = next((l for l in entrada.splitlines() if l.startswith('vigia rele')), '')
    banco_api = re.search(r'--banco (\S+)', api_linha)
    check(R + 'Coolify: a entrada passa ao relé o --banco da API ("$DADOS/soterra.db")',
          banco_api is not None and ('--banco ' + banco_api.group(1)) in rele_linha
          and banco_api.group(1) == '"$DADOS/soterra.db"', rele_linha)
    svc_rele, svc_api = ler('servidor/soterra-rele.service'), ler('servidor/soterra-api.service')
    b_rele = re.search(r'^ExecStart=.*rele\.py.*--banco (\S+)', svc_rele, re.M)
    b_api = re.search(r'^ExecStart=.*api\.py.*--banco (\S+)', svc_api, re.M)
    u_rele = re.search(r'^User=(\S+)', svc_rele, re.M)
    u_api = re.search(r'^User=(\S+)', svc_api, re.M)
    check(R + 'VPS limpo: o serviço do relé lê o mesmo banco que o da API, como o mesmo usuário (o -shm do WAL)',
          b_rele and b_api and b_rele.group(1) == b_api.group(1) and u_rele and u_api
          and u_rele.group(1) == u_api.group(1) == 'soterra',
          '%s %s' % (b_rele and b_rele.group(1), u_rele and u_rele.group(1)))
    fonte = ler('servidor/rele.py')
    ruins = logs_com_token(fonte)
    check(R + 'nenhuma linha de log do rele.py fala do token', not ruins, repr(ruins[:2]))
    check(R + 'o rele.py importa o rele_ident (a identidade mora ao lado dele)',
          re.search(r'^import rele_ident\b', fonte, re.M) is not None)


if __name__ == '__main__':
    argumentos = sys.argv[1:]
    if '--so-navegador' in argumentos:                 # só a parte 3 (para repetir a do rede.js)
        prova_no_navegador(argumentos)
        argumentos.append('--so-modulo')
    else:
        prova_do_modulo()
        prova_do_orcamento()
        prova_do_deploy()
    if '--so-modulo' not in argumentos:
        prova_ao_vivo()
        prova_da_revogacao()
        if '--sem-navegador' in argumentos:
            print('PULOU · navegador: --sem-navegador (o js/core/rede.js NÃO foi provado nesta rodada)')
        else:
            prova_no_navegador(argumentos)
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
