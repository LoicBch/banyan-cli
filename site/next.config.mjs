import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this folder. The parent repo has its own
  // package-lock.json (the banyan-cli npm package), and Next.js otherwise
  // picks the higher one and warns.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
