# Subir o SOTERRA na Hostinger (VPS KVM)

Sobem quatro coisas de uma vez: o **jogo** (estático, abre em qualquer
navegador), o **site** (landing, ranking e conta, em `site/`), o **Relé** (os
jogadores se veem no Acampamento) e a **API** (a conta no servidor: login, o
mesmo save em qualquer máquina e o registro de cada peça, que impede item
duplicado).

São duas partes: alguns cliques no hPanel (uma vez só) e **um comando** no
Windows (toda vez que quiser subir uma versão nova).

---

## Parte 1 — no hPanel (uma vez)

### 1. O VPS

- VPS → **Sistema operacional** → o **puro, sem painel**: **Ubuntu 24.04**.
  Nada de CloudPanel, cPanel, Docker ou "Ubuntu com …": o instalador cuida de
  tudo, e um painel disputaria as portas 80 e 443 com ele. (O 22.04 também
  funciona com o instalador, mas o 24.04 é o recomendado.)
- Defina a **senha de root** quando o hPanel pedir. É ela que o Windows vai pedir.
- Em VPS → **Visão geral**, anote o **IP** (ex.: `181.215.1.2`) e o
  **hostname** (ex.: `srv123456.hstgr.cloud`).
- Teste o acesso no PowerShell: `ssh root@IP-DO-VPS`. Na primeira vez ele
  pergunta se confia no servidor (responda `yes`) e depois pede a senha.
  `exit` para sair.

### 2. O firewall (se você criar um)

O firewall do hPanel (VPS → **Segurança** → **Firewall**) fica fora do VPS e,
depois de ativado, **bloqueia tudo o que não tiver regra**. Um firewall vazio
derruba o SSH, o site e o certificado.

Se for usar (é recomendado), crie antes três regras **Aceitar**, protocolo
**TCP**, origem **qualquer**, nas portas **22**, **80** e **443**, e ative.
Mudou uma regra depois? Clique em **Sincronizar**. Não abra mais nada: a API
(8300) e o Relé (8791) só escutam dentro do VPS e chegam pelo Caddy.

Sem firewall criado, nada é bloqueado.

### 3. O endereço

Escolha por onde o jogo vai abrir:

| Você tem | Endereço | O que fazer no DNS |
|---|---|---|
| um domínio, e quer um subdomínio | `jogo.seudominio.com.br` | criar um registro **A**, nome `jogo`, apontando para o IP |
| um domínio, e quer ele inteiro | `seudominio.com.br` e `www.seudominio.com.br` | apagar os registros A, AAAA e CNAME de `@` e de `www` (são o estacionamento da Hostinger) e criar **A** `@` → IP e **A** `www` → IP |
| nenhum domínio ainda | o hostname `srv123456.hstgr.cloud` | nada: a Hostinger já publica esse nome, e ele tem HTTPS de verdade |
| só o IP | `181.215.1.2` | nada, mas fica **sem HTTPS** (sem cadeado). Provisório |

O DNS fica em **Domínios** → seu domínio → **Gerenciar** → **DNS /
Nameservers**. Isso vale quando o domínio usa os nameservers da Hostinger, que
é o padrão de domínio comprado lá.

Antes de subir, confira no PowerShell contra um resolvedor público:

```powershell
nslookup jogo.seudominio.com.br 8.8.8.8
```

A resposta tem de ser o IP do VPS. Pode levar de minutos a algumas horas.
Se subir antes, não tem problema: o instalador avisa, e o HTTPS sai sozinho
quando o DNS chegar.

---

## Parte 2 — no Windows (toda vez que subir)

O pacote é o **último commit**. O que não foi commitado não vai, e o script avisa.

No PowerShell, na pasta do jogo:

```powershell
python tools/sobe_vps.py IP-DO-VPS jogo.seudominio.com.br
```

Com o domínio inteiro, passe o `www` também. Ele passa a levar ao endereço
principal, porque a sessão do site e do jogo mora num endereço só:

```powershell
python tools/sobe_vps.py IP-DO-VPS seudominio.com.br www.seudominio.com.br
```

Sem domínio:

```powershell
python tools/sobe_vps.py IP-DO-VPS srv123456.hstgr.cloud
```

O que acontece (de 5 a 10 minutos na primeira vez):

1. **Monta o pacote**, de uns 133 MB: o jogo, o site e o servidor. Ficam de
   fora os testes, as ferramentas, a arte fora do git e os embutidos que o
   jogo servido não usa.
