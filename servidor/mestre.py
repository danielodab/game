#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O painel do Mestre (10/09): buscar qualquer conta e dar PRESENTES.

Pedido do dono: "preciso fazer liberações pontuais no site para alguns
jogadores, de classes... na conta admin posso pesquisar qualquer usuario e
fazer essas liberações".

Entra no cartório como mixin (`class Api(..., MestreMixin, ...)` no api.py).
NÃO faz `import api` (a armadilha do __main__, ver o topo do comum.py).

O PRESENTE É UM PEDIDO DA LOJA: uma linha em `loja_pedidos` de preço 0 (a
classe, um item do catálogo ou N vinténs), marcada em `loja_presentes`, que
anda pelo MESMO caminho da compra (pendente → o jogo retira → aplica dentro do
save → o PUT fecha). O de vinténs é também um crédito (`loja_creditos`, loja.py):
conta no "a caminho" do jogador, que já pode gastar no site.

As regras que seguram o resto:
  - A marca é `contas.gm`, lida do banco a cada pedido (tirar a marca vale na
    hora); o 403 vem antes de o corpo ser olhado (api.py, despacha).
  - Os limites da loja NÃO valem para o presente, e ele não gasta os do
    jogador; a regra do produto vale (classe já liberada ou a caminho = recusa).
  - Freios no BANCO (valem entre os dois processos do rolling update): 60
    buscas e 120 fichas por hora por Mestre; 30 presentes por hora por Mestre
    (em qualquer estado: segura o disco); 500.000 vinténs de presente por
    Mestre em 24 h.
  - A busca é POST (o e-mail não vai para a URL nem para o log do proxy), só
    acha e-mail INTEIRO (pedaço de e-mail não varre ninguém) e devolve o
    e-mail mascarado; o e-mail inteiro só na ficha, uma conta por vez. O log
    nunca leva o termo buscado.
  - Os alertas de pagamento (estorno, contestação, valor estranho…) moram em
    `contas_alertas` (pagamento.py); aqui o Mestre os lê e marca como vistos.
