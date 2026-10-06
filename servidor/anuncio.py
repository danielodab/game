#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O ANÚNCIO PREMIADO do aplicativo de Android — a área "Ganhar prêmios" (06/10).

A REGRA DO DONO: "as propagandas só devem aparecer SOMENTE se o usuário for nessa
área; não quero que meu jogo fique cheio de propagandas atrapalhando o jogo; tem
que ser de livre e espontânea vontade." O jogador entra na área, escolhe o prêmio
e toca em "Assistir anúncio". Só no aplicativo: na web nada disto é carregado.

DOIS PRÊMIOS, cada um com o seu limite por CONTA e por dia de Brasília:
  - 'vintens': ANUNCIO_VINTENS por anúncio visto até o fim, ANUNCIO_MAX_DIA por dia;
  - 'barras':  ANUNCIO_BARRAS barra de ouro por anúncio, ANUNCIO_MAX_DIA por dia.
O limite de um não gasta o do outro. Fechou antes do fim: não ganha nem perde.

QUEM DÁ O PRÊMIO É O SERVIDOR, e só com a palavra ASSINADA da Google (a
"verificação pelo servidor" do AdMob, SSV). O cliente nunca credita nada:
  1. POST /api/anuncio/bilhete {tipo} (com sessão): um BILHETE de uso único, ligado
     à conta e ao TIPO de prêmio, que vale BILHETE_VALE segundos;
  2. o aplicativo mostra o anúncio com custom_data = bilhete e user_id = o código
     da conta (um hmac; não diz nada da conta a quem não tem o segredo);
  3. o anúncio visto até o fim faz a GOOGLE chamar GET /api/anuncio/premio?… com
     os parâmetros assinados (ECDSA P-256 / SHA-256; as chaves públicas moram em
     gstatic.com e ficam em cache). Sem sessão: a assinatura é a porta;
  4. o servidor confere a ASSINATURA, o bloco (ad_unit), o bilhete (existe, é
     daquela conta, não foi usado, não venceu), o transaction_id (o mesmo nunca
     credita duas vezes) e o limite do dia DAQUELE tipo — e só então credita, pelo
     caminho de sempre: a barra por barras_move (extrato), os vinténs por credita
     (o pedido de preço 0 que o jogo retira e o juiz confere, como o presente).
O prêmio é o do BILHETE: o reward_item e o reward_amount que vêm no pedido da
Google não são lidos (quem os escolhe é o cadastro do bloco no AdMob).

Sem assinatura válida NADA é creditado, em nenhuma configuração. As provas não
desligam a conferência: trocam só a FONTE das chaves (--anuncio-chaves ARQ, um
arquivo com o par de chaves da própria prova; nunca em produção).

A conta do MESTRE não recebe bilhete (o dono não pode clicar no próprio anúncio:
a Google suspende a conta do AdMob por isso). A conta BANIDA não chega às rotas
com sessão, e um prêmio que chegue depois do banimento não é creditado.

A ECDSA é a da biblioteca `cryptography` (py3-cryptography no Dockerfile). Sem
ela, a área fica desligada (503) — nunca "credita sem conferir".

Tabelas NOVAS, nunca ALTER (o rolling update). Chamam-se `propaganda_*` porque
`mercado_anuncios` já é o anúncio de venda do mercadinho.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request

from comum import Recusa, agora

try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    TEM_ECDSA = True
except ImportError:                      # sem a biblioteca: a área desliga, nada é creditado
    TEM_ECDSA = False

log = logging.getLogger("soterra.anuncio")

# ---- os números do dono (06/10) ----
ANUNCIO_VINTENS = 50             # vinténs por anúncio visto até o fim
ANUNCIO_BARRAS = 1               # barras de ouro por anúncio ("barra de ouro deve ser mais difícil")
ANUNCIO_MAX_DIA = 5              # por conta, por dia de Brasília, de CADA tipo
PREMIOS = {'vintens': ANUNCIO_VINTENS, 'barras': ANUNCIO_BARRAS}
TIPOS = ('vintens', 'barras')

