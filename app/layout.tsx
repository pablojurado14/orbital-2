import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORBITAL — Dental Flow",
  description: "Optimización operativa en tiempo real para clínicas dentales",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          background: "#F5F1EB",
          color: "#0F172A",
        }}
      >
        {children}
      </body>
    </html>
  );
}
