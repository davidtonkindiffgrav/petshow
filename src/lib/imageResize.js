// Shrinks an oversized image client-side, keeping JPEG quality fixed and only
// reducing pixel dimensions. Converges in a couple of passes by measuring the
// real bytes-per-pixel of the first encode and solving for the target size,
// rather than looping blindly.
const QUALITY = 0.92;
const MARGIN_FACTOR = 0.9;
const MAX_PASSES = 4;
const INITIAL_CAP_PX = 6000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function encode(img, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function resizeImageToLimit(file, maxBytes, opts = {}) {
  const {
    quality = QUALITY,
    marginFactor = MARGIN_FACTOR,
    maxPasses = MAX_PASSES,
    initialCapPx = INITIAL_CAP_PX,
  } = opts;

  const img = await loadImage(file);
  try {
    const capScale = Math.min(1, initialCapPx / Math.max(img.width, img.height));
    let width = Math.round(img.width * capScale);
    let height = Math.round(img.height * capScale);

    let blob = await encode(img, width, height, quality);

    for (let pass = 0; pass < maxPasses && blob.size > maxBytes; pass++) {
      const bytesPerPixel = blob.size / (width * height);
      const targetPixels = (maxBytes * marginFactor) / bytesPerPixel;
      const scale = Math.sqrt(targetPixels / (width * height));
      const newWidth = Math.max(1, Math.round(width * scale));
      const newHeight = Math.max(1, Math.round(height * scale));
      if (newWidth >= width && newHeight >= height) break; // not converging, bail out
      width = newWidth;
      height = newHeight;
      blob = await encode(img, width, height, quality);
    }

    return blob.size <= maxBytes ? blob : null;
  } finally {
    URL.revokeObjectURL(img.src);
  }
}
