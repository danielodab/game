# SOTERRA — prova em Unity, para comparar

Isto **não é o jogo**. É a grade tática mínima — chão, obstáculos, alcance de
passo e clique para andar — escrita em C# com **a mesma regra** do jogo em JS,
para você sentir a diferença de engenharia sem que a regra mude junto.

Se a cor, a câmera e a distância fossem diferentes, você não saberia o que está
julgando. Por isso a paleta é a mesma de `DATA.classes`, o enquadramento é o
mesmo 3/4, e a distância é Manhattan, como no motor de verdade.

## Como abrir (é tudo o que precisa de mouse)

1. No **Unity Hub**, aba *Installs* → *Install Editor* → **2022 LTS** ou mais
   novo. (Você já tem o Hub; falta um Editor.)
2. Aba *Projects* → *Add* → aponte para esta pasta
   (`unity/SOTERRA-Tatico`). O Unity gera sozinho o que falta na primeira
   abertura — `Library/`, `ProjectSettings/`, os `.meta`.
3. Dentro do Editor: **File › New Scene › Basic (URP)**.
4. **GameObject › Create Empty**. Com ele selecionado, arraste
   `Assets/Scripts/Bootstrap.cs` para a janela *Inspector*.
5. **Play**.

A cena inteira — chão, obstáculos, herói, luz e câmera — é montada por código
no `Bootstrap`. Foi de propósito: cena da Unity é um YAML grande e ilegível em
diff, e eu não consigo clicar no Editor. Assim o projeto cabe no Git e dá para
revisar como se revisa código.

## O que dá para fazer

- **Clicar numa casa acesa** — o herói anda e desconta PP por passo.
- **ESPAÇO** — encerra o turno e devolve os PP.
- O realce sob o cursor acompanha o mouse.

O alcance é busca em largura, não distância crua: um corredor em L custa mais
do que a linha reta sugere, e sem isso o jogador clicaria do outro lado da
parede. É a mesma decisão que o motor em JS toma.

## O que este projeto responde, e o que não responde

**Responde:** como é trabalhar com iluminação, sombra e câmera de verdade; como
a Unity organiza cena e componente; quanto código custa a mesma regra nas duas
casas.

**Não responde:** se vale migrar. Migrar é **reescrever** — os ~15 mil linhas do
motor de batalha, do renderizador e da interface não atravessam. O que
atravessaria são os **dados** (classes, 171 feitiços, 107 formas de fusão, 90
itens — objetos JS que viram JSON numa tarde) e os **modelos CC0**, que na Unity
entram com menos briga do que no `file://`.

## O que eu consigo fazer aqui sem você

Assim que houver um Editor instalado, consigo rodar em modo lote, igual já faço
com o Blender:

```bash
Unity.exe -batchmode -quit -projectPath "C:\Users\danie\Documents\Jogo\unity\SOTERRA-Tatico" -executeMethod Soterra.Build.Tudo
```

E rodar os testes lendo o resultado:

```bash
Unity.exe -batchmode -runTests -testPlatform EditMode -testResults resultado.xml
```

O que continua **só seu**: clicar no Editor, ativar a licença e qualquer coisa
que peça login — Asset Store inclusive. Não faço login em conta nenhuma.
