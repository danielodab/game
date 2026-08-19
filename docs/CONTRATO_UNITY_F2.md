# CONTRATO — Unity, rodada 2: o jogo rodando

Objetivo desta rodada: **uma batalha jogável dentro da Unity**, com a sala real,
os heróis, os monstros e os feitiços que já existem nos dados. Placeholder onde
faltar arte — o elenco definitivo entra depois, e a troca tem de ser mecânica.

Destino final é **celular**. Toque, não mouse. Tela em pé ou deitada, mas dedo.

Vale tudo da [rodada 1](CONTRATO_UNITY_F1.md) — português, comentário explica o
porquê, não afrouxar teste, não inventar número, só mexer nos seus arquivos,
commitar e dizer a branch. As armadilhas da §3 de lá continuam valendo.

## O que já está pronto e você USA, não reescreve

| namespace | o que faz |
| --- | --- |
| `Soterra.Grade` | `Mapa` (sala em texto), `Passo.Alcance` (busca em largura), `Visao.Livre`, `Alcance`, `Area.Casas` — 51 testes passando |
| `Soterra.Dados` | `BancoDeDados` carrega as 25 chaves de `Assets/Resources/dados/` |
| `Soterra.Cena` | `Palco` monta o tabuleiro 3D, câmera ortográfica travada em 3/4, `Realcar`, `Girar` |

## Donos de arquivo

| papel | pode criar e editar |
| --- | --- |
| **Motor** | `Assets/Scripts/Motor/**`, `Assets/Tests/EditMode/Motor/**` |
| **Batalha** | `Assets/Scripts/Batalha/**`, `Assets/Tests/EditMode/Batalha/**` |
| **Cena** | `Assets/Scripts/Cena/**` (já é seu), `Assets/Tests/EditMode/Cena/**` |
| **Interface** | `Assets/Scripts/Interface/**`, `Assets/UI/**`, `Assets/Tests/EditMode/Interface/**` |

Não crie `asmdef`. Não toque em `Grade/`, `Dados/`, `Packages/`,
`ProjectSettings/`, `lote.ps1`, nem em nada de `js/`.

## API do motor — dono: Motor

C# **puro**, sem `MonoBehaviour`. É o que deixa a regra ser testada sem cena.

A fonte é `js/core/engine.js`. Onde o documento discordar do código, **o código
está certo**.

```csharp
namespace Soterra.Motor
{
    public enum Lado { Heroi, Monstro }

    public sealed class Unidade
    {
        public string Uid;
        public string ClasseOuMonstroId;
        public Lado Lado;
        public Vector2Int Casa;
        public int PV, PVMax, PA, PAMax, PP, PPMax, Esquiva, Nivel;
        public string Elemento;
        public bool Viva;
        public bool ForaDoTabuleiro;      // fusao tira o convidado sem contar derrota
    }

    public sealed class Batalha
    {
        public Grade.Mapa Mapa;
        public IReadOnlyList<Unidade> Unidades;
        public Unidade Atual;             // de quem e o turno
        public int Rodada;
        public string Clima;

        public IReadOnlyDictionary<Vector2Int,int> AlcanceDePasso();
        public bool PodeAndar(Vector2Int destino);
        public void Andar(Vector2Int destino);          // desconta PP por passo
        public IReadOnlyList<Vector2Int> AlvosDe(string feiticoId);
        public bool PodeConjurar(string feiticoId, Vector2Int alvo);
        public Resultado Conjurar(string feiticoId, Vector2Int alvo);
        public void EncerrarTurno();                     // enche PA/PP de quem entra
    }

    public sealed class Resultado
    {
        public List<Evento> Eventos;      // dano, cura, morte, empurrao, estado
    }
}
```

Regras que os testes TÊM de cobrar, porque cada uma e defeito conhecido:

- **PA e PP enchem no comeco do turno DA UNIDADE**, nao no comeco da rodada.
- **Rivalidade elemental**: fogo↔agua, terra↔ar, neutro sem rival. O numero sai
  de `DATA.rivals` e `DATA.elementInfo`, nao da sua memoria.
- **Feitico de area mira o CHAO.** Com forma diferente de `Single`, a casa-alvo
  e um lugar: basta estar no alcance. So o alvo unico exige criatura na casa.
- **Esquiva e identidade de classe** — 5 no Barbaro, 30 no Ladino.
- **Morte** tira do tabuleiro mas a fusao tira SEM contar derrota
  (`ForaDoTabuleiro`).

## API da batalha montada — dono: Batalha

```csharp
namespace Soterra.Batalha
{
    public static class Montador
    {
        // Le a sala do calabouco e devolve a batalha pronta: herois nos 'P',
        // monstros nas letras, ordem de iniciativa definida.
        public static Motor.Batalha DeSala(Dados.BancoDeDados banco,
                                           string calabocoId, int indiceDaSala,
                                           IReadOnlyList<string> classesDosHerois);
    }
}
```

A sala real traz VARIOS `P` e repete letra de monstro — use
`Mapa.NascimentosHeroi` e `NascimentosMonstro`, que sao LISTAS. Os dois herois
ocupam os primeiros; os que sobram ficam vazios, e isso e correto.

**Nao conte com seis.** Este contrato ja afirmou "seis" como fato e estava
errado: 15 das 18 salas tem seis, mas `windscaffold` 0 tem **8**,
`windscaffold` 1 tem **10** e `brokenheart` 0 tem **4**. O piso e QUATRO. Quem
escrever selecao de grupo maior que quatro precisa saber disso antes, nao na
hora em que o terceiro heroi nao tiver onde nascer.

## Cena — dono: Cena

- Uma **unidade em cena** por unidade do motor, plantada na casa
- Placeholder e aceitavel: capsula colorida pela classe serve. O elenco entra
  depois, e a troca tem de ser **por id de classe**, sem tocar em codigo
- Realce de alcance de passo, de alvo de feitico e de area
- Camera pensada para **celular**: a sala de 21×17 tem de caber em tela de 16:9
  deitada e de 9:16 em pe

## Interface — dono: Interface

**UI Toolkit** (UXML/USS), nao IMGUI. E texto, versiona e revisa em diff — e da
para escrever sem clicar no Editor.

- PV, PA e PP de quem joga
- Barra de feiticos da classe, com custo em PA e recarga
- Botao de encerrar turno
- Ordem de iniciativa
- **Alvo de dedo com no minimo 44×44 pontos.** Menor que isso ninguem acerta.

## Como provar que funciona

Alem de `lote.ps1 testar`, esta rodada precisa de **foto da batalha montada**:
sala real, herois e monstros nas casas, alcance aceso. Sem foto, nao houve
entrega — o teste prova a regra, a foto prova que existe jogo.
