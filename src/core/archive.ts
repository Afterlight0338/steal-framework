import JSZip from 'jszip';
import { parseOsuFile } from './parser';
import { ParsedBeatmap } from './types';

export interface ExtractedDifficulty {
  filename: string;
  version: string;
  cs: number;
  ar: number;
  od: number;
  hp: number;
  objectCount: number;
  parsed: ParsedBeatmap;
}

export interface ExtractedOsz {
  title: string;
  artist: string;
  creator: string;
  difficulties: ExtractedDifficulty[];
  audioBlobUrl?: string;
  backgroundBlobUrl?: string;
}

export async function extractOsz(fileData: ArrayBuffer | Blob): Promise<ExtractedOsz> {
  const zip = await JSZip.loadAsync(fileData);
  const difficulties: ExtractedDifficulty[] = [];

  let title = '';
  let artist = '';
  let creator = '';

  const entries = Object.keys(zip.files);
  for (const filename of entries) {
    if (filename.toLowerCase().endsWith('.osu')) {
      const content = await zip.files[filename].async('string');
      const parsed = parseOsuFile(content);

      if (!title) title = parsed.metadata.title;
      if (!artist) artist = parsed.metadata.artist;
      if (!creator) creator = parsed.metadata.creator;

      difficulties.push({
        filename,
        version: parsed.metadata.version || filename.replace(/\.osu$/i, ''),
        cs: parsed.difficulty.cs,
        ar: parsed.difficulty.ar,
        od: parsed.difficulty.od,
        hp: parsed.difficulty.hp,
        objectCount: parsed.hitObjects.length,
        parsed,
      });
    }
  }

  // Sort difficulties by object count / approach rate
  difficulties.sort((a, b) => a.objectCount - b.objectCount);

  return {
    title,
    artist,
    creator,
    difficulties,
  };
}
