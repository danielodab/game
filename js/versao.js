// SOTERRA — o mapa de versões dos arquivos do jogo.
//
// ESTE é o padrão do repositório: 'dev', sem mapa. Com ele, o jogo servido
// em casa (python -m http.server, o APK) pede cada arquivo com o carimbo do
// instante — sempre fresco, como sempre foi.
//
// No build do contêiner (Dockerfile) e no instala.sh do VPS,
// servidor/coolify/versao.py REESCREVE este arquivo com o hash do conteúdo de
// cada .js/.css. Aí cada endereço leva o hash do arquivo dele, e o navegador
// guarda o que não mudou de um deploy para o outro.
//
// No file:// (dois cliques no index.html) este arquivo nem é lido.
(typeof window !== 'undefined' ? window : globalThis).SOTERRA_VERSAO = { versao: 'dev', arquivos: {} };
