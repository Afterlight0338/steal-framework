import { ParsedBeatmap, ComparisonResult, AnalysisProgress, getModeName } from './types';
import { parseOsuFile } from './parser';
import { extractOsz, ExtractedDifficulty } from './archive';
import { parseOsuInput, fetchRawOsu, fetchBeatmapSetDetails, fetchBeatmapDiffDetails, searchMirror, getCoverUrl } from '../api/hinamizawa';
import { compareBeatmaps } from './detector';
import { isSongTitleMatch } from './matching';

export interface AnalysisInput {
  urlOrId?: string;
  file?: File;
  selectedDiffFromOsz?: ExtractedDifficulty;
}

export class StealEngine {
  private progressCallback?: (progress: AnalysisProgress) => void;

  constructor(onProgress?: (progress: AnalysisProgress) => void) {
    this.progressCallback = onProgress;
  }

  private notify(progress: AnalysisProgress) {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }

  public async analyzeTarget(
    input: AnalysisInput
  ): Promise<{
    targetBeatmap: ParsedBeatmap;
    targetSetId: number;
    targetBeatmapId: number;
    results: ComparisonResult[];
    query: string;
  }> {
    let targetBeatmap: ParsedBeatmap;
    let targetSetId = 0;
    let targetBeatmapId = 0;

    // 1. Resolve & Parse Target Map
    this.notify({
      step: 'parsing_target',
      message: 'Resolving and parsing target beatmap...',
      percent: 10,
    });

    if (input.selectedDiffFromOsz) {
      targetBeatmap = input.selectedDiffFromOsz.parsed;
      targetSetId = targetBeatmap.metadata.beatmapSetId;
      targetBeatmapId = targetBeatmap.metadata.beatmapId;
    } else if (input.file) {
      const fileName = input.file.name.toLowerCase();
      if (fileName.endsWith('.osz') || fileName.endsWith('.zip')) {
        const osz = await extractOsz(input.file);
        if (osz.difficulties.length === 0) {
          throw new Error('No .osu difficulty files found inside .osz archive');
        }
        // Default to highest object count / highest difficulty
        const topDiff = osz.difficulties[osz.difficulties.length - 1];
        targetBeatmap = topDiff.parsed;
        targetSetId = targetBeatmap.metadata.beatmapSetId;
        targetBeatmapId = targetBeatmap.metadata.beatmapId;
      } else {
        const text = await input.file.text();
        targetBeatmap = parseOsuFile(text);
        targetSetId = targetBeatmap.metadata.beatmapSetId;
        targetBeatmapId = targetBeatmap.metadata.beatmapId;
      }
    } else if (input.urlOrId) {
      const parsed = parseOsuInput(input.urlOrId);
      if (parsed.type === 'beatmap' && parsed.beatmapId) {
        targetBeatmapId = parsed.beatmapId;
        targetSetId = parsed.beatmapsetId || 0;
        const [rawOsu, diffMeta] = await Promise.all([
          fetchRawOsu(parsed.beatmapId),
          fetchBeatmapDiffDetails(parsed.beatmapId),
        ]);
        targetBeatmap = parseOsuFile(rawOsu);
        if (diffMeta) {
          targetBeatmap.starRating = diffMeta.difficulty_rating;
          targetBeatmap.mode = diffMeta.mode_int;
          if (!targetSetId) targetSetId = diffMeta.beatmapset_id;
        }
        if (!targetSetId) targetSetId = targetBeatmap.metadata.beatmapSetId;
      } else if (parsed.type === 'beatmapset' && parsed.beatmapsetId) {
        targetSetId = parsed.beatmapsetId;
        const setDetails = await fetchBeatmapSetDetails(parsed.beatmapsetId);
        // Pick the top diff
        const stdMaps = setDetails.ChildrenBeatmaps.filter((b) => b.Mode === 0);
        const mapToAnalyze = (stdMaps.length > 0 ? stdMaps : setDetails.ChildrenBeatmaps).sort(
          (a, b) => b.DifficultyRating - a.DifficultyRating
        )[0];

        if (!mapToAnalyze) {
          throw new Error('No difficulties found in this beatmapset');
        }

        targetBeatmapId = mapToAnalyze.BeatmapID;
        const rawOsu = await fetchRawOsu(targetBeatmapId);
        targetBeatmap = parseOsuFile(rawOsu);
        targetBeatmap.starRating = mapToAnalyze.DifficultyRating;
        targetBeatmap.mode = mapToAnalyze.Mode;
      } else {
        throw new Error('Invalid osu! beatmap link, ID, or file');
      }
    } else {
      throw new Error('No beatmap provided for analysis');
    }

    // 2. Search Hinamizawa Mirror for Same Song with matching Game Mode
    const artist = targetBeatmap.metadata.artist;
    const title = targetBeatmap.metadata.title;
    const targetMode = targetBeatmap.mode || 0;
    const targetStarRating = targetBeatmap.starRating || 5.0;

    // Build query prioritizing cleaned title & artist
    const query = `${artist} ${title}`.trim();

    this.notify({
      step: 'searching_mirror',
      message: `Searching mirror.hinamizawa.ai for ${getModeName(targetMode)} maps of "${title}" near ${targetStarRating.toFixed(1)}★...`,
      percent: 25,
    });
    const searchHits = await searchMirror(query, 50, targetMode);

    // Filter out target's own beatmapset and STRICTLY keep candidate sets of the same song (matching title)
    const candidateSets = searchHits.filter(
      (s) =>
        s.SetID !== targetSetId &&
        isSongTitleMatch(title, s.Title, targetBeatmap.metadata.titleUnicode, s.TitleUnicode)
    );

    // If query was very specific and returned few results, try title only with same strict matching
    if (candidateSets.length < 3 && title) {
      const titleOnlyHits = await searchMirror(title, 50, targetMode);
      for (const s of titleOnlyHits) {
        if (
          s.SetID !== targetSetId &&
          isSongTitleMatch(title, s.Title, targetBeatmap.metadata.titleUnicode, s.TitleUnicode) &&
          !candidateSets.some((existing) => existing.SetID === s.SetID)
        ) {
          candidateSets.push(s);
        }
      }
    }

    if (candidateSets.length === 0) {
      this.notify({
        step: 'complete',
        message: `No other ${getModeName(targetMode)} beatmaps of this song found on the mirror.`,
        percent: 100,
      });

      return {
        targetBeatmap,
        targetSetId,
        targetBeatmapId,
        results: [],
        query,
      };
    }

    // 3. Fetch candidate difficulties matching Mode & Star Range
    this.notify({
      step: 'fetching_candidates',
      message: `Found ${candidateSets.length} sets. Filtering by ${getModeName(targetMode)} and star range...`,
      percent: 40,
      totalCandidates: candidateSets.length,
      processedCandidates: 0,
    });

    const results: ComparisonResult[] = [];
    let processed = 0;

    // Collect candidates matching target game mode
    const candidateDiffsToFetch: Array<{
      setId: number;
      beatmapId: number;
      title: string;
      artist: string;
      creator: string;
      version: string;
      coverUrl: string;
      diffRating: number;
      starDelta: number;
    }> = [];

    for (const set of candidateSets) {
      // STRICT FILTER: Only accept difficulties matching the target map's game mode!
      const matchingModeMaps = set.ChildrenBeatmaps.filter((b) => b.Mode === targetMode);
      if (matchingModeMaps.length === 0) continue;

      // Sort by closest star rating to target
      matchingModeMaps.sort((a, b) => {
        const deltaA = Math.abs(a.DifficultyRating - targetStarRating);
        const deltaB = Math.abs(b.DifficultyRating - targetStarRating);
        return deltaA - deltaB;
      });

      // Include top 3 closest diffs from each candidate set
      const diffsToInclude = matchingModeMaps.slice(0, 3);
      for (const d of diffsToInclude) {
        candidateDiffsToFetch.push({
          setId: set.SetID,
          beatmapId: d.BeatmapID,
          title: set.Title,
          artist: set.Artist,
          creator: set.Creator,
          version: d.DiffName,
          coverUrl: getCoverUrl(set.SetID),
          diffRating: d.DifficultyRating,
          starDelta: Math.abs(d.DifficultyRating - targetStarRating),
        });
      }
    }

    // Sort candidate diffs by star rating delta so the closest stars are analyzed first!
    candidateDiffsToFetch.sort((a, b) => a.starDelta - b.starDelta);

    // Fetch and analyze in parallel batches of 4
    const BATCH_SIZE = 4;
    for (let i = 0; i < candidateDiffsToFetch.length; i += BATCH_SIZE) {
      const batch = candidateDiffsToFetch.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (candidateInfo) => {
          try {
            const rawOsu = await fetchRawOsu(candidateInfo.beatmapId);
            const candidateMap = parseOsuFile(rawOsu);

            const comparison = compareBeatmaps(targetBeatmap, candidateMap, {
              candidateSetId: candidateInfo.setId,
              candidateBeatmapId: candidateInfo.beatmapId,
              candidateCoverUrl: candidateInfo.coverUrl,
              candidateDifficultyRating: candidateInfo.diffRating,
            });

            results.push(comparison);
          } catch (err) {
            console.warn(`Could not analyze candidate ${candidateInfo.beatmapId}:`, err);
          }
        })
      );

      processed += batch.length;
      const pct = Math.min(95, Math.round(40 + (processed / candidateDiffsToFetch.length) * 55));
      this.notify({
        step: 'comparing',
        message: `Cross-referencing forensic fingerprints (${processed}/${candidateDiffsToFetch.length})...`,
        percent: pct,
        totalCandidates: candidateDiffsToFetch.length,
        processedCandidates: processed,
      });
    }

    // Sort results by overall plagiarism suspicion score descending
    results.sort((a, b) => b.overallSuspicionScore - a.overallSuspicionScore);

    this.notify({
      step: 'complete',
      message: `Forensic cross-reference complete. Analyzed ${results.length} candidate maps.`,
      percent: 100,
    });

    return {
      targetBeatmap,
      targetSetId,
      targetBeatmapId,
      results,
      query,
    };
  }
}
