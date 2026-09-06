/* One deterministic Canvas renderer for preview, developing and PNG export.
   Photo windows always start from originals; paper and ink never receive edits. */
const NEUTRAL_EDITS = Object.freeze({ light: 0, contrast: 0, warmth: 0, fade: 0, soft: 0, grain: 0, blur: 0, vignette: 0 });
const VARIATIONS = {
  single: [{ id: "hero", label: "Hero", count: 1 }],
  stack: [{ id: "duo", label: "Duo · 2", count: 2 }, { id: "pile", label: "Pile · 3", count: 3 }, { id: "scatter2", label: "Scatter · 2", count: 2 }, { id: "scatter3", label: "Scatter · 3", count: 3 }],
  strip: [{ id: "three", label: "3 photos", count: 3 }, { id: "four", label: "4 photos", count: 4 }],
  hanging: [{ id: "two", label: "2 photos", count: 2 }, { id: "three", label: "3 photos", count: 3 }],
};
function surface(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function wrapCaption(ctx, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? line + " " + word : word;
    if (ctx.measureText(candidate).width <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    // Also wrap long unbroken words, preserving Unicode code points.
    for (const letter of Array.from(word)) {
      if (line && ctx.measureText(line + letter).width > width) { lines.push(line); line = ""; }
      line += letter;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function captionBlock(ctx, text, x, y, width, height, style) {
  if (!text.trim()) return;
  ctx.save();
  ctx.translate(x, y);
  if (style !== "classic") ctx.rotate((style === "messy" ? -2 : -1.1) * Math.PI / 180);
  let size = style === "classic" ? 30 : 36;
  let lines;
  do {
    ctx.font = (style === "classic" ? "" : "italic ") + size + 'px ' + (style === "classic" ? 'Georgia, serif' : '"Segoe Print", "Bradley Hand", cursive');
    lines = wrapCaption(ctx, text, width);
    if (lines.length * size * 1.45 <= height) break;
    size -= 1;
  } while (size > 8);
  ctx.textAlign = style === "classic" ? "center" : "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#563b39";
  lines.forEach((line, i) => ctx.fillText(line, style === "classic" ? width / 2 : 0, i * size * 1.45));
  if (style === "messy") {
    ctx.strokeStyle = "#9d626b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, lines.length * size * 1.45 + 3);
    ctx.quadraticCurveTo(width * .18, lines.length * size * 1.45 + 9, width * .4, lines.length * size * 1.45 + 1); ctx.stroke();
  }
  ctx.restore();
}
function photoWindow(original, width, height, edits) {
  const c = surface(width, height), ctx = c.getContext("2d", { willReadFrequently: true });
  const iw = original.naturalWidth || original.width, ih = original.naturalHeight || original.height;
  const scale = Math.max(width / iw, height / ih), sw = width / scale, sh = height / scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(original, (iw - sw) / 2, (ih - sh) * (ih > iw ? .36 : .5), sw, sh, 0, 0, width, height);
  if (!Object.values(edits).some(Boolean)) return c; // Exact neutral draw: no pixel treatment.
  const frame = ctx.getImageData(0, 0, width, height), p = frame.data;
  const exposure = 2 ** (edits.light / 140), contrast = 1 + edits.contrast / 240, warmth = edits.warmth / 100, fade = edits.fade / 100;
  for (let i = 0; i < p.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let value = (p[i + ch] * exposure - 128) * contrast + 128;
      value += warmth * [14, 2, -14][ch];
      p[i + ch] = value * (1 - fade * .18) + fade * 27;
    }
  }
  if (edits.soft) {
    const luma = new Float32Array(width * height);
    for (let i = 0; i < luma.length; i++) luma[i] = p[i * 4] * .299 + p[i * 4 + 1] * .587 + p[i * 4 + 2] * .114;
    const smooth = boxBlur(luma, width, height, Math.max(1, Math.round(width / 160)));
    for (let i = 0; i < luma.length; i++) {
      const change = (smooth[i] - luma[i]) * edits.soft / 100 * .45;
      for (let ch = 0; ch < 3; ch++) p[i * 4 + ch] += change;
    }
  }
  if (edits.blur) {
    // Separable CPU blur also works on browsers without Canvas filter support.
    const radius = Math.max(1, Math.round(width / 220 * edits.blur / 100));
    for (let ch = 0; ch < 3; ch++) {
      const values = new Float32Array(width * height);
      for (let i = 0; i < values.length; i++) values[i] = p[i * 4 + ch];
      const blurred = boxBlur(values, width, height, radius);
      const amount = Math.min(1, edits.blur / 20);
      for (let i = 0; i < values.length; i++) p[i * 4 + ch] += (blurred[i] - values[i]) * amount;
    }
  }
  // Fine pixel noise alone disappears when a high-resolution print is reduced
  // to a phone preview. Blend a small, smoothly correlated grain structure
  // with fine noise so the same exported texture survives that reduction.
  const grainCell = Math.max(2, Math.round(width / 180));
  const grainColumns = Math.ceil(width / grainCell) + 1;
  const grainRows = Math.ceil(height / grainCell) + 1;
  const grainField = edits.grain ? Float32Array.from(
    { length: grainColumns * grainRows }, (_, i) => randomNoise(i * 17 + 731),
  ) : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    let noise = 0;
    if (grainField) {
      const gx = Math.floor(x / grainCell), gy = Math.floor(y / grainCell);
      const fx = x / grainCell - gx, fy = y / grainCell - gy;
      const top = grainField[gy * grainColumns + gx] * (1 - fx) + grainField[gy * grainColumns + gx + 1] * fx;
      const bottom = grainField[(gy + 1) * grainColumns + gx] * (1 - fx) + grainField[(gy + 1) * grainColumns + gx + 1] * fx;
      noise = (top * (1 - fy) + bottom * fy) * 42 + randomNoise(i + 977) * 7;
      noise *= edits.grain / 100;
    }
    const distance = Math.min(1, ((x / width - .5) ** 2 + (y / height - .5) ** 2) * 2);
    const shade = 1 - distance * distance * edits.vignette / 100 * .32;
    for (let ch = 0; ch < 3; ch++) p[i + ch] = p[i + ch] * shade + noise;
  }
  ctx.putImageData(frame, 0, 0);
  return c;
}
// Bounded cache: only current settings for each original/window, never an edited input.
let photoCache = new WeakMap();
function clearPhotoCache() { photoCache = new WeakMap(); }
function editedWindow(original, w, h, edits) {
  const key = w + ":" + h + ":" + JSON.stringify(edits);
  const cached = photoCache.get(original);
  if (cached?.key === key) return cached.canvas;
  const canvas = photoWindow(original, w, h, edits);
  photoCache.set(original, { key, canvas });
  return canvas;
}
function paper(ctx, x, y, w, h, color, rough = false) {
  ctx.save(); ctx.translate(x, y);
  ctx.shadowColor = "rgba(55,42,27,.16)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 9;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(2, 1); ctx.lineTo(w - 3, rough ? 5 : 1);
  ctx.lineTo(w - 1, h - 4); ctx.lineTo(rough ? w * .65 : 3, h - 1);
  if (rough) { ctx.lineTo(w * .34, h - 5); ctx.lineTo(4, h - 1); ctx.lineTo(0, h * .6); }
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  drawPaperTexture(ctx, w, h, { textureAlpha: rough ? .05 : .012, textureMarks: rough ? 1400 : 380 });
  ctx.restore();
}
function heart(ctx, x, y, scale = 1, angle = 9) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180); ctx.scale(scale, scale);
  ctx.strokeStyle = "#945760"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(0, 8);
  ctx.bezierCurveTo(-10, -5, -25, 2, -22, 15); ctx.bezierCurveTo(-18, 26, -6, 30, 2, 38);
  ctx.bezierCurveTo(9, 29, 23, 23, 24, 10); ctx.bezierCurveTo(25, 0, 10, -5, 0, 8);
  ctx.stroke(); ctx.restore();
}
function ink(ctx, x, y, kind, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.strokeStyle = "#845a57"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "star") {
    ctx.moveTo(0, -20); ctx.lineTo(6, 5); ctx.lineTo(24, 8); ctx.lineTo(4, 14);
    ctx.lineTo(-7, 33); ctx.lineTo(-7, 10); ctx.lineTo(-24, -3); ctx.lineTo(-2, 0); ctx.lineTo(0, -20);
  } else if (kind === "loop") {
    ctx.moveTo(-27, 12); ctx.bezierCurveTo(45, -45, 32, 45, 0, 17); ctx.bezierCurveTo(-15, -6, 5, -17, 36, 0);
  } else {
    ctx.moveTo(-13, 0); ctx.lineTo(-21, -15); ctx.moveTo(0, -5); ctx.lineTo(-1, -26); ctx.moveTo(12, 0); ctx.lineTo(20, -17);
  }
  ctx.stroke(); ctx.restore();
}
function decorations(ctx, w, h, style) {
  if (style === "classic") return;
  heart(ctx, w - 145, h - 150, .85);
  if (style !== "messy") return;
  heart(ctx, 98, h * .48, .7, -18); heart(ctx, w - 103, h * .36, .52, 23);
  ink(ctx, w - 100, h * .66, "star"); ink(ctx, 98, h - 235, "loop", 1.1);
  ink(ctx, 128, 132, "marks"); ink(ctx, w - 170, 135, "star", .6);
  ctx.save(); ctx.fillStyle = "#8b5b61"; ctx.font = 'italic 22px "Segoe Print", cursive';
  ctx.translate(w - 140, h * .51); ctx.rotate(-.12); ctx.fillText("xo", 0, 0); ctx.restore();
}
function print(ctx, image, placement, style, edits) {
  const { x, y, w, h, rotation = 0 } = placement;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation * Math.PI / 180);
  if (style === "messy") {
    ctx.save(); ctx.rotate(-.045); paper(ctx, -w / 2 - 13, -h / 2 + 16, w + 26, h + 6, "#ead2cd", true); ctx.restore();
  }
  paper(ctx, -w / 2, -h / 2, w, h, "#fffaf1", style !== "classic");
  const border = style === "classic" ? 30 : 20, bottom = style === "classic" ? 76 : 32;
  const photo = editedWindow(image, w - border * 2, h - border - bottom, edits);
  ctx.drawImage(photo, -w / 2 + border, -h / 2 + border);
  ctx.strokeStyle = "rgba(71,58,42,.12)"; ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2 + border, -h / 2 + border, photo.width, photo.height);
  if (style !== "classic") {
    drawTapePiece(ctx, -w * .19, -h / 2 + 5, Math.min(140, w * .3), 36, -6);
    if (style === "messy") drawTapePiece(ctx, w / 2 - 2, h * .2, 110, 32, 74);
  }
  ctx.restore();
}
function renderMemory(target, images, options) {
  const { layout, variation, style, edits, caption } = options;
  const n = images.length;
  let w = 1200, h = 1500;
  if (layout === "single") { w = 1380; h = 1600; }
  if (layout === "stack") h = n === 3 ? 1900 : 1500;
  if (layout === "stack" && variation.startsWith("scatter")) h = n === 3 ? 1600 : 1300;
  if (layout === "strip") { w = 760; h = 180 + n * 485 + 240; }
  if (layout === "hanging") { w = 1600; h = n === 3 ? 1220 : 1160; }
  target.width = w; target.height = h;
  const ctx = target.getContext("2d"); ctx.fillStyle = "#f4f0e8"; ctx.fillRect(0, 0, w, h);
  if (style !== "classic" && layout !== "strip") paper(ctx, 60, 60, w - 120, h - 120, style === "messy" ? "#eedbd5" : "#f6e1e5", true);
  if (style === "messy" && layout !== "strip") {
    // Broad scraps peek from behind the prints, with their own paper direction.
    ctx.save(); ctx.translate(w * .45, h * .39); ctx.rotate(-.11);
    paper(ctx, -w * .31, -h * .27, w * .64, h * .59, "#e4c4c0", true); ctx.restore();
    const noteX = layout === "single" ? 190 : layout === "hanging" ? 205 : 155;
    const noteY = layout === "single" ? 1295 : h - (layout === "hanging" ? 225 : 200);
    ctx.save(); ctx.translate(noteX, noteY); ctx.rotate(-.012);
    paper(ctx, 0, 0, w - noteX * 2, 165, "#fff3df", true); ctx.restore();
  }
  if (layout === "single") {
    if (style === "classic") {
      paper(ctx, 130, 95, 1120, 1380, "#fffaf0");
      ctx.drawImage(editedWindow(images[0], 968, 968, edits), 206, 171);
      captionBlock(ctx, caption, 206, 1210, 968, 210, style);
    } else {
      print(ctx, images[0], { x: 706, y: 715, w: 1000, h: 1070, rotation: style === "messy" ? -3.2 : 1.35 }, style, edits);
      captionBlock(ctx, caption, 215, 1320, 850, 150, style);
    }
  } else if (layout === "stack") {
    let placements;
    if (variation.startsWith("scatter")) {
      placements = n === 2
        ? [{ x: 375, y: 425, rotation: -12 }, { x: 815, y: 765, rotation: 11 }]
        : [{ x: 360, y: 380, rotation: -11 }, { x: 815, y: 620, rotation: 13 }, { x: 420, y: 1030, rotation: -5 }];
      placements = placements.map(p => ({ ...p, w: 540, h: 600 }));
    } else if (style === "classic") {
      // Original Duo/Pile placement foundations.
      placements = (n === 2
        ? [{ x: 470, y: 470, rotation: -3.1 }, { x: 724, y: 924, rotation: 2.4 }]
        : [{ x: 445, y: 415, rotation: -3.2 }, { x: 730, y: 850, rotation: 2.6 }, { x: 490, y: 1284, rotation: -1.8 }]
      ).map(p => ({ ...p, w: 680, h: 770 }));
    } else {
      placements = (n === 2
        ? [{ x: 410, y: 410, rotation: -2.5 }, { x: 750, y: 850, rotation: 2.1 }]
        : [{ x: 405, y: 395, rotation: -2.7 }, { x: 760, y: 800, rotation: 2.3 }, { x: 440, y: 1230, rotation: -1.8 }]
      ).map((p, i) => ({ ...p, w: 600, h: 620, rotation: p.rotation * (style === "messy" ? 2 : 1) }));
    }
    placements.forEach((p, i) => print(ctx, images[i], p, style, edits));
    captionBlock(ctx, caption, 180, h - 175, w - 380, 140, style);
  } else if (layout === "strip") {
    // A single continuous ribbon, never a column of separate cards.
    if (style === "messy") paper(ctx, 78, 66, 612, h - 120, "#e7cbc6", true);
    paper(ctx, 95, 60, 570, h - 120, "#fffaf1", style !== "classic");
    images.forEach((image, i) => ctx.drawImage(editedWindow(image, 490, 435, edits), 135, 110 + i * 485));
    if (style !== "classic") {
      drawTapePiece(ctx, 280, 66, 180, 42, -5);
      if (style === "messy") { drawTapePiece(ctx, 660, h * .55, 138, 35, 81); ink(ctx, 106, h * .38, "star", .6); heart(ctx, 650, h - 235, .65); }
    }
    captionBlock(ctx, caption, 142, h - 235, 470, 155, style);
    if (style !== "classic") heart(ctx, 622, h - 102, .45);
  } else if (layout === "hanging") {
    // Wide hanging composition with visible cord and attachment points.
    ctx.save(); ctx.strokeStyle = "#967869"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(90, 170); ctx.quadraticCurveTo(w / 2, 470, w - 90, 170); ctx.stroke(); ctx.restore();
    const positions = n === 2 ? [.28, .72] : [.18, .5, .82];
    positions.forEach((t, i) => {
      const x = 90 + (w - 180) * t, lineY = 170 + 600 * t * (1 - t);
      const pw = n === 2 ? 510 : 400, ph = n === 2 ? 610 : 520;
      print(ctx, images[i], { x, y: lineY + ph / 2 + 12, w: pw, h: ph, rotation: (i % 2 ? 3 : -3) * (style === "messy" ? 1.5 : 1) }, style, edits);
      ctx.save(); ctx.translate(x, lineY + 9); ctx.rotate(i % 2 ? .06 : -.05);
      ctx.fillStyle = "#b6977f"; ctx.fillRect(-10, -22, 20, 61);
      ctx.strokeStyle = "#765e51"; ctx.lineWidth = 2; ctx.strokeRect(-10, -22, 20, 61); ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(0, 28); ctx.stroke(); ctx.restore();
    });
    captionBlock(ctx, caption, 230, h - 200, w - 460, 140, style);
  }
  if (layout !== "strip") decorations(ctx, w, h, style);
  return target;
}

