import './style.css';
import { bookFileName, buildBook, renderBookHtml, type BookDocument } from './book';
import { createEpubBlob } from './book/export-epub';
import {
  generateTitle,
  importDocumentFiles,
  type ImportedDocumentDraft,
} from './documents';
import { listDetectedPeople } from './people/build-index';
import { createDictation, type DictationController } from './speech/dictation';
import {
  chooseBackupDirectory,
  ensureDirectoryPermission,
  forgetBackupDirectory,
  restoreDirectoryHandle,
  supportsDirectoryBackup,
  writeDirectoryBackup,
} from './storage/directory-backup';
import { createLibraryExportBlob } from './storage/export-data';
import {
  createMemory,
  loadLibraryState,
  saveLibraryState,
  updateMemory,
  withNormalizedManualOrder,
  type LibraryState,
  type MemoryEntry,
  type PeopleCorrections,
  type StorageLike,
} from './storage/memory-store';
import { parseTime, sortMemories } from './time';

const PARSE_OPTIONS = { middleSchoolStartYear: 2003 };

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const storage: StorageLike = window.localStorage;
let library: LibraryState = loadLibraryState(storage);
let importDrafts: readonly ImportedDocumentDraft[] = [];
let currentBook: BookDocument | null = null;
let draggedMemoryId: string | null = null;
let backupDirectory: FileSystemDirectoryHandle | null = null;
let backupTimer: number | null = null;
let backupRunning = false;
let dictationBaseText = '';
let dictationInterim = '';
let editorDictationBase = '';
let editorInterim = '';
let selectedMemoryId: string | null = library.memories[0]?.id ?? null;
let isCreatingMemory = false;
const timelineSelection = new Set<string>();

const fileInput = requireElement<HTMLInputElement>('#file-input');
const dropFileInput = requireElement<HTMLInputElement>('#drop-file-input');
const importButton = requireElement<HTMLButtonElement>('#import-button');
const dropImportButton = requireElement<HTMLButtonElement>('#drop-import-button');
const dropZone = requireElement<HTMLDivElement>('#drop-zone');
const manualAddButton = requireElement<HTMLButtonElement>('#manual-add-button');
const searchInput = requireElement<HTMLInputElement>('#search-input');
const searchStatus = requireElement<HTMLSpanElement>('#search-status');
const entryList = requireElement<HTMLDivElement>('#entry-list');
const editorSurface = requireElement<HTMLElement>('#editor-surface');
const librarySummary = requireElement<HTMLParagraphElement>('#library-summary');
const orderButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-order-mode]')];
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const viewPanels = [...document.querySelectorAll<HTMLElement>('[data-view-panel]')];
const importDialog = requireElement<HTMLDialogElement>('#import-dialog');
const importList = requireElement<HTMLDivElement>('#import-list');
const importStatus = requireElement<HTMLParagraphElement>('#import-status');
const confirmImportButton = requireElement<HTMLButtonElement>('#confirm-import-button');
const editDialog = requireElement<HTMLDialogElement>('#edit-dialog');
const editForm = requireElement<HTMLFormElement>('#edit-form');
const editTimePreview = requireElement<HTMLDivElement>('#edit-time-preview');
const editStatus = requireElement<HTMLParagraphElement>('#edit-status');
const editTimeInput = editForm.elements.namedItem('timeText');
const regenerateTitleButton = requireElement<HTMLButtonElement>('#regenerate-title-button');
const voiceInputButton = requireElement<HTMLButtonElement>('#voice-input-button');
const voiceStatus = requireElement<HTMLParagraphElement>('#voice-status');
const groupOptions = requireElement<HTMLDataListElement>('#group-options');
const peopleDialog = requireElement<HTMLDialogElement>('#people-dialog');
const peopleList = requireElement<HTMLDivElement>('#people-list');
const extraPersonInput = requireElement<HTMLInputElement>('#extra-person-input');
const addExtraPersonButton = requireElement<HTMLButtonElement>('#add-extra-person-button');
const bookDialog = requireElement<HTMLDialogElement>('#book-dialog');
const bookFrame = requireElement<HTMLIFrameElement>('#book-frame');
const bookPreviewTitle = requireElement<HTMLHeadingElement>('#book-preview-title');
const previewBookButton = requireElement<HTMLButtonElement>('#preview-book-button');
const downloadBookButton = requireElement<HTMLButtonElement>('#download-book-button');
const downloadEpubButton = requireElement<HTMLButtonElement>('#download-epub-button');
const printBookButton = requireElement<HTMLButtonElement>('#print-book-button');
const bookStatus = requireElement<HTMLParagraphElement>('#book-status');
const selectedCount = requireElement<HTMLElement>('#selected-count');
const toast = requireElement<HTMLDivElement>('#toast');
const bookTitleInput = requireElement<HTMLInputElement>('#book-title');
const bookSubtitleInput = requireElement<HTMLInputElement>('#book-subtitle');
const bookAuthorInput = requireElement<HTMLInputElement>('#book-author');
const bookPrefaceInput = requireElement<HTMLTextAreaElement>('#book-preface');
const bookAfterwordInput = requireElement<HTMLTextAreaElement>('#book-afterword');
const chapterModeSelect = requireElement<HTMLSelectElement>('#chapter-mode');
const peopleIndexButton = requireElement<HTMLButtonElement>('#open-people-index-button');
const exportDataButton = requireElement<HTMLButtonElement>('#export-data-button');
const chooseBackupButton = requireElement<HTMLButtonElement>('#choose-backup-button');
const forgetBackupButton = requireElement<HTMLButtonElement>('#forget-backup-button');
const backupStatus = requireElement<HTMLParagraphElement>('#backup-status');
const timelineList = requireElement<HTMLDivElement>('#timeline-list');
const timelineOrderMode = requireElement<HTMLSelectElement>('#timeline-order-mode');
const timelineGroupMode = requireElement<HTMLSelectElement>('#timeline-group-mode');
const timelineSelectedCount = requireElement<HTMLElement>('#timeline-selected-count');
const timelineBatchTime = requireElement<HTMLInputElement>('#timeline-batch-time');
const timelineBatchTimeButton = requireElement<HTMLButtonElement>('#timeline-batch-time-button');
const timelineBatchDeleteButton = requireElement<HTMLButtonElement>('#timeline-batch-delete-button');
const timelineSelectAllButton = requireElement<HTMLButtonElement>('#timeline-select-all');
const bookSelectionList = requireElement<HTMLDivElement>('#book-selection-list');
const dataSearchInput = requireElement<HTMLInputElement>('#data-search-input');
const dataSearchResults = requireElement<HTMLDivElement>('#data-search-results');

function showToast(message: string, tone: 'normal' | 'error' | 'success' = 'normal'): void {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('is-visible');
  window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateBackupStatus(message: string, tone: 'normal' | 'error' | 'success' = 'normal'): void {
  backupStatus.textContent = message;
  backupStatus.dataset.tone = tone;
  forgetBackupButton.classList.toggle('is-hidden', !backupDirectory);
}

function getTimelineMemories(): readonly MemoryEntry[] {
  if (library.orderMode === 'auto') {
    return sortMemories(library.memories, PARSE_OPTIONS).map((entry) => entry.item);
  }

  return [...library.memories].sort((left, right) => {
    const leftOrder = left.manualOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.manualOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.createdAt.localeCompare(right.createdAt);
  });
}

function scheduleDirectoryBackup(): void {
  if (!backupDirectory) return;
  if (backupTimer !== null) window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => void runDirectoryBackup(), 900);
}

