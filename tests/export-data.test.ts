import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createLibraryExportBlob } from '../src/storage/export-data';
import { createEmptyLibraryState, createMemory } from '../src/storage/memory-store';

describe('full data export', () => {
  it('packages metadata, preface, afterword and markdown entries', async () => {
    const memory = createMemory({
      title: '雨里的操场',
      timeText: '2018年秋',
      body: '张明跑进雨里。\n\n我们都在喊他的名字。',
      bookGroup: '那些人',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    const state = {
      ...createEmptyLibraryState(),
      memories: [memory],
      book: {
        ...createEmptyLibraryState().book,
        preface: '写在前面。',
        afterword: '写在后面。',
      },
    };
    const blob = await createLibraryExportBlob(state, [memory]);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(archive.file('metadata.json')).toBeTruthy();
    expect(archive.file('preface.md')).toBeTruthy();
    expect(archive.file('afterword.md')).toBeTruthy();
    expect(await archive.file('entries/001-雨里的操场.md')?.async('string')).toContain('group: "那些人"');
  });
});