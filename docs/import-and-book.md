# 导入、编排与成书架构

## 界面分层

应用分为四个独立视图：

- `writing`：左侧篇目目录，右侧内联写作纸面。
- `timeline`：时间排序、手动拖动、分组总览和批量修改。
- `book`：选篇、顺序、分章、序后记、人物索引与成书预览。
- `data`：文档导入、全量导出、本地备份和人物设置。

主导航使用文字切换，不把数据管理操作放进写作纸面。
## 数据流

```text
文档 / 语音 / 手动输入
  ↓
原始文字、标题、时间
  ↓
MemoryEntry v3
  ↓
自动时间排序或手动顺序
  ↓
自然年份 / 学年 / 自定义分组
  ↓
HTML / 打印 PDF / EPUB
```

所有核心处理都在浏览器完成，没有后端上传。

## 文档适配层

`src/documents/document-import.ts` 负责：

- TXT、Markdown：`File.text()`
- HTML：`DOMParser`
- DOCX：动态加载 Mammoth
- PDF：动态加载 PDF.js 和 worker

已有标题按 YAML、标题字段、H1、Word 标题或短首行识别。只有没有原题时才调用 `generateTitle`。标题生成根据已有标题的平均长度、常见词尾和正文场景词组合候选，结果完全本地。

## 语音输入

`src/speech/dictation.ts` 封装 `SpeechRecognition` 和 `webkitSpeechRecognition`：

- `lang = 'zh-CN'`
- `continuous = true`
- `interimResults = true`
- 最终结果追加到正文
- 临时结果直接显示在正文，停止或转为最终文字后替换
- 不支持该 API 时返回可读错误

## v3 数据模型

```ts
interface LibraryState {
  version: 3;
  memories: MemoryEntry[];
  orderMode: 'auto' | 'manual';
  book: BookSettings;
  people: PeopleCorrections;
  backupDirectoryName: string | null;
}
```

新增字段：

- `MemoryEntry.bookGroup`：用于自定义章节。
- `BookSettings.preface / afterword`：序和后记。
- `BookSettings.chapterMode`：`year`、`academic-year` 或 `manual-group`。
- `PeopleCorrections`：人物别名、忽略列表和手动补充。
- `backupDirectoryName`：最近一次本地备份目录的显示名。

旧版 `v2` 库和更早的 `v1` 篇目数组都会迁移到 v3。

## 人物索引

`src/people/build-index.ts` 的识别过程：

1. 扫描常见中文姓氏。
2. 结合后一两个汉字生成候选名。
3. 使用“和、在、的、说、笑、走”等常见续词避免把姓和相邻动词拼成姓名。
4. 过滤“老师、校长、同学”等角色词。
5. 默认保留至少出现两次的人名。
6. 应用用户的显示名、忽略和手动补充设置。
7. 记录每个人名出现的篇目。

规则故意保持轻量，结果可能有误，因此书稿设置中提供完整的手动修正界面。

## 成书分组

`buildBook` 保留传入顺序，并按设置分章：

- `year`：时间区间中点所在自然年份。
- `academic-year`：8 月以后归入新学年，并尝试映射初中、高中年级。
- `manual-group`：使用每篇的 `bookGroup`，章节顺序由分组第一次出现的位置决定。

序放在正文前，人物索引放在正文后，后记放在最后。

## HTML 与 PDF

`renderBookHtml` 输出没有脚本、没有外部资源的独立 HTML，包含：

- 封面
- 书名页
- 版本页
- 序
- 目录
- 章节
- 人物索引
- 后记

打印样式使用 @page { size: A5; margin: 20mm 22mm; }。A5 成品为 148×210mm，扣除边距后版心约 104mm；正文为 10.5pt、1.65 行距，段首缩进两字符且不额外增加段间距。章节、序、后记、人物索引和每篇回忆均独立起页，目录带点线与页码，段落设置 orphans: 2 和 widows: 2。

## EPUB

`createEpubBlob` 使用 JSZip 直接构建 EPUB 3：

- 未压缩的 `mimetype`
- `META-INF/container.xml`
- `content.opf`
- `nav.xhtml`
- 兼容阅读器的 `toc.ncx`
- 封面、序、章节、人物索引、后记
- 内置 CSS

目录链接与自定义分组会完整保留。

## 数据安全

普通导出会创建一个 ZIP：

- `metadata.json`
- 逐篇 Markdown
- 序 Markdown
- 后记 Markdown

自动备份使用 File System Access API。目录句柄保存在 IndexedDB；每次保存后，程序会防抖写入结构化 JSON 和逐篇 Markdown。权限被浏览器撤销时会停止写入并提示重新授权。