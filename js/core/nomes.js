// SOTERRA — a lei dos nomes (lado do jogo e do site). Gêmeo de servidor/nomes.py.
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/*
 * PEDIDO DO DONO (literal): "ninguem conseguir colocar o nome com GM Gm Admin
 * Administrador etc.." — ninguém pode escolher um nome que se passe pela equipe
 * do jogo. O "etc." pede o ESPÍRITO, não a lista: por isso aqui tem um
 * esqueleto de comparação (que desmonta disfarce) e não um `if nome == 'GM'`.
 *
 * =============================== A POLÍTICA ===============================
 * (este bloco é IGUAL, palavra por palavra, nos dois arquivos)
 *
 * 1. O QUE É RESERVADO — cargo da equipe ou do sistema, em pt, en e es, com
 *    plural e feminino:
 *      GM · game master · admin · adm · administrador(a) · administrator ·
 *      administração · administración · moderador(a) · moderator · mod ·
 *      moderação · moderación · moderation · staff · suporte · support ·
 *      soporte · atendimento · helpdesk · community manager · cm · dev ·
 *      developer · desenvolvedor(a) · desarrollador(a) · dono · owner ·
 *      dueño · dueña · root · sysop · superuser · sistema · system ·
 *      servidor · server · bot · oficial · official · webmaster ·
 *      SOTERRA (o nome do jogo como identidade oficial) e o título do Mestre
 *      ("Mestre do Fundo", e "mestre"/"master" como palavra).
 *    Mais os erros de grafia que se leem igual (adimin, admim, admistrador,
 *    staf, suport, surporte, sistem, systema, offical, sotera) e o CARGO DO
 *    JOGO: criador(a), equipe, time/team, gerente, diretor(a), programador(a),
 *    proprietário(a), dono/dona, dueño/dueña, mestre/maestro, dev, admin,
 *    mod, gm, suporte… seguido de "do jogo", "del juego", "do game", "do
 *    servidor" ou "da Soterra" — "Criador do Jogo", "Dona do Jogo",
 *    "Maestro del Juego". Sozinhos, "Criador", "Dona" e "Maestro" passam.
 *    E a EQUIPE COMO VOZ (03/10): o jogo assina as falas da moderação como "a
 *    Equipe" (carta, correio), então "Equipe"/"Equipo" cai sozinha ou só com
 *    artigo, conectivo e as palavras do correio — "A Equipe", "Correio da
 *    Equipe", "Carta da Equipe", "Equipe BR". "Equipe Rocket" passa.
 *
 * 2. COMO CADA PALAVRA CONTA — nome de gente não pode virar refém:
 *    - LONGA (admin, moderador, staff, suporte, desenvolvedor, helpdesk…):
 *      pega DENTRO de outra palavra ("xXadminXx", "superstaff") e também
 *      ATRAVÉS de um separador quando encosta numa ponta de palavra
 *      ("Admi nistrador", "Superad-min", "Moder adora") ou quando o meio é
 *      soletrado letra por letra ("oa d m i nzinho"). Pelo meio de duas
 *      palavras de verdade não conta: "Conrad Minelli", "Mohammad Mina",
 *      "Ana D Minelli" e "brad_mint" passam.
 *    - CURTA ou ambígua (gm, adm, mod, dev, bot, cm, root, sysop, mestre,
 *      master, sistema, servidor, server, oficial, dono, owner, dueño,
 *      soterra…): só como PALAVRA INTEIRA — sozinha, no plural, colada com
 *      troca de caixa ("GMJoao", "JoaoGM", "ModZe"), separada por pontuação
 *      ("[GM]", "-GM-", "G_M") ou grudada em dígito ("GM2").
 *    - A REGRA DA SÍLABA (só gm, adm e mod): em português e espanhol o "m"
 *      dessas três sempre abre a sílaba seguinte (Sig-mund, Mag-ma, Ad-mar,
 *      Mo-des-to). Então elas contam DENTRO da palavra quando vêm no fim ou
 *      antes de consoante: "SUPERGM", "xXGMXx", "gmjoao", "ADMJOAO",
 *      "MODROSA", "Joaoadm". Sigmund, Magma, Dogma, Bergman, Gmeiner, Admar,
 *      Admilson, Madmax, Modesto, Almodóvar e Moody passam (o y conta como
 *      vogal). dev, bot e cm NÃO têm essa regra: Devlin, Medvedev, Talbot,
 *      Robot, Abbot e Cmdr são nome de gente.
 *    - EMENDADAS: uma palavra toda feita de reservadas ("gmadmin",
 *      "soterraoficial") ou de reservada com time/team/equipe/br ("Devteam",
 *      "teamsoterra", "SOTERRABR") cai.
 *    - SOLETRADAS: uma sequência de palavras que soletra uma reservada cai
 *      ("A D M I N", "G M", "Sys Op") — menos quando uma das peças é
 *      conectivo (do, da, de, no, na, em, el, la, of…) e as peças não são
 *      letras soltas: "Zé do Nó" e "Máscara do Nô" não soletram "dono".
 *    - NEGAÇÃO: "sem" logo antes de uma palavra curta desarma ela ("Terra
 *      Sem Dono", "Cão Sem Dono").
 *    - PLURAL: "-s" sempre; "-es" só depois de r ou l (servidores,
 *      oficiales) — "Botes" e "Deves" não viram "bot" e "dev".
 *    - EXCEÇÕES NOMEADAS (palavra de dicionário ou sobrenome com a reservada
 *      dentro por acidente): badminton, stafford, flagstaff, mcmaster,
 *      macmaster, dueñas.
 *
 * 3. RESISTE A (a comparação é feita sobre um ESQUELETO, em mais de uma
 *    LEITURA do mesmo nome — basta uma casar):
 *    - caixa (gm/GM/Gm/gM), acentos e cedilha (NFKD: as marcas caem);
 *    - separadores e pontuação: G.M, G M, G_M, [GM], -GM-, A.D.M.I.N;
 *    - colado com troca de caixa: GMJoao, JoaoGM, ADMINJoao, oGMzinho;
 *    - o enfeite xX…Xx (as pontas de x caem numa leitura à parte);
 *    - leetspeak: 4dm1n, @dmin, Adm!n, 6M, M0d, 5taff, o de barrinhas
 *      (/\DMIN, |\/|OD) e o ele fingindo de i (ADMlN) — mas número SOLTO é
 *      número ("Mago_807" e "Agente 007" não são bot); e o número que fecha
 *      a palavra é lido das duas formas ("D0n0" e "deV2" caem);
 *    - pontuação de dentro da palavra: o ponto e o apóstrofo são lidos
 *      colados numa leitura à parte ("superg.m", "oG.Mzinho");
 *    - letras repetidas: Aaadmin, GGMM, Sttaff (quem ESTICA é a palavra
 *      reservada, letra por letra — "insuportável" e "suportar" passam);
 *    - NFKD: largura cheia ＧＭ, sobrescritas ᴳᴹ, matemáticas 𝐆𝐌, circuladas
 *      ⒼⓂ, as negativas e as bandeirinhas 🅶🅼 🇬🇲, e as letras VAZADAS e o S
 *      modificador do Unicode 16/17 (o Python do servidor ainda não conhece
 *      esses: uma tabela troca antes de normalizar, igual nos dois lados);
 *    - homóglifos: uma tabela com 1013 letras de cara latina (latim
 *      estendido, IPA, versaletes, grego, cirílico, armênio, cheroqui,
 *      cóptico, lisu, silábicos canadenses, runas, algarismos em forma de O,
 *      moedas e sinais); e toda LETRA de outra escrita que não está na
 *      tabela vale como CURINGA — uma por palavra reservada de 3 letras ou
 *      mais ("Aдmin" cai mesmo que a tabela não conheça o д);
 *    - invisíveis e marcas: TODAS as marcas combinantes e todos os
 *      caracteres de formato do Unicode somem (zero-width, seletores de
 *      variação, etiquetas, controles musicais e taquigráficos, hífen
 *      suave, U+180F…); e espaço fino, espaço estreito, emoji ou símbolo
 *      NO MEIO da palavra também são lidos colados (Superad + U+200A + min
 *      = Superadmin);
 *    - direção do texto: com override da direita para a esquerda (U+202E)
 *      vale o que APARECE na tela — "U+202E NIMDA" mostra ADMIN;
 *    - fala caipira: "Moderadô", "Desenvolvedô" (ô no fim = "or").
 *
 * 4. CONJUNTO DE CARACTERES PARA NOME NOVO (caracteres_ok): letras latinas com
 *    os acentos do português e do espanhol, ª e º (Mª Clara), dígitos,
 *    espaço, _ e -, e o apóstrofo em qualquer das formas que o teclado manda
 *    (' ’ ‘ ´ ʼ — o celular troca sozinho). Nada de ponto (é o disfarce
 *    clássico "G.M." e nome nenhum precisa dele). Isso fecha a porta dos
 *    homóglifos pela RAIZ — mas `reservado()` funciona sozinho de propósito:
 *    o batismo do jogo e a guilda hoje aceitam qualquer coisa, e os nomes
 *    antigos continuam existindo.
 *
 * 5. CUSTO ACEITO (dito, não escondido): "Dev", "Mod", "Bot", "Master" e
 *    "Mestre" sozinhos (ou em camelo, "DevAir") caem — é o que o dono pediu.
 *    Caem também, por decisão: "Bott", "Donno" e "Rooot" (a letra repetida é
 *    o disfarce mais barato que existe e a regra estica), "Roots" e "Root
 *    Beer" (root no plural e como palavra inteira), "Sistema Solar" (sistema
 *    como palavra inteira), "Staffy" (staff + y), "LeMaster" ("Le Master" é
 *    "O Mestre"), "Paradigm", "Modric" e "Pramod" (a regra da sílaba),
 *    "Vlad Min" e "Moderado Rei" (a reservada encostada na ponta de uma
 *    palavra — o preço de pegar "Admi nistrador" e "Suppor ter") e "Staffa"
 *    (staff + a, como Staffy). E passam, por decisão:
 *    "superdev", "megabot" e "DEVJOAO" (dev e bot não têm a regra da sílaba
 *    por causa de Devlin e Talbot). Conta que JÁ EXISTE não muda: a trava é
 *    para nome NOVO (a conta "Administrator" do dono segue entrando).
 *
 * =========================== A API (idêntica nos dois lados) ===============
 *     JOGO.Nomes.normaliza(nome)    -> String   o esqueleto de comparação
 *     JOGO.Nomes.reservado(nome)    -> String|null  a reservada que casou
 *     JOGO.Nomes.caracteresOk(nome) -> Boolean  só o conjunto de caracteres
 *     JOGO.Nomes.valida(nome, minimo, maximo) -> {ok, motivo} (motivo pt-BR)
 *
 * Sem estado e sem depender de nada além de window: roda no jogo (file://) e
 * no site (que carrega ../js/core/nomes.js). ES5 como o resto do jogo — sem
 * regex com flag u, sem \p{…}, sem let/const/arrow.
 */
