const {
  eraseContiguousRegion,
  fillContiguousRegion,
} = window.ImageOps;

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_PIXELS = 12_000_000;
const MAX_IMAGE_EDGE = 16_384;
const INITIAL_IMAGE_HEADER_BYTES = 512 * 1024;
const MAX_IMAGE_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_HISTORY_BYTES = 128 * 1024 * 1024;
const MAX_HISTORY_ENTRIES = 200;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;
const MAX_POINTER_EDIT_MOVEMENT = 9;
const TOLERANCE_STEP = 1;
const REAPPLY_DELAY = 140;
const EDIT_MARKER_LINGER = 900;
// The reach to catch a point is in screen pixels rather than picture pixels, so
// a point is no harder to grab when the picture is small. The wall a line makes
// is the other way round, and belongs to the code that stamps it.
const GUIDE_GRAB_REACH = 8;
const GUIDE_ERASE_REACH = 14;
const GUIDE_DOUBLE_CLICK_WAIT = 350;
// A fingertip covers far more of the screen than a mouse pointer or a pencil tip,
// so a finger gets more room to land on a point.
const GUIDE_TOUCH_GRAB_REACH = 22;
const GUIDE_TOUCH_ERASE_REACH = 28;
const RECENT_COLOR_LIMIT = 13;
const ARROW_KEYS = new Set(["arrowleft", "arrowright", "arrowup", "arrowdown"]);
const DADS_PRIMITIVE_GRADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
const DADS_COLOR_PALETTE = [
  ["blue", "青", DADS_PRIMITIVE_GRADES, ["#e8f1fe", "#d9e6ff", "#c5d7fb", "#9db7f9", "#7096f8", "#4979f5", "#3460fb", "#264af4", "#0031d8", "#0017c1", "#00118f", "#000071", "#000060"]],
  ["light-blue", "ライトブルー", DADS_PRIMITIVE_GRADES, ["#f0f9ff", "#dcf0ff", "#c0e4ff", "#97d3ff", "#57b8ff", "#39abff", "#008bf2", "#0877d7", "#0066be", "#0055ad", "#00428c", "#00316a", "#00234b"]],
  ["cyan", "シアン", DADS_PRIMITIVE_GRADES, ["#e9f7f9", "#c8f8ff", "#99f2ff", "#79e2f2", "#2bc8e4", "#01b7d6", "#00a3bf", "#008da6", "#008299", "#006f83", "#006173", "#004c59", "#003741"]],
  ["green", "緑", DADS_PRIMITIVE_GRADES, ["#e6f5ec", "#c2e5d1", "#9bd4b5", "#71c598", "#51b883", "#2cac6e", "#259d63", "#1d8b56", "#197a4b", "#115a36", "#0c472a", "#08351f", "#032213"]],
  ["lime", "ライム", DADS_PRIMITIVE_GRADES, ["#ebfad9", "#d0f5a2", "#c0f354", "#ade830", "#9ddd15", "#8cc80c", "#7eb40d", "#6fa104", "#618e00", "#507500", "#3e5a00", "#2c4100", "#1e2d00"]],
  ["yellow", "黄", DADS_PRIMITIVE_GRADES, ["#fbf5e0", "#fff0b3", "#ffe380", "#ffd43d", "#ffc700", "#ebb700", "#d2a400", "#b78f00", "#a58000", "#927200", "#806300", "#6e5600", "#604b00"]],
  ["orange", "オレンジ", DADS_PRIMITIVE_GRADES, ["#ffeee2", "#ffdfca", "#ffc199", "#ffa66d", "#ff8d44", "#ff7628", "#fb5b01", "#e25100", "#c74700", "#ac3e00", "#8b3200", "#6d2700", "#541e00"]],
  ["red", "赤", DADS_PRIMITIVE_GRADES, ["#fdeeee", "#ffdada", "#ffbbbb", "#ff9696", "#ff7171", "#ff5454", "#fe3939", "#fa0000", "#ec0000", "#ce0000", "#a90000", "#850000", "#620000"]],
  ["magenta", "マゼンタ", DADS_PRIMITIVE_GRADES, ["#f3e5f4", "#ffd0ff", "#ffaeff", "#ff8eff", "#f661f6", "#f137f1", "#db00db", "#c000c0", "#aa00aa", "#8b008b", "#6c006c", "#500050", "#3b003b"]],
  ["purple", "紫", DADS_PRIMITIVE_GRADES, ["#f1eafa", "#ecddff", "#ddc2ff", "#cda6ff", "#bb87ff", "#a565f8", "#8843e1", "#6f23d0", "#5c10be", "#5109ad", "#41048e", "#30016c", "#21004b"]],
  ["neutral", "ニュートラル", ["white", "solid-gray-50", "solid-gray-100", "solid-gray-200", "solid-gray-300", "solid-gray-400", "solid-gray-420", "solid-gray-500", "solid-gray-536", "solid-gray-600", "solid-gray-700", "solid-gray-800", "solid-gray-900"], ["#ffffff", "#f2f2f2", "#e6e6e6", "#cccccc", "#b3b3b3", "#999999", "#949494", "#7f7f7f", "#767676", "#666666", "#4d4d4d", "#333333", "#1a1a1a"]],
];
const USWDS_STANDARD_PALETTE = [
  ["red-cool", "赤 Cool", ["#f8eff1", "#f3e1e4", "#ecbec6", "#e09aa6", "#e16b80", "#cd425b", "#9e394b", "#68363f", "#40282c", "#1e1517"]],
  ["red", "赤", ["#f9eeee", "#f8e1de", "#f7bbb1", "#f2938c", "#e9695f", "#d83933", "#a23737", "#6f3331", "#3e2927", "#1b1616"]],
  ["red-warm", "赤 Warm", ["#f6efea", "#f4e3db", "#ecc0a7", "#dca081", "#d27a56", "#c3512c", "#805039", "#524236", "#332d29", "#1f1c18"]],
  ["orange-warm", "オレンジ Warm", ["#faeee5", "#fbe0d0", "#f7bca2", "#f3966d", "#e17141", "#bd5727", "#914734", "#633a32", "#3d2925", "#1c1615"]],
  ["orange", "オレンジ", ["#f6efe9", "#f2e4d4", "#f3bf90", "#f09860", "#dd7533", "#a86437", "#775540", "#524236", "#332d27", "#1b1614"]],
  ["gold", "ゴールド", ["#f5f0e6", "#f1e5cd", "#dec69a", "#c7a97b", "#ad8b65", "#8e704f", "#6b5947", "#4d4438", "#322d26", "#191714"]],
  ["yellow", "黄", ["#faf3d1", "#f5e6af", "#e6c74c", "#c9ab48", "#a88f48", "#8a7237", "#6b5a39", "#504332", "#332d27", "#1a1614"]],
  ["green-warm", "緑 Warm", ["#f1f4d7", "#e7eab7", "#cbd17a", "#a6b557", "#8a984b", "#6f7a41", "#5a5f38", "#45472f", "#2d2f21", "#171712"]],
  ["green", "緑", ["#eaf4dd", "#dfeacd", "#b8d293", "#9bb672", "#7d9b4e", "#607f35", "#4c6424", "#3c4a29", "#293021", "#161814"]],
  ["green-cool", "緑 Cool", ["#ecf3ec", "#dbebde", "#b4d0b9", "#86b98e", "#5e9f69", "#4d8055", "#446443", "#37493b", "#28312a", "#1a1f1a"]],
  ["mint", "ミント", ["#dbf6ed", "#c7efe2", "#92d9bb", "#5abf95", "#34a37e", "#2e8367", "#286846", "#204e34", "#193324", "#0d1a12"]],
  ["mint-cool", "ミント Cool", ["#e0f7f6", "#c4eeeb", "#9bd4cf", "#6fbab3", "#4f9e99", "#40807e", "#376462", "#2a4b45", "#203131", "#111818"]],
  ["cyan", "シアン", ["#e7f6f8", "#ccecf2", "#99deea", "#5dc0d1", "#449dac", "#168092", "#2a646d", "#2c4a4e", "#203133", "#111819"]],
  ["blue-cool", "青 Cool", ["#e7f2f5", "#dae9ee", "#adcfdc", "#82b4c9", "#6499af", "#3a7d95", "#2e6276", "#224a58", "#14333d", "#0f191c"]],
  ["blue", "青", ["#eff6fb", "#d9e8f6", "#aacdec", "#73b3e7", "#4f97d1", "#2378c3", "#2c608a", "#274863", "#1f303e", "#11181d"]],
  ["blue-warm", "青 Warm", ["#ecf1f7", "#e1e7f1", "#bbcae4", "#98afd2", "#7292c7", "#4a77b4", "#345d96", "#2f4668", "#252f3e", "#13171f"]],
  ["indigo-cool", "藍 Cool", ["#eef0f9", "#e1e6f9", "#bbc8f5", "#96abee", "#6b8ee8", "#496fd8", "#3f57a6", "#374274", "#292d42", "#151622"]],
  ["indigo", "藍", ["#efeff8", "#e5e4fa", "#c5c5f3", "#a5a8eb", "#8889db", "#676cc8", "#4d52af", "#3d4076", "#2b2c40", "#16171f"]],
  ["indigo-warm", "藍 Warm", ["#f1eff7", "#e7e3fa", "#cbc4f2", "#afa5e8", "#9287d8", "#7665d1", "#5e519e", "#453c7b", "#2e2c40", "#18161d"]],
  ["violet", "紫", ["#f4f1f9", "#ebe3f9", "#d0c3e9", "#b8a2e3", "#9d84d2", "#8168b3", "#665190", "#4c3d69", "#312b3f", "#18161d"]],
  ["violet-warm", "紫 Warm", ["#f8f0f9", "#f6dff8", "#e2bee4", "#d29ad8", "#bf77c8", "#b04abd", "#864381", "#5c395a", "#382936", "#1b151b"]],
  ["magenta", "マゼンタ", ["#f9f0f2", "#f6e1e8", "#f0bbcc", "#e895b3", "#e0699f", "#c84281", "#8b4566", "#66364b", "#402731", "#1b1617"]],
  ["gray-cool", "グレー Cool", ["#edeff0", "#dfe1e2", "#c6cace", "#a9aeb1", "#8d9297", "#71767a", "#565c65", "#3d4551", "#2d2e2f", "#1c1d1f"]],
  ["gray", "グレー", ["#f0f0f0", "#e6e6e6", "#c9c9c9", "#adadad", "#919191", "#757575", "#5c5c5c", "#454545", "#2e2e2e", "#1b1b1b"]],
  ["gray-warm", "グレー Warm", ["#f0f0ec", "#e6e6e2", "#cac9c0", "#afaea2", "#929285", "#76766a", "#5d5d52", "#454540", "#2e2e2a", "#171716"]],
];
const USWDS_STANDARD_GRADES = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90];
const USWDS_VIVID_GRADES = ["5v", "10v", "20v", "30v", "40v", "50v", "60v", "70v", "80v"];
const USWDS_VIVID_PALETTE = [
  ["red-cool", "赤 Cool Vivid", USWDS_VIVID_GRADES, ["#fff2f5", "#f8dfe2", "#f8b9c5", "#fd8ba0", "#f45d79", "#e41d3d", "#b21d38", "#822133", "#4f1c24"]],
  ["red", "赤 Vivid", USWDS_VIVID_GRADES, ["#fff3f2", "#fde0db", "#fdb8ae", "#ff8d7b", "#fb5a47", "#e52207", "#b50909", "#8b0a03", "#5c1111"]],
  ["red-warm", "赤 Warm Vivid", USWDS_VIVID_GRADES, ["#fff5ee", "#fce1d4", "#f6bd9c", "#f39268", "#ef5e25", "#d54309", "#9c3d10", "#63340f", "#3e2a1e"]],
  ["orange-warm", "オレンジ Warm Vivid", USWDS_VIVID_GRADES, ["#fff3ea", "#ffe2d1", "#fbbaa7", "#fc906d", "#ff580a", "#cf4900", "#a72f10", "#782312", "#3d231d"]],
  ["orange", "オレンジ Vivid", USWDS_VIVID_GRADES, ["#fef2e4", "#fce2c5", "#ffbc78", "#fa9441", "#e66f0e", "#c05600", "#8c471c", "#5f3617", "#352313"]],
  ["gold", "ゴールド Vivid", USWDS_VIVID_GRADES, ["#fef0c8", "#ffe396", "#ffbe2e", "#e5a000", "#c2850c", "#936f38", "#7a591a", "#5c410a", "#3b2b15"]],
  ["yellow", "黄 Vivid", USWDS_VIVID_GRADES, ["#fff5c2", "#fee685", "#face00", "#ddaa01", "#b38c00", "#947100", "#776017", "#5c4809", "#422d19"]],
  ["green-warm", "緑 Warm Vivid", USWDS_VIVID_GRADES, ["#f5fbc1", "#e7f434", "#c5d30a", "#a3b72c", "#7e9c1d", "#6a7d00", "#5a6613", "#4b4e10", "#38380b"]],
  ["green", "緑 Vivid", USWDS_VIVID_GRADES, ["#ddf9c7", "#c5ee93", "#98d035", "#7fb135", "#719f2a", "#538200", "#466c04", "#2f4a0b", "#243413"]],
  ["green-cool", "緑 Cool Vivid", USWDS_VIVID_GRADES, ["#e3f5e1", "#b7f5bd", "#70e17b", "#21c834", "#00a91c", "#008817", "#216e1f", "#154c21", "#19311e"]],
  ["mint", "ミント Vivid", USWDS_VIVID_GRADES, ["#c9fbeb", "#83fcd4", "#0ceda6", "#04c585", "#00a871", "#008659", "#146947", "#0c4e29", "#0d351e"]],
  ["mint-cool", "ミント Cool Vivid", USWDS_VIVID_GRADES, ["#d5fbf3", "#7efbe1", "#29e1cb", "#1dc2ae", "#00a398", "#008480", "#0f6460", "#0b4b3f", "#123131"]],
  ["cyan", "シアン Vivid", USWDS_VIVID_GRADES, ["#e5faff", "#a8f2ff", "#52daf2", "#00bde3", "#009ec1", "#0081a1", "#00687d", "#0e4f5c", "#093b44"]],
  ["blue-cool", "青 Cool Vivid", USWDS_VIVID_GRADES, ["#e1f3f8", "#c3ebfa", "#97d4ea", "#59b9de", "#28a0cb", "#0d7ea2", "#07648d", "#074b69", "#002d3f"]],
  ["blue", "青 Vivid", USWDS_VIVID_GRADES, ["#e8f5ff", "#cfe8ff", "#a1d3ff", "#58b4ff", "#2491ff", "#0076d6", "#005ea2", "#0b4778", "#112f4e"]],
  ["blue-warm", "青 Warm Vivid", USWDS_VIVID_GRADES, ["#edf5ff", "#d4e5ff", "#adcdff", "#81aefc", "#5994f6", "#2672de", "#0050d8", "#1a4480", "#162e51"]],
  ["indigo-cool", "藍 Cool Vivid", USWDS_VIVID_GRADES, ["#edf0ff", "#dee5ff", "#b8c8ff", "#94adff", "#628ef4", "#4866ff", "#3e4ded", "#222fbf", "#1b2b85"]],
  ["indigo", "藍 Vivid", USWDS_VIVID_GRADES, ["#f0f0ff", "#e0e0ff", "#ccceff", "#a3a7fa", "#8289ff", "#656bd7", "#4a50c4", "#3333a3", "#212463"]],
  ["indigo-warm", "藍 Warm Vivid", USWDS_VIVID_GRADES, ["#f5f2ff", "#e4deff", "#cfc4fd", "#b69fff", "#967efb", "#745fe9", "#5942d2", "#3d2c9d", "#261f5b"]],
  ["violet", "紫 Vivid", USWDS_VIVID_GRADES, ["#f7f2ff", "#ede3ff", "#d5bfff", "#c39deb", "#ad79e9", "#9355dc", "#783cb9", "#54278f", "#39215e"]],
  ["violet-warm", "紫 Warm Vivid", USWDS_VIVID_GRADES, ["#fef2ff", "#fbdcff", "#f4b2ff", "#ee83ff", "#d85bef", "#be32d0", "#93348c", "#711e6c", "#481441"]],
  ["magenta", "マゼンタ Vivid", USWDS_VIVID_GRADES, ["#fff2f5", "#ffddea", "#ffb4cf", "#ff87b2", "#fd4496", "#d72d79", "#ab2165", "#731f44", "#4f172e"]],
];
const USWDS_COLOR_PALETTE = USWDS_STANDARD_PALETTE.flatMap((standardRow) => {
  const vividRow = USWDS_VIVID_PALETTE.find(([family]) => family === standardRow[0]);
  return vividRow ? [standardRow, vividRow] : [standardRow];
});

