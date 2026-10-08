# Runs only a fake Docker command and temporary files; never touches containers.
$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('kanbanodon-demo-script-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$recordPath = Join-Path $testDirectory 'calls.jsonl'
$dockerMockPath = Join-Path $testDirectory 'fake docker.ps1'
$priorMockPath = $env:KANBANODON_DEMO_SCRIPT_TEST_LOG
$priorMockFailure = $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD
$priorMockRunFailure = $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN
$priorClear = $env:KANBANODON_CLEAR_TASK_DATA
$priorSeed = $env:KANBANODON_SEED_DEMO_DATA
$priorReset = $env:KANBANODON_RESET_DEMO_DATA

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Read-DockerCalls {
    if (-not (Test-Path -LiteralPath $recordPath)) { return @() }
    return @(Get-Content -LiteralPath $recordPath | ForEach-Object { ,(ConvertFrom-Json -InputObject $_) })
}

try {
    @'
ConvertTo-Json -InputObject @($args) -Compress | Add-Content -LiteralPath $env:KANBANODON_DEMO_SCRIPT_TEST_LOG
$global:LASTEXITCODE = 0
if ($args -contains 'build' -and $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD -eq 'true') {
    $global:LASTEXITCODE = 17
}
if ($args -contains 'run' -and $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN -eq 'true') {
    $global:LASTEXITCODE = 19
}
'@ | Set-Content -LiteralPath $dockerMockPath
    $env:KANBANODON_DEMO_SCRIPT_TEST_LOG = $recordPath
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD = 'false'
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN = 'false'
    # Even inherited dangerous startup flags must be overridden for the run.
    $env:KANBANODON_CLEAR_TASK_DATA = 'true'
    $env:KANBANODON_SEED_DEMO_DATA = 'true'
    $env:KANBANODON_RESET_DEMO_DATA = 'true'

    Push-Location $testDirectory
    try {
        & (Join-Path $repoDirectory 'scripts/clear-task-data.ps1') -DockerPath $dockerMockPath
        & (Join-Path $repoDirectory 'scripts/seed-demo-data.ps1') -DockerPath $dockerMockPath -SkipBuild
    } finally {
        Pop-Location
    }

    $calls = @(Read-DockerCalls)
    Assert-True ($calls.Count -eq 3) 'Expected build, clear one-shot run, then seed one-shot run.'
    Assert-True ($calls[0] -contains 'build') 'Clear must build the latest CLI by default.'
    foreach ($call in $calls) {
        Assert-True ($call[0] -eq 'compose') 'Command must use Docker Compose.'
        Assert-True ($call -contains $repoDirectory) 'Compose project directory must be absolute, independent of caller location.'
        Assert-True ($call -contains (Join-Path $repoDirectory 'docker-compose.yml')) 'Default Compose file must resolve in the repository.'
        Assert-True (-not ($call -contains 'up')) 'Helper must not replace the persistent application container.'
    }
    foreach ($call in @($calls[1], $calls[2])) {
        Assert-True ($call -contains '--rm' -and $call -contains '--no-deps') 'Maintenance run must be temporary and not start dependencies.'
        Assert-True ($call -contains '/app/kanbanodon' -and $call -contains '-prepare-demo-data') 'Maintenance run must invoke the explicit one-shot command.'
        Assert-True ($call -contains 'KANBANODON_RESET_DEMO_DATA=false') 'Legacy reset must be disabled regardless of inherited environment.'
    }
    Assert-True ($calls[1] -contains 'KANBANODON_CLEAR_TASK_DATA=true' -and $calls[1] -contains 'KANBANODON_SEED_DEMO_DATA=false') 'Clear must never seed.'
    Assert-True ($calls[2] -contains 'KANBANODON_CLEAR_TASK_DATA=false' -and $calls[2] -contains 'KANBANODON_SEED_DEMO_DATA=true') 'Seed must never clear.'
    Assert-True ($env:KANBANODON_CLEAR_TASK_DATA -eq 'true' -and $env:KANBANODON_SEED_DEMO_DATA -eq 'true' -and $env:KANBANODON_RESET_DEMO_DATA -eq 'true') 'Helpers must not mutate caller startup flags.'

    Clear-Content -LiteralPath $recordPath
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD = 'true'
    $failed = $false
    try {
        & (Join-Path $repoDirectory 'scripts/clear-task-data.ps1') -DockerPath $dockerMockPath
    } catch {
        $failed = $true
    }
    $calls = @(Read-DockerCalls)
    Assert-True ($failed -and $calls.Count -eq 1 -and $calls[0] -contains 'build') 'A failed build must stop before any data action.'

    Clear-Content -LiteralPath $recordPath
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD = 'false'
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN = 'true'
    $runFailure = ''
    try {
        & (Join-Path $repoDirectory 'scripts/seed-demo-data.ps1') -DockerPath $dockerMockPath -SkipBuild
    } catch {
        $runFailure = $_.Exception.Message
    }
    $calls = @(Read-DockerCalls)
    Assert-True ($runFailure -match 'preparation failed \(exit 19\)' -and $calls.Count -eq 1 -and $calls[0] -contains 'run') 'A failed maintenance run must report its failure and stop.'
    Assert-True ($env:KANBANODON_CLEAR_TASK_DATA -eq 'true' -and $env:KANBANODON_SEED_DEMO_DATA -eq 'true' -and $env:KANBANODON_RESET_DEMO_DATA -eq 'true') 'A failed run must not change caller startup flags.'
    Write-Host 'Demo-data script checks passed.' -ForegroundColor Green
} finally {
    $env:KANBANODON_DEMO_SCRIPT_TEST_LOG = $priorMockPath
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD = $priorMockFailure
    $env:KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN = $priorMockRunFailure
    $env:KANBANODON_CLEAR_TASK_DATA = $priorClear
    $env:KANBANODON_SEED_DEMO_DATA = $priorSeed
    $env:KANBANODON_RESET_DEMO_DATA = $priorReset
    if (Test-Path -LiteralPath $testDirectory) {
        $resolvedTestDirectory = (Resolve-Path -LiteralPath $testDirectory).ProviderPath
        $expectedTestDirectory = [IO.Path]::GetFullPath($testDirectory)
        $tempDirectoryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedTestDirectory.Equals($expectedTestDirectory, [StringComparison]::OrdinalIgnoreCase) -or
            -not $resolvedTestDirectory.StartsWith($tempDirectoryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path -Leaf $resolvedTestDirectory) -notmatch '^kanbanodon-demo-script-test-[a-f0-9]{32}$') {
            throw "Refusing to remove unexpected test directory: $resolvedTestDirectory"
        }
        Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force
    }
}
