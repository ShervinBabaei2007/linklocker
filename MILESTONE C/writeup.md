# Milestone C — load balancing, redundancy, CDN, logging, and analytics

This records what we deployed and tested. Each teammate should be able to explain the configuration during the presentation.

**Live site:** https://linklocker.northcentralus.cloudapp.azure.com/

**Architecture diagram:** [README](../README.md#architecture)

**Annotated configuration:** [HAProxy](haproxy.cfg), [Nginx](nginx.conf), [Papertrail forwarder example](rsyslog-papertrail.conf.example)

## Load balancing and the failure test

A browser connects to Nginx over HTTPS. Nginx forwards to HAProxy on `127.0.0.1:8080`, and HAProxy chooses one of two Express processes managed by PM2 on `127.0.0.1:3000` and `:3001`. These internal ports are not exposed publicly. Both processes use the same MongoDB database and session store, so a signed-in user can be served by either process.

In [`haproxy.cfg`](haproxy.cfg), `frontend linklocker_front` receives Nginx's local requests. `backend linklocker_apps` uses `balance roundrobin`, which alternates requests between `app1` and `app2`. The `GET /api/health` check requires HTTP 200. After two failed checks (`fall 2`), HAProxy stops choosing an unhealthy process; after two successful checks (`rise 2`), it can use that process again. The stats listener on `127.0.0.1:8404` stays local to the VM.

We saw both backend rows `UP` and their request counters increasing. We stopped `linklocker-2`, waited for HAProxy to mark `app2` `DOWN`, and confirmed the public `/api/health` still returned HTTP 200 through `app1`. We restarted the worker and both returned `UP`. We also signed in with Google, created and followed a short link, and stayed signed in after refreshing the live site. That checks the normal app flow through the load balancer, not just the health route.

## Remaining single point of failure and proposed redundancy

If our Azure VM goes down, LinkLocker cannot be reached. Nginx, HAProxy, and both PM2 workers all run on that one machine, so the second worker helps when a process fails but cannot help when the whole VM fails. DNS may still point to its address, but there is no running service there to answer visitors.

We would remove that single-machine failure point with a second Azure VM running its own Nginx, HAProxy, and Express workers. A public Azure Standard Load Balancer would forward TCP 443 to the two Nginx servers and use an HTTPS health probe on `/api/health`. When one VM becomes unhealthy, new requests would go to the other. Both VMs would need the same app version, valid TLS certificates, and access to a shared MongoDB session store. The database and other external services would need their own availability plan. We chose the assignment's documented-design option because deploying and maintaining another VM and front load balancer takes extra Azure resources and setup time.

## CDN, centralized logs, and GA4

The live HTML points to pinned [jsDelivr CSS and JS URLs](../public/index.html) for files from our public GitHub repository. Both assets returned HTTP 200 through the CDN. We pinned them to a commit so a later change to the branch cannot unexpectedly change the assets visitors receive. HTML, login, and API requests still go to our Nginx server.

PM2 writes separate output and error files for each Express process. `rsyslog` reads those four files and forwards LinkLocker entries over TLS to the hosted Papertrail collector. The [Papertrail screenshot](milestonec-papertrail.png) shows real startup messages from `linklocker-1` on port 3000 and `linklocker-2` on port 3001 in the same view. This is a single place to inspect both processes' logs even if the app VM is unavailable later.

The live page includes the GA4 tag for Measurement ID `G-193L2XV8Q0`. After opening LinkLocker in Chrome, [GA4 Realtime](milestonec-ga4.png) showed two active users in the last 30 minutes, two LinkLocker views, and two `page_view` events. The screenshot records received data rather than only the presence of a script tag.

## What we had to fix

The old live checkout had a local commit and had diverged from GitHub, so we preserved it and deployed the Milestone C branch in a separate worktree. We backed up the active proxy configuration before switching Nginx to HAProxy.

Our first Papertrail test messages arrived, but real PM2 entries did not. The `syslog` user could not traverse `/home/azureuser`; after fixing that file permission, Ubuntu's AppArmor profile still denied `rsyslogd` access to the PM2 directory. We added narrow read rules for those paths, restarted rsyslog, and then saw both workers' real startup messages. The [deployment guide](DEPLOYMENT.md) records the checks and commands.

Team contributions are listed in the [README](../README.md#team-contributions). The deployed redundancy is at the **process** level; the two-VM design above is documented and has not been deployed.