const elements = {
  appShell: document.querySelector(".app-shell"),
  canvas: document.querySelector("#editorCanvas"),
  canvasFrame: document.querySelector("#canvasFrame"),
  canvasMeta: document.querySelector("#canvasMeta"),
  canvasSize: document.querySelector("#canvasSize"),
  canvasStage: document.querySelector("#canvasStage"),
  canvasViewport: document.querySelector("#canvasViewport"),
  colorHex: document.querySelector("#colorHex"),
  colorPicker: document.querySelector("#colorPicker"),
  colorPreview: document.querySelector("#colorPreview"),
  colorSection: document.querySelector("#colorSection"),
  connectedAreaRadio: document.querySelector("#connectedAreaRadio"),
  dadsPalette: document.querySelector("#dadsPalette"),
  dadsPaletteTab: document.querySelector("#dadsPaletteTab"),
  documentName: document.querySelector("#documentName"),
  clearGuidesButton: document.querySelector("#clearGuidesButton"),
  dropOverlay: document.querySelector("#dropOverlay"),
  guideActions: document.querySelector("#guideActions"),
  guideCanvas: document.querySelector("#guideCanvas"),
  guideHelpText: document.querySelector("#guideHelpText"),
  editMarker: document.querySelector("#editMarker"),
  emptyCopy: document.querySelector(".empty-copy"),
  emptyDecor: document.querySelector("#emptyDecor"),
  emptyIllustration: document.querySelector(".empty-illustration"),
  emptyOpenButton: document.querySelector("#emptyOpenButton"),
  emptyState: document.querySelector("#emptyState"),
  erasePointButton: document.querySelector("#erasePointButton"),
  exportButton: document.querySelector("#exportButton"),
  fileInput: document.querySelector("#fileInput"),
  fitButton: document.querySelector("#fitButton"),
  newGuideButton: document.querySelector("#newGuideButton"),
  openButton: document.querySelector("#openButton"),
  reapplySpinner: document.querySelector("#reapplySpinner"),
  recentSwatches: document.querySelector("#recentSwatches"),
  redoButton: document.querySelector("#redoButton"),
  paletteDescription: document.querySelector("#paletteDescription"),
  settingsSection: document.querySelector("#settingsSection"),
  sidePanel: document.querySelector(".side-panel"),
  swatchTooltip: document.querySelector("#swatchTooltip"),
  toast: document.querySelector("#toast"),
  toastDismissButton: document.querySelector("#toastDismissButton"),
  toastLabel: document.querySelector("#toastLabel"),
  toastMessage: document.querySelector("#toastMessage"),
  toleranceSlider: document.querySelector("#toleranceSlider"),
  toleranceValue: document.querySelector("#toleranceValue"),
  toolButtons: [...document.querySelectorAll(".tool-card")],
  toolSpeech: document.querySelector("#toolSpeech"),
  toolSpeechText: document.querySelector("#toolSpeechText"),
  undoButton: document.querySelector("#undoButton"),
  uswdsPalette: document.querySelector("#uswdsPalette"),
  uswdsPaletteTab: document.querySelector("#uswdsPaletteTab"),
  wholePictureToggle: document.querySelector("#wholePictureToggle"),
  includeWhiteBlackToggle: document.querySelector("#includeWhiteBlackToggle"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
};

const context = elements.canvas.getContext("2d", { willReadFrequently: true });

const state = {
  activeTool: "eraser",
  color: "#ff7628",
  colorChosen: false,
  currentRevision: 0,
  documentFileName: "",
  historyLimit: 12,
  imageLoaded: false,
  isBusy: false,
  isFitMode: true,
  palette: "dads",
  nextRevision: 0,
  recentColors: [],
  redoStack: [],
  savedRevision: 0,
  undoStack: [],
  viewScale: 1,
};

let dragDepth = 0;
let canvasPointerGesture = null;
// Where the user has drawn a wall for this session: the lines as their points,
// and the same thing rasterised, one byte per pixel. Neither is written into
// the picture or exported.
let guidePaths = [];
let activeGuidePath = null;
let activeGuidePathIsNew = false;
let erasingGuidePointOnce = false;
let guideDrag = null;
let hoveredGuidePoint = null;
let pendingGuidePointClick = null;
let lastTapCornerAt = -Infinity;
// The point Delete takes away: the last one placed, grabbed or dragged.
let selectedGuidePoint = null;
let guideBarrier = null;
let resizeTimer = 0;
let swatchTooltipTimer = 0;
let swatchTooltipHideTimer = 0;
let toastTimer = 0;
let reapplyTimer = 0;
let editMarkerTimer = 0;
let lastEdit = null;
let selectedSwatches = [];

// Said by the tool in hand, in the sidebar under the tools. It stays there for as
// long as the tool is held, so none of it has to go through a toast that fades.
const TOOL_SPEECH = {
  eraser: "透過できます",
  bucket: "塗りつぶしできます",
  guide: "点をつないで線にしてください\n消しゴムもバケツも、この線で止められます",
};

// A screen worked by a finger or a pencil is tapped, not clicked, so the words
// that name the gesture follow the device.
const CLICK_WORD = window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ? "タップ" : "クリック";

const SWATCH_TOOLTIP_DELAY = 1000;
const SWATCH_TOOLTIP_GRACE = 150;
const swatchesByColor = new Map();

function renderPalette(container, palette, fallbackGrades, modifier) {
  const fragment = document.createDocumentFragment();

  for (const [family, label, rowGradesOrColors, possibleColors] of palette) {
    const grades = possibleColors ? rowGradesOrColors : fallbackGrades;
    const colors = possibleColors ?? rowGradesOrColors;
    const entries = colors
      .map((color, index) => ({ color, grade: grades[index] }))
      .filter(({ grade }) => modifier !== "uswds" || grade !== 90);
    const row = document.createElement("div");
    row.className = `palette-family palette-family--${modifier}`;
    row.style.setProperty("--palette-columns", entries.length);
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);

    const swatchParent = modifier === "dads" ? document.createElement("div") : row;
    if (modifier === "dads") {
      swatchParent.className = "palette-swatches";
    }

    entries.forEach(({ color, grade }) => {
      const token = family === "neutral" ? grade : `${family}-${grade}`;
      const swatchLabel = family === "neutral"
        ? grade === "white" ? "ホワイト" : "グレー"
        : label;
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.tabIndex = -1;
      swatch.dataset.color = color;
      swatch.style.setProperty("--swatch", color);
      swatch.setAttribute("aria-label", `${swatchLabel}、${token}、${color.toUpperCase()}`);
      swatch.setAttribute("aria-pressed", "false");
      swatch.dataset.tooltip = `${swatchLabel}｜${token}｜${color.toUpperCase()}`;
      const sameColor = swatchesByColor.get(swatch.dataset.color.toLowerCase());
      if (sameColor) {
        sameColor.push(swatch);
      } else {
        swatchesByColor.set(swatch.dataset.color.toLowerCase(), [swatch]);
      }
      swatchParent.append(swatch);
    });

    if (modifier === "dads") {
      row.append(swatchParent);
    }

    fragment.append(row);
  }

  // Put in front of anything already written in the panel, so the credit line
  // stays below the swatches.
  container.prepend(fragment);
}

function setRovingSwatchTabStop(swatches, preferred) {
  for (const swatch of swatches) {
    swatch.tabIndex = -1;
  }

  const tabStop = swatches.includes(preferred) ? preferred : swatches[0];
  if (tabStop) {
    tabStop.tabIndex = 0;
  }
  return tabStop ?? null;
}

function updateSwatchTabStops() {
  const activePalette = state.palette === "uswds" ? elements.uswdsPalette : elements.dadsPalette;
  const activeSwatches = [...activePalette.querySelectorAll(".swatch")];
  const paletteTabStop = activeSwatches.find((swatch) => swatch.classList.contains("is-selected")) ?? activeSwatches[0];
  setRovingSwatchTabStop(
    [...elements.dadsPalette.querySelectorAll(".swatch"), ...elements.uswdsPalette.querySelectorAll(".swatch")],
    paletteTabStop,
  );

  const recentSwatches = [...elements.recentSwatches.querySelectorAll(".swatch")];
  const recentTabStop = recentSwatches.find((swatch) => swatch.classList.contains("is-selected")) ?? recentSwatches[0];
  setRovingSwatchTabStop(recentSwatches, recentTabStop);
  return paletteTabStop ?? null;
}

function setPalette(palette) {
  const useUswds = palette === "uswds";
  const focusWasOnTab = document.activeElement === elements.dadsPaletteTab || document.activeElement === elements.uswdsPaletteTab;
  const focusWasInPalette = Boolean(document.activeElement?.closest?.(".palette-families"));
  if (state.palette !== (useUswds ? "uswds" : "dads")) {
    settleLastEdit();
  }

  state.palette = useUswds ? "uswds" : "dads";
  elements.dadsPalette.classList.toggle("is-hidden", useUswds);
  elements.uswdsPalette.classList.toggle("is-hidden", !useUswds);
  elements.dadsPaletteTab.classList.toggle("is-active", !useUswds);
  elements.uswdsPaletteTab.classList.toggle("is-active", useUswds);
  elements.dadsPaletteTab.setAttribute("aria-selected", String(!useUswds));
  elements.uswdsPaletteTab.setAttribute("aria-selected", String(useUswds));
  elements.dadsPaletteTab.tabIndex = useUswds ? -1 : 0;
  elements.uswdsPaletteTab.tabIndex = useUswds ? 0 : -1;
  elements.paletteDescription.textContent = useUswds ? "全423色" : "全143色";
  const swatchTabStop = updateSwatchTabStops();
  if (focusWasOnTab) {
    (useUswds ? elements.uswdsPaletteTab : elements.dadsPaletteTab).focus();
  } else if (focusWasInPalette) {
    swatchTabStop?.focus();
  }
}

