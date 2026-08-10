// shuffle.js
// Deterministic, seeded shuffle so each student gets a different question
// order, but the SAME order every time they reload the page (no re-shuffling
// mid-quiz, which would be confusing/unfair).

// Simple string hash -> 32-bit int, used to seed the PRNG
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// Mulberry32 PRNG - small, fast, deterministic given a seed
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle using a seeded PRNG derived from (studentId + quizSetId)
// so the same student+quiz combination always produces the same order.
function seededShuffle(array, seedString) {
  const result = [...array];
  const rand = mulberry32(hashSeed(seedString));
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

module.exports = { seededShuffle };
