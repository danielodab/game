# Receber o lote de um portal fechado (monstros, cenário, arte)

Os quatro portais fechados — **Fecho de Brasa** (`emberlock`), **Andaimes do
Vento** (`windscaffold`), **Mina Trêmula** (`quakemine`) e **Coração Partido**
(`brokenheart`) — abrem quando o lote deles entra. Este é o caminho, do mesmo
jeito que a Estufa e a Cisterna entraram, só que agora com ferramenta
genérica em vez de script copiado.

## O que o lote precisa ter

```
C:\Users\danie\Downloads\assets_ok\mapa\<Nome do calabouço>\
    monstros\<Nome do monstro>\<Nome do monstro> idle.glb
                               <Nome do monstro> walk.glb
                               <Nome do monstro> run.glb      (opcional)
                               <Nome do monstro> attack.glb
                               <Nome do monstro> hit.glb
                               <Nome do monstro> death.glb
    muros\   ...   (o kit de cenário: muros altos, pilar, marco, enfeites, chão)
```

O nome de cada monstro está em `tools/monstros/<id>.json` depois do passo 1.
Se a pasta ou o prefixo saírem diferentes, é só editar o manifesto.

## Os passos

1. **O manifesto** (lista os monstros do calabouço, lido do catálogo):
   ```bash
   python tools/embute_monstros.py --calabouco emberlock --manifesto
   ```
2. **O raio-X** (lê cada GLB e decide, pelo conteúdo, qual arquivo é a
   reação e qual é o ataque — em dez lotes o Meshy trocou os dois):
   ```bash
   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/embute_monstros.py -- --calabouco emberlock --raio-x
   ```
3. **A fusão** (um kit por monstro, textura 1024, `models-meshy-<id>.js`):
   ```bash
   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/embute_monstros.py -- --calabouco emberlock
   ```
4. **Ligar no jogo**: acrescente `'assets/embedded/models-meshy-emberlock.js'`
   na lista de modelos do `index.html` (ao lado de `models-meshy-cisterna.js`)
   e rode `python tools/extrai_assets.py` para o bundle servido.
5. **A régua**: abra `tests/bestiario.html?calabouco=emberlock`. Ela cobra kit
   próprio para todos, clipe por papel, porte entre 0,8 e 3,6 m e o chefe
   como o maior. Sem linha no `MONSTER_LOOK` o kit já veste sozinho em
   escala 1; o porte se acerta depois em `js/render3d/models3d_v2.js`
   (`MONSTER_LOOK`, campo `scale`), como foi feito na Cisterna.
6. **O cenário** (muros e enfeites do tema, para a batalha e para o
   cantinho do portal na praça): `tools/separa_cenario.py`,
   `tools/normaliza_muros_cisterna.py` e `tools/embute_cenario_cisterna.py`
   são o modelo — copie os dois últimos trocando `cistern` pelo tema do
   calabouço (`forge`, `scaffold`, `mine`, `heart`) e registre o catálogo
   em `JOGO.CENARIO[tema]` com os papéis `alto`, `pilar`, `marco`,
   `sotaque`, `sotaque_alto`, `chao`, `borda`.
7. **Abrir o portal**: tire o id de `JOGO.DATA.portaisFechados` em
   `js/core/data/dungeons.js`. O X vermelho some, a descida volta, o
   Calabouço do Dia e o Poço passam a contar com ele, e as peças dele
   deixam de vazar para os outros calabouços.
8. **Conferir**: `tests/bateria.html` (portais_fechados vai cobrar a lista
   nova — ajuste a contagem no teste) e uma foto da praça
   (`tests/prova_praca.html?dist=26&tilt=1.1&ang=0`).

## O que NÃO precisa mudar

- Itens: as 90 peças dos seis calabouços já têm ícone e já caem (as dos
  fechados vazam para os abertos até o portal abrir).
- Pets: as cartas do pet de cada calabouço já caem do chefe dele.
- Salas, layouts, feitiços e IA dos monstros: já existem para os seis.