function positionSwatchTooltip(swatch) {
  const tooltip = elements.swatchTooltip;
  const swatchRect = swatch.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const gap = 7;
  const edge = 8;
  const centeredLeft = swatchRect.left + (swatchRect.width - tooltipRect.width) / 2;
  const left = Math.min(window.innerWidth - tooltipRect.width - edge, Math.max(edge, centeredLeft));
  const top = swatchRect.top >= tooltipRect.height + gap + edge
    ? swatchRect.top - tooltipRect.height - gap
    : swatchRect.bottom + gap;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function renderSwatchTooltip(swatch) {
  const tooltip = elements.swatchTooltip;
  tooltip.textContent = swatch.dataset.tooltip;
  tooltip.hidden = false;
  positionSwatchTooltip(swatch);
}

function showSwatchTooltip(swatch, delay = SWATCH_TOOLTIP_DELAY) {
  window.clearTimeout(swatchTooltipTimer);
  window.clearTimeout(swatchTooltipHideTimer);

  // Waiting again once it is open would leave the previous colour on screen
  // while the cursor is already somewhere else.
  if (!elements.swatchTooltip.hidden) {
    renderSwatchTooltip(swatch);
    return;
  }

  swatchTooltipTimer = window.setTimeout(() => renderSwatchTooltip(swatch), delay);
}

// Crossing the 2px gap between two swatches must not count as leaving.
function releaseSwatchTooltip() {
  window.clearTimeout(swatchTooltipTimer);
  window.clearTimeout(swatchTooltipHideTimer);
  swatchTooltipHideTimer = window.setTimeout(hideSwatchTooltip, SWATCH_TOOLTIP_GRACE);
}

function hideSwatchTooltip() {
  window.clearTimeout(swatchTooltipTimer);
  window.clearTimeout(swatchTooltipHideTimer);
  elements.swatchTooltip.hidden = true;
}

function setColorControlsEnabled(enabled) {
  elements.colorHex.disabled = !enabled;
  elements.colorPicker.disabled = !enabled;
  elements.colorSection.setAttribute("aria-disabled", String(!enabled));
  elements.colorSection.inert = !enabled;
  if (!enabled) {
    hideSwatchTooltip();
  }
}

function setTool(tool) {
  if (!["eraser", "bucket", "guide"].includes(tool)) {
    return;
  }

  if (tool !== state.activeTool) {
    cancelPendingGuidePointClick();
    settleLastEdit();
    finishGuidePath();
    setGuideErasing(false);
    selectedGuidePoint = null;
  }

  state.activeTool = tool;
  for (const button of elements.toolButtons) {
    const isActive = button.dataset.tool === tool;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-checked", String(isActive));
    // The three are one choice, so Tab stops at the tool in hand, once.
    button.tabIndex = isActive ? 0 : -1;
  }
  elements.toolSpeech.dataset.tool = tool;
  updateGuideActions();
  elements.colorSection.classList.toggle("is-paint-tool-inactive", tool !== "bucket");

  setColorControlsEnabled(state.imageLoaded);
  elements.canvas.classList.toggle("is-drawing-guide", tool === "guide");
  updateGuideHelp();
  setHoveredGuidePoint(null);
  paintGuideOverlay();
}

function updateGuideHelp() {
  const visible = state.imageLoaded && state.activeTool === "guide";
  elements.guideHelpText.hidden = !visible;
}

function updateGuideActions() {
  const visible = state.activeTool === "guide" && guidePaths.length > 0;
  elements.guideActions.classList.toggle("is-hidden", !visible);
  elements.toolSpeech.classList.toggle("has-guide-actions", visible);
  elements.toolSpeechText.textContent = visible
    ? erasingGuidePointOnce
      ? `消したい点を${CLICK_WORD}`
      : "消しゴムもバケツも、この線で止められます"
    : TOOL_SPEECH[state.activeTool];
}

function setGuideErasing(on) {
  erasingGuidePointOnce = Boolean(on && state.activeTool === "guide" && guidePaths.length > 0);
  elements.erasePointButton.setAttribute("aria-pressed", String(erasingGuidePointOnce));
  elements.canvas.classList.toggle("is-erasing-point", erasingGuidePointOnce);
  setHoveredGuidePoint(hoveredGuidePoint);
  updateGuideActions();
  paintGuideOverlay();
}

function setStatus(message, options) {
  showToast(message, options);
}

function showToast(message, { error = false } = {}) {
  window.clearTimeout(toastTimer);
  elements.toastMessage.textContent = message;
  elements.toast.classList.toggle("is-error", error);
  elements.toastMessage.setAttribute("role", error ? "alert" : "status");
  elements.toastDismissButton.hidden = !error;
  elements.toastLabel.hidden = !error;
  elements.toast.setAttribute("aria-hidden", "false");
  elements.toast.classList.add("is-visible");
  if (error) {
    return;
  }

  toastTimer = window.setTimeout(dismissToast, 2400);
}

function dismissToast() {
  window.clearTimeout(toastTimer);
  elements.toast.classList.remove("is-visible");
  elements.toastDismissButton.hidden = true;
  elements.toastLabel.hidden = true;
  elements.toast.setAttribute("aria-hidden", "true");
}

function updateTolerance() {
  const value = Number(elements.toleranceSlider.value);
  // Writing to the field would drag the caret to its end, so it is only written
  // when it is holding something other than the value already.
  const text = String(value);
  if (elements.toleranceValue.value !== text) {
    elements.toleranceValue.value = text;
  }
  elements.toleranceSlider.style.background = `linear-gradient(to right, var(--primary) ${value}%, var(--gray-10) ${value}%)`;
}

function normalizeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#ff7628";
}

function setColor(color) {
  const normalizedColor = normalizeColor(color);
  if (normalizedColor !== state.color) {
    settleLastEdit();
  }

  state.color = normalizedColor;
  elements.colorPicker.value = normalizedColor;
  elements.colorPreview.style.backgroundColor = normalizedColor;
  if (document.activeElement !== elements.colorHex) {
    elements.colorHex.value = normalizedColor.toUpperCase();
  }

  for (const swatch of selectedSwatches) {
    swatch.classList.remove("is-selected");
    swatch.setAttribute("aria-pressed", "false");
  }

  selectedSwatches = state.colorChosen ? swatchesByColor.get(normalizedColor) ?? [] : [];
  for (const swatch of selectedSwatches) {
    swatch.classList.add("is-selected");
    swatch.setAttribute("aria-pressed", "true");
  }

  for (const swatch of elements.recentSwatches.children) {
    if (!swatch.dataset.color) {
      continue;
    }
    const isSelected = state.colorChosen && swatch.dataset.color === normalizedColor;
    swatch.classList.toggle("is-selected", isSelected);
    swatch.setAttribute("aria-pressed", String(isSelected));
  }
  updateSwatchTabStops();
}

function choosePaintColor(color) {
  state.colorChosen = true;
  setColor(color);
  if (state.imageLoaded && !state.isBusy) {
    setTool("bucket");
  }
}

// Nothing is marked selected until the colour is picked or actually used, so
// the untouched palette carries no ring the user never asked for.
function markColorChosen() {
  if (state.colorChosen) {
    return;
  }

  state.colorChosen = true;
  setColor(state.color);
}

function visiblePaletteRows() {
  const container = state.palette === "uswds" ? elements.uswdsPalette : elements.dadsPalette;
  return [...container.querySelectorAll(".palette-family")]
    .map((row) => [...row.querySelectorAll(".swatch")]);
}

function selectSwatch(swatch, moveFocus = false) {
  choosePaintColor(swatch.dataset.color);
  if (moveFocus) {
    swatch.focus();
  }
  swatch.scrollIntoView({ block: "nearest" });
}

function moveSwatchSelection(key, moveFocus = false, startingSwatch = null) {
  const rows = visiblePaletteRows();
  if (rows.length === 0) {
    return;
  }

  let rowIndex = -1;
  let columnIndex = -1;
  if (startingSwatch) {
    rows.forEach((row, index) => {
      const found = row.indexOf(startingSwatch);
      if (rowIndex === -1 && found !== -1) {
        rowIndex = index;
        columnIndex = found;
      }
    });
  }

  rows.forEach((row, index) => {
    const found = row.findIndex((swatch) => swatch.dataset.color === state.color);
    if (rowIndex === -1 && state.colorChosen && found !== -1) {
      rowIndex = index;
      columnIndex = found;
    }
  });

  // The picker can hold a colour this palette does not contain.
  if (rowIndex === -1) {
    selectSwatch(rows[0][0], moveFocus);
    return;
  }

  if (key === "arrowup" || key === "arrowdown") {
    rowIndex = clamp(rowIndex + (key === "arrowdown" ? 1 : -1), 0, rows.length - 1);
  } else {
    columnIndex += key === "arrowright" ? 1 : -1;
  }

  const row = rows[rowIndex];
  selectSwatch(row[clamp(columnIndex, 0, row.length - 1)], moveFocus);
}

function moveRecentSwatchSelection(swatch, key) {
  const swatches = [...elements.recentSwatches.querySelectorAll(".swatch")];
  const currentIndex = swatches.indexOf(swatch);
  if (currentIndex === -1) {
    return;
  }

  const forwards = key === "arrowright" || key === "arrowdown";
  selectSwatch(swatches[clamp(currentIndex + (forwards ? 1 : -1), 0, swatches.length - 1)], true);
}

function rememberColor(color) {
  const kept = state.recentColors.filter((entry) => entry !== color);
  state.recentColors = [color, ...kept].slice(0, RECENT_COLOR_LIMIT);
  renderRecentColors();
  markColorChosen();
}

function renderRecentColors() {
  elements.recentSwatches.replaceChildren();

  for (const color of state.recentColors) {
    const swatch = document.createElement("button");
    const isSelected = state.colorChosen && color === state.color;
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.tabIndex = -1;
    swatch.dataset.color = color;
    swatch.dataset.tooltip = color.toUpperCase();
    swatch.style.setProperty("--swatch", color);
    swatch.setAttribute("aria-label", `最近使った色、${color.toUpperCase()}`);
    swatch.setAttribute("aria-pressed", String(isSelected));
    swatch.classList.toggle("is-selected", isSelected);
    elements.recentSwatches.append(swatch);
  }

  // The row holds its place from the start, so the first colour used does not
  // push the palette down from under the cursor.
  for (let index = state.recentColors.length; index < RECENT_COLOR_LIMIT; index += 1) {
    const slot = document.createElement("span");
    slot.className = "recent-slot";
    slot.setAttribute("aria-hidden", "true");
    elements.recentSwatches.append(slot);
  }
  updateSwatchTabStops();
}

