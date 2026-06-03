# Cloudflare Deployment

This project is set up for **Cloudflare Pages**.

## Final deployment steps

1. Install dependencies locally:

```bash
npm install
```

2. Confirm the repo is still using the Cloudflare Pages config:

- [`wrangler.toml`](./wrangler.toml) should keep `pages_build_output_dir = "."`
- `compatibility_flags = ["nodejs_compat"]` must stay enabled because the Pages Functions use Stripe and Supabase server libraries
- Pages Functions are routed from the repo root via [`_routes.json`](./_routes.json)

3. Deploy the repo root to the Cloudflare Pages project:

```bash
npx wrangler pages deploy . --project-name chiplogger-site
```

4. In the Cloudflare Pages project settings, set the environment variables for both Production and Preview:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL` is optional, because the functions fall back to the current Supabase project URL

5. Update the Stripe webhook endpoint to the Pages route:

- `https://chiplogger.com/stripe-webhook`

6. In Supabase Auth URL configuration, allow the app auth redirect URLs:

- `https://chiplogger.com/poker.html?path=/auth/login`
- `https://chiplogger.com/poker.html?path=/auth/reset`

7. Smoke test the live site:

- Open `https://chiplogger.com`
- Confirm `/create-checkout-session`, `/get-subscription-status`, `/admin-tools`, and `/stripe-webhook` all resolve through Pages Functions

## Local deploy command

If you just want the one-liner, use:

```bash
npx wrangler pages deploy . --project-name chiplogger-site
```

## Required environment variables

Set these in the Cloudflare Pages project settings:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL` is optional; the functions default to `https://gaobxnzfiogklkoueldd.supabase.co`

## Notes

- `wrangler.toml` is configured for Pages output from the repo root.
- The app shell is `index.html`, which redirects into `poker.html`.
- The server endpoints live under `functions/` and are exposed at the root paths listed in `_routes.json`.
- If the runtime complains about version mismatch or plugin loading, make sure `openclaw --version`, `which openclaw`, and the Gateway service are all using the same install.
