(() => {
const CHANNEL_MAX = 255;
const MAX_RGB_DISTANCE_SQUARED = 3 * CHANNEL_MAX * CHANNEL_MAX;
const EDGE_SAMPLE_GRID = 16;
const SPAN_VALUE_CHUNK_SIZE = 4096;
const SPAN_VALUE_CHUNK_SHIFT = 12;
const SPAN_VALUE_CHUNK_MASK = SPAN_VALUE_CHUNK_SIZE - 1;
// Ignore isolated white flecks while retaining meaningful flat-color areas.
const MIN_PLATEAU_PIXELS = 16;
const FILL_RAY_TOLERANCE = 1.5;
// How much ink a pixel must carry before it is worth keeping. Below this it is
// treated as background and simply painted: a wash that sits a little darker
// than the colour being filled is not a stroke's skirt, and compositing it on
// top of the new colour is what turned an even band into a mottled one. The
// test is the amount of ink, not its colour, so an outline in brown or navy
// counts the same as one in black.
const BACKGROUND_NOISE_COVERAGE = 0.12;
// Paper this close to the flat colour carries no ink worth keeping. The bucket
// paints flat areas, so on white line art it always absorbs at least this much:
// a narrow range must not turn scanner grain into a moth-eaten fill.
const PAPER_FLOOR_DISTANCE_SQUARED = 3
  * (BACKGROUND_NOISE_COVERAGE * CHANNEL_MAX)
  * (BACKGROUND_NOISE_COVERAGE * CHANNEL_MAX);
// Near-white pixels are paper rather than another coloured face. A coloured
// click never absorbs them merely because RGB distance reaches white first;
// clicking the paper itself remains the explicit way to edit it.
const PAPER_CHANNEL_FLOOR = 248;
// The drawing's own lines. Whatever colour a line is drawn in, none of its
// channels is bright: every one of them is at least three quarters ink. That is
// what tells a stroke apart from a face the user has painted, however dark the
// paint is, and a bucket never spreads into one. Widening the range to reach
// one more face must not cost the drawing the lines it is made of.
const INK_CHANNEL_FLOOR = 0.25;
// A stroke lying on white paper dims every channel by the same share, because
// what it hides is white. A pixel that has given up a different share in each
// channel is holding a colour instead, and is a face rather than paper.
const INK_EVEN_SHARE = 0.05;
const SPECK_NEIGHBOUR_RATIO = 0.5;
// Two neighbours this close are a run of one flat colour. The skirt of a stroke
// is a slope, so its pixels never match the pixel past them.
const FLAT_RUN_DISTANCE_SQUARED = 3;
// How far the fill may reach across paper the range stopped at, to get to the
// stroke behind it. A rim left by grain is a pixel or two wide; a neighbouring
// face is not, so a short reach tells them apart.
const RIM_REACH = 3;
// How far an edge ramp may run, and how far off the line between the flat
// colour and its background a pixel may sit before it stops counting as part
// of that ramp.
const EDGE_RAMP_REACH = 6;
const EDGE_OFF_LINE_DISTANCE_SQUARED = 40 * 40;
// A pair of soft shape edges can miss one another by a pixel at a tight join.
// Only bridge a very short nick: a longer white seam is part of the drawing.
const FACE_JOIN_REACH = 2;
const FACE_JOIN_COVERAGE = 0.75;
// Drawings vary in how softly their shapes are drawn: in this artwork a stroke
// crosses its edge in one pixel while a sparkle takes four. Pulling the shares
// away from the middle tightens the softer ones towards the crisper ones
// without stepping the edge, which no longer holds any grade at all at 1.
const EDGE_CONTRAST = 1.6;
// A cut-out has no new colour to match anything to: what it leaves behind is
// the edge the drawing was already made with, read as it stands and pulled
// neither way. Tightening it there would hand back a stroke a shade heavier
// than the one beside it, which is the drawing's own edge going wrong.
const EDGE_AS_DRAWN = 1;
const NEIGHBOR_NORTH = 1 << 0;
const NEIGHBOR_NORTH_EAST = 1 << 1;
const NEIGHBOR_EAST = 1 << 2;
const NEIGHBOR_SOUTH_EAST = 1 << 3;
const NEIGHBOR_SOUTH = 1 << 4;
const NEIGHBOR_SOUTH_WEST = 1 << 5;
const NEIGHBOR_WEST = 1 << 6;
const NEIGHBOR_NORTH_WEST = 1 << 7;

function createInnerEdgeCoverageLookup() {
  // Reconstruct subpixel coverage from the center pixel and its 8 neighbors.
  // Sampling only the selected side keeps every unselected pixel untouched.
  const lookup = new Uint8Array(256);
  const sampleCount = EDGE_SAMPLE_GRID * EDGE_SAMPLE_GRID;

  for (let pattern = 0; pattern < lookup.length; pattern += 1) {
    let coveredSamples = 0;

    for (let sampleY = 0; sampleY < EDGE_SAMPLE_GRID; sampleY += 1) {
      const y = (sampleY + 0.5) / EDGE_SAMPLE_GRID - 0.5;
      const verticalDistance = Math.abs(y);
      const verticalBit = y < 0 ? NEIGHBOR_NORTH : NEIGHBOR_SOUTH;

      for (let sampleX = 0; sampleX < EDGE_SAMPLE_GRID; sampleX += 1) {
        const x = (sampleX + 0.5) / EDGE_SAMPLE_GRID - 0.5;
        const horizontalDistance = Math.abs(x);
        const horizontalBit = x < 0 ? NEIGHBOR_WEST : NEIGHBOR_EAST;
        const diagonalBit = y < 0
          ? x < 0
            ? NEIGHBOR_NORTH_WEST
            : NEIGHBOR_NORTH_EAST
          : x < 0
            ? NEIGHBOR_SOUTH_WEST
            : NEIGHBOR_SOUTH_EAST;
        const horizontal = pattern & horizontalBit ? 1 : 0;
        const vertical = pattern & verticalBit ? 1 : 0;
        const diagonal = pattern & diagonalBit ? 1 : 0;
        const coverageValue =
          (1 - horizontalDistance) * (1 - verticalDistance) +
          horizontalDistance * (1 - verticalDistance) * horizontal +
          (1 - horizontalDistance) * verticalDistance * vertical +
          horizontalDistance * verticalDistance * diagonal;

        if (coverageValue >= 0.5) {
          coveredSamples += 1;
        }
      }
    }

    lookup[pattern] = Math.round((coveredSamples / sampleCount) * CHANNEL_MAX);
  }

  return lookup;
}

const INNER_EDGE_COVERAGE = createInnerEdgeCoverageLookup();

function createSpanStream() {
  return {
    chunks: [],
    currentChunk: null,
    currentOffset: SPAN_VALUE_CHUNK_SIZE,
    valueCount: 0,
  };
}

function appendSpanValue(stream, value) {
  if (stream.currentOffset === SPAN_VALUE_CHUNK_SIZE) {
    stream.currentChunk = new Int32Array(SPAN_VALUE_CHUNK_SIZE);
    stream.currentOffset = 0;
    stream.chunks.push(stream.currentChunk);
  }

  stream.currentChunk[stream.currentOffset] = value;
  stream.currentOffset += 1;
  stream.valueCount += 1;
}

function recordSpan(stream, startPixel, length) {
  // A one-pixel span needs one Int32. Longer spans use a negative start marker
  // plus their length. The stream therefore never costs more than an Int32 per
  // selected pixel, while normal horizontal runs are substantially smaller.
  if (length === 1) {
    appendSpanValue(stream, startPixel);
    return;
  }

  appendSpanValue(stream, ~startPixel);
  appendSpanValue(stream, length);
}

function spanValueAt(stream, valueIndex) {
  const chunkIndex = valueIndex >>> SPAN_VALUE_CHUNK_SHIFT;
  const chunkOffset = valueIndex & SPAN_VALUE_CHUNK_MASK;
  return stream.chunks[chunkIndex][chunkOffset];
}

function forEachSpanPixel(stream, width, callback) {
  let spanValueIndex = 0;
  while (spanValueIndex < stream.valueCount) {
    const encodedStart = spanValueAt(stream, spanValueIndex);
    spanValueIndex += 1;
    const spanStart = encodedStart < 0 ? ~encodedStart : encodedStart;
    const spanLength = encodedStart < 0
      ? spanValueAt(stream, spanValueIndex)
      : 1;
    if (encodedStart < 0) {
      spanValueIndex += 1;
    }

    const pixelY = Math.floor(spanStart / width);
    const firstX = spanStart - pixelY * width;
    for (let spanOffset = 0; spanOffset < spanLength; spanOffset += 1) {
      callback(spanStart + spanOffset, firstX + spanOffset, pixelY);
    }
  }
}

function assertImageDataLike(imageData) {
  const width = imageData?.width;
  const height = imageData?.height;
  const data = imageData?.data;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data == null ||
    typeof data.length !== "number" ||
    data.length !== width * height * 4
  ) {
    throw new TypeError("Expected ImageData or an ImageData-like object");
  }
}

function cloneImageData(imageData) {
  assertImageDataLike(imageData);

  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

function seedIndex(imageData, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return -1;
  }

  const pixelX = Math.floor(x);
  const pixelY = Math.floor(y);

  if (
    pixelX < 0 ||
    pixelY < 0 ||
    pixelX >= imageData.width ||
    pixelY >= imageData.height
  ) {
    return -1;
  }

  return pixelY * imageData.width + pixelX;
}

function isOpaqueWhitePixel(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return (
    data[offset] === CHANNEL_MAX &&
    data[offset + 1] === CHANNEL_MAX &&
    data[offset + 2] === CHANNEL_MAX &&
    data[offset + 3] === CHANNEL_MAX
  );
}

function isPaperLikePixel(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return (
    data[offset + 3] === CHANNEL_MAX &&
    Math.min(data[offset], data[offset + 1], data[offset + 2]) >=
      PAPER_CHANNEL_FLOOR
  );
}

function belongsToSubstantialPaperPlateau(data, width, height, firstPixel) {
  const pending = [firstPixel];
  const visited = new Set([firstPixel]);
  let pendingIndex = 0;

  while (pendingIndex < pending.length) {
    if (visited.size >= MIN_PLATEAU_PIXELS) return true;

    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    const pixelX = pixelIndex % width;
    const inspect = (neighbor) => {
      if (visited.has(neighbor) || !isPaperLikePixel(data, neighbor)) return;
      visited.add(neighbor);
      pending.push(neighbor);
    };

    if (pixelIndex >= width) inspect(pixelIndex - width);
    if (pixelX + 1 < width) inspect(pixelIndex + 1);
    if (pixelIndex + width < width * height) inspect(pixelIndex + width);
    if (pixelX > 0) inspect(pixelIndex - 1);
  }

  return false;
}

function isProtectedPaperPixel(data, width, height, pixelIndex) {
  return (
    isOpaqueWhitePixel(data, pixelIndex) ||
    (isPaperLikePixel(data, pixelIndex) &&
      belongsToSubstantialPaperPlateau(data, width, height, pixelIndex))
  );
}

function belongsToSubstantialWhitePlateau(data, width, height, firstPixel) {
  const pending = [firstPixel];
  const visited = new Set([firstPixel]);
  let pendingIndex = 0;

  while (pendingIndex < pending.length) {
    if (visited.size >= MIN_PLATEAU_PIXELS) return true;

    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    const pixelX = pixelIndex % width;
    const inspect = (neighbor) => {
      if (visited.has(neighbor) || !isOpaqueWhitePixel(data, neighbor)) return;
      visited.add(neighbor);
      pending.push(neighbor);
    };

    if (pixelIndex >= width) inspect(pixelIndex - width);
    if (pixelX + 1 < width) inspect(pixelIndex + 1);
    if (pixelIndex + width < width * height) inspect(pixelIndex + width);
    if (pixelX > 0) inspect(pixelIndex - 1);
  }

  return visited.size >= MIN_PLATEAU_PIXELS;
}

function nearbyWhiteSeed(imageData, x, y, tolerance, barrier) {
  const firstPixel = seedIndex(imageData, x, y);
  if (isWalledOff(barrier, firstPixel)) {
    return firstPixel;
  }

  const maximumDistanceSquared = Math.max(
    toleranceDistanceSquared(tolerance),
    PAPER_FLOOR_DISTANCE_SQUARED,
  );
  if (firstPixel === -1) {
    return firstPixel;
  }

  const { data, width, height } = imageData;
  const firstOffset = firstPixel * 4;
  const white = {
    red: CHANNEL_MAX,
    green: CHANNEL_MAX,
    blue: CHANNEL_MAX,
    alpha: CHANNEL_MAX,
  };
  // An exact click is authoritative. Looking for a visually stronger patch can
  // otherwise jump across a thin antialiased bridge to a different white face.
  if (isOpaqueWhitePixel(data, firstPixel)) {
    return firstPixel;
  }
  if (
    data[firstOffset + 3] !== CHANNEL_MAX ||
    Math.min(data[firstOffset], data[firstOffset + 1], data[firstOffset + 2]) <
      PAPER_CHANNEL_FLOOR ||
    !isWithinTolerance(data, firstPixel, white, maximumDistanceSquared)
  ) {
    return firstPixel;
  }
  const firstX = firstPixel % width;
  const firstY = Math.floor(firstPixel / width);
  const radius = 8;
  const pending = [firstPixel];
  const visited = new Set([firstPixel]);
  let pendingIndex = 0;

  while (pendingIndex < pending.length) {
    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    // The queue is breadth-first, so the first substantial plateau is also the
    // one reached by the shortest in-tolerance path from the actual click.
    if (
      isOpaqueWhitePixel(data, pixelIndex) &&
      belongsToSubstantialWhitePlateau(data, width, height, pixelIndex)
    ) {
      return pixelIndex;
    }

    const pixelX = pixelIndex % width;
    const pixelY = Math.floor(pixelIndex / width);
    const inspect = (neighbor, neighborX, neighborY) => {
      if (
        isWalledOff(barrier, neighbor) ||
        Math.abs(neighborX - firstX) > radius ||
        Math.abs(neighborY - firstY) > radius ||
        visited.has(neighbor)
      ) {
        return;
      }
      visited.add(neighbor);
      const offset = neighbor * 4;
      if (
        data[offset + 3] === CHANNEL_MAX &&
        Math.min(data[offset], data[offset + 1], data[offset + 2]) >=
          PAPER_CHANNEL_FLOOR &&
        isWithinTolerance(data, neighbor, white, maximumDistanceSquared)
      ) {
        pending.push(neighbor);
      }
    };

    if (pixelY > 0) inspect(pixelIndex - width, pixelX, pixelY - 1);
    if (pixelX + 1 < width) inspect(pixelIndex + 1, pixelX + 1, pixelY);
    if (pixelY + 1 < height) inspect(pixelIndex + width, pixelX, pixelY + 1);
    if (pixelX > 0) inspect(pixelIndex - 1, pixelX - 1, pixelY);
  }

  return firstPixel;
}

function toleranceDistanceSquared(tolerance) {
  const numericTolerance = Number(tolerance);
  const boundedTolerance = Number.isFinite(numericTolerance)
    ? Math.min(100, Math.max(0, numericTolerance))
    : 0;
  const ratio = boundedTolerance / 100;

  return ratio * ratio * MAX_RGB_DISTANCE_SQUARED;
}

function isWithinTolerance(data, pixelIndex, target, maximumDistanceSquared) {
  const offset = pixelIndex * 4;
  const alpha = data[offset + 3];

  if (target.alpha === 0) {
    return alpha === 0;
  }

  if (alpha === 0) {
    return false;
  }

  const redDifference = data[offset] - target.red;
  const greenDifference = data[offset + 1] - target.green;
  const blueDifference = data[offset + 2] - target.blue;

  return (
    redDifference * redDifference +
      greenDifference * greenDifference +
      blueDifference * blueDifference <=
    maximumDistanceSquared
  );
}

function boundarySimilarityCoverage(
  data,
  pixelIndex,
  target,
  maximumDistanceSquared,
) {
  // Transparent regions deliberately ignore hidden RGB values. Small and
  // maximum tolerances keep their existing exact semantics; the soft band is
  // introduced only when the user deliberately widens the range.
  if (target.alpha === 0 || maximumDistanceSquared <= 0) {
    return 1;
  }

  const tolerance =
    Math.sqrt(maximumDistanceSquared / MAX_RGB_DISTANCE_SQUARED) * 100;
  const transitionBand = Math.min(
    8,
    Math.max(0, tolerance - 20),
    Math.max(0, 100 - tolerance),
  );

  if (transitionBand <= 0) {
    return 1;
  }

  const offset = pixelIndex * 4;
  const redDifference = data[offset] - target.red;
  const greenDifference = data[offset + 1] - target.green;
  const blueDifference = data[offset + 2] - target.blue;
  const pixelTolerance =
    Math.sqrt(
      (redDifference * redDifference +
        greenDifference * greenDifference +
        blueDifference * blueDifference) /
        MAX_RGB_DISTANCE_SQUARED,
    ) * 100;
  const position = Math.min(
    1,
    Math.max(0, (tolerance - pixelTolerance) / transitionBand),
  );

  // Smoothstep removes the visible jump at both ends of the soft threshold.
  return position * position * (3 - 2 * position);
}

function clampChannel(value) {
  return Math.min(CHANNEL_MAX, Math.max(0, Math.round(value)));
}

function normalizeColor(color) {
  if (
    color == null ||
    !Number.isFinite(color.r) ||
    !Number.isFinite(color.g) ||
    !Number.isFinite(color.b) ||
    (color.a !== undefined && !Number.isFinite(color.a))
  ) {
    return null;
  }

  return {
    r: clampChannel(color.r),
    g: clampChannel(color.g),
    b: clampChannel(color.b),
    a: clampChannel(color.a ?? CHANNEL_MAX),
    hasExplicitAlpha: color.a !== undefined,
  };
}

function channelForegroundCoverage(source, background) {
  return source < background
    ? (background - source) / background
    : background < CHANNEL_MAX
      ? (source - background) / (CHANNEL_MAX - background)
      : 0;
}

function isDrawnInk(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return Math.max(data[offset], data[offset + 1], data[offset + 2])
    <= INK_CHANNEL_FLOOR * CHANNEL_MAX;
}

function hasNearbyDrawnInk(data, width, height, x, y) {
  const left = Math.max(0, x - RIM_REACH);
  const right = Math.min(width - 1, x + RIM_REACH);
  const top = Math.max(0, y - RIM_REACH);
  const bottom = Math.min(height - 1, y + RIM_REACH);
  for (let neighborY = top; neighborY <= bottom; neighborY += 1) {
    for (let neighborX = left; neighborX <= right; neighborX += 1) {
      if (isDrawnInk(data, neighborY * width + neighborX)) {
        return true;
      }
    }
  }
  return false;
}

// Whether the range took in everything around a pixel: nothing within a rim's
// reach of it lies beyond the range, and nothing beside it was left out of the
// area, as a guide line leaves out its far side.
function rangeTakesInSurroundings(data, mask, width, height, x, y, target, maximumDistanceSquared) {
  const pixelIndex = y * width + x;
  if (
    mask[pixelIndex] !== 1 ||
    (y > 0 && mask[pixelIndex - width] !== 1) ||
    (x + 1 < width && mask[pixelIndex + 1] !== 1) ||
    (y + 1 < height && mask[pixelIndex + width] !== 1) ||
    (x > 0 && mask[pixelIndex - 1] !== 1)
  ) {
    return false;
  }

  // The widest range leaves nothing beyond it, and looking anyway doubles the
  // time a fill takes on a large picture.
  if (maximumDistanceSquared >= MAX_RGB_DISTANCE_SQUARED) {
    return true;
  }

  const left = Math.max(0, x - RIM_REACH);
  const right = Math.min(width - 1, x + RIM_REACH);
  const top = Math.max(0, y - RIM_REACH);
  const bottom = Math.min(height - 1, y + RIM_REACH);
  for (let neighborY = top; neighborY <= bottom; neighborY += 1) {
    for (let neighborX = left; neighborX <= right; neighborX += 1) {
      if (seedDistanceSquaredAt(data, neighborY * width + neighborX, target) > maximumDistanceSquared) {
        return false;
      }
    }
  }
  return true;
}

function isWhiteBackground(target) {
  return (
    target.alpha === CHANNEL_MAX &&
    target.red === CHANNEL_MAX &&
    target.green === CHANNEL_MAX &&
    target.blue === CHANNEL_MAX
  );
}

function isPaperLikeTarget(target) {
  return (
    target.alpha === CHANNEL_MAX &&
    Math.min(target.red, target.green, target.blue) >= PAPER_CHANNEL_FLOOR
  );
}

// Ink belongs to a stroke, so it always has comparably dark company beside it.
// A lone dark pixel is speckle: preserving its ink paints a dot that was
// invisible against white paper but stands out against a saturated fill.
function isolatedSpeck(data, width, height, x, y, target, ownCoverage) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }

      const offset = (ny * width + nx) * 4;
      const neighbour = Math.max(
        channelForegroundCoverage(data[offset], target.red),
        channelForegroundCoverage(data[offset + 1], target.green),
        channelForegroundCoverage(data[offset + 2], target.blue),
      );
      if (neighbour >= ownCoverage * SPECK_NEIGHBOUR_RATIO) {
        return false;
      }
    }
  }

  return true;
}

