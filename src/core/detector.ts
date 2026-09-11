import { ParsedBeatmap, HitObject, ComparisonResult, MatchSegment, TransformationType, PlagiarismVerdict } from './types';

interface TransformedPoint {
  x: number;
  y: number;
}

function applyTransform(x: number, y: number, transform: TransformationType): TransformedPoint {
  const centerX = 256;
  const centerY = 192;

  switch (transform) {
    case 'identity':
      return { x, y };
    case 'flipped_h':
      return { x: 512 - x, y };
    case 'flipped_v':
      return { x, y: 384 - y };
    case 'rotated_180':
      return { x: 512 - x, y: 384 - y };
    case 'rotated_90': {
      // 90 deg clockwise around (256, 192)
      const relX = x - centerX;
      const relY = y - centerY;
      return { x: centerX - relY, y: centerY + relX };
    }
    case 'rotated_270': {
      // 270 deg clockwise around (256, 192)
      const relX = x - centerX;
      const relY = y - centerY;
      return { x: centerX + relY, y: centerY - relX };
    }
    case 'translated':
      return { x, y };
  }
}

export function compareBeatmaps(
  target: ParsedBeatmap,
  candidate: ParsedBeatmap,
  meta?: {
    candidateSetId: number;
    candidateBeatmapId: number;
    candidateCoverUrl?: string;
    candidateDifficultyRating?: number;
  }
): ComparisonResult {
  const targetObjs = target.hitObjects;
  const candidateObjs = candidate.hitObjects;

  if (targetObjs.length === 0 || candidateObjs.length === 0) {
    return {
      candidateSetId: meta?.candidateSetId ?? candidate.metadata.beatmapSetId,
      candidateBeatmapId: meta?.candidateBeatmapId ?? candidate.metadata.beatmapId,
      candidateTitle: candidate.metadata.title,
      candidateArtist: candidate.metadata.artist,
      candidateCreator: candidate.metadata.creator,
      candidateVersion: candidate.metadata.version,
      candidateDifficultyRating: meta?.candidateDifficultyRating,
      candidateCoverUrl: meta?.candidateCoverUrl ?? '',
      rhythmOverlapPercentage: 0,
      spatialOverlapPercentage: 0,
      sliderGeometryOverlapPercentage: 0,
      patternStreakCount: 0,
      longestStreak: 0,
      overallSuspicionScore: 0,
      verdict: 'CLEAN',
      segments: [],
      candidateBeatmap: candidate,
    };
  }

  // 1. Check Rhythm Alignment (within 12ms tolerance)
  const TIME_TOLERANCE_MS = 12;
  const SPATIAL_TOLERANCE_PX = 16;
  const SLIDER_LEN_TOLERANCE = 0.08;

  let rhythmMatchedCount = 0;
  const matchedPairs: Array<{
    targetIdx: number;
    candIdx: number;
    targetObj: HitObject;
    candObj: HitObject;
    timeDiff: number;
  }> = [];

  let cIdx = 0;
  for (let tIdx = 0; tIdx < targetObjs.length; tIdx++) {
    const tObj = targetObjs[tIdx];

    // Advance candidate index until candidate time is within range
    while (cIdx < candidateObjs.length && candidateObjs[cIdx].time < tObj.time - TIME_TOLERANCE_MS) {
      cIdx++;
    }

    // Check candidate objects within tolerance window
    let bestCandIdx = -1;
    let minTimeDiff = Infinity;

    for (let testIdx = cIdx; testIdx < candidateObjs.length; testIdx++) {
      const cObj = candidateObjs[testIdx];
      const diff = Math.abs(cObj.time - tObj.time);
      if (diff <= TIME_TOLERANCE_MS) {
        if (diff < minTimeDiff) {
          minTimeDiff = diff;
          bestCandIdx = testIdx;
        }
      } else if (cObj.time > tObj.time + TIME_TOLERANCE_MS) {
        break;
      }
    }

    if (bestCandIdx !== -1) {
      rhythmMatchedCount++;
      matchedPairs.push({
        targetIdx: tIdx,
        candIdx: bestCandIdx,
        targetObj: tObj,
        candObj: candidateObjs[bestCandIdx],
        timeDiff: minTimeDiff,
      });
    }
  }

  const rhythmOverlapPercentage = Math.round(
    (rhythmMatchedCount / Math.min(targetObjs.length, candidateObjs.length)) * 100
  );

  // 2. Spatial & Geometric Analysis under Transformations
  const transforms: TransformationType[] = [
    'identity',
    'flipped_h',
    'flipped_v',
    'rotated_180',
    'rotated_90',
    'rotated_270',
  ];

  let bestSpatialMatches = 0;
  let dominantTransform: TransformationType = 'identity';

  for (const trans of transforms) {
    let spatialMatches = 0;
    for (const pair of matchedPairs) {
      const candTransformed = applyTransform(pair.candObj.x, pair.candObj.y, trans);
      const dist = Math.hypot(pair.targetObj.x - candTransformed.x, pair.targetObj.y - candTransformed.y);
      if (dist <= SPATIAL_TOLERANCE_PX) {
        spatialMatches++;
      }
    }

    if (spatialMatches > bestSpatialMatches) {
      bestSpatialMatches = spatialMatches;
      dominantTransform = trans;
    }
  }

  // Also check translation vector invariance (same layout shifted by dx, dy)
  let translationMatches = 0;
  if (matchedPairs.length >= 2) {
    const vectorMatches: number[] = [];
    for (let i = 0; i < matchedPairs.length - 1; i++) {
      const p1 = matchedPairs[i];
      const p2 = matchedPairs[i + 1];

      // If they are adjacent or near-adjacent in rhythm
      if (p2.targetIdx - p1.targetIdx <= 2 && p2.candIdx - p1.candIdx <= 2) {
        const targetDx = p2.targetObj.x - p1.targetObj.x;
        const targetDy = p2.targetObj.y - p1.targetObj.y;
        const candDx = p2.candObj.x - p1.candObj.x;
        const candDy = p2.candObj.y - p1.candObj.y;

        const deltaVectorDist = Math.hypot(targetDx - candDx, targetDy - candDy);
        if (deltaVectorDist <= 12) {
          translationMatches++;
        }
      }
    }
    if (translationMatches > bestSpatialMatches) {
      bestSpatialMatches = translationMatches;
      dominantTransform = 'translated';
    }
  }

  const spatialOverlapPercentage = rhythmMatchedCount > 0
    ? Math.round((bestSpatialMatches / rhythmMatchedCount) * 100)
    : 0;

  // 3. Slider Geometry Analysis
  let totalSliders = 0;
  let matchingSliders = 0;

  for (const pair of matchedPairs) {
    if (pair.targetObj.isSlider && pair.candObj.isSlider) {
      totalSliders++;
      const tLen = pair.targetObj.pixelLength || 1;
      const cLen = pair.candObj.pixelLength || 1;
      const lenDiff = Math.abs(tLen - cLen) / Math.max(tLen, cLen);
      const repeatsMatch = pair.targetObj.repeats === pair.candObj.repeats;

      if (lenDiff <= SLIDER_LEN_TOLERANCE && repeatsMatch) {
        matchingSliders++;
      }
    }
  }

  const sliderGeometryOverlapPercentage = totalSliders > 0
    ? Math.round((matchingSliders / totalSliders) * 100)
    : 0;

  // 4. Consecutive Streak & Contiguous Segment Mining
  const segments: MatchSegment[] = [];
  let currentStreak: Array<{
    targetIdx: number;
    candIdx: number;
    targetObj: HitObject;
    candObj: HitObject;
  }> = [];
  let longestStreak = 0;
  let streakCount = 0;

  for (let i = 0; i < matchedPairs.length; i++) {
    const pair = matchedPairs[i];
    const candTrans = applyTransform(pair.candObj.x, pair.candObj.y, dominantTransform);
    const dist = Math.hypot(pair.targetObj.x - candTrans.x, pair.targetObj.y - candTrans.y);
    const isSpatialMatch = dist <= SPATIAL_TOLERANCE_PX * 1.5;

    if (isSpatialMatch) {
      currentStreak.push(pair);
    } else {
      if (currentStreak.length >= 6) {
        streakCount++;
        if (currentStreak.length > longestStreak) {
          longestStreak = currentStreak.length;
        }

        const startObj = currentStreak[0].targetObj;
        const endObj = currentStreak[currentStreak.length - 1].targetObj;

        segments.push({
          startTime: startObj.time,
          endTime: endObj.endTime || endObj.time,
          targetStartIndex: currentStreak[0].targetIdx,
          targetEndIndex: currentStreak[currentStreak.length - 1].targetIdx,
          candidateStartIndex: currentStreak[0].candIdx,
          candidateEndIndex: currentStreak[currentStreak.length - 1].candIdx,
          objectCount: currentStreak.length,
          rhythmScore: 100,
          spatialScore: Math.round(100 - (dist / SPATIAL_TOLERANCE_PX) * 20),
          transformation: dominantTransform,
          confidence: Math.min(100, Math.round(70 + currentStreak.length * 2.5)),
          description: `Copied sequence of ${currentStreak.length} objects (${formatTime(startObj.time)} - ${formatTime(endObj.time)}) [Pattern: ${dominantTransform}]`,
        });
      }
      currentStreak = [];
    }
  }

  if (currentStreak.length >= 6) {
    streakCount++;
    if (currentStreak.length > longestStreak) {
      longestStreak = currentStreak.length;
    }
    const startObj = currentStreak[0].targetObj;
    const endObj = currentStreak[currentStreak.length - 1].targetObj;
    segments.push({
      startTime: startObj.time,
      endTime: endObj.endTime || endObj.time,
      targetStartIndex: currentStreak[0].targetIdx,
      targetEndIndex: currentStreak[currentStreak.length - 1].targetIdx,
      candidateStartIndex: currentStreak[0].candIdx,
      candidateEndIndex: currentStreak[currentStreak.length - 1].candIdx,
      objectCount: currentStreak.length,
      rhythmScore: 100,
      spatialScore: 95,
      transformation: dominantTransform,
      confidence: Math.min(100, Math.round(70 + currentStreak.length * 2.5)),
      description: `Copied sequence of ${currentStreak.length} objects (${formatTime(startObj.time)} - ${formatTime(endObj.time)}) [Pattern: ${dominantTransform}]`,
    });
  }

  // 5. Composite Plagiarism Suspicion Score Calculation
  // Important distinction: Songs naturally have identical rhythms when mapped by different mappers.
  // Rhythm alone is NOT plagiarism. Spatial duplication or long copied streaks ARE plagiarism.
  let overallSuspicionScore = 0;

  if (spatialOverlapPercentage >= 70 && rhythmOverlapPercentage >= 75) {
    // Direct or near-direct clone
    overallSuspicionScore = Math.min(100, Math.round(spatialOverlapPercentage * 0.7 + rhythmOverlapPercentage * 0.3));
  } else if (longestStreak >= 16) {
    // Substantial copied pattern/combo
    overallSuspicionScore = Math.min(100, Math.round(65 + longestStreak * 1.5));
  } else if (spatialOverlapPercentage >= 40 && longestStreak >= 8) {
    overallSuspicionScore = Math.min(85, Math.round(spatialOverlapPercentage * 0.8 + 20));
  } else if (spatialOverlapPercentage >= 25 && rhythmOverlapPercentage >= 50) {
    overallSuspicionScore = Math.min(60, Math.round(spatialOverlapPercentage * 0.6 + rhythmOverlapPercentage * 0.2));
  } else {
    // Normal mappers mapping the same song
    overallSuspicionScore = Math.min(30, Math.round(spatialOverlapPercentage * 0.4 + rhythmOverlapPercentage * 0.1));
  }

  let verdict: PlagiarismVerdict = 'CLEAN';
  if (overallSuspicionScore >= 75) {
    verdict = 'BLATANT_PLAGIARISM';
  } else if (overallSuspicionScore >= 45) {
    verdict = 'SUSPICIOUS';
  } else if (overallSuspicionScore >= 25) {
    verdict = 'SLIGHT_SIMILARITY';
  } else {
    verdict = 'CLEAN';
  }

  return {
    candidateSetId: meta?.candidateSetId ?? candidate.metadata.beatmapSetId,
    candidateBeatmapId: meta?.candidateBeatmapId ?? candidate.metadata.beatmapId,
    candidateTitle: candidate.metadata.title,
    candidateArtist: candidate.metadata.artist,
    candidateCreator: candidate.metadata.creator,
    candidateVersion: candidate.metadata.version,
    candidateDifficultyRating: meta?.candidateDifficultyRating,
    candidateCoverUrl: meta?.candidateCoverUrl ?? '',
    rhythmOverlapPercentage,
    spatialOverlapPercentage,
    sliderGeometryOverlapPercentage,
    patternStreakCount: streakCount,
    longestStreak,
    overallSuspicionScore,
    verdict,
    segments,
    candidateBeatmap: candidate,
  };
}

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const millis = Math.floor(ms % 1000);
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${Math.floor(millis / 100)}`;
}
