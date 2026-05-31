# Cloudflare Deployment

This project is set up for **Cloudflare Pages** now, not Netlify.

## Deploy

1. Install dependencies:

```bash
npm install
```

2. Deploy the repo root as a Pages project:

```bash
npx wrangler pages deploy . --project-name chiplogger-site
```

## Required environment variables

Set these in the Cloudflare Pages project settings:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
- `SUPABASE_URL` if you want to override the default Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`

## Notes

- `wrangler.toml` is configured for Pages output from the repo root.
- The app shell is `index.html`, which redirects into `poker.html`.
- The server endpoints live under `functions/` and are meant for Pages Functions.
- Netlify files are removed, so do not redeploy using `netlify.toml`.
- The old Netlify form attributes in `poker.html` are harmless, but they do not provide Netlify form handling on Cloudflare.
