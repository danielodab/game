<#
  SOTERRA — atalhos do Unity em linha de comando.

  Existe porque o Editor da Unity é um programa de janela e este projeto é
  desenvolvido por linha de comando: sem estes atalhos, "compilou?", "passou?"
  e "como ficou?" só se responderiam clicando.

  Uso:
    .\unity\lote.ps1 verificar    # importa e compila; falha se o código quebrou
    .\unity\lote.ps1 testar       # testes EditMode, resultado em unity/resultado.xml
    .\unity\lote.ps1 cena         # grava Assets/Scenes/Tatico.unity montada
    .\unity\lote.ps1 foto         # renderiza um PNG da cena (precisa de vídeo)
    .\unity\lote.ps1 build        # player Windows em unity/Build/

  ARMADILHA: 'foto' e 'build' NÃO podem usar -nographics — sem dispositivo de
  vídeo a câmera não tem o que renderizar e o PNG sai preto.
#>
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('verificar','testar','cena','foto','build')]
  [string]$Acao,
  [string]$Saida = 'foto.png',
  [int]$Largura = 1280,
  [int]$Altura = 800
)

$ErrorActionPreference = 'Stop'
$editor  = 'C:\Program Files\Unity\Hub\Editor\6000.5.8f1\Editor\Unity.exe'
$projeto = Join-Path $PSScriptRoot 'SOTERRA-Tatico'
$log     = Join-Path $PSScriptRoot 'lote.log'

if (-not (Test-Path $editor)) { throw "Editor não encontrado em $editor (instale pelo Unity Hub)" }

$comum = @('-batchmode','-projectPath',$projeto,'-logFile',$log)

switch ($Acao) {
  'verificar' { $args = $comum + @('-quit','-nographics','-executeMethod','Soterra.Ferramentas.Lote.Verificar') }
  'cena'      { $args = $comum + @('-quit','-nographics','-executeMethod','Soterra.Ferramentas.Lote.MontarCena') }
  'foto'      { $args = $comum + @('-quit','-executeMethod','Soterra.Ferramentas.Lote.Foto',
                                   '-foto',(Join-Path $PSScriptRoot $Saida),'-largura',$Largura,'-altura',$Altura) }
  'testar'    { $args = $comum + @('-runTests','-testPlatform','EditMode','-nographics',
                                   '-testResults',(Join-Path $PSScriptRoot 'resultado.xml')) }
  'build'     { $args = $comum + @('-quit','-executeMethod','Soterra.Ferramentas.Lote.BuildWindows') }
}

# Start-Process -Wait porque chamar o .exe direto devolve o prompt antes do fim,
# e aí o log ainda está pela metade quando alguém vai ler.
$p = Start-Process -FilePath $editor -ArgumentList $args -Wait -PassThru -NoNewWindow
Write-Host "código de saída: $($p.ExitCode)"
if (Test-Path $log) { Get-Content $log -Tail 25 }
exit $p.ExitCode
