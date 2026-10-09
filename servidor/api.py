#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A API — o cartório do SOTERRA (fase 3 da vida online: a conta no servidor).

    python api.py [--host 127.0.0.1] [--porta 8300] [--banco dados/soterra.db] [--emails-prova ARQ]
                  [--mp-api URL]   (só nas provas: o Mercado Pago de mentira)

O QUE ELA É: guarda a conta (nome, e-mail, senha picada), o save (o Progress e
o DB local do cliente, como JSON OPACO — o servidor não entende de feitiços) e,
o mais importante, o REGISTRO DE INSTÂNCIAS: cada cópia de item que nasce no
jogo tem um iid, e o servidor sabe de quem é e se ainda existe. É isso que
impede o truque clássico de "copiar o save e ficar com dois": o mesmo iid não
pode estar em dois lugares, o que foi consumido (fundido, vendido, forjado)
não volta, e o que é de outra conta só chega pela rota de troca.

O QUE ELA NÃO É: não valida o saque — nesta fase é o CLIENTE quem sorteia e
manda `nascimentos`; o servidor só garante que o que nasceu uma vez não vira
dois. Regras de sorteio no servidor são a fase seguinte.

DESDE 10/09 ela também guarda os EVENTOS DO MUNDO (a "agenda": XP em dobro,
Maré da Cisterna…, ligados pelo Mestre e lidos por todos em /api/eventos) e o
RANKING POR CLASSE (a melhor ficha de cada classe de cada conta, com o avatar).

NA FASE C entram a CONTA NO SITE (trocar a senha, trocar o e-mail com código,
"esqueci a senha" e as sessões: conta.py, que manda e-mail pelo correio.py) e
a LOJA DE VINTÉNS (loja.py), como mixins desta mesma Api. As primitivas que os
três dividem moram em comum.py (ver lá a armadilha do __main__).

NA LOJA 2 (10/09) entram o PAINEL DO MESTRE (mestre.py: buscar qualquer conta
e dar presentes: classes, itens da loja e vinténs), os PACOTES DE VINTÉNS pagos
no Mercado Pago (pagamento.py) e o RETRATO que o jogador escolhe no site para o
ranking (conta.py, GET/POST /api/avatar).

NO VPS ela fica atrás do Caddy (https://<dominio>/api/* → 127.0.0.1:8300; ver
Caddyfile e soterra-api.service ao lado), irmã do Relé. Em casa, roda direto e
o site aponta com `?api=http://127.0.0.1:8300`.

