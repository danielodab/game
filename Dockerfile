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
# su-exec para rodá-los sem root; tini para os sinais e os processos órfãos
RUN apk add --no-cache python3 py3-websockets sqlite su-exec tini \
 && addgroup -S soterra \
 && adduser -S -G soterra -H -s /sbin/nologin soterra

# o jogo e o site (o .dockerignore deixa de fora os testes, as ferramentas e
# os embutidos que o jogo servido não carrega: ele busca assets/models/bundle)
COPY . /srv/soterra
RUN mkdir -p /app \
 && rm -f /srv/soterra/Dockerfile /srv/soterra/.dockerignore /srv/soterra/docker-compose.yaml \
          /srv/soterra/docker-compose.yml /srv/soterra/.env \
 && mv /srv/soterra/servidor /app/servidor \
 && chmod 755 /app/servidor/coolify/*.sh \
 && ln -s /app/servidor/coolify/admin.sh /usr/local/bin/admin \
 && chmod -R a+rX /srv/soterra /app

EXPOSE 80
# intervalo curto: no deploy o Coolify espera o contêiner novo ficar saudável
# por cerca de 1 min, e com 30 s a primeira sonda já chegava no limite
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1/api/saude >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/servidor/coolify/entrada.sh"]
