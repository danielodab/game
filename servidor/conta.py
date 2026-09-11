#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A conta no site (Fase C): trocar a senha, trocar o e-mail com código,
"esqueci a senha", ver e encerrar as sessões.

Entra no cartório como mixin (`class Api(ContaMixin, LojaMixin)` no api.py):
tudo pelo `self` — con, tranca, _escrita, _evento, _tentativas_estouradas,
_libera_tentativas, tentativas, _abre_sessao, correio e segredo.

As regras que seguram o resto:
  - 401 só quer dizer TOKEN MORTO: num 401 o jogo apaga a sessão e desliga a
    Nuvem. Senha atual errada e código errado são 400.
  - PBKDF2 e SMTP sempre FORA de self.tranca e de _escrita: a tranca serializa
    a API inteira, e 1 a 15 s de SMTP lá dentro travariam o save de todo mundo.
    O "esqueci" manda numa thread; o pedido de troca de e-mail manda depois do
    commit e, se falhar, apaga o código (o pedido não gasta a cota da hora).
  - O código de 6 dígitos nunca vai para o log nem fica em claro no banco:
    lá mora hmac(segredo, 'conta:finalidade:codigo').
  - Contagens que valem entre os dois processos do rolling update (pedidos por
    hora, limites por IP, tentativas de código) moram no BANCO, dentro de
    _escrita (BEGIN IMMEDIATE). Só as tentativas de senha seguem em memória,
    como as do login, porque são a mesma contagem.
  - A tranca de 10 senhas erradas em 10 minutos só barra quem ERRA: a senha é
    conferida ANTES do 429, então quem sabe a senha entra mesmo com a conta sob
    ataque (senão qualquer um trancava qualquer conta pelo nome, e o ranking
    publica nomes). O PBKDF2 de quem insiste é pago pelo freio por IP
    (_freia_por_ip), que conta só as senhas ERRADAS: LOGIN_POR_IP no login e
    SENHA_POR_IP em cada rota com senha, cada uma no seu balde; o acerto
    devolve a vaga, e quem divide o endereço (CGNAT, escola) não se tranca
    entrando — nem entrando JUNTO: com o balde cheio de vagas ainda no
    PBKDF2, o pedido espera uma voltar, em vez do 429. CADASTRO_POR_IP no
    cadastro conta todos, e fecha o oráculo "esse e-mail já tem conta". O
    acerto tem o balde dele, POR CONTA
    (LOGIN_OK_POR_CONTA, SENHA_OK_POR_CONTA), que só quem sabe a senha enche.
    No IPv6, todo freio conta pelo /64 (comum.chave_do_ip).
  - O login não conta quem tem conta: o nome que não existe paga o MESMO
    PBKDF2 (SAL_DE_FACHADA) e recebe a mesma resposta, no mesmo tempo, com a
    mesma 11ª (a contagem das erradas vale também para ele).

