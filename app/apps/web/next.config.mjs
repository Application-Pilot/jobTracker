/**
 * Next.js config.
 *
 * Kept intentionally minimal. OpenNext reads from `next build` output, so
 * we don't need to special-case the deployment target here.
 *
 * If we later need to:
 *   - configure image domains: add `images: { remotePatterns: [...] }`
 *   - hit DynamoDB from server components: nothing to configure here — server
 *     code runs in a Node runtime by default in App Router.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // `output: 'standalone'` is required by OpenNext — it makes Next.js
  // produce a single self-contained server bundle that OpenNext can
  // wrap into a Lambda handler.
  output: 'standalone',

  // Strict mode catches bugs early during dev.
  reactStrictMode: true,
};

export default nextConfig;
