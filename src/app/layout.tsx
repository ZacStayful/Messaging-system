import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import { cookies } from "next/headers";
import { readThemeCookie, THEME_COOKIE } from "@/lib/theme";
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
  icons: { icon: "/brand/stayful-logo.png", apple: "/brand/stayful-logo.png" },
  applicationName: "Stayful",
};

export const viewport: Viewport = {
  themeColor: "#5D8156",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = readThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-GB" data-theme={theme} className={`${inter.variable} ${poppins.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
