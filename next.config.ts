import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this directory. Without it Turbopack walks up
    // and finds the stray package-lock.json in the parent folder, then warns
    // that it sits outside the git repo.
    root: path.join(__dirname),
  },
};

export default nextConfig;
