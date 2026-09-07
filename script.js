const $ = (selector) => document.querySelector(selector);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const state = { layout: "single", variation: "hero", style: "classic", edits: { ...NEUTRAL_EDITS }, caption: "", photos: Array(4).fill(null) };
const screens = [...document.querySelectorAll(".app-screen")];
const canvas = $("#photoCanvas"), printReveal = $("#printReveal"), printObject = $("#printObject");
let activeTool = "light", renderTimer = 0, developmentRun = 0, developmentFallback = 0, hasDeveloped = false;
const uploadVersions = [0, 0, 0, 0];
const pendingUploads = new Set();
const toolLabels = { light: "Light", contrast: "Contrast", warmth: "Warmth", fade: "Fade", soft: "Soft", grain: "Grain", blur: "Blur", vignette: "Vignette" };
function count() { return VARIATIONS[state.layout].find(v => v.id === state.variation).count; }
function complete() { return state.photos.slice(0, count()).every((photo, i) => photo && !pendingUploads.has(i)); }
function showScreen(id) {
  screens.forEach(screen => {
    screen.hidden = screen.id !== id;
    screen.classList.remove("is-entering");
  });
  const screen = $("#" + id);
  if (!reducedMotion.matches) { void screen.offsetWidth; screen.classList.add("is-entering"); }
  window.scrollTo({ top: 0, behavior: "instant" });
  screen.focus({ preventScroll: true });
}
function optionsMarkup(name, values, selected) {
  return values.map(v => '<label><input type="radio" name="' + name + '" value="' + v.id + '"' + (v.id === selected ? ' checked' : '') + '><span>' + v.label + '</span></label>').join("");
}
function syncVariations() {
  for (const id of ["uploadVariations", "customVariations"]) {
    $("#" + id).innerHTML = optionsMarkup(id, VARIATIONS[state.layout], state.variation);
    $("#" + id).closest("fieldset").hidden = state.layout === "single";
  }
  $("#layoutName").textContent = state.layout;
}
function syncUploads() {
  const n = count();
  document.querySelectorAll(".photo-slot").forEach((slot, i) => {
    slot.hidden = i >= n || (n === 1 && !state.photos[i]);
    const photo = state.photos[i];
    slot.classList.toggle("has-photo", Boolean(photo));
    const thumb = slot.querySelector("img");
    thumb.hidden = !photo;
    if (photo) thumb.src = photo.url; else thumb.removeAttribute("src");
    slot.querySelector(".slot-label").textContent = photo ? photo.name : "choose photo";
    slot.querySelector("input").setAttribute("aria-label", (photo ? "Replace" : "Choose") + " photo " + (i + 1));
  });
  $("#uploadHint").textContent = n === 1 ? "One photo. A little keepsake." : n + " photos, one little memory.";
  $("#continueButton").disabled = !complete();
  $("#developButton").disabled = !complete();
  $("#batchLabel").textContent = n === 1 ? "choose a photo" : "choose " + n + " photos";
  $("#photoInput").multiple = n > 1;
  $("#uploadArea").classList.toggle("is-selected", complete());
  if (complete()) $("#batchLabel").textContent = n === 1 ? "choose a different photo" : "choose different photos";
  $("#missingPhotos").hidden = complete();
}
function changeVariation(value) {
  state.variation = value;
  syncVariations(); syncUploads();
  if (!$("#customizeScreen").hidden) renderPreview();
}
document.querySelectorAll('input[name="layout"]').forEach(input => input.addEventListener("change", () => {
  state.layout = input.value; state.variation = VARIATIONS[state.layout][0].id;
  syncVariations(); syncUploads(); $("#status").textContent = "";
}));
for (const id of ["uploadVariations", "customVariations"]) $("#" + id).addEventListener("change", event => changeVariation(event.target.value));
document.querySelectorAll('input[name="frameStyle"]').forEach(input => input.addEventListener("change", () => { state.style = input.value; schedulePreview(); }));
async function loadPhoto(file, index) {
  if (!file || (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|avif)$/i.test(file.name))) {
    $("#status").textContent = "Please choose an image file."; return;
  }
  const version = ++uploadVersions[index], url = URL.createObjectURL(file);
  pendingUploads.add(index); syncUploads();
  const image = new Image();
  $("#status").textContent = "opening your photo…";
  try {
    image.src = url; await image.decode();
    if (version !== uploadVersions[index]) { URL.revokeObjectURL(url); return; }
    if (state.photos[index]) URL.revokeObjectURL(state.photos[index].url);
    state.photos[index] = { image, url, name: file.name };
    hasDeveloped = false;
    $("#status").textContent = "";
  } catch {
    URL.revokeObjectURL(url);
    if (version !== uploadVersions[index]) return;
    $("#status").textContent = "This photo could not be opened. Try a JPG, PNG or WEBP.";
  }
  pendingUploads.delete(index); syncUploads();
  if (!$("#customizeScreen").hidden) renderPreview();
}
function loadBatch(files) {
  const selected = [...files].slice(0, count());
  selected.forEach((file, i) => loadPhoto(file, i));
}
$("#photoInput").addEventListener("change", event => { loadBatch(event.target.files); event.target.value = ""; });
document.querySelectorAll("[data-photo-index]").forEach(input => input.addEventListener("change", event => {
  if (event.target.files[0]) loadPhoto(event.target.files[0], Number(input.dataset.photoIndex));
  event.target.value = "";
}));
["dragenter", "dragover"].forEach(name => $("#uploadArea").addEventListener(name, event => {
  event.preventDefault(); $("#uploadArea").classList.add("is-dragging");
}));
["dragleave", "drop"].forEach(name => $("#uploadArea").addEventListener(name, event => {
  event.preventDefault(); $("#uploadArea").classList.remove("is-dragging");
}));
$("#uploadArea").addEventListener("drop", event => loadBatch(event.dataTransfer.files));
function renderPreview() {
  clearTimeout(renderTimer);
  if (!complete()) {
    $("#previewHost").hidden = true; $("#missingPhotos").hidden = false; return false;
  }
  try {
    renderMemory(canvas, state.photos.slice(0, count()).map(photo => photo.image), state);
    printReveal.style.aspectRatio = canvas.width + " / " + canvas.height;
    $("#previewHost").hidden = false;
    $("#customStatus").textContent = "";
    hasDeveloped = false;
    return true;
  } catch (error) {
    $("#customStatus").textContent = "That memory could not be drawn. Try a smaller photo.";
    return false;
  }
}
function schedulePreview() { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 90); }
function customize() {
  $("#previewHost").appendChild(printReveal);
  syncVariations(); syncUploads(); renderPreview(); showScreen("customizeScreen");
}
$("#continueButton").addEventListener("click", () => { if (complete()) customize(); });
$("#backButton").addEventListener("click", () => showScreen("uploadScreen"));
$("#addPhotosButton").addEventListener("click", () => showScreen("uploadScreen"));
$("#editButton").addEventListener("click", customize);
$("#caption").addEventListener("input", event => { state.caption = event.target.value; schedulePreview(); });
function syncTool() {
  document.querySelectorAll("[data-tool]").forEach(button => button.setAttribute("aria-pressed", button.dataset.tool === activeTool));
  const slider = $("#editSlider");
  slider.min = ["light", "contrast", "warmth"].includes(activeTool) ? -100 : 0;
  slider.value = state.edits[activeTool];
  slider.setAttribute("aria-label", toolLabels[activeTool]);
  $("#toolValue").textContent = toolLabels[activeTool] + " " + state.edits[activeTool];
  $("#resetEdits").disabled = !Object.values(state.edits).some(Boolean);
}
$("#editTools").innerHTML = Object.entries(toolLabels).map(([id, label]) => '<button type="button" data-tool="' + id + '" aria-pressed="false">' + label.toLowerCase() + '</button>').join("");
$("#editTools").addEventListener("click", event => {
  const button = event.target.closest("[data-tool]"); if (!button) return;
  activeTool = button.dataset.tool; syncTool();
  const tools = $("#editTools");
  const toolRect = button.getBoundingClientRect(), railRect = tools.getBoundingClientRect();
  const delta = toolRect.left < railRect.left ? toolRect.left - railRect.left : Math.max(0, toolRect.right - railRect.right);
  tools.scrollBy({ left: delta, behavior: reducedMotion.matches ? "auto" : "smooth" });
});
$("#editSlider").addEventListener("input", event => { state.edits[activeTool] = Number(event.target.value); syncTool(); schedulePreview(); });
$("#resetEdits").addEventListener("click", () => { state.edits = { ...NEUTRAL_EDITS }; syncTool(); renderPreview(); });
function startDeveloping() {
  if (!complete() || !renderPreview()) return;
  const run = ++developmentRun;
  clearTimeout(developmentFallback);
  $("#developButton").disabled = true;
  $("#developingPrintHost").appendChild(printReveal);
  const screen = $("#developingScreen");
  screen.classList.remove("is-printing"); screen.classList.add("is-preparing"); screen.setAttribute("aria-busy", "true");
  // Keep tall strips comfortably inside the screen and align the camera to the print.
  showScreen("developingScreen");
  fitPrintToViewport();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (run !== developmentRun) return;
    screen.classList.remove("is-preparing"); void printObject.offsetWidth; screen.classList.add("is-printing");
    developmentFallback = setTimeout(() => finishDeveloping(run), reducedMotion.matches ? 220 : 3200);
  }));
}
function finishDeveloping(run) {
  if (run !== developmentRun || !$("#developingScreen").classList.contains("is-printing")) return;
  clearTimeout(developmentFallback);
  $("#developingScreen").classList.remove("is-printing", "is-preparing");
  $("#developingScreen").setAttribute("aria-busy", "false");
  $("#resultPhotoHost").dataset.layout = state.layout;
  $("#resultPhotoHost").appendChild(printReveal);
  hasDeveloped = true; $("#developButton").disabled = false; showScreen("resultScreen");
  fitPrintToViewport();
}
function fitPrintToViewport() {
  const height = window.visualViewport?.height || window.innerHeight;
  const shellStyle = getComputedStyle($(".app-shell"));
  const availableWidth = $(".app-shell").clientWidth - parseFloat(shellStyle.paddingLeft) - parseFloat(shellStyle.paddingRight);
  const ratio = canvas.width / canvas.height;
  const safeBottom = parseFloat(shellStyle.paddingBottom) || 20;
  $("#developingContent").style.width = Math.max(60, Math.min(460, availableWidth, (height - 170 - safeBottom) / (1 / ratio + .25))) + "px";
  $("#resultPhotoHost").style.maxWidth = Math.max(60, Math.min(460, availableWidth, (height - 200 - safeBottom) * ratio)) + "px";
}
window.addEventListener("resize", fitPrintToViewport);
window.visualViewport?.addEventListener("resize", fitPrintToViewport);
$("#caption").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); event.target.blur(); }
});
printObject.addEventListener("animationend", () => finishDeveloping(developmentRun));
$("#developButton").addEventListener("click", startDeveloping);
function triggerDownload(url, filename) {
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
}
$("#saveButton").addEventListener("click", () => {
  if (!hasDeveloped) return;
  const filename = "still-" + state.layout + "-" + state.style + ".png";
  canvas.toBlob(blob => {
    if (!blob) { $("#resultStatus").textContent = "Could not save. Please try again."; return; }
    const url = URL.createObjectURL(blob); triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("#resultStatus").textContent = "Your PNG is ready. Keep it somewhere lovely.";
  }, "image/png");
});
function resetApp() {
  ++developmentRun; clearTimeout(developmentFallback); clearTimeout(renderTimer);
  pendingUploads.clear();
  state.photos.forEach((photo, i) => { ++uploadVersions[i]; if (photo) URL.revokeObjectURL(photo.url); });
  Object.assign(state, { layout: "single", variation: "hero", style: "classic", edits: { ...NEUTRAL_EDITS }, caption: "", photos: Array(4).fill(null) });
  clearPhotoCache(); hasDeveloped = false; activeTool = "light";
  $("#caption").value = "";
  $("#editPanel").open = false;
  document.querySelector('input[name="layout"][value="single"]').checked = true;
  document.querySelector('input[name="frameStyle"][value="classic"]').checked = true;
  document.querySelectorAll('input[type="file"]').forEach(input => { input.value = ""; });
  for (const id of ["status", "customStatus", "resultStatus"]) $("#" + id).textContent = "";
  canvas.width = 1; canvas.height = 1;
  $("#previewHost").appendChild(printReveal);
  syncVariations(); syncUploads(); syncTool(); showScreen("uploadScreen");
}
$("#tryAgainButton").addEventListener("click", resetApp);
window.addEventListener("beforeunload", () => state.photos.forEach(photo => { if (photo) URL.revokeObjectURL(photo.url); }));
function dismissAppSplash() {
  const splash = $("#appSplash");
  if (!splash) return;
  if (reducedMotion.matches) { splash.remove(); return; }
  splash.classList.add("is-leaving");
  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  setTimeout(() => splash.remove(), 500);
}
window.addEventListener("load", () => {
  setTimeout(dismissAppSplash, 180);
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}, { once: true });
syncVariations(); syncUploads(); syncTool();
