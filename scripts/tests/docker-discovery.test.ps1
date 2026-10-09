# Docker discovery tests use only fake files and command metadata; no Docker run.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'demo-data-common.ps1')
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('kanbanodon-docker-discovery-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$priorLocalAppData = $env:LOCALAPPDATA
$priorProgramW6432 = $env:ProgramW6432
$priorProgramFiles = $env:ProgramFiles
$priorProgramFilesX86 = ${env:ProgramFiles(x86)}
$script:discoveryCommandResults = @()
$script:discoveryCommandCalls = 0

function Get-Command {
    [CmdletBinding()]
    param([string]$Name, [string]$CommandType, [switch]$All)
    if ($Name -ne 'docker' -or $CommandType -ne 'Application' -or -not $All) {
        throw 'Docker discovery must inspect every Application match.'
    }
    $script:discoveryCommandCalls++
    return $script:discoveryCommandResults
}
function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function New-FakeExecutable([string]$Path) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    'discovery fixture only; not an executable' | Set-Content -LiteralPath $Path
    return (Resolve-Path -LiteralPath $Path).ProviderPath
}
function Assert-DockerPath([string]$Expected) {
    $resolved = @(Resolve-KanbanodonDockerPath)
    Assert-True ($resolved.Count -eq 1 -and $resolved[0] -is [string]) 'Docker discovery must return exactly one string path.'
    Assert-True ($resolved[0] -eq $Expected) "Expected Docker at $Expected; got $resolved."
}

try {
    $wrapper = New-FakeExecutable (Join-Path $testDirectory 'Desktop bin\docker')
    $executable = New-FakeExecutable (Join-Path $testDirectory 'Desktop bin\docker.exe')
    $secondExecutable = New-FakeExecutable (Join-Path $testDirectory 'Other bin\docker.exe')
    $script:discoveryCommandResults = @(
        [pscustomobject]@{ Source = $wrapper },
        [pscustomobject]@{ Source = $executable },
        [pscustomobject]@{ Source = $secondExecutable }
    )
    Assert-DockerPath $executable

    $explicit = New-FakeExecutable (Join-Path $testDirectory 'Explicit docker path.exe')
    $callsBeforeExplicit = $script:discoveryCommandCalls
    $resolvedExplicit = Resolve-KanbanodonDockerPath -DockerPath $explicit
    Assert-True ($resolvedExplicit -eq $explicit -and $script:discoveryCommandCalls -eq $callsBeforeExplicit) 'Explicit DockerPath must take precedence over automatic discovery.'
    $invalidExplicit = $false
    try { $null = Resolve-KanbanodonDockerPath -DockerPath (Join-Path $testDirectory 'missing.exe') }
    catch { $invalidExplicit = $_.Exception.Message -match 'supplied -DockerPath' }
    Assert-True $invalidExplicit 'An invalid explicit path must fail clearly instead of choosing another installation.'

    $script:discoveryCommandResults = @(
        [pscustomobject]@{ Source = (Join-Path $testDirectory 'stale docker.exe') },
        [pscustomobject]@{ Source = ''; Path = $secondExecutable }
    )
    Assert-DockerPath $secondExecutable

    $env:LOCALAPPDATA = Join-Path $testDirectory 'Per user installs'
    $env:ProgramW6432 = Join-Path $testDirectory 'Program Files 64'
    $env:ProgramFiles = Join-Path $testDirectory 'Program Files visible to shell'
    ${env:ProgramFiles(x86)} = Join-Path $testDirectory 'Program Files 32'
    $localExecutable = New-FakeExecutable (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe')
    $machineExecutable = New-FakeExecutable (Join-Path $env:ProgramW6432 'Docker\Docker\resources\bin\docker.exe')
    $x86Executable = New-FakeExecutable (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\resources\bin\docker.exe')
    $script:discoveryCommandResults = @([pscustomobject]@{ Source = $wrapper })
    Assert-DockerPath $localExecutable

    $env:LOCALAPPDATA = Join-Path $testDirectory 'No per user installation'
    Assert-DockerPath $machineExecutable
    $env:ProgramW6432 = ''
    $env:ProgramFiles = ''
    Assert-DockerPath $x86Executable

    ${env:ProgramFiles(x86)} = ''
    $script:discoveryCommandResults = @()
    $notFound = $false
    try { $null = Resolve-KanbanodonDockerPath }
    catch { $notFound = $_.Exception.Message -match 'Docker was not found' }
    Assert-True $notFound 'Missing Docker must report an actionable executable-path hint.'
    Write-Host 'Docker discovery checks passed.' -ForegroundColor Green
} finally {
    $env:LOCALAPPDATA = $priorLocalAppData
    $env:ProgramW6432 = $priorProgramW6432
    $env:ProgramFiles = $priorProgramFiles
    ${env:ProgramFiles(x86)} = $priorProgramFilesX86
    if (Test-Path -LiteralPath $testDirectory) {
        $resolvedTestDirectory = (Resolve-Path -LiteralPath $testDirectory).ProviderPath
        $expectedTestDirectory = [IO.Path]::GetFullPath($testDirectory)
        $tempDirectoryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedTestDirectory.Equals($expectedTestDirectory, [StringComparison]::OrdinalIgnoreCase) -or
            -not $resolvedTestDirectory.StartsWith($tempDirectoryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path -Leaf $resolvedTestDirectory) -notmatch '^kanbanodon-docker-discovery-test-[a-f0-9]{32}$') {
            throw "Refusing to remove unexpected test directory: $resolvedTestDirectory"
        }
        Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force
    }
}
