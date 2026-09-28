# Baixa da Umapyoi os dados usados pelas landing pages e grava um JSON por
# personagem em data/<id>.json. As páginas leem esse arquivo local em vez de
# fazer 5 requisições à API a cada visita.
#
# Uso (na raiz do projeto):  powershell -ExecutionPolicy Bypass -File scripts/update-data.ps1

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Api = "https://umapyoi.net/api/v1"
$OutDir = Join-Path $PSScriptRoot "..\data"

# id da personagem na Umapyoi => game id (usado pelos support cards)
$Characters = [ordered]@{
  5474  = 1059  # Mejiro Dober   (index.html)
  5191  = 1033  # Admire Vega    (ayabe.html)
  5509  = 1069  # Sakura Chiyono O (chiyo.html)
  7518  = 1087  # Aston Machan   (machan.html)
  10013 = 1091  # Vivlos         (vivlos.html)
}

$Client = New-Object System.Net.WebClient
$Client.Encoding = [Text.Encoding]::UTF8
$Client.Headers.Add("Accept", "application/json")

function Get-Raw([string]$Path) {
  $text = $Client.DownloadString("$Api/$Path").Trim()
  $null = $text | ConvertFrom-Json  # garante que é JSON válido antes de gravar
  return $text
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$Utf8 = New-Object System.Text.UTF8Encoding $false

foreach ($entry in $Characters.GetEnumerator()) {
  $id = $entry.Key
  $gameId = $entry.Value
  Write-Host "Personagem $id..."

  $character = Get-Raw "character/$id"
  $images = Get-Raw "character/images/$id"
  $supports = Get-Raw "support/character/$gameId"

  $voice = "null"
  $voiceIds = @(Get-Raw "va/character/$id" | ConvertFrom-Json)
  if ($voiceIds.Count) {
    $first = $voiceIds[0]
    $voiceId = if ($first -is [Management.Automation.PSCustomObject]) { $first.id } else { $first }
    $voice = Get-Raw "va/$voiceId"
  }

  $updated = (Get-Date).ToString("yyyy-MM-dd")
  $json = "{`n  ""updated"": ""$updated"",`n  ""character"": $character,`n  ""images"": $images,`n  ""supports"": $supports,`n  ""voice"": $voice`n}`n"
  [IO.File]::WriteAllText((Join-Path $OutDir "$id.json"), $json, $Utf8)
}

Write-Host "Pronto: $($Characters.Count) arquivos em data/"
