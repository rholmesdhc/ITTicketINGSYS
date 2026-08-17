# Keeps an SSH *local* forward alive from this PC to the JARVIS/Jack VM, so
# the ticketing backend (running on this PC) can reach Jack's
# /api/classify-ticket-priority at 127.0.0.1:18080 -> forwarded over SSH ->
# 127.0.0.1:8080 on the VM.
#
# Opposite direction from reverse-tunnel-watchdog.ps1 (which forwards the
# VM's local port back to this PC's ticketing backend), but the same root
# cause: verified live 2026-08-17 that the office network only trusts the
# already-established SSH channel between these two hosts (port 22), not
# arbitrary new ports in either direction -- a direct PC -> VM:8080 request
# TCP-timed-out (silent drop) even after Jack's web server was rebound to
# 0.0.0.0 and a UFW rule opened for it. Both of those changes were reverted
# once this tunnel was confirmed working, since they turned out to add
# exposure without adding reachability.
#
# Restarts ssh.exe automatically if it dies (network blip, VM reboot, etc.).

$logFile = Join-Path $PSScriptRoot "jack-callback-tunnel.log"

while ($true) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting local forward to Jack..." | Out-File -FilePath $logFile -Append -Encoding utf8
    & ssh -N `
        -o ExitOnForwardFailure=yes `
        -o ServerAliveInterval=30 `
        -o ServerAliveCountMax=3 `
        -o StrictHostKeyChecking=accept-new `
        -L 18080:127.0.0.1:8080 `
        rholmes@10.4.2.10 2>> $logFile
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Tunnel exited (code $LASTEXITCODE) -- reconnecting in 5s" | Out-File -FilePath $logFile -Append -Encoding utf8
    Start-Sleep -Seconds 5
}
