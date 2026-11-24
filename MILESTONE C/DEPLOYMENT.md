# Milestone C deployment and learning guide

Use the commands below on your Azure Ubuntu VM unless a step says **collector VM** or **browser**. This guide is a runbook; write the assessed `writeup.md` in your own words after doing the work. The live site is `https://linklocker.northcentralus.cloudapp.azure.com/`.

## 0. Trace one request before changing anything

Current path: browser → Nginx (HTTPS) → one Express process → MongoDB. Target path: browser → Nginx (HTTPS) → HAProxy (127.0.0.1:8080) → Express (127.0.0.1:3000 or :3001) → shared MongoDB. The MongoDB session store means a Google login started on one instance can be read by the other.

**Do not commit `.env`, credentials, or screenshots containing them.** The live VM checkout is `~/Web-adminProject`, and its `main` branch has one local CSS commit that is not on GitHub. Keep it intact. Prepare the Milestone C branch in a separate Git worktree. Ask a teammate to review the config before replacing the live Nginx file.

## 1. Prepare a separate worktree and two app processes

From the existing checkout, fetch the remote and save a local branch name pointing to the current live commit. The old PM2 process continues running from the old directory throughout this step:

```bash
cd ~/Web-adminProject
git fetch origin
git branch backup/live-before-milestone-c-20261123
git worktree add --detach ../linklocker-milestone-c origin/milestone-c-infrastructure
cd ~/linklocker-milestone-c
git rev-parse --short HEAD
test -f ../Web-adminProject/.env && echo 'Production environment file exists'
df -h .
```

Only after verifying the production `.env` exists, copy it **on the VM** into the separate worktree and install dependencies there. Never paste `.env` in chat or commit it:

```bash
cp ../Web-adminProject/.env .env
npm ci --omit=dev --no-audit --no-fund
pm2 ls
```

If the backup branch or worktree already exists, inspect it rather than repeating the creation command. After the draft PR is merged, update the new worktree or create a clean one from the merged `main`; do not pull into the diverged old `main` without deciding what to do with its local CSS commit.

First run a second process without interrupting the existing app:

```bash
PORT=3001 pm2 start src/app.js --name linklocker-2
curl -i http://127.0.0.1:3001/api/health
```

It should return HTTP 200 and `"status":"ok"`. If it does not, inspect `pm2 logs linklocker-2 --lines 50` and fix the database or environment before continuing. PM2 processes must start from the directory containing your production `.env`.

`MILESTONE C/ecosystem.config.js` shows both expected process names and ports. Leave the old `linklocker` process on port 3000 until HAProxy and Nginx are working. HAProxy can temporarily send traffic to the old app on 3000 and the new app on 3001. After the proxy is live, replace the old process as described in Step 2.

## 2. Put HAProxy between Nginx and Express

```bash
sudo apt update
sudo apt install haproxy
sudo cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.before-linklocker
sudo cp 'MILESTONE C/haproxy.cfg' /etc/haproxy/haproxy.cfg
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
sudo systemctl restart haproxy
curl -i http://127.0.0.1:8080/api/health
```

`frontend` accepts local traffic from Nginx. `backend` sends successive requests to the two instances using round robin. HAProxy checks `/api/health`; a failed worker is removed until healthy again. You can watch the backend choice in HAProxy logs (`journalctl -u haproxy`) if your distro routes syslog there.

Only switch the live Nginx proxy after the HAProxy health request succeeds. Find your **actual active** site file with `sudo nginx -T` before copying anything. The new `MILESTONE C/nginx.conf` has the existing cert paths and proxy headers. Back up the active file, copy the new config into that same active location, then check and reload:

```bash
sudo cp /etc/nginx/sites-available/YOUR_ACTIVE_SITE /etc/nginx/sites-available/YOUR_ACTIVE_SITE.before-milestone-c
sudo cp 'MILESTONE C/nginx.conf' /etc/nginx/sites-available/YOUR_ACTIVE_SITE
sudo nginx -t
sudo systemctl reload nginx
curl -i https://linklocker.northcentralus.cloudapp.azure.com/api/health
```

If `nginx -t` fails, restore your backup and recheck before reloading. For a failure after reload, restore the backed-up file and reload Nginx. Do not expose ports 3000, 3001, or 8080 in Azure NSG or the VM firewall.

