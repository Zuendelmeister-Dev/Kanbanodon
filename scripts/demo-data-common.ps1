# Shared implementation for the two explicit demo-data maintenance commands.
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

    if ([string]::IsNullOrWhiteSpace($DockerPath)) {
        $dockerCommand = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue
        if ($dockerCommand) {
            $DockerPath = $dockerCommand.Source
        } else {
            $DockerPath = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
        }
    }
    if (-not (Test-Path -LiteralPath $DockerPath -PathType Leaf)) {
        throw 'Docker was not found. Install Docker Desktop or pass -DockerPath with the full executable path.'
    }

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