// A pixel an earlier pass already painted is the fill colour composited over
// whatever ink sat under it, so it lands on the ray from black through the fill
// colour. Its flat interior matches the fill exactly; its antialiased rim does
// not, which is why an exact comparison alone leaves that rim unprotected.
function carriesFillAlready(red, green, blue, fill) {
  const peak = Math.max(fill.r, fill.g, fill.b);
  if (peak === 0) {
    return red === 0 && green === 0 && blue === 0;
  }

  const along = (peak === fill.r ? red : peak === fill.g ? green : blue) / peak;
  return (
    along <= 1 &&
    Math.abs(red - along * fill.r) <= FILL_RAY_TOLERANCE &&
    Math.abs(green - along * fill.g) <= FILL_RAY_TOLERANCE &&
    Math.abs(blue - along * fill.b) <= FILL_RAY_TOLERANCE
  );
}

function lightBackgroundWeight(data, pixelIndex, target) {
  if (!isWhiteBackground(target)) {
    return null;
  }

  const offset = pixelIndex * 4;
  const foregroundCoverage = Math.max(
    channelForegroundCoverage(data[offset], target.red),
    channelForegroundCoverage(data[offset + 1], target.green),
    channelForegroundCoverage(data[offset + 2], target.blue),
  );

  return 1 - foregroundCoverage;
}

// Whether this pixel belongs to a face the fill is repainting, rather than to
// paper with a stroke lying on it.
//
// A stroke hides white, so it dims every channel of the paper by the same
// share; a colour of its own dims them by different shares. Swapping the paper
// out from under a stroke is what the light background weight is for, and it
// keeps the stroke. Doing the same to a face only tints it, which is why a
// range wide enough to select the next face along used to leave that face
// looking untouched.
//
// The face is the fill's to repaint only where the range reached the colour
// itself. Between paper and a face the range left out, the rim is a real soft
// edge and compositing is what keeps it soft, so a rim pixel counts as face
// only when a neighbour holding more of that colour was selected too. A
// neighbour already at the requested fill counts as selected as well: this is
// how the two sides of a removed guide recognise their shared soft seam.
function facePainted(data, mask, width, height, x, y, pixelIndex, target, fill) {
  const offset = pixelIndex * 4;
  const red = channelForegroundCoverage(data[offset], target.red);
  const green = channelForegroundCoverage(data[offset + 1], target.green);
  const blue = channelForegroundCoverage(data[offset + 2], target.blue);
  const selectedOnEverySide =
    mask[pixelIndex] === 1 &&
    (y === 0 || mask[pixelIndex - width] === 1) &&
    (x + 1 === width || mask[pixelIndex + 1] === 1) &&
    (y + 1 === height || mask[pixelIndex + width] === 1) &&
    (x === 0 || mask[pixelIndex - 1] === 1);
  const evenInkShare =
    Math.max(red, green, blue) - Math.min(red, green, blue) <= INK_EVEN_SHARE;

  if (evenInkShare) {
    // Exact greys can be small marks with no dark core; the speck check below
    // already tells a lone one from a real detail. A former guide crossing can
    // also land near grey, but its unequal channels and lack of a nearby ink
    // core identify it as mixed paint inside the selected area.
    const exactGrey =
      data[offset] === data[offset + 1] && data[offset + 1] === data[offset + 2];
    if (
      selectedOnEverySide &&
      !exactGrey &&
      !hasNearbyDrawnInk(data, width, height, x, y)
    ) {
      return true;
    }
    return false;
  }

  const ownDistance = seedDistanceSquaredAt(data, pixelIndex, target);
  let anyDeeper = false;
  let deeperSelected = false;
  const look = (neighborX, neighborY, selectedCounts = true) => {
    if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
      return;
    }

    const neighbor = neighborY * width + neighborX;
    if (seedDistanceSquaredAt(data, neighbor, target) <= ownDistance) {
      return;
    }

    anyDeeper = true;
    const neighborOffset = neighbor * 4;
    if (
      (selectedCounts && mask[neighbor] === 1) ||
      (data[neighborOffset] === fill.r &&
        data[neighborOffset + 1] === fill.g &&
        data[neighborOffset + 2] === fill.b)
    ) {
      deeperSelected = true;
    }
  };

  look(x, y - 1);
  look(x + 1, y);
  look(x, y + 1);
  look(x - 1, y);
  // A darker diagonal can belong to another part of the same old guide run.
  // If this pixel and every cardinal neighbour were directly selected, the
  // range took both sides and there is no silhouette here to rebuild.
  if (!deeperSelected && selectedOnEverySide) {
    return true;
  }
  if (!deeperSelected) {
    look(x - 1, y - 1, false);
    look(x + 1, y - 1, false);
    look(x + 1, y + 1, false);
    look(x - 1, y + 1, false);
  }

  // A step further from the paper means this pixel is on the rim and the face
  // proper lies that way, so the rim goes wherever the face went. With no step
  // left to take, this pixel is the face, and the range having selected it is
  // the whole answer.
  return anyDeeper ? deeperSelected : mask[pixelIndex] === 1;
}

// A partly transparent pixel beside the area a previous erase already cleared
// is its soft edge. When the erase reaches it from the other side, that edge is
// now inside the cut-out rather than at its boundary and must go with it.
function continuesPreviousErase(data, width, height, x, y, alpha) {
  if (alpha === CHANNEL_MAX) {
    return false;
  }

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const neighborX = x + dx;
      const neighborY = y + dy;
      if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
        continue;
      }

      if (data[(neighborY * width + neighborX) * 4 + 3] === 0) {
        return true;
      }
    }
  }

  return false;
}

// Erasing leaves the drawing's antialiased rim partly transparent. When that
// cut-out is painted again, the new colour belongs behind the rim: leaving it
// over transparency makes the page underneath show through as pale dots. Only
// follow visible pixels joined to the selected transparency, so a separate
// translucent part of the artwork remains untouched.
function includeTransparentEdge(data, width, height, region, barrier) {
  const included = new Uint8Array(width * height);
  const pending = [];
  const inspect = (pixelIndex) => {
    const alpha = data[pixelIndex * 4 + 3];
    if (
      region.mask[pixelIndex] ||
      included[pixelIndex] ||
      isWalledOff(barrier, pixelIndex) ||
      alpha === 0 ||
      alpha === CHANNEL_MAX
    ) {
      return;
    }
    included[pixelIndex] = 1;
    pending.push(pixelIndex);
  };
  const inspectNeighbours = (pixelIndex) => {
    const pixelX = pixelIndex % width;
    const pixelY = Math.floor(pixelIndex / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const neighborX = pixelX + dx;
        const neighborY = pixelY + dy;
        if (neighborX >= 0 && neighborY >= 0 && neighborX < width && neighborY < height) {
          inspect(neighborY * width + neighborX);
        }
      }
    }
  };

  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (region.mask[pixelIndex] === 1 && data[pixelIndex * 4 + 3] === 0) {
      inspectNeighbours(pixelIndex);
    }
  });
  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    inspectNeighbours(pending[pendingIndex]);
  }
  for (const pixelIndex of pending) {
    region.mask[pixelIndex] = 2;
    recordSpan(region.spans, pixelIndex, 1);
    region.count += 1;
  }

  return included;
}

// True when the pixel past this one carries the same colour, which marks a run
// of flat paint rather than the slope leading into a stroke.
function startsFlatRun(data, pixelIndex, beyondIndex) {
  const offset = pixelIndex * 4;
  const beyondOffset = beyondIndex * 4;
  const redDifference = data[offset] - data[beyondOffset];
  const greenDifference = data[offset + 1] - data[beyondOffset + 1];
  const blueDifference = data[offset + 2] - data[beyondOffset + 2];

  return (
    redDifference * redDifference +
      greenDifference * greenDifference +
      blueDifference * blueDifference <=
    FLAT_RUN_DISTANCE_SQUARED
  );
}

