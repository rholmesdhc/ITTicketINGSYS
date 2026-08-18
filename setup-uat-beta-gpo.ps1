<#
.SYNOPSIS
    Sets up a scoped GPO push of the UAT Caddy root CA to a specific group of
    beta-tester computers - not an org-wide push.

.DESCRIPTION
    Automates the parts of this that have solid, well-documented cmdlets:
    creating the security group, adding computer members, creating the GPO,
    configuring Security Filtering (the part that actually scopes this to
    just the beta group instead of everyone), and linking the GPO.

    Deliberately does NOT attempt to script the certificate import itself
    (Computer Configuration -> Public Key Policies -> Trusted Root
    Certification Authorities -> Import). That's only reachable through
    GPMC's COM automation interface, which is obscure and version-dependent
    enough that a wrong guess here could silently fail or leave the GPO in a
    bad state - worse than just doing this one step by hand, which takes
    about 30 seconds. The script pauses with exact instructions right where
    that step belongs.

.PARAMETER GroupName
    Name for the new security group. Must be a GLOBAL security group of
    COMPUTER accounts - the Trusted Root CA policy is a Computer
    Configuration setting, evaluated by machine, not by logged-in user.

.PARAMETER ComputerNames
    The beta testers' actual PC/laptop names (AD computer account names,
    not usernames) - e.g. @("DHC-LAPTOP-042", "DHC-DESK-118").

.PARAMETER GpoName
    Name for the new GPO.

.PARAMETER TargetOU
    Distinguished name of the OU (or domain root) to link the GPO to - must
    actually contain the computer objects above, since Security Filtering
    narrows WHO within the link applies the GPO, it doesn't make the GPO
    reachable somewhere it isn't linked at all.

.EXAMPLE
    .\setup-uat-beta-gpo.ps1 `
        -GroupName "GPO-UATBeta-Computers" `
        -ComputerNames @("DHC-LAPTOP-042", "DHC-DESK-118") `
        -GpoName "UAT Beta - Trusted Root CA" `
        -TargetOU "OU=Workstations,DC=deltahealthcenter,DC=org"

.NOTES
    Run on a domain controller or an RSAT-enabled admin workstation, as an
    account with rights to create AD groups and GPOs (Domain Admin, or
    delegated equivalent). Requires the ActiveDirectory and GroupPolicy
    PowerShell modules (part of RSAT).
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$GroupName,

    [Parameter(Mandatory)]
    [string[]]$ComputerNames,

    [Parameter(Mandatory)]
    [string]$GpoName,

    [Parameter(Mandatory)]
    [string]$TargetOU,

    [string]$CertPath = ".\caddy-uat-root-ca.crt"
)

$ErrorActionPreference = "Stop"

# --- Preflight: modules ---
foreach ($mod in "ActiveDirectory", "GroupPolicy") {
    if (-not (Get-Module -ListAvailable -Name $mod)) {
        throw "Module '$mod' isn't available - install RSAT: Active Directory Domain Services and Group Policy Management tools first."
    }
}
Import-Module ActiveDirectory
Import-Module GroupPolicy

if (-not (Test-Path $CertPath)) {
    throw "Certificate file not found at '$CertPath' - pass -CertPath, or copy caddy-uat-root-ca.crt next to this script."
}

# --- 1. Security group (computer accounts, not user accounts - see .DESCRIPTION) ---
$existingGroup = Get-ADGroup -Filter "Name -eq '$GroupName'" -ErrorAction SilentlyContinue
if ($existingGroup) {
    Write-Host "Group '$GroupName' already exists - reusing it." -ForegroundColor Yellow
} else {
    Write-Host "Creating security group '$GroupName'..." -ForegroundColor Cyan
    New-ADGroup -Name $GroupName -GroupScope Global -GroupCategory Security `
        -Description "Computers trusted to reach the UAT ticketing environment (beta program) - see setup-uat-beta-gpo.ps1"
    $existingGroup = Get-ADGroup -Filter "Name -eq '$GroupName'"
}

# --- 2. Add computer accounts ---
foreach ($name in $ComputerNames) {
    try {
        $computer = Get-ADComputer -Identity $name
        Add-ADGroupMember -Identity $existingGroup -Members $computer -ErrorAction Stop
        Write-Host "  Added $name" -ForegroundColor Green
    } catch {
        # Don't let one typo'd/missing computer name kill the whole run - report
        # it clearly and keep going, so the operator can fix just that one entry.
        Write-Warning "  Could not add '$name': $($_.Exception.Message)"
    }
}

# --- 3. GPO ---
$existingGpo = Get-GPO -Name $GpoName -ErrorAction SilentlyContinue
if ($existingGpo) {
    Write-Host "GPO '$GpoName' already exists - reusing it." -ForegroundColor Yellow
    $gpo = $existingGpo
} else {
    Write-Host "Creating GPO '$GpoName'..." -ForegroundColor Cyan
    $gpo = New-GPO -Name $GpoName -Comment "Trusts the UAT ticketing environment's self-signed cert (Caddy internal CA) - scoped to beta-tester computers only, see setup-uat-beta-gpo.ps1"
}

# --- 4. Security Filtering: THIS is what scopes it to just the beta group ---
# New GPOs default to applying to "Authenticated Users" for whatever OU
# they're linked to - remove that first, or this GPO silently applies to
# every computer in $TargetOU regardless of group membership.
Write-Host "Setting Security Filtering (removing default 'Authenticated Users', scoping to '$GroupName')..." -ForegroundColor Cyan
try {
    Set-GPPermission -Guid $gpo.Id -TargetName "Authenticated Users" -TargetType Group -PermissionLevel None -ErrorAction Stop
} catch {
    Write-Warning "  Couldn't remove 'Authenticated Users' (may already be removed): $($_.Exception.Message)"
}
Set-GPPermission -Guid $gpo.Id -TargetName $GroupName -TargetType Group -PermissionLevel GpoApply

# --- 5. Link the GPO ---
Write-Host "Linking GPO to '$TargetOU'..." -ForegroundColor Cyan
try {
    New-GPLink -Guid $gpo.Id -Target $TargetOU -ErrorAction Stop
} catch {
    if ($_.Exception.Message -like "*already*") {
        Write-Host "  Already linked there - fine." -ForegroundColor Yellow
    } else {
        throw
    }
}

# --- 6. The one manual step ---
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Magenta
Write-Host " Group, GPO, Security Filtering, and linking are done." -ForegroundColor Magenta
Write-Host " One manual step left - the certificate import itself:" -ForegroundColor Magenta
Write-Host "=================================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  1. Open Group Policy Management Console (gpmc.msc)"
Write-Host "  2. Find and edit '$GpoName'"
Write-Host "  3. Computer Configuration -> Policies -> Windows Settings ->"
Write-Host "     Security Settings -> Public Key Policies"
Write-Host "  4. Right-click 'Trusted Root Certification Authorities' -> Import"
Write-Host "  5. Browse to: $((Resolve-Path $CertPath).Path)"
Write-Host "  6. Complete the wizard (default 'Trusted Root Certification"
Write-Host "     Authorities' store is correct - just click through)"
Write-Host ""
Write-Host "Then, on a beta test machine: gpupdate /force, then verify with:"
Write-Host "  certmgr.msc -> (as that machine's local admin) Local Computer \"
Write-Host "  -> Trusted Root Certification Authorities -> look for"
Write-Host "  'Caddy Local Authority - 2026 ECC Root'"
Write-Host ""
