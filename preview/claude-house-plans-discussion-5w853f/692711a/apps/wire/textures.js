/* Canvas textures: dots, dimension labels, the gizmo's tips. */

/* A round sprite, so the vertices are dots rather than squares. */
export function dotTexture(THREE) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A dimension's label: the text on a dark pill, sized to fit it. */
export function labelTexture(THREE, text, ink = '#fff3b0') {
  const h = 96, pad = 28;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `700 ${Math.round(h * 0.5)}px -apple-system, Inter, Helvetica, Arial, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = 'rgba(6, 10, 16, 0.82)';
  g.beginPath();
  if (g.roundRect) g.roundRect(2, 8, w - 4, h - 16, (h - 16) / 2); else g.rect(2, 8, w - 4, h - 16);
  g.fill();
  g.strokeStyle = ink;
  g.globalAlpha = 0.55;
  g.lineWidth = 3;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A filled ball with its letter for +X/+Y/+Z, a hollow one for the
   negative ends — the same read as Unity's scene gizmo. */
export function tipTexture(THREE, hex, label) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const col = `#${hex.toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
  if (label) {
    g.fillStyle = col;
    g.fill();
    g.fillStyle = '#06101a';
    g.font = `700 ${Math.round(s * 0.5)}px -apple-system, Inter, Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, s / 2, s / 2 + s * 0.03);
  } else {
    g.fillStyle = 'rgba(4, 10, 16, 0.75)';
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 10;
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
