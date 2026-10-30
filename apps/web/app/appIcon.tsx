import { ImageResponse } from "next/og";

/** The app icon: the two-signer V on black, drawn at any square size. */
export function appIcon(size: number) {
  const mark = Math.round(size * 0.62);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000000" }}>
        <svg width={mark} height={mark} viewBox="0 0 64 64">
          <path d="M17 14 32 50" fill="none" stroke="#F2F1E9" strokeWidth="11" strokeLinecap="round" />
          <path d="M47 14 32 50" fill="none" stroke="#FF7966" strokeWidth="11" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
