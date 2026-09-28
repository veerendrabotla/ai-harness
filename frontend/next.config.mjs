import SerwistInit from "@serwist/next";

const withSerwist = SerwistInit({
  swSrc: "src/sw/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  transpilePackages: ["@ai-harness/contracts"],
  reactStrictMode: true,
  webpack(config) {
    // Workspace packages use NodeNext ".js" specifiers that map to .ts sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default withSerwist(nextConfig);
