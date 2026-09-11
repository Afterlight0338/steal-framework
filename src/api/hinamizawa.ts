const BASE_URL = 'https://mirror.hinamizawa.ai';

export interface HinaiBeatmapChild {
  BeatmapID: number;
  ParentSetID: number;
  DiffName: string;
  DifficultyRating: number;
  CS: number;
  AR: number;
  OD: number;
  HP: number;
  Mode: number;
  HitLength: number;
  TotalLength: number;
  FileMD5?: string;
}

export interface HinaiBeatmapSet {
  SetID: number;
  Artist: string;
  ArtistUnicode?: string;
  Title: string;
  TitleUnicode?: string;
  Creator: string;
  RankedStatus: number;
  ChildrenBeatmaps: HinaiBeatmapChild[];
  CoverUrl?: string;
  PreviewUrl?: string;
}

export interface ParsedOsuTarget {
  type: 'beatmap' | 'beatmapset' | 'unknown';
  beatmapId?: number;
  beatmapsetId?: number;
}

export function parseOsuInput(input: string): ParsedOsuTarget {
  const trimmed = input.trim();

  // Pattern: https://osu.ppy.sh/beatmapsets/12345#osu/67890
  const beatmapsetWithDiffMatch = trimmed.match(/osu\.ppy\.sh\/beatmapsets\/(\d+)#(?:osu|taiko|fruits|mania)\/(\d+)/i);
  if (beatmapsetWithDiffMatch) {
    return {
      type: 'beatmap',
      beatmapsetId: parseInt(beatmapsetWithDiffMatch[1], 10),
      beatmapId: parseInt(beatmapsetWithDiffMatch[2], 10),
    };
  }

  // Pattern: https://osu.ppy.sh/beatmapsets/12345
  const beatmapsetOnlyMatch = trimmed.match(/osu\.ppy\.sh\/beatmapsets\/(\d+)/i);
  if (beatmapsetOnlyMatch) {
    return {
      type: 'beatmapset',
      beatmapsetId: parseInt(beatmapsetOnlyMatch[1], 10),
    };
  }

  // Pattern: https://osu.ppy.sh/b/12345
  const shortBeatmapMatch = trimmed.match(/osu\.ppy\.sh\/b\/(\d+)/i);
  if (shortBeatmapMatch) {
    return {
      type: 'beatmap',
      beatmapId: parseInt(shortBeatmapMatch[1], 10),
    };
  }

  // Pattern: https://osu.ppy.sh/s/12345
  const shortSetMatch = trimmed.match(/osu\.ppy\.sh\/s\/(\d+)/i);
  if (shortSetMatch) {
    return {
      type: 'beatmapset',
      beatmapsetId: parseInt(shortSetMatch[1], 10),
    };
  }

  // Hinamizawa mirror link patterns
  const hinaiDiffMatch = trimmed.match(/mirror\.hinamizawa\.ai\/(?:v3\/osu\/beatmaps\/)?(?:b|osu)\/(\d+)/i);
  if (hinaiDiffMatch) {
    return {
      type: 'beatmap',
      beatmapId: parseInt(hinaiDiffMatch[1], 10),
    };
  }

  const hinaiSetMatch = trimmed.match(/mirror\.hinamizawa\.ai\/(?:v3\/osu\/beatmaps\/)?s\/(\d+)/i);
  if (hinaiSetMatch) {
    return {
      type: 'beatmapset',
      beatmapsetId: parseInt(hinaiSetMatch[1], 10),
    };
  }

  // Just numeric ID
  if (/^\d+$/.test(trimmed)) {
    // If it's a raw number, treat it as beatmap difficulty id by default
    return {
      type: 'beatmap',
      beatmapId: parseInt(trimmed, 10),
    };
  }

  return { type: 'unknown' };
}

export async function fetchRawOsu(beatmapId: number): Promise<string> {
  const url = `${BASE_URL}/v3/osu/beatmaps/osu/${beatmapId}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/plain',
    },
  });

  if (!response.ok) {
    // Fallback to legacy endpoint
    const fallbackUrl = `${BASE_URL}/api/osu/${beatmapId}`;
    const fallbackRes = await fetch(fallbackUrl);
    if (!fallbackRes.ok) {
      throw new Error(`Failed to fetch .osu file for beatmap ${beatmapId}: HTTP ${response.status}`);
    }
    return await fallbackRes.text();
  }

  return await response.text();
}

export async function fetchBeatmapDiffDetails(beatmapId: number): Promise<{
  difficulty_rating: number;
  mode_int: number;
  beatmapset_id: number;
  version: string;
} | null> {
  try {
    const url = `${BASE_URL}/v3/osu/beatmaps/b/${beatmapId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      difficulty_rating: data.difficulty_rating || 0,
      mode_int: data.mode_int !== undefined ? data.mode_int : 0,
      beatmapset_id: data.beatmapset_id || (data.beatmapset && data.beatmapset.id) || 0,
      version: data.version || '',
    };
  } catch (err) {
    console.warn(`Could not fetch beatmap details for ${beatmapId}:`, err);
    return null;
  }
}

