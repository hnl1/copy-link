/**
 * 文本差异对比的纯逻辑：基于 Myers O(ND) 算法的两级 diff。
 * - 先按行做 diff 定位变化块；
 * - 再在配对的变化行内部做词级 diff，得到行内高亮。
 * 算法对相似的大文本很快；差异过大时按 maxD 截断并退化为整体替换。
 */

/** 行级 diff 的最大编辑距离，超出后退化为粗粒度替换（控制内存/耗时） */
const LINE_MAX_D = 3000;
/** 词级 diff 的最大编辑距离 */
const WORD_MAX_D = 3000;

/**
 * 把一行切成词级 token：英文/数字/下划线连成词，空白连成一段，其余（含 CJK、标点）逐字符。
 * @param {string} str
 * @returns {string[]}
 */
export function tokenizeWords(str) {
  if (!str) return [];
  return str.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/gu) || [];
}

/**
 * 按行切分，兼容 \r\n、\r、\n。
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return String(text ?? "").split(/\r\n|\r|\n/);
}

/**
 * @param {{ type: string, value: unknown[] }[]} segs
 * @param {string} type
 * @param {unknown} token
 */
function pushToken(segs, type, token) {
  const last = segs[segs.length - 1];
  if (last && last.type === type) last.value.push(token);
  else segs.push({ type, value: [token] });
}

/**
 * Myers O(ND) 差异算法，返回按 token 分组的编辑序列；编辑距离超过 maxD 时返回 null。
 * @template T
 * @param {T[]} a
 * @param {T[]} b
 * @param {{ maxD?: number, eq?: (x: T, y: T) => boolean }} [options]
 * @returns {{ type: "equal" | "delete" | "insert", value: T[] }[] | null}
 */
export function myersDiff(a, b, options = {}) {
  const N = a.length;
  const M = b.length;
  const eq = options.eq || ((x, y) => x === y);
  const total = N + M;
  if (total === 0) return [];

  const cap = options.maxD == null ? total : Math.min(options.maxD, total);
  const limit = Math.max(cap, 1);
  const offset = limit;
  const size = 2 * limit + 1;
  const v = new Int32Array(size);
  v[offset + 1] = 0;

  /** @type {Int32Array[]} */
  const trace = [];
  let found = false;
  let foundD = 0;

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && eq(a[x], b[y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        found = true;
        foundD = d;
        break;
      }
    }
    if (found) break;
  }

  if (!found) return null;

  /** @type {{ type: "equal" | "delete" | "insert", a?: number, b?: number }[]} */
  const moves = [];
  let x = N;
  let y = M;
  for (let d = foundD; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      moves.push({ type: "equal", a: x - 1, b: y - 1 });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        moves.push({ type: "insert", b: y - 1 });
      } else {
        moves.push({ type: "delete", a: x - 1 });
      }
      x = prevX;
      y = prevY;
    }
  }
  moves.reverse();

  /** @type {{ type: "equal" | "delete" | "insert", value: T[] }[]} */
  const segs = [];
  for (const mv of moves) {
    if (mv.type === "equal") pushToken(segs, "equal", a[/** @type {number} */ (mv.a)]);
    else if (mv.type === "delete") pushToken(segs, "delete", a[/** @type {number} */ (mv.a)]);
    else pushToken(segs, "insert", b[/** @type {number} */ (mv.b)]);
  }
  return segs;
}

/**
 * @param {{ type: string, value: unknown[] }[]} segs
 * @returns {{ type: string, value: unknown[] }[]}
 */
function mergeSegs(segs) {
  /** @type {{ type: string, value: unknown[] }[]} */
  const out = [];
  for (const s of segs) {
    if (!s.value.length) continue;
    const last = out[out.length - 1];
    if (last && last.type === s.type) last.value = last.value.concat(s.value);
    else out.push({ type: s.type, value: s.value.slice() });
  }
  return out;
}

/**
 * 对 token 数组做 diff，先裁剪公共前后缀再跑 Myers；超过 maxD 时退化为整体替换。
 * @template T
 * @param {T[]} a
 * @param {T[]} b
 * @param {{ maxD?: number, eq?: (x: T, y: T) => boolean }} [options]
 * @returns {{ type: "equal" | "delete" | "insert", value: T[] }[]}
 */
export function diffTokens(a, b, options = {}) {
  const eq = options.eq || ((x, y) => x === y);
  const n = a.length;
  const m = b.length;

  let pre = 0;
  while (pre < n && pre < m && eq(a[pre], b[pre])) pre++;
  let aEnd = n;
  let bEnd = m;
  while (aEnd > pre && bEnd > pre && eq(a[aEnd - 1], b[bEnd - 1])) {
    aEnd--;
    bEnd--;
  }

  /** @type {{ type: "equal" | "delete" | "insert", value: T[] }[]} */
  const segs = [];
  if (pre > 0) segs.push({ type: "equal", value: a.slice(0, pre) });

  const aMid = a.slice(pre, aEnd);
  const bMid = b.slice(pre, bEnd);
  if (aMid.length && bMid.length) {
    const mid = myersDiff(aMid, bMid, options);
    if (mid) {
      for (const s of mid) segs.push(s);
    } else {
      segs.push({ type: "delete", value: aMid });
      segs.push({ type: "insert", value: bMid });
    }
  } else if (aMid.length) {
    segs.push({ type: "delete", value: aMid });
  } else if (bMid.length) {
    segs.push({ type: "insert", value: bMid });
  }

  if (aEnd < n) segs.push({ type: "equal", value: a.slice(aEnd) });

  return /** @type {{ type: "equal" | "delete" | "insert", value: T[] }[]} */ (mergeSegs(segs));
}