async function runDirectoryBackup(): Promise<void> {
  if (!backupDirectory || backupRunning) return;
  backupRunning = true;
  updateBackupStatus('自动备份：正在写入……');
  try {
    const granted = await ensureDirectoryPermission(backupDirectory, false);
    if (!granted) {
      updateBackupStatus('自动备份：需要重新授权文件夹', 'error');
      return;
    }
    const count = await writeDirectoryBackup(backupDirectory, library, getTimelineMemories());
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    updateBackupStatus(`自动备份：${backupDirectory.name} · ${count} 篇 · ${time}`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : '自动备份失败。';
    updateBackupStatus(`自动备份：${message}`, 'error');
  } finally {
    backupRunning = false;
  }
}

function persist(nextLibrary: LibraryState): boolean {
  if (!saveLibraryState(storage, nextLibrary)) {
    showToast('浏览器没有允许本地存储，这次修改没有保存。', 'error');
    return false;
  }
  library = nextLibrary;
  scheduleDirectoryBackup();
  return true;
}

async function initializeBackup(): Promise<void> {
  if (!supportsDirectoryBackup()) {
    chooseBackupButton.disabled = true;
    updateBackupStatus('自动备份：当前浏览器不支持');
    return;
  }
  backupDirectory = await restoreDirectoryHandle();
  if (!backupDirectory) {
    updateBackupStatus('自动备份：未开启');
    return;
  }
  const granted = await ensureDirectoryPermission(backupDirectory, false);
  updateBackupStatus(
    granted ? `自动备份：${backupDirectory.name} · 已连接` : '自动备份：文件夹需要重新授权',
    granted ? 'success' : 'error',
  );
}

function getVisibleMemories(): readonly MemoryEntry[] {
  const term = searchInput.value.trim().toLocaleLowerCase('zh-CN');
  const timeline = getTimelineMemories();
  if (!term) return timeline;
  return timeline.filter(
    (memory) =>
      memory.title.toLocaleLowerCase('zh-CN').includes(term) ||
      memory.body.toLocaleLowerCase('zh-CN').includes(term) ||
      memory.timeText.toLocaleLowerCase('zh-CN').includes(term) ||
      memory.bookGroup.toLocaleLowerCase('zh-CN').includes(term),
  );
}

function appendHighlightedText(container: HTMLElement, text: string, term: string): void {
  container.replaceChildren();
  if (!term) {
    container.textContent = text;
    return;
  }
  const lowerText = text.toLocaleLowerCase('zh-CN');
  const lowerTerm = term.toLocaleLowerCase('zh-CN');
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerTerm, cursor);
  if (matchIndex === -1) {
    container.textContent = text;
    return;
  }
  while (matchIndex !== -1) {
    if (matchIndex > cursor) container.append(text.slice(cursor, matchIndex));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(matchIndex, matchIndex + term.length);
    container.append(mark);
    cursor = matchIndex + term.length;
    matchIndex = lowerText.indexOf(lowerTerm, cursor);
  }
  if (cursor < text.length) container.append(text.slice(cursor));
}

function excerptAround(text: string, term: string, maximum = 180): string {
  if (!term || text.length <= maximum) return text;
  const index = text.toLocaleLowerCase('zh-CN').indexOf(term.toLocaleLowerCase('zh-CN'));
  if (index === -1) return `${text.slice(0, maximum)}……`;
  const start = Math.max(0, index - 65);
  const end = Math.min(text.length, start + maximum);
  return `${start > 0 ? '……' : ''}${text.slice(start, end)}${end < text.length ? '……' : ''}`;
}

