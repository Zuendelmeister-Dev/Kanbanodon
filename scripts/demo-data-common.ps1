# Shared implementation for the two explicit demo-data maintenance commands.
function Resolve-KanbanodonDockerPath {
    [CmdletBinding()]
    param([string]$DockerPath)

    if (-not [string]::IsNullOrWhiteSpace($DockerPath)) {
        if (-not (Test-Path -LiteralPath $DockerPath -PathType Leaf)) {
            throw "Docker executable was not found at the supplied -DockerPath: $DockerPath"
        }
        return (Resolve-Path -LiteralPath $DockerPath).ProviderPath
    }

    # Docker Desktop installs both docker.exe and an extensionless shell wrapper.
    # Get-Command can return both: inspect each path, never stringify a collection.
    $commandPaths = @()
    foreach ($command in @(Get-Command docker -CommandType Application -All -ErrorAction SilentlyContinue)) {
        $candidate = [string]$command.Source
        if ([string]::IsNullOrWhiteSpace($candidate)) { $candidate = [string]$command.Path }
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $commandPaths += $candidate
        }
    }
    foreach ($candidate in $commandPaths) {
        if ([IO.Path]::GetExtension($candidate) -ieq '.exe') {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }

    $desktopCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        foreach ($relativePath in @(
            'Programs\DockerDesktop\resources\bin\docker.exe',
            'Docker\resources\bin\docker.exe',
            'Programs\Docker\Docker\resources\bin\docker.exe',
            'Docker\Docker\resources\bin\docker.exe'
        )) {
            $desktopCandidates += Join-Path $env:LOCALAPPDATA $relativePath
        }
    }
    foreach ($installRoot in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not [string]::IsNullOrWhiteSpace($installRoot)) {
            $desktopCandidates += Join-Path $installRoot 'Docker\Docker\resources\bin\docker.exe'
        }
    }
    foreach ($candidate in $desktopCandidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }

    foreach ($candidate in $commandPaths) {
        $extension = [IO.Path]::GetExtension($candidate)
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $extension -ieq '.cmd' -or $extension -ieq '.bat') {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }
    throw 'Docker was not found. Install Docker Desktop or pass -DockerPath with the full docker.exe path.'
}

function Invoke-KanbanodonDemoData {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Clear', 'Seed')]
        [string]$Operation,
        [string]$ComposeFile,
        [string]$DockerPath,
        [switch]$SkipBuild
    )

    $ErrorActionPreference = 'Stop'
    $repoDirectory = Split-Path -Parent $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($ComposeFile)) {
        $ComposeFile = Join-Path $repoDirectory 'docker-compose.yml'
    }
    $resolvedComposeFile = (Resolve-Path -LiteralPath $ComposeFile).ProviderPath
    if (-not (Test-Path -LiteralPath $resolvedComposeFile -PathType Leaf)) {
        throw "Compose file is not a file: $resolvedComposeFile"
    }

    $DockerPath = Resolve-KanbanodonDockerPath -DockerPath $DockerPath

    $composeArguments = @('compose', '--project-directory', $repoDirectory, '--file', $resolvedComposeFile)
    if (-not $SkipBuild) {
        Write-Host 'Building the current Kanbanodon image...'
        & $DockerPath @composeArguments build kanbanodon
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose build failed (exit $LASTEXITCODE). No data preparation command was run."
        }
    }

    $clearValue = 'false'
    $seedValue = 'false'
    if ($Operation -eq 'Clear') {
        $clearValue = 'true'
        Write-Host 'Deleting every ticket and sprint plan in the Compose database; accounts and boards remain.' -ForegroundColor Yellow
    } else {
        $seedValue = 'true'
        Write-Host 'Adding current demo Epics, Sprints, planned tasks, and Backlog tasks to unseeded boards.'
    }
    $maintenanceArguments = @(
        'run', '--rm', '--no-deps',
        '--env', "KANBANODON_CLEAR_TASK_DATA=$clearValue",
        '--env', "KANBANODON_SEED_DEMO_DATA=$seedValue",
        '--env', 'KANBANODON_RESET_DEMO_DATA=false',
        'kanbanodon', '/app/kanbanodon', '-prepare-demo-data'
    )
    & $DockerPath @composeArguments @maintenanceArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Demo data preparation failed (exit $LASTEXITCODE). Check the server error above before retrying."
    }
    Write-Host 'Finished. The one-shot container has exited; the running application keeps its existing startup flags.' -ForegroundColor Green
    Write-Host 'Refresh the browser to load the updated tasks and Sprints.'
}