function cssColorToRgba(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function hasUnsavedChanges() {
  return state.imageLoaded && state.currentRevision !== state.savedRevision;
}

function updateDocumentState() {
  const isEdited = hasUnsavedChanges();
  elements.documentName.classList.toggle("is-edited", isEdited);
  const name = state.documentFileName || "新しいキャンバス";
  elements.documentName.querySelector(".document-name-full").textContent = `${name}${isEdited ? " • 編集中" : ""}`;
}

function updateHistoryButtons() {
  elements.undoButton.disabled = state.undoStack.length === 0;
  elements.redoButton.disabled = state.redoStack.length === 0;
}

function setImageActionsEnabled(enabled) {
  elements.exportButton.disabled = !enabled;
  elements.fitButton.disabled = !enabled;
  elements.zoomInButton.disabled = !enabled || state.viewScale >= MAX_ZOOM;
  elements.zoomOutButton.disabled = !enabled || state.viewScale <= MIN_ZOOM;
}

function setEditingControlsEnabled(enabled) {
  elements.sidePanel.classList.toggle("is-ready", state.imageLoaded);
  elements.toleranceSlider.disabled = !enabled;
  elements.toleranceValue.disabled = !enabled;
  elements.connectedAreaRadio.disabled = !enabled;
  elements.wholePictureToggle.disabled = !enabled;
  elements.includeWhiteBlackToggle.disabled = !enabled;
  elements.settingsSection.setAttribute("aria-disabled", String(!enabled));
  for (const button of elements.toolButtons) {
    button.disabled = !enabled;
  }

  setColorControlsEnabled(enabled);
  updateGuideHelp();
}

// Being busy does not change how the controls look. An edit is worked out in
// one go, and a press made meanwhile is only handled once it is done, so taking
// the controls out of reach for that time only faded the tools and the save
// button on every click - and faded is how this app says "cannot be used".
// Opening a picture and writing the PNG do let presses through, and none of
// them can get in the way: what must not start meanwhile - an edit, undo and
// redo, saving, opening another picture - checks state.isBusy for itself.
function setBusy(isBusy) {
  state.isBusy = isBusy;
  elements.canvas.classList.toggle("is-busy", isBusy);
  setImageActionsEnabled(state.imageLoaded);
  setEditingControlsEnabled(state.imageLoaded);
  updateHistoryButtons();
}

function copyCurrentImageData() {
  return context.getImageData(0, 0, elements.canvas.width, elements.canvas.height);
}

function restoreImageData(imageData) {
  const restored = imageData instanceof ImageData
    ? imageData
    : new ImageData(imageData.data, imageData.width, imageData.height);
  context.putImageData(restored, 0, 0);
}

// A step back is a step back whichever the user took last, so the guide lines
// share one history with the picture. An entry holds the state to return to:
// the picture, unless the step never touched it, and the lines as their points.
function historyEntry(imageData) {
  return { imageData, revision: state.currentRevision, guides: guideSnapshot() };
}

function pushHistory(stack, entry) {
  stack.push(entry);
  // The memory budget is about pictures, so only the steps carrying one count
  // against it: a run of guide-line steps must not push the picture history
  // out. The plain cap on entries keeps a long session from growing forever.
  let pictures = stack.reduce((count, item) => count + (item.imageData === null ? 0 : 1), 0);
  while (pictures > state.historyLimit || stack.length > MAX_HISTORY_ENTRIES) {
    if (stack.shift().imageData !== null) {
      pictures -= 1;
    }
  }
}

function commitEdit(beforeImageData) {
  pushHistory(state.undoStack, historyEntry(beforeImageData));
  state.redoStack = [];
  state.nextRevision += 1;
  state.currentRevision = state.nextRevision;
  updateHistoryButtons();
  updateDocumentState();
}

// Moving a guide line changes nothing in the picture, so it takes a step in the
// history without making the document unsaved: the revision stays where it is.
function commitGuideChange(beforeGuides) {
  pushHistory(state.undoStack, { imageData: null, revision: state.currentRevision, guides: beforeGuides });
  state.redoStack = [];
  updateHistoryButtons();
}

// A step back waits while a press is still down. A guide point it holds has no
// step of its own until it is let go of (endGuideDrag), and a step taken around
// it would hand the point to redo, to come back without ever landing.
function undo() {
  if (state.isBusy || canvasPointerGesture !== null || state.undoStack.length === 0) {
    return;
  }

  const previous = state.undoStack[state.undoStack.length - 1];
  try {
    const current = historyEntry(previous.imageData === null ? null : copyCurrentImageData());
    if (previous.imageData !== null) {
      restoreImageData(previous.imageData);
    }
    restoreGuides(previous.guides);
    state.undoStack.pop();
    pushHistory(state.redoStack, current);
    state.currentRevision = previous.revision;
    settleLastEdit();
    updateHistoryButtons();
    updateDocumentState();
    setStatus(previous.imageData === null ? "区切り線をひとつ前に戻しました" : "ひとつ前の状態に戻しました");
  } catch {
    setStatus("元に戻せませんでした。画像サイズを小さくしてお試しください", { error: true });
  }
}

function redo() {
  if (state.isBusy || canvasPointerGesture !== null || state.redoStack.length === 0) {
    return;
  }

  const next = state.redoStack[state.redoStack.length - 1];
  try {
    const current = historyEntry(next.imageData === null ? null : copyCurrentImageData());
    if (next.imageData !== null) {
      restoreImageData(next.imageData);
    }
    restoreGuides(next.guides);
    state.redoStack.pop();
    pushHistory(state.undoStack, current);
    state.currentRevision = next.revision;
    settleLastEdit();
    updateHistoryButtons();
    updateDocumentState();
    setStatus(next.imageData === null ? "区切り線をやり直しました" : "編集をやり直しました");
  } catch {
    setStatus("やり直せませんでした。画像サイズを小さくしてお試しください", { error: true });
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function availableCanvasSpace() {
  const styles = window.getComputedStyle(elements.canvasStage);
  const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  return {
    width: Math.max(1, elements.canvasStage.clientWidth - horizontalPadding),
    height: Math.max(1, elements.canvasStage.clientHeight - verticalPadding),
  };
}

function applyZoom(scale, fitMode = false) {
  if (!state.imageLoaded) {
    return;
  }

  state.viewScale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  state.isFitMode = fitMode;
  const displayWidth = Math.max(1, Math.round(elements.canvas.width * state.viewScale));
  const displayHeight = Math.max(1, Math.round(elements.canvas.height * state.viewScale));
  elements.canvas.style.width = `${displayWidth}px`;
  elements.canvas.style.height = `${displayHeight}px`;
  elements.canvasFrame.style.width = `${displayWidth}px`;
  elements.canvasFrame.style.height = `${displayHeight}px`;
  elements.canvas.classList.toggle("is-magnified", state.viewScale >= 1);
  elements.fitButton.textContent = `${Math.round(state.viewScale * 100)}%`;
  elements.zoomOutButton.disabled = state.viewScale <= MIN_ZOOM;
  elements.zoomInButton.disabled = state.viewScale >= MAX_ZOOM;
  paintGuideOverlay();
}

function fitImageToViewport() {
  if (!state.imageLoaded) {
    return;
  }

  const available = availableCanvasSpace();
  // Filling the space is only worth doing when the picture is too big for it.
  // Blown up to fill the window, a small picture is further from the drawing
  // than it needs to be, so it is shown at its own size and the room is left
  // over. Making it larger than that is something the user asks for.
  const fitScale = Math.min(
    1,
    available.width / elements.canvas.width,
    available.height / elements.canvas.height,
  );
  applyZoom(fitScale, true);
  elements.canvasStage.scrollLeft = 0;
  elements.canvasStage.scrollTop = 0;
}

function zoomAtClientPoint(scale, clientX, clientY) {
  if (!state.imageLoaded) {
    return;
  }

  const before = elements.canvas.getBoundingClientRect();
  const anchorX = (clientX - before.left) / before.width;
  const anchorY = (clientY - before.top) / before.height;
  applyZoom(scale, false);

  const after = elements.canvas.getBoundingClientRect();
  elements.canvasStage.scrollLeft += after.left + anchorX * after.width - clientX;
  elements.canvasStage.scrollTop += after.top + anchorY * after.height - clientY;
}

function adjustZoom(factor) {
  if (!state.imageLoaded) {
    return;
  }

  const bounds = elements.canvasStage.getBoundingClientRect();
  zoomAtClientPoint(
    state.viewScale * factor,
    bounds.left + bounds.width / 2,
    bounds.top + bounds.height / 2,
  );
}

function isSupportedImage(file) {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return true;
  }

  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

function confirmDiscardIfNeeded() {
  if (!hasUnsavedChanges()) {
    return true;
  }

  return window.confirm("保存していない編集があります。新しい画像を開きますか？");
}

function readUint24LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function textAt(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }

  return null;
}

function webpDimensions(bytes, view) {
  if (
    bytes.length < 30 ||
    textAt(bytes, 0, 4) !== "RIFF" ||
    textAt(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = textAt(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;

    if (chunkType === "VP8X" && dataOffset + 10 <= bytes.length) {
      return {
        width: readUint24LittleEndian(bytes, dataOffset + 4) + 1,
        height: readUint24LittleEndian(bytes, dataOffset + 7) + 1,
      };
    }
    if (chunkType === "VP8L" && dataOffset + 5 <= bytes.length && bytes[dataOffset] === 0x2f) {
      const sizeBits = view.getUint32(dataOffset + 1, true);
      return {
        width: (sizeBits & 0x3fff) + 1,
        height: ((sizeBits >>> 14) & 0x3fff) + 1,
      };
    }
    if (
      chunkType === "VP8 " &&
      dataOffset + 10 <= bytes.length &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      return {
        width: view.getUint16(dataOffset + 6, true) & 0x3fff,
        height: view.getUint16(dataOffset + 8, true) & 0x3fff,
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return null;
}

async function readImageDimensions(file) {
  const declaredSize = Number.isFinite(file.size) && file.size >= 0
    ? file.size
    : INITIAL_IMAGE_HEADER_BYTES;
  const scanLimit = Math.min(
    Math.max(declaredSize, 1),
    MAX_IMAGE_HEADER_BYTES,
  );
  let requestedBytes = Math.min(INITIAL_IMAGE_HEADER_BYTES, scanLimit);
  let format = "";

  while (requestedBytes > 0) {
    const header = await file.slice(0, requestedBytes).arrayBuffer();
    const bytes = new Uint8Array(header);
    const view = new DataView(header);

    if (!format) {
      if (bytes.length >= 8 && textAt(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
        format = "png";
      } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        format = "jpeg";
      } else if (
        bytes.length >= 12 &&
        textAt(bytes, 0, 4) === "RIFF" &&
        textAt(bytes, 8, 4) === "WEBP"
      ) {
        format = "webp";
      } else {
        return null;
      }
    }

    if (
      format === "png" &&
      bytes.length >= 24 &&
      textAt(bytes, 12, 4) === "IHDR"
    ) {
      return {
        width: view.getUint32(16),
        height: view.getUint32(20),
      };
    }

    const dimensions = format === "jpeg"
      ? jpegDimensions(bytes)
      : format === "webp"
        ? webpDimensions(bytes, view)
        : null;
    if (dimensions !== null) {
      return dimensions;
    }

    if (
      format === "png" ||
      bytes.length < requestedBytes ||
      requestedBytes >= declaredSize
    ) {
      return null;
    }
    if (requestedBytes >= MAX_IMAGE_HEADER_BYTES) {
      throw new Error("Image dimensions are beyond the safe metadata scan limit");
    }

    requestedBytes = Math.min(
      requestedBytes * 2,
      declaredSize,
      MAX_IMAGE_HEADER_BYTES,
    );
  }

  return null;
}

function imageIsTooLarge(width, height) {
  return (
    width * height > MAX_IMAGE_PIXELS ||
    width > MAX_IMAGE_EDGE ||
    height > MAX_IMAGE_EDGE
  );
}

async function loadImageFile(file) {
  if (state.isBusy) {
    elements.fileInput.value = "";
    setStatus("処理が終わってから新しい画像を開いてください");
    return;
  }

  if (!file || !isSupportedImage(file)) {
    elements.fileInput.value = "";
    setStatus("PNG・JPG・WebPの画像を選んでください", { error: true });
    return;
  }

  if (!confirmDiscardIfNeeded()) {
    elements.fileInput.value = "";
    return;
  }

  setBusy(true);
  setStatus("画像を読み込んでいます…");
  let objectUrl = "";
  let opened = false;

  try {
    const dimensions = await readImageDimensions(file);
    if (dimensions && imageIsTooLarge(dimensions.width, dimensions.height)) {
      setStatus("画像が大きすぎます。1,200万画素・長辺16,384px以下にしてください", { error: true });
      return;
    }

    objectUrl = URL.createObjectURL(file);
    const image = await decodeImage(objectUrl);
    if (imageIsTooLarge(image.naturalWidth, image.naturalHeight)) {
      setStatus("画像が大きすぎます。1,200万画素・長辺16,384px以下にしてください", { error: true });
      return;
    }

    elements.canvas.width = image.naturalWidth;
    elements.canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);

    state.imageLoaded = true;
    state.documentFileName = file.name;
    state.undoStack = [];
    state.redoStack = [];
    settleLastEdit();
    resetGuides();
    state.currentRevision = 0;
    state.savedRevision = 0;
    state.nextRevision = 0;
    state.historyLimit = clamp(
      Math.floor(MAX_HISTORY_BYTES / (elements.canvas.width * elements.canvas.height * 4)),
      1,
      20,
    );

    elements.emptyState.classList.add("is-hidden");
    elements.canvasStage.classList.remove("is-hidden");
    elements.canvasSize.textContent = `${image.naturalWidth.toLocaleString()} × ${image.naturalHeight.toLocaleString()} px`;
    updateHistoryButtons();
    updateDocumentState();
    requestAnimationFrame(fitImageToViewport);
    setTool(state.activeTool);
    opened = true;
  } catch {
    setStatus("画像を読み込めませんでした。ファイルを確認してください", { error: true });
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    elements.fileInput.value = "";
    setBusy(false);
    // Whichever button opened the picture is gone or spent by now, and the
    // empty state took its own button away with it, so the focus would drop
    // back to the top of the page. The sidebar takes it, and Tab from there
    // walks along the tools. Not the tool in hand itself: its ring would stay
    // behind when a key picks another tool, and read as two tools chosen.
    if (opened) {
      dismissToast();
      elements.sidePanel.focus();
    }
  }
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function runAfterNextPaint(callback) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

// A wall the user draws is temporary: it lives beside the picture, blocks the
// bucket and the eraser while it is there, and leaves nothing behind when it
// goes. Nothing about the image changes, so there is no history entry for it.
//
// A line is kept as the points that were placed, not as the pixels they cover,
// so a point can still be dragged after the line is drawn and the wall follows.
// Correcting a line costs one drag instead of drawing the whole line again.
function resetGuides() {
  cancelPendingGuidePointClick();
  guidePaths = [];
  activeGuidePath = null;
  activeGuidePathIsNew = false;
  erasingGuidePointOnce = false;
  elements.erasePointButton.setAttribute("aria-pressed", "false");
  elements.canvas.classList.remove("is-erasing-point");
  guideDrag = null;
  selectedGuidePoint = null;
  setHoveredGuidePoint(null);
  guideBarrier = null;
  elements.guideCanvas.setAttribute("viewBox", `0 0 ${elements.canvas.width} ${elements.canvas.height}`);
  elements.guideCanvas.replaceChildren();
  updateGuideActions();
}

// Points, copied out and copied back, are all a step in the history needs to
// hold: the pixels of the wall are rebuilt from them.
function copyGuidePaths(paths) {
  const copiedPoints = new Map();
  return paths.map((path) => {
    const copy = path.map((point) => {
      if (!copiedPoints.has(point)) {
        copiedPoints.set(point, { ...point });
      }
      return copiedPoints.get(point);
    });
    if (path.closed) {
      copy.closed = true;
    }
    return copy;
  });
}

function guideSnapshot() {
  return copyGuidePaths(guidePaths);
}

function restoreGuides(paths) {
  cancelPendingGuidePointClick();
  guidePaths = copyGuidePaths(paths);
  activeGuidePath = null;
  activeGuidePathIsNew = false;
  erasingGuidePointOnce = false;
  elements.erasePointButton.setAttribute("aria-pressed", "false");
  elements.canvas.classList.remove("is-erasing-point");
  guideDrag = null;
  selectedGuidePoint = null;
  setHoveredGuidePoint(null);
  rebuildGuides();
}

function mixPoints(from, to, ratio) {
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

// Centripetal Catmull-Rom. The curve passes through every point that was placed
// and stays close to the straight line between them, so the wall lands where
// the points say it does, and a bend needs no handles of its own to control.
function curvePointBetween(before, from, to, after, ratio) {
  const knot = (a, b) => Math.max(Math.hypot(b.x - a.x, b.y - a.y) ** 0.5, 1e-4);
  const first = knot(before, from);
  const second = first + knot(from, to);
  const third = second + knot(to, after);
  const time = first + (second - first) * ratio;
  const beforeFrom = mixPoints(before, from, time / first);
  const fromTo = mixPoints(from, to, (time - first) / (second - first));
  const toAfter = mixPoints(to, after, (time - second) / (third - second));
  return mixPoints(
    mixPoints(beforeFrom, fromTo, time / second),
    mixPoints(fromTo, toAfter, (time - first) / (third - first)),
    (time - first) / (second - first),
  );
}

// The two ends have no neighbour to lean on, so they lean on themselves: the
// curve leaves the first point and reaches the last one straight. A corner is
// told to do the same in the middle of a line: with nothing reaching across it,
// the curve arrives and leaves along the chords, and the bend is as sharp as
// the two chords make it.
//
// A ring has no ends at all. Every point has a neighbour on both sides, the
// seam where the last point meets the first bends like any other join, and the
// line it draws comes back to where it started.
function guidePolyline(points) {
  if (points.length < 2) {
    return points.slice();
  }

  const count = points.length;
  const ring = points.closed === true;
  const neighbour = (index, alone) => (ring ? points[(index + count) % count] : points[index] ?? alone);

  const line = [points[0]];
  for (let index = 0; index < (ring ? count : count - 1); index += 1) {
    const from = points[index];
    const to = neighbour(index + 1, from);
    const before = from.corner ? from : neighbour(index - 1, from);
    const after = to.corner ? to : neighbour(index + 2, to);
    const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
    for (let step = 1; step <= steps; step += 1) {
      line.push(curvePointBetween(before, from, to, after, step / steps));
    }
  }
  return line;
}

// The wall every line makes, rebuilt from scratch whenever the points move, so
// that a line taken away leaves nothing of itself behind.
function paintGuideBarrier() {
  if (guidePaths.every((path) => path.length < 2)) {
    guideBarrier = null;
    return;
  }

  guideBarrier = ImageOps.createGuideBarrier(
    elements.canvas.width,
    elements.canvas.height,
    guidePaths.map(guidePolyline),
    guideBarrier,
  );
}

// Kept at a steady size on screen, so a line is as easy to see and to catch
// zoomed out as it is zoomed in. The points appear only while the tool that
// moves them is selected; the rest of the time they would just cover the work.
//
// The line stays thin, since a thin line is what puts a wall exactly where it
// belongs. Over violet, over dark ground or across a close hatch it all but
// vanishes, so a faint white glow lies under it: unseen on white paper, and just
// enough to lift the line off everything else. The points are white already.
function paintGuideOverlay() {
  const inPixels = (onScreen) => onScreen / Math.max(state.viewScale, MIN_ZOOM);
  const svgElement = (tag, attributes, children = []) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, String(value));
    }
    node.replaceChildren(...children);
    return node;
  };
  const shapes = [];
  const extent = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };

  for (const path of guidePaths) {
    const line = guidePolyline(path);
    if (line.length < 2) {
      continue;
    }
    for (const point of line) {
      extent.left = Math.min(extent.left, point.x);
      extent.top = Math.min(extent.top, point.y);
      extent.right = Math.max(extent.right, point.x);
      extent.bottom = Math.max(extent.bottom, point.y);
    }
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    shape.setAttribute("points", line.map((point) => `${point.x + 0.5},${point.y + 0.5}`).join(" "));
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke", "rgba(147, 85, 220, 0.85)"); // USWDS violet-50v
    shape.setAttribute("stroke-width", "1");
    shape.setAttribute("stroke-linecap", "round");
    shape.setAttribute("stroke-linejoin", "round");
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    shape.setAttribute("filter", "url(#guideGlow)");
    shapes.push(shape);
  }

  // The glow is a screen pixel of blur at every zoom, like the line. It is drawn
  // within where the lines are, padded by its reach: a straight line has no
  // height to measure a region from, and nothing outside the region is drawn.
  if (extent.left <= extent.right) {
    const reach = inPixels(4);
    shapes.push(svgElement("defs", {}, [
      svgElement("filter", {
        id: "guideGlow",
        filterUnits: "userSpaceOnUse",
        x: extent.left + 0.5 - reach,
        y: extent.top + 0.5 - reach,
        width: extent.right - extent.left + reach * 2,
        height: extent.bottom - extent.top + reach * 2,
        "color-interpolation-filters": "sRGB",
      }, [
        svgElement("feFlood", { "flood-color": "#ffffff", result: "white" }), // DADS white
        svgElement("feComposite", { in: "white", in2: "SourceAlpha", operator: "in", result: "line" }),
        svgElement("feGaussianBlur", { in: "line", stdDeviation: inPixels(1), result: "blur" }),
        svgElement("feComponentTransfer", { in: "blur", result: "glow" }, [
          svgElement("feFuncA", { type: "linear", slope: 1.6 }),
        ]),
        svgElement("feMerge", {}, [
          svgElement("feMergeNode", { in: "glow" }),
          svgElement("feMergeNode", { in: "SourceGraphic" }),
        ]),
      ]),
    ]));
  }

  if (state.activeTool === "guide") {
    const radius = inPixels(5.5);
    for (const path of guidePaths) {
      for (let index = 0; index < path.length; index += 1) {
        const live = hoveredGuidePoint !== null
          && hoveredGuidePoint.path === path
          && hoveredGuidePoint.index === index;
        const chosen = selectedGuidePoint !== null
          && selectedGuidePoint.path === path
          && selectedGuidePoint.index === index;
        const ink = live && erasingGuidePointOnce
          ? "rgba(213, 67, 9, 0.95)"
          : "rgba(84, 39, 143, 0.95)";
        const size = live ? radius * 1.2 : radius;
        const point = document.createElementNS(
          "http://www.w3.org/2000/svg",
          path[index].corner ? "rect" : "circle",
        );
        // Square for a corner, round for a smooth point, so which points bend and
        // which turn can be read off the line without touching any of them.
        if (path[index].corner) {
          point.setAttribute("x", path[index].x + 0.5 - size);
          point.setAttribute("y", path[index].y + 0.5 - size);
          point.setAttribute("width", size * 2);
          point.setAttribute("height", size * 2);
        } else {
          point.setAttribute("cx", path[index].x + 0.5);
          point.setAttribute("cy", path[index].y + 0.5);
          point.setAttribute("r", size);
        }
        point.setAttribute("fill", live || chosen ? ink : "#ffffff");
        point.setAttribute("stroke", ink);
        point.setAttribute("stroke-width", "1.5");
        point.setAttribute("vector-effect", "non-scaling-stroke");
        shapes.push(point);
      }
    }
  }

  elements.guideCanvas.replaceChildren(...shapes);
}

function rebuildGuides() {
  paintGuideBarrier();
  paintGuideOverlay();
  updateGuideActions();
}

function guidePointAt(point, reachOnScreen = GUIDE_GRAB_REACH) {
  const reach = Math.max(3, reachOnScreen / Math.max(state.viewScale, MIN_ZOOM));
  let closest = null;
  let shortest = reach * reach;
  for (const path of guidePaths) {
    for (let index = 0; index < path.length; index += 1) {
      const distance = (path[index].x - point.x) ** 2 + (path[index].y - point.y) ** 2;
      if (distance <= shortest) {
        shortest = distance;
        closest = { path, index };
      }
    }
  }
  return closest;
}

function guideReachFor(event, erasing = false) {
  if (event.pointerType === "touch") {
    return erasing ? GUIDE_TOUCH_ERASE_REACH : GUIDE_TOUCH_GRAB_REACH;
  }
  return erasing ? GUIDE_ERASE_REACH : GUIDE_GRAB_REACH;
}

function canContinueGuideFrom(found) {
  return found !== null && activeGuidePath === null;
}

function canConnectGuideTo(found) {
  return found !== null
    && activeGuidePath !== null
    && found.path[found.index] !== activeGuidePath[activeGuidePath.length - 1];
}

function canCloseGuidePathAt(found) {
  return found !== null
    && found.path === activeGuidePath
    && found.index === 0
    && activeGuidePath.length >= 3;
}

function guidePointClickAction(found) {
  if (canCloseGuidePathAt(found)) {
    return "close";
  }
  if (canConnectGuideTo(found)) {
    return "connect";
  }
  if (canContinueGuideFrom(found)) {
    return "continue";
  }
  return null;
}

function cancelPendingGuidePointClick() {
  if (pendingGuidePointClick === null) {
    return;
  }
  window.clearTimeout(pendingGuidePointClick.timer);
  pendingGuidePointClick = null;
}

function performPendingGuidePointClick() {
  if (pendingGuidePointClick === null) {
    return;
  }

  const pending = pendingGuidePointClick;
  window.clearTimeout(pending.timer);
  pendingGuidePointClick = null;
  if (
    state.activeTool !== "guide" ||
    state.isBusy ||
    !guidePaths.includes(pending.found.path) ||
    pending.found.path[pending.found.index] !== pending.point
  ) {
    return;
  }

  if (pending.action === "close") {
    closeGuidePathAt(pending.found);
  } else if (pending.action === "connect") {
    connectGuideTo(pending.found);
  } else {
    continueGuideFrom(pending.found);
  }
}

function scheduleGuidePointClick(found, action) {
  cancelPendingGuidePointClick();
  const pending = {
    action,
    found,
    point: found.path[found.index],
    timer: 0,
  };
  pending.timer = window.setTimeout(() => {
    if (pendingGuidePointClick === pending) {
      performPendingGuidePointClick();
    }
  }, GUIDE_DOUBLE_CLICK_WAIT);
  pendingGuidePointClick = pending;
}

function connectGuideTo(found) {
  if (!canConnectGuideTo(found)) {
    return false;
  }

  const before = guideSnapshot();
  if (activeGuidePathIsNew) {
    guidePaths.push(activeGuidePath);
    activeGuidePathIsNew = false;
  }
  // Both paths hold the same point object, so dragging the joined point later
  // keeps the connection intact instead of pulling one line away from it.
  activeGuidePath.push(found.path[found.index]);
  selectedGuidePoint = { path: activeGuidePath, index: activeGuidePath.length - 1 };
  activeGuidePath = null;
  activeGuidePathIsNew = false;
  setHoveredGuidePoint(null);
  commitGuideChange(before);
  rebuildGuides();
  setStatus("既存の点につなぎました");
  return true;
}

function continueGuideFrom(found) {
  if (!canContinueGuideFrom(found)) {
    return false;
  }

  const isOpenEnd = !found.path.closed
    && found.path.length >= 2
    && (found.index === 0 || found.index === found.path.length - 1);
  if (isOpenEnd && found.index === 0) {
    found.path.reverse();
  }
  if (isOpenEnd) {
    activeGuidePath = found.path;
    activeGuidePathIsNew = false;
  } else {
    activeGuidePath = [found.path[found.index]];
    activeGuidePathIsNew = true;
  }
  selectedGuidePoint = { path: activeGuidePath, index: activeGuidePath.length - 1 };
  setHoveredGuidePoint(null);
  paintGuideOverlay();
  updateGuideActions();
  setStatus("この点から区切り線を続けられます");
  return true;
}

// Showing which point a press would take hold of, before the press happens.
// The cursor changes as well, in the class the stylesheet reads.
function setHoveredGuidePoint(found) {
  const before = hoveredGuidePoint;
  const same = before === null
    ? found === null
    : found !== null && found.path === before.path && found.index === before.index;
  elements.canvas.classList.toggle(
    "can-continue-guide",
    !erasingGuidePointOnce && canContinueGuideFrom(found),
  );
  elements.canvas.classList.toggle(
    "can-connect-guide",
    !erasingGuidePointOnce && canConnectGuideTo(found),
  );
  if (same) {
    return;
  }

  hoveredGuidePoint = found;
  elements.canvas.classList.toggle("is-over-point", found !== null);
  paintGuideOverlay();
}

function trackGuideHover(event) {
  if (state.activeTool !== "guide") {
    setHoveredGuidePoint(null);
    return;
  }

  // A point being dragged stays the live one wherever the cursor has got to.
  if (guideDrag === null) {
    setHoveredGuidePoint(guidePointAt(
      canvasPointFromEvent(event),
      erasingGuidePointOnce ? GUIDE_ERASE_REACH : GUIDE_GRAB_REACH,
    ));
  }
}

// A point put down by a press is drawn, and walls the fill, at once, but takes
// its step in the history only when the press lets go of it (endGuideDrag). A
// press cut short takes it back up as though it had never landed.
function addGuidePoint(point) {
  const placed = {
    before: guideSnapshot(),
    paths: [...guidePaths],
    activeGuidePath,
    activeGuidePathIsNew,
    chosen: selectedGuidePoint,
  };
  if (activeGuidePath === null) {
    activeGuidePath = [];
    guidePaths.push(activeGuidePath);
    activeGuidePathIsNew = false;
  } else if (activeGuidePathIsNew) {
    guidePaths.push(activeGuidePath);
    activeGuidePathIsNew = false;
  }

  activeGuidePath.push(point);
  rebuildGuides();
  return { path: activeGuidePath, index: activeGuidePath.length - 1, placed };
}

function takeBackGuidePoint({ path, index, placed }) {
  guideDrag = null;
  path.splice(index, 1);
  guidePaths = placed.paths;
  activeGuidePath = placed.activeGuidePath;
  activeGuidePathIsNew = placed.activeGuidePathIsNew;
  selectedGuidePoint = placed.chosen;
  setHoveredGuidePoint(null);
  rebuildGuides();
}

function removeGuidePoint({ path, index }) {
  if (path === activeGuidePath && activeGuidePathIsNew) {
    activeGuidePath = null;
    activeGuidePathIsNew = false;
    selectedGuidePoint = null;
    setHoveredGuidePoint(null);
    rebuildGuides();
    return;
  }

  const before = guideSnapshot();
  const removedPoint = path[index];
  // Joined lines share one point object. Removing that one logical point from
  // every line keeps an overlapping copy from appearing to survive the click.
  for (const guidePath of guidePaths) {
    for (let pointIndex = guidePath.length - 1; pointIndex >= 0; pointIndex -= 1) {
      if (guidePath[pointIndex] === removedPoint) {
        guidePath.splice(pointIndex, 1);
      }
    }
    // Two points enclose nothing, so what is left is a line again, not a ring.
    if (guidePath.length < 3) {
      delete guidePath.closed;
    }
  }
  guidePaths = guidePaths.filter((guidePath) => guidePath.length > 0);
  if (activeGuidePath !== null && !guidePaths.includes(activeGuidePath)) {
    activeGuidePath = null;
    activeGuidePathIsNew = false;
  }
  selectedGuidePoint = null;
  setHoveredGuidePoint(null);
  commitGuideChange(before);
  rebuildGuides();
}

// Every point is smooth, which is what tracing around a shape mostly wants.
// Where the shape actually turns, the point is told to stop leaning on its
// neighbours, instead of crowding more points around it until it looks sharp.
// A double click asks for it: it lands on a point that is already down, so it
// costs no gesture of its own and takes nothing from the click that places one.
function toggleGuideCornerAt(event) {
  if (
    state.activeTool !== "guide" ||
    !state.imageLoaded ||
    state.isBusy ||
    erasingGuidePointOnce
  ) {
    return;
  }
  // A double tap has already turned the corner on its second release; a browser
  // that follows it with a dblclick of its own must not turn it back.
  if (event.type === "dblclick" && Date.now() - lastTapCornerAt < GUIDE_DOUBLE_CLICK_WAIT) {
    return;
  }
  if (event.type !== "dblclick") {
    lastTapCornerAt = Date.now();
  }

  const found = guidePointAt(canvasPointFromEvent(event), guideReachFor(event));
  if (found === null) {
    return;
  }

  // A double click belongs wholly to changing the corner. Its first click must
  // not also continue or connect a line.
  cancelPendingGuidePointClick();
  const before = guideSnapshot();
  const point = found.path[found.index];
  if (point.corner) {
    delete point.corner;
  } else {
    point.corner = true;
  }
  commitGuideChange(before);
  rebuildGuides();
}

// A line that comes back to where it started is the one shape a fill cannot
// slip around, so the point the line began at doubles as the way to close it:
// press it and the line becomes a ring and is done. Two points enclose nothing,
// so until there is a third the first point is still just a point to be moved.
function closeGuidePathAt(found) {
  if (!canCloseGuidePathAt(found)) {
    return false;
  }

  const before = guideSnapshot();
  activeGuidePath.closed = true;
  activeGuidePath = null;
  activeGuidePathIsNew = false;
  setHoveredGuidePoint(null);
  commitGuideChange(before);
  rebuildGuides();
  setStatus("区切り線を輪にしました");
  return true;
}

// A line ends where the user says it does, so the next click starts a new line
// instead of joining the last one. A lone point walls nothing off, so it leaves
// with the line it never became.
function finishGuidePath() {
  if (activeGuidePath === null) {
    return false;
  }

  if (activeGuidePathIsNew) {
    activeGuidePath = null;
    activeGuidePathIsNew = false;
    rebuildGuides();
    return true;
  }

  if (activeGuidePath.length < 2) {
    const before = guideSnapshot();
    guidePaths.splice(guidePaths.indexOf(activeGuidePath), 1);
    commitGuideChange(before);
  }
  activeGuidePath = null;
  activeGuidePathIsNew = false;
  rebuildGuides();
  return true;
}

function startNewGuide() {
  cancelPendingGuidePointClick();
  setGuideErasing(false);
  finishGuidePath();
  selectedGuidePoint = null;
  setHoveredGuidePoint(null);
  updateGuideActions();
  setStatus(`キャンバスを${CLICK_WORD}して、新しい区切り線を始められます`);
}

function clearGuides() {
  if (guidePaths.length === 0) {
    return;
  }

  const before = guideSnapshot();
  resetGuides();
  commitGuideChange(before);
  setStatus("区切り線をすべて消しました");
}

function canvasPointFromEvent(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - bounds.left) / bounds.width) * elements.canvas.width),
    y: Math.floor(((event.clientY - bounds.top) / bounds.height) * elements.canvas.height),
  };
}

