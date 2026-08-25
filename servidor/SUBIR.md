# Subir o SOTERRA no VPS (Hostinger KVM4)

O que sobe nesta fase: o **jogo** (cliente estático, jogável no navegador de
qualquer PC) e o **Relé** (os jogadores se veem no Acampamento: fantasma,
chat, troca). As contas continuam no navegador de cada jogador (Banco de
Contas local); a conta NO servidor — login de verdade, mesma conta em
qualquer máquina — é a fase seguinte e vai morar ao lado do Relé.

## O que é preciso antes

1. Um **domínio** (ou subdomínio) com registro A apontando para o IP do VPS —
   o HTTPS automático do Caddy precisa dele, e `wss://` + PWA + Play Store
   (TWA) exigem HTTPS.
2. Acesso **SSH** ao VPS (usuário com sudo).
3. Portas **80 e 443 livres** (ou o Caddyfile convive com o que já estiver lá).

## O passo a passo (Ubuntu/Debian)

```bash
# 1. dependências
sudo apt update
sudo apt install -y caddy python3-websockets rsync

# 2. o jogo (rodar NA SUA MÁQUINA, da pasta do jogo)
rsync -av --delete \
  --exclude '.git' --exclude 'tests' --exclude 'tools' --exclude 'docs' \
  --exclude 'servidor' --exclude 'unity' \
  ./  usuario@IP-DO-VPS:/var/www/soterra/

# 3. o relé (no VPS)
sudo mkdir -p /opt/soterra
sudo cp servidor/rele.py /opt/soterra/
sudo cp servidor/soterra-rele.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soterra-rele
systemctl status soterra-rele        # deve dizer "o Relé escuta em ..."

# 4. o Caddy (no VPS) — edite o domínio no Caddyfile antes
sudo cp servidor/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Pronto: `https://SEU-DOMINIO` abre o jogo; dois PCs diferentes entram no
Acampamento e se veem (a Rede acha o relé sozinha em `wss://<host>/ws`).

## Atualizar o jogo depois

Só o passo 2 de novo (o rsync). Relé e Caddy ficam quietos.

## Conferir que o relé está de pé

```bash
journalctl -u soterra-rele -f      # "entrou ... na praça: N" a cada jogador
```

## Notas

- O relé é um carteiro **burro de propósito** (não valida nada) — certo para
  jogar entre amigos. Validação no servidor é a fase 3.
- O peso: o cliente tem ~129 MB (GLBs em base64). Funciona, mas a primeira
  carga é longa; a migração base64→arquivos reais + service worker é o
  próximo passo natural depois desta subida.
- Teste local do relé sem VPS: `python servidor/rele.py` e abrir o jogo com
  `?rede=ws://127.0.0.1:8791` em duas janelas (contas diferentes).
