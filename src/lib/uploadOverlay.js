// Full-screen blocking overlay shown while an image upload is in flight,
// so users can't navigate, save, or close panels until it settles.

let overlay = null;

export function showUploadOverlay(message = 'Uploading image…') {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(14,42,42,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:white;border-radius:16px;padding:28px 40px;display:flex;flex-direction:column;align-items:center;gap:14px;box-shadow:0 24px 64px rgba(14,42,42,0.25)">
        <div style="width:36px;height:36px;border:3px solid rgba(27,168,154,0.2);border-top-color:#1ba89a;border-radius:50%;animation:ftf-upload-spin 0.8s linear infinite"></div>
        <p data-upload-msg style="font-size:14px;font-weight:700;color:#1c1626;margin:0;font-family:inherit"></p>
        <p style="font-size:12px;color:#9b94a8;margin:0;font-family:inherit">Please wait — don't close this page.</p>
      </div>
      <style>@keyframes ftf-upload-spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('[data-upload-msg]').textContent = message;
  overlay.style.display = 'flex';
}

export function hideUploadOverlay() {
  if (overlay) overlay.style.display = 'none';
}

// Convenience wrapper: shows the overlay for the duration of an async task.
export async function withUploadOverlay(task, message) {
  showUploadOverlay(message);
  try {
    return await task();
  } finally {
    hideUploadOverlay();
  }
}