(function () {
  'use strict';

  var N = {};
  JOGO.Nomes = N;

  /* ================================================================ tabelas
   * Tudo aqui é LISTA FIXA, com o MESMO texto do gêmeo em Python (a prova,
   * tests/nomes_prova.py, compara uma por uma): o JavaScript não tem as
   * categorias do Unicode, e a única forma de os dois nunca discordarem é os
   * dois lerem a mesma lista. As três primeiras saíram do unicodedata do
   * Python 3.13 (Unicode 15.1) e da comparação ponto a ponto com o NFKD do
   * Chrome (Unicode 17). */

  /* SOME: somem do nome — todas as marcas combinantes (Mn, Me), todos os
   * caracteres de formato (Cf) e os demais ignoráveis (preenchedores hangul,
   * etiquetas, seletores de variação). Pares [primeiro, último]. */
  var SOME = [
    0x00AD, 0x00AD, 0x0300, 0x036F, 0x0483, 0x0489, 0x0591, 0x05BD, 0x05BF, 0x05BF, 0x05C1, 0x05C2,
    0x05C4, 0x05C5, 0x05C7, 0x05C7, 0x0600, 0x0605, 0x0610, 0x061A, 0x061C, 0x061C, 0x064B, 0x065F,
    0x0670, 0x0670, 0x06D6, 0x06DD, 0x06DF, 0x06E4, 0x06E7, 0x06E8, 0x06EA, 0x06ED, 0x070F, 0x070F,
    0x0711, 0x0711, 0x0730, 0x074A, 0x07A6, 0x07B0, 0x07EB, 0x07F3, 0x07FD, 0x07FD, 0x0816, 0x0819,
    0x081B, 0x0823, 0x0825, 0x0827, 0x0829, 0x082D, 0x0859, 0x085B, 0x0890, 0x089F, 0x08CA, 0x0902,
    0x093A, 0x093A, 0x093C, 0x093C, 0x0941, 0x0948, 0x094D, 0x094D, 0x0951, 0x0957, 0x0962, 0x0963,
    0x0981, 0x0981, 0x09BC, 0x09BC, 0x09C1, 0x09C4, 0x09CD, 0x09CD, 0x09E2, 0x09E3, 0x09FE, 0x0A02,
    0x0A3C, 0x0A3C, 0x0A41, 0x0A51, 0x0A70, 0x0A71, 0x0A75, 0x0A75, 0x0A81, 0x0A82, 0x0ABC, 0x0ABC,
    0x0AC1, 0x0AC8, 0x0ACD, 0x0ACD, 0x0AE2, 0x0AE3, 0x0AFA, 0x0B01, 0x0B3C, 0x0B3C, 0x0B3F, 0x0B3F,
    0x0B41, 0x0B44, 0x0B4D, 0x0B56, 0x0B62, 0x0B63, 0x0B82, 0x0B82, 0x0BC0, 0x0BC0, 0x0BCD, 0x0BCD,
    0x0C00, 0x0C00, 0x0C04, 0x0C04, 0x0C3C, 0x0C3C, 0x0C3E, 0x0C40, 0x0C46, 0x0C56, 0x0C62, 0x0C63,
    0x0C81, 0x0C81, 0x0CBC, 0x0CBC, 0x0CBF, 0x0CBF, 0x0CC6, 0x0CC6, 0x0CCC, 0x0CCD, 0x0CE2, 0x0CE3,
    0x0D00, 0x0D01, 0x0D3B, 0x0D3C, 0x0D41, 0x0D44, 0x0D4D, 0x0D4D, 0x0D62, 0x0D63, 0x0D81, 0x0D81,
    0x0DCA, 0x0DCA, 0x0DD2, 0x0DD6, 0x0E31, 0x0E31, 0x0E34, 0x0E3A, 0x0E47, 0x0E4E, 0x0EB1, 0x0EB1,
    0x0EB4, 0x0EBC, 0x0EC8, 0x0ECE, 0x0F18, 0x0F19, 0x0F35, 0x0F35, 0x0F37, 0x0F37, 0x0F39, 0x0F39,
    0x0F71, 0x0F7E, 0x0F80, 0x0F84, 0x0F86, 0x0F87, 0x0F8D, 0x0FBC, 0x0FC6, 0x0FC6, 0x102D, 0x1030,
    0x1032, 0x1037, 0x1039, 0x103A, 0x103D, 0x103E, 0x1058, 0x1059, 0x105E, 0x1060, 0x1071, 0x1074,
    0x1082, 0x1082, 0x1085, 0x1086, 0x108D, 0x108D, 0x109D, 0x109D, 0x115F, 0x1160, 0x135D, 0x135F,
    0x1712, 0x1714, 0x1732, 0x1733, 0x1752, 0x1753, 0x1772, 0x1773, 0x17B4, 0x17B5, 0x17B7, 0x17BD,
    0x17C6, 0x17C6, 0x17C9, 0x17D3, 0x17DD, 0x17DD, 0x180B, 0x180F, 0x1885, 0x1886, 0x18A9, 0x18A9,
    0x1920, 0x1922, 0x1927, 0x1928, 0x1932, 0x1932, 0x1939, 0x193B, 0x1A17, 0x1A18, 0x1A1B, 0x1A1B,
    0x1A56, 0x1A56, 0x1A58, 0x1A60, 0x1A62, 0x1A62, 0x1A65, 0x1A6C, 0x1A73, 0x1A7F, 0x1AB0, 0x1B03,
    0x1B34, 0x1B34, 0x1B36, 0x1B3A, 0x1B3C, 0x1B3C, 0x1B42, 0x1B42, 0x1B6B, 0x1B73, 0x1B80, 0x1B81,
    0x1BA2, 0x1BA5, 0x1BA8, 0x1BA9, 0x1BAB, 0x1BAD, 0x1BE6, 0x1BE6, 0x1BE8, 0x1BE9, 0x1BED, 0x1BED,
    0x1BEF, 0x1BF1, 0x1C2C, 0x1C33, 0x1C36, 0x1C37, 0x1CD0, 0x1CD2, 0x1CD4, 0x1CE0, 0x1CE2, 0x1CE8,
    0x1CED, 0x1CED, 0x1CF4, 0x1CF4, 0x1CF8, 0x1CF9, 0x1DC0, 0x1DFF, 0x200B, 0x200F, 0x202A, 0x202E,
    0x2060, 0x206F, 0x20D0, 0x20F0, 0x2CEF, 0x2CF1, 0x2D7F, 0x2D7F, 0x2DE0, 0x2DFF, 0x302A, 0x302D,
    0x3099, 0x309A, 0x3164, 0x3164, 0xA66F, 0xA672, 0xA674, 0xA67D, 0xA69E, 0xA69F, 0xA6F0, 0xA6F1,
    0xA802, 0xA802, 0xA806, 0xA806, 0xA80B, 0xA80B, 0xA825, 0xA826, 0xA82C, 0xA82C, 0xA8C4, 0xA8C5,
    0xA8E0, 0xA8F1, 0xA8FF, 0xA8FF, 0xA926, 0xA92D, 0xA947, 0xA951, 0xA980, 0xA982, 0xA9B3, 0xA9B3,
    0xA9B6, 0xA9B9, 0xA9BC, 0xA9BD, 0xA9E5, 0xA9E5, 0xAA29, 0xAA2E, 0xAA31, 0xAA32, 0xAA35, 0xAA36,
    0xAA43, 0xAA43, 0xAA4C, 0xAA4C, 0xAA7C, 0xAA7C, 0xAAB0, 0xAAB0, 0xAAB2, 0xAAB4, 0xAAB7, 0xAAB8,
    0xAABE, 0xAABF, 0xAAC1, 0xAAC1, 0xAAEC, 0xAAED, 0xAAF6, 0xAAF6, 0xABE5, 0xABE5, 0xABE8, 0xABE8,
    0xABED, 0xABED, 0xFB1E, 0xFB1E, 0xFE00, 0xFE0F, 0xFE20, 0xFE2F, 0xFEFF, 0xFEFF, 0xFFA0, 0xFFA0,
    0xFFF0, 0xFFFB, 0x101FD, 0x101FD, 0x102E0, 0x102E0, 0x10376, 0x1037A, 0x10A01, 0x10A0F, 0x10A38, 0x10A3F,
    0x10AE5, 0x10AE6, 0x10D24, 0x10D27, 0x10EAB, 0x10EAC, 0x10EFD, 0x10EFF, 0x10F46, 0x10F50, 0x10F82, 0x10F85,
    0x11001, 0x11001, 0x11038, 0x11046, 0x11070, 0x11070, 0x11073, 0x11074, 0x1107F, 0x11081, 0x110B3, 0x110B6,
    0x110B9, 0x110BA, 0x110BD, 0x110BD, 0x110C2, 0x110CD, 0x11100, 0x11102, 0x11127, 0x1112B, 0x1112D, 0x11134,
    0x11173, 0x11173, 0x11180, 0x11181, 0x111B6, 0x111BE, 0x111C9, 0x111CC, 0x111CF, 0x111CF, 0x1122F, 0x11231,
    0x11234, 0x11234, 0x11236, 0x11237, 0x1123E, 0x1123E, 0x11241, 0x11241, 0x112DF, 0x112DF, 0x112E3, 0x112EA,
    0x11300, 0x11301, 0x1133B, 0x1133C, 0x11340, 0x11340, 0x11366, 0x11374, 0x11438, 0x1143F, 0x11442, 0x11444,
    0x11446, 0x11446, 0x1145E, 0x1145E, 0x114B3, 0x114B8, 0x114BA, 0x114BA, 0x114BF, 0x114C0, 0x114C2, 0x114C3,
    0x115B2, 0x115B5, 0x115BC, 0x115BD, 0x115BF, 0x115C0, 0x115DC, 0x115DD, 0x11633, 0x1163A, 0x1163D, 0x1163D,
    0x1163F, 0x11640, 0x116AB, 0x116AB, 0x116AD, 0x116AD, 0x116B0, 0x116B5, 0x116B7, 0x116B7, 0x1171D, 0x1171F,
    0x11722, 0x11725, 0x11727, 0x1172B, 0x1182F, 0x11837, 0x11839, 0x1183A, 0x1193B, 0x1193C, 0x1193E, 0x1193E,
    0x11943, 0x11943, 0x119D4, 0x119DB, 0x119E0, 0x119E0, 0x11A01, 0x11A0A, 0x11A33, 0x11A38, 0x11A3B, 0x11A3E,
    0x11A47, 0x11A47, 0x11A51, 0x11A56, 0x11A59, 0x11A5B, 0x11A8A, 0x11A96, 0x11A98, 0x11A99, 0x11C30, 0x11C3D,
    0x11C3F, 0x11C3F, 0x11C92, 0x11CA7, 0x11CAA, 0x11CB0, 0x11CB2, 0x11CB3, 0x11CB5, 0x11CB6, 0x11D31, 0x11D45,
    0x11D47, 0x11D47, 0x11D90, 0x11D91, 0x11D95, 0x11D95, 0x11D97, 0x11D97, 0x11EF3, 0x11EF4, 0x11F00, 0x11F01,
    0x11F36, 0x11F3A, 0x11F40, 0x11F40, 0x11F42, 0x11F42, 0x13430, 0x13440, 0x13447, 0x13455, 0x16AF0, 0x16AF4,
    0x16B30, 0x16B36, 0x16F4F, 0x16F4F, 0x16F8F, 0x16F92, 0x16FE4, 0x16FE4, 0x1BC9D, 0x1BC9E, 0x1BCA0, 0x1CF46,
    0x1D167, 0x1D169, 0x1D173, 0x1D182, 0x1D185, 0x1D18B, 0x1D1AA, 0x1D1AD, 0x1D242, 0x1D244, 0x1DA00, 0x1DA36,
    0x1DA3B, 0x1DA6C, 0x1DA75, 0x1DA75, 0x1DA84, 0x1DA84, 0x1DA9B, 0x1DAAF, 0x1E000, 0x1E02A, 0x1E08F, 0x1E08F,
    0x1E130, 0x1E136, 0x1E2AE, 0x1E2AE, 0x1E2EC, 0x1E2EF, 0x1E4EC, 0x1E4EF, 0x1E8D0, 0x1E8D6, 0x1E944, 0x1E94A,
    0xE0000, 0xE0FFF
  ];

  /* SIMBOLOS: o que NÃO é letra (pontuação, símbolo, espaço, controle). Fora
   * do ASCII, o que sobra depois da tabela de homóglifos e não está aqui é
   * LETRA de outra escrita — e vale como CURINGA na comparação. */
  var SIMBOLOS = [
    0x0080, 0x00A9, 0x00AB, 0x00AC, 0x00AE, 0x00B1, 0x00B4, 0x00B4, 0x00B6, 0x00B8, 0x00BB, 0x00BB,
    0x00BF, 0x00BF, 0x00D7, 0x00D7, 0x00F7, 0x00F7, 0x02C2, 0x02C5, 0x02D2, 0x02DF, 0x02E5, 0x02EB,
    0x02ED, 0x02ED, 0x02EF, 0x02FF, 0x0375, 0x0375, 0x037E, 0x037E, 0x0384, 0x0385, 0x0387, 0x0387,
    0x03F6, 0x03F6, 0x0482, 0x0482, 0x055A, 0x055F, 0x0589, 0x058F, 0x05BE, 0x05BE, 0x05C0, 0x05C0,
    0x05C3, 0x05C3, 0x05C6, 0x05C6, 0x05F3, 0x05F4, 0x0606, 0x060F, 0x061B, 0x061B, 0x061D, 0x061F,
    0x066A, 0x066D, 0x06D4, 0x06D4, 0x06DE, 0x06DE, 0x06E9, 0x06E9, 0x06FD, 0x06FE, 0x0700, 0x070D,
    0x07F6, 0x07F9, 0x07FE, 0x07FF, 0x0830, 0x083E, 0x085E, 0x085E, 0x0888, 0x0888, 0x0964, 0x0965,
    0x0970, 0x0970, 0x09F2, 0x09F3, 0x09FA, 0x09FB, 0x09FD, 0x09FD, 0x0A76, 0x0A76, 0x0AF0, 0x0AF1,
    0x0B70, 0x0B70, 0x0BF3, 0x0BFA, 0x0C77, 0x0C77, 0x0C7F, 0x0C7F, 0x0C84, 0x0C84, 0x0D4F, 0x0D4F,
    0x0D79, 0x0D79, 0x0DF4, 0x0DF4, 0x0E3F, 0x0E3F, 0x0E4F, 0x0E4F, 0x0E5A, 0x0E5B, 0x0F01, 0x0F17,
    0x0F1A, 0x0F1F, 0x0F34, 0x0F34, 0x0F36, 0x0F36, 0x0F38, 0x0F38, 0x0F3A, 0x0F3D, 0x0F85, 0x0F85,
    0x0FBE, 0x0FC5, 0x0FC7, 0x0FDA, 0x104A, 0x104F, 0x109E, 0x109F, 0x10FB, 0x10FB, 0x1360, 0x1368,
    0x1390, 0x1399, 0x1400, 0x1400, 0x166D, 0x166E, 0x1680, 0x1680, 0x169B, 0x169C, 0x16EB, 0x16ED,
    0x1735, 0x1736, 0x17D4, 0x17D6, 0x17D8, 0x17DB, 0x1800, 0x180A, 0x1940, 0x1945, 0x19DE, 0x19FF,
    0x1A1E, 0x1A1F, 0x1AA0, 0x1AA6, 0x1AA8, 0x1AAD, 0x1B5A, 0x1B6A, 0x1B74, 0x1B7E, 0x1BFC, 0x1BFF,
    0x1C3B, 0x1C3F, 0x1C7E, 0x1C7F, 0x1CC0, 0x1CC7, 0x1CD3, 0x1CD3, 0x1FBD, 0x1FBD, 0x1FBF, 0x1FC1,
    0x1FCD, 0x1FCF, 0x1FDD, 0x1FDF, 0x1FED, 0x1FEF, 0x1FFD, 0x200A, 0x2010, 0x2029, 0x202F, 0x205F,
    0x207A, 0x207E, 0x208A, 0x208E, 0x20A0, 0x20C0, 0x2100, 0x2101, 0x2103, 0x2106, 0x2108, 0x2109,
    0x2114, 0x2114, 0x2116, 0x2118, 0x211E, 0x2123, 0x2125, 0x2125, 0x2127, 0x2127, 0x2129, 0x2129,
    0x212E, 0x212E, 0x213A, 0x213B, 0x2140, 0x2144, 0x214A, 0x214D, 0x214F, 0x214F, 0x218A, 0x244A,
    0x249C, 0x24E9, 0x2500, 0x2775, 0x2794, 0x2BFF, 0x2CE5, 0x2CEA, 0x2CF9, 0x2CFC, 0x2CFE, 0x2CFF,
    0x2D70, 0x2D70, 0x2E00, 0x2E2E, 0x2E30, 0x3004, 0x3008, 0x3020, 0x3030, 0x3030, 0x3036, 0x3037,
    0x303D, 0x303F, 0x309B, 0x309C, 0x30A0, 0x30A0, 0x30FB, 0x30FB, 0x3190, 0x3191, 0x3196, 0x319F,
    0x31C0, 0x31EF, 0x3200, 0x321E, 0x322A, 0x3247, 0x3250, 0x3250, 0x3260, 0x327F, 0x328A, 0x32B0,
    0x32C0, 0x33FF, 0x4DC0, 0x4DFF, 0xA490, 0xA4C6, 0xA4FE, 0xA4FF, 0xA60D, 0xA60F, 0xA673, 0xA673,
    0xA67E, 0xA67E, 0xA6F2, 0xA716, 0xA720, 0xA721, 0xA789, 0xA78A, 0xA828, 0xA82B, 0xA836, 0xA839,
    0xA874, 0xA877, 0xA8CE, 0xA8CF, 0xA8F8, 0xA8FA, 0xA8FC, 0xA8FC, 0xA92E, 0xA92F, 0xA95F, 0xA95F,
    0xA9C1, 0xA9CD, 0xA9DE, 0xA9DF, 0xAA5C, 0xAA5F, 0xAA77, 0xAA79, 0xAADE, 0xAADF, 0xAAF0, 0xAAF1,
    0xAB5B, 0xAB5B, 0xAB6A, 0xAB6B, 0xABEB, 0xABEB, 0xFB29, 0xFB29, 0xFBB2, 0xFBC2, 0xFD3E, 0xFD4F,
    0xFDCF, 0xFDCF, 0xFDFC, 0xFDFF, 0xFE10, 0xFE19, 0xFE30, 0xFE6B, 0xFF01, 0xFF0F, 0xFF1A, 0xFF20,
    0xFF3B, 0xFF40, 0xFF5B, 0xFF65, 0xFFE0, 0xFFEE, 0xFFFC, 0xFFFD, 0x10100, 0x10102, 0x10137, 0x1013F,
    0x10179, 0x10189, 0x1018C, 0x101FC, 0x1039F, 0x1039F, 0x103D0, 0x103D0, 0x1056F, 0x1056F, 0x10857, 0x10857,
    0x10877, 0x10878, 0x1091F, 0x1091F, 0x1093F, 0x1093F, 0x10A50, 0x10A58, 0x10A7F, 0x10A7F, 0x10AC8, 0x10AC8,
    0x10AF0, 0x10AF6, 0x10B39, 0x10B3F, 0x10B99, 0x10B9C, 0x10EAD, 0x10EAD, 0x10F55, 0x10F59, 0x10F86, 0x10F89,
    0x11047, 0x1104D, 0x110BB, 0x110BC, 0x110BE, 0x110C1, 0x11140, 0x11143, 0x11174, 0x11175, 0x111C5, 0x111C8,
    0x111CD, 0x111CD, 0x111DB, 0x111DB, 0x111DD, 0x111DF, 0x11238, 0x1123D, 0x112A9, 0x112A9, 0x1144B, 0x1144F,
    0x1145A, 0x1145D, 0x114C6, 0x114C6, 0x115C1, 0x115D7, 0x11641, 0x11643, 0x11660, 0x1166C, 0x116B9, 0x116B9,
    0x1173C, 0x1173F, 0x1183B, 0x1183B, 0x11944, 0x11946, 0x119E2, 0x119E2, 0x11A3F, 0x11A46, 0x11A9A, 0x11A9C,
    0x11A9E, 0x11AA2, 0x11B00, 0x11B09, 0x11C41, 0x11C45, 0x11C70, 0x11C71, 0x11EF7, 0x11EF8, 0x11F43, 0x11F4F,
    0x11FD5, 0x11FFF, 0x12470, 0x12474, 0x12FF1, 0x12FF2, 0x16A6E, 0x16A6F, 0x16AF5, 0x16AF5, 0x16B37, 0x16B3F,
    0x16B44, 0x16B45, 0x16E97, 0x16E9A, 0x16FE2, 0x16FE2, 0x1BC9C, 0x1BC9C, 0x1BC9F, 0x1BC9F, 0x1CF50, 0x1D164,
    0x1D16A, 0x1D16C, 0x1D183, 0x1D184, 0x1D18C, 0x1D1A9, 0x1D1AE, 0x1D241, 0x1D245, 0x1D245, 0x1D300, 0x1D356,
    0x1D6C1, 0x1D6C1, 0x1D6DB, 0x1D6DB, 0x1D6FB, 0x1D6FB, 0x1D715, 0x1D715, 0x1D735, 0x1D735, 0x1D74F, 0x1D74F,
    0x1D76F, 0x1D76F, 0x1D789, 0x1D789, 0x1D7A9, 0x1D7A9, 0x1D7C3, 0x1D7C3, 0x1D800, 0x1D9FF, 0x1DA37, 0x1DA3A,
    0x1DA6D, 0x1DA74, 0x1DA76, 0x1DA83, 0x1DA85, 0x1DA8B, 0x1E14F, 0x1E14F, 0x1E2FF, 0x1E2FF, 0x1E95E, 0x1E95F,
    0x1ECAC, 0x1ECAC, 0x1ECB0, 0x1ECB0, 0x1ED2E, 0x1ED2E, 0x1EEF0, 0x1F0F5, 0x1F10D, 0x1FBCA
  ];

  /* HOMÓGLIFOS: o que o NFKD não desfaz, agrupado pela letra que finge ser. A
   * caixa é PRESERVADA (letra que parece maiúscula vira maiúscula) porque a
   * troca de caixa é o que separa "GMJoao" em duas palavras lá embaixo. */
  var GRUPOS = [
    ['A', 0x023A, 0x0245, 0x0391, 0x0394, 0x039B, 0x0410, 0x041B, 0x13AA, 0x1431, 0x15C5,
     0x15E9, 0x1D00, 0x1D27, 0x20B3, 0x2200, 0x2206, 0x2227, 0x22BC, 0x22C0, 0x2C6D, 0x2C6F,
     0x2C70, 0x2C80, 0x2D37, 0xA4E5, 0xA4EE, 0xA4EF, 0xA7BA, 0xAB7A, 0x10300],
    ['a', 0x0250, 0x0251, 0x0252, 0x028C, 0x03B1, 0x0430, 0x1D8F, 0x1D90, 0x2C65, 0x2C81,
     0xA7BB, 0xAB30],
    ['AA', 0xA732, 0x10780],
    ['aa', 0xA733],
    ['AE', 0x00C6, 0x1D01],
    ['ae', 0x00E6],
    ['AO', 0xA734],
    ['ao', 0xA735],
    ['AU', 0xA736],
    ['au', 0xA737],
    ['AV', 0xA738, 0xA73A],
    ['av', 0xA739, 0xA73B],
    ['AY', 0xA73C],
    ['ay', 0xA73D],
    ['B', 0x0181, 0x0182, 0x0243, 0x0299, 0x0392, 0x0412, 0x13F4, 0x13FC, 0x15F7, 0x16D2,
     0x1D03, 0x20BF, 0x2C82, 0xA4D0, 0xA796, 0xA7B4, 0xAB9F, 0x10331],
    ['b', 0x0180, 0x0183, 0x0184, 0x0185, 0x0253, 0x03B2, 0x042A, 0x042C, 0x0432, 0x044A,
     0x044C, 0x0462, 0x0463, 0x13CF, 0x1472, 0x1572, 0x1D6C, 0x1D80, 0x2C83, 0xA797, 0xA7B5],
    ['C', 0x0187, 0x023B, 0x0421, 0x0480, 0x04AA, 0x13DF, 0x1455, 0x1D04, 0x20A1, 0x20A2,
     0x20B5, 0x2183, 0x2201, 0x2282, 0x2286, 0x2CA4, 0xA4DA, 0xA792, 0xA7C4, 0xABAF],
    ['c', 0x0188, 0x023C, 0x0255, 0x0297, 0x0441, 0x0481, 0x04AB, 0x2184, 0x2CA5, 0xA793,
     0xA794, 0x1DF0F, 0x1DF1D],
    ['D', 0x00D0, 0x0110, 0x0189, 0x018A, 0x018B, 0x13A0, 0x15DE, 0x15EA, 0x1D05, 0x1D06,
     0xA4D3, 0xA4F7, 0xA779, 0xA7C7, 0xAB70],
    ['d', 0x00F0, 0x0111, 0x018C, 0x0221, 0x0256, 0x0257, 0x03B4, 0x0500, 0x0501, 0x056A,
     0x146F, 0x1D6D, 0x1D81, 0x1D91, 0x1E9F, 0x20AB, 0x2202, 0xA771, 0xA77A, 0xA7C8, 0x1DF25],
    ['db', 0x0238],
    ['dz', 0x02A3, 0x02A4],
    ['E', 0x018E, 0x018F, 0x0190, 0x01A9, 0x0246, 0x0395, 0x0404, 0x0415, 0x04BC, 0x04BE,
     0x04D8, 0x0510, 0x13AC, 0x156E, 0x15F4, 0x1D07, 0x2203, 0x2208, 0x2211, 0x2C7B, 0x2C88,
     0xA4F0, 0xA4F1, 0xA7AB, 0xAB7C],
    ['e', 0x01DD, 0x0247, 0x0258, 0x0259, 0x025A, 0x025B, 0x025C, 0x025D, 0x03B5, 0x0435,
     0x044D, 0x0454, 0x04BD, 0x04BF, 0x04D9, 0x0511, 0x1D08, 0x1D92, 0x1D93, 0x1D94, 0x1D95,
     0x212E, 0x220A, 0x2C78, 0x2C89, 0xAB32, 0xAB33, 0xAB34],
    ['F', 0x0191, 0x03DC, 0x0492, 0x0493, 0x04FA, 0x15B4, 0x16A0, 0x20A3, 0x2132, 0xA4DD,
     0xA730, 0xA77B, 0xA798, 0xA7FB, 0x10346],
    ['f', 0x0192, 0x03DD, 0x04FB, 0x1D6E, 0x1D82, 0x214E, 0xA77C, 0xA799, 0xAB35],
    ['G', 0x0193, 0x01E4, 0x0262, 0x029B, 0x0413, 0x0490, 0x04F6, 0x050C, 0x13C0, 0x13F3,
     0x13FB, 0x161C, 0x20B2, 0x2141, 0xA4D6, 0xA77D, 0xA77E, 0xA7A0, 0xA7AC, 0xA7D0, 0xAB90],
    ['g', 0x01E5, 0x0260, 0x0261, 0x0433, 0x0491, 0x04F7, 0x050D, 0x0581, 0x1D77, 0x1D79,
     0x1D83, 0xA77F, 0xA7A1, 0xA7D1, 0xAB36],
    ['H', 0x0126, 0x029C, 0x0397, 0x041D, 0x04A2, 0x04A4, 0x04BA, 0x04C7, 0x04C9, 0x050A,
     0x0526, 0x13BB, 0x157C, 0x16BA, 0x16BB, 0x2C67, 0x2C75, 0x2C8E, 0xA4E7, 0xA726, 0xA78D,
     0xA7AA, 0xAB8B, 0xAB92],
    ['h', 0x0127, 0x0265, 0x0266, 0x0267, 0x0402, 0x040B, 0x043D, 0x0452, 0x045B, 0x04A3,
     0x04A5, 0x04BB, 0x04C8, 0x04CA, 0x050B, 0x0527, 0x056B, 0x0570, 0x13C2, 0x2C68, 0x2C76,
     0x2C8F, 0xA727, 0xA795, 0x10337],
    ['hv', 0x0195],
    ['I', 0x0196, 0x0197, 0x026A, 0x0399, 0x0406, 0x04C0, 0x16C1, 0x16CC, 0x1D7B, 0x2C92,
     0x2D4F, 0xA4F2, 0xA646, 0xA7AE, 0xA7BC, 0xA7FE, 0xAB75, 0x10309, 0x10339],
    ['i', 0x0131, 0x01C3, 0x0268, 0x0269, 0x03B9, 0x0456, 0x13A5, 0x1D09, 0x1D7C, 0x1D96,
     0x2129, 0x2C93, 0xA647, 0xA7BD, 0x1DF1A],
    ['IS', 0xA76C],
    ['is', 0xA76D],
    ['J', 0x0248, 0x037F, 0x0408, 0x13AB, 0x148D, 0x1D0A, 0xA4D9, 0xA7B2, 0xAB7B],
    ['j', 0x0237, 0x0249, 0x025F, 0x0284, 0x029D, 0x03F3, 0x0458, 0x0575],
    ['K', 0x0198, 0x039A, 0x041A, 0x049A, 0x049C, 0x049E, 0x04A0, 0x04C3, 0x13E6, 0x1D0B,
     0x20AD, 0x2C69, 0x2C94, 0xA4D7, 0xA4D8, 0xA740, 0xA742, 0xA744, 0xA7A2, 0xA7B0, 0xABB6,
     0x1033A, 0x1DF10],
    ['k', 0x0138, 0x0199, 0x029E, 0x03BA, 0x043A, 0x049B, 0x049D, 0x049F, 0x04A1, 0x04C4,
     0x1D84, 0x2C6A, 0x2C95, 0xA741, 0xA743, 0xA745, 0xA7A3, 0x1DF03],
    ['L', 0x0141, 0x023D, 0x029F, 0x053C, 0x13DE, 0x14AA, 0x1D0C, 0x20A4, 0x2142, 0x2143,
     0x2C60, 0x2C62, 0xA4E1, 0xA4F6, 0xA746, 0xA748, 0xA780, 0xA7AD, 0xABAE, 0x1DF04],
    ['l', 0x0142, 0x019A, 0x01C0, 0x0234, 0x026B, 0x026C, 0x026D, 0x04CF, 0x05D5, 0x05DF,
     0x1D85, 0x2C61, 0xA747, 0xA749, 0xA772, 0xA781, 0xA78E, 0xAB37, 0xAB38, 0xAB39, 0x1DF11,
     0x1DF13, 0x1DF26],
    ['LL', 0x1EFA],
    ['ll', 0x01C1, 0x1EFB],
    ['ls', 0x02AA],
    ['lz', 0x02AB],
    ['M', 0x039C, 0x03FA, 0x041C, 0x04CD, 0x13B7, 0x15F0, 0x163B, 0x16D6, 0x16D7, 0x1D0D,
     0x2C6E, 0x2C98, 0xA4DF, 0xA7FF, 0xAB87, 0x1030C, 0x1033C],
    ['m', 0x0271, 0x028D, 0x03BC, 0x03FB, 0x043C, 0x04CE, 0x10DD, 0x1D6F, 0x1D86, 0x20A5,
     0x2C99, 0xA773, 0xAB3A],
    ['N', 0x014A, 0x019D, 0x0220, 0x0274, 0x039D, 0x0418, 0x144E, 0x1D0E, 0x20A6, 0x2C9A,
     0xA4E0, 0xA790, 0xA7A4, 0x1033D],
    ['n', 0x014B, 0x019E, 0x0235, 0x0272, 0x0273, 0x03B7, 0x043F, 0x0578, 0x057C, 0x05D7,
     0x1D28, 0x1D70, 0x1D87, 0x2229, 0x22C2, 0x2C9B, 0xA774, 0xA791, 0xA7A5, 0xAB3B, 0xAB3C,
     0x1DF14, 0x1DF27],
    ['O', 0x00D8, 0x019F, 0x0298, 0x0398, 0x039F, 0x03A9, 0x041E, 0x0472, 0x047A, 0x04E8,
     0x0555, 0x07C0, 0x1D0F, 0x2205, 0x2295, 0x2296, 0x2297, 0x2298, 0x2299, 0x229A, 0x229B,
     0x229D, 0x2300, 0x25C9, 0x25CB, 0x25CE, 0x25CF, 0x25EF, 0x2609, 0x26AA, 0x274D, 0x29BF,
     0x2B24, 0x2B55, 0x2B58, 0x2C90, 0x2C9E, 0x2D54, 0x2D59, 0x3007, 0xA4F3, 0xA668, 0xA66A,
     0xA66C, 0xA66E, 0xA698, 0xA69A, 0xA74A, 0xA74C, 0xA7C0, 0x1030F],
    ['o', 0x00F8, 0x0275, 0x03B8, 0x03BF, 0x03C3, 0x043E, 0x0473, 0x047B, 0x04E9, 0x0585,
     0x05DD, 0x05E1, 0x0647, 0x0665, 0x06D5, 0x06F5, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66,
     0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0E50, 0x0ED0, 0x101D, 0x1040, 0x17E0, 0x1810, 0x1D11,
     0x1D13, 0x25E6, 0x26AC, 0x2C7A, 0x2C91, 0x2C9F, 0xA669, 0xA66B, 0xA66D, 0xA699, 0xA69B,
     0xA74B, 0xA74D, 0xA7C1, 0xAB3D, 0xAB3E, 0x1DF1B],
    ['OE', 0x0152, 0x0276],
    ['oe', 0x0153],
    ['OO', 0xA74E],
    ['oo', 0xA74F],
    ['P', 0x01A4, 0x01F7, 0x03A1, 0x03F7, 0x0420, 0x048E, 0x13E2, 0x146D, 0x16A6, 0x1D18,
     0x1D29, 0x20B1, 0x20BD, 0x2C63, 0x2CA2, 0xA4D1, 0xA750, 0xA752, 0xA754, 0xA764, 0xA766,
     0xA7FC, 0xABB2],
    ['p', 0x01A5, 0x01BF, 0x03C1, 0x03F8, 0x03FC, 0x0440, 0x048F, 0x0584, 0x1577, 0x1D71,
     0x1D7D, 0x1D88, 0x2CA3, 0xA751, 0xA753, 0xA755, 0xA765, 0xA767],
    ['Q', 0x024A, 0x03D8, 0x051A, 0x146B, 0xA756, 0xA758, 0xA7AF],
    ['q', 0x024B, 0x02A0, 0x03D9, 0x051B, 0x0563, 0x0566, 0xA757, 0xA759],
    ['qp', 0x0239],
    ['R', 0x01A6, 0x024C, 0x0280, 0x042F, 0x13A1, 0x13D2, 0x1587, 0x16B1, 0x1D19, 0x1D1A,
     0x211E, 0x211F, 0x2C64, 0xA4E3, 0xA75A, 0xA776, 0xA782, 0xA7A6, 0xAB46, 0xAB71, 0xABA2,
     0x10342],
    ['r', 0x024D, 0x0279, 0x027C, 0x027D, 0x027E, 0x044F, 0x1D72, 0x1D73, 0x1D89, 0x2C79,
     0xA75B, 0xA775, 0xA783, 0xA7A7, 0xAB45, 0xAB47, 0xAB49, 0xAB4B, 0xAB4C, 0x1DF16,
     0x1DF28],
    ['rr', 0xAB48],
    ['S', 0x03A3, 0x0405, 0x054F, 0x10BD, 0x13D5, 0x13DA, 0x1515, 0x16CA, 0x16CB, 0x20B4,
     0x2C7E, 0xA4E2, 0xA644, 0xA731, 0xA784, 0xA7A8, 0xA7C5, 0xA7C9, 0xA7D6, 0xA7D8, 0xABA5,
     0xABAA, 0x10343],
    ['s', 0x023F, 0x0282, 0x0283, 0x03C2, 0x03DB, 0x0455, 0x1D74, 0x1D8A, 0x1E9C, 0x1E9D,
     0xA645, 0xA785, 0xA7A9, 0xA7CA, 0xA7D7, 0xA7D9, 0x1DF1E, 0x1DF29],
    ['SS', 0x1E9E],
    ['ss', 0x00DF],
    ['T', 0x0166, 0x01AC, 0x01AE, 0x023E, 0x03A4, 0x0422, 0x04AC, 0x13A2, 0x16CF, 0x1D1B,
     0x20AE, 0x20B8, 0x2CA6, 0xA4D4, 0xA786, 0xA7B1, 0xAB72, 0x10315, 0x10344],
    ['t', 0x0167, 0x01AB, 0x01AD, 0x0236, 0x0287, 0x0288, 0x03C4, 0x0442, 0x04AD, 0x1D75,
     0x2C66, 0x2CA7, 0xA777, 0xA787, 0x1DF09, 0x1DF2A],
    ['tc', 0x02A8],
    ['th', 0x1D7A],
    ['ts', 0x02A6, 0x02A7],
    ['TZ', 0xA728],
    ['tz', 0xA729],
    ['U', 0x01B1, 0x0244, 0x0426, 0x054D, 0x144C, 0x1D1C, 0x1D7E, 0x2127, 0x2210, 0x222A,
     0x22C3, 0xA4F4, 0xA7B8, 0xA7BE],
    ['u', 0x0289, 0x028A, 0x03C5, 0x0446, 0x057D, 0x1D1D, 0x1D7F, 0x1D99, 0xA7B9, 0xA7BF,
     0xAB4E, 0xAB52],
    ['ue', 0x1D6B],
    ['ui', 0xAB50],
    ['uo', 0xAB63],
    ['V', 0x01B2, 0x0474, 0x13D9, 0x1401, 0x142F, 0x1D20, 0x2123, 0x2207, 0x221A, 0x2228,
     0x22BB, 0x22C1, 0xA4E6, 0xA75E, 0xA768, 0xABA9],
    ['v', 0x028B, 0x03BD, 0x0475, 0x1D8C, 0x2C71, 0x2C74, 0xA75F, 0xA769],
    ['VY', 0xA760],
    ['vy', 0xA761],
    ['W', 0x019C, 0x0428, 0x0429, 0x0460, 0x051C, 0x13B3, 0x13D4, 0x15EF, 0x1D21, 0x20A9,
     0x2C72, 0x2CB0, 0xA4EA, 0xA7B6, 0xA7C2, 0xA7FA, 0xA7FD, 0xAB83, 0xABA4],
    ['w', 0x026F, 0x0270, 0x03C9, 0x0448, 0x0449, 0x0461, 0x051D, 0x0561, 0x05E9, 0x2C73,
     0x2CB1, 0xA7B7, 0xA7C3],
    ['X', 0x03A7, 0x0425, 0x04B2, 0x04FC, 0x04FE, 0x1541, 0x166D, 0x16B7, 0x2573, 0x2715,
     0x2716, 0x2717, 0x2718, 0x274C, 0x2CAC, 0xA4EB, 0xA7B3, 0x10317, 0x10347],
    ['x', 0x00D7, 0x03C7, 0x0445, 0x04B3, 0x04FD, 0x04FF, 0x1D8D, 0x2A2F, 0x2CAD, 0xAB53,
     0xAB54, 0xAB55, 0xAB56, 0xAB57, 0xAB58, 0xAB59],
    ['Y', 0x0194, 0x01B3, 0x024E, 0x028F, 0x03A5, 0x0423, 0x04AE, 0x04B0, 0x13A9, 0x13BD,
     0x15BB, 0x1EFE, 0x2144, 0x22CE, 0x2CA8, 0xA4EC, 0xAB79, 0xAB8D],
    ['y', 0x01B4, 0x024F, 0x0263, 0x0264, 0x03B3, 0x0443, 0x04AF, 0x04B1, 0x10E7, 0x1EFF,
     0x2CA9, 0xAB5A],
    ['Z', 0x01B5, 0x01B7, 0x0224, 0x0396, 0x13C3, 0x1614, 0x1D22, 0x1D23, 0x2C6B, 0x2C7F,
     0x2C8C, 0xA4DC, 0xA7C6, 0xAB93],
    ['z', 0x01B6, 0x01BA, 0x0225, 0x0240, 0x0290, 0x0291, 0x0292, 0x0293, 0x03B6, 0x1D76,
     0x1D8E, 0x1D9A, 0x2125, 0x2C6C, 0x2C8D, 0x1DF18]
  ];

  /* ANTES do NFKD: [primeiro, último, alvo do primeiro]. Apóstrofos
   * tipográficos viram o reto; e o que o Unicode 16/17 decompõe mas o Python
   * do servidor ainda não conhece é trocado AQUI, igual nos dois lados. */
  var PRE_FAIXAS = [
    [0x00B4, 0x00B4, 0x27],
    [0x02BB, 0x02BC, 0x27],
    [0x2018, 0x2019, 0x27],
    [0x2032, 0x2032, 0x27],
    [0xA7F1, 0xA7F1, 0x53],
    [0x1CCD6, 0x1CCEF, 0x41],
    [0x1CCF0, 0x1CCF9, 0x30],
    [0x1F150, 0x1F169, 0x41],
    [0x1F170, 0x1F189, 0x41],
    [0x1F1E6, 0x1F1FF, 0x41]
  ];
  var PRE_PARES = [
    [0x105C9, [0x105D2, 0x0307]], [0x105E4, [0x105DA, 0x0307]],
    [0x11383, [0x11382, 0x113C9]], [0x11385, [0x11384, 0x113BB]],
    [0x1138E, [0x1138B, 0x113C2]], [0x11391, [0x11390, 0x113C9]],
    [0x113C5, [0x113C2, 0x113C2]], [0x113C7, [0x113C2, 0x113B8]],
    [0x113C8, [0x113C2, 0x113C9]], [0x16121, [0x1611E, 0x1611E]],
    [0x16122, [0x1611E, 0x16129]], [0x16123, [0x1611E, 0x1611F]],
    [0x16124, [0x16129, 0x1611F]], [0x16125, [0x1611E, 0x16120]],
    [0x16126, [0x1611E, 0x1611E, 0x1611F]], [0x16127, [0x1611E, 0x16129, 0x1611F]],
    [0x16128, [0x1611E, 0x1611E, 0x16120]], [0x16D68, [0x16D67, 0x16D67]],
    [0x16D69, [0x16D63, 0x16D67]], [0x16D6A, [0x16D63, 0x16D67, 0x16D67]]
  ];

  /* Confusáveis (leetspeak e a velha troca de l por i) — viram uma LEITURA à
   * parte, e não o esqueleto oficial: senão "GM1" perderia o dígito que o
   * denuncia. Na leitura, a tabela passa no nome E na lista de reservadas. */
  var LEET = {
    '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g',
    '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i',
    '+': 't', '(': 'c', '{': 'c', '<': 'c', '€': 'e', '£': 'l', '¢': 'c',
    '¥': 'y', '¡': 'i', '§': 's', 'l': 'i'
  };
  // o leet de barrinhas (os mais compridos primeiro)
  var ARTE = [
    ['|\\/|', 'm'], ['/\\/\\', 'm'], ['\\/\\/', 'w'], ['|\\|', 'n'], ['/\\/', 'n'],
    ['|-|', 'h'], ['|_|', 'u'], ['\\/', 'v'], ['/\\', 'a'], ['|)', 'd'], ['|3', 'b'],
    ['|2', 'r'], ['|<', 'k'], ['|>', 'p'], ['()', 'o'], ['[]', 'o']
  ];

  /* ---- as reservadas ------------------------------------------------------
   * ORDEM IMPORTA: os dois lados varrem as listas na mesma ordem para
   * devolverem exatamente a mesma palavra quando mais de uma casa. */
  var DENTRO = [                  // LONGAS: pegam também DENTRO de outra palavra
    'admin',                      // admins, administrador(a), administrator,
                                  // administração, administración, sysadmin
    'adimin', 'admim', 'admistr',
    'moderador', 'moderator', 'moderac', 'moderation',
    'gamemaster', 'webmaster',
    'staff', 'suporte', 'support', 'soporte', 'surporte',
    'desenvolvedor', 'developer', 'desarrollador',
    'mestredofundo', 'helpdesk', 'superuser', 'superusuario',
    'communitymanager', 'equipetecnica', 'equipotecnico'
  ];
  var PALAVRA = [                 // CURTAS/ambíguas: só como palavra inteira
    'gm', 'adm', 'mod', 'dev', 'bot', 'cm', 'root', 'sysop',
    'mestre', 'mestra', 'master',
    'sistema', 'sistem', 'system', 'systema', 'servidor', 'server',
    'oficial', 'official', 'offical', 'oficiais',
    'dono', 'owner', 'dueno', 'duena',
    'soterra', 'sotera', 'staf', 'suport', 'atendimento'
  ];
  var SILABA = ['gm', 'adm', 'mod'];   // a regra da sílaba (seção 2 da política)
  var VOGAIS = 'aeiouy';
  var CONTEXTO = ['team', 'time', 'equipe', 'br'];   // emendam com uma reservada
  var CARGOS = [
    'criador', 'criadora', 'creador', 'creadora', 'dono', 'dona', 'dueno', 'duena',
    'equipe', 'equipo', 'time', 'team', 'staff', 'proprietario', 'proprietaria',
    'propietario', 'propietaria', 'programador', 'programadora', 'gerente',
    'diretor', 'diretora', 'director', 'directora', 'mestre', 'mestra', 'maestro',
    'maestra', 'master', 'dev', 'desenvolvedor', 'desenvolvedora', 'desarrollador',
    'desarrolladora', 'administrador', 'administradora', 'moderador', 'moderadora',
    'suporte', 'soporte', 'support', 'atendimento', 'owner', 'admin', 'mod', 'gm'
  ];
  var LIGAS = ['', 'do', 'da', 'de', 'del', 'dos', 'das', 'of', 'ofthe', 'the'];
  var EQUIPE = ['equipe', 'equipo', 'equipes', 'equipos'];   // a Equipe como voz (03/10)
  var COM_EQUIPE = [              // o que pode vir junto dela sem desarmar
    'a', 'o', 'as', 'os', 'la', 'el', 'los', 'las', 'the', 'da', 'do', 'de', 'del',
    'das', 'dos', 'correio', 'correo', 'carta', 'cartas', 'mensagem', 'mensaje',
    'aviso', 'avisos', 'br', 'brasil', 'oficial', 'official'
  ];
  var OBJETOS = ['jogo', 'juego', 'game', 'servidor', 'server', 'soterra'];
  var CONECTORES = [
    'do', 'da', 'dos', 'das', 'de', 'di', 'du', 'no', 'na', 'nos', 'nas', 'em',
    'um', 'uns', 'uma', 'umas', 'el', 'la', 'las', 'los', 'lo', 'del', 'al', 'en',
    'un', 'the', 'of', 'and', 'in', 'on', 'at', 'to', 'le', 'les', 'van', 'von',
    'der', 'des'
  ];
  var NEGA = 'sem';
  var PLURAL_ES = 'rl';           // "-es" só depois destas (servidores, oficiales)
  var EXCECOES = ['badminton', 'stafford', 'flagstaff', 'mcmaster', 'macmaster', 'duenas'];

  var CURINGA = '\ue000';         // a letra desconhecida, dentro do esqueleto

  var PERMITIDOS_EXTRA = " '_-\u2019\u2018\u00b4\u02bc";   // e os apóstrofos tipográficos
  /* ACENTOS e ESPACOS ficam em \u de propósito: o gêmeo em Python tem a
   * MESMA lista, e caractere invisível copiado à mão é como as duas se
   * separam. */
  var ACENTOS = '\u00e1\u00e0\u00e2\u00e3\u00e4\u00e9\u00e8\u00ea\u00eb' +   // a e minusculas
                '\u00ed\u00ec\u00ee\u00ef\u00f3\u00f2\u00f4\u00f5\u00f6' +   // i o minusculas
                '\u00fa\u00f9\u00fb\u00fc\u00e7\u00f1\u00fd' +   // u c n y
                '\u00c1\u00c0\u00c2\u00c3\u00c4\u00c9\u00c8\u00ca\u00cb' +   // A E maiusculas
                '\u00cd\u00cc\u00ce\u00cf\u00d3\u00d2\u00d4\u00d5\u00d6' +   // I O maiusculas
                '\u00da\u00d9\u00db\u00dc\u00c7\u00d1\u00dd';   // U C N Y
  var ORDINAIS = '\u00aa\u00ba';  // ª º (Mª Clara)
  var ESPACOS = ' \t\n\r\f\v\x1c\x1d\x1e\x1f\u00a0\u1680' +
                '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a' +
                '\u200b\u200c\u200d\u2028\u2029\u202f\u205f\u3000\ufeff';

  var MOTIVO_VAZIO = 'diga um nome';
  var MOTIVO_PONTAS = 'sem espaço no começo nem no fim';
  var MOTIVO_CARACTERES = 'use só letras, números, espaço, apóstrofo, _ ou -';
  var MOTIVO_LETRA = 'o nome precisa ter pelo menos uma letra';
  var MOTIVO_RESERVADO = 'esse nome é reservado à equipe do jogo';
  N.MOTIVO_RESERVADO = MOTIVO_RESERVADO;   // a guilda e a HUD falam a mesma língua

  // ---------------------------------------------------------------- miudezas
  /* um ponto de código em texto (o JavaScript anda de 16 em 16 bits) */
  function chr(cp) {
    if (cp < 0x10000) return String.fromCharCode(cp);
    cp -= 0x10000;
    return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
  }
  /* os pontos de código de um texto — o par substituto vira UM ponto */
  function pontos(s) {
    var fora = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) {
          fora.push((c - 0xD800) * 0x400 + (d - 0xDC00) + 0x10000);
          i++;
          continue;
        }
      }
      fora.push(c);
    }
    return fora;
  }
  /* busca binária nas faixas planas [a0, b0, a1, b1, …] */
  function na(cp, plana) {
    var lo = 0, hi = (plana.length >> 1) - 1;
    while (lo <= hi) {
      var meio = (lo + hi) >> 1;
      if (cp < plana[2 * meio]) hi = meio - 1;
      else if (cp > plana[2 * meio + 1]) lo = meio + 1;
      else return true;
    }
    return false;
  }
  function eDigito(ch) { return ch >= '0' && ch <= '9'; }
  function eMaiuscula(ch) { return ch >= 'A' && ch <= 'Z'; }
  function eMinuscula(ch) { return ch >= 'a' && ch <= 'z'; }
  function eAlnum(ch) { return eDigito(ch) || eMaiuscula(ch) || eMinuscula(ch); }
  /* o que entra numa palavra: ASCII alfanumérico ou o curinga */
  function eLetra(ch) { return eAlnum(ch) || ch === CURINGA; }
  function tem(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  /* minúscula SÓ do ASCII — o resto do mundo já virou ASCII no esqueleto */
  function baixa(s) {
    var fora = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      fora += eMaiuscula(ch) ? String.fromCharCode(s.charCodeAt(i) + 32) : ch;
    }
    return fora;
  }
  function texto(nome) {
    if (typeof nome === 'string') return nome;
    if (nome === null || nome === undefined) return '';
    return String(nome);
  }
  /* tira os espaços das pontas — a MESMA lista dos dois lados (o trim do
   * JavaScript e o strip do Python não concordam sobre BOM e afins) */
  function apara(s) {
    var i = 0, j = s.length;
    while (i < j && ESPACOS.indexOf(s.charAt(i)) >= 0) i++;
    while (j > i && ESPACOS.indexOf(s.charAt(j - 1)) >= 0) j--;
    return s.slice(i, j);
  }

  // ---------------------------------------------------- as tabelas, prontas
  var HOMOGLIFOS = {}, PRE = {};
  (function () {
    var g, i, cp, t;
    for (g = 0; g < GRUPOS.length; g++) {
      for (i = 1; i < GRUPOS[g].length; i++) HOMOGLIFOS[GRUPOS[g][i]] = GRUPOS[g][0];
    }
    for (g = 0; g < PRE_FAIXAS.length; g++) {
      for (cp = PRE_FAIXAS[g][0]; cp <= PRE_FAIXAS[g][1]; cp++) {
        PRE[cp] = chr(PRE_FAIXAS[g][2] + cp - PRE_FAIXAS[g][0]);
      }
    }
    for (g = 0; g < PRE_PARES.length; g++) {
      t = '';
      for (i = 0; i < PRE_PARES[g][1].length; i++) t += chr(PRE_PARES[g][1][i]);
      PRE[PRE_PARES[g][0]] = t;
    }
  })();

  // ------------------------------------------------------------- o esqueleto
  function pre(s) {
    var cps = pontos(s), fora = '';
    for (var i = 0; i < cps.length; i++) {
      fora += tem(PRE, cps[i]) ? PRE[cps[i]] : chr(cps[i]);
    }
    return fora;
  }
  function nfkd(s) {
    if (typeof s.normalize === 'function') {
      try { return s.normalize('NFKD'); } catch (e) {}
    }
    /* Navegador sem normalize (não existe entre os que rodam o jogo, mas o
     * arquivo tem de sobreviver a ele): a largura cheia é o disfarce mais
     * comum e sai na mão; o resto cai no conjunto de caracteres. */
    var fora = '';
    for (var i = 0; i < s.length; i++) {
      var cp = s.charCodeAt(i);
      if (cp >= 0xFF21 && cp <= 0xFF3A) fora += String.fromCharCode(cp - 0xFEE0);
      else if (cp >= 0xFF41 && cp <= 0xFF5A) fora += String.fromCharCode(cp - 0xFEE0);
      else if (cp >= 0xFF10 && cp <= 0xFF19) fora += String.fromCharCode(cp - 0xFEE0);
      else fora += s.charAt(i);
    }
    return fora;
  }

  /* PRE + NFKD; marcas e invisíveis fora; homóglifos virando latim; letra de
   * outra escrita virando CURINGA. A CAIXA é preservada (a troca de caixa
   * separa palavras depois). (NFKD e não NFKC+NFD: dá no mesmo e é uma volta
   * só.) */
  function cru(nome) {
    var cps = pontos(nfkd(pre(texto(nome))));
    var fora = '';
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (tem(HOMOGLIFOS, cp)) fora += HOMOGLIFOS[cp];
      else if (cp < 0x80) fora += String.fromCharCode(cp);
      else if (na(cp, SOME)) continue;
      else if (!na(cp, SIMBOLOS)) fora += CURINGA;
      else fora += chr(cp);
    }
    return fora;
  }

  /* O esqueleto de comparação: minúsculo, só [a-z0-9], o resto vira um
   * espaço só. normaliza('[GM] João') === 'gm joao'. */
  N.normaliza = function (nome) {
    var s = baixa(cru(nome));
    var fora = '', espaco = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (eAlnum(ch)) { fora += ch; espaco = false; }
      else if (!espaco) { fora += ' '; espaco = true; }
    }
    var a = 0, b = fora.length;
    while (a < b && fora.charAt(a) === ' ') a++;
    while (b > a && fora.charAt(b - 1) === ' ') b--;
    return fora.slice(a, b);
  };

  // ---------------------------------------------------------------- leituras
  var RLO = 0x202E, PDF = 0x202C, PDI = 0x2069;
  var ABRE = [0x202A, 0x202B, 0x202D, 0x2066, 0x2067, 0x2068];

  /* O que APARECE na tela quando tem override da direita para a esquerda
   * (U+202E): o trecho vem ao contrário até o fecho (U+202C/U+2069) ou o fim.
   * Um modelo pequeno do algoritmo bidi — só o override inverte letra latina,
   * e é só ele que interessa aqui. */
  function exibe(s) {
    if (s.indexOf(chr(RLO)) < 0) return s;
    var cps = pontos(s), pilha = [[false, []]];
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (cp === RLO) pilha.push([true, []]);
      else if (ABRE.indexOf(cp) >= 0) pilha.push([false, []]);
      else if (cp === PDF || cp === PDI) { if (pilha.length > 1) fecha(pilha); }
      else pilha[pilha.length - 1][1].push(chr(cp));
    }
    while (pilha.length > 1) fecha(pilha);
    return pilha[0][1].join('');
  }
  function fecha(pilha) {
    var topo = pilha.pop();
    if (topo[0]) topo[1].reverse();
    pilha[pilha.length - 1][1].push(topo[1].join(''));
  }

  /* 'ô' no fim da palavra, depois de letra, lido como 'or' (Moderadô). */
  function caipira(s) {
    var fora = '', n = s.length, i = 0;
    while (i < n) {
      var ch = s.charAt(i), largura = 0;
      if (ch === '\u00f4' || ch === '\u00d4') largura = 1;
      else if ((ch === 'o' || ch === 'O') && i + 1 < n && s.charAt(i + 1) === '\u0302') largura = 2;
      if (largura && i > 0 && eAlnum(s.charAt(i - 1))) {
        var depois = (i + largura < n) ? s.charAt(i + largura) : '';
        if (depois === '' || !(eAlnum(depois) || ACENTOS.indexOf(depois) >= 0)) {
          fora += (ch === '\u00d4' || ch === 'O') ? 'OR' : 'or';
          i += largura;
          continue;
        }
      }
      fora += ch;
      i++;
    }
    return fora;
  }

  /* a pontuação de DENTRO da palavra (a abreviatura G.M., a elisão D'Ávila):
   * na leitura colada ela some junto com o que não é ASCII */
  var COLA = ".'";

  /* A leitura COLADA: espaço fora do ASCII sai antes de normalizar, e depois
   * do esqueleto sai tudo que não é ASCII nem curinga (emoji, símbolo,
   * espaço fino), e mais o ponto e o apóstrofo — o que sobra gruda
   * ("superg.m" = supergm, "oG.Mzinho" = oGMzinho). */
  function colado(s) {
    var t = '', i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (ch === ' ' || ESPACOS.indexOf(ch) < 0) t += ch;
    }
    var c = cru(t), fora = '';
    for (i = 0; i < c.length; i++) {
      ch = c.charAt(i);
      if ((c.charCodeAt(i) < 0x80 && COLA.indexOf(ch) < 0) || ch === CURINGA) fora += ch;
    }
    return fora;
  }

  /* tira o enfeite xX…Xx das pontas de cada palavra (xXGMXx -> GM) */
  function desenfeita(t) {
    var fora = '', n = t.length, i = 0;
    while (i < n) {
      if (!eLetra(t.charAt(i))) { fora += t.charAt(i); i++; continue; }
      var j = i;
      while (j < n && eLetra(t.charAt(j))) j++;
      var a = i, b = j;
      while (a < b && (t.charAt(a) === 'x' || t.charAt(a) === 'X')) a++;
      while (b > a && (t.charAt(b - 1) === 'x' || t.charAt(b - 1) === 'X')) b--;
      fora += (a < b) ? t.slice(a, b) : t.slice(i, j);
      i = j;
    }
    return fora;
  }

  /* vizinho que faz um número ser parte da palavra (e não número solto) */
  function gruda(ch) {
    return ch !== '' && (eLetra(ch) || tem(LEET, ch) || '/\\|()[]<>{}'.indexOf(ch) >= 0);
  }

  /* A leitura dos CONFUSÁVEIS: minúscula e cada glifo trocado pelo que ele
   * finge ser (4->a, 0->o, @->a, l->i, |\/|->m…). Vale para o nome E para a
   * lista de reservadas. Número SOLTO (sem letra encostada) fica número:
   * "Mago_807" não é "bot". Com cauda === false, o número que FECHA a
   * palavra também fica número ("deV2", "doNo2") — é uma segunda leitura,
   * porque "D0n0" precisa do contrário. */
  function confuso(s, cauda) {
    var b = baixa(s), fora = '', n = b.length, i = 0, j, k, a;
    var comCauda = (cauda !== false);
    while (i < n) {
      var ch = b.charAt(i);
      if (eDigito(ch)) {
        j = i;
        while (j < n && eDigito(b.charAt(j))) j++;
        var antes = (i > 0) ? b.charAt(i - 1) : '';
        var depois = (j < n) ? b.charAt(j) : '';
        if (!gruda(depois) && (!comCauda || !gruda(antes))) fora += b.slice(i, j);
        else for (k = i; k < j; k++) fora += LEET[b.charAt(k)];
        i = j;
        continue;
      }
      var casou = false;
      for (a = 0; a < ARTE.length; a++) {
        if (b.substr(i, ARTE[a][0].length) === ARTE[a][0]) {
          fora += ARTE[a][1];
          i += ARTE[a][0].length;
          casou = true;
          break;
        }
      }
      if (casou) continue;
      fora += tem(LEET, ch) ? LEET[ch] : ch;
      i++;
    }
    return fora;
  }

  /* apaga as exceções nomeadas (badminton, stafford…) antes de quebrar */
  function mascara(t, excecoes) {
    var b = baixa(t), marca = t.split(''), mexeu = false;
    for (var e = 0; e < excecoes.length; e++) {
      var k = b.indexOf(excecoes[e]);
      while (k >= 0) {
        for (var x = k; x < k + excecoes[e].length; x++) marca[x] = ' ';
        mexeu = true;
        k = b.indexOf(excecoes[e], k + excecoes[e].length);
      }
    }
    return mexeu ? marca.join('') : t;
  }

  /* As leituras do mesmo nome: o texto como veio, o que aparece na tela
   * (RLO), a fala caipira; cada um no esqueleto e na versão colada; cada um
   * com e sem o enfeite xX…Xx. */
  function leituras(nome) {
    var s = texto(nome), brutos = [s], i, j, k;
    var e = exibe(s);
    if (e !== s) brutos.push(e);
    var n0 = brutos.length;
    for (i = 0; i < n0; i++) {
      var c = caipira(brutos[i]);
      if (brutos.indexOf(c) < 0) brutos.push(c);
    }
    var fora = [];
    for (i = 0; i < brutos.length; i++) {
      var ps = [cru(brutos[i]), colado(brutos[i])];
      for (j = 0; j < 2; j++) {
        var vs = [ps[j], desenfeita(ps[j])];
        for (k = 0; k < 2; k++) {
          if (fora.indexOf(vs[k]) < 0) fora.push(vs[k]);
        }
      }
    }
    return fora;
  }

  // ------------------------------------------------------------ a comparação
  /* A palavra `w` cabe em `t` a partir de `i` deixando CADA letra dela se
   * repetir à vontade? É assim que Aaadmin, GGMM e Sttaff caem sem que
   * "insuportável" ou "suportar" virem vítimas de um colapso cego: quem
   * estica é a palavra reservada, letra por letra, não o dicionário.
   * Um CURINGA pode ocupar UMA letra, e só em reservada de 3 letras ou mais
   * (sobram pelo menos duas letras de verdade). */
  function estica(t, w, i, ateOFim) {
    var n = t.length, m = w.length, k = 0, curinga = m >= 3;
    while (k < m) {
      if (i >= n) return -1;
      var c = t.charAt(i);
      if (c === w.charAt(k)) {
        i++;
        if (k + 1 >= m || w.charAt(k + 1) !== w.charAt(k)) {
          while (i < n && t.charAt(i) === w.charAt(k)) i++;
        }
      } else if (c === CURINGA && curinga) {
        curinga = false;
        i++;
      } else {
        return -1;
      }
      k++;
    }
    if (ateOFim && i !== n) return -1;
    return i;
  }
  function contem(t, w) {
    for (var s = 0; s < t.length; s++) {
      if (estica(t, w, s, false) >= 0) return true;
    }
    return false;
  }
  /* w dentro de t, no fim ou antes de consoante (SUPERGM, gmjoao) */
  function silaba(t, w) {
    var n = t.length;
    for (var s = 0; s < n; s++) {
      var e = estica(t, w, s, false);
      if (e >= 0 && (e >= n || VOGAIS.indexOf(t.charAt(e)) < 0)) return true;
    }
    return false;
  }

  /* Quebra em palavras minúsculas: separador, troca de caixa e a fronteira
   * letra/dígito. 'GMJoao' -> ['gm','joao']; 'gm2' -> ['gm','2'].
   *
   * Devolve {p: palavras, e: extras}. Os EXTRAS são as corridas de maiúsculas
   * inteiras, guardadas à parte porque as duas leituras do camelo brigam: em
   * "ADMINJoao" a última maiúscula é o começo da palavra seguinte, mas em
   * "oGMzinho" a corrida inteira ("GM") é que é a palavra. O curinga não tem
   * caixa: gruda dos dois lados. */
  function quebra(s) {
    var fora = [], extras = [], buf = '';
    function solta() {
      if (buf) { fora.push(baixa(buf)); buf = ''; }
    }
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (!eLetra(ch)) { solta(); continue; }
      if (buf) {
        var u = buf.charAt(buf.length - 1);
        if (eDigito(u) !== eDigito(ch)) {
          solta();
        } else if (eMinuscula(u) && eMaiuscula(ch)) {
          solta();
        } else if (buf.length >= 2 && eMaiuscula(u) &&
                   eMaiuscula(buf.charAt(buf.length - 2)) && eMinuscula(ch)) {
          // ADMINJoao: a última maiúscula abre a palavra seguinte — e a
          // corrida inteira ("ADMINJ", "GM") vai para os extras
          extras.push(baixa(buf));
          var guarda = u;
          buf = buf.slice(0, -1);
          solta();
          buf = guarda;
        }
      }
      buf += ch;
    }
    solta();
    return { p: fora, e: extras };
  }

  /* o próprio e os singulares plausíveis: mods->mod, mestres->mestre,
   * servidores->servidor (o "-es" só depois de r ou l) */
  function singulares(p, L) {
    var fora = [p], n = p.length;
    if (n > 2 && p.charAt(n - 1) === 's') fora.push(p.slice(0, n - 1));
    if (n > 4 && p.slice(n - 2) === 'es' && L.plural_es.indexOf(p.charAt(n - 3)) >= 0) {
      fora.push(p.slice(0, n - 2));
    }
    return fora;
  }
  function inteira(p, lista, L) {
    var cands = singulares(p, L);
    for (var c = 0; c < cands.length; c++) {
      for (var k = 0; k < lista.length; k++) {
        if (estica(cands[c], lista[k], 0, true) >= 0) return k;
      }
    }
    return -1;
  }

  /* a palavra (0, 1, 2…) que contém a posição x */
  function qual(fins, x) {
    var k = 0;
    while (fins[k] <= x) k++;
    return k;
  }

  /* w atravessa a fronteira entre pals[i..j] encostada numa ponta de
   * palavra ("Admi nistrador", "Superad-min") ou com o miolo soletrado
   * ("oa d m i nzinho") — e não "Conrad Minelli", nem "Ana D Minelli". */
  function atravessa(pals, i, j, w) {
    var junta = '', inicios = [], fins = [], pos = 0, k, s, e, a, b;
    for (k = i; k <= j; k++) {
      inicios.push(pos);
      junta += pals[k];
      pos += pals[k].length;
      fins.push(pos);
    }
    for (s = 0; s < junta.length; s++) {
      e = estica(junta, w, s, false);
      if (e < 0) continue;
      a = qual(fins, s);
      b = qual(fins, e - 1);
      if (a === b) continue;
      if (inicios.indexOf(s) >= 0 || fins.indexOf(e) >= 0) return true;
      if (b - a >= 3) {
        var soletrada = true;
        for (k = a + 1; k < b; k++) {
          if (pals[i + k].length !== 1) { soletrada = false; break; }
        }
        if (soletrada) return true;
      }
    }
    return false;
  }

  function cargoEm(t, L, inicios, fins) {
    var n = t.length, s, ci, li, oi, c, lg, o, p, q;
    for (s = 0; s < n; s++) {
      if (inicios !== null && inicios.indexOf(s) < 0) continue;
      for (ci = 0; ci < L.cargos.length; ci++) {
        c = L.cargos[ci];
        if (t.substr(s, c.length) !== c) continue;
        p = s + c.length;
        for (li = 0; li < L.ligas.length; li++) {
          lg = L.ligas[li];
          if (t.substr(p, lg.length) !== lg) continue;
          q = p + lg.length;
          for (oi = 0; oi < L.objetos.length; oi++) {
            o = L.objetos[oi];
            if (t.substr(q, o.length) !== o) continue;
            if (fins !== null && fins.indexOf(q + o.length) < 0) continue;
            return CARGOS[ci] + LIGAS[li] + OBJETOS[oi];
          }
        }
      }
    }
    return null;
  }
  /* o cargo do jogo: "Criador do Jogo", "criadordojogo", "Maestro del Juego"
   * — colado numa palavra só, ou em palavras seguidas (aí encostado nas
   * pontas). */
  function cargo(pals, extras, L) {
    var todas = pals.concat(extras), i, j, r;
    for (i = 0; i < todas.length; i++) {
      r = cargoEm(todas[i], L, null, null);
      if (r) return r;
    }
    var n = pals.length;
    for (i = 0; i < n; i++) {
      var junta = pals[i], inicios = [0], fins = [junta.length];
      for (j = i + 1; j < Math.min(n, i + 6); j++) {
        inicios.push(junta.length);
        junta += pals[j];
        fins.push(junta.length);
        r = cargoEm(junta, L, inicios, fins);
        if (r) return r;
      }
    }
    return null;
  }

  /* p é toda feita de peças (reservadas e contexto), com 2 peças ou mais e
   * pelo menos uma reservada? estado = reservada(0/1)*3 + peças(0/1/2+) */
  function cobre1(p, L) {
    var n = p.length, i, st, t, m, res, k2;
    if (n < 4) return false;
    var chega = [];
    for (i = 0; i <= n; i++) chega.push(0);
    chega[0] = 1;
    for (i = 0; i < n; i++) {
      m = chega[i];
      if (!m) continue;
      for (st = 0; st < 6; st++) {
        if (!((m >> st) & 1)) continue;
        res = Math.floor(st / 3);
        k2 = (st % 3 >= 1) ? 2 : 1;
        for (t = 0; t < L.todas.length; t++) {
          if (p.substr(i, L.todas[t].length) === L.todas[t]) {
            chega[i + L.todas[t].length] |= 1 << (3 + k2);
          }
        }
        for (t = 0; t < L.contexto.length; t++) {
          if (p.substr(i, L.contexto[t].length) === L.contexto[t]) {
            chega[i + L.contexto[t].length] |= 1 << (res * 3 + k2);
          }
        }
      }
    }
    return ((chega[n] >> 5) & 1) === 1;
  }
  function cobre(p, L) {
    var cands = singulares(p, L);
    for (var c = 0; c < cands.length; c++) {
      if (cobre1(cands[c], L)) {
        for (var k = 0; k < L.todas.length; k++) {
          if (cands[c].indexOf(L.todas[k]) >= 0) return L.o_todas[k];
        }
      }
    }
    return null;
  }

  /* a Equipe como voz: o nome inteiro (as palavras emendadas) é feito só de
   * EQUIPE e COM_EQUIPE, com uma EQUIPE pelo menos — "A Equipe", "Correio da
   * Equipe", "EquipeBR". Bit 1: chegou aqui; bit 2: já passou pela Equipe. */
  function vozEquipe(pals, L) {
    var p = pals.join(''), n = p.length, i, t, m, k;
    if (n === 0) return null;
    var chega = [];
    for (i = 0; i <= n; i++) chega.push(0);
    chega[0] = 1;
    for (i = 0; i < n; i++) {
      m = chega[i];
      if (!m) continue;
      for (t = 0; t < L.equipe.length; t++) {
        if (p.substr(i, L.equipe[t].length) === L.equipe[t]) chega[i + L.equipe[t].length] |= 2;
      }
      for (t = 0; t < L.com_equipe.length; t++) {
        if (p.substr(i, L.com_equipe[t].length) === L.com_equipe[t]) chega[i + L.com_equipe[t].length] |= m;
      }
    }
    if (!(chega[n] & 2)) return null;
    for (k = 0; k < L.equipe.length; k++) {
      if (p.indexOf(L.equipe[k]) >= 0) return EQUIPE[k];
    }
    return null;
  }

  /* A palavra reservada (original) que casou numa leitura, ou null. */
  function bate(q, L) {
    var pals = q.p, extras = q.e, juntas = pals.concat(extras);
    var dentro = L.dentro, palavra = L.palavra, sil = L.silaba;
    var i, j, k, p, r;
    // 1) LONGA dentro de uma palavra (xXadminXx)
    for (i = 0; i < juntas.length; i++) {
      for (k = 0; k < dentro.length; k++) {
        if (contem(juntas[i], dentro[k])) return DENTRO[k];
      }
    }
    // 2) a regra da sílaba (SUPERGM, gmjoao, ADMJOAO)
    for (i = 0; i < juntas.length; i++) {
      for (k = 0; k < sil.length; k++) {
        if (silaba(juntas[i], sil[k])) return SILABA[k];
      }
    }
    // 3) CURTA como palavra inteira — "sem" logo antes desarma
    for (i = 0; i < pals.length; i++) {
      if (i > 0 && pals[i - 1] === L.sem) continue;
      k = inteira(pals[i], palavra, L);
      if (k >= 0) return PALAVRA[k];
    }
    for (i = 0; i < extras.length; i++) {
      k = inteira(extras[i], palavra, L);
      if (k >= 0) return PALAVRA[k];
    }
    // 4) palavras seguidas: a LONGA atravessando, a CURTA soletrada
    var n = pals.length;
    for (i = 0; i < n; i++) {
      var junta = pals[i];
      var soLetras = pals[i].length === 1;
      var conector = L.conectores.indexOf(pals[i]) >= 0;
      for (j = i + 1; j < n; j++) {
        if (junta.length + pals[j].length > 40) break;
        junta += pals[j];
        soLetras = soLetras && pals[j].length === 1;
        conector = conector || L.conectores.indexOf(pals[j]) >= 0;
        for (k = 0; k < dentro.length; k++) {
          if (atravessa(pals, i, j, dentro[k])) return DENTRO[k];
        }
        if (soLetras || !conector) {
          k = inteira(junta, palavra, L);
          if (k >= 0) return PALAVRA[k];
        }
      }
    }
    // 5) o cargo do jogo
    r = cargo(pals, extras, L);
    if (r) return r;
    // 6) palavra feita de reservadas emendadas (gmadmin, devteam, soterrabr)
    for (i = 0; i < juntas.length; i++) {
      r = cobre(juntas[i], L);
      if (r) return r;
    }
    // 7) a Equipe como voz (A Equipe, Correio da Equipe)
    return vozEquipe(pals, L);
  }

  function listas(f) {
    function m(lista) {
      var fora = [];
      for (var i = 0; i < lista.length; i++) fora.push(f(lista[i]));
      return fora;
    }
    return {
      dentro: m(DENTRO), palavra: m(PALAVRA), silaba: m(SILABA),
      todas: m(DENTRO.concat(PALAVRA)), o_todas: DENTRO.concat(PALAVRA),
      contexto: m(CONTEXTO), cargos: m(CARGOS), ligas: m(LIGAS),
      objetos: m(OBJETOS), equipe: m(EQUIPE), com_equipe: m(COM_EQUIPE),
      conectores: m(CONECTORES), excecoes: m(EXCECOES),
      sem: f(NEGA), plural_es: f(PLURAL_ES)
    };
  }
  var BASE = listas(function (x) { return x; });
  var CONF = listas(confuso);

  /* A palavra reservada que o nome tenta vestir, ou null.
   *
   * Cada LEITURA do nome passa duas vezes: como veio (onde a caixa e o dígito
   * ainda falam — é o que derruba "GMJoao" e "GM1") e na dos confusáveis, com
   * o nome e a lista passando pela mesma tabela de glifos. As letras
   * repetidas não pedem leitura nenhuma: quem estica é a comparação. */
  N.reservado = function (nome) {
    var ls = leituras(nome);
    for (var i = 0; i < ls.length; i++) {
      var v = ls[i];
      var r = bate(quebra(mascara(v, BASE.excecoes)), BASE);
      if (r) return r;
      var vistas = [v], cs = [confuso(v), confuso(v, false)];
      for (var j = 0; j < cs.length; j++) {
        if (vistas.indexOf(cs[j]) >= 0) continue;
        vistas.push(cs[j]);
        r = bate(quebra(mascara(cs[j], CONF.excecoes)), CONF);
        if (r) return r;
      }
    }
    return null;
  };

  /* Só o conjunto de caracteres do nome NOVO — nada de normalizar aqui: é
   * justamente o cru que fecha a porta dos homóglifos. */
  N.caracteresOk = function (nome) {
    var s = texto(nome);
    if (!s) return false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (eAlnum(ch) || PERMITIDOS_EXTRA.indexOf(ch) >= 0 ||
          ACENTOS.indexOf(ch) >= 0 || ORDINAIS.indexOf(ch) >= 0) continue;
      return false;
    }
    return true;
  };

  function temLetra(s) {
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (eMaiuscula(ch) || eMinuscula(ch) || ACENTOS.indexOf(ch) >= 0 ||
          ORDINAIS.indexOf(ch) >= 0) return true;
    }
    return false;
  }

  /* {ok, motivo}. O motivo é curto, em pt-BR, e vai direto para o jogador. */
  N.valida = function (nome, minimo, maximo) {
    if (minimo === undefined || minimo === null) minimo = 3;
    if (maximo === undefined || maximo === null) maximo = 20;
    if (typeof nome !== 'string' || nome === '') return { ok: false, motivo: MOTIVO_VAZIO };
    if (apara(nome) !== nome) return { ok: false, motivo: MOTIVO_PONTAS };
    if (!N.caracteresOk(nome)) return { ok: false, motivo: MOTIVO_CARACTERES };
    /* o comprimento é contado DEPOIS do conjunto de caracteres de propósito:
     * só sobra o plano básico, e o JavaScript conta o mesmo que o Python */
    if (nome.length < minimo || nome.length > maximo) {
      return { ok: false, motivo: 'de ' + minimo + ' a ' + maximo + ' caracteres' };
    }
    if (!temLetra(nome)) return { ok: false, motivo: MOTIVO_LETRA };
    if (N.reservado(nome)) return { ok: false, motivo: MOTIVO_RESERVADO };
    return { ok: true, motivo: '' };
  };

  /* SÓ PARA A PROVA (tests/nomes_prova.py): o esqueleto de um texto (a prova
   * varre os 1,1 milhão de pontos de código e compara com o Python) e as
   * tabelas em cima da mesa, para conferir item por item que os dois
   * arquivos não brigaram. */
  N._cru = cru;
  N._tabelas = function () {
    var h = [], l = [], pr = [], a = [], k, i, cps, t;
    function hex(x) { return x.toString(16).toUpperCase(); }
    for (k in HOMOGLIFOS) {
      if (tem(HOMOGLIFOS, k)) h.push(hex(+k) + '>' + HOMOGLIFOS[k]);
    }
    for (k in PRE) {
      if (tem(PRE, k)) {
        cps = pontos(PRE[k]);
        t = [];
        for (i = 0; i < cps.length; i++) t.push(hex(cps[i]));
        pr.push(hex(+k) + '>' + t.join('.'));
      }
    }
    for (k in LEET) {
      if (tem(LEET, k)) l.push(k + '>' + LEET[k]);
    }
    for (i = 0; i < ARTE.length; i++) a.push(ARTE[i][0] + '>' + ARTE[i][1]);
    return {
      some: SOME, simbolos: SIMBOLOS, homoglifos: h.sort(), pre: pr.sort(),
      leet: l.sort(), arte: a,
      dentro: DENTRO, palavra: PALAVRA, silaba: SILABA, vogais: VOGAIS,
      contexto: CONTEXTO, cargos: CARGOS, ligas: LIGAS, objetos: OBJETOS,
      equipe: EQUIPE, com_equipe: COM_EQUIPE,
      conectores: CONECTORES, nega: NEGA, plural_es: PLURAL_ES, excecoes: EXCECOES,
      acentos: ACENTOS, ordinais: ORDINAIS, espacos: ESPACOS,
      permitidos: PERMITIDOS_EXTRA, cola: COLA,
      motivos: [MOTIVO_VAZIO, MOTIVO_PONTAS, MOTIVO_CARACTERES, MOTIVO_LETRA,
                MOTIVO_RESERVADO]
    };
  };
})();
