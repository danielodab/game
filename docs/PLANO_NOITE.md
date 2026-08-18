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