function releaseCanvasPointerCapture(pointerId, captureTarget = elements.canvas) {
  try {
    if (captureTarget.hasPointerCapture(pointerId)) {
      captureTarget.releasePointerCapture(pointerId);
    }
  } catch {
    // The browser may already have released capture after cancellation.
  }
}

function startCanvasPointerGesture(event, captureTarget = elements.canvas) {
  if (
    event.button !== 0 ||
    !state.imageLoaded ||
    state.isBusy ||
    canvasPointerGesture !== null
  ) {
    return;
  }

  const point = canvasPointFromEvent(event);
  let guidePointAction = null;
  let cornerOnRelease = false;

  if (state.activeTool === "guide") {
    guideDrag = guidePointAt(point, guideReachFor(event, erasingGuidePointOnce));
    if (erasingGuidePointOnce) {
      if (guideDrag !== null) {
        removeGuidePoint(guideDrag);
        setGuideErasing(false);
      }
      guideDrag = null;
      return;
    }

    let suppressPointClick = false;
    if (pendingGuidePointClick !== null) {
      const clickedPoint = guideDrag === null ? null : guideDrag.path[guideDrag.index];
      if (clickedPoint === pendingGuidePointClick.point) {
        // This is the second press of a double click. Leave both single-click
        // actions unused; the following dblclick event changes the corner. A
        // pencil or a finger may never send one, so for them the release of this
        // press changes it.
        cancelPendingGuidePointClick();
        suppressPointClick = true;
        cornerOnRelease = event.pointerType === "pen" || event.pointerType === "touch";
      } else {
        // A quick click somewhere else is normal drawing, not a double click.
        // Apply the first point action now so this press sees the right path.
        performPendingGuidePointClick();
        guideDrag = guidePointAt(point, guideReachFor(event));
      }
    }

    if (guideDrag === null) {
      // Nothing to grab here, so this press puts a point down and the line is
      // drawn at once. The press keeps hold of it: sliding before letting go
      // places it, and that is still the one step the point cost.
      guideDrag = addGuidePoint(point);
      guideDrag.origin = { ...point };
      setHoveredGuidePoint(guideDrag);
    } else {
      guidePointAction = suppressPointClick ? null : guidePointClickAction(guideDrag);
      // A whole drag is one step back, not one per pixel the point passed over.
      guideDrag.before = guideSnapshot();
      guideDrag.origin = { ...guideDrag.path[guideDrag.index] };
      guideDrag.chosen = selectedGuidePoint;
      setHoveredGuidePoint(guideDrag);
    }
    // The point this press holds, placed or grabbed, is the one Delete takes.
    selectedGuidePoint = { path: guideDrag.path, index: guideDrag.index };
    paintGuideOverlay();
  }

  canvasPointerGesture = {
    pointerId: event.pointerId,
    captureTarget,
    point,
    drawingGuide: state.activeTool === "guide",
    guidePointAction,
    cornerOnRelease,
    startX: event.clientX,
    startY: event.clientY,
    movedTooFar: false,
  };

  try {
    captureTarget.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic pointer events may not have an active pointer to capture.
  }
}