function packedRgbAt(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
}

function targetFromPackedRgb(packed, alpha) {
  return {
    red: (packed >> 16) & 0xff,
    green: (packed >> 8) & 0xff,
    blue: packed & 0xff,
    alpha,
  };
}

function isFlatColourAt(data, width, height, pixelIndex) {
  const pixelX = pixelIndex % width;
  const alpha = data[pixelIndex * 4 + 3];
  let matching = 0;
  const inspect = (neighbor) => {
    if (
      data[neighbor * 4 + 3] === alpha &&
      startsFlatRun(data, pixelIndex, neighbor)
    ) {
      matching += 1;
    }
  };

  if (pixelIndex >= width) inspect(pixelIndex - width);
  if (pixelX + 1 < width) inspect(pixelIndex + 1);
  if (pixelIndex + width < width * height) inspect(pixelIndex + width);
  if (pixelX > 0) inspect(pixelIndex - 1);
  return matching >= 3;
}

function solveMixtureShare(source, target, others) {
  const count = others.length;
  const targetChannels = [target.red, target.green, target.blue];
  const sourceChannels = [source.red, source.green, source.blue];
  const vectors = others.map((colour) => [
    colour.red - target.red,
    colour.green - target.green,
    colour.blue - target.blue,
  ]);
  const delta = sourceChannels.map(
    (level, channel) => level - targetChannels[channel],
  );
  const equations = Array.from({ length: count }, (_, row) => [
    ...Array.from({ length: count }, (_, column) => (
      vectors[row][0] * vectors[column][0] +
      vectors[row][1] * vectors[column][1] +
      vectors[row][2] * vectors[column][2]
    )),
    vectors[row][0] * delta[0] +
      vectors[row][1] * delta[1] +
      vectors[row][2] * delta[2],
  ]);

  for (let column = 0; column < count; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < count; row += 1) {
      if (Math.abs(equations[row][column]) > Math.abs(equations[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(equations[pivot][column]) < 1e-6) {
      return null;
    }
    [equations[column], equations[pivot]] = [equations[pivot], equations[column]];
    const divisor = equations[column][column];
    for (let at = column; at <= count; at += 1) {
      equations[column][at] /= divisor;
    }
    for (let row = 0; row < count; row += 1) {
      if (row === column) continue;
      const factor = equations[row][column];
      for (let at = column; at <= count; at += 1) {
        equations[row][at] -= factor * equations[column][at];
      }
    }
  }

  const weights = equations.map((row) => row[count]);
  const targetWeight = 1 - weights.reduce((sum, weight) => sum + weight, 0);
  const allWeights = [targetWeight, ...weights];
  if (allWeights.some((weight) => weight < -0.02 || weight > 1.02)) {
    return null;
  }
  const rebuilt = targetChannels.map((level, channel) => level + vectors.reduce(
    (sum, vector, index) => sum + weights[index] * vector[channel],
    0,
  ));
  const error = rebuilt.reduce(
    (sum, level, channel) => sum + (level - sourceChannels[channel]) ** 2,
    0,
  );
  return error <= FLAT_RUN_DISTANCE_SQUARED
    ? { share: Math.min(1, Math.max(0, targetWeight)), error }
    : null;
}

// Once a guide is gone, an ordinary edge can be recovered as one foreground
// and one backdrop. A crossing is different: its pixel can hold a share of as
// many as four flat faces, and flattening or projecting that mixture onto one
// edge either leaves the old face behind or eats a neighbour. Find the nearby
// flat face colours and recover only the clicked face's share of the mixture.
function localTargetShareAt(data, width, height, x, y, target, minimumOthers = 1) {
  const pixelIndex = y * width + x;
  const offset = pixelIndex * 4;
  const source = {
    red: data[offset],
    green: data[offset + 1],
    blue: data[offset + 2],
  };
  const candidates = [];
  const addCandidate = (candidate) => {
    if (candidates.length >= 6) {
      return;
    }
    const packed = packedRgbAt(data, candidate);
    const colour = targetFromPackedRgb(packed, target.alpha);
    const fromTarget =
      (colour.red - target.red) ** 2 +
      (colour.green - target.green) ** 2 +
      (colour.blue - target.blue) ** 2;
    if (
      fromTarget <= FLAT_RUN_DISTANCE_SQUARED ||
      candidates.some((known) => (
        (known.red - colour.red) ** 2 +
        (known.green - colour.green) ** 2 +
        (known.blue - colour.blue) ** 2 <= FLAT_RUN_DISTANCE_SQUARED
      ))
    ) {
      return;
    }
    candidates.push(colour);
  };

  for (let radius = 1; radius <= EDGE_RAMP_REACH && candidates.length < 6; radius += 1) {
    const left = Math.max(0, x - radius);
    const right = Math.min(width - 1, x + radius);
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let nearY = top; nearY <= bottom; nearY += 1) {
      for (let nearX = left; nearX <= right; nearX += 1) {
        if (
          nearX !== left && nearX !== right &&
          nearY !== top && nearY !== bottom
        ) {
          continue;
        }
        const candidate = nearY * width + nearX;
        if (
          data[candidate * 4 + 3] === target.alpha &&
          isFlatColourAt(data, width, height, candidate)
        ) {
          addCandidate(candidate);
        }
      }
    }
  }

  if (candidates.length < minimumOthers) {
    return null;
  }

  const choose = (count, start, chosen, visit) => {
    if (chosen.length === count) {
      visit(chosen);
      return;
    }
    for (let index = start; index <= candidates.length - (count - chosen.length); index += 1) {
      choose(count, index + 1, [...chosen, candidates[index]], visit);
    }
  };
  let best = null;
  for (let count = minimumOthers; count <= Math.min(3, candidates.length); count += 1) {
    choose(count, 0, [], (colours) => {
      const solved = solveMixtureShare(source, target, colours);
      if (
        solved !== null &&
        (best === null || solved.error < best.error - 1e-6)
      ) {
        best = solved;
      }
    });
  }
  return best === null ? null : best.share;
}

// A flat face has colour-matching company in more than one direction. An
// antialiased edge can run for many pixels with the same shade along its
// tangent, but it does not have matching pixels on the inside and outside as
// well. Requiring three neighbours therefore finds the colours on either side
// of an edge without mistaking the edge itself for another face.
function isSelectedPlateau(data, mask, width, height, pixelIndex) {
  const pixelX = pixelIndex % width;
  let matching = 0;
  const inspect = (neighbor) => {
    if (
      mask[neighbor] &&
      data[neighbor * 4 + 3] === data[pixelIndex * 4 + 3] &&
      startsFlatRun(data, pixelIndex, neighbor)
    ) {
      matching += 1;
    }
  };

  if (pixelIndex >= width) inspect(pixelIndex - width);
  if (pixelX + 1 < width) inspect(pixelIndex + 1);
  if (pixelIndex + width < width * height) inspect(pixelIndex + width);
  if (pixelX > 0) inspect(pixelIndex - 1);
  return matching >= 3;
}

// Edge reconstruction normally touches only a thin skirt around the selected
// face. Allocate its bookkeeping in 32px tiles as the walk reaches them, so a
// tiny edit in a large image does not reserve four more full-canvas rasters.
function createEdgeRampStorage(width) {
  const tileShift = 5;
  const tileSize = 1 << tileShift;
  const tileMask = tileSize - 1;
  const tilePixels = tileSize * tileSize;
  const tileColumns = Math.ceil(width / tileSize);
  const pages = new Map();
  const backgroundPixels = new Set();

  const location = (pixelIndex) => {
    const pixelX = pixelIndex % width;
    const pixelY = (pixelIndex - pixelX) / width;
    return {
      key: (pixelY >> tileShift) * tileColumns + (pixelX >> tileShift),
      slot: (pixelY & tileMask) * tileSize + (pixelX & tileMask),
    };
  };
  const pageAt = (pixelIndex, create = false) => {
    const at = location(pixelIndex);
    let page = pages.get(at.key);
    if (!page && create) {
      page = {
        parent: new Int32Array(tilePixels).fill(-1),
        depth: new Int8Array(tilePixels).fill(-1),
        background: new Int32Array(tilePixels).fill(-1),
        foreground: new Int32Array(tilePixels).fill(-1),
      };
      pages.set(at.key, page);
    }
    return { page, slot: at.slot };
  };
  const get = (name, pixelIndex) => {
    const { page, slot } = pageAt(pixelIndex);
    return page ? page[name][slot] : -1;
  };
  const set = (name, pixelIndex, value) => {
    const { page, slot } = pageAt(pixelIndex, true);
    page[name][slot] = value;
  };

  return {
    backgroundPixels,
    getBackground: (pixelIndex) => get("background", pixelIndex),
    getDepth: (pixelIndex) => get("depth", pixelIndex),
    getForeground: (pixelIndex) => get("foreground", pixelIndex),
    getParent: (pixelIndex) => get("parent", pixelIndex),
    setBackground(pixelIndex, value) {
      const previous = get("background", pixelIndex);
      set("background", pixelIndex, value);
      if (previous === -1 && value !== -1) backgroundPixels.add(pixelIndex);
      else if (previous !== -1 && value === -1) backgroundPixels.delete(pixelIndex);
    },
    setDepth: (pixelIndex, value) => set("depth", pixelIndex, value),
    setForeground: (pixelIndex, value) => set("foreground", pixelIndex, value),
    setParent: (pixelIndex, value) => set("parent", pixelIndex, value),
  };
}

// At a tight join, two antialiased coloured faces can each round away from the
// same paper pixel. Repainting either face then exposes that pixel as a white
// nick even though the selected face already wraps around its corner. Claim at
// most two such pixels, and only when the remaining side is visibly another
// colour rather than more of this face. This closes a join without walking up
// a deliberate white separator or pushing out an ordinary silhouette edge.
function closeFaceJoinNicks(
  data,
  width,
  height,
  region,
  target,
  edge,
  barrier,
) {
  const pixelCount = width * height;
  const paper = (CHANNEL_MAX << 16) | (CHANNEL_MAX << 8) | CHANNEL_MAX;
  let possible = new Set();

  const includePaper = (set, pixelIndex) => {
    const offset = pixelIndex * 4;
    if (
      data[offset + 3] === target.alpha &&
      data[offset] === CHANNEL_MAX &&
      data[offset + 1] === CHANNEL_MAX &&
      data[offset + 2] === CHANNEL_MAX
    ) {
      set.add(pixelIndex);
    }
  };
  const includeNearbyPaper = (set, pixelIndex) => {
    const pixelX = pixelIndex % width;
    includePaper(set, pixelIndex);
    if (pixelIndex >= width) includePaper(set, pixelIndex - width);
    if (pixelX + 1 < width) includePaper(set, pixelIndex + 1);
    if (pixelIndex + width < pixelCount) includePaper(set, pixelIndex + width);
    if (pixelX > 0) includePaper(set, pixelIndex - 1);
  };
  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (region.mask[pixelIndex]) includeNearbyPaper(possible, pixelIndex);
  });

  for (let generation = 0; generation < FACE_JOIN_REACH; generation += 1) {
    const candidates = [];

    for (const pixelIndex of possible) {
      const offset = pixelIndex * 4;
      if (
        isWalledOff(barrier, pixelIndex) ||
        data[offset + 3] !== target.alpha ||
        data[offset] !== CHANNEL_MAX ||
        data[offset + 1] !== CHANNEL_MAX ||
        data[offset + 2] !== CHANNEL_MAX
      ) {
        continue;
      }

      const pixelX = pixelIndex % width;
      const north = pixelIndex >= width && region.mask[pixelIndex - width] !== 0;
      const east = pixelX + 1 < width && region.mask[pixelIndex + 1] !== 0;
      const south = pixelIndex + width < pixelCount && region.mask[pixelIndex + width] !== 0;
      const west = pixelX > 0 && region.mask[pixelIndex - 1] !== 0;
      const selectedSides = Number(north) + Number(east) + Number(south) + Number(west);
      const hasSelectedCorner =
        (north && east) || (east && south) || (south && west) || (west && north);

      let touchesAnotherFace = false;
      const inspect = (neighbor) => {
        if (touchesAnotherFace || isDrawnInk(data, neighbor)) {
          return;
        }
        const neighborOffset = neighbor * 4;
        if (
          data[neighborOffset + 3] === target.alpha &&
          seedFractionAt(data, neighbor, target, paper) === -1
        ) {
          touchesAnotherFace = true;
        }
      };

      if (pixelIndex >= width) inspect(pixelIndex - width);
      if (pixelX + 1 < width) inspect(pixelIndex + 1);
      if (pixelIndex + width < pixelCount) inspect(pixelIndex + width);
      if (pixelX > 0) inspect(pixelIndex - 1);
      // A ramp walker may already have claimed the nick, but then rebuild it
      // as zero coverage because the source pixel is pure paper. Only an open
      // corner touching another colour is a face join; paper surrounded by the
      // selected face is an intentional closed detail and stays paper.
      const isFaceJoin =
        selectedSides < 4 && hasSelectedCorner && touchesAnotherFace;
      if (region.mask[pixelIndex]) {
        if (
          edge.getBackground(pixelIndex) !== -1 &&
          isFaceJoin
        ) {
          edge.setBackground(pixelIndex, -1);
          edge.setForeground(pixelIndex, -1);
          // Value 3 distinguishes a repaired join from the ordinary mask (1)
          // and a deliberately full-strength ramp pixel (2).
          region.mask[pixelIndex] = 3;
        }
        continue;
      }

      if (isFaceJoin) {
        candidates.push(pixelIndex);
      }
    }

    if (candidates.length === 0) {
      break;
    }
    const nextPossible = new Set();
    for (const pixelIndex of candidates) {
      region.mask[pixelIndex] = 1;
      recordSpan(region.spans, pixelIndex, 1);
      region.count += 1;
      includeNearbyPaper(nextPossible, pixelIndex);
    }
    possible = nextPossible;
  }
}