"""
import json
import logging
import re

from comum import CLASSES_RANK, Recusa, agora, liberadas, limita
from conta import mascara_email
from loja import (CARTEIRA_TETO, CATALOGO, COLUNAS_PEDIDO, DE_PEDIDOS, POR_SKU, RE_IDEM, SKU_PRESENTE_VINTENS,
                  entrega_de, id_valido, le_json, milhar, nome_do_pedido)
from pagamento import FRASE_EM_BREVE, PAGAMENTOS_LISTA

log = logging.getLogger('api')

FRASE_SO_MESTRE = 'só o Mestre do Fundo abre o painel do Mestre'
FRASE_BUSCA = 'busque por 3 letras ou mais do nome, pelo e-mail inteiro ou pelo #número da conta'
BUSCA_MIN, BUSCA_MAX, BUSCA_LISTA = 3, 120, 20
BUSCAS_POR_HORA = 60        # por Mestre, contadas no banco (limites 'mestre-busca:<id>')
FICHAS_POR_HORA = 120       # por Mestre ('mestre-ficha:<id>'); conta também o id que não existe
PRESENTES_POR_HORA = 30     # LINHAS de presente criadas por Mestre por hora, em qualquer estado (segura o disco)
PRESENTES_LISTA = 50        # GET /api/mestre/presentes
PRESENTES_DA_CONTA = 30     # na ficha
PRESENTE_VINTENS_MAX = 100000        # por presente
PRESENTE_VINTENS_DIA = 500000        # por Mestre em 24 h (todos os estados: é um teto contra token roubado)
CONFERE_POR_HORA = 60       # "conferir no Mercado Pago" por Mestre ('mestre-pag-conferir:<id>'); conta o id que não existe
RE_ID_BUSCA = re.compile(r'^#?(\d{1,15})$')
FECHADOS = ('entregue', 'estornado', 'cancelado')

CONSULTA_PRESENTE = (
    "SELECT p.id, p.conta_id, p.sku, p.entrega, p.estado, p.motivo, p.criado_em, p.retirado_em, p.fechado_em, "
    "c.nome AS conta_nome, pr.por, m.nome AS por_nome, pr.cancelado_por, k.nome AS cancelado_nome, "
    "cr.vintens AS credito_vintens "
    "FROM loja_presentes pr JOIN loja_pedidos p ON p.id = pr.pedido_id "
    "LEFT JOIN contas c ON c.id = p.conta_id LEFT JOIN contas m ON m.id = pr.por "
    "LEFT JOIN contas k ON k.id = pr.cancelado_por LEFT JOIN loja_creditos cr ON cr.pedido_id = p.id")


# ---- funções puras ------------------------------------------------------------------
def escapa_like(texto):
    return texto.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def modo_da_busca(q):
    """(modo, número ou None, termo). '#N' → id; só dígitos → id (e o nome com
    esses dígitos, com 3 ou mais); com '@' → o e-mail INTEIRO; senão → nome, 3+
    caracteres. Levanta o 400 (antes do freio: erro de digitação não gasta vez)."""
    if not isinstance(q, str):
        raise Recusa(400, FRASE_BUSCA)
    q = q.strip()
    if not q or len(q) > BUSCA_MAX:
        raise Recusa(400, FRASE_BUSCA)
    casou = RE_ID_BUSCA.match(q)
    if q.startswith('#'):
        if casou is None:
            raise Recusa(400, FRASE_BUSCA)
        return 'id', int(casou.group(1)), q
    if casou is not None:
        return 'id', int(casou.group(1)), q
    if '@' in q:
        return 'email', None, q
    if len(q) < BUSCA_MIN:
        raise Recusa(400, FRASE_BUSCA)
    return 'nome', None, q


def id_da_consulta(v, frase):
    """O número que veio na URL (?id=, ?conta=): dígitos, > 0, < 2^53."""
    if not isinstance(v, str) or not v.isdigit() or len(v) > 16:
        raise Recusa(400, frase)
    n = int(v)
    if not 0 < n < 2 ** 53:
        raise Recusa(400, frase)
    return n


# ---- o mixin --------------------------------------------------------------------------
class MestreMixin:

    def _mestre_freio(self, conta, rotulo, maximo, frase):
        """Numa _escrita PRÓPRIA (commita sozinha): um 404/400 depois não desfaz a anotação."""
        t = agora()
        chave = 'mestre-%s:%d' % (rotulo, conta['id'])
        with self._escrita():
            libera = self._conta_limite(chave, maximo, 3600, t)
            if libera is not None:
                raise Recusa(429, frase, liberaEm=libera)
            self._anota_limite(chave, t)

    def _presente_json(self, r, t):
        entrega = le_json(r['entrega']) or {}
        return {'id': r['id'], 'conta': {'id': r['conta_id'], 'nome': r['conta_nome']}, 'sku': r['sku'],
                'nome': nome_do_pedido(r['sku'], entrega, r['credito_vintens']), 'tipo': entrega.get('tipo'),
                'estado': r['estado'], 'motivo': r['motivo'], 'criadoEm': r['criado_em'],
                'retiradoEm': r['retirado_em'], 'fechadoEm': r['fechado_em'],
                'por': {'id': r['por'], 'nome': r['por_nome']} if r['por'] is not None else None,
                'canceladoPor': ({'id': r['cancelado_por'], 'nome': r['cancelado_nome']}
                                 if r['cancelado_por'] is not None else None),
                'cancelavel': self._loja_cancelavel(r, t), 'vintens': r['credito_vintens']}

    def _presente_por_id(self, pid):
        return self.con.execute(CONSULTA_PRESENTE + " WHERE p.id = ?", (pid,)).fetchone()

    # -- POST /api/mestre/contas {q} ----------------------------------------------------------
    def mestre_contas(self, conta, corpo):
        modo, num, q = modo_da_busca(corpo.get('q'))
        self._mestre_freio(conta, 'busca', BUSCAS_POR_HORA, 'buscas demais nesta hora; espere um pouco')
        prefixo = escapa_like(q) + '%'
        if modo == 'id':
            if q.startswith('#') or len(q) < BUSCA_MIN:
                onde, args = "id = ?", [num]
            else:
                onde, args = "id = ? OR nome LIKE ? ESCAPE '\\'", [num, '%' + escapa_like(q) + '%']
        elif modo == 'email':
            onde, args = "email = ?", [q]
        else:
            onde, args = "nome LIKE ? ESCAPE '\\'", ['%' + escapa_like(q) + '%']
        with self.tranca:
            linhas = self.con.execute(
                "SELECT id, nome, email, criado_em, gm, banido FROM contas WHERE (%s) "
                "ORDER BY (id = ?) DESC, (nome = ?) DESC, (nome LIKE ? ESCAPE '\\') DESC, nome COLLATE NOCASE LIMIT ?"
                % onde, args + [num if num is not None else -1, q, prefixo, BUSCA_LISTA + 1]).fetchall()
        contas = [{'id': r['id'], 'nome': r['nome'], 'email': mascara_email(r['email']), 'criadoEm': r['criado_em'],
                   'gm': bool(r['gm']), 'banido': bool(r['banido'])} for r in linhas[:BUSCA_LISTA]]
        log.info("mestre: #%d buscou (%s) — %d achadas", conta['id'], modo, len(contas))
        return 200, {'ok': True, 'modo': modo, 'contas': contas, 'mais': len(linhas) > BUSCA_LISTA}

    # -- GET /api/mestre/conta?id=N -------------------------------------------------------------
    def mestre_conta(self, conta, corpo):
        alvo_id = id_da_consulta((corpo.get('_query') or {}).get('id'), 'id precisa ser o número da conta')
        # o freio ANTES da busca: o id que não existe também custa (sem varredura por id)
        self._mestre_freio(conta, 'ficha', FICHAS_POR_HORA, 'fichas demais nesta hora; espere um pouco')
        t = agora()
        with self.tranca:
            alvo = self.con.execute("SELECT * FROM contas WHERE id = ?", (alvo_id,)).fetchone()
            if alvo is None:
                raise Recusa(404, 'conta não encontrada')
            ultima = self.con.execute("SELECT MAX(ultimo_uso) FROM sessoes WHERE conta_id = ?", (alvo_id,)).fetchone()[0]
            save = self._loja_save(alvo_id)
            resumo = self.con.execute("SELECT nivel_max, xp_total FROM resumos WHERE conta_id = ?", (alvo_id,)).fetchone()
            fichas = {r['classe']: r for r in self.con.execute(
                "SELECT classe, nivel, elemento FROM resumos_classe WHERE conta_id = ?", (alvo_id,))}
            presentes = self.con.execute(CONSULTA_PRESENTE + " WHERE p.conta_id = ? ORDER BY p.id DESC LIMIT ?",
                                         (alvo_id, PRESENTES_DA_CONTA)).fetchall()
            progress = save['progress'] if save else None
            catalogo = []
            for item in CATALOGO:
                pode, motivo = True, None
                if alvo['banido']:
                    pode, motivo = False, 'conta banida'
                else:
                    try:
                        self._loja_confere_item(alvo_id, item, progress)
                    except Recusa as r:
                        pode, motivo = False, r.erro
                catalogo.append({'sku': item['sku'], 'nome': item['nome'], 'secao': item['secao'], 'tipo': item['tipo'],
                                 'alvo': item['alvo'], 'raridade': item.get('raridade'), 'pode': pode, 'motivo': motivo})
            saldo = self._loja_saldo(alvo_id, alvo, save)
            pagamentos = self._pagamentos_da_conta(alvo_id, PAGAMENTOS_LISTA)
            alertas = self._alertas_da_conta(alvo_id)
            presentes = [self._presente_json(r, t) for r in presentes]
        db = save['db'] if save else None
        cart = db.get('carteira') if isinstance(db, dict) else None
        lib = liberadas(progress)
        log.info("mestre: #%d abriu a ficha de #%d", conta['id'], alvo_id)
        return 200, {
            'ok': True, 'agora': t,
            'conta': {'id': alvo['id'], 'nome': alvo['nome'], 'email': alvo['email'], 'criadoEm': alvo['criado_em'],
                      'gm': bool(alvo['gm']), 'banido': bool(alvo['banido']), 'ultimaSessao': ultima},
            'save': (None if save is None else
                     {'versao': save['versao'], 'em': save['em'],
                      'vintens': limita(cart.get('moedas'), 0, CARTEIRA_TETO) if isinstance(cart, dict) else 0,
                      'nivelMax': resumo['nivel_max'] if resumo else 0, 'xpTotal': resumo['xp_total'] if resumo else 0}),
            'classes': [{'id': c, 'nivel': fichas[c]['nivel'] if c in fichas else None,
                         'elemento': fichas[c]['elemento'] if c in fichas else None}
                        for c in CLASSES_RANK if c in lib],
            'cartas': self._loja_classes(progress),
            'catalogo': catalogo,
            'presentes': presentes,
            'saldo': saldo,
            'pagamentos': pagamentos,
            'alertas': alertas,
        }

    # -- POST /api/mestre/presentear {conta, idem, sku | vintens} ------------------------------------
    def mestre_presentear(self, conta, corpo):
        alvo_id, sku, vintens, idem = corpo.get('conta'), corpo.get('sku'), corpo.get('vintens'), corpo.get('idem')
        if not id_valido(alvo_id):
            raise Recusa(400, 'conta precisa ser o número da conta')
        if sku is not None and vintens is not None:
            raise Recusa(400, 'mande sku ou vintens, não os dois')
        item = None
        if vintens is not None:
            if not id_valido(vintens) or vintens > PRESENTE_VINTENS_MAX:
                raise Recusa(400, 'vintens precisa ser um inteiro de 1 a %s' % milhar(PRESENTE_VINTENS_MAX))
            sku = SKU_PRESENTE_VINTENS
        else:
            item = POR_SKU.get(sku) if isinstance(sku, str) else None
            if item is None:
                raise Recusa(400, 'produto desconhecido')
        if not isinstance(idem, str) or not RE_IDEM.match(idem):
            raise Recusa(400, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        mestre, t = conta['id'], agora()
        with self._escrita():
            alvo = self.con.execute("SELECT id, nome, gm, banido FROM contas WHERE id = ?", (alvo_id,)).fetchone()
            if alvo is None:
                raise Recusa(404, 'conta não encontrada')
            if alvo['banido']:
                raise Recusa(409, 'essa conta está banida: o presente não entra')
            ja = self.con.execute("SELECT %s FROM %s WHERE p.conta_id = ? AND p.idem = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS),
                                  (alvo_id, idem)).fetchone()
            if ja is not None:                          # o mesmo clique chegando de novo
                if ja['presente'] and ja['sku'] == sku and (item is not None or ja['credito_vintens'] == vintens):
                    return 200, {'ok': True, 'presente': self._presente_json(self._presente_por_id(ja['id']), t),
                                 'repetido': True}
                raise Recusa(409, 'idem já usado em outro pedido')
            criados = [r[0] for r in self.con.execute(
                "SELECT criado_em FROM loja_presentes WHERE por = ? AND criado_em > ? ORDER BY criado_em",
                (mestre, t - 3600))]
            if len(criados) >= PRESENTES_POR_HORA:
                raise Recusa(429, 'presentes demais na última hora (%d)' % PRESENTES_POR_HORA,
                             liberaEm=criados[len(criados) - PRESENTES_POR_HORA] + 3600)
            if vintens is not None:
                dados_dia = self.con.execute(
                    "SELECT cr.vintens, cr.criado_em FROM loja_creditos cr JOIN loja_presentes pr ON pr.pedido_id = cr.pedido_id "
                    "WHERE cr.origem = 'presente' AND pr.por = ? AND cr.criado_em > ? ORDER BY cr.criado_em",
                    (mestre, t - 86400)).fetchall()
                soma = sum(r['vintens'] for r in dados_dia)
                if soma + vintens > PRESENTE_VINTENS_DIA:
                    libera, resto = None, soma
                    for r in dados_dia:
                        resto -= r['vintens']
                        if resto + vintens <= PRESENTE_VINTENS_DIA:
                            libera = r['criado_em'] + 86400
                            break
                    raise Recusa(429, 'vinténs de presente demais nas últimas 24 h (%s)' % milhar(PRESENTE_VINTENS_DIA),
                                 liberaEm=libera)
            save = self._loja_save(alvo_id)
            if item is not None:
                # a regra do produto (os 409 da loja); os limites, o saldo e o teto do jogador NÃO
                self._loja_confere_item(alvo_id, item, save['progress'] if save else None)
                pid = self.con.execute(
                    "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
                    "VALUES (?, ?, ?, 0, 'pendente', ?, ?)",
                    (alvo_id, sku, json.dumps(entrega_de(item), ensure_ascii=False), idem, t)).lastrowid
            else:
                pid = self.credita(alvo_id, SKU_PRESENTE_VINTENS, vintens, 'presente', idem, None, t)
            self.con.execute("INSERT INTO loja_presentes(pedido_id, por, criado_em) VALUES (?, ?, ?)", (pid, mestre, t))
            dados = {'id': pid, 'para': alvo_id, 'sku': sku, 'por': mestre}
            if vintens is not None:
                dados['vintens'] = vintens
            self._evento(alvo_id, 'presente-admin', dados)
            presente = self._presente_json(self._presente_por_id(pid), t)
        log.info("mestre: #%d deu %s a #%d (pedido %d)", mestre, sku if vintens is None else '%d vinténs' % vintens,
                 alvo_id, pid)
        return 201, {'ok': True, 'presente': presente, 'semSave': save is None}

    # -- POST /api/mestre/presente/cancelar {id} -------------------------------------------------------
    def mestre_presente_cancelar(self, conta, corpo):
        pid = corpo.get('id')
        if not id_valido(pid):
            raise Recusa(400, 'id precisa ser o número do presente')
        mestre, t = conta['id'], agora()
        with self._escrita():
            r = self._presente_por_id(pid)              # o JOIN em loja_presentes: compra comum não casa
            if r is None:
                raise Recusa(404, 'presente não encontrado')
            if r['estado'] in FECHADOS:
                raise Recusa(409, 'presente já fechado')
            if not self._loja_cancelavel(r, t):         # a mesma regra do cancelar da loja
                raise Recusa(409, 'já está a caminho do jogo; espere a entrega ou 24 h')
            self.con.execute("UPDATE loja_pedidos SET estado = 'cancelado', fechado_em = ? "
                             "WHERE id = ? AND estado IN ('pendente', 'retirado')", (t, pid))
            self.con.execute("UPDATE loja_presentes SET cancelado_por = ? WHERE pedido_id = ?", (mestre, pid))
            self._evento(r['conta_id'], 'presente-cancela',
                         {'id': pid, 'para': r['conta_id'], 'sku': r['sku'], 'por': mestre, 'de': r['estado']})
            presente = self._presente_json(self._presente_por_id(pid), t)
        log.info("mestre: #%d cancelou o presente %d", mestre, pid)
        return 200, {'ok': True, 'presente': presente}

    # -- GET /api/mestre/presentes[?conta=N] --------------------------------------------------------
    def mestre_presentes(self, conta, corpo):
        q = corpo.get('_query') or {}
        alvo = None
        if q.get('conta') is not None:
            alvo = id_da_consulta(q.get('conta'), 'conta precisa ser o número da conta')
        t = agora()
        with self.tranca:
            if alvo is None:
                linhas = self.con.execute(CONSULTA_PRESENTE + " ORDER BY p.id DESC LIMIT ?", (PRESENTES_LISTA,)).fetchall()
            else:
                linhas = self.con.execute(CONSULTA_PRESENTE + " WHERE p.conta_id = ? ORDER BY p.id DESC LIMIT ?",
                                          (alvo, PRESENTES_LISTA)).fetchall()
            presentes = [self._presente_json(r, t) for r in linhas]
        return 200, {'ok': True, 'agora': t, 'conta': alvo, 'presentes': presentes}

    # -- os alertas de pagamento (pagamento.py grava) --------------------------------------------------
    # -- POST /api/mestre/pagamento/conferir {id} --------------------------------------------------
    def mestre_pagamento_conferir(self, conta, corpo):
        """O botão "conferir no Mercado Pago" da ficha: consulta de novo um
        pagamento de QUALQUER conta — o aviso que se perdeu, o que chegou com o
        servidor mal configurado (SOTERRA_MP_TESTE trocado), o crédito que
        esperava o teto de 24 h. Nunca credita sozinho: passa pelo mesmo
        `processa` do aviso, com o que a API do Mercado Pago responde."""
        if not self._mp().ligado:
            raise Recusa(503, FRASE_EM_BREVE, pagamento=False)
        pid = corpo.get('id')
        if not id_valido(pid):
            raise Recusa(400, 'id precisa ser o número do pagamento')
        # o freio ANTES da busca: o id que não existe também custa (e cada vaga é uma consulta ao Mercado Pago)
        self._mestre_freio(conta, 'pag-conferir', CONFERE_POR_HORA, 'conferências demais nesta hora; espere um pouco')
        with self.tranca:
            pg = self.con.execute("SELECT * FROM pagamentos WHERE id = ?", (pid,)).fetchone()
        if pg is None:
            raise Recusa(404, 'pagamento não encontrado')
        achados, ignorados = self._pagamento_reconcilia(pg)
        with self.tranca:
            pub = self._pag_publico(self.con.execute("SELECT * FROM pagamentos WHERE id = ?", (pid,)).fetchone())
        log.info("mestre: #%d conferiu o pagamento %d no Mercado Pago (%d achado(s)%s)", conta['id'], pid, achados,
                 (', ignorado: ' + ', '.join(ignorados)) if ignorados else '')
        return 200, {'ok': True, 'pagamento': pub, 'achados': achados, 'ignorados': ignorados}

    def mestre_alertas(self, conta, corpo):
        with self.tranca:
            alertas = self._alertas_lista()
        return 200, {'ok': True, 'alertas': alertas}

    def mestre_alerta_visto(self, conta, corpo):
        aid = corpo.get('id')
        if not id_valido(aid):
            raise Recusa(400, 'id precisa ser o número do alerta')
        t = agora()
        with self._escrita():
            r = self.con.execute("SELECT id, conta_id, tipo, visto_em FROM contas_alertas WHERE id = ?", (aid,)).fetchone()
            if r is None:
                raise Recusa(404, 'alerta não encontrado')
            if r['visto_em'] is None:
                self.con.execute("UPDATE contas_alertas SET visto_em = ?, visto_por = ? WHERE id = ?",
                                 (t, conta['id'], aid))
                self._evento(r['conta_id'], 'alerta-visto', {'id': aid, 'tipo': r['tipo'], 'por': conta['id']})
            alerta = self._alerta_publico(self.con.execute(self.CONSULTA_ALERTAS + " WHERE a.id = ?", (aid,)).fetchone())
        return 200, {'ok': True, 'alerta': alerta}