/**
 * @typedef {{ type: "equal" | "del" | "add", text: string }} Part
 */

/**
 * @param {Part[]} parts
 * @param {"equal" | "del" | "add"} type
 * @param {string} text
 */
function pushPart(parts, type, text) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.type === type) last.text += text;
  else parts.push({ type, text });
}

/**
 * 对配对的一行旧文本 / 新文本做词级 diff，返回左右两侧的高亮片段。
 * @param {string} aLine
 * @param {string} bLine
 * @returns {{ left: Part[], right: Part[] }}
 */
export function diffLineParts(aLine, bLine) {
  const segs = diffTokens(tokenizeWords(aLine), tokenizeWords(bLine), { maxD: WORD_MAX_D });
  /** @type {Part[]} */
  const left = [];
  /** @type {Part[]} */
  const right = [];
  for (const seg of segs) {
    const text = seg.value.join("");
    if (seg.type === "equal") {
      pushPart(left, "equal", text);
      pushPart(right, "equal", text);
    } else if (seg.type === "delete") {
      pushPart(left, "del", text);
    } else {
      pushPart(right, "add", text);
    }
  }
  return { left, right };
}

/**
 * @typedef {{ type: "equal" | "del" | "add", no: number, parts: Part[] }} LineEntry
 * @typedef {{ left: LineEntry | null, right: LineEntry | null }} SideRow
 * @typedef {{ type: "equal" | "del" | "add", aNo: number | null, bNo: number | null, parts: Part[] }} UnifiedRow
 */

/**
 * 计算两段文本的差异，产出并排视图和统一视图所需的数据。
 * @param {string} textA
 * @param {string} textB
 * @returns {{ sideRows: SideRow[], unifiedRows: UnifiedRow[], stats: { added: number, removed: number, same: number } }}
 */
export function computeDiff(textA, textB) {
  const aLines = splitLines(textA);
  const bLines = splitLines(textB);
  const lineSegs = diffTokens(aLines, bLines, { maxD: LINE_MAX_D });

  /** @type {{ type: "equal" | "delete" | "insert", line: string }[]} */
  const ops = [];
  for (const seg of lineSegs) {
    for (const line of /** @type {string[]} */ (seg.value)) {
      ops.push({ type: /** @type {"equal" | "delete" | "insert"} */ (seg.type), line });
    }
  }

  /** @type {SideRow[]} */
  const sideRows = [];
  /** @type {UnifiedRow[]} */
  const unifiedRows = [];
  let aNo = 0;
  let bNo = 0;
  let added = 0;
  let removed = 0;
  let same = 0;

  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "equal") {
      aNo++;
      bNo++;
      same++;
      /** @type {Part[]} */
      const parts = [{ type: "equal", text: op.line }];
      sideRows.push({
        left: { type: "equal", no: aNo, parts },
        right: { type: "equal", no: bNo, parts },
      });
      unifiedRows.push({ type: "equal", aNo, bNo, parts });
      i++;
      continue;
    }

    /** @type {string[]} */
    const dels = [];
    /** @type {string[]} */
    const adds = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") dels.push(ops[i].line);
      else adds.push(ops[i].line);
      i++;
    }
    removed += dels.length;
    added += adds.length;

    const pairCount = Math.min(dels.length, adds.length);
    /** @type {LineEntry[]} */
    const leftEntries = [];
    /** @type {LineEntry[]} */
    const rightEntries = [];

    for (let p = 0; p < pairCount; p++) {
      aNo++;
      bNo++;
      const { left, right } = diffLineParts(dels[p], adds[p]);
      leftEntries.push({ type: "del", no: aNo, parts: left.length ? left : [{ type: "del", text: "" }] });
      rightEntries.push({ type: "add", no: bNo, parts: right.length ? right : [{ type: "add", text: "" }] });
    }
    for (let p = pairCount; p < dels.length; p++) {
      aNo++;
      leftEntries.push({ type: "del", no: aNo, parts: [{ type: "del", text: dels[p] }] });
    }
    for (let p = pairCount; p < adds.length; p++) {
      bNo++;
      rightEntries.push({ type: "add", no: bNo, parts: [{ type: "add", text: adds[p] }] });
    }

    const maxLen = Math.max(leftEntries.length, rightEntries.length);
    for (let r = 0; r < maxLen; r++) {
      sideRows.push({ left: leftEntries[r] || null, right: rightEntries[r] || null });
    }
    for (const e of leftEntries) unifiedRows.push({ type: "del", aNo: e.no, bNo: null, parts: e.parts });
    for (const e of rightEntries) unifiedRows.push({ type: "add", aNo: null, bNo: e.no, parts: e.parts });
  }

  return { sideRows, unifiedRows, stats: { added, removed, same } };
}
