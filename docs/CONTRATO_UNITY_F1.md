# CONTRATO — Unity, rodada 1. Leia antes de escrever qualquer linha.

Lei técnica da primeira rodada da reconstrução na Unity. Vale para **todos os
papéis**. Quem discordar do contrato **fala antes**, não desvia depois.

Fontes de verdade, nesta ordem:

1. [`SISTEMAS.md`](SISTEMAS.md) — o jogo **como ele é hoje**. É a especificação.
2. [`PLANO_UNITY.md`](PLANO_UNITY.md) — as fases e a decisão visual.
3. O código em `js/` — se o documento discordar do código, **o código está
   certo**; diga isso no seu relatório em vez de escolher sozinho.

## 0. Regras gerais

- **Português** em comentário, documento e mensagem de commit.
- **Comentário explica o PORQUÊ**, de preferência o defeito que a linha evita.
  Comentário que repete o nome do método é lixo — não escreva.
- **Não afrouxe teste para ele passar.** Se o teste está errado, conserte o
  teste e **diga o que ele media de errado**. Se o contrato está errado, diga
  isso — não mude o número escondido.
- **Não invente número.** Todo valor de jogo sai de `js/core/data/*.js` ou do
  `SISTEMAS.md`. Se não achar, pergunte no relatório; não chute.
- **Só mexa nos seus arquivos** (§1). Precisou de algo de outro dono? Escreva no
  relatório o que precisa e siga com o que dá.
- **Commite o seu trabalho** e diga no relatório o **nome da branch**.

## 1. Donos de arquivo — NUNCA edite arquivo de outro dono

| papel | pode criar e editar |
| --- | --- |
| **Criativo/Dados** | `tools/exporta_dados_unity.py`, `tests/dump_dados.html`, `unity/SOTERRA-Tatico/Assets/Resources/dados/**` |
| **Locomoção** | `unity/SOTERRA-Tatico/Assets/Scripts/Grade/**`, `Assets/Tests/EditMode/Grade/**` |
| **Lógica** | `unity/SOTERRA-Tatico/Assets/Scripts/Dados/**`, `Assets/Tests/EditMode/Dados/**` |
| **Designer** | `unity/SOTERRA-Tatico/Assets/Scripts/Cena/**`, `Assets/Tests/EditMode/Cena/**` |

**De ninguém — não toque:** `Assets/Scripts/Bootstrap.cs`, `Tabuleiro.cs`,
`Assets/Scripts/Soterra.asmdef`, `Assets/Editor/**`, `Packages/**`,
`ProjectSettings/**`, `unity/lote.ps1`, e qualquer coisa em `js/`, `css/`,
`index*.html` — a linha JS continua viva e não se mexe nela nesta rodada.

`Assets/Scripts/Soterra.asmdef` já cobre tudo abaixo de `Assets/Scripts/`
recursivamente, e `Soterra.Tests.asmdef` cobre `Assets/Tests/EditMode/`.
**Não crie asmdef novo** — criaria fronteira de compilação onde não precisa.

## 2. Namespaces

`Soterra.Grade` · `Soterra.Dados` · `Soterra.Cena`. Testes em
`Soterra.Testes.<Papel>`. Já existem e não se mexe: `Soterra` (Bootstrap,
Tabuleiro) e `Soterra.Ferramentas` (Lote).

## 3. Como rodar a Unity

Cada papel trabalha em **worktree próprio**, então cada um tem o seu
`unity/SOTERRA-Tatico` e o seu `Library/` — dá para compilar e testar sem
esbarrar em ninguém. A primeira importação leva alguns minutos; é uma vez só.

```
powershell -File unity/lote.ps1 verificar
powershell -File unity/lote.ps1 testar
```

`verificar` compila e devolve código de saída diferente de zero se quebrou;
`testar` roda os EditMode e escreve `unity/resultado.xml`.

**Entregar sem rodar `testar` não conta como entrega.**

Armadilhas já pagas por esta equipe — não redescubra:

- `foto` e `build` **não podem** usar `-nographics`: sem vídeo o PNG sai preto.
- `RenderTexture` no padrão é **linear** e `ReadPixels` não converte: crie com
  `RenderTextureReadWrite.sRGB` ou o PNG sai escuro e lavado.
- `renderer.material` **fora de Play** devolve **cópia descartada** — a pintura
  não chega na tela e vaza um material por objeto. Use `MaterialPropertyBlock`.