O RETRATO NO RANKING (Loja 2, 10/09): na página da conta o jogador escolhe o
retrato que o ranking mostra (GET/POST /api/avatar), entre as classes que tem
no último save (as liberadas, as das fichas e as duas iniciais) e as fusões de
qualquer dupla delas; o Cavaleiro Negro ('gm') é só da conta com a marca de
Mestre, e ela só veste ele. Fica na tabela `avatares` (nova: sem ALTER). O
_resumo do api.py passa por `_retrato_escolhido`: a escolha que o save não
sustenta mais cai no automático (a fusão do avatar do jogo, senão a classe do
melhor herói). O avatar do JOGO (o corpo na praça) não muda por causa disto.
"""
import hashlib
import hmac
import ipaddress
import itertools
import logging
import os
import re
import secrets
import sqlite3
import string
import threading
import time

from comum import (LOGIN_JANELA, SESSAO_DIAS, Recusa, agora, chave_do_ip, email_novo_valido, email_valido,
                   ip_e_publico, le_ip, pica_senha, senha_valida)
from comum import CLASSES_RANK, INICIAIS, classe_do_heroi, liberadas

log = logging.getLogger('api')

CODIGO_VALIDADE = 15 * 60
CODIGO_TENTATIVAS = 5            # a 5ª errada queima o código
CODIGO_PEDIDOS = 3               # por hora, por conta e finalidade...
CODIGO_INTERVALO = 60            # ...com 1 minuto entre um e outro (reenviarEm)
HORA = 3600
ESQUECI_POR_IP = 10              # pedidos de "esqueci" por IP por hora
ESQUECI_GLOBAL = 60              # e-mails de "esqueci" que o servidor manda por hora (protege a caixa)
ESQUECI_CONF_POR_IP = 30         # confirmações por IP por hora
LOGIN_POR_IP = 30                # senhas ERRADAS no login (nome que não existe conta) por IP por hora; o acerto não conta
SENHA_POR_IP = 30                # senhas atuais ERRADAS por IP por hora, cada rota com senha no seu balde (senha, e-mail)
LOGIN_OK_POR_CONTA = 60          # logins CERTOS por conta por hora (cada um é um PBKDF2 e uma sessão nova)
SENHA_OK_POR_CONTA = 10          # trocas de senha por conta por hora (dois PBKDF2 e um e-mail de aviso cada)
CADASTRO_POR_IP = 10             # cadastros por IP por hora (fecha o oráculo do 409 e o PBKDF2 de graça)
TENTATIVAS_CHAVES = 5000         # teto de chaves na contagem em memória das senhas erradas (os nomes que não existem)
VAGA_ESPERA = 5.0                # s que um pedido de senha espera uma vaga do balde do IP presa num PBKDF2 em curso
VAGA_PASSO = 0.05                # s entre uma olhada e outra no balde, enquanto espera
VAGA_DE_NOVO = 60                # o liberaEm (agora + isto) de quem não pôde esperar: as vagas em voo voltam logo
# O login de um nome que não existe paga o MESMO PBKDF2 contra este sal (o formato do sal de uma conta):
# sem ele, o relógio contava quem tem conta — 15 ms sem PBKDF2 contra 138 ms com.
SAL_DE_FACHADA = 'e80dbac5ca63f28ad6f97ce5851376ab'
_DOBRA_ASCII = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)   # como o COLLATE NOCASE do banco
FAXINA = 86400                   # códigos e limites com mais de 1 dia somem
AGENTE_MAX = 160
# o que GET /api/conta mostra na atividade (só o tipo e a hora)
ATIVIDADE = ('cadastro', 'login', 'login-recusado', 'senha-recusada', 'senha-trocada', 'senha-redefinida',
             'email-pedido', 'email-trocado', 'sessoes-encerradas', 'esqueci-pedido')
RE_CODIGO = re.compile(r'^\d{6}$')
FRASE_ESQUECI = 'Se houver conta com esse e-mail, o código chega em instantes. Ele vale por 15 minutos.'
SEM_CORREIO = 'o envio de e-mails ainda não foi ligado neste servidor'
CORREIO_FALHOU = 'o correio do servidor falhou agora; tente de novo em alguns minutos'
MUITAS_TENTATIVAS = 'muitas tentativas; espere 10 minutos'
FRASE_IP_SENHA = 'tentativas demais deste endereço; tente de novo mais tarde'
FRASE_IP_CADASTRO = 'cadastros demais deste endereço; tente de novo mais tarde'
FRASE_LOGINS_CONTA = 'logins demais nesta conta; tente de novo mais tarde'
FRASE_TROCAS_SENHA = 'trocas de senha demais nesta hora; tente de novo mais tarde'
AVATAR_TROCAS_POR_HORA = 30      # trocas de retrato por conta por hora (cada uma refaz a foto do ranking)
AVATAR_TAM = 40

# Só tabelas novas (e um índice): o contêiner velho e o novo sobem juntos no
# mesmo banco no rolling update do Coolify, e uma coluna nova quebraria o velho.
ESQUEMA_CONTA = """
CREATE TABLE IF NOT EXISTS codigos(
  id         INTEGER PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  finalidade TEXT NOT NULL CHECK (finalidade IN ('email', 'senha')),
  hash       TEXT NOT NULL,
  dado       TEXT,
  ip         TEXT,
  criado_em  INTEGER NOT NULL,
  expira_em  INTEGER NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  usado      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS codigos_conta ON codigos(conta_id, finalidade, criado_em);
CREATE TABLE IF NOT EXISTS limites(
  id    INTEGER PRIMARY KEY,
  chave TEXT NOT NULL,
  em    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS limites_chave ON limites(chave, em);
CREATE TABLE IF NOT EXISTS sessoes_extra(
  token     TEXT PRIMARY KEY REFERENCES sessoes(token) ON DELETE CASCADE,
  ip        TEXT,
  agente    TEXT,
  criado_em INTEGER NOT NULL
);
-- a atividade da conta (GET /api/conta) lê os 10 últimos eventos dela
CREATE INDEX IF NOT EXISTS eventos_conta ON eventos(conta_id, id);
-- o retrato que o jogador escolheu no site (10/09): o ranking usa; sem linha = automático
CREATE TABLE IF NOT EXISTS avatares(
  conta_id     INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  avatar       TEXT NOT NULL,
  escolhido_em INTEGER NOT NULL
);
"""


# ---- funções puras ------------------------------------------------------------------
def carrega_segredo(pasta, env=None):
    """O segredo do hmac dos códigos: SOTERRA_SEGREDO, ou o arquivo `segredo` na
    pasta do banco (/dados/segredo no Coolify). O primeiro processo o cria com
    O_CREAT|O_EXCL e permissão 0600; o outro (o do rolling update) só lê — e
    espera um instante se chegou no meio da escrita."""
    env = os.environ if env is None else env
    s = env.get('SOTERRA_SEGREDO')
    if isinstance(s, str) and s.strip():
        return s.strip().encode('utf-8')
    arq = os.path.join(pasta, 'segredo')
    try:
        fd = os.open(arq, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        for _ in range(100):
            with open(arq, 'rb') as f:
                dado = f.read().strip()
            if len(dado) >= 32:
                return dado
            time.sleep(0.05)
        raise RuntimeError('o arquivo %s está vazio ou curto: apague-o (os códigos abertos morrem) '
                           'e suba a API de novo' % arq)
    dado = secrets.token_hex(32).encode('ascii')
    with os.fdopen(fd, 'wb') as f:
        f.write(dado)
        f.flush()
        os.fsync(f.fileno())
    return dado


def mascara_email(email):
    """'daniel@exemplo.com' → 'da***@exemplo.com' (com 1 ou 2 letras antes do @, fica só a primeira)."""
    if not isinstance(email, str) or '@' not in email:
        return '***'
    local, dominio = email.rsplit('@', 1)
    return '%s***@%s' % (local[:2] if len(local) > 2 else local[:1], dominio)


def mascara_ip(texto):
    """'189.34.12.7' → '189.34.*.*'; IPv6 fica com os dois primeiros blocos."""
    try:
        ip = ipaddress.ip_address(texto) if isinstance(texto, str) and texto else None
    except ValueError:
        return None
    if ip is None:
        return None
    if ip.version == 4:
        a, b = str(ip).split('.')[:2]
        return '%s.%s.*.*' % (a, b)
    blocos = ip.exploded.split(':')
    return '%x:%x:*' % (int(blocos[0], 16), int(blocos[1], 16))


def id_sessao(token):
    """O id público de uma sessão: o token nunca sai do servidor."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()[:12]


def _desconta(contagem, chave):
    """Um a menos em contagem[chave]; no zero, a chave sai (o voo e a fila do
    freio por IP não crescem sem fim)."""
    n = contagem.get(chave, 0) - 1
    if n > 0:
        contagem[chave] = n
    else:
        contagem.pop(chave, None)


def _descreve(erro):
    # CorreioFalhou já vem limpo (sem endereço, sem senha); qualquer outra coisa, só o tipo
    return str(erro) if erro.__class__.__name__ == 'CorreioFalhou' else erro.__class__.__name__


# ---- o retrato no ranking (Loja 2, 10/09) --------------------------------------------------
def opcoes_de_avatar(progress, gm):
    """Os retratos que a conta pode escolher, na ordem da página: a conta do
    Mestre, só o Cavaleiro Negro; as outras, as classes que têm no save (as
    liberadas, as das fichas e as duas iniciais), na ordem de classes.js, e
    depois as fusões de qualquer dupla delas (o par em ordem alfabética, como
    os retratos do site). Sem save: as duas iniciais e a fusão delas."""
    if gm:
        return ['gm']
    tem = set(liberadas(progress)) | set(INICIAIS)
    herois = progress.get('heroes') if isinstance(progress, dict) else None
    if isinstance(herois, dict):
        tem |= {classe_do_heroi(hid, h) for hid, h in herois.items() if isinstance(h, dict)}
    tem = [c for c in CLASSES_RANK if c in tem]
    return ['classe:' + c for c in tem] + ['fus:%s+%s' % par for par in itertools.combinations(sorted(tem), 2)]


def avatar_valido(v):
    """A gramática do id: 'classe:<id>', 'fus:<a>+<b>' (a < b, as duas do jogo) ou 'gm'."""
    if not isinstance(v, str) or len(v) > AVATAR_TAM:
        return False
    if v == 'gm':
        return True
    if v.startswith('classe:'):
        return v[7:] in CLASSES_RANK
    if v.startswith('fus:'):
        par = v[4:].split('+')
        return len(par) == 2 and par[0] in CLASSES_RANK and par[1] in CLASSES_RANK and par[0] < par[1]
    return False


def opcao_publica(o):
    if o == 'gm':
        return {'id': 'gm', 'tipo': 'gm'}
    if o.startswith('classe:'):
        return {'id': o, 'tipo': 'classe', 'classe': o[7:]}
    return {'id': o, 'tipo': 'fusao', 'par': o[4:].split('+')}


def retrato_do_ranking(escolha, opcoes, automatico):
    """(avatar, classe) que o ranking mostra: a fusão escolhida (com a classe do
    melhor herói, como hoje), a classe escolhida (sem fusão) ou, sem escolha ou
    com uma que o save não sustenta mais, o automático. O 'gm' não muda nada
    aqui: a conta do Mestre no ranking é assunto da caixa da Equipe."""
    if isinstance(escolha, str) and escolha in opcoes:
        if escolha.startswith('fus:'):
            return escolha, automatico[1]
        if escolha.startswith('classe:'):
            return None, escolha[7:]
    return automatico


# ---- o mixin --------------------------------------------------------------------------
class ContaMixin:

    # -- ajudantes ------------------------------------------------------------------
    def _hash_codigo(self, conta_id, finalidade, codigo):
        return hmac.new(self.segredo, ('%d:%s:%s' % (conta_id, finalidade, codigo)).encode('utf-8'),
                        hashlib.sha256).hexdigest()

    _mascara = staticmethod(mascara_email)

    @staticmethod
    def _chave_ip(corpo):
        """A chave dos freios por IP para o IP do pedido (posto por
        Atendente._atende): o IPv4 inteiro; do IPv6, o /64 (comum.chave_do_ip).
        Só IP público: privado ou loopback quer dizer "atrás de proxy mal
        configurado" ou "em casa", e aí os limites por IP NÃO valem (senão
        valeriam para todo mundo junto); valem só os por conta e o global."""
        ip = le_ip(corpo.get('_ip') if isinstance(corpo, dict) else None)
        return chave_do_ip(ip) if ip_e_publico(ip) else None

    def _conta_limite(self, chave, maximo, janela, t):
        """Dentro de _escrita. None se `chave` ainda cabe na janela; senão, o
        instante (epoch) em que volta a caber. Não anota nada."""
        em = [r[0] for r in self.con.execute("SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em",
                                             (chave, t - janela))]
        return None if len(em) < maximo else em[len(em) - maximo] + janela

    def _anota_limite(self, chave, t):
        """Dentro de _escrita: uma linha no balde; devolve o id dela."""
        cur = self.con.execute("INSERT INTO limites(chave, em) VALUES (?, ?)", (chave, t))
        self.con.execute("DELETE FROM limites WHERE em < ?", (t - FAXINA,))
        return cur.lastrowid

    def _pedidos_estourados(self, cid, finalidade, t):
        """Dentro de _escrita: (frase, liberaEm) se a conta já pediu 3 códigos
        desta finalidade na última hora, ou pediu um há menos de 1 minuto; None se pode."""
        em = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM codigos WHERE conta_id = ? AND finalidade = ? AND criado_em > ? ORDER BY criado_em",
            (cid, finalidade, t - HORA))]
        if len(em) >= CODIGO_PEDIDOS:
            return ('pedidos demais: são %d códigos por hora; espere' % CODIGO_PEDIDOS,
                    em[len(em) - CODIGO_PEDIDOS] + HORA)
        if em and em[-1] > t - CODIGO_INTERVALO:
            return 'espere 1 minuto para pedir outro código', em[-1] + CODIGO_INTERVALO
        return None

    def _grava_codigo(self, cid, finalidade, codigo, dado, corpo, t):
        """Dentro de _escrita: os códigos abertos anteriores desta finalidade
        morrem (um aberto por vez), o novo entra picado, e a faxina de 1 dia passa."""
        self.con.execute("UPDATE codigos SET usado = 1 WHERE conta_id = ? AND finalidade = ? AND usado = 0",
                         (cid, finalidade))
        cur = self.con.execute(
            "INSERT INTO codigos(conta_id, finalidade, hash, dado, ip, criado_em, expira_em) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cid, finalidade, self._hash_codigo(cid, finalidade, codigo), dado, corpo.get('_ip') or None, t,
             t + CODIGO_VALIDADE))
        self.con.execute("DELETE FROM codigos WHERE criado_em < ?", (t - FAXINA,))
        return cur.lastrowid

    def _gasta_pedido(self, cid, finalidade, corpo, t):
        """Dentro de _escrita: um pedido recusado DEPOIS da senha (o 409 do
        e-mail já usado) entra na cota da hora e no intervalo de 1 minuto como
        se tivesse gerado código — a sondagem custa o mesmo que o pedido. A
        linha nasce queimada (usado = 1, sem hash nem dado): não mata o código
        aberto, não confirma nada e não aparece em GET /api/conta."""
        self.con.execute(
            "INSERT INTO codigos(conta_id, finalidade, hash, dado, ip, criado_em, expira_em, usado) "
            "VALUES (?, ?, '', NULL, ?, ?, ?, 1)", (cid, finalidade, corpo.get('_ip') or None, t, t))

    def _barra_tentativas(self, cid):
        with self.tranca:
            if self._tentativas_estouradas(cid):
                raise Recusa(429, MUITAS_TENTATIVAS, liberaEm=self._libera_tentativas(cid))

    def _freia_por_ip(self, corpo, rotulo, maximo, t, frase, so_erradas=False):
        """O freio por IP das rotas que gastam um PBKDF2 (login, cadastro,
        senha): `maximo` por hora por endereço público (o /64, no IPv6),
        contado no banco (vale entre os dois processos do rolling update). A
        vaga é reservada ANTES do PBKDF2, na mesma transação que conta — uma
        rajada paralela não passa do teto — e volta para quem chama. O
        cadastro conta todos. As rotas de senha (so_erradas) só contam as
        ERRADAS: enquanto o PBKDF2 corre, a vaga fica EM VOO (self._em_voo,
        deste processo); a senha bateu, ela volta (_solta_vaga); errou, a
        linha fica. Quem chama sempre a pousa (_pousa_vaga, num finally).
        Balde cheio, mas cheio também de vagas em voo — logins CERTOS juntos
        do mesmo endereço, que vão devolvê-las —: o pedido ESPERA uma delas
        resolver, em vez do 429, até VAGA_ESPERA e com no máximo `maximo` na
        fila (self._fila). Quem espera não gasta PBKDF2, então a rajada de
        erradas continua parando no teto; e o vizinho de CGNAT não se tranca
        entrando junto. IP privado ou loopback: sem freio (None), como no
        esqueci (senão valeria para todo mundo junto)."""
        chave_ip = self._chave_ip(corpo)
        if not chave_ip:
            return None
        chave = '%s-ip:%s' % (rotulo, chave_ip)
        fim, na_fila = time.monotonic() + VAGA_ESPERA, False
        try:
            while True:
                with self._escrita():
                    em = [r[0] for r in self.con.execute(
                        "SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em", (chave, t - HORA))]
                    if len(em) < maximo:
                        vaga = {'chave': chave, 'id': self._anota_limite(chave, t), 'voo': so_erradas}
                        if so_erradas:
                            self._em_voo[chave] = self._em_voo.get(chave, 0) + 1
                        return vaga
                    # cheio. Das linhas, as EM VOO (deste processo) ainda podem voltar; o resto é
                    # senha errada (ou vaga do outro processo, no rolling update): o 429 de sempre
                    if len(em) - (self._em_voo.get(chave, 0) if so_erradas else 0) >= maximo:
                        raise Recusa(429, frase, liberaEm=em[len(em) - maximo] + HORA)
                    if not na_fila:
                        if self._fila.get(chave, 0) >= maximo:
                            raise Recusa(429, frase, liberaEm=agora() + VAGA_DE_NOVO)
                        self._fila[chave] = self._fila.get(chave, 0) + 1
                        na_fila = True
                if time.monotonic() >= fim:         # os PBKDF2 em curso não acabaram a tempo (servidor atolado)
                    raise Recusa(429, frase, liberaEm=agora() + VAGA_DE_NOVO)
                time.sleep(VAGA_PASSO)
                t = agora()
        finally:
            if na_fila:
                with self.tranca:
                    _desconta(self._fila, chave)

    def _solta_vaga(self, vaga):
        """Dentro de uma transação: a vaga que _freia_por_ip reservou volta (a
        senha bateu, ou o pedido parou antes do PBKDF2: o balde do IP das rotas
        de senha conta só as erradas). A linha some; do voo, sai no _pousa_vaga."""
        if vaga is not None:
            self.con.execute("DELETE FROM limites WHERE id = ?", (vaga['id'],))

    def _pousa_vaga(self, vaga):
        """Num finally, DEPOIS da transação que resolveu a vaga (apagou a linha,
        ou a deixou como senha errada): ela sai do voo, uma vez só, e quem
        espera na fila volta a olhar o balde. Nessa ordem, quem espera nunca vê
        a vaga fora do voo com a linha ainda lá — o que seria um 429 à toa."""
        if vaga is None or not vaga['voo']:
            return
        with self.tranca:
            vaga['voo'] = False
            _desconta(self._em_voo, vaga['chave'])

    def _barra_logins_certos(self, cid, t, vaga=None):
        """Dentro da tranca, antes do PBKDF2: 429 se a conta já teve
        LOGIN_OK_POR_CONTA logins certos na última hora. O balde do IP não
        conta mais o acerto; sem este, quem tem uma conta faria login certo em
        laço (um PBKDF2 e uma sessão nova cada), o que o freio antigo segurava.
        Só quem sabe a senha o enche, e ele não é de mais ninguém: não tranca o
        vizinho de CGNAT. Nome que não existe (cid None) consulta o balde 0,
        que nunca enche: a mesma consulta nos dois caminhos. Barrado aqui,
        nenhum PBKDF2 foi gasto: a vaga do IP volta (senão quem insiste na
        conta que estourou enchia o balde do vizinho de CGNAT)."""
        libera = self._conta_limite('login-ok:%d' % (cid or 0), LOGIN_OK_POR_CONTA, HORA, t)
        if libera is not None:
            if vaga is not None:
                self._solta_vaga(vaga)
                self.con.commit()
            raise Recusa(429, FRASE_LOGINS_CONTA, liberaEm=libera)

    def _login_certo(self, cid, vaga, t):
        """Dentro da transação do login que abriu sessão: a vaga do IP volta, e
        o login entra no balde da conta."""
        self._solta_vaga(vaga)
        self._anota_limite('login-ok:%d' % cid, t)

    @staticmethod
    def _pica_de_fachada(senha):
        """O PBKDF2 do login de um nome que não existe, contra o SAL_DE_FACHADA:
        o mesmo custo (~0,1 s) da senha errada de uma conta de verdade, e o
        relógio não conta quem tem conta."""
        pica_senha(senha, SAL_DE_FACHADA)

    @staticmethod
    def _chave_tentativas(conta, login):
        """A chave da contagem de senhas erradas (self.tentativas): o id da
        conta; do nome que não existe, o próprio texto — cortado (nome e e-mail
        cabem em 120) e com as maiúsculas ASCII dobradas como o COLLATE NOCASE
        do banco: 'Ana', 'ana' e 'ANA' são o mesmo fantasma, como seriam a
        mesma conta. Assim a 11ª errada tranca o fantasma igual à conta."""
        return conta['id'] if conta is not None else ('?', login[:121].translate(_DOBRA_ASCII))

    def _anota_tentativa(self, chave, t):
        """Dentro da tranca: uma senha errada na contagem. As chaves dos nomes
        que não existem não crescem sem fim: uma NOVA, com TENTATIVAS_CHAVES já
        guardadas, passa antes a faxina (sai quem não errou nos últimos 10
        minutos); se nem assim couber (muitos endereços chutando juntos), o
        fantasma fica sem anotar."""
        if not isinstance(chave, int) and not self.tentativas.get(chave) and len(self.tentativas) >= TENTATIVAS_CHAVES:
            velho = t - LOGIN_JANELA
            for k in [k for k, v in self.tentativas.items() if not v or v[-1] <= velho]:
                del self.tentativas[k]
            if len(self.tentativas) >= TENTATIVAS_CHAVES:
                return
        self.tentativas.setdefault(chave, []).append(t)

    def _confere_senha(self, conta, senha, frase, corpo, rotulo):
        """A senha da conta, com o PBKDF2 fora da tranca, conferida ANTES da
        tranca de tentativas: quem sabe a senha nunca é trancado. Errou: soma na
        MESMA contagem do login (um token roubado não vira máquina de chutar
        senha), grava o evento senha-recusada e responde 400 — nunca 401; com a
        conta já trancada, 429 sem gravar. O PBKDF2 de quem insiste é pago
        pelo freio por IP da rota (`rotulo`: 'senha' ou 'email', cada uma no
        seu balde de SENHA_POR_IP), que só fica com a vaga de quem ERRA."""
        cid = conta['id']
        vaga = self._freia_por_ip(corpo, rotulo, SENHA_POR_IP, agora(), FRASE_IP_SENHA, so_erradas=True)
        try:
            if hmac.compare_digest(pica_senha(senha, conta['sal']), conta['senha_hash']):
                if vaga is not None:
                    with self._escrita():
                        self._solta_vaga(vaga)
                return
            self._barra_tentativas(cid)
            with self._escrita():
                self.tentativas.setdefault(cid, []).append(agora())
                self._evento(cid, 'senha-recusada', None)
        finally:
            self._pousa_vaga(vaga)              # sai do voo depois de resolvida, bata a senha ou não
        raise Recusa(400, frase)

    def _envia_depois(self, para, assunto, texto, rotulo, ao_falhar=None):
        """Um e-mail que não segura a resposta (os avisos e o código do
        "esqueci"): numa thread, fora da tranca. A falha vai para o log sem
        endereço e sem código."""
        if not self.correio.ligado or not para:
            return

        def vai():
            try:
                self.correio.envia(para, assunto, texto)
            except Exception as e:                      # noqa: BLE001 — a thread não pode morrer calada
                log.warning("correio: %s não saiu (%s)", rotulo, _descreve(e))
                if ao_falhar is not None:
                    try:
                        ao_falhar()
                    except Exception:
                        log.exception("correio: a limpeza depois da falha também falhou")

        threading.Thread(target=vai, name='correio', daemon=True).start()

    def _textos(self, qual, nome, **d):
        """(assunto, texto) de cada e-mail. Nenhum leva link com token."""
        if qual == 'codigo-email':
            assunto = 'SOTERRA: código para trocar o e-mail da conta'
            miolo = ('Pediram para trocar o e-mail da sua conta do SOTERRA para %s.\n\n'
                     'O código é: %s\n\n'
                     'Ele vale por 15 minutos. Digite-o na página da conta, no site.\n\n'
                     'Se não foi você, troque a senha agora: quem pediu sabia a sua senha.' % (d['novo'], d['codigo']))
        elif qual == 'codigo-senha':
            assunto = 'SOTERRA: código para redefinir a senha'
            miolo = ('Pediram para redefinir a senha da sua conta do SOTERRA.\n\n'
                     'O código é: %s\n\n'
                     'Ele vale por 15 minutos. Digite-o no site, junto com a senha nova.\n\n'
                     'Se não foi você, ignore este e-mail: a senha continua a mesma.' % d['codigo'])
        elif qual == 'senha-trocada':
            assunto = 'SOTERRA: sua senha foi trocada'
            miolo = ('A senha da sua conta do SOTERRA acabou de ser trocada, e as outras sessões foram encerradas.\n\n'
                     'Se não foi você, use "esqueci a senha" no site para pegar a conta de volta.')
        elif qual == 'email-trocado':
            assunto = 'SOTERRA: o e-mail da conta mudou'
            miolo = ('O e-mail da sua conta do SOTERRA foi trocado. Agora é %s.\n\n'
                     'Se não foi você, procure o dono do jogo.' % d['novo'])
        else:
            raise ValueError(qual)
        texto = 'Olá, %s.\n\n%s\n' % (nome, miolo)
        if self.correio.endereco:
            texto += '\nA sua conta: %s/site/conta.html\n' % self.correio.endereco
        texto += '\n— SOTERRA (mensagem automática; não precisa responder)\n'
        return assunto, texto

    @staticmethod
    def _conta_publica(conta):
        return {'id': conta['id'], 'nome': conta['nome'], 'email': conta['email'], 'criadoEm': conta['criado_em'],
                'gm': bool(conta['gm'])}

    # -- GET /api/conta -----------------------------------------------------------------
    def conta_dados(self, conta, corpo):
        cid, t, token = conta['id'], agora(), corpo.get('_token')
        with self.tranca:
            sessoes = self.con.execute(
                "SELECT s.token, s.criado_em, s.ultimo_uso, x.ip, x.agente FROM sessoes s "
                "LEFT JOIN sessoes_extra x ON x.token = s.token WHERE s.conta_id = ? AND s.ultimo_uso >= ? "
                "ORDER BY s.ultimo_uso DESC, s.criado_em DESC LIMIT 50",
                (cid, t - SESSAO_DIAS * 86400)).fetchall()
            atividade = self.con.execute(
                "SELECT tipo, criado_em FROM eventos WHERE conta_id = ? AND tipo IN (%s) ORDER BY id DESC LIMIT 10"
                % ','.join('?' * len(ATIVIDADE)), (cid,) + ATIVIDADE).fetchall()
            troca = self.con.execute(
                "SELECT dado, criado_em, expira_em FROM codigos WHERE conta_id = ? AND finalidade = 'email' "
                "AND usado = 0 AND expira_em > ? ORDER BY id DESC LIMIT 1", (cid, t)).fetchone()
        return 200, {
            'ok': True,
            'conta': self._conta_publica(conta),
            'correio': self.correio.ligado,
            'sessoes': [{'id': id_sessao(r['token']), 'criadoEm': r['criado_em'], 'ultimoUso': r['ultimo_uso'],
                         'agente': r['agente'], 'ip': mascara_ip(r['ip']), 'estaAqui': r['token'] == token}
                        for r in sessoes],
            'atividade': [{'tipo': r['tipo'], 'em': r['criado_em']} for r in atividade],
            'trocaEmail': ({'para': troca['dado'], 'enviadoPara': mascara_email(conta['email']),
                            'expiraEm': troca['expira_em'], 'reenviarEm': troca['criado_em'] + CODIGO_INTERVALO}
                           if troca is not None else None),
        }

    # -- POST /api/conta/senha ----------------------------------------------------------
    def conta_senha(self, conta, corpo):
        atual, nova = corpo.get('atual'), corpo.get('nova')
        if not isinstance(atual, str) or not atual or not isinstance(nova, str) or not nova:
            raise Recusa(400, 'informe a senha atual e a nova')
        if not senha_valida(nova):
            raise Recusa(400, 'a senha nova precisa ter pelo menos 8 caracteres')
        if nova == atual:
            raise Recusa(400, 'a senha nova é igual à atual')
        cid = conta['id']
        # as trocas CERTAS têm o balde delas, por conta (SENHA_OK_POR_CONTA): o
        # do IP só conta a senha atual errada, e cada troca são dois PBKDF2 e
        # um e-mail de aviso. Só quem sabe a senha o enche
        with self.tranca:
            libera = self._conta_limite('senha-ok:%d' % cid, SENHA_OK_POR_CONTA, HORA, agora())
        if libera is not None:
            raise Recusa(429, FRASE_TROCAS_SENHA, liberaEm=libera)
        self._confere_senha(conta, atual, 'senha atual errada', corpo, 'senha')
        sal = secrets.token_hex(16)
        picada = pica_senha(nova, sal)                  # fora da tranca: ~0,1 s
        with self._escrita():
            self.con.execute("UPDATE contas SET senha_hash = ?, sal = ? WHERE id = ?", (picada, sal, cid))
            n = self.con.execute("DELETE FROM sessoes WHERE conta_id = ? AND token != ?",
                                 (cid, corpo.get('_token') or '')).rowcount
            self.tentativas.pop(cid, None)
            self._evento(cid, 'senha-trocada', {'sessoesEncerradas': n})
            self._anota_limite('senha-ok:%d' % cid, agora())
        log.info("conta: #%d trocou a senha (%d sessões encerradas)", cid, n)
        assunto, texto = self._textos('senha-trocada', conta['nome'])
        self._envia_depois(conta['email'], assunto, texto, 'o aviso de senha trocada')
        return 200, {'ok': True, 'sessoesEncerradas': n}

    # -- POST /api/conta/email/pedir ----------------------------------------------------
    def conta_email_pedir(self, conta, corpo):
        senha, novo = corpo.get('senha'), corpo.get('novoEmail')
        if not isinstance(senha, str) or not senha or not isinstance(novo, str) or not novo.strip():
            raise Recusa(400, 'informe a senha e o e-mail novo')
        novo = novo.strip()
        if not email_novo_valido(novo):
            raise Recusa(400, 'e-mail inválido')
        if novo.lower() == (conta['email'] or '').lower():
            raise Recusa(400, 'esse já é o e-mail da conta')
        if not self.correio.ligado:
            raise Recusa(503, SEM_CORREIO, correio=False)
        cid = conta['id']
        # a cota de códigos (3 por hora, 1 por minuto) também ANTES da senha: o
        # balde do IP devolve a vaga de quem acerta, e sem isto cada pedido além
        # da cota ainda pagava um PBKDF2. A conferência que vale segue abaixo,
        # dentro da transação
        with self.tranca:
            estouro = self._pedidos_estourados(cid, 'email', agora())
        if estouro is not None:
            raise Recusa(429, estouro[0], liberaEm=estouro[1])
        self._confere_senha(conta, senha, 'senha errada', corpo, 'email')
        t = agora()
        codigo = '%06d' % secrets.randbelow(10 ** 6)
        erro = None
        with self._escrita():
            # a cota vem ANTES do 409, e o 409 gasta a cota: senão "esse e-mail já
            # tem conta" era um oráculo de graça — justamente o que o esqueci esconde
            estouro = self._pedidos_estourados(cid, 'email', t)
            if estouro is not None:
                raise Recusa(429, estouro[0], liberaEm=estouro[1])
            if self.con.execute("SELECT 1 FROM contas WHERE email = ? AND id != ?", (novo, cid)).fetchone():
                self._gasta_pedido(cid, 'email', corpo, t)
                erro = Recusa(409, 'esse e-mail já tem conta')
            else:
                cod_id = self._grava_codigo(cid, 'email', codigo, novo, corpo, t)
        if erro is not None:                            # depois do commit: a sondagem ficou contada
            raise erro
        # depois do commit e fora da tranca; o código vai para o e-mail ATUAL
        assunto, texto = self._textos('codigo-email', conta['nome'], novo=novo, codigo=codigo)
        try:
            self.correio.envia(conta['email'], assunto, texto)
        except Exception as e:                          # noqa: BLE001
            log.warning("correio: o código da troca de e-mail da conta #%d não saiu (%s)", cid, _descreve(e))
            with self._escrita():
                self.con.execute("DELETE FROM codigos WHERE id = ?", (cod_id,))
            raise Recusa(503, CORREIO_FALHOU, correio=True)
        with self._escrita():
            self._evento(cid, 'email-pedido', {'para': novo})
        return 200, {'ok': True, 'enviadoPara': mascara_email(conta['email']), 'expiraEm': t + CODIGO_VALIDADE,
                     'reenviarEm': t + CODIGO_INTERVALO}

    # -- POST /api/conta/email/confirmar ------------------------------------------------
    def conta_email_confirmar(self, conta, corpo):
        codigo = corpo.get('codigo')
        codigo = codigo.strip() if isinstance(codigo, str) else codigo
        if not isinstance(codigo, str) or not RE_CODIGO.match(codigo):
            raise Recusa(400, 'o código tem 6 dígitos')
        cid, t = conta['id'], agora()
        erro = de = para = None
        with self._escrita():
            r = self.con.execute(
                "SELECT id, hash, dado, expira_em, tentativas FROM codigos WHERE conta_id = ? AND finalidade = 'email' "
                "AND usado = 0 ORDER BY id DESC LIMIT 1", (cid,)).fetchone()
            if r is None or r['expira_em'] <= t or not r['dado']:
                raise Recusa(400, 'não há troca de e-mail pedida, ou o código venceu; peça outro')
            tentativas = r['tentativas'] + 1
            # a tentativa é gravada ANTES de comparar: cair no meio não devolve a vez
            self.con.execute("UPDATE codigos SET tentativas = ? WHERE id = ?", (tentativas, r['id']))
            if not hmac.compare_digest(self._hash_codigo(cid, 'email', codigo), r['hash']):
                if tentativas >= CODIGO_TENTATIVAS:
                    self.con.execute("UPDATE codigos SET usado = 1 WHERE id = ?", (r['id'],))
                    erro = Recusa(400, 'código errado vezes demais; peça outro')
                else:
                    erro = Recusa(400, 'código errado', restam=CODIGO_TENTATIVAS - tentativas)
            else:
                self.con.execute("UPDATE codigos SET usado = 1 WHERE id = ?", (r['id'],))
                para = r['dado']
                de = self.con.execute("SELECT email FROM contas WHERE id = ?", (cid,)).fetchone()[0]
                livre = self.con.execute("SELECT 1 FROM contas WHERE email = ? AND id != ?",
                                         (para, cid)).fetchone() is None
                if livre:
                    try:
                        self.con.execute("UPDATE contas SET email = ? WHERE id = ?", (para, cid))
                    except sqlite3.IntegrityError:
                        livre = False
                if livre:
                    self._evento(cid, 'email-trocado', {'de': de, 'para': para})
                else:
                    erro = Recusa(409, 'esse e-mail já tem conta')
        if erro is not None:                            # depois do commit: a tentativa ficou gravada
            raise erro
        log.info("conta: #%d trocou o e-mail", cid)
        # o aviso vai ao e-mail ANTIGO: é ele que pode dar o alarme
        assunto, texto = self._textos('email-trocado', conta['nome'], novo=mascara_email(para))
        self._envia_depois(de, assunto, texto, 'o aviso de e-mail trocado')
        return 200, {'ok': True, 'conta': self._conta_publica(dict(conta, email=para))}

    # -- POST /api/esqueci ----------------------------------------------------------------
    def esqueci(self, conta, corpo):
        """Sempre a mesma frase, no mesmo tempo (o envio vai numa thread): a
        resposta não conta quem tem conta. Conta banida, conta que já pediu 3
        na hora e conta que não existe: a mesma frase, e nada sai."""
        email = corpo.get('email')
        email = email.strip() if isinstance(email, str) else email
        if not email_valido(email):
            raise Recusa(400, 'e-mail inválido')
        if not self.correio.ligado:
            raise Recusa(503, SEM_CORREIO, correio=False)
        t, ip = agora(), self._chave_ip(corpo)       # IPv6: o /64
        envio = None
        with self._escrita():
            if ip:
                libera = self._conta_limite('esqueci-ip:' + ip, ESQUECI_POR_IP, HORA, t)
                if libera is not None:
                    raise Recusa(429, 'pedidos demais deste endereço; tente de novo mais tarde', liberaEm=libera)
            libera = self._conta_limite('esqueci-global', ESQUECI_GLOBAL, HORA, t)
            if libera is not None:
                raise Recusa(429, 'o correio está ocupado; tente em alguns minutos', liberaEm=libera)
            if ip:
                self._anota_limite('esqueci-ip:' + ip, t)
            c = self.con.execute("SELECT id, nome, email, banido FROM contas WHERE email = ?", (email,)).fetchone()
            if c is not None and not c['banido'] and self._pedidos_estourados(c['id'], 'senha', t) is None:
                codigo = '%06d' % secrets.randbelow(10 ** 6)
                cod_id = self._grava_codigo(c['id'], 'senha', codigo, None, corpo, t)
                self._anota_limite('esqueci-global', t)        # o teto global conta o que SAI
                self._evento(c['id'], 'esqueci-pedido', None)
                envio = (c['id'], c['nome'], c['email'], codigo, cod_id)
        if envio is not None:
            cid, nome, para, codigo, cod_id = envio
            assunto, texto = self._textos('codigo-senha', nome, codigo=codigo)

            def apaga():
                with self._escrita():
                    self.con.execute("DELETE FROM codigos WHERE id = ?", (cod_id,))

            self._envia_depois(para, assunto, texto, 'o código do esqueci-a-senha da conta #%d' % cid, ao_falhar=apaga)
        return 200, {'ok': True, 'mensagem': FRASE_ESQUECI}

    # -- POST /api/esqueci/confirmar -------------------------------------------------------
    def esqueci_confirmar(self, conta, corpo):
        email, codigo, nova = corpo.get('email'), corpo.get('codigo'), corpo.get('nova')
        # a senha nova ANTES do código: um erro de digitação não gasta tentativa
        if not senha_valida(nova):
            raise Recusa(400, 'a senha nova precisa ter pelo menos 8 caracteres')
        codigo = codigo.strip() if isinstance(codigo, str) else codigo
        if not isinstance(codigo, str) or not RE_CODIGO.match(codigo):
            raise Recusa(400, 'o código tem 6 dígitos')
        email = email.strip() if isinstance(email, str) else email
        t, ip = agora(), self._chave_ip(corpo)       # IPv6: o /64
        erro = alvo = None
        with self._escrita():
            if ip:
                libera = self._conta_limite('esqueci-conf-ip:' + ip, ESQUECI_CONF_POR_IP, HORA, t)
                if libera is not None:
                    raise Recusa(429, 'tentativas demais deste endereço; tente de novo mais tarde', liberaEm=libera)
                self._anota_limite('esqueci-conf-ip:' + ip, t)
            c = (self.con.execute("SELECT * FROM contas WHERE email = ?", (email,)).fetchone()
                 if email_valido(email) else None)
            r = None
            if c is not None and not c['banido']:
                r = self.con.execute(
                    "SELECT id, hash, expira_em, tentativas FROM codigos WHERE conta_id = ? AND finalidade = 'senha' "
                    "AND usado = 0 ORDER BY id DESC LIMIT 1", (c['id'],)).fetchone()
            if r is None or r['expira_em'] <= t:
                erro = Recusa(400, 'código errado ou vencido')      # a mesma frase para quem não existe
            else:
                tentativas = r['tentativas'] + 1
                self.con.execute("UPDATE codigos SET tentativas = ? WHERE id = ?", (tentativas, r['id']))
                if hmac.compare_digest(self._hash_codigo(c['id'], 'senha', codigo), r['hash']):
                    self.con.execute("UPDATE codigos SET usado = 1 WHERE id = ?", (r['id'],))
                    alvo = dict(c)
                else:
                    if tentativas >= CODIGO_TENTATIVAS:
                        self.con.execute("UPDATE codigos SET usado = 1 WHERE id = ?", (r['id'],))
                    erro = Recusa(400, 'código errado ou vencido')
        if erro is not None:
            raise erro
        cid = alvo['id']
        sal = secrets.token_hex(16)
        picada = pica_senha(nova, sal)                  # fora da tranca
        with self._escrita():
            self.con.execute("UPDATE contas SET senha_hash = ?, sal = ? WHERE id = ?", (picada, sal, cid))
            self.con.execute("DELETE FROM sessoes WHERE conta_id = ?", (cid,))       # TODAS: quem roubou sai
            self.tentativas.pop(cid, None)
            token = self._abre_sessao(cid, corpo)
            self._evento(cid, 'senha-redefinida', None)
        log.info("conta: #%d redefiniu a senha pelo código", cid)
        assunto, texto = self._textos('senha-trocada', alvo['nome'])
        self._envia_depois(alvo['email'], assunto, texto, 'o aviso de senha redefinida')
        return 200, {'ok': True, 'token': token, 'conta': {'id': cid, 'nome': alvo['nome'], 'gm': bool(alvo['gm'])}}

    # -- POST /api/conta/sessoes/encerrar -------------------------------------------------
    def conta_sessoes_encerrar(self, conta, corpo):
        outras, todas, sid = corpo.get('outras') is True, corpo.get('todas') is True, corpo.get('id')
        if outras + todas + (sid is not None) != 1 or (sid is not None and not isinstance(sid, str)):
            raise Recusa(400, 'diga o que encerrar: outras, id ou todas')
        cid, token = conta['id'], corpo.get('_token') or ''
        with self._escrita():
            if outras:
                n, esta, modo = self.con.execute("DELETE FROM sessoes WHERE conta_id = ? AND token != ?",
                                                 (cid, token)).rowcount, False, 'outras'
            elif todas:
                n, esta, modo = self.con.execute("DELETE FROM sessoes WHERE conta_id = ?", (cid,)).rowcount, True, 'todas'
            else:
                sid = sid.strip().lower()
                alvo = next((r[0] for r in self.con.execute("SELECT token FROM sessoes WHERE conta_id = ?", (cid,))
                             if id_sessao(r[0]) == sid), None)
                if alvo is None:
                    raise Recusa(404, 'sessão não encontrada')
                n = self.con.execute("DELETE FROM sessoes WHERE token = ?", (alvo,)).rowcount
                esta, modo = alvo == token, 'uma'
            if n:
                self._evento(cid, 'sessoes-encerradas', {'modo': modo, 'quantas': n})
        return 200, {'ok': True, 'encerradas': n, 'estaEncerrada': esta}

    # -- o retrato no ranking (Loja 2, 10/09) ------------------------------------------------
    def _retrato_escolhido(self, cid, conta, progress, avatar, principal):
        """Dentro da transação do _resumo (api.py): (avatar, classe) do ranking
        com a escolha do site, se o save ainda a sustenta; senão o automático."""
        r = self.con.execute("SELECT avatar FROM avatares WHERE conta_id = ?", (cid,)).fetchone()
        if r is None:
            return avatar, principal
        return retrato_do_ranking(r['avatar'], opcoes_de_avatar(progress, bool(conta['gm'])), (avatar, principal))

    def _retrato_atual(self, cid):
        """O que o ranking mostra agora (a linha de resumos_extra)."""
        r = self.con.execute("SELECT avatar, classe FROM resumos_extra WHERE conta_id = ?", (cid,)).fetchone()
        return {'avatar': r['avatar'], 'classe': r['classe']} if r is not None else {'avatar': None, 'classe': None}

    # -- GET /api/avatar -------------------------------------------------------------------
    def avatar_ler(self, conta, corpo):
        cid, gm = conta['id'], bool(conta['gm'])
        with self.tranca:
            save = self._loja_save(cid)
            r = self.con.execute("SELECT avatar FROM avatares WHERE conta_id = ?", (cid,)).fetchone()
            efetivo = self._retrato_atual(cid)
        opcoes = opcoes_de_avatar(save['progress'] if save else None, gm)
        return 200, {'ok': True, 'escolhido': r['avatar'] if r is not None else None, 'efetivo': efetivo,
                     'opcoes': [opcao_publica(o) for o in opcoes], 'semSave': save is None, 'gm': gm}

    # -- POST /api/avatar {avatar} ----------------------------------------------------------
    def avatar_escolher(self, conta, corpo):
        if 'avatar' not in corpo:
            raise Recusa(400, 'avatar inválido')
        avatar = corpo.get('avatar')                    # null = automático
        if avatar is not None and not avatar_valido(avatar):
            raise Recusa(400, 'avatar inválido')
        cid, gm, t = conta['id'], bool(conta['gm']), agora()
        with self._escrita():
            save = self._loja_save(cid)
            progress = save['progress'] if save else None
            if avatar is not None:
                if gm and avatar != 'gm':
                    raise Recusa(409, 'o Mestre do Fundo veste o Cavaleiro Negro')
                if not gm and avatar == 'gm':
                    raise Recusa(409, 'o Cavaleiro Negro é só do Mestre do Fundo')
                if avatar not in opcoes_de_avatar(progress, gm):
                    raise Recusa(409, 'esse retrato ainda não é seu: libere a classe no jogo')
            chave = 'avatar:%d' % cid
            libera = self._conta_limite(chave, AVATAR_TROCAS_POR_HORA, HORA, t)
            if libera is not None:
                raise Recusa(429, 'trocas de avatar demais nesta hora (%d)' % AVATAR_TROCAS_POR_HORA, liberaEm=libera)
            self._anota_limite(chave, t)
            if avatar is None:
                self.con.execute("DELETE FROM avatares WHERE conta_id = ?", (cid,))
            else:
                self.con.execute("INSERT OR REPLACE INTO avatares(conta_id, avatar, escolhido_em) VALUES (?, ?, ?)",
                                 (cid, avatar, t))
            # o ranking já mostra: a foto pública desta conta refeita a partir do
            # último save (o mesmo _resumo do salvar, com a data do save)
            if save is not None:
                self._resumo(cid, conta, progress, save['db'], save['em'])
            self._ranking_guardado = None
            self._evento(cid, 'avatar', {'avatar': avatar})
            efetivo = self._retrato_atual(cid)
        log.info("conta: #%d escolheu o retrato %s", cid, avatar or 'automático')
        return 200, {'ok': True, 'escolhido': avatar, 'efetivo': efetivo}
