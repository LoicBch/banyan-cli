# Discord Rich Presence assets

These are the master SVGs for the four images uploaded to the
[Discord Developer Portal](https://discord.com/developers/applications)
under the Banyan application (Rich Presence → Art Assets).

| File                  | Discord asset key  | Used as     | Recommended export |
|-----------------------|--------------------|-------------|--------------------|
| `banyan-logo.svg`     | `banyan-logo`      | Large image | 1024×1024 PNG      |
| `status-working.svg`  | `status-working`   | Small badge | 512×512 PNG        |
| `status-idle.svg`     | `status-idle`      | Small badge | 512×512 PNG        |
| `status-blocked.svg`  | `status-blocked`   | Small badge | 512×512 PNG        |

The asset key in the portal **must match the filename without extension** —
that's what `largeImageKey` / `smallImageKey` in `discord-rpc.yaml`
references.

## Converting to PNG for upload

Discord only accepts PNG / JPEG / GIF. Convert with `librsvg`:

```bash
brew install librsvg
cd assets/discord
rsvg-convert -h 1024 banyan-logo.svg     > banyan-logo.png
rsvg-convert -h 512  status-working.svg  > status-working.png
rsvg-convert -h 512  status-idle.svg     > status-idle.png
rsvg-convert -h 512  status-blocked.svg  > status-blocked.png
```

The PNGs are intentionally gitignored — only the SVGs are committed as
the source of truth.

## Design language

All assets share the Banyan palette:

- `#0f172a` — slate-900 background (matches the dashboard's dark surface)
- `#10b981` — emerald-500 brand accent
- `#64748b` — slate-500 for idle / muted states
- `#ef4444` — red-500 for blocked / error states

The logo is a half-filled emerald ring on a slate-rounded square — same
glyph as the dashboard favicon, scaled to 1024 with proportional radii.