- Material distinto por objeto criado em tempo de edição faz o **SRP Batcher**
  desenhar tudo com a cor do primeiro.
- `Camera.IsRenderRequestSupported` **não existe** nesta versão (CS1061).
- `Input.` legado **lança exceção** com `activeInputHandler: 1` — use o Input
  System novo.

## 4. Esquema dos dados — dono: Criativo/Dados

Os arquivos de `js/core/data/` **não são só literais**: `fusions.js`, `items.js`,
`monsters.js` e `pets.js` têm funções que geram conteúdo. Converter o texto
perderia o que é gerado. Exporte o **resultado**, executando o JS.

Não há Node nesta máquina. O caminho é Chrome headless carregando os scripts na
**ordem de `v2.html`** e serializando `JOGO.DATA`.

Saída: **um arquivo por chave** de `JOGO.DATA`, em
`Assets/Resources/dados/<chave>.json`, com o dump exato de `JOGO.DATA[chave]`.
Um arquivo por chave, e não um `dados.json` gigante, porque 1 MB numa linha só
não se revisa em diff.

Mais o manifesto, `Assets/Resources/dados/_manifesto.json`:

```
{ "gerado": "2026-08-18T21:00:00Z",
  "fonte": "v2.html",
  "chaves": { "spells": 171, "dungeons": 6 } }
```

`chaves[k]` = comprimento, se for lista; número de chaves **de topo**, se for
objeto. A contagem é rasa de propósito: contar recursivamente daria número
diferente para a mesma estrutura dependendo de onde o autor decidiu aninhar.

**Âncoras que o manifesto tem de bater** — já conferidas contra o dado real na
exportação de 18/08/2026:
`spells: 171` · `classes: 6` · `dungeons: 6` · `items: 90` · `sets: 18` ·
`monsters: 66` · `fusionForms: 15` · `fusionBlends: 25` · `elements: 5` ·
`weathers: 5`.

Duas dessas já enganaram uma vez, e a explicação evita o susto:

- **`fusionForms: 15`, e não 105.** São 15 duplas de classe, cada uma com lista
  de 7 degraus: 15 × 7 = 105 formas. A contagem rasa vê as 15; o 105 está um
  nível abaixo, e continua verdadeiro.
- **`fusionBlends: 25`, e não 16.** São os pares **ordenados** de 5 elementos.
  16 seria só o que sobra tirando o `neutro` — e o neutro tem de existir, porque
  herói abaixo do nível 5 ainda não escolheu caminho.

Chave que é **objeto-embrulho** (`leveling`, `stars`, `upgrade`) conta os campos
do embrulho: `stars: 2` é `{max, bonuses}`, não duas estrelas.

Se o dado real divergir da âncora, **o dado ganha** — relate a divergência, não
force o número.

`Resources/` e não `StreamingAssets/` porque `Resources.Load<TextAsset>`
funciona igual no Editor, no player e no **WebGL**, sem `UnityWebRequest` e sem
referência arrastada no Inspector — e ninguém aqui arrasta nada no Inspector.

## 5. API da grade — dono: Locomoção

C# **puro**: nada de `MonoBehaviour` em `Assets/Scripts/Grade/`. É o que deixa
tudo isso rodar em teste EditMode, sem cena, em milissegundos.

O mapa de cada sala é **texto**, num retângulo de 21×17 a 27×23 (`SISTEMAS.md`
§2). Símbolos: `.` chão · `,` chão decorado · `#` obstáculo **alto**, bloqueia
passagem **e visão** · `=` obstáculo **baixo**, bloqueia passagem mas **não**
bloqueia visão · `~` vazio · `P` nascimento do herói · `a`–`z` nascimento de
monstro.