Now replace the old port-3000 worker with a new one from `~/linklocker-milestone-c`. The healthy port-3001 worker continues serving through HAProxy during this change. There may be a few failed requests until HAProxy's health checks mark the stopped worker down, so perform it when traffic is low:

```bash
cd ~/linklocker-milestone-c
pm2 delete linklocker
PORT=3000 pm2 start src/app.js --name linklocker-1
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3001/api/health
pm2 save
```

If the new app 1 does not start, use `cd ~/Web-adminProject && pm2 start npm --name linklocker -- start` to restore the old process, then inspect its logs. Do not delete every PM2 app. Once both new workers are healthy, future coordinated restarts can use the ecosystem file.

### Prove that balancing works

Open a second terminal and view both PM2 logs:

```bash
pm2 logs --lines 0
```

The current app does not log every request. HAProxy exposes local-only counters at `127.0.0.1:8404/stats`. Send several requests through HAProxy, then inspect the `app1` and `app2` rows in the stats page; both request counters should rise:

```bash
for n in 1 2 3 4 5 6; do curl -fsS http://127.0.0.1:8080/api/health >/dev/null; done
curl -s 'http://127.0.0.1:8404/stats;csv' | grep 'linklocker_apps,app'
```

To check failover, stop **only** `linklocker-2` with `pm2 stop linklocker-2`, wait for its two health checks to fail, and confirm the public `/api/health` stays 200. Restart it using `pm2 restart linklocker-2`. Check both workers' status and stats again. This proves that the surviving instance handles traffic; two processes in `pm2 ls` alone do not prove balancing.

## 3. CDN for CSS and JavaScript

`public/index.html` references jsDelivr URLs pinned to a known Git commit for `public/style.css` and `public/mainApp.js`. Because they are public static files, the CDN can retrieve them from GitHub. **When those files change, pin the URLs to a new commit containing the new assets.** The initial pin refers to the pre-Milestone-C code, which is unchanged in this branch.

In the browser DevTools Network tab, reload the live page and check that CSS and JS requests go to `cdn.jsdelivr.net` and return 200. Test in a private browsing window too: the sign-in link, form, and returned short link should still work. The HTML, authentication routes, and API continue to come from your own server.

## 4. Centralize both app processes' logs

### Hosted collector: Papertrail (one-VM teams)

Papertrail is a hosted option explicitly allowed by the assignment. In the new SolarWinds Papertrail portal, create a destination (for example, `linklocker-pm2`), choose **Usage Instructions → Syslog → Linux (Debian/Ubuntu) → Manual**, and find its ingestion token. Treat this token as a secret. The VM already has PM2 log files; `rsyslog` will tail both workers' output and error logs and forward only those messages to the `na-01` collector over TLS on TCP 6514. This sample assumes the account URL is `my.na-01.cloud.solarwinds.com`. If your account is in another region, change the collector host accordingly.

On the app VM, check the files and install rsyslog's TLS driver and the system CA bundle:

```bash
ls /home/azureuser/.pm2/logs/linklocker-*-*.log
sudo apt install -y ca-certificates rsyslog rsyslog-gnutls
```

On this VM `/home/azureuser` has mode `750`; rsyslog runs as `syslog` and
cannot traverse the home directory to read PM2 logs even when the log files
themselves are world-readable. Grant only directory traversal for this user:

```bash
sudo apt install -y acl
sudo setfacl -m u:syslog:--x /home/azureuser
sudo -u syslog test -r /home/azureuser/.pm2/logs/linklocker-1-out.log && echo 'worker 1 readable'
sudo -u syslog test -r /home/azureuser/.pm2/logs/linklocker-2-out.log && echo 'worker 2 readable'
```

The `--x` ACL on the home directory permits traversal to known paths, not
listing the home directory. The PM2 directory and log-file permissions still
apply. Apply the same check to the error files if they do not appear.

Copy `MILESTONE C/rsyslog-papertrail.conf.example` to `/etc/rsyslog.d/30-linklocker-papertrail.conf`. Use `sudoedit` to replace `REPLACE_WITH_NEW_INGESTION_TOKEN` with the destination's current token without pasting it in chat or a terminal command. The screenshot of the Easy setup exposed the original token, so rotate/recreate that token before using it. Limit the installed file to root (`sudo chmod 600 /etc/rsyslog.d/30-linklocker-papertrail.conf`). Keep the real token off GitHub. Check syntax and restart rsyslog only if the check succeeds:

