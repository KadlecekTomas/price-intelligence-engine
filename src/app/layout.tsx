import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Price Intelligence — nejlepší fashion dealy",
  description: "Vyhledávání oblečení podle ceny, historie, materiálu a skutečné výhodnosti napříč českými e-shopy.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