function trackCanvasPointerGesture(event) {
  if (
    canvasPointerGesture === null ||
    canvasPointerGesture.pointerId !== event.pointerId
  ) {
    return;
  }

  if (!canvasPointerGesture.movedTooFar) {
    const deltaX = event.clientX - canvasPointerGesture.startX;
    const deltaY = event.clientY - canvasPointerGesture.startY;
    canvasPointerGesture.movedTooFar =
      deltaX * deltaX + deltaY * deltaY > MAX_POINTER_EDIT_MOVEMENT ** 2;
  }

  if (guideDrag !== null) {
    Object.assign(guideDrag.path[guideDrag.index], canvasPointFromEvent(event));
    // Only the line itself is redrawn while the point is on the move. The wall
    // it makes is rebuilt when the point comes to rest.
    paintGuideOverlay();
  }
}

function cancelCanvasPointerGesture(event) {
  if (
    canvasPointerGesture === null ||
    canvasPointerGesture.pointerId !== event.pointerId
  ) {
    return;
  }

  const { captureTarget } = canvasPointerGesture;
  canvasPointerGesture = null;
  // Only letting go says what a press did to the line. A press cut short, by a
  // second finger turning the touch into a pinch or by the browser taking the
  // pointer, leaves the line and the chosen point as the press found them and
  // takes no step: a point it put down is taken back up, and a point it dragged
  // goes back.
  if (guideDrag?.placed !== undefined) {
    takeBackGuidePoint(guideDrag);
  } else if (guideDrag !== null) {
    Object.assign(guideDrag.path[guideDrag.index], guideDrag.origin);
    selectedGuidePoint = guideDrag.chosen;
    endGuideDrag();
    setHoveredGuidePoint(null);
    paintGuideOverlay();
  }
  releaseCanvasPointerCapture(event.pointerId, captureTarget);
}

function endGuideDrag() {
  if (guideDrag === null) {
    return;
  }

  const moved = guideDrag.path[guideDrag.index];
  const shifted = moved.x !== guideDrag.origin.x || moved.y !== guideDrag.origin.y;
  // A point this press put down takes its one step now, however far it slid.
  if (guideDrag.placed !== undefined) {
    commitGuideChange(guideDrag.placed.before);
  } else if (guideDrag.before !== undefined && shifted) {
    commitGuideChange(guideDrag.before);
  }
  guideDrag = null;
  // The wall is read by an edit and by nothing else, so it is built once the
  // point has come to rest, where every way a drag can end passes through,
  // rather than on each movement of the mouse: building it is work over the
  // whole picture, and during the drag not one pixel of it is looked at. A
  // point that never left where it was leaves the wall standing as it is.
  if (shifted) {
    rebuildGuides();
  }
}

function finishCanvasPointerGesture(event) {
  if (
    canvasPointerGesture === null ||
    canvasPointerGesture.pointerId !== event.pointerId
  ) {
    return;
  }

  const gesture = canvasPointerGesture;
  const deltaX = event.clientX - gesture.startX;
  const deltaY = event.clientY - gesture.startY;
  const movedTooFar =
    gesture.movedTooFar ||
    deltaX * deltaX + deltaY * deltaY > MAX_POINTER_EDIT_MOVEMENT ** 2;

  canvasPointerGesture = null;
  releaseCanvasPointerCapture(event.pointerId, gesture.captureTarget);

  if (gesture.drawingGuide) {
    const clickedExistingPoint = guideDrag !== null
      && guideDrag.before !== undefined
      && !movedTooFar;
    if (clickedExistingPoint) {
      Object.assign(guideDrag.path[guideDrag.index], guideDrag.origin);
    }
    const actionTarget = !clickedExistingPoint || gesture.guidePointAction === null
      ? null
      : { path: guideDrag.path, index: guideDrag.index };
    endGuideDrag();
    if (actionTarget !== null) {
      scheduleGuidePointClick(actionTarget, gesture.guidePointAction);
    }
    if (gesture.cornerOnRelease && !movedTooFar) {
      toggleGuideCornerAt(event);
    }
    return;
  }

  if (!movedTooFar) {
    editAtPoint(gesture.point);
  }
}

function editAtPoint(point) {
  if (!state.imageLoaded || state.isBusy) {
    return;
  }

  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= elements.canvas.width ||
    point.y >= elements.canvas.height
  ) {
    return;
  }

  const visibleTolerance = Number(elements.toleranceSlider.value);
  const visibleWholePicture = elements.wholePictureToggle.checked;
  const visibleIncludeWhiteAndBlack = elements.includeWhiteBlackToggle.checked;
  if (
    lastEdit !== null &&
    (
      visibleTolerance !== lastEdit.tolerance ||
      visibleWholePicture !== lastEdit.wholePicture ||
      visibleIncludeWhiteAndBlack !== lastEdit.includeWhiteAndBlack
    )
  ) {
    window.clearTimeout(reapplyTimer);
    reapplyTimer = 0;
    reapplyLastEdit(visibleTolerance, visibleWholePicture, visibleIncludeWhiteAndBlack, () => editAtPoint(point));
    return;
  }

  setBusy(true);
  const editTool = state.activeTool;
  const editColor = state.color;
  // The click is the edit in hand from the moment it lands, not only once it is
  // worked out a frame or two later. A range moved in between turns the spinner
  // like any other change, and the edit reads the settings as they then stand.
  lastEdit = {
    tool: editTool,
    point,
    color: editColor,
    tolerance: visibleTolerance,
    wholePicture: visibleWholePicture,
    includeWhiteAndBlack: visibleIncludeWhiteAndBlack,
    committed: false,
  };
  setStatus(editTool === "eraser" ? "選択範囲を透過しています…" : "選択範囲を塗りつぶしています…");

  runAfterNextPaint(() => {
    try {
      const editTolerance = Number(elements.toleranceSlider.value);
      const editWholePicture = elements.wholePictureToggle.checked;
      const editIncludeWhiteAndBlack = elements.includeWhiteBlackToggle.checked;
      const before = copyCurrentImageData();
      const result = editTool === "eraser"
        ? eraseContiguousRegion(before, point.x, point.y, editTolerance, guideBarrier, editWholePicture, editIncludeWhiteAndBlack)
        : fillContiguousRegion(before, point.x, point.y, cssColorToRgba(editColor), editTolerance, guideBarrier, editWholePicture, editIncludeWhiteAndBlack);

      lastEdit = {
        tool: editTool,
        point,
        color: editColor,
        tolerance: editTolerance,
        wholePicture: editWholePicture,
        includeWhiteAndBlack: editIncludeWhiteAndBlack,
        committed: false,
      };

      if (result.changedPixels === 0) {
        setStatus("見た目が変わらないため、編集は追加しませんでした。許容範囲を広げてみてください");
        return;
      }

      restoreImageData(result);
      commitEdit(before);
      lastEdit.committed = true;
      if (editTool === "bucket") {
        rememberColor(editColor);
      }
      const reach = editWholePicture ? "画像全体の同じ色" : "同じ色の連続範囲";
      const message = editTool === "eraser"
        ? `${reach}を透過しました`
        : `${reach}を塗りつぶしました`;
      setStatus(message);
    } catch {
      setStatus("編集できませんでした。別の場所でもう一度お試しください", { error: true });
    } finally {
      setBusy(false);
    }
  });
}

