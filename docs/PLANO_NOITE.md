# Plano da noite — o que foi decidido e executado sem você

Você delegou a condução e a aprovação. Este documento registra **cada decisão tomada em seu nome**,
para você conferir de manhã e reverter o que não gostar (tudo está versionado no Git).

## Decisões que tomei por você

| Decisão | Escolha | Porquê |
|---|---|---|
| Estilo visual | **KayKit low-poly (CC0)** para personagens, monstros e cenário | O cenário 3D que já tínhamos usa o KayKit Dungeon; os personagens novos são da mesma família. Casam sem esforço, e foi o que você pediu ("mesmo gráfico"). |
| Sua arte desenhada | Fica nos **retratos e cartas da interface** | É onde ela aparece o tempo todo e onde o desenho à mão brilha mais que o modelo 3D. |
| Licenças | **Só CC0** | Sem crédito obrigatório e sem restrição de redistribuição: tudo pode ir para o repositório público. |
| Compras | **Nenhuma** | Você definiu isso antes; mantive. |
| Efeitos | Partículas 3D + malhas emissivas + **luz dinâmica** | Em 3D o projétil pode iluminar o chão e os personagens — é o ganho que o 2D não dava. |
| Camada 2D | **Preservada** como alternativa | Nada foi apagado; a versão com o seu Sumô continua no histórico. |

## Duas decisões que mudaram o que você tinha combinado — leia com atenção

O Agente Chefe reprovou uma versão da noite justamente por estas duas não estarem
documentadas fora de um comentário de código. **Ambas são reversíveis e a palavra final é sua.**

### 1. As classes foram renomeadas

Você autorizou trocar a aparência das classes para casar com os modelos 3D prontos
("podemos mudar também os personagens de cada classe"). O elenco ficou assim:

| id interno | antes | agora |
|---|---|---|
| `sumo` | Sumô | **Bárbaro** (machado de duas mãos) |
| `arqueiro` | Elfo Arqueiro | **Batedor** (besta, capuz) |
| `curandeira` | Curandeira | **Paladina** (armadura clara, escudo) |
| `espadachim` | Espadachim | **Ladino** (adagas gêmeas) |
| `invocador` | Invocador | **Xamã** (grimório) |
| `bruxo` | Bruxo | Bruxo (mantido) |

Papéis táticos, ids, efeitos e balanceamento **não mudaram**. Foram renomeados 20 dos 171
feitiços — só os que citavam a aparência antiga (sino, mawashi, dohyo, pavio, cajado).

### 2. A sua arte do Sumô saiu da tela

Ela está **preservada** em `assets/embedded/sprites-sumo.js` e não foi apagada.
Tirei do `index.html` porque a classe virou um Bárbaro de machado: o retrato desenhado
mostraria um lutador de sumô ao lado de um bárbaro no tabuleiro, e essa incoerência salta aos
olhos. Os retratos agora são gerados dos próprios modelos, então tudo combina.

**Para trazê-la de volta** (ela tem prioridade sobre o retrato 3D): acrescente
`assets/embedded/sprites-sumo.js` e `js/render2d/spriteart.js` à lista de arquivos do
`index.html`, nesta ordem, logo antes de `js/render3d/portraits3d.js`. Está explicado lá dentro.

> Se preferir o contrário — manter o Sumô como conceito e a sua arte na tela — é meia hora de
> trabalho: renomear a classe de volta e trocar o modelo do Bárbaro por um mais corpulento.

## Ordem de execução

1. **Camada 3D**: 6 classes com modelo e animação → cenário nos 6 temas → monstros e chefes → efeitos → clima, pets, estados → fusão
2. **Integração** (eu): trocar a entrada do jogo, verificar de ponta a ponta, commitar
3. **QA** (Agente Revisor): regressão completa — suítes, fluxo E2E nos 6 calabouços, casos de borda, desempenho
4. **Veredito** (Agente Chefe): só aprova se o jogo estiver bom de verdade
5. **Correções**: o que o QA e o Chefe apontarem volta para os donos dos arquivos

## O que continua garantido (nada disso muda com o 3D)

- Motor de combate: 186 testes · Progressão: 143 testes · Mundo: 6.397 checagens
- 6 classes, 171 feitiços, 66 monstros, 6 chefes, 6 calabouços, 18 salas
- 1.875 ataques de fusão, 6 pets, 48 itens, 12 conjuntos, 5 pedras, forja até +10
- Cartas com estrelas, clima, esquiva elemental, eventos de terreno, cronômetro de 30s
- Interface completa com Coleção, Inventário e Forja, pensada para celular

## Como conferir de manhã

- Abra `index.html` — o jogo deve estar rodando em 3D
- `docs/CREDITS_3D.md` — de onde veio cada modelo e sob qual licença
- `docs/QA_REPORT.md` — o relatório do Revisor (seção mais recente)
- `docs/CHIEF_REVIEW.md` — o veredito do Chefe
- `git log` — cada entrega commitada separadamente, com mensagem explicando o que mudou
