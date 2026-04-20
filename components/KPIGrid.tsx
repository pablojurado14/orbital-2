export default function KPIGrid({
  recoveredRevenue,
  recoveredGaps,
}: {
  recoveredRevenue: number;
  recoveredGaps: number;
}) {
  const cardStyle = {
    background: "#FFFFFF",
    padding: 20,
    borderRadius: 14,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };

  const labelStyle = {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 6,
  };

  const valueStyle = {
    fontSize: 24,
    fontWeight: 700 as const,
    color: "#0F172A",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
        marginBottom: 24,
      }}
    >
      <div style={cardStyle}>
        <div style={labelStyle}>Ocupación</div>
        <div style={valueStyle}>87%</div>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>Citas hoy</div>
        <div style={valueStyle}>24</div>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>Huecos recuperados</div>
        <div style={valueStyle}>{recoveredGaps}</div>
      </div>

      <div
        style={{
          ...cardStyle,
          background: "#0F2744",
          color: "white",
        }}
      >
        <div style={{ ...labelStyle, color: "#94A3B8" }}>Ingresos</div>
        <div style={{ ...valueStyle, color: "#00C2C7" }}>€{recoveredRevenue}</div>
      </div>
    </div>
  );
}