// The slider redoes the last edit only while that edit is still live, and
// anything meaning the user has moved on settles it, so a drag meant for the
// next click cannot rewrite it. The marker only answers "which spot is the
// slider moving?", so it shows while the slider is in use and then leaves.
function showEditMarker() {
  window.clearTimeout(editMarkerTimer);
  elements.editMarker.style.left = `${((lastEdit.point.x + 0.5) / elements.canvas.width) * 100}%`;
  elements.editMarker.style.top = `${((lastEdit.point.y + 0.5) / elements.canvas.height) * 100}%`;
  elements.editMarker.classList.remove("is-hidden");
  editMarkerTimer = window.setTimeout(hideEditMarker, EDIT_MARKER_LINGER);
}

function hideEditMarker() {
  window.clearTimeout(editMarkerTimer);
  elements.editMarker.classList.add("is-hidden");
}

function settleLastEdit() {
  if (lastEdit === null) {
    return;
  }

  window.clearTimeout(reapplyTimer);
  reapplyTimer = 0;
  lastEdit = null;
  hideEditMarker();
  elements.reapplySpinner.hidden = true;
}

// A changed setting is redone a moment after the change, and on a large picture
// the redo then takes a second or two in which the page cannot even move the
// slider. The spinner beside the range turns from the change until the last redo
// is done. A redo still to come keeps it turning, so a drag that runs several in
// a row does not blink it off between them.
function scheduleReapply() {
  if (lastEdit === null) {
    return;
  }

  showEditMarker();
  window.clearTimeout(reapplyTimer);
  reapplyTimer = window.setTimeout(runPendingReapply, REAPPLY_DELAY);
  elements.reapplySpinner.hidden = false;
}

function runPendingReapply() {
  reapplyTimer = 0;
  if (lastEdit === null) {
    return;
  }

  if (state.isBusy) {
    scheduleReapply();
    return;
  }

  const tolerance = Number(elements.toleranceSlider.value);
  const wholePicture = elements.wholePictureToggle.checked;
  const includeWhiteAndBlack = elements.includeWhiteBlackToggle.checked;
  if (
    tolerance !== lastEdit.tolerance ||
    wholePicture !== lastEdit.wholePicture ||
    includeWhiteAndBlack !== lastEdit.includeWhiteAndBlack
  ) {
    reapplyLastEdit(tolerance, wholePicture, includeWhiteAndBlack);
  } else {
    elements.reapplySpinner.hidden = true;
  }
}

function reapplyLastEdit(tolerance, wholePicture, includeWhiteAndBlack, onComplete = null) {
  const edit = lastEdit;
  const entry = edit.committed ? state.undoStack[state.undoStack.length - 1] : null;
  if (edit.committed && (!entry || entry.imageData === null)) {
    settleLastEdit();
    onComplete?.();
    return;
  }

  setBusy(true);

  runAfterNextPaint(() => {
    try {
      const before = entry ? entry.imageData : copyCurrentImageData();
      const result = edit.tool === "eraser"
        ? eraseContiguousRegion(before, edit.point.x, edit.point.y, tolerance, guideBarrier, wholePicture, includeWhiteAndBlack)
        : fillContiguousRegion(before, edit.point.x, edit.point.y, cssColorToRgba(edit.color), tolerance, guideBarrier, wholePicture, includeWhiteAndBlack);

      if (!entry && result.changedPixels === 0) {
        if (lastEdit !== null) {
          lastEdit = { ...edit, tolerance, wholePicture, includeWhiteAndBlack };
        }
        return;
      }

      restoreImageData(result);
      if (entry) {
        state.nextRevision += 1;
        state.currentRevision = state.nextRevision;
        updateDocumentState();
      } else {
        commitEdit(before);
        if (edit.tool === "bucket") {
          rememberColor(edit.color);
        }
      }
      if (lastEdit !== null) {
        lastEdit = { ...edit, tolerance, wholePicture, includeWhiteAndBlack, committed: true };
      }
    } catch {
      setStatus("編集できませんでした。別の場所でもう一度お試しください", { error: true });
    } finally {
      setBusy(false);
      elements.reapplySpinner.hidden = reapplyTimer === 0;
      onComplete?.();
    }
  });
}

function nudgeTolerance(delta) {
  if (elements.toleranceSlider.disabled) {
    return;
  }

  const current = Number(elements.toleranceSlider.value);
  const next = clamp(current + delta, 0, 100);
  if (next === current) {
    return;
  }

  elements.toleranceSlider.value = String(next);
  updateTolerance();
  if (lastEdit === null) {
    setStatus(`色の許容範囲 ${next}`);
  } else {
    scheduleReapply();
  }
}

function exportPng() {
  if (!state.imageLoaded || state.isBusy) {
    return;
  }

  settleLastEdit();
  setBusy(true);
  setStatus("PNGを書き出しています…");
  const exportFileName = state.documentFileName;
  const exportRevision = state.currentRevision;
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      setBusy(false);
      setStatus("PNGを作成できませんでした", { error: true });
      return;
    }

    const originalName = exportFileName.replace(/\.[^.]+$/, "") || "illustration";
    const link = document.createElement("a");
    const downloadUrl = URL.createObjectURL(blob);
    link.href = downloadUrl;
    link.download = `${originalName}-edited.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    state.savedRevision = exportRevision;
    updateDocumentState();
    setBusy(false);
    setStatus("透過PNGとして保存しました");
  }, "image/png");
}

// Nothing is settled here. The picker can be closed with nothing chosen, which
// the page is never told about, and a picture that does open settles the last
// edit itself (loadImageFile).
function openFilePicker() {
  elements.fileInput.click();
}

for (const button of elements.toolButtons) {
  button.addEventListener("click", () => setTool(button.dataset.tool));
  // Within the group, an arrow key moves to the next tool and takes it up. The
  // key is stopped here: left to carry on, it would reach the sidebar's own
  // arrow keys and step the paint colour somewhere the user is not looking.
  button.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (!ARROW_KEYS.has(key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const step = key === "arrowleft" || key === "arrowup" ? -1 : 1;
    const tools = elements.toolButtons;
    const next = tools[(tools.indexOf(button) + step + tools.length) % tools.length];
    setTool(next.dataset.tool);
    next.focus();
  });
}

elements.colorSection.addEventListener("click", (event) => {
  const swatch = event.target.closest(".swatch");
  if (swatch) {
    choosePaintColor(swatch.dataset.color);
  }
});

elements.colorSection.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const swatch = event.target.closest?.(".swatch");
  if (!swatch || !ARROW_KEYS.has(key)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (swatch.closest("#recentSwatches")) {
    moveRecentSwatchSelection(swatch, key);
  } else {
    moveSwatchSelection(key, true, swatch);
  }
});

elements.colorSection.addEventListener("pointerover", (event) => {
  const swatch = event.target.closest(".swatch");
  if (swatch) {
    showSwatchTooltip(swatch);
  } else {
    releaseSwatchTooltip();
  }
});

elements.colorSection.addEventListener("pointerleave", hideSwatchTooltip);
elements.colorSection.addEventListener("focusout", hideSwatchTooltip);
elements.colorSection.addEventListener("focusin", (event) => {
  const swatch = event.target.closest(".swatch");
  if (swatch) {
    showSwatchTooltip(swatch, 0);
  }
});

elements.sidePanel.addEventListener("scroll", hideSwatchTooltip);
elements.toastDismissButton.addEventListener("click", dismissToast);

elements.colorPicker.addEventListener("input", (event) => {
  choosePaintColor(event.target.value);
});
elements.dadsPaletteTab.addEventListener("click", () => setPalette("dads"));
elements.uswdsPaletteTab.addEventListener("click", () => setPalette("uswds"));
for (const tab of [elements.dadsPaletteTab, elements.uswdsPaletteTab]) {
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const useUswds = event.key === "ArrowRight" || event.key === "End";
    setPalette(useUswds ? "uswds" : "dads");
    (useUswds ? elements.uswdsPaletteTab : elements.dadsPaletteTab).focus();
  });
}
elements.toleranceSlider.addEventListener("input", () => {
  updateTolerance();
  scheduleReapply();
});

// A field is only worth typing into if half-finished text may sit in it for a
// moment. Nothing happens until what is there reads as a whole value, and
// leaving the field puts back whatever the tool is actually set to.
elements.toleranceValue.addEventListener("input", () => {
  const typed = elements.toleranceValue.value.trim();
  if (!/^\d{1,3}$/.test(typed) || Number(typed) > 100) {
    return;
  }

  elements.toleranceSlider.value = typed;
  updateTolerance();
  scheduleReapply();
});
elements.toleranceValue.addEventListener("blur", updateTolerance);
// The same question the range asks - how much of the picture one click takes in
// - so reaching for it adjusts the edit in hand rather than settling it.
// The two are radio buttons, and only the one being checked hears a change.
elements.connectedAreaRadio.addEventListener("change", scheduleReapply);
elements.wholePictureToggle.addEventListener("change", scheduleReapply);
// Also a question of what one click takes in, so it too adjusts the edit in hand.
elements.includeWhiteBlackToggle.addEventListener("change", scheduleReapply);

elements.colorHex.addEventListener("input", () => {
  const typed = elements.colorHex.value.trim();
  const code = typed.startsWith("#") ? typed : `#${typed}`;
  if (!/^#[0-9a-f]{6}$/i.test(code)) {
    return;
  }

  choosePaintColor(code);
});
elements.colorHex.addEventListener("blur", () => {
  elements.colorHex.value = state.color.toUpperCase();
});
elements.openButton.addEventListener("click", openFilePicker);
elements.emptyOpenButton.addEventListener("click", openFilePicker);
elements.fileInput.addEventListener("change", () => loadImageFile(elements.fileInput.files[0]));
elements.newGuideButton.addEventListener("click", startNewGuide);
elements.erasePointButton.addEventListener("click", () => {
  cancelPendingGuidePointClick();
  if (erasingGuidePointOnce) {
    setGuideErasing(false);
    return;
  }

  finishGuidePath();
  selectedGuidePoint = null;
  setHoveredGuidePoint(null);
  // The speech bubble already asks for the point, so no toast says it twice.
  setGuideErasing(true);
});
elements.clearGuidesButton.addEventListener("click", clearGuides);
elements.undoButton.addEventListener("click", undo);
elements.redoButton.addEventListener("click", redo);
elements.exportButton.addEventListener("click", exportPng);
elements.fitButton.addEventListener("click", fitImageToViewport);
elements.zoomInButton.addEventListener("click", () => adjustZoom(1.25));
elements.zoomOutButton.addEventListener("click", () => adjustZoom(0.8));
elements.canvasStage.addEventListener("wheel", (event) => {
  if (!state.imageLoaded || !(event.ctrlKey || event.metaKey)) {
    return;
  }

  event.preventDefault();
  zoomAtClientPoint(state.viewScale * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
}, { passive: false });

elements.canvasStage.addEventListener("pointerdown", (event) => {
  if (state.activeTool === "guide" && event.target === elements.canvasStage) {
    startCanvasPointerGesture(event, elements.canvasStage);
  }
});
elements.canvasStage.addEventListener("dblclick", (event) => {
  if (event.target === elements.canvasStage) {
    toggleGuideCornerAt(event);
  }
});
elements.canvasStage.addEventListener("pointermove", (event) => {
  if (event.target !== elements.canvasStage) {
    return;
  }
  if (canvasPointerGesture?.captureTarget === elements.canvasStage) {
    trackCanvasPointerGesture(event);
  }
  trackGuideHover(event);
});
elements.canvasStage.addEventListener("pointerup", (event) => {
  if (canvasPointerGesture?.captureTarget === elements.canvasStage) {
    finishCanvasPointerGesture(event);
  }
});
elements.canvasStage.addEventListener("pointercancel", (event) => {
  if (canvasPointerGesture?.captureTarget === elements.canvasStage) {
    cancelCanvasPointerGesture(event);
  }
});
elements.canvasStage.addEventListener("lostpointercapture", (event) => {
  if (canvasPointerGesture?.captureTarget === elements.canvasStage) {
    cancelCanvasPointerGesture(event);
  }
});
elements.canvasStage.addEventListener("pointerleave", () => {
  if (canvasPointerGesture === null) {
    setHoveredGuidePoint(null);
  }
});

elements.canvas.addEventListener("pointerdown", startCanvasPointerGesture);
elements.canvas.addEventListener("dblclick", toggleGuideCornerAt);
elements.canvas.addEventListener("pointermove", trackCanvasPointerGesture);
elements.canvas.addEventListener("pointermove", trackGuideHover);
elements.canvas.addEventListener("pointerleave", () => setHoveredGuidePoint(null));
elements.canvas.addEventListener("pointerup", finishCanvasPointerGesture);
elements.canvas.addEventListener("pointercancel", cancelCanvasPointerGesture);
elements.canvas.addEventListener("lostpointercapture", cancelCanvasPointerGesture);

// A finger shares the canvas with the two-finger pinch that zooms and pans, so it
// does not act the moment it lands: a second finger may be on its way. It acts
// once it lifts, or once it has slid far enough to be a drag, as if pressed where
// it landed; a second finger turns the touch into a pinch instead, and a finger
// left behind by a pinch does nothing until it lifts. A pencil and a mouse are
// never part of a pinch and act on the press, as before. These listeners run in
// the capture phase, ahead of the canvas's own.
const touchPoints = new Map();
const ignoredTouches = new Set();
let pendingTouch = null;
let touchPinch = null;

function beginTouchGesture(touch) {
  const event = { pointerId: touch.pointerId, pointerType: "touch", button: 0, clientX: touch.clientX, clientY: touch.clientY };
  if (touch.target === elements.canvas) {
    startCanvasPointerGesture(event);
  } else if (state.activeTool === "guide" && touch.target === elements.canvasStage) {
    startCanvasPointerGesture(event, elements.canvasStage);
  }
}

function touchPinchMetrics() {
  const [first, second] = touchPoints.values();
  return {
    distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function moveTouchPinch() {
  const now = touchPinchMetrics();
  // Zoom about where the fingers were, then follow them to where they are now.
  zoomAtClientPoint(touchPinch.scale * (now.distance / touchPinch.distance), touchPinch.x, touchPinch.y);
  elements.canvasStage.scrollLeft -= now.x - touchPinch.x;
  elements.canvasStage.scrollTop -= now.y - touchPinch.y;
  touchPinch.x = now.x;
  touchPinch.y = now.y;
}

function endTouch(event, cancelled) {
  if (event.pointerType !== "touch" || !touchPoints.has(event.pointerId)) {
    return;
  }

  touchPoints.delete(event.pointerId);
  if (touchPinch !== null || ignoredTouches.has(event.pointerId)) {
    event.stopPropagation();
    ignoredTouches.delete(event.pointerId);
    if (touchPinch !== null && touchPoints.size < 2) {
      touchPinch = null;
      for (const pointerId of touchPoints.keys()) {
        ignoredTouches.add(pointerId);
      }
    }
    return;
  }

  if (pendingTouch?.pointerId === event.pointerId) {
    event.stopPropagation();
    const touch = pendingTouch;
    pendingTouch = null;
    if (!cancelled) {
      beginTouchGesture(touch);
      finishCanvasPointerGesture(event);
    }
  }
}

elements.canvasStage.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") {
    return;
  }

  event.stopPropagation();
  touchPoints.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  try {
    elements.canvasStage.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic pointer events may not have an active pointer to capture.
  }

  if (touchPoints.size === 1) {
    if (canvasPointerGesture === null) {
      pendingTouch = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, target: event.target };
    } else {
      ignoredTouches.add(event.pointerId);
    }
    return;
  }

  // A further finger: whatever the first one was doing gives way to the pinch.
  pendingTouch = null;
  if (canvasPointerGesture !== null && touchPoints.has(canvasPointerGesture.pointerId)) {
    cancelCanvasPointerGesture({ pointerId: canvasPointerGesture.pointerId });
  }
  if (touchPinch === null && touchPoints.size === 2) {
    const start = touchPinchMetrics();
    touchPinch = { distance: start.distance, scale: state.viewScale, x: start.x, y: start.y };
  }
}, true);

