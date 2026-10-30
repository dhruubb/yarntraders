import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs", "pg", "bcryptjs"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default nextConfig;
