<#
  SOTERRA — atalhos do Unity em linha de comando.

  Existe porque o Editor da Unity é um programa de janela e este projeto é
  desenvolvido por linha de comando: sem estes atalhos, "compilou?", "passou?"
  e "como ficou?" só se responderiam clicando.

  Uso:
    .\unity\lote.ps1 verificar    # importa e compila; falha se o código quebrou
    .\unity\lote.ps1 testar       # testes EditMode; falha se algum teste caiu (unity/resultado.xml)
    .\unity\lote.ps1 cena         # grava Assets/Scenes/Tatico.unity montada
    .\unity\lote.ps1 foto         # renderiza um PNG da cena (precisa de vídeo)
    .\unity\lote.ps1 build        # player Windows em unity/Build/

  ARMADILHA: 'foto' e 'build' NÃO podem usar -nographics — sem dispositivo de
  vídeo a câmera não tem o que renderizar e o PNG sai preto.

  ARMADILHA: -runTests devolve código 0 mesmo com teste vermelho (visto no
  6000.5.8f1), então em 'testar' o veredito vem do resultado.xml, não do
  código de saída do Unity.
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

# Apaga o resultado da rodada anterior: se esta rodada nem chegar a escrever o
# XML (ex.: erro de compilação), um veredito velho não pode passar por atual.
$xmlResultado = Join-Path $PSScriptRoot 'resultado.xml'
if ($Acao -eq 'testar') { Remove-Item $xmlResultado -ErrorAction SilentlyContinue }

# Start-Process -Wait porque chamar o .exe direto devolve o prompt antes do fim,
# e aí o log ainda está pela metade quando alguém vai ler.
$p = Start-Process -FilePath $editor -ArgumentList $args -Wait -PassThru -NoNewWindow
Write-Host "código de saída: $($p.ExitCode)"
if (Test-Path $log) { Get-Content $log -Tail 25 }

# Em 'testar' o código de saída do Unity não é veredito (ver ARMADILHA no topo):
# ele sai 0 mesmo com teste vermelho. O veredito real está no resultado.xml.
# Só consultamos o XML quando o Unity saiu com 0 — saída diferente de 0 já é
# falha por si (ex.: o código nem compilou e os testes nem rodaram).
if ($Acao -eq 'testar' -and $p.ExitCode -eq 0) {
  if (-not (Test-Path $xmlResultado)) {
    Write-Host 'FALHA: resultado.xml não foi escrito — a rodada de testes não chegou ao veredito.'
    exit 1
  }
  # Load() respeita o encoding declarado no próprio XML; Get-Content no
  # PowerShell 5.1 leria em ANSI e estragaria nomes acentuados.
  $resultado = New-Object System.Xml.XmlDocument
  $resultado.Load($xmlResultado)
  $execucao = $resultado.DocumentElement   # o nó <test-run>
  if ([int]$execucao.failed -gt 0 -or $execucao.result -ne 'Passed') {
    Write-Host "FALHA: $($execucao.failed) de $($execucao.total) teste(s) caíram (result=$($execucao.result))"
    foreach ($caso in $resultado.SelectNodes('//test-case[@result="Failed"]')) {
      Write-Host "  FALHOU: $($caso.fullname)"
    }
    exit 1
  }
  Write-Host "testes: $($execucao.passed) de $($execucao.total) passaram"
}
exit $p.ExitCode
