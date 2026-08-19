<#
  Converte o env-kit de Assets/Modelos/cenario/*.glb para
  Assets/Resources/cenario/*.fbx, que e de onde `PecasDeResources` carrega.

  Uso, da raiz do repositorio:
    powershell -File unity/SOTERRA-Tatico/Assets/Scripts/Cena/Ferramentas/converter_cenario.ps1

  POR QUE ISTO EXISTE
    A Unity 6 nao le `.glb` sem `com.unity.cloud.gltfast`, e `Packages/` nao e
    do dono deste diretorio. O Blender le glb e escreve fbx, entao a ponte e
    ele — a mesma de `converter_elenco.ps1`, e pelo mesmo motivo.

  SEM ANIMACAO e SEM POSE, ao contrario do elenco: parede nao tem esqueleto.
  Uma tocha acesa aqui e geometria parada; o fogo, quando entrar, e efeito.

  As 49 pecas dividem UM material e UM atlas (`dungeon_texture.png`) — foi
  conferido lendo o bloco JSON dos glb. E isso que deixa a sala inteira caber
  em meia duzia de chamadas de desenho: malha combinada por TINTA, nao por
  casa. Ver `Cenario.Montar`.
#>
$ErrorActionPreference = 'Stop'
$blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
if (-not (Test-Path $blender)) { throw "Blender nao encontrado em $blender" }

$aqui    = Split-Path -Parent $MyInvocation.MyCommand.Path
$roteiro = Join-Path $aqui 'glb_para_fbx.py'
$projeto = (Resolve-Path (Join-Path $aqui '..\..\..\..')).Path
$origem  = Join-Path $projeto 'Assets\Modelos\cenario'
$destino = Join-Path $projeto 'Assets\Resources\cenario'

New-Item -ItemType Directory -Force $destino | Out-Null

$n = 0
foreach ($glb in Get-ChildItem $origem -Filter *.glb) {
  $fbx = Join-Path $destino ($glb.BaseName + '.fbx')
  $p = Start-Process -FilePath $blender -Wait -PassThru -NoNewWindow `
       -ArgumentList @('-b','--python',$roteiro,'--',$glb.FullName,$fbx) `
       -RedirectStandardOutput ([System.IO.Path]::GetTempFileName())
  if ($p.ExitCode -ne 0) { throw "falhou: $($glb.Name)" }
  $n++
  Write-Host ("  ok  " + $glb.BaseName)
}
Write-Host "$n pecas convertidas em $destino"
