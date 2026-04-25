import net from "node:net";

export async function findFreePort(startFrom: number, maxTries = 100): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const port = startFrom + i;
    if (port < 1024 || port > 65535) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(`no free port found starting from ${startFrom} (${maxTries} tries)`);
}

/**
 * A port is "free" iff we can bind it on BOTH `0.0.0.0` (what Ktor/Spring do
 * by default) AND `127.0.0.1`. Testing only loopback misses ports already
 * bound on the wildcard address.
 */
function isFree(port: number): Promise<boolean> {
  return Promise.all([tryBind(port, "0.0.0.0"), tryBind(port, "127.0.0.1")])
    .then((results) => results.every(Boolean));
}

function tryBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}