elements.canvasStage.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "touch" || !touchPoints.has(event.pointerId)) {
    return;
  }

  touchPoints.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
  if (touchPinch !== null) {
    event.stopPropagation();
    moveTouchPinch();
    return;
  }
  if (ignoredTouches.has(event.pointerId)) {
    event.stopPropagation();
    return;
  }
  if (pendingTouch?.pointerId === event.pointerId) {
    event.stopPropagation();
    const deltaX = event.clientX - pendingTouch.clientX;
    const deltaY = event.clientY - pendingTouch.clientY;
    if (deltaX * deltaX + deltaY * deltaY <= MAX_POINTER_EDIT_MOVEMENT ** 2) {
      return;
    }
    const touch = pendingTouch;
    pendingTouch = null;
    beginTouchGesture(touch);
    trackCanvasPointerGesture(event);
  }
}, true);

elements.canvasStage.addEventListener("pointerup", (event) => endTouch(event, false), true);
elements.canvasStage.addEventListener("pointercancel", (event) => endTouch(event, true), true);

function isFileDrag(event) {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

window.addEventListener("dragenter", (event) => {
  if (!isFileDrag(event)) {
    return;
  }

  event.preventDefault();
  dragDepth += 1;
  elements.dropOverlay.classList.add("is-visible");
});

window.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

window.addEventListener("dragleave", (event) => {
  if (!isFileDrag(event)) {
    return;
  }

  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    elements.dropOverlay.classList.remove("is-visible");
  }
});

// Only a file dropped on the page is this app's to take. Text dragged into one
// of the boxes is the browser's business, and answering it with an error would
// be answering a question nobody asked.
window.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) {
    return;
  }

  event.preventDefault();
  dragDepth = 0;
  elements.dropOverlay.classList.remove("is-visible");
  loadImageFile(event.dataTransfer?.files[0]);
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping =
    target === elements.colorHex ||
    target === elements.toleranceValue ||
    target instanceof HTMLTextAreaElement;
  const isNonTypingInput = target instanceof HTMLInputElement && !isTyping;
  const commandKey = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  // Undo inside a text box belongs to the box. Taking it here would leave the
  // typing where it was and step the picture back instead.
  if (commandKey && key === "z" && !isTyping) {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }

  if (commandKey && key === "o") {
    event.preventDefault();
    openFilePicker();
    return;
  }

  if (commandKey && key === "s") {
    event.preventDefault();
    exportPng();
    return;
  }

  if (isTyping || commandKey || event.altKey) {
    return;
  }

  if (key === "1" || key === "2") {
    nudgeTolerance(key === "1" ? -TOLERANCE_STEP : TOLERANCE_STEP);
    return;
  }

  // Tab is left to the browser: it is how the keyboard reaches the boxes in the
  // sidebar, and taking it over walls them off.
  if (key === "p" && state.imageLoaded && state.activeTool === "bucket") {
    setPalette(state.palette === "dads" ? "uswds" : "dads");
    return;
  }

  if (
    !isNonTypingInput &&
    ARROW_KEYS.has(key) &&
    state.imageLoaded &&
    state.activeTool === "bucket"
  ) {
    event.preventDefault();
    moveSwatchSelection(key);
    return;
  }

  if (state.isBusy) {
    return;
  }

  // The Mac's delete key reports Backspace, so both take the chosen point away.
  // The point is checked against the lines as they are now, because finishing a
  // line can take away the lone point it was.
  if (
    (key === "delete" || key === "backspace") &&
    state.activeTool === "guide" &&
    selectedGuidePoint !== null &&
    guidePaths.includes(selectedGuidePoint.path) &&
    selectedGuidePoint.index < selectedGuidePoint.path.length
  ) {
    event.preventDefault();
    // As with undo, a point a press still holds stays until it is let go of.
    if (canvasPointerGesture === null) {
      removeGuidePoint(selectedGuidePoint);
    }
    return;
  }

  if (key === "escape") {
    if (pendingGuidePointClick !== null) {
      cancelPendingGuidePointClick();
      return;
    }
    if (erasingGuidePointOnce) {
      setGuideErasing(false);
      return;
    }
    if (!finishGuidePath()) {
      settleLastEdit();
    }
    return;
  }

  if (key === "e") {
    setTool("eraser");
  } else if (key === "b") {
    setTool("bucket");
  } else if (key === "g") {
    setTool("guide");
  } else if (key === "0") {
    fitImageToViewport();
  } else if (key === "+" || key === "=") {
    adjustZoom(1.25);
  } else if (key === "-") {
    adjustZoom(0.8);
  }
});

// Reaching into the sidebar means the user has moved on. The tolerance section
// is the adjustment itself, and the zoom controls sit in the workspace, so
// checking the result up close never counts as leaving. The guide actions now
// live in the sidebar too, so they follow the same settling rule.
document.addEventListener("pointerdown", (event) => {
  if (lastEdit === null || state.isBusy || !(event.target instanceof Element)) {
    return;
  }

  if (event.target.closest(".side-panel") && !event.target.closest("#settingsSection")) {
    settleLastEdit();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
});

// The empty state's column sits under the header's centre line - the words of
// the document name, not its box, which also holds the dot to their left -
// rather than the canvas's own middle. The two differ by about half the width of
// the header buttons, which depends on the fonts in use, so it is measured, not
// written into the stylesheet. With the name hidden on a narrow window there is
// no line to meet, and the column keeps to the canvas's middle.
function alignEmptyState() {
  const name = elements.documentName.querySelector(".document-name-full").getBoundingClientRect();
  const area = elements.canvasViewport.getBoundingClientRect();
  const shift = name.width === 0
    ? 0
    : (area.left + area.width / 2) - (name.left + name.width / 2);
  elements.emptyState.style.setProperty("--empty-shift", `${Math.max(0, Math.round(shift))}px`);
  placeEmptyDecor();
}

// Pochi at his easel sits small and faint in the canvas's bottom right corner,
// where the stylesheet puts him. He is nine tenths as wide as the Pochi above the
// headline, and shrinks with him on a smaller window, so the corner never
// outweighs the drawing the page leads with. Where he would come within 16px of
// the column, he is left out. He is shown before he is measured, since a hidden
// element has no box.
function placeEmptyDecor() {
  const decor = elements.emptyDecor;
  const lead = elements.emptyIllustration.getBoundingClientRect();
  decor.style.setProperty("--decor-width", `${Math.round(lead.width * 0.9)}px`);
  decor.hidden = false;
  const box = decor.getBoundingClientRect();
  decor.hidden = [elements.emptyIllustration, elements.emptyCopy].some((part) => {
    const edge = part.getBoundingClientRect();
    return box.left < edge.left + edge.width + 16 && box.top < edge.top + edge.height + 16;
  });
}

// A short window may cut the palette credit off along with the palette, but never
// on its own: a whole palette above a missing credit reads as the credit hidden
// on purpose. When that is what the window would do, or when the credit would sit
// against the bottom edge, the spacing gives back what the credit needs to keep a
// little room under it, taking the steps in turn: the room above the tools, the
// header, the gaps between sections, then the small gaps inside them. How far each
// step lifts the credit is measured on its own, and each is used only as far as
// the ones before it fall short. Everything is measured every time, so the answer
// never depends on the last one or on the fonts in use. The last row gets a pixel
// of slack so a row clipped by a fraction still counts as whole. A change is
// applied a frame later: made inside the ResizeObserver callback, it would resize
// what that observer watches, and the browser reports a loop. Measuring and
// putting everything back leaves every size as it was, so that part can stay here.
const CREDIT_FIT_ROOM = 4;
const CREDIT_FIT_STEPS = ["--tight-top", "--tight-header", "--tight-sections", "--tight-gaps"];
let creditFitShares = CREDIT_FIT_STEPS.map(() => 0);

function applyCreditFit(shares) {
  elements.appShell.classList.toggle("is-tight", shares.some((share) => share > 0));
  CREDIT_FIT_STEPS.forEach((name, index) => elements.appShell.style.setProperty(name, String(shares[index])));
}

function updateCreditFit() {
  const panel = elements.sidePanel;
  // DADS is the compact layout reference. USWDS is deliberately longer and
  // scrolls, so measuring it would clear DADS's small fit adjustment and move
  // every control above the palette when the tabs are switched.
  if (elements.dadsPalette.classList.contains("is-hidden")) {
    applyCreditFit(creditFitShares);
    return;
  }
  const palette = elements.dadsPalette;
  const credit = palette.querySelector(".palette-credit");
  const lastRow = [...palette.children].filter((child) => child !== credit).at(-1);
  let shares = CREDIT_FIT_STEPS.map(() => 0);
  if (lastRow) {
    const overflow = (element) => {
      const top = panel.getBoundingClientRect().top - panel.scrollTop;
      return element.getBoundingClientRect().bottom - top - panel.clientHeight;
    };
    applyCreditFit(shares);
    const loose = overflow(credit);
    let needed = loose + CREDIT_FIT_ROOM;
    if (overflow(lastRow) <= 1 && needed > 0) {
      const lifts = CREDIT_FIT_STEPS.map((_, step) => {
        applyCreditFit(CREDIT_FIT_STEPS.map((__, other) => (other === step ? 1 : 0)));
        return loose - overflow(credit);
      });
      shares = lifts.map((lift) => {
        if (needed <= 0 || lift <= 0) {
          return 0;
        }
        const share = Math.min(1, Math.ceil((needed / lift) * 1000) / 1000);
        needed -= lift * share;
        return share;
      });
    }
    applyCreditFit(creditFitShares);
  }
  if (shares.some((share, index) => share !== creditFitShares[index])) {
    requestAnimationFrame(() => {
      creditFitShares = shares;
      applyCreditFit(shares);
    });
  }
}

function updateSidePanelScrollability() {
  updateCreditFit();
  const isScrollable = elements.sidePanel.scrollHeight > elements.sidePanel.clientHeight + 1;
  elements.sidePanel.classList.toggle("is-scrollable", isScrollable);
  if (!isScrollable && elements.sidePanel.scrollTop !== 0) {
    elements.sidePanel.scrollTop = 0;
  }
}

const resizeObserver = new ResizeObserver(() => {
  alignEmptyState();
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.isFitMode) {
      fitImageToViewport();
    }
  }, 80);
});

resizeObserver.observe(elements.canvasViewport);
const sidePanelResizeObserver = new ResizeObserver(updateSidePanelScrollability);
sidePanelResizeObserver.observe(elements.sidePanel);
for (const section of elements.sidePanel.querySelectorAll(".panel-section")) {
  sidePanelResizeObserver.observe(section);
}
alignEmptyState();
renderPalette(elements.dadsPalette, DADS_COLOR_PALETTE, null, "dads");
renderPalette(elements.uswdsPalette, USWDS_COLOR_PALETTE, USWDS_STANDARD_GRADES, "uswds");
setPalette("dads");
updateTolerance();
renderRecentColors();
setColor(state.color);
setTool(state.activeTool);
setImageActionsEnabled(false);
setEditingControlsEnabled(false);
updateHistoryButtons();
requestAnimationFrame(updateSidePanelScrollability);