```bash
sudo rsyslogd -N1
sudo systemctl restart rsyslog
logger -p local0.info -t linklocker-1 'LinkLocker collector test from worker 1'
logger -p local0.info -t linklocker-2 'LinkLocker collector test from worker 2'
pm2 restart linklocker-1
pm2 restart linklocker-2
```

In Papertrail's **Logs** view, find both collector test lines and new startup entries tagged `linklocker-1` and `linklocker-2`. The test messages check forwarding; the startup messages also check the PM2 file collection. If one is missing, check the associated PM2 log path, `journalctl -u rsyslog --since '10 minutes ago'`, and outbound TCP 6514. Capture evidence of both tags in one collector view. Do not include tokens, OAuth secrets, or production `.env` in screenshots.

### Separate private collector VM (alternative)

Use a **separate collector VM** on the same private Azure network, with an Azure NSG rule permitting TCP 514 **only from the app VM's private IP**. Keep TCP 514 closed to the public internet. The sample uses plain syslog over the private network; use TLS or a hosted log service for traffic across public networks. This collector is separate from the one Azure VM that currently hosts Nginx, HAProxy, and both workers.

On the collector VM, copy `MILESTONE C/rsyslog-collector.conf` to `/etc/rsyslog.d/30-linklocker-collector.conf`. Check that rsyslog and the firewall are configured, then:

```bash
sudo rsyslogd -N1
sudo systemctl restart rsyslog
sudo ss -ltn | grep ':514'
sudo tail -f /var/log/linklocker-central.log
```

On the app VM, copy `MILESTONE C/rsyslog-forwarder.conf.example` to a temporary file. Replace `REPLACE_VM_USER` with the OS username owning the PM2 logs and `REPLACE_COLLECTOR_PRIVATE_IP` with the collector VM's private IP. Confirm all four log paths exist (`ls ~/.pm2/logs/linklocker-*`). Then install the edited file as `/etc/rsyslog.d/30-linklocker-forwarder.conf`:

```bash
sudo rsyslogd -N1
sudo systemctl restart rsyslog
pm2 restart 'MILESTONE C/ecosystem.config.js' --update-env
```

The collector's `/var/log/linklocker-central.log` should contain new startup lines tagged `linklocker-1` **and** `linklocker-2`. Check both tags. If one is absent, verify its PM2 log path, the rsyslog config syntax, the app VM's network route, and the collector NSG rule. Forwarding does not by itself make your architecture highly available; the collector is another possible failure point.

## 5. Turn on GA4 and capture actual evidence

In Google Analytics, create or select a GA4 web data stream for the live site, and copy its **Measurement ID**, which starts `G-`. Add `GA_MEASUREMENT_ID=G-...` to the production `.env` (do not commit this file). Restart both app processes with `pm2 restart 'MILESTONE C/ecosystem.config.js' --update-env`. The server inserts the GA4 script only when the ID is valid. The front end sends a default pageview through `gtag('config', ...)`.

Visit the live home page with analytics not blocked in your browser. In DevTools Network, look for the `gtag/js` script and a GA collection request. In GA4 **Reports → Realtime**, look for your visit and capture a screenshot that shows live data. GA4 reporting can lag, so don't submit a screenshot that only shows the tag in source; the assignment explicitly requests a screenshot with live data. Keep the Measurement ID in `.env.example` as a placeholder, but never put the Google OAuth client secret in screenshots or the repo.

## 6. Write the assessment in your own words

Fill `MILESTONE C/writeup.md` with what actually happened. Include the architecture and actual setup; explain `frontend`, `backend`, `balance roundrobin`, the health check, and what happens if one app process fails. Describe the remaining single points of failure: the sole Azure VM, Nginx, HAProxy, and any external data/logging dependency. For the permitted design-only redundancy path, describe a second VM with a second Nginx/HAProxy pair and independent workers, plus a managed entry load balancer with health checks. Explain how traffic would move when one VM fails, and why you chose documentation rather than implementing this extra infrastructure. Note that two processes on one VM do **not** survive loss of that VM.

Add evidence: live URL; link to the annotated HAProxy config; a short SPOF analysis; GA4 Realtime screenshot; and screenshots or command output showing both PM2 workers, the HAProxy health/failover check, CDN Network requests, and both log tags at the collector. Update the main README's architecture diagram and your team's actual contributions. The assignment permits AI help with configs and debugging but requires that your milestone write-up be in your own words and each team member can explain the configuration.
