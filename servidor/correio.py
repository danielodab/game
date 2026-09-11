#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O correio do SOTERRA: os e-mails da conta (o código da troca de e-mail, o
código do "esqueci a senha" e os avisos de senha e e-mail trocados).
Só biblioteca padrão.

    python3 correio.py --teste ENDERECO     # um e-mail de prova (é o `admin email-teste`)

A configuração vem SÓ de variáveis de ambiente. No Coolify: Runtime ligado e
Build DESLIGADO (num deploy por Dockerfile a variável de build vira ARG, e a
senha iria para a imagem); na SENHA, marcar "Is Literal".

  SOTERRA_SMTP_HOST        ex.: smtp.gmail.com
  SOTERRA_SMTP_PORTA       587 (padrão)
  SOTERRA_SMTP_SEGURANCA   starttls (padrão) ou ssl (o padrão quando a porta é 465)
  SOTERRA_SMTP_USUARIO     o endereço completo que faz login (ex.: system@viidoo.io)
  SOTERRA_SMTP_SENHA       a senha (no Google, a senha de app); nunca vai para o log
  SOTERRA_SMTP_REMETENTE   quem aparece no From (padrão: o USUARIO)
  SOTERRA_ENDERECO         opcional (https://soterra.viidoo.io): um link simples,
                           sem token, para a página da conta no fim de cada e-mail
  SOTERRA_EMAIL_PROVA      MODO DE PROVA: cada e-mail vira uma linha JSON
                           {em, para, assunto, texto} neste arquivo e nada sai
                           da máquina. NUNCA em produção (o api.py também aceita
                           --emails-prova ARQ).

Ligado = HOST, USUARIO e SENHA presentes, ou o modo de prova. Desligado, a API
responde 503 nas rotas que mandam e-mail, e o resto funciona igual.
"""
import argparse
import json
import os
import smtplib
import ssl
import sys
import threading
import time
from email.message import EmailMessage
from email.utils import formataddr, formatdate, getaddresses, make_msgid

TIMEOUT = 15
SEGURANCAS = ('starttls', 'ssl')


class CorreioFalhou(Exception):
    """O e-mail não saiu. A mensagem é para o log: nunca leva a senha nem o
    endereço (o servidor SMTP costuma repetir o destinatário no erro, por isso
    só o código da resposta e o tipo do erro passam)."""


def _descreve(erro):
    if isinstance(erro, smtplib.SMTPAuthenticationError):
        return 'o servidor SMTP recusou o login (%s)' % erro.smtp_code
    if isinstance(erro, smtplib.SMTPResponseException):
        return 'o servidor SMTP respondeu %s' % erro.smtp_code
    return erro.__class__.__name__


class Correio:
    """Sem argumentos: desligado (é o que o cartório usa quando ninguém passa
    um correio, como nos testes que criam a Api dentro do processo)."""

    def __init__(self, host=None, porta=587, seguranca=None, usuario=None, senha=None, remetente=None,
                 prova=None, endereco=None, erro=None):
        self.host = host or None
        self.porta = porta
        self.seguranca = seguranca or ('ssl' if porta == 465 else 'starttls')
        self.usuario = usuario or None
        self._senha = senha or None
        self.remetente = remetente or usuario or None
        self.prova = prova or None
        self.endereco = (endereco or '').rstrip('/') or None
        self.erro = erro                 # configuração torta: fica desligado, e a descrição diz por quê
        self._trava = threading.Lock()

    def __repr__(self):                 # nunca a senha, nem num traceback
        return '<Correio %s>' % self.descricao()

    @classmethod
    def do_ambiente(cls, env=None, prova=None):
        env = os.environ if env is None else env

        def valor(nome):
            v = env.get(nome)
            return v.strip() if isinstance(v, str) and v.strip() else None

        prova = prova or valor('SOTERRA_EMAIL_PROVA')
        endereco = valor('SOTERRA_ENDERECO')
        if prova:
            return cls(prova=prova, endereco=endereco,
                       remetente=valor('SOTERRA_SMTP_REMETENTE') or 'nao-responda@soterra.prova')
        erro = None
        porta = 587
        if valor('SOTERRA_SMTP_PORTA') is not None:
            try:
                porta = int(valor('SOTERRA_SMTP_PORTA'))
                if not 0 < porta < 65536:
                    raise ValueError
            except ValueError:
                erro, porta = 'SOTERRA_SMTP_PORTA precisa ser um número de porta', 587
        seguranca = valor('SOTERRA_SMTP_SEGURANCA')
        if seguranca is not None:
            seguranca = seguranca.lower()
            if seguranca not in SEGURANCAS:
                erro, seguranca = 'SOTERRA_SMTP_SEGURANCA precisa ser starttls ou ssl', None
        senha = env.get('SOTERRA_SMTP_SENHA')
        return cls(host=valor('SOTERRA_SMTP_HOST'), porta=porta, seguranca=seguranca,
                   usuario=valor('SOTERRA_SMTP_USUARIO'),
                   senha=senha if isinstance(senha, str) and senha.strip() else None,
                   remetente=valor('SOTERRA_SMTP_REMETENTE'), endereco=endereco, erro=erro)

    @property
    def ligado(self):
        if self.prova:
            return True
        return self.erro is None and bool(self.host and self.usuario and self._senha)

    def descricao(self):
        """A linha do log de boot. Nunca a senha."""
        if self.prova:
            return 'PROVA em %s' % self.prova
        if self.erro:
            return 'DESLIGADO (%s)' % self.erro
        if not self.ligado:
            faltam = [nome for nome, v in (('SOTERRA_SMTP_HOST', self.host), ('SOTERRA_SMTP_USUARIO', self.usuario),
                                           ('SOTERRA_SMTP_SENHA', self._senha)) if not v]
            return 'DESLIGADO' + (' (falta %s)' % ', '.join(faltam) if len(faltam) < 3 else '')
        return '%s:%d %s como %s' % (self.host, self.porta, self.seguranca, self.remetente)

    @staticmethod
    def _um_destinatario(para):
        """Um endereço só: 'a@b.com, c@d.com' no To seriam dois destinatários."""
        if not isinstance(para, str) or '\r' in para or '\n' in para:
            raise CorreioFalhou('destinatário inválido')
        pares = getaddresses([para])
        if len(pares) != 1 or '@' not in pares[0][1] or pares[0][1] != para.strip():
            raise CorreioFalhou('destinatário inválido')
        return pares[0][1]

    def _monta(self, para, assunto, texto):
        msg = EmailMessage()
        msg['From'] = formataddr(('SOTERRA', self.remetente))
        msg['To'] = para
        msg['Subject'] = assunto
        msg['Date'] = formatdate()
        dominio = self.remetente.rsplit('@', 1)[1] if self.remetente and '@' in self.remetente else None
        msg['Message-ID'] = make_msgid(domain=dominio)
        msg['Auto-Submitted'] = 'auto-generated'        # RFC 3834: resposta automática não volta
        msg.set_content(texto)                          # texto simples, UTF-8
        return msg

    def envia(self, para, assunto, texto):
        """Manda um e-mail. Levanta CorreioFalhou se não sair (a mensagem vai
        para o log sem endereço, sem senha e sem código)."""
        if not self.ligado:
            raise CorreioFalhou('o correio está desligado')
        para = self._um_destinatario(para)
        if self.prova:
            linha = json.dumps({'em': int(time.time()), 'para': para, 'assunto': assunto, 'texto': texto},
                               ensure_ascii=False)
            with self._trava:
                try:
                    with open(self.prova, 'a', encoding='utf-8') as f:
                        f.write(linha + '\n')
                except OSError as e:
                    raise CorreioFalhou('o arquivo de prova não abriu (%s)' % e.__class__.__name__) from None
            return
        msg = self._monta(para, assunto, texto)
        ctx = ssl.create_default_context()          # confere o certificado e o nome do servidor
        s = None
        try:
            if self.seguranca == 'ssl':
                s = smtplib.SMTP_SSL(self.host, self.porta, timeout=TIMEOUT, context=ctx)
            else:
                s = smtplib.SMTP(self.host, self.porta, timeout=TIMEOUT)
                s.ehlo()
                s.starttls(context=ctx)
                s.ehlo()
            s.login(self.usuario, self._senha)
            s.send_message(msg)
        except (smtplib.SMTPException, OSError, ssl.SSLError) as e:
            raise CorreioFalhou(_descreve(e)) from None
        finally:
            if s is not None:
                try:
                    s.quit()
                except Exception:
                    try:
                        s.close()
                    except Exception:
                        pass


def main(argv=None):
    try:
        sys.stdout.reconfigure(errors='replace')
    except Exception:
        pass
    ap = argparse.ArgumentParser(description='O correio do SOTERRA: manda um e-mail de prova')
    ap.add_argument('--teste', metavar='ENDERECO', required=True, help='o endereço que recebe o e-mail de prova')
    ap.add_argument('--emails-prova', metavar='ARQ', default=None,
                    help='modo de prova: escreve o e-mail no arquivo em vez de mandar')
    args = ap.parse_args(argv)
    c = Correio.do_ambiente(prova=args.emails_prova)
    print('correio: ' + c.descricao())
    if not c.ligado:
        print('O envio está desligado. No Coolify, em Environment Variables, ponha SOTERRA_SMTP_HOST, '
              'SOTERRA_SMTP_USUARIO e SOTERRA_SMTP_SENHA (Runtime ligado, Build desligado) e faça Redeploy.')
        return 2
    texto = ('Este é um e-mail de teste do servidor do SOTERRA.\n\n'
             'Se ele chegou, o envio está funcionando. Se caiu no spam, confira o SPF, o DKIM e o DMARC do '
             'domínio: no Gmail, "Mostrar original" tem de dizer PASS nos três.\n\n'
             '— SOTERRA (mensagem automática)\n')
    try:
        c.envia(args.teste, 'SOTERRA: e-mail de teste', texto)
    except CorreioFalhou as e:
        print('O envio falhou: %s' % e)
        return 1
    print('Mandado. Confira a caixa de entrada e o spam de %s.' % args.teste)
    return 0


if __name__ == '__main__':
    sys.exit(main())
