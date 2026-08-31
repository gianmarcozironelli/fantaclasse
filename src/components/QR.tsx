"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QR({ value, size = 160 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#07090c", light: "#e6ebf1" },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [value, size]);

  if (!dataUrl) {
    return <div className="rounded bg-ink-800" style={{ width: size, height: size }} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt={value} width={size} height={size} className="rounded" />;
}
