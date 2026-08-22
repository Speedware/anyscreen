# Anyscreen

Self-hosted digital signage plus two interchangeable players — a native **Android TV app** and a **web player** that runs in browser.

## One-command setup

Point your domain's DNS A/AAAA record at the server, make sure ports 80 and 443 are open, then
run this on the server as root (or with sudo):

```bash
curl -fsSL https://raw.githubusercontent.com/Speedware/anyscreen/main/deploy.sh | sudo bash
```

The script (`deploy.sh`) will:

- install git if it's missing;
- clone this repo into `~/anyscreen` (or `git pull` if it's already there);
- install Docker and Node.js if missing;
- generate a `.env` with a random `JWT_SECRET` if one doesn't exist yet;
- install ufw if missing and open ports 22, 80, and 443;
- ask for the domain to serve the dashboard on;
- run Caddy as a Docker container and write its config — Caddy requests and renews the SSL
  certificate from Let's Encrypt automatically;
- start the project with Docker Compose.

It's safe to re-run later to deploy an update: it pulls the latest code, rebuilds, and restarts
the containers — without touching your uploaded content, playlists, schedules, or paired
displays.

To move to a different server without losing any of that:

```bash
./deploy.sh --backup migration.tar.gz     # on the old server
./deploy.sh --restore migration.tar.gz    # on the new server
```