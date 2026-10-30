import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs", "pg", "bcryptjs"],
  poweredByHeader: false,
  // pdfkit reads its built-in font files from disk at runtime; make sure they ship with the PDF routes.
  outputFileTracingIncludes: {
    "/api/invoices/**": ["./node_modules/pdfkit/js/data/**"],
    "/api/parties/**": ["./node_modules/pdfkit/js/data/**"],
    "/api/reports/**": ["./node_modules/pdfkit/js/data/**"],
  },
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default nextConfig;
