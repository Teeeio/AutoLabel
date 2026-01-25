export default function TooltipLayer({ tooltip }) {
  if (!tooltip?.visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: `${tooltip.x}px`,
        top: `${tooltip.y}px`,
        padding: "8px 12px",
        background: "rgba(15, 23, 42, 0.95)",
        color: "white",
        fontSize: "13px",
        fontWeight: "500",
        borderRadius: "8px",
        maxWidth: "300px",
        zIndex: 10000,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        pointerEvents: "none",
        lineHeight: "1.4",
        wordWrap: "break-word"
      }}
    >
      {tooltip.text}
    </div>
  );
}