// A guide line the user drew for this edit only. It is not part of the picture
// and is never painted: every walk simply refuses to enter it, so a gap in the
// artwork can be closed, or a face split, without touching the image itself.
//
// The wall is three arrays over the same pixels, and a copy of the picture it
// was drawn over. `reach` is how far the nearest
// line runs from the pixel's centre, in sixty-fourths of a pixel and counting
// from one. `headings` is which way that line lies, and which way the nearest
// line heading elsewhere lies, and `crossing` is how far away that second one
// is. Distance alone says how much of a pixel a line leaves on each side of it;
// it takes the headings as well to say how a crossing cuts one into corners.
// `paper` is the picture as it stood before any fill ran under a line, taken
// because a pixel a line runs through is painted by the areas on both sides of
// it and soon looks like neither of them. It belongs to the picture rather than
// to the lines, so moving a point does not take it again: the point moved, the
// picture did not, and taking it again would record the paint already laid down
// along the old line as though it had been there all along.
//
// Only a pixel within the wall's reach of a line is shut off. The rest is
// recorded a pixel further out, because a line too far to cut a pixel can still
// be near enough to stand in the way of leaving it.
const WALL_DISTANCE_STEPS = 64;
const WALL_GEOMETRY_EPSILON = 1e-9;
const WALL_REACH = 1;
const WALL_RECORD_REACH = 2;
const WALL_SHUT_OFF = 1 + WALL_REACH * WALL_DISTANCE_STEPS;
// A heading is which way a line lies, in one hundred and twenty-eighths of a
// half turn, with the top bit set when the pixel is on the other side of it: a
// line and the same line the other way round are one line, and the side is what
// tells those two readings of it apart.
const WALL_LIE_STEPS = 128;
const WALL_LIE_MASK = WALL_LIE_STEPS - 1;
const WALL_OTHER_SIDE = WALL_LIE_STEPS;
// Two lines whose headings are closer than this are one line bending, not a
// crossing: a curve is stamped as a run of short straight pieces, and where one
// piece ends and the next begins the pixel is not a corner.
const WALL_CROSSING_TURN = 24;
// How far out of a piece of a wall pixel to look for the area it belongs to,
// and in what steps. Six pixels clears the wall even at the tip of a wedge.
const WALL_MARCH_STRIDE = 0.5;
const WALL_MARCH_STEPS = 12;
const WALL_SQUARE = Object.freeze([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
// A pixel is cut in two by one line, and into four corners by a crossing.
const WALL_HALVES = Object.freeze([[1, 0], [-1, 0]]);
const WALL_CORNERS = Object.freeze([[1, 1], [1, -1], [-1, 1], [-1, -1]]);

/** Whether a guide line shuts this pixel off, rather than merely running near it. */
function isWalledOff(barrier, pixelIndex) {
  if (!barrier) {
    return false;
  }
  const reach = barrier.reach[pixelIndex];
  return reach !== 0 && reach <= WALL_SHUT_OFF;
}

// A guide line is a wall for a fill on its way out from where it was put down.
// Asked for the whole picture nothing travels, so there is no wall to be, and a
// line left standing here would only take away the safeguard over the paper
// that a line is meant to overrule - taking the say, and handing back nothing.
function wallFor(barrier, wholePicture) {
  return wholePicture ? null : barrier;
}

function seedDistanceSquaredAt(data, pixelIndex, target) {
  const offset = pixelIndex * 4;
  const redDifference = data[offset] - target.red;
  const greenDifference = data[offset + 1] - target.green;
  const blueDifference = data[offset + 2] - target.blue;

  return (
    redDifference * redDifference +
    greenDifference * greenDifference +
    blueDifference * blueDifference
  );
}

// The artwork's own antialiasing says where a shape's edge really lies: an edge
// pixel holds a fraction of the flat colour blended with whatever sits behind
// it. Walking out from the region until the colour settles finds that backdrop,
// and recording it lets the edit rebuild the same edge in the new colour rather
// than cutting the shape off at a pixel boundary.
function collectEdgeRamp(
  data,
  width,
  height,
  region,
  target,
  barrier,
  repairFaceJoins,
) {
  const pixelCount = width * height;
  const edge = createEdgeRampStorage(width);
  const pending = [];
  const added = [];

  // One wide fill can deliberately take in several adjoining flat colours.
  // They make one output area, but each of their outer antialiased edges was
  // drawn against its own local colour. Using only the clicked colour there
  // bends the reconstructed edge towards the wrong backdrop and leaves a
  // one-pixel fleck wherever three areas meet.
  let hasSeveralPlateaus = false;
  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (
      !hasSeveralPlateaus &&
      region.mask[pixelIndex] &&
      seedDistanceSquaredAt(data, pixelIndex, target) > PAPER_FLOOR_DISTANCE_SQUARED &&
      isSelectedPlateau(data, region.mask, width, height, pixelIndex)
    ) {
      hasSeveralPlateaus = true;
    }
  });

  // The walk starts from the flat face, not from the edge of the region: a
  // wide range swallows part of the ramp into the region, and those pixels are
  // still a blend that has to be rebuilt rather than flattened.
  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (
      region.mask[pixelIndex] &&
      edge.getDepth(pixelIndex) === -1 &&
      (hasSeveralPlateaus
        ? isSelectedPlateau(data, region.mask, width, height, pixelIndex)
        : seedDistanceSquaredAt(data, pixelIndex, target) <= PAPER_FLOOR_DISTANCE_SQUARED)
    ) {
      edge.setDepth(pixelIndex, 0);
      edge.setForeground(pixelIndex, hasSeveralPlateaus
        ? packedRgbAt(data, pixelIndex)
        : (target.red << 16) | (target.green << 8) | target.blue);
      pending.push(pixelIndex);
    }
  });

  // A very small clicked plateau may have no pixel with three flat neighbours.
  // Keep the original seed-colour roots as a fallback so its edge is not lost
  // merely because another, larger colour was selected with it.
  if (hasSeveralPlateaus) {
    forEachSpanPixel(region.spans, width, (pixelIndex) => {
      if (
        region.mask[pixelIndex] &&
        edge.getDepth(pixelIndex) === -1 &&
        seedDistanceSquaredAt(data, pixelIndex, target) <= PAPER_FLOOR_DISTANCE_SQUARED
      ) {
        edge.setDepth(pixelIndex, 0);
        edge.setForeground(
          pixelIndex,
          (target.red << 16) | (target.green << 8) | target.blue,
        );
        pending.push(pixelIndex);
      }
    });
  }

  const settle = (fromPixel, settledPixel, packedForeground) => {
    const packedBackground = packedRgbAt(data, settledPixel);
    let pixelIndex = fromPixel;
    while (
      pixelIndex !== -1 &&
      edge.getDepth(pixelIndex) > 0 &&
      edge.getBackground(pixelIndex) === -1
    ) {
      edge.setBackground(pixelIndex, packedBackground);
      edge.setForeground(pixelIndex, packedForeground);
      pixelIndex = edge.getParent(pixelIndex);
    }
  };

  let pendingIndex = 0;
  while (pendingIndex < pending.length) {
    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    // A claimed wall pixel is painted for its share of the area, but it is not
    // part of that area. Letting edge repair use it as a new root can step onto
    // textured paper on the far side of a closed guide.
    if (isWalledOff(barrier, pixelIndex)) {
      continue;
    }
    const ownDepth = edge.getDepth(pixelIndex);
    const localForeground = edge.getForeground(pixelIndex);
    const localTarget = targetFromPackedRgb(localForeground, target.alpha);
    const ownDistance = seedDistanceSquaredAt(data, pixelIndex, localTarget);
    const pixelX = pixelIndex % width;

    const inspect = (neighbor, beyond) => {
      if (
        edge.getDepth(neighbor) !== -1 ||
        isWalledOff(barrier, neighbor) ||
        data[neighbor * 4 + 3] !== target.alpha
      ) {
        return;
      }
      if (beyond !== -1 && startsFlatRun(data, neighbor, beyond)) {
        // A flat run the fill is painting as well is no backdrop to rebuild an
        // edge against: there is no edge between two areas that are both coming
        // out the same colour, and the pixels along it are painted like the
        // rest. Rebuilding them used to hand each one back the colour of
        // whichever side it leaned towards, which left the boundary showing as
        // a dotted trail through the middle of one flat colour.
        if (!region.mask[neighbor]) {
          settle(pixelIndex, neighbor, localForeground);
        }
        return;
      }
      if (
        ownDepth >= EDGE_RAMP_REACH ||
        seedDistanceSquaredAt(data, neighbor, localTarget) <= ownDistance
      ) {
        return;
      }

      edge.setDepth(neighbor, ownDepth + 1);
      edge.setParent(neighbor, pixelIndex);
      edge.setForeground(neighbor, localForeground);
      pending.push(neighbor);
      if (!region.mask[neighbor]) {
        added.push(neighbor);
      }
    };

    if (pixelIndex >= width) {
      inspect(pixelIndex - width, pixelIndex >= 2 * width ? pixelIndex - 2 * width : -1);
    }
    if (pixelX + 1 < width) {
      inspect(pixelIndex + 1, pixelX + 2 < width ? pixelIndex + 2 : -1);
    }
    if (pixelIndex + width < pixelCount) {
      inspect(
        pixelIndex + width,
        pixelIndex + 2 * width < pixelCount ? pixelIndex + 2 * width : -1,
      );
    }
    if (pixelX > 0) {
      inspect(pixelIndex - 1, pixelX > 1 ? pixelIndex - 2 : -1);
    }
  }

  // A pixel the walk could not reach - a corner, a step the slope did not
  // climb - still belongs to the same edge as the pixels around it. Lend it a
  // neighbour's backdrop so it is rebuilt too instead of keeping the old colour.
  {
    const lent = [];
    const lendCandidates = new Set();
    for (const pixelIndex of edge.backgroundPixels) {
      const pixelX = pixelIndex % width;
      if (pixelIndex >= width) lendCandidates.add(pixelIndex - width);
      if (pixelX + 1 < width) lendCandidates.add(pixelIndex + 1);
      if (pixelIndex + width < pixelCount) lendCandidates.add(pixelIndex + width);
      if (pixelX > 0) lendCandidates.add(pixelIndex - 1);
    }

    for (const pixelIndex of lendCandidates) {
      if (
        edge.getBackground(pixelIndex) !== -1 ||
        data[pixelIndex * 4 + 3] !== target.alpha
      ) {
        continue;
      }

      // Paper this close to the flat colour is not a ramp, and belongs to the
      // region rather than here - unless the walk stepped onto it, which means
      // it lies along the edge and the range was simply too narrow to take it
      // in. Nothing else will have it then, and it is left showing whatever
      // colour was there before.
      if (
        edge.getDepth(pixelIndex) === -1 &&
        seedDistanceSquaredAt(data, pixelIndex, target) <= PAPER_FLOOR_DISTANCE_SQUARED
      ) {
        continue;
      }

      const pixelX = pixelIndex % width;
      let lender = -1;
      if (pixelIndex >= width && edge.getBackground(pixelIndex - width) !== -1) lender = pixelIndex - width;
      else if (pixelX + 1 < width && edge.getBackground(pixelIndex + 1) !== -1) lender = pixelIndex + 1;
      else if (pixelIndex + width < pixelCount && edge.getBackground(pixelIndex + width) !== -1) lender = pixelIndex + width;
      else if (pixelX > 0 && edge.getBackground(pixelIndex - 1) !== -1) lender = pixelIndex - 1;
      if (lender === -1) {
        continue;
      }

      const lentBackground = edge.getBackground(lender);
      const lentForeground = edge.getForeground(lender);
      const localTarget = targetFromPackedRgb(lentForeground, target.alpha);
      const fraction = seedFractionAt(data, pixelIndex, localTarget, lentBackground);
      if (fraction <= 0) {
        continue;
      }

      lent.push([pixelIndex, lentBackground, lentForeground]);
    }

    for (const [pixelIndex, lentBackground, lentForeground] of lent) {
      edge.setBackground(pixelIndex, lentBackground);
      edge.setForeground(pixelIndex, lentForeground);
      if (!region.mask[pixelIndex]) {
        added.push(pixelIndex);
      }
    }
  }

  if (hasSeveralPlateaus) {
    // A ramp from one plateau can brush a nearby outside edge while its pixel
    // is actually enclosed by the union of selected plateaus. There is no
    // silhouette edge to preserve when all four sides are selected; painting
    // it flat removes the pale pinhole at the join.
    for (const pixelIndex of [...edge.backgroundPixels]) {
      if (region.mask[pixelIndex] !== 1) {
        continue;
      }
      const pixelX = pixelIndex % width;
      const surrounded =
        (pixelIndex < width || region.mask[pixelIndex - width]) &&
        (pixelX + 1 >= width || region.mask[pixelIndex + 1]) &&
        (pixelIndex + width >= pixelCount || region.mask[pixelIndex + width]) &&
        (pixelX === 0 || region.mask[pixelIndex - 1]);
      if (surrounded) {
        edge.setBackground(pixelIndex, -1);
        edge.setForeground(pixelIndex, -1);
      }
    }
  }

  for (const pixelIndex of added) {
    if (edge.getBackground(pixelIndex) === -1 || region.mask[pixelIndex]) {
      continue;
    }
    region.mask[pixelIndex] = 2;
    recordSpan(region.spans, pixelIndex, 1);
    region.count += 1;
  }

  if (repairFaceJoins) {
    closeFaceJoinNicks(
      data,
      width,
      height,
      region,
      target,
      edge,
      barrier,
    );
  }

  return edge;
}

// How much of the flat colour this pixel holds, read off the line between that
// colour and the backdrop behind the edge. Returns -1 when the pixel does not
// sit on that line. An added ramp pixel is then left alone; a pixel the range
// selected itself falls back to the mask's geometric edge handling.
//
// `contrast` says how hard to pull the share away from the middle: laying a new
// colour down wants the edge tightened towards the crispness of the line art
// around it, and a cut-out wants it left exactly where the drawing put it.
function seedFractionAt(data, pixelIndex, target, packedBackground, contrast = EDGE_CONTRAST) {
  const backRed = (packedBackground >> 16) & 0xff;
  const backGreen = (packedBackground >> 8) & 0xff;
  const backBlue = packedBackground & 0xff;
  const axisRed = target.red - backRed;
  const axisGreen = target.green - backGreen;
  const axisBlue = target.blue - backBlue;
  const axisLengthSquared =
    axisRed * axisRed + axisGreen * axisGreen + axisBlue * axisBlue;

  if (axisLengthSquared === 0) {
    return -1;
  }

  const offset = pixelIndex * 4;
  const red = data[offset] - backRed;
  const green = data[offset + 1] - backGreen;
  const blue = data[offset + 2] - backBlue;
  const fraction = Math.min(
    1,
    Math.max(0, (red * axisRed + green * axisGreen + blue * axisBlue) / axisLengthSquared),
  );

  const offRed = red - fraction * axisRed;
  const offGreen = green - fraction * axisGreen;
  const offBlue = blue - fraction * axisBlue;
  if (
    offRed * offRed + offGreen * offGreen + offBlue * offBlue >
    EDGE_OFF_LINE_DISTANCE_SQUARED
  ) {
    return -1;
  }

  return Math.min(1, Math.max(0, (fraction - 0.5) * contrast + 0.5));
}

