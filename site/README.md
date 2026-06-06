# banyan-site

Marketing site for [banyan](https://github.com/LoicBch/banyan-cli). Built with
Next.js 15 (App Router), Tailwind v3, lucide-react.

## Local dev

```bash
cd site
npm install
npm run dev      # http://localhost:3000
```

## Deploy to Vercel

1. **Connect the repo** at [vercel.com/new](https://vercel.com/new) — pick
   `LoicBch/banyan-cli`.
2. **Set "Root Directory" to `site`** in the project's Settings. Vercel
   auto-detects Next.js from there.
3. (Optional) Add a custom domain in Settings → Domains (e.g. `banyan.dev`).
   Vercel handles HTTPS automatically.
4. Push to `develop` (or wherever you set the production branch in Vercel
   settings) — auto-deploys on every push.

That's it. No `vercel.json` needed at the repo root; the dashboard setting
is the source of truth.

## Structure

```
site/
├── app/
│   ├── layout.tsx      # html + metadata + Geist font
│   ├── page.tsx        # composes the sections
│   └── globals.css     # tailwind base + theme vars + utilities
├── components/
│   ├── Nav.tsx
│   ├── Hero.tsx
│   ├── Terminal.tsx    # the stylized session demo
│   ├── BorderBeam.tsx  # animated border (Magic UI-style)
│   ├── Features.tsx    # 6-card grid
│   ├── HowItWorks.tsx  # 3-step section
│   ├── CTA.tsx
│   ├── Footer.tsx
│   └── CopyableCode.tsx  # one-line copy-to-clipboard pill
├── lib/utils.ts        # cn() helper
└── tailwind.config.ts  # dark-mode-only theme + custom animations
```

## Adding sections

Each section is a self-contained component that takes no props. Drop it into
`app/page.tsx`'s `<main>` to add it to the page.
