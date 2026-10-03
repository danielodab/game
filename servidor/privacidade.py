#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Os direitos do titular (LGPD) e o aceite dos termos (02/10, antes do lançamento).

Entra no cartório como mixin (`class Api(..., PrivacidadeMixin)` no api.py), com a
mesma conexão e a mesma tranca. Usa do ContaMixin (conta.py) o que já existe para
reautenticar: _confere_senha (o PBKDF2 fora da tranca, o freio por IP, a contagem de
senhas erradas), _conta_limite/_anota_limite e _envia_depois.

O QUE MORA AQUI:
  - O ACEITE DOS TERMOS. Os Termos de Uso (site/termos.html) e a Política de
    Privacidade (site/privacidade.html) andam juntos numa versão só, VERSAO_TERMOS.
    O cadastro (api.py) só cria a conta com `aceiteTermos` igual à versão de agora,
    e grava o aceite (`aceites`: a conta, o documento, a versão e o instante) na MESMA
    transação que cria a conta: não existe conta sem aceite gravado. Quem tem conta de
    antes (ou de uma versão velha) aceita de novo pela página da conta.
  - EXCLUIR A CONTA (POST /api/conta/excluir): o nome digitado e a senha.
  - BAIXAR MEUS DADOS (GET /api/conta/meus-dados): um JSON com o que o servidor
    guarda desta conta — a portabilidade e o acesso do art. 18 da LGPD.

COMO A CONTA SAI (o que a Política de Privacidade promete; tests/privacidade_api.py
confere tabela por tabela, lendo o esquema — tabela nova que aponte para a conta
entra na prova sozinha):
  1. a guilda se resolve ANTES: o líder passa a liderança ao membro mais antigo
     (entrou_em, depois o id); sem mais ninguém, a guilda se desfaz. `guildas.lider_id`
     não tem ON DELETE e barraria o resto;
  2. os eventos da conta (a trilha de auditoria: logins, trocas, salas…) saem. Ficam só
     os de PAGAMENTO, sem a conta (ON DELETE SET NULL): são a trilha do dinheiro;
  3. as tabelas que guardam o id sem chave estrangeira (a presença do relé, as esperas
     do duelo e da guerra) são limpas à mão;
  4. a linha de `contas` sai, e as chaves estrangeiras fazem o resto do jeito que o
     esquema já declarava: CASCADE apaga (sessões, save, itens, ranking, amigos,
     anúncios do mercadinho e as propostas deles, empréstimos, vida dos heróis, salas,
     duelos, códigos, avatar, saldo de barras…) e SET NULL desliga o que é trilha de
     dinheiro (pagamentos, extrato das barras, alertas de pagamento);
  5. no mesmo id nasce uma LÁPIDE: a linha volta com nome 'excluída#<id>' (o '#' não
     passa na lei dos nomes: ninguém se cadastra com ele), e-mail num domínio .invalid,
     senha que nenhum PBKDF2 produz e banido = 1. POR QUÊ: o SQLite reaproveita o maior
     id quando ele é apagado (INTEGER PRIMARY KEY sem AUTOINCREMENT) — a próxima conta
     criada herdaria o id da que saiu, e com ele o que ainda citasse aquele número (o
     id em `dados` de eventos de outras contas, a presença que o relé grava depois).
     A lápide segura o número; banida, nenhuma rota a atende, e o ranking não a lista.
     `contas_excluidas` anota o id e a data (sem nada da pessoa).
A peça que a conta EMPRESTOU pelo banco da guilda fica com quem pegou (a original some
com a conta; não é duplicação). A peça que ela PEGOU volta a ser só do dono. Barras de
ouro e vinténs que sobrarem somem com a conta: os Termos dizem isso, e o arrependimento
de 7 dias se pede ANTES de excluir.

RECUSA A EXCLUSÃO (409) enquanto há: uma luta com outra pessoa no meio (duelo aberto sem
resultado, sala em grupo aberta, partida da Arena casada ou pronta, guerra casada ou
pronta) — a luta dos outros cairia junto —; ou um pagamento no Mercado Pago ainda aberto
(o dinheiro chegaria a uma conta que não existe: pagamento.py só loga e não credita). A
conta do Mestre também não sai por aqui: perder a última marca de Mestre trancaria o
painel; tire a marca no Terminal antes (admin tirar-mestre).