function inkCoverageAt(data, pixelIndex, target) {
  const offset = pixelIndex * 4;
  return Math.max(
    channelForegroundCoverage(data[offset], target.red),
    channelForegroundCoverage(data[offset + 1], target.green),
    channelForegroundCoverage(data[offset + 2], target.blue),
  );
}

// Splitting faces leaves stray pixels scattered far from the click: a small
// pocket of paper elsewhere in the drawing is too small to be a face of its
// own, so it is handed to whichever face is nearest, and across a thin line
// that can be this one. A bucket paints one connected area, so only paper
// reachable from the click survives. Ink cannot carry the walk: otherwise the
// strokes, which run everywhere, would rejoin every pocket on the page. The
// skirt around the face is added back afterwards.
function keepSeedComponent(data, region, width, height, firstPixel, target, walkDistanceSquared, barrier) {
  const pixelCount = width * height;
  const reached = new Uint8Array(pixelCount);
  const pending = [firstPixel];
  reached[firstPixel] = 1;
  let pendingIndex = 0;
  let count = 1;

  while (pendingIndex < pending.length) {
    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    const pixelX = pixelIndex % width;

    const inspect = (neighbor) => {
      if (
        reached[neighbor] ||
        !region.mask[neighbor] ||
        isWalledOff(barrier, neighbor) ||
        data[neighbor * 4 + 3] !== target.alpha ||
        !isWithinTolerance(data, neighbor, target, walkDistanceSquared)
      ) {
        return;
      }
      reached[neighbor] = 1;
      count += 1;
      pending.push(neighbor);
    };

    if (pixelIndex >= width) inspect(pixelIndex - width);
    if (pixelX + 1 < width) inspect(pixelIndex + 1);
    if (pixelIndex + width < pixelCount) inspect(pixelIndex + width);
    if (pixelX > 0) inspect(pixelIndex - 1);
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (region.mask[pixelIndex] && !reached[pixelIndex]) {
      region.mask[pixelIndex] = 0;
    }
  }

  region.count = count;
  return count;
}

// Grain the tolerance missed leaves unpainted flecks inside an otherwise solid
// face. A fleck is a run of pixels outside the region that never reaches the
// edge of the image and carries no ink at all: paper the range happened to skip.
// Anything holding ink is drawing - a glyph, a dot, the far side of a stroke -
// and anything reaching the border leads out of this face, so neither is taken.
// Paper the fill could not reach because a stroke closes around it: an eye, a
// gap inside a letter. Each patch is walked to its end before it is judged,
// never abandoned partway. Stopping early used to leave the rest of a patch
// marked as looked at while nothing had been decided about it, and whatever the
// scan met next was walled in by those leftovers and looked enclosed itself: a
// stray sliver of the picture, nowhere near the fill, quietly painted over.
function fillEnclosedPockets(data, width, height, region, target, barrier) {
  const pixelCount = width * height;
  const seen = new Uint8Array(pixelCount);

  for (let startPixel = 0; startPixel < pixelCount; startPixel += 1) {
    if (seen[startPixel] || region.mask[startPixel]) {
      continue;
    }

    const pocket = [startPixel];
    seen[startPixel] = 1;
    let pocketIndex = 0;
    let enclosed = true;
    let paperOnly = true;

    while (pocketIndex < pocket.length) {
      const pixelIndex = pocket[pocketIndex];
      pocketIndex += 1;
      const pixelX = pixelIndex % width;
      const pixelY = (pixelIndex - pixelX) / width;

      if (pixelX === 0 || pixelY === 0 || pixelX === width - 1 || pixelY === height - 1) {
        enclosed = false;
      }
      if (
        isWalledOff(barrier, pixelIndex) ||
        data[pixelIndex * 4 + 3] !== target.alpha ||
        !isWithinTolerance(data, pixelIndex, target, PAPER_FLOOR_DISTANCE_SQUARED)
      ) {
        paperOnly = false;
      }
      const inspect = (neighbor) => {
        if (seen[neighbor] || region.mask[neighbor]) {
          return;
        }
        seen[neighbor] = 1;
        pocket.push(neighbor);
      };

      if (pixelIndex >= width) inspect(pixelIndex - width);
      if (pixelX + 1 < width) inspect(pixelIndex + 1);
      if (pixelIndex + width < pixelCount) inspect(pixelIndex + width);
      if (pixelX > 0) inspect(pixelIndex - 1);
    }

    if (!enclosed || !paperOnly) {
      continue;
    }

    for (const pixelIndex of pocket) {
      region.mask[pixelIndex] = 1;
      recordSpan(region.spans, pixelIndex, 1);
      region.count += 1;
    }
  }

  return region.count;
}

// A narrow range stops at the first speck of grain, which can leave a pale rim
// of paper between the fill and the stroke - the flood cannot cross the speck,
// and the rim is open to the outside so it is not an enclosed pocket either.
// Paper that runs into ink within a pixel or two is that rim and belongs to the
// face. Paper that opens into more paper is the next face, and is left alone:
// that is what keeps a hairline seam between two faces from joining them.
function reachRimToInk(data, width, height, region, target, barrier) {
  const pixelCount = width * height;
  const depth = new Int8Array(pixelCount).fill(-1);
  const parent = new Int32Array(pixelCount);
  const pending = [];
  const anchored = [];

  const isPaper = (pixelIndex) =>
    !isWalledOff(barrier, pixelIndex) &&
    data[pixelIndex * 4 + 3] === target.alpha &&
    isWithinTolerance(data, pixelIndex, target, PAPER_FLOOR_DISTANCE_SQUARED);

  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (region.mask[pixelIndex] && depth[pixelIndex] === -1) {
      depth[pixelIndex] = 0;
      parent[pixelIndex] = -1;
      pending.push(pixelIndex);
    }
  });

  let pendingIndex = 0;
  while (pendingIndex < pending.length) {
    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    const ownDepth = depth[pixelIndex];
    const pixelX = pixelIndex % width;
    let touchesInk = false;

    const inspect = (neighbor) => {
      if (region.mask[neighbor]) {
        return;
      }
      if (!isPaper(neighbor)) {
        touchesInk = true;
        return;
      }
      if (depth[neighbor] !== -1 || ownDepth >= RIM_REACH) {
        return;
      }
      depth[neighbor] = ownDepth + 1;
      parent[neighbor] = pixelIndex;
      pending.push(neighbor);
    };

    if (pixelIndex >= width) inspect(pixelIndex - width);
    if (pixelX + 1 < width) inspect(pixelIndex + 1);
    if (pixelIndex + width < pixelCount) inspect(pixelIndex + width);
    if (pixelX > 0) inspect(pixelIndex - 1);

    if (touchesInk && ownDepth > 0) {
      anchored.push(pixelIndex);
    }
  }

  for (const anchor of anchored) {
    let pixelIndex = anchor;
    while (pixelIndex !== -1 && !region.mask[pixelIndex]) {
      region.mask[pixelIndex] = 1;
      recordSpan(region.spans, pixelIndex, 1);
      region.count += 1;
      pixelIndex = parent[pixelIndex];
    }
  }

  return region.count;
}

function wallLieOf(x, y) {
  return Math.round((Math.atan2(y, x) / Math.PI) * WALL_LIE_STEPS) & WALL_LIE_MASK;
}

// Whether two headings lie along the same line, whichever side of it each of
// them was read from.
function sameWallLine(first, second) {
  let turn = Math.abs((first & WALL_LIE_MASK) - (second & WALL_LIE_MASK));
  if (turn > WALL_LIE_STEPS / 2) {
    turn = WALL_LIE_STEPS - turn;
  }
  return turn < WALL_CROSSING_TURN;
}

// First settle the nearest line independently of traversal order. Only then can
// another heading be judged against it: comparing against a nearest line that
// is still changing makes a tight bend look different when drawn backwards.
function recordNearestWall(barrier, pixelIndex, distance, heading) {
  const reach = 1 + Math.round(
    distance * WALL_DISTANCE_STEPS + WALL_GEOMETRY_EPSILON,
  );
  const nearest = barrier.reach[pixelIndex];
  const slot = pixelIndex * 2;

  if (
    nearest === 0 ||
    reach < nearest ||
    (reach === nearest && heading < barrier.headings[slot])
  ) {
    barrier.reach[pixelIndex] = reach;
    barrier.headings[slot] = heading;
  }
}

// The nearest heading that differs from the settled line is the second cut of
// a crossing. A third would need a third line through the same pixel, which is
// a knot no drawing asks for.
function recordCrossingWall(barrier, pixelIndex, distance, heading) {
  const slot = pixelIndex * 2;

  if (sameWallLine(barrier.headings[slot], heading)) {
    return;
  }
  const reach = 1 + Math.round(
    distance * WALL_DISTANCE_STEPS + WALL_GEOMETRY_EPSILON,
  );
  const crossing = barrier.crossing[pixelIndex];
  if (
    crossing === 0 ||
    reach < crossing ||
    (reach === crossing && heading < barrier.headings[slot + 1])
  ) {
    barrier.headings[slot + 1] = heading;
    barrier.crossing[pixelIndex] = reach;
  }
}

function stampWallRun(barrier, width, height, from, to, record) {
  const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - WALL_RECORD_REACH));
  const right = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + WALL_RECORD_REACH));
  const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - WALL_RECORD_REACH));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + WALL_RECORD_REACH));
  const runX = to.x - from.x;
  const runY = to.y - from.y;
  const runLengthSquared = runX * runX + runY * runY;
  const lie = wallLieOf(runX, runY);
  // The side is judged against the heading as it will be read back, not against
  // the way the run happens to point: a run the other way round about the same
  // line has the other square angle, and would read every side backwards.
  const across = wallEdgeAt(lie, 1);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const reachX = x - from.x;
      const reachY = y - from.y;
      const along = runLengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, (reachX * runX + reachY * runY) / runLengthSquared));
      const awayX = reachX - runX * along;
      const awayY = reachY - runY * along;
      const distance = Math.hypot(awayX, awayY);
      if (distance > WALL_RECORD_REACH) {
        continue;
      }

      // Which way the line lies is the same for every pixel it passes; all this
      // one has to say for itself is which side of it its centre came down on.
      const heading = awayX * across.nx + awayY * across.ny >= -WALL_GEOMETRY_EPSILON
        ? lie
        : lie | WALL_OTHER_SIDE;
      record(barrier, y * width + x, distance, heading);
    }
  }
}

/**
 * Builds the wall a set of guide polylines makes over a picture that size.
 * Pass the wall from last time to write over it rather than make another: a
 * point being dragged rebuilds this on every movement of the mouse.
 */
function createGuideBarrier(width, height, lines, previous = null) {
  const barrier = previous !== null && previous.reach.length === width * height
    ? previous
    : {
      reach: new Uint8Array(width * height),
      headings: new Uint8Array(width * height * 2),
      crossing: new Uint8Array(width * height),
      paper: null,
      painted: false,
      rebuildFromPaper: false,
    };
  barrier.rebuildFromPaper = barrier.painted;
  barrier.reach.fill(0);
  barrier.headings.fill(0);
  barrier.crossing.fill(0);

  for (const line of lines) {
    for (let index = 0; index < line.length - 1; index += 1) {
      stampWallRun(
        barrier,
        width,
        height,
        line[index],
        line[index + 1],
        recordNearestWall,
      );
    }
  }
  for (const line of lines) {
    for (let index = 0; index < line.length - 1; index += 1) {
      stampWallRun(
        barrier,
        width,
        height,
        line[index],
        line[index + 1],
        recordCrossingWall,
      );
    }
  }
  return barrier;
}

// Where a line stands within one pixel: the way out of it towards the pixel's
// own centre, and how far along that way the line runs. A point of the pixel is
// on the centre's side of the line when nx*x + ny*y + offset is not negative.
function wallEdgeAt(heading, reach) {
  const lie = ((heading & WALL_LIE_MASK) / WALL_LIE_STEPS) * Math.PI;
  const side = (heading & WALL_OTHER_SIDE) === 0 ? 1 : -1;
  return {
    nx: -Math.sin(lie) * side,
    ny: Math.cos(lie) * side,
    offset: (reach - 1) / WALL_DISTANCE_STEPS,
  };
}

function clipToSide(polygon, nx, ny, offset) {
  const kept = [];
  const corners = polygon.length / 2;
  for (let corner = 0; corner < corners; corner += 1) {
    const nextCorner = (corner + 1) % corners;
    const x = polygon[corner * 2];
    const y = polygon[corner * 2 + 1];
    const nextX = polygon[nextCorner * 2];
    const nextY = polygon[nextCorner * 2 + 1];
    const here = nx * x + ny * y + offset;
    const next = nx * nextX + ny * nextY + offset;
    if (here >= 0) {
      kept.push(x, y);
    }
    if ((here >= 0) !== (next >= 0)) {
      const ratio = here / (here - next);
      kept.push(x + (nextX - x) * ratio, y + (nextY - y) * ratio);
    }
  }
  return kept;
}

