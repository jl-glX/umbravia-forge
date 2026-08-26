[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("commercial")]
  [string]$Application,

  [ValidatePattern("^https://")]
  [string]$BaseUrl = "https://www.umbraviaforge.com",

  [string]$InstallRoot = "",

  [switch]$TestMode,
  [switch]$Launch,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$customInstallRoot = -not [string]::IsNullOrWhiteSpace($InstallRoot)
if ($customInstallRoot -and -not $TestMode) {
  throw "InstallRoot solo se admite con TestMode. La instalacion y desinstalacion reales usan el directorio seguro del producto."
}
if ($TestMode -and $Uninstall) {
  throw "TestMode no puede combinarse con Uninstall."
}
if ($TestMode -and $Launch) {
  throw "TestMode no puede combinarse con Launch."
}
$product = @{
  Name = "Umbravia Forge"
  Slug = "Umbravia-Forge"
  Path = "/"
}

if (-not $customInstallRoot) {
  $safeInstallRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $env:LOCALAPPDATA "Programs\Umbravia Forge Web Apps")
  )
  $InstallRoot = Join-Path $safeInstallRoot $product.Slug
}
$installDirectory = [System.IO.Path]::GetFullPath($InstallRoot)
$startMenuDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Umbravia Forge"
$desktopDirectory = [Environment]::GetFolderPath("Desktop")
$shortcutName = "$($product.Name).lnk"
$url = ([Uri]::new([Uri]::new($BaseUrl.TrimEnd("/")), $product.Path)).AbsoluteUri

function Resolve-EdgePath {
  $roots = @($env:ProgramFiles, $env:LOCALAPPDATA)
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    $roots = @(${env:ProgramFiles(x86)}) + $roots
  }
  $candidates = $roots |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { Join-Path $_ "Microsoft\Edge\Application\msedge.exe" }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  throw "Microsoft Edge no esta instalado o no se ha encontrado en una ubicacion admitida."
}

function Remove-InstalledApp {
  $safePrefix = $safeInstallRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $installDirectory.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "La ruta de desinstalacion queda fuera del directorio autorizado."
  }
  $targets = @(
    (Join-Path $startMenuDirectory $shortcutName),
    (Join-Path $desktopDirectory $shortcutName)
  )
  foreach ($target in $targets) {
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      Remove-Item -LiteralPath $target -Force
    }
  }
  if (Test-Path -LiteralPath $installDirectory -PathType Container) {
    Remove-Item -LiteralPath $installDirectory -Recurse -Force
  }
  Write-Host "$($product.Name) se ha retirado del perfil actual."
}

if ($Uninstall) {
  Remove-InstalledApp
  exit 0
}

$edgePath = Resolve-EdgePath
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
$iconPath = $edgePath
$manifest = [ordered]@{
  schemaVersion = 1
  application = $Application
  name = $product.Name
  url = $url
  runtime = "Microsoft Edge app mode"
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  storesCredentials = $false
  testPackage = $true
  launchRequested = [bool]$Launch
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDirectory "installation.json") -Encoding UTF8

if ($TestMode) {
  Write-Host "Prueba de instalacion completada en $installDirectory"
  exit 0
}

New-Item -ItemType Directory -Path $startMenuDirectory -Force | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @(
  (Join-Path $startMenuDirectory $shortcutName),
  (Join-Path $desktopDirectory $shortcutName)
)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $edgePath
  $shortcut.Arguments = "--app=`"$url`" --start-maximized"
  $shortcut.WorkingDirectory = Split-Path $edgePath
  $shortcut.IconLocation = "$iconPath,0"
  $shortcut.Description = "$($product.Name) - acceso web instalado"
  $shortcut.Save()
}

Write-Host "$($product.Name) se ha instalado para el usuario actual."
Write-Host "La aplicacion usa $url y no guarda credenciales dentro del paquete."
if ($Launch) {
  try {
    Start-Process -FilePath $edgePath -ArgumentList @(
      "--app=$url",
      "--start-maximized"
    )
    Write-Host "$($product.Name) se ha abierto en Microsoft Edge."
  } catch {
    Write-Warning "La instalacion termino, pero no se pudo abrir la aplicacion. Usa el acceso directo creado."
  }
}
