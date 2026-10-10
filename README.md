# AppZed Governance Framework

Tag-compliance audits and posture reports for your account. Daily cron stores audit reports in KV.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/naelmohammad/appzed-governance)

Click **Deploy to Cloudflare**: it clones this repo to your GitHub account, provisions the bindings below on your Cloudflare account, and wires CI/CD with preview URLs on every PR.

## Bindings (auto-provisioned)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "appzed-governance",
  "main": "worker.js",
  "compatibility_date": "2025-09-01",
  "ai": {
    "binding": "AI"
  },
  "kv_namespaces": [
    {
      "binding": "GOV"
    }
  ],
  "triggers": {
    "crons": [
      "17 6 * * *"
    ]
  }
}
```

## KV setup

One-click deploy provisions the KV namespace automatically. If you deploy with wrangler CLI instead:

```bash
wrangler kv namespace create appzed-governance
```

Put the returned id in `wrangler.jsonc` (`kv_namespaces[0].id`), then `wrangler deploy`.

## Configure

Set `CF_API_TOKEN` (account:read + per-product read) and `CF_ACCOUNT_ID` after deploy.

```bash
wrangler secret put CF_API_TOKEN
```

Set `CF_ACCOUNT_ID` in `wrangler.jsonc` vars or as a secret.

## Try it

```bash
curl https://<your-worker>.workers.dev/audit
```

GET /health for a liveness check. Managed by AppZed (https://dev.appzed.com/solutions/governance).