function refreshGroupOptions(): void {
  const groups = [...new Set(library.memories.map((memory) => memory.bookGroup).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  groupOptions.replaceChildren();
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group;
    groupOptions.append(option);
  }
}

function renderTimePreview(container: HTMLElement, rawText: string): void {
  container.replaceChildren();
  if (!rawText.trim()) {
    container.className = 'time-preview';
    const dot = document.createElement('span');
    dot.className = 'time-preview__dot';
    container.append(dot, '输入时间后显示识别结果。');
    return;
  }
  const parsed = parseTime(rawText, PARSE_OPTIONS);
  const badge = document.createElement('span');
  badge.className = 'time-preview__badge';
  if (!parsed.resolved) {
    container.className = 'time-preview time-preview--unknown';
    badge.textContent = '暂未识别';
    container.append(badge, '会保留原文，并排在时间线末尾。');
    return;
  }
  container.className = 'time-preview time-preview--resolved';
  badge.textContent = parsed.confidence === 'exact' ? '已识别' : '推算时间';
  const normalized = document.createElement('strong');
  normalized.textContent = parsed.normalized;
  container.append(badge, normalized);
}
function setBookSettings(changes: Partial<LibraryState['book']>): void {
  persist({ ...library, book: { ...library.book, ...changes } });
  renderBookPanel();
}

function createActionButton(label: string, action: string, extraClass = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `entry-action ${extraClass}`.trim();
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

function createEntryCard(memory: MemoryEntry, position: number, manualMode: boolean): HTMLElement {
  const parsed = parseTime(memory.timeText, PARSE_OPTIONS);
  const searchTerm = searchInput.value.trim();
  const card = document.createElement('article');
  card.className = 'entry-card';
  card.dataset.id = memory.id;
  card.draggable = true;
  card.classList.toggle('is-active', memory.id === selectedMemoryId);

  const order = document.createElement('div');
  order.className = 'entry-card__order';
  order.textContent = String(position).padStart(2, '0');
  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle';
  dragHandle.title = '拖拽调整顺序';
  dragHandle.setAttribute('aria-hidden', 'true');
  dragHandle.textContent = '⠿';

  const content = document.createElement('div');
  content.className = 'entry-card__content';
  const top = document.createElement('div');
  top.className = 'entry-card__top';

  const selectionLabel = document.createElement('label');
  selectionLabel.className = 'book-check';
  const selection = document.createElement('input');
  selection.type = 'checkbox';
  selection.checked = memory.includedInBook;
  selection.dataset.action = 'toggle-book';
  selection.setAttribute('aria-label', `将《${memory.title}》收录进书稿`);
  const selectionText = document.createElement('span');
  selectionText.textContent = memory.includedInBook ? '已收录' : '未收录';
  selectionLabel.append(selection, selectionText);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'entry-card__title-wrap';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'entry-title';
  title.dataset.action = 'select';
  appendHighlightedText(title, memory.title, searchTerm);
  titleWrap.append(title);
  if (memory.titleOrigin === 'generated') {
    const generatedTag = document.createElement('span');
    generatedTag.className = 'origin-tag';
    generatedTag.textContent = '自动拟题';
    titleWrap.append(generatedTag);
  }

  const actions = document.createElement('div');
  actions.className = 'entry-card__actions';
  if (manualMode) {
    const up = createActionButton('↑', 'move-up', 'entry-action--move');
    const down = createActionButton('↓', 'move-down', 'entry-action--move');
    up.setAttribute('aria-label', '上移');
    down.setAttribute('aria-label', '下移');
    actions.append(up, down);
  }
  actions.append(createActionButton('编辑', 'edit'), createActionButton('删除', 'delete', 'entry-action--danger'));
  top.append(selectionLabel, titleWrap, actions);

  const meta = document.createElement('div');
  meta.className = 'entry-card__meta';
  const rawTime = document.createElement('span');
  rawTime.className = 'raw-time';
  rawTime.textContent = `原写法：${memory.timeText}`;
  const normalizedTime = document.createElement('span');
  normalizedTime.className = parsed.resolved ? 'normalized-time' : 'normalized-time normalized-time--unknown';
  normalizedTime.textContent = parsed.resolved ? parsed.normalized : '未识别';
  meta.append(rawTime, normalizedTime);
  if (memory.bookGroup) {
    const group = document.createElement('span');
    group.className = 'group-badge';
    group.textContent = `分组：${memory.bookGroup}`;
    meta.append(group);
  }
  if (memory.sourceFileName) {
    const source = document.createElement('span');
    source.className = 'source-file';
    source.textContent = memory.sourceFileName;
    meta.append(source);
  }

  const body = document.createElement('p');
  body.className = 'entry-card__excerpt';
  appendHighlightedText(body, excerptAround(memory.body, searchTerm), searchTerm);

  content.append(top, meta, body);
  card.append(order, dragHandle, content);
  return card;
}

function renderEntryList(): void {
  const visible = getVisibleMemories();
  const term = searchInput.value.trim();
  entryList.replaceChildren();
  librarySummary.textContent = `${library.memories.length} 篇 · 已选 ${library.memories.filter((item) => item.includedInBook).length} 篇`;
  searchStatus.textContent = term ? `${visible.length} 个搜索结果` : '输入关键词全文搜索';

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = term
      ? '<p>没有找到匹配的篇章。</p><span>试试更短的关键词，或搜索分组名称。</span>'
      : '<p>这里还没有篇章。</p><span>导入一份 Word、PDF 或 Markdown 文档开始。</span>';
    entryList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((memory, index) => {
    fragment.append(createEntryCard(memory, index + 1, library.orderMode === 'manual'));
  });
  entryList.append(fragment);
}

function timelineGroupFor(memory: MemoryEntry): { readonly key: string; readonly title: string } {
  const mode = timelineGroupMode.value;
  if (mode === 'none') return { key: 'all', title: '全部篇目' };
  if (mode === 'group') {
    const title = memory.bookGroup.trim() || '未分组';
    return { key: `group-${title}`, title };
  }

  const parsed = parseTime(memory.timeText, PARSE_OPTIONS);
  if (!parsed.resolved || !parsed.range) return { key: 'unknown', title: '时间待考' };
  const date = new Date(parsed.range.midDay * 86_400_000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (mode === 'year') return { key: `year-${year}`, title: `${year}年` };

  const startYear = month >= 8 ? year : year - 1;
  const gradeIndex = startYear - PARSE_OPTIONS.middleSchoolStartYear;
  const grades = ['初一', '初二', '初三', '高一', '高二', '高三'];
  const grade = grades[gradeIndex];
  return {
    key: `stage-${startYear}`,
    title: grade ? `${grade} · ${startYear}—${startYear + 1}` : `${startYear}—${startYear + 1} 学年`,
  };
}

function createTimelineDragHandle(enabled: boolean): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'timeline-drag-handle';
  handle.draggable = enabled;
  handle.disabled = !enabled;
  handle.title = enabled ? '拖拽调整顺序' : '切换到手动顺序后可拖拽';
  handle.setAttribute('aria-label', handle.title);
  handle.innerHTML = `
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="5" cy="3" r="1.2"></circle>
      <circle cx="11" cy="3" r="1.2"></circle>
      <circle cx="5" cy="8" r="1.2"></circle>
      <circle cx="11" cy="8" r="1.2"></circle>
      <circle cx="5" cy="13" r="1.2"></circle>
      <circle cx="11" cy="13" r="1.2"></circle>
    </svg>
  `;
  return handle;
}

function createTimelineRow(memory: MemoryEntry): HTMLElement {
  const parsed = parseTime(memory.timeText, PARSE_OPTIONS);
  const row = document.createElement('article');
  const manualMode = library.orderMode === 'manual';
  row.className = manualMode ? 'timeline-row is-manual' : 'timeline-row';
  row.dataset.id = memory.id;
  row.draggable = false;

  const dragHandle = createTimelineDragHandle(manualMode);

  const selectLabel = document.createElement('label');
  selectLabel.className = 'timeline-select';
  const select = document.createElement('input');
  select.type = 'checkbox';
  select.dataset.role = 'timeline-select';
  select.checked = timelineSelection.has(memory.id);
  selectLabel.append(select);

  const main = document.createElement('div');
  main.className = 'timeline-row__main';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'timeline-row__title';
  title.dataset.action = 'timeline-edit';
  title.textContent = memory.title;
  const meta = document.createElement('span');
  meta.className = 'timeline-row__meta';
  meta.textContent = `${memory.timeText} · ${parsed.resolved ? parsed.normalized : '时间待考'}${memory.bookGroup ? ` · ${memory.bookGroup}` : ''}`;
  main.append(title, meta);

  const includeLabel = document.createElement('label');
  includeLabel.className = 'book-check';
  const include = document.createElement('input');
  include.type = 'checkbox';
  include.checked = memory.includedInBook;
  include.dataset.role = 'timeline-include';
  includeLabel.append(include, '入书');

  const actions = document.createElement('div');
  actions.className = 'timeline-row__actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'text-button';
  edit.dataset.action = 'timeline-edit';
  edit.textContent = '编辑';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button';
  remove.dataset.action = 'timeline-delete';
  remove.textContent = '删除';
  actions.append(edit, remove);

  row.append(dragHandle, selectLabel, main, includeLabel, actions);
  return row;
}

function renderTimelineView(): void {
  const memories = getTimelineMemories();
  timelineList.replaceChildren();
  timelineSelectedCount.textContent = timelineSelection.size > 0 ? `已选择 ${timelineSelection.size} 篇` : '未选择';

  if (memories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '还没有篇目。请先在“设置与数据”中导入文档。';
    timelineList.append(empty);
    return;
  }

  const groups = new Map<string, { title: string; memories: MemoryEntry[] }>();
  for (const memory of memories) {
    const group = timelineGroupFor(memory);
    const existing = groups.get(group.key);
    if (existing) existing.memories.push(memory);
    else groups.set(group.key, { title: group.title, memories: [memory] });
  }

  for (const group of groups.values()) {
    const section = document.createElement('section');
    section.className = 'timeline-group';
    const heading = document.createElement('h2');
    heading.textContent = group.title;
    const list = document.createElement('div');
    list.className = 'timeline-group__list';
    group.memories.forEach((memory) => list.append(createTimelineRow(memory)));
    section.append(heading, list);
    timelineList.append(section);
  }
}

function renderBookSelectionList(): void {
  const memories = getTimelineMemories();
  bookSelectionList.replaceChildren();
  if (memories.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '还没有可收录的篇目。';
    bookSelectionList.append(empty);
    return;
  }

  memories.forEach((memory, index) => {
    const row = document.createElement('div');
    row.className = 'book-selection-row';
    row.dataset.id = memory.id;
    const includeLabel = document.createElement('label');
    includeLabel.className = 'book-check';
    const include = document.createElement('input');
    include.type = 'checkbox';
    include.checked = memory.includedInBook;
    include.dataset.role = 'book-select';
    includeLabel.append(include);
    const title = document.createElement('span');
    title.className = 'book-selection-row__title';
    title.textContent = `${String(index + 1).padStart(2, '0')}　${memory.title}`;
    const time = document.createElement('span');
    time.className = 'book-selection-row__time';
    time.textContent = memory.timeText;
    const controls = document.createElement('div');
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'entry-action';
    up.dataset.action = 'book-move-up';
    up.textContent = '↑';
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'entry-action';
    down.dataset.action = 'book-move-down';
    down.textContent = '↓';
    controls.append(up, down);
    row.append(includeLabel, title, time, controls);
    bookSelectionList.append(row);
  });
}
function renderBookPanel(): void {
  const count = library.memories.filter((memory) => memory.includedInBook).length;
  selectedCount.textContent = `已选 ${count} 篇`;
  previewBookButton.disabled = count === 0;
  bookStatus.textContent = count === 0 ? '至少选择一篇，才能生成书稿。' : `${count} 篇会按当前时间线顺序进入书稿。`;
  bookStatus.dataset.tone = count === 0 ? 'error' : 'neutral';
  renderBookSelectionList();
}

function markEditorDirty(): void {
  const status = editorSurface.querySelector<HTMLElement>('.editor-save-status');
  if (status) status.textContent = '有未保存的修改';
}

function getEditorBody(): HTMLTextAreaElement | null {
  return editorSurface.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
}

function saveEditorDraft(): void {
  const titleInput = editorSurface.querySelector<HTMLInputElement>('input[name="title"]');
  const timeInput = editorSurface.querySelector<HTMLInputElement>('input[name="timeText"]');
  const bodyInput = getEditorBody();
  const status = editorSurface.querySelector<HTMLElement>('.editor-save-status');
  if (!titleInput || !timeInput || !bodyInput || !status) return;

  const title = titleInput.value.trim();
  const timeText = timeInput.value.trim() || '时间待考';
  const body = bodyInput.value.trim();
  if (!title || !body) {
    status.textContent = '标题和正文不能为空';
    return;
  }

  if (isCreatingMemory || !selectedMemoryId) {
    const memory = createMemory({ title, timeText, body, titleOrigin: 'manual' });
    selectedMemoryId = memory.id;
    isCreatingMemory = false;
    persist({ ...library, memories: [...library.memories, memory] });
  } else {
    const memories = library.memories.map((memory) =>
      memory.id === selectedMemoryId
        ? updateMemory(memory, { title, timeText, body, titleOrigin: title === memory.title ? memory.titleOrigin : 'manual' })
        : memory,
    );
    persist({ ...library, memories });
  }

  status.textContent = `已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  refreshListView();
}

function renderEditorSurface(): void {
  editorSurface.replaceChildren();
  const memory = isCreatingMemory ? null : library.memories.find((item) => item.id === selectedMemoryId) ?? null;
  if (!memory && !isCreatingMemory) {
    const empty = document.createElement('section');
    empty.className = 'editor-empty';
    const mark = document.createElement('span');
    mark.className = 'editor-empty__mark';
    mark.textContent = '拾年';
    const title = document.createElement('h1');
    title.textContent = '从一段记得住的地方开始。';
    const text = document.createElement('p');
    text.textContent = '选择左侧一篇，或新建一篇。';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'secondary-button';
    create.textContent = '新的一篇';
    create.addEventListener('click', beginNewMemory);
    empty.append(mark, title, text, create);
    editorSurface.append(empty);
    return;
  }

  const form = document.createElement('form');
  form.className = 'writing-form';
  form.noValidate = true;

  const header = document.createElement('div');
  header.className = 'writing-form__header';
  const titleInput = document.createElement('input');
  titleInput.name = 'title';
  titleInput.className = 'writing-title';
  titleInput.type = 'text';
  titleInput.maxLength = 100;
  titleInput.placeholder = '标题';
  titleInput.value = memory?.title ?? '';

  const timeInput = document.createElement('input');
  timeInput.name = 'timeText';
  timeInput.className = 'writing-time';
  timeInput.type = 'text';
  timeInput.maxLength = 80;
  timeInput.placeholder = '时间，例如：初中毕业那年 / 2018年秋';
  timeInput.value = memory?.timeText ?? '';
  header.append(titleInput, timeInput);

  const bodyInput = document.createElement('textarea');
  bodyInput.name = 'body';
  bodyInput.className = 'writing-body';
  bodyInput.placeholder = '从这里开始写……';
  bodyInput.value = memory?.body ?? '';

  const footer = document.createElement('footer');
  footer.className = 'writing-form__footer';
  const voice = document.createElement('button');
  voice.type = 'button';
  voice.className = 'voice-button';
  voice.textContent = '语音输入';
  voice.addEventListener('click', () => {
    if (voice.classList.contains('is-listening')) {
      editorDictation?.stop();
      return;
    }
    editorDictationBase = bodyInput.value;
    editorInterim = '';
    editorDictation?.start();
  });
  const status = document.createElement('span');
  status.className = 'editor-save-status';
  status.textContent = memory ? '已保存' : '新篇章';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'secondary-button';
  save.textContent = '保存';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button';
  remove.textContent = '删除';
  remove.hidden = !memory;
  remove.addEventListener('click', () => {
    if (!memory || !window.confirm(`确定删除《${memory.title}》吗？`)) return;
    const remaining = library.memories.filter((item) => item.id !== memory.id);
    if (persist({ ...library, memories: remaining })) {
      selectedMemoryId = remaining[0]?.id ?? null;
      isCreatingMemory = false;
      renderWorkspace();
    }
  });
  footer.append(voice, status, save, remove);

  form.append(header, bodyInput, footer);
  form.addEventListener('input', markEditorDirty);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveEditorDraft();
  });
  editorSurface.append(form);
}
function refreshListView(): void {
  renderEntryList();
  renderTimelineView();
  renderBookPanel();
  renderDataSearchResults();
}
function renderDataSearchResults(): void {
  const term = dataSearchInput.value.trim().toLocaleLowerCase('zh-CN');
  dataSearchResults.replaceChildren();
  if (!term) {
    const hint = document.createElement('p');
    hint.className = 'data-search-hint';
    hint.textContent = '输入关键词后显示匹配篇目。';
    dataSearchResults.append(hint);
    return;
  }

  const matches = library.memories.filter(
    (memory) =>
      memory.title.toLocaleLowerCase('zh-CN').includes(term) ||
      memory.body.toLocaleLowerCase('zh-CN').includes(term) ||
      memory.timeText.toLocaleLowerCase('zh-CN').includes(term) ||
      memory.bookGroup.toLocaleLowerCase('zh-CN').includes(term),
  );
  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'data-search-hint';
    empty.textContent = '没有找到匹配篇目。';
    dataSearchResults.append(empty);
    return;
  }

  matches.forEach((memory) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'data-search-result';
    const title = document.createElement('span');
    appendHighlightedText(title, memory.title, dataSearchInput.value.trim());
    const meta = document.createElement('small');
    meta.textContent = `${memory.timeText}${memory.bookGroup ? ` · ${memory.bookGroup}` : ''}`;
    button.append(title, meta);
    button.addEventListener('click', () => {
      selectedMemoryId = memory.id;
      isCreatingMemory = false;
      renderEntryList();
      renderEditorSurface();
      switchView('writing');
    });
    dataSearchResults.append(button);
  });
}
function renderWorkspace(): void {
  const timeline = getTimelineMemories();
  if (!selectedMemoryId || !timeline.some((memory) => memory.id === selectedMemoryId)) {
    selectedMemoryId = timeline[0]?.id ?? null;
  }
  orderButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.orderMode === library.orderMode);
  });
  timelineOrderMode.value = library.orderMode;
  refreshGroupOptions();
  renderEntryList();
  renderEditorSurface();
  renderTimelineView();
  renderBookPanel();
  renderDataSearchResults();
}

function updateMemoryById(id: string, changes: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): void {
  const memories = library.memories.map((memory) =>
    memory.id === id ? updateMemory(memory, changes) : memory,
  );
  if (persist({ ...library, memories })) renderWorkspace();
}

function reorderMemory(
  sourceId: string,
  targetId: string,
  placement: 'before' | 'after' = 'before',
): void {
  if (searchInput.value.trim()) {
    showToast('请先清空搜索，再拖拽调整顺序。');
    return;
  }
  const ordered = [...getTimelineMemories()];
  const sourceIndex = ordered.findIndex((memory) => memory.id === sourceId);
  const targetIndex = ordered.findIndex((memory) => memory.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;
  const [source] = ordered.splice(sourceIndex, 1);
  if (!source) return;
  const remainingTargetIndex = ordered.findIndex((memory) => memory.id === targetId);
  if (remainingTargetIndex === -1) return;
  const insertionIndex = placement === 'after' ? remainingTargetIndex + 1 : remainingTargetIndex;
  ordered.splice(insertionIndex, 0, source);
  const memories = withNormalizedManualOrder(ordered);
  if (persist({ ...library, orderMode: 'manual', memories })) {
    renderWorkspace();
    showToast('手动顺序已保存。');
  }
}

function moveMemory(id: string, offset: -1 | 1): void {
  const ordered = [...getTimelineMemories()];
  const sourceIndex = ordered.findIndex((memory) => memory.id === id);
  const targetIndex = sourceIndex + offset;
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= ordered.length) return;
  const [source] = ordered.splice(sourceIndex, 1);
  if (!source) return;
  ordered.splice(targetIndex, 0, source);
  persist({ ...library, orderMode: 'manual', memories: withNormalizedManualOrder(ordered) });
  renderWorkspace();
}

function getFormControl<T extends HTMLInputElement | HTMLTextAreaElement>(
  form: HTMLFormElement,
  name: string,
  kind: 'input' | 'textarea',
): T | null {
  const control = form.elements.namedItem(name);
  if (kind === 'input' && control instanceof HTMLInputElement) return control as T;
  if (kind === 'textarea' && control instanceof HTMLTextAreaElement) return control as T;
  return null;
}

function openEditDialog(memory: MemoryEntry): void {
  const idInput = getFormControl<HTMLInputElement>(editForm, 'id', 'input');
  const titleInput = getFormControl<HTMLInputElement>(editForm, 'title', 'input');
  const timeField = getFormControl<HTMLInputElement>(editForm, 'timeText', 'input');
  const groupField = getFormControl<HTMLInputElement>(editForm, 'bookGroup', 'input');
  const bodyField = getFormControl<HTMLTextAreaElement>(editForm, 'body', 'textarea');
  if (!idInput || !titleInput || !timeField || !groupField || !bodyField) return;
  idInput.value = memory.id;
  titleInput.value = memory.title;
  timeField.value = memory.timeText;
  groupField.value = memory.bookGroup;
  bodyField.value = memory.body;
  editStatus.textContent = '';
  regenerateTitleButton.hidden = memory.titleOrigin === 'original';
  renderTimePreview(editTimePreview, memory.timeText);
  editDialog.showModal();
  titleInput.focus();
}

function renderImportDrafts(): void {
  importList.replaceChildren();
  const fragment = document.createDocumentFragment();
  importDrafts.forEach((draft, index) => {
    const card = document.createElement('article');
    card.className = 'import-card';
    card.dataset.localId = draft.localId;
    const head = document.createElement('div');
    head.className = 'import-card__head';
    const indexLabel = document.createElement('span');
    indexLabel.className = 'import-card__index';
    indexLabel.textContent = String(index + 1).padStart(2, '0');
    const fileLabel = document.createElement('span');
    fileLabel.className = 'source-file';
    fileLabel.textContent = draft.sourceFileName;
    const includeLabel = document.createElement('label');
    includeLabel.className = 'book-check';
    const include = document.createElement('input');
    include.type = 'checkbox';
    include.checked = true;
    include.dataset.role = 'import-include';
    includeLabel.append(include, '导入');
    head.append(indexLabel, fileLabel, includeLabel);

    const fields = document.createElement('div');
    fields.className = 'form-grid form-grid--three';
    const makeField = (labelText: string, role: string, value = '', placeholder = ''): HTMLLabelElement => {
      const label = document.createElement('label');
      label.className = 'field';
      label.append(labelText);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.placeholder = placeholder;
      input.dataset.role = role;
      label.append(input);
      return label;
    };
    fields.append(
      makeField('标题', 'import-title', draft.title),
      makeField('时间', 'import-time', draft.timeText, '例如：2018年秋'),
      makeField('成书分组', 'import-group', '', '可留空'),
    );

    const badges = document.createElement('div');
    badges.className = 'import-card__badges';
    if (draft.titleGenerated) {
      const tag = document.createElement('span');
      tag.className = 'origin-tag';
      tag.textContent = '原标题缺失，标题由程序生成';
      badges.append(tag);
    }
    for (const warning of draft.warnings) {
      const warningTag = document.createElement('span');
      warningTag.className = 'warning-tag';
      warningTag.textContent = warning;
      badges.append(warningTag);
    }
    const preview = document.createElement('p');
    preview.className = 'import-card__preview';
    preview.textContent = draft.body.length > 360 ? `${draft.body.slice(0, 360)}……` : draft.body;
    card.append(head, fields, badges, preview);
    fragment.append(card);
  });
  importList.append(fragment);
}

async function handleFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  importStatus.textContent = `正在解析 ${files.length} 份文档……`;
  confirmImportButton.disabled = true;
  try {
    importDrafts = await importDocumentFiles(files, library.memories.map((memory) => memory.title));
    renderImportDrafts();
    importStatus.textContent = `已解析 ${importDrafts.length} 份文档，请确认后加入。`;
    importDialog.showModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : '文档解析失败。';
    showToast(message, 'error');
    importStatus.textContent = message;
  } finally {
    confirmImportButton.disabled = false;
    fileInput.value = '';
    dropFileInput.value = '';
  }
}

function confirmImport(): void {
  const cards = [...importList.querySelectorAll<HTMLElement>('.import-card')];
  const newMemories: MemoryEntry[] = [];
  let skipped = 0;
  cards.forEach((card) => {
    const include = card.querySelector<HTMLInputElement>('[data-role="import-include"]');
    const title = card.querySelector<HTMLInputElement>('[data-role="import-title"]');
    const time = card.querySelector<HTMLInputElement>('[data-role="import-time"]');
    const group = card.querySelector<HTMLInputElement>('[data-role="import-group"]');
    const draft = importDrafts.find((item) => item.localId === card.dataset.localId);
    if (!include?.checked || !draft) {
      skipped += 1;
      return;
    }
    const titleText = title?.value.trim() || draft.title;
    newMemories.push(createMemory({
      title: titleText,
      timeText: time?.value.trim() || '时间待考',
      body: draft.body,
      sourceFileName: draft.sourceFileName,
      titleOrigin: draft.titleGenerated && titleText === draft.title ? 'generated' : 'original',
      includedInBook: true,
      bookGroup: group?.value.trim() ?? '',
    }));
  });
  if (newMemories.length === 0) {
    showToast('没有选择任何篇章。');
    return;
  }
  const original = [...library.memories, ...newMemories];
  const memories = library.orderMode === 'manual' ? withNormalizedManualOrder(original) : original;
  if (!persist({ ...library, memories })) return;
  selectedMemoryId = newMemories[0]?.id ?? selectedMemoryId;
  importDrafts = [];
  importDialog.close();
  renderWorkspace();
  showToast(`已加入 ${newMemories.length} 篇，跳过 ${skipped} 篇。`, 'success');
}
function renderPeopleDialog(): void {
  const detected = listDetectedPeople(library.memories, library.people);
  peopleList.replaceChildren();
  if (detected.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state empty-state--compact';
    empty.innerHTML = '<p>还没有识别到反复出现的人名。</p><span>可以手动补充一个人名。</span>';
    peopleList.append(empty);
  }
  for (const person of detected) {
    const row = document.createElement('article');
    row.className = 'person-row';
    row.dataset.rawName = person.rawName;
    const head = document.createElement('div');
    head.className = 'person-row__head';
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'person-name';
    nameButton.textContent = person.rawName;
    const count = document.createElement('span');
    count.className = 'person-count';
    count.textContent = person.count > 0 ? `出现 ${person.count} 次` : '手动补充';
    head.append(nameButton, count);

    const aliasLabel = document.createElement('label');
    aliasLabel.className = 'field field--inline';
    aliasLabel.append('显示名');
    const aliasInput = document.createElement('input');
    aliasInput.type = 'text';
    aliasInput.maxLength = 20;
    aliasInput.placeholder = '修正或与另一名字合并';
    aliasInput.value = library.people.aliases[person.rawName] ?? '';
    aliasInput.dataset.role = 'person-alias';
    aliasLabel.append(aliasInput);

    const ignoreLabel = document.createElement('label');
    ignoreLabel.className = 'book-check';
    const ignore = document.createElement('input');
    ignore.type = 'checkbox';
    ignore.checked = person.ignored;
    ignore.dataset.role = 'person-ignore';
    ignoreLabel.append(ignore, '忽略误识别');

    const details = document.createElement('div');
    details.className = 'person-row__details';
    const mentions = library.memories
      .filter((memory) => memory.body.includes(person.rawName))
      .map((memory) => memory.title);
    details.textContent = mentions.length ? `出现在：${mentions.join('、')}` : '还没有出现在正文中。';
    row.append(head, aliasLabel, ignoreLabel, details);
    peopleList.append(row);
  }
}

function openPeopleDialog(): void {
  renderPeopleDialog();
  peopleDialog.showModal();
}

function getCurrentBook(): BookDocument | null {
  const selected = getTimelineMemories().filter((memory) => memory.includedInBook);
  if (selected.length === 0) return null;
  return buildBook(getTimelineMemories(), library.book, PARSE_OPTIONS, library.people);
}

let editorDictation: DictationController | null = null;

function beginNewMemory(): void {
  dictation.stop();
  editorDictation?.stop();
  isCreatingMemory = true;
  selectedMemoryId = null;
  renderEditorSurface();
  switchView('writing');
}

function switchView(view: 'writing' | 'timeline' | 'book' | 'data'): void {
  viewButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  viewPanels.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  if (view !== 'writing') {
    dictation.stop();
    editorDictation?.stop();
  }
  if (view === 'timeline') {
    timelineOrderMode.value = library.orderMode;
    renderTimelineView();
  }
  if (view === 'book') renderBookPanel();
}

const dictation: DictationController = createDictation({
  onFinalText: (text) => {
    const bodyField = getFormControl<HTMLTextAreaElement>(editForm, 'body', 'textarea');
    if (!bodyField) return;
    dictationBaseText = `${dictationBaseText}${text}`;
    bodyField.value = dictationBaseText;
    bodyField.dispatchEvent(new Event('input', { bubbles: true }));
  },
  onInterimText: (text) => {
    const bodyField = getFormControl<HTMLTextAreaElement>(editForm, 'body', 'textarea');
    if (!bodyField) return;
    dictationInterim = text;
    bodyField.value = `${dictationBaseText}${dictationInterim}`;
    voiceStatus.textContent = text ? `正在识别：${text}` : '语音输入已开启，正在聆听。';
  },
  onStateChange: (listening) => {
    voiceInputButton.classList.toggle('is-listening', listening);
    voiceInputButton.setAttribute('aria-pressed', String(listening));
    voiceInputButton.innerHTML = listening
      ? '<span aria-hidden="true">■</span> 停止语音'
      : '<span aria-hidden="true">●</span> 语音输入';
    if (!listening) voiceStatus.textContent = '语音输入已停止。';
  },
  onError: (message) => {
    voiceStatus.textContent = message;
    showToast(message, 'error');
  },
});

editorDictation = createDictation({
  onFinalText: (text) => {
    const body = getEditorBody();
    const status = editorSurface.querySelector<HTMLElement>('.editor-save-status');
    if (!body) return;
    editorDictationBase = `${editorDictationBase}${text}`;
    body.value = editorDictationBase;
    body.dispatchEvent(new Event('input', { bubbles: true }));
    if (status) status.textContent = '有未保存的修改';
  },
  onInterimText: (text) => {
    const body = getEditorBody();
    const status = editorSurface.querySelector<HTMLElement>('.editor-save-status');
    if (!body) return;
    editorInterim = text;
    body.value = `${editorDictationBase}${editorInterim}`;
    if (status) status.textContent = text ? `识别中：${text}` : '正在聆听';
  },
  onStateChange: (listening) => {
    const voice = editorSurface.querySelector<HTMLButtonElement>('.voice-button');
    if (voice) {
      voice.classList.toggle('is-listening', listening);
      voice.textContent = listening ? '停止语音' : '语音输入';
    }
  },
  onError: (message) => showToast(message, 'error'),
});
entryList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest<HTMLElement>('.entry-card');
  const id = card?.dataset.id;
  if (!card || !id) return;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  const memory = library.memories.find((item) => item.id === id);
  if (!memory) return;
  if (!action) {
    selectedMemoryId = id;
    renderEntryList();
    renderEditorSurface();
    return;
  }
  if (action === 'select') {
    selectedMemoryId = id;
    renderEntryList();
    renderEditorSurface();
  } else if (action === 'edit') {
    openEditDialog(memory);
  } else if (action === 'delete') {
    if (!window.confirm(`确定删除《${memory.title}》吗？`)) return;
    const remaining = library.memories.filter((item) => item.id !== id);
    const memories = library.orderMode === 'manual' ? withNormalizedManualOrder(remaining) : remaining;
    if (persist({ ...library, memories })) {
      renderWorkspace();
      showToast('这一篇已删除。');
    }
  } else if (action === 'move-up') {
    moveMemory(id, -1);
  } else if (action === 'move-down') {
    moveMemory(id, 1);
  }
});

entryList.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== 'toggle-book') return;
  const id = target.closest<HTMLElement>('.entry-card')?.dataset.id;
  if (id) updateMemoryById(id, { includedInBook: target.checked });
});

entryList.addEventListener('dragstart', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest<HTMLElement>('.entry-card');
  if (!card?.dataset.id) return;
  draggedMemoryId = card.dataset.id;
  card.classList.add('is-dragging');
  event.dataTransfer?.setData('text/plain', draggedMemoryId);
});
entryList.addEventListener('dragover', (event) => {
  event.preventDefault();
  const target = event.target;
  if (target instanceof Element) target.closest<HTMLElement>('.entry-card')?.classList.add('is-drop-target');
});
entryList.addEventListener('dragleave', (event) => {
  const target = event.target;
  if (target instanceof Element) target.closest<HTMLElement>('.entry-card')?.classList.remove('is-drop-target');
});
entryList.addEventListener('drop', (event) => {
  event.preventDefault();
  entryList.querySelectorAll('.is-drop-target').forEach((element) => element.classList.remove('is-drop-target'));
  const target = event.target;
  if (!(target instanceof Element)) return;
  const targetId = target.closest<HTMLElement>('.entry-card')?.dataset.id;
  const sourceId = draggedMemoryId ?? event.dataTransfer?.getData('text/plain');
  if (sourceId && targetId) reorderMemory(sourceId, targetId);
});
entryList.addEventListener('dragend', () => {
  draggedMemoryId = null;
  entryList.querySelectorAll('.is-dragging, .is-drop-target').forEach((element) => element.classList.remove('is-dragging', 'is-drop-target'));
});

orderButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.orderMode === 'auto') {
      persist({ ...library, orderMode: 'auto' });
      renderWorkspace();
      return;
    }
    const memories = withNormalizedManualOrder(getTimelineMemories());
    if (persist({ ...library, orderMode: 'manual', memories })) renderWorkspace();
  });
});

editorSurface.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  const memory = library.memories.find((item) => item.id === selectedMemoryId);
  if (!memory || !action) return;
  if (action === 'edit') {
    openEditDialog(memory);
  } else if (action === 'delete') {
    if (!window.confirm(`确定删除《${memory.title}》吗？`)) return;
    const remaining = library.memories.filter((item) => item.id !== memory.id);
    const memories = library.orderMode === 'manual' ? withNormalizedManualOrder(remaining) : remaining;
    if (persist({ ...library, memories })) {
      selectedMemoryId = memories[0]?.id ?? null;
      renderWorkspace();
    }
  }
});

editorSurface.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== 'toggle-book' || !selectedMemoryId) return;
  updateMemoryById(selectedMemoryId, { includedInBook: target.checked });
});
manualAddButton.addEventListener('click', beginNewMemory);

viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (view === 'writing' || view === 'timeline' || view === 'book' || view === 'data') {
      switchView(view);
    }
  });
});

timelineOrderMode.addEventListener('change', () => {
  const orderMode = timelineOrderMode.value === 'manual' ? 'manual' : 'auto';
  const memories = orderMode === 'manual' ? withNormalizedManualOrder(getTimelineMemories()) : library.memories;
  persist({ ...library, orderMode, memories });
  renderWorkspace();
});
timelineGroupMode.addEventListener('change', renderTimelineView);
timelineSelectAllButton.addEventListener('click', () => {
  const ids = getTimelineMemories().map((memory) => memory.id);
  if (timelineSelection.size === ids.length) timelineSelection.clear();
  else ids.forEach((id) => timelineSelection.add(id));
  renderTimelineView();
});
timelineBatchTimeButton.addEventListener('click', () => {
  const timeText = timelineBatchTime.value.trim();
  if (timelineSelection.size === 0 || !timeText) {
    showToast('请选择篇目并填写时间。', 'error');
    return;
  }
  const memories = library.memories.map((memory) =>
    timelineSelection.has(memory.id) ? updateMemory(memory, { timeText }) : memory,
  );
  timelineSelection.clear();
  timelineBatchTime.value = '';
  if (persist({ ...library, memories })) renderWorkspace();
});
timelineBatchDeleteButton.addEventListener('click', () => {
  if (timelineSelection.size === 0 || !window.confirm(`确定删除选中的 ${timelineSelection.size} 篇吗？`)) return;
  const memories = library.memories.filter((memory) => !timelineSelection.has(memory.id));
  timelineSelection.clear();
  if (persist({ ...library, memories })) renderWorkspace();
});
timelineList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>('.timeline-row');
  const id = row?.dataset.id;
  const memory = library.memories.find((item) => item.id === id);
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!memory || !action) return;
  if (action === 'timeline-edit') {
    openEditDialog(memory);
  } else if (action === 'timeline-delete' && window.confirm(`确定删除《${memory.title}》吗？`)) {
    const memories = library.memories.filter((item) => item.id !== memory.id);
    timelineSelection.delete(memory.id);
    if (persist({ ...library, memories })) renderWorkspace();
  }
});
timelineList.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const id = target.closest<HTMLElement>('.timeline-row')?.dataset.id;
  if (!id) return;
  if (target.dataset.role === 'timeline-select') {
    if (target.checked) timelineSelection.add(id);
    else timelineSelection.delete(id);
    renderTimelineView();
  } else if (target.dataset.role === 'timeline-include') {
    updateMemoryById(id, { includedInBook: target.checked });
    renderBookPanel();
  }
});
timelineList.addEventListener('dragstart', (event) => {
  if (library.orderMode !== 'manual') return;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('.timeline-drag-handle')) return;
  const row = target.closest<HTMLElement>('.timeline-row');
  if (!row?.dataset.id) return;
  draggedMemoryId = row.dataset.id;
  row.classList.add('is-dragging');
  event.dataTransfer?.setData('text/plain', draggedMemoryId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

timelineList.addEventListener('dragover', (event) => {
  if (library.orderMode !== 'manual' || !draggedMemoryId) return;
  event.preventDefault();
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>('.timeline-row');
  if (!row || row.dataset.id === draggedMemoryId) return;
  timelineList.querySelectorAll('.is-drop-before, .is-drop-after').forEach((element) => {
    element.classList.remove('is-drop-before', 'is-drop-after');
  });
  const rect = row.getBoundingClientRect();
  row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'is-drop-before' : 'is-drop-after');
});

timelineList.addEventListener('drop', (event) => {
  if (library.orderMode !== 'manual') return;
  event.preventDefault();
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>('.timeline-row');
  const targetId = row?.dataset.id;
  const sourceId = draggedMemoryId ?? event.dataTransfer?.getData('text/plain');
  if (!row || !targetId || !sourceId) return;
  const rect = row.getBoundingClientRect();
  const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  reorderMemory(sourceId, targetId, placement);
});

timelineList.addEventListener('dragend', () => {
  draggedMemoryId = null;
  timelineList.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').forEach((element) => {
    element.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
  });
});

bookSelectionList.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.role !== 'book-select') return;
  const id = target.closest<HTMLElement>('.book-selection-row')?.dataset.id;
  if (id) {
    updateMemoryById(id, { includedInBook: target.checked });
    renderBookPanel();
  }
});
bookSelectionList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  const id = target.closest<HTMLElement>('.book-selection-row')?.dataset.id;
  if (!id) return;
  if (action === 'book-move-up') moveMemory(id, -1);
  else if (action === 'book-move-down') moveMemory(id, 1);
});
importButton.addEventListener('click', () => fileInput.click());
dropImportButton.addEventListener('click', () => dropFileInput.click());
fileInput.addEventListener('change', () => void handleFiles([...fileInput.files ?? []]));
dropFileInput.addEventListener('change', () => void handleFiles([...dropFileInput.files ?? []]));
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  void handleFiles([...event.dataTransfer?.files ?? []]);
});
searchInput.addEventListener('input', renderEntryList);
dataSearchInput.addEventListener('input', renderDataSearchResults);
searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const firstCard = entryList.querySelector<HTMLElement>('.entry-card');
  if (firstCard?.dataset.id) {
    selectedMemoryId = firstCard.dataset.id;
    isCreatingMemory = false;
    renderEntryList();
    renderEditorSurface();
  }
  firstCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  firstCard?.classList.add('search-jump');
  window.setTimeout(() => firstCard?.classList.remove('search-jump'), 1200);
});
confirmImportButton.addEventListener('click', confirmImport);

editForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(editForm);
  const id = String(formData.get('id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const timeText = String(formData.get('timeText') ?? '').trim() || '时间待考';
  const bookGroup = String(formData.get('bookGroup') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title || !body) {
    editStatus.textContent = '标题和正文不能为空。';
    editStatus.dataset.tone = 'error';
    return;
  }
  const existing = id ? library.memories.find((item) => item.id === id) : null;
  let savedMemoryId = existing?.id ?? null;
  if (existing) {
    const memories = library.memories.map((memory) =>
      memory.id === id
        ? updateMemory(memory, {
            title,
            timeText,
            body,
            bookGroup,
            titleOrigin: title === existing.title ? existing.titleOrigin : 'manual',
          })
        : memory,
    );
    persist({ ...library, memories });
  } else {
    const newMemory = createMemory({ title, timeText, body, bookGroup, titleOrigin: 'manual' });
    const original = [...library.memories, newMemory];
    const memories = library.orderMode === 'manual' ? withNormalizedManualOrder(original) : original;
    persist({ ...library, memories });
    savedMemoryId = newMemory.id;
  }
  selectedMemoryId = savedMemoryId ?? selectedMemoryId;
  dictation.stop();
  editDialog.close();
  renderWorkspace();
  showToast(existing ? '篇章已更新。' : '新篇章已加入。', 'success');
});

regenerateTitleButton.addEventListener('click', () => {
  const bodyField = getFormControl<HTMLTextAreaElement>(editForm, 'body', 'textarea');
  const titleField = getFormControl<HTMLInputElement>(editForm, 'title', 'input');
  const idField = getFormControl<HTMLInputElement>(editForm, 'id', 'input');
  if (!bodyField || !titleField) return;
  const existingTitles = library.memories.filter((memory) => memory.id !== (idField?.value ?? '')).map((memory) => memory.title);
  titleField.value = generateTitle(bodyField.value, existingTitles);
  showToast('已根据正文生成新标题。');
});

if (editTimeInput instanceof HTMLInputElement) {
  editTimeInput.addEventListener('input', () => renderTimePreview(editTimePreview, editTimeInput.value));
}

voiceInputButton.addEventListener('click', () => {
  const bodyField = getFormControl<HTMLTextAreaElement>(editForm, 'body', 'textarea');
  if (!bodyField) return;
  if (voiceInputButton.classList.contains('is-listening')) {
    dictation.stop();
    return;
  }
  dictationBaseText = bodyField.value;
  dictationInterim = '';
  voiceStatus.textContent = '语音输入已开启，正在聆听。';
  dictation.start();
});
bookTitleInput.addEventListener('input', () => setBookSettings({ title: bookTitleInput.value }));
bookSubtitleInput.addEventListener('input', () => setBookSettings({ subtitle: bookSubtitleInput.value }));
bookAuthorInput.addEventListener('input', () => setBookSettings({ author: bookAuthorInput.value }));
bookPrefaceInput.addEventListener('input', () => setBookSettings({ preface: bookPrefaceInput.value }));
bookAfterwordInput.addEventListener('input', () => setBookSettings({ afterword: bookAfterwordInput.value }));
chapterModeSelect.addEventListener('change', () => {
  const value = chapterModeSelect.value;
  setBookSettings({ chapterMode: value === 'academic-year' || value === 'manual-group' ? value : 'year' });
});

requireElement<HTMLButtonElement>('#select-all').addEventListener('click', () => {
  persist({ ...library, memories: library.memories.map((memory) => ({ ...memory, includedInBook: true })) });
  renderWorkspace();
});
requireElement<HTMLButtonElement>('#clear-selection').addEventListener('click', () => {
  persist({ ...library, memories: library.memories.map((memory) => ({ ...memory, includedInBook: false })) });
  renderWorkspace();
});

previewBookButton.addEventListener('click', () => {
  currentBook = getCurrentBook();
  if (!currentBook) {
    showToast('至少选择一篇再生成书稿。', 'error');
    return;
  }
  bookPreviewTitle.textContent = currentBook.title;
  bookFrame.srcdoc = renderBookHtml(currentBook);
  bookDialog.showModal();
});

downloadBookButton.addEventListener('click', () => {
  if (!currentBook) return;
  downloadBlob(
    new Blob([renderBookHtml(currentBook)], { type: 'text/html;charset=utf-8' }),
    bookFileName(currentBook.title, 'html'),
  );
  showToast('书稿 HTML 已下载。', 'success');
});

downloadEpubButton.addEventListener('click', async () => {
  if (!currentBook) return;
  downloadEpubButton.disabled = true;
  try {
    downloadBlob(await createEpubBlob(currentBook), bookFileName(currentBook.title, 'epub'));
    showToast('EPUB 已导出，可发送到阅读器。', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'EPUB 导出失败。', 'error');
  } finally {
    downloadEpubButton.disabled = false;
  }
});

printBookButton.addEventListener('click', () => {
  bookFrame.contentWindow?.focus();
  bookFrame.contentWindow?.print();
});

peopleIndexButton.addEventListener('click', openPeopleDialog);
peopleList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const nameButton = target.closest<HTMLButtonElement>('.person-name');
  if (nameButton) nameButton.closest('.person-row')?.classList.toggle('is-expanded');
});

peopleList.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const rawName = target.closest<HTMLElement>('.person-row')?.dataset.rawName;
  if (!rawName) return;
  if (target.dataset.role === 'person-alias') {
    const aliases = { ...library.people.aliases };
    const value = target.value.trim();
    if (value) aliases[rawName] = value;
    else delete aliases[rawName];
    const people: PeopleCorrections = { ...library.people, aliases };
    persist({ ...library, people });
    renderPeopleDialog();
  } else if (target.dataset.role === 'person-ignore') {
    const ignored = new Set(library.people.ignoredNames);
    if (target.checked) ignored.add(rawName);
    else ignored.delete(rawName);
    const people: PeopleCorrections = { ...library.people, ignoredNames: [...ignored] };
    persist({ ...library, people });
    renderPeopleDialog();
  }
});

addExtraPersonButton.addEventListener('click', () => {
  const name = extraPersonInput.value.trim();
  if (!name) return;
  const names = new Set(library.people.extraNames);
  names.add(name);
  const people: PeopleCorrections = { ...library.people, extraNames: [...names] };
  persist({ ...library, people });
  extraPersonInput.value = '';
  renderPeopleDialog();
});

exportDataButton.addEventListener('click', async () => {
  exportDataButton.disabled = true;
  try {
    downloadBlob(await createLibraryExportBlob(library, getTimelineMemories()), '拾年回忆录-全部数据.zip');
    showToast('全部数据和 Markdown 已打包。', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '数据导出失败。', 'error');
  } finally {
    exportDataButton.disabled = false;
  }
});

chooseBackupButton.addEventListener('click', async () => {
  try {
    backupDirectory = await chooseBackupDirectory();
    persist({ ...library, backupDirectoryName: backupDirectory.name });
    updateBackupStatus(`自动备份：${backupDirectory.name} · 正在建立初始备份……`);
    await runDirectoryBackup();
    showToast('自动备份文件夹已连接。', 'success');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    showToast(error instanceof Error ? error.message : '无法选择备份文件夹。', 'error');
  }
});

forgetBackupButton.addEventListener('click', async () => {
  await forgetBackupDirectory();
  backupDirectory = null;
  persist({ ...library, backupDirectoryName: null });
  updateBackupStatus('自动备份：未开启');
  showToast('自动备份已关闭。');
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const closeButton = target.closest<HTMLElement>('[data-close-dialog]');
  if (closeButton?.dataset.closeDialog) {
    requireElement<HTMLDialogElement>(`#${closeButton.dataset.closeDialog}`).close();
  }
});

for (const dialog of [importDialog, editDialog, peopleDialog, bookDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

editDialog.addEventListener('close', () => {
  dictation.stop();
  voiceStatus.textContent = '语音输入使用浏览器中文识别，边说边写入正文。';
});

bookTitleInput.value = library.book.title;
bookSubtitleInput.value = library.book.subtitle;
bookAuthorInput.value = library.book.author;
bookPrefaceInput.value = library.book.preface;
bookAfterwordInput.value = library.book.afterword;
chapterModeSelect.value = library.book.chapterMode;
renderWorkspace();
void initializeBackup();
switchView('writing');

