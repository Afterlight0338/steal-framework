export interface BeatmapMetadata {
  title: string;
  titleUnicode: string;
  artist: string;
  artistUnicode: string;
  creator: string;
  version: string;
  source: string;
  tags: string[];
  beatmapId: number;
  beatmapSetId: number;
}

export interface BeatmapDifficulty {
  hp: number;
  cs: number;
  od: number;
  ar: number;
  sliderMultiplier: number;
  sliderTickRate: number;
}

export interface TimingPoint {
  time: number;
  beatLength: number;
  meter: number;
  sampleSet: number;
  sampleIndex: number;
  volume: number;
  uninherited: boolean;
  effects: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface HitObject {
  x: number;
  y: number;
  time: number;
  type: number;
  hitSound: number;
  endTime: number;
  isCircle: boolean;
  isSlider: boolean;
  isSpinner: boolean;
  // Slider properties
  curveType?: 'B' | 'C' | 'L' | 'P';
  curvePoints?: CurvePoint[];
  repeats?: number;
  pixelLength?: number;
  comboNumber?: number;
}

export interface ParsedBeatmap {
  metadata: BeatmapMetadata;
  difficulty: BeatmapDifficulty;
  timingPoints: TimingPoint[];
  hitObjects: HitObject[];
  rawText: string;
  durationMs: number;
  bpm: number;
}

export type TransformationType = 
  | 'identity' 
  | 'translated' 
  | 'flipped_h' 
  | 'flipped_v' 
  | 'rotated_90' 
  | 'rotated_180' 
  | 'rotated_270';

export interface MatchSegment {
  startTime: number;
  endTime: number;
  targetStartIndex: number;
  targetEndIndex: number;
  candidateStartIndex: number;
  candidateEndIndex: number;
  objectCount: number;
  rhythmScore: number;
  spatialScore: number;
  transformation: TransformationType;
  confidence: number;
  description: string;
}

export type PlagiarismVerdict = 'CLEAN' | 'SLIGHT_SIMILARITY' | 'SUSPICIOUS' | 'BLATANT_PLAGIARISM';

export interface ComparisonResult {
  candidateSetId: number;
  candidateBeatmapId: number;
  candidateTitle: string;
  candidateArtist: string;
  candidateCreator: string;
  candidateVersion: string;
  candidateDifficultyRating?: number;
  candidateCoverUrl: string;
  rhythmOverlapPercentage: number;
  spatialOverlapPercentage: number;
  sliderGeometryOverlapPercentage: number;
  patternStreakCount: number;
  longestStreak: number;
  overallSuspicionScore: number; // 0 - 100
  verdict: PlagiarismVerdict;
  segments: MatchSegment[];
  candidateBeatmap?: ParsedBeatmap;
}

export interface AnalysisProgress {
  step: 'idle' | 'parsing_target' | 'searching_mirror' | 'fetching_candidates' | 'comparing' | 'complete' | 'error';
  message: string;
  percent: number;
  totalCandidates?: number;
  processedCandidates?: number;
}
