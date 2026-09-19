param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$Python = 'python',
    [switch]$SkipDependencies
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot 'artifacts\speech-runtime'
$runtimePython = Join-Path $runtimeDir 'Scripts\python.exe'
if (!$SkipDependencies) {
    if (!(Test-Path -LiteralPath $runtimePython)) {
        & $Python -m venv --without-pip $runtimeDir
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated Python runtime.' }
    }
    & $Python -m pip --python $runtimePython install --index-url https://pypi.org/simple --upgrade -r (Join-Path $PSScriptRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install audio dependencies. Install pip for your Python and retry.' }
}
if (!(Test-Path -LiteralPath $runtimePython)) { throw 'Audio runtime not found.' }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer and restart Chrome before continuing.' }
$hostScript = Join-Path $PSScriptRoot 'host.py'
$launcher = Join-Path $runtimeDir 'sentence-audio.cmd'
$launcherText = "@echo off`r`n`"$runtimePython`" -u `"$hostScript`" %*`r`n"
[IO.File]::WriteAllText($launcher, $launcherText, [Text.Encoding]::Default)
$manifestPath = Join-Path $runtimeDir 'com.sentence.audio.json'
$manifest = @{ name='com.sentence.audio'; description='Sentence video audio preparation'; path=$launcher; type='stdio'; allowed_origins=@("chrome-extension://$ExtensionId/") }
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
foreach ($browserKey in @('Google\Chrome', 'Microsoft\Edge')) {
    $key = "HKCU:\Software\$browserKey\NativeMessagingHosts\com.sentence.audio"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifestPath
}
Write-Output "Installed Sentence audio helper for extension $ExtensionId. Reload the extension and click Check local helper."