BLOCO_PADRAO = 'ca-app-pub-4989579635131748/7206484209'    # o bloco premiado do dono (público)
URL_CHAVES = 'https://www.gstatic.com/admob/reward/verifier-keys.json'
CHAVES_VALEM = 24 * 3600         # s de cache das chaves públicas
CHAVES_DE_NOVO = 60              # s entre duas buscas por causa de um key_id desconhecido
TIMEOUT = 8
BILHETE_VALE = 30 * 60           # s: carregar o anúncio, assistir, e a Google avisar
BILHETES_POR_HORA = 30           # por conta (freio 'anuncio:<conta>')
BILHETES_POR_HORA_IP = 90        # por IP público (freio 'anuncio-ip:<ip>')
BILHETES_GUARDA = 3 * 86400      # o bilhete velho sai na faxina
FUSO_S = -3 * 3600               # Brasília, deslocamento fixo (o Brasil não tem horário de verão)
SKU_VINTENS = 'anuncio-vintens'  # o pedido de preço 0 dos vinténs (loja.py dá o nome)
REF_BARRAS = 'anuncio:'          # a `ref` do movimento de barras (loja.py mostra como 'anuncio')
RE_BILHETE = re.compile(r'^[A-Za-z0-9_-]{20,64}$')
RE_TRANSACAO = re.compile(r'^[A-Za-z0-9_.:-]{6,128}$')
CONSULTA_MAX = 2000

FRASE_DESLIGADO = 'os anúncios premiados não estão disponíveis agora'
FRASE_MESTRE = 'a conta do Mestre não assiste a anúncios'

ESQUEMA_ANUNCIO = """
-- O ANÚNCIO PREMIADO (06/10, anuncio.py). O bilhete é do servidor, de uso único, e diz a conta e o tipo
CREATE TABLE IF NOT EXISTS propaganda_bilhetes(
  bilhete   TEXT PRIMARY KEY,
  conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL CHECK (tipo IN ('vintens', 'barras')),
  criado_em INTEGER NOT NULL,
  usado_em  INTEGER
);
CREATE INDEX IF NOT EXISTS propaganda_bilhetes_em ON propaganda_bilhetes(criado_em);
-- o prêmio creditado: a transação da Google é a chave (a mesma nunca credita duas vezes); `dia` é o dia de
-- Brasília, e é por (conta, tipo, dia) que o limite conta. A linha sobrevive à conta (é trilha)
CREATE TABLE IF NOT EXISTS propaganda_premios(
  id        INTEGER PRIMARY KEY,
  transacao TEXT NOT NULL UNIQUE,
  conta_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  bilhete   TEXT NOT NULL,
  tipo      TEXT NOT NULL CHECK (tipo IN ('vintens', 'barras')),
  qtd       INTEGER NOT NULL CHECK (qtd > 0),
  dia       INTEGER NOT NULL,
  chave     TEXT,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS propaganda_premios_dia ON propaganda_premios(conta_id, tipo, dia);
"""


def dia_de(t):
    """O número do dia de Brasília em que cai o instante t (vira à 00:00 de lá)."""
    return (int(t) + FUSO_S) // 86400


def vira_em(t):
    """O instante (epoch) da próxima 00:00 de Brasília: quando os contadores zeram."""
    return (dia_de(t) + 1) * 86400 - FUSO_S


def _b64url(texto):
    return base64.urlsafe_b64decode(texto + '=' * (-len(texto) % 4))


