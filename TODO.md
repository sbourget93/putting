Remove "kind" from batch docs and sql.
Will everyones local apps work (already signed in) if the servers is down?
rolling average for hitory all time %
fix bug where rapidly clicking makes duplicate entries. currently implemented fixes didnt work.
an admin stats page showing app debug info (time to load prjections form s3 events, othing things like this). I dont have datadog.

Harden deploys against apt failures.
A deploy replaces the EC2 instance, which builds the three images on the box at boot via user_data.sh.tftpl.
That script runs under `set -e`, so a single failed `apt-get install` aborts the whole provision and the app never comes up (happened 2026-08-28: the us-east-1.ec2.ports.ubuntu.com mirror threw intermittent 503s).
Short term: switch apt off the flaky ec2 regional mirror to ports.ubuntu.com and add `Acquire::Retries` in the template.
Better: stop building on the instance entirely, build images in CI and just `docker pull` at boot, which also fixes the slow/tight builds on the t4g.nano.

make app work if server is down.
different pages/url so that refreshing doesnt break things and you can share links