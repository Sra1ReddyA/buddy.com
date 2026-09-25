import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf / mammoth run only in Node route handlers
  serverExternalPackages: ["unpdf", "mammoth"],
  poweredByHeader: false,
};

export default nextConfig;
