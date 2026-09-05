interface PlaceholderOptions {
  label: string;
  viewport: string;
  hasIssue?: boolean;
}

function dimensions(viewport: string): { width: number; height: number } {
  const [width, height] = viewport.split("×").map((value) => Number.parseInt(value.trim(), 10));
  return { width: width || 1440, height: height || 900 };
}

export function screenshotPlaceholder({ label, viewport, hasIssue = false }: PlaceholderOptions): string {
  const { width, height } = dimensions(viewport);
  const isNarrow = width < 700;
  const sidebarWidth = isNarrow ? 0 : Math.round(width * 0.18);
  const headerHeight = Math.round(height * 0.08);
  const rows = Array.from({ length: 6 }, (_, index) => {
    const y = headerHeight + 40 + index * Math.round((height - headerHeight - 80) / 6);
    const rowWidth = Math.round((width - sidebarWidth) * (0.55 + (index % 3) * 0.12));
    return `<rect x="${sidebarWidth + 32}" y="${y}" width="${rowWidth}" height="18" rx="4" fill="#d5dbe3"/>`;
  }).join("");
  const warning = hasIssue
    ? `<rect x="${sidebarWidth + 32}" y="${headerHeight + 8}" width="${Math.round((width - sidebarWidth) * 0.5)}" height="22" rx="4" fill="#f6d4d8"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#f3f5f8"/>
${sidebarWidth > 0 ? `<rect width="${sidebarWidth}" height="${height}" fill="#e6eaef"/>` : ""}
<rect x="${sidebarWidth}" width="${width - sidebarWidth}" height="${headerHeight}" fill="#ffffff"/>
${warning}
${rows}
<text x="${width - 24}" y="${height - 24}" text-anchor="end" font-family="sans-serif" font-size="${isNarrow ? 18 : 22}" fill="#6b7785">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
