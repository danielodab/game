# Subir o SOTERRA no VPS (Hostinger KVM4)

O que sobe: o **jogo** (cliente estático, jogável no navegador de qualquer
PC), o **site** (landing, ranking e a página de conta, em `site/`), o **Relé**
(os jogadores se veem no Acampamento: fantasma, chat, troca) e a **API** (a
conta no servidor — login de verdade, o mesmo save em qualquer máquina, e o
registro de instâncias que impede item duplicado).

## O que é preciso antes

1. Um **domínio** (ou subdomínio) com registro A apontando para o IP do VPS —
   o HTTPS automático do Caddy precisa dele, e `wss://` + PWA + Play Store
   (TWA) exigem HTTPS.
2. Acesso **SSH** ao VPS (usuário com sudo).
3. Portas **80 e 443 livres** (ou o Caddyfile convive com o que já estiver lá).

## O passo a passo (Ubuntu/Debian)

A ordem importa pouco entre relé e API, mas o Caddy vai por último: ele é
quem liga o domínio ao que já estiver de pé.

```bash
# 1. dependências (a API não precisa de nada além do python3 que já vem)
sudo apt update
sudo apt install -y caddy python3 python3-websockets rsync

# 2. o jogo + o site (rodar NA SUA MÁQUINA, da pasta do jogo).
#    A pasta site/ VAI junto (é a landing); servidor/ fica de fora — e, dentro
#    dela, servidor/dados nunca sai da sua máquina (é o banco de testes local).
rsync -av --delete \
  --exclude '.git' --exclude 'tests' --exclude 'tools' --exclude 'docs' \
  --exclude 'servidor' --exclude 'servidor/dados' --exclude 'unity' \
  ./  usuario@IP-DO-VPS:/var/www/soterra/

# 3. o relé (no VPS)
sudo mkdir -p /opt/soterra
sudo cp servidor/rele.py /opt/soterra/
sudo cp servidor/soterra-rele.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soterra-rele
systemctl status soterra-rele        # deve dizer "o Relé escuta em ..."

# 4. a API (no VPS)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin soterra
sudo cp servidor/api.py /opt/soterra/
sudo cp servidor/soterra-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soterra-api
systemctl status soterra-api         # deve dizer "a API escuta em http://127.0.0.1:8300"
curl -s http://127.0.0.1:8300/api/saude   # {"ok": true, "contas": 0, "agora": ...}

# 5. o Caddy (no VPS) — edite o domínio no Caddyfile antes
sudo cp servidor/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Pronto: `https://SEU-DOMINIO` abre a landing (`/site/`), `https://SEU-DOMINIO/index.html`
abre o jogo, `https://SEU-DOMINIO/api/saude` responde pela API, e dois PCs
diferentes entram no Acampamento e se veem (a Rede acha o relé sozinha em
`wss://<host>/ws`).

### Sobre a API e o banco

- O banco é UM arquivo SQLite: `/var/lib/soterra/soterra.db` (mais os
  companheiros `-wal` e `-shm` do modo WAL). O `StateDirectory=soterra` no
  service faz o systemd criar `/var/lib/soterra` com dono `soterra` na
  primeira subida; se preferir à mão: `sudo mkdir -p /var/lib/soterra && sudo chown soterra:soterra /var/lib/soterra`.
- **Backup** = copiar esse arquivo com o serviço parado, ou, sem parar,
  `sqlite3 /var/lib/soterra/soterra.db ".backup /root/soterra-$(date +%F).db"`.
- Senhas nunca ficam em claro (pbkdf2-sha256, 200 mil voltas, sal por conta).
- O que a API guarda de cada conta: o save (Progress + DB local, como JSON
  opaco), o registro de instâncias (`itens`: cada iid, de quem é, vivo/fora),
  o resumo para o ranking, e a trilha de auditoria (`eventos`: cadastro,
  login, iids nascidos, saves recusados). Para olhar por dentro:
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db 'select tipo, dados from eventos order by id desc limit 20'`.
- Para dar o modo Mestre a uma conta no servidor:
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db "update contas set gm=1 where nome='SEU-NOME'"`.
  Banir: `... set banido=1 ...` (a sessão dela passa a levar 403).

## O jogo e a Nuvem (o lado do cliente)

