# Keeps an SSH reverse tunnel alive from this PC to the JARVIS/Jack VM, so
# Jack's ticketing MCP server (running on the VM) can reach this PC's
# ticketing backend at 127.0.0.1:8005 via the VM's own 127.0.0.1:18005 --
# without needing the network to allow VM-initiated connections into this
# PC's subnet (it doesn't; see 2026-08-11 investigation: requests from the
# VM reached the backend and got a 200, but the response never routed back).
# SSH already works PC -> VM, so the tunnel rides that direction instead.
#
# Restarts ssh.exe automatically if it dies (network blip, VM reboot, etc.)
# rather than leaving the ticketing feature silently dead until someone
# notices. Logs each (re)start so a persistent failure is visible.

$logFile = Join-Path $PSScriptRoot "reverse-tunnel.log"

while ($true) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting reverse tunnel..." | Out-File -FilePath $logFile -Append -Encoding utf8
    & ssh -N `
        -o ExitOnForwardFailure=yes `
        -o ServerAliveInterval=30 `
        -o ServerAliveCountMax=3 `
        -o StrictHostKeyChecking=accept-new `
        -R 18005:127.0.0.1:8005 `
        rholmes@10.4.2.10 2>> $logFile
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Tunnel exited (code $LASTEXITCODE) -- reconnecting in 5s" | Out-File -FilePath $logFile -Append -Encoding utf8
    Start-Sleep -Seconds 5
}
