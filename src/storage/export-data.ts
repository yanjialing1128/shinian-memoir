import JSZip from 'jszip';
import type { LibraryState, MemoryEntry } from './memory-store';

function safeFileName(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 64);
  return safe || fallback;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function memoryToMarkdown(memory: MemoryEntry): string {
  return `---
title: ${yamlString(memory.title)}
time: ${yamlString(memory.timeText)}
group: ${yamlString(memory.bookGroup)}
included_in_book: ${memory.includedInBook}
title_origin: ${memory.titleOrigin}
source_file: ${memory.sourceFileName ? yamlString(memory.sourceFileName) : 'null'}
created_at: ${yamlString(memory.createdAt)}
updated_at: ${yamlString(memory.updatedAt)}
---

# ${memory.title}

${memory.body}
`;
}

export async function createLibraryExportBlob(
  state: LibraryState,
  orderedMemories: readonly MemoryEntry[],
): Promise<Blob> {
  const zip = new JSZip();
  const metadata = {
    schema: 'shinian-memoir/v3',
    exportedAt: new Date().toISOString(),
    library: state,
    timelineOrder: orderedMemories.map((memory) => memory.id),
  };

  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  zip.file(
    'README.txt',
    `拾年回忆录数据备份\n\n- metadata.json：完整结构化数据，可用于重新导入或自行处理。\n- entries/：每篇回忆对应一个 Markdown 文件。\n- preface.md / afterword.md：序与后记。\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n`,
  );

  orderedMemories.forEach((memory, index) => {
    const file = `${String(index + 1).padStart(3, '0')}-${safeFileName(memory.title, '未命名')}.md`;
    zip.file(`entries/${file}`, memoryToMarkdown(memory));
  });

  if (state.book.preface.trim()) {
    zip.file('preface.md', `# 序\n\n${state.book.preface.trim()}\n`);
  }
  if (state.book.afterword.trim()) {
    zip.file('afterword.md', `# 后记\n\n${state.book.afterword.trim()}\n`);
  }

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}