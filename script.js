// Vector Draw — prototype
//
// A fixed gallery of five targets (Line, Rectangle, Logo, Face, Flower), each
// described as a list of shapes. The player reproduces them on a grid using
// a small toolbar, then compares against the exact target on Reveal.

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRID_UNITS = 20;
const CELL = 32;
const GRID_PX = GRID_UNITS * CELL;

const GUTTER_TOP = 22;
const GUTTER_LEFT = 32;
const PAGE_P = 32; // equal distance from viewport top/right/bottom to the grid square

// Footprint of the wide-layout nav sidebar + instruction column, used only to
// decide when to switch to the compact (dropdown) nav. The nav sidebar's
// content never changes, so its width is just a tight fixed measurement.
// The instruction column's content does change — a one-line "M 3 16 L 17 4"
// needs far less room than the Logo's 16-line listing or a wrapped English
// paragraph — so its width is computed from the actual current text (see
// getWideInstructionWidth) rather than reserved at a worst-case guess. Both
// stay independent of which layout is currently on screen (never measured
// from the live DOM) so the breakpoint can't flicker once compact mode,
// which renders narrower, is already active.
const WIDE_NAV_WIDTH = 130;
const NAV_INSTRUCTION_GAP = 40;
const INSTRUCTION_MIN_WIDTH = 140;
const INSTRUCTION_MAX_WIDTH = 500;

const TOOL_POINTS = { line: 2, rect: 2, circle: 2, curve: 3 };
const LINE_WIDTH = 10;
const DEFAULT_TOOL = 'line';
const OPEN_PATH_TYPES = new Set(['line', 'curve']); // color = stroke; closed shapes: color = fill, no stroke

const PALETTE = [
  { name: 'black', css: '#000000' },
  { name: 'petal', css: '#FC8F29' },
  { name: 'center', css: '#F3DA5F' },
  { name: 'leaf', css: '#66B879' },
  { name: 'sky', css: '#B7E5ED' },
];

// The Reveal overlay draws a target shape's own color at a thin dashed
// stroke plus 18% fill (see closedShapeStyle in buildShapeNode) — fine for
// most of the palette, but yellow is pale enough (L≈66%) that it nearly
// disappears against the page background at that weight. This substitutes
// a darker, same-hue yellow for the overlay only; the swatch, drawn player
// shapes, and code/English text all keep the real #F3DA5F.
const REVEAL_COLOR_OVERRIDES = {
  '#F3DA5F': '#C7A80F',
};

// ---------- content library ----------

const CONTENT = {
  line: {
    label: 'Line',
    shapes: [
      { type: 'line', points: [[3, 15], [17, 4]] },
    ],
  },
  rect: {
    label: 'Rectangle',
    shapes: [
      { type: 'rect', points: [[8, 8], [11, 14]] },
    ],
  },
  logo: {
    label: 'Logo',
    shapes: [
      { type: 'rect', points: [[3, 1], [11, 3]] },
      { type: 'rect', points: [[3, 13], [11, 15]] },
      { type: 'rect', points: [[11, 7], [17, 9]] },
      { type: 'rect', points: [[9, 3], [11, 9]] },
      { type: 'rect', points: [[3, 7], [5, 13]] },
      { type: 'rect', points: [[15, 9], [17, 15]] },
    ],
  },
  face: {
    label: 'Face',
    shapes: [
      { type: 'circle', points: [[10, 8], [16, 8]], color: '#F3DA5F' },
      { type: 'circle', points: [[8, 7], [8.5, 7]], color: '#000000' },
      { type: 'circle', points: [[12, 7], [12.5, 7]], color: '#000000' },
      { type: 'curve', points: [[7, 9], [10, 11], [13, 9]], color: '#000000' },
    ],
  },
  scene: {
    label: 'Flower',
    shapes: [
      { type: 'rect', points: [[4, 1], [16, 17]], color: '#B7E5ED' },
      { type: 'line', points: [[10, 9], [10, 15]], color: '#66B879' },
      { type: 'curve', points: [[10, 15], [10, 11], [6, 11]], color: '#66B879' },
      { type: 'curve', points: [[10, 15], [10, 11], [14, 11]], color: '#66B879' },
      { type: 'circle', points: [[10, 5], [12, 5]], color: '#FC8F29' },
      { type: 'circle', points: [[10, 9], [12, 9]], color: '#FC8F29' },
      { type: 'circle', points: [[12, 7], [14, 7]], color: '#FC8F29' },
      { type: 'circle', points: [[8, 7], [10, 7]], color: '#FC8F29' },
      { type: 'circle', points: [[10, 7], [11, 7]], color: '#F3DA5F' },
    ],
  },
};

const CONTENT_ORDER = ['line', 'rect', 'logo', 'face', 'scene'];

const el = {
  contentList: document.getElementById('contentList'),
  contentSelect: document.getElementById('contentSelect'),
  contentDot: document.getElementById('contentDot'),
  hintsBtn: document.getElementById('hintsBtn'),
  hintsLabel: document.getElementById('hintsLabel'),
  instructionText: document.getElementById('instructionText'),
  canvasColumn: document.querySelector('.canvas-column'),
  canvasFrame: document.getElementById('canvasFrame'),
  topLabels: document.getElementById('topLabels'),
  leftLabels: document.getElementById('leftLabels'),
  gridSquareWrap: document.getElementById('gridSquareWrap'),
  grid: document.getElementById('grid'),
  dimensionTooltip: document.getElementById('dimensionTooltip'),
  colorPopover: document.getElementById('colorPopover'),
  swatchRow: document.getElementById('swatchRow'),
  revealBtn: document.getElementById('revealBtn'),
  revealLabel: document.getElementById('revealLabel'),
  clearBtn: document.getElementById('clearBtn'),
  toolbar: document.getElementById('toolbar'),
};

let playerLayer, targetLayer;
let xTickLabels = [], yTickLabels = [];

let showHints = false; // English translation shown alongside the code when toggled on
let contentKey = 'line';
let currentContent = CONTENT[contentKey];