function polygonMiddle(polygon) {
  const corners = polygon.length / 2;
  if (corners < 3) {
    return null;
  }

  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let corner = 0; corner < corners; corner += 1) {
    const nextCorner = (corner + 1) % corners;
    const cornerX = polygon[corner * 2];
    const cornerY = polygon[corner * 2 + 1];
    const nextX = polygon[nextCorner * 2];
    const nextY = polygon[nextCorner * 2 + 1];
    const cross = cornerX * nextY - nextX * cornerY;
    twiceArea += cross;
    x += (cornerX + nextX) * cross;
    y += (cornerY + nextY) * cross;
  }
  if (twiceArea === 0) {
    return null;
  }
  return { area: Math.abs(twiceArea) / 2, x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

// Which area a piece of a wall pixel belongs to: step out of the middle of the
// piece, the way that leads away from every line that cut it, until the wall
// runs out. The tip of a narrow wedge is several pixels of wall away from the
// area it belongs to, while the areas on either side of it are one pixel away,
// so asking which area is nearest hands them a corner that is not theirs.
function wallPieceHome(barrier, width, height, pixelX, pixelY, middle, awayX, awayY) {
  const length = Math.hypot(awayX, awayY);
  if (length === 0) {
    return -1;
  }

  const strideX = (awayX / length) * WALL_MARCH_STRIDE;
  const strideY = (awayY / length) * WALL_MARCH_STRIDE;
  let x = pixelX + middle.x;
  let y = pixelY + middle.y;
  for (let step = 0; step < WALL_MARCH_STEPS; step += 1) {
    x += strideX;
    y += strideY;
    const atX = Math.round(x);
    const atY = Math.round(y);
    if (atX < 0 || atY < 0 || atX >= width || atY >= height) {
      return -1;
    }
    const at = atY * width + atX;
    if (!isWalledOff(barrier, at)) {
      return at;
    }
  }
  return -1;
}

// The pieces the lines cut one pixel of wall into, each with the share of the
// pixel it covers and the area it belongs to. The shares are the areas of the
// pixel's own square cut by one line or two, so they add up to the whole of it.
function wallPieces(barrier, width, height, pixelIndex) {
  const slot = pixelIndex * 2;
  const near = wallEdgeAt(barrier.headings[slot], barrier.reach[pixelIndex]);
  const across = barrier.crossing[pixelIndex] !== 0
    && !sameWallLine(barrier.headings[slot], barrier.headings[slot + 1])
    ? wallEdgeAt(barrier.headings[slot + 1], barrier.crossing[pixelIndex])
    : null;
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  const pieces = [];

  for (const [nearSide, acrossSide] of across === null ? WALL_HALVES : WALL_CORNERS) {
    let piece = clipToSide(
      WALL_SQUARE,
      near.nx * nearSide,
      near.ny * nearSide,
      near.offset * nearSide,
    );
    if (acrossSide !== 0) {
      piece = clipToSide(
        piece,
        across.nx * acrossSide,
        across.ny * acrossSide,
        across.offset * acrossSide,
      );
    }

    const middle = polygonMiddle(piece);
    if (middle === null) {
      continue;
    }

    const awayX = near.nx * nearSide + (acrossSide === 0 ? 0 : across.nx * acrossSide);
    const awayY = near.ny * nearSide + (acrossSide === 0 ? 0 : across.ny * acrossSide);
    pieces.push({
      share: middle.area,
      home: wallPieceHome(barrier, width, height, pixelX, pixelY, middle, awayX, awayY),
    });
  }
  return pieces;
}

// Rebuild a wall pixel from the page the guide was first drawn over and the
// colours that now live on each side. Adding another delta to the current
// pixel is not stable after the guide moves: its shares change with the line,
// so traces of colours painted at earlier positions would accumulate there.
function rebuiltWallColour(data, width, height, pixelIndex, mask, barrier, fill) {
  const offset = pixelIndex * 4;
  const fillChannels = [fill.r, fill.g, fill.b];
  const colour = [
    barrier.paper[offset],
    barrier.paper[offset + 1],
    barrier.paper[offset + 2],
  ];

  for (const piece of wallPieces(barrier, width, height, pixelIndex)) {
    if (piece.home === -1) {
      continue;
    }
    const homeOffset = piece.home * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const current = mask[piece.home]
        ? fillChannels[channel]
        : data[homeOffset + channel];
      colour[channel] += piece.share * (current - barrier.paper[homeOffset + channel]);
    }
  }

  return colour.map(clampChannel);
}

// A drawn line is a wall a few pixels thick, and the picture under it is never
// touched, so a fill that simply stops at the wall leaves a stripe of the
// original showing, with the pixel grid for an edge. Instead the wall is shared
// out: every pixel it covers is painted by the fill on each side of it, in
// proportion to how much of that pixel falls on that side. Two fills then meet
// along the curve itself, smoothly, and neither one has a staircase for an edge.
//
// The proportions work because a fill is written as a change from the colour it
// replaced. Two of them over the same pixel add to exactly one whole pixel of
// paint, with no trace of the page between them.
//
// Only pixels the fill would have covered anyway are taken, so a line drawn
// across an outline never smears over it, and only the pieces that lead back to
// this area, so the rest of the line leaves nothing behind.
function claimWallEdge(data, width, height, region, seedPixel, maximumDistanceSquared, barrier) {
  if (barrier === null) {
    return { count: region.count, share: null };
  }

  // Whether a pixel the line runs through belongs to this area is a question
  // about the picture the line was drawn over, not about the picture now. Now,
  // the pixel carries paint from every area it has been shared out to and
  // matches none of them, and the area asking may itself have been painted a
  // colour the pixel never had. Both are read off the page as it was, so the
  // two are being compared on the same terms however often either is repainted.
  if (barrier.paper === null) {
    barrier.paper = data.slice();
  }
  const paperTarget = {
    red: barrier.paper[seedPixel * 4],
    green: barrier.paper[seedPixel * 4 + 1],
    blue: barrier.paper[seedPixel * 4 + 2],
    alpha: barrier.paper[seedPixel * 4 + 3],
  };

  const share = new Uint8Array(width * height);
  let count = region.count;
  for (let pixelIndex = 0; pixelIndex < barrier.reach.length; pixelIndex += 1) {
    if (!isWalledOff(barrier, pixelIndex) || region.mask[pixelIndex]) {
      continue;
    }
    if (!isWithinTolerance(barrier.paper, pixelIndex, paperTarget, maximumDistanceSquared)) {
      continue;
    }

    let coverage = 0;
    for (const piece of wallPieces(barrier, width, height, pixelIndex)) {
      if (piece.home !== -1 && region.mask[piece.home]) {
        coverage += piece.share;
      }
    }
    if (coverage <= 0) {
      continue;
    }

    share[pixelIndex] = 1 + Math.round(Math.min(1, coverage) * 254);
    region.mask[pixelIndex] = 2;
    recordSpan(region.spans, pixelIndex, 1);
    count += 1;
  }
  return { count, share };
}

// A bucket for flat colour has to meet the drawn line, not stop wherever the
// tolerance ran out. A narrow range otherwise leaves a pale rim along every
// stroke and lets paper grain stand out as unpainted specks. From the edge of
// the region, step outward only into a pixel carrying strictly more ink than
// the one it came from: that walks down the antialiased skirt of a stroke and
// halts on its crest, so the fill reaches the line and never crosses it, and a
// neighbouring flat face is never entered because it carries no more ink.
function extendRegionToInk(data, width, height, region, target, barrier) {
  const pending = [];

  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (!region.mask[pixelIndex]) {
      return;
    }

    const pixelX = pixelIndex % width;
    if (
      (pixelIndex >= width && !region.mask[pixelIndex - width]) ||
      (pixelX + 1 < width && !region.mask[pixelIndex + 1]) ||
      (pixelIndex + width < width * height && !region.mask[pixelIndex + width]) ||
      (pixelX > 0 && !region.mask[pixelIndex - 1])
    ) {
      pending.push(pixelIndex);
    }
  });

  let pendingIndex = 0;
  while (pendingIndex < pending.length) {
    const pixelIndex = pending[pendingIndex];
    pendingIndex += 1;
    const ownInk = inkCoverageAt(data, pixelIndex, target);
    const pixelX = pixelIndex % width;

    const inspect = (neighbor, beyond) => {
      if (
        region.mask[neighbor] ||
        isWalledOff(barrier, neighbor) ||
        data[neighbor * 4 + 3] !== target.alpha ||
        inkCoverageAt(data, neighbor, target) <= ownInk
      ) {
        return;
      }

      // The flat-run test exists to stop the fill biting into a neighbouring
      // block of colour. Paper is never that neighbour, so grain lying two or
      // three pixels together is absorbed instead of left as a fleck.
      if (
        beyond !== -1 &&
        !isWithinTolerance(data, neighbor, target, PAPER_FLOOR_DISTANCE_SQUARED) &&
        startsFlatRun(data, neighbor, beyond)
      ) {
        return;
      }

      // Marked 2, not 1: these pixels were chosen because they lead into the
      // line, so the soft threshold that fades pixels near the tolerance edge
      // must not fade them back out again.
      region.mask[neighbor] = 2;
      recordSpan(region.spans, neighbor, 1);
      region.count += 1;
      pending.push(neighbor);
    };

    if (pixelIndex >= width) {
      inspect(pixelIndex - width, pixelIndex >= 2 * width ? pixelIndex - 2 * width : -1);
    }
    if (pixelX + 1 < width) {
      inspect(pixelIndex + 1, pixelX + 2 < width ? pixelIndex + 2 : -1);
    }
    if (pixelIndex + width < width * height) {
      inspect(
        pixelIndex + width,
        pixelIndex + 2 * width < width * height ? pixelIndex + 2 * width : -1,
      );
    }
    if (pixelX > 0) {
      inspect(pixelIndex - 1, pixelX > 1 ? pixelIndex - 2 : -1);
    }
  }

  return region.count;
}

function regionContains(mask, width, height, x, y) {
  return (
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height ||
    mask[y * width + x] !== 0
  );
}

function innerEdgeCoverage(
  mask,
  width,
  height,
  x,
  y,
  data,
  pixelIndex,
  target,
  maximumDistanceSquared,
) {
  if (mask[pixelIndex] === 3) {
    return FACE_JOIN_COVERAGE;
  }
  if (mask[pixelIndex] === 2) {
    return 1;
  }

  const north = regionContains(mask, width, height, x, y - 1);
  const east = regionContains(mask, width, height, x + 1, y);
  const south = regionContains(mask, width, height, x, y + 1);
  const west = regionContains(mask, width, height, x - 1, y);

  if (north && east && south && west) {
    return 1;
  }

  let pattern = 0;
  if (north) pattern |= NEIGHBOR_NORTH;
  if (regionContains(mask, width, height, x + 1, y - 1)) pattern |= NEIGHBOR_NORTH_EAST;
  if (east) pattern |= NEIGHBOR_EAST;
  if (regionContains(mask, width, height, x + 1, y + 1)) pattern |= NEIGHBOR_SOUTH_EAST;
  if (south) pattern |= NEIGHBOR_SOUTH;
  if (regionContains(mask, width, height, x - 1, y + 1)) pattern |= NEIGHBOR_SOUTH_WEST;
  if (west) pattern |= NEIGHBOR_WEST;
  if (regionContains(mask, width, height, x - 1, y - 1)) pattern |= NEIGHBOR_NORTH_WEST;

  const geometricCoverage = INNER_EDGE_COVERAGE[pattern] / CHANNEL_MAX;
  const similarityCoverage = boundarySimilarityCoverage(
    data,
    pixelIndex,
    target,
    maximumDistanceSquared,
  );

  // Both values describe the same inside edge from different evidence. Use
  // the tighter limit instead of stacking two blur strengths together.
  return Math.min(geometricCoverage, similarityCoverage);
}

function collectContiguousRegion(
  data,
  width,
  height,
  firstPixel,
  target,
  maximumDistanceSquared,
  recordVisitedSpans = true,
  barrier = null,
  guardDrawing = false,
  guardPaper = false,
  wholePicture = false,
  allNonInk = false,
) {
  const visited = new Uint8Array(width * height);
  const pending = [firstPixel];
  const spans = recordVisitedSpans ? createSpanStream() : null;
  let visitedCount = 0;
  const belongs = (pixelIndex) => {
    const alpha = data[pixelIndex * 4 + 3];
    return (
      !isWalledOff(barrier, pixelIndex) &&
      (allNonInk || isWithinTolerance(data, pixelIndex, target, maximumDistanceSquared)) &&
      !(guardDrawing && alpha !== 0 && isDrawnInk(data, pixelIndex)) &&
      !(guardPaper && isProtectedPaperPixel(data, width, height, pixelIndex))
    );
  };

  // Asked for the whole picture, the walk has nothing to walk: what belongs is
  // decided pixel by pixel, and being joined to the click no longer comes into
  // it. The rows are read in order so the spans come out the same shape the
  // flood would have left them, and every pass after this one reads them alike.
  if (wholePicture) {
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * width;
      let runStart = -1;
      for (let x = 0; x <= width; x += 1) {
        const inRun = x < width && belongs(rowStart + x);
        if (inRun) {
          visited[rowStart + x] = 1;
          visitedCount += 1;
          if (runStart === -1) {
            runStart = rowStart + x;
          }
        } else if (runStart !== -1) {
          if (recordVisitedSpans) {
            recordSpan(spans, runStart, rowStart + x - runStart);
          }
          runStart = -1;
        }
      }
    }
    return { mask: visited, spans, count: visitedCount };
  }

  while (pending.length > 0) {
    const pixelIndex = pending.pop();
    if (visited[pixelIndex] || !belongs(pixelIndex)) {
      continue;
    }

    const pixelX = pixelIndex % width;
    const pixelY = Math.floor(pixelIndex / width);
    const rowStart = pixelY * width;
    let left = pixelX;
    let right = pixelX;

    while (left > 0 && !visited[rowStart + left - 1] && belongs(rowStart + left - 1)) {
      left -= 1;
    }

    while (right + 1 < width && !visited[rowStart + right + 1] && belongs(rowStart + right + 1)) {
      right += 1;
    }

    let upperSpanQueued = false;
    let lowerSpanQueued = false;

    for (let currentX = left; currentX <= right; currentX += 1) {
      const currentPixel = rowStart + currentX;
      if (!visited[currentPixel]) {
        visited[currentPixel] = 1;
        visitedCount += 1;
      }

      if (pixelY > 0) {
        const upperPixel = currentPixel - width;
        const upperMatches = !visited[upperPixel] && belongs(upperPixel);
        if (upperMatches && !upperSpanQueued) {
          pending.push(upperPixel);
        }
        upperSpanQueued = upperMatches;
      }

      if (pixelY + 1 < height) {
        const lowerPixel = currentPixel + width;
        const lowerMatches = !visited[lowerPixel] && belongs(lowerPixel);
        if (lowerMatches && !lowerSpanQueued) {
          pending.push(lowerPixel);
        }
        lowerSpanQueued = lowerMatches;
      }
    }

    if (recordVisitedSpans) {
      recordSpan(spans, rowStart + left, right - left + 1);
    }
  }

  return { mask: visited, spans, count: visitedCount };
}

