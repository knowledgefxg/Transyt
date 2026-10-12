import assert from "node:assert/strict";
import { mergeWordsToSegments } from "../lib/segment.ts";

const sentence = mergeWordsToSegments([
  {
    start: 0,
    end: 2,
    text: "Hello there. Next sentence",
    words: [
      { word: " Hello", start: 0, end: 0.4 },
      { word: " there.", start: 0.5, end: 0.9 },
      { word: " Next", start: 1.0, end: 1.3 },
      { word: " sentence", start: 1.4, end: 1.9 },
    ],
  },
]);
assert.deepEqual(
  sentence.map((item) => item.text),
  ["Hello there.", "Next sentence"],
);

const pause = mergeWordsToSegments([
  {
    start: 0,
    end: 3,
    text: "",
    words: [
      { word: " Hi", start: 0, end: 0.3 },
      { word: " there", start: 0.4, end: 0.8 },
      { word: " Next", start: 2.1, end: 2.6 },
    ],
  },
]);
assert.deepEqual(
  pause.map((item) => item.text),
  ["Hi there", "Next"],
);

const soft = mergeWordsToSegments([
  {
    start: 0,
    end: 8,
    text: "",
    words: [
      { word: " I", start: 0, end: 0.2 },
      { word: " thought", start: 0.2, end: 0.5 },
      { word: " about", start: 0.5, end: 0.8 },
      { word: " boredom,", start: 0.8, end: 1.4 },
      { word: " and", start: 1.5, end: 1.7 },
      { word: " then", start: 1.7, end: 2.0 },
      { word: " I", start: 2.0, end: 2.2 },
      { word: " kept", start: 2.2, end: 2.6 },
      { word: " talking", start: 2.6, end: 3.2 },
      { word: " until", start: 3.2, end: 3.6 },
      { word: " the", start: 3.6, end: 3.8 },
      { word: " sentence", start: 3.8, end: 4.4 },
      { word: " became", start: 4.4, end: 5.0 },
      { word: " much", start: 5.0, end: 5.4 },
      { word: " too", start: 5.4, end: 5.8 },
      { word: " long.", start: 5.8, end: 6.4 },
    ],
  },
]);
assert.equal(soft.length, 2);
assert.match(soft[0].text, /boredom/);
assert.match(soft[1].text, /long\.$/);

const fragment = mergeWordsToSegments([
  {
    start: 0,
    end: 2,
    text: "A complete sentence.",
    words: [{ word: " A complete sentence.", start: 0, end: 2 }],
  },
  {
    start: 2.05,
    end: 2.2,
    text: "ok",
    words: [{ word: " ok", start: 2.05, end: 2.2 }],
  },
]);
assert.equal(fragment.length, 2);
assert.equal(fragment[0].text, "A complete sentence.");
assert.equal(fragment[1].text, "ok");

console.log("segment checks passed");