let playerShapes = []; // committed shapes: { id, type, points }
let pendingPoints = []; // points placed so far for the shape being drawn
let shapeIdCounter = 1;

let activeTool = DEFAULT_TOOL;
let currentColor = PALETTE[0].css;
let selectedShapeId = null;
let revealed = false;

let isDragging = false;
let dragStart = null;
let dragMoved = false;

// ---------- layout ----------

let measureCtx = null;
function measureTextWidth(text, font) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return text.split('\n').reduce((max, line) => Math.max(max, measureCtx.measureText(line).width), 0);
}

// The "Instructions" headline + hints toggle sit in one row above the
// instruction text regardless of content, so the column can never usefully
// be narrower than that row needs — otherwise the button gets squeezed
// (and its label clipped) whenever hints are off and the code alone is
// short enough to want a much narrower column.
function getInstructionHeaderMinWidth() {
  const uiFont = '13px "Google Sans Flex", -apple-system, BlinkMacSystemFont, sans-serif';
  const headlineWidth = measureTextWidth('INSTRUCTIONS', uiFont);
  const labelWidth = Math.max(measureTextWidth('Show hints', uiFont), measureTextWidth('Hide hints', uiFont));
  const ROW_GAP = 24; // .instructions-row's gap
  const BUFFER = 8;
  return Math.ceil(headlineWidth + ROW_GAP + labelWidth) + BUFFER;
}

function getInstructionMinWidth() {
  return Math.max(INSTRUCTION_MIN_WIDTH, getInstructionHeaderMinWidth());
}

// How wide the instruction column would need to be in wide mode for the
// CURRENT content — a one-line "M 3 16 L 17 4" needs far less than the
// Logo's 16-line listing, so this is measured from the actual text rather
// than reserved at a worst-case guess (which is what made the layout switch
// to compact well before the canvas actually needed the space).
function getWideInstructionWidth() {
  // Code is always shown, so the code font drives the measurement even when
  // hints (the English line underneath) are also visible.
  const font = '13px "Google Sans Code", "SF Mono", Menlo, Consolas, monospace';
  const text = showHints
    ? currentContent.shapes.map((shape) => `${formatSyntax(shape)}\n${translateShapeToEnglish(shape)}`).join('\n')
    : currentContent.shapes.map(formatSyntax).join('\n');
  const textWidth = measureTextWidth(text, font);
  const RIGHT_PADDING = 24;
  const BUFFER = 8;
  const minWidth = getInstructionMinWidth();
  const contentWidth = Math.min(INSTRUCTION_MAX_WIDTH, Math.max(minWidth, Math.ceil(textWidth) + RIGHT_PADDING + BUFFER));

  // Beyond hugging content, the column also has to fit the viewport: give it
  // whatever it wants as long as the canvas can still be a full-height
  // square, but cap it once that stops being true, so it shrinks (down to
  // minWidth — see updateCompactNav for what happens past that floor)
  // instead of overflowing or squeezing the canvas narrower than the
  // available height.
  const availH = window.innerHeight - 2 * PAGE_P;
  const maxByViewport = window.innerWidth - WIDE_NAV_WIDTH - NAV_INSTRUCTION_GAP - GUTTER_LEFT - PAGE_P - availH;
  return Math.max(minWidth, Math.min(contentWidth, maxByViewport));
}

function updateInstructionColumnWidth() {
  document.documentElement.style.setProperty('--instr-w', `${getWideInstructionWidth()}px`);
}

// Compact-vs-wide is decided from the instruction column's floor
// (getInstructionMinWidth), not its content-driven width — matching the cap
// getWideInstructionWidth applies above. So: as the viewport narrows, the
// column first shrinks (still wide layout, canvas stays a full-height
// square) until it bottoms out at that floor; only past that point, where
// even the narrowest column would force the canvas to shrink below the
// available height, do we give up and switch to compact. This must stay
// independent of current content (see getWideInstructionWidth) or the same
// viewport size would behave inconsistently depending on what happened to
// be showing.
function updateCompactNav() {
  const wideAvailW = window.innerWidth - WIDE_NAV_WIDTH - NAV_INSTRUCTION_GAP - getInstructionMinWidth() - GUTTER_LEFT - PAGE_P;
  const availH = window.innerHeight - 2 * PAGE_P;
  document.body.classList.toggle('compact-nav', wideAvailW < availH);
}

function updateLayout() {
  updateInstructionColumnWidth();
  updateCompactNav();
  layoutCanvas();
}

function layoutCanvas() {
  const colRect = el.canvasColumn.getBoundingClientRect();
  const availW = colRect.width - GUTTER_LEFT - PAGE_P;
  const availH = window.innerHeight - 2 * PAGE_P;
  const side = Math.max(120, Math.min(availW, availH));

  // Centering the square's total height (side + gutter) in the viewport keeps
  // top/bottom distance equal even when width (not height) is the binding
  // constraint — it reduces to exactly PAGE_P when height is the constraint.
  const marginTop = Math.max(0, (window.innerHeight - side) / 2 - GUTTER_TOP);

  el.canvasFrame.style.width = `${side + GUTTER_LEFT}px`;
  el.canvasFrame.style.height = `${side + GUTTER_TOP}px`;
  el.canvasFrame.style.marginTop = `${marginTop}px`;
  el.canvasFrame.style.marginRight = `${PAGE_P}px`;
}

window.addEventListener('resize', updateLayout);

// ---------- grid rendering ----------

function makeEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

function px(unit) {
  return unit * CELL;
}

function clearGroup(group) {
  while (group.firstChild) group.removeChild(group.firstChild);
}

