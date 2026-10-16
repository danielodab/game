# -*- coding: utf-8 -*-
"""O CONVITE (15/10) — o link que chama um amigo, e o prêmio para os dois.

O dono: "tem chance de ser viral?" — o convite dentro do jogo era só entre contas que já existiam.
Aqui cada conta tem um CÓDIGO (8 letras e dígitos, sem I/O/0/1) e um link para o cadastro do site
(`site/conta.html?convite=<código>#criar`); quem se cadastra pelo link fica anotado em `convidados`.
Quando o convidado VENCE A PRIMEIRA SALA (confirmada pelo juiz, em servidor/salas.py), os dois ganham
vinténs pela fila da loja (loja_pedidos de preço 0, como a trilha e o prêmio diário) — o convidado
na hora (`_loja_depois_da_luta`), o convidante na hora também (`_loja_na_hora`) ou na próxima vez
que abrir o jogo.

Contra o abuso: nada de convidar a si mesmo; o cadastro com código inválido não falha (o código só é
ignorado); o prêmio só sai com a VITÓRIA confirmada e uma vez por convidado; não sai quando as duas
contas estão no MESMO endereço agora (a sessão viva de cada uma, sessoes_extra — duas contas do mesmo
celular); e o convidante recebe no máximo PAGOS_POR_DIA por dia e PAGOS_TOTAL ao todo (o convidado
recebe mesmo assim: ele jogou de verdade).

Privacidade: as duas tabelas guardam só números de conta (e somem com a conta: ON DELETE CASCADE /
SET NULL); o endereço NÃO é gravado aqui — a comparação lê o que a sessão já guarda.
"""
import os
import re
import secrets

from comum import Recusa, agora

SITE = os.environ.get('SOTERRA_SITE', 'https://soterra.viidoo.io')
VINTENS_CONVIDADO = 500
VINTENS_CONVIDANTE = 500
PAGOS_POR_DIA = 5
PAGOS_TOTAL = 100
SKU = 'convite-vintens'
ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
CODIGO_RE = re.compile(r'^[A-Z2-9]{8}$')

ESQUEMA_CONVITES = """
-- 15/10: o convite (servidor/convites.py): o código de cada conta, e quem veio por quem
CREATE TABLE IF NOT EXISTS convites(
  conta_id   INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  codigo     TEXT NOT NULL UNIQUE,
  criado_em  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS convidados(
  conta_id     INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  convidou_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  criado_em    INTEGER NOT NULL,
  pago_em      INTEGER,
  motivo       TEXT
);
CREATE INDEX IF NOT EXISTS convidados_convidou ON convidados(convidou_id, pago_em);
"""

ROTAS_CONVITES = {
    ('GET', '/api/convite'): ('convite_ler', True),
}


def novo_codigo():
    return ''.join(secrets.choice(ALFABETO) for _ in range(8))


def codigo_limpo(v):
    if not isinstance(v, str):
        return None
    v = v.strip().upper()
    return v if CODIGO_RE.match(v) else None


def link_de(codigo):
    return '%s/site/conta.html?convite=%s#criar' % (SITE, codigo)


class ConvitesMixin:

    def _convite_codigo(self, cid, t):
        """Dentro da tranca de escrita: o código da conta (nasce na primeira vez)."""
        r = self.con.execute("SELECT codigo FROM convites WHERE conta_id = ?", (cid,)).fetchone()
        if r is not None:
            return r['codigo']
        for _ in range(20):
            c = novo_codigo()
            if self.con.execute("SELECT 1 FROM convites WHERE codigo = ?", (c,)).fetchone() is None:
                self.con.execute("INSERT INTO convites(conta_id, codigo, criado_em) VALUES (?, ?, ?)", (cid, c, t))
                return c
        raise Recusa(500, 'não deu para sortear um código de convite')

    # -- GET /api/convite ---------------------------------------------------------------------
    def convite_ler(self, conta, corpo):
        cid = conta['id']
        t = agora()
        with self._escrita():
            codigo = self._convite_codigo(cid, t)
            n = self.con.execute("SELECT COUNT(*) FROM convidados WHERE convidou_id = ?", (cid,)).fetchone()[0]
            pagos = self.con.execute("SELECT COUNT(*) FROM convidados WHERE convidou_id = ? AND pago_em IS NOT NULL AND motivo IS NULL",
                                     (cid,)).fetchone()[0]
            veio = self.con.execute("SELECT convidou_id, pago_em, motivo FROM convidados WHERE conta_id = ?", (cid,)).fetchone()
        return 200, {'ok': True, 'codigo': codigo, 'link': link_de(codigo), 'convidados': n, 'pagos': pagos,
                     'premio': VINTENS_CONVIDANTE, 'premioConvidado': VINTENS_CONVIDADO, 'limiteDia': PAGOS_POR_DIA,
                     'convidado': bool(veio and veio['convidou_id']), 'convidadoPago': bool(veio and veio['pago_em'] and not veio['motivo'])}

    # -- no cadastro (dentro da tranca do cadastro) --------------------------------------------
    def _convite_registra(self, cid, codigo, t):
        """Anota de quem veio a conta nova; código inválido ou próprio = nada. Devolve o id de quem convidou."""
        c = codigo_limpo(codigo)
        if not c:
            return None
        r = self.con.execute("SELECT conta_id FROM convites WHERE codigo = ?", (c,)).fetchone()
        if r is None or r['conta_id'] == cid:
            return None
        self.con.execute("INSERT OR IGNORE INTO convidados(conta_id, convidou_id, criado_em) VALUES (?, ?, ?)", (cid, r['conta_id'], t))
        return r['conta_id']

    def _ip_vivo(self, cid):
        r = self.con.execute(
            "SELECT x.ip FROM sessoes s JOIN sessoes_extra x ON x.token = s.token WHERE s.conta_id = ? "
            "ORDER BY s.ultimo_uso DESC LIMIT 1", (cid,)).fetchone()
        return (r['ip'] or None) if r is not None else None

    # -- na vitória confirmada (dentro da _escrita do sala_fechar) ----------------------------
    def _convite_paga(self, cid, t):
        """O convidado `cid` venceu uma sala: paga os dois (uma vez) e devolve o id de quem convidou, ou None."""
        r = self.con.execute("SELECT convidou_id FROM convidados WHERE conta_id = ? AND pago_em IS NULL", (cid,)).fetchone()
        if r is None or r['convidou_id'] is None:
            return None
        inv = r['convidou_id']
        quem = self.con.execute("SELECT banido FROM contas WHERE id = ?", (inv,)).fetchone()
        if quem is None or quem['banido']:
            self.con.execute("UPDATE convidados SET pago_em = ?, motivo = 'convidante-fora' WHERE conta_id = ?", (t, cid))
            return None
        ip_a, ip_b = self._ip_vivo(cid), self._ip_vivo(inv)
        if ip_a and ip_b and ip_a == ip_b:
            self.con.execute("UPDATE convidados SET pago_em = ?, motivo = 'mesmo-endereco' WHERE conta_id = ?", (t, cid))
            return None
        total = self.con.execute("SELECT COUNT(*) FROM convidados WHERE convidou_id = ? AND pago_em IS NOT NULL AND motivo IS NULL",
                                 (inv,)).fetchone()[0]
        dia = self.con.execute("SELECT COUNT(*) FROM convidados WHERE convidou_id = ? AND pago_em > ? AND motivo IS NULL",
                               (inv, t - 86400)).fetchone()[0]
        # o convidado ganha sempre (jogou de verdade); o convidante só dentro dos tetos
        self.credita(cid, SKU, VINTENS_CONVIDADO, 'presente', 'convite-%d-b' % cid, None, t)
        if total >= PAGOS_TOTAL or dia >= PAGOS_POR_DIA:
            self.con.execute("UPDATE convidados SET pago_em = ?, motivo = ? WHERE conta_id = ?",
                             (t, 'teto-total' if total >= PAGOS_TOTAL else 'teto-dia', cid))
            self._evento(cid, 'convite-pago', {'convidou': inv, 'convidante': False})
            return None
        self.credita(inv, SKU, VINTENS_CONVIDANTE, 'presente', 'convite-%d-a' % cid, None, t)
        self.con.execute("UPDATE convidados SET pago_em = ? WHERE conta_id = ?", (t, cid))
        self._evento(cid, 'convite-pago', {'convidou': inv, 'convidante': True})
        return inv

    def _convite_entrega_convidante(self, inv):
        """Fora da tranca: a entrega na hora para quem convidou (se o jogo dele estiver aberto, chega em 30 s)."""
        try:
            with self.tranca:
                row = self.con.execute("SELECT * FROM contas WHERE id = ?", (inv,)).fetchone()
            if row is not None and hasattr(self, '_loja_na_hora'):
                self._loja_na_hora(dict(row))
        except Exception:
            pass