Só biblioteca padrão de propósito: http.server, sqlite3, hashlib, secrets,
hmac, json. Nada para instalar no VPS além do python3.
"""
import argparse
import contextlib
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

# As primitivas moram em comum.py (a armadilha do __main__: ver o topo de lá).
# Importadas aqui, continuam valendo como api.Recusa, api.email_valido, api.XP_MAX…
from comum import (CLASSE_RENOMEADA, CLASSES_RANK, ELEMENTOS, LOGIN_JANELA, LOGIN_TENTATIVAS,  # noqa: F401
                   NIVEL_MAX, NOME_DO_MESTRE, NOME_PUBLICO_SQL, ORIGENS, PBKDF2_VOLTAS, RE_IID, SESSAO_DIAS, XP_MAX, Recusa, agora, classe_do_heroi,
                   email_novo_valido, email_valido, iid_valido, inteiro, ip_do_pedido, limita, nome_valido,
                   pica_senha, senha_valida)
from conta import (CADASTRO_POR_IP, ESQUEMA_CONTA, FRASE_IP_CADASTRO, FRASE_IP_SENHA, FRASE_OUTRO_APARELHO,
                   LOGIN_POR_IP, MOTIVO_OUTRO_APARELHO, MUITAS_TENTATIVAS, ContaMixin, carrega_segredo)
from correio import Correio
from loja import ESQUEMA_LOJA, LojaMixin
from mestre import FRASE_SO_MESTRE, MestreMixin
from pagamento import ESQUEMA_PAGAMENTO, MercadoPago, PagamentoMixin, base_de_prova
from anuncio import ESQUEMA_ANUNCIO, Anuncios, AnuncioMixin
from pagamento_play import ESQUEMA_PLAY, GooglePlay, PagamentoPlayMixin, liga_varredura
from comum import le_consulta   # a consulta da URL (?id=, ?data.id=): o painel do Mestre e o aviso do Mercado Pago
from guilda import ESQUEMA_GUILDA, GuildaMixin   # 11/09: a guilda no servidor (antes morava em cada navegador)
from amigos import ESQUEMA_AMIGOS, AmigosMixin   # 13/09: amigos e inimigos da conta
from juiz_ponte import Juiz   # 12/09: as regras do jogo em Node (servidor/juiz/) — a segurança
# 13/09: a autoridade (salas.py): bilhete e fechamento de sala, ops de economia, o PUT cosmético
from salas import ESQUEMA_SALAS, SalasMixin, chave_do_lado, lado_da_troca, lado_vazio
from grupo import ESQUEMA_GRUPO, GrupoMixin   # 13/09: a sala em grupo e o duelo ranqueado conferidos no servidor
from arena import ESQUEMA_ARENA, ArenaMixin   # 14/09: a fila da Arena (o PvP ranqueado por inscrição)
from guerra import ESQUEMA_GUERRA, GuerraMixin   # 15/09: a guerra de guilda 2x2 na Sede (a fila e o XP da guilda)
from mercado import ESQUEMA_MERCADO, MercadoMixin   # 13/09: o mercadinho entre contas, com propostas
from presenca import ESQUEMA_PRESENCA   # 15/09: a queda e a volta de cada conta, contadas pelo Relé (a prova do W.O.)
from supremo import ESQUEMA_SUPREMO, SupremoMixin   # 02/10: o Eco Primordial (a tentativa, o placar e a semana)
from supremo import FUSO_S as FUSO_S_BR, dia_de     # 07/10: o dia de Brasília do programa da semana
from trilha import ESQUEMA_TRILHA, ROTAS_TRILHA, TrilhaMixin   # 07/10: a trilha da temporada (trilha.py)
from premio_diario import ESQUEMA_DIARIO, ROTAS_DIARIO, DiarioMixin   # 08/10: o prêmio diário de resgate (premio_diario.py)
# 02/10: os direitos do titular (aceite dos termos, excluir a conta, baixar os dados) e o registro de erros
from privacidade import ESQUEMA_PRIVACIDADE, ROTAS_PRIVACIDADE, PrivacidadeMixin, confere_aceite
from registros import ESQUEMA_REGISTROS, ROTAS_REGISTROS, RegistrosMixin
import nomes                    # a lei dos nomes (servidor/nomes.py): o cadastro recusa quem veste a equipe
# 02/10: a moderação (servidor/moderacao.py): banimento com prazo, silêncio, denúncias, auditoria do Mestre
from moderacao import DO_BANIDO, ESQUEMA_MODERACAO, FRASE_BANIDA, ModeracaoMixin

log = logging.getLogger("api")

# ---- as réguas -------------------------------------------------------------
LIMITE_CORPO = 2 * 1024 * 1024   # um save tem dezenas de KB; 2 MB é folga, acima é abuso
# o motivo da lei dos nomes para o nome NOVO que veste a equipe do jogo: o mesmo
# texto de nomes.valida (a prova confere, para os dois não se separarem)
NOME_RESERVADO = 'esse nome é reservado à equipe do jogo'
# SESSAO_DIAS, LOGIN_TENTATIVAS, LOGIN_JANELA e PBKDF2_VOLTAS moram em comum.py (a conta.py usa também)
NASC_POR_PUT = 200               # instâncias novas num save só
NASC_POR_HORA = 2000             # e por hora, por conta (ninguém saqueia tanto)
TROCA_VALIDADE = 120             # a intenção de troca espera o parceiro por 2 min
TROCA_GRACA = 10 * 60            # item recém-recebido não é varrido por 10 min (ver salvar)
RANKING_CACHE = 30               # segundos que o GET /api/ranking fica guardado por processo (ver ranking)
# ORIGENS, RE_IID e iid_valido moram em comum.py desde 13/09: a autoridade (salas.py) registra séries também

# ---- os eventos do mundo e o ranking por classe (10/09) ---------------------
# No código a palavra é "agenda": "evento" já tem dono aqui (a trilha de
# auditoria, tabela `eventos`). Para o público, as rotas são /api/eventos.
# Cinco tipos, cada um com TETO; eventos do mesmo tipo não se multiplicam (vale
# o maior). Nenhum mexe na raridade das peças, na Âncora, nos selos, nas
# insígnias nem nas cartas: "o drop de itens bons deve ser MUITO difícil".
# Quem calcula a recompensa é o cliente (a mesma confiança do saque, ver o
# topo): o teto segura erro de digitação do Mestre, não trapaça.
# 12/09, pedido do dono: "devo conseguir colocar o rate que eu quiser" — o
# Mestre escolhe o número (mais de 1 até ×10); o ×10 só segura o zero a mais.
# js/core/agenda.js tem a cópia destes números.
AGENDA_TETOS = {'xp': 20.0, 'vintem': 10.0, 'pedras': 10.0, 'saque': 10.0, 'aviso': 1.0}   # 09/10: XP até ×20 (o dono)
# A SEMANA DO SOTERRA (07/10; o dono: "quero um jogo que o jogador tenha motivo para voltar"). Um programa FIXO:
# cada dia da semana (Brasília) tem um bônus próprio, publicado como evento do mundo (`semanais`, como a semana
# do Eco) e pago pelo servidor (_fatores_no_ar). Os números são modestos de propósito — a economia é dura por
# desenho, e o que se quer é ritmo, não inflação: ×1,25 no XP e no saque; ×1,5 nas moedas baratas (pedras e
# vinténs); a sexta dobra o saque SÓ do Calabouço do Dia (que já paga ×1,5: o evento não empilha com o Dia,
# vale o maior — a sexta é +33% sobre ele). `dia` 0 = domingo, como o getDay do JS e as regras do Mestre.
# PROGRAMA_SEMANAL=0 no ambiente desliga tudo (como LOJA_OFERTAS=0).
PROGRAMA_LIGADO = os.environ.get('PROGRAMA_SEMANAL', '1').strip() != '0'
PROGRAMA_SEMANAL = (
    {'dia': 0, 'tipo': 'pedras', 'multiplicador': 1.5, 'calabouco': 'poco', 'titulo': 'Domingo do Poço',
     'texto': 'As pedras do Poço sem Fundo ×1,5 — e o recorde da semana fecha à meia-noite.'},
    {'dia': 1, 'tipo': 'vintem', 'multiplicador': 1.5, 'calabouco': None, 'titulo': 'Segunda dos Vinténs',
     'texto': 'Toda sala paga vinténs ×1,5. O Eco Primordial abre a semana.'},
    {'dia': 2, 'tipo': 'pedras', 'multiplicador': 1.5, 'calabouco': None, 'titulo': 'Terça das Pedras',
     'texto': 'As pedras de forja de todo calabouço ×1,5.'},
    {'dia': 3, 'tipo': 'xp', 'multiplicador': 1.25, 'calabouco': None, 'titulo': 'Quarta da Descida',
     'texto': 'XP ×1,25 em toda sala.'},
    {'dia': 4, 'tipo': 'saque', 'multiplicador': 1.25, 'calabouco': None, 'titulo': 'Quinta do Saque',
     'texto': 'O saque de toda sala ×1,25.'},
    {'dia': 5, 'tipo': 'saque', 'multiplicador': 2.0, 'calabouco': 'dia', 'titulo': 'Sexta do Dia',
     'texto': 'O Calabouço do Dia paga saque ×2 (no lugar do ×1,5 de sempre).'},
    {'dia': 6, 'tipo': 'xp', 'multiplicador': 1.5, 'calabouco': None, 'titulo': 'Sábado Cheio',
     'texto': 'XP ×1,5 em toda sala — o dia de descer com a guilda.'},
)
PROGRAMA_POR_DIA = {p['dia']: p for p in PROGRAMA_SEMANAL}
# os calabouços que um evento pode mirar (null = todos). O servidor não sabe
# quais portais estão fechados — isso mora em dungeons.js, e uma terceira cópia
# ficaria velha. Evento num portal fechado só não tem efeito: ninguém desce lá.
CALABOUCOS = ('greenhouse', 'cistern', 'emberlock', 'windscaffold', 'quakemine', 'brokenheart', 'poco')
# CLASSES_RANK, CLASSE_RENOMEADA, XP_MAX, NIVEL_MAX e ELEMENTOS (as réguas do jogo
# que o servidor copia; o teste pega a deriva) moram em comum.py: a loja.py usa também
# O relógio de parede é o de Brasília com deslocamento FIXO: o contêiner não
# instala tzdata (zoneinfo falharia) e o Brasil não tem horário de verão desde 2019.
FUSO_MIN = -180
FUSO = timezone(timedelta(minutes=FUSO_MIN))
JANELA_DIAS = 14                 # o GET mostra as próximas duas semanas
PROXIMOS_MAX = 50
EVENTO_TITULO = (3, 60)          # caracteres, depois do strip
EVENTO_TEXTO = 280
EVENTO_FOLGA = 60                # um início até 1 min no passado ainda é "agora" (relógio do cliente)
EVENTO_ANTECEDENCIA = 180 * 86400
EVENTO_DURACAO = 7 * 86400
EVENTOS_MARCADOS_MAX = 50        # pontuais que ainda não acabaram, fora os cancelados
REGRAS_MAX = 20                  # regras vigentes
REGRA_DURACAO = (15, 1440)       # minutos: de um quarto de hora a um dia inteiro
RE_HORA = re.compile(r'^(\d{1,2}):(\d{2})$')

ESQUEMA = """
CREATE TABLE IF NOT EXISTS contas(
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  sal        TEXT NOT NULL,
  criado_em  INTEGER NOT NULL,
  gm         INTEGER NOT NULL DEFAULT 0,
  banido     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessoes(
  token      TEXT PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  criado_em  INTEGER NOT NULL,
  ultimo_uso INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessoes_conta ON sessoes(conta_id);
CREATE TABLE IF NOT EXISTS saves(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  progress      TEXT,
  db            TEXT,
  versao        INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS itens(
  iid       TEXT PRIMARY KEY,
  conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  item_id   TEXT NOT NULL DEFAULT '',
  origem    TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  estado    TEXT NOT NULL DEFAULT 'vivo' CHECK (estado IN ('vivo', 'fora'))
);
CREATE INDEX IF NOT EXISTS itens_conta ON itens(conta_id, estado);
CREATE INDEX IF NOT EXISTS itens_nascidos ON itens(conta_id, criado_em);
CREATE TABLE IF NOT EXISTS resumos(
  conta_id       INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  nome           TEXT,
  xp_total       INTEGER NOT NULL DEFAULT 0,
  nivel_max      INTEGER NOT NULL DEFAULT 0,
  classes        INTEGER NOT NULL DEFAULT 0,
  brasa_pts      INTEGER NOT NULL DEFAULT 0,
  brasa_partidas INTEGER NOT NULL DEFAULT 0,
  guilda_nome    TEXT,
  guilda_emblema TEXT,
  atualizado_em  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eventos(
  id        INTEGER PRIMARY KEY,
  conta_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  tipo      TEXT NOT NULL,
  dados     TEXT,
  criado_em INTEGER NOT NULL
);
-- 08/10 à noite: A PLATEIA — o que o mundo inteiro fica sabendo (peça épica, Gema com +1 PA, coroa nova). A API
-- grava aqui (_plateia), o relé lê o que é novo (rele.py, vigia_plateia) e anuncia no chat da praça. Nunca apaga
CREATE TABLE IF NOT EXISTS plateia(
  id        INTEGER PRIMARY KEY,
  conta_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  nome      TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  dados     TEXT,
  criado_em INTEGER NOT NULL
);
-- os eventos do mundo (10/09). Cancelar grava cancelado_em e nunca apaga: a
-- linha fica como trilha. O público nunca vê criado_por, criado_em nem o cancelado.
CREATE TABLE IF NOT EXISTS agenda_eventos(
  id            INTEGER PRIMARY KEY,
  tipo          TEXT NOT NULL,
  multiplicador REAL NOT NULL DEFAULT 1,
  calabouco     TEXT,
  titulo        TEXT NOT NULL,
  texto         TEXT,
  inicio        INTEGER NOT NULL,
  fim           INTEGER NOT NULL,
  criado_por    INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  criado_em     INTEGER NOT NULL,
  cancelado_em  INTEGER,
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS agenda_eventos_janela ON agenda_eventos(fim, inicio);
-- o calendário automático: dias da semana ("0,6"; 0 = domingo, como o getDay
-- do JS), hora de Brasília em minutos e duração. O servidor expande no GET.
CREATE TABLE IF NOT EXISTS agenda_regras(
  id            INTEGER PRIMARY KEY,
  tipo          TEXT NOT NULL,
  multiplicador REAL NOT NULL DEFAULT 1,
  calabouco     TEXT,
  titulo        TEXT NOT NULL,
  texto         TEXT,
  dias          TEXT NOT NULL,
  hora_min      INTEGER NOT NULL,
  duracao_min   INTEGER NOT NULL,
  vigente_de    INTEGER,
  vigente_ate   INTEGER,
  criado_por    INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  criado_em     INTEGER NOT NULL,
  cancelado_em  INTEGER
);
-- o ranking por classe (10/09): a melhor ficha de cada classe da conta. Tabelas
-- novas em vez de colunas em `resumos`: sem ALTER, o contêiner velho e o novo
-- sobem juntos no mesmo banco (rolling update do Coolify) sem "duplicate column".
CREATE TABLE IF NOT EXISTS resumos_classe(
  conta_id      INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  classe        TEXT NOT NULL,
  heroi_id      TEXT NOT NULL,
  nivel         INTEGER NOT NULL DEFAULT 1,
  xp            INTEGER NOT NULL DEFAULT 0,
  elemento      TEXT,
  atualizado_em INTEGER NOT NULL,
  PRIMARY KEY (conta_id, classe)
);
CREATE INDEX IF NOT EXISTS resumos_classe_rank ON resumos_classe(classe, xp DESC);
CREATE TABLE IF NOT EXISTS resumos_extra(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  avatar        TEXT,
  classe        TEXT,
  atualizado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS migracoes(
  nome          TEXT PRIMARY KEY,
  feita_em      INTEGER NOT NULL
);
-- 04/10: de quem é cada CÓDIGO DE JOGADOR (o jogador.id do save, que é a identidade na praça: o Relé
-- trata como eco de si mesmo tudo o que chega com o próprio id). Duas contas com o mesmo código não se
-- viam. O código é de UMA conta só — a primeira que o trouxe; a outra recebe a ordem de trocar
-- (ver _jid_confere). Tabela nova, sem ALTER: o save e a conta ficam como estão.
CREATE TABLE IF NOT EXISTS jogador_ids(
  jid           TEXT PRIMARY KEY,
  conta_id      INTEGER NOT NULL,
  criado_em     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jogador_ids_conta ON jogador_ids(conta_id);
"""

# rota → (método da Api, precisa de conta?[, só do Mestre?[, a frase do 403 de quem não é]])
ROTAS = {
    ('POST', '/api/cadastro'): ('cadastro', False),
    ('POST', '/api/login'):    ('login', False),
    ('POST', '/api/logout'):   ('logout', True),
    ('GET',  '/api/eu'):       ('eu', True),
    ('GET',  '/api/save'):     ('save_ler', True),
    ('PUT',  '/api/save'):     ('salvar', True),
    ('POST', '/api/jogador-id'): ('jogador_id', True),   # 04/10: o código de jogador é de uma conta só
    ('POST', '/api/troca'):    ('troca', True),
    ('GET',  '/api/ranking'):  ('ranking', False),
    ('GET',  '/api/saude'):    ('saude', False),
    # os eventos do mundo (10/09): ler é público; criar, agendar e cancelar só a
    # conta que o servidor marcou (contas.gm = 1). POST, e não DELETE nem id no
    # caminho: `despacha` casa o caminho exato e o DELETE chega sem corpo.
    ('GET',  '/api/eventos'):          ('eventos_ler', False),
    ('POST', '/api/eventos'):          ('evento_criar', True, True),
    ('POST', '/api/eventos/regras'):   ('regra_criar', True, True),
    ('POST', '/api/eventos/cancelar'): ('evento_cancelar', True, True),
    # a conta no site (Fase C, conta.py): 401 só quer dizer token morto; senha
    # ou código errado é 400. O "esqueci" é sem conta (quem esqueceu não tem token).
    ('GET',  '/api/conta'):                  ('conta_dados', True),
    ('POST', '/api/conta/senha'):            ('conta_senha', True),
    ('POST', '/api/conta/email/pedir'):      ('conta_email_pedir', True),
    ('POST', '/api/conta/email/confirmar'):  ('conta_email_confirmar', True),
    ('POST', '/api/conta/sessoes/encerrar'): ('conta_sessoes_encerrar', True),
    ('POST', '/api/esqueci'):                ('esqueci', False),
    ('POST', '/api/esqueci/confirmar'):      ('esqueci_confirmar', False),
    # a loja de vinténs (Fase C, loja.py): o catálogo é público; retirar é o jogo
    ('GET',  '/api/loja/catalogo'):          ('loja_catalogo', False),
    ('GET',  '/api/loja/minha'):             ('loja_minha', True),
    ('POST', '/api/loja/comprar'):           ('loja_comprar', True),
    ('POST', '/api/loja/cancelar'):          ('loja_cancelar', True),
    ('POST', '/api/loja/retirar'):           ('loja_retirar', True),
    # 04/10: a vitrine do jogo (ofertas, Pacote de Boas-Vindas, auras), a aura vestida e o presente a um amigo
    ('GET',  '/api/loja/vitrine'):           ('loja_vitrine', True),
    ('GET',  '/api/loja/aura'):              ('loja_aura_ver', True),
    ('POST', '/api/loja/aura'):              ('loja_aura_escolher', True),
    # 08/10: a moldura premium da plaquinha (loja.py), como a aura
    ('GET',  '/api/loja/moldura'):           ('loja_moldura_ver', True),
    ('POST', '/api/loja/moldura'):           ('loja_moldura_escolher', True),
    ('POST', '/api/loja/presentear'):        ('loja_presentear', True),
    # o retrato no ranking (Loja 2, 10/09, conta.py): o jogador escolhe no site
    ('GET',  '/api/avatar'):                 ('avatar_ler', True),
    ('POST', '/api/avatar'):                 ('avatar_escolher', True),
    # os pacotes de vinténs pagos no Mercado Pago (10/09, pagamento.py). O aviso é
    # SEM conta (quem chama é o Mercado Pago): a assinatura dele é a porta
    ('POST', '/api/pagamento/pacote'):       ('pagamento_pacote', True),
    ('POST', '/api/pagamento/aviso'):        ('pagamento_aviso', False),
    ('POST', '/api/pagamento/conferir'):     ('pagamento_conferir', True),
    ('GET',  '/api/pagamento/meus'):         ('pagamento_meus', True),
    # 04/10: as barras compradas pela Google Play DENTRO do aplicativo (pagamento_play.py); a web segue no Mercado Pago
    ('GET',  '/api/pagamento/play'):         ('play_ver', True),
    ('POST', '/api/pagamento/play'):         ('play_compra', True),
    # 06/10: o anúncio premiado do aplicativo (anuncio.py), só para quem ENTRA na área e toca no botão.
    # O prêmio é SEM conta (quem chama é a Google): a assinatura dela é a porta
    ('GET',  '/api/anuncio'):                ('anuncio_ver', True),
    ('POST', '/api/anuncio/bilhete'):        ('anuncio_bilhete', True),
    ('GET',  '/api/anuncio/premio'):         ('anuncio_premio', False),
    ('POST', '/api/mestre/pagamento/play/estornos'): ('mestre_play_estornos', True, True, FRASE_SO_MESTRE),
    # o painel do Mestre (10/09, mestre.py): buscar contas, dar presentes e ver os
    # alertas de pagamento. A busca é POST: o e-mail não vai para a URL (nem para o
    # log do proxy). A marca é contas.gm, lida do banco a cada pedido.
    ('POST', '/api/mestre/contas'):            ('mestre_contas', True, True, FRASE_SO_MESTRE),
    ('GET',  '/api/mestre/conta'):             ('mestre_conta', True, True, FRASE_SO_MESTRE),
    ('GET',  '/api/mestre/recusas'):           ('mestre_recusas', True, True, FRASE_SO_MESTRE),   # 09/10: a caixa-preta
    ('GET',  '/api/mestre/recusa'):            ('mestre_recusa', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/presentear'):        ('mestre_presentear', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/presente/cancelar'): ('mestre_presente_cancelar', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/barras'):            ('mestre_barras', True, True, FRASE_SO_MESTRE),   # 13/09: barras de ouro
    ('GET',  '/api/mestre/presentes'):         ('mestre_presentes', True, True, FRASE_SO_MESTRE),
    ('GET',  '/api/mestre/alertas'):           ('mestre_alertas', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/alerta/visto'):      ('mestre_alerta_visto', True, True, FRASE_SO_MESTRE),
    # o botão "conferir no Mercado Pago" da ficha (o aviso perdido, o servidor mal configurado, o teto de 24 h)
    ('POST', '/api/mestre/pagamento/conferir'): ('mestre_pagamento_conferir', True, True, FRASE_SO_MESTRE),
    # a guilda no servidor (11/09, guilda.py): tudo com conta — a guilda é de contas.
    # O convite entre máquinas só funciona daqui (antes a guilda morava em cada navegador)
    ('GET',  '/api/guilda/minha'):            ('guilda_minha', True),
    ('GET',  '/api/guilda/lista'):            ('guilda_lista', True),
    ('POST', '/api/guilda/criar'):            ('guilda_criar', True),
    ('POST', '/api/guilda/trazer'):           ('guilda_trazer', True),    # 13/09: a guilda de antes do servidor
    ('POST', '/api/guilda/entrar'):           ('guilda_entrar', True),
    ('POST', '/api/guilda/pedir'):            ('guilda_pedir', True),
    ('POST', '/api/guilda/pedido'):           ('guilda_pedido', True),
    ('POST', '/api/guilda/convidar'):         ('guilda_convidar', True),
    ('POST', '/api/guilda/porta'):            ('guilda_porta', True),
    ('POST', '/api/guilda/cargo'):            ('guilda_cargo', True),
    ('POST', '/api/guilda/dizimo'):           ('guilda_dizimo', True),
    ('POST', '/api/guilda/mural'):            ('guilda_mural', True),     # 13/09: a mensagem da guilda
    ('POST', '/api/guilda/renomear'):         ('guilda_renomear', True),  # 08/10 à noite: o Pergaminho do Novo Nome
    ('POST', '/api/guilda/brasao'):           ('guilda_brasao', True),    # 08/10 à noite: o Pergaminho do Brasão
    # 13/09: amigos e inimigos (amigos.py); o online e a batalha vêm do relé
    ('GET',  '/api/amigos'):                  ('amigos_lista', True),
    ('POST', '/api/amigos/definir'):          ('amigos_definir', True),
    ('POST', '/api/guilda/doar'):             ('guilda_doar', True),
    ('POST', '/api/guilda/bonus'):            ('guilda_bonus', True),
    ('POST', '/api/guilda/treino'):           ('guilda_treino', True),
    ('POST', '/api/guilda/sair'):             ('guilda_sair', True),
    ('POST', '/api/guilda/banco/depositar'):  ('guilda_banco_depositar', True),
    ('POST', '/api/guilda/banco/pegar'):      ('guilda_banco_pegar', True),
    ('POST', '/api/guilda/banco/devolver'):   ('guilda_banco_devolver', True),
    ('POST', '/api/guilda/avisos/visto'):     ('guilda_avisos_visto', True),   # 04/10: o recado da peça que voltou
    ('POST', '/api/guilda/devolucoes/visto'): ('guilda_devolucoes_visto', True),   # 04/10: a peça da guilda desfeita, sem o juiz
    # a autoridade (13/09, salas.py; docs/SEGURANCA.md §4): o servidor dá a semente da
    # sala, o juiz refaz e paga; as operações de economia rodam no estado do servidor
    ('POST', '/api/sala/abrir'):              ('sala_abrir', True),
    ('POST', '/api/sala/fechar'):             ('sala_fechar', True),
    ('POST', '/api/sala/pocao'):              ('sala_pocao', True),       # 13/09: a poção na sala de espera
    ('POST', '/api/op'):                      ('economia_op', True),
    # a sala em grupo e o duelo ranqueado (13/09, grupo.py)
    ('POST', '/api/grupo/abrir'):             ('grupo_abrir', True),
    ('POST', '/api/grupo/fechar'):            ('grupo_fechar', True),
    ('POST', '/api/grupo/pocao'):             ('grupo_pocao', True),      # 13/09: cada um cura os próprios
    ('POST', '/api/duelo/abrir'):             ('duelo_abrir', True),      # 14/09: a vida com que cada lado entra
    ('POST', '/api/duelo/fechar'):            ('duelo_fechar', True),
    # 02/10: o Eco Primordial (supremo.py) — ler é público (com token traz a parte da conta); a tentativa
    # abre com a semente do servidor e fecha pelo juiz
    ('GET',  '/api/supremo'):                 ('supremo_ler', False),
    ('GET',  '/api/supremo/ranking'):         ('supremo_ranking', False),
    ('POST', '/api/supremo/abrir'):           ('supremo_abrir', True),
    ('POST', '/api/supremo/sal'):             ('supremo_sal', True),      # 03/10: o sorteio de cada rodada, travado
    ('POST', '/api/supremo/fechar'):          ('supremo_fechar', True),
    # 14/09: a fila da Arena (arena.py)
    ('POST', '/api/arena/inscrever'):         ('arena_inscrever', True),
    ('GET',  '/api/arena/quadro'):            ('arena_quadro', True),
    ('POST', '/api/arena/desafiar'):          ('arena_desafiar', True),
    ('POST', '/api/arena/confirmar'):         ('arena_confirmar', True),
    ('POST', '/api/arena/recusar'):           ('arena_recusar', True),
    ('POST', '/api/arena/sair'):              ('arena_sair', True),
    ('GET',  '/api/arena/estado'):            ('arena_estado', True),
    # 15/09: a guerra de guilda 2x2 na Sede (guerra.py). 19/09: sair {gid} é a saída declarada da guerra pronta
    # (os heróis da conta a 0 na hora); fechar aceita desistiu/wo e responde 'aguardando' enquanto não há um fim
    ('POST', '/api/guerra/inscrever'):        ('guerra_inscrever', True),
    ('POST', '/api/guerra/juntar'):           ('guerra_juntar', True),
    ('POST', '/api/guerra/confirmar'):        ('guerra_confirmar', True),
    ('POST', '/api/guerra/recusar'):          ('guerra_recusar', True),
    ('POST', '/api/guerra/sair'):             ('guerra_sair', True),
    ('GET',  '/api/guerra/estado'):           ('guerra_estado', True),
    ('POST', '/api/guerra/fechar'):           ('guerra_fechar', True),
    # 14/09, a vida única do herói (salas.py): a vida de agora e a poção fora da batalha, em qualquer lugar
    ('GET',  '/api/vida'):                    ('vida_lista', True),
    ('POST', '/api/vida/pocao'):              ('vida_pocao', True),
    # o mercadinho entre contas (13/09, mercado.py): o anúncio é do servidor e a peça fica em
    # custódia; a proposta, o aceite do vendedor e a confirmação do comprador; sem juiz, 503
    ('GET',  '/api/mercado/resumo'):          ('mercado_resumo', True),
    ('GET',  '/api/mercado/item'):            ('mercado_item', True),
    ('GET',  '/api/mercado/meus'):            ('mercado_meus', True),
    ('GET',  '/api/mercado/propostas'):       ('mercado_propostas', True),
    ('GET',  '/api/mercado/avisos'):          ('mercado_avisos', True),
    ('POST', '/api/mercado/visto'):           ('mercado_visto', True),
    ('POST', '/api/mercado/anunciar'):        ('mercado_anunciar', True),
    ('POST', '/api/mercado/comprar'):         ('mercado_comprar', True),
    ('POST', '/api/mercado/propor'):          ('mercado_propor', True),
    ('POST', '/api/mercado/cancelar'):        ('mercado_cancelar', True),
    ('POST', '/api/mercado/responder'):       ('mercado_responder', True),
    ('POST', '/api/mercado/confirmar'):       ('mercado_confirmar', True),
    ('POST', '/api/mercado/retirar'):         ('mercado_retirar', True),
    # 02/10: a moderação (moderacao.py). O jogador denuncia, lê o correio da Equipe e (mesmo banido)
    # pergunta por que está banido; o resto é do Mestre, com a marca lida do banco a cada pedido
    ('POST', '/api/denuncia'):                ('denuncia_criar', True),
    ('GET',  '/api/correio'):                 ('correio_ler', True),
    ('POST', '/api/correio/lida'):            ('correio_lida', True),
    ('GET',  '/api/moderacao/eu'):            ('moderacao_eu', True),
    # 03/10: o que o Mestre enviou a esta conta (o aviso "O Mestre te enviou …"; o /api/eu conta as não vistas)
    ('GET',  '/api/entregas'):                ('entregas_ler', True),
    ('POST', '/api/entregas/vistas'):         ('entregas_vistas', True),
    ('POST', '/api/mestre/banir'):            ('mestre_banir', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/desbanir'):         ('mestre_desbanir', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/silenciar'):        ('mestre_silenciar', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/dessilenciar'):     ('mestre_dessilenciar', True, True, FRASE_SO_MESTRE),
    ('GET',  '/api/mestre/banimentos'):       ('mestre_banimentos', True, True, FRASE_SO_MESTRE),
    ('GET',  '/api/mestre/denuncias'):        ('mestre_denuncias', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/denuncia'):         ('mestre_denuncia', True, True, FRASE_SO_MESTRE),
    ('GET',  '/api/mestre/auditoria'):        ('mestre_auditoria', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/dar'):              ('mestre_dar', True, True, FRASE_SO_MESTRE),
    # 04/10 (guilda.py): o Mestre vê TODAS as guildas (até a da equipe) e desfaz uma inteira
    ('GET',  '/api/mestre/guildas'):          ('mestre_guildas', True, True, FRASE_SO_MESTRE),
    ('POST', '/api/mestre/guilda/desfazer'):  ('mestre_guilda_desfazer', True, True, FRASE_SO_MESTRE),
}
ROTAS.update(ROTAS_PRIVACIDADE)   # 02/10: privacidade.py — aceite, excluir a conta, baixar os dados
ROTAS.update(ROTAS_REGISTROS)     # 02/10: registros.py — o registro de erros e o painel dele
ROTAS.update(ROTAS_TRILHA)        # 07/10: trilha.py — a trilha da temporada (ler e resgatar)
ROTAS.update(ROTAS_DIARIO)        # 08/10: premio_diario.py — o prêmio diário de resgate (ler e resgatar)


# ---- validações miúdas (as da conta, com agora e Recusa, moram em comum.py) ------
JID_MAX = 80                 # o teto do código de jogador (o mesmo do relé: ids de até 80 caracteres)


def texto_ou_nulo(v, tam=40):
    return v.strip()[:tam] if isinstance(v, str) and v.strip() else None


def colhe_iids(progress, db):
    """Varre o save e devolve [(iid, onde)] — cada lugar em que o cliente
    guarda uma INSTÂNCIA de item. Entradas sem iid são ignoradas: é o modelo
    antigo (`hero.items[slot]` = só o id do item) ou um saco ainda sem carimbo,
    e o cliente as registra como origem 'legado' quando carimbar."""
    achados = []

    def anota(lista, onde):
        if not isinstance(lista, list):
            return
        for i, e in enumerate(lista):
            if isinstance(e, dict) and isinstance(e.get('iid'), str) and e['iid']:
                achados.append((e['iid'], '%s[%d]' % (onde, i)))

    if isinstance(progress, dict):
        anota(progress.get('inventory'), 'inventory')
        herois = progress.get('heroes')
        if isinstance(herois, dict):
            for hid, h in herois.items():
                iv = h.get('itemVar') if isinstance(h, dict) else None
                if not isinstance(iv, dict):
                    continue
                for slot, v in iv.items():
                    if isinstance(v, dict) and isinstance(v.get('iid'), str) and v['iid']:
                        achados.append((v['iid'], 'heroes.%s.itemVar.%s' % (hid, slot)))
    if isinstance(db, dict):
        banco = db.get('banco')
        if isinstance(banco, dict):
            anota(banco.get('itens'), 'banco.itens')
        mercado = db.get('mercado')
        ofertas = mercado.get('ofertas') if isinstance(mercado, dict) else None
        if isinstance(ofertas, list):
            for i, o in enumerate(ofertas):
                # só o que o JOGADOR pendurou é instância dele; a banca do
                # mercador-fantasma é semeada pela data e não tem dono
                if (isinstance(o, dict) and o.get('vendedor') == 'jogador'
                        and isinstance(o.get('iid'), str) and o['iid']):
                    achados.append((o['iid'], 'mercado.ofertas[%d]' % i))
    return achados


def lista_de_iids(v, campo):
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > 50:
        raise Recusa(400, '%s precisa ser uma lista de até 50 iids' % campo)
    saida = []
    for iid in v:
        if not iid_valido(iid):
            raise Recusa(400, 'iid inválido em %s' % campo)
        if iid not in saida:
            saida.append(iid)
    return saida


# ---- o ranking por classe (10/09; limita e classe_do_heroi moram em comum.py) ----
def herois_por_classe(progress):
    """{classe: (heroi_id, nivel, xp, elemento)} com a MELHOR ficha de cada
    classe da conta (maior xp, depois maior nível): uma linha por conta no
    ranking, mesmo com 'sumo' e 'sumo#2'. Os números vêm do cliente e são presos
    nas réguas do jogo: xp gigante vira o teto, nível 99 vira 30, elemento
    desconhecido vira neutro."""
    melhores = {}
    herois = progress.get('heroes') if isinstance(progress, dict) else None
    if not isinstance(herois, dict):
        return melhores
    for hid, h in herois.items():
        if not isinstance(h, dict):
            continue
        classe = classe_do_heroi(hid, h)
        if classe is None:
            continue
        xp = limita(h.get('xp'), 0, XP_MAX)
        nivel = limita(h.get('level'), 1, NIVEL_MAX)
        elemento = h.get('element') if h.get('element') in ELEMENTOS else 'neutro'
        atual = melhores.get(classe)
        if atual is None or (xp, nivel) > (atual[2], atual[1]):
            melhores[classe] = (str(hid)[:64], nivel, xp, elemento)
    return melhores


def classe_principal(por_classe):
    """A classe do herói de maior xp da conta (o retrato dela no ranking), ou None.
    Empate: vale a ordem de classes.js (o max devolve o primeiro)."""
    candidatas = [c for c in CLASSES_RANK if c in por_classe]
    if not candidatas:
        return None
    return max(candidatas, key=lambda c: (por_classe[c][2], por_classe[c][1]))


def avatar_publico(db):
    """O avatar que o jogador escolheu (DB.jogador.avatar = 'fus:a+b'), só se for
    uma fusão de verdade: duas classes diferentes, as duas do jogo, nunca 'gm'.
    O par sai em ordem alfabética, como as chaves de fusions.js e os nomes dos
    retratos do site. O DB do cliente (DB.definirAvatar) não confere nada disso."""
    jog = db.get('jogador') if isinstance(db, dict) else None
    avatar = jog.get('avatar') if isinstance(jog, dict) else None
    if not isinstance(avatar, str) or not avatar.startswith('fus:'):
        return None
    par = avatar[4:].split('+')
    if len(par) != 2:
        return None
    a, b = sorted(CLASSE_RENOMEADA.get(p, p) for p in par)
    if a == b or a not in CLASSES_RANK or b not in CLASSES_RANK:
        return None
    return 'fus:%s+%s' % (a, b)


# ---- os eventos do mundo (10/09) ------------------------------------------------
def data_local(t):
    """O dia do calendário de Brasília em que cai o instante t (epoch em segundos)."""
    return datetime.fromtimestamp(t, FUSO).date()


def _numero(v):
    """Número de verdade (int ou float finito, nunca bool), ou None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def _num_br(x):
    return ('%g' % x).replace('.', ',')


def _instante(v, campo):
    """Epoch em segundos vindo do cliente (o JS pode mandar fração)."""
    n = _numero(v)
    if n is None or not 0 <= n < 1e11:
        raise Recusa(400, '%s precisa ser um instante em segundos (epoch)' % campo)
    return int(n)


def _valida_base(corpo):
    """O que o evento pontual e a regra têm em comum: tipo, multiplicador,
    calabouço, título e texto. Devolve o dicionário já normalizado."""
    tipo = corpo.get('tipo')
    if not isinstance(tipo, str) or tipo not in AGENDA_TETOS:
        raise Recusa(400, 'tipo de evento desconhecido: use xp, vintem, pedras, saque ou aviso')
    teto = AGENDA_TETOS[tipo]
    m = corpo.get('multiplicador')
    if tipo == 'aviso':
        # o aviso é só um anúncio no jogo e no site: não multiplica nada
        if m is not None and (_numero(m) is None or m != 1):
            raise Recusa(400, 'o aviso não multiplica nada: mande multiplicador 1 ou nenhum')
        m = 1.0
    else:
        n = _numero(m)
        m = round(float(n), 2) if n is not None and abs(n) < 1e6 else None
        if m is None or not 1 < m <= teto:
            raise Recusa(400, 'o multiplicador de %s é um número de mais de 1 até %s' % (tipo, _num_br(teto)))
    calabouco = corpo.get('calabouco')
    if calabouco == '':
        calabouco = None                 # o "todos" de um <select> pode chegar vazio
    if calabouco is not None and calabouco not in CALABOUCOS:
        raise Recusa(400, 'calabouço desconhecido: use null (todos) ou um de %s' % ', '.join(CALABOUCOS))
    titulo = corpo.get('titulo')
    titulo = titulo.strip() if isinstance(titulo, str) else ''
    if not EVENTO_TITULO[0] <= len(titulo) <= EVENTO_TITULO[1]:
        raise Recusa(400, 'o título precisa ter de %d a %d caracteres' % EVENTO_TITULO)
    texto = corpo.get('texto')
    if texto is None:
        texto = ''
    if not isinstance(texto, str):
        raise Recusa(400, 'o texto do evento precisa ser um texto')
    texto = texto.strip()
    if len(texto) > EVENTO_TEXTO:
        raise Recusa(400, 'o texto do evento vai até %d caracteres' % EVENTO_TEXTO)
    return {'tipo': tipo, 'multiplicador': m, 'calabouco': calabouco, 'titulo': titulo, 'texto': texto}


def valida_evento(corpo, t):
    """O corpo de POST /api/eventos conferido e normalizado. Sem `inicio`, o
    evento liga agora ("ligar agora" do painel do Mestre)."""
    ev = _valida_base(corpo)
    inicio = t if corpo.get('inicio') is None else _instante(corpo.get('inicio'), 'inicio')
    fim = _instante(corpo.get('fim'), 'fim')
    if inicio < t - EVENTO_FOLGA:
        raise Recusa(400, 'o início já passou (para ligar agora, não mande inicio)')
    if inicio > t + EVENTO_ANTECEDENCIA:
        raise Recusa(400, 'o início pode ser marcado até %d dias à frente' % (EVENTO_ANTECEDENCIA // 86400))
    if fim <= inicio:
        raise Recusa(400, 'o fim precisa vir depois do início')
    if fim - inicio > EVENTO_DURACAO:
        raise Recusa(400, 'um evento dura no máximo %d dias' % (EVENTO_DURACAO // 86400))
    ev.update(inicio=inicio, fim=fim)
    return ev


def valida_regra(corpo):
    """O corpo de POST /api/eventos/regras: dias da semana (0 = domingo …
    6 = sábado, como o getDay do JS), hora de Brasília "HH:MM" e duração em
    minutos (15 a 1440; sexta 22:00 com 240 min atravessa a meia-noite).
    Devolve a regra normalizada, a mesma forma que `regra_da_linha` lê do banco."""
    rg = _valida_base(corpo)
    dias = corpo.get('dias')
    if (not isinstance(dias, list) or not dias
            or any(isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 6 for d in dias)
            or len(set(dias)) != len(dias)):
        raise Recusa(400, 'dias precisa ser uma lista de 0 (domingo) a 6 (sábado), sem repetir')
    hora = corpo.get('hora')
    casou = RE_HORA.match(hora) if isinstance(hora, str) else None
    if not casou or int(casou.group(1)) > 23 or int(casou.group(2)) > 59:
        raise Recusa(400, 'hora precisa ser "HH:MM", de 00:00 a 23:59 (hora de Brasília)')
    dur = _numero(corpo.get('duracaoMin'))
    if dur is None or dur != int(dur) or not REGRA_DURACAO[0] <= dur <= REGRA_DURACAO[1]:
        raise Recusa(400, 'duracaoMin precisa ser um número inteiro de %d a %d' % REGRA_DURACAO)
    de = None if corpo.get('vigenteDe') is None else _instante(corpo.get('vigenteDe'), 'vigenteDe')
    ate = None if corpo.get('vigenteAte') is None else _instante(corpo.get('vigenteAte'), 'vigenteAte')
    if de is not None and ate is not None and ate <= de:
        raise Recusa(400, 'vigenteAte precisa vir depois de vigenteDe')
    rg.update(dias=sorted(dias), hora_min=int(casou.group(1)) * 60 + int(casou.group(2)),
              duracao_min=int(dur), vigente_de=de, vigente_ate=ate)
    return rg


def id_do_alvo(alvo, v):
    """O id a cancelar: o número (12), ou o id público como sai no GET ('e12',
    'r3@1789218000') — o painel pode devolver o que leu, sem desmontar."""
    if isinstance(v, int) and not isinstance(v, bool) and 0 < v < 2 ** 53:
        return v
    casou = re.match(r'^%s?(\d{1,15})(@\d+)?$' % ('e' if alvo == 'evento' else 'r'), v) if isinstance(v, str) else None
    if casou is None or (casou.group(2) and alvo != 'regra'):
        raise Recusa(400, 'id precisa ser o número do evento ou da regra')
    return int(casou.group(1))


def _linha_valida(r):
    """Linha da agenda que o GET mostra: tipo e calabouço conhecidos (uma linha
    mexida à mão no sqlite com tipo torto fica de fora, não quebra o site)."""
    return r['tipo'] in AGENDA_TETOS and (r['calabouco'] is None or r['calabouco'] in CALABOUCOS)


def _mult_lido(tipo, m):
    """O multiplicador como sai do banco, preso de novo em [1, teto]: um valor
    torto gravado à mão não vira "XP ×9" no site."""
    n = _numero(m)
    return round(min(AGENDA_TETOS[tipo], max(1.0, float(n) if n is not None else 1.0)), 2)


def evento_publico(r):
    """Um evento pontual como sai no GET (sem criado_por, criado_em nem cancelado_em)."""
    return {'id': 'e%d' % r['id'], 'origem': 'pontual', 'regra': None, 'tipo': r['tipo'],
            'multiplicador': _mult_lido(r['tipo'], r['multiplicador']), 'calabouco': r['calabouco'],
            'titulo': r['titulo'], 'texto': r['texto'] or '', 'inicio': r['inicio'], 'fim': r['fim']}


def regra_da_linha(r):
    """Uma linha de agenda_regras na forma normalizada (a de valida_regra, com id)."""
    return {'id': r['id'], 'tipo': r['tipo'], 'multiplicador': _mult_lido(r['tipo'], r['multiplicador']),
            'calabouco': r['calabouco'], 'titulo': r['titulo'], 'texto': r['texto'] or '',
            'dias': sorted({int(d) for d in (r['dias'] or '').split(',') if d.strip().isdigit() and int(d) <= 6}),
            'hora_min': r['hora_min'], 'duracao_min': r['duracao_min'],
            'vigente_de': r['vigente_de'], 'vigente_ate': r['vigente_ate']}


def regra_publica(rg):
    """A regra (forma normalizada) como o site e o jogo leem."""
    return {'id': rg['id'], 'tipo': rg['tipo'], 'multiplicador': rg['multiplicador'], 'calabouco': rg['calabouco'],
            'titulo': rg['titulo'], 'texto': rg['texto'], 'dias': list(rg['dias']),
            'hora': '%02d:%02d' % divmod(rg['hora_min'], 60), 'duracaoMin': rg['duracao_min'],
            'vigenteDe': rg['vigente_de'], 'vigenteAte': rg['vigente_ate']}


def expande_regra(regra, de, ate):
    """As ocorrências de uma regra semanal (forma normalizada) que cruzam
    [de, ate), em ordem de início, no formato de um item de `ativos`.

    Percorre os dias de Brasília desde a VÉSPERA de `de` — a ocorrência que
    começou ontem pode estar no ar: sexta 22:00 + 240 min vai até sábado
    02:00 — até o dia de `ate`. A vigência corta: a ocorrência é o pedaço da
    janela semanal que cai dentro de [vigente_de, vigente_ate)."""
    dias = set(regra['dias'])
    duracao = regra['duracao_min'] * 60
    v_de, v_ate = regra.get('vigente_de'), regra.get('vigente_ate')
    saida = []
    d = data_local(de) - timedelta(days=1)
    ultimo = data_local(ate)
    while d <= ultimo:
        # Python conta a semana da segunda (0); o contrato, como o JS, do domingo (0)
        if (d.weekday() + 1) % 7 in dias:
            ini = int(datetime(d.year, d.month, d.day, tzinfo=FUSO).timestamp()) + regra['hora_min'] * 60
            fim = ini + duracao
            if v_de is not None:
                ini = max(ini, v_de)
            if v_ate is not None:
                fim = min(fim, v_ate)
            if ini < fim and fim > de and ini < ate:
                saida.append({'id': 'r%d@%d' % (regra['id'], ini), 'origem': 'calendario', 'regra': regra['id'],
                              'tipo': regra['tipo'], 'multiplicador': regra['multiplicador'],
                              'calabouco': regra['calabouco'], 'titulo': regra['titulo'],
                              'texto': regra.get('texto') or '', 'inicio': ini, 'fim': fim})
        d += timedelta(days=1)
    return saida


def resolve_fatores(lista, t):
    """A regra de resolução resolvida no instante t — a mesma conta que o jogo
    (agenda.js) faz na hora da recompensa:
        fator(tipo, calabouço) = min(TETO, max(1, maior multiplicador entre os
        eventos no ar daquele tipo, gerais ou daquele calabouço))
    Do mesmo tipo, vale o maior (xp ×1,5 com xp ×2 dá 2, nunca 3). `geral` é o
    que vale em todo calabouço; `porCalabouco` só lista quem tem evento próprio,
    com o geral já somado pelo max. Fator 1 não aparece: não muda nada."""
    geral, proprio = {}, {}
    for e in lista:
        tipo, m = e.get('tipo'), _numero(e.get('multiplicador'))
        if not isinstance(tipo, str) or tipo not in AGENDA_TETOS or m is None:
            continue
        if not e['inicio'] <= t < e['fim']:
            continue
        alvo = geral if e.get('calabouco') is None else proprio.setdefault(e['calabouco'], {})
        alvo[tipo] = max(alvo.get(tipo, 1.0), m)

    def preso(tipo, m):
        return round(min(AGENDA_TETOS[tipo], max(1.0, m)), 2)

    saida_geral = {tipo: preso(tipo, m) for tipo, m in geral.items() if preso(tipo, m) > 1}
    por_calabouco = {}
    for calabouco, tipos in proprio.items():
        junto = dict(saida_geral)
        for tipo, m in tipos.items():
            junto[tipo] = preso(tipo, max(m, geral.get(tipo, 1.0)))
        junto = {tipo: f for tipo, f in junto.items() if f > 1}
        if junto:
            por_calabouco[calabouco] = junto
    return {'geral': saida_geral, 'porCalabouco': por_calabouco}


# ---- o cartório -------------------------------------------------------------
def versao_da_regra():
    """A marca da lei dos nomes (servidor/nomes.py, o arquivo inteiro): muda
    quando a regra muda, e a vitrine gravada é passada a limpo de novo, uma
    vez (Api._migra_resumos_nomes)."""
    try:
        with open(nomes.__file__, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()[:12]
    except (OSError, TypeError):
        return '0'


class Api(ContaMixin, LojaMixin, MestreMixin, PagamentoMixin, PagamentoPlayMixin, AnuncioMixin, GuildaMixin, SalasMixin, GrupoMixin, MercadoMixin,
          AmigosMixin, ArenaMixin, GuerraMixin, SupremoMixin, PrivacidadeMixin, RegistrosMixin, ModeracaoMixin,
          TrilhaMixin, DiarioMixin):          # 07/10: a trilha da temporada; 08/10: o prêmio diário
    """Uma conexão SQLite só, guardada por uma tranca. O SQLite serializa as
    escritas de qualquer jeito, e a tranca dá de graça o que o anti-duplicação
    precisa: dois PUT do mesmo save nunca se entrelaçam — o segundo vê a
    versão que o primeiro gravou e leva 409.

    A conta no site (conta.py), a loja (loja.py), o painel do Mestre (mestre.py)
    e os pacotes pagos (pagamento.py) entram como mixins: as rotas deles são
    métodos deste mesmo objeto, com a mesma conexão e a mesma tranca."""

    def __init__(self, caminho_banco, correio=None, mp=None, juiz=None, play=None, anuncios=None):
        pasta = os.path.dirname(os.path.abspath(caminho_banco))
        # 09/10: A CAIXA-PRETA — toda sala que o juiz recusa (422: divergiu, lance fora da vez…) deixa o pedido
        # inteiro (a ata, os lances, o estado das contas) num JSON desta pasta, para ser refeita no computador
        # de quem conserta (tools/refaz_recusa.js). O dono: "de novo não deu XP na luta, isso é inaceitável" —
        # sem o registro, o "lance 1 deu diferente aqui" do juiz não diz O QUE deu diferente
        self.pasta_recusas = os.path.join(pasta, 'recusas')
        try:
            os.makedirs(self.pasta_recusas, exist_ok=True)
        except OSError:
            pass
        os.makedirs(pasta, exist_ok=True)
        self.con = sqlite3.connect(caminho_banco, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.execute("PRAGMA foreign_keys=ON")
        self.con.executescript(ESQUEMA)
        # Fase C: só tabelas novas (e um índice) — o rolling update segue seguro
        self.con.executescript(ESQUEMA_CONTA + ESQUEMA_LOJA + ESQUEMA_PAGAMENTO)   # a loja antes: o pagamento a cita
        self.con.executescript(ESQUEMA_PLAY)     # 04/10: a compra pela Google Play (pagamento_play.py) — só tabela nova
        self.con.executescript(ESQUEMA_ANUNCIO)  # 06/10: o anúncio premiado do aplicativo (anuncio.py) — idem
        self.con.executescript(ESQUEMA_TRILHA)   # 07/10: a trilha da temporada (trilha.py) — idem
        self.con.executescript(ESQUEMA_DIARIO)   # 08/10: o prêmio diário (premio_diario.py) — idem
        self.con.executescript(ESQUEMA_GUILDA)   # 11/09: a guilda (guilda.py) — só tabelas novas, como a Fase C
        self.con.executescript(ESQUEMA_SALAS)    # 13/09: a autoridade (salas.py) — só tabelas novas, nunca ALTER
        self.con.executescript(ESQUEMA_GRUPO)    # 13/09: sala em grupo e duelo ranqueado (grupo.py) — idem
        self.con.executescript(ESQUEMA_MERCADO)  # 13/09: o mercadinho entre contas (mercado.py) — idem
        self.con.executescript(ESQUEMA_AMIGOS)   # 13/09: amigos e inimigos (amigos.py) — idem; o relé lê só para ler
        self.con.executescript(ESQUEMA_ARENA)    # 14/09: a fila da Arena (arena.py) — idem
        self.con.executescript(ESQUEMA_GUERRA)   # 15/09: a guerra de guilda 2x2 (guerra.py) — idem
        self.con.executescript(ESQUEMA_PRESENCA)  # 15/09: a presença que o Relé grava (presenca.py) — idem
        self.con.executescript(ESQUEMA_SUPREMO)   # 02/10: o Eco Primordial (supremo.py) — idem
        self.con.executescript(ESQUEMA_PRIVACIDADE + ESQUEMA_REGISTROS)   # 02/10: aceites e erros — idem
        self.con.executescript(ESQUEMA_MODERACAO)  # 02/10: a moderação (moderacao.py) — idem
        self.tranca = threading.RLock()
        self._registros_init()   # 02/10: o freio do registro de erros (registros.py), em memória
        self.tentativas = {}     # conta_id → [instantes de senha errada]   (em memória basta)
        self._em_voo = {}        # chave do balde do IP → vagas com o PBKDF2 correndo   (conta.py: _freia_por_ip)
        self._fila = {}          # chave do balde do IP → pedidos esperando uma dessas vagas voltar
        self.intencoes = {}      # (de, para) → {dou, recebo, em}            (idem: expira em 120 s)
        # o correio (correio.py). Sem nada, desligado: as rotas que mandam
        # e-mail respondem 503 com correio:false, e o resto funciona igual
        self.correio = correio if correio is not None else Correio()
        # o Mercado Pago (pagamento.py). Sem nada, desligado: os pacotes aparecem
        # "em breve", as rotas de pagamento respondem 503, e o resto funciona igual
        self.mp = mp if mp is not None else MercadoPago()
        # a Google Play (pagamento_play.py): a compra de barras DENTRO do aplicativo. Sem a conta de serviço,
        # desligada: as rotas dela respondem 503 e o resto funciona igual
        self.play = play if play is not None else GooglePlay()
        # o anúncio premiado (anuncio.py): só credita com a assinatura da Google conferida
        self.anuncios = anuncios if anuncios is not None else Anuncios.do_ambiente()
        # o JUIZ (12/09, juiz_ponte.py): as regras do jogo em Node. Sem ele, as rotas
        # que precisam conferir respondem 503 — nada é pago sem conferir
        self.juiz = juiz if juiz is not None else Juiz(None)
        # o segredo do hmac dos códigos (SOTERRA_SEGREDO, ou o arquivo `segredo` na pasta do banco)
        self.segredo = carrega_segredo(pasta)
        self._ranking_guardado = None    # (vale_ate, data_version, resposta) — ver ranking
        self._resumos_vistos = {}        # conta_id → a última foto pública — ver _resumo
        self._migra_resumos_v2()
        self._migra_resumos_nomes()
        self._migra_jogador_ids()          # 04/10: de quem é cada código de jogador que já está nos saves
        self._migra_guildas_antigas()      # 13/09: a foto das guildas de antes do servidor
        with self._escrita():
            self._faxina_privacidade(forcar=True)   # 02/10: sessões vencidas, códigos e freios velhos (privacidade.py)

    # -- miudezas -------------------------------------------------------------
    def _evento(self, conta_id, tipo, dados):
        self.con.execute("INSERT INTO eventos(conta_id, tipo, dados, criado_em) VALUES (?, ?, ?, ?)",
                         (conta_id, tipo, json.dumps(dados, ensure_ascii=False) if dados is not None else None,
                          agora()))

    def _plateia(self, conta_id, tipo, dados):
        """08/10 à noite: uma linha para o relé anunciar na praça (tabela plateia); dentro da escrita de quem
        chama. O nome é o do jogador no jogo (resumos), senão o da conta; nome reservado à equipe não sai."""
        try:
            r = self.con.execute("SELECT r.nome AS jogo, c.nome AS conta FROM contas c LEFT JOIN resumos r "
                                 "ON r.conta_id = c.id WHERE c.id = ?", (conta_id,)).fetchone()
        except sqlite3.Error:
            r = None
        nome = (r['jogo'] or r['conta']) if r is not None else None
        if not isinstance(nome, str) or not nome.strip() or nomes.reservado(nome):
            return False
        self.con.execute("INSERT INTO plateia(conta_id, nome, tipo, dados, criado_em) VALUES (?, ?, ?, ?, ?)",
                         (conta_id, nome.strip()[:40], tipo,
                          json.dumps(dados, ensure_ascii=False) if dados is not None else None, agora()))
        return True

    @contextlib.contextmanager
    def _escrita(self):
        """Uma transação de escrita com a trava entre processos já pega (BEGIN
        IMMEDIATE, como no salvar): quem conta um limite e insere não se
        entrelaça com o contêiner vizinho no rolling update. Commit no fim;
        qualquer erro (Recusa inclusive) desfaz tudo."""
        with self.tranca:
            if self.con.in_transaction:
                self.con.rollback()
            self.con.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.con.commit()
            except BaseException:
                if self.con.in_transaction:
                    self.con.rollback()
                raise

    def _abre_sessao(self, conta_id, corpo=None):
        """Uma sessão nova. Com o corpo do pedido, guarda também o IP e o
        navegador (sessoes_extra, que morre junto com a sessão): a página da
        conta mostra a lista, com o IP mascarado."""
        token = secrets.token_hex(32)
        t = agora()
        self._faxina_privacidade(t)   # 02/10: as vencidas saem com o IP delas (privacidade.py), no máximo 1 vez por hora
        self.con.execute("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES (?, ?, ?, ?)",
                         (token, conta_id, t, t))
        self._g_visto(conta_id, t)            # 04/10: entrou — o prazo do empréstimo da guilda conta daqui (guilda.py)
        if isinstance(corpo, dict):
            self.con.execute("INSERT INTO sessoes_extra(token, ip, agente, criado_em) VALUES (?, ?, ?, ?)",
                             (token, corpo.get('_ip') or None, (corpo.get('_agente') or '')[:160] or None, t))
        return token

    def conta_do_token(self, token):
        if not token:
            return None
        with self.tranca:
            r = self.con.execute(
                "SELECT s.ultimo_uso AS sessao_uso, c.* FROM sessoes s JOIN contas c ON c.id = s.conta_id "
                "WHERE s.token = ?", (token,)).fetchone()
            if r is None:
                return None
            t = agora()
            if r['sessao_uso'] < t - SESSAO_DIAS * 86400:
                self.con.execute("DELETE FROM sessoes WHERE token = ?", (token,))
                self.con.commit()
                return None
            if t - r['sessao_uso'] > 60:          # não escrever a cada pedido
                self.con.execute("UPDATE sessoes SET ultimo_uso = ? WHERE token = ?", (t, token))
                self._g_visto(r['id'], t)         # 04/10: o "visto por último" que sobrevive à sessão (guilda.py)
                self.con.commit()
            return dict(r)

    def despacha(self, metodo, caminho, token, corpo):
        rota = ROTAS.get((metodo, caminho))
        if rota is None:
            raise Recusa(404, 'rota desconhecida')
        nome, precisa_conta = rota[0], rota[1]
        so_mestre = len(rota) > 2 and rota[2]
        conta = None
        # 04/10: os empréstimos do banco da guilda vencidos por ausência voltam (guilda.py), no
        # máximo uma vez por hora — e ANTES de a conta deste pedido contar como presente
        self._g_passo_emprestimos()
        if precisa_conta or so_mestre:
            conta = self.conta_do_token(token)
            if conta is None:
                # UM APARELHO SÓ (13/09): o token que um login em outro aparelho
                # derrubou ouve o motivo — é por ele que o jogo cai com a tela
                # própria em vez de só esquecer a sessão (conta.py, _derruba_outras)
                if token and self._sessao_derrubada(token):
                    raise Recusa(401, FRASE_OUTRO_APARELHO, motivo=MOTIVO_OUTRO_APARELHO)
                raise Recusa(401, 'faça login (token ausente ou vencido)')
            # 02/10: o banimento tem prazo e motivo (moderacao.py): o 403 leva os dois, o prazo
            # vencido se fecha aqui mesmo, e sair/perguntar por quê passam (DO_BANIDO)
            if conta['banido'] and nome not in DO_BANIDO:
                ban = self._ban_atual(conta)
                if ban is not None:
                    raise Recusa(403, FRASE_BANIDA, banimento=ban)
            # a marca é do SERVIDOR (contas.gm, lida do banco a cada pedido): o
            # `gm` que o cliente guardou do login é só uma cópia (10/09)
            if so_mestre and not conta['gm']:
                raise Recusa(403, rota[3] if len(rota) > 3 else 'só o Mestre do Fundo mexe nos eventos do mundo')
        resultado = getattr(self, nome)(conta, corpo)
        if so_mestre:
            self._audita_rota(conta, metodo, nome, corpo, resultado)   # 02/10: toda ação do Mestre deixa linha
        return resultado

    # -- conta ------------------------------------------------------------------
    def cadastro(self, conta, corpo):
        nome, email, senha = corpo.get('nome'), corpo.get('email'), corpo.get('senha')
        if not nome_valido(nome):
            # o motivo exato vem da lei dos nomes (curto, comprido, espaço na ponta,
            # caractere fora do conjunto), na mesma ordem do site. Só os 21 primeiros
            # caracteres: já dizem "comprido", e a regra num texto de 2 MB custaria
            # caro antes do freio por IP.
            amostra = nome[:21] if isinstance(nome, str) else nome
            raise Recusa(400, 'nome inválido: ' + (nomes.valida(amostra, 3, 20)[1] or 'de 3 a 20 caracteres'))
        # a lei dos nomes (pedido do dono, 10/09): ninguém se cadastra vestido de
        # equipe do jogo — GM, Admin, Moderador, Mestre do Fundo… e os disfarces
        # (4dm1n, JoaoGM, Gm2). Só o nome NOVO: login, esqueci e sessões não
        # conferem, e a conta antiga com nome assim continua entrando. Um nome
        # desses só o dono dá, no Terminal: admin renomear "VELHO" "NOVO".
        if nomes.reservado(nome):
            raise Recusa(400, NOME_RESERVADO)
        if not email_novo_valido(email):
            raise Recusa(400, 'e-mail inválido')
        if not senha_valida(senha):
            raise Recusa(400, 'a senha precisa ter pelo menos 8 caracteres')
        # 02/10: sem o aceite dos Termos e da Política de Privacidade (a versão de agora), não há conta
        aceite = confere_aceite(corpo)
        # o freio por IP (10 por hora; conta.py) antes do PBKDF2 e do 409: sem
        # ele, "esse e-mail já tem conta" era um oráculo de graça de quem tem
        # conta, e cada pedido queimava 0,1 s de processador
        self._freia_por_ip(corpo, 'cadastro', CADASTRO_POR_IP, agora(), FRASE_IP_CADASTRO)
        sal = secrets.token_hex(16)
        picada = pica_senha(senha, sal)          # fora da tranca: leva ~0,1 s
        with self.tranca:
            if self.con.execute("SELECT 1 FROM contas WHERE nome = ?", (nome,)).fetchone():
                raise Recusa(409, 'esse nome já tem dono')
            if self.con.execute("SELECT 1 FROM contas WHERE email = ?", (email,)).fetchone():
                raise Recusa(409, 'esse e-mail já tem conta')
            try:
                cur = self.con.execute(
                    "INSERT INTO contas(nome, email, senha_hash, sal, criado_em) VALUES (?, ?, ?, ?, ?)",
                    (nome, email, picada, sal, agora()))
            except sqlite3.IntegrityError:
                self.con.rollback()
                raise Recusa(409, 'nome ou e-mail já usado')
            cid = cur.lastrowid
            self._aceite_grava(cid, aceite, agora())   # na MESMA transação: não existe conta sem aceite
            token = self._abre_sessao(cid, corpo)
            self._evento(cid, 'cadastro', {'nome': nome})
            self.con.commit()
        log.info("cadastro: %s (#%d)", nome, cid)
        return 201, {'ok': True, 'token': token, 'conta': {'id': cid, 'nome': nome}}

    def _tentativas_estouradas(self, conta_id):
        t = agora()
        lista = [x for x in self.tentativas.get(conta_id, []) if x > t - LOGIN_JANELA]
        self.tentativas[conta_id] = lista
        return len(lista) >= LOGIN_TENTATIVAS

    def _libera_tentativas(self, conta_id):
        """Quando a conta volta a poder errar a senha (epoch), para o liberaEm do 429."""
        lista = sorted(self.tentativas.get(conta_id, []))
        if len(lista) < LOGIN_TENTATIVAS:
            return None
        return lista[len(lista) - LOGIN_TENTATIVAS] + LOGIN_JANELA

    def login(self, conta, corpo):
        login, senha = corpo.get('login'), corpo.get('senha')
        if not isinstance(login, str) or not isinstance(senha, str):
            raise Recusa(400, 'informe login (nome ou e-mail) e senha')
        login = login.strip()
        t = agora()
        # o freio por IP (30 senhas ERRADAS por hora; conta.py) vem antes de
        # tudo: é o que segura o PBKDF2 de quem chuta, já que a senha é
        # conferida mesmo com a conta trancada. A vaga fica reservada (em voo)
        # durante o PBKDF2 e VOLTA quando a senha bate: login certo não gasta o
        # balde de quem divide o endereço (CGNAT de operadora, escola, a casa
        # inteira), e quem chega com o balde cheio de vagas em voo — logins
        # certos juntos — espera uma voltar, em vez do 429
        vaga = self._freia_por_ip(corpo, 'login', LOGIN_POR_IP, t, FRASE_IP_SENHA, so_erradas=True)
        try:
            return self._login_com_vaga(login, senha, corpo, vaga, t)
        finally:
            self._pousa_vaga(vaga)              # sai do voo depois de resolvida, bata a senha ou não (conta.py)

    def _login_com_vaga(self, login, senha, corpo, vaga, t):
        """O resto do login, com a vaga do freio por IP em voo (ver login)."""
        with self.tranca:
            c = self.con.execute("SELECT * FROM contas WHERE nome = ? OR email = ?", (login, login)).fetchone()
            # e o acerto tem o balde dele, por conta (60 por hora; conta.py); barrado
            # aqui, antes do PBKDF2, a vaga do IP volta
            self._barra_logins_certos(c['id'] if c is not None else None, t, vaga)
        # a senha ANTES da tranca de tentativas: quem sabe a senha nunca é
        # trancado (senão qualquer um trancava qualquer conta pelo nome, e o
        # ranking publica nomes); quem chuta continua parando na 11ª. O nome
        # que não existe segue o MESMO caminho: o mesmo PBKDF2 (contra o sal de
        # fachada), a mesma contagem, o mesmo evento gravado e a mesma resposta
        # — nem a frase, nem o relógio, nem a 11ª contam quem tem conta
        if c is None:
            self._pica_de_fachada(senha)
            bateu = False
        else:
            bateu = hmac.compare_digest(pica_senha(senha, c['sal']), c['senha_hash'])
        chave = self._chave_tentativas(c, login)
        with self.tranca:
            if not bateu:
                if self._tentativas_estouradas(chave):
                    raise Recusa(429, MUITAS_TENTATIVAS, liberaEm=self._libera_tentativas(chave))
                self._anota_tentativa(chave, agora())
                self._evento(c['id'] if c is not None else None, 'login-recusado', None)
                self.con.commit()
                raise Recusa(401, 'login ou senha errados')
        # 02/10: a conta banida ouve o motivo e o fim — só DEPOIS da senha conferida (sem a senha,
        # o motivo não sai). O prazo vencido se fecha aqui (moderacao.py) e o login segue
        ban = self._ban_atual(c, t) if c['banido'] else None
        if ban is not None:
            raise Recusa(403, FRASE_BANIDA, banimento=ban)
        with self.tranca:
            self.tentativas.pop(c['id'], None)
            token = self._abre_sessao(c['id'], corpo)
            # UM APARELHO SÓ (13/09, pedido do dono): o login certo derruba todas as
            # outras sessões da conta, na mesma transação — o jogo aberto no outro
            # aparelho cai (conta.py, _derruba_outras; a faxina das vencidas vem junto)
            self._derruba_outras(c['id'], token)
            self._evento(c['id'], 'login', None)
            # a senha bateu: a vaga do IP volta, e o login entra no balde da conta
            self._login_certo(c['id'], vaga, t)
            self.con.commit()
        return 200, {'ok': True, 'token': token,
                     'conta': {'id': c['id'], 'nome': c['nome'], 'gm': bool(c['gm'])}}

    def logout(self, conta, corpo):
        with self.tranca:
            self.con.execute("DELETE FROM sessoes WHERE token = ?", (corpo['_token'],))
            self.con.commit()
        return 200, {'ok': True}

    def eu(self, conta, corpo):
        # 03/10: `entregas` = quantas entregas do Mestre a conta não viu (moderacao.py). O jogo já pergunta o
        # /api/eu a cada 30 s com a aba à vista (sessao.js): é por aqui que o presente chega sem mais um pedido
        return 200, {'ok': True, 'conta': {'id': conta['id'], 'nome': conta['nome'], 'email': conta['email'],
                                           'criadoEm': conta['criado_em'], 'gm': bool(conta['gm'])},
                     'entregas': self._entregas_pendentes(conta['id']),
                     # 04/10: quantos pedidos da loja esperam o jogo vir buscar — o jogo aberto busca a fila
                     # logo depois da compra (em até 30 s), em vez de esperar o ciclo de 5 minutos (loja.js)
                     'lojaAbertos': self._loja_abertos_para_o_jogo(conta['id'])}

    # -- o save e o registro de instâncias ----------------------------------------
    def save_ler(self, conta, corpo):
        with self.tranca:
            r = self.con.execute("SELECT versao, progress, db FROM saves WHERE conta_id = ?",
                                 (conta['id'],)).fetchone()
            h = self.con.execute("SELECT hash FROM autoridade WHERE conta_id = ?", (conta['id'],)).fetchone()
        # hash: o último da economia que o juiz devolveu (13/09, salas.py); null antes da primeira op/sala
        if r is None:
            return 200, {'ok': True, 'versao': 0, 'progress': None, 'db': None, 'hash': None}
        db = json.loads(r['db']) if r['db'] else None
        resposta = {'ok': True, 'versao': r['versao'],
                    'progress': json.loads(r['progress']) if r['progress'] else None,
                    'db': db, 'hash': h['hash'] if h else None}
        # 04/10: o save guardado traz o código de jogador de OUTRA conta (a cópia de antes do registro):
        # o jogo que vai adotar este save já o adota com um código novo (js/core/nuvem.js). Só leitura aqui
        jid = self._jid_do_db(db)
        if jid:
            with self.tranca:
                dono = self.con.execute("SELECT conta_id FROM jogador_ids WHERE jid = ?", (jid,)).fetchone()
            if dono is not None and dono['conta_id'] != conta['id']:
                resposta['trocarId'] = jid
        return 200, resposta

    # -- o código de jogador é de UMA conta (04/10) -----------------------------------------------
    # O DEFEITO: o dono entrou com a conta do Mestre no celular e com outra conta no PC, e uma não via a
    # outra na praça. A identidade na Rede é o jogador.id do SAVE, e o js/core/rede.js joga fora toda
    # mensagem que chega com o próprio id (é o eco dela mesma). A segunda conta tinha nascido com uma cópia
    # do save da primeira (o mesmo navegador), então as duas tinham o MESMO código e cada uma tratava a
    # outra como eco. Daqui em diante o servidor guarda de quem é cada código e manda a segunda trocar.
    @staticmethod
    def _jid_do_db(db):
        jog = db.get('jogador') if isinstance(db, dict) else None
        jid = jog.get('id') if isinstance(jog, dict) else None
        return jid if isinstance(jid, str) and 0 < len(jid) <= JID_MAX else None

    def _jid_confere(self, cid, jid):
        """Dentro de uma transação de escrita. O código `jid` chegou pela conta `cid`: livre, fica dela
        (devolve None); já dela, None; de OUTRA conta, devolve o próprio jid — a ordem de trocar. Nunca
        recusa nada: o save sobe e o progresso fica; só a identidade na praça é que tem de mudar."""
        if not jid:
            return None
        r = self.con.execute("SELECT conta_id FROM jogador_ids WHERE jid = ?", (jid,)).fetchone()
        if r is None:
            self.con.execute("INSERT INTO jogador_ids(jid, conta_id, criado_em) VALUES (?, ?, ?)", (jid, cid, agora()))
            return None
        return None if r['conta_id'] == cid else jid

    def jogador_id(self, conta, corpo):
        """POST /api/jogador-id {id} → {ok, trocar}. O jogo pergunta ao abrir, com o código que está no
        save DESTA máquina (que pode nem ter subido: um save recusado também entra na praça). trocar:true
        = esse código é de outra conta; o jogo gera um novo, grava e pergunta de novo."""
        jid = corpo.get('id')
        if not isinstance(jid, str) or not jid or len(jid) > JID_MAX:
            raise Recusa(400, 'id precisa ser o código do jogador (texto de até %d caracteres)' % JID_MAX)
        with self._escrita():
            troca = self._jid_confere(conta['id'], jid)
            if troca:
                self._evento(conta['id'], 'jogador-id-repetido', {'id': jid})
        if troca:
            log.info("código de jogador repetido: a conta #%d chegou com um que é de outra — mandada trocar", conta['id'])
        return 200, {'ok': True, 'trocar': bool(troca)}

    def _migra_jogador_ids(self):
        """Os saves que JÁ estão no banco: cada código fica com UMA conta — a do Mestre primeiro (é a
        conta do dono, a original), depois a mais antiga. As outras que trazem o mesmo código ficam sem
        registro e recebem a ordem de trocar na próxima vez que abrirem o jogo. Uma vez por banco."""
        repetidos = 0
        with self._escrita():
            if self.con.execute("SELECT 1 FROM migracoes WHERE nome = 'jogador-ids'").fetchone():
                return
            for r in self.con.execute("SELECT s.conta_id, s.db FROM saves s JOIN contas c ON c.id = s.conta_id "
                                      "ORDER BY c.gm DESC, c.id").fetchall():
                try:
                    jid = self._jid_do_db(json.loads(r['db']) if r['db'] else None)
                except (TypeError, ValueError):
                    jid = None
                if self._jid_confere(r['conta_id'], jid):
                    repetidos += 1
            self.con.execute("INSERT INTO migracoes(nome, feita_em) VALUES ('jogador-ids', ?)", (agora(),))
        if repetidos:
            log.info("migração jogador-ids: %d contas com o código de jogador de outra (trocam ao abrir o jogo)", repetidos)

    def _recusa_save(self, conta_id, status, erro, **extra):
        """Toda recusa de save vira evento — é a trilha para achar quem tenta
        duplicar (e para o dono depurar um cliente que ficou torto)."""
        with self.tranca:
            self._evento(conta_id, 'save-recusado', {'status': status, 'erro': erro})
            self.con.commit()
        # também no journal (journalctl -u soterra-api): é onde o dono olha primeiro
        log.info("save recusado: #%d HTTP %d — %.300s", conta_id, status, erro)
        raise Recusa(status, erro, **extra)

    def salvar(self, conta, corpo):
        cid = conta['id']
        versao = corpo.get('versao')
        if isinstance(versao, bool) or not isinstance(versao, int) or versao < 0:
            raise Recusa(400, 'versao precisa ser um inteiro (0 na primeira gravação)')
        progress, db = corpo.get('progress'), corpo.get('db')
        if progress is not None and not isinstance(progress, dict):
            raise Recusa(400, 'progress precisa ser um objeto JSON ou null')
        if db is not None and not isinstance(db, dict):
            raise Recusa(400, 'db precisa ser um objeto JSON ou null')
        # A AUTORIDADE (13/09, docs/SEGURANCA.md §4.4): com o juiz ligado e o estado da
        # conta já no servidor, o PUT só grava o cosmético — o progress, os nascimentos,
        # a carteira e a anotação da loja do corpo são ignorados, sem 409 por versão
        # (salas.py, _salvar_cosmetico). Conta sem estado segue abaixo: o primeiro save
        # é aceito inteiro e vira o estado inicial. Sem juiz, o cartório de antes.
        if self._autoridade_ligada():
            feito = self._salvar_cosmetico(conta, db)
            if feito is not None:
                # 04/10: o id é campo de dono cliente (JOGADOR_CLIENTE): entrou no save; confere de quem é
                with self._escrita():
                    troca = self._jid_confere(cid, self._jid_do_db(db))
                if troca:
                    feito['trocarId'] = troca
                return 200, feito
        brutos = corpo.get('nascimentos') or []
        if not isinstance(brutos, list):
            raise Recusa(400, 'nascimentos precisa ser uma lista')
        if len(brutos) > NASC_POR_PUT:
            self._recusa_save(cid, 429, 'nascimentos demais num save só (máximo %d)' % NASC_POR_PUT)

        # o que o cliente diz que nasceu agora: iid → (item_id, origem)
        nascimentos = {}
        for n in brutos:
            if not isinstance(n, dict) or not iid_valido(n.get('iid')):
                raise Recusa(400, 'nascimento sem iid válido')
            if n.get('origem') not in ORIGENS:
                raise Recusa(400, 'origem desconhecida em nascimento: %r' % (n.get('origem'),))
            item_id = n.get('itemId', '')
            if not isinstance(item_id, str) or len(item_id) > 64:
                raise Recusa(400, 'itemId inválido em nascimento')
            nascimentos.setdefault(n['iid'], (item_id, n['origem']))

        # (a') A CAIXA DO MESTRE (10/09): peça de origem 'caixa' só nasce na conta
        # que o servidor marcou (contas.gm = 1). A chave do modo Mestre mora no
        # js/core/gm.js, que é servido a todo mundo: quem a achar não registra nada.
        if not conta['gm'] and any(o == 'caixa' for _, o in nascimentos.values()):
            self._recusa_save(cid, 403, 'a Caixa do Mestre é só da conta do Mestre '
                                        '(peça de origem caixa numa conta sem a marca)')

        # (b) o mesmo iid não pode estar em dois lugares do save
        no_save = {}
        for iid, onde in colhe_iids(progress, db):
            if not iid_valido(iid):
                raise Recusa(400, 'iid inválido em %s' % onde)
            if iid in no_save:
                self._recusa_save(cid, 409, 'instância duplicada no save: %s está em %s e em %s'
                                  % (iid, no_save[iid], onde))
            no_save[iid] = onde

        with self.tranca:
            # A TRAVA ENTRE PROCESSOS (10/09): no deploy do Coolify o contêiner
            # velho e o novo usam este banco juntos por alguns segundos. A tranca
            # acima só vale dentro de UM processo; o BEGIN IMMEDIATE pega a trava
            # de escrita do SQLite ANTES de ler a versão, e o outro processo espera
            # (até 5 s, o timeout da conexão) em vez de gravar por cima.
            if self.con.in_transaction:
                self.con.rollback()
            self.con.execute("BEGIN IMMEDIATE")
            try:
                atual = self.con.execute("SELECT versao, progress, db FROM saves WHERE conta_id = ?", (cid,)).fetchone()
                versao_atual = atual['versao'] if atual else 0
                # (a) só grava por cima da versão que o cliente viu; senão devolve
                # a atual para ele fundir e tentar de novo
                if versao != versao_atual:
                    self._recusa_save(cid, 409, 'save desatualizado: o servidor está na versão %d' % versao_atual,
                                      versao=versao_atual,
                                      progress=json.loads(atual['progress']) if atual and atual['progress'] else None,
                                      db=json.loads(atual['db']) if atual and atual['db'] else None)

                # (c) o registro: o que o servidor já sabe de cada iid citado
                conhecidos = {}
                todos = list(set(no_save) | set(nascimentos))
                for i in range(0, len(todos), 400):                 # lotes: o SQLite limita variáveis por consulta
                    lote = todos[i:i + 400]
                    for r in self.con.execute("SELECT iid, conta_id, estado FROM itens WHERE iid IN (%s)"
                                              % ','.join('?' * len(lote)), lote):
                        conhecidos[r['iid']] = (r['conta_id'], r['estado'])

                # 13/09: a série anunciada no mercadinho entre contas está em custódia no servidor
                # (mercado.py); um save que a traga de volta ao saco a duplicaria
                custodia = set()
                for i in range(0, len(todos), 400):
                    lote = todos[i:i + 400]
                    custodia.update(r[0] for r in self.con.execute(
                        "SELECT iid FROM mercado_anuncios WHERE estado = 'aberto' AND iid IN (%s)"
                        % ','.join('?' * len(lote)), lote))
                registrar = []
                for iid, onde in no_save.items():
                    if iid in custodia:
                        self._recusa_save(cid, 409, 'instância anunciada no mercadinho: %s (%s) — retire o anúncio antes'
                                          % (iid, onde))
                    dono = conhecidos.get(iid)
                    if dono is None:
                        if iid not in nascimentos:
                            self._recusa_save(cid, 409, 'instância desconhecida: %s (%s) não nasceu neste servidor'
                                              % (iid, onde))
                        item_id, origem = nascimentos[iid]
                        registrar.append((iid, item_id, origem))
                    elif dono[0] != cid:
                        self._recusa_save(cid, 403, 'instância de outra conta: %s (%s) — troca só pela rota de troca'
                                          % (iid, onde))
                    elif dono[1] == 'fora':
                        self._recusa_save(cid, 409, 'instância já consumida: %s (%s) saiu do jogo e não volta'
                                          % (iid, onde))
                # nascimento que NEM está no save: nasceu e morreu antes de salvar
                # (vendido ao mercador na mesma sessão). Registra mesmo assim — a
                # varredura abaixo o marca 'fora' e ele não pode voltar depois.
                for iid, (item_id, origem) in nascimentos.items():
                    if iid in no_save:
                        continue
                    dono = conhecidos.get(iid)
                    if dono is None:
                        registrar.append((iid, item_id, origem))
                    elif dono[0] != cid:
                        self._recusa_save(cid, 403, 'instância de outra conta: %s' % iid)

                t = agora()
                na_hora = self.con.execute("SELECT COUNT(*) FROM itens WHERE conta_id = ? AND criado_em > ?",
                                           (cid, t - 3600)).fetchone()[0]
                if na_hora + len(registrar) > NASC_POR_HORA:
                    self._recusa_save(cid, 429, 'instâncias demais na última hora (máximo %d)' % NASC_POR_HORA)

                # daqui para baixo só escrita — nenhuma recusa depois disso
                self.con.executemany(
                    "INSERT INTO itens(iid, conta_id, item_id, origem, criado_em, estado) VALUES (?, ?, ?, ?, ?, 'vivo')",
                    [(iid, cid, item_id, origem, t) for iid, item_id, origem in registrar])
                # varredura: instância viva desta conta que sumiu do save foi
                # consumida (fundida, vendida, forjada). Exceção: o que chegou por
                # troca há pouco — o cliente pode ainda não ter posto no save
                # (um PUT que já estava a caminho), e marcar 'fora' o apagaria.
                # 11/09: e o que está GUARDADO no banco da guilda (guilda.py): saiu
                # do save do dono, mas não do jogo. 13/09: idem a peça anunciada no mercadinho
                # entre contas (mercado.py), em custódia no servidor até vender ou voltar
                vivos = self.con.execute(
                    "SELECT iid FROM itens WHERE conta_id = ? AND estado = 'vivo' "
                    "AND NOT (origem = 'troca' AND criado_em > ?) "
                    "AND iid NOT IN (SELECT iid FROM guilda_banco WHERE iid IS NOT NULL AND dono_id = ?) "
                    "AND iid NOT IN (SELECT iid FROM mercado_anuncios WHERE iid IS NOT NULL AND vendedor_id = ? "
                    "AND estado = 'aberto') "
                    # 04/10: e a peça que voltou de uma guilda DESFEITA e espera o dono (guilda.py,
                    # guilda_devolucoes): fora do banco e ainda fora do save, mas não do jogo
                    "AND iid NOT IN (SELECT iid FROM guilda_devolucoes WHERE iid IS NOT NULL AND conta_id = ? "
                    "AND (entregue_em IS NULL OR entregue_em > ?))",
                    (cid, t - TROCA_GRACA, cid, cid, cid, t - TROCA_GRACA)).fetchall()
                consumidos = [(r['iid'],) for r in vivos if r['iid'] not in no_save]
                self.con.executemany("UPDATE itens SET estado = 'fora' WHERE iid = ?", consumidos)

                nova = versao_atual + 1
                self.con.execute(
                    "INSERT OR REPLACE INTO saves(conta_id, progress, db, versao, atualizado_em) VALUES (?, ?, ?, ?, ?)",
                    (cid, json.dumps(progress, ensure_ascii=False) if progress is not None else None,
                     json.dumps(db, ensure_ascii=False) if db is not None else None, nova, t))
                self._resumo(cid, conta, progress, db, t)
                # a loja (Fase C): o que este save diz ter entregue ou recusado
                # fecha junto com ele, na mesma transação; nunca recusa o save
                loja = self._loja_confirma(cid, db, nova, t)
                # 04/10: o código de jogador deste save é desta conta? (livre: passa a ser). De outra: o
                # save SOBE assim mesmo — o progresso não se perde — e a resposta manda o jogo trocar
                troca_id = self._jid_confere(cid, self._jid_do_db(db))
                if registrar:
                    self._evento(cid, 'nascimentos', {'versao': nova, 'iids': [r[0] for r in registrar]})
                self.con.commit()
            except BaseException:
                if self.con.in_transaction:
                    self.con.rollback()
                raise
        resposta = {'ok': True, 'versao': nova, 'registrados': len(registrar), 'loja': loja}
        if troca_id:
            resposta['trocarId'] = troca_id
        return 200, resposta

    def _resumo(self, cid, conta, progress, db, t):
        """(d) a foto pública da conta, para o ranking — recalculada a cada save.
        Tudo é calculado antes da primeira escrita: um save torto não deixa
        metade das tabelas atualizada."""
        xp_total = nivel_max = classes = 0
        herois = progress.get('heroes') if isinstance(progress, dict) else None
        if isinstance(herois, dict):
            for h in herois.values():
                if not isinstance(h, dict):
                    continue
                classes += 1
                xp_total += inteiro(h.get('xp'))
                nivel_max = max(nivel_max, inteiro(h.get('level')))
        jog = db.get('jogador') if isinstance(db, dict) else None
        jog = jog if isinstance(jog, dict) else {}
        brasa = jog.get('brasa') if isinstance(jog.get('brasa'), dict) else {}
        guilda = jog.get('guilda') if isinstance(jog.get('guilda'), dict) else {}
        nome = texto_ou_nulo(jog.get('nome'))
        guilda_nome = texto_ou_nulo(guilda.get('nome'))
        # a lei dos nomes vale também para a vitrine: o nome e a guilda que vêm no
        # SAVE (o batismo do jogo; um save forjado passa ao largo dele) não põem
        # "GM" nem "Staff" no ranking público de quem não é o Mestre — o nome cai
        # para o da conta e a guilda sai da vitrine
        emblema = texto_ou_nulo(guilda.get('emblema'), 64)
        if not conta['gm']:
            if nome and nomes.reservado(nome):
                nome = None
            if guilda_nome and nomes.reservado(guilda_nome):
                guilda_nome = None
            if emblema and nomes.reservado(emblema):
                emblema = None                       # a placa é emblema + nome: 'GM' e 'STAFF' também vestem a equipe
        nome = nome or conta['nome']
        por_classe = herois_por_classe(progress)
        avatar, principal = avatar_publico(db), classe_principal(por_classe)
        # o retrato escolhido no site (conta.py, /api/avatar), se o save ainda o sustenta
        avatar, principal = self._retrato_escolhido(cid, conta, progress, avatar, principal)
        self.con.execute(
            "INSERT OR REPLACE INTO resumos(conta_id, nome, xp_total, nivel_max, classes, brasa_pts, brasa_partidas, "
            "guilda_nome, guilda_emblema, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, nome, xp_total, nivel_max, classes, inteiro(brasa.get('pts')), inteiro(brasa.get('partidas')),
             guilda_nome, emblema, t))
        # (e) o ranking por classe (10/09): a melhor ficha de cada classe. Apagar e
        # regravar: um save sem a classe (a ficha foi apagada) tira a linha dela.
        self.con.execute("DELETE FROM resumos_classe WHERE conta_id = ?", (cid,))
        self.con.executemany(
            "INSERT INTO resumos_classe(conta_id, classe, heroi_id, nivel, xp, elemento, atualizado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(cid, classe, hid, nivel, xp, elemento, t) for classe, (hid, nivel, xp, elemento) in por_classe.items()])
        # (f) o retrato da conta no ranking: o avatar escolhido (conferido) e a classe principal
        self.con.execute(
            "INSERT OR REPLACE INTO resumos_extra(conta_id, avatar, classe, atualizado_em) VALUES (?, ?, ?, ?)",
            (cid, avatar, principal, t))
        # (g) o ranking guardado (ver ranking) cai quando a foto pública desta
        # conta mudou de verdade; um save que só mexeu no saco não o derruba
        publico = (nome, xp_total, nivel_max, classes, inteiro(brasa.get('pts')), inteiro(brasa.get('partidas')),
                   guilda_nome, emblema, avatar, principal,
                   tuple(sorted(por_classe.items())))
        if self._resumos_vistos.get(cid) != publico:
            self._resumos_vistos[cid] = publico
            self._ranking_guardado = None

    def _migra_resumos_v2(self):
        """Preenche resumos_classe e resumos_extra das contas que já existiam
        antes de 10/09 (sem isso, a conta só entraria no ranking por classe no
        próximo save). Roda uma vez por banco: o marcador em `migracoes` sai na
        mesma transação. No rolling update do Coolify dois processos sobem
        juntos no mesmo banco: o BEGIN IMMEDIATE faz o segundo esperar a trava
        e encontrar o marcador. Save torto fica de fora sem derrubar o boot."""
        feitas = tortas = 0
        with self._escrita():
            if self.con.execute("SELECT 1 FROM migracoes WHERE nome = 'resumos-v2'").fetchone():
                return
            linhas = self.con.execute(
                "SELECT c.*, s.progress AS save_progress, s.db AS save_db, s.atualizado_em AS save_em "
                "FROM saves s JOIN contas c ON c.id = s.conta_id ORDER BY c.id").fetchall()
            for r in linhas:
                try:
                    progress = json.loads(r['save_progress']) if r['save_progress'] else None
                    db = json.loads(r['save_db']) if r['save_db'] else None
                    self._resumo(r['id'], r, progress, db, r['save_em'])
                    feitas += 1
                except Exception:              # JSON quebrado, número que o sqlite não guarda…
                    tortas += 1
                    log.info("migração resumos-v2: o save da conta #%d ficou de fora (entra no próximo save)",
                             r['id'])
            self.con.execute("INSERT INTO migracoes(nome, feita_em) VALUES ('resumos-v2', ?)", (agora(),))
        log.info("migração resumos-v2: %d contas no ranking por classe, %d saves tortos", feitas, tortas)

    def _migra_resumos_nomes(self):
        """A lei dos nomes (10/09) também na vitrine que JÁ estava gravada: até
        então o _resumo punha no ranking o nome, a guilda e o emblema do save sem
        regra nenhuma, e essas linhas só mudariam no próximo save — quem não volta
        ficava para sempre como 'GM Velho' da guilda 'Staff'. Passa a limpo as
        contas que não são o Mestre: nome reservado volta a ser o da conta,
        guilda e emblema reservados saem. O marcador leva a marca da regra
        (versao_da_regra): quando servidor/nomes.py muda, roda de novo, uma vez.
        A regra roda FORA da transação (ela custa); a gravação só troca a linha
        que ainda está como foi lida (um save no meio-tempo já passou pela lei)."""
        marca = 'resumos-nomes:' + versao_da_regra()
        with self.tranca:
            if self.con.execute("SELECT 1 FROM migracoes WHERE nome = ?", (marca,)).fetchone():
                return
            linhas = self.con.execute(
                "SELECT r.conta_id, r.nome, r.guilda_nome, r.guilda_emblema, c.nome AS conta_nome "
                "FROM resumos r JOIN contas c ON c.id = r.conta_id WHERE c.gm = 0").fetchall()
        vistos = {}

        def cai(s):
            if not s:
                return False
            if s not in vistos:
                vistos[s] = bool(nomes.reservado(s))
            return vistos[s]
        trocas = []
        for r in linhas:
            velho = (r['nome'], r['guilda_nome'], r['guilda_emblema'])
            novo = (r['conta_nome'] if cai(r['nome']) else r['nome'],
                    None if cai(r['guilda_nome']) else r['guilda_nome'],
                    None if cai(r['guilda_emblema']) else r['guilda_emblema'])
            if novo != velho:
                trocas.append(novo + (r['conta_id'],) + velho)
        with self._escrita():
            if self.con.execute("SELECT 1 FROM migracoes WHERE nome = ?", (marca,)).fetchone():
                return
            for tr in trocas:
                self.con.execute("UPDATE resumos SET nome = ?, guilda_nome = ?, guilda_emblema = ? "
                                 "WHERE conta_id = ? AND nome IS ? AND guilda_nome IS ? AND guilda_emblema IS ?", tr)
            self.con.execute("INSERT INTO migracoes(nome, feita_em) VALUES (?, ?)", (marca, agora()))
        self._ranking_guardado = None
        if trocas:
            log.info("migração %s: %d fotos do ranking passadas a limpo pela lei dos nomes", marca, len(trocas))

    # -- troca entre contas ----------------------------------------------------------
    def troca(self, conta, corpo):
        """Cada lado registra a intenção; quando as duas se espelham (A dá X e
        recebe Y; B dá Y e recebe X) dentro de 120 s, a posse muda de mãos numa
        transação só. O item trocado ganha origem 'troca' e criado_em = agora —
        é como `salvar` sabe não varrê-lo enquanto o cliente o encaixa no save.

        13/09 (docs/SEGURANCA.md §4.6): cada lado é {iids, pets, moedas} (a lista
        de iids de antes ainda vale: só peças). Com a autoridade ligada, quando as
        intenções se espelham, o juiz tira dos DOIS estados do servidor e põe no
        do outro (salas.py, _troca_autoridade), e cada lado recebe o estado novo.
        Sem autoridade, bichos e vinténs só entram no espelho (o cliente move)."""
        cid = conta['id']
        com = corpo.get('com')
        if isinstance(com, bool) or not isinstance(com, int) or com == cid:
            raise Recusa(400, 'com precisa ser o id de outra conta')
        lado_dou = lado_da_troca(corpo.get('dou'), 'dou')
        lado_recebo = lado_da_troca(corpo.get('recebo'), 'recebo')
        dou, recebo = lado_dou['iids'], lado_recebo['iids']
        if lado_vazio(lado_dou) and lado_vazio(lado_recebo):
            raise Recusa(400, 'troca vazia: informe dou e/ou recebo')
        if set(dou) & set(recebo):
            raise Recusa(400, 'o mesmo iid não pode estar em dou e em recebo')
        autoridade = self._autoridade_ligada()
        with self.tranca:
            outro = self.con.execute("SELECT id, banido FROM contas WHERE id = ?", (com,)).fetchone()
            if outro is None or outro['banido']:
                raise Recusa(404, 'conta não encontrada')
            for iid in dou:
                r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                if r is None or r['conta_id'] != cid or r['estado'] != 'vivo':
                    raise Recusa(409, 'você não tem a instância %s' % iid)
            for iid in recebo:
                r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                if r is None or r['conta_id'] != com or r['estado'] != 'vivo':
                    raise Recusa(409, 'a outra conta não tem a instância %s' % iid)
            t = agora()
            for chave in [k for k, v in self.intencoes.items() if v['em'] < t - TROCA_VALIDADE]:
                del self.intencoes[chave]
            self.intencoes[(cid, com)] = {'dou': chave_do_lado(lado_dou), 'recebo': chave_do_lado(lado_recebo), 'em': t}
            espelho = self.intencoes.get((com, cid))
            if not (espelho and espelho['dou'] == chave_do_lado(lado_recebo)
                    and espelho['recebo'] == chave_do_lado(lado_dou)):
                return 200, {'ok': True, 'feita': False, 'aguardando': True}
            if not autoridade:
                return self._troca_so_posse(cid, com, dou, recebo, t)
            # a cópia de um empréstimo do banco da guilda não troca de dono: devolvida, ela some
            # (guilda.py); trocada, ficaria no jogo para sempre
            emprestadas = [r[0] for r in self.con.execute(
                "SELECT iid FROM guilda_emprestimos WHERE iid IN (%s)" % ','.join('?' * len(dou + recebo)),
                dou + recebo)] if dou or recebo else []
            if emprestadas:
                raise Recusa(409, 'peça emprestada do banco da guilda não se troca: %s' % emprestadas[0])
        # com a autoridade, o juiz trabalha FORA da tranca (salas.py)
        return self._troca_autoridade(conta, com, lado_dou, lado_recebo)

    def _troca_so_posse(self, cid, com, dou, recebo, t):
        """A troca sem autoridade (o cartório de antes): só a posse das séries muda."""
        with self.tranca:
            self.con.executemany(
                "UPDATE itens SET conta_id = ?, origem = 'troca', criado_em = ? WHERE iid = ? AND conta_id = ? AND estado = 'vivo'",
                [(com, t, iid, cid) for iid in dou] + [(cid, t, iid, com) for iid in recebo])
            del self.intencoes[(cid, com)]
            del self.intencoes[(com, cid)]
            self._evento(cid, 'troca', {'com': com, 'dou': dou, 'recebo': recebo})
            self._evento(com, 'troca', {'com': cid, 'dou': recebo, 'recebo': dou})
            self.con.commit()
        log.info("troca feita: #%d ⇄ #%d (%d/%d itens)", cid, com, len(dou), len(recebo))
        return 200, {'ok': True, 'feita': True}

    # -- público ------------------------------------------------------------------------
    def ranking(self, conta, corpo):
        """Público. Guardado RANKING_CACHE segundos neste processo: a resposta
        custa 11 consultas sob a tranca, e a landing a pede a cada visita. A
        cópia vale enquanto (a) nenhum save deste processo mudou a foto pública
        de uma conta (_resumo compara) e (b) nenhuma OUTRA conexão gravou no
        banco (PRAGMA data_version: o `admin banir`, o `admin mestre` e o
        `admin tirar-mestre` pelo sqlite3, o contêiner vizinho no rolling update).

        A EQUIPE (pedido do dono, 10/09): conta com contas.gm = 1 não entra em
        lista nenhuma (jogadores, arena, por classe) nem soma na guilda (nem a
        XP nem o membro). Ela sai à parte, em `equipe`, só com o nome público
        (o do jogo, que o _resumo grava; sem save, o da conta) e o retrato do
        Cavaleiro Negro (avatar 'gm'): nada de XP, nível, e-mail ou id."""
        with self.tranca:
            versao_banco = self.con.execute("PRAGMA data_version").fetchone()[0]
            guardado = self._ranking_guardado
            if guardado is not None and guardado[1] == versao_banco and time.monotonic() < guardado[0]:
                return 200, guardado[2]
            jogadores = self.con.execute(
                "SELECT r.nome, r.xp_total, r.nivel_max, r.classes, x.avatar, x.classe FROM resumos r "
                "JOIN contas c ON c.id = r.conta_id LEFT JOIN resumos_extra x ON x.conta_id = r.conta_id "
                "WHERE c.banido = 0 AND c.gm = 0 "
                "ORDER BY r.xp_total DESC, r.nivel_max DESC, r.nome COLLATE NOCASE LIMIT 50").fetchall()
            pvp = self.con.execute(
                "SELECT r.nome, r.brasa_pts, r.brasa_partidas FROM resumos r JOIN contas c ON c.id = r.conta_id "
                "WHERE c.banido = 0 AND c.gm = 0 AND r.brasa_partidas > 0 "
                "ORDER BY r.brasa_pts DESC, r.nome COLLATE NOCASE LIMIT 50").fetchall()
            # 11/09: a guilda mora no servidor (guilda.py). 13/09 (dono: "no site
            # só aparece a guild Game Over, no jogo só a STAFF"): o ranking lia
            # também o NOME DE GUILDA DO SAVE — um campo cosmético de antes do
            # servidor, que ninguém mais atualiza — e punha no site guilda que não
            # existe no jogo; e o JOIN que tirava a equipe do XP tirava junto a
            # guilda inteira quando todos os membros eram da equipe (a STAFF). Agora
            # são as guildas do servidor: membros = quem está nela (menos banido nem
            # a equipe), XP = soma dos mesmos. A regra de 10/09 fica: a
            # equipe não soma nem conta membro, então a guilda SÓ da equipe (a STAFF)
            # não entra na vitrine pública — e, desde 04/10, nem na lista do jogo (guilda.py).
            # A guilda de antes sobe pelo "trazer" da ficha (guilda.py, _g_antiga).
            guildas = self.con.execute(
                "SELECT nome, emblema, membros, xp FROM ("
                "  SELECT g.nome AS nome, g.emblema AS emblema, "
                "    (SELECT COUNT(*) FROM guilda_membros m JOIN contas c ON c.id = m.conta_id "
                "      WHERE m.guilda_id = g.id AND c.banido = 0 AND c.gm = 0) AS membros, "
                "    COALESCE((SELECT SUM(r.xp_total) FROM guilda_membros m JOIN contas c ON c.id = m.conta_id "
                "      JOIN resumos r ON r.conta_id = m.conta_id "
                "      WHERE m.guilda_id = g.id AND c.banido = 0 AND c.gm = 0), 0) AS xp "
                # 04/10 (dono: "guild staff não deve aparecer nem na lista de guild"): a guilda que um
                # Mestre lidera fica fora mesmo com jogador comum dentro (convidado por ele) — antes
                # ela só sumia enquanto TODOS os membros eram da equipe
                "  FROM guildas g WHERE NOT EXISTS (SELECT 1 FROM contas l WHERE l.id = g.lider_id AND l.gm = 1)"
                ") WHERE membros > 0 ORDER BY xp DESC, membros DESC, nome COLLATE NOCASE LIMIT 50").fetchall()
            # o melhor de cada classe (10/09): uma linha por conta (a melhor ficha
            # daquela classe, escolhida no _resumo), sem banidas nem a equipe; as 7 chaves sempre
            por_classe = {classe: self.con.execute(
                "SELECT r.nome, rc.nivel, rc.xp, rc.elemento FROM resumos_classe rc "
                "JOIN resumos r ON r.conta_id = rc.conta_id JOIN contas c ON c.id = rc.conta_id "
                "WHERE c.banido = 0 AND c.gm = 0 AND rc.classe = ? "
                "ORDER BY rc.xp DESC, rc.nivel DESC, r.nome COLLATE NOCASE LIMIT 50", (classe,)).fetchall()
                for classe in CLASSES_RANK}
            # a equipe à parte: o nome que o ranking usaria (o do jogo, gravado
            # pelo _resumo) ou, sem save, o da conta; conta banida não aparece
            equipe = self.con.execute(
                "SELECT COALESCE(NULLIF(r.nome, ''), c.nome) AS nome FROM contas c "
                "LEFT JOIN resumos r ON r.conta_id = c.id WHERE c.gm = 1 AND c.banido = 0 "
                "ORDER BY COALESCE(NULLIF(r.nome, ''), c.nome) COLLATE NOCASE, c.id LIMIT 50").fetchall()
            resposta = {
                'ok': True,
                'jogadores': [{'nome': r['nome'], 'xpTotal': r['xp_total'], 'nivelMax': r['nivel_max'],
                               'classes': r['classes'], 'avatar': r['avatar'], 'classe': r['classe']}
                              for r in jogadores],
                'pvp': [{'nome': r['nome'], 'brasa': r['brasa_pts'], 'partidas': r['brasa_partidas']} for r in pvp],
                'guildas': [{'nome': r['nome'], 'emblema': r['emblema'], 'membros': r['membros'],
                             'xpTotal': r['xp']} for r in guildas],
                'classes': list(CLASSES_RANK),
                'porClasse': {classe: [{'nome': r['nome'], 'nivel': r['nivel'], 'xp': r['xp'],
                                        'elemento': r['elemento'] if r['elemento'] in ELEMENTOS else 'neutro'}
                                       for r in linhas] for classe, linhas in por_classe.items()},
                # 04/10 (o dono: "mude o nome do Super Admin para GM"): a equipe aparece como "GM", o nome
                # público do Mestre — uma linha só, haja uma conta marcada ou várias (todas se chamam "GM")
                'equipe': [{'nome': NOME_DO_MESTRE, 'avatar': 'gm'}] if equipe else [],
            }
            # guardada ainda dentro da tranca: um save que chegue agora a derruba depois, nunca antes
            self._ranking_guardado = (time.monotonic() + RANKING_CACHE, versao_banco, resposta)
        return 200, resposta

    def saude(self, conta, corpo):
        with self.tranca:
            n = self.con.execute("SELECT COUNT(*) FROM contas").fetchone()[0]
        return 200, {'ok': True, 'contas': n, 'agora': agora(), 'correio': self.correio.ligado}

    # -- A SEMANA DO SOTERRA (07/10) ------------------------------------------------------
    def _programa_eventos(self, t, ate):
        """O PROGRAMA FIXO DA SEMANA como eventos do mundo: um por dia de Brasília entre t e `ate`, o do dia da
        semana (PROGRAMA_SEMANAL). Ninguém liga nem cancela (como a semana do Eco): a semana tem rosto — todo
        dia tem um motivo próprio para entrar — e o Mestre o desliga inteiro com PROGRAMA_SEMANAL=0 no ambiente.
        O `calabouco` 'dia' vira o Calabouço do Dia daquele dia (o juiz diz: salas.py _dia); sem juiz, o
        evento daquele dia não sai (nada promete o que não pode pagar)."""
        if not PROGRAMA_LIGADO:
            return []
        fora = []
        d0, d1 = dia_de(t), dia_de(max(t, ate - 1))
        for d in range(d0, d1 + 1):
            ini = d * 86400 - FUSO_S_BR
            fim = ini + 86400
            entrada = PROGRAMA_POR_DIA.get((d + 4) % 7)       # o dia 0 da época foi uma quinta: (0 + 4) % 7 = 4
            if entrada is None:
                continue
            calabouco = entrada['calabouco']
            if calabouco == 'dia':
                dia = self._dia(ini + 43200)
                calabouco = dia.get('dungeonId') if dia else None
                if not calabouco:
                    continue
            fora.append({'id': 'semana-%s-%d' % (entrada['tipo'], d), 'origem': 'programa', 'regra': None,
                         'tipo': entrada['tipo'], 'multiplicador': entrada['multiplicador'], 'calabouco': calabouco,
                         'titulo': entrada['titulo'], 'texto': entrada['texto'], 'inicio': ini, 'fim': fim})
        return fora

    # -- os eventos do mundo (10/09) ------------------------------------------------------
    def _fatores_no_ar(self, t):
        """Os fatores dos eventos no ar no instante t, pela mesma resolução do GET
        /api/eventos (resolve_fatores). A sala fechada no servidor (salas.py) paga com
        estes números — nunca com os que o cliente leu."""
        with self.tranca:
            pontuais = self.con.execute(
                "SELECT id, tipo, multiplicador, calabouco, titulo, texto, inicio, fim FROM agenda_eventos "
                "WHERE cancelado_em IS NULL AND inicio <= ? AND fim > ?", (t, t)).fetchall()
            linhas = self.con.execute(
                "SELECT * FROM agenda_regras WHERE cancelado_em IS NULL "
                "AND (vigente_ate IS NULL OR vigente_ate > ?) ORDER BY id", (t,)).fetchall()
        lista = [evento_publico(r) for r in pontuais if _linha_valida(r)]
        for rg in (regra_da_linha(r) for r in linhas if _linha_valida(r)):
            lista.extend(expande_regra(rg, t, t + 1))
        lista.extend(self._programa_eventos(t, t + 1))       # 07/10: o dia da semana também paga
        return resolve_fatores(lista, t)

    def eventos_ler(self, conta, corpo):
        """GET público: o que está no ar, os eventos pontuais marcados (todos: são
        no máximo EVENTOS_MARCADOS_MAX, até 180 dias à frente), as ocorrências do
        calendário semanal das próximas duas semanas e as regras. O jogo recalcula o fator na hora da recompensa a
        partir de `ativos` e `proximos`; `fatores` é conveniência do site."""
        t = agora()
        ate = t + JANELA_DIAS * 86400
        with self.tranca:
            pontuais = self.con.execute(
                "SELECT id, tipo, multiplicador, calabouco, titulo, texto, inicio, fim FROM agenda_eventos "
                "WHERE cancelado_em IS NULL AND fim > ?", (t,)).fetchall()
            linhas = self.con.execute(
                "SELECT * FROM agenda_regras WHERE cancelado_em IS NULL "
                "AND (vigente_ate IS NULL OR vigente_ate > ?) ORDER BY id", (t,)).fetchall()
        lista = [evento_publico(r) for r in pontuais if _linha_valida(r)]
        regras = [regra_da_linha(r) for r in linhas if _linha_valida(r)]
        for rg in regras:
            lista.extend(expande_regra(rg, t, ate))
        # tudo em `lista` termina depois de agora: começou = está no ar
        ativos = sorted((e for e in lista if e['inicio'] <= t), key=lambda e: (e['fim'], e['inicio'], e['id']))
        # 10/09: os pontuais vêm todos, marcados até 180 dias à frente — é por aqui
        # que o painel do Mestre os lista e os cancela (antes, um evento a mais de
        # 14 dias sumia da lista logo depois de criado). O teto vale só para as
        # ocorrências do calendário, para uma regra diária não empurrar os marcados.
        ordem = lambda e: (e['inicio'], e['fim'], e['id'])
        futuros = [e for e in lista if e['inicio'] > t]
        cal = sorted((e for e in futuros if e.get('origem') == 'calendario'), key=ordem)[:PROXIMOS_MAX]
        proximos = sorted([e for e in futuros if e.get('origem') != 'calendario'] + cal, key=ordem)
        # 02/10: a semana do Eco Primordial (supremo.py) é um evento do mundo FIXO — a de agora e a próxima —,
        # num campo à parte: `ativos`/`proximos` continuam sendo a agenda do Mestre (o que ele liga e cancela),
        # e o jogo (agenda.js) e o site (site.js) juntam os dois para mostrar a contagem regressiva
        semanais = [e for e in self._supremo_eventos(t) if e['fim'] > t and e['inicio'] < ate]
        # 07/10: e A SEMANA DO SOTERRA — o programa fixo, um evento por dia (o de hoje entra nos fatores)
        semanais.extend(self._programa_eventos(t, ate))
        no_ar = ativos + [e for e in semanais if e['inicio'] <= t < e['fim']]
        return 200, {'ok': True, 'agora': t, 'fusoMin': FUSO_MIN, 'janelaDias': JANELA_DIAS,
                     'tetos': dict(AGENDA_TETOS), 'ativos': ativos, 'proximos': proximos,
                     'regras': [regra_publica(rg) for rg in regras], 'fatores': resolve_fatores(no_ar, t),
                     'semanais': semanais,
                     'programa': [dict(p) for p in PROGRAMA_SEMANAL] if PROGRAMA_LIGADO else []}

    def evento_criar(self, conta, corpo):
        """O Mestre liga um evento pontual: agora (sem `inicio`) ou agendado."""
        t = agora()
        ev = valida_evento(corpo, t)
        with self._escrita():
            marcados = self.con.execute(
                "SELECT COUNT(*) FROM agenda_eventos WHERE cancelado_em IS NULL AND fim > ?", (t,)).fetchone()[0]
            if marcados >= EVENTOS_MARCADOS_MAX:
                raise Recusa(400, 'já há %d eventos marcados: cancele algum antes de criar outro' % marcados)
            cur = self.con.execute(
                "INSERT INTO agenda_eventos(tipo, multiplicador, calabouco, titulo, texto, inicio, fim, criado_por, "
                "criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ev['tipo'], ev['multiplicador'], ev['calabouco'], ev['titulo'], ev['texto'], ev['inicio'],
                 ev['fim'], conta['id'], t))
            ev['id'] = cur.lastrowid
            self._evento(conta['id'], 'agenda-evento',
                         {'id': ev['id'], 'tipo': ev['tipo'], 'multiplicador': ev['multiplicador'],
                          'calabouco': ev['calabouco'], 'titulo': ev['titulo'], 'inicio': ev['inicio'],
                          'fim': ev['fim']})
        log.info("agenda: evento #%d (%s ×%s) ligado por #%d", ev['id'], ev['tipo'], ev['multiplicador'],
                 conta['id'])
        return 201, {'ok': True, 'evento': evento_publico(ev)}

    def regra_criar(self, conta, corpo):
        """O Mestre marca uma regra do calendário automático (toda semana)."""
        t = agora()
        rg = valida_regra(corpo)
        with self._escrita():
            vigentes = self.con.execute(
                "SELECT COUNT(*) FROM agenda_regras WHERE cancelado_em IS NULL "
                "AND (vigente_ate IS NULL OR vigente_ate > ?)", (t,)).fetchone()[0]
            if vigentes >= REGRAS_MAX:
                raise Recusa(400, 'já há %d regras no calendário: cancele alguma antes de criar outra' % vigentes)
            cur = self.con.execute(
                "INSERT INTO agenda_regras(tipo, multiplicador, calabouco, titulo, texto, dias, hora_min, duracao_min, "
                "vigente_de, vigente_ate, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (rg['tipo'], rg['multiplicador'], rg['calabouco'], rg['titulo'], rg['texto'],
                 ','.join(str(d) for d in rg['dias']), rg['hora_min'], rg['duracao_min'], rg['vigente_de'],
                 rg['vigente_ate'], conta['id'], t))
            rg['id'] = cur.lastrowid
            publica = regra_publica(rg)
            self._evento(conta['id'], 'agenda-regra',
                         {'id': rg['id'], 'tipo': rg['tipo'], 'multiplicador': rg['multiplicador'],
                          'calabouco': rg['calabouco'], 'titulo': rg['titulo'], 'dias': publica['dias'],
                          'hora': publica['hora'], 'duracaoMin': rg['duracao_min']})
        log.info("agenda: regra #%d (%s ×%s, dias %s às %s) marcada por #%d", rg['id'], rg['tipo'],
                 rg['multiplicador'], publica['dias'], publica['hora'], conta['id'])
        # as próximas 3 (a que já estiver no ar entra): cinco semanas bastam para
        # achar 3 de uma regra de um dia só
        de = max(t, rg['vigente_de'] or t)
        return 201, {'ok': True, 'regra': publica, 'proximas': expande_regra(rg, de, de + 35 * 86400)[:3]}

    def evento_cancelar(self, conta, corpo):
        """Cancelar não apaga: grava cancelado_em. Cancelar a regra derruba também
        a ocorrência que estiver no ar; "encerrar agora" um evento pontual é isto
        mesmo. Já cancelado: 200 com cancelado=false (o painel pode repetir)."""
        alvo = corpo.get('alvo')
        if alvo not in ('evento', 'regra'):
            raise Recusa(400, 'alvo precisa ser "evento" ou "regra"')
        num = id_do_alvo(alvo, corpo.get('id'))
        tabela = 'agenda_eventos' if alvo == 'evento' else 'agenda_regras'
        with self._escrita():
            r = self.con.execute("SELECT id, titulo, cancelado_em FROM %s WHERE id = ?" % tabela, (num,)).fetchone()
            if r is None:
                raise Recusa(404, 'evento não encontrado' if alvo == 'evento' else 'regra não encontrada')
            if r['cancelado_em'] is not None:
                return 200, {'ok': True, 'cancelado': False}
            self.con.execute("UPDATE %s SET cancelado_em = ? WHERE id = ?" % tabela, (agora(), num))
            self._evento(conta['id'], 'agenda-cancela', {'alvo': alvo, 'id': num, 'titulo': r['titulo']})
        log.info("agenda: %s #%d cancelado por #%d", alvo, num, conta['id'])
        return 200, {'ok': True, 'cancelado': True}


# ---- o atendente HTTP ----------------------------------------------------------------
    # ---- a caixa-preta das salas recusadas (09/10) ---------------------------------------
    RECUSAS_MAX = 60                  # os arquivos mais velhos saem sozinhos

    def _guarda_recusa(self, tipo, ref, pedido, erro):
        """Grava o pedido que o juiz recusou (ata, lances, membros com progress/db, contexto) e a frase dele.
        Nunca derruba o fechar: qualquer erro de disco só vai ao log."""
        try:
            nome = '%s-%s-%d.json' % (tipo, re.sub(r'[^0-9A-Za-z_-]', '_', str(ref))[:48], int(time.time()))
            caminho = os.path.join(self.pasta_recusas, nome)
            with open(caminho, 'w', encoding='utf-8') as f:
                json.dump({'tipo': tipo, 'ref': ref, 'quando': int(time.time() * 1000),
                           'erro': getattr(erro, 'erro', str(erro)),
                           'motivo': (getattr(erro, 'extra', None) or {}).get('motivo'),
                           'pedido': pedido}, f, ensure_ascii=False)
            velhos = sorted(n for n in os.listdir(self.pasta_recusas) if n.endswith('.json'))
            for n in velhos[:-self.RECUSAS_MAX]:
                try:
                    os.remove(os.path.join(self.pasta_recusas, n))
                except OSError:
                    pass
            log.warning("caixa-preta: a sala recusada ficou em %s", caminho)
        except Exception as e:                                        # pylint: disable=broad-except
            log.warning("caixa-preta: não deu para gravar a recusa de %s %s: %s", tipo, ref, e)

    def mestre_recusas(self, conta, corpo):
        """A lista da caixa-preta: nome, tamanho, quando, tipo, referência, motivo e a frase do juiz."""
        saida = []
        try:
            nomes = sorted((n for n in os.listdir(self.pasta_recusas) if n.endswith('.json')), reverse=True)
        except OSError:
            nomes = []
        for n in nomes[:self.RECUSAS_MAX]:
            caminho = os.path.join(self.pasta_recusas, n)
            item = {'arquivo': n, 'tamanho': 0, 'quando': None, 'tipo': None, 'ref': None, 'motivo': None, 'erro': None}
            try:
                item['tamanho'] = os.path.getsize(caminho)
                with open(caminho, encoding='utf-8') as f:
                    d = json.load(f)
                for k in ('quando', 'tipo', 'ref', 'motivo', 'erro'):
                    item[k] = d.get(k)
            except (OSError, ValueError):
                pass
            saida.append(item)
        return 200, {'ok': True, 'recusas': saida}

    def mestre_recusa(self, conta, corpo):
        """Um arquivo da caixa-preta, inteiro (o nome como a lista deu; nada de caminho)."""
        nome = corpo.get('arquivo')
        if not isinstance(nome, str) or not re.fullmatch(r'[0-9A-Za-z_-]+\.json', nome):
            raise Recusa(400, 'arquivo inválido')
        caminho = os.path.join(self.pasta_recusas, nome)
        if not os.path.isfile(caminho):
            raise Recusa(404, 'esse registro não existe mais')
        with open(caminho, encoding='utf-8') as f:
            return 200, {'ok': True, 'arquivo': nome, 'registro': json.load(f)}


class Atendente(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'     # keep-alive: o Caddy reaproveita a conexão
    server_version = 'SOTERRA-API/1'
    api = None                         # preenchido no boot

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def _cors(self):
        # o site e o jogo moram no mesmo domínio; o `*` é para o jogo aberto
        # em file:// ou num servidor local falar com a API sem cerimônia.
        # Não há cookie — a sessão vai no header Authorization —, então
        # liberar a origem não abre nada.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')

    def _responde(self, status, obj):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(corpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        self._atende('GET')

    def do_POST(self):
        self._atende('POST')

    def do_PUT(self):
        self._atende('PUT')

    def do_DELETE(self):
        self._atende('DELETE')

    def _token(self):
        cab = self.headers.get('Authorization', '')
        partes = cab.split(None, 1)
        if len(partes) == 2 and partes[0].lower() == 'bearer' and partes[1].strip():
            return partes[1].strip()
        return None

    def _le_corpo(self, metodo):
        if metodo not in ('POST', 'PUT'):
            return {}
        try:
            tamanho = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            raise Recusa(400, 'Content-Length inválido')
        if tamanho > LIMITE_CORPO:
            self.close_connection = True          # não vamos ler isso; a conexão morre junto
            raise Recusa(413, 'corpo grande demais (máximo 2 MB)')
        if tamanho <= 0:
            return {}
        bruto = self.rfile.read(tamanho)
        try:
            corpo = json.loads(bruto.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise Recusa(400, 'JSON inválido')
        if not isinstance(corpo, dict):
            raise Recusa(400, 'o corpo precisa ser um objeto JSON')
        return corpo

    def _atende(self, metodo):
        caminho = urlsplit(self.path).path
        try:
            corpo = self._le_corpo(metodo)
            token = self._token()
            corpo['_token'] = token                 # o logout precisa saber qual sessão apagar
            # o IP (limites por IP, lista de sessões; lido do X-Forwarded-For
            # da direita para a esquerda, ver comum.ip_do_pedido) e o navegador.
            # Postos DEPOIS do corpo lido: o cliente não os escolhe. TODOS os
            # cabeçalhos X-Forwarded-For, juntados por vírgula (RFC 7230): o
            # .get() devolvia só o primeiro — o que o cliente forjou — e jogava
            # fora o que o proxy escreveu.
            corpo['_ip'] = ip_do_pedido(', '.join(self.headers.get_all('X-Forwarded-For') or []),
                                        self.client_address[0] if self.client_address else '')
            corpo['_agente'] = (self.headers.get('User-Agent') or '')[:160]
            # a consulta da URL (o painel do Mestre: GET ?id=N; o aviso do Mercado
            # Pago: ?data.id=…&type=…) e os dois cabeçalhos da assinatura dele,
            # também postos DEPOIS do corpo lido
            corpo['_query'] = le_consulta(urlsplit(self.path).query)
            # a consulta CRUA: a assinatura do AdMob (anuncio.py) é sobre o texto como chegou
            corpo['_consulta'] = urlsplit(self.path).query
            corpo['_cabecalhos'] = {'x-signature': self.headers.get('x-signature'),
                                    'x-request-id': self.headers.get('x-request-id')}
            status, resposta = self.api.despacha(metodo, caminho, token, corpo)
        except Recusa as r:
            status, resposta = r.status, {'ok': False, 'erro': r.erro}
            resposta.update(r.extra)
        except Exception:
            log.exception("erro em %s %s", metodo, caminho)
            self.api.registra_excecao_api(metodo, caminho, self._token())   # 02/10: o painel do Mestre vê (registros.py)
            status, resposta = 500, {'ok': False, 'erro': 'erro interno do servidor'}
        self._responde(status, resposta)



if __name__ == '__main__':
    ap = argparse.ArgumentParser(description="A API de contas do SOTERRA")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8300)
    ap.add_argument("--banco", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "dados", "soterra.db"))
    ap.add_argument("--emails-prova", metavar="ARQ", default=None,
                    help="modo de prova do correio: cada e-mail vira uma linha JSON em ARQ e nada sai da "
                         "máquina (NUNCA em produção)")
    ap.add_argument("--mp-api", metavar="URL", default=None,
                    help="SÓ PARA AS PROVAS: a API do Mercado Pago de mentira (tests/mp_falso.py), "
                         "http://127.0.0.1:PORTA; o token e a assinatura continuam vindo do ambiente")
    ap.add_argument("--play-api", metavar="URL", default=None,
                    help="SÓ PARA AS PROVAS: a Google Play de mentira (tests/play_falso.py), "
                         "http://127.0.0.1:PORTA; a credencial continua vindo do ambiente")
    ap.add_argument("--anuncio-chaves", metavar="ARQ", default=None,
                    help="SÓ PARA AS PROVAS: as chaves públicas do AdMob saem deste arquivo (o formato do "
                         "verifier-keys.json) em vez da Google; a assinatura continua sendo conferida")
    ap.add_argument("--juiz", metavar="URL", default=None,
                    help="o juiz (servidor/juiz/juiz.js), http://127.0.0.1:PORTA — as regras do jogo que "
                         "conferem salas e economia; sem ele, essas rotas respondem 503")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    correio = Correio.do_ambiente(prova=args.emails_prova)
    log.info("correio: %s", correio.descricao())      # nunca a senha
    try:
        base_mp = base_de_prova(args.mp_api) if args.mp_api else None
        base_play = base_de_prova(args.play_api) if args.play_api else None
    except ValueError as e:
        ap.error(str(e))
    mp = MercadoPago.do_ambiente(base=base_mp)
    log.info("pagamento: %s", mp.descricao())         # nunca o token nem a assinatura
    play = GooglePlay.do_ambiente(base=base_play)
    log.info("pagamento: %s", play.descricao())       # nunca a chave da conta de serviço
    anuncios = Anuncios.do_ambiente(arquivo=args.anuncio_chaves)
    log.info("anúncio: %s", anuncios.descricao())
    juiz = Juiz(args.juiz)
    if args.juiz:
        log.info("juiz: %s — autoridade LIGADA (o servidor manda na economia; docs/SEGURANCA.md)", args.juiz)
    else:
        log.warning("juiz: desligado — autoridade DESLIGADA: o save do cliente vale inteiro e as rotas "
                    "conferidas (sala, op) respondem 503. Em produção, suba com --juiz.")
    Atendente.api = Api(args.banco, correio=correio, mp=mp, juiz=juiz, play=play, anuncios=anuncios)
    liga_varredura(Atendente.api)                     # os reembolsos da Google Play, de 6 em 6 h (se ligada)
    servidor = ThreadingHTTPServer((args.host, args.porta), Atendente)
    log.info("a API escuta em http://%s:%d — banco em %s", args.host, args.porta, os.path.abspath(args.banco))
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
