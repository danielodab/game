# SOTERRA na Unity — a grade tática, e o encanamento para trabalhar sem clicar

Isto ainda **não é o jogo**. É a grade tática mínima — chão, obstáculos,
alcance de passo, clique para andar — em C# com **a mesma regra** do motor em
JS, mais o encanamento que faz o resto do trabalho caber em linha de comando.

A paleta é a mesma de `DATA.classes` e a distância é Manhattan, como no motor
de verdade: se a cor e a regra mudassem junto, você não saberia o que está
julgando.

## O que já está resolvido

- Projeto **Unity 6000.5.8f1** com **URP**, montado a partir do template do
  próprio Editor instalado — abre sem diálogo de atualização.
- **Input System novo** (mouse e toque), porque o projeto quer celular e porque
  o `Input.` antigo lança exceção com `activeInputHandler: 1`.
- **Testes EditMode** que rodam sem Editor aberto.
- **Foto pela linha de comando**: a cena é renderizada para PNG sem ninguém
  apertar Play — é o equivalente do Chrome headless que o jogo em JS usa.

## Abrir no Editor (opcional)

Unity Hub → *Projects* → *Add* → aponte para `unity/SOTERRA-Tatico`. A cena
inicial é `Assets/Scenes/Tatico.unity` (gerada por `lote.ps1 cena`). Play.

- **Clique numa casa acesa** — o herói anda e desconta PP por passo.
- **ESPAÇO** — encerra o turno e devolve os PP.

## Trabalhar sem abrir o Editor

```bash
powershell -File unity/lote.ps1 verificar
```

| ação | o que faz |
| --- | --- |
| `verificar` | importa e compila; código de saída ≠ 0 se quebrou |
| `testar` | testes EditMode → `unity/resultado.xml` |
| `cena` | grava `Assets/Scenes/Tatico.unity` já montada |
| `foto` | renderiza `unity/foto.png` da cena |

As mesmas ações direto no Editor, se preferir:

```bash
"C:\Program Files\Unity\Hub\Editor\6000.5.8f1\Editor\Unity.exe" -batchmode -quit -nographics -projectPath unity\SOTERRA-Tatico -executeMethod Soterra.Ferramentas.Lote.Verificar -logFile -
```

**Armadilha:** `foto` e `build` **não podem** usar `-nographics`. Sem
dispositivo de vídeo a câmera não tem o que renderizar e o PNG sai preto — é o
mesmo defeito do `snap` no headless do Chrome, por motivo diferente.

## Por que a cena é montada por código

Cena da Unity é um YAML grande e ilegível em diff, e quem escreve este projeto
não clica no Editor. `Bootstrap.Montar()` monta chão, obstáculos, herói, luz e
câmera em C#; `Lote.MontarCena()` grava o resultado como cena de verdade. Assim
o projeto cabe no Git e se revisa como se revisa código — e ainda dá para abrir
no Editor e apertar Play.

## O que este projeto responde, e o que não responde

**Responde:** como é trabalhar com iluminação, sombra e câmera de verdade; como
a Unity organiza cena e componente; quanto código custa a mesma regra nas duas
casas; e — o que mais importava — que dá para desenvolver aqui pelo terminal.

**Não responde:** se vale migrar. Migrar é **reescrever**: das ~45 mil linhas
de JS, o motor, o renderizador e a interface **não atravessam**.

**O que atravessa:** os **dados** (`js/core/data/*.js` são objetos literais —
viram JSON), a **regra** como especificação (`engine.js` é puro e legível), os
**modelos CC0** (na Unity entram sem base64 e sem briga com `file://`) e as
**decisões medidas** de equilíbrio.

## O que continua sendo só seu

Ativar licença, qualquer coisa que peça login — Asset Store inclusive. Não faço
login em conta nenhuma.
