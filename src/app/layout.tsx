import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Price Intelligence Engine",
  description: "Lokální price-intelligence engine pro české e-shopy",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