export async function fetchBeatmapSetDetails(setId: number): Promise<HinaiBeatmapSet> {
  const url = `${BASE_URL}/api/v1/hinai/s/${setId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch beatmapset ${setId}: HTTP ${response.status}`);
  }
  const data = await response.json();
  
  // Format to unified HinaiBeatmapSet
  const children: HinaiBeatmapChild[] = (data.ChildrenBeatmaps || data.beatmaps || []).map((b: any) => ({
    BeatmapID: b.BeatmapID || b.id,
    ParentSetID: setId,
    DiffName: b.DiffName || b.version,
    DifficultyRating: b.DifficultyRating || b.difficulty_rating || 0,
    CS: b.CS || b.cs || 0,
    AR: b.AR || b.ar || 0,
    OD: b.OD || b.od || 0,
    HP: b.HP || b.hp || 0,
    Mode: b.Mode !== undefined ? b.Mode : (b.mode_int ?? 0),
    HitLength: b.HitLength || b.hit_length || 0,
    TotalLength: b.TotalLength || b.total_length || 0,
    FileMD5: b.FileMD5 || b.checksum,
  }));

  return {
    SetID: setId,
    Artist: data.Artist || data.artist || '',
    ArtistUnicode: data.ArtistUnicode || data.artist_unicode,
    Title: data.Title || data.title || '',
    TitleUnicode: data.TitleUnicode || data.title_unicode,
    Creator: data.Creator || data.creator || '',
    RankedStatus: data.RankedStatus !== undefined ? data.RankedStatus : (data.ranked ?? 1),
    ChildrenBeatmaps: children,
    CoverUrl: getCoverUrl(setId),
    PreviewUrl: getPreviewAudioUrl(setId),
  };
}

export async function searchMirror(query: string, limit = 25, mode = -1): Promise<HinaiBeatmapSet[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  // Use the CheeseGull compatible search endpoint with optional mode filter (0=std, 1=taiko, 2=catch, 3=mania)
  const modeParam = mode >= 0 && mode <= 3 ? `&mode=${mode}` : '';
  const searchUrl = `${BASE_URL}/api/v1/hinai/search?query=${encodeURIComponent(cleanQuery)}&amount=${Math.min(limit, 50)}${modeParam}`;
  
  try {
    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      SetID: item.SetID,
      Artist: item.Artist,
      ArtistUnicode: item.ArtistUnicode,
      Title: item.Title,
      TitleUnicode: item.TitleUnicode,
      Creator: item.Creator,
      RankedStatus: item.RankedStatus,
      ChildrenBeatmaps: (item.ChildrenBeatmaps || []).map((b: any) => ({
        BeatmapID: b.BeatmapID,
        ParentSetID: item.SetID,
        DiffName: b.DiffName,
        DifficultyRating: b.DifficultyRating,
        CS: b.CS,
        AR: b.AR,
        OD: b.OD,
        HP: b.HP,
        Mode: b.Mode !== undefined ? b.Mode : (b.mode_int ?? 0),
        HitLength: b.HitLength,
        TotalLength: b.TotalLength,
        FileMD5: b.FileMD5,
      })),
      CoverUrl: getCoverUrl(item.SetID),
      PreviewUrl: getPreviewAudioUrl(item.SetID),
    }));
  } catch (err) {
    console.error('Error during mirror search:', err);
    return [];
  }
}

export function getCoverUrl(setId: number): string {
  return `${BASE_URL}/v3/osu/beatmaps/cover/${setId}?type=cover`;
}

export function getPreviewAudioUrl(setId: number): string {
  // Returns direct MP3 preview audio stream (b.ppy.sh / catboy)
  return `https://b.ppy.sh/preview/${setId}.mp3`;
}

export function getFullAudioUrl(setId: number): string {
  // Returns full music audio stream from Hinamizawa's 67,000+ song archive
  return `${BASE_URL}/v3/osu/music/audio/${setId}`;
}