2. **Manda por `scp`**, que já vem no Windows. Pede a senha de root.
3. **Roda `servidor/instala.sh` no VPS**, que pede a senha de novo e:
   - instala Python, websockets, sqlite3 e o Caddy (do repositório oficial do Caddy);
   - põe o jogo e o site em `/var/www/soterra`;
   - sobe o Relé e a API como serviços do systemd, que renascem sozinhos e
     voltam quando o VPS reinicia;
   - escreve o Caddyfile com o seu endereço, confere e recarrega;
   - agenda o backup diário do banco;
   - no fim, diz se está tudo de pé e se o DNS já aponta para o VPS.

Quando terminar, o site abre em `https://SEU-ENDERECO` e o jogo em
`https://SEU-ENDERECO/index.html`. O certificado HTTPS sai no primeiro acesso,
em até um minuto.

**Atualizar depois**: commit e o **mesmo comando**. Jogo, site, API e relé
são trocados; o banco (`/var/lib/soterra`) nunca é tocado.

**Sem digitar senha** (opcional). No PowerShell, uma vez só:

```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP-DO-VPS "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

---

## Se algo der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `ssh: connect ... timed out` | IP errado, ou o firewall do hPanel sem a porta 22 | conferir o IP na Visão geral; regra 22 e Sincronizar |
| o passo 1/6 fica parado ("o apt está ocupado" ou "Waiting for cache lock") | VPS recém-criado: o Ubuntu está se atualizando sozinho | esperar; o instalador tenta de novo sozinho por uns 15 minutos |
| o instalador termina com "Algo não subiu" | um serviço caiu; o log aparece logo acima | rodar de novo; se repetir, guardar o log |
| "AVISO: … ainda não existe no DNS" ou "aponta para outro IP" | o registro A não propagou, ou está errado | `nslookup ENDERECO 8.8.8.8`; o HTTPS sai sozinho depois |
| o site não abre em https | DNS, ou o firewall sem 80 e 443 | no VPS: `journalctl -u caddy -n 50 --no-pager` |
| o jogo abre, mas ninguém se vê no Acampamento | o Relé | no VPS: `systemctl status soterra-rele` |

Para ver tudo de uma vez, no VPS (`ssh root@IP-DO-VPS`):

```bash
systemctl status soterra-api soterra-rele caddy --no-pager
journalctl -u soterra-api -f        # cadastros, trocas, saves recusados
curl -s https://SEU-ENDERECO/api/saude
```

---

## Administrar (no VPS)

- **Backup**: todo dia, sozinho, em `/var/backups/soterra/`, com os últimos 14
  guardados. Para fazer um na hora: `/etc/cron.daily/soterra-backup`. Para
  trazer um para o seu PC, no PowerShell:
  `scp root@IP-DO-VPS:/var/backups/soterra/soterra-AAAA-MM-DD.db .`
  O hPanel também guarda cópias do VPS inteiro, no menu de backups do VPS.
- **O banco** é um arquivo SQLite só: `/var/lib/soterra/soterra.db` (mais os
  companheiros `-wal` e `-shm`). Senhas nunca ficam em claro (pbkdf2-sha256,
  200 mil voltas, sal por conta). Mexa nele sempre como o usuário `soterra`,
  como nos comandos abaixo: o root criaria arquivos que a API não consegue gravar.
- **O modo Mestre no ar**. A chave de `js/core/gm.js` fica legível para
  qualquer um (o arquivo é servido a todo mundo), então no ar ela sozinha não
  vale: com sessão do site, o modo Mestre só liga na conta que o servidor
  marcou, e o servidor recusa peça da Caixa de qualquer outra conta. Para ser
  o Mestre:
  1. crie a sua conta pelo site;
  2. no VPS, marque-a:
     `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db "update contas set gm=1 where nome='SEU-NOME'"`
  3. no site, **saia e entre de novo** (a sessão pega a marca no login);
  4. abra uma vez `https://SEU-ENDERECO/index.html?gm=SUA-CHAVE` (`?gm=off` desliga).
  Para tirar a marca, o mesmo comando com `gm=0`.
