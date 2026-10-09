<#
.SYNOPSIS
Adds current example Epics, Sprints, planned tasks, and Backlog tasks.
.DESCRIPTION
Runs an explicit one-shot maintenance container. Existing tickets remain.
Boards already seeded are skipped; clear old data first to refresh their demo
dates. The first seed sets each board's demo Sprint cadence and names.
.PARAMETER SkipBuild
Use an already-built image that includes the -prepare-demo-data server option.
#>
[CmdletBinding()]
param(
    [string]$ComposeFile,
    [string]$DockerPath,
    [switch]$SkipBuild
)

. (Join-Path $PSScriptRoot 'demo-data-common.ps1')
Invoke-KanbanodonDemoData -Operation Seed -ComposeFile $ComposeFile -DockerPath $DockerPath -SkipBuild:$SkipBuild
