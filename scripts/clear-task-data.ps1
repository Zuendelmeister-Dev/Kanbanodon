<#
.SYNOPSIS
Deletes all tickets and sprint plans in the Kanbanodon Compose database.
.DESCRIPTION
Runs an explicit one-shot maintenance container. Accounts, boards, workflow
columns, and access settings remain. It does not seed example tasks.
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
Invoke-KanbanodonDemoData -Operation Clear -ComposeFile $ComposeFile -DockerPath $DockerPath -SkipBuild:$SkipBuild
