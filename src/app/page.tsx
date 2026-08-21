export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "2rem",
        textAlign: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        background: "#0f1115",
        color: "#f3f4f6",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 600, margin: 0 }}>
        Productos
      </h1>
      <p style={{ color: "#9ca3af", margin: 0, maxWidth: "32ch" }}>
        Estamos preparando el sitio. Vuelve pronto.
      </p>
    </main>
  );
}