class Anuncios:
    """A configuração e as chaves públicas do AdMob. `arquivo` é SÓ PARA AS PROVAS: as
    chaves saem de um arquivo local no formato do verifier-keys.json — a assinatura
    continua sendo conferida, só a fonte muda."""

    def __init__(self, bloco=BLOCO_PADRAO, ligado=True, aparelhos=(), arquivo=None, url=URL_CHAVES):
        self.bloco = bloco
        self.aparelhos = tuple(aparelhos)
        self.arquivo = arquivo
        self.url = url
        self.defeito = None if TEM_ECDSA else 'falta a biblioteca cryptography'
        self.ligado = bool(ligado) and TEM_ECDSA and bool(bloco)
        self._chaves, self._lidas_em, self._tentou_em = {}, 0, 0
        self._tranca = threading.Lock()

    @classmethod
    def do_ambiente(cls, env=None, arquivo=None):
        env = os.environ if env is None else env
        bloco = (env.get('SOTERRA_ANUNCIO_BLOCO') or '').strip() or BLOCO_PADRAO
        aparelhos = [a.strip() for a in (env.get('SOTERRA_ANUNCIO_APARELHOS_TESTE') or '').split(',')
                     if re.match(r'^[A-Fa-f0-9-]{16,64}$', a.strip())][:10]
        return cls(bloco=bloco, ligado=(env.get('SOTERRA_ANUNCIOS') or '1').strip() != '0', aparelhos=aparelhos,
                   arquivo=arquivo)

    @property
    def unidade(self):
        """O que a Google manda em `ad_unit`: só o número depois da barra."""
        return self.bloco.rsplit('/', 1)[-1]

    def descricao(self):
        if not self.ligado:
            return 'anúncio premiado desligado (%s)' % (self.defeito or 'SOTERRA_ANUNCIOS=0')
        return 'anúncio premiado ligado (bloco %s%s)' % (
            self.bloco, ', chaves de PROVA em %s' % self.arquivo if self.arquivo else '')

    def _busca(self):
        if self.arquivo:
            with open(self.arquivo, encoding='utf-8') as f:
                bruto = f.read()
        else:
            with urllib.request.urlopen(urllib.request.Request(self.url, headers={'User-Agent': 'soterra-api'}),
                                        timeout=TIMEOUT) as r:
                bruto = r.read(200000).decode('utf-8')
        chaves = {}
        for k in json.loads(bruto).get('keys', []):
            try:
                chave = serialization.load_pem_public_key(str(k['pem']).encode('ascii'))
                if isinstance(chave, ec.EllipticCurvePublicKey) and isinstance(chave.curve, ec.SECP256R1):
                    chaves[str(k['keyId'])] = chave
            except (KeyError, ValueError, TypeError):
                continue
        return chaves

    def chave(self, key_id):
        """A chave pública `key_id`, ou None. O cache vale 24 h; um id desconhecido
        (a Google trocou as chaves) faz buscar de novo, no máximo uma vez por minuto."""
        t = time.time()
        with self._tranca:
            velho = t - self._lidas_em > CHAVES_VALEM
            if (velho or key_id not in self._chaves) and t - self._tentou_em > (0 if self.arquivo else CHAVES_DE_NOVO):
                self._tentou_em = t
                try:
                    novas = self._busca()
                    if novas:
                        self._chaves, self._lidas_em = novas, t
                except Exception as e:      # a rede, o JSON: fica o que havia
                    log.warning("anúncio: as chaves públicas do AdMob não vieram (%s)", e)
            return self._chaves.get(key_id)

    def confere(self, consulta):
        """A consulta CRUA do pedido da Google (como chegou, sem decodificar). Devolve os
        parâmetros (dict) se a assinatura confere; None se não. A mensagem assinada é tudo
        o que vem antes de '&signature='; a assinatura e o key_id são os dois últimos."""
        if not self.ligado or not isinstance(consulta, str) or not 0 < len(consulta) <= CONSULTA_MAX:
            return None
        corte = consulta.find('&signature=')
        if corte <= 0:
            return None
        mensagem, resto = consulta[:corte], urllib.parse.parse_qs(consulta[corte + 1:], keep_blank_values=True)
        try:
            assinatura = _b64url(resto['signature'][0])
            key_id = resto['key_id'][0]
        except (KeyError, IndexError, ValueError):
            return None
        chave = self.chave(key_id)
        if chave is None:
            return None
        try:
            chave.verify(assinatura, mensagem.encode('utf-8'), ec.ECDSA(hashes.SHA256()))
        except (InvalidSignature, ValueError):
            return None
        p = {k: v[0] for k, v in urllib.parse.parse_qs(mensagem, keep_blank_values=True).items()}
        p['key_id'] = key_id
        return p


_DESLIGADOS = Anuncios(ligado=False)


