import { ParsedBeatmap, ComparisonResult, AnalysisProgress } from './types';
import { parseOsuFile } from './parser';
import { extractOsz, ExtractedDifficulty } from './archive';
import { parseOsuInput, fetchRawOsu, fetchBeatmapSetDetails, searchMirror, getCoverUrl } from '../api/hinamizawa';
import { compareBeatmaps } from './detector';

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
        const rawOsu = await fetchRawOsu(parsed.beatmapId);
        targetBeatmap = parseOsuFile(rawOsu);
        if (!targetSetId) targetSetId = targetBeatmap.metadata.beatmapSetId;
      } else if (parsed.type === 'beatmapset' && parsed.beatmapsetId) {
        targetSetId = parsed.beatmapsetId;
        const setDetails = await fetchBeatmapSetDetails(parsed.beatmapsetId);
        // Pick the most difficult std map in the set
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
      } else {
        throw new Error('Invalid osu! beatmap link, ID, or file');
      }
    } else {
      throw new Error('No beatmap provided for analysis');
    }

    // 2. Search Hinamizawa Mirror for Same Song
    const artist = targetBeatmap.metadata.artist;
    const title = targetBeatmap.metadata.title;
    // Build query prioritizing cleaned title & artist
    const query = `${artist} ${title}`.trim();

    this.notify({
      step: 'searching_mirror',
      message: `Searching mirror.hinamizawa.ai for other maps of "${title}"...`,
      percent: 25,
    });

    const searchHits = await searchMirror(query, 30);

    // Filter out target's own beatmapset
    const candidateSets = searchHits.filter((s) => s.SetID !== targetSetId);

    // If query was very specific and returned few results, try title only
    if (candidateSets.length < 3 && title) {
      const titleOnlyHits = await searchMirror(title, 20);
      for (const s of titleOnlyHits) {
        if (s.SetID !== targetSetId && !candidateSets.some((existing) => existing.SetID === s.SetID)) {
          candidateSets.push(s);
        }
      }
    }

    if (candidateSets.length === 0) {
      this.notify({
        step: 'complete',
        message: 'No other beatmaps of this song found on the mirror.',
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

    // 3. Fetch candidate difficulties & compare
    this.notify({
      step: 'fetching_candidates',
      message: `Found ${candidateSets.length} sets. Fetching candidate difficulties...`,
      percent: 40,
      totalCandidates: candidateSets.length,
      processedCandidates: 0,
    });

    const results: ComparisonResult[] = [];
    let processed = 0;

    // Pick best matching difficulty from each candidate set
    const candidateDiffsToFetch: Array<{
      setId: number;
      beatmapId: number;
      title: string;
      artist: string;
      creator: string;
      version: string;
      coverUrl: string;
      diffRating: number;
    }> = [];

    for (const set of candidateSets) {
      const stdMaps = set.ChildrenBeatmaps.filter((b) => b.Mode === 0);
      const pool = stdMaps.length > 0 ? stdMaps : set.ChildrenBeatmaps;
      if (pool.length === 0) continue;

      // Find difficulty with closest object count / length or star rating
      const targetDiffRating = targetBeatmap.difficulty.od; // reference
      const sortedByCloseness = [...pool].sort((a, b) => {
        return Math.abs(a.DifficultyRating - targetDiffRating) - Math.abs(b.DifficultyRating - targetDiffRating);
      });

      // Take top 1 or 2 candidate diffs per set
      for (let i = 0; i < Math.min(2, sortedByCloseness.length); i++) {
        const c = sortedByCloseness[i];
        candidateDiffsToFetch.push({
          setId: set.SetID,
          beatmapId: c.BeatmapID,
          title: set.Title,
          artist: set.Artist,
          creator: set.Creator,
          version: c.DiffName,
          coverUrl: getCoverUrl(set.SetID),
          diffRating: c.DifficultyRating,
        });
      }
    }

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
