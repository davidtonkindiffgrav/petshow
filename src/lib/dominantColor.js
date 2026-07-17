// Extracts a usable accent color from an uploaded image file by averaging
// pixels on a downscaled canvas, then clamping the result into a range that
// reads well as a UI background (dark enough for white text, not muddy gray).

const SAMPLE_SIZE = 50;

export function extractDominantColor(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // skip transparent pixels
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
        if (!count) { resolve(null); return; }
        resolve(clampToUsableColor(r / count, g / count, b / count));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function clampToUsableColor(r, g, b) {
  let [h, s, l] = rgbToHsl(r, g, b);
  // A near-white/gray/black banner has no real hue (h is meaningless when
  // s is ~0) — forcing saturation onto it would fabricate an arbitrary
  // color rather than reflect the image, so fall back to the default accent.
  if (s < 0.06) return null;
  s = Math.min(1, Math.max(s, 0.35));
  l = Math.min(0.32, Math.max(l, 0.14));
  return hslToHex(h, s, l);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// "#RRGGBB" -> "R,G,B" for use inside rgba(...) strings
export function hexToRgbString(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '14,42,42';
  return [1, 2, 3].map(i => parseInt(m[i], 16)).join(',');
}

// Derives a brighter, more saturated companion tone from the (dark) accent
// color — for surfaces like the sticky CTA bar that sit behind a button
// already using the accent color itself. Without this the button would blend
// into its own background instead of standing out on top of it.
export function deriveBarColor(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '#1E8E7E';
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16));
  let [h, s, l] = rgbToHsl(r, g, b);
  s = Math.max(s, 0.55);
  l = Math.min(0.42, Math.max(l + 0.22, 0.3));
  return hslToHex(h, s, l);
}
