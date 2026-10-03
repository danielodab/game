#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A MODERAÇÃO (02/10): banimento com prazo, silêncio no chat, denúncias de
jogador, o correio da Equipe, a auditoria do Mestre e o "pôr no inventário" do
painel do Mestre dentro do jogo.

Pedido do dono, para o lançamento: o Mestre age SEM sair do jogo (o painel do
Mestre no jogo, js/ui/painel_mestre.js), bane por um tempo ou para sempre com
motivo, silencia no chat por um tempo, recebe as denúncias numa fila com
estados, e toda ação dele fica num registro de auditoria.

Entra no cartório como mixin (`class Api(..., ModeracaoMixin)` no api.py). NÃO
faz `import api` (a armadilha do __main__, ver o topo do comum.py). As funções
de LEITURA do começo (banimento_lido, silencio_lido, le_*) servem também ao
Relé (servidor/rele.py e rele_ident.py), que abre o banco só para ler.

O BANIMENTO
  - A linha mora em `moderacao_banimentos` (tabela NOVA, nunca ALTER: o rolling
    update divide o banco). `contas.banido` continua sendo a CHAVE GERAL: com 0
    a conta não está banida, ponto — o ranking, os amigos, a guilda, a troca e
    o relé já leem esse 0/1 há meses, e o `admin desbanir` do Terminal o zera.
  - Banida = `contas.banido = 1` e (uma linha aberta em vigor OU nenhuma linha
    aberta). Sem linha nenhuma é o banimento de antes desta tabela (o `admin
    banir` velho, o UPDATE do SUBIR.md): permanente, sem motivo registrado.
  - O PRAZO vence sozinho, sem relógio de fundo: o próximo pedido da conta (o
    login, qualquer rota) vê a linha vencida, fecha-a como 'expirou' e zera
    `contas.banido`, numa transação. Até esse pedido o ranking ainda a esconde
    — e quem lê só para ler (o relé) confere o prazo na linha, não só o 0/1.
  - Toda rota com conta devolve 403 `{erro:'conta banida', banimento:{motivo,
    inicio, fim, permanente}}` (o jogo e o site mostram a tela com isso); o
    login também, DEPOIS da senha conferida (sem a senha, o motivo não sai).
    Só `logout` e `GET /api/moderacao/eu` passam (DO_BANIDO).
  - O Mestre não bane a si mesmo nem outra conta com a marca de Mestre (essa
    briga é do dono: `admin tirar-mestre` primeiro). Banir quem já está banido
    TROCA a linha (a velha fecha como 'trocado').

O SILÊNCIO: a mesma forma, em `moderacao_silencios`, sem chave geral — vale
pela linha. Quem para a fala é o Relé (rele.py): o chat da praça, o sussurro e
o /g da conta silenciada não saem, e ela ouve {t:'silenciado', fim, motivo}.

A DENÚNCIA: categoria + texto (até 500) + as últimas falas do alvo que o
denunciante VIU (marcadas `relato: 'cliente'` — o servidor não guarda o chat,
então é palavra do denunciante, e o painel diz isso). Freios no banco: 10 por
dia por denunciante e 1 por alvo por hora. Estados: aberta → em-analise →
procedente | improcedente; fechada é final. Na procedente o Mestre pode ligar a
ação (silenciar ou banir) na mesma transação. Ao fechar, o denunciante recebe
uma CARTA da Equipe (o correio do jogo, `moderacao_cartas`, GET /api/correio)
e, com o correio do servidor ligado, um e-mail — nunca com a punição aplicada.

A AUDITORIA: `moderacao_auditoria`, uma linha por ação do Mestre. As rotas
deste arquivo e as ops da Caixa do Mestre pelo /api/op (salas.py) a gravam NA
MESMA transação da ação; as outras rotas do Mestre (mestre.py, os eventos do
mundo) ganham a linha do gancho do despacha (api.py, `_audita_rota`) LOGO
DEPOIS de dar certo, numa transação própria (se ela falhar, a ação fica e o
log conta).

