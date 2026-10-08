#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A identidade na praça: o que o Relé (rele.py) sabe de quem está do outro lado do fio.

PEDIDO DO DONO (literal): "ninguem conseguir colocar o nome com GM Gm Admin
Administrador etc.." — o cadastro e o batismo recusam o nome da equipe, mas o
nome da PRAÇA é do cliente: viaja dentro do envelope da Rede (js/core/rede.js)
e um cliente mexido manda o que quiser. O relé é a porta do servidor por onde
esses nomes passam, e este módulo é o que ele usa para decidir. A regra dos
nomes é UMA só, servidor/nomes.py (reservado); aqui só se decide QUEM pode
vestir um nome reservado — o Mestre do Fundo de verdade, conferido no banco —
e o que os outros vestem no lugar.

O APERTO DE MÃO (a segurança do token)
  1. O cliente novo põe uma MARCA sorteada no endereço da conexão
     (wss://.../ws?n=<marca>, 8 a 40 letras minúsculas e dígitos). Só o
     servidor a vê — ela vai no pedido de abertura, que nenhum par enxerga.
  2. O relé que sabe conferir se ANUNCIA ao aceitar a conexão, devolvendo a
     marca:  {t:'rele', v:1, ident:true, n:<marca>, cx:<conexão>}   (ident:false
     sem --banco; sem marca no endereço, sem `n`; o `cx`, desde 11/09, é o id
     que o relé sorteou para ESTA conexão e carimba nos dirigidos dela). É uma
     mensagem sem `de`: o cliente de antes de 10/09 a ignora.
  3. Só DEPOIS desse anúncio, com ident:true E a marca certa, o cliente manda
         {t:'ident', de, token}
     (o token da sessão do cartório, o mesmo do Authorization da API). O relé
     antigo — o que repassa tudo a todos, como o que está no ar antes do deploy
     e o do rolling update — nunca se anuncia, então nunca recebe token. E um
     par mal-intencionado que forje o anúncio por esse relé antigo não sabe a
     marca: o anúncio dele não vale (sem a marca, um anúncio forjado bastava
     para colher o token de quem entrasse naquela janela).
  4. O relé NUNCA repassa o ident, nunca escreve o token no log e responde só
     a quem mandou: {t:'ident-ok', mestre:bool} ou {t:'ident-nao'}. Se a
     resposta mudar depois (ver A CONFERÊNCIA), ele manda a nova, também só a
     quem se identificou.

A CONFERÊNCIA (confere / Verificador): SQLite só-leitura (URI file:...?mode=ro
— nunca cria nem escreve o banco, e NÃO mexe no ultimo_uso da sessão), numa
thread fora do laço de eventos, com a mesma leitura da API:
    SELECT c.id, c.nome, c.gm, c.banido, s.ultimo_uso FROM sessoes s
      JOIN contas c ON c.id = s.conta_id WHERE s.token = ?
Vale se ultimo_uso >= agora - SESSAO_DIAS dias (a régua de comum.py, a mesma
com que a API apaga a sessão vencida) e banido = 0. A resposta fica guardada
por até 60 s por token — a chave do cache é o sha256 do token, não o token.
A conexão que já se identificou é conferida DE NOVO a cada CACHE_S (rele.py,
_revista; o token fica só na memória da conexão, nunca no log): sair,
"encerrar sessões", trocar a senha, banir e tirar o Mestre valem também para
quem já está na praça, em até ~2 minutos (o cache mais o prazo) — antes a
conexão identificada seguia Mestre até cair. Banco ausente, trancado ou
estranho = não verificado, sem ir para o cache e sem derrubar nada: a conexão
tenta de novo a cada REVISTA_FALHA_S, até REVISTA_TENTATIVAS vezes seguidas
(quem já era conferido segue conferido nesse meio-tempo; depois, fecha por
padrão). Muitos idents de uma vez — o religar de todo mundo 4 s depois de um
deploy — esperam a vez (EM_VOO_MAX ao mesmo tempo, até ESPERA_VEZ s) em vez de
ouvir "não conferido" na hora (a revisão mediu 68 de 100 sessões VÁLIDAS
recusadas assim, e o cliente não pergunta de novo).

O CARIMBO (carimba), no envelope que sai do relé:
  - qualquer `mestre` que veio do cliente cai, em todo tipo de envelope;
  - conexão do Mestre conferido: oi, eco, chat, sussurro e gchat (o chat da
    guilda, 13/09) saem com mestre:true e (04/10) com o nome "GM" — o
    NOME_DO_MESTRE, seja qual for o nome que o cliente mandou —, mais o título e
    o corpo que ele escolheu (a classe 'gm');
  - dos outros: nome reservado (oi, eco, chat, sussurro, gchat) vira 'Aventureiro-xxxx' (as
    quatro últimas letras/dígitos do id da conexão, em minúsculas — e, se por
    azar isso também cair na regra, como 'xxgm', só 'Aventureiro');
    título reservado vira ''; guilda reservada (resumo.guilda no oi/eco e os
    dados do convite de guilda) vira 'Guilda' — e o EMBLEMA reservado vira '⚑'
    (a placa é emblema + nome: 'GM', 'STAFF' e a bandeira que se lê G M também
    vestem a equipe); o CORPO do Mestre (a classe 'gm', o Cavaleiro Negro, e
    a fusão com ela) vira 'sumo', e a ficha 'gm' sai do resumo do placar;
  - `nuvem` (a conta no cartório, que a troca espelhada usa) vira o id
    CONFERIDO, ou some: ninguém se passa por outra conta.
Sem --banco (em casa, nas provas antigas) ninguém é conferido: o nome
reservado sempre é trocado e o nuvem sempre some; o resto segue igual.

FECHA POR PADRÃO: nome, título, guilda ou emblema que não são texto, ou com
mais de TEXTO_MAX caracteres, contam como reservados sem nem passar pela regra
— nenhum nome legítimo passa de 24 (o batismo antigo cortava em 24, o novo em
20; a guilda corta em 24; o maior título tem 23), e a regra custa: 8 mil
caracteres levavam 2,6 s, e 24 escolhidos a dedo ainda levam ~60 ms.

O TEMPO DA REGRA (10/09: a revisão mediu 15 conexões com nomes caros
segurando a praça inteira por 1,4 s — o relé não julgava texto nenhum antes):
a regra roda no laço do relé, então ela tem um ORÇAMENTO que soma TODAS as
conexões (Orcamento: ORC_TAXA_MS de regra por segundo, ORC_RAJADA_MS de uma
vez) e um JUIZ (Juiz) que julga os textos novos numa fila só, na ordem de
chegada — os de conta conferida primeiro — e no ritmo do orçamento. O envelope
com texto novo espera o veredicto (até PRAZO_REGRA_S) sem travar ninguém: no
religar depois de um deploy os nomes chegam uns segundos depois, mas chegam
certos. Fila cheia, prazo vencido ou freio da conexão vazio = fecha por
padrão, sem guardar: o próximo envelope tenta de novo. Os veredictos ficam
num cache (sai primeiro o que ninguém usa há mais tempo), e o texto que não
está nele gasta uma ficha do freio da conexão (6 de uma vez, 1 a cada 5 s): o
cliente de verdade manda sempre os mesmos 2 ou 3 textos, e quem inventa um
nome por envelope passa a sair 'Aventureiro' sem custo.

Só biblioteca padrão, mais servidor/nomes.py e servidor/comum.py (ao lado).
"""
import asyncio
import collections
import hashlib
import itertools
import json
import logging
import os
import pathlib
import re
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit

import moderacao                 # 02/10: o banimento com prazo (a linha vencida não é mais banimento)
import nomes
from comum import NOME_DO_MESTRE, SESSAO_DIAS

log = logging.getLogger("rele.ident")

ANUNCIO_V = 1                 # a versão do relé que se anuncia (o `v` do {t:'rele'})
IDENT_MAX = 4                 # idents por conexão (o 5º em diante é descartado)
CACHE_S = 60.0                # quanto a resposta do banco vale, por token — e o prazo da conferência de novo
CACHE_MAX = 4096              # tokens guardados; cheio, saem os vencidos (e, se ainda cheio, todos)
ESPERA_BANCO = 1.0            # s que o SQLite espera um banco trancado
PRAZO_CONFERENCIA = 3.0       # s até desistir da thread (a conexão segue, não verificada)
EM_VOO_MAX = 32               # conferências ao mesmo tempo; as outras esperam a vez...
ESPERA_VEZ = 10.0             # ...até tanto (s): depois, "não verificado" — e a conexão tenta de novo
REVISTA_FALHA_S = 10.0        # o banco não respondeu: a conexão confere de novo daqui a tanto...
REVISTA_TENTATIVAS = 6        # ...tantas vezes seguidas; depois fica sem conta (fecha por padrão)
RE_TOKEN = re.compile(r'[\x21-\x7e]{16,128}')   # o do cartório tem 64 hex; aqui, ASCII visível de 16 a 128
RE_MARCA = re.compile(r'[0-9a-z]{8,40}')         # a marca que o cliente sorteia e põe no endereço (?n=)
RE_CX = re.compile(r'[0-9a-f]{8,16}')            # o id da conexão (rele.py, Par.cx: 8 hex), que o anúncio conta a ela

TEXTO_MAX = 64                # nome/título/guilda/emblema maior que isto nem passa pela regra: é trocado
VEREDITOS_MAX = 8192          # textos já julgados (cheio, sai a metade que ninguém usa há mais tempo)
FREIO_TAXA, FREIO_RAJADA = 0.2, 6.0   # textos NOVOS julgados por conexão: 6 de uma vez, 1 a cada 5 s
ORC_TAXA_MS, ORC_RAJADA_MS = 200.0, 500.0   # ms de regra por segundo somando TODAS as conexões (20% do laço), e de uma vez
FILA_MAX = 512                # textos esperando o juiz; cheia, o texto novo fecha por padrão
PRAZO_REGRA_S = 15.0          # quanto um envelope espera o veredicto de um texto novo

NOME_TROCA = 'Aventureiro'
GUILDA_TROCA = 'Guilda'
EMBLEMA_TROCA = '⚑'           # o emblema de sempre da guilda (o primeiro da ficha da HUD)
CLASSE_MESTRE = 'gm'          # o corpo do Mestre do Fundo, o Cavaleiro Negro (js/core/gm.js)
CLASSE_TROCA = 'sumo'         # o que veste quem não é o Mestre (o mesmo padrão do rede.js)
COM_NOME = ('oi', 'eco', 'chat', 'sussurro', 'gchat')   # os envelopes que levam o nome de quem manda (o sussurro: 11/09; o chat da guilda: 13/09)
COM_PERFIL = ('oi', 'eco')            # os que levam título, classe, resumo (guilda) e nuvem
# 03/10 (revisão): com o banco ligado, a fala da conexão SEM conta conferida sai
# com o nome de troca ('Aventureiro-xxxx'), nunca com o nome que o cliente
# escolheu — senão a conta banida ou silenciada voltava a falar com o próprio
# nome (ou com o de outro jogador) abrindo uma conexão sem ident
FALAS_ANONIMAS = ('chat', 'sussurro')
JULGADOS = ('oi', 'eco', 'chat', 'guilda', 'sussurro', 'gchat')   # os que levam texto para a regra (o relé só chama o prepara neles)

SQL = ("SELECT c.id, c.nome, c.gm, c.banido, s.ultimo_uso FROM sessoes s "
       "JOIN contas c ON c.id = s.conta_id WHERE s.token = ?")
# 04/10: A AURA DA PRAÇA (servidor/loja.py). É coisa comprada: quem diz qual aura a conta veste é o banco
# (`aura_escolhida`, que a API só grava para a aura que a conta TEM), nunca o cliente. Consulta À PARTE da
# de cima, e com erro engolido: no rolling update o relé novo pode abrir um banco que ainda não tem a
# tabela, e isso não pode virar "banco estranho" e deixar a praça inteira sem conferência
SQL_AURA = "SELECT aura FROM aura_escolhida WHERE conta_id = ?"
AURAS = ('fogo', 'agua', 'terra', 'ar', 'neutra', 'sombra', 'gelo', 'ouro')    # o gêmeo de loja.AURAS (tests/loja_api.py confere)
# 08/10: a MOLDURA premium da plaquinha — a escolhida mora em `moldura_escolhida` (a API só grava a que a conta tem)
SQL_MOLDURA = "SELECT moldura FROM moldura_escolhida WHERE conta_id = ?"
MOLDURAS = ('ouro', 'rubi', 'esmeralda', 'obsidiana')   # o gêmeo de loja.MOLDURAS_LOJA
# 08/10: OS TÍTULOS DE PÓDIO ACOMPANHAM A POSIÇÃO (o dono: "se ele é top 1 pvp e perde o posto, não terá mais
# esse título; passa para o top 1 atual"). O relé lê o pódio da conta no banco (as mesmas consultas de
# servidor/salas.py _posicoes/_posicoes_classe) e carimba o título de ranking com a posição de AGORA — ou
# tira, quando a conta saiu do pódio. Os títulos de chefe e do Eco são para sempre e passam como vieram.
SQL_PODIO_PVM = ("SELECT r.conta_id FROM resumos r JOIN contas c ON c.id = r.conta_id WHERE c.banido = 0 AND c.gm = 0 "
                 "ORDER BY r.xp_total DESC, r.nivel_max DESC, r.nome COLLATE NOCASE LIMIT 3")
SQL_PODIO_PVP = ("SELECT r.conta_id FROM resumos r JOIN contas c ON c.id = r.conta_id "
                 "WHERE c.banido = 0 AND c.gm = 0 AND r.brasa_partidas > 0 "
                 "ORDER BY r.brasa_pts DESC, r.nome COLLATE NOCASE LIMIT 3")
SQL_PODIO_CLASSE = ("SELECT rc.conta_id FROM resumos_classe rc JOIN resumos r ON r.conta_id = rc.conta_id "
                    "JOIN contas c ON c.id = rc.conta_id WHERE c.banido = 0 AND c.gm = 0 AND rc.classe = ? "
                    "ORDER BY rc.xp DESC, rc.nivel DESC, r.nome COLLATE NOCASE LIMIT 3")
# os nomes das classes em português, como o título os escreve ("Top 1 Xamã"): o gêmeo de DATA.classes[].name
NOMES_CLASSE = {'sumo': 'Bárbaro', 'curandeiro': 'Curandeiro', 'invocador': 'Xamã', 'bruxo': 'Bruxo',
                'espadachim': 'Ladino', 'arqueiro': 'Caçador', 'minotauro': 'Minotauro'}
RE_TOP = re.compile(r'^Top ([123]) (.+)$')


def podio_de(con, cid):
    """{'pvm': 1|2|3|None, 'pvp': idem, 'classes': {cid_da_classe: 1|2|3}} da conta, lido do banco; None se as
    tabelas não existem (o banco de antes)."""
    try:
        pvm = [r[0] for r in con.execute(SQL_PODIO_PVM)]
        pvp = [r[0] for r in con.execute(SQL_PODIO_PVP)]
        classes = {}
        for classe in NOMES_CLASSE:
            topo = [r[0] for r in con.execute(SQL_PODIO_CLASSE, (classe,))]
            if cid in topo:
                classes[classe] = topo.index(cid) + 1
    except sqlite3.Error:
        return None
    return {'pvm': pvm.index(cid) + 1 if cid in pvm else None,
            'pvp': pvp.index(cid) + 1 if cid in pvp else None, 'classes': classes}


def titulo_do_podio(titulo, podio):
    """O título de ranking como deve SAIR: a posição de agora no lugar da escolhida ('Top 1 Pvp' vira
    'Top 2 Pvp' se a conta caiu para o 2º; '' se saiu do pódio). Título que não é de ranking, ou pódio
    desconhecido (None), passa como veio."""
    if not isinstance(titulo, str) or podio is None:
        return titulo
    m = RE_TOP.match(titulo)
    if not m:
        return titulo
    resto = m.group(2)
    if resto == 'PVM':
        pos = podio.get('pvm')
        return 'Top %d PVM' % pos if pos else ''
    if resto == 'Pvp':
        pos = podio.get('pvp')
        return 'Top %d Pvp' % pos if pos else ''
    for cid_c, nome in NOMES_CLASSE.items():
        if resto == nome:
            pos = (podio.get('classes') or {}).get(cid_c)
            return 'Top %d %s' % (pos, nome) if pos else ''
    return titulo
AURAS_MESTRE = ('mestre',)   # 04/10: a Chama do Mestre — a API só a grava para a conta marcada (loja.AURAS_MESTRE)

# UM APARELHO SÓ (13/09, pedido do dono: "uma conta só pode estar logada em um
# dispositivo.. se outro tentar logar, no que estava logado cai o jogo"). O
# login certo apaga as outras sessões da conta e anota o sha256 de cada token em
# sessoes_derrubadas (servidor/conta.py, _derruba_outras). O relé lê essa tabela
# para derrubar — {t:'derrubado'} e fechamento FECHA_DERRUBADO — a conexão do
# token que caiu: na hora, quando o aparelho novo se identifica neste relé
# (rele.py, _derruba_outros), e na conferência de novo (_revista), que é o que
# vale no outro contêiner do rolling update (cada um tem o seu relé; os dois
# leem o mesmo banco). Só derruba token que o BANCO diz derrubado: sessão velha
# que ainda vale (aberta antes desta regra) não cai por um ident.
MOTIVO_OUTRO_APARELHO = 'outro-aparelho'        # o mesmo de servidor/conta.py e de js/core/sessao.js
FECHA_DERRUBADO = 4001                          # o código de fechamento da conexão derrubada (rede.js não religa)
SQL_DERRUBADA = "SELECT 1 FROM sessoes_derrubadas WHERE token_hash = ?"


# ------------------------------------------------------------------ o aperto de mão
def marca_do_caminho(caminho):
    """A marca (?n=) do endereço da conexão ('/ws?n=abc123xyz'), ou None.
    Só 8 a 40 letras minúsculas e dígitos: o resto volta None e o anúncio sai
    sem `n` (o cliente então não confia nele)."""
    if not isinstance(caminho, str) or '?' not in caminho:
        return None
    try:
        n = parse_qs(urlsplit(caminho).query).get('n')
    except Exception:
        return None
    return n[0] if n and RE_MARCA.fullmatch(n[0]) else None


def anuncio(com_banco, marca=None, cx=None):
    """O que o relé manda ao aceitar a conexão (texto JSON, sem `de`), com a
    marca que o cliente pôs no endereço — é ela que prova ao cliente que o
    anúncio veio do relé, e não de um par repassado por um relé antigo — e,
    desde 11/09, o `cx`: o id DESTA conexão, que o relé sorteia e carimba nos
    dirigidos que ela manda (o grupo, o duelo e a batalha conferem por ele que
    o parceiro é a mesma conexão de antes; o `paraCx` entrega só a ela)."""
    a = {'t': 'rele', 'v': ANUNCIO_V, 'ident': bool(com_banco)}
    if isinstance(marca, str) and RE_MARCA.fullmatch(marca):
        a['n'] = marca
    if isinstance(cx, str) and RE_CX.fullmatch(cx):
        a['cx'] = cx
    return json.dumps(a, separators=(',', ':'))


def resposta(conta):
    """A resposta ao ident, só para quem mandou. Nunca leva o token."""
    if conta:
        return json.dumps({'t': 'ident-ok', 'mestre': bool(conta.get('gm'))}, separators=(',', ':'))
    return '{"t":"ident-nao"}'


def token_ok(token):
    return isinstance(token, str) and RE_TOKEN.fullmatch(token) is not None


def derrubado():
    """O aviso à conexão derrubada (só a ela, antes do fechamento). Nunca leva o token."""
    return json.dumps({'t': 'derrubado', 'motivo': MOTIVO_OUTRO_APARELHO}, separators=(',', ':'))


# ------------------------------------------------------------------ a conferência
def uri_so_leitura(caminho):
    """O endereço do banco para abrir SÓ PARA LER: mode=ro nunca cria o arquivo
    nem escreve nele. O as_uri escapa espaço, '?', '#' e '%' do caminho."""
    return pathlib.Path(os.path.abspath(caminho)).as_uri() + '?mode=ro'


def confere(caminho, token, agora=None):
    """(conta, definitivo): conta = {'id', 'nome', 'gm'} da sessão válida, ou
    None. `definitivo` é False quando o BANCO não respondeu (ausente, trancado,
    sem as tabelas): essa resposta não vai para o cache. Síncrona — o relé a
    chama numa thread (Verificador.consulta). Abre e fecha a conexão a cada
    vez: é raro (uma vez por conexão por minuto, com cache) e aguenta o banco
    que ainda não existe, o que é restaurado de um backup e o que troca de lugar."""
    if not caminho or not token_ok(token):
        return None, True
    t = time.time() if agora is None else agora
    try:
        con = sqlite3.connect(uri_so_leitura(caminho), uri=True, timeout=ESPERA_BANCO)
    except (sqlite3.Error, ValueError, OSError):
        return None, False
    try:
        linha = con.execute(SQL, (token,)).fetchone()
        # 02/10 (servidor/moderacao.py): contas.banido = 1 com as linhas de banimento todas
        # vencidas não é mais banimento — a API só zera o 0/1 no próximo pedido da conta,
        # e até lá o relé recusaria quem já cumpriu o prazo
        if linha is not None and linha[3] and not moderacao.banida_de_fato(con, linha[0], t):
            linha = linha[:3] + (0,) + linha[4:]
        aura = None
        moldura = None
        podio = None
        if linha is not None:
            try:
                achada = con.execute(SQL_AURA, (linha[0],)).fetchone()
                aura = achada[0] if achada is not None and (achada[0] in AURAS or achada[0] in AURAS_MESTRE) else None
            except sqlite3.Error:                    # o banco de antes de 04/10: ninguém tem aura ainda
                aura = None
            try:                                     # 08/10: a moldura premium escolhida
                achada = con.execute(SQL_MOLDURA, (linha[0],)).fetchone()
                moldura = achada[0] if achada is not None and achada[0] in MOLDURAS else None
            except sqlite3.Error:
                moldura = None
            podio = podio_de(con, linha[0])          # 08/10: o pódio de agora (os títulos acompanham)
    except sqlite3.Error:
        return None, False
    finally:
        con.close()
    if linha is None:
        return None, True
    cid, nome, gm, banido, uso = linha
    if banido or isinstance(uso, bool) or not isinstance(uso, (int, float)) or uso < t - SESSAO_DIAS * 86400:
        return None, True
    conta = {'id': int(cid), 'nome': nome, 'gm': bool(gm)}
    if aura is not None:                             # só quando há: quem compara a conta inteira não muda
        conta['aura'] = aura
    if moldura is not None:
        conta['moldura'] = moldura
    if podio is not None:
        conta['podio'] = podio
    return conta, True


def derrubadas(caminho, tokens):
    """Quais destes tokens um login em outro aparelho derrubou (o set deles),
    numa abertura só do banco SÓ PARA LER — ou None quando o banco não
    respondeu (ausente, trancado). O banco de antes de 13/09, sem a tabela
    sessoes_derrubadas, responde "nenhum": não havia regra, ninguém caiu por ela.
    Síncrona, como o confere (o relé a chama numa thread)."""
    tokens = [tk for tk in tokens if token_ok(tk)]
    if not caminho or not tokens:
        return set()
    try:
        con = sqlite3.connect(uri_so_leitura(caminho), uri=True, timeout=ESPERA_BANCO)
    except (sqlite3.Error, ValueError, OSError):
        return None
    try:
        fora = set()
        for tk in tokens:
            if con.execute(SQL_DERRUBADA, (Verificador.chave(tk),)).fetchone() is not None:
                fora.add(tk)
        return fora
    except sqlite3.OperationalError as e:
        return set() if 'no such table' in str(e) else None
    except sqlite3.Error:
        return None
    finally:
        con.close()


class Verificador:
    """A conferência do relé: cache curto por token e a consulta numa thread
    (run_in_executor — vale da websockets 9.1 às novas, e do Python 3.7 em
    diante). Sem `caminho`, ninguém é verificado."""

    def __init__(self, caminho, validade=CACHE_S, maximo=CACHE_MAX, relogio=time.monotonic):
        self.caminho = caminho or None
        self.validade, self.maximo, self.relogio = validade, maximo, relogio
        self.cache = {}              # sha256(token) -> (vale_até, conta ou None)
        self.em_voo = 0
        self.consultas = 0           # idas ao banco (a prova do cache conta por aqui)

    @property
    def ligado(self):
        return self.caminho is not None

    @staticmethod
    def chave(token):
        return hashlib.sha256(token.encode('ascii')).hexdigest()

    def _guarda(self, chave, conta):
        agora = self.relogio()
        if len(self.cache) >= self.maximo:
            for k in [k for k, (ate, _) in self.cache.items() if ate <= agora]:
                del self.cache[k]
            if len(self.cache) >= self.maximo:
                self.cache.clear()
        self.cache[chave] = (agora + self.validade, conta)

    async def consulta(self, token):
        """(conta, definitivo) do token: a conta conferida (dict só de leitura)
        ou None, e se a resposta é do banco (definitiva) ou só de que ele não
        respondeu — ausente, trancado, a thread que passou do prazo, a vez que
        não chegou —, e aí quem chama tenta de novo depois. Muitas de uma vez (o
        religar de todo mundo depois de um deploy) esperam a vez: EM_VOO_MAX
        consultas ao mesmo tempo, as outras até ESPERA_VEZ s."""
        if self.caminho is None or not token_ok(token):
            return None, True
        chave = self.chave(token)
        fim = time.monotonic() + ESPERA_VEZ
        while True:
            achado = self.cache.get(chave)
            if achado is not None and achado[0] > self.relogio():
                return achado[1], True
            if self.em_voo < EM_VOO_MAX:
                break
            if time.monotonic() >= fim:
                return None, False
            await asyncio.sleep(0.05)            # a vez: outra consulta termina logo (o SELECT é pela chave)
        self.em_voo += 1
        self.consultas += 1
        try:
            loop = asyncio.get_running_loop()
            conta, definitivo = await asyncio.wait_for(
                loop.run_in_executor(None, confere, self.caminho, token), PRAZO_CONFERENCIA)
        except Exception as e:                   # o prazo, a thread que morreu... (nunca o token no log)
            log.warning("a conferência de identidade falhou (%s): segue sem verificar", type(e).__name__)
            return None, False
        finally:
            self.em_voo -= 1
        if definitivo:
            self._guarda(chave, conta)
        return conta, definitivo

    async def confere(self, token):
        """A conta conferida do token (dict só de leitura) ou None."""
        return (await self.consulta(token))[0]

    async def derrubadas(self, tokens):
        """13/09: o set dos `tokens` que um login em outro aparelho derrubou,
        SEM cache (a resposta guardada de 60 s ainda diria "vale" para o token
        que acabou de cair), ou None se o banco não respondeu. O que caiu sai do
        cache de conferência também."""
        tokens = [tk for tk in set(tokens) if token_ok(tk)]
        if self.caminho is None or not tokens:
            return set()
        try:
            loop = asyncio.get_running_loop()
            fora = await asyncio.wait_for(loop.run_in_executor(None, derrubadas, self.caminho, tokens),
                                          PRAZO_CONFERENCIA)
        except Exception as e:                   # o prazo, a thread que morreu... (nunca o token no log)
            log.warning("a conferência das sessões derrubadas falhou (%s)", type(e).__name__)
            return None
        for tk in fora or ():
            self.cache.pop(self.chave(tk), None)
        return fora


# ------------------------------------------------------------------ o tempo da regra
class Orcamento:
    """Os milissegundos de regra que o laço do relé pode gastar, somando TODAS
    as conexões: `taxa_ms` por segundo, com `rajada_ms` guardados de uma vez. O
    saldo pode ficar negativo (um texto caro gasta o que custou) e se paga com
    o tempo. Relógio injetável para as provas."""

    def __init__(self, taxa_ms=ORC_TAXA_MS, rajada_ms=ORC_RAJADA_MS, relogio=time.monotonic):
        self.taxa, self.rajada, self.relogio = float(taxa_ms), float(rajada_ms), relogio
        self.saldo, self.t = float(rajada_ms), relogio()
        self.gasto = 0.0                         # ms gastos desde o começo (as provas olham)

    def _enche(self):
        agora = self.relogio()
        self.saldo = min(self.rajada, self.saldo + (agora - self.t) * self.taxa)
        self.t = agora

    def tem(self):
        self._enche()
        return self.saldo > 0

    def falta(self):
        """Segundos até sobrar saldo (0 = já tem)."""
        self._enche()
        return 0.0 if self.saldo > 0 else (0.5 - self.saldo) / self.taxa

    def gasta(self, ms):
        self._enche()
        self.saldo -= ms
        self.gasto += ms


ORCAMENTO = Orcamento()
_VEREDITOS = {}                  # texto -> bool; a ordem é a do último uso (o mais velho sai primeiro)


def _guarda_veredito(texto, v):
    if len(_VEREDITOS) >= VEREDITOS_MAX:
        for k in list(itertools.islice(_VEREDITOS, VEREDITOS_MAX // 2)):
            del _VEREDITOS[k]
    _VEREDITOS[texto] = v


def _julga(texto):
    """Passa `texto` pela regra (servidor/nomes.py), paga o tempo no orçamento e guarda."""
    t0 = time.perf_counter()
    try:
        v = bool(nomes.reservado(texto))
    except Exception:
        log.exception("a regra dos nomes falhou num texto de %d caracteres: conta como reservado", len(texto))
        v = True
    finally:
        ORCAMENTO.gasta((time.perf_counter() - t0) * 1000.0)
    _guarda_veredito(texto, v)
    return v


class Juiz:
    """A regra fora do caminho quente: os textos novos esperam numa fila só
    (os de conta conferida na frente), julgados um por vez no ritmo do
    ORCAMENTO — o laço nunca passa mais que o orçamento (e um texto) na regra,
    e ninguém fica congelado esperando o nome dos outros. O mesmo texto pedido
    por muitos é julgado uma vez. Liga sozinho no laço de quem pede."""

    def __init__(self, maximo=FILA_MAX):
        self.maximo = maximo
        self.futuros = {}            # texto -> Future do veredicto
        self.filas = (collections.deque(), collections.deque())   # (conta conferida, o resto)
        self.acorda = self.tarefa = self.laco = None
        self.julgados = 0

    def _garante(self):
        laco = asyncio.get_running_loop()
        if self.tarefa is None or self.tarefa.done() or self.laco is not laco:
            self.laco = laco
            self.futuros = {}
            self.filas = (collections.deque(), collections.deque())
            self.acorda = asyncio.Event()
            self.tarefa = laco.create_task(self._roda())

    def _proximo(self):
        for f in self.filas:
            if f:
                return f.popleft()
        return None

    async def _roda(self):
        while True:
            texto = self._proximo()
            if texto is None:
                self.acorda.clear()
                await self.acorda.wait()
                continue
            try:
                falta = ORCAMENTO.falta()
                if falta > 0:
                    await asyncio.sleep(falta)
                v = _VEREDITOS.get(texto)
                if v is None:
                    v = _julga(texto)
                self.julgados += 1
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("o juiz dos nomes tropeçou: o texto fica sem veredicto (fecha por padrão)")
                v = None
            fut = self.futuros.pop(texto, None)
            if fut is not None and not fut.done():
                fut.set_result(v)
            await asyncio.sleep(0)               # a vez dos outros entre um julgamento e outro

    async def pede(self, texto, prioridade=False, prazo=None):
        """Espera o veredicto de `texto`. False = não deu (fila cheia, prazo
        vencido): quem pediu fecha por padrão, e o texto segue na fila — o
        veredicto fica guardado para a próxima vez."""
        if texto in _VEREDITOS:
            return True
        self._garante()
        fut = self.futuros.get(texto)
        if fut is None:
            if len(self.futuros) >= self.maximo:
                return False
            fut = self.laco.create_future()
            self.futuros[texto] = fut
            self.filas[0 if prioridade else 1].append(texto)
            self.acorda.set()
        elif prioridade:
            try:
                self.filas[1].remove(texto)
                self.filas[0].append(texto)
            except ValueError:
                pass
        try:
            await asyncio.wait_for(asyncio.shield(fut), PRAZO_REGRA_S if prazo is None else prazo)
        except asyncio.TimeoutError:
            return False
        return texto in _VEREDITOS


JUIZ = Juiz()


# ------------------------------------------------------------------ o carimbo
def reservado(texto, freio=None, agora=None, so_cache=False):
    """Este texto (nome, título, guilda, emblema) veste a equipe do jogo?
    Também True para o que não é texto, é maior que TEXTO_MAX ou não pôde ser
    julgado agora (fecha por padrão): o freio da conexão vazio, o ORCAMENTO do
    laço gasto, ou — com `so_cache` (o caminho do relé, que julga antes pelo
    Juiz) — o que o juiz não julgou a tempo. None e '' não vestem nada.
    `freio` é qualquer coisa com .tira(agora) -> bool (no relé, um Balde por
    conexão); só o texto que ainda não foi julgado gasta ficha."""
    if texto is None or texto == '':
        return False
    if not isinstance(texto, str) or len(texto) > TEXTO_MAX:
        return True
    v = _VEREDITOS.pop(texto, None)
    if v is not None:
        _VEREDITOS[texto] = v                    # o usado vai para o fim da fila: sai por último
        return v
    if so_cache or not ORCAMENTO.tem():
        return True
    if freio is not None and not freio.tira(time.monotonic() if agora is None else agora):
        return True
    return _julga(texto)


def candidato_de_troca(id_):
    """'Aventureiro-' e as quatro últimas letras/dígitos do id (minúsculas:
    'xxGM' em caixa alta seria outro GM), ou None se o id não tem nenhuma."""
    sufixo = re.sub(r'[^0-9a-z]', '', str(id_ if id_ is not None else '').lower())[-4:]
    return NOME_TROCA + '-' + sufixo if sufixo else None


def nome_de_troca(id_, so_cache=False):
    """O que veste quem tentou um nome reservado: o candidato_de_troca; se até
    ele cair na regra (ou não pôde ser julgado), só 'Aventureiro'. O gêmeo é o
    nomeDeTroca do js/core/rede.js."""
    candidato = candidato_de_troca(id_)
    if candidato and not reservado(candidato, so_cache=so_cache):
        return candidato
    return NOME_TROCA


def veste_o_mestre(classe):
    """A aparência (o `classe` do protocolo) é o corpo do Mestre? A classe 'gm'
    ou uma fusão com ela ('fus:gm+sumo' — o jogo compõe o corpo com as duas)."""
    if not isinstance(classe, str):
        return False
    if classe == CLASSE_MESTRE:
        return True
    return classe.startswith('fus:') and CLASSE_MESTRE in classe[4:].split('+')


def _guilda_limpa(g, cai):
    """Nome e emblema de guilda reservados trocados no lugar; True se mudou."""
    if not isinstance(g, dict):
        return False
    mudou = False
    if 'nome' in g and cai(g['nome']):
        g['nome'] = GUILDA_TROCA
        mudou = True
    if 'emblema' in g and cai(g['emblema']):
        g['emblema'] = EMBLEMA_TROCA
        mudou = True
    return mudou


def textos_a_julgar(m, conta):
    """Os textos do envelope que o carimba vai julgar (sem repetir): nome,
    título, nome e emblema de guilda. Nenhum para o Mestre conferido; nenhum
    que não seja texto julgável (esses fecham por padrão sem regra)."""
    if conta and conta.get('gm'):
        return []
    fora = []

    def poe(s):
        if isinstance(s, str) and s and len(s) <= TEXTO_MAX and s not in fora:
            fora.append(s)
    t = m.get('t')
    if t in COM_NOME:
        poe(m.get('nome'))
    if t in COM_PERFIL:
        poe(m.get('titulo'))
        resumo = m.get('resumo')
        g = resumo.get('guilda') if isinstance(resumo, dict) else None
        if isinstance(g, dict):
            poe(g.get('nome'))
            poe(g.get('emblema'))
    elif t == 'guilda':
        d = m.get('dados')
        if isinstance(d, dict):
            poe(d.get('nome'))
            poe(d.get('emblema'))
    return fora


async def prepara(m, conta, freio=None, juiz=None, anonimo=False):
    """Julga ANTES do carimbo, pelo Juiz, os textos novos do envelope — o
    caminho do relé: o laço segue livre enquanto isso, e o carimba depois
    (com so_cache=True) só lê os veredictos. O texto novo gasta uma ficha do
    freio da conexão; freio vazio, fila cheia ou prazo vencido = desiste, e o
    carimba fecha por padrão o que ficou sem veredicto."""
    if conta and conta.get('gm'):
        return                                   # o Mestre conferido não passa pela regra: nada a esperar
    j = juiz if juiz is not None else JUIZ
    prioridade = conta is not None
    for texto in textos_a_julgar(m, conta):
        if texto in _VEREDITOS:
            continue
        if texto not in j.futuros and freio is not None and not freio.tira(time.monotonic()):
            return
        if not await j.pede(texto, prioridade):
            return
    nome = m.get('nome') if m.get('t') in COM_NOME else None
    if (anonimo and m.get('t') in FALAS_ANONIMAS) or (nome is not None and nome != '' and reservado(nome, so_cache=True)):
        candidato = candidato_de_troca(m.get('de'))   # o nome de troca também passa pela regra
        if candidato and candidato not in _VEREDITOS:
            await j.pede(candidato, True)


def carimba(m, conta, freio=None, agora=None, so_cache=False, anonimo=False):
    """O envelope `m` (o dict já aberto; mexido no lugar) como deve sair do
    relé, ou None quando sai como chegou — aí o relé repassa o texto original,
    sem re-serializar. `conta` é a conta CONFERIDA desta conexão ({'id',
    'nome', 'gm'}) ou None; o id da troca de nome é o `de` do envelope (o relé
    já garantiu que é o da conexão). `so_cache`: não julga nada aqui — o que
    o prepara não julgou fecha por padrão. `anonimo`: a conexão não tem conta
    conferida e o banco está ligado — a fala (FALAS_ANONIMAS) sai com o nome
    de troca, seja qual for o nome que veio."""
    mudou = False
    if 'mestre' in m:                            # a marca é do relé, nunca do cliente
        del m['mestre']
        mudou = True
    t = m.get('t')
    if t in COM_PERFIL:
        nuvem = conta['id'] if conta else None
        if nuvem is None:
            if 'nuvem' in m:
                del m['nuvem']
                mudou = True
        elif type(m.get('nuvem')) is not int or m['nuvem'] != nuvem:
            m['nuvem'] = nuvem
            mudou = True
        # 04/10: a aura comprada. O `auraCor` que sai é o do banco (o Mestre inclusive); o que o cliente
        # mandou cai — um cliente mexido não veste na frente dos outros a aura que não comprou. A releitura
        # da conta a cada CACHE_S (rele.py, _revista) é o que faz a troca de aura chegar à praça
        aura = conta.get('aura') if conta else None
        if aura is None:
            if 'auraCor' in m:
                del m['auraCor']
                mudou = True
        elif m.get('auraCor') != aura:
            m['auraCor'] = aura
            mudou = True
        # 08/10: a MOLDURA premium — a do banco sai; sem ela, qualquer premium que o cliente mandou vira 'auto'
        # (as molduras dos títulos são automáticas e não viajam: cada tela as tira do próprio título)
        mol = conta.get('moldura') if conta else None
        if mol is not None:
            if m.get('moldura') != mol:
                m['moldura'] = mol
                mudou = True
        elif m.get('moldura') in MOLDURAS:
            m['moldura'] = 'auto'
            mudou = True
        # 08/10: o título de pódio sai com a posição de AGORA (ou sai vazio, se a conta caiu do pódio)
        if conta and isinstance(m.get('titulo'), str):
            novo_t = titulo_do_podio(m['titulo'], conta.get('podio'))
            if novo_t != m['titulo']:
                m['titulo'] = novo_t
                mudou = True
    if conta and conta.get('gm'):
        if t in COM_NOME:
            m['mestre'] = True
            # 04/10 (o dono: "mude o nome do Super Admin para GM"): o Mestre conferido sai como "GM"
            # para todo mundo, na praça e no chat — o nome do save dele (era "Oda") não aparece mais
            m['nome'] = NOME_DO_MESTRE
            mudou = True
        return m if mudou else None

    def cai(s):
        return reservado(s, freio, agora, so_cache)

    if anonimo and conta is None and t in FALAS_ANONIMAS:
        troca = nome_de_troca(m.get('de'), so_cache)
        if m.get('nome') != troca:
            m['nome'] = troca
            mudou = True
    elif t in COM_NOME and 'nome' in m and cai(m['nome']):
        m['nome'] = nome_de_troca(m.get('de'), so_cache)
        mudou = True
    if t in COM_PERFIL:
        if 'titulo' in m and cai(m['titulo']):
            m['titulo'] = ''
            mudou = True
        if veste_o_mestre(m.get('classe')):
            m['classe'] = CLASSE_TROCA
            mudou = True
        resumo = m.get('resumo')
        if isinstance(resumo, dict):
            if _guilda_limpa(resumo.get('guilda'), cai):
                mudou = True
            # 05/10: a coroa escolhida no painel do Mestre viaja no resumo e é SÓ dele (o ramo do
            # Mestre saiu logo acima, com o resumo como veio) — de qualquer outro, cai: um cliente
            # mexido não pendura a Coroa X que não ganhou
            if 'coroaMestre' in resumo:
                del resumo['coroaMestre']
                mudou = True
            classes = resumo.get('classes')
            if isinstance(classes, dict) and CLASSE_MESTRE in classes:
                del classes[CLASSE_MESTRE]           # a ficha do Mestre no placar é só dele
                mudou = True
    elif t == 'guilda':
        if _guilda_limpa(m.get('dados'), cai):
            mudou = True
    return m if mudou else None
