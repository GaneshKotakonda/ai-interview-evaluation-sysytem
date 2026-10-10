// -------------------------------------------------------------
// Still image from the live camera (identity enrolment and checks)
// -------------------------------------------------------------
// Draws the current <video> frame, scaled to `width` pixels wide, onto a
// canvas and encodes it as JPEG. Resolves null when no frame is available.
export function captureFrame(video, width = 480, quality = 0.85) {
  if (!video || video.readyState < 2 || !video.videoWidth || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  const scale = Math.min(1, width / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob || null), 'image/jpeg', quality);
  });
}
