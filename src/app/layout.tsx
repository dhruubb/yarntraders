import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Yarn Register", template: "%s · Yarn Register" },
  description: "Sales, purchases, stock and dues for a yarn business",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#1e2650", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
