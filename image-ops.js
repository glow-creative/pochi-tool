(() => {
const CHANNEL_MAX = 255;
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
// A ground a drawing sits on is pale, whether it is the page itself or a panel
// laid over it. Below this a colour is a face of its own.
const PALE_CHANNEL_FLOOR = 200;
// How far past a pixel to look before calling it the start of another flat
// block. A shadow can fall as slowly as a level every pixel or two, so the next
// pixel along says nothing; five of them apart, a slope has clearly moved on
// and a block has clearly not.
const SKIRT_FLAT_REACH = 5;
// Half a pixel is where a line stops being an edge and starts being the line.
// Below this share the pixel is the face's soft edge; above it, it is the
// stroke's own body, and a fill that cannot keep the ink it holds has no
// business taking it.
const INK_CREST_SHARE = 0.5;
// The drawing's own lines. Whatever colour a line is drawn in, none of its
// channels is bright: every one of them is at least three quarters ink. That is
// what tells a stroke apart from a face the user has painted, however dark the
// paint is, and a bucket never spreads into one. Widening the range to reach
// one more face must not cost the drawing the lines it is made of.
const INK_CHANNEL_FLOOR = 0.25;
// A line's own edge is graded the whole way down to nothing, and every step of
// it belongs to the line. Only a share too small to change a single level is
// left alone, so that paper standing beside a line is not dragged in by
// rounding.
const INK_EDGE_FLOOR = 1 / CHANNEL_MAX;
// A stroke lying on white paper dims every channel by the same share, because
// what it hides is white. A pixel that has given up a different share in each
// channel is holding a colour instead, and is a face rather than paper.
const INK_EVEN_SHARE = 0.05;
const SPECK_NEIGHBOUR_RATIO = 0.5;
// Two neighbours this close are a run of one flat colour. The skirt of a stroke
// is a slope, so its pixels never match the pixel past them.
const FLAT_RUN_DISTANCE_SQUARED = 3;
// Gamut clipping can make a tiny, unrelated third colour fit a two-colour
// seam. It must own at least this much of the pixel before that more complex
// explanation may displace an equally accurate, simpler one.
const MIN_MEANINGFUL_MIXTURE_SHARE = 0.04;
// A separate patch of nearly the same colour can first become reachable when
// the tolerance admits a narrow passage of intermediate pixels. Fade that new
// connection over a few slider stops instead of painting the whole patch at
// once.
const EDGE_ENTRY_TRANSITION = 4;
// A pale panel is defined most clearly while the range is still narrow. A
// wider range may also admit a shadow that falls beyond the panel, even though
// that shadow is visually part of the page. Keep the stable panel's bounds
// when they already account for most of an axis.
const PALE_GROUND_SHAPE_TOLERANCE = 2;
const PALE_GROUND_BOUND_EXTENT_RATIO = 0.75;
// How far the fill may reach across paper the range stopped at, to get to the
// stroke behind it. A rim left by grain is a pixel or two wide; a neighbouring
// face is not, so a short reach tells them apart.
const RIM_REACH = 3;
// How far an edge ramp may run, and how far off the line between the flat
// colour and its background a pixel may sit before it stops counting as part
// of that ramp.
const EDGE_RAMP_REACH = 6;
// A screenshot can enlarge one antialiased source pixel into a flat block many
// pixels wide. This longer reach is used only from selected white paper to a
// darker crest; ordinary edge walking keeps its short, local reach above.
const PIXELATED_EDGE_RAMP_REACH = 128;
// How much darker than the pixel beside the area a crest has to be before the
// two are read as the skirt of a stroke rather than one face shading into the
// next. A stroke drawn in any colour is well clear of what it is drawn on.
const EDGE_CREST_DROP = 40;
// How much darker than a pixel the range has just taken in something beside it
// has to be before that pixel reads as the soft edge of a stroke rather than a
// face of its own. Measured from the pixel, which is already part way down the
// slope, so it is far smaller than the drop to a crest above: enough to clear
// paper grain and one step of a shaded face, no more.
const EDGE_SHOULDER_DROP = 16;
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
// How long a run of one colour has to be before it reads as one pixel of the
// drawing shown larger, rather than as a step of ordinary antialiasing.
const ENLARGED_RUN_LENGTH = 10;
// How far the edge blend may look for the colour lying beside the one being
// replaced. A drawing at its own size puts it in the very next pixel, and
// looking past that on a shaded face reads the shading as an edge and streaks
// it, so that is all an ordinary pixel gets.
//
// Past that first pixel the walk may only conclude that this pixel is the
// ground and should be left alone, never that it is part way along an edge.
// Where a range ends inside a flat ground the pixels it took have nothing but
// each other beside them, and the ground they belong to is a few pixels out;
// without the reach they read as no mixture at all and are painted whole, which
// is what tears a boundary into spikes. Letting the same reach hand back a part
// share instead is what streaks a shaded face.
//
// A picture shown larger than it was drawn spreads one antialiased pixel over a
// whole block of one colour, and what it was blended with is that block away.
const EDGE_MIX_REACH = 1;
const EDGE_MIX_FLAT_REACH = 4;
// How long a run of one colour has to be before the blend reads it as one pixel
// of a picture shown larger, and looks across the whole block for what it was
// blended with. Shorter than the run length the rest of the fill uses: a curve
// staggers its blocks, and the ones on the diagonals come out shorter.
const EDGE_MIX_RUN_LENGTH = 4;
const EDGE_MIX_ENLARGED_REACH = 24;
// How far apart those two colours have to be before the share of one in a pixel
// between them can be read at all. Any closer and rounding decides the answer.
const EDGE_MIX_SEPARATION_SQUARED = 24 * 24;
// How far off the line between them a pixel may sit and still read as a mixture
// of the two rather than a colour of its own.
const EDGE_MIX_OFF_LINE_SQUARED = 10 * 10;
// A pixel this near the colour being replaced holds no readable share of
// anything else, and asking costs a walk.
const EDGE_MIX_FLAT_SQUARED = 4 * 4;
// How near two colours have to be for a blended edge to count them as the same
// thing behind it. Looser than the run of one colour the rest of the fill calls
// flat: what an edge fades into is read a pixel at a time along the edge, and a
// drawing's background carries a level or two of grain from one to the next.
const EDGE_BACKDROP_MATCH_SQUARED = 4 * 4;
// The mask value for a pixel taken in only to have its edge blended: it is the
// ramp the drawing lays around an area, which the range itself stopped short of.
const BLENDED_EDGE = 5;
// How far out that ramp may be followed, and how little of the colour being
// replaced a pixel may hold and still count as part of it rather than as the
// ground the ramp fades into.
const BLENDED_EDGE_STEPS = 4;
// The four ways a line can run through a pixel, each taken both ways out of it.
const LINE_WAYS = Object.freeze([[1, 0], [0, 1], [1, 1], [1, -1]]);
// The eight ways out of a pixel. A curve puts an edge diagonally as readily as
// along a row, so a walk looking for what a pixel belongs to takes all of them.
const OUTWARD_STEPS = Object.freeze([
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
]);
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

  if (firstPixel === -1) {
    return firstPixel;
  }

  const { data, width, height } = imageData;
  const firstOffset = firstPixel * 4;
  const maximumDistanceSquared = Math.max(
    toleranceDistanceSquared(tolerance, {
      red: data[firstOffset],
      green: data[firstOffset + 1],
      blue: data[firstOffset + 2],
    }),
    PAPER_FLOOR_DISTANCE_SQUARED,
  );
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

/**
 * The farthest any colour can be from this one. Only the corners of the cube
 * are candidates: each channel is at its most distant at nothing or at full.
 *
 * This is what the range is measured against. Measured against black to white
 * instead, the slider meant something different for every colour clicked: from
 * a saturated red nothing is more than three quarters of that span away, so the
 * top of the slider did nothing at all, while the paper a drawing sits on came
 * out at barely half of it - which is how a range of 52 swallowed the page.
 */
function farthestDistanceSquaredFrom(target) {
  const red = Math.max(target.red, CHANNEL_MAX - target.red);
  const green = Math.max(target.green, CHANNEL_MAX - target.green);
  const blue = Math.max(target.blue, CHANNEL_MAX - target.blue);

  return red * red + green * green + blue * blue;
}

function boundedTolerance(tolerance) {
  const numericTolerance = Number(tolerance);
  return Number.isFinite(numericTolerance)
    ? Math.min(100, Math.max(0, numericTolerance))
    : 0;
}

// Whether the range leaves no colour outside it. Every colour is reachable from
// every other now, so this is the top of the slider and nothing else.
function coversEveryColour(tolerance) {
  return boundedTolerance(tolerance) >= 100;
}

function toleranceDistanceSquared(tolerance, target) {
  const ratio = boundedTolerance(tolerance) / 100;

  return ratio * ratio * farthestDistanceSquaredFrom(target);
}

// Lightness, colourfulness and hue, each on its own scale of 0 to 255 so the
// three read alike, and so the whole of them stays on the scale the range is
// already measured in.
//
// The range then means the same thing on each of them: no further than this in
// lightness, and no further than this in colourfulness, and no further than
// this in hue. A colour has to answer to all three to count as the same one.
//
// Straight RGB distance answers with a single number in which the three are
// already mixed, and mixes them in the wrong proportions: a saturated colour
// and the paper a drawing sits on differ on every one of the three, yet come
// out barely two thirds apart, because most of what separates them is lightness
// and RGB leaves lightness little room.
const OKLAB_CHROMA_LIMIT = 0.3225;
// The paper a drawing sits on is the pole with no colour in it at all, and
// anything carrying colour stands away from that pole by the whole of what it
// carries, faint or strong. So the two colours' own colourfulness is what their
// difference is measured against, not the most a screen can show: a pale mint
// losing all of its green has gone as far from the paper as a saturated red
// has. Measured against the screen's most, the pale one came out barely a
// quarter of the way and a range of 50 swallowed the page.
//
// The added part keeps that honest at the pole itself, where the ratio alone
// would turn the page's own grain into a colour of its own.
const OKLAB_CHROMA_PRESENCE = 0.05;
const colourAxesCache = new Map();
const COLOUR_AXES_CACHE_LIMIT = 1 << 16;

function colourAxes(red, green, blue) {
  const packed = (red << 16) | (green << 8) | blue;
  const held = colourAxesCache.get(packed);
  if (held !== undefined) {
    return held;
  }

  const [lightness, greenRed, blueYellow] = rgbToOklab(red, green, blue);
  const chroma = Math.sqrt(greenRed * greenRed + blueYellow * blueYellow);
  const axes = [
    lightness * CHANNEL_MAX,
    chroma,
    Math.atan2(blueYellow, greenRed),
    chroma / OKLAB_CHROMA_LIMIT,
  ];
  if (colourAxesCache.size >= COLOUR_AXES_CACHE_LIMIT) {
    colourAxesCache.clear();
  }
  colourAxesCache.set(packed, axes);
  return axes;
}

function axisDistanceSquared(here, there) {
  const lightness = Math.abs(here[0] - there[0]);
  const colourfulness = (Math.abs(here[1] - there[1])
    / (Math.max(here[1], there[1]) + OKLAB_CHROMA_PRESENCE)) * CHANNEL_MAX;
  let turn = Math.abs(here[2] - there[2]);
  if (turn > Math.PI) {
    turn = 2 * Math.PI - turn;
  }
  // Hue only means anything as far as both colours have a colour to turn: two
  // near-greys are not opposite merely because rounding put them either side of
  // the wheel.
  const hue = (turn / Math.PI) * Math.min(here[3], there[3]) * CHANNEL_MAX;
  const widest = Math.max(lightness, colourfulness, hue);

  return widest * widest;
}

// Each axis is measured against the whole of itself, so the range means the
// same on all three: at 50, no more than half the way from black to white in
// lightness, no more than half the way from grey to the most colourful a screen
// can show, and no more than half a turn of the colour wheel.
function colourRangeSquaredFor(tolerance) {
  const reach = (boundedTolerance(tolerance) / 100) * CHANNEL_MAX;

  return reach * reach;
}

function isWithinColourRange(data, pixelIndex, target, colourRangeSquared) {
  const offset = pixelIndex * 4;
  // A transparent pixel has no colour to read, and neither has a transparent
  // target. Those are the plain test's to settle.
  if (colourRangeSquared === Infinity || target.alpha === 0 || data[offset + 3] === 0) {
    return true;
  }

  return axisDistanceSquared(
    colourAxes(data[offset], data[offset + 1], data[offset + 2]),
    colourAxes(target.red, target.green, target.blue),
  ) <= colourRangeSquared;
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

function pixelStepDistanceSquared(data, from, to) {
  const there = from * 4;
  const here = to * 4;
  const red = data[here] - data[there];
  const green = data[here + 1] - data[there + 1];
  const blue = data[here + 2] - data[there + 2];
  return red * red + green * green + blue * blue;
}

function toleranceForDistanceSquared(distanceSquared, target) {
  return Math.min(100, Math.max(0, Math.ceil(
    Math.sqrt(distanceSquared / farthestDistanceSquaredFrom(target)) * 100 - 1e-9,
  )));
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
    Math.sqrt(maximumDistanceSquared / farthestDistanceSquaredFrom(target)) * 100;
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
        farthestDistanceSquaredFrom(target),
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

// The two curves between a channel level and the light it stands for. Both are
// looked up rather than worked out below; these stay the one statement of what
// the tables mean, and the only place either curve is written down.
function curvedLight(channel) {
  const encoded = channel / CHANNEL_MAX;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function curvedChannel(light) {
  const held = Math.min(1, Math.max(0, light));
  const encoded = held <= 0.0031308
    ? held * 12.92
    : 1.055 * held ** (1 / 2.4) - 0.055;
  return clampChannel(encoded * CHANNEL_MAX);
}

// Every caller hands the light of a whole channel level, and there are only so
// many of those.
const LINEAR_LIGHT_LEVELS = new Float64Array(CHANNEL_MAX + 1);
for (let level = 0; level <= CHANNEL_MAX; level += 1) {
  LINEAR_LIGHT_LEVELS[level] = curvedLight(level);
}

function channelToLinearLight(channel) {
  const level = LINEAR_LIGHT_LEVELS[channel];
  return level === undefined ? curvedLight(channel) : level;
}

// Where each channel level begins, in light. Going back the other way was the
// last place the mixture search raised a power, and it is only ever asked which
// of two hundred and fifty-six levels a light value lands on. Each edge is
// walked to the exact double at which the curve itself changes its answer, so
// the lookup and the curve agree to the last bit.
const LEVEL_FIRST_LIGHT = new Float64Array(CHANNEL_MAX + 1);
{
  const pattern = new BigInt64Array(1);
  const asNumber = new Float64Array(pattern.buffer);
  const neighbouring = (value, direction) => {
    asNumber[0] = value;
    pattern[0] += BigInt(direction);
    return asNumber[0];
  };
  for (let level = 1; level <= CHANNEL_MAX; level += 1) {
    let edge = curvedLight(level - 0.5);
    while (curvedChannel(edge) < level) {
      edge = neighbouring(edge, 1);
    }
    while (edge > 0 && curvedChannel(neighbouring(edge, -1)) >= level) {
      edge = neighbouring(edge, -1);
    }
    LEVEL_FIRST_LIGHT[level] = edge;
  }
}

// Halving the range to find the level still took eight comparisons a channel,
// three channels deep inside the search. The square root of a light value rises
// smoothly enough across the levels that a coarse table of it lands on the level
// below the answer, or on the answer itself, leaving a step or two to walk.
const LEVEL_INDEX_STEPS = 1 << 12;
const LEVEL_AT_INDEX = new Uint8Array(LEVEL_INDEX_STEPS + 1);
{
  const levelAtOrBelow = (light) => {
    let level = 1;
    let highest = CHANNEL_MAX;
    while (level < highest) {
      const middle = (level + highest + 1) >> 1;
      if (light >= LEVEL_FIRST_LIGHT[middle]) {
        level = middle;
      } else {
        highest = middle - 1;
      }
    }
    return light < LEVEL_FIRST_LIGHT[1] ? 0 : level;
  };
  for (let index = 0; index <= LEVEL_INDEX_STEPS; index += 1) {
    const root = index / LEVEL_INDEX_STEPS;
    LEVEL_AT_INDEX[index] = levelAtOrBelow(root * root);
  }
}

function channelFromLinearLight(channel) {
  // Anything that is not a light level at all - below zero, or no number -
  // keeps whatever the curve itself says about it.
  if (!(channel >= LEVEL_FIRST_LIGHT[1])) {
    return channel >= 0 ? 0 : curvedChannel(channel);
  }
  if (channel >= 1) {
    return CHANNEL_MAX;
  }
  let level = LEVEL_AT_INDEX[Math.sqrt(channel) * LEVEL_INDEX_STEPS | 0];
  while (level < CHANNEL_MAX && channel >= LEVEL_FIRST_LIGHT[level + 1]) {
    level += 1;
  }
  return level;
}

// Both conversions come in two forms: one that writes into an array handed to
// it, for the mixture search that runs tens of millions of times and cannot
// afford an array per colour, and the plain one everywhere else.
function rgbToOklabInto(red, green, blue, out) {
  const linearRed = channelToLinearLight(red);
  const linearGreen = channelToLinearLight(green);
  const linearBlue = channelToLinearLight(blue);
  const long = Math.cbrt(
    0.4122214708 * linearRed +
    0.5363325363 * linearGreen +
    0.0514459929 * linearBlue,
  );
  const medium = Math.cbrt(
    0.2119034982 * linearRed +
    0.6806995451 * linearGreen +
    0.1073969566 * linearBlue,
  );
  const short = Math.cbrt(
    0.0883024619 * linearRed +
    0.2817188376 * linearGreen +
    0.6299787005 * linearBlue,
  );
  out[0] = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  out[1] = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  out[2] = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;
  return out;
}

function rgbToOklab(red, green, blue) {
  return rgbToOklabInto(red, green, blue, [0, 0, 0]);
}

function oklabToRgbInto(lightness, greenRed, blueYellow, out) {
  const longRoot = lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow;
  const mediumRoot = lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow;
  const shortRoot = lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow;
  const long = longRoot * longRoot * longRoot;
  const medium = mediumRoot * mediumRoot * mediumRoot;
  const short = shortRoot * shortRoot * shortRoot;
  out[0] = channelFromLinearLight(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short);
  out[1] = channelFromLinearLight(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short);
  out[2] = channelFromLinearLight(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short);
  return out;
}

function oklabToRgb(lightness, greenRed, blueYellow) {
  return oklabToRgbInto(lightness, greenRed, blueYellow, [0, 0, 0]);
}

function replaceOklabShare(source, replacement, fill, share) {
  const sourceLab = rgbToOklab(...source);
  const replacementLab = rgbToOklab(...replacement);
  const fillLab = rgbToOklab(...fill);
  return oklabToRgb(...sourceLab.map(
    (level, channel) => level + share * (fillLab[channel] - replacementLab[channel]),
  ));
}

function replaceSolvedOklabShare(solved, replacement, fill) {
  const replacementLab = rgbToOklab(...replacement);
  const fillLab = rgbToOklab(...fill);
  return oklabToRgb(...solved.channels.map(
    (level, channel) => level + solved.share * (fillLab[channel] - replacementLab[channel]),
  ));
}

function projectMixtureWeights(weights) {
  const ordered = [...weights].sort((first, second) => second - first);
  let total = 0;
  let lastPositive = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    total += ordered[index];
    if (ordered[index] - (total - 1) / (index + 1) > 0) {
      lastPositive = index;
    }
  }
  const threshold = (
    ordered.slice(0, lastPositive + 1).reduce((sum, weight) => sum + weight, 0) - 1
  ) / (lastPositive + 1);
  return weights.map((weight) => Math.max(0, weight - threshold));
}

function fittedOklabMixture(source, components, startingWeights) {
  const count = components.length;
  const sourceLab = rgbToOklab(source.red, source.green, source.blue);
  // A page-sized fill runs the search below tens of millions of times, so it is
  // written with plain loops over buffers it reuses rather than the shorter
  // array form it began as: the arrays a single step allocated, and the hop to
  // a colour held in an array of its own, cost more than all the colour maths
  // in it. `mixed` holds the blend the last measurement was taken of, for
  // whichever weights turn out to be worth keeping.
  const componentLabs = [];
  for (let index = 0; index < count; index += 1) {
    const colour = components[index];
    const lab = rgbToOklab(colour.red, colour.green, colour.blue);
    componentLabs.push(lab[0], lab[1], lab[2]);
  }

  const mixed = [0, 0, 0];
  const shown = [0, 0, 0];
  const shownLab = [0, 0, 0];
  const errorOf = (weights) => {
    let lightness = 0;
    let greenRed = 0;
    let blueYellow = 0;
    for (let index = 0; index < count; index += 1) {
      const weight = weights[index];
      lightness += weight * componentLabs[index * 3];
      greenRed += weight * componentLabs[index * 3 + 1];
      blueYellow += weight * componentLabs[index * 3 + 2];
    }
    mixed[0] = lightness;
    mixed[1] = greenRed;
    mixed[2] = blueYellow;
    oklabToRgbInto(lightness, greenRed, blueYellow, shown);
    rgbToOklabInto(shown[0], shown[1], shown[2], shownLab);
    let error = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const apart = (shownLab[channel] - sourceLab[channel]) * CHANNEL_MAX;
      error += apart * apart;
    }
    return error;
  };

  // The closed-form answer, the even blend, and each colour on its own. Two of
  // these coincide often enough to be worth noticing: walking the same descent
  // twice cannot find anything the first walk did not.
  const starts = [
    projectMixtureWeights(startingWeights),
    components.map(() => 1 / count),
    ...components.map((_, chosen) => components.map((__, index) => (
      index === chosen ? 1 : 0
    ))),
  ];
  const held = new Array(count);
  const tried = new Array(count);
  const heldChannels = [0, 0, 0];
  const bestWeights = new Array(count);
  const bestChannels = [0, 0, 0];
  let bestError = 0;
  let found = false;

  for (let which = 0; which < starts.length; which += 1) {
    const start = starts[which];
    let walked = false;
    for (let earlier = 0; earlier < which && !walked; earlier += 1) {
      const before = starts[earlier];
      walked = true;
      for (let index = 0; index < count; index += 1) {
        if (before[index] !== start[index]) {
          walked = false;
          break;
        }
      }
    }
    if (walked) {
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      held[index] = start[index];
    }
    let heldError = errorOf(held);
    for (let channel = 0; channel < 3; channel += 1) {
      heldChannels[channel] = mixed[channel];
    }
    for (let step = 0.25; step >= 1 / 256; step /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (let from = 0; from < count; from += 1) {
          if (held[from] + 1e-9 < step) continue;
          for (let to = 0; to < count; to += 1) {
            if (to === from) continue;
            for (let index = 0; index < count; index += 1) {
              tried[index] = held[index];
            }
            tried[from] -= step;
            tried[to] += step;
            const error = errorOf(tried);
            if (
              error < heldError - 1e-6 ||
              (Math.abs(error - heldError) <= 1e-6 && tried[0] < held[0])
            ) {
              for (let index = 0; index < count; index += 1) {
                held[index] = tried[index];
              }
              for (let channel = 0; channel < 3; channel += 1) {
                heldChannels[channel] = mixed[channel];
              }
              heldError = error;
              improved = true;
            }
          }
        }
      }
    }
    if (
      !found ||
      heldError < bestError - 1e-6 ||
      (Math.abs(heldError - bestError) <= 1e-6 && held[0] < bestWeights[0])
    ) {
      for (let index = 0; index < count; index += 1) {
        bestWeights[index] = held[index];
      }
      for (let channel = 0; channel < 3; channel += 1) {
        bestChannels[channel] = heldChannels[channel];
      }
      bestError = heldError;
      found = true;
    }
  }
  return { weights: bestWeights.slice(), channels: bestChannels.slice(), error: bestError };
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

// Whether the colour being replaced is one of the drawing's own lines. The
// paper grain a fill ignores and the faint end of a line's edge read alike -
// both hold very little of the colour being replaced - and only the colour
// itself tells them apart. Painting a line, a pixel holding a little of it is
// that line's edge and is owed the new colour in the same proportion; painting
// a face, the same reading is grain in the page and is left as it was drawn.
function isInkTarget(target) {
  return (
    Math.max(target.red, target.green, target.blue) <= INK_CHANNEL_FLOOR * CHANNEL_MAX
  );
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
  if (maximumDistanceSquared >= farthestDistanceSquaredFrom(target)) {
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

// Whether the clicked colour is a plain pale ground - a page, or a panel laid
// on one - rather than a colour of its own. What is drawn on such a ground
// casts its edges into it, and those edges belong to the ground: that is what
// lets a fill walk down an antialiased skirt and stop on the crest of a stroke.
// A darker colour is a face in its own right, and its neighbours' edges are not
// its to absorb.
function isPaleBackground(target) {
  return (
    target.alpha === CHANNEL_MAX &&
    Math.min(target.red, target.green, target.blue) >= PALE_CHANNEL_FLOOR
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

function hasFlatCompanion(data, width, height, pixelIndex) {
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  for (let y = Math.max(0, pixelY - 1); y <= Math.min(height - 1, pixelY + 1); y += 1) {
    for (let x = Math.max(0, pixelX - 1); x <= Math.min(width - 1, pixelX + 1); x += 1) {
      const neighbor = y * width + x;
      if (
        neighbor !== pixelIndex &&
        data[neighbor * 4 + 3] === data[pixelIndex * 4 + 3] &&
        startsFlatRun(data, pixelIndex, neighbor)
      ) {
        return true;
      }
    }
  }
  return false;
}

// An outline the drawing came with, as against paint laid down since. Nothing
// in the pixels themselves can tell those apart - a saturated colour standing
// on the paper looks the same whether the drawing put it there or a fill did -
// so the picture as it was opened is what answers it.
//
// The floor in isLightStrokeCore below refuses any colour with one low channel,
// which is how ink is recognised, and an orange is refused by the same test for
// having little blue. Here the refusal is by lightness, which is what makes ink
// ink, and the opened picture keeps paint from passing for a drawing.
function isColouredOutlineCore(data, openedPaper, width, height, pixelIndex, target) {
  if (openedPaper === null) {
    return false;
  }

  const offset = pixelIndex * 4;
  if (
    openedPaper[offset] !== data[offset] ||
    openedPaper[offset + 1] !== data[offset + 1] ||
    openedPaper[offset + 2] !== data[offset + 2] ||
    data[offset + 3] !== target.alpha ||
    lightnessAt(data, pixelIndex) <= INK_CHANNEL_FLOOR * CHANNEL_MAX
  ) {
    return false;
  }

  const ownCoverage = Math.max(
    target.red - data[offset],
    target.green - data[offset + 1],
    target.blue - data[offset + 2],
  );

  return ownCoverage / CHANNEL_MAX >= BACKGROUND_NOISE_COVERAGE
    && hasFlatCompanion(data, width, height, pixelIndex);
}

function isOutlineCore(data, openedPaper, width, height, pixelIndex, target) {
  return isLightStrokeCore(data, width, height, pixelIndex, target)
    || isColouredOutlineCore(data, openedPaper, width, height, pixelIndex, target);
}

function isLightStrokeCore(data, width, height, pixelIndex, target) {
  const offset = pixelIndex * 4;
  const ownCoverage = Math.max(
    target.red - data[offset],
    target.green - data[offset + 1],
    target.blue - data[offset + 2],
  );
  if (
    data[offset + 3] !== target.alpha ||
    Math.min(data[offset], data[offset + 1], data[offset + 2]) <=
      INK_CHANNEL_FLOOR * CHANNEL_MAX ||
    ownCoverage / CHANNEL_MAX < BACKGROUND_NOISE_COVERAGE ||
    !hasFlatCompanion(data, width, height, pixelIndex)
  ) {
    return false;
  }

  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  for (let y = Math.max(0, pixelY - 1); y <= Math.min(height - 1, pixelY + 1); y += 1) {
    for (let x = Math.max(0, pixelX - 1); x <= Math.min(width - 1, pixelX + 1); x += 1) {
      const neighborOffset = (y * width + x) * 4;
      if (
        Math.max(
          target.red - data[neighborOffset],
          target.green - data[neighborOffset + 1],
          target.blue - data[neighborOffset + 2],
        ) > ownCoverage
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasNearbyLightStrokeCore(data, width, height, pixelIndex, target) {
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  for (let y = Math.max(0, pixelY - 1); y <= Math.min(height - 1, pixelY + 1); y += 1) {
    for (let x = Math.max(0, pixelX - 1); x <= Math.min(width - 1, pixelX + 1); x += 1) {
      if (isLightStrokeCore(data, width, height, y * width + x, target)) {
        return true;
      }
    }
  }
  return false;
}

// How much of a pale outline's own colour this pixel holds, or -1 where no such
// outline lies within the ordinary local reach of it. With a mask given, only
// an outline the region has not taken counts.
function lightStrokeShareAt(data, width, height, pixelIndex, target, mask = null, openedPaper = null) {
  if (!isWhiteBackground(target)) {
    return -1;
  }
  const offset = pixelIndex * 4;
  const sourceAwayFromPaper = [
    target.red - data[offset],
    target.green - data[offset + 1],
    target.blue - data[offset + 2],
  ];
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  let deepestLength = 0;
  let foregroundShare = -1;

  // A pale solid outline is not a faint black line. Find its repeated local
  // core and replace only the white share around it; the core itself then stays
  // the colour it was drawn, even where a curve puts its pixels diagonally.
  const left = Math.max(0, pixelX - EDGE_RAMP_REACH);
  const right = Math.min(width - 1, pixelX + EDGE_RAMP_REACH);
  const top = Math.max(0, pixelY - EDGE_RAMP_REACH);
  const bottom = Math.min(height - 1, pixelY + EDGE_RAMP_REACH);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const candidate = y * width + x;
      const candidateOffset = candidate * 4;
      if (
        (mask !== null && mask[candidate] !== 0) ||
        !isOutlineCore(data, openedPaper, width, height, candidate, target)
      ) {
        continue;
      }

      const candidateAwayFromPaper = [
        target.red - data[candidateOffset],
        target.green - data[candidateOffset + 1],
        target.blue - data[candidateOffset + 2],
      ];
      const lengthSquared = candidateAwayFromPaper.reduce(
        (sum, channel) => sum + channel * channel,
        0,
      );
      if (
        lengthSquared <= deepestLength ||
        Math.max(...candidateAwayFromPaper) / CHANNEL_MAX < BACKGROUND_NOISE_COVERAGE
      ) {
        continue;
      }

      const share = sourceAwayFromPaper.reduce(
        (sum, channel, index) => sum + channel * candidateAwayFromPaper[index],
        0,
      ) / lengthSquared;
      if (share < 0 || share > 1) {
        continue;
      }
      const error = sourceAwayFromPaper.reduce(
        (sum, channel, index) => (
          sum + (channel - share * candidateAwayFromPaper[index]) ** 2
        ),
        0,
      );
      if (error > FLAT_RUN_DISTANCE_SQUARED) {
        continue;
      }

      deepestLength = lengthSquared;
      foregroundShare = share;
    }
  }

  return foregroundShare;
}

// How much of a pale outline beside this pixel the pixel itself holds, or -1
// where it holds none. The outline is found by walking out until the picture
// stops getting darker, which reaches across the long flat runs a picture shown
// larger than it was drawn puts between a skirt and the outline it belongs to.
// Only an outline the region has not taken counts: once the range reaches the
// outline itself, there is no outline left beside the face.
function outlineSkirtShareAt(data, mask, width, height, pixelIndex, target, openedPaper = null) {
  if (!isWhiteBackground(target)) {
    return -1;
  }

  // An outline stands on the paper, and a skirt is where the two meet, so going
  // up the slope from this pixel has to arrive at the paper. Without that, what
  // stands beside it is another face of the drawing: the grain across a face
  // makes a darkest pixel of its own, and every pixel around that one reads as
  // a share of it, which would leave a wide range picking a whole face apart.
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  let reachesPaper = false;
  for (const [stepX, stepY] of OUTWARD_STEPS) {
    let lightest = lightnessAt(data, pixelIndex);
    for (let step = 1; step <= PIXELATED_EDGE_RAMP_REACH && !reachesPaper; step += 1) {
      const nearbyX = pixelX + stepX * step;
      const nearbyY = pixelY + stepY * step;
      if (nearbyX < 0 || nearbyY < 0 || nearbyX >= width || nearbyY >= height) {
        break;
      }
      const nearby = nearbyY * width + nearbyX;
      const level = lightnessAt(data, nearby);
      if (level < lightest) {
        break;
      }
      lightest = level;
      reachesPaper = isWithinTolerance(
        data, nearby, target, PAPER_FLOOR_DISTANCE_SQUARED,
      );
    }
    if (reachesPaper) {
      break;
    }
  }
  if (!reachesPaper) {
    return -1;
  }

  // An outline within the ordinary local reach answers directly, and a curve
  // puts its pixels diagonally where walking straight out finds nothing.
  const nearby = lightStrokeShareAt(data, width, height, pixelIndex, target, mask, openedPaper);
  if (nearby !== -1) {
    return nearby;
  }
  const offset = pixelIndex * 4;
  const awayFromPaper = [
    target.red - data[offset],
    target.green - data[offset + 1],
    target.blue - data[offset + 2],
  ];
  let deepestLength = 0;
  let share = -1;

  for (const [stepX, stepY] of OUTWARD_STEPS) {
    let darkest = lightnessAt(data, pixelIndex);
    let core = -1;
    for (let step = 1; step <= PIXELATED_EDGE_RAMP_REACH; step += 1) {
      const nearbyX = pixelX + stepX * step;
      const nearbyY = pixelY + stepY * step;
      if (nearbyX < 0 || nearbyY < 0 || nearbyX >= width || nearbyY >= height) {
        break;
      }
      const nearby = nearbyY * width + nearbyX;
      if (data[nearby * 4 + 3] !== target.alpha) {
        break;
      }
      const level = lightnessAt(data, nearby);
      if (level > darkest) {
        break;
      }
      if (level < darkest) {
        darkest = level;
        core = nearby;
      }
    }
    if (
      core === -1 ||
      mask[core] !== 0 ||
      !isOutlineCore(data, openedPaper, width, height, core, target)
    ) {
      continue;
    }

    const coreOffset = core * 4;
    const coreAwayFromPaper = [
      target.red - data[coreOffset],
      target.green - data[coreOffset + 1],
      target.blue - data[coreOffset + 2],
    ];
    const lengthSquared = coreAwayFromPaper.reduce(
      (sum, channel) => sum + channel * channel,
      0,
    );
    if (lengthSquared <= deepestLength) {
      continue;
    }
    const along = awayFromPaper.reduce(
      (sum, channel, index) => sum + channel * coreAwayFromPaper[index],
      0,
    ) / lengthSquared;
    if (along < 0 || along > 1) {
      continue;
    }
    const error = awayFromPaper.reduce(
      (sum, channel, index) => (
        sum + (channel - along * coreAwayFromPaper[index]) ** 2
      ),
      0,
    );
    if (error > FLAT_RUN_DISTANCE_SQUARED) {
      continue;
    }
    deepestLength = lengthSquared;
    share = along;
  }
  return share;
}

function lightBackgroundWeight(
  data,
  width,
  height,
  pixelIndex,
  target,
  seekLightStroke,
) {
  if (!isWhiteBackground(target)) {
    return null;
  }

  const offset = pixelIndex * 4;
  const foregroundCoverage = Math.max(
    target.red - data[offset],
    target.green - data[offset + 1],
    target.blue - data[offset + 2],
  ) / CHANNEL_MAX;
  const blackStrokeWeight = 1 - foregroundCoverage;

  // Range-selected pixels keep the established interpretation. Recover a pale
  // local core only for pixels added by edge repair; otherwise a flat colour
  // deliberately included by a wider range could be mistaken for an outline.
  if (!seekLightStroke) {
    return blackStrokeWeight;
  }
  const share = lightStrokeShareAt(data, width, height, pixelIndex, target);
  return share === -1 ? blackStrokeWeight : 1 - share;
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

// Whether this pixel belongs to something the picture actually draws, rather
// than being a speck or a step of a shading that happens to hold its colour.
// A face carries its colour on all round; a line drawn a single pixel wide does
// not, but its colour runs straight through the pixel and out the other side,
// which is what a line is. Anything answering to neither is not something to
// read an edge against.
function standsInLineOrFace(data, width, height, pixelIndex) {
  if (isFlatColourAt(data, width, height, pixelIndex)) {
    return true;
  }
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  const alpha = data[pixelIndex * 4 + 3];
  for (const [stepX, stepY] of LINE_WAYS) {
    let ends = 0;
    for (const way of [1, -1]) {
      const atX = pixelX + stepX * way;
      const atY = pixelY + stepY * way;
      if (atX < 0 || atY < 0 || atX >= width || atY >= height) {
        break;
      }
      const neighbour = atY * width + atX;
      if (data[neighbour * 4 + 3] !== alpha || !startsFlatRun(data, pixelIndex, neighbour)) {
        break;
      }
      ends += 1;
    }
    if (ends === 2) {
      return true;
    }
  }
  return false;
}

// Whether a line stands close enough to this pixel to stop a ramp stepping on
// to it. Asking only whether the line covers the pixel is not enough here: the
// ramp steps on the diagonal as well, and can pass the corner of a line one
// pixel wide. The wall records a pixel further out than it shuts off for
// exactly this - a line too far to cut a pixel can still be near enough to
// stand in the way of leaving it.
function wallStandsBeside(barrier, pixelIndex) {
  return barrier !== null && barrier.reach[pixelIndex] !== 0;
}

// With the edges blended, the ramp a drawing lays around an area belongs to
// that area's edge even where the range stopped short of it. Taking those
// pixels in lets each give up its own share of the colour being replaced. Left
// out, the area is repainted and its ramp keeps the old colour, which reads as
// a hard step with a fringe of the old colour standing outside it.
//
// The walk goes outwards from the region a few pixels at a time and stops where
// the ramp has faded into the ground: a pixel holding less of the old colour
// than the paper grain the fill already ignores is that ground, not the ramp.
function collectBlendedEdge(data, width, height, region, target, barrier) {
  const { mask } = region;
  const faintestWorthTaking = isInkTarget(target)
    ? INK_EDGE_FLOOR
    : BACKGROUND_NOISE_COVERAGE;
  // The ramp is the fill's own edge, so it sets out only from pixels that
  // carry the colour being replaced: the ones the range chose, and the ones an
  // edge repair added that still hold a share of it. A repair can reach across
  // paper to the next stroke along, and a ramp started from that paper walks
  // on into a stroke the press never touched.
  const carriesTheColour = (pixelIndex) => (
    mask[pixelIndex] === 1 ||
    edgeMixtureShareAt(data, mask, width, height, pixelIndex, target) >= faintestWorthTaking
  );
  let frontier = [];
  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (mask[pixelIndex] !== 0 && carriesTheColour(pixelIndex)) {
      frontier.push(pixelIndex);
    }
  });

  // Which colour the edge fades into is settled on the first step away from the
  // region, and the rest of that walk has to agree with it. Asked afresh and
  // alone at each pixel, the reading finds whatever nearby colour best explains
  // where the walk has got to, and out on flat ground there is always one: any
  // flat colour reads as a faint mixture of itself with whatever lies beyond,
  // so the walk keeps finding an edge and spreads over the background.
  const found = { against: -1 };
  // The colour each pixel of the frontier was read against, and the share of
  // the old colour it was found to hold. Both are empty on the first step out,
  // where neither is settled yet.
  let readAgainst = new Map();
  let shareHeld = new Map();

  for (let step = 0; step < BLENDED_EDGE_STEPS && frontier.length > 0; step += 1) {
    const taken = new Map();
    const takenShare = new Map();
    for (const pixelIndex of frontier) {
      // Nor does the ramp set out from the band along a line. A pixel the line
      // passes near is already shared with whatever is on the other side of
      // it, and stepping on from there is stepping across.
      if (wallStandsBeside(barrier, pixelIndex)) {
        continue;
      }
      const against = readAgainst.get(pixelIndex) ?? -1;
      // Nothing settled yet leaves the first step out free to hold as much of
      // the old colour as it does.
      const roomLeft = shareHeld.get(pixelIndex) ?? 1;
      const pixelX = pixelIndex % width;
      const pixelY = (pixelIndex - pixelX) / width;
      for (const [stepX, stepY] of OUTWARD_STEPS) {
        const atX = pixelX + stepX;
        const atY = pixelY + stepY;
        if (atX < 0 || atY < 0 || atX >= width || atY >= height) {
          continue;
        }
        const beside = atY * width + atX;
        // A guide line is the boundary the user drew. The ramp stops at it like
        // everything else, whatever the colours on the far side look like.
        if (
          mask[beside] !== 0 ||
          taken.has(beside) ||
          wallStandsBeside(barrier, beside)
        ) {
          continue;
        }
        const share = edgeMixtureShareAt(data, mask, width, height, beside, target, found);
        if (share < faintestWorthTaking || share >= 1) {
          continue;
        }
        // A pixel read against some other colour is the start of a different
        // edge, or none at all. Either way it is not further along this one.
        if (against !== -1 && !holdsSameBackdrop(data, found.against, against)) {
          continue;
        }
        // Going outwards an edge only gives the old colour up. A pixel holding
        // more of it than the one it was reached from is not the next step of
        // the same edge. An equal share passes, so a picture shown larger than
        // it was drawn keeps its blocks of one colour whole.
        if (share > roomLeft) {
          continue;
        }
        taken.set(beside, against === -1 ? found.against : against);
        takenShare.set(beside, share);
      }
    }
    for (const pixelIndex of taken.keys()) {
      mask[pixelIndex] = BLENDED_EDGE;
      recordSpan(region.spans, pixelIndex, 1);
    }
    frontier = Array.from(taken.keys());
    readAgainst = taken;
    shareHeld = takenShare;
  }
}

// Whether two pixels hold near enough the same colour for a blended edge to
// treat them as the one thing it is fading into.
function holdsSameBackdrop(data, pixelIndex, otherIndex) {
  const offset = pixelIndex * 4;
  const otherOffset = otherIndex * 4;
  const red = data[offset] - data[otherOffset];
  const green = data[offset + 1] - data[otherOffset + 1];
  const blue = data[offset + 2] - data[otherOffset + 2];
  return red * red + green * green + blue * blue <= EDGE_BACKDROP_MATCH_SQUARED;
}

/**
 * The share of the colour being replaced held by a pixel sitting between it and
 * a colour the range left alone, or -1 where the pixel is not such a mixture.
 *
 * Every edge a drawing tool lays down is a row of these mixtures. Taking them
 * whole is what turns a drawn curve into a staircase; replacing only the share
 * inside each one leaves the edge as soft as it was drawn, in the new colour.
 *
 * The colour beside the edge is read from the nearest pixel the range left
 * alone that is flat - one of a run of its own colour. A step of the edge is
 * not flat, so the walk passes over the ramp and reaches what it fades into.
 */
function edgeMixtureShareAt(data, mask, width, height, pixelIndex, target, report = null) {
  if (report !== null) {
    report.against = -1;
  }
  const offset = pixelIndex * 4;
  if (data[offset + 3] !== CHANNEL_MAX) {
    return -1;
  }
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const fromTarget = (red - target.red) * (red - target.red)
    + (green - target.green) * (green - target.green)
    + (blue - target.blue) * (blue - target.blue);
  if (fromTarget <= EDGE_MIX_FLAT_SQUARED) {
    return -1;
  }

  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  // Outwards along each of the eight ways, stopping on each at the first flat
  // colour the range left alone. An edge is locally straight, so the colour it
  // fades into lies along one of them; a picture shown larger than it was drawn
  // puts a whole block of the drawing in the way first, which is what the reach
  // is for. The nearest of the eight answers, being the one across the edge
  // rather than along it.
  const enlarged = belongsToFlatRun(data, width, height, pixelIndex, true, EDGE_MIX_RUN_LENGTH);
  const reach = enlarged ? EDGE_MIX_ENLARGED_REACH : EDGE_MIX_FLAT_REACH;
  let closestToTheLine = EDGE_MIX_OFF_LINE_SQUARED;
  let share = -1;

  // Each candidate is the first flat colour the range left alone on the way
  // out. Past the first pixel the walk may only find that this one is the
  // ground: the same reach allowed to hand back a part share puts a soft halo
  // around every speck, and a walk that goes further in eight directions than
  // in the gaps between them turns that halo into a star.
  const consider = (candidate, step) => {
    const candidateOffset = candidate * 4;
    if (
      mask[candidate] !== 0 ||
      data[candidateOffset + 3] !== CHANNEL_MAX ||
      !standsInLineOrFace(data, width, height, candidate)
    ) {
      return false;
    }

    const towardsTarget = [
      target.red - data[candidateOffset],
      target.green - data[candidateOffset + 1],
      target.blue - data[candidateOffset + 2],
    ];
    const separation = towardsTarget[0] * towardsTarget[0]
      + towardsTarget[1] * towardsTarget[1]
      + towardsTarget[2] * towardsTarget[2];
    if (separation < EDGE_MIX_SEPARATION_SQUARED) {
      return true;
    }

    const projected = ((red - data[candidateOffset]) * towardsTarget[0]
      + (green - data[candidateOffset + 1]) * towardsTarget[1]
      + (blue - data[candidateOffset + 2]) * towardsTarget[2]) / separation;
    const along = Math.min(1, Math.max(0, projected));
    if (1 - along < BACKGROUND_NOISE_COVERAGE) {
      return true;
    }
    if (!enlarged && step > EDGE_MIX_REACH && along >= BACKGROUND_NOISE_COVERAGE) {
      return true;
    }

    const offLine = [red, green, blue].reduce((sum, channel, index) => {
      const onTheLine = data[candidateOffset + index] + along * towardsTarget[index];
      return sum + (channel - onTheLine) * (channel - onTheLine);
    }, 0);
    if (offLine <= EDGE_MIX_OFF_LINE_SQUARED && offLine < closestToTheLine) {
      closestToTheLine = offLine;
      share = along;
      if (report !== null) {
        report.against = candidate;
      }
    }
    return true;
  };

  // A picture shown larger than it was drawn puts a whole block of one colour
  // in the way, and an edge is locally straight, so there the walk goes out
  // along the eight ways and takes the nearest answer. Everywhere else it goes
  // ring by ring, which reaches every direction alike.
  if (enlarged) {
    let nearest = reach + 1;
    for (const [stepX, stepY] of OUTWARD_STEPS) {
      for (let step = 1; step <= nearest; step += 1) {
        const atX = pixelX + stepX * step;
        const atY = pixelY + stepY * step;
        if (atX < 0 || atY < 0 || atX >= width || atY >= height) {
          break;
        }
        const along = atY * width + atX;
        // The walk is crossing this pixel's own block to reach what the drawing
        // blended it with. Once it is out of the block it has arrived, and
        // whatever lies further is another part of the picture: walking on to
        // it lets one ray in eight find a colour the other seven never see,
        // and leaves a star of unpainted pixels behind.
        if (startsFlatRun(data, pixelIndex, along)) {
          continue;
        }
        const before = share;
        if (consider(along, step) && share !== before) {
          nearest = step;
        }
        break;
      }
    }
    return share;
  }

  for (let step = 1; step <= reach; step += 1) {
    const left = Math.max(0, pixelX - step);
    const right = Math.min(width - 1, pixelX + step);
    const top = Math.max(0, pixelY - step);
    const bottom = Math.min(height - 1, pixelY + step);
    let answered = false;
    for (let y = top; y <= bottom; y += 1) {
      const alongTheRing = Math.abs(y - pixelY) === step;
      for (let x = left; x <= right; x += 1) {
        if (!alongTheRing && Math.abs(x - pixelX) !== step) {
          continue;
        }
        if (consider(y * width + x, step)) {
          answered = true;
        }
      }
    }
    if (answered) {
      return share;
    }
  }
  return share;
}

// Guide seams are composed in OKLab. Solve their stored mixtures in the same
// space; encoded RGB would infer the wrong face share from a perceptual blend.
function solveMixtureShare(source, target, others) {
  const count = others.length;
  const targetChannels = rgbToOklab(target.red, target.green, target.blue)
    .map((channel) => channel * CHANNEL_MAX);
  const sourceChannels = rgbToOklab(source.red, source.green, source.blue)
    .map((channel) => channel * CHANNEL_MAX);
  const vectors = others.map((colour) => {
    const channels = rgbToOklab(colour.red, colour.green, colour.blue)
      .map((channel) => channel * CHANNEL_MAX);
    return channels.map((channel, index) => channel - targetChannels[index]);
  });
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
  // A perceptual blend can briefly leave the sRGB gamut before it is displayed.
  // Once a channel is clipped, solving only the displayed OKLab value can give
  // the wrong face the missing share. Fit the forward, clipped result instead;
  // among equally good fits prefer less of the clicked face so a neighbouring
  // seam is never eaten on an ambiguous pixel.
  const fitted = fittedOklabMixture(source, [target, ...others], [targetWeight, ...weights]);
  return fitted.error <= FLAT_RUN_DISTANCE_SQUARED
    ? {
      share: fitted.weights[0],
      weights: fitted.weights,
      channels: fitted.channels,
      error: fitted.error,
    }
    : null;
}

// Once a guide is gone, an ordinary edge can be recovered as one foreground
// and one backdrop. A crossing is different: its pixel can hold a share of as
// many as four flat faces, and flattening or projecting that mixture onto one
// edge either leaves the old face behind or eats a neighbour. Find the nearby
// flat face colours and recover only the clicked face's share of the mixture.
function localTargetShareAt(
  data, width, height, x, y, target, minimumOthers = 1, cache = null,
) {
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

  const cacheKey = cache === null
    ? null
    : [
      source.red,
      source.green,
      source.blue,
      minimumOthers,
      ...candidates
        .map((colour) => (colour.red << 16) | (colour.green << 8) | colour.blue)
        .sort((first, second) => first - second),
    ].join(",");
  if (cacheKey !== null && cache.has(cacheKey)) {
    return cache.get(cacheKey);
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
        (
          best === null ||
          solved.error < best.error - 1e-6 ||
          (
            Math.abs(solved.error - best.error) <= 1e-6 &&
            solved.share < best.share &&
            (
              solved.weights.length <= best.weights.length ||
              solved.weights.slice(1).every((weight) => weight >= MIN_MEANINGFUL_MIXTURE_SHARE)
            )
          )
        )
      ) {
        best = solved;
      }
    });
    // Most old walls are one ordinary edge. Once its two displayed colours
    // reproduce the pixel exactly, trying every crossing combination can only
    // find a more complicated explanation for the same colour. A crossing
    // needs the later rounds; an exact zero share is also final because this
    // face did not own any of the pixel.
    if (
      best !== null &&
      (
        count === 1 ||
        (best.error <= 1e-6 && best.share <= 1 / 512)
      )
    ) {
      if (cacheKey !== null) {
        cache.set(cacheKey, best);
      }
      return best;
    }
  }
  if (cacheKey !== null) {
    cache.set(cacheKey, best);
  }
  return best;
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
// How far apart along one run two pieces may sit and still be one wall bending.
// A pixel is about a piece long, so two or three of them can reach into it.
const WALL_SMOOTH_SPAN = 4;
// How far, and over how many pieces, to look out of a piece of a wall pixel for
// the area it belongs to. Near the point of a wedge the way out runs along the
// wedge, so the walk has to cover the whole narrow stretch: this clears about
// five degrees however the wedge is turned. Sharper than that and the point
// keeps its paper. Nearly every piece finds its area in a step or two, so the
// budget is only ever spent where two walls pinch.
const WALL_HOME_REACH = 48;
const WALL_HOME_PIECES = 400;
// How much of the side between two pixels two pieces have to share to be one
// way through. Where a line falls within a pixel is kept to a sixty-fourth,
// and the two pixels either side of it round that differently, so an overlap
// thinner than a few of those says nothing about the shape that was drawn.
const WALL_TOUCH_SPAN = 3 / WALL_DISTANCE_STEPS;
// Pieces already cut, kept while a walk is passing. Each step asks its
// neighbours for their pieces and every neighbour asks back, so without this
// the wall is cut again once for each pixel beside it. A walk only ever works
// its way along, so a few thousand is as much of it as is ever asked for
// twice, and holding more would cost more than cutting them again.
const WALL_SHAPE_MEMORY = 1 << 12;
const WALL_SQUARE = Object.freeze([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
// A pixel is cut in two by one line, and into four corners by a crossing.
const WALL_HALVES = Object.freeze([[1, 0], [-1, 0]]);
const WALL_CORNERS = Object.freeze([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
// Which side of a pixel each neighbour lies across: the way to it, and
// whether that side runs down the pixel (0) or across it (1).
const WALL_SIDES = Object.freeze([[-1, 0, 0], [1, 0, 0], [0, -1, 1], [0, 1, 1]]);

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
    let climbed = false;

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

      climbed = true;
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

    // A stroke drawn small and soft has no flat core to settle on: it is all
    // slope, darkest for a pixel or two and then climbing away again. Where the
    // slope stops climbing, that pixel is the crest, and the crest is what the
    // edge was drawn against. Without this the whole ramp keeps the colour it
    // had, which reads as a ring of the old colour left round the new one.
    if (
      !climbed &&
      ownDepth >= 3 &&
      ownDistance > PAPER_FLOOR_DISTANCE_SQUARED &&
      edge.getBackground(pixelIndex) === -1
    ) {
      settle(pixelIndex, pixelIndex, localForeground);
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

      // Lending reaches one pixel further than the walk, which is enough to
      // step onto the edge of a stroke this press never touched: a lone pixel
      // then comes out tinted with nothing painted beside it. What is lent to
      // has to touch the area itself.
      const pixelX = pixelIndex % width;
      const besideTheArea =
        (pixelIndex >= width && region.mask[pixelIndex - width]) ||
        (pixelX + 1 < width && region.mask[pixelIndex + 1]) ||
        (pixelIndex + width < pixelCount && region.mask[pixelIndex + width]) ||
        (pixelX > 0 && region.mask[pixelIndex - 1]);
      if (!besideTheArea) {
        continue;
      }

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

  // A wide range can step off the edge of the area and a pixel or two out into
  // the ground, wherever the grain leans the ground's colour towards the one
  // being replaced. Such a pixel holds none of that colour, so there is nothing
  // of it there to replace, and what lies between it and the area is the ground
  // the ramp has already settled as the backdrop. Painting it lays a solid
  // speck onto the paper with none of the fill joined to it.
  //
  // Whether a pixel is that speck or the outermost pixel of the area cannot be
  // read off its own colour, since both hold none of it. It is a question of
  // what the pixel is joined to, so the faces are walked outwards and anything
  // the walk cannot reach except through the backdrop keeps what it has.
  {
    // A reading of zero, rather than no reading at all, is what says a pixel is
    // the backdrop: it sits on the line towards the colour being replaced, at
    // none of the way along it.
    const standsAsGround = (pixelIndex) => {
      const packedBackground = edge.getBackground(pixelIndex);
      return (
        packedBackground !== -1 &&
        seedFractionAt(
          data,
          pixelIndex,
          targetFromPackedRgb(edge.getForeground(pixelIndex), target.alpha),
          packedBackground,
        ) === 0
      );
    };

    const joined = new Uint8Array(pixelCount);
    const reached = [];
    forEachSpanPixel(region.spans, width, (pixelIndex) => {
      if (region.mask[pixelIndex] && edge.getDepth(pixelIndex) === 0) {
        joined[pixelIndex] = 1;
        reached.push(pixelIndex);
      }
    });

    for (let at = 0; at < reached.length; at += 1) {
      const pixelIndex = reached[at];
      const pixelX = pixelIndex % width;
      const step = (neighbour) => {
        if (joined[neighbour] || !region.mask[neighbour] || standsAsGround(neighbour)) {
          return;
        }
        joined[neighbour] = 1;
        reached.push(neighbour);
      };
      if (pixelIndex >= width) step(pixelIndex - width);
      if (pixelX + 1 < width) step(pixelIndex + 1);
      if (pixelIndex + width < pixelCount) step(pixelIndex + width);
      if (pixelX > 0) step(pixelIndex - 1);
    }

    forEachSpanPixel(region.spans, width, (pixelIndex) => {
      if (
        !region.mask[pixelIndex] ||
        joined[pixelIndex] ||
        edge.getBackground(pixelIndex) !== -1
      ) {
        return;
      }
      edge.setBackground(pixelIndex, packedRgbAt(data, pixelIndex));
      edge.setForeground(
        pixelIndex,
        (target.red << 16) | (target.green << 8) | target.blue,
      );
    });
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

  // A pixel right against the area, still holding some of the colour being
  // replaced, is what reads as a rim of the old colour once the area around it
  // has changed. Whatever the walk above did or did not reach, such a pixel can
  // say for itself what it is a blend of: the colour being replaced on one
  // side, and whatever its neighbours are furthest towards on the other. Asking
  // each pixel rather than following a walk also keeps the answer steady, since
  // a wider range moves where the walk goes but not what a pixel is made of.
  const rim = [];
  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (!region.mask[pixelIndex]) {
      return;
    }
    const pixelX = pixelIndex % width;
    // `beyond` is the next pixel on the same way out. A colour that carries on
    // unchanged there is a face of its own, standing outside the range because
    // it was meant to; only a blend on its way from one colour to another is
    // this area's edge to settle.
    const look = (neighbor, beyond) => {
      if (
        region.mask[neighbor] ||
        beyond === -1 ||
        startsFlatRun(data, neighbor, beyond) ||
        edge.getBackground(neighbor) !== -1 ||
        isWalledOff(barrier, neighbor) ||
        data[neighbor * 4 + 3] !== target.alpha ||
        isDrawnInk(data, neighbor) ||
        seedDistanceSquaredAt(data, neighbor, target) <= PAPER_FLOOR_DISTANCE_SQUARED
      ) {
        return;
      }
      // Carry on the same way out, looking for a stroke: somewhere along there
      // the picture has to get darker and then stop getting darker. That crest
      // is what the edge was drawn against. Where instead one face simply
      // shades into another, with nothing dark in between, there is no stroke
      // here and no edge of this area's to settle - the range's answer stands.
      let against = -1;
      let darkest = lightnessAt(data, neighbor);
      let at = neighbor;
      for (let step = 1; step < EDGE_RAMP_REACH; step += 1) {
        const nextX = (neighbor % width) + (neighbor - pixelIndex === 1 ? step
          : neighbor - pixelIndex === -1 ? -step : 0);
        const nextY = ((neighbor - (neighbor % width)) / width)
          + (neighbor - pixelIndex === width ? step
            : neighbor - pixelIndex === -width ? -step : 0);
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          break;
        }
        at = nextY * width + nextX;
        if (data[at * 4 + 3] !== target.alpha) {
          break;
        }
        const level = lightnessAt(data, at);
        if (level < darkest) {
          darkest = level;
          against = at;
        } else if (against !== -1) {
          break;
        }
      }
      if (against === -1 || lightnessAt(data, neighbor) - darkest < EDGE_CREST_DROP) {
        return;
      }
      rim.push([neighbor, packedRgbAt(data, against)]);
    };
    if (pixelIndex >= width) {
      look(pixelIndex - width, pixelIndex >= 2 * width ? pixelIndex - 2 * width : -1);
    }
    if (pixelX + 1 < width) {
      look(pixelIndex + 1, pixelX + 2 < width ? pixelIndex + 2 : -1);
    }
    if (pixelIndex + width < pixelCount) {
      look(
        pixelIndex + width,
        pixelIndex + 2 * width < pixelCount ? pixelIndex + 2 * width : -1,
      );
    }
    if (pixelX > 0) {
      look(pixelIndex - 1, pixelX > 1 ? pixelIndex - 2 : -1);
    }
  });

  for (const [pixelIndex, packedBackground] of rim) {
    if (region.mask[pixelIndex] || edge.getBackground(pixelIndex) !== -1) {
      continue;
    }
    const fraction = seedFractionAt(data, pixelIndex, target, packedBackground);
    if (fraction <= 0) {
      continue;
    }
    edge.setBackground(pixelIndex, packedBackground);
    edge.setForeground(pixelIndex, (target.red << 16) | (target.green << 8) | target.blue);
    added.push(pixelIndex);
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

// White paper normally rebuilds the antialiasing already selected by its own
// delta. A screenshot can turn one outside antialiasing pixel into a flat block
// wider than the range, however, so none of that block is selected. Look only
// straight out from the chosen paper towards a darker crest and replace the
// paper share of every block before it. The crest and the skirt on the far side
// stay untouched, which keeps a glyph's hole as it was drawn.
function collectPixelatedWhiteSkirt(
  data,
  width,
  height,
  region,
  target,
  barrier,
  maximumDistanceSquared,
  colourRangeSquared,
) {
  // A pixel the range admits, which the ordinary walk nonetheless never
  // reached, is not this area's skirt: it is another area of the same colour,
  // standing behind something the walk could not cross. The skirt this pass is
  // for is the part the range left out - the faint steps of an antialiasing the
  // range stops short of - so that is the only part it may take.
  //
  // Bounding the walk by distance instead cannot tell the two apart: a skirt
  // enlarged by a screenshot runs several blocks and seventy pixels deep, which
  // is further than the white face this pass was wrongly reaching into.
  const belongsToAnotherArea = (pixelIndex) => (
    isWithinTolerance(data, pixelIndex, target, maximumDistanceSquared) &&
    isWithinColourRange(data, pixelIndex, target, colourRangeSquared)
  );
  const pixelCount = width * height;
  const edge = createEdgeRampStorage(width);
  const added = new Set();
  const packedForeground = (target.red << 16) | (target.green << 8) | target.blue;

  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    if (!region.mask[pixelIndex]) return;
    const pixelX = pixelIndex % width;
    // A pixel an earlier repair reached out and took (2) may still be a block of
    // the same enlarged skirt, so the walk starts through it and, where it is
    // indeed a block of one colour, rebuilds it too. Without that, the block the
    // repair happened to reach first was the one block along the edge left flat.
    // An ordinary one-pixel skirt is not this pass's business and keeps the
    // answer the repair gave it.
    const look = (neighbor, beyond) => {
      if (
        (region.mask[neighbor] && region.mask[neighbor] !== 2) || beyond === -1 ||
        edge.getBackground(neighbor) !== -1 ||
        isWalledOff(barrier, neighbor) ||
        data[neighbor * 4 + 3] !== target.alpha ||
        (!region.mask[neighbor] && belongsToAnotherArea(neighbor))
      ) {
        return;
      }

      const scanned = [neighbor];
      let darkest = lightnessAt(data, neighbor);
      let previous = darkest;
      let againstIndex = -1;
      for (let step = 1; step < PIXELATED_EDGE_RAMP_REACH; step += 1) {
        const nextX = (neighbor % width) + (neighbor - pixelIndex === 1 ? step
          : neighbor - pixelIndex === -1 ? -step : 0);
        const nextY = ((neighbor - (neighbor % width)) / width)
          + (neighbor - pixelIndex === width ? step
            : neighbor - pixelIndex === -width ? -step : 0);
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) break;
        const at = nextY * width + nextX;
        if (data[at * 4 + 3] !== target.alpha || isWalledOff(barrier, at)) break;
        // Meeting a pixel the range admits that the walk never reached means
        // the line has left this area and crossed into another one. Nothing
        // further along it belongs to the skirt being rebuilt - not the far
        // area's own antialiasing either - so the whole line is given up here,
        // rather than this one pixel being stepped over.
        if (!region.mask[at] && belongsToAnotherArea(at)) break;
        const level = lightnessAt(data, at);
        if (level > previous && againstIndex === -1) break;
        scanned.push(at);
        if (level < darkest) {
          darkest = level;
          againstIndex = scanned.length - 1;
        } else if (level > darkest && againstIndex !== -1) {
          break;
        }
        previous = level;
      }

      // Measured from the colour being replaced rather than from the first
      // pixel outside the area. A wider range eats into the skirt from the
      // light end, and reading the drop from whatever it has left would make
      // the same edge stop counting as one partway up the slider.
      if (
        againstIndex === -1 ||
        Math.max(target.red, target.green, target.blue) - darkest < EDGE_CREST_DROP
      ) {
        return;
      }
      const packedBackground = packedRgbAt(data, scanned[againstIndex]);
      for (let index = 0; index < againstIndex; index += 1) {
        const candidate = scanned[index];
        if (
          (region.mask[candidate] && (
            region.mask[candidate] !== 2 ||
            !belongsToFlatRun(data, width, height, candidate)
          )) ||
          edge.getBackground(candidate) !== -1 ||
          isWalledOff(barrier, candidate) ||
          data[candidate * 4 + 3] !== target.alpha ||
          seedFractionAt(data, candidate, target, packedBackground) <= 0
        ) {
          continue;
        }
        edge.setBackground(candidate, packedBackground);
        edge.setForeground(candidate, packedForeground);
        added.add(candidate);
      }
    };

    if (pixelIndex >= width) {
      look(pixelIndex - width, pixelIndex >= 2 * width ? pixelIndex - 2 * width : -1);
    }
    if (pixelX + 1 < width) {
      look(pixelIndex + 1, pixelX + 2 < width ? pixelIndex + 2 : -1);
    }
    if (pixelIndex + width < pixelCount) {
      look(
        pixelIndex + width,
        pixelIndex + 2 * width < pixelCount ? pixelIndex + 2 * width : -1,
      );
    }
    if (pixelX > 0) {
      look(pixelIndex - 1, pixelX > 1 ? pixelIndex - 2 : -1);
    }
  });

  for (const pixelIndex of added) {
    if (region.mask[pixelIndex]) continue;
    region.mask[pixelIndex] = 2;
    recordSpan(region.spans, pixelIndex, 1);
    region.count += 1;
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
// How light a pixel reads, for telling a stroke from a shading.
function lightnessAt(data, pixelIndex) {
  const offset = pixelIndex * 4;
  return Math.max(data[offset], data[offset + 1], data[offset + 2]);
}

// Whether this pixel is one of a run of its own colour. A picture shown larger
// than it was drawn turns every level of an edge into such a run, and the share
// each run holds was settled when the picture was drawn: it is exact, and
// sharpening it only throws it away, which is what makes a fill look as though
// it has cut into the line beside it. A lone pixel of blend carries no such
// certainty, and is the case sharpening was meant for.
function belongsToFlatRun(data, width, height, pixelIndex, bothWays = false, runLength = ENLARGED_RUN_LENGTH) {
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  let ways = 0;
  for (const [stepX, stepY] of [[1, 0], [0, 1]]) {
    let along = 1;
    for (const way of [1, -1]) {
      for (let step = 1; step < runLength; step += 1) {
        const atX = pixelX + stepX * step * way;
        const atY = pixelY + stepY * step * way;
        if (atX < 0 || atY < 0 || atX >= width || atY >= height) {
          break;
        }
        if (!startsFlatRun(data, pixelIndex, atY * width + atX)) {
          break;
        }
        along += 1;
      }
    }
    if (along >= runLength) {
      if (!bothWays) {
        return true;
      }
      ways += 1;
    }
  }
  // A shadow shades away across the picture: it runs on along the edge it falls
  // from, but changes with every step away from it. A band of its own carries
  // on both ways, and that is what tells the two apart.
  return ways === 2;
}

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

// How much of this pixel is something drawn on the ground rather than the
// ground itself. Nothing is brighter than white, so on the page a reading in
// either direction means the same thing; on a pale panel the page around it is
// brighter, and counting that as ink would make the fill walk off the panel
// and across the page instead of down the shadow cast onto it.
function inkCoverageAt(data, pixelIndex, target) {
  const offset = pixelIndex * 4;
  const brighterCounts = Math.min(target.red, target.green, target.blue) === CHANNEL_MAX;
  const reading = (source, ground) => (brighterCounts || source <= ground
    ? channelForegroundCoverage(source, ground)
    : 0);
  return Math.max(
    reading(data[offset], target.red),
    reading(data[offset + 1], target.green),
    reading(data[offset + 2], target.blue),
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

  // Where two lines pinch, the area carries on through pixels the lines run
  // over, and a walk that steps only from pixel to pixel cannot follow it. The
  // first walk did follow it, so take its word for those pixels rather than
  // cut off everything beyond them.
  for (const pixelIndex of region.bridged) {
    if (region.mask[pixelIndex] && !reached[pixelIndex]) {
      reached[pixelIndex] = 1;
      count += 1;
      pending.push(pixelIndex);
    }
  }

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

// Paper inside a face: grain a shade off the colour clicked on, or the page
// itself left uncovered by the paint. On white line art those are the same
// thing. Inside a band of colour they are not, and paper showing through the
// band still belongs to it. This is the pocket rule, and a pocket is already
// closed on every side by the face, so nothing open to the page reaches it.
function isFacePaper(data, pixelIndex, target) {
  return (
    isWithinTolerance(data, pixelIndex, target, PAPER_FLOOR_DISTANCE_SQUARED) ||
    isPaperLikePixel(data, pixelIndex)
  );
}

// Paper in the rim between a face and the stroke beside it. Nothing closes
// this side, so the page has to be told apart from the hairline of paper a
// brush leaves along a line: the page comes in fields, the hairline in specks.
// Without that, a pale panel with no line drawn round it would bleed into the
// page wherever a stroke reached its edge.
function isRimPaper(data, width, height, pixelIndex, target) {
  return (
    isWithinTolerance(data, pixelIndex, target, PAPER_FLOOR_DISTANCE_SQUARED) ||
    (isPaperLikePixel(data, pixelIndex) &&
      !belongsToSubstantialPaperPlateau(data, width, height, pixelIndex))
  );
}

// Whether this pixel is a lone speck of paper the selected area closes around:
// paper, with the area on all four sides of it and none of those sides its own
// colour. A step of a drawn edge always has more of itself beside it, however
// wide the edge is, so it is not a speck and keeps the share it holds. Nor is
// anything holding a colour of its own, which belongs to whatever is drawn
// there rather than to the ground it is drawn on.
function isSpeckInsideFace(data, mask, width, height, pixelIndex, target) {
  const pixelX = pixelIndex % width;
  const inside = (neighbour) =>
    mask[neighbour] !== 0 && mask[neighbour] !== BLENDED_EDGE;
  return (
    isFacePaper(data, pixelIndex, target) &&
    (pixelIndex < width || inside(pixelIndex - width)) &&
    (pixelX + 1 === width || inside(pixelIndex + 1)) &&
    (pixelIndex + width >= width * height || inside(pixelIndex + width)) &&
    (pixelX === 0 || inside(pixelIndex - 1)) &&
    !isSelectedPlateau(data, mask, width, height, pixelIndex)
  );
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
        !isFacePaper(data, pixelIndex, target)
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
    isRimPaper(data, width, height, pixelIndex, target);

  forEachSpanPixel(region.spans, width, (pixelIndex) => {
    // Value 2 is the crest of a stroke reached from this face. Starting a
    // second rim walk there can step down the opposite skirt and leave
    // detached dots outside a light outline. Original face pixels (1) and
    // repaired paper (4) may still carry the walk forward on the same side.
    if (
      region.mask[pixelIndex] !== 0 &&
      region.mask[pixelIndex] !== 2 &&
      depth[pixelIndex] === -1
    ) {
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
      if (
        depth[neighbor] !== -1 ||
        ownDepth >= RIM_REACH ||
        (
          ownDepth >= 1 &&
          hasNearbyLightStrokeCore(data, width, height, neighbor, target)
        )
      ) {
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
      // Value 4 keeps repaired paper distinct from pixels selected by the
      // requested range. A pale outline beside it then stays an outline rather
      // than being mistaken for another flat part of the face.
      region.mask[pixelIndex] = 4;
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
function recordNearestWall(barrier, pixelIndex, distance, heading, at) {
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
    // The piece itself, counted from one so that nought means none. Its run and
    // where it sits along that run are read back from the list when needed,
    // which is one number a pixel rather than two.
    barrier.nearest[pixelIndex] = at + 1;
  }
}

// The nearest heading that differs from the settled line is the second cut of
// a crossing. A third would need a third line through the same pixel, which is
// a knot no drawing asks for.
function recordCrossingWall(barrier, pixelIndex, distance, heading, at) {
  const slot = pixelIndex * 2;
  const nearest = barrier.nearest[pixelIndex];
  const beside = nearest === 0 ? null : barrier.segments[nearest - 1];
  const piece = barrier.segments[at];

  // Two headings that lie alike are one line bending only where they are the
  // same run of pieces, met near the same place along it. Either side of a
  // point the user asked to keep sharp, two lines of their own, and a line that
  // comes back across itself are all crossings, however shallow the angle. That
  // is what lets the point of a narrow wedge hold paint.
  const lieAlike = sameWallLine(barrier.headings[slot], heading);
  if (
    lieAlike
    && beside !== null
    && piece.run === beside.run
    && bendsTogether(barrier, piece.run, piece.spot, beside.spot)
  ) {
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
    // Read back where the pieces of the pixel are cut: the headings alone
    // cannot say that these two were kept apart on purpose.
    barrier.crossesAlike[pixelIndex] = lieAlike ? 1 : 0;
  }
}

function stampWallRun(barrier, width, height, from, to, record, at) {
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
      record(barrier, y * width + x, distance, heading, at);
    }
  }
}

/**
 * Builds the wall a set of guide polylines makes over a picture that size.
 * Pass the wall from last time to write over it rather than make another: a
 * point being dragged rebuilds this on every movement of the mouse.
 */
// A line may say which run of pieces each of its segments belongs to, in `runs`,
// and where along that run each one sits, in `spots`. Pieces of one run lying
// near each other along it are one wall bending; anything else is a crossing,
// however alike the two lie. That is how a point the user asked to keep sharp
// reaches the wall as a corner, how a line that crosses itself is two walls
// where it does, and how two lines of their own always cross. A line that says
// nothing is one run, counted in the order its pieces were drawn.
function guideSegments(lines) {
  const segments = [];
  const runLength = new Map();
  const cyclicRuns = new Set();
  let nextRun = 1;
  for (const line of lines) {
    const base = nextRun;
    let highest = 0;
    for (let index = 0; index < line.length - 1; index += 1) {
      const within = line.runs === undefined ? 0 : (line.runs[index] ?? 0);
      if (within > highest) {
        highest = within;
      }
      const run = base + within;
      const spot = line.spots === undefined ? index : (line.spots[index] ?? index);
      runLength.set(run, Math.max(runLength.get(run) ?? 0, spot + 1));
      segments.push({ from: line[index], to: line[index + 1], run, spot });
    }
    if (line.cyclicRun !== undefined && line.cyclicRun >= 0) {
      cyclicRuns.add(base + line.cyclicRun);
    }
    nextRun = base + highest + 1;
  }
  return { segments, runLength, cyclicRuns };
}

// Whether two pieces of one run sit near enough along it to be the same wall
// bending. A pixel holds only a piece or two of a curve, so a handful either
// way is generous; anything further apart is the run coming back on itself.
function bendsTogether(barrier, run, spot, otherSpot) {
  let apart = Math.abs(spot - otherSpot);
  if (barrier.cyclicRuns.has(run)) {
    const length = barrier.runLength.get(run) ?? 0;
    apart = Math.min(apart, length - apart);
  }
  return apart <= WALL_SMOOTH_SPAN;
}

function createGuideBarrier(width, height, lines, previous = null) {
  const barrier = previous !== null
    && previous.reach.length === width * height
    && previous.crossesAlike !== undefined
    ? previous
    : {
      reach: new Uint8Array(width * height),
      headings: new Uint8Array(width * height * 2),
      crossing: new Uint8Array(width * height),
      crossesAlike: new Uint8Array(width * height),
      paper: null,
      cut: null,
      painted: false,
    };
  barrier.reach.fill(0);
  barrier.headings.fill(0);
  barrier.crossing.fill(0);
  barrier.crossesAlike.fill(0);

  // Which piece of which line stands nearest is asked only while the wall is
  // being stamped. Reading it back needs no more than the one answer recorded
  // in crossesAlike, so this is put down again afterwards rather than held for
  // as long as the picture is open.
  const { segments, runLength, cyclicRuns } = guideSegments(lines);
  barrier.nearest = new Uint32Array(width * height);
  barrier.segments = segments;
  barrier.runLength = runLength;
  barrier.cyclicRuns = cyclicRuns;
  for (const record of [recordNearestWall, recordCrossingWall]) {
    for (let at = 0; at < segments.length; at += 1) {
      stampWallRun(barrier, width, height, segments[at].from, segments[at].to, record, at);
    }
  }
  barrier.nearest = null;
  barrier.segments = null;
  barrier.runLength = null;
  barrier.cyclicRuns = null;
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

// The stretch of one side of a pixel a piece takes up, or nothing where the
// piece does not reach that side.
function wallPieceSpan(polygon, axis, at) {
  let low = Infinity;
  let high = -Infinity;
  for (let corner = 0; corner < polygon.length; corner += 2) {
    if (Math.abs(polygon[corner + axis] - at) > WALL_GEOMETRY_EPSILON) {
      continue;
    }
    const across = polygon[corner + 1 - axis];
    low = Math.min(low, across);
    high = Math.max(high, across);
  }
  return high - low > WALL_TOUCH_SPAN ? { low, high } : null;
}

function spansMeet(here, there) {
  return there !== null
    && Math.min(here.high, there.high) - Math.max(here.low, there.low) > WALL_TOUCH_SPAN;
}

// Whether two points lie the same side of every line that cuts a pixel.
function sameSideOfCuts(cuts, hereX, hereY, thereX, thereY) {
  for (const cut of cuts) {
    const here = cut.nx * hereX + cut.ny * hereY + cut.offset;
    const there = cut.nx * thereX + cut.ny * thereY + cut.offset;
    if ((here >= 0) !== (there >= 0)) {
      return false;
    }
  }
  return true;
}

// Whether two pieces of neighbouring pixels are one way through. They have to
// share a stretch of the side between them, and each has to lie the side of
// the other's lines that the other does: a line running along the join between
// two pixels cuts neither of them, so the overlap alone would step over it.
function wallPiecesJoin(here, at, span, there, other, axis, side, stepX, stepY) {
  const piece = here[at];
  const beyond = there[other];
  if (!spansMeet(span, wallPieceSpan(beyond.polygon, axis, -side))) {
    return false;
  }
  return sameSideOfCuts(here.cuts, piece.x, piece.y, beyond.x + stepX, beyond.y + stepY)
    && sameSideOfCuts(there.cuts, beyond.x, beyond.y, piece.x - stepX, piece.y - stepY);
}

// What a walk over the pieces keeps to hand: the pieces it has already cut,
// and the pieces one search has already been to.
function createWallScratch() {
  return { shapes: new Map(), seen: new Map() };
}

// The pieces the lines cut one pixel of wall into, each with the share of the
// pixel it covers and the shape it covers it with. The shares are the areas of
// the pixel's own square cut by one line or two, so they add up to the whole
// of it.
function wallPieceShapes(memory, barrier, pixelIndex) {
  const remembered = memory.shapes.get(pixelIndex);
  if (remembered !== undefined) {
    return remembered;
  }

  const slot = pixelIndex * 2;
  const near = wallEdgeAt(barrier.headings[slot], barrier.reach[pixelIndex]);
  const across = barrier.crossing[pixelIndex] !== 0
    && (barrier.crossesAlike[pixelIndex] === 1
      || !sameWallLine(barrier.headings[slot], barrier.headings[slot + 1]))
    ? wallEdgeAt(barrier.headings[slot + 1], barrier.crossing[pixelIndex])
    : null;
  const shapes = [];

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
    if (middle !== null) {
      shapes.push({ share: middle.area, polygon: piece, x: middle.x, y: middle.y });
    }
  }
  shapes.cuts = across === null ? [near] : [near, across];

  if (memory.shapes.size >= WALL_SHAPE_MEMORY) {
    memory.shapes.clear();
  }
  memory.shapes.set(pixelIndex, shapes);
  return shapes;
}

// Which area a piece of a wall pixel belongs to: step from piece to touching
// piece, never across a line, until the walk steps out of the wall. The tip of
// a narrow wedge is a long stretch of wall from the area it belongs to, and the
// areas either side of it are one pixel away - but those are the far side of a
// line, which no step may cross, so the nearest area the walk can reach is the
// one down the wedge. Two pieces touch where their sides of the pixel between
// them overlap, which is a question about the lines as drawn; marching out
// along the line that bisects a piece instead asks the pixel grid, and a wedge
// turned off that grid is missed by a hair over the length of its narrow part.
function wallPieceHome(memory, barrier, width, height, pixelIndex, pieceAt) {
  const { seen } = memory;
  seen.clear();
  seen.set(pixelIndex * 4 + pieceAt, 1);
  let edge = [pixelIndex * 4 + pieceAt];

  for (let step = 0; step < WALL_HOME_REACH && edge.length > 0; step += 1) {
    const next = [];
    for (const node of edge) {
      const piece = node % 4;
      const at = (node - piece) / 4;
      const x = at % width;
      const y = (at - x) / width;
      const shapes = wallPieceShapes(memory, barrier, at);
      const { polygon } = shapes[piece];

      for (const [towardsX, towardsY, axis] of WALL_SIDES) {
        const nextX = x + towardsX;
        const nextY = y + towardsY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue;
        }
        const side = towardsX + towardsY > 0 ? 0.5 : -0.5;
        const here = wallPieceSpan(polygon, axis, side);
        if (here === null) {
          continue;
        }
        const neighbour = nextY * width + nextX;
        if (!isWalledOff(barrier, neighbour)) {
          return neighbour;
        }
        const theirs = wallPieceShapes(memory, barrier, neighbour);
        for (let other = 0; other < theirs.length; other += 1) {
          const reached = neighbour * 4 + other;
          if (seen.has(reached) || seen.size >= WALL_HOME_PIECES) {
            continue;
          }
          if (!wallPiecesJoin(shapes, piece, here, theirs, other, axis, side, towardsX, towardsY)) {
            continue;
          }
          seen.set(reached, 1);
          next.push(reached);
        }
      }
    }
    edge = next;
  }
  return -1;
}

// The pieces of one pixel of wall, each with its share of the pixel and the
// area it belongs to. Pass the scratch of a walk already under way to reuse the
// pieces it has cut; on its own each call starts from nothing.
function wallPieces(barrier, width, height, pixelIndex, memory = createWallScratch()) {
  return wallPieceShapes(memory, barrier, pixelIndex).map((shape, at) => ({
    share: shape.share,
    home: wallPieceHome(memory, barrier, width, height, pixelIndex, at),
  }));
}

// Rebuild a wall pixel from the page the guide was first drawn over and the
// colours that now live on each side. A side that still has its original colour
// contributes no change: on a multicoloured image its colour often differs
// from the wall pixel before anything is painted. Treating that existing
// difference as a replacement made distant white reappear as bright dots
// wherever two close guides pinched a pixel.
//
// Adding another delta to the current wall pixel is not stable after the guide
// moves: its shares change with the line, so traces of colours painted at
// earlier positions would accumulate there.
function rebuiltWallColour(data, width, height, pixelIndex, mask, barrier, fill) {
  const offset = pixelIndex * 4;
  const fillChannels = rgbToOklab(fill.r, fill.g, fill.b);
  const paper = rgbToOklab(
    barrier.paper[offset],
    barrier.paper[offset + 1],
    barrier.paper[offset + 2],
  );
  const colour = [...paper];

  for (const piece of wallPieces(barrier, width, height, pixelIndex)) {
    if (piece.home === -1) {
      continue;
    }
    const homeOffset = piece.home * 4;
    const currentRed = mask[piece.home] ? fill.r : data[homeOffset];
    const currentGreen = mask[piece.home] ? fill.g : data[homeOffset + 1];
    const currentBlue = mask[piece.home] ? fill.b : data[homeOffset + 2];
    if (
      currentRed === barrier.paper[homeOffset]
      && currentGreen === barrier.paper[homeOffset + 1]
      && currentBlue === barrier.paper[homeOffset + 2]
    ) {
      continue;
    }
    const current = mask[piece.home]
      ? fillChannels
      : rgbToOklab(currentRed, currentGreen, currentBlue);
    for (let channel = 0; channel < 3; channel += 1) {
      colour[channel] += piece.share * (current[channel] - paper[channel]);
    }
  }

  return oklabToRgb(...colour);
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
  if (barrier.cut === null || barrier.cut === undefined || barrier.cut.length !== width * height) {
    barrier.cut = new Uint8Array(width * height);
  }
  const paperTarget = {
    red: barrier.paper[seedPixel * 4],
    green: barrier.paper[seedPixel * 4 + 1],
    blue: barrier.paper[seedPixel * 4 + 2],
    alpha: barrier.paper[seedPixel * 4 + 3],
  };

  // What the area itself holds now, for the pixels the line only runs beside.
  const standingTarget = {
    red: data[seedPixel * 4],
    green: data[seedPixel * 4 + 1],
    blue: data[seedPixel * 4 + 2],
    alpha: data[seedPixel * 4 + 3],
  };
  const reachToTheLine = Math.max(maximumDistanceSquared, PAPER_FLOOR_DISTANCE_SQUARED);

  const share = new Uint8Array(width * height);
  const memory = createWallScratch();
  let count = region.count;
  for (let pixelIndex = 0; pixelIndex < barrier.reach.length; pixelIndex += 1) {
    if (!isWalledOff(barrier, pixelIndex) || region.mask[pixelIndex]) {
      continue;
    }
    if (!isWithinTolerance(barrier.paper, pixelIndex, paperTarget, maximumDistanceSquared)) {
      continue;
    }

    let coverage = 0;
    for (const piece of wallPieces(barrier, width, height, pixelIndex, memory)) {
      if (piece.home !== -1 && region.mask[piece.home]) {
        coverage += piece.share;
      }
    }
    if (coverage <= 0) {
      continue;
    }

    // A pixel the line cuts is shared, and both sides rebuild it from the page
    // the line was drawn over - now, or on an earlier position of the line. A
    // pixel the line only runs beside is shared with nothing: it is taken
    // whole, so it is this area's only while it still holds this area's own
    // colour. Where it holds another area's instead, the line has arrived over
    // paint the page knows nothing about, and taking it laid the page back down
    // over that paint - the new colour biting into the one beside it, in a band
    // following the line.
    const cut = coverage < 1;
    if (cut) {
      barrier.cut[pixelIndex] = 1;
    } else if (
      !barrier.cut[pixelIndex] &&
      !isWithinTolerance(data, pixelIndex, standingTarget, reachToTheLine)
    ) {
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
// A shadow falling across a ground gives up a level or two at a time. The edge
// of a letter drops away all at once. `keepToTheGround` is that difference: the
// walk follows a slope down but never steps off it onto something else, which
// is what a walk with no such rule did to every glyph the fill ran up to.
function extendRegionToInk(data, width, height, region, target, barrier, keepToTheGround = 0) {
  const pending = [];
  // Reading a pixel as ink over a ground, and swapping only the ground, works
  // where the ground is white. Over any other ground there is no such reading,
  // and a pixel taken in here is painted whole. Climbing to the crest then
  // paints the line itself, which is why the walk stops short of it: the line
  // is the boundary of the area, not part of it.
  const paintsWhatItTakesWhole = !isWhiteBackground(target);

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

    // `beyond` is the next pixel on, which says whether a step down has landed
    // on another flat block. `far` is several further still, which says whether
    // a slope that has paused is still a slope.
    const inspect = (neighbor, beyond, far) => {
      if (
        region.mask[neighbor] ||
        isWalledOff(barrier, neighbor) ||
        data[neighbor * 4 + 3] !== target.alpha
      ) {
        return;
      }

      // A shadow cast across a pale ground can give up a level only every
      // pixel or two, so a skirt walk that insists on darker at every step
      // stops at the first pair that matches and leaves a pale ring behind.
      // Standing still carries the walk on only where the walk is already on a
      // skirt and the ground goes on falling further out.
      if (keepToTheGround !== 0) {
        const there = pixelIndex * 4;
        const here = neighbor * 4;
        const red = data[here] - data[there];
        const green = data[here + 1] - data[there + 1];
        const blue = data[here + 2] - data[there + 2];
        if (red * red + green * green + blue * blue > keepToTheGround) {
          return;
        }
      }

      const reading = inkCoverageAt(data, neighbor, target);
      if (paintsWhatItTakesWhole && reading >= INK_CREST_SHARE) {
        return;
      }
      if (reading < ownInk) {
        return;
      }
      if (
        reading === ownInk &&
        !(reading > 0 && far !== -1 && inkCoverageAt(data, far, target) > reading)
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

    const reach = SKIRT_FLAT_REACH;
    if (pixelIndex >= width) {
      inspect(
        pixelIndex - width,
        pixelIndex >= 2 * width ? pixelIndex - 2 * width : -1,
        pixelIndex >= reach * width ? pixelIndex - reach * width : -1,
      );
    }
    if (pixelX + 1 < width) {
      inspect(
        pixelIndex + 1,
        pixelX + 2 < width ? pixelIndex + 2 : -1,
        pixelX + reach < width ? pixelIndex + reach : -1,
      );
    }
    if (pixelIndex + width < width * height) {
      inspect(
        pixelIndex + width,
        pixelIndex + 2 * width < width * height ? pixelIndex + 2 * width : -1,
        pixelIndex + reach * width < width * height ? pixelIndex + reach * width : -1,
      );
    }
    if (pixelX > 0) {
      inspect(
        pixelIndex - 1,
        pixelX > 1 ? pixelIndex - 2 : -1,
        pixelX >= reach ? pixelIndex - reach : -1,
      );
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

// Whether this pixel is the soft edge of a stroke rather than a face of its
// own: something markedly darker lies beside it that the fill is not
// replacing. A darker neighbour the range took in is another part of the same
// face, and says nothing about an edge.
function sitsAgainstStroke(data, mask, width, height, pixelIndex, target, openedPaper) {
  // Nothing has no colour: what is stored behind a fully transparent pixel is
  // whatever was last there, and says nothing about a stroke either side.
  if (data[pixelIndex * 4 + 3] === 0) {
    return false;
  }
  const own = lightnessAt(data, pixelIndex);
  const pixelX = pixelIndex % width;
  const pixelY = (pixelIndex - pixelX) / width;
  for (let nearbyY = Math.max(0, pixelY - 1);
    nearbyY <= Math.min(height - 1, pixelY + 1); nearbyY += 1) {
    for (let nearbyX = Math.max(0, pixelX - 1);
      nearbyX <= Math.min(width - 1, pixelX + 1); nearbyX += 1) {
      const nearby = nearbyY * width + nearbyX;
      if (
        mask[nearby] === 0 &&
        data[nearby * 4 + 3] !== 0 &&
        (
          own - lightnessAt(data, nearby) >= EDGE_SHOULDER_DROP ||
          // An outline drawn in a colour is no darker than the paper it stands
          // on - an orange holds red at the full, as white does - so by
          // lightness alone the step beside it did not read as a step at all,
          // and the shape of the mask was laid over the softness the drawing
          // had already given it. At a corner the mask has a different shape,
          // so one step along an outline came out two colours.
          isColouredOutlineCore(data, openedPaper, width, height, nearby, target)
        )
      ) {
        return true;
      }
    }
  }
  return false;
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
  keepFullShare = false,
) {
  if (mask[pixelIndex] === 3) {
    return FACE_JOIN_COVERAGE;
  }
  if (mask[pixelIndex] === 2) {
    return 1;
  }
  // The share of a pixel the range took in on the edge of a stroke is already
  // known from the colours in it, the same way it is for one the edge repair
  // added. The mask's own geometry has nothing to add, and multiplying the two
  // would count the same edge twice.
  if (keepFullShare) {
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
  maximumStepDistanceSquared = maximumDistanceSquared,
  colourRangeSquared = Infinity,
) {
  const visited = new Uint8Array(width * height);
  const pending = [firstPixel];
  const spans = recordVisitedSpans ? createSpanStream() : null;
  let visitedCount = 0;
  let widestStepDistanceSquared = 0;
  // Same colour, reached without crossing an edge. A face can shade away from
  // the colour that was clicked - a shadow falls across it - and the range is
  // what says how far that may go. But a step from one pixel to the next that
  // is itself the whole width of the range is not shading: it is where one
  // thing ends and another begins, and the two may happen to lie within the
  // range of each other all the same.
  const noStepOver = (from, to) => {
    const there = from * 4;
    const here = to * 4;
    // Nothing has no colour. What is stored behind a fully transparent pixel is
    // whatever was last there, so a step to or from one says nothing at all.
    if (data[there + 3] === 0 || data[here + 3] === 0) {
      return true;
    }
    const distanceSquared = pixelStepDistanceSquared(data, from, to);
    if (distanceSquared > maximumStepDistanceSquared) {
      return false;
    }
    widestStepDistanceSquared = Math.max(widestStepDistanceSquared, distanceSquared);
    return true;
  };

  const belongs = (pixelIndex) => {
    const alpha = data[pixelIndex * 4 + 3];
    return (
      !isWalledOff(barrier, pixelIndex) &&
      (allNonInk || (
        isWithinTolerance(data, pixelIndex, target, maximumDistanceSquared) &&
        isWithinColourRange(data, pixelIndex, target, colourRangeSquared)
      )) &&
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
    return { mask: visited, spans, count: visitedCount, bridged: [], widestStepDistanceSquared };
  }

  // A guide line is thicker than the shape it divides. Where two lines pinch,
  // the way through is a sliver of the pixels they both run over, and there is
  // no run of whole pixels left to walk down: the point of a narrow wedge is
  // reached over the pieces the lines cut those pixels into, not over the
  // pixels themselves. The pieces are only a way through; what each of them
  // takes of the pixel it lies in is settled later, by its share.
  const memory = barrier === null ? null : createWallScratch();
  const wallPending = [];
  // Pixels this walk reached over the pieces rather than over their neighbours.
  // A later pass that asks again what is joined to what has to start from these
  // as well, because it asks the question a pixel at a time.
  const bridged = [];
  const wallSeen = barrier === null ? null : new Uint8Array(width * height);
  // Whether a pixel the lines run over is this area's is a question about the
  // page the guide was drawn over, for the same reason the shares are: the
  // pixel now carries paint from every area it has been shared out to.
  const wallData = barrier !== null && barrier.paper !== null ? barrier.paper : data;
  const wallTarget = barrier === null ? null : {
    red: wallData[firstPixel * 4],
    green: wallData[firstPixel * 4 + 1],
    blue: wallData[firstPixel * 4 + 2],
    alpha: wallData[firstPixel * 4 + 3],
  };
  const wallHolds = (pixelIndex) =>
    isWithinTolerance(wallData, pixelIndex, wallTarget, maximumDistanceSquared);

  // A wall pixel now carries the colours painted on every side of it, so only
  // the page below the guide can say whether another wall pixel is one this
  // area's piece may cross. Beside the wall, however, the picture as it is now
  // decides whether the piece still borders this area. Looking at the old page
  // there let a guide laid over white act as a tunnel past a face painted later:
  // two currently separate areas of the same colour then became one bucket
  // region. A piece touching such a different current face stops there.
  const wallPieceRunsClear = (polygon, x, y) => {
    for (const [towardsX, towardsY, axis] of WALL_SIDES) {
      const nextX = x + towardsX;
      const nextY = y + towardsY;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }
      const side = towardsX + towardsY > 0 ? 0.5 : -0.5;
      if (wallPieceSpan(polygon, axis, side) === null) {
        continue;
      }
      const neighbour = nextY * width + nextX;
      const neighbourHolds = isWalledOff(barrier, neighbour)
        ? wallHolds(neighbour)
        : belongs(neighbour);
      if (!neighbourHolds) {
        return false;
      }
    }
    return true;
  };

  const reachIntoWall = (pixelIndex, axis, side, span, from, fromPiece, stepX, stepY) => {
    if (!isWalledOff(barrier, pixelIndex) || !wallHolds(pixelIndex)) {
      return;
    }
    const x = pixelIndex % width;
    const y = (pixelIndex - x) / width;
    const shapes = wallPieceShapes(memory, barrier, pixelIndex);
    for (let piece = 0; piece < shapes.length; piece += 1) {
      const taken = 1 << piece;
      if ((wallSeen[pixelIndex] & taken) !== 0) {
        continue;
      }
      const joins = from === null
        ? spansMeet(span, wallPieceSpan(shapes[piece].polygon, axis, -side))
        : wallPiecesJoin(from, fromPiece, span, shapes, piece, axis, side, stepX, stepY);
      if (!joins || !wallPieceRunsClear(shapes[piece].polygon, x, y)) {
        continue;
      }
      wallSeen[pixelIndex] |= taken;
      wallPending.push(pixelIndex * 4 + piece);
    }
  };

  // Every side of a free pixel is open along its whole length, so a piece of
  // the wall beside it is reached wherever it touches that side at all.
  const WHOLE_SIDE = { low: -0.5, high: 0.5 };
  const reachOutOfArea = (pixelIndex, axis, side) => {
    reachIntoWall(pixelIndex, axis, side, WHOLE_SIDE, null, 0, 0, 0);
  };

  const stepAlongWall = (node) => {
    const piece = node % 4;
    const at = (node - piece) / 4;
    const x = at % width;
    const y = (at - x) / width;
    const shapes = wallPieceShapes(memory, barrier, at);
    const { polygon } = shapes[piece];
    for (const [towardsX, towardsY, axis] of WALL_SIDES) {
      const nextX = x + towardsX;
      const nextY = y + towardsY;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }
      const side = towardsX + towardsY > 0 ? 0.5 : -0.5;
      const here = wallPieceSpan(polygon, axis, side);
      if (here === null) {
        continue;
      }
      const neighbour = nextY * width + nextX;
      if (isWalledOff(barrier, neighbour)) {
        reachIntoWall(neighbour, axis, side, here, shapes, piece, towardsX, towardsY);
      } else if (!visited[neighbour] && belongs(neighbour)) {
        pending.push(neighbour);
        bridged.push(neighbour);
      }
    }
  };

  while (pending.length > 0 || wallPending.length > 0) {
    if (pending.length === 0) {
      stepAlongWall(wallPending.pop());
      continue;
    }

    const pixelIndex = pending.pop();
    if (visited[pixelIndex] || !belongs(pixelIndex)) {
      continue;
    }

    const pixelX = pixelIndex % width;
    const pixelY = Math.floor(pixelIndex / width);
    const rowStart = pixelY * width;
    let left = pixelX;
    let right = pixelX;

    while (left > 0 && !visited[rowStart + left - 1] && belongs(rowStart + left - 1)
      && noStepOver(rowStart + left, rowStart + left - 1)) {
      left -= 1;
    }

    while (right + 1 < width && !visited[rowStart + right + 1] && belongs(rowStart + right + 1)
      && noStepOver(rowStart + right, rowStart + right + 1)) {
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
        const upperMatches = !visited[upperPixel] && belongs(upperPixel)
          && noStepOver(currentPixel, upperPixel);
        // Adjacent entrances are one queued span only when that other row can
        // also be walked between them. Its colour step may be wider than the
        // vertical ones, in which case one seed cannot stand in for the next.
        const upperContinuesSpan = upperMatches && upperSpanQueued
          && noStepOver(upperPixel - 1, upperPixel);
        if (upperMatches && !upperContinuesSpan) {
          pending.push(upperPixel);
        } else if (!upperMatches && barrier !== null) {
          reachOutOfArea(upperPixel, 1, -0.5);
        }
        upperSpanQueued = upperMatches;
      }

      if (pixelY + 1 < height) {
        const lowerPixel = currentPixel + width;
        const lowerMatches = !visited[lowerPixel] && belongs(lowerPixel)
          && noStepOver(currentPixel, lowerPixel);
        const lowerContinuesSpan = lowerMatches && lowerSpanQueued
          && noStepOver(lowerPixel - 1, lowerPixel);
        if (lowerMatches && !lowerContinuesSpan) {
          pending.push(lowerPixel);
        } else if (!lowerMatches && barrier !== null) {
          reachOutOfArea(lowerPixel, 1, 0.5);
        }
        lowerSpanQueued = lowerMatches;
      }
    }

    if (barrier !== null) {
      if (left > 0) {
        reachOutOfArea(rowStart + left - 1, 0, -0.5);
      }
      if (right + 1 < width) {
        reachOutOfArea(rowStart + right + 1, 0, 0.5);
      }
    }

    if (recordVisitedSpans) {
      recordSpan(spans, rowStart + left, right - left + 1);
    }
  }

  return { mask: visited, spans, count: visitedCount, bridged, widestStepDistanceSquared };
}

function selectedRegionBounds(region, width, height) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  forEachSpanPixel(region.spans, width, (pixelIndex, pixelX, pixelY) => {
    if (!region.mask[pixelIndex]) return;
    left = Math.min(left, pixelX);
    right = Math.max(right, pixelX);
    top = Math.min(top, pixelY);
    bottom = Math.max(bottom, pixelY);
  });

  return right === -1 ? null : { left, right, top, bottom };
}

function stablePaleGroundBounds(
  data,
  width,
  height,
  firstPixel,
  target,
  maximumDistanceSquared,
  fullRegion,
  guardDrawing,
  guardPaper,
) {
  const stableDistanceSquared = toleranceDistanceSquared(PALE_GROUND_SHAPE_TOLERANCE, target);
  if (maximumDistanceSquared <= stableDistanceSquared) return null;

  const stableRegion = collectContiguousRegion(
    data,
    width,
    height,
    firstPixel,
    target,
    stableDistanceSquared,
    true,
    null,
    guardDrawing,
    guardPaper,
    false,
    false,
    stableDistanceSquared,
    colourRangeSquaredFor(PALE_GROUND_SHAPE_TOLERANCE),
  );
  if (stableRegion.count < MIN_PLATEAU_PIXELS) return null;

  const stable = selectedRegionBounds(stableRegion, width, height);
  const full = selectedRegionBounds(fullRegion, width, height);
  if (stable === null || full === null) return null;

  const stableWidth = stable.right - stable.left + 1;
  const stableHeight = stable.bottom - stable.top + 1;
  const fullWidth = full.right - full.left + 1;
  const fullHeight = full.bottom - full.top + 1;
  const keepHorizontalBounds =
    fullWidth - stableWidth > EDGE_RAMP_REACH &&
    stableWidth / fullWidth >= PALE_GROUND_BOUND_EXTENT_RATIO;
  const keepVerticalBounds =
    fullHeight - stableHeight > EDGE_RAMP_REACH &&
    stableHeight / fullHeight >= PALE_GROUND_BOUND_EXTENT_RATIO;
  if (!keepHorizontalBounds && !keepVerticalBounds) return null;

  return {
    left: keepHorizontalBounds ? stable.left : 0,
    right: keepHorizontalBounds ? stable.right : width - 1,
    top: keepVerticalBounds ? stable.top : 0,
    bottom: keepVerticalBounds ? stable.bottom : height - 1,
  };
}

// What the bounds are for is a shadow that falls off the panel and shades away:
// the panel's own edge, not a thing in its own right. A pixel standing in a run
// of one colour is such a thing - a strip, a band, another face - and the range
// is what decides whether it belongs, as it does everywhere else. Fencing those
// out as well meant no setting could ever reach them, however wide.
function trimRegionToBounds(data, region, width, height, bounds) {
  if (bounds === null) return;
  forEachSpanPixel(region.spans, width, (pixelIndex, pixelX, pixelY) => {
    if (
      region.mask[pixelIndex] &&
      (
        pixelX < bounds.left ||
        pixelX > bounds.right ||
        pixelY < bounds.top ||
        pixelY > bounds.bottom
      ) &&
      !belongsToFlatRun(data, width, height, pixelIndex, true)
    ) {
      region.mask[pixelIndex] = 0;
      region.count -= 1;
    }
  });
}

// The ordinary region walk answers whether a pixel can be reached at the
// chosen tolerance. It does not say whether the route only opened at this
// exact slider stop. When that happens behind one comparatively strong colour
// step, every pixel on the far side used to arrive as full paint at once.
//
// Walk the already-selected region again with a slightly stricter range and
// step limit. Only the pieces cut off by that stricter walk need a strength. A
// small bucketed widest-path pass gives every such piece the first integer
// tolerance at which its connection opens; ordinary gradual shading remains
// in the core.
function collectStepEntryStrength(
  data,
  width,
  height,
  fullRegion,
  coreRegion,
  target,
  currentTolerance,
) {
  const state = coreRegion.mask;
  const pixelCount = width * height;
  const highestBucket = Math.min(100, Math.ceil(currentTolerance));
  const buckets = Array.from({ length: highestBucket + 1 }, () => []);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (fullRegion.mask[pixelIndex] === 0) {
      state[pixelIndex] = 0;
    } else {
      state[pixelIndex] = state[pixelIndex] !== 0 ? 254 : 255;
    }
  }

  const offer = (pixelIndex, requiredTolerance) => {
    if (requiredTolerance > highestBucket) return;
    const encoded = requiredTolerance + 1;
    if (state[pixelIndex] === 255 || encoded < state[pixelIndex]) {
      state[pixelIndex] = encoded;
      buckets[requiredTolerance].push(pixelIndex);
    }
  };

  const inspectCoreEdge = (pixelIndex, neighbor) => {
    if (state[neighbor] !== 254) return;
    offer(pixelIndex, Math.max(
      toleranceForDistanceSquared(seedDistanceSquaredAt(data, pixelIndex, target), target),
      toleranceForDistanceSquared(
        pixelStepDistanceSquared(data, pixelIndex, neighbor),
        target,
      ),
    ));
  };

  forEachSpanPixel(fullRegion.spans, width, (pixelIndex) => {
    if (state[pixelIndex] !== 255) return;
    const pixelX = pixelIndex % width;
    if (pixelIndex >= width) inspectCoreEdge(pixelIndex, pixelIndex - width);
    if (pixelX + 1 < width) inspectCoreEdge(pixelIndex, pixelIndex + 1);
    if (pixelIndex + width < pixelCount) inspectCoreEdge(pixelIndex, pixelIndex + width);
    if (pixelX > 0) inspectCoreEdge(pixelIndex, pixelIndex - 1);
  });

  const relax = (pixelIndex, neighbor, requiredTolerance) => {
    if (fullRegion.mask[neighbor] === 0 || state[neighbor] === 254) return;
    const nextTolerance = Math.max(
      requiredTolerance,
      toleranceForDistanceSquared(seedDistanceSquaredAt(data, neighbor, target), target),
      toleranceForDistanceSquared(pixelStepDistanceSquared(data, pixelIndex, neighbor), target),
    );
    offer(neighbor, nextTolerance);
  };

  for (let requiredTolerance = 0; requiredTolerance <= highestBucket; requiredTolerance += 1) {
    const bucket = buckets[requiredTolerance];
    while (bucket.length > 0) {
      const pixelIndex = bucket.pop();
      if (state[pixelIndex] !== requiredTolerance + 1) continue;
      const pixelX = pixelIndex % width;
      if (pixelIndex >= width) relax(pixelIndex, pixelIndex - width, requiredTolerance);
      if (pixelX + 1 < width) relax(pixelIndex, pixelIndex + 1, requiredTolerance);
      if (pixelIndex + width < pixelCount) relax(pixelIndex, pixelIndex + width, requiredTolerance);
      if (pixelX > 0) relax(pixelIndex, pixelIndex - 1, requiredTolerance);
    }
  }

  return { state, currentTolerance, data, target };
}

function stepEntryCoverageAt(entryStrength, pixelIndex) {
  if (entryStrength === null) return 1;
  const encoded = entryStrength.state[pixelIndex];
  if (encoded === 0 || encoded >= 254) return 1;
  const requiredTolerance = encoded - 1;
  const ownTolerance = toleranceForDistanceSquared(
    seedDistanceSquaredAt(entryStrength.data, pixelIndex, entryStrength.target),
    entryStrength.target,
  );
  // A gradual shade reaches the range because of its own colour and should be
  // painted normally. Only a stronger bottleneck elsewhere fades this pixel.
  if (requiredTolerance <= ownTolerance) return 1;
  const position = Math.min(1, Math.max(
    0,
    (entryStrength.currentTolerance - requiredTolerance + 1) / EDGE_ENTRY_TRANSITION,
  ));
  return position * position * (3 - 2 * position);
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
  softEdges = true,
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
  const maximumDistanceSquared = toleranceDistanceSquared(tolerance, target);
  const clickedInk = isDrawnInk(data, firstPixel);
  const fillsEveryNonInkColour =
    protectDrawing && wholePicture &&
    maximumDistanceSquared >= farthestDistanceSquaredFrom(target);
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
    maximumDistanceSquared,
    colourRangeSquaredFor(tolerance),
  );
  let selectedCount = fullRegion.count;
  const whitePaper = protectDrawing && isWhiteBackground(target);
  // A panel laid on the page is a ground too, and what is drawn on it casts its
  // edges into it. Only that one pass is shared: how an edge is rebuilt, and
  // what counts as a pocket, are the page's own questions and stay with it.
  //
  // A ground is something a drawing sits on, which means there has to be some
  // of it: a stray pale pixel between two strokes is not a panel, and walking
  // out of one would only swallow the strokes either side. Asked for the whole
  // picture, every face is already in hand and there is nothing to walk to.
  const paleGround = protectDrawing && !whitePaper && !wholePicture
    && isPaleBackground(target);

  let paleGroundBounds = null;
  if (softEdges && paleGround && fullRegion.count >= MIN_PLATEAU_PIXELS) {
    // A band of colour is a face like any other: what the line encloses is
    // what the bucket paints. Paper the brush left showing inside the band,
    // and the pale rim between the band and the stroke beside it, are part of
    // it and were being left behind as flecks of white.
    reachRimToInk(data, width, height, fullRegion, target, barrier);
    extendRegionToInk(
      data, width, height, fullRegion, target, barrier,
      Math.max(maximumDistanceSquared, 1),
    );
    // Once the skirt is in it becomes a rim of its own, so the walk is worth a
    // second round; and grain the two of them have closed around is enclosed
    // at last, which is what the pocket pass is left to find.
    reachRimToInk(data, width, height, fullRegion, target, barrier);
    fillEnclosedPockets(data, width, height, fullRegion, target, barrier);
    if (barrier === null) {
      paleGroundBounds = stablePaleGroundBounds(
        data,
        width,
        height,
        firstPixel,
        target,
        maximumDistanceSquared,
        fullRegion,
        guardDrawing,
        guardPaper,
      );
      trimRegionToBounds(data, fullRegion, width, height, paleGroundBounds);
    }
    selectedCount = fullRegion.count;
  }

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
    // Reaching out to the line art is an edge repair: it takes in the pale rim
    // the range stopped at, so a fill meets the drawing instead of stopping a
    // pixel short. Asked for no antialiasing, the range is the whole answer and
    // nothing reaches past what it chose.
    if (softEdges) {
      reachRimToInk(data, width, height, fullRegion, target, barrier);
      extendRegionToInk(data, width, height, fullRegion, target, barrier);
      // Once the skirt is in, it becomes a starting point of its own, and grain
      // caught between the face and a stroke is enclosed at last. A second round
      // of both passes picks up the flecks that were unreachable before.
      reachRimToInk(data, width, height, fullRegion, target, barrier);
      extendRegionToInk(data, width, height, fullRegion, target, barrier);
    }
    selectedCount = fillEnclosedPockets(data, width, height, fullRegion, target, barrier);
  }

  // Edge repair can add the very pixels whose connection has just opened, so
  // measure the entry strength only after those additions are in the mask.
  let stepEntryStrength = null;
  const numericTolerance = Math.sqrt(
    maximumDistanceSquared / farthestDistanceSquaredFrom(target),
  ) * 100;
  const coreTolerance = Math.max(0, numericTolerance - EDGE_ENTRY_TRANSITION);
  const coreDistanceSquared = toleranceDistanceSquared(coreTolerance, target);
  let hasEntryFringe = fullRegion.widestStepDistanceSquared > coreDistanceSquared;
  if (!hasEntryFringe && numericTolerance > 0 && numericTolerance < 100) {
    // Flat areas and ordinary gradients do not need a second flood. Edge
    // repair may have enlarged the selected mask since the first walk, so
    // inspect the finished spans as well as the steps recorded by that walk.
    forEachSpanPixel(fullRegion.spans, width, (pixelIndex) => {
      if (
        !hasEntryFringe &&
        fullRegion.mask[pixelIndex] &&
        seedDistanceSquaredAt(data, pixelIndex, target) > coreDistanceSquared
      ) {
        hasEntryFringe = true;
      }
    });
  }
  if (
    softEdges &&
    !wholePicture &&
    barrier === null &&
    numericTolerance > 0 &&
    numericTolerance < 100 &&
    hasEntryFringe
  ) {
    const coreRegion = collectContiguousRegion(
      data,
      width,
      height,
      firstPixel,
      target,
      coreDistanceSquared,
      true,
      barrier,
      guardDrawing,
      guardPaper,
      wholePicture,
      fillsEveryNonInkColour,
      coreDistanceSquared,
      colourRangeSquaredFor(coreTolerance),
    );
    // The stricter walk is the baseline for what a narrower range already
    // painted, so it has to be the whole of what that range paints. Paper the
    // repair passes take in - a pocket inside a glyph, a rim running into a
    // stroke - is painted at full strength there. Leaving it out of the
    // baseline made the wider range fade in paper the narrower one had already
    // laid down solid.
    if (whitePaper) {
      fillEnclosedPockets(data, width, height, coreRegion, target, barrier);
      keepSeedComponent(
        data,
        coreRegion,
        width,
        height,
        firstPixel,
        target,
        Math.max(coreDistanceSquared, PAPER_FLOOR_DISTANCE_SQUARED),
        barrier,
      );
      reachRimToInk(data, width, height, coreRegion, target, barrier);
      extendRegionToInk(data, width, height, coreRegion, target, barrier);
      reachRimToInk(data, width, height, coreRegion, target, barrier);
      extendRegionToInk(data, width, height, coreRegion, target, barrier);
      fillEnclosedPockets(data, width, height, coreRegion, target, barrier);
    }
    stepEntryStrength = collectStepEntryStrength(
      data,
      width,
      height,
      fullRegion,
      coreRegion,
      target,
      numericTolerance,
    );
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
  // usual ramp is collected for every other case: a coloured area, and the
  // eraser. White paper only needs the outside block that a screenshot may
  // have enlarged beyond the selected region.
  const edgeRamp =
    !rebuildEdges || !softEdges
      ? null
      : !whitePaper
        ? collectEdgeRamp(
          data,
          width,
          height,
          fullRegion,
          target,
          barrier,
          protectDrawing,
        )
        // A guide is the boundary the user chose. The long search below is
        // only for recovering an enlarged edge from the artwork itself; over
        // a guide it can see a distant stroke through a partly covered wall
        // pixel and paint the paper between them as a vertical stripe.
        : guardDrawing && !wholePicture && barrier === null
          ? collectPixelatedWhiteSkirt(
            data,
            width,
            height,
            fullRegion,
            target,
            barrier,
            maximumDistanceSquared,
            colourRangeSquaredFor(tolerance, target),
          )
          : null;
  const transparentEdge =
    softEdges && rebuildEdges && protectDrawing && target.alpha === 0
      ? includeTransparentEdge(data, width, height, fullRegion, barrier)
      : null;

  // Edge reconstruction may walk through the outside shadow while looking for
  // its backdrop. Keep the inferred colours, but do not select past the panel.
  trimRegionToBounds(data, fullRegion, width, height, paleGroundBounds);

  // The ramp is part of rebuilding the edge, so it is collected wherever the
  // edge is rebuilt. Asked only which pixels the range reaches, nothing is
  // drawn and nothing is added to the mask for drawing.
  if (rebuildEdges) {
    collectBlendedEdge(data, width, height, fullRegion, target, barrier);
  }

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
        stepEntryCoverageAt(stepEntryStrength, pixelIndex),
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

/**
 * The range says how much of the picture the cut takes, and how far into a soft
 * edge it reaches: widen it and the cut takes more of the edge with it. Inside
 * the cut every pixel goes whole. Only the edge is left partly standing, and in
 * the colour the drawing blended it with, which is what lets the saved picture
 * sit on another background without a staircase along it.
 *
 * softEdges is the older reading, where the shape of the mask settles the edge
 * rather than the drawing does. The eraser does not ask for it; the fill does.
 */
function eraseContiguousRegion(
  imageData, x, y, tolerance = 0, barrier = null, wholePicture = false,
  includeWhiteAndBlack = false, softEdges = false,
) {
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
    _transparentEdge,
    stepEntryCoverage,
  ) => {
    const offset = pixelIndex * 4;
    const alphaOffset = offset + 3;
    const sourceRed = result.data[offset];
    const sourceGreen = result.data[offset + 1];
    const sourceBlue = result.data[offset + 2];
    const sourceAlpha = result.data[alphaOffset];
    try {

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

    // With the edges blended, an edge pixel holds part of the colour being
    // cleared and part of the colour beside it. Taking away only that share
    // leaves the rest of the pixel standing, in the colour it was blended with,
    // which is the edge the drawing was made with. The ramp the range stopped
    // short of is taken in for this too: it is the same edge, and left whole it
    // stands around the hole in the colour the drawing gave it.
    const edgeMixShare =
      wallCoverage === -1 &&
      (mask[pixelIndex] === 1 || mask[pixelIndex] === BLENDED_EDGE) &&
      sourceAlpha === CHANNEL_MAX
        ? edgeMixtureShareAt(
          imageData.data,
          mask,
          imageData.width,
          imageData.height,
          pixelIndex,
          target,
        )
        : -1;
    if (edgeMixShare !== -1) {
      const standing = 1 - edgeMixShare;
      result.data[offset] = clampChannel((sourceRed - edgeMixShare * target.red) / standing);
      result.data[offset + 1] = clampChannel((sourceGreen - edgeMixShare * target.green) / standing);
      result.data[offset + 2] = clampChannel((sourceBlue - edgeMixShare * target.blue) / standing);
      result.data[alphaOffset] = clampChannel(sourceAlpha * standing);
      if (
        sourceRed !== result.data[offset] ||
        sourceGreen !== result.data[offset + 1] ||
        sourceBlue !== result.data[offset + 2] ||
        sourceAlpha !== result.data[alphaOffset]
      ) {
        changedPixels += 1;
      }
      return;
    }

    // On the wall the share of the pixel is already known from the line that
    // drew it, and it is finer than anything the mask's own shape can say.
    // Asked for no antialiasing, a pixel the range chose goes whole: the range
    // is the only thing left to say where the cut falls.
    const coverage = wallCoverage !== -1
      ? wallCoverage
      : !softEdges
        ? 1
        : innerEdgeCoverage(
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
    } finally {
      if (stepEntryCoverage < 1) {
        result.data[offset] = clampChannel(
          sourceRed + stepEntryCoverage * (result.data[offset] - sourceRed),
        );
        result.data[offset + 1] = clampChannel(
          sourceGreen + stepEntryCoverage * (result.data[offset + 1] - sourceGreen),
        );
        result.data[offset + 2] = clampChannel(
          sourceBlue + stepEntryCoverage * (result.data[offset + 2] - sourceBlue),
        );
        result.data[alphaOffset] = clampChannel(
          sourceAlpha + stepEntryCoverage * (result.data[alphaOffset] - sourceAlpha),
        );
      }
    }
  }, false, -1, true, wallFor(barrier, wholePicture), wholePicture, includeWhiteAndBlack, softEdges);

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
  softEdges = true,
  openedPaper = null,
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
  const firstPixel = nearbyWhiteSeed(imageData, x, y, tolerance, wall);
  const fillX = firstPixel === -1 ? x : firstPixel % imageData.width;
  const fillY = firstPixel === -1 ? y : Math.floor(firstPixel / imageData.width);
  const fillingTransparency =
    firstPixel !== -1 && imageData.data[firstPixel * 4 + 3] === 0;
  const fillsEveryNonInkColour =
    wholePicture && coversEveryColour(tolerance);
  const seedOffset = (firstPixel === -1 ? seedIndex(imageData, x, y) : firstPixel) * 4;
  // Whether the area asked for has already been painted since the line was
  // drawn. A first fill finds the paper the line was drawn over, and that is
  // what its share of a pixel on the line gives up. One that comes back to an
  // area it painted before finds that colour there instead, and gives up that.
  // Asking at the seed answers it for the whole area: a pixel on the line
  // cannot be asked, since two fills can leave one holding the colour the paper
  // had.
  const repaintingPaintedArea = barrier !== null && barrier.paper !== null && (
    barrier.paper[seedOffset] !== imageData.data[seedOffset]
    || barrier.paper[seedOffset + 1] !== imageData.data[seedOffset + 1]
    || barrier.paper[seedOffset + 2] !== imageData.data[seedOffset + 2]
  );
  const seedDiffersFromFill =
    imageData.data[seedOffset] !== normalizedColor.r ||
    imageData.data[seedOffset + 1] !== normalizedColor.g ||
    imageData.data[seedOffset + 2] !== normalizedColor.b;
  const oldGuideMixtureCache = new Map();
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
    stepEntryCoverage,
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
    try {

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
        // A settled dark edge stores straight ink plus its opacity, so the
        // white-matted pixel the ordinary white-paper bucket would have seen is
        // recreated first and the paper under it swapped for the new colour.
        //
        // Everything else the eraser leaves stores what the pixel still holds,
        // with the share of it that survived. There the new colour simply fills
        // the hole beside it. Reading that as ink over paper instead took the
        // whole pixel wherever what survived was close to the paper, which
        // swallowed the soft edge of a cut-out and squared off its corners.
        const foregroundWeight = sourceAlpha / CHANNEL_MAX;
        const settledInk = isDrawnInk(imageData.data, pixelIndex);

        if (!settledInk) {
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
          const drawnRed = clampChannel(
            sourceRed * foregroundWeight + CHANNEL_MAX * (1 - foregroundWeight),
          );
          const drawnGreen = clampChannel(
            sourceGreen * foregroundWeight + CHANNEL_MAX * (1 - foregroundWeight),
          );
          const drawnBlue = clampChannel(
            sourceBlue * foregroundWeight + CHANNEL_MAX * (1 - foregroundWeight),
          );
          const inkCoverage = Math.max(
            channelForegroundCoverage(drawnRed, CHANNEL_MAX),
            channelForegroundCoverage(drawnGreen, CHANNEL_MAX),
            channelForegroundCoverage(drawnBlue, CHANNEL_MAX),
          );
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
      wall !== null &&
      wallCoverage !== -1 &&
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

    // With the edges blended this is the whole of what the fill does: each pixel
    // gives up exactly the share of the old colour it holds, and keeps the rest.
    // A pixel that is all of it becomes the new colour outright; one that is
    // half of it comes out half way; one that is none of it is left alone.
    //
    // That last case is what keeps a wide range from tearing the boundary. A
    // range reaching past a shape into the ground around it otherwise takes
    // whichever of the ground's pixels happen to fall inside, and since those
    // vary pixel by pixel the edge breaks into spikes at one stop of the slider.
    const edgeMixShare =
      !fillingTransparency &&
      sourceAlpha === CHANNEL_MAX &&
      (!normalizedColor.hasExplicitAlpha || normalizedColor.a === CHANNEL_MAX) &&
      // A mixture is what a pixel between the area and the colour beside it
      // holds. One the area closes around is not between anything: it is a
      // speck of paper inside the face, and keeping a share of it left the
      // fill with white dots in it.
      !isSpeckInsideFace(
        imageData.data, mask, imageData.width, imageData.height, pixelIndex,
        target,
      )
        ? edgeMixtureShareAt(
          imageData.data,
          mask,
          imageData.width,
          imageData.height,
          pixelIndex,
          target,
        )
        : -1;
    // The ramp taken in for blending is nothing but edge: it is there to give up
    // its share and keep the rest, and none of the work below applies to it.
    if (mask[pixelIndex] === BLENDED_EDGE && edgeMixShare !== -1) {
      result.data[offset] = clampChannel(sourceRed + edgeMixShare * (normalizedColor.r - target.red));
      result.data[offset + 1] = clampChannel(sourceGreen + edgeMixShare * (normalizedColor.g - target.green));
      result.data[offset + 2] = clampChannel(sourceBlue + edgeMixShare * (normalizedColor.b - target.blue));
      if (
        sourceRed !== result.data[offset] ||
        sourceGreen !== result.data[offset + 1] ||
        sourceBlue !== result.data[offset + 2]
      ) {
        changedPixels += 1;
      }
      return;
    }
    if (mask[pixelIndex] === BLENDED_EDGE) {
      return;
    }

    // A pixel holding less of the colour being replaced than the paper grain
    // the fill already ignores is the ground the area stands on, not the area.
    // A range wide enough to reach that ground otherwise takes whichever of its
    // pixels happen to fall inside, and since those vary pixel by pixel the
    // boundary breaks into spikes at one stop of the slider.
    //
    // Two cases are the exception, and in both the pixel is a line's own edge
    // rather than grain beside a shape. Painting a line, the faint end of its
    // edge reads the same as grain, and leaving it grey is what left a
    // repainted line speckled with the colour it used to be. Painting the page
    // a line is drawn on, how much of the page a pixel holds is exactly what
    // the fill replaces, and the reading below works it out from the ink
    // rather than from a mixture.
    //
    // Nor does it apply to a pixel an edge repair put in the area on purpose:
    // the floor is there for pixels a wide range happened to reach, and a
    // repair has already decided that this one belongs.
    if (
      edgeMixShare !== -1 &&
      edgeMixShare < BACKGROUND_NOISE_COVERAGE &&
      mask[pixelIndex] === 1 &&
      !isInkTarget(target) &&
      !isWhiteBackground(target)
    ) {
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
        belongsToFlatRun(imageData.data, imageData.width, imageData.height, pixelIndex)
          ? EDGE_AS_DRAWN
          : EDGE_CONTRAST,
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
            oldGuideMixtureCache,
          )
          : null;
        if (crossingShare !== null) {
          result.data.set(replaceSolvedOklabShare(
            crossingShare,
            [target.red, target.green, target.blue],
            [normalizedColor.r, normalizedColor.g, normalizedColor.b],
          ), offset);
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

    // A stroke's edge that the range stops short of is not left as it was: the
    // edge repair takes it in and rebuilds it at its full share. Once a wider
    // range admits the same pixel itself, it has to be read the same way, or
    // widening the range would hand back paint a narrower one had already laid
    // down and change how the edge is read at one slider stop.
    const againstStroke =
      mask[pixelIndex] === 1 &&
      sitsAgainstStroke(
        imageData.data, mask, imageData.width, imageData.height, pixelIndex,
        target, openedPaper,
      );

    // On the wall the share of the pixel is already known from the line that
    // drew it, and it is finer than anything the mask's own shape can say.
    const coverage = wallCoverage !== -1
      ? wallCoverage
      : !softEdges
        ? 1
        : innerEdgeCoverage(
          mask,
          imageData.width,
          imageData.height,
          pixelX,
          pixelY,
          imageData.data,
          pixelIndex,
          target,
          maximumDistanceSquared,
          againstStroke,
        );
    const canPreserveWhiteAntialiasing =
      softEdges &&
      !fillingTransparency &&
      sourceAlpha === CHANNEL_MAX &&
      (!normalizedColor.hasExplicitAlpha || normalizedColor.a === CHANNEL_MAX);
    // A pixel on a drawn edge holds part of the colour being replaced and part
    // of the colour beside it. Everywhere below that would otherwise paint the
    // pixel whole, swapping out only that share keeps the edge as soft as the
    // drawing made it instead of stepping it.
    const wholeRed = edgeMixShare === -1
      ? normalizedColor.r
      : clampChannel(sourceRed + edgeMixShare * (normalizedColor.r - target.red));
    const wholeGreen = edgeMixShare === -1
      ? normalizedColor.g
      : clampChannel(sourceGreen + edgeMixShare * (normalizedColor.g - target.green));
    const wholeBlue = edgeMixShare === -1
      ? normalizedColor.b
      : clampChannel(sourceBlue + edgeMixShare * (normalizedColor.b - target.blue));

    // A pale outline the range stops short of still has a skirt beside it, and
    // every pixel of that skirt is part outline, part face. Swapping out only
    // the face's share keeps the edge as soft as it was drawn. Taking the
    // pixel whole, which is what a range wide enough to reach the skirt used to
    // do, flattens the outline against the new colour and leaves a hard, muddy
    // edge where a graded one belongs.
    // A pixel holding none of the colour being replaced holds none of an
    // outline either, and asking costs a walk, so the plain face is let past
    // without one.
    const outlineSkirtShare =
      softEdges &&
      canPreserveWhiteAntialiasing &&
      mask[pixelIndex] === 1 &&
      Math.max(
        target.red - sourceRed,
        target.green - sourceGreen,
        target.blue - sourceBlue,
      ) > 0
        ? outlineSkirtShareAt(
          imageData.data,
          mask,
          imageData.width,
          imageData.height,
          pixelIndex,
          target,
          openedPaper,
        )
        : -1;
    // A skirt holds part of the outline and part of the face. A pixel that is
    // all outline and no face is not a skirt: it is the outline's own body, and
    // where the range has taken that in, it is the range's to paint.
    const keepsOutlineSkirt = outlineSkirtShare !== -1 && outlineSkirtShare < 1;
    const backgroundWeight = !canPreserveWhiteAntialiasing
      ? null
      : keepsOutlineSkirt
        ? 1 - outlineSkirtShare
        : lightBackgroundWeight(
          imageData.data,
          imageData.width,
          imageData.height,
          pixelIndex,
          target,
          mask[pixelIndex] !== 1 || againstStroke,
        );
    const blackStrokeBackgroundWeight = backgroundWeight === null
      ? null
      : 1 - Math.max(
        channelForegroundCoverage(sourceRed, target.red),
        channelForegroundCoverage(sourceGreen, target.green),
        channelForegroundCoverage(sourceBlue, target.blue),
      );
    const lightOutlinePixel =
      backgroundWeight !== null &&
      (mask[pixelIndex] !== 1 || keepsOutlineSkirt) &&
      backgroundWeight < blackStrokeBackgroundWeight - 1e-9;
    let touchesSelectedFace = false;
    if (lightOutlinePixel) {
      for (
        let nearbyY = Math.max(0, pixelY - 1);
        nearbyY <= Math.min(imageData.height - 1, pixelY + 1);
        nearbyY += 1
      ) {
        for (
          let nearbyX = Math.max(0, pixelX - 1);
          nearbyX <= Math.min(imageData.width - 1, pixelX + 1);
          nearbyX += 1
        ) {
          if (mask[nearbyY * imageData.width + nearbyX] === 1) {
            touchesSelectedFace = true;
          }
        }
      }
    }

    // A pale solid outline and its outside ramp keep their original colour.
    // Only the ramp touching the range-selected face receives the new
    // background, which closes the inside without growing a fringe outside.
    if (
      lightOutlinePixel &&
      (
        backgroundWeight < BACKGROUND_NOISE_COVERAGE ||
        !touchesSelectedFace
      )
    ) {
      return;
    }

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
        result.data[offset] = wholeRed;
        result.data[offset + 1] = wholeGreen;
        result.data[offset + 2] = wholeBlue;
        result.data[offset + 3] = replacementAlpha;
        if (sourceRed !== wholeRed || sourceGreen !== wholeGreen
          || sourceBlue !== wholeBlue || sourceAlpha !== replacementAlpha) {
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
      const inferredOldGuideShare =
        wall === null &&
        !wholePicture &&
        maximumDistanceSquared < farthestDistanceSquaredFrom(target) &&
        carriesUnevenColour
        ? localTargetShareAt(
          imageData.data,
          imageData.width,
          imageData.height,
          pixelX,
          pixelY,
          target,
          1,
          oldGuideMixtureCache,
        )
        : null;
      // A selected ordinary edge is normally handled by its ink coverage. A
      // deleted straight guide is the exception: its centre pixel is selected
      // as a whole even though half still belongs to the already-painted face.
      // Admit that exact half-share without making every selected colour ramp
      // look like a former guide.
      const oldGuideShare =
        inferredOldGuideShare !== null &&
        (
          coverageByPaperFloorOnly ||
          mask[pixelIndex] !== 1 ||
          (coverage === 1 && Math.abs(inferredOldGuideShare.share - 0.5) <= 0.02)
        )
          ? inferredOldGuideShare
          : null;

      if (oldGuideShare !== null) {
        result.data.set(replaceSolvedOklabShare(
          oldGuideShare,
          [target.red, target.green, target.blue],
          [normalizedColor.r, normalizedColor.g, normalizedColor.b],
        ), offset);
        // Replacing the last share of the paper with the same colour already
        // on the other side should close the seam exactly. Conversion through
        // OKLab can miss by a level or two at a clipped channel; snap
        // only that indistinguishable remainder to the flat fill.
        if (
          Math.max(
            Math.abs(result.data[offset] - normalizedColor.r),
            Math.abs(result.data[offset + 1] - normalizedColor.g),
            Math.abs(result.data[offset + 2] - normalizedColor.b),
          ) <= 2
        ) {
          result.data.set([normalizedColor.r, normalizedColor.g, normalizedColor.b], offset);
        }
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
        !lightOutlinePixel &&
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
      // Grain a few levels off the paper carries no outline worth keeping, even
      // where an outline stands near enough to explain it. A run of one colour
      // is the exception: that is one pixel of the drawing shown larger, and
      // the share it holds was settled when the drawing was made.
      const skirtUnderTheFloor =
        keepsOutlineSkirt &&
        belongsToFlatRun(imageData.data, imageData.width, imageData.height, pixelIndex);
      if (
        repaintingFace ||
        (!skirtUnderTheFloor && coverage === 1 && inkCoverage < BACKGROUND_NOISE_COVERAGE)
      ) {
        // Giving up a share keeps an edge the drawing made. A pixel of a face
        // being repainted has no edge to keep, and reading a share off it
        // instead leaves the seam of a moved guide a level or two short of the
        // colour on either side of it.
        const [faceRed, faceGreen, faceBlue] = repaintingFace
          ? [normalizedColor.r, normalizedColor.g, normalizedColor.b]
          : [wholeRed, wholeGreen, wholeBlue];
        result.data[offset] = faceRed;
        result.data[offset + 1] = faceGreen;
        result.data[offset + 2] = faceBlue;
        result.data[offset + 3] = replacementAlpha;
        if (sourceRed !== faceRed || sourceGreen !== faceGreen
          || sourceBlue !== faceBlue || sourceAlpha !== replacementAlpha) {
          changedPixels += 1;
        }
        return;
      }

      if (
        !lightOutlinePixel &&
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
      if (wallCoverage !== -1 && wallCoverage < 1) {
        // Encoded RGB averages complementary colours too dark. Replace the
        // wall's share in OKLab so the boundary stays halfway between the
        // perceived lightness of the colours on either side.
        result.data.set(replaceOklabShare(
          [sourceRed, sourceGreen, sourceBlue],
          [target.red, target.green, target.blue],
          [normalizedColor.r, normalizedColor.g, normalizedColor.b],
          coverage,
        ), offset);
      } else {
        const replacementWeight = coverage * backgroundWeight;
        result.data[offset] = clampChannel(
          sourceRed + replacementWeight * (normalizedColor.r - target.red),
        );
        result.data[offset + 1] = clampChannel(
          sourceGreen + replacementWeight * (normalizedColor.g - target.green),
        );
        result.data[offset + 2] = clampChannel(
          sourceBlue + replacementWeight * (normalizedColor.b - target.blue),
        );
      }
    } else if (coverage === 1) {
      result.data[offset] = wholeRed;
      result.data[offset + 1] = wholeGreen;
      result.data[offset + 2] = wholeBlue;
      result.data[offset + 3] = replacementAlpha;
    } else if (
      wallCoverage !== -1 &&
      normalizedColor.a === CHANNEL_MAX &&
      !fillingTransparency &&
      sourceAlpha === CHANNEL_MAX
    ) {
      // A pixel the line runs through is shared with the fill on the other side
      // of it, and the two shares are the whole of it. Each side replaces its
      // own share of the paper rather than painting over whatever the other
      // side left there: painted one over the other, a quarter of the paper
      // survived in the seam, in a colour belonging to neither fill and
      // depending on which side was painted first.
      //
      // What the share gives up is this pixel's own paper, unless the area was
      // painted before, in which case it gives up the colour being replaced.
      // The pixel's own paper is what matters where a line runs over more than
      // one colour: the point of a narrow wedge is nearly all pixels the line
      // runs through, and measuring their share against the colour clicked on
      // far away drove them away from the fill instead of towards it.
      const knownPaper = wall !== null && wall.paper !== null;
      const replacedRed = !knownPaper ? sourceRed
        : repaintingPaintedArea ? target.red : wall.paper[offset];
      const replacedGreen = !knownPaper ? sourceGreen
        : repaintingPaintedArea ? target.green : wall.paper[offset + 1];
      const replacedBlue = !knownPaper ? sourceBlue
        : repaintingPaintedArea ? target.blue : wall.paper[offset + 2];
      result.data.set(replaceOklabShare(
        [sourceRed, sourceGreen, sourceBlue],
        [replacedRed, replacedGreen, replacedBlue],
        [normalizedColor.r, normalizedColor.g, normalizedColor.b],
        coverage,
      ), offset);
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
    } finally {
      if (stepEntryCoverage < 1) {
        result.data[offset] = clampChannel(
          sourceRed + stepEntryCoverage * (result.data[offset] - sourceRed),
        );
        result.data[offset + 1] = clampChannel(
          sourceGreen + stepEntryCoverage * (result.data[offset + 1] - sourceGreen),
        );
        result.data[offset + 2] = clampChannel(
          sourceBlue + stepEntryCoverage * (result.data[offset + 2] - sourceBlue),
        );
        result.data[offset + 3] = clampChannel(
          sourceAlpha + stepEntryCoverage * (result.data[offset + 3] - sourceAlpha),
        );
      }
    }
  }, true, originalPixel, true, wall, wholePicture, includeWhiteAndBlack, softEdges);

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