Só biblioteca padrão. Tabelas NOVAS, nunca ALTER (o rolling update divide o banco).
"""
import json
import logging
import sqlite3
from datetime import datetime, timezone

from comum import SESSAO_DIAS, Recusa, agora
from conta import FAXINA
from registros import RETENCAO_DIAS

log = logging.getLogger('api')

# A versão dos dois documentos (a data em que foram publicados). Mudou o texto de um
# deles de um jeito que muda direito ou dever de alguém: sobe aqui, em site/conta.js
# (VERSAO_TERMOS) e no data-versao das duas páginas — tests/privacidade_api.py pega a
# deriva entre os quatro.
VERSAO_TERMOS = '2026-10-02'
DOCUMENTOS = ('termos', 'privacidade')
FRASE_SEM_ACEITE = 'para criar a conta, leia e aceite os Termos de Uso e a Política de Privacidade'
FRASE_TERMOS_VELHOS = 'os Termos de Uso mudaram: recarregue a página, leia a versão nova e aceite de novo'

MEUS_DADOS_POR_HORA = 5          # cada pedido monta um JSON grande: o freio segura quem pede em laço
EXCLUIR_LUTA_JANELA = 6 * 3600   # a luta mais velha que isso está largada (o bilhete vence em 6 h): não segura
# 03/10 (revisão): o duelo dura minutos e a espera mais longa dele (a desistência, o W.O.) é de 2 min;
# aberto há mais de 1 h e sem resultado, os dois largaram — não segura a exclusão de ninguém
EXCLUIR_DUELO_JANELA = 3600
PAGAMENTO_ABERTO = 2 * 3600      # o link de pagamento vale 2 h (pagamento.PREFERENCIA_VALIDADE)
PENDENTES_MP = ('pending', 'in_process', 'authorized', 'in_mediation')
# o teto de linhas de cada lista do "baixar meus dados" (a conta mais ativa tem dezenas de
# milhares de eventos; o arquivo diz o total e quantos vieram)
LISTA_MAX = 2000
FAXINA_PRIVACIDADE_S = 3600     # a faxina dos prazos (sessões, códigos, freios) roda no máximo uma vez por hora, por processo
LAPIDE_NOME = 'excluída#%d'
LAPIDE_EMAIL = 'excluida-%d@conta-excluida.invalid'

ESQUEMA_PRIVACIDADE = """
-- 02/10: o aceite dos Termos de Uso e da Política de Privacidade (servidor/privacidade.py)
CREATE TABLE IF NOT EXISTS aceites(
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  documento  TEXT NOT NULL CHECK (documento IN ('termos', 'privacidade')),
  versao     TEXT NOT NULL,
  aceito_em  INTEGER NOT NULL,
  PRIMARY KEY (conta_id, documento, versao)
);
-- 02/10: as contas que o titular excluiu. Só o número e a data: a lápide em `contas`
-- segura o id, e esta linha diz que ela é uma exclusão (e não um banimento)
CREATE TABLE IF NOT EXISTS contas_excluidas(
  conta_id    INTEGER PRIMARY KEY,
  excluida_em INTEGER NOT NULL,
  guilda      TEXT
);
"""

# rota → (método da Api, precisa de conta?) — o api.py junta estas às dele
ROTAS_PRIVACIDADE = {
    ('GET',  '/api/termos'):           ('termos_versao', False),   # público: a versão de agora (as provas leem)
    ('GET',  '/api/conta/aceite'):     ('conta_aceite_ler', True),
    ('POST', '/api/conta/aceite'):     ('conta_aceite', True),
    ('POST', '/api/conta/excluir'):    ('conta_excluir', True),
    ('GET',  '/api/conta/meus-dados'): ('conta_meus_dados', True),
}

# As tabelas que guardam o id da conta SEM chave estrangeira (o CASCADE não as alcança).
# Coluna e tabela de cada uma; a prova confere que nenhuma linha fica para trás.
SEM_CHAVE = (('rele_presenca', 'conta_id'), ('duelo_espera', 'conta_id'), ('guerra_espera', 'conta_id'),
             ('guerra_saidas', 'conta_id'))


def _json(texto):
    if not texto:
        return None
    try:
        return json.loads(texto)
    except (TypeError, ValueError):
        return None


def confere_aceite(corpo):
    """O `aceiteTermos` do corpo do cadastro: a versão que a página mostrou ao lado da
    caixa marcada. Sem ele (ou falso), 400; outra versão, 409 com a de agora (a página
    é de antes da mudança dos termos)."""
    v = corpo.get('aceiteTermos') if isinstance(corpo, dict) else None
    if not isinstance(v, str) or not v:
        raise Recusa(400, FRASE_SEM_ACEITE, motivo='sem-aceite', versaoTermos=VERSAO_TERMOS)
    if v != VERSAO_TERMOS:
        raise Recusa(409, FRASE_TERMOS_VELHOS, motivo='termos-velhos', versaoTermos=VERSAO_TERMOS)
    return v


class PrivacidadeMixin:

    # -- a faxina dos prazos que a Política de Privacidade promete ----------------------------
    def _faxina_privacidade(self, t=None, forcar=False):
        """Dentro de uma transação de quem chama. Apaga:
          - as sessões sem uso há mais de SESSAO_DIAS (e, pelo CASCADE, o IP e o navegador
            guardados com elas em sessoes_extra). POR QUÊ: a sessão vencida só morria
            quando o token dela VOLTAVA (conta_do_token) ou quando a conta entrava de novo;
            o celular perdido e o navegador limpo nunca voltam, e o IP ficava no banco para
            sempre;
          - o resumo das sessões derrubadas, os códigos (com o IP de quem pediu), as
            contagens dos freios por IP e os erros registrados mais velhos que os prazos
            deles: a faxina de cada um só rodava quando nascia outro igual (conta.py,
            registros.py), e num dia parado o IP de ontem ficava.
        A Política de Privacidade promete esses prazos (data-regua SESSAO_DIAS e
        FAXINA_DIAS em site/privacidade.html). Roda no boot e a cada sessão aberta
        (login, cadastro, esqueci), no máximo uma vez por hora por processo."""
        t = agora() if t is None else t
        if not forcar and t - getattr(self, '_faxina_privacidade_em', 0) < FAXINA_PRIVACIDADE_S:
            return 0
        self._faxina_privacidade_em = t
        n = self.con.execute("DELETE FROM sessoes WHERE ultimo_uso < ?", (t - SESSAO_DIAS * 86400,)).rowcount
        self.con.execute("DELETE FROM sessoes_derrubadas WHERE em < ?", (t - SESSAO_DIAS * 86400,))
        self.con.execute("DELETE FROM codigos WHERE criado_em < ?", (t - FAXINA,))
        self.con.execute("DELETE FROM limites WHERE em < ?", (t - FAXINA,))
        # o registro de erros tem a faxina dele a cada lote que chega; num servidor sem erro
        # novo por semanas, o de 30 dias atrás esperaria o próximo — aqui ele não espera
        self.con.execute("DELETE FROM erros_registro WHERE ultima_em < ?", (t - RETENCAO_DIAS * 86400,))
        if n:
            log.info("faxina: %d sessão(ões) sem uso há mais de %d dias saíram (com o IP delas)", n, SESSAO_DIAS)
        return n

    # -- o aceite --------------------------------------------------------------------
    def _aceite_grava(self, cid, versao, t):
        """Dentro da transação de quem chama (o cadastro, o aceite de novo)."""
        self.con.executemany(
            "INSERT OR IGNORE INTO aceites(conta_id, documento, versao, aceito_em) VALUES (?, ?, ?, ?)",
            [(cid, doc, versao, t) for doc in DOCUMENTOS])

    def _aceite_atual(self, cid):
        """{versao, em} do último aceite dos DOIS documentos, ou None."""
        r = self.con.execute(
            "SELECT versao, MIN(aceito_em) AS em, COUNT(DISTINCT documento) AS n FROM aceites WHERE conta_id = ? "
            "GROUP BY versao ORDER BY em DESC LIMIT 1", (cid,)).fetchone()
        if r is None or r['n'] < len(DOCUMENTOS):
            return None
        return {'versao': r['versao'], 'em': r['em']}

    def termos_versao(self, conta, corpo):
        """Público: a versão que o cadastro exige e onde moram os dois documentos."""
        return 200, {'ok': True, 'versaoTermos': VERSAO_TERMOS, 'termos': 'site/termos.html',
                     'privacidade': 'site/privacidade.html'}

    def conta_aceite_ler(self, conta, corpo):
        with self.tranca:
            atual = self._aceite_atual(conta['id'])
        return 200, {'ok': True, 'versaoTermos': VERSAO_TERMOS, 'aceite': atual,
                     'pendente': atual is None or atual['versao'] != VERSAO_TERMOS}

    def conta_aceite(self, conta, corpo):
        """Quem tem conta de antes dos termos (ou de uma versão velha) aceita a de agora."""
        v = confere_aceite({'aceiteTermos': corpo.get('versao')})
        t = agora()
        with self._escrita():
            self._aceite_grava(conta['id'], v, t)
            atual = self._aceite_atual(conta['id'])
        return 200, {'ok': True, 'versaoTermos': VERSAO_TERMOS, 'aceite': atual, 'pendente': False}

    # -- excluir a conta -----------------------------------------------------------------
    def _excluir_barrado(self, cid, t):
        """Dentro da tranca: o motivo (texto) que segura a exclusão agora, ou None."""
        ms = t * 1000
        luta = self.con.execute(
            "SELECT 1 FROM salas_grupo WHERE (lider_id = ? OR membro_id = ?) AND estado = 'aberta' AND aberta_em > ?",
            (cid, cid, t - EXCLUIR_LUTA_JANELA)).fetchone()
        luta = luta or self.con.execute(
            "SELECT 1 FROM arena_partidas WHERE (a_id = ? OR b_id = ?) AND estado IN ('casada', 'pronta') "
            "AND criada_ms > ?", (cid, cid, ms - EXCLUIR_LUTA_JANELA * 1000)).fetchone()
        luta = luta or self.con.execute(
            "SELECT 1 FROM guerra_jogadores j JOIN guerra_partidas p ON p.gid = j.gid WHERE j.conta_id = ? "
            "AND p.estado IN ('casada', 'pronta') AND p.criada_ms > ?",
            (cid, ms - EXCLUIR_LUTA_JANELA * 1000)).fetchone()
        # 03/10 (revisão): o DUELO (desafio da praça, Campo ou Arena) aberto e ainda sem resultado. Sem esta
        # linha a exclusão passava no meio dele, e o fechamento do OUTRO lado caía para sempre em 404 ("conta
        # do duelo não encontrada": a lápide é banida, grupo.py _conta_viva) — a luta dele nunca fechava
        luta = luta or self.con.execute(
            "SELECT 1 FROM duelo_vida v WHERE v.conta_id = ? AND v.criado_em > ? "
            "AND NOT EXISTS (SELECT 1 FROM duelos d WHERE d.did = v.did)",
            (cid, t - EXCLUIR_DUELO_JANELA)).fetchone()
        if luta:
            return ('luta-aberta', 'há uma luta com outros jogadores em andamento (duelo, sala em grupo, Arena ou '
                                   'guerra): termine ou largue a luta antes de excluir a conta')
        pag = self.con.execute(
            "SELECT 1 FROM pagamentos p WHERE p.conta_id = ? AND ("
            "  (p.estado IN ('criado', 'aberto') AND p.criado_em > ? "
            "   AND NOT EXISTS (SELECT 1 FROM pagamentos_mp m WHERE m.pagamento_id = p.id)) "
            "  OR EXISTS (SELECT 1 FROM pagamentos_mp m WHERE m.pagamento_id = p.id AND m.status IN (%s)))"
            % ','.join('?' * len(PENDENTES_MP)), (cid, t - PAGAMENTO_ABERTO) + PENDENTES_MP).fetchone()
        if pag:
            return ('pagamento-aberto', 'há um pagamento no Mercado Pago ainda em andamento: espere ele terminar '
                                        '(o link vale 2 horas) antes de excluir a conta')
        return None

    def _excluir_guilda(self, cid):
        """Dentro da transação da exclusão: a guilda da conta antes de a conta sair.
        Devolve o que aconteceu ('lideranca' | 'desfeita' | 'saiu' | None)."""
        m = self.con.execute("SELECT g.id, g.lider_id FROM guilda_membros m JOIN guildas g ON g.id = m.guilda_id "
                             "WHERE m.conta_id = ?", (cid,)).fetchone()
        # a conta pode liderar uma guilda sem ser membro dela (linha torta de antes): também se resolve
        lideradas = [r[0] for r in self.con.execute("SELECT id FROM guildas WHERE lider_id = ?", (cid,))]
        resultado = 'saiu' if m is not None else None
        for gid in lideradas:
            herdeiro = self.con.execute(
                "SELECT conta_id FROM guilda_membros WHERE guilda_id = ? AND conta_id != ? "
                "ORDER BY entrou_em, conta_id LIMIT 1", (gid, cid)).fetchone()
            if herdeiro is not None:
                self.con.execute("UPDATE guildas SET lider_id = ? WHERE id = ?", (herdeiro[0], gid))
                self._evento(herdeiro[0], 'guilda', {'acao': 'herdou', 'gid': gid, 'motivo': 'lider-excluiu-a-conta'})
                resultado = 'lideranca'
            else:
                # o último apaga a luz, como no guilda_sair: o que pende da guilda sem CASCADE sai antes
                for tabela in ('guilda_contrib', 'guilda_dizimo_membro', 'guilda_mural'):
                    self.con.execute("DELETE FROM %s WHERE guilda_id = ?" % tabela, (gid,))
                self.con.execute("DELETE FROM guildas WHERE id = ?", (gid,))
                resultado = 'desfeita'
        return resultado

    def conta_excluir(self, conta, corpo):
        cid = conta['id']
        nome, senha = corpo.get('nome'), corpo.get('senha')
        if not isinstance(nome, str) or not isinstance(senha, str) or not senha:
            raise Recusa(400, 'digite o nome da conta e a senha para excluir')
        # a confirmação forte: o nome EXATO (o que a página mostra), não um "sim" que se clica sem ler
        if nome.strip() != conta['nome']:
            raise Recusa(400, 'o nome digitado não é o desta conta', motivo='nome-errado')
        if conta['gm']:
            raise Recusa(409, 'a conta do Mestre não se exclui por aqui: tire a marca de Mestre no Terminal '
                              '(admin tirar-mestre) e exclua depois', motivo='mestre')
        with self.tranca:
            barrado = self._excluir_barrado(cid, agora())
        if barrado:
            raise Recusa(409, barrado[1], motivo=barrado[0])
        # a senha por último (o PBKDF2 custa): conferida como na troca de senha, com o freio
        # por IP no balde próprio da exclusão
        self._confere_senha(conta, senha, 'senha errada', corpo, 'excluir')
        email, t = conta['email'], agora()
        with self._escrita():
            # a conta pode ter mudado entre a conferência e aqui (outra aba abriu uma luta)
            barrado = self._excluir_barrado(cid, t)
            if barrado:
                raise Recusa(409, barrado[1], motivo=barrado[0])
            guilda = self._excluir_guilda(cid)
            self.con.execute("DELETE FROM eventos WHERE conta_id = ? AND tipo NOT LIKE 'pagamento-%'", (cid,))
            for tabela, coluna in SEM_CHAVE:
                self.con.execute("DELETE FROM %s WHERE %s = ?" % (tabela, coluna), (cid,))
            try:
                self.con.execute("DELETE FROM contas WHERE id = ?", (cid,))
            except sqlite3.IntegrityError as e:
                # uma tabela que aponta para contas SEM dizer o que fazer na exclusão (como
                # guildas.lider_id, resolvida acima): a transação inteira volta, nada some
                log.error("excluir conta #%d: uma chave estrangeira barrou (%s)", cid, e)
                raise Recusa(500, 'a exclusão não fechou: nada foi apagado; avise o suporte')
            self.con.execute(
                "INSERT INTO contas(id, nome, email, senha_hash, sal, criado_em, gm, banido) VALUES (?, ?, ?, ?, ?, ?, 0, 1)",
                (cid, LAPIDE_NOME % cid, LAPIDE_EMAIL % cid, '!', '!', t))
            self.con.execute("INSERT OR REPLACE INTO contas_excluidas(conta_id, excluida_em, guilda) VALUES (?, ?, ?)",
                             (cid, t, guilda))
        # o que mora só na memória deste processo — DENTRO da tranca (03/10, revisão): a troca (api.py)
        # mexe em `intencoes` com ela pega, e percorrer o dicionário enquanto outra thread insere levanta
        # RuntimeError DEPOIS do commit: a conta já tinha saído, a resposta era 500 e o e-mail não ia
        with self.tranca:
            self.tentativas.pop(cid, None)
            self._resumos_vistos.pop(cid, None)
            self._ranking_guardado = None
            for chave in [k for k in self.intencoes if cid in k]:
                self.intencoes.pop(chave, None)
        log.info("conta #%d excluída pelo titular (guilda: %s)", cid, guilda or '-')
        self._envia_depois(email, *self._texto_excluida(conta['nome']), rotulo='o aviso de conta excluída')
        return 200, {'ok': True, 'excluida': True, 'guilda': guilda}

    def _texto_excluida(self, nome):
        assunto = 'SOTERRA: sua conta foi excluída'
        texto = ('Olá, %s.\n\nA sua conta do SOTERRA foi excluída a seu pedido, agora. O nome, o e-mail, o save, '
                 'os amigos, a guilda, os anúncios e as sessões saíram do servidor.\n\n'
                 'Ficam só os registros de pagamento que a lei manda guardar, já sem o seu nome e sem o seu e-mail '
                 '(a Política de Privacidade explica).\n\n'
                 'Este é o último e-mail que mandamos para este endereço.\n' % nome)
        if self.correio.endereco:
            texto += '\nA Política de Privacidade: %s/site/privacidade.html\n' % self.correio.endereco
        texto += '\n— SOTERRA (mensagem automática; não precisa responder)\n'
        return assunto, texto

    # -- baixar meus dados ----------------------------------------------------------------------
    def _lista(self, sql, args, limite=LISTA_MAX):
        """{total, incluidos, itens} de uma consulta (os mais recentes primeiro, pelo ORDER do sql)."""
        total = self.con.execute("SELECT COUNT(*) FROM (%s)" % sql, args).fetchone()[0]
        itens = [dict(r) for r in self.con.execute("%s LIMIT %d" % (sql, limite), args)]
        return {'total': total, 'incluidos': len(itens), 'itens': itens}

    def conta_meus_dados(self, conta, corpo):
        cid, t = conta['id'], agora()
        with self._escrita():
            libera = self._conta_limite('meus-dados:%d' % cid, MEUS_DADOS_POR_HORA, 3600, t)
            if libera is not None:
                raise Recusa(429, 'pedidos demais nesta hora; tente de novo mais tarde', liberaEm=libera)
            self._anota_limite('meus-dados:%d' % cid, t)
        with self.tranca:
            dados = self._junta_dados(conta, t)
        log.info("conta #%d baixou os próprios dados", cid)
        return 200, {'ok': True, 'dados': dados}

    def _junta_dados(self, conta, t):
        """Dentro da tranca: tudo o que o servidor guarda desta conta, legível."""
        cid = conta['id']
        um = lambda sql: (lambda r: dict(r) if r is not None else None)(self.con.execute(sql, (cid,)).fetchone())
        save = um("SELECT versao, atualizado_em, progress, db FROM saves WHERE conta_id = ?")
        if save is not None:
            save['progress'], save['db'] = _json(save['progress']), _json(save['db'])
        eventos = self._lista("SELECT tipo, criado_em, dados FROM eventos WHERE conta_id = ? ORDER BY id DESC", (cid,))
        for e in eventos['itens']:
            e['dados'] = _json(e['dados'])
        guilda = um("SELECT g.nome, g.emblema, m.cargo, m.entrou_em, (g.lider_id = m.conta_id) AS lider "
                    "FROM guilda_membros m JOIN guildas g ON g.id = m.guilda_id WHERE m.conta_id = ?")
        dados = {
            'sobre': ('Os dados que o servidor do SOTERRA guarda desta conta, no dia %s (epoch %d). Datas em '
                      'segundos desde 1970 (UTC). Listas longas vêm com o total e quantos itens couberam.'
                      % (datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d'), t)),
            'gerado_em': t,
            'conta': {'id': cid, 'nome': conta['nome'], 'email': conta['email'], 'criado_em': conta['criado_em'],
                      'mestre': bool(conta['gm'])},
            'aceites': [dict(r) for r in self.con.execute(
                "SELECT documento, versao, aceito_em FROM aceites WHERE conta_id = ? ORDER BY aceito_em", (cid,))],
            'save': save,
            'sessoes': [dict(r) for r in self.con.execute(
                "SELECT s.criado_em, s.ultimo_uso, x.ip, x.agente FROM sessoes s LEFT JOIN sessoes_extra x "
                "ON x.token = s.token WHERE s.conta_id = ? ORDER BY s.ultimo_uso DESC", (cid,))],
            'eventos': eventos,
            'ranking': um("SELECT nome, xp_total, nivel_max, classes, brasa_pts, brasa_partidas, atualizado_em "
                          "FROM resumos WHERE conta_id = ?"),
            'ranking_por_classe': [dict(r) for r in self.con.execute(
                "SELECT classe, heroi_id, nivel, xp, elemento FROM resumos_classe WHERE conta_id = ?", (cid,))],
            'retrato': um("SELECT avatar, escolhido_em FROM avatares WHERE conta_id = ?"),
            'guilda': dict(guilda, lider=bool(guilda['lider'])) if guilda else None,
            'amigos_e_inimigos': [dict(r) for r in self.con.execute(
                "SELECT COALESCE(NULLIF(r.nome, ''), c.nome) AS nome, x.tipo, x.em FROM relacoes x "
                "JOIN contas c ON c.id = x.alvo_id LEFT JOIN resumos r ON r.conta_id = x.alvo_id "
                "WHERE x.conta_id = ? ORDER BY x.em", (cid,))],
            'itens': self._lista("SELECT iid, item_id, origem, estado, criado_em FROM itens WHERE conta_id = ? "
                                 "ORDER BY criado_em DESC", (cid,)),
            'vida_dos_herois': [dict(r) for r in self.con.execute(
                "SELECT heroi, hp_fim, hp_max, desde_ms FROM vida_heroi WHERE conta_id = ?", (cid,))],
            'salas': self._lista("SELECT dungeon, sala, dificuldade, estado, aberta_em, fechada_em FROM salas "
                                 "WHERE conta_id = ? ORDER BY aberta_em DESC", (cid,)),
            'barras_de_ouro': {
                'saldo': (um("SELECT saldo FROM barras_saldo WHERE conta_id = ?") or {}).get('saldo', 0),
                'extrato': self._lista("SELECT delta, motivo, ref, saldo_depois, criado_em FROM barras_movimentos "
                                       "WHERE conta_id = ? ORDER BY id DESC", (cid,))},
            'loja': self._lista("SELECT sku, preco, estado, criado_em, fechado_em FROM loja_pedidos WHERE conta_id = ? "
                                "ORDER BY id DESC", (cid,)),
            'pagamentos': [dict(r) for r in self.con.execute(
                "SELECT p.pacote, p.centavos, p.estado, p.criado_em, "
                "(SELECT GROUP_CONCAT(m.status) FROM pagamentos_mp m WHERE m.pagamento_id = p.id) AS mercado_pago "
                "FROM pagamentos p WHERE p.conta_id = ? ORDER BY p.id DESC", (cid,))],
            'mercadinho': {
                'anuncios': self._lista("SELECT item_id, level, stars, preco, estado, criado_em, valor_final, fechado_em "
                                        "FROM mercado_anuncios WHERE vendedor_id = ? ORDER BY id DESC", (cid,)),
                'propostas': self._lista("SELECT valor, estado, criado_em, resolvida_em FROM mercado_propostas "
                                         "WHERE comprador_id = ? ORDER BY id DESC", (cid,))},
        }
        # 03/10 (revisão): o resto do que o servidor guarda desta conta. A Política (seção 8) e a página
        # prometem "tudo"; sem estes, faltavam as lutas com outros jogadores (que a Política lista na
        # seção 2), as peças da pessoa guardadas no banco da guilda, o XP que ela doou, a mensagem que
        # escreveu no mural, os pedidos e convites de guilda e a presença do relé. O adversário entra só
        # como o LADO (A/B) — o número da outra conta é dado de outra pessoa
        dados['duelos'] = self._lista(
            "SELECT did, CASE WHEN a_id = ? THEN 'A' ELSE 'B' END AS meu_lado, fase, venc, criado_em FROM duelos "
            "WHERE a_id = ? OR b_id = ? ORDER BY criado_em DESC", (cid, cid, cid))
        dados['arena'] = self._lista(
            "SELECT did, CASE WHEN a_id = ? THEN 'A' ELSE 'B' END AS meu_lado, estado, criada_ms, pronta_ms "
            "FROM arena_partidas WHERE a_id = ? OR b_id = ? ORDER BY criada_ms DESC", (cid, cid, cid))
        dados['guerras'] = self._lista(
            "SELECT p.gid, j.lado AS meu_lado, j.herois, p.estado, p.criada_ms FROM guerra_jogadores j "
            "JOIN guerra_partidas p ON p.gid = j.gid WHERE j.conta_id = ? ORDER BY p.criada_ms DESC", (cid,))
        dados['salas_em_grupo'] = self._lista(
            "SELECT dungeon, sala, dificuldade, estado, aberta_em, fechada_em, "
            "CASE WHEN lider_id = ? THEN 'lider' ELSE 'membro' END AS papel FROM salas_grupo "
            "WHERE lider_id = ? OR membro_id = ? ORDER BY aberta_em DESC", (cid, cid, cid))
        # uma linha por guilda: a contribuição fica na guilda de antes quando a pessoa sai dela
        dados['guilda_xp_doado'] = [dict(r) for r in self.con.execute(
            "SELECT g.nome AS guilda, c.xp FROM guilda_contrib c JOIN guildas g ON g.id = c.guilda_id "
            "WHERE c.conta_id = ? ORDER BY g.nome", (cid,))]
        dados['guilda_banco_minhas_pecas'] = [dict(r) for r in self.con.execute(
            "SELECT g.nome AS guilda, b.item_id, b.nivel, b.estrelas, b.iid, (b.emprestado_para IS NOT NULL) AS emprestada, "
            "b.em FROM guilda_banco b JOIN guildas g ON g.id = b.guilda_id WHERE b.dono_id = ? ORDER BY b.em", (cid,))]
        dados['guilda_emprestimos_comigo'] = [dict(r) for r in self.con.execute(
            "SELECT b.item_id, b.nivel, b.estrelas, e.iid, e.em FROM guilda_emprestimos e "
            "JOIN guilda_banco b ON b.id = e.banco_id WHERE e.conta_id = ? ORDER BY e.em", (cid,))]
        dados['guilda_mural_escrito'] = [dict(r) for r in self.con.execute(
            "SELECT g.nome AS guilda, m.texto, m.em FROM guilda_mural m JOIN guildas g ON g.id = m.guilda_id "
            "WHERE m.autor_id = ?", (cid,))]
        dados['guilda_pedidos'] = [dict(r) for r in self.con.execute(
            "SELECT g.nome AS guilda, p.em FROM guilda_pedidos p JOIN guildas g ON g.id = p.guilda_id "
            "WHERE p.conta_id = ? ORDER BY p.em", (cid,))]
        dados['guilda_convites'] = [dict(r) for r in self.con.execute(
            "SELECT g.nome AS guilda, c.em FROM guilda_convites c JOIN guildas g ON g.id = c.guilda_id "
            "WHERE c.conta_id = ? ORDER BY c.em", (cid,))]
        dados['presenca'] = [dict(r) for r in self.con.execute(
            "SELECT evento, em_ms FROM rele_presenca WHERE conta_id = ? ORDER BY em_ms DESC", (cid,))]
        # 03/10 (junção com o Eco Primordial): as tentativas da semana e os prêmios recebidos — o placar
        # é público, mas a semente, os heróis e o motivo de uma recusa são da conta
        try:
            dados['eco_tentativas'] = self._lista(
                "SELECT id, semana, dia, herois, estado, dano, pontos, derrubou, rodada, motivo, aberta_ms, fechada_em "
                "FROM supremo_tentativas WHERE conta_id = ? ORDER BY aberta_ms DESC", (cid,))
            dados['eco_premios'] = [dict(r) for r in self.con.execute(
                "SELECT semana, posicao, faixa, pontos, vintens, selos, titulo, criado_em FROM supremo_premios "
                "WHERE conta_id = ? ORDER BY semana DESC", (cid,))]
        except sqlite3.OperationalError:   # um banco de antes do Eco
            dados['eco_tentativas'] = []
            dados['eco_premios'] = []
        # 03/10 (junção com a moderação, servidor/moderacao.py): as punições desta conta (sem quem
        # puniu), as denúncias que ELA fez e as cartas da Equipe. A denúncia contra ela fica de fora:
        # mostraria quem denunciou, que é dado de outra pessoa
        try:
            dados['moderacao'] = {
                'banimentos': [dict(r) for r in self.con.execute(
                    "SELECT motivo, inicio, fim, encerrado_em, encerrado_como FROM moderacao_banimentos "
                    "WHERE conta_id = ? ORDER BY inicio DESC", (cid,))],
                'silencios': [dict(r) for r in self.con.execute(
                    "SELECT motivo, inicio, fim, encerrado_em, encerrado_como FROM moderacao_silencios "
                    "WHERE conta_id = ? ORDER BY inicio DESC", (cid,))],
                'denuncias_feitas': self._lista(
                    "SELECT alvo_nome, categoria, onde, texto, estado, resposta, criado_em, fechado_em "
                    "FROM moderacao_denuncias WHERE denunciante_id = ? ORDER BY criado_em DESC", (cid,)),
                'cartas': self._lista(
                    "SELECT assunto, texto, criado_em, lida_em FROM moderacao_cartas WHERE conta_id = ? "
                    "ORDER BY id DESC", (cid,)),
            }
        except sqlite3.OperationalError:   # um banco de antes da moderação
            dados['moderacao'] = {'banimentos': [], 'silencios': [], 'denuncias_feitas': [], 'cartas': []}
        try:   # a tabela é do servidor/registros.py; sem ela (um banco de antes), a lista fica vazia
            dados['registros_de_erro'] = [dict(r) for r in self.con.execute(
                "SELECT e.origem, e.mensagem, e.ultima_em FROM erros_registro_contas x JOIN erros_registro e "
                "ON e.chave = x.chave WHERE x.conta_id = ? ORDER BY e.ultima_em DESC LIMIT 200", (cid,))]
        except sqlite3.OperationalError:
            dados['registros_de_erro'] = []
        return dados