- **Uma sessão só**: o site grava `localStorage['soterra-sessao']` ao entrar
  ou criar conta; o jogo (`js/core/sessao.js`) lê a mesma chave. Como site e
  jogo vivem na mesma origem (o Caddy serve os dois), logar em
  `/site/conta.html` já deixa `/index.html` logado.
- **O que a Nuvem faz** (`js/core/nuvem.js`): ao abrir, GET `/api/save` — se
  o servidor tem versão mais nova (ou a conta é outra), o save de lá entra e a
  página recarrega uma vez; senão o local sobe. Depois, toda gravação local
  (Progress e DB) sobe 3 s depois num PUT com `versao` + `nascimentos`. Um
  409 de versão (outra máquina gravou antes) faz o servidor mandar; um 409 de
  instância (linha duplicada, peça consumida que voltou) PARA a subida e a
  Ficha de Contas mostra a mensagem, com o botão "Tentar de novo".
- **O número de série**: toda cópia de item tem `iid` (progress.js cunha em
  saque, roleta, forja, Caixa do Mestre, balcão do mercador, cofre da guilda;
  equipar, devolver, cofre pessoal, balcão do jogador e troca carregam a
  MESMA série). Save antigo ganha carimbo `legado` uma vez; série repetida
  colada à mão no save SOME no saneamento em vez de ganhar número novo.
- **Conta trocada na mesma máquina**: se o registro local é de outra conta e o
  servidor não tem nada da nova, o disco é limpo e a nova começa do zero —
  o save da conta anterior continua no cartório dela.
- **Na Ficha de Contas** (menu → Contas) fica a caixa "Nuvem": logado como
  quem, versão do save, "em dia"/"subindo…"/erro, "Sincronizar agora",
  "Sair da nuvem" — ou o botão "Entrar ou criar conta", que abre o site.
- **Provas**: `tests/instancias.html` (a série por cópia), `tests/nuvem.html`
  (o protocolo, contra um cartório de mentira), `python tests/nuvem_viva.py`
  (o cliente contra a API de verdade, conta descartável) e
  `python tests/servidor_api.py` (a API por dentro).
- **Em casa, sem Caddy**: o jogo em `http://127.0.0.1:8200/index.html?api=http://127.0.0.1:8300`
  (a base fica lembrada em `localStorage['soterra-api-base']`); o site do
  disco já aponta para a API de casa sozinho.

## Atualizar depois

- **Jogo ou site**: só o passo 2 de novo (o rsync). Relé, API e Caddy ficam quietos.
- **API**: `sudo cp servidor/api.py /opt/soterra/ && sudo systemctl restart soterra-api`.
  O banco fica onde está; o esquema é criado com `IF NOT EXISTS`, então uma
  versão nova da API sobe por cima do banco antigo.
- **Relé**: `sudo cp servidor/rele.py /opt/soterra/ && sudo systemctl restart soterra-rele`.

## Conferir que está tudo de pé

```bash
journalctl -u soterra-rele -f      # "entrou ... na praça: N" a cada jogador
journalctl -u soterra-api -f       # "cadastro: nome (#id)", "troca feita: ..."
curl -s https://SEU-DOMINIO/api/saude
curl -s https://SEU-DOMINIO/api/ranking | head -c 300
```

## Testar em casa, sem VPS

```bash
python servidor/rele.py            # ws://127.0.0.1:8791
python servidor/api.py             # http://127.0.0.1:8300, banco em servidor/dados/
python tests/servidor_api.py       # a prova da API (sobe uma cópia própria numa porta livre)
```

Abra `site/conta.html` do disco: o site descobre que está em `file://` e fala
com `http://127.0.0.1:8300` sozinho (ou force com `?api=http://host:porta`).
O jogo em duas janelas com `?rede=ws://127.0.0.1:8791` (contas diferentes)
prova o relé.

## Notas

- O relé é um carteiro **burro de propósito** (não valida nada) — certo para
  jogar entre amigos. A API é a autoridade das contas e das instâncias de
  item; o que ainda NÃO é validado no servidor é o sorteio do saque (o cliente
  diz o que nasceu, e o servidor só garante que nasceu uma vez).
- O peso: o cliente tem ~129 MB (GLBs em base64). Funciona, mas a primeira
  carga é longa; a migração base64→arquivos reais + service worker é o
  próximo passo natural depois desta subida.
