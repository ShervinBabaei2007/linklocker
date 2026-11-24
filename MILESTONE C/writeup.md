# Milestone C

[Live site](https://linklocker.northcentralus.cloudapp.azure.com/) · [HAProxy config](haproxy.cfg) · [Nginx config](nginx.conf) · [Papertrail config](rsyslog-papertrail.conf.example)

## Load balancing

Nginx handles HTTPS and sends requests to HAProxy. HAProxy takes turns sending them to two PM2 app processes, on ports 3000 and 3001. It checks `/api/health` every three seconds and stops using a process after two failed checks.

We saw requests reach both processes. When we stopped process 2, the site still returned 200 through process 1. We started process 2 again. Google sign-in and making a short link also worked after the change. Both processes use the same MongoDB database for links and logins.

## What can still fail

Both processes, Nginx, and HAProxy are on one Azure VM. If that VM goes down, the whole site goes down. Having two processes only helps when one process fails.

We would put the same setup on a second VM and place an Azure load balancer in front of the two VMs. It would check which VM is working and send visitors there. We documented this plan because setting up another VM takes more time and Azure resources. The shared database would also need to stay available.

## CDN, logs, and analytics

The site loads its CSS and JavaScript from jsDelivr. We checked that both files returned 200. Each app process writes its own logs, and rsyslog sends them to Papertrail. [This screenshot](milestonec-papertrail.png) shows startup logs from both processes in one place. [GA4 Realtime](milestonec-ga4.png) shows two LinkLocker page views and two `page_view` events.

## What broke

At first, Papertrail received our test messages but not the app logs. rsyslog could not read the PM2 files because of the home folder permissions and an AppArmor rule. After we allowed access to those log files, both processes appeared in Papertrail.
