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
- Add your screenshot or short command output proving both counters and the failover test: **TODO**.
- Explain what changes for a user when only one worker remains.

## Redundancy / single points of failure

- Current deployment has one Azure VM. Loss of the VM, Nginx, or HAProxy stops the public site despite two Express processes. Shared MongoDB and external dependencies need their own availability plan. The hosted Papertrail collector is outside this VM, but logging is not the request path.
- **Documented design, not yet implemented:** use a second Azure VM with its own Nginx/HAProxy pair and app workers. Put a managed public entry load balancer with health checks in front of the VMs. If one VM fails, route new connections to the healthy VM. Use the same application version and shared database/session store on both VMs. Ensure the entry load balancer and database are themselves highly available. Describe the extra cost and setup time that led the team to document this design for the course's permitted option.
- Rewrite this analysis with a simple failure scenario in your own words. State clearly that two workers on the **same** VM do not provide VM-level redundancy.

## CDN, logging, and analytics evidence

| Requirement | Observed verification | Evidence to attach |
| --- | --- | --- |
| CDN | Live HTML points to pinned jsDelivr CSS and JS; both returned HTTP 200. | Screenshot of browser Network tab for both assets: **TODO** |
| Central logs | Papertrail showed `linklocker-1` with `http://127.0.0.1:3000` and `linklocker-2` with `http://127.0.0.1:3001` in the same Logs view. | Screenshot from Nov 23: **TODO attach or link** |
| GA4 | The live page included the tag for `G-193L2XV8Q0`. Realtime for the LinkLocker property showed 2 active users in the last 30 minutes, 2 LinkLocker views, and 2 `page_view` events. | Realtime screenshot captured Nov 23: **TODO attach or link in repo** |

## Troubleshooting and contributions

- What happened: production `main` had a local commit and diverged from GitHub, so deployment used a separate worktree and backed up the old checkout. The old process was replaced only after HAProxy and Nginx worked.
- What happened: rsyslog could forward `logger` test messages, but PM2 file entries did not appear until the `syslog` user could traverse `/home/azureuser` and the AppArmor profile allowed read access to the PM2 paths. Explain the difference between Unix file permissions and AppArmor.
- Name which teammate set up HAProxy, logging, GA4, screenshots, docs, and testing: **TODO**.

See the [deployment guide](DEPLOYMENT.md) for commands and verification steps. Do not commit `.env`, ingestion tokens, OAuth secrets, or screenshots showing them.
