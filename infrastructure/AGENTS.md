# Infrastructure

`infrastructure/` houses the terraform code that deploys this app to AWS.

`terraform/` is a module. This app references the module in `app.tf` and provides (at minimum) an app name (e.g. `app-template`).

## Stack

| Layer | Details |
| --- | --- |
| **IaC** | All AWS infrastructure is managed with Terraform (`terraform/`). |
| **Source Control** | GitHub hosts the source in a public repo. The EC2 instance clones it directly at startup to build and run the app. |
| **Cloud Compute** | A single on-demand `t4g.nano` EC2 instance runs the entire application (see the root "Inexpensive" constraint). |
| **DNS** | Route 53 routes `<app>.stephengb.com` to the instance and backs certbot's DNS-01 SSL verification. The parent `stephengb.com` is managed in Route 53 but is out of scope for this app. |
| **Containers** | Docker containerizes the individual application components. |

## Terraform structure (`terraform/`)

| File | Purpose |
| --- | --- |
| `data.tf` | Resources Terraform does *not* manage, loaded as data only — things that must not be deleted or that outscope this app (Route 53 zone, Ubuntu AMI, caller identity). |
| `ec2.tf` / `eip.tf` / `key_pair.tf` | The instance, its static IP, and SSH key. |
| `user_data.sh.tftpl` | Startup script — clones the repo and builds/runs the containers. |
| `route53_record.tf` | The `<app>` DNS record. |
| `security_group.tf` | Inbound/outbound firewall rules. |
| `iam.tf` | The instance's IAM role (e.g. S3 backup access). |
| `versions.tf` / `variables.tf` | Provider config and input variables. |
| `<app>.pem` | The SSH private key, output by Terraform and saved in this dir. It is a secret and must never be committed to git. |
| `main.tf` | Locals for inferring app-specific variable defaults, and renders `user_data.sh.tftpl`. Cert bootstrap (obtain a Let's Encrypt cert and sync it to S3) is a conditional block inside that template, enabled when DNS is managed. |

## SSL / certbot

The module's default bootstrap obtains a Let's Encrypt cert on the box (DNS-01 via Route 53) using the `certbot_email` variable.
That value is supplied locally via the `TF_VAR_certbot_email` environment variable.

## Secrets (SSM)

The instance reads its login secrets from SSM Parameter Store at boot. These are configured globally so no app *needs* to create their own, but all apps *may choose* to make their own.

| Parameter | Required | Purpose |
| --- | --- | --- |
| `<secrets_path>/google_client_id` | Yes | Google OAuth client id; the deploy refuses to start without it. |
| `<secrets_path>/session_secret` | Yes | Signs the session cookie; keep stable across releases. Deploy refuses without it. |
| `<secrets_path>/admin_emails` | No | Comma-separated admin allowlist. |

## Debugging
Connect to the production instance with ssh -i `<app>.pem ubuntu@<app>.stephengb.com`.
