# Discord Rich Presence for Banyan

Display your Banyan activity in your Discord profile. The card is fixed by
design — Banyan picks the most useful packing of the limited Discord
surface based on whether you're working on one project or several.

**Single project** — features take the top line:

```
┌──────────────┐  login · profile · settings · +2
│ [banyan-logo]│  🌿 my-project · 5 of 8 features
│  ⏺ working   │  elapsed 12:34
└──────────────┘  [ Open Dashboard ]
```

**Multiple projects** — projects with their active-feature count:

```
┌──────────────┐  proj-a (3) · proj-b (1) · proj-c (4)
│ [banyan-logo]│  🌐 3 projects · 8 features
│  ⏺ working   │  elapsed 12:34
└──────────────┘  [ Open Dashboard ]
```

The `Open Dashboard` button only appears when Banyan is running with
`bn serve --remote` (Discord refuses `http://` and `localhost` URLs).

## Features

- 🎯 **Automatic updates** - Syncs every 15 seconds (configurable)
- 🔒 **Privacy-friendly** - Only shows what you configure
- 🎨 **Customizable** - Control what information is displayed
- 🔌 **Completely optional** - Disabled by default, zero impact when off
- 🧩 **Separated code** - Not mixed with core Banyan logic

## Quick Start

### 1. Prerequisites

- Discord Desktop app installed and running
- Banyan dashboard running (`bn serve`)

### 2. Enable Discord RPC

Create or edit `~/.config/banyan/discord-rpc.yaml`:

```yaml
enabled: true
```

### 3. Restart the dashboard

```bash
bn serve
```

That's it! Your Discord profile will now show your Banyan activity.

## Configuration

Full configuration options in `~/.config/banyan/discord-rpc.yaml`:

```yaml
# Enable Discord Rich Presence (default: false)
enabled: true

# Update interval in seconds (default: 15)
updateIntervalSec: 15

# Advanced — assets must be uploaded to the Discord Developer Portal under
# this application id. Defaults reference Banyan's official assets.
# largeImageKey: "banyan-logo"
# largeImageText: "Banyan — multi-agent worktree orchestrator"
# smallImageKey: "status-working"
# smallImageText: "Working"
# applicationId: "1508879085680595004"
```

The layout itself is no longer configurable — Banyan picks the shape based
on how many projects are running (see header).

## Discord Portal Assets

The SVG masters for the four images uploaded to the Discord Developer
Portal live in [`assets/discord/`](../../../assets/discord/). See the
README there for the conversion command (`rsvg-convert`).

| Key                | Used for                         | Master |
|--------------------|----------------------------------|--------|
| `banyan-logo`      | Large square logo (1024×1024)    | `assets/discord/banyan-logo.svg` |
| `status-working`   | Small badge when sessions live   | `assets/discord/status-working.svg` |
| `status-idle`      | (future) small badge when paused | `assets/discord/status-idle.svg` |
| `status-blocked`   | (future) small badge on failure  | `assets/discord/status-blocked.svg` |

The default `applicationId` (`1508879085680595004`) points at Banyan's
official Discord application — no setup needed, just flip `enabled: true`.
Override only if you fork and want to host your own.

When idle (no live agent panes) the card is cleared — your Discord status
returns to whatever it was before.

## Privacy

- Only shows aggregated information (project name, feature count, mode)
- Does not show feature names or any code details
- Can be disabled at any time by setting `enabled: false`
- All data stays local - only sent to Discord RPC (no external servers)

## Troubleshooting

### Discord presence not showing?

1. **Check Discord Desktop is running**
   - Discord must be running for RPC to work
   - Web/mobile Discord doesn't support Rich Presence

2. **Check activity settings in Discord**
   - Go to Discord Settings → Activity Privacy
   - Enable "Display current activity as a status message"

3. **Check Banyan logs**
   ```bash
   bn serve
   # Look for "[discord-rpc] Service started"
   ```

4. **Verify config is enabled**
   ```bash
   cat ~/.config/banyan/discord-rpc.yaml
   ```

### Connection issues?

The service auto-reconnects every 30 seconds if Discord disconnects. Just keep Discord running and it will reconnect automatically.

## Architecture

This integration is designed to be **completely separate** from core Banyan:

```
src/integrations/discord-rpc/
├── README.md           # This file
├── config.ts           # Type definitions
├── configLoader.ts     # Config file management
├── client.ts           # Discord RPC client wrapper
├── activity.ts         # Activity formatting
├── stateReader.ts      # Read Banyan state
└── index.ts            # Public API
```

The integration:
- ✅ Uses a separate config file (`discord-rpc.yaml`)
- ✅ Is lazy-loaded only when enabled
- ✅ Fails gracefully if Discord is not available
- ✅ Can be removed without affecting core Banyan
- ✅ Has zero performance impact when disabled

## Development

### Testing locally

1. Enable in config:
   ```yaml
   enabled: true
   updateIntervalSec: 5  # Faster updates for testing
   ```

2. Start dashboard:
   ```bash
   npm run build
   bn serve
   ```

3. Open Discord and check your profile

### Debugging

Set a shorter update interval for faster testing:

```yaml
updateIntervalSec: 5
```

Check logs in the terminal where `bn serve` is running.

## Credits

Built with [@xhayper/discord-rpc](https://www.npmjs.com/package/@xhayper/discord-rpc) - an actively maintained fork of the original discord-rpc library.

## License

Same as Banyan (MIT)
