# Milestone C — team write-up checklist

**Team: rewrite the explanations below in your own words before submission.**
Keep screenshots that show actual data, and be ready to explain each config line.

## Live site and topology

- Live URL: https://linklocker.northcentralus.cloudapp.azure.com/
- Request path: browser → Nginx with TLS → HAProxy on `127.0.0.1:8080` → one of two Express/PM2 processes (`127.0.0.1:3000` or `:3001`) → shared MongoDB.
- CSS and JS load from jsDelivr URLs pinned to a GitHub commit. The browser sends GA4 pageviews to Google. Each PM2 worker's output and error files go through rsyslog to Papertrail.
- Explain why 3000/3001/8080/8404 bind only to loopback and why port 443 is public.

## Load balancing and failure test

- [Annotated HAProxy configuration](haproxy.cfg): explain `frontend`, `backend`, `balance roundrobin`, `option httpchk`, `fall 2`, and `rise 2` in your own words.
- Evidence observed on Nov 23: both `app1` and `app2` showed `UP` and received requests in the local HAProxy stats counters. During a test, `linklocker-2` was stopped, `app2` showed `DOWN`, and public `/api/health` still returned HTTP 200 via `app1`. The worker was restarted and both returned `UP`.
- After deployment, Google sign-in, creating a short link, staying signed in across repeated page refreshes, and following the resulting redirect were tested successfully through the public HTTPS URL. Explain how the shared MongoDB session store lets either worker recognize the login.
- Add your screenshot or short command output proving both counters and the failover test: **TODO**.
- Explain what changes for a user when only one worker remains.

## Redundancy / single points of failure

**Team draft based on the VM-failure discussion; read this aloud and edit it into your own words.**

If our current Azure VM goes down, nobody can reach LinkLocker. Nginx, HAProxy,
and both PM2 workers all run on that one machine, so having two workers only
helps if one *process* fails. DNS can still point at the VM, but it has no
running service to answer visitors.

To remove this single-machine failure point, we would deploy another Azure VM
with its own Nginx, HAProxy, and Express workers. An Azure Standard Load
Balancer would be the public entry point and probe `/api/health` over HTTPS on
both VMs. It would send new requests to the healthy VM if the other failed.
Both VMs would use the same application version and a shared, available
MongoDB session store, and both would need valid TLS certificates. We chose the
assignment's documented-design option because a second VM and front load
balancer take additional setup and Azure resources. The shared database and
other external services still need their own availability plans.

Explain this design and its remaining limitations in your own words during the
presentation. Papertrail is outside the VM, but it is not on the request path.

## CDN, logging, and analytics evidence

| Requirement | Observed verification | Evidence to attach |
| --- | --- | --- |
| CDN | Live HTML points to pinned jsDelivr CSS and JS; both returned HTTP 200. | The pinned URLs in [`public/index.html`](../public/index.html) and the `curl` checks in the [deployment guide](DEPLOYMENT.md). Optional Network-tab screenshot: **TODO** |
| Central logs | Papertrail showed `linklocker-1` with `http://127.0.0.1:3000` and `linklocker-2` with `http://127.0.0.1:3001` in the same Logs view. | [Papertrail screenshot](milestonec-papertrail.png) |
| GA4 | The live page included the tag for `G-193L2XV8Q0`. Realtime for the LinkLocker property showed 2 active users in the last 30 minutes, 2 LinkLocker views, and 2 `page_view` events. | [GA4 Realtime screenshot](milestonec-ga4.png) |

## Troubleshooting and contributions

- What happened: production `main` had a local commit and diverged from GitHub, so deployment used a separate worktree and backed up the old checkout. The old process was replaced only after HAProxy and Nginx worked.
- What happened: rsyslog could forward `logger` test messages, but PM2 file entries did not appear until the `syslog` user could traverse `/home/azureuser` and the AppArmor profile allowed read access to the PM2 paths. Explain the difference between Unix file permissions and AppArmor.
- Name which teammate set up HAProxy, logging, GA4, screenshots, docs, and testing: **TODO**.

See the [deployment guide](DEPLOYMENT.md) for commands and verification steps. Do not commit `.env`, ingestion tokens, OAuth secrets, or screenshots showing them.
