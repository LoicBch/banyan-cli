/**
 * Render a QR code in the terminal for the remote dashboard URL. Uses
 * `qrcode-terminal` (pure-JS, no native deps) and prints the ASCII output to
 * stdout.
 *
 * The URL embedded in the QR includes the auth token in the hash fragment
 * (`#token=<32-hex>`), so scanning it on a phone opens the dashboard
 * pre-authenticated — no manual paste required.
 */
// @ts-expect-error — qrcode-terminal has no bundled types
import qrcodeTerminal from "qrcode-terminal";

export function printDashboardQR(url: string, token: string): void {
  const fullUrl = `${url.replace(/\/$/, "")}/#token=${token}`;
  // small/compact form, easier to fit in a terminal
  qrcodeTerminal.generate(fullUrl, { small: true }, (qr: string) => {
    process.stdout.write("\n");
    process.stdout.write(qr);
    process.stdout.write("\n");
    process.stdout.write(`  scan to open:  ${fullUrl}\n`);
    process.stdout.write("\n");
  });
}