function drawTapePiece(pageContext, x, y, width, height, angle) {
  pageContext.save();
  pageContext.translate(x, y);
  pageContext.rotate(angle * Math.PI / 180);
  pageContext.fillStyle = "rgba(207, 181, 135, 0.56)";
  pageContext.strokeStyle = "rgba(112, 88, 53, 0.13)";
  pageContext.lineWidth = 1;
  pageContext.beginPath();
  pageContext.moveTo(-width / 2 + 2, -height / 2);
  pageContext.lineTo(width / 2 - 3, -height / 2 + 2);
  pageContext.lineTo(width / 2, height / 2 - 2);
  pageContext.lineTo(-width / 2 - 1, height / 2);
  pageContext.closePath();
  pageContext.fill();
  pageContext.stroke();

  pageContext.globalAlpha = 0.11;
  pageContext.strokeStyle = "#7c6747";
  for (let offset = -width / 2 + 18; offset < width / 2 - 8; offset += 23) {
    pageContext.beginPath();
    pageContext.moveTo(offset, -height / 2 + 7);
    pageContext.lineTo(offset + 8, height / 2 - 7);
    pageContext.stroke();
  }
  pageContext.restore();
}

function drawPaperTexture(printContext, width, height, frameStyle) {
  printContext.save();
  printContext.globalAlpha = frameStyle.textureAlpha;
  for (let index = 0; index < frameStyle.textureMarks; index += 1) {
    const x = (randomNoise(index * 4 + 31) * 0.5 + 0.5) * width;
    const y = (randomNoise(index * 4 + 47) * 0.5 + 0.5) * height;
    const shade = index % 3 === 0 ? "#8f7b60" : "#ffffff";
    printContext.fillStyle = shade;
    printContext.fillRect(x, y, index % 5 === 0 ? 2 : 1, 1);
  }

  printContext.globalAlpha = frameStyle.textureAlpha * 0.42;
  printContext.strokeStyle = "#806f58";
  printContext.lineWidth = 0.7;
  for (let index = 0; index < 90; index += 1) {
    const y = (randomNoise(index * 9 + 83) * 0.5 + 0.5) * height;
    const x = (randomNoise(index * 11 + 97) * 0.5 + 0.5) * width;
    printContext.beginPath();
    printContext.moveTo(x, y);
    printContext.lineTo(Math.min(width, x + 28 + (index % 35)), y + randomNoise(index + 113) * 1.5);
    printContext.stroke();
  }
  printContext.restore();
}

function randomNoise(index) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function boxBlur(source, width, height, radius) {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += source[y * width + clampRange(x, 0, width - 1)];
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      sum -= source[y * width + clampRange(x - radius, 0, width - 1)];
      sum += source[y * width + clampRange(x + radius + 1, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[clampRange(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / (radius * 2 + 1);
      sum -= horizontal[clampRange(y - radius, 0, height - 1) * width + x];
      sum += horizontal[clampRange(y + radius + 1, 0, height - 1) * width + x];
    }
  }

  return output;
}

function clampRange(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
