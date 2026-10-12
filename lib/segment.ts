export type Word = { start: number; end: number; word: string };

export type RawSegment = {
  start: number;
  end: number;
  text: string;
  words: Word[];
};

export type Piece = { start: number; end: number; text: string };

const SENTENCE_END = /[.?!。？！…]["']?$/;
const CLAUSE_END = /[,;:，；：、]["']?$/;
const CONJUNCTION = /^(and|but|or|so|because|which|when|where|if|while|that|after|before|until)$/i;
const TARGET = 46;
const HARD = 72;

function textOf(words: Word[]): string {
  return words.map((word) => word.word).join("").replace(/\s+/g, " ").trim();
}

function token(word: Word): string {
  return word.word.trim();
}

function isSentenceEnd(word: Word): boolean {
  return SENTENCE_END.test(token(word));
}

function isClauseEnd(word: Word): boolean {
  return CLAUSE_END.test(token(word));
}

function isConjunction(word: Word): boolean {
  return CONJUNCTION.test(token(word));
}

function pieceFrom(words: Word[]): Piece | null {
  const text = textOf(words);
  if (!text) return null;
  return { start: words[0].start, end: words[words.length - 1].end, text };
}

function flatten(segments: RawSegment[]): Word[] {
  const flat: Word[] = [];
  for (const segment of segments) {
    const words = (segment.words || []).filter((word) => word.word.trim());
    if (words.length === 0) {
      const text = segment.text?.trim();
      if (!text) continue;
      flat.push({
        start: segment.start,
        end: Math.max(segment.end, segment.start + 0.2),
        word: segment.text.startsWith(" ") ? segment.text : ` ${segment.text}`,
      });
      continue;
    }
    flat.push(...words);
  }
  return flat;
}

function sentencesOf(words: Word[]): Piece[] {
  const pieces: Piece[] = [];
  let current: Word[] = [];
  const push = () => {
    const piece = pieceFrom(current);
    if (piece) pieces.push(piece);
    current = [];
  };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    current.push(word);
    const next = words[index + 1];
    const gap = next ? next.start - word.end : 0;
    const duration = word.end - current[0].start;
    if (isSentenceEnd(word) && textOf(current).length >= 8) {
      push();
      continue;
    }
    if (gap >= 1.1 && textOf(current).length >= 8) {
      push();
      continue;
    }
    if (duration >= 14) push();
  }
  push();
  return pieces;
}

function splitLongSentence(piece: Piece, words: Word[]): Piece[] {
  if (piece.text.length <= HARD) return [piece];
  const source = words.filter((word) => word.start >= piece.start - 0.05 && word.end <= piece.end + 0.05);
  const usable = source.length > 1 ? source : words;
  const parts: Piece[] = [];
  let start = 0;
  while (start < usable.length) {
    const rest = textOf(usable.slice(start));
    if (rest.length <= HARD || start >= usable.length - 1) {
      const tail = pieceFrom(usable.slice(start));
      if (tail) parts.push(tail);
      break;
    }
    let best = -1;
    let bestScore = Infinity;
    let soft = -1;
    let softScore = Infinity;
    for (let index = start; index < usable.length - 1; index += 1) {
      const word = usable[index];
      const next = usable[index + 1];
      const length = textOf(usable.slice(start, index + 1)).length;
      if (length < 18) continue;
      if (length > HARD) break;
      const score = Math.abs(length - TARGET);
      if (score < softScore) {
        softScore = score;
        soft = index;
      }
      const boundary = isClauseEnd(word) || isSentenceEnd(word) || (next ? isConjunction(next) : false);
      if (!boundary) continue;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    const chosen = best >= start ? best : soft;
    if (chosen < start) {
      const tail = pieceFrom(usable.slice(start));
      if (tail) parts.push(tail);
      break;
    }
    const head = pieceFrom(usable.slice(start, chosen + 1));
    if (head) parts.push(head);
    start = chosen + 1;
  }
  return parts.length ? parts : [piece];
}

function mergeFragments(pieces: Piece[]): Piece[] {
  const merged: Piece[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const item = pieces[index];
    const next = pieces[index + 1];
    const words = item.text.split(/\s+/).filter(Boolean);
    const fragment = words.length <= 3 && !/[.?!。？！…]$/.test(item.text);
    const gap = next ? next.start - item.end : 0;
    if (fragment && next && gap < 0.85 && `${item.text} ${next.text}`.length <= HARD + 16) {
      next.start = item.start;
      next.text = `${item.text} ${next.text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
}

function postprocess(pieces: Piece[]): Piece[] {
  const cleaned: Piece[] = [];
  for (const item of pieces) {
    if (item.end <= item.start) continue;
    const previous = cleaned[cleaned.length - 1];
    if (previous && item.text === previous.text) {
      previous.end = Math.max(previous.end, item.end);
      continue;
    }
    cleaned.push({ ...item });
  }
  const merged = mergeFragments(cleaned);
  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index].start < merged[index - 1].end) {
      merged[index].start = merged[index - 1].end;
      if (merged[index].end <= merged[index].start) merged[index].end = merged[index].start + 0.3;
    }
  }
  return merged;
}

/** 先按完整句子收，太长再在逗号和连词处拆成能单独显示的一句。 */
export function mergeWordsToSegments(segments: RawSegment[]): Piece[] {
  const words = flatten(segments);
  if (words.length === 0) return [];
  const sentences = sentencesOf(words).flatMap((piece) => splitLongSentence(piece, words));
  return postprocess(sentences);
}
