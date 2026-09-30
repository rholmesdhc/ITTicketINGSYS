# UAT VM Runbook

**Status:** Reverse-engineered from the live VM, 2026-09-21 - not a
historical record.
**Scope:** How to build a VM that runs this project's UAT environment,
not a recollection of how the current one (`it-ticketing-uat`,
`10.4.1.89`) actually came to be - no Terraform/Ansible/cloud-init
exists in this repo, and nothing here was captured at the time the
current box was created. Every step below was confirmed by inspecting
the running VM directly (`docker ps`, the real `Caddyfile`, the
runner's own registration file, etc.), not assumed.

If you're rebuilding UAT itself, this is accurate. If you're using it
as a template for something else (a second UAT-like environment, a
pre-Azure reference), the Proxmox-specific parts in step 1 need your
own environment's answers - node, storage pool, network bridge - none
of which this doc has visibility into.

## What you're building

A single Ubuntu VM running four Docker containers via Compose - Caddy
(reverse proxy/TLS), the frontend and backend app images (pulled from
GHCR), and Postgres - plus a GitHub Actions self-hosted runner that
GitHub dispatches this project's `deploy-uat.yml` deploy job to
directly on the box.

Confirmed current specs (not prescriptive minimums, just what's
actually running today): **Ubuntu 24.04.4 LTS**, 4 vCPU, 7.8 GiB RAM, a
58 GB disk (18% used) - comfortable for an app this size, not
particularly tight.

## 1. Create the VM in Proxmox

Proxmox-specific - fill in your own node/storage/bridge, this doc can't
know them:

1. In the Proxmox web UI: **Create VM** (or `qm create <vmid> ...` on
   the Proxmox host itself if you prefer the CLI).
2. **OS**: Ubuntu Server 24.04 LTS ISO, or clone from a cloud-init-ready
   24.04 template if one already exists in your cluster (faster,
   consistent with anything else built that way).
3. **System**: default is fine; enable the QEMU Guest Agent if your
   cluster's other VMs do (lets Proxmox see the VM's real IP/status).
4. **Disk**: 58 GB+ on whichever storage pool your other VMs use -
   matches the current box; give it headroom if you expect Postgres
   data or screenshot uploads to grow meaningfully over time.
5. **CPU/Memory**: 4 cores / 8 GiB matches the current box comfortably.
6. **Network**: attach to whatever bridge/VLAN puts it on the same
   private network as `10.4.1.89` today (or wherever you want the new
   one reachable from) - it needs to be reachable both by whoever
   manages it over SSH and by the GitHub Actions runner's own outbound
   connection to GitHub.
7. Install Ubuntu (or boot the cloned template) and complete first-boot
   setup: hostname, an admin user (the current box uses `ubuntu`),
   your SSH public key authorized for that user.

## 2. Base OS setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg
```

Passwordless `sudo` for the admin user is in use on the current box
(confirmed - `sudo -n whoami` succeeds without a password prompt) -
decide deliberately whether you want that here too, it's a real
security tradeoff, not just a convenience default to copy blindly.

## 3. Install Docker

Official Docker install (not the Ubuntu-packaged `docker.io`, which
lags behind and doesn't include the Compose v2 plugin cleanly):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out/in (or `newgrp docker`) for the group change to take effect
```

Confirmed current versions on the live box: **Docker 29.7.2**, **Docker
Compose v5.4.0** (the `docker compose` plugin, not standalone
`docker-compose`) - the install script above tracks current stable, so
a fresh install should land on the same or newer.

## 4. Create the secrets/data directory

```bash
sudo mkdir -p /opt/it-ticketing/data
sudo chown -R $USER:$USER /opt/it-ticketing
```

Then create `/opt/it-ticketing/.env.uat` with real values - this is
the file `docker-compose.uat.yml` is invoked with via
`--env-file /opt/it-ticketing/.env.uat` (see `deploy-uat.yml`), and
it's **not** in this repo. Use `.env.uat.example` (repo root) as the
template for which keys it needs - `DATABASE_URL`/Postgres credentials,
`SECRET_KEY`, the `ENTRA_*` vars, `FRONTEND_HOST`/`BACKEND_HOST` (the
real hostnames Caddy routes by - see step 6), and the mail-sending vars
if this environment should actually send email.

Lock it down - the current file is `-rw-------`, owned by the deploy
user, nobody else:

```bash
chmod 600 /opt/it-ticketing/.env.uat
```

This is exactly the plaintext-secrets-on-a-VM tradeoff
`docs/production-deployment-plan.md`'s Azure build-out section calls
out as fine for UAT but not for production (Key Vault replaces this
step there).