```csharp
namespace Soterra.Grade
{
    public enum Casa { Chao, ChaoDecorado, ObstaculoAlto, ObstaculoBaixo, Vazio }
    public enum Forma { Single, Circle, Cross, Cone, Line, Ring }

    public struct Nascimento { public char Letra; public Vector2Int Casa; }

    public sealed class Mapa
    {
        public int Largura { get; }
        public int Altura { get; }
        public static Mapa DeTexto(string[] linhas);
        public Casa Em(Vector2Int p);
        public bool Dentro(Vector2Int p);
        public bool Andavel(Vector2Int p);         // Chao e ChaoDecorado
        public bool BloqueiaVisao(Vector2Int p);   // SO ObstaculoAlto
        // LISTA, nao casa unica: a sala real traz SEIS 'P' e o jogo desce com
        // DOIS herois. Guardando um so, o segundo nao teria onde nascer.
        public IReadOnlyList<Vector2Int> NascimentosHeroi { get; }
        // LISTA com repeticao, nao dicionario por letra: dois 'a' sao dois
        // monstros do mesmo tipo, e o dicionario engolia o segundo.
        public IReadOnlyList<Nascimento> NascimentosMonstro { get; }
    }

    public static class Distancia
    {
        public static int Manhattan(Vector2Int a, Vector2Int b);
    }

    public static class Visao
    {
        public static bool Livre(Mapa m, Vector2Int a, Vector2Int b);
    }

    public static class Passo
    {
        // Casas alcancaveis gastando ate `pp`, respeitando bloqueio e ocupacao.
        public static Dictionary<Vector2Int, int> Alcance(
            Mapa m, Vector2Int origem, int pp, IEnumerable<Vector2Int> ocupadas = null);
    }

    public struct Alcance
    {
        public int Min, Max;
        public bool Linha, Visao;
        public bool Valido(Mapa m, Vector2Int origem, Vector2Int alvo);
        public IEnumerable<Vector2Int> Casas(Mapa m, Vector2Int origem);
    }

    public static class Area
    {
        public static List<Vector2Int> Casas(
            Mapa m, Vector2Int origem, Vector2Int alvo, Forma forma, int tamanho);
    }
}
```

Regras que os testes têm de cobrar, porque cada uma é um defeito conhecido:

- **Alcance de passo é busca em largura, não distância crua.** Corredor em L
  custa mais que a linha reta sugere; medir por Manhattan puro deixaria o
  jogador andar através da parede.
- **`#` bloqueia visão, `=` não.** É o que faz cobertura existir. Um teste com
  os dois lado a lado, mesma geometria, resultados opostos.
- **Área mira o CHÃO.** Com `Forma` diferente de `Single` e `tamanho > 0`, a
  casa-alvo é um lugar: basta estar no alcance, e a área pega quem estiver
  dentro — ou ninguém. Só alvo único exige criatura na casa. Teste que prova:
  explosão largada **entre** dois inimigos pega os dois.

## 6. API do palco 3D — dono: Designer

Decisão fechada (`PLANO_UNITY.md`, fase 3): **modelos 3D sob câmera ortográfica
FIXA em 3/4**. Nada de câmera livre. Rotação só em passos de 90°.

Nesta rodada **não há modelo nenhum** — o palco desenha o chão, os dois tipos de
obstáculo e os realces. Cubo e cor bastam; o acervo entra na rodada seguinte.

```csharp
namespace Soterra.Cena
{
    public sealed class Palco : MonoBehaviour
    {
        public Camera Camera { get; }
        public void Montar(Soterra.Grade.Mapa mapa);
        public Vector3 Mundo(Vector2Int casa, float altura = 0f);
        public Vector2Int Casa(Vector3 mundo);            // inverso de Mundo
        public void Realcar(IEnumerable<Vector2Int> casas, Color cor);
        public void LimparRealce();
        public void Girar(int quartosDeVolta);            // +1 ou -1 = 90 graus
    }
}
```

- `Montar` tem de funcionar **fora de Play** — o modo lote nunca aperta Play.
- Obstáculo **alto** e **baixo** precisam ser distinguíveis **de relance**, sem
  ler legenda: é a informação mais importante do tabuleiro depois das unidades.
- `Mundo` e `Casa` são inversos exatos, em qualquer rotação. **Teste isso** —
  arredondamento errado aqui faz o clique cair na casa vizinha.
- Material fosco, cor em `MaterialPropertyBlock` (ver §3).

## 7. O que cada papel entrega

| papel | pronto quando |
| --- | --- |
| **Criativo/Dados** | os JSON existem, o manifesto bate com as âncoras de §4, e o relatório lista toda divergência encontrada |
| **Locomoção** | `lote.ps1 testar` passa, com teste para cada regra de §5 |
| **Lógica** | carrega os JSON por `Resources.Load<TextAsset>` e um teste confere contagem contra `_manifesto.json` |
| **Designer** | `lote.ps1 testar` passa e existe **foto** provando alto ≠ baixo ≠ realce |

Depois vêm **Revisor**, que lê o diff dos quatro, e **Aprovador**, que dá o
veredito.