function walkContiguousRegion(
  imageData,
  x,
  y,
  tolerance,
  visitPixel,
  protectDrawing = false,
  requiredPixel = -1,
  rebuildEdges = false,
  barrier = null,
  wholePicture = false,
  includeWhiteAndBlack = false,
) {
  assertImageDataLike(imageData);

  const firstPixel = seedIndex(imageData, x, y);
  if (firstPixel === -1) {
    return 0;
  }

  const { data, width, height } = imageData;
  const firstOffset = firstPixel * 4;
  const target = {
    red: data[firstOffset],
    green: data[firstOffset + 1],
    blue: data[firstOffset + 2],
    alpha: data[firstOffset + 3],
  };
  const maximumDistanceSquared = toleranceDistanceSquared(tolerance);
  const clickedInk = isDrawnInk(data, firstPixel);
  const fillsEveryNonInkColour =
    protectDrawing && wholePicture &&
    maximumDistanceSquared >= MAX_RGB_DISTANCE_SQUARED;
  // The lines of the drawing are not the bucket's to paint over, at any range -
  // unless a line is what was clicked, and then it is the area being painted.
  // At the widest whole-picture setting the click only starts the operation:
  // every non-ink colour is the target, even when the click landed on a dark
  // antialiased edge, so the drawing stays protected there as well.
  // Asked to include white and black, the user has taken both safeguards off:
  // the lines and the paper then fall in or out of the area by the range alone.
  const guardDrawing =
    protectDrawing && !includeWhiteAndBlack && (!clickedInk || fillsEveryNonInkColour);
  // A guide is the user's explicit boundary and takes precedence over the
  // automatic paper safeguard. This lets a moved guide absorb its old soft
  // seam instead of freezing those near-white pixels in place.
  // Selecting the whole picture at the maximum range is likewise an explicit
  // bucket request for every non-ink colour, including paper. At that setting
  // ink remains protected wherever the click landed. The eraser keeps its
  // existing paper safeguard.
  const guardPaper =
    barrier === null && !includeWhiteAndBlack && !isPaperLikeTarget(target) && !fillsEveryNonInkColour;
  const fullRegion = collectContiguousRegion(
    data,
    width,
    height,
    firstPixel,
    target,
    maximumDistanceSquared,
    true,
    barrier,
    guardDrawing,
    guardPaper,
    wholePicture,
    fillsEveryNonInkColour,
  );
  let selectedCount = fullRegion.count;
  const whitePaper = protectDrawing && isWhiteBackground(target);

  if (whitePaper) {
    fillEnclosedPockets(data, width, height, fullRegion, target, barrier);
    // The range decides what counts as one colour, so the area it covers has
    // to follow it. Telling faces apart automatically used to override the
    // range outright: once a neighbouring face held a colour of its own, no
    // setting could ever reach it again. The paper floor stays as a floor so a
    // narrow range still absorbs grain.
    // Keeping only the piece the click sits in is the one repair that asks
    // what is joined to what, so it has nothing to say when the whole picture
    // was asked for.
    if (!wholePicture) {
      keepSeedComponent(
        data,
        fullRegion,
        width,
        height,
        firstPixel,
        target,
        Math.max(maximumDistanceSquared, PAPER_FLOOR_DISTANCE_SQUARED),
        barrier,
      );
    }
    reachRimToInk(data, width, height, fullRegion, target, barrier);
    extendRegionToInk(data, width, height, fullRegion, target, barrier);
    // Once the skirt is in, it becomes a starting point of its own, and grain
    // caught between the face and a stroke is enclosed at last. A second round
    // of both passes picks up the flecks that were unreachable before.
    reachRimToInk(data, width, height, fullRegion, target, barrier);
    extendRegionToInk(data, width, height, fullRegion, target, barrier);
    selectedCount = fillEnclosedPockets(data, width, height, fullRegion, target, barrier);
  }

  // Paper grain is absorbed on the way to a stroke, so the seam absorbs it too
  // and does not come out speckled where the line crossed a mottled patch.
  const wall = claimWallEdge(
    data,
    width,
    height,
    fullRegion,
    firstPixel,
    whitePaper ? Math.max(maximumDistanceSquared, PAPER_FLOOR_DISTANCE_SQUARED) : maximumDistanceSquared,
    barrier,
  );
  selectedCount = wall.count;

  // Seed snapping is only a convenience for near-white edge pixels. Never
  // apply an edit if that convenience selected a face that excludes the point
  // the user actually clicked. The widest whole-picture bucket operation is
  // the exception: its click is only a trigger, not one of the pixels to paint.
  if (
    requiredPixel !== -1 &&
    fullRegion.mask[requiredPixel] === 0 &&
    !fillsEveryNonInkColour
  ) {
    return 0;
  }

  // The white bucket path already rebuilds edges through its own delta, so the
  // ramp is collected for every other case: a coloured area, and the eraser.
  const edgeRamp =
    rebuildEdges && !whitePaper
      ? collectEdgeRamp(
        data,
        width,
        height,
        fullRegion,
        target,
        barrier,
        protectDrawing,
      )
      : null;
  const transparentEdge =
    rebuildEdges && protectDrawing && target.alpha === 0
      ? includeTransparentEdge(data, width, height, fullRegion, barrier)
      : null;

  // Splitting a region drops pixels from the mask while their spans stay in the
  // stream, so a later pass can record the same pixel a second time. Painting it
  // twice applies the same delta twice and burns a saturated speck into the page.
  const painted = new Uint8Array(width * height);
  forEachSpanPixel(fullRegion.spans, width, (pixelIndex, pixelX, pixelY) => {
    if (fullRegion.mask[pixelIndex] && !painted[pixelIndex]) {
      painted[pixelIndex] = 1;
      visitPixel(
        pixelIndex,
        fullRegion.mask,
        pixelX,
        pixelY,
        target,
        maximumDistanceSquared,
        edgeRamp === null ? -1 : edgeRamp.getBackground(pixelIndex),
        edgeRamp === null ? -1 : edgeRamp.getForeground(pixelIndex),
        wall.share === null || wall.share[pixelIndex] === 0
          ? -1
          : (wall.share[pixelIndex] - 1) / 254,
        transparentEdge !== null && transparentEdge[pixelIndex] === 1,
      );
    }
  });

  return selectedCount;
}

/**
 * Returns linear pixel indexes in the 4-neighbor region connected to the seed.
 * Tolerance compares RGB distance against the seed pixel. Visible alpha levels
 * stay connected so antialiased edges recolor together. Transparent regions
 * are kept separate and their hidden RGB values are ignored.
 */
function getContiguousRegion(imageData, x, y, tolerance = 0, barrier = null) {
  const region = [];
  walkContiguousRegion(imageData, x, y, tolerance, (pixelIndex) => {
    region.push(pixelIndex);
  }, false, -1, false, barrier);
  return region;
}

/** Returns a copy with the connected region erased using an inner antialiased edge. */
function eraseContiguousRegion(imageData, x, y, tolerance = 0, barrier = null, wholePicture = false, includeWhiteAndBlack = false) {
  const result = cloneImageData(imageData);
  let changedPixels = 0;

  walkContiguousRegion(imageData, x, y, tolerance, (
    pixelIndex,
    mask,
    pixelX,
    pixelY,
    target,
    maximumDistanceSquared,
    packedBackground,
    packedForeground,
    wallCoverage,
  ) => {
    const alphaOffset = pixelIndex * 4 + 3;

    // An edge pixel only partly belongs to the area being cleared: take away
    // that share of its opacity and leave the backdrop it was blended with, so
    // the cut-out keeps the edge the drawing was made with.
    if (packedBackground !== -1) {
      const seedFraction = seedFractionAt(
        imageData.data,
        pixelIndex,
        packedForeground === -1
          ? target
          : targetFromPackedRgb(packedForeground, target.alpha),
        packedBackground,
        EDGE_AS_DRAWN,
      );

      if (seedFraction === -1 && mask[pixelIndex] !== 1) {
        return;
      }

      if (seedFraction !== -1) {
        const offset = pixelIndex * 4;
        const remaining = clampChannel(result.data[alphaOffset] * (1 - seedFraction));
        const hadRed = result.data[offset];
        const hadGreen = result.data[offset + 1];
        const hadBlue = result.data[offset + 2];
        const hadAlpha = result.data[alphaOffset];
        result.data[offset] = (packedBackground >> 16) & 0xff;
        result.data[offset + 1] = (packedBackground >> 8) & 0xff;
        result.data[offset + 2] = packedBackground & 0xff;
        result.data[alphaOffset] = remaining;
        if (
          hadRed !== result.data[offset] ||
          hadGreen !== result.data[offset + 1] ||
          hadBlue !== result.data[offset + 2] ||
          hadAlpha !== remaining
        ) {
          changedPixels += 1;
        }
        return;
      }
    }

    // On the wall the share of the pixel is already known from the line that
    // drew it, and it is finer than anything the mask's own shape can say.
    const coverage = wallCoverage !== -1 ? wallCoverage : innerEdgeCoverage(
      mask,
      imageData.width,
      imageData.height,
      pixelX,
      pixelY,
      imageData.data,
      pixelIndex,
      target,
      maximumDistanceSquared,
    );
    // Taking a share of what is left keeps the drawn edge on an ordinary pixel,
    // but a pixel the line runs through is shared with the erase on the other
    // side of it: taking that share away outright is what lets the two of them
    // clear the whole pixel between them.
    const continuesErase =
      coverage < 1 &&
      imageData.data[alphaOffset] !== CHANNEL_MAX &&
      continuesPreviousErase(
        imageData.data,
        imageData.width,
        imageData.height,
        pixelX,
        pixelY,
        imageData.data[alphaOffset],
      );
    const replacementAlpha = continuesErase
      ? 0
      : wallCoverage !== -1 && wallCoverage < 1
        ? clampChannel(result.data[alphaOffset] - CHANNEL_MAX * coverage)
        : clampChannel(result.data[alphaOffset] * (1 - coverage));
    if (result.data[alphaOffset] !== replacementAlpha) {
      result.data[alphaOffset] = replacementAlpha;
      changedPixels += 1;
    }
  }, false, -1, true, wallFor(barrier, wholePicture), wholePicture, includeWhiteAndBlack);

  result.changedPixels = changedPixels;
  return result;
}

/**
 * Returns a copy with the connected region replaced by color.
 * color is { r, g, b, a }. When alpha is omitted, visible coverage is kept;
 * filling a fully transparent region uses alpha 255. Diagonal inside edges
 * are composited by coverage while pixels outside the region stay untouched.
 * White line art also preserves the dark foreground contribution in antialiased
 * edge pixels instead of replacing those pixels with a flat color.
 */
