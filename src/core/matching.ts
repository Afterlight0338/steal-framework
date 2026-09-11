/**
 * Normalizes an osu! beatmap song title by stripping common edition/cut tags,
 * punctuation, and excessive whitespace for accurate cross-reference matching.
 */
export function normalizeSongTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    // Remove common bracketed/parenthesized tags like (TV Size), [Cut Ver.], (Short Ver.), (Full Ver.), (Game Ver.), (feat. ...), etc.
    .replace(/\s*[\(\[][^\)\]]*(tv|cut|short|size|edit|ver|game|sped|speed|nightcore|remix|version|ost|opening|ending|op|ed|feat|ft\.)[^\)\]]*[\)\]]/gi, '')
    // Remove punctuation / special characters while keeping letters, numbers, and spaces across all languages/scripts
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether two song titles refer to the same song,
 * preventing unrelated songs from being pulled into the plagiarism analysis.
 */
export function isSongTitleMatch(
  targetTitle: string,
  candidateTitle: string,
  targetUnicode?: string,
  candidateUnicode?: string
): boolean {
  const normTarget = normalizeSongTitle(targetTitle);
  const normCand = normalizeSongTitle(candidateTitle);

  if (!normTarget || !normCand) return false;

  // 1. Exact normalized match
  if (normTarget === normCand) return true;

  // 2. Substring containment with significant ratio (e.g. >= 60% of character length)
  if (normTarget.length >= 4 && normCand.length >= 4) {
    if (normTarget.includes(normCand) || normCand.includes(normTarget)) {
      const minLen = Math.min(normTarget.length, normCand.length);
      const maxLen = Math.max(normTarget.length, normCand.length);
      if (minLen / maxLen >= 0.6) return true;
    }
  }

  // 3. Check unicode titles if available (e.g. Japanese Kanji / Kana titles)
  if (targetUnicode && candidateUnicode) {
    const normUniTarget = normalizeSongTitle(targetUnicode);
    const normUniCand = normalizeSongTitle(candidateUnicode);
    if (normUniTarget && normUniCand) {
      if (normUniTarget === normUniCand) return true;
      if (normUniTarget.length >= 3 && normUniCand.length >= 3) {
        if (normUniTarget.includes(normUniCand) || normUniCand.includes(normUniTarget)) {
          return true;
        }
      }
    }
  }

  // 4. Word token overlap (Jaccard similarity >= 0.75 for multi-word titles)
  const targetWords = new Set(normTarget.split(' ').filter((w) => w.length > 2));
  const candWords = new Set(normCand.split(' ').filter((w) => w.length > 2));
  if (targetWords.size >= 2 && candWords.size >= 2) {
    let intersection = 0;
    targetWords.forEach((w) => {
      if (candWords.has(w)) intersection++;
    });
    const union = new Set([...targetWords, ...candWords]).size;
    if (union > 0 && intersection / union >= 0.75) return true;
  }

  return false;
}
