# =============================================================================
# SOTERRA num contêiner (Coolify ou qualquer Docker): o jogo, o site, a API de
# contas e o Relé. O domínio e o HTTPS são do proxy do Coolify; aqui dentro o
# Caddy escuta em HTTP na porta 80 e separa o tráfego (servidor/coolify/).
#
# O banco mora em /dados: configure um volume persistente com esse destino
# (Coolify: Persistent Storage). Sem ele o contêiner se recusa a subir.
# Roteiro: servidor/SUBIR.md, parte "No Coolify".
# =============================================================================
FROM caddy:2-alpine

# python3 + websockets para a API e o Relé; sqlite para o backup e o admin;
# su-exec para rodá-los sem root; tini para os sinais e os processos órfãos;
# nodejs para o JUIZ (servidor/juiz/): as regras do jogo rodando no servidor
RUN apk add --no-cache python3 py3-websockets py3-cryptography sqlite su-exec tini nodejs \
 && addgroup -S soterra \
 && adduser -S -G soterra -H -s /sbin/nologin soterra

# o jogo e o site (o .dockerignore deixa de fora os testes, as ferramentas e
# os embutidos que o jogo servido não carrega: ele busca assets/models/bundle)
COPY . /srv/soterra
# versao.py grava js/versao.js com o hash do conteúdo de cada .js/.css (e
# confere cada binário do bundle contra o manifesto): o index.html pede cada
# arquivo com o hash dele, e o que não mudou fica no cache do navegador de um
# deploy para o outro. Grava também /srv/soterra-marcas, uma marca por
# endereço com hash: o Caddyfile de dentro só manda guardar por um ano o
# pedido cujo hash é o DESTE contêiner (no rolling update o velho e o novo
# respondem juntos por uns segundos). E PARA o build se a lista de carga do
# index.html citar arquivo que não entrou na imagem: o jogo não sobe
# incompleto e calado. O caddy validate pega um Caddyfile torto aqui, com o
# contêiner velho ainda no ar, e não no boot do novo.
RUN mkdir -p /app \
 && rm -f /srv/soterra/Dockerfile /srv/soterra/.dockerignore /srv/soterra/docker-compose.yaml \
          /srv/soterra/docker-compose.yml /srv/soterra/.env \
 && mv /srv/soterra/servidor /app/servidor \
 && chmod 755 /app/servidor/coolify/*.sh \
 && ln -s /app/servidor/coolify/admin.sh /usr/local/bin/admin \
 && python3 /app/servidor/coolify/versao.py /srv/soterra \
 && chmod -R a+rX /srv/soterra /srv/soterra-marcas /app \
 && caddy validate --config /app/servidor/coolify/Caddyfile --adapter caddyfile

EXPOSE 80
# intervalo curto: no deploy o Coolify espera o contêiner novo ficar saudável
# por cerca de 1 min, e com 30 s a primeira sonda já chegava no limite
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1/api/saude >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/servidor/coolify/entrada.sh"]