- **Banir** uma conta (a sessão dela passa a levar 403):
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db "update contas set banido=1 where nome='NOME'"`
- **Olhar a trilha de auditoria** (cadastros, logins, peças nascidas, saves recusados):
  `sudo -u soterra sqlite3 /var/lib/soterra/soterra.db 'select tipo, dados from eventos order by id desc limit 20'`

---

## O jogo e a Nuvem (o lado do cliente)

- **Uma sessão só**: o site grava `localStorage['soterra-sessao']` ao entrar
  ou criar conta; o jogo (`js/core/sessao.js`) lê a mesma chave. Como site e
  jogo vivem no mesmo endereço (o Caddy serve os dois), logar em
  `/site/conta.html` já deixa `/index.html` logado.
- **O que a Nuvem faz** (`js/core/nuvem.js`): ao abrir, GET `/api/save`. Se o
  servidor tem versão mais nova (ou a conta é outra), o save de lá entra e a
  página recarrega uma vez; senão o local sobe. Depois, toda gravação local
  sobe 3 s depois num PUT com `versao` e `nascimentos`. Nada sobe antes de o
  servidor responder o primeiro GET: com a API fora do ar no boot, o jogo
  continua local e sobe quando ela voltar. Um 409 de versão (outra máquina
  gravou antes) faz o servidor mandar. Um 409 de instância (linha duplicada,
  peça consumida que voltou) para a subida, e a Ficha de Contas mostra a
  mensagem com o botão "Tentar de novo". O 502 do Caddy (API reiniciando) é
  tratado como "fora": tenta de novo sozinho.
- **O número de série**: toda cópia de item tem `iid`. O progress.js cunha em
  saque, roleta, forja, Caixa do Mestre, balcão do mercador e cofre da guilda;
  equipar, devolver, cofre pessoal, balcão do jogador e troca carregam a
  mesma série. Save antigo ganha carimbo `legado` uma vez; série repetida
  colada à mão no save some no saneamento, em vez de ganhar número novo.
- **Conta trocada na mesma máquina**: se o registro local é de outra conta e o
  servidor não tem nada da nova, o disco é limpo e a nova começa do zero. O
  save da conta anterior continua no servidor, na conta dela.
- **Só a conta Principal sobe**: as outras contas locais do jogo ("Criar conta
  nova", `?conta=2`, a conta local do Mestre) ficam só na máquina. A sessão do
  site vale para o navegador inteiro, e subir duas contas locais na mesma conta
  do servidor faria uma apagar o jogo da outra.
- **Na Ficha de Contas** (menu → Contas) fica a caixa "Nuvem": logado como
  quem, versão do save, "em dia" / "subindo…" / erro, "Sincronizar agora",
  "Sair da nuvem", ou o botão "Entrar ou criar conta", que abre o site.

---

## Testar em casa, sem VPS

```bash
python servidor/rele.py              # ws://127.0.0.1:8791
python servidor/api.py               # http://127.0.0.1:8300, banco em servidor/dados/
python tests/servidor_api.py         # a API por dentro
python tests/nuvem_viva.py           # o jogo contra a API de verdade (conta descartável)
python tests/rele_prova.py           # o relé, nos dois caminhos do websockets
python tests/pacote_servido.py       # o pacote do VPS, servido sozinho, abre o jogo e o site
python tools/sobe_vps.py --so-pacote # só monta e mede o pacote
```

Abra `site/conta.html` do disco: o site descobre que está em `file://` e fala
com `http://127.0.0.1:8300` sozinho (ou force com `?api=http://host:porta`).
O jogo em `http://127.0.0.1:8200/index.html?api=http://127.0.0.1:8300` fala
com a API de casa (a base fica lembrada em `localStorage['soterra-api-base']`).
Em duas janelas com `?rede=ws://127.0.0.1:8791` (contas diferentes), prova o relé.

---

## Notas

- O relé é um carteiro **burro de propósito** (não valida nada), certo para
  jogar entre amigos. A API é a autoridade das contas e das instâncias de
  item. O que ainda **não** é validado no servidor é o sorteio do saque: o
  cliente diz o que nasceu, e o servidor só garante que nasceu uma vez.
- O que a revisão de 10/09 separou como endurecimento (não impede a subida):
  o cadastro não tem freio por IP (atrás do Caddy a API só vê 127.0.0.1, então
  um robô pode criar contas em série); o log de acesso do Caddy vem desligado
  (não fica o IP de quem entrou); o relé roda sem a jaula do systemd que a API tem.
- A subida não passa pelo GitHub. O remoto `origin` está bem atrás desta
  máquina (o último push foi em 18/08); atualizá-lo é outra decisão.
- A landing do site tem 16 molduras esperando fotos em `site/img/` (a lista de
  nomes está no começo de `site/index.html`). Enquanto não existirem, aparece
  a inicial num fundo dourado.
- O peso: a primeira visita de cada jogador baixa os modelos do bundle
  (`assets/models/bundle/`). A migração para um service worker que guarde
  isso é o próximo passo natural depois desta subida.
