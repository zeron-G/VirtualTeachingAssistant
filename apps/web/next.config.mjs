import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for a small production Docker image.
  output: 'standalone',
  // We live in a pnpm monorepo; trace deps from the repo root so the standalone
  // output resolves everything correctly.
  outputFileTracingRoot: path.join(here, '..', '..'),
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