function fillContiguousRegion(
  imageData,
  x,
  y,
  color,
  tolerance = 0,
  barrier = null,
  wholePicture = false,
  includeWhiteAndBlack = false,
) {
  const result = cloneImageData(imageData);
  const normalizedColor = normalizeColor(color);

  if (normalizedColor == null) {
    result.changedPixels = 0;
    return result;
  }

  let changedPixels = 0;
  const originalPixel = seedIndex(imageData, x, y);
  const wall = wallFor(barrier, wholePicture);
  const rebuildMovedWall = wall !== null && wall.rebuildFromPaper;
  const firstPixel = nearbyWhiteSeed(imageData, x, y, tolerance, wall);
  const fillX = firstPixel === -1 ? x : firstPixel % imageData.width;
  const fillY = firstPixel === -1 ? y : Math.floor(firstPixel / imageData.width);
  const fillingTransparency =
    firstPixel !== -1 && imageData.data[firstPixel * 4 + 3] === 0;
  const fillsEveryNonInkColour =
    wholePicture && toleranceDistanceSquared(tolerance) >= MAX_RGB_DISTANCE_SQUARED;
  const seedOffset = (firstPixel === -1 ? seedIndex(imageData, x, y) : firstPixel) * 4;
  const seedDiffersFromFill =
    imageData.data[seedOffset] !== normalizedColor.r ||
    imageData.data[seedOffset + 1] !== normalizedColor.g ||
    imageData.data[seedOffset + 2] !== normalizedColor.b;
  walkContiguousRegion(imageData, fillX, fillY, tolerance, (
    pixelIndex,
    mask,
    pixelX,
    pixelY,
    target,
    maximumDistanceSquared,
    packedBackground,
    packedForeground,
    wallCoverage,
    transparentEdge,
  ) => {
    const offset = pixelIndex * 4;
    const sourceRed = result.data[offset];
    const sourceGreen = result.data[offset + 1];
    const sourceBlue = result.data[offset + 2];
    const sourceAlpha = result.data[offset + 3];
    const replacementAlpha = normalizedColor.hasExplicitAlpha
      ? normalizedColor.a
      : fillingTransparency || (fillsEveryNonInkColour && sourceAlpha === 0)
        ? CHANNEL_MAX
        : sourceAlpha;

    // At the maximum whole-picture range the mask has already decided that a
    // selected transparent pixel is not ink. Restore it directly so dark
    // neighbours cannot make it look like a drawn edge whose alpha should stay.
    if (
      fillsEveryNonInkColour &&
      sourceAlpha === 0 &&
      mask[pixelIndex] === 1
    ) {
      result.data[offset] = normalizedColor.r;
      result.data[offset + 1] = normalizedColor.g;
      result.data[offset + 2] = normalizedColor.b;
      result.data[offset + 3] = replacementAlpha;
      if (
        sourceRed !== normalizedColor.r ||
        sourceGreen !== normalizedColor.g ||
        sourceBlue !== normalizedColor.b ||
        sourceAlpha !== replacementAlpha
      ) {
        changedPixels += 1;
      }
      return;
    }

    if (transparentEdge) {
      if (replacementAlpha === CHANNEL_MAX) {
        // A settled dark edge stores straight ink plus its opacity; a lighter
        // neutral edge still stores the opaque, white-matted pixel from before
        // the erase. Recreate whichever form the ordinary white-paper bucket
        // would have seen, then run the same background replacement over it.
        const foregroundWeight = sourceAlpha / CHANNEL_MAX;
        const settledInk = isDrawnInk(imageData.data, pixelIndex);
        const drawnRed = settledInk
          ? clampChannel(sourceRed * foregroundWeight + CHANNEL_MAX * (1 - foregroundWeight))
          : sourceRed;
        const drawnGreen = settledInk
          ? clampChannel(sourceGreen * foregroundWeight + CHANNEL_MAX * (1 - foregroundWeight))
          : sourceGreen;
        const drawnBlue = settledInk
          ? clampChannel(sourceBlue * foregroundWeight + CHANNEL_MAX * (1 - foregroundWeight))
          : sourceBlue;
        const redCoverage = channelForegroundCoverage(drawnRed, CHANNEL_MAX);
        const greenCoverage = channelForegroundCoverage(drawnGreen, CHANNEL_MAX);
        const blueCoverage = channelForegroundCoverage(drawnBlue, CHANNEL_MAX);
        const inkCoverage = Math.max(redCoverage, greenCoverage, blueCoverage);
        const whiteMattedInk =
          settledInk ||
          inkCoverage - Math.min(redCoverage, greenCoverage, blueCoverage) <= INK_EVEN_SHARE;

        if (!whiteMattedInk) {
          result.data[offset] = clampChannel(
            sourceRed * foregroundWeight + normalizedColor.r * (1 - foregroundWeight),
          );
          result.data[offset + 1] = clampChannel(
            sourceGreen * foregroundWeight + normalizedColor.g * (1 - foregroundWeight),
          );
          result.data[offset + 2] = clampChannel(
            sourceBlue * foregroundWeight + normalizedColor.b * (1 - foregroundWeight),
          );
          result.data[offset + 3] = CHANNEL_MAX;
        } else {
          const backgroundWeight = 1 - inkCoverage;
          if (inkCoverage < BACKGROUND_NOISE_COVERAGE) {
            result.data[offset] = normalizedColor.r;
            result.data[offset + 1] = normalizedColor.g;
            result.data[offset + 2] = normalizedColor.b;
          } else {
            result.data[offset] = clampChannel(
              drawnRed + backgroundWeight * (normalizedColor.r - CHANNEL_MAX),
            );
            result.data[offset + 1] = clampChannel(
              drawnGreen + backgroundWeight * (normalizedColor.g - CHANNEL_MAX),
            );
            result.data[offset + 2] = clampChannel(
              drawnBlue + backgroundWeight * (normalizedColor.b - CHANNEL_MAX),
            );
          }
          result.data[offset + 3] = CHANNEL_MAX;
        }
      } else {
        const sourceWeight = sourceAlpha;
        const fillWeight = replacementAlpha * (1 - sourceAlpha / CHANNEL_MAX);
        const outputAlpha = sourceWeight + fillWeight;
        result.data[offset] = clampChannel(
          (sourceRed * sourceWeight + normalizedColor.r * fillWeight) / outputAlpha,
        );
        result.data[offset + 1] = clampChannel(
          (sourceGreen * sourceWeight + normalizedColor.g * fillWeight) / outputAlpha,
        );
        result.data[offset + 2] = clampChannel(
          (sourceBlue * sourceWeight + normalizedColor.b * fillWeight) / outputAlpha,
        );
        result.data[offset + 3] = clampChannel(outputAlpha);
      }
      if (
        sourceRed !== result.data[offset] ||
        sourceGreen !== result.data[offset + 1] ||
        sourceBlue !== result.data[offset + 2] ||
        sourceAlpha !== result.data[offset + 3]
      ) {
        changedPixels += 1;
      }
      return;
    }

    if (
      rebuildMovedWall &&
      wallCoverage !== -1 &&
      wall !== null &&
      wall.paper !== null &&
      sourceAlpha === CHANNEL_MAX &&
      replacementAlpha === CHANNEL_MAX
    ) {
      const [red, green, blue] = rebuiltWallColour(
        imageData.data,
        imageData.width,
        imageData.height,
        pixelIndex,
        mask,
        wall,
        normalizedColor,
      );
      result.data[offset] = red;
      result.data[offset + 1] = green;
      result.data[offset + 2] = blue;
      if (sourceRed !== red || sourceGreen !== green || sourceBlue !== blue) {
        changedPixels += 1;
      }
      return;
    }

    // On the edge of the shape the pixel is part old colour, part backdrop.
    // Swapping the old colour's share for the new one keeps the drawn edge.
    if (packedBackground !== -1) {
      const seedFraction = seedFractionAt(
        imageData.data,
        pixelIndex,
        packedForeground === -1
          ? target
          : targetFromPackedRgb(packedForeground, target.alpha),
        packedBackground,
      );

      // Off that line an added ramp pixel belongs to something else - a stroke
      // crossing the edge, another shape - and is left exactly as drawn. A
      // pixel selected by the range still has to be painted; it falls through
      // to the mask's geometric edge handling below.
      if (seedFraction === -1 && mask[pixelIndex] !== 1) {
        const crossingShare = wall === null
          ? localTargetShareAt(
            imageData.data,
            imageData.width,
            imageData.height,
            pixelX,
            pixelY,
            target,
            2,
          )
          : null;
        if (crossingShare !== null) {
          result.data[offset] = clampChannel(
            sourceRed + crossingShare * (normalizedColor.r - target.red),
          );
          result.data[offset + 1] = clampChannel(
            sourceGreen + crossingShare * (normalizedColor.g - target.green),
          );
          result.data[offset + 2] = clampChannel(
            sourceBlue + crossingShare * (normalizedColor.b - target.blue),
          );
          if (
            sourceRed !== result.data[offset] ||
            sourceGreen !== result.data[offset + 1] ||
            sourceBlue !== result.data[offset + 2]
          ) {
            changedPixels += 1;
          }
          return;
        }
        return;
      }

      if (seedFraction !== -1) {
        // Written as the blend itself rather than as a nudge to what is there,
        // so no trace of the old colour is left behind at either end of it.
        const backRed = (packedBackground >> 16) & 0xff;
        const backGreen = (packedBackground >> 8) & 0xff;
        const backBlue = packedBackground & 0xff;
        result.data[offset] = clampChannel(
          backRed + seedFraction * (normalizedColor.r - backRed),
        );
        result.data[offset + 1] = clampChannel(
          backGreen + seedFraction * (normalizedColor.g - backGreen),
        );
        result.data[offset + 2] = clampChannel(
          backBlue + seedFraction * (normalizedColor.b - backBlue),
        );
        if (
          sourceRed !== result.data[offset] ||
          sourceGreen !== result.data[offset + 1] ||
          sourceBlue !== result.data[offset + 2]
        ) {
          changedPixels += 1;
        }
        return;
      }
    }

    // On the wall the share of the pixel is already known from the line that
    // drew it, and it is finer than anything the mask's own shape can say.
    const coverage = wallCoverage !== -1 ? wallCoverage : innerEdgeCoverage(
      mask,
      imageData.width,
      imageData.height,
      pixelX,
      pixelY,
      imageData.data,
      pixelIndex,
      target,
      maximumDistanceSquared,
    );
    const canPreserveWhiteAntialiasing =
      !fillingTransparency &&
      sourceAlpha === CHANNEL_MAX &&
      (!normalizedColor.hasExplicitAlpha || normalizedColor.a === CHANNEL_MAX);
    const backgroundWeight = canPreserveWhiteAntialiasing
      ? lightBackgroundWeight(imageData.data, pixelIndex, target)
      : null;

    if (backgroundWeight !== null) {
      // With white and black included, a line has no say of its own. Where the
      // range took in everything around a pixel, its darkest ink too, the pixel
      // is only the colour being replaced. Where the range stops short of that
      // ink, the pixel is its soft edge and is kept over the new colour below.
      if (
        includeWhiteAndBlack &&
        rangeTakesInSurroundings(
          imageData.data,
          mask,
          imageData.width,
          imageData.height,
          pixelX,
          pixelY,
          target,
          maximumDistanceSquared,
        )
      ) {
        result.data[offset] = normalizedColor.r;
        result.data[offset + 1] = normalizedColor.g;
        result.data[offset + 2] = normalizedColor.b;
        result.data[offset + 3] = replacementAlpha;
        if (sourceRed !== normalizedColor.r || sourceGreen !== normalizedColor.g
          || sourceBlue !== normalizedColor.b || sourceAlpha !== replacementAlpha) {
          changedPixels += 1;
        }
        return;
      }

      const targetDistanceSquared = seedDistanceSquaredAt(
        imageData.data,
        pixelIndex,
        target,
      );
      const coverageByPaperFloorOnly =
        targetDistanceSquared > maximumDistanceSquared &&
        targetDistanceSquared <= PAPER_FLOOR_DISTANCE_SQUARED;
      const redCoverage = channelForegroundCoverage(sourceRed, target.red);
      const greenCoverage = channelForegroundCoverage(sourceGreen, target.green);
      const blueCoverage = channelForegroundCoverage(sourceBlue, target.blue);
      const carriesUnevenColour =
        Math.max(redCoverage, greenCoverage, blueCoverage) -
          Math.min(redCoverage, greenCoverage, blueCoverage) > INK_EVEN_SHARE;
      if (
        coverageByPaperFloorOnly &&
        carriesUnevenColour &&
        isFlatColourAt(
          imageData.data,
          imageData.width,
          imageData.height,
          pixelIndex,
        )
      ) {
        return;
      }
      const oldGuideShare =
        wall === null &&
        (coverageByPaperFloorOnly || mask[pixelIndex] !== 1) &&
        carriesUnevenColour
        ? localTargetShareAt(
          imageData.data,
          imageData.width,
          imageData.height,
          pixelX,
          pixelY,
          target,
        )
        : null;
      if (oldGuideShare !== null) {
        result.data[offset] = clampChannel(
          sourceRed + oldGuideShare * (normalizedColor.r - target.red),
        );
        result.data[offset + 1] = clampChannel(
          sourceGreen + oldGuideShare * (normalizedColor.g - target.green),
        );
        result.data[offset + 2] = clampChannel(
          sourceBlue + oldGuideShare * (normalizedColor.b - target.blue),
        );
        if (
          sourceRed !== result.data[offset] ||
          sourceGreen !== result.data[offset + 1] ||
          sourceBlue !== result.data[offset + 2]
        ) {
          changedPixels += 1;
        }
        return;
      }

      // The replacement below is a delta measured against the seed, which
      // assumes the pixel is still background blended with ink. An area an
      // earlier pass already painted breaks that assumption, so a tolerance
      // wide enough to reach it again would apply the same delta twice.
      if (seedDiffersFromFill && carriesFillAlready(sourceRed, sourceGreen, sourceBlue, normalizedColor)) {
        return;
      }

      const inkCoverage = 1 - backgroundWeight;

      // Paper grain a few levels off white carries no ink worth keeping, and it
      // is invisible until the fill amplifies it into a speck. Anything under
      // the floor is background: paint it, do not composite it. A pixel of a
      // face the range took in, or whose deeper neighbour already has this
      // fill, is the same story from the other end - there is no paper left to
      // swap.
      const repaintingFace =
        inkCoverage >= BACKGROUND_NOISE_COVERAGE &&
        facePainted(
          imageData.data,
          mask,
          imageData.width,
          imageData.height,
          pixelX,
          pixelY,
          pixelIndex,
          target,
          normalizedColor,
        );
      if (
        repaintingFace ||
        (coverage === 1 && inkCoverage < BACKGROUND_NOISE_COVERAGE)
      ) {
        result.data[offset] = normalizedColor.r;
        result.data[offset + 1] = normalizedColor.g;
        result.data[offset + 2] = normalizedColor.b;
        result.data[offset + 3] = replacementAlpha;
        if (sourceRed !== normalizedColor.r || sourceGreen !== normalizedColor.g
          || sourceBlue !== normalizedColor.b || sourceAlpha !== replacementAlpha) {
          changedPixels += 1;
        }
        return;
      }

      if (
        coverage === 1 &&
        isolatedSpeck(
          imageData.data,
          imageData.width,
          imageData.height,
          pixelX,
          pixelY,
          target,
          inkCoverage,
        )
      ) {
        result.data[offset] = normalizedColor.r;
        result.data[offset + 1] = normalizedColor.g;
        result.data[offset + 2] = normalizedColor.b;
        result.data[offset + 3] = replacementAlpha;
        changedPixels += 1;
        return;
      }

      // A pixel the line runs through is shared with the fill on the other side
      // of it, and what darkens it is that other fill rather than ink, so its
      // share is the whole story. Wall pixels the line only passes beside are
      // ordinary pixels and keep the ink they carry.
      const replacementWeight = wallCoverage !== -1 && wallCoverage < 1
        ? coverage
        : coverage * backgroundWeight;
      result.data[offset] = clampChannel(
        sourceRed + replacementWeight * (normalizedColor.r - target.red),
      );
      result.data[offset + 1] = clampChannel(
        sourceGreen + replacementWeight * (normalizedColor.g - target.green),
      );
      result.data[offset + 2] = clampChannel(
        sourceBlue + replacementWeight * (normalizedColor.b - target.blue),
      );
    } else if (coverage === 1) {
      result.data[offset] = normalizedColor.r;
      result.data[offset + 1] = normalizedColor.g;
      result.data[offset + 2] = normalizedColor.b;
      result.data[offset + 3] = replacementAlpha;
    } else if (!normalizedColor.hasExplicitAlpha && !fillingTransparency) {
      result.data[offset] = clampChannel(sourceRed * (1 - coverage) + normalizedColor.r * coverage);
      result.data[offset + 1] = clampChannel(sourceGreen * (1 - coverage) + normalizedColor.g * coverage);
      result.data[offset + 2] = clampChannel(sourceBlue * (1 - coverage) + normalizedColor.b * coverage);
    } else {
      const sourceWeight = sourceAlpha * (1 - coverage);
      const replacementWeight = replacementAlpha * coverage;
      const outputAlpha = sourceWeight + replacementWeight;

      if (outputAlpha === 0) {
        result.data[offset] = normalizedColor.r;
        result.data[offset + 1] = normalizedColor.g;
        result.data[offset + 2] = normalizedColor.b;
      } else {
        result.data[offset] = clampChannel(
          (sourceRed * sourceWeight + normalizedColor.r * replacementWeight) / outputAlpha,
        );
        result.data[offset + 1] = clampChannel(
          (sourceGreen * sourceWeight + normalizedColor.g * replacementWeight) / outputAlpha,
        );
        result.data[offset + 2] = clampChannel(
          (sourceBlue * sourceWeight + normalizedColor.b * replacementWeight) / outputAlpha,
        );
      }
      result.data[offset + 3] = clampChannel(outputAlpha);
    }

    if (
      sourceRed !== result.data[offset] ||
      sourceGreen !== result.data[offset + 1] ||
      sourceBlue !== result.data[offset + 2] ||
      sourceAlpha !== result.data[offset + 3]
    ) {
      changedPixels += 1;
    }
  }, true, originalPixel, true, wall, wholePicture, includeWhiteAndBlack);

  if (wall !== null && wall.paper !== null) {
    wall.painted = true;
  }

  result.changedPixels = changedPixels;
  return result;
}

globalThis.ImageOps = Object.freeze({
  WALL_REACH,
  createGuideBarrier,
  isWalledOff,
  eraseContiguousRegion,
  fillContiguousRegion,
  getContiguousRegion,
});
})();