class AnuncioMixin:

    def _anuncios(self):
        a = getattr(self, 'anuncios', None)
        return a if a is not None else _DESLIGADOS

    def _anuncio_conta(self, cid):
        """O user_id que vai no anúncio e volta assinado pela Google: um hmac com o segredo do servidor."""
        segredo = self.segredo if isinstance(self.segredo, bytes) else str(self.segredo).encode('utf-8')
        return hmac.new(segredo, b'anuncio-conta:%d' % cid, hashlib.sha256).hexdigest()[:40]

    def _anuncio_hoje(self, cid, t):
        """Dentro da tranca: quantos prêmios de cada tipo a conta já ganhou no dia de Brasília de `t`."""
        hoje = {tipo: 0 for tipo in TIPOS}
        for r in self.con.execute("SELECT tipo, COUNT(*) FROM propaganda_premios WHERE conta_id = ? AND dia = ? "
                                  "GROUP BY tipo", (cid, dia_de(t))):
            if r[0] in hoje:
                hoje[r[0]] = r[1]
        return hoje

    def _anuncio_estado(self, cid, t):
        hoje = self._anuncio_hoje(cid, t)
        return {'limite': ANUNCIO_MAX_DIA, 'zeraEm': vira_em(t), 'agora': t,
                'premios': [{'tipo': tipo, 'qtd': PREMIOS[tipo], 'hoje': hoje[tipo], 'limite': ANUNCIO_MAX_DIA,
                             'faltam': max(0, ANUNCIO_MAX_DIA - hoje[tipo])} for tipo in TIPOS]}

    # -- GET /api/anuncio: o que a tela mostra (quantos hoje, quantos faltam, quando zera) ------------
    def anuncio_ver(self, conta, corpo):
        an = self._anuncios()
        if not an.ligado:
            raise Recusa(503, FRASE_DESLIGADO, anuncios=False)
        cid, t = conta['id'], agora()
        with self.tranca:
            estado = self._anuncio_estado(cid, t)
            saldo = self._barras_saldo(cid)
        estado.update({'ok': True, 'ligado': True, 'bloco': an.bloco, 'aparelhosTeste': list(an.aparelhos),
                       'mestre': bool(conta['gm']), 'barras': {'saldo': saldo}})
        return 200, estado

    # -- POST /api/anuncio/bilhete {tipo}: o bilhete de uso único que vai dentro do anúncio -----------
    def anuncio_bilhete(self, conta, corpo):
        an = self._anuncios()
        if not an.ligado:
            raise Recusa(503, FRASE_DESLIGADO, anuncios=False)
        tipo = corpo.get('tipo')
        if tipo not in TIPOS:
            raise Recusa(400, 'prêmio desconhecido')
        if conta['gm']:
            raise Recusa(403, FRASE_MESTRE, mestre=True)
        cid, t = conta['id'], agora()
        ip = self._chave_ip(corpo)
        with self._escrita():
            estado = self._anuncio_estado(cid, t)
            if self._anuncio_hoje(cid, t)[tipo] >= ANUNCIO_MAX_DIA:
                raise Recusa(409, 'o limite de hoje desse prêmio já foi atingido', limite=True,
                             zeraEm=estado['zeraEm'], premios=estado['premios'])
            chaves = [('anuncio:%d' % cid, BILHETES_POR_HORA)]
            if ip is not None:
                chaves.append(('anuncio-ip:%s' % ip, BILHETES_POR_HORA_IP))
            for chave, maximo in chaves:
                libera = self._conta_limite(chave, maximo, 3600, t)
                if libera is not None:
                    raise Recusa(429, 'anúncios demais nesta hora; tente de novo mais tarde', liberaEm=libera)
            for chave, _ in chaves:
                self._anota_limite(chave, t)
            bilhete = secrets.token_urlsafe(24)
            self.con.execute("INSERT INTO propaganda_bilhetes(bilhete, conta_id, tipo, criado_em) VALUES (?, ?, ?, ?)",
                             (bilhete, cid, tipo, t))
            self.con.execute("DELETE FROM propaganda_bilhetes WHERE criado_em < ?", (t - BILHETES_GUARDA,))
        return 201, {'ok': True, 'bilhete': bilhete, 'conta': self._anuncio_conta(cid), 'tipo': tipo,
                     'qtd': PREMIOS[tipo], 'vale': BILHETE_VALE, 'bloco': an.bloco}

    # -- GET /api/anuncio/premio?…&signature=…&key_id=…: quem chama é a GOOGLE (SSV) ------------------
    def anuncio_premio(self, conta, corpo):
        """Sem sessão: a ASSINATURA é a porta (403 sem ela). Com a assinatura boa a resposta é
        sempre 200 — a Google repete o pedido que não leva 200, e repetir um bilhete gasto ou
        um limite estourado não muda nada; `creditado` e `motivo` dizem o que houve."""
        an = self._anuncios()
        if not an.ligado:
            raise Recusa(503, FRASE_DESLIGADO, anuncios=False)
        p = an.confere(corpo.get('_consulta'))            # fora da tranca: pode buscar as chaves na Google
        if p is None:
            log.warning("anúncio: pedido de prêmio SEM assinatura válida (de %s)", corpo.get('_ip'))
            raise Recusa(403, 'assinatura inválida')

        def nada(motivo, cid=None, calado=False):
            (log.debug if calado else log.warning)("anúncio: prêmio assinado e NÃO creditado (%s; conta %s; transação %s)", motivo, cid,
                        p.get('transaction_id'))
            return 200, {'ok': True, 'creditado': False, 'motivo': motivo}

        if p.get('ad_unit') != an.unidade:
            return nada('bloco')
        transacao, bilhete, usuario = p.get('transaction_id') or '', p.get('custom_data') or '', p.get('user_id') or ''
        if not RE_TRANSACAO.match(transacao):
            return nada('transacao')
        if not RE_BILHETE.match(bilhete):                # o botão "verificar URL" do AdMob cai aqui: 200 e nada
            return nada('bilhete')
        t = agora()
        with self._escrita():
            if self.con.execute("SELECT 1 FROM propaganda_premios WHERE transacao = ?", (transacao,)).fetchone():
                return nada('repetido', calado=True)      # a Google repetindo o aviso: sem linha no log
            b = self.con.execute("SELECT * FROM propaganda_bilhetes WHERE bilhete = ?", (bilhete,)).fetchone()
            if b is None:
                return nada('bilhete')
            cid, tipo = b['conta_id'], b['tipo']
            if not hmac.compare_digest(usuario, self._anuncio_conta(cid)):
                return nada('outra-conta', cid)
            if b['usado_em'] is not None:
                return nada('bilhete-usado', cid)
            if t > b['criado_em'] + BILHETE_VALE:
                return nada('bilhete-vencido', cid)
            dona = self.con.execute("SELECT banido, gm FROM contas WHERE id = ?", (cid,)).fetchone()
            if dona is None or dona['banido'] or dona['gm']:
                return nada('conta', cid)
            # o bilhete é gasto mesmo quando o limite barra: um bilhete, um anúncio
            self.con.execute("UPDATE propaganda_bilhetes SET usado_em = ? WHERE bilhete = ?", (t, bilhete))
            if tipo not in PREMIOS or self._anuncio_hoje(cid, t)[tipo] >= ANUNCIO_MAX_DIA:
                return nada('limite', cid)          # sair do `with` sem erro grava o bilhete gasto
            qtd = PREMIOS[tipo]
            pid = self.con.execute(
                "INSERT INTO propaganda_premios(transacao, conta_id, bilhete, tipo, qtd, dia, chave, criado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (transacao, cid, bilhete, tipo, qtd, dia_de(t), p.get('key_id'), t)).lastrowid
            idem = 'anuncio-%d' % pid
            if tipo == 'barras':
                # o MESMO caminho da loja: o movimento no extrato e o saldo, juntos (motivo 'presente' no
                # banco, porque o CHECK da tabela não se altera; a `ref` é que diz que foi anúncio)
                self.barras_move(cid, qtd, 'presente', '%s%d' % (REF_BARRAS, pid), idem, t)
            else:
                # o caminho do presente de vinténs: um pedido de preço 0 que o jogo retira e o juiz confere
                self.credita(cid, SKU_VINTENS, qtd, 'presente', idem, None, t)
            self._evento(cid, 'anuncio-premio', {'premio': pid, 'tipo': tipo, 'qtd': qtd})
            dona_inteira = self.con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone()
        # com a autoridade ligada os vinténs entram na conta agora, como o presente (loja.py, _loja_na_hora);
        # sem ela (ou com a conta numa luta) o pedido fica aberto e o jogo o busca — nada se perde
        if tipo == 'vintens' and dona_inteira is not None:
            self._loja_na_hora(dict(dona_inteira))
        return 200, {'ok': True, 'creditado': True}
