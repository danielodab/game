<#
  Converte o acervo de personagens de Assets/Modelos/*.glb para
  Assets/Resources/elenco/*.fbx, que e de onde o `ModelosDeResources` carrega.

  Uso, da raiz do repositorio:
    powershell -File unity/SOTERRA-Tatico/Assets/Scripts/Cena/Ferramentas/converter_elenco.ps1

  O cenario (49 pecas de `Assets/Modelos/cenario/`) fica de fora: esta rodada e
  das UNIDADES, e o Palco desenha chao e obstaculo por conta. Quando o cenario
  entrar, e so acrescentar a pasta na lista.

  So o banco de animacao sai com as acoes baqueadas — o porque esta no cabecalho
  de glb_para_fbx.py.
#>
param(
  [switch]$ComAnimacaoNosPersonagens
)

$ErrorActionPreference = 'Stop'
$blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
if (-not (Test-Path $blender)) { throw "Blender nao encontrado em $blender" }

$aqui    = Split-Path -Parent $MyInvocation.MyCommand.Path
$roteiro = Join-Path $aqui 'glb_para_fbx.py'
$projeto = (Resolve-Path (Join-Path $aqui '..\..\..\..')).Path
$modelos = Join-Path $projeto 'Assets\Modelos'
$destino = Join-Path $projeto 'Assets\Resources\elenco'

New-Item -ItemType Directory -Force $destino | Out-Null

$bancoDeAnimacao = Join-Path $modelos 'animacoes\_anims.glb'

function Converter($glb, $fbx, $comAnimacao, $posar) {
  $args = @('-b', '--python', $roteiro, '--', $glb, $fbx)
  if ($comAnimacao) { $args += '--com-animacao' }
  if ($posar) { $args += @('--pose', $bancoDeAnimacao) }
  $p = Start-Process -FilePath $blender -ArgumentList $args -Wait -PassThru -NoNewWindow `
                     -RedirectStandardOutput ([System.IO.Path]::GetTempFileName())
  if ($p.ExitCode -ne 0) { throw "falhou: $glb" }
  Write-Host ("  ok  " + [System.IO.Path]::GetFileNameWithoutExtension($glb))
}

# TODOS pedem a pose: o roteiro sai fora sozinho quando o esqueleto nao e o da
# KayKit (os bichos do Quaternius ja chegam numa pose natural). Pedir para todos
# e mais seguro que manter aqui uma lista de quem e humanoide — lista assim
# envelhece calada no dia em que o acervo crescer.
foreach ($pasta in @('herois', 'monstros', 'chefes', 'invocacoes')) {
  foreach ($glb in Get-ChildItem (Join-Path $modelos $pasta) -Filter *.glb) {
    Converter $glb.FullName (Join-Path $destino ($glb.BaseName + '.fbx')) `
              $ComAnimacaoNosPersonagens $true
  }
}

# O banco de 30 clipes da KayKit, este SEMPRE com animacao: e dele que sai a
# pose de `idle`, e e dele que a rodada da animacao vai tirar o resto.
Converter $bancoDeAnimacao (Join-Path $destino '_anims.fbx') $true $false
