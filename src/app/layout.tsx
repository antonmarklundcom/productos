import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Productos",
  description: "Sitio en construcción.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