## 5. Register the GitHub Actions self-hosted runner

`deploy-uat.yml`'s deploy job targets `runs-on: [self-hosted, uat]` -
the runner **must** be registered with both labels, or the workflow has
nothing to dispatch to.

1. On GitHub: repo **Settings → Actions → Runners → New self-hosted
   runner**, Linux/x64. Copy the registration token it gives you (it's
   single-use and short-lived - don't reuse an old one from
   documentation).
2. On the VM:

   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner-linux-x64.tar.gz -L \
     https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64-<version>.tar.gz
   tar xzf actions-runner-linux-x64.tar.gz
   ./config.sh --url https://github.com/rholmesdhc/ITTicketINGSYS \
     --token <token-from-step-1> \
     --name it-ticketing-uat \
     --labels self-hosted,uat
   ```

   Confirmed from the live runner's own `.runner` registration file:
   `agentName: it-ticketing-uat`, pointed at
   `github.com/rholmesdhc/ITTicketINGSYS`, work folder `_work` (the
   default - this is where `actions/checkout` puts the repo on every
   job run, not something you clone manually ahead of time).

3. Install it as a systemd service so it survives reboots and starts
   automatically:

   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

   This is the `actions.runner.*` systemd unit every deploy in this
   project has been watched through via
   `journalctl -u 'actions.runner.*' -f`.

## 6. Deploy the stack for the first time

The runner's first job run populates
`~/actions-runner/_work/ITTicketINGSYS/ITTicketINGSYS/` with the repo
automatically - `docker-compose.uat.yml` and the `Caddyfile` it
references both come from there, not a manual clone.

Either trigger a push to `main` (the normal path - `deploy-uat.yml`
fires on every push) or run the workflow manually from the Actions tab
(`workflow_dispatch`) once the runner shows as Idle in GitHub's runner
list.

The deploy job runs:

```bash
docker compose --env-file /opt/it-ticketing/.env.uat -f docker-compose.uat.yml pull
docker compose --env-file /opt/it-ticketing/.env.uat -f docker-compose.uat.yml up -d --remove-orphans
```

Confirmed containers on a healthy box: `caddy` (2-alpine, ports 80/443
published), `frontend` and `backend` (pulled from
`ghcr.io/rholmesdhc/it-ticketing-*`, no ports published - only Caddy
talks to them directly on the Compose network), and `postgres`
(16-alpine). Three named volumes persist data across restarts:
`postgres_data`, `caddy_data`, `screenshot_uploads`.

## 7. TLS and hostnames (Caddy)

The real `Caddyfile` in this repo, verbatim reasoning included:

```caddyfile
{
	default_sni {$FRONTEND_HOST}
}

{$FRONTEND_HOST} {
	tls internal
	reverse_proxy frontend:3005
}

{$BACKEND_HOST} {
	tls internal
	reverse_proxy backend:8005
}
```

`tls internal` mints a self-signed cert from Caddy's own local CA -
deliberate, not a shortcut someone forgot to fix: `dhc.org` here is an
internal-only name this box can't prove public ownership of via ACME,
so a publicly-trusted cert was never an option for UAT. Every health
check and manual `curl` against this environment needs `-k`
(`--insecure`) because of this - that's expected, not a bug to chase.
Production, per the deployment plan, replaces this entirely with
Container Apps' managed certificates on a real domain.

`FRONTEND_HOST`/`BACKEND_HOST` must be set in `.env.uat` (step 4) to
real hostnames that resolve to this VM - DNS (or `/etc/hosts` for
purely internal testing) needs to point them here before Caddy can
route correctly.

## 8. Verify

```bash
curl -sk https://<BACKEND_HOST>/docs -o /dev/null -w "%{http_code}\n"   # expect 200
curl -sk https://<FRONTEND_HOST>/login -o /dev/null -w "%{http_code}\n" # expect 200
```

Same checks `deploy-uat.yml`'s own health-check step runs after every
deploy, `--resolve`-pinned to `127.0.0.1` since it runs on the box
itself.

## What's deliberately not covered here

- **Firewall**: `ufw` is confirmed inactive on the current box - network
  access control, if any, is happening at the Proxmox/network level,
  not the host. Worth a real decision, not an assumption either way.
- **Backups**: nothing here backs up the `postgres_data` volume. Fine
  for a UAT/beta environment per the deployment plan's own framing;
  not something to carry forward unexamined into production.
- **Updating the runner itself**: GitHub occasionally deprecates old
  runner versions - this doc doesn't cover the update procedure,
  only initial registration.