function initGrid(svg) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${GRID_PX} ${GRID_PX}`);

  const bg = makeEl('g', { class: 'grid-bg' });
  for (let i = 0; i <= GRID_UNITS; i++) {
    const isStrong = i % 5 === 0;
    const pos = px(i);
    bg.appendChild(makeEl('line', {
      x1: pos, y1: 0, x2: pos, y2: GRID_PX, class: isStrong ? 'strong' : '',
    }));
    bg.appendChild(makeEl('line', {
      x1: 0, y1: pos, x2: GRID_PX, y2: pos, class: isStrong ? 'strong' : '',
    }));
  }
  svg.appendChild(bg);

  const shapes = makeEl('g', { class: 'shapes-layer' });
  svg.appendChild(shapes);
  const target = makeEl('g', { class: 'target-layer' });
  svg.appendChild(target);

  return { shapes, target };
}

function buildTickLabels() {
  el.topLabels.innerHTML = '';
  el.leftLabels.innerHTML = '';
  xTickLabels = [];
  yTickLabels = [];

  for (let i = 0; i <= GRID_UNITS; i++) {
    const isStrong = i % 5 === 0;
    const pct = (i / GRID_UNITS) * 100;

    const xLabel = document.createElement('span');
    xLabel.className = `tick-label top${isStrong ? ' strong' : ''}`;
    xLabel.style.left = `${pct}%`;
    xLabel.textContent = i;
    el.topLabels.appendChild(xLabel);
    xTickLabels[i] = xLabel;

    const yLabel = document.createElement('span');
    yLabel.className = `tick-label left${isStrong ? ' strong' : ''}`;
    yLabel.style.top = `${pct}%`;
    yLabel.textContent = i;
    el.leftLabels.appendChild(yLabel);
    yTickLabels[i] = yLabel;
  }
}

function markerCircle(point, color) {
  return makeEl('circle', {
    cx: px(point[0]), cy: px(point[1]), r: 3,
    style: `fill:${color}; stroke:var(--panel); stroke-width:1;`,
  });
}

// ---------- shape geometry / rendering ----------
//
// Color rule: for open paths (line, curve), the color IS the stroke. For
// closed shapes (rect, circle), the color fills the shape and there is no
// stroke — except as temporary UI feedback while selected (accent ring) or
// being reproduced as a target overlay (neutral dashed outline), neither of
// which reflects the drawn artwork's own color rule.

function buildShapeNode(type, points, opts = {}) {
  const { selected = false, dashed = false, target = false, color } = opts;
  // Target shapes fall back to neutral gray when they carry no color of
  // their own (Line/Rectangle/Logo), but use their real color when they do
  // (Face/Flower) — that's the whole point of a color instruction. Some
  // colors get swapped for a darker overlay-only variant here (see
  // REVEAL_COLOR_OVERRIDES) since the overlay's thin dashed stroke + 18%
  // fill washes out pale ones.
  const paintColor = target ? ((color && (REVEAL_COLOR_OVERRIDES[color] || color)) || 'var(--muted)') : color;
  const dashRule = dashed ? ' stroke-dasharray:6 5;' : '';

  function openPathStyle(strokeW) {
    // Never recolor the stroke for selection — for an open path the stroke
    // IS the whole visible shape, so overriding it would hide the very
    // color the player is trying to see/pick. Selection is shown separately
    // via a halo drawn behind the line (see buildSelectionHalo).
    return `fill:none; stroke:${paintColor}; stroke-width:${strokeW}; stroke-linecap:round;${dashRule}`;
  }

  function closedShapeStyle() {
    if (target) return `fill:${paintColor}; fill-opacity:0.18; stroke:${paintColor}; stroke-width:2;${dashRule}`;
    if (selected) return `fill:${paintColor}; stroke:var(--accent); stroke-width:2.5;`;
    return `fill:${paintColor}; stroke:none;`;
  }

  // Reveal's target overlay stays thin regardless of shape type — it's a
  // reference outline, not a drawn stroke, so it shouldn't take on the
  // player's thick 10px line weight.
  const openWidth = target ? 2 : LINE_WIDTH;

  switch (type) {
    case 'line': {
      const [[x1, y1], [x2, y2]] = points;
      return makeEl('line', { x1: px(x1), y1: px(y1), x2: px(x2), y2: px(y2), style: openPathStyle(openWidth) });
    }
    case 'curve': {
      const [[x1, y1], [cx, cy], [x2, y2]] = points;
      return makeEl('path', {
        d: `M ${px(x1)} ${px(y1)} Q ${px(cx)} ${px(cy)} ${px(x2)} ${px(y2)}`,
        style: openPathStyle(openWidth),
      });
    }
    case 'rect': {
      const [[x1, y1], [x2, y2]] = points;
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      return makeEl('rect', { x: px(x), y: px(y), width: w * CELL, height: h * CELL, style: closedShapeStyle() });
    }
    case 'circle': {
      const [[cx, cy], [ex, ey]] = points;
      const r = Math.hypot(ex - cx, ey - cy) * CELL;
      return makeEl('circle', { cx: px(cx), cy: px(cy), r, style: closedShapeStyle() });
    }
  }
}

// A soft accent-colored glow drawn behind a selected open path (line/curve),
// wider and translucent, so the real line renders in its true color on top —
// the ring-around-a-filled-shape idea, adapted for a shape with no fill.
function buildSelectionHalo(type, points) {
  const style = `fill:none; stroke:var(--accent); stroke-opacity:0.3; stroke-width:${LINE_WIDTH + 6}; stroke-linecap:round;`;
  if (type === 'line') {
    const [[x1, y1], [x2, y2]] = points;
    return makeEl('line', { x1: px(x1), y1: px(y1), x2: px(x2), y2: px(y2), style });
  }
  const [[x1, y1], [cx, cy], [x2, y2]] = points;
  return makeEl('path', { d: `M ${px(x1)} ${px(y1)} Q ${px(cx)} ${px(cy)} ${px(x2)} ${px(y2)}`, style });
}

function drawCommittedShapes() {
  playerShapes.forEach((shape) => {
    const isSelected = shape.id === selectedShapeId;
    if (isSelected && OPEN_PATH_TYPES.has(shape.type)) {
      playerLayer.appendChild(buildSelectionHalo(shape.type, shape.points));
    }
    const node = buildShapeNode(shape.type, shape.points, { selected: isSelected, color: shape.color });
    node.classList.add('player-shape');
    playerLayer.appendChild(node);
  });
}

function drawPendingPreview() {
  if (pendingPoints.length === 0) return;
  pendingPoints.forEach((p) => playerLayer.appendChild(markerCircle(p, currentColor)));

  if (TOOL_POINTS[activeTool] === 3 && pendingPoints.length >= 2) {
    // Only curve is a 3-point tool now — a straight guide line from its
    // start point to the not-yet-placed control point.
    for (let i = 0; i < pendingPoints.length - 1; i++) {
      playerLayer.appendChild(makeEl('line', {
        x1: px(pendingPoints[i][0]), y1: px(pendingPoints[i][1]),
        x2: px(pendingPoints[i + 1][0]), y2: px(pendingPoints[i + 1][1]),
        class: 'guide-line',
      }));
    }
  } else if (pendingPoints.length === 2) {
    // selected:true so a closed shape (rect/circle) gets its accent outline
    // even while its fill happens to match whatever's underneath (e.g. a
    // leftover yellow currentColor over the Face's own yellow circle) —
    // otherwise a same-color preview is invisible until it's committed.
    const node = buildShapeNode(activeTool, pendingPoints, { color: currentColor, selected: true });
    node.classList.add('player-shape', 'preview');
    playerLayer.appendChild(node);
  }
}

function renderAll() {
  clearGroup(playerLayer);
  drawCommittedShapes();
  drawPendingPreview();
}

function renderTarget() {
  clearGroup(targetLayer);
  const nodes = currentContent.shapes.map((shape) => {
    const node = buildShapeNode(shape.type, shape.points, { dashed: true, target: true, color: shape.color });
    node.classList.add('target-shape');
    targetLayer.appendChild(node);
    return node;
  });
  animateTargetDrawIn(nodes, currentContent.shapes);
}

const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TRACE_TYPES = new Set(['line', 'curve']); // these get the stroke trace-in; everything else fades in

// Fixed per-type duration, ranked by how complex the shape reads as a
// hand-drawn thing — a straight line is the simplest mark there is, a
// circle (one continuous curve, no straight edges to anchor it) the most —
// independent of each instance's actual size. 750ms (see the fallback
// below) is the baseline.
const SHAPE_REVEAL_MS = {
  line: 500,
  curve: 650,
  rect: 900,
  circle: 1100,
};

// Reveals each target shape in turn, in the order the instructions list
// them, back-to-back (each one's delay is the sum of every prior shape's
// duration). Line/curve trace in via the classic stroke-dasharray/
// dashoffset technique: set one dash exactly as long as the path (hiding it
// entirely via a matching offset), then animate the offset to 0. Every
// other shape (rect/circle) just fades its opacity in — tracing a closed
// fill doesn't read the same way a line does.
function animateTargetDrawIn(nodes, shapes) {
  if (REDUCE_MOTION) return;

  let delay = 0;
  nodes.forEach((node, i) => {
    const type = shapes[i].type;
    const duration = SHAPE_REVEAL_MS[type] || 750;

    if (TRACE_TYPES.has(type)) {
      traceShapeIn(node, duration, delay);
    } else {
      fadeShapeIn(node, duration, delay);
    }
    delay += duration;
  });
}

function traceShapeIn(node, duration, delay) {
  let len;
  try {
    len = node.getTotalLength();
  } catch (e) {
    return;
  }
  if (!len || !isFinite(len)) return;

  node.style.strokeDasharray = `${len} ${len}`;
  node.style.strokeDashoffset = String(len);
  node.getBoundingClientRect(); // force reflow so the hidden state commits before transitioning
  node.style.transition = `stroke-dashoffset ${duration}ms ease ${delay}ms`;
  requestAnimationFrame(() => {
    node.style.strokeDashoffset = '0';
  });

  node.addEventListener('transitionend', function onEnd(evt) {
    if (evt.propertyName !== 'stroke-dashoffset') return;
    node.removeEventListener('transitionend', onEnd);
    node.style.transition = '';
    // Reverts to the small 6/5 pattern used for the resting "reference
    // outline" look, since the long-single-dash values only exist to drive
    // the trace animation.
    node.style.strokeDasharray = '6 5';
    node.style.strokeDashoffset = '';
  });
}

function fadeShapeIn(node, duration, delay) {
  node.style.opacity = '0';
  node.getBoundingClientRect(); // force reflow so the hidden state commits before transitioning
  node.style.transition = `opacity ${duration}ms ease ${delay}ms`;
  requestAnimationFrame(() => {
    node.style.opacity = '1';
  });

  node.addEventListener('transitionend', function onEnd(evt) {
    if (evt.propertyName !== 'opacity') return;
    node.removeEventListener('transitionend', onEnd);
    node.style.transition = '';
    node.style.opacity = '';
  });
}

// ---------- hit testing (for selecting an existing shape) ----------

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function distToQuadratic(pt, [s, c, e], steps = 24) {
  let prev = s;
  let best = Infinity;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * c[0] + t * t * e[0];
    const y = (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * c[1] + t * t * e[1];
    best = Math.min(best, distToSegment(pt, prev, [x, y]));
    prev = [x, y];
  }
  return best;
}

function hitTestShape(shape, pt) {
  const TOL = 0.45;
  switch (shape.type) {
    case 'line':
      return distToSegment(pt, shape.points[0], shape.points[1]) <= TOL;
    case 'rect': {
      const [[x1, y1], [x2, y2]] = shape.points;
      const x = Math.min(x1, x2) - TOL, X = Math.max(x1, x2) + TOL;
      const y = Math.min(y1, y2) - TOL, Y = Math.max(y1, y2) + TOL;
      return pt[0] >= x && pt[0] <= X && pt[1] >= y && pt[1] <= Y;
    }
    case 'circle': {
      const [[cx, cy], [ex, ey]] = shape.points;
      const r = Math.hypot(ex - cx, ey - cy);
      return Math.hypot(pt[0] - cx, pt[1] - cy) <= r + TOL;
    }
    case 'curve':
      return distToQuadratic(pt, shape.points) <= TOL;
  }
  return false;
}

function findShapeAt(pt) {
  for (let i = playerShapes.length - 1; i >= 0; i--) {
    if (hitTestShape(playerShapes[i], pt)) return playerShapes[i];
  }
  return null;
}

// ---------- dimension tooltip ----------

function formatNum(n) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// Only called for rect/circle — line/curve show cursor coordinates instead
// (see COORD_TOOLTIP_TYPES), since neither has a meaningful "dimension".
function dimensionLabel(tool, from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  return tool === 'rect'
    ? `H ${Math.abs(dy)}  W ${Math.abs(dx)}`
    : `R ${formatNum(Math.hypot(dx, dy))}`;
}

function previewBoundsBottomCenter(type, points) {
  if (type === 'circle') {
    const [[cx, cy], [ex, ey]] = points;
    const r = Math.hypot(ex - cx, ey - cy);
    return [cx, cy + r];
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...ys)];
}

// Converts a [u, v] grid-unit point into CSS pixels relative to
// #gridSquareWrap — needed because the SVG's viewBox units (GRID_PX) and its
// actual rendered size (`side`, computed responsively) are different scales.
function unitToPixel([u, v]) {
  const svgRect = el.grid.getBoundingClientRect();
  const wrapRect = el.gridSquareWrap.getBoundingClientRect();
  const viewBox = el.grid.viewBox.baseVal;
  const scaleX = svgRect.width / viewBox.width;
  const scaleY = svgRect.height / viewBox.height;
  const pageX = svgRect.left + px(u) * scaleX;
  const pageY = svgRect.top + px(v) * scaleY;
  return [pageX - wrapRect.left, pageY - wrapRect.top];
}

function positionTooltipAt([ux, uy]) {
  const [x, y] = unitToPixel([ux, uy]);
  el.dimensionTooltip.style.left = `${x}px`;
  el.dimensionTooltip.style.top = `${y}px`;
}

function positionTooltipBelowShape(type, points) {
  positionTooltipAt(previewBoundsBottomCenter(type, points));
}

function showDimensionTooltip(text, type, points) {
  el.dimensionTooltip.textContent = text;
  positionTooltipBelowShape(type, points);
  el.dimensionTooltip.hidden = false;
}

// Line/curve don't have a clean "dimensions" reading the way Rect's H/W or
// Circle's R do (their old fallback was just the last segment's length,
// which isn't a meaningful measurement) — so instead they show where the
// cursor actually is, both before the first point is placed and while
// drawing, pinned to the hovered grid point rather than the shape's bounds.
const COORD_TOOLTIP_TYPES = new Set(['line', 'curve']);

function showCoordTooltip(point) {
  el.dimensionTooltip.textContent = `X ${point[0]}  Y ${point[1]}`;
  positionTooltipAt(point);
  el.dimensionTooltip.hidden = false;
}

function hideDimensionTooltip() {
  el.dimensionTooltip.hidden = true;
}

// ---------- color popover ----------

function shapeAnchorTop(shape) {
  if (shape.type === 'circle') {
    const [[cx, cy], [ex, ey]] = shape.points;
    const r = Math.hypot(ex - cx, ey - cy);
    return [cx, cy - r];
  }
  const xs = shape.points.map((p) => p[0]);
  const ys = shape.points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)];
}

function updateSwatchRowActive(color) {
  Array.from(el.swatchRow.children).forEach((btn) => {
    btn.dataset.active = btn.dataset.color === color ? 'true' : 'false';
  });
}

function openPopoverForShape(id) {
  const shape = playerShapes.find((s) => s.id === id);
  if (!shape) return;
  const [x, y] = unitToPixel(shapeAnchorTop(shape));
  el.colorPopover.style.left = `${x}px`;
  el.colorPopover.style.top = `${y}px`;
  updateSwatchRowActive(shape.color);
  el.colorPopover.hidden = false;
}

function hidePopover() {
  el.colorPopover.hidden = true;
}

function handleSwatchPick(color) {
  if (selectedShapeId) {
    const shape = playerShapes.find((s) => s.id === selectedShapeId);
    if (shape) shape.color = color;
  }
  currentColor = color;
  renderAll();
  hidePopover();
}

// ---------- selection ----------

// Line/Rectangle/Logo targets have no color of their own to match — only
// Face and Flower do — so the color popover isn't worth popping open by
// default outside those two; the shape still gets selected either way.
const COLOR_RELEVANT_CONTENT = new Set(['face', 'scene']);

function selectShape(id) {
  selectedShapeId = id;
  renderAll();
  if (COLOR_RELEVANT_CONTENT.has(contentKey)) openPopoverForShape(id);
}

function deselect() {
  if (!selectedShapeId) return;
  selectedShapeId = null;
  hidePopover();
  renderAll();
}

// ---------- interaction ----------

function getSnappedPoint(evt, svg) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;
  const svgX = (evt.clientX - rect.left) * scaleX + viewBox.x;
  const svgY = (evt.clientY - rect.top) * scaleY + viewBox.y;

  let u = Math.round(svgX / CELL);
  let v = Math.round(svgY / CELL);
  u = Math.max(0, Math.min(GRID_UNITS, u));
  v = Math.max(0, Math.min(GRID_UNITS, v));
  return [u, v];
}

// Same as getSnappedPoint but without rounding to a grid intersection —
// used to derive a whole-number circle radius from the cursor's true
// distance from the center, rather than from two independently-snapped
// grid points (which usually gives a fractional radius).
function getRawPoint(evt, svg) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;
  const svgX = (evt.clientX - rect.left) * scaleX + viewBox.x;
  const svgY = (evt.clientY - rect.top) * scaleY + viewBox.y;

  let u = svgX / CELL;
  let v = svgY / CELL;
  u = Math.max(0, Math.min(GRID_UNITS, u));
  v = Math.max(0, Math.min(GRID_UNITS, v));
  return [u, v];
}

// Returns an edge point at exactly a half-grid-unit distance from center,
// along the direction of the raw (unsnapped) cursor position.
function snappedCirclePoint(center, rawPoint) {
  const dx = rawPoint[0] - center[0];
  const dy = rawPoint[1] - center[1];
  const dist = Math.hypot(dx, dy);
  const r = Math.max(0.5, Math.round(dist * 2) / 2);
  if (dist === 0) return [center[0] + r, center[1]];
  const scale = r / dist;
  return [center[0] + dx * scale, center[1] + dy * scale];
}

function updateAxisHighlight([hu, hv]) {
  xTickLabels.forEach((label, i) => {
    label.classList.toggle('active', i === hu);
    label.classList.toggle('faded', i !== hu);
  });
  yTickLabels.forEach((label, i) => {
    label.classList.toggle('active', i === hv);
    label.classList.toggle('faded', i !== hv);
  });
}

function clearAxisHighlight() {
  xTickLabels.forEach((label) => label.classList.remove('active', 'faded'));
  yTickLabels.forEach((label) => label.classList.remove('active', 'faded'));
}

function commitShape(type, points) {
  const id = `shape-${shapeIdCounter++}`;
  playerShapes.push({ id, type, points: points.slice(), color: currentColor });
  return id;
}

function refreshControls() {
  el.clearBtn.disabled = pendingPoints.length === 0 && playerShapes.length === 0;
}

function onGridPointerDown(evt) {
  const pt = getSnappedPoint(evt, el.grid);
  updateAxisHighlight(pt);

  if (activeTool === 'cursor') {
    const hit = findShapeAt(pt);
    if (hit) selectShape(hit.id);
    else deselect();
    return;
  }

  if (pendingPoints.length === 0 && selectedShapeId) deselect();

  isDragging = true;
  dragMoved = false;
  dragStart = pt;
  el.grid.setPointerCapture(evt.pointerId);
}

// The live preview (rubber-band shape + dimension tooltip) appears while
// actively dragging the first point of a 2-point tool, while hovering after
// a discrete first click waiting for the next click, or while placing the
// 2nd/3rd point of curve, the only 3-point tool.
function onGridPointerMove(evt) {
  const hovered = getSnappedPoint(evt, el.grid);
  updateAxisHighlight(hovered);

  if (activeTool === 'cursor') return;
  if (isDragging && (hovered[0] !== dragStart[0] || hovered[1] !== dragStart[1])) {
    dragMoved = true;
  }

  const required = TOOL_POINTS[activeTool];
  let previewFrom = null;

  if (isDragging && dragMoved && pendingPoints.length === 0 && required === 2) {
    previewFrom = dragStart;
  } else if (!isDragging && pendingPoints.length === 1 && required === 2) {
    previewFrom = pendingPoints[0];
  } else if (required === 3 && pendingPoints.length >= 1 && pendingPoints.length < 3) {
    previewFrom = pendingPoints[pendingPoints.length - 1];
  }

  if (!previewFrom) {
    // Not yet drawing — just hovering with a tool armed: show where the
    // cursor is, so the next click's coordinates aren't a surprise.
    showCoordTooltip(hovered);
    return;
  }

  // For a circle, snap the radius (not the edge point) to a whole number —
  // derived from the true cursor distance rather than two independently
  // grid-snapped points, which usually gives a fractional radius.
  const effectiveHovered = activeTool === 'circle'
    ? snappedCirclePoint(previewFrom, getRawPoint(evt, el.grid))
    : hovered;

  clearGroup(playerLayer);
  drawCommittedShapes();

  let boundsPoints;
  if (required === 3) {
    // Curve is the only 3-point tool left: a control-point guide line until
    // the 3rd point lands, then the actual curve preview.
    const pts = [...pendingPoints, hovered];
    boundsPoints = pts;
    pts.forEach((p) => playerLayer.appendChild(markerCircle(p, currentColor)));
    if (pts.length === 3) {
      const node = buildShapeNode('curve', pts, { color: currentColor, selected: true });
      node.classList.add('player-shape', 'preview');
      playerLayer.appendChild(node);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        playerLayer.appendChild(makeEl('line', {
          x1: px(pts[i][0]), y1: px(pts[i][1]), x2: px(pts[i + 1][0]), y2: px(pts[i + 1][1]),
          class: 'guide-line',
        }));
      }
    }
  } else {
    boundsPoints = [previewFrom, effectiveHovered];
    // selected:true so a closed shape's accent outline shows even when its
    // fill matches what's underneath (see the comment in drawPendingPreview).
    const node = buildShapeNode(activeTool, boundsPoints, { color: currentColor, selected: true });
    node.classList.add('player-shape', 'preview');
    playerLayer.appendChild(node);
  }

  if (COORD_TOOLTIP_TYPES.has(activeTool)) {
    showCoordTooltip(hovered);
  } else {
    showDimensionTooltip(dimensionLabel(activeTool, previewFrom, effectiveHovered), activeTool, boundsPoints);
  }
}

function onGridPointerUp(evt) {
  if (!isDragging) return;
  isDragging = false;
  el.grid.releasePointerCapture(evt.pointerId);

  const required = TOOL_POINTS[activeTool];
  let releasePoint = getSnappedPoint(evt, el.grid);

  // Placing a circle's edge point (2nd point, however it got there): snap
  // the radius to a whole number instead of independently snapping the
  // edge point to a grid intersection.
  const placingCircleEdge = activeTool === 'circle'
    && ((dragMoved && pendingPoints.length === 0) || pendingPoints.length === 1);
  if (placingCircleEdge) {
    const center = pendingPoints.length === 1 ? pendingPoints[0] : dragStart;
    releasePoint = snappedCirclePoint(center, getRawPoint(evt, el.grid));
  }

  if (dragMoved && pendingPoints.length === 0 && required === 2) {
    pendingPoints = [dragStart, releasePoint];
  } else {
    pendingPoints.push(releasePoint);
  }
  dragStart = null;
  dragMoved = false;

  if (pendingPoints.length >= required) {
    const id = commitShape(activeTool, pendingPoints);
    pendingPoints = [];
    hideDimensionTooltip();
    // Back to cursor mode once a shape/line is finished, so the next click
    // selects instead of starting another shape with the same tool.
    activeTool = 'cursor';
    updateToolbarActive();
    selectShape(id);
  } else {
    renderAll();
  }
  refreshControls();
}

function onGridPointerLeave() {
  if (!isDragging) {
    clearAxisHighlight();
    hideDimensionTooltip();
  }
}

// ---------- toolbar ----------

function updateToolbarActive() {
  el.toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.dataset.active = btn.dataset.tool === activeTool ? 'true' : 'false';
  });
  // Crosshair while an actual drawing tool is armed; the regular pointer
  // for Cursor mode, since nothing is about to be placed on click.
  el.grid.classList.toggle('tool-cursor', activeTool === 'cursor');
}

function selectTool(tool) {
  activeTool = tool;
  pendingPoints = [];
  isDragging = false;
  hideDimensionTooltip();
  deselect();
  updateToolbarActive();
  renderAll();
  refreshControls();
}

// ---------- instruction display ----------

function formatSyntax(shape) {
  const fillAttr = shape.color ? ` fill="${shape.color}"` : '';
  const strokeAttr = shape.color ? ` stroke="${shape.color}"` : '';

  switch (shape.type) {
    case 'line': {
      const [[x1, y1], [x2, y2]] = shape.points;
      const d = `M ${x1} ${y1} L ${x2} ${y2}`;
      // Bare path-data shorthand when there's no color to attach; a full
      // <path> tag (real SVG, just like the rect/circle elements) once
      // there's a stroke attribute worth showing.
      return shape.color ? `<path d="${d}"${strokeAttr} />` : d;
    }
    case 'rect': {
      const [[x1, y1], [x2, y2]] = shape.points;
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      return `<rect x="${formatNum(x)}" y="${formatNum(y)}" width="${formatNum(w)}" height="${formatNum(h)}"${fillAttr} />`;
    }
    case 'circle': {
      const [[cx, cy], [ex, ey]] = shape.points;
      return `<circle cx="${cx}" cy="${cy}" r="${formatNum(Math.hypot(ex - cx, ey - cy))}"${fillAttr} />`;
    }
    case 'curve': {
      const [[x1, y1], [cx, cy], [x2, y2]] = shape.points;
      const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
      return shape.color ? `<path d="${d}"${strokeAttr} />` : d;
    }
  }
}

const COLOR_NAMES = {
  '#000000': 'black',
  '#FC8F29': 'orange',
  '#F3DA5F': 'yellow',
  '#66B879': 'green',
  '#B7E5ED': 'light blue',
};

// A literal, mechanical line-by-line translation of the code — not a
// rewritten description. Same order, same values, same structure as
// formatSyntax; SVG terms become plain words (rect -> Rectangle, fill ->
// filled) but nothing is added that isn't already in the code (no "stem",
// "eyes", "petal", etc).
function translateShapeToEnglish(shape) {
  const colorWord = shape.color ? (COLOR_NAMES[shape.color] || shape.color) : null;
  const filled = colorWord ? `, filled ${colorWord}` : '';

  switch (shape.type) {
    case 'line': {
      const [[x1, y1], [x2, y2]] = shape.points;
      let s = `Draw a line from [x=${x1}, y=${y1}] to [x=${x2}, y=${y2}].`;
      if (colorWord) s += ` Stroke ${colorWord}.`;
      return s;
    }
    case 'rect': {
      const [[x1, y1], [x2, y2]] = shape.points;
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      return `From [x=${formatNum(x)}, y=${formatNum(y)}] draw a rectangle ${formatNum(w)} units wide and ${formatNum(h)} units tall${filled}.`;
    }
    case 'circle': {
      const [[cx, cy], [ex, ey]] = shape.points;
      const r = formatNum(Math.hypot(ex - cx, ey - cy));
      return `At [x=${cx}, y=${cy}] draw a circle with a radius of [r=${r}]${filled}.`;
    }
    case 'curve': {
      // "through" implied the curve passes over the middle point — it
      // doesn't: this is a quadratic Bezier, so the path only ever touches
      // the first and third points, and the middle one just pulls the bend
      // toward it (an easy thing to miss when you're clicking 3 points and
      // only 2 of them end up on the line).
      const [[x1, y1], [cx, cy], [x2, y2]] = shape.points;
      let s = `Draw a curve from [x=${x1}, y=${y1}] bending toward [x=${cx}, y=${cy}] to [x=${x2}, y=${y2}].`;
      if (colorWord) s += ` Stroke ${colorWord}.`;
      return s;
    }
  }
}

// A small colored dot right before a shape's color (the hex in the code
// line, the color word in the hint line), so the player can match it to a
// palette swatch by eye instead of decoding the hex digits — the text
// itself is untouched, just annotated alongside.
function appendTextWithDot(fragment, text, marker, color) {
  const idx = marker ? text.indexOf(marker) : -1;
  if (idx === -1) {
    fragment.appendChild(document.createTextNode(text));
    return;
  }
  fragment.appendChild(document.createTextNode(text.slice(0, idx)));
  const dot = document.createElement('span');
  dot.className = 'color-dot';
  dot.style.background = color;
  fragment.appendChild(dot);
  fragment.appendChild(document.createTextNode(text.slice(idx)));
}

// With hints on, each code line gets its English translation underneath,
// styled as a comment via reduced opacity (see .instr-comment).
function renderCodeWithHintBlock(shape) {
  const fragment = document.createDocumentFragment();
  const codeText = formatSyntax(shape);
  appendTextWithDot(fragment, codeText, shape.color, shape.color);
  fragment.appendChild(document.createTextNode('\n'));

  const colorWord = shape.color ? COLOR_NAMES[shape.color] || shape.color : null;
  const commentText = translateShapeToEnglish(shape);
  const comment = document.createElement('span');
  comment.className = 'instr-comment';
  appendTextWithDot(comment, commentText, colorWord, shape.color);
  fragment.appendChild(comment);
  return fragment;
}

function renderInstructionLine(shape) {
  if (showHints) return renderCodeWithHintBlock(shape);

  const fragment = document.createDocumentFragment();
  appendTextWithDot(fragment, formatSyntax(shape), shape.color, shape.color);
  return fragment;
}

function updateInstructionDisplay() {
  el.instructionText.textContent = '';
  const lineBreak = showHints ? '\n\n' : '\n'; // hints read as separate paragraphs
  currentContent.shapes.forEach((shape, i) => {
    if (i > 0) el.instructionText.appendChild(document.createTextNode(lineBreak));
    el.instructionText.appendChild(renderInstructionLine(shape));
  });
  updateLayout();
}

// Moves a menu's selector dot to the given row index, computed straight from
// the shared --row-h/--row-gap rhythm (see .selector-dot) rather than
// measured off the DOM — exact regardless of webfont-loading reflow, and
// the CSS transition on transform is what makes it glide instead of jump.
function positionSelectorDot(dotEl, index) {
  const styles = getComputedStyle(document.documentElement);
  const rowH = parseFloat(styles.getPropertyValue('--row-h'));
  const rowGap = parseFloat(styles.getPropertyValue('--row-gap'));
  const dotSize = 4;
  const y = index * (rowH + rowGap) + rowH / 2 - dotSize / 2;
  dotEl.style.transform = `translateY(${y}px)`;
}

function setHintsButtonState(visible) {
  animatePillWidth(el.hintsBtn, () => {
    el.hintsLabel.textContent = visible ? 'Hide hints' : 'Show hints';
  });
}

function setHints(on) {
  showHints = on;
  setHintsButtonState(showHints);
  updateInstructionDisplay();
}

// ---------- content switching ----------

function setContent(key) {
  contentKey = key;
  currentContent = CONTENT[key];

  el.contentList.querySelectorAll('.content-btn').forEach((btn) => {
    btn.dataset.active = btn.dataset.content === key ? 'true' : 'false';
  });
  el.contentSelect.value = key;
  positionSelectorDot(el.contentDot, CONTENT_ORDER.indexOf(key));

  pendingPoints = [];
  playerShapes = [];
  selectedShapeId = null;
  revealed = false;
  isDragging = false;
  dragStart = null;
  dragMoved = false;
  hideDimensionTooltip();
  hidePopover();

  setRevealButtonState(false);

  updateInstructionDisplay();
  clearGroup(playerLayer);
  clearGroup(targetLayer);
  clearAxisHighlight();
  refreshControls();

  // Arm the tool the first shape actually needs, so the player can start
  // drawing immediately without first hunting for the right icon.
  selectTool(currentContent.shapes[0].type);
}

// ---------- round-level actions ----------

function undo() {
  if (pendingPoints.length > 0) {
    pendingPoints.pop();
  } else if (playerShapes.length > 0) {
    const removed = playerShapes.pop();
    if (selectedShapeId === removed.id) {
      selectedShapeId = null;
      hidePopover();
    }
  }
  renderAll();
  refreshControls();
}

function clearAll() {
  pendingPoints = [];
  playerShapes = [];
  selectedShapeId = null;
  hidePopover();
  renderAll();
  refreshControls();
}

// Smoothly resizes a pill button to fit its new label instead of snapping —
// lock the current width, let the caller apply whatever label/state change,
// measure the natural width it now wants, then transition from the old
// width to the new one. Shared by Reveal and the hints toggle.
function animatePillWidth(btn, applyChange) {
  const startWidth = btn.getBoundingClientRect().width;
  btn.style.width = `${startWidth}px`;
  applyChange();
  btn.style.width = 'auto';
  const endWidth = btn.getBoundingClientRect().width;
  btn.style.width = `${startWidth}px`;
  btn.getBoundingClientRect(); // force reflow so the start width commits before transitioning
  requestAnimationFrame(() => {
    btn.style.width = `${endWidth}px`;
  });
}

function setRevealButtonState(isRevealed) {
  animatePillWidth(el.revealBtn, () => {
    el.revealBtn.dataset.active = isRevealed ? 'true' : 'false';
    el.revealLabel.textContent = isRevealed ? 'Hide' : 'Reveal';
  });
}

function toggleReveal() {
  revealed = !revealed;
  if (revealed) {
    renderTarget();
  } else {
    clearGroup(targetLayer);
  }
  setRevealButtonState(revealed);
}

// ---------- wire up ----------

({ shapes: playerLayer, target: targetLayer } = initGrid(el.grid));
buildTickLabels();
updateLayout();

// Re-measure once the Google Sans Flex / Google Sans Code webfonts finish
// loading — getWideInstructionWidth may have run against fallback-font
// metrics on first paint, before this resolves.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(updateLayout);
}

el.grid.addEventListener('pointerdown', onGridPointerDown);
el.grid.addEventListener('pointermove', onGridPointerMove);
el.grid.addEventListener('pointerup', onGridPointerUp);
el.grid.addEventListener('pointerleave', onGridPointerLeave);

el.toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => selectTool(btn.dataset.tool));
});
updateToolbarActive();

PALETTE.forEach((c) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.color = c.css;
  btn.title = c.name;
  btn.style.background = c.css;
  btn.addEventListener('click', () => handleSwatchPick(c.css));
  el.swatchRow.appendChild(btn);
});

document.addEventListener('pointerdown', (evt) => {
  if (el.colorPopover.hidden) return;
  if (el.colorPopover.contains(evt.target) || el.grid.contains(evt.target)) return;
  hidePopover();
});

el.hintsBtn.addEventListener('click', () => setHints(!showHints));

el.contentList.querySelectorAll('.content-btn').forEach((btn) => {
  btn.addEventListener('click', () => setContent(btn.dataset.content));
});

el.contentSelect.addEventListener('change', () => setContent(el.contentSelect.value));

el.revealBtn.addEventListener('click', toggleReveal);
el.clearBtn.addEventListener('click', clearAll);

document.addEventListener('keydown', (evt) => {
  if ((evt.key === 'Backspace' || evt.key === 'Delete') && selectedShapeId) {
    evt.preventDefault();
    playerShapes = playerShapes.filter((s) => s.id !== selectedShapeId);
    selectedShapeId = null;
    hidePopover();
    renderAll();
    refreshControls();
    return;
  }
  if ((evt.metaKey || evt.ctrlKey) && evt.key === 'z') {
    evt.preventDefault();
    undo();
    return;
  }
  if (evt.key >= '1' && evt.key <= '5') {
    const key = CONTENT_ORDER[Number(evt.key) - 1];
    if (key) setContent(key);
  }
});

setContent('line');
updateInstructionDisplay();