O "PÔR NO INVENTÁRIO" (POST /api/mestre/dar): pelo JUIZ, no estado que o
servidor guarda (ops internas `mestreDar*`, servidor/juiz/economia.js), como a
entrega da loja — nunca no save local. A resposta leva o estado novo quando o
alvo é o próprio Mestre: o jogo adota sem recarregar (JOGO.Autoridade). Sem
juiz, 503: a autoridade e o juiz não podem divergir.
  03/10 (o dono: "pode por itens no inventario do jogador tambem, alem do
  proprio dele"): o painel ficou ÚNICO e entrega de tudo o que a Caixa dá —
  peça (estrelas, forja, quantidade), conjunto, bicho, pedras, selos,
  insígnias, cartas, pergaminhos e dias de bônus de XP — em QUALQUER conta,
  com as réguas de TIPOS_DAR (e o juiz conferindo o teto do dado e a vaga do
  saco). Nunca numa lápide (conta excluída) nem numa banida. O jogador fica
  sabendo por `moderacao_entregas` (o /api/eu conta as não vistas; o jogo
  pergunta GET /api/entregas, mostra "O Mestre te enviou …" e adota o estado)
  e por uma carta da Equipe, que fica no correio. E ele não perde o que fez:
  cada entrega guarda o hash de antes e o de depois, e a op do jogador que
  chega com o hash de ANTES de uma corrente de entregas sobe por cima delas
  (salas.py, economia_op, `_rebase_entregas`) em vez de cair no 409.
  03/10 (revisão): cartas e bicho mudam o grupo que o juiz refaz no fim da
  luta — com uma luta aberta na conta de destino eles esperam (409 em-luta,
  TIPOS_DA_LUTA); e a entrega que não muda nada é 422 nada-mudou, sem aviso.
"""
import json
import logging
import os
import pathlib
import re
import sqlite3

from comum import EstadoMudou, Recusa, agora

log = logging.getLogger('api')

ESQUEMA_MODERACAO = """
-- 02/10: a moderação (servidor/moderacao.py). Tabelas NOVAS, nunca ALTER: no rolling
-- update do Coolify o contêiner velho e o novo sobem juntos no mesmo banco
CREATE TABLE IF NOT EXISTS moderacao_banimentos(
  id               INTEGER PRIMARY KEY,
  conta_id         INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  por              INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  motivo           TEXT NOT NULL,
  inicio           INTEGER NOT NULL,
  fim              INTEGER,
  denuncia_id      INTEGER,
  encerrado_em     INTEGER,
  encerrado_por    INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  encerrado_como   TEXT CHECK (encerrado_como IN ('expirou', 'desfeito', 'trocado')),
  encerrado_motivo TEXT
);
CREATE INDEX IF NOT EXISTS moderacao_banimentos_conta ON moderacao_banimentos(conta_id, encerrado_em);
CREATE TABLE IF NOT EXISTS moderacao_silencios(
  id               INTEGER PRIMARY KEY,
  conta_id         INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  por              INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  motivo           TEXT NOT NULL,
  inicio           INTEGER NOT NULL,
  fim              INTEGER,
  denuncia_id      INTEGER,
  encerrado_em     INTEGER,
  encerrado_por    INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  encerrado_como   TEXT CHECK (encerrado_como IN ('expirou', 'desfeito', 'trocado')),
  encerrado_motivo TEXT
);
CREATE INDEX IF NOT EXISTS moderacao_silencios_conta ON moderacao_silencios(conta_id, encerrado_em);
-- a denúncia sobrevive às contas (o histórico do Mestre): quem sai vira NULL e o nome fica
CREATE TABLE IF NOT EXISTS moderacao_denuncias(
  id              INTEGER PRIMARY KEY,
  denunciante_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  denunciante_nome TEXT,
  alvo_id         INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  alvo_nome       TEXT,
  categoria       TEXT NOT NULL CHECK (categoria IN ('ofensa', 'trapaca', 'nome', 'spam', 'outro')),
  texto           TEXT NOT NULL DEFAULT '',
  falas           TEXT,
  onde            TEXT,
  estado          TEXT NOT NULL DEFAULT 'aberta'
                  CHECK (estado IN ('aberta', 'em-analise', 'procedente', 'improcedente')),
  mestre_id       INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  nota            TEXT,
  resposta        TEXT,
  acao            TEXT,
  criado_em       INTEGER NOT NULL,
  atualizado_em   INTEGER NOT NULL,
  fechado_em      INTEGER
);
CREATE INDEX IF NOT EXISTS moderacao_denuncias_estado ON moderacao_denuncias(estado, id);
CREATE INDEX IF NOT EXISTS moderacao_denuncias_quem ON moderacao_denuncias(denunciante_id, criado_em);
CREATE INDEX IF NOT EXISTS moderacao_denuncias_alvo ON moderacao_denuncias(alvo_id, criado_em);
CREATE TABLE IF NOT EXISTS moderacao_auditoria(
  id         INTEGER PRIMARY KEY,
  mestre_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  mestre_nome TEXT,
  acao       TEXT NOT NULL,
  alvo_id    INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  dados      TEXT,
  idem       TEXT,
  criado_em  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS moderacao_auditoria_quando ON moderacao_auditoria(criado_em);
CREATE UNIQUE INDEX IF NOT EXISTS moderacao_auditoria_idem ON moderacao_auditoria(mestre_id, idem)
  WHERE idem IS NOT NULL;
-- o correio da Equipe para o jogador (o retorno da denúncia)
CREATE TABLE IF NOT EXISTS moderacao_cartas(
  id         INTEGER PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  assunto    TEXT NOT NULL,
  texto      TEXT NOT NULL,
  criado_em  INTEGER NOT NULL,
  lida_em    INTEGER
);
CREATE INDEX IF NOT EXISTS moderacao_cartas_conta ON moderacao_cartas(conta_id, id);
-- 03/10: o que o Mestre pôs no estado de uma conta (POST /api/mestre/dar). `avisar` = 1 quando a conta não é
-- a do próprio Mestre (o jogador vê "O Mestre te enviou …" e marca `visto_em`); os dois hashes são a corrente
-- que deixa a op do jogador, que saiu antes da entrega, subir por cima dela (salas.py, economia_op)
CREATE TABLE IF NOT EXISTS moderacao_entregas(
  id          INTEGER PRIMARY KEY,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  mestre_id   INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  tipo        TEXT NOT NULL,
  texto       TEXT NOT NULL,
  hash_antes  TEXT,
  hash_depois TEXT,
  avisar      INTEGER NOT NULL DEFAULT 1,
  criado_em   INTEGER NOT NULL,
  visto_em    INTEGER
);
CREATE INDEX IF NOT EXISTS moderacao_entregas_conta ON moderacao_entregas(conta_id, id);
"""

# ---- as réguas ------------------------------------------------------------------------
FRASE_BANIDA = 'conta banida'          # o texto de sempre do 403 (as provas antigas e o site o conhecem)
DURACOES = {'1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400}
PERMANENTE, PERSONALIZADO = 'permanente', 'personalizado'
PRAZO_MIN = 60                         # o personalizado começa em 1 minuto…
PRAZO_MAX = 10 * 365 * 86400           # …e vai até 10 anos (mais que isso é o permanente)
FRASE_DURACAO = ('duracao precisa ser 1h, 24h, 7d, 30d, permanente ou personalizado (com `ate`, o instante do '
                 'fim, de 1 minuto a 10 anos daqui)')
MOTIVO_MIN, MOTIVO_MAX = 3, 300
CATEGORIAS = {'ofensa': 'ofensa ou assédio', 'trapaca': 'trapaça ou abuso de bug', 'nome': 'nome impróprio',
              'spam': 'spam ou golpe', 'outro': 'outro'}
ESTADOS = ('aberta', 'em-analise', 'procedente', 'improcedente')
FECHADOS = ('procedente', 'improcedente')
ONDES = ('praca', 'chat', 'perfil', 'amigos', 'guilda', 'outro')
TEXTO_MAX = 500                        # o texto da denúncia
TEXTO_OUTRO_MIN = 10                   # 'outro' sem explicar não diz nada ao Mestre
FALAS_MAX, FALA_MAX = 20, 240          # as falas anexadas (o chat corta em 240)
DENUNCIAS_POR_DIA = 10                 # por denunciante, em 24 h corridas
DENUNCIA_ALVO_S = 3600                 # uma por alvo por hora, por denunciante
RESPOSTA_MAX = 500                     # o que o Mestre escreve ao denunciante (vai na carta)
NOTA_MAX = 1000                        # a nota interna do Mestre (o denunciante nunca vê)
LISTA_MAX = 100                        # as listas do painel
CARTAS_LISTA = 30
DAR_POR_HORA = 120                     # "pôr no inventário" por Mestre por hora (contado no banco)
DAR_ITEM_QTD = 20                      # cópias de uma vez (o saco tem fundo: o juiz confere a vaga)
DAR_SELOS_MAX = 999
# 03/10: o que o painel único entrega, a op do juiz de cada um e as réguas (as mesmas do juiz, que também
# confere o teto das estrelas e da forja no dado e a vaga do saco). Coerentes com o jogo: a Caixa dava +10
# e +100 de pedra, selo e insígnia; o pergaminho pára no teto do inventário (99); o bônus de XP, até 30 dias
TIPOS_DAR = {'item': 'mestreDarItem', 'set': 'mestreDarSet', 'pet': 'mestreDarPet', 'pedras': 'mestreDarPedras',
             'selos': 'mestreDarSelos', 'insignias': 'mestreDarInsignias', 'cartas': 'mestreDarCartas',
             'pergaminho': 'mestreDarPergaminho', 'bonus-xp': 'mestreDarBonusXp'}
DAR_PEDRAS_MAX = 1000
DAR_INSIGNIAS_MAX = 100
DAR_CARTAS_MAX = 500
DAR_PERGAMINHOS_MAX = 99
DAR_BONUS_DIAS_MAX = 30
PERGAMINHOS = ('xp', 'elemento')
ENTREGA_TEXTO_MAX = 160                # o "O Mestre te enviou …" (o texto vem do juiz, com os nomes do dado)
ENTREGAS_LISTA = 20                    # quantas o jogo busca de uma vez
CORRENTE_MAX = 30                      # quantas entregas seguidas a op do jogador atravessa (_rebase_entregas)
FRASE_LAPIDE = 'essa conta foi excluída pelo titular: o id é só a lápide dela'
# 03/10 (revisão): o que muda o GRUPO que o juiz refaz. A sala solo, a em grupo, o duelo, a Arena e a guerra
# fecham refazendo a luta com o Progress.battleParty do estado de AGORA (as estrelas da classe e o nível e as
# estrelas do bicho entram nos atributos). Cartas ou bicho entregues no meio da luta faziam o replay sair
# diferente do que o jogador jogou: a sala vencida caía como 'divergiu' — a trilha de fraude — e não pagava
# (medido: cartas no topo com a sala aberta → 422 "o fim da sala divergiu"). Esses dois tipos esperam a luta
# acabar; peça, pedra, selo, insígnia, pergaminho e bônus de XP não tocam no grupo e entram a qualquer hora.
# (O Eco Primordial refaz com a FOTO da abertura, supremo_estados: não segura nada.)
TIPOS_DA_LUTA = ('cartas', 'pet')
DAR_LUTA_JANELA = 2 * 3600             # luta aberta há mais que isso foi largada (a mesma régua da luta largada)
DAR_DUELO_JANELA = 3600                # o duelo sem resultado há mais de 1 h: os dois largaram (privacidade.py)
FRASE_EM_LUTA = ('essa conta está numa luta agora: cartas e bicho mudam o grupo que o servidor refaz no fim '
                 'dela, e a vitória do jogador cairia — mande quando a luta acabar (peças, pedras e o resto entram já)')
FRASE_NADA_MUDOU = 'nada mudou: essa conta já tem isso (a entrega não foi feita nem avisada)'
DADOS_MAX = 2000                       # o JSON de uma linha de auditoria
RE_IDEM = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
RE_ID_TEXTO = re.compile(r'^[a-z0-9_-]{1,64}$')
ELEMENTOS_SELO = ('fogo', 'agua', 'terra', 'ar', 'neutro')   # 03/10: o neutro também (a Caixa sempre deu)
TENTATIVAS = 3                          # quantas vezes refazer quando o estado muda no meio
FRASE_SEM_JUIZ = ('o juiz do servidor está fora: sem ele nada entra no inventário (a autoridade e o juiz não '
                  'podem divergir). Tente de novo em instantes')
FRASE_SEM_ESTADO = ('o servidor ainda não tem o estado desta conta: abra o jogo logado nela e deixe salvar uma vez')
MUDOU_NO_MEIO = 'o estado da conta mudou no meio — tente de novo'
# as rotas que a conta banida ainda alcança: sair, e saber POR QUE está banida (a tela do jogo e do site)
DO_BANIDO = frozenset({'logout', 'moderacao_eu'})
# as rotas do Mestre que gravam a PRÓPRIA linha de auditoria (na transação da ação); as outras
# rotas do Mestre ganham a linha do gancho genérico do despacha (_audita_rota)
AUDITA_SOZINHA = frozenset({'mestre_banir', 'mestre_desbanir', 'mestre_silenciar', 'mestre_dessilenciar',
                            'mestre_denuncia', 'mestre_dar', 'mestre_denuncias', 'mestre_banimentos',
                            'mestre_auditoria'})
CONTROLE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


# ---- funções puras ------------------------------------------------------------------------
def _id_valido(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 < v < 2 ** 53


def limpa_texto(v, maximo):
    """Texto aparado, sem caracteres de controle (o \\n e o \\t ficam), cortado em `maximo`."""
    if not isinstance(v, str):
        return ''
    return CONTROLE.sub('', v).strip()[:maximo]


def prazo_de(corpo, t):
    """(fim, rotulo): o instante em que a punição vence (None = permanente) e o nome
    da duração. Levanta o 400 da FRASE_DURACAO."""
    d = corpo.get('duracao')
    if isinstance(d, str) and d in DURACOES:
        return t + DURACOES[d], d
    if d == PERMANENTE:
        return None, d
    if d == PERSONALIZADO:
        ate = corpo.get('ate')
        if _id_valido(ate) and t + PRAZO_MIN <= ate <= t + PRAZO_MAX:
            return ate, d
    raise Recusa(400, FRASE_DURACAO)


def motivo_de(corpo, obrigatorio=True):
    m = limpa_texto(corpo.get('motivo'), MOTIVO_MAX + 1)
    if not m and not obrigatorio:
        return None
    if not MOTIVO_MIN <= len(m) <= MOTIVO_MAX:
        raise Recusa(400, 'motivo precisa ter de %d a %d caracteres' % (MOTIVO_MIN, MOTIVO_MAX))
    return m


def falas_de(v):
    """As falas que o denunciante viu do alvo: até FALAS_MAX, cada uma com o texto
    (até FALA_MAX) e o instante que o cliente diz (ms ou s; o que não for número
    vira None). Marcadas: é relato do cliente, o servidor não guarda o chat."""
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > FALAS_MAX:
        raise Recusa(400, 'falas precisa ser uma lista de até %d' % FALAS_MAX)
    fora = []
    for f in v:
        if not isinstance(f, dict):
            raise Recusa(400, 'cada fala precisa ser um objeto {texto, em}')
        texto = limpa_texto(f.get('texto'), FALA_MAX)
        if not texto:
            continue
        em = f.get('em')
        if isinstance(em, bool) or not isinstance(em, (int, float)) or not 0 < em < 1e14:
            em = None
        else:
            em = int(em if em < 1e11 else em // 1000)        # o relógio do navegador anda em ms
        fora.append({'texto': texto, 'em': em, 'relato': 'cliente'})
    return fora


def _json(texto, padrao=None):
    try:
        v = json.loads(texto) if texto else padrao
    except (TypeError, ValueError):
        return padrao
    return v


def _dados_auditoria(dados):
    """O JSON da linha de auditoria, cortado em DADOS_MAX (o corte fica marcado)."""
    try:
        s = json.dumps(dados, ensure_ascii=False, sort_keys=True, default=str)
    except (TypeError, ValueError):
        s = json.dumps({'torto': True})
    return s if len(s) <= DADOS_MAX else s[:DADOS_MAX - 12] + '…(cortado)'


def punicao_publica(r, para_mestre=False):
    """A linha de banimento/silêncio como o jogo e o site a mostram. Para o
    jogador, sem quem aplicou (`por` é coisa da Equipe)."""
    if r is None:
        return None
    p = {'id': r['id'], 'motivo': r['motivo'], 'inicio': r['inicio'], 'fim': r['fim'],
         'permanente': r['fim'] is None}
    if para_mestre:
        p.update(por=r['por'], denuncia=r['denuncia_id'], encerradoEm=r['encerrado_em'],
                 encerradoComo=r['encerrado_como'], encerradoMotivo=r['encerrado_motivo'])
    return p


BANIMENTO_LEGADO = {'id': None, 'motivo': None, 'inicio': None, 'fim': None, 'permanente': True, 'legado': True}


def _vigente(rows, t):
    """A linha aberta que vale agora (a de fim mais distante; permanente vence tudo), ou None."""
    melhor = None
    for r in rows:
        if r['fim'] is not None and r['fim'] <= t:
            continue
        if melhor is None or r['fim'] is None or (melhor['fim'] is not None and r['fim'] > melhor['fim']):
            melhor = r
    return melhor


def _abertas(con, tabela, conta_id):
    return con.execute("SELECT * FROM %s WHERE conta_id = ? AND encerrado_em IS NULL ORDER BY id" % tabela,
                       (conta_id,)).fetchall()


def _linha(con):
    con.row_factory = sqlite3.Row
    return con


# ---- as leituras que o Relé também faz (banco SÓ PARA LER) ---------------------------------------
def banimento_lido(con, conta_id, banido, t):
    """O banimento EM VIGOR da conta, só lendo (sem fechar a linha vencida): dict
    público ou None. `banido` é o contas.banido lido junto. Banco de antes desta
    tabela: o 0/1 manda (o banimento sem linha é o permanente de antes)."""
    if not banido:
        return None
    try:
        rows = _abertas(_linha(con), 'moderacao_banimentos', conta_id)
    except sqlite3.OperationalError as e:
        if 'no such table' in str(e):
            return dict(BANIMENTO_LEGADO)
        raise
    if not rows:
        return dict(BANIMENTO_LEGADO)
    return punicao_publica(_vigente(rows, t))


def silencio_lido(con, conta_id, t):
    """O silêncio em vigor da conta, só lendo: dict público ou None."""
    try:
        rows = _abertas(_linha(con), 'moderacao_silencios', conta_id)
    except sqlite3.OperationalError as e:
        if 'no such table' in str(e):
            return None
        raise
    return punicao_publica(_vigente(rows, t))


def _abre_leitura(caminho):
    """O banco SÓ PARA LER (mode=ro nunca cria nem escreve o arquivo), como o relé abre."""
    uri = pathlib.Path(os.path.abspath(caminho)).as_uri() + '?mode=ro'
    return sqlite3.connect(uri, uri=True, timeout=1.0)


def le_silencio(caminho, conta_id, t=None):
    """(silencio, definitivo) para o Relé: o dict público do silêncio em vigor (ou
    None) e False quando o banco não respondeu. Síncrona: o relé chama numa thread."""
    t = agora() if t is None else t
    try:
        con = _abre_leitura(caminho)
    except (sqlite3.Error, ValueError, OSError):
        return None, False
    try:
        return silencio_lido(con, conta_id, t), True
    except sqlite3.Error:
        return None, False
    finally:
        con.close()


def le_banimento_do_token(caminho, token, t=None):
    """(banimento, definitivo) para o Relé: o token é de uma sessão VÁLIDA de conta
    banida agora? Só chamada quando a conferência de identidade já recusou o token
    (rele_ident.confere), para dizer ao cliente POR QUÊ e fechar a conexão."""
    t = agora() if t is None else t
    if not isinstance(token, str) or not token:
        return None, True
    try:
        con = _abre_leitura(caminho)
    except (sqlite3.Error, ValueError, OSError):
        return None, False
    try:
        r = con.execute("SELECT c.id, c.banido FROM sessoes s JOIN contas c ON c.id = s.conta_id WHERE s.token = ?",
                        (token,)).fetchone()
        if r is None:
            return None, True
        return banimento_lido(con, r[0], r[1], t), True
    except sqlite3.Error:
        return None, False
    finally:
        con.close()


def banida_de_fato(con, conta_id, t):
    """Para o rele_ident.confere: contas.banido = 1 é banimento AGORA? False quando
    as linhas abertas venceram todas (a API ainda não fechou: ninguém da conta
    pediu nada depois do prazo)."""
    try:
        return banimento_lido(con, conta_id, 1, t) is not None
    except sqlite3.Error:
        return True                     # na dúvida, fecha por padrão (o banco não deixou ler a linha)


# ---- o mixin --------------------------------------------------------------------------------
class ModeracaoMixin:

    # -- a auditoria ------------------------------------------------------------------------
    def _audita(self, mestre, acao, alvo_id, dados, idem=None, t=None):
        """Dentro de uma _escrita: a linha da ação do Mestre (a mesma transação da ação)."""
        nome = mestre.get('nome') if isinstance(mestre, dict) else None
        mid = mestre['id'] if isinstance(mestre, dict) else mestre
        self.con.execute("INSERT INTO moderacao_auditoria(mestre_id, mestre_nome, acao, alvo_id, dados, idem, criado_em) "
                         "VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (mid, nome, acao, alvo_id if _id_valido(alvo_id) else None, _dados_auditoria(dados), idem,
                          agora() if t is None else t))

    def _audita_rota(self, conta, metodo, nome, corpo, resultado):
        """O gancho do despacha (api.py): a rota do Mestre que não grava a própria
        linha (presentes, barras, alertas, eventos do mundo…) ganha uma aqui, depois
        de dar certo. As de LEITURA ficam de fora, menos a ficha da conta (ela mostra
        o e-mail inteiro). O termo da busca não entra inteiro (o e-mail fica mascarado,
        como no painel)."""
        if nome in AUDITA_SOZINHA:
            return
        status = resultado[0] if isinstance(resultado, tuple) and resultado else 200
        if not isinstance(status, int) or status >= 400:
            return
        if metodo == 'GET' and nome != 'mestre_conta':
            return
        dados = {k: v for k, v in (corpo or {}).items() if isinstance(k, str) and not k.startswith('_')}
        q = (corpo or {}).get('_query') or {}
        if nome == 'mestre_contas':
            termo = dados.get('q')
            dados = {'busca': ('%s***@%s' % (termo.split('@')[0][:2], termo.rsplit('@', 1)[1]))
                     if isinstance(termo, str) and '@' in termo else termo}
        alvo = dados.get('conta')
        if not _id_valido(alvo):
            try:
                alvo = int(q.get('id') or q.get('conta') or 0) or None
            except (TypeError, ValueError):
                alvo = None
        if q:
            dados['consulta'] = {k: v for k, v in q.items() if isinstance(k, str)}
        try:
            with self._escrita():
                self._audita(conta, nome.replace('mestre_', '').replace('_', '-'), alvo, dados)
        except sqlite3.Error:
            log.exception("auditoria: a linha de %s não foi gravada", nome)

    # -- o banimento ------------------------------------------------------------------------
    def _ban_atual(self, conta, t=None):
        """O banimento em vigor da conta (dict público) ou None. Fecha aqui as linhas
        vencidas e, sem nenhuma em vigor, zera contas.banido (o prazo venceu): numa
        _escrita própria. Chamada só com contas.banido = 1 (o despacha e o login)."""
        if not conta or not conta['banido']:      # dict da sessão ou sqlite3.Row do login
            return None
        t = agora() if t is None else t
        cid = conta['id']
        # primeiro SÓ LENDO: a conta banida que insiste (cada pedido dela passa por aqui) não
        # pega a trava de escrita do banco; a _escrita só abre quando há linha vencida a fechar
        with self.tranca:
            r = self.con.execute("SELECT banido FROM contas WHERE id = ?", (cid,)).fetchone()
            if r is None or not r['banido']:
                return None
            rows = _abertas(self.con, 'moderacao_banimentos', cid)
            if not rows:
                return dict(BANIMENTO_LEGADO)       # o banimento de antes desta tabela: permanente
            if not any(x['fim'] is not None and x['fim'] <= t for x in rows):
                return punicao_publica(_vigente(rows, t))
        with self._escrita():
            r = self.con.execute("SELECT banido FROM contas WHERE id = ?", (cid,)).fetchone()
            if r is None or not r['banido']:
                return None                         # desbanida entre a leitura da sessão e agora
            rows = _abertas(self.con, 'moderacao_banimentos', cid)
            if not rows:
                return dict(BANIMENTO_LEGADO)       # o banimento de antes desta tabela: permanente
            vencidas = [x for x in rows if x['fim'] is not None and x['fim'] <= t]
            for x in vencidas:
                self.con.execute("UPDATE moderacao_banimentos SET encerrado_em = ?, encerrado_como = 'expirou' "
                                 "WHERE id = ? AND encerrado_em IS NULL", (x['fim'], x['id']))
            vigente = _vigente(rows, t)
            if vigente is None:
                self.con.execute("UPDATE contas SET banido = 0 WHERE id = ?", (cid,))
                self._evento(cid, 'ban-expirou', {'ids': [x['id'] for x in vencidas]})
                log.info("moderação: o banimento de #%d venceu", cid)
                return None
            return punicao_publica(vigente)

    def _e_lapide(self, conta_id):
        """03/10 (junção com a frente da conta): a conta foi excluída e o id é a LÁPIDE dela
        (servidor/privacidade.py: nome 'excluída#id', banido = 1, senha impossível). Ninguém pune
        nem desbane uma lápide — desbanida, ela voltaria às listas como conta comum."""
        try:
            return self.con.execute("SELECT 1 FROM contas_excluidas WHERE conta_id = ?",
                                    (conta_id,)).fetchone() is not None
        except sqlite3.OperationalError:   # um banco sem a tabela da privacidade
            return False

    def _alvo_para_punir(self, mestre, alvo_id, palavra):
        """Dentro de uma _escrita: a linha da conta alvo, com as regras de quem pode ser punido."""
        if not _id_valido(alvo_id):
            raise Recusa(400, 'conta precisa ser o número da conta')
        if alvo_id == mestre['id']:
            raise Recusa(409, 'o Mestre não %s a si mesmo' % palavra)
        alvo = self.con.execute("SELECT * FROM contas WHERE id = ?", (alvo_id,)).fetchone()
        if alvo is None:
            raise Recusa(404, 'conta não encontrada')
        if self._e_lapide(alvo_id):
            raise Recusa(409, FRASE_LAPIDE)
        if alvo['gm']:
            raise Recusa(409, 'essa conta tem a marca de Mestre: tire a marca no Terminal (admin tirar-mestre) antes')
        return alvo

    def _fecha_vencidas(self, tabela, conta_id, t):
        """Dentro de uma _escrita: as linhas abertas cujo prazo já passou fecham como 'expirou', no
        instante do fim delas. O silêncio nunca é fechado pelo prazo (vale pela linha) e o banimento
        vencido só fecha no próximo pedido DA CONTA: sem isto, punir de novo ou desfazer depois do
        prazo gravava a linha velha como 'trocado'/'desfeito', e o histórico do Mestre mentia."""
        self.con.execute("UPDATE %s SET encerrado_em = fim, encerrado_como = 'expirou' WHERE conta_id = ? "
                         "AND encerrado_em IS NULL AND fim IS NOT NULL AND fim <= ?" % tabela, (conta_id, t))

    def _pune(self, tabela, mestre, alvo, fim, motivo, denuncia_id, t):
        """Dentro de uma _escrita: a linha nova (a aberta de antes fecha como 'trocado'; a vencida, 'expirou')."""
        self._fecha_vencidas(tabela, alvo['id'], t)
        self.con.execute("UPDATE %s SET encerrado_em = ?, encerrado_por = ?, encerrado_como = 'trocado' "
                         "WHERE conta_id = ? AND encerrado_em IS NULL" % tabela, (t, mestre['id'], alvo['id']))
        lid = self.con.execute(
            "INSERT INTO %s(conta_id, por, motivo, inicio, fim, denuncia_id) VALUES (?, ?, ?, ?, ?, ?)" % tabela,
            (alvo['id'], mestre['id'], motivo, t, fim, denuncia_id)).lastrowid
        return self.con.execute("SELECT * FROM %s WHERE id = ?" % tabela, (lid,)).fetchone()

    def _bane_dentro(self, mestre, alvo, fim, rotulo, motivo, denuncia_id, t):
        r = self._pune('moderacao_banimentos', mestre, alvo, fim, motivo, denuncia_id, t)
        self.con.execute("UPDATE contas SET banido = 1 WHERE id = ?", (alvo['id'],))
        self._evento(alvo['id'], 'banido', {'id': r['id'], 'por': mestre['id'], 'fim': fim, 'duracao': rotulo})
        self._audita(mestre, 'banir', alvo['id'], {'id': r['id'], 'duracao': rotulo, 'fim': fim, 'motivo': motivo,
                                                    'denuncia': denuncia_id}, t=t)
        log.info("moderação: #%d baniu #%d (%s)", mestre['id'], alvo['id'], rotulo)
        return r

    def _silencia_dentro(self, mestre, alvo, fim, rotulo, motivo, denuncia_id, t):
        r = self._pune('moderacao_silencios', mestre, alvo, fim, motivo, denuncia_id, t)
        self._evento(alvo['id'], 'silenciado', {'id': r['id'], 'por': mestre['id'], 'fim': fim, 'duracao': rotulo})
        self._audita(mestre, 'silenciar', alvo['id'], {'id': r['id'], 'duracao': rotulo, 'fim': fim, 'motivo': motivo,
                                                        'denuncia': denuncia_id}, t=t)
        log.info("moderação: #%d silenciou #%d (%s)", mestre['id'], alvo['id'], rotulo)
        return r

    def _desfaz(self, tabela, mestre, alvo_id, motivo, t):
        """Dentro de uma _escrita: fecha as linhas abertas como 'desfeito' (as vencidas, como 'expirou').
        Devolve quantas foram desfeitas."""
        self._fecha_vencidas(tabela, alvo_id, t)
        return self.con.execute(
            "UPDATE %s SET encerrado_em = ?, encerrado_por = ?, encerrado_como = 'desfeito', encerrado_motivo = ? "
            "WHERE conta_id = ? AND encerrado_em IS NULL" % tabela, (t, mestre['id'], motivo, alvo_id)).rowcount

    # -- POST /api/mestre/banir {conta, duracao, ate?, motivo} --------------------------------------
    def mestre_banir(self, conta, corpo):
        t = agora()
        fim, rotulo = prazo_de(corpo, t)
        motivo = motivo_de(corpo)
        with self._escrita():
            alvo = self._alvo_para_punir(conta, corpo.get('conta'), 'bane')
            r = self._bane_dentro(conta, alvo, fim, rotulo, motivo, None, t)
        return 201, {'ok': True, 'banimento': punicao_publica(r, True), 'conta': {'id': alvo['id'], 'nome': alvo['nome']}}

    # -- POST /api/mestre/desbanir {conta, motivo?} -------------------------------------------------
    def mestre_desbanir(self, conta, corpo):
        alvo_id = corpo.get('conta')
        if not _id_valido(alvo_id):
            raise Recusa(400, 'conta precisa ser o número da conta')
        motivo = motivo_de(corpo, obrigatorio=False)
        t = agora()
        with self._escrita():
            alvo = self.con.execute("SELECT id, nome, banido FROM contas WHERE id = ?", (alvo_id,)).fetchone()
            if alvo is None:
                raise Recusa(404, 'conta não encontrada')
            if self._e_lapide(alvo_id):
                raise Recusa(409, 'essa conta foi excluída pelo titular: o id é só a lápide dela')
            n = self._desfaz('moderacao_banimentos', conta, alvo_id, motivo, t)
            if not alvo['banido'] and not n:
                raise Recusa(409, 'essa conta não está banida')
            self.con.execute("UPDATE contas SET banido = 0 WHERE id = ?", (alvo_id,))
            self._evento(alvo_id, 'desbanido', {'por': conta['id'], 'linhas': n})
            self._audita(conta, 'desbanir', alvo_id, {'motivo': motivo, 'linhas': n}, t=t)
        log.info("moderação: #%d desbaniu #%d", conta['id'], alvo_id)
        return 200, {'ok': True, 'conta': {'id': alvo['id'], 'nome': alvo['nome']}}

    # -- POST /api/mestre/silenciar {conta, duracao, ate?, motivo} -----------------------------------
    def mestre_silenciar(self, conta, corpo):
        t = agora()
        fim, rotulo = prazo_de(corpo, t)
        motivo = motivo_de(corpo)
        with self._escrita():
            alvo = self._alvo_para_punir(conta, corpo.get('conta'), 'silencia')
            r = self._silencia_dentro(conta, alvo, fim, rotulo, motivo, None, t)
        return 201, {'ok': True, 'silencio': punicao_publica(r, True), 'conta': {'id': alvo['id'], 'nome': alvo['nome']}}

    # -- POST /api/mestre/dessilenciar {conta, motivo?} ----------------------------------------------
    def mestre_dessilenciar(self, conta, corpo):
        alvo_id = corpo.get('conta')
        if not _id_valido(alvo_id):
            raise Recusa(400, 'conta precisa ser o número da conta')
        motivo = motivo_de(corpo, obrigatorio=False)
        t = agora()
        with self._escrita():
            alvo = self.con.execute("SELECT id, nome FROM contas WHERE id = ?", (alvo_id,)).fetchone()
            if alvo is None:
                raise Recusa(404, 'conta não encontrada')
            vigente = _vigente(_abertas(self.con, 'moderacao_silencios', alvo_id), t)
            n = self._desfaz('moderacao_silencios', conta, alvo_id, motivo, t)
            if vigente is None:
                raise Recusa(409, 'essa conta não está silenciada')
            self._evento(alvo_id, 'dessilenciado', {'por': conta['id'], 'linhas': n})
            self._audita(conta, 'dessilenciar', alvo_id, {'motivo': motivo, 'linhas': n}, t=t)
        return 200, {'ok': True, 'conta': {'id': alvo['id'], 'nome': alvo['nome']}}

    # -- GET /api/moderacao/eu (passa com a conta banida: a tela do banimento lê daqui) ---------------
    def moderacao_eu(self, conta, corpo):
        t = agora()
        ban = self._ban_atual(conta, t) if conta['banido'] else None
        with self.tranca:
            sil = silencio_lido(self.con, conta['id'], t)
        return 200, {'ok': True, 'agora': t, 'banimento': ban, 'silencio': sil}

    def _moderacao_da_conta(self, alvo_id, t):
        """Dentro da tranca: o que a ficha do Mestre mostra da conta (mestre.py, a ficha)."""
        bans = self.con.execute("SELECT * FROM moderacao_banimentos WHERE conta_id = ? ORDER BY id DESC LIMIT 20",
                                (alvo_id,)).fetchall()
        sils = self.con.execute("SELECT * FROM moderacao_silencios WHERE conta_id = ? ORDER BY id DESC LIMIT 20",
                                (alvo_id,)).fetchall()
        banido = self.con.execute("SELECT banido FROM contas WHERE id = ?", (alvo_id,)).fetchone()
        contra = self.con.execute("SELECT estado, COUNT(*) FROM moderacao_denuncias WHERE alvo_id = ? GROUP BY estado",
                                  (alvo_id,)).fetchall()
        return {'banimento': banimento_lido(self.con, alvo_id, banido['banido'] if banido else 0, t),
                'silencio': silencio_lido(self.con, alvo_id, t),
                'banimentos': [punicao_publica(r, True) for r in bans],
                'silencios': [punicao_publica(r, True) for r in sils],
                'denuncias': {r[0]: r[1] for r in contra}}

    # -- GET /api/mestre/banimentos[?conta=N][&todos=1] ---------------------------------------------
    def mestre_banimentos(self, conta, corpo):
        q = corpo.get('_query') or {}
        alvo = q.get('conta')
        todos = q.get('todos') == '1'
        t = agora()
        with self.tranca:
            sql = ("SELECT b.*, c.nome AS conta_nome, c.banido AS conta_banido, m.nome AS por_nome, "
                   "k.nome AS encerrado_nome FROM %s b LEFT JOIN contas c ON c.id = b.conta_id "
                   "LEFT JOIN contas m ON m.id = b.por LEFT JOIN contas k ON k.id = b.encerrado_por ")
            args, onde = [], []
            if alvo is not None:
                if not isinstance(alvo, str) or not alvo.isdigit():
                    raise Recusa(400, 'conta precisa ser o número da conta')
                onde.append("b.conta_id = ?")
                args.append(int(alvo))
            if not todos:
                onde.append("b.encerrado_em IS NULL AND (b.fim IS NULL OR b.fim > ?)")
                args.append(t)
            fim = (" WHERE " + " AND ".join(onde) if onde else "") + " ORDER BY b.id DESC LIMIT ?"
            listas = {}
            for chave, tabela in (('banimentos', 'moderacao_banimentos'), ('silencios', 'moderacao_silencios')):
                linhas = self.con.execute(sql % tabela + fim, args + [LISTA_MAX]).fetchall()
                fora = []
                for r in linhas:
                    p = punicao_publica(r, True)
                    p.update(conta={'id': r['conta_id'], 'nome': r['conta_nome']},
                             porNome=r['por_nome'], encerradoPorNome=r['encerrado_nome'],
                             ativo=(r['encerrado_em'] is None and (r['fim'] is None or r['fim'] > t)
                                    and (chave == 'silencios' or bool(r['conta_banido']))))
                    fora.append(p)
                listas[chave] = fora
            # o banimento de antes desta tabela (o `admin banir` velho): banida sem linha nenhuma aberta
            legado = self.con.execute(
                "SELECT c.id, c.nome FROM contas c WHERE c.banido = 1 AND NOT EXISTS (SELECT 1 FROM "
                "moderacao_banimentos b WHERE b.conta_id = c.id AND b.encerrado_em IS NULL)"
                # 03/10: a lápide da conta excluída (privacidade.py) tem banido = 1 e não é banimento
                " AND NOT EXISTS (SELECT 1 FROM contas_excluidas x WHERE x.conta_id = c.id)"
                + (" AND c.id = ?" if alvo is not None else "") + " ORDER BY c.id LIMIT ?",
                ([int(alvo)] if alvo is not None else []) + [LISTA_MAX]).fetchall()
        listas['legado'] = [{'conta': {'id': r['id'], 'nome': r['nome']}, 'permanente': True, 'motivo': None,
                             'ativo': True, 'legado': True} for r in legado]
        return 200, dict(ok=True, agora=t, **listas)

    # -- POST /api/denuncia (o jogador) -------------------------------------------------------------
    def denuncia_criar(self, conta, corpo):
        alvo_id = corpo.get('alvo')
        if not _id_valido(alvo_id):
            raise Recusa(400, 'alvo precisa ser o número da conta de quem você denuncia')
        if alvo_id == conta['id']:
            raise Recusa(400, 'você não pode denunciar a si mesmo')
        categoria = corpo.get('categoria')
        if categoria not in CATEGORIAS:
            raise Recusa(400, 'categoria precisa ser uma de: %s' % ', '.join(CATEGORIAS))
        texto = corpo.get('texto')
        if texto is not None and not isinstance(texto, str):
            raise Recusa(400, 'texto precisa ser um texto')
        texto = limpa_texto(texto, TEXTO_MAX + 1)
        if len(texto) > TEXTO_MAX:
            raise Recusa(400, 'o texto vai até %d caracteres' % TEXTO_MAX)
        if categoria == 'outro' and len(texto) < TEXTO_OUTRO_MIN:
            raise Recusa(400, 'em "outro", conte o que aconteceu (pelo menos %d caracteres)' % TEXTO_OUTRO_MIN)
        falas = falas_de(corpo.get('falas'))
        onde = corpo.get('onde') if corpo.get('onde') in ONDES else 'outro'
        t = agora()
        with self._escrita():
            alvo = self.con.execute("SELECT id, nome FROM contas WHERE id = ?", (alvo_id,)).fetchone()
            if alvo is None or self._e_lapide(alvo_id):   # 03/10 (revisão): a lápide 'excluída#id' não se denuncia
                raise Recusa(404, 'essa conta não existe mais')
            # os freios no BANCO (valem entre os dois processos do rolling update)
            dia = [r[0] for r in self.con.execute(
                "SELECT criado_em FROM moderacao_denuncias WHERE denunciante_id = ? AND criado_em > ? ORDER BY criado_em",
                (conta['id'], t - 86400))]
            if len(dia) >= DENUNCIAS_POR_DIA:
                raise Recusa(429, 'são %d denúncias por dia; a próxima vaga abre mais tarde' % DENUNCIAS_POR_DIA,
                             liberaEm=dia[len(dia) - DENUNCIAS_POR_DIA] + 86400)
            ja = self.con.execute(
                "SELECT MAX(criado_em) FROM moderacao_denuncias WHERE denunciante_id = ? AND alvo_id = ? AND criado_em > ?",
                (conta['id'], alvo_id, t - DENUNCIA_ALVO_S)).fetchone()[0]
            if ja is not None:
                raise Recusa(429, 'você já denunciou essa pessoa na última hora: a Equipe já está olhando',
                             liberaEm=ja + DENUNCIA_ALVO_S)
            did = self.con.execute(
                "INSERT INTO moderacao_denuncias(denunciante_id, denunciante_nome, alvo_id, alvo_nome, categoria, "
                "texto, falas, onde, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (conta['id'], conta['nome'], alvo_id, alvo['nome'], categoria, texto,
                 json.dumps(falas, ensure_ascii=False) if falas else None, onde, t, t)).lastrowid
            self._evento(conta['id'], 'denuncia', {'id': did, 'alvo': alvo_id, 'categoria': categoria})
        log.info("moderação: #%d denunciou #%d (%s, denúncia %d)", conta['id'], alvo_id, categoria, did)
        # 03/10 (revisão): sem o nome — a resposta transformava qualquer número de conta em nome (o "por" de
        # um evento antigo dizia quem puniu); o denunciante já sabe de quem fala
        return 201, {'ok': True, 'denuncia': {'id': did, 'estado': 'aberta', 'alvo': {'id': alvo_id}}}

    def _denuncia_json(self, r, contra=None):
        acao = _json(r['acao'])
        return {'id': r['id'], 'estado': r['estado'], 'categoria': r['categoria'],
                'categoriaNome': CATEGORIAS.get(r['categoria'], r['categoria']), 'texto': r['texto'],
                'falas': _json(r['falas'], []), 'onde': r['onde'], 'criadoEm': r['criado_em'],
                'atualizadoEm': r['atualizado_em'], 'fechadoEm': r['fechado_em'],
                'denunciante': {'id': r['denunciante_id'], 'nome': r['denunciante_nome']},
                'alvo': {'id': r['alvo_id'], 'nome': r['alvo_atual'] or r['alvo_nome'], 'nomeNaHora': r['alvo_nome'],
                         'banido': bool(r['alvo_banido'])},
                'mestre': {'id': r['mestre_id'], 'nome': r['mestre_nome']} if r['mestre_id'] is not None else None,
                'nota': r['nota'], 'resposta': r['resposta'], 'acao': acao,
                'contraAlvo': contra}

    CONSULTA_DENUNCIA = ("SELECT d.*, a.nome AS alvo_atual, a.banido AS alvo_banido, m.nome AS mestre_nome "
                         "FROM moderacao_denuncias d LEFT JOIN contas a ON a.id = d.alvo_id "
                         "LEFT JOIN contas m ON m.id = d.mestre_id")

    # -- GET /api/mestre/denuncias[?estado=aberta|em-analise|procedente|improcedente|todas][&alvo=N] -----
    def mestre_denuncias(self, conta, corpo):
        q = corpo.get('_query') or {}
        estado = q.get('estado') or 'abertas'
        onde, args = [], []
        if estado == 'abertas':
            onde.append("d.estado IN ('aberta', 'em-analise')")
        elif estado in ESTADOS:
            onde.append("d.estado = ?")
            args.append(estado)
        elif estado != 'todas':
            raise Recusa(400, 'estado precisa ser abertas, todas ou um de: %s' % ', '.join(ESTADOS))
        if q.get('alvo') is not None:
            a = q.get('alvo')
            if not isinstance(a, str) or not a.isdigit():
                raise Recusa(400, 'alvo precisa ser o número da conta')
            onde.append("d.alvo_id = ?")
            args.append(int(a))
        t = agora()
        with self.tranca:
            linhas = self.con.execute(self.CONSULTA_DENUNCIA + (" WHERE " + " AND ".join(onde) if onde else "")
                                      + " ORDER BY (d.estado IN ('aberta', 'em-analise')) DESC, d.id DESC LIMIT ?",
                                      args + [LISTA_MAX]).fetchall()
            contas = {r['alvo_id'] for r in linhas if r['alvo_id'] is not None}
            contra = {}
            for cid in contas:
                contra[cid] = self.con.execute("SELECT COUNT(*) FROM moderacao_denuncias WHERE alvo_id = ?",
                                               (cid,)).fetchone()[0]
            silenciados = {cid for cid in contas if silencio_lido(self.con, cid, t) is not None}
            contagem = {e: 0 for e in ESTADOS}
            for e, n in self.con.execute("SELECT estado, COUNT(*) FROM moderacao_denuncias GROUP BY estado"):
                contagem[e] = n
        fora = []
        for r in linhas:
            d = self._denuncia_json(r, contra.get(r['alvo_id']))
            d['alvo']['silenciado'] = r['alvo_id'] in silenciados
            fora.append(d)
        return 200, {'ok': True, 'agora': t, 'denuncias': fora, 'contagem': contagem}

    # -- POST /api/mestre/denuncia {id, estado, resposta?, nota?, acao?: {tipo, duracao, ate?, motivo?}} ------
    def mestre_denuncia(self, conta, corpo):
        did, novo = corpo.get('id'), corpo.get('estado')
        if not _id_valido(did):
            raise Recusa(400, 'id precisa ser o número da denúncia')
        if novo not in ESTADOS or novo == 'aberta':
            raise Recusa(400, 'estado precisa ser em-analise, procedente ou improcedente')
        resposta = limpa_texto(corpo.get('resposta'), RESPOSTA_MAX + 1)
        nota = limpa_texto(corpo.get('nota'), NOTA_MAX + 1)
        if len(resposta) > RESPOSTA_MAX or len(nota) > NOTA_MAX:
            raise Recusa(400, 'a resposta vai até %d caracteres e a nota até %d' % (RESPOSTA_MAX, NOTA_MAX))
        acao = corpo.get('acao')
        t = agora()
        prazo = None
        if acao is not None:
            if novo != 'procedente':
                raise Recusa(400, 'a ação (silenciar ou banir) só vai junto da denúncia procedente')
            if not isinstance(acao, dict) or acao.get('tipo') not in ('silenciar', 'banir'):
                raise Recusa(400, 'acao.tipo precisa ser silenciar ou banir')
            prazo = prazo_de(acao, t)
        carta = None
        with self._escrita():
            r = self.con.execute(self.CONSULTA_DENUNCIA + " WHERE d.id = ?", (did,)).fetchone()
            if r is None:
                raise Recusa(404, 'denúncia não encontrada')
            if r['estado'] in FECHADOS:
                raise Recusa(409, 'essa denúncia já foi fechada (%s)' % r['estado'])
            if r['estado'] == novo:
                raise Recusa(409, 'a denúncia já está %s' % novo)
            feito = None
            if acao is not None:
                if r['alvo_id'] is None:
                    raise Recusa(409, 'a conta denunciada não existe mais: não há quem punir')
                motivo = motivo_de(acao, obrigatorio=False) or (
                    'denúncia %d procedente (%s)' % (did, CATEGORIAS.get(r['categoria'])))
                alvo = self._alvo_para_punir(conta, r['alvo_id'], 'bane' if acao['tipo'] == 'banir' else 'silencia')
                fim, rotulo = prazo
                if acao['tipo'] == 'banir':
                    p = self._bane_dentro(conta, alvo, fim, rotulo, motivo, did, t)
                else:
                    p = self._silencia_dentro(conta, alvo, fim, rotulo, motivo, did, t)
                feito = {'tipo': acao['tipo'], 'id': p['id'], 'duracao': rotulo, 'fim': fim}
            fecha = novo in FECHADOS
            self.con.execute(
                "UPDATE moderacao_denuncias SET estado = ?, mestre_id = ?, nota = COALESCE(?, nota), "
                "resposta = COALESCE(?, resposta), acao = COALESCE(?, acao), atualizado_em = ?, fechado_em = ? "
                "WHERE id = ?",
                (novo, conta['id'], nota or None, resposta or None,
                 json.dumps(feito, ensure_ascii=False) if feito else None, t, t if fecha else None, did))
            self._audita(conta, 'denuncia', r['alvo_id'], {'id': did, 'de': r['estado'], 'para': novo,
                                                            'acao': feito, 'resposta': bool(resposta)}, t=t)
            if fecha and r['denunciante_id'] is not None:
                carta = self._carta_da_denuncia(r, novo, resposta, t)
            r = self.con.execute(self.CONSULTA_DENUNCIA + " WHERE d.id = ?", (did,)).fetchone()
            d = self._denuncia_json(r)
        if carta is not None:
            self._email_da_carta(*carta)
        log.info("moderação: #%d pôs a denúncia %d em %s", conta['id'], did, novo)
        return 200, {'ok': True, 'denuncia': d}

    def _carta_da_denuncia(self, r, estado, resposta, t):
        """Dentro de uma _escrita: a carta da Equipe ao denunciante. Nunca diz a punição
        (é da conta de outra pessoa); diz só se a Equipe achou que procedia."""
        alvo = r['alvo_nome'] or 'o jogador'
        assunto = 'Sua denúncia foi analisada'
        if estado == 'procedente':
            miolo = ('A Equipe analisou a sua denúncia contra %s (%s) e concordou com você: '
                     'as medidas cabíveis foram tomadas. Obrigado por ajudar a manter o mundo enterrado em paz.'
                     % (alvo, CATEGORIAS.get(r['categoria'])))
        else:
            miolo = ('A Equipe analisou a sua denúncia contra %s (%s) e não encontrou violação das regras '
                     'desta vez. Obrigado por avisar — se acontecer de novo, denuncie de novo.'
                     % (alvo, CATEGORIAS.get(r['categoria'])))
        if resposta:
            miolo += '\n\nA Equipe escreveu: ' + resposta
        self.con.execute("INSERT INTO moderacao_cartas(conta_id, assunto, texto, criado_em) VALUES (?, ?, ?, ?)",
                         (r['denunciante_id'], assunto, miolo, t))
        quem = self.con.execute("SELECT nome, email FROM contas WHERE id = ?", (r['denunciante_id'],)).fetchone()
        if quem is None:
            return None
        return quem['email'], quem['nome'], assunto, miolo

    def _email_da_carta(self, para, nome, assunto, miolo):
        """Com o correio do servidor ligado, a carta vai também por e-mail (fora da tranca,
        numa thread: a falha vai ao log sem o endereço). Desligado, fica só no jogo."""
        envia = getattr(self, '_envia_depois', None)
        if envia is None:
            return
        texto = 'Olá, %s.\n\n%s\n' % (nome, miolo)
        endereco = getattr(getattr(self, 'correio', None), 'endereco', None)
        if endereco:
            texto += '\nA sua conta: %s/site/conta.html\n' % endereco
        texto += '\n— SOTERRA (mensagem automática; não precisa responder)\n'
        envia(para, 'SOTERRA: ' + assunto.lower(), texto, 'retorno de denúncia')

    # -- o correio da Equipe (o jogador) ---------------------------------------------------------------
    def correio_ler(self, conta, corpo):
        with self.tranca:
            linhas = self.con.execute("SELECT id, assunto, texto, criado_em, lida_em FROM moderacao_cartas "
                                      "WHERE conta_id = ? ORDER BY id DESC LIMIT ?", (conta['id'], CARTAS_LISTA)).fetchall()
            n = self.con.execute("SELECT COUNT(*) FROM moderacao_cartas WHERE conta_id = ? AND lida_em IS NULL",
                                 (conta['id'],)).fetchone()[0]
        return 200, {'ok': True, 'naoLidas': n,
                     'cartas': [{'id': r['id'], 'assunto': r['assunto'], 'texto': r['texto'],
                                 'criadoEm': r['criado_em'], 'lida': r['lida_em'] is not None} for r in linhas]}

    def correio_lida(self, conta, corpo):
        cid, todas = corpo.get('id'), corpo.get('todas') is True
        if not todas and not _id_valido(cid):
            raise Recusa(400, 'mande id (o número da carta) ou todas:true')
        t = agora()
        with self._escrita():
            if todas:
                n = self.con.execute("UPDATE moderacao_cartas SET lida_em = ? WHERE conta_id = ? AND lida_em IS NULL",
                                     (t, conta['id'])).rowcount
            else:
                n = self.con.execute("UPDATE moderacao_cartas SET lida_em = COALESCE(lida_em, ?) "
                                     "WHERE conta_id = ? AND id = ?", (t, conta['id'], cid)).rowcount
                if not n:
                    raise Recusa(404, 'carta não encontrada')
        return 200, {'ok': True, 'marcadas': n}

    # -- GET /api/mestre/auditoria[?limite=N][&acao=x][&alvo=N] ------------------------------------
    def mestre_auditoria(self, conta, corpo):
        q = corpo.get('_query') or {}
        try:
            limite = max(1, min(500, int(q.get('limite') or LISTA_MAX)))
        except (TypeError, ValueError):
            raise Recusa(400, 'limite precisa ser um número de 1 a 500')
        onde, args = [], []
        if q.get('acao'):
            onde.append("a.acao = ?")
            args.append(str(q.get('acao'))[:40])
        if q.get('alvo'):
            if not str(q.get('alvo')).isdigit():
                raise Recusa(400, 'alvo precisa ser o número da conta')
            onde.append("a.alvo_id = ?")
            args.append(int(q.get('alvo')))
        with self.tranca:
            linhas = self.con.execute(
                "SELECT a.*, c.nome AS alvo_nome, m.nome AS mestre_atual FROM moderacao_auditoria a "
                "LEFT JOIN contas c ON c.id = a.alvo_id LEFT JOIN contas m ON m.id = a.mestre_id"
                + (" WHERE " + " AND ".join(onde) if onde else "") + " ORDER BY a.id DESC LIMIT ?",
                args + [limite]).fetchall()
        return 200, {'ok': True, 'registros': [
            {'id': r['id'], 'acao': r['acao'], 'criadoEm': r['criado_em'],
             'mestre': {'id': r['mestre_id'], 'nome': r['mestre_atual'] or r['mestre_nome']},
             'alvo': {'id': r['alvo_id'], 'nome': r['alvo_nome']} if r['alvo_id'] is not None else None,
             'dados': _json(r['dados'], r['dados'])} for r in linhas]}

    # -- POST /api/mestre/dar {conta?, tipo, idem, ...} -------------------------------------------------
    @staticmethod
    def _args_dar(tipo, corpo):
        """As réguas de cada entrega (TIPOS_DAR): os argumentos da op do juiz, ou Recusa(400)."""
        def inteiro(campo, minimo, maximo, padrao=None):
            v = corpo.get(campo, padrao)
            if isinstance(v, bool) or not isinstance(v, int) or not minimo <= v <= maximo:
                raise Recusa(400, '%s precisa ser um inteiro de %d a %d' % (campo, minimo, maximo))
            return v

        def ident(campo):
            v = corpo.get(campo)
            if not isinstance(v, str) or not RE_ID_TEXTO.match(v):
                raise Recusa(400, '%s inválido' % campo)
            return v

        def sim_nao(campo):
            v = corpo.get(campo, False)
            if not isinstance(v, bool):
                raise Recusa(400, '%s precisa ser true ou false' % campo)
            return v

        if tipo == 'item':
            return {'itemId': ident('itemId'), 'estrelas': inteiro('estrelas', 0, 99, 0),
                    'nivel': inteiro('nivel', 0, 99, 0), 'qtd': inteiro('qtd', 1, DAR_ITEM_QTD, 1)}
        if tipo == 'set':
            return {'setId': ident('setId')}
        if tipo == 'pet':
            return {'petId': ident('petId'), 'topo': sim_nao('topo')}
        if tipo == 'pedras':
            return {'stoneId': ident('stoneId'), 'n': inteiro('n', 1, DAR_PEDRAS_MAX)}
        if tipo == 'selos':
            if corpo.get('elemento') not in ELEMENTOS_SELO:
                raise Recusa(400, 'elemento precisa ser um de: %s' % ', '.join(ELEMENTOS_SELO))
            return {'elemento': corpo['elemento'], 'n': inteiro('n', 1, DAR_SELOS_MAX)}
        if tipo == 'insignias':
            return {'n': inteiro('n', 1, DAR_INSIGNIAS_MAX)}
        if tipo == 'cartas':
            if sim_nao('topo'):
                return {'classId': ident('classId'), 'topo': True}
            return {'classId': ident('classId'), 'n': inteiro('n', 1, DAR_CARTAS_MAX)}
        if tipo == 'pergaminho':
            if corpo.get('pergaminho') not in PERGAMINHOS:
                raise Recusa(400, 'pergaminho precisa ser um de: %s' % ', '.join(PERGAMINHOS))
            return {'tipo': corpo['pergaminho'], 'n': inteiro('n', 1, DAR_PERGAMINHOS_MAX)}
        if tipo == 'bonus-xp':
            return {'dias': inteiro('dias', 1, DAR_BONUS_DIAS_MAX)}
        raise Recusa(400, 'tipo precisa ser um de: %s' % ', '.join(TIPOS_DAR))

    @staticmethod
    def _texto_entrega(resultado):
        """O que entrou, para o aviso ao jogador: o texto do juiz (com os nomes do dado), limpo e curto."""
        t = resultado.get('texto') if isinstance(resultado, dict) else None
        t = limpa_texto(t, ENTREGA_TEXTO_MAX) if isinstance(t, str) else None
        return t or 'um presente'

    def mestre_dar(self, conta, corpo):
        """O "pôr no inventário" do painel único do Mestre, PELO JUIZ no estado do servidor
        (ver o topo): `tipo` em TIPOS_DAR, com os argumentos de _args_dar, na conta `conta`
        (sem ela, a do próprio Mestre). Nunca numa lápide nem numa conta banida."""
        alvo_id = corpo.get('conta', conta['id'])
        if not _id_valido(alvo_id):
            raise Recusa(400, 'conta precisa ser o número da conta')
        tipo, idem = corpo.get('tipo'), corpo.get('idem')
        if not isinstance(idem, str) or not RE_IDEM.match(idem):
            raise Recusa(400, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        if tipo not in TIPOS_DAR:
            raise Recusa(400, 'tipo precisa ser um de: %s' % ', '.join(TIPOS_DAR))
        args, op = self._args_dar(tipo, corpo), TIPOS_DAR[tipo]
        if not self._autoridade_ligada():
            raise Recusa(503, FRASE_SEM_JUIZ)
        proprio = alvo_id == conta['id']
        with self.tranca:
            ja = self.con.execute("SELECT dados, alvo_id FROM moderacao_auditoria WHERE mestre_id = ? AND idem = ?",
                                  (conta['id'], idem)).fetchone()
        if ja is not None:                                   # o mesmo clique chegando de novo
            dados = _json(ja['dados'], {}) or {}
            if ja['alvo_id'] != alvo_id or dados.get('op') != op or dados.get('args') != args:
                raise Recusa(409, 'idem já usado em outra entrega')
            resp = {'ok': True, 'repetido': True, 'resultado': dados.get('resultado')}
            if proprio:
                resp.update(self._estado_publico(alvo_id))
            return 200, resp
        self._mestre_freio(conta, 'dar', DAR_POR_HORA, 'entregas demais nesta hora; espere um pouco')
        for _ in range(TENTATIVAS):
            t = agora()
            with self.tranca:
                alvo = self.con.execute("SELECT * FROM contas WHERE id = ?", (alvo_id,)).fetchone()
                if alvo is None:
                    raise Recusa(404, 'conta não encontrada')
                # a lápide antes do banido: ela também tem banido = 1, e a frase certa é "excluída"
                if self._e_lapide(alvo_id):
                    raise Recusa(409, FRASE_LAPIDE)
                if alvo['banido']:
                    raise Recusa(409, 'essa conta está banida: nada entra nela')
                if tipo in TIPOS_DA_LUTA and self._dar_em_luta(alvo_id, t):
                    raise Recusa(409, FRASE_EM_LUTA, motivo='em-luta')
                estado = self._estado_ler(alvo_id)
            if estado is None:
                raise Recusa(409, FRASE_SEM_ESTADO)
            alvo = dict(alvo)
            saida = self._juiz_op(alvo, estado, [{'nome': op, 'args': args}], interno=True)
            resultado = (saida.get('resultados') or [None])[0]
            texto = self._texto_entrega(resultado)
            # o hash do estado de antes, medido pelo juiz: o servidor só o guarda depois da primeira op ou sala,
            # e o jogo, sem ele, mede o mesmo hash no estado que adotou (autoridade.js, puxaEstado)
            hash_antes = saida.get('hashAntes') if isinstance(saida.get('hashAntes'), str) else estado['hash']
            # 03/10 (revisão): a entrega que não mexeu em nada (o bicho que a conta já tem, sem o topo; o que
            # já está no topo) virava aviso e carta "O Mestre te enviou …" sem nada ter entrado
            if isinstance(saida.get('hash'), str) and saida['hash'] == hash_antes:
                raise Recusa(422, FRASE_NADA_MUDOU, motivo='nada-mudou')
            try:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM moderacao_auditoria WHERE mestre_id = ? AND idem = ?",
                                        (conta['id'], idem)).fetchone() is not None:
                        raise Recusa(409, 'esta entrega acabou de ser feita por outro pedido com o mesmo idem')
                    # a luta pode ter aberto enquanto o juiz trabalhava (a abertura também escreve aqui dentro)
                    if tipo in TIPOS_DA_LUTA and self._dar_em_luta(alvo_id, t):
                        raise Recusa(409, FRASE_EM_LUTA, motivo='em-luta')
                    nova, db = self._estado_grava(alvo, estado, saida, t)
                    self._evento(alvo_id, 'mestre-dar', {'por': conta['id'], 'op': op, 'args': args,
                                                         'novos': [n['iid'] for n in saida['iids']['novos']]})
                    self.con.execute(
                        "INSERT INTO moderacao_entregas(conta_id, mestre_id, tipo, texto, hash_antes, hash_depois, avisar, "
                        "criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (alvo_id, conta['id'], tipo, texto, hash_antes, saida['hash'], 0 if proprio else 1, t))
                    if not proprio:
                        # a carta fica no correio da Equipe: o registro que o jogador relê depois do aviso
                        self.con.execute("INSERT INTO moderacao_cartas(conta_id, assunto, texto, criado_em) "
                                         "VALUES (?, ?, ?, ?)",
                                         (alvo_id, 'O Mestre te enviou um presente',
                                          'O Mestre te enviou %s. Já está na sua conta: confira o inventário.' % texto, t))
                    self._audita(conta, 'dar-' + tipo, alvo_id, {'op': op, 'args': args, 'resultado': resultado,
                                                                  'versao': nova}, idem=idem, t=t)
                break
            except EstadoMudou:
                continue
        else:
            raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(alvo_id))
        log.info("moderação: #%d pôs %s no estado de #%d (versão %d)", conta['id'], op, alvo_id, nova)
        resp = {'ok': True, 'resultado': resultado, 'versao': nova, 'texto': texto}
        if proprio:
            # o próprio Mestre: o jogo adota o estado novo sem recarregar (Autoridade.adotaDeFora)
            resp.update(hash=saida['hash'], progress=saida['progress'], db=db)
        return 201, resp

    def _dar_em_luta(self, cid, t):
        """Dentro da tranca: a conta tem uma luta aberta que o servidor ainda vai refazer com o estado dela
        (ver TIPOS_DA_LUTA)? Sala solo ou em grupo, duelo (desafio, Campo, Arena), partida da Arena casada ou
        pronta, guerra. Tabela que não existe (um banco de antes): não segura."""
        ms = t * 1000
        consultas = (
            ("SELECT 1 FROM salas WHERE conta_id = ? AND estado = 'aberta' AND aberta_em > ?", (cid, t - DAR_LUTA_JANELA)),
            ("SELECT 1 FROM salas_grupo WHERE (lider_id = ? OR membro_id = ?) AND estado = 'aberta' AND aberta_em > ?",
             (cid, cid, t - DAR_LUTA_JANELA)),
            ("SELECT 1 FROM arena_partidas WHERE (a_id = ? OR b_id = ?) AND estado IN ('casada', 'pronta') "
             "AND criada_ms > ?", (cid, cid, ms - DAR_LUTA_JANELA * 1000)),
            ("SELECT 1 FROM guerra_jogadores j JOIN guerra_partidas p ON p.gid = j.gid WHERE j.conta_id = ? "
             "AND p.estado IN ('casada', 'pronta') AND p.criada_ms > ?", (cid, ms - DAR_LUTA_JANELA * 1000)),
            ("SELECT 1 FROM duelo_vida v WHERE v.conta_id = ? AND v.criado_em > ? "
             "AND NOT EXISTS (SELECT 1 FROM duelos d WHERE d.did = v.did)", (cid, t - DAR_DUELO_JANELA)),
        )
        for sql, args in consultas:
            try:
                if self.con.execute(sql, args).fetchone() is not None:
                    return True
            except sqlite3.OperationalError:
                continue
        return False

    # -- o jogador: o que o Mestre lhe enviou (03/10) -----------------------------------------------------
    def _entregas_pendentes(self, conta_id):
        """Quantas entregas do Mestre a conta ainda não viu (o /api/eu leva o número: o jogo olha a cada
        30 s, e só pergunta a lista quando há alguma). Sem a tabela (um banco de antes), 0."""
        try:
            with self.tranca:
                return self.con.execute("SELECT COUNT(*) FROM moderacao_entregas WHERE conta_id = ? AND avisar = 1 "
                                        "AND visto_em IS NULL", (conta_id,)).fetchone()[0]
        except sqlite3.Error:
            return 0

    def entregas_ler(self, conta, corpo):
        with self.tranca:
            linhas = self.con.execute("SELECT id, tipo, texto, criado_em FROM moderacao_entregas WHERE conta_id = ? "
                                      "AND avisar = 1 AND visto_em IS NULL ORDER BY id LIMIT ?",
                                      (conta['id'], ENTREGAS_LISTA)).fetchall()
        return 200, {'ok': True, 'entregas': [{'id': r['id'], 'tipo': r['tipo'], 'texto': r['texto'],
                                               'criadoEm': r['criado_em']} for r in linhas]}

    def entregas_vistas(self, conta, corpo):
        ids = corpo.get('ids')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 200 or not all(_id_valido(i) for i in ids):
            raise Recusa(400, 'ids precisa ser uma lista de 1 a 200 números de entrega')
        t = agora()
        with self._escrita():
            n = 0
            for i in set(ids):
                n += self.con.execute("UPDATE moderacao_entregas SET visto_em = ? WHERE id = ? AND conta_id = ? "
                                      "AND visto_em IS NULL", (t, i, conta['id'])).rowcount
        return 200, {'ok': True, 'marcadas': n}

    def _rebase_entregas(self, conta_id, hash_cliente, hash_servidor):
        """Dentro da tranca (salas.py, economia_op): a op do jogador chegou com um hash velho. Se a
        diferença entre o estado que ele viu e o de agora são SÓ entregas do Mestre (a corrente de
        hash_antes → hash_depois, da mais nova para trás, até o hash dele), a op dele sobe por cima delas:
        a entrega só ACRESCENTA (a peça entra no fim do saco, a pedra no estoque), e os índices que a op
        dele cita continuam apontando para as mesmas coisas. Qualquer outro buraco na corrente: False (o
        409 de sempre, e o jogo adota o estado do servidor)."""
        if not isinstance(hash_cliente, str) or not isinstance(hash_servidor, str):
            return False
        try:
            linhas = self.con.execute("SELECT hash_antes, hash_depois FROM moderacao_entregas WHERE conta_id = ? "
                                      "ORDER BY id DESC LIMIT ?", (conta_id, CORRENTE_MAX)).fetchall()
        except sqlite3.Error:
            return False
        atual = hash_servidor
        for r in linhas:
            if r['hash_depois'] != atual or not r['hash_antes']:
                return False
            atual = r['hash_antes']
            if atual == hash_cliente:
                return True
        return False
