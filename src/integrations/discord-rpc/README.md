# Discord Rich Presence for Banyan

Display your Banyan activity in your Discord profile! This optional integration shows what you're working on, including:

- Current project name
- Number of active features
- Agent mode (autonomous, assisted, etc.)
- Link to your Banyan dashboard

![Discord Rich Presence Example](https://via.placeholder.com/400x100?text=Discord+Presence+Example)

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

# Display options
showProject: true       # Show project name
showFeatureCount: true  # Show number of active features
showMode: true          # Show agent mode (autonomous, assisted, etc.)

# Advanced options (usually don't need to change)
# applicationId: "1234567890123456789"  # Custom Discord Application ID
# largeImageKey: "banyan"
# largeImageText: "Banyan"
```

## What's Displayed

### When you have active features:

**Details:** `Project: park4night`
**State:** `3 features • autonomous mode`
**Elapsed:** Time since dashboard started
**Button:** "View Dashboard" → Opens your local dashboard

### When idle:

Nothing is displayed - your Discord status remains unchanged.

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
