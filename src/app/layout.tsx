import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Stayful", template: "%s · Stayful" },
  description: "Stayful owner and team messaging",
  // No `icons` here on purpose. Next picks up icon.svg, favicon.ico and apple-icon.png from
  // this directory by convention, and an explicit entry would override them — which is what
  // used to happen: the tab was served the full 176 KB logo, whose script wordmark is an
  // unreadable smudge at 16px. The mark in icon.svg is the same palette reduced to one letter.
  applicationName: "Stayful",
};

export const viewport: Viewport = {
  themeColor: "#1E2B1C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-theme="dark" className={`${inter.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
