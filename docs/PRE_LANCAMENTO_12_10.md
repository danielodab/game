# A noite de 12/10 — o que entrou, o que a bateria disse, o que falta para a Play

> O pedido do dono (12/10, "trabalhe com calma e revise, amanhã que vou ver"): analisar o jogo e fazer todos os
> testes, ver o equilíbrio das classes e sugerir melhorias, trocar os ícones dos ataques ("vejo muitos
> repetidos"), criar mais efeitos visuais nos ataques (pelo Blender), e melhorar os detalhes em volta dos nomes.
> A Play em duas semanas.
>
> Tudo está na branch `claude/game-analysis-polish-4b0e6d` (base = main `6773161`), em commits separados por
> bloco, **sem push** — o push ao main redesdobra o servidor e fecha o terminal do Coolify, então ele é seu.

## 1. O que entrou (um commit por bloco)

| bloco | commit | o que é | prova |
|---|---|---|---|
| A ponte do plugin de avisos | `4c95b8e` | `vendor/capacitor/local-notifications.js` não existia — o `notificacoes.js` de 08/10 o carrega; no aplicativo dava 404 e os três avisos locais ficavam calados. Entrou o dist do `@capacitor/local-notifications` 8.3.1 | `app_modelos` 41/41 |
| Ícones de feitiço v2 | `c44385c` | um desenho por feitiço: `MOTIVO_FX` (198 fxKeys nomeados), `MOTIVO_FORMA` (147 formas de fusão pelo nome), família do nome para monstros/bichos/itens; marca da área e distintivo do efeito secundário; a fusão em duas cores | `icones_feiticos` 30/30 (é a galeria: abra e olhe) |
| Molduras da plaquinha | `772557e` | bisel (aro de dentro claro/escuro, fio de fora), lustre, contas, rosetas, gemas facetadas, rebites com luz; um ornamento por forma (volutas, espinhos sombreados, vinha, runas, arcos góticos, ameias com torres, medalhão do pódio); a placa comum e a da guilda também; sem brilho | `foto_molduras` 12, `foto_moldura_arena` 17/17 |
| Folhas de efeito do Blender | `4413c4f` | sete folhas renderizadas no Cycles por `tools/fx_blender.py` (golpe, impacto, rachadura, raio, jato, pilar, selo), brancas, tingidas pelo elemento em `filme()`; mais de um filme por família, o corte no tempo do acerto, o impacto no fim de todo projétil, o raio para o ar, o jato para a água; a folha só aparece com a imagem aberta | `fx_filme` 8/8, `efeitos_um_a_um` 7/7 (213 feitiços), 8 fotos de `fx_sala.html?efeito=cast` |
| Réguas de prova envelhecidas | `f4828f6` | `art_gallery` (7 classes, 8+ pedras, 48+ itens, 5+ corpos de pet), `icones_extras` (15) | PASS · 8/8 |
| Documentação | (este commit) | `docs/SISTEMAS.md` §9-A.30, README (árvore, §5, §7.3), `docs/EQUILIBRIO.md` §8, este relatório | — |

**Como olhar amanhã, em cinco minutos:** abra `tests/icones_feiticos.html` (a galeria dos ícones, por classe e
por dupla de fusão), `tests/foto_molduras.html` (as doze placas) e, servido, `tests/fx_sala.html?efeito=cast&spell=espadachim-fogo-5&espera=520&frames=3`
(troque o `spell` por `bruxo-terra-12`, `curandeiro-neutro-1`, `invocador-neutro-3`, `curandeiro-agua-15`,
`bruxo-ar-5`). No jogo mesmo: qualquer luta — o corte, a flecha, o terremoto e a cura mudaram.

## 2. A bateria (12/10 à noite, nesta branch)

Rodada inteira, por camada. **Nenhuma falha nova**: tudo o que está vermelho abaixo falha IGUAL no main
`6773161` (conferido rodando as mesmas provas na pasta principal), e a lista bate com o que o README já
registrava como antigo.

### 2.1 Node (52 suítes)

Verdes: afixos 39, app_casca 43, app_jogo 56, **app_modelos 41** (era 40: a ponte do plugin), coop_registro_p 6,
coroa_mestre 20, cronicas 16, descanso 12, eco_motor 74, eco_sal_cliente 18, elites 21, entregas_cliente 11,
estrelas_manuais 18, feitos 12, gema 29, idiomas 76, inatividade_mestre 11, invisivel_armadilha 118,
jogador_id_cliente 24, juiz_balcao 18, juiz_economia 57, juiz_grupo 13, juiz_grupo_xp 9, juiz_guerra 26,
juiz_pocoes 46, juiz_recompensa 26, juiz_sala 9, juiz_supremo 36, juiz_titulos_regua 8, mercado_cliente 26,
musica 59, notificacoes 20, palavroes 12, pedidos_duas_pontas 47, poco_perigos 42, porteiro 24, premio_anuncio 40,
registro_erros 40, regras_equilibrio 64, ritmo 8, santuario_regras 94, sessao_sair_cliente 14, tela_cheia_app 7,
torneio_cliente 70, torneio_perfil 12, um_aparelho_cliente 33, visao_mapas 274.

Vermelhas, todas de antes: `juiz_poco` 1 de 7 (o cliente não vence um andar semeado em 12 sementes),
`luta_aberta_cliente` 2 de 34, `autoridade_cliente` (sem vitória para provar), `autoridade_ponta` 3 de 11,
`guerra_bancada` 7 de 96 (8 no main) — o bloco B2 espera que os três avancem mais de 10 turnos enquanto a Ana
está fora e eles avançam 7: é a régua do cenário que envelheceu com as classes mais fortes, não a reconexão.

### 2.2 Python — API e relé (43 suítes)

Verdes (36): servidor_api, conta_api, autoridade_api, afixos_api, amigos_api, anuncio_api, arena_api, barras_api,
grupo_duelo_api, guerra_api, guilda_antiga_api, guilda_meta_api, loja_api, luta_largada_api, mercado_api,
premio_diario_api, privacidade_api, programa_api, registros_api, regras_versao_api, santuario_api, supremo_api,
trilha_api, texturas_prova 16, rele_prova 96, rele_amigos 26, rele_aparelho 15, rele_plateia 9, rele_presenca 24,
rele_titulos, guerra_rele 14, moderacao_rele 19, coolify_prova 64, carga_prova 19, app_jogo_sw 23, idiomas_site 62.

Vermelhas (7), todas iguais no main: `guilda_api` 1 (o nome "Mestre" reservado), `mestre_api` 3 (`test_ficha`
40 ≠ 26, `test_presentear` "classe já liberada" ≠ "produto desconhecido" — as duas iniciais livres de 08/10
mudaram a resposta — e `test_trilha_e_log`, que é só codificação: o "—" do log sai em cp1252 e o teste lê
UTF-8; com `PYTHONUTF8=1` passa), `moderacao_api` 1 (`test_16`, as cartas de classe liberada dão 422
`nada-mudou`), `pagamento_api` 3 (sem as chaves do Mercado Pago no ambiente), `pagamento_play_api` 1 (a conta de
serviço), `pocoes_api` 1 (`prova_03_fim_de_luta_grava_a_vida`; no main o `setUpClass` nem sobe),
`torneio_api` (um `TimeoutError` de socket no `test_05` com a máquina cheia, e o resto em cascata — repetido com a
máquina vazia no fim da noite: **15 de 15, 75 s**; `pocoes_api` repetido vazio segue com a mesma 1).

### 2.3 Navegador (Chrome headless, pela vez da máquina)

Verdes: icones_feiticos 30, efeitos_um_a_um 7 (213 feitiços), fx_filme 8, art_gallery PASS, icones_itens 6,
icones_extras 8, icones_ui 46, foto_molduras 12 placas, foto_moldura_arena 17, aura_praca 12, vida_praca 48,
fantasmas_teto 8, coroas_3d 9, muro_visual 20, armadilha_chao, validate_data 2.631, estrelas_caminhos 29,
liberacao, oito fotos de fx_sala.

Vermelhas, todas iguais no main: `coroa_praca` 4–5 de 10 (a coroa 3D não abre dentro do prazo com a CPU cheia —
o mesmo sintoma de 21/09 do README §8), `balao_praca` 3 de 10 (o balão não esmaece nos 6 s de relógio real sob
carga), `arvore_feiticos` 4 de 11, `prova_icones_menus` 4 de 74, `cartas_item` 3 de 21 (as cartas de classe
liberada e a versão 10 das regras — réguas de antes de 08/10), `sprite_gallery` não fecha (página antiga).

**A bateria das páginas de HUD, batalha e validação** (24 páginas, um Chrome só, com a bancada completa rodando
ao lado): test_engine_v2 218/0, **validate_world 8.791/0, validate_classes 7.095/0, validate_fusion 6.664/0**
(as três voltaram a zero depois das réguas acertadas — commit `e27caf4`; antes 4, 13 e 53 falhas, iguais no
main), prova_toque_batalha 14, pvp_hud 36, mercado_hud 22, painel_mestre 95, gm_agenda 46, muro 12, duelo 10,
campo_pvp 52, desafios 11, grupo 246, prova_forja, prova_inventario_dupla, foto_auras. Vermelhas, todas iguais
no main (conferido lá na mesma noite): `grupo_hud` 2 de 40 (o item 28, do README), `torneio_hud` 1 de 101 (o
botão da moldura mede 182×36 numa janela de 1500 px — a prova é de 375 px), `eco_hud` 2 de 50, `quebra_hud` 3 de
61 (as mesmas três do commit de 10/10), `pocoes_hud` 1 de 44 ("quem enche sai do registro", do README),
`guerra_hud` 12 de 33 — repetido com a máquina VAZIA, nesta branch e no main: 12 de 33 nos dois, a partida pronta
não abre a guerra no Salão da Sede ("[menu · guerra]"); não é a oscilação sob carga de 03/10, é um cenário que
quebrou entre 03/10 (33/33) e 10/10, com cara de vir do fluxo da partida pronta do torneio — fica para o seu
olho, é regra de guerra, não desta noite — e `ui_screens` que não fecha (não fecha o placar, também do README).
`coroa_praca` e `balao_praca` também falham vazios (4/10 e 3/10) e iguais no main.

### 2.4 O que é da máquina, não do código

Esta noite rodaram ao mesmo tempo a bancada completa do equilíbrio (4 filhos), as provas de API e até três
Chromes com WebGL por software. Com a CPU em 100% as páginas de 30 s passaram de 300 s, a coroa 3D não
decodificou, o balão não esmaeceu no prazo e a API do torneio não respondeu a tempo. A regra que fica (está na
memória): **uma coisa pesada de cada vez** — a bancada completa sozinha, depois as páginas, um Chrome só.

## 3. O equilíbrio

A medida completa (`node tests/equilibrio.js --completo`, 11 sementes, 924 jogos por média, 1 h 40 com a
máquina dividida) deu **405 de 436 na faixa** — 399 na medida de 03/10. A leitura inteira, as tabelas por
classe e por CAMINHO (classe × elemento, que a prova não cobra e é onde o desequilíbrio mora) e as sugestões com
número estão em `docs/EQUILIBRIO.md` §8. Nenhum dado foi mexido; o resumo:

- **As médias em dupla** (níveis 5/12/20/30): Bárbaro 42\*/47/47/51, Caçador 46/53/51/52, Bruxo 57\*/46/46/51,
  Ladino 60\*/45\*/46/48, Curandeiro 46/50/49/46, Xamã 52/51/55/54, Minotauro 48/57\*/57\*/48 (\* fora de 45–55%).
  Desde 03/10 o Bárbaro caiu de 3 a 8 pontos e o Xamã e o Minotauro subiram — as mesmas sementes e a mesma IA;
  a suspeita é a regra 10 ("atacar a casa vazia"), que dá jogada a quem mira o chão. Vale medir com ela
  desligada antes de mexer em número.
- **Por caminho, os extremos:** o Bárbaro de Fogo é o caminho mais fraco do jogo (34/39/40/43%: os feitiços que
  se queimam); o Caçador de Água no 5 (26%: o Tiro-Arpão puxa o inimigo para junto de quem atira de longe); o
  Minotauro de Água no 12 e no 20 (76%, 67%: muro + armadilha + regeneração somados); o Ladino inteiro no 5
  (57–62%) e o Ladino de Ar do 20 em diante (39%, 37%); o Curandeiro de Água no 20 e no 30 (39%, 31%); o Bruxo
  de Ar no 20 (32%).
- **As sugestões, cada uma com o número** (§8.3): a queimadura própria do Sangue Fervente pela metade e +12% em
  Gume Incandescente e Estouro de Brasa; o puxão do Tiro-Arpão de 2 para 1; a regeneração do Casco de Maré −25%
  e o muro de água ferindo 24 (os outros 30); o Ladino de nível 0–5 −8% e Corte em Cadeia/Mil Cortes +15%; a
  cura da Corrente Sanadora e da Cisterna Boa +15%; a cadeia do Bruxo +20% e a Trovoada com alcance 8. O que
  NÃO mexer: Xamã × Minotauro e Ladino × Xamã são alcance e invocação no caminho — a IA não usa a troca de lugar
  nem a invisibilidade; gente usa.
- **A fusão:** as sete fora de ±20% são as mesmas de 03/10, todas nos níveis de conferência 16 e 25 (e
  `curandeiro+minotauro` no 20, em 120%, na borda).

## 4. O que falta para a Play (seu, não meu)

1. **`npm install` + `npx cap sync` na pasta principal e um AAB novo (versionCode 2).** A ponte JS dos avisos
   locais entrou nesta branch, mas a parte NATIVA do plugin só entra no aparelho com um build novo; sem ele os
   avisos seguem calados no Android (e o `node_modules` da pasta principal não tem o plugin).
2. **Juntar esta branch ao main e dar o push** (o deploy do Coolify fecha o terminal aberto).
   Depois do push, `tools/extrai_assets.py` não é preciso (as folhas do Blender ficam embutidas, como fx-anim).
3. **AdMob** ainda "not approved" (06/10): o prêmio do anúncio nunca foi provado de ponta a ponta. Sem a aprovação,
   a área "Ganhar prêmios" fica com o anúncio de teste.
4. **Os 12 testadores por 14 dias** do teste fechado e depois "Solicitar acesso de produção" (docs/GOOGLE_PLAY.md).
5. **Jogar e julgar com o seu olho**: os ícones (a galeria), as molduras (a praça) e os efeitos (qualquer luta);
   o que estiver forte demais ou fraco demais nos efeitos é um número em `FILME_FAM` (tamanho, duração, opacidade)
   ou a tinta em `corBranca`.
6. As vermelhas de §2 que são regra de jogo e não ambiente — `mestre_api`/`moderacao_api`/`cartas_item` (as
   iniciais livres), `juiz_poco`, `luta_aberta_cliente`, `autoridade_*`, `guerra_bancada` B2 — são réguas
   envelhecidas ou cenários que mudaram com as suas decisões; vale uma manhã acertando as réguas para a bateria
   voltar a toda verde antes da produção.
