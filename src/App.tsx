import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookMarked,
  BookOpen,
  Bookmark,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Globe2,
  Languages,
  Library,
  List,
  LoaderCircle,
  Menu,
  MessageCircle,
  Moon,
  PanelRightClose,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Answer, LibraryModal, Modal, SettingsModal } from './components';
import { buildContext, expandQuestion, streamAI, translationKey } from './lib/ai';
import { importBook } from './lib/import';
import { sampleBook, sampleTranslations } from './lib/sample';
import { loadSettings, saveSettings, storage } from './lib/storage';
import { useAutomaticTranslation } from './lib/useAutomaticTranslation';
import {
  languageName,
  type Book,
  type Message,
  type Note,
  type Paragraph,
  type Position,
} from './lib/types';

const emptyPosition: Position = { chapter: 0, paragraph: '1.1', farthest: 0 };
const scopeNames = { chapter: '当前章节', read: '截至最远章节', book: '整本书（可能剧透）' };

export default function App() {
  const [books, setBooks] = useState<Book[]>([sampleBook]);
  const [book, setBook] = useState<Book>(sampleBook);
  const [position, setPosition] = useState<Position>(emptyPosition);
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [glossary, setGlossary] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [hasServerKey, setHasServerKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(() => window.innerWidth > 720);
  const [panel, setPanel] = useState<'chat' | 'notes'>('chat');
  const [selected, setSelected] = useState<{ paragraph: Paragraph; text: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [question, setQuestion] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<'chat' | null>(null);
  const [busyText, setBusyText] = useState('');
  const [notice, setNotice] = useState('');
  const [jump, setJump] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const operation = useRef<AbortController | null>(null);
  const activation = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoring = useRef(false);
  const settingsEdited = useRef(false);
  const chapter = book.chapters[position.chapter] || book.chapters[0];
  const view = settings.readingMode;
  const readingIndex = Math.max(
    0,
    chapter.paragraphs.findIndex((p) => p.id === position.paragraph),
  );
  const readingParagraph =
    chapter.paragraphs.slice(readingIndex).find((p) => p.kind !== 'heading') ||
    chapter.paragraphs[readingIndex];
  const aiReady = Boolean(settings.baseUrl && settings.model);
  const automaticTranslation = useAutomaticTranslation({
    book,
    chapter,
    settings,
    glossary,
    readerRef,
    enabled: ready && !switching && !jump && aiReady && view !== 'original',
    getTranslation,
    onComplete: (key, value) => setTranslations((previous) => ({ ...previous, [key]: value })),
  });
  const chapterTranslationsReady = chapter.paragraphs.every((p) => Boolean(getTranslation(p)));
  const allParagraphs = book.chapters.flatMap((c) => c.paragraphs);
  const progress = Math.round(
    ((Math.max(
      0,
      allParagraphs.findIndex((p) => p.id === position.paragraph),
    ) +
      1) /
      allParagraphs.length) *
      100,
  );

  function report(error: unknown) {
    setNotice(error instanceof Error ? error.message : String(error));
  }
  async function activate(next: Book) {
    const token = ++activation.current;
    operation.current?.abort();
    operation.current = null;
    setBusy(null);
    setBusyText('');
    setSwitching(true);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    try {
      const [savedPosition, savedNotes, savedMessages, savedTranslations, savedGlossary] =
        await Promise.all([
          storage.position(next.id),
          storage.notes(next.id),
          storage.chat(next.id),
          storage.translations(next.id),
          storage.glossary(next.id),
        ]);
      if (token !== activation.current) return;
      const pos = savedPosition || {
        ...emptyPosition,
        paragraph: next.chapters[0].paragraphs[0].id,
      };
      const safePosition = {
        ...pos,
        chapter: Math.min(next.chapters.length - 1, Math.max(0, pos.chapter)),
        farthest: Math.min(next.chapters.length - 1, Math.max(0, pos.farthest)),
      };
      setBook(next);
      setPosition(safePosition);
      setNotes(savedNotes);
      setMessages(savedMessages);
      setTranslations(savedTranslations);
      setGlossary(savedGlossary);
      setSelected(null);
      setNoteDraft('');
      setSearch('');
      setQuestion('');
      setBusy(null);
      setJump(safePosition.paragraph);
      try {
        localStorage.setItem('ai-read-active', next.id);
      } catch {
        /* Reading remains available if preferences cannot be stored. */
      }
    } catch (error) {
      report(error);
    } finally {
      if (token === activation.current) {
        setSwitching(false);
        setReady(true);
      }
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stored = await storage.books();
        const list = [
          sampleBook,
          ...stored.filter((b) => !b.sample).sort((a, b) => b.importedAt - a.importedAt),
        ];
        if (!alive) return;
        setBooks(list);
        let active = '';
        try {
          active = localStorage.getItem('ai-read-active') || '';
        } catch {
          /* optional preference */
        }
        await activate(list.find((b) => b.id === active) || sampleBook);
      } catch (error) {
        if (alive) {
          report(error);
          setReady(true);
        }
      }
    })();
    fetch('/api/config')
      .then((r) => r.json())
      .then((config) => {
        if (!alive) return;
        setHasServerKey(config.hasKey);
        if (!settingsEdited.current)
          setSettings((s) => ({
            ...s,
            baseUrl: s.baseUrl || config.baseUrl || '',
            model: s.model || config.model || '',
          }));
      })
      .catch(() => {
        if (alive) setNotice('AI 服务暂时不可用，仍可继续本地阅读。');
      });
    return () => {
      alive = false;
      activation.current++;
      operation.current?.abort();
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    try {
      saveSettings(settings);
    } catch {
      setNotice('偏好设置无法保存到浏览器。');
    }
  }, [settings]);
  useEffect(() => {
    if (ready && !switching) void storage.savePosition(book.id, position).catch(report);
  }, [book.id, position, ready, switching]);
  useEffect(() => {
    if (ready && !switching) void storage.saveNotes(book.id, notes).catch(report);
  }, [book.id, notes, ready, switching]);
  useEffect(() => {
    if (ready && !switching && !busy) void storage.saveChat(book.id, messages).catch(report);
  }, [book.id, messages, busy, ready, switching]);
  useEffect(() => {
    if (ready && !switching) void storage.saveTranslations(book.id, translations).catch(report);
  }, [book.id, translations, ready, switching]);
  useEffect(() => {
    if (!jump) return;
    restoring.current = true;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`passage-${jump}`)?.scrollIntoView({ block: 'start' });
      setJump(null);
      requestAnimationFrame(() => {
        restoring.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, chapter.id, book.id]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busyText]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        setSidebarOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  function navigate(id: string) {
    const index = book.chapters.findIndex((c) => c.paragraphs.some((p) => p.id === id));
    if (index < 0) return;
    setSelected(null);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    setPosition((p) => ({ chapter: index, paragraph: id, farthest: Math.max(p.farthest, index) }));
    setJump(id);
    setSidebarOpen(false);
  }
  function toChapter(index: number) {
    const c = book.chapters[index];
    if (c) {
      setSelected(null);
      navigate(c.paragraphs[0].id);
    }
  }
  function saveScroll() {
    if (restoring.current || switching || !ready) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const root = readerRef.current;
      if (!root || restoring.current) return;
      const top = root.getBoundingClientRect().top + 100;
      const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]'));
      const closest = elements.find((el) => el.getBoundingClientRect().bottom > top);
      if (closest?.dataset.paragraph)
        setPosition((p) => ({ ...p, paragraph: closest.dataset.paragraph! }));
    }, 180);
  }
  function readSelection() {
    const selection = window.getSelection();
    const value = selection?.toString().trim();
    if (!value || value.length < 2 || !selection?.anchorNode || !selection.focusNode) return;
    if (
      !readerRef.current?.contains(selection.anchorNode) ||
      !readerRef.current.contains(selection.focusNode)
    )
      return;
    const anchor =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode.parentElement;
    const id = anchor?.closest('[data-paragraph]')?.getAttribute('data-paragraph');
    const paragraph = chapter.paragraphs.find((p) => p.id === id);
    if (paragraph) {
      setSelected({ paragraph, text: value.slice(0, 4000) });
      setNoteDraft('');
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const next = await importBook(file);
      await storage.saveBook(next);
      setBooks((list) => [sampleBook, next, ...list.filter((b) => b.id !== next.id && !b.sample)]);
      await activate(next);
      setLibraryOpen(false);
      setNotice(`已导入《${next.title}》`);
    } catch (error) {
      report(error);
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }
  async function removeBook() {
    if (!deleteTarget) return;
    try {
      await storage.deleteBook(deleteTarget.id);
      setBooks((list) => list.filter((b) => b.id !== deleteTarget.id));
      if (book.id === deleteTarget.id) await activate(sampleBook);
      setDeleteTarget(null);
    } catch (error) {
      report(error);
    }
  }
  function getTranslation(p: Paragraph) {
    if (book.language.toLowerCase() === settings.language.toLowerCase()) return p.text;
    return (
      translations[translationKey(settings, p.id, glossary)] ||
      (book.sample && settings.language === 'zh-CN'
        ? sampleTranslations[`zh-CN:${p.id}:sample`]
        : '')
    );
  }
  async function ask(prompt: string, passage = selected) {
    if (busy || !prompt.trim()) return;
    if (!aiReady) {
      setQuestion(prompt);
      setSettingsOpen(true);
      return;
    }
    setCompanionOpen(true);
    setPanel('chat');
    const controller = new AbortController();
    operation.current = controller;
    setBusy('chat');
    setQuestion('');
    const focus = passage || { paragraph: readingParagraph, text: readingParagraph.text };
    const allowedIds = new Set(
      book.chapters.flatMap((c, i) =>
        (
          settings.scope === 'chapter'
            ? i === position.chapter
            : settings.scope === 'read'
              ? i <= Math.max(position.farthest, position.chapter)
              : true
        )
          ? c.paragraphs.map((p) => p.id)
          : [],
      ),
    );
    const history: Message[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const user = messages[i],
        assistant = messages[i + 1];
      if (
        user.role === 'user' &&
        assistant.role === 'assistant' &&
        !assistant.partial &&
        assistant.sources?.every((id) => allowedIds.has(id))
      )
        history.push(user, assistant);
    }
    const userContent = passage
      ? `${prompt}\n\n「${passage.text.slice(0, 500)}」`
      : `${prompt}\n\n（阅读位置：段落 ${focus.paragraph.id}）`;
    const next: Message[] = [
      ...messages,
      { role: 'user', content: userContent },
      { role: 'assistant', content: '', sources: [] },
    ];
    setMessages(next);
    let output = '';
    let sourceIds: string[] = [];
    try {
      setBusyText('正在阅读相关段落…');
      let context = buildContext(
        book,
        position.chapter,
        position.farthest,
        settings.scope,
        prompt,
        focus.paragraph,
      );
      if (context.partial) {
        setBusyText('正在跨语言查找相关原文…');
        let terms = '';
        try {
          terms = await expandQuestion(
            settings,
            book,
            prompt,
            focus.text,
            history.slice(-8),
            controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) throw error;
          setNotice('跨语言检索词生成失败，本次使用问题原文检索。');
        }
        context = buildContext(
          book,
          position.chapter,
          position.farthest,
          settings.scope,
          `${prompt} ${terms}`,
          focus.paragraph,
        );
      }
      sourceIds = context.sources.map((s) => s.id);
      setBusyText(
        `参考 ${context.sources.length} / ${context.total} 段 · ${scopeNames[settings.scope]}`,
      );
      output = await streamAI(
        settings,
        {
          action: 'ask',
          title: book.title,
          question: prompt,
          selection: passage?.text,
          readingPassage: `[${focus.paragraph.id}] ${focus.paragraph.text}`,
          glossary,
          history: history.slice(-8),
          scope: `${scopeNames[settings.scope]}; passages ${context.sources.length}/${context.total}; partial=${context.partial}`,
          sources: context.sources,
        },
        controller.signal,
        (content) => {
          if (operation.current !== controller) return;
          output = content;
          setMessages([...next.slice(0, -1), { role: 'assistant', content, sources: sourceIds }]);
        },
      );
      if (operation.current === controller)
        setMessages([
          ...next.slice(0, -1),
          { role: 'assistant', content: output, sources: sourceIds },
        ]);
    } catch (error) {
      const failure = controller.signal.aborted
        ? '已停止生成。'
        : error instanceof Error
          ? error.message
          : '请求失败，请重试。';
      if (operation.current === controller)
        setMessages([
          ...next.slice(0, -1),
          {
            role: 'assistant',
            content: output ? `${output}\n\n—— ${failure}（以上内容可能不完整）` : failure,
            sources: sourceIds,
            partial: true,
          },
        ]);
    } finally {
      if (operation.current === controller) {
        setBusy(null);
        setBusyText('');
        operation.current = null;
      }
    }
  }
  function saveNote() {
    if (!selected) return;
    const note: Note = {
      id: crypto.randomUUID(),
      bookId: book.id,
      paragraphId: selected.paragraph.id,
      quote: selected.text,
      text: noteDraft.trim(),
      createdAt: Date.now(),
    };
    setNotes((previous) => [note, ...previous]);
    setNoteDraft('');
    setNotice('摘录已保存');
  }
  function exportNotes() {
    const content =
      `# ${book.title}\n\n${book.author}\n\n` +
      notes
        .map(
          (n) => `## 段落 ${n.paragraphId}\n\n> ${n.quote.replace(/\n/g, '\n> ')}\n\n${n.text}\n`,
        )
        .join('\n---\n\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title.replace(/[\\/:*?"<>|]/g, '_')}-notes.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const searchResults = search.trim()
    ? allParagraphs
        .filter((p) => p.text.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 60)
    : [];

  return (
    <div className={`app ${companionOpen ? '' : 'without-companion'}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.txt"
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <aside className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setLibraryOpen(true);
          }}
        >
          <span className="brand-mark">
            <BookOpen size={22} strokeWidth={1.6} />
          </span>
          <span>
            ai<span className="brand-dot">.</span>read
          </span>
          <span className="beta">ALPHA</span>
        </a>
        <button className="library-button" onClick={() => setLibraryOpen(true)}>
          <Library size={17} />
          <span>我的书架</span>
          <ChevronRight size={15} />
        </button>
        <div className="sidebar-rule" />
        <div className="current-book">
          <div className="mini-cover">
            <BookOpen size={25} strokeWidth={1.2} />
          </div>
          <div>
            <strong>{book.title}</strong>
            <span>{book.author}</span>
          </div>
        </div>
        <div className="sidebar-label">
          <span>
            目录 <small>{book.chapters.length}</small>
          </span>
          <button
            className={`icon-button ${searchOpen ? 'active' : ''}`}
            onClick={() => setSearchOpen((v) => !v)}
            title="搜索书内文字 ⌘K"
            aria-label="搜索书内文字"
          >
            <Search size={16} />
          </button>
        </div>
        {searchOpen && (
          <div className="book-search">
            <Search size={14} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索原文…"
            />
            <button
              className="icon-button"
              onClick={() => {
                setSearch('');
                setSearchOpen(false);
              }}
              aria-label="关闭搜索"
            >
              <X size={13} />
            </button>
          </div>
        )}
        <nav className="chapter-list" aria-label="章节目录">
          {search.trim() ? (
            searchResults.length ? (
              searchResults.map((p) => (
                <button
                  className="search-result"
                  key={p.id}
                  onClick={() => {
                    navigate(p.id);
                    setSearch('');
                  }}
                >
                  <small>段落 {p.id}</small>
                  <span>{p.text.slice(0, 130)}</span>
                </button>
              ))
            ) : (
              <p className="empty-search">没有找到匹配的原文</p>
            )
          ) : (
            book.chapters.map((c, i) => (
              <button
                key={c.id}
                className={`chapter-item ${position.chapter === i ? 'current' : ''}`}
                onClick={() => toChapter(i)}
                disabled={switching}
              >
                <span className="chapter-number">{String(i + 1).padStart(2, '0')}</span>
                <span>{c.title}</span>
                {position.chapter === i && <span className="current-dot" />}
              </button>
            ))
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="import-button"
            onClick={() => inputRef.current?.click()}
            disabled={importing}
          >
            <Plus size={17} />
            {importing ? '正在导入…' : '添加一本新书'}
          </button>
          <div className="local-badge">
            <span />
            本地书库 · 自由阅读
            <button
              className="icon-button"
              onClick={() => setHelpOpen(true)}
              aria-label="关于 AI Read"
            >
              <CircleHelp size={15} />
            </button>
          </div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭目录"
        />
      )}

      <section className="reading-area">
        <header className="reading-header">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="打开目录"
            >
              <Menu size={19} />
            </button>
            <BookOpen size={15} />
            <span>{book.sample ? '开始阅读' : book.title}</span>
            <ChevronRight size={12} />
            <strong>第 {position.chapter + 1} 章</strong>
          </div>
          <div className="header-actions">
            <span className="language-badge">
              {book.language === 'auto' ? '原文' : book.language.toUpperCase()}{' '}
              <ArrowRight size={12} /> {languageName(settings.language)}
            </span>
            <button
              className="icon-button"
              onClick={() => {
                setPanel('notes');
                setCompanionOpen(true);
              }}
              title="阅读笔记"
              aria-label="阅读笔记"
            >
              <Bookmark size={18} />
            </button>
            <button
              className={`icon-button ${companionOpen ? 'active' : ''}`}
              onClick={() => setCompanionOpen((v) => !v)}
              title="AI 伴读"
              aria-label="切换 AI 伴读"
            >
              <Sparkles size={18} />
            </button>
          </div>
        </header>
        <div className="reading-toolbar">
          <div className="segmented" role="group" aria-label="阅读语言模式">
            {(
              [
                ['original', '原文'],
                ['bilingual', '双语'],
                ['translation', '译文'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={view === id ? 'chosen' : ''}
                aria-pressed={view === id}
                onClick={() => setSettings((s) => ({ ...s, readingMode: id }))}
              >
                {id === 'bilingual' && <Languages size={14} />}
                {label}
              </button>
            ))}
          </div>
          <div className="type-controls">
            <button
              className="icon-button"
              onClick={() => setSettings((s) => ({ ...s, fontSize: Math.max(15, s.fontSize - 1) }))}
              aria-label="减小字号"
              title="减小字号"
            >
              <span className="small-a">A</span>
            </button>
            <span className="font-value">{settings.fontSize}</span>
            <button
              className="icon-button"
              onClick={() => setSettings((s) => ({ ...s, fontSize: Math.min(26, s.fontSize + 1) }))}
              aria-label="增大字号"
              title="增大字号"
            >
              A
            </button>
            <span className="toolbar-divider" />
            <button
              className="icon-button"
              onClick={() =>
                setSettings((s) => ({ ...s, theme: s.theme === 'paper' ? 'night' : 'paper' }))
              }
              title="切换阅读主题"
              aria-label="切换阅读主题"
            >
              {settings.theme === 'paper' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>
        {selected && (
          <div className="selection-bar">
            <span>已选文字</span>
            <button onClick={() => void ask('请结合上下文解释这段文字。')} disabled={Boolean(busy)}>
              <Sparkles size={13} />
              解释
            </button>
            <button
              onClick={() => {
                setPanel('notes');
                setCompanionOpen(true);
              }}
            >
              <Bookmark size={13} />
              摘录
            </button>
            <button className="icon-button" onClick={() => setSelected(null)} aria-label="取消选择">
              <X size={14} />
            </button>
          </div>
        )}
        <main
          className={`reader-scroll ${view}`}
          ref={readerRef}
          onScroll={saveScroll}
          aria-label="书籍正文"
          aria-busy={!ready || switching}
        >
          <article
            className="book-page"
            style={{ '--reader-font-size': `${settings.fontSize}px` } as CSSProperties}
            onMouseUp={readSelection}
            onKeyUp={readSelection}
          >
            <div className="chapter-eyebrow">
              <span /> CHAPTER {String(position.chapter + 1).padStart(2, '0')}
            </div>
            <h1>{chapter.title}</h1>
            <div className="chapter-meta">
              <span>{book.title}</span>
              <span className="meta-dot">·</span>
              <span>{chapter.paragraphs.length} 段</span>
              {book.sample && <span className="sample-label">原创双语示例</span>}
            </div>
            <div className="chapter-ornament">
              <span />
              <BookOpen size={17} strokeWidth={1} />
              <span />
            </div>
            {view !== 'original' && (
              <div className="translation-toolbar">
                <span>
                  <Globe2 size={13} />
                  {languageName(settings.language)}
                  {book.sample && settings.language === 'zh-CN' ? ' · 预置译文' : ' · 自动翻译'}
                </span>
                {chapterTranslationsReady ? (
                  <span>译文已就绪</span>
                ) : !aiReady ? (
                  <button onClick={() => setSettingsOpen(true)}>连接模型，自动准备译文</button>
                ) : automaticTranslation.status === 'error' ? (
                  <button onClick={automaticTranslation.retry} title={automaticTranslation.error}>
                    译文暂不可用 · 重试
                  </button>
                ) : (
                  <span role="status">
                    {automaticTranslation.status === 'translating' && (
                      <LoaderCircle size={12} className="spin" />
                    )}
                    {automaticTranslation.status === 'translating'
                      ? '正在准备译文'
                      : automaticTranslation.status === 'retrying'
                        ? '连接恢复中…'
                        : automaticTranslation.status === 'offline'
                          ? '离线 · 已有译文仍可阅读'
                          : '随阅读自动准备'}
                  </span>
                )}
              </div>
            )}
            {view !== 'original' && automaticTranslation.status === 'error' && (
              <div className="translation-problem" role="status">
                <span>{automaticTranslation.error}</span>
                <button onClick={() => setSettingsOpen(true)}>AI 设置</button>
              </div>
            )}
            {chapter.paragraphs.map((p) => {
              const translated = getTranslation(p);
              const pending =
                automaticTranslation.streaming?.id === p.id
                  ? automaticTranslation.streaming.text
                  : '';
              return (
                <section
                  key={p.id}
                  id={`passage-${p.id}`}
                  data-paragraph={p.id}
                  className={`passage kind-${p.kind} ${selected?.paragraph.id === p.id ? 'selected-passage' : ''} ${notes.some((n) => n.paragraphId === p.id) ? 'annotated' : ''}`}
                >
                  <div className="paragraph-tools">
                    <span>{p.id}</span>
                    <button
                      className="icon-button"
                      title="解释这一段"
                      aria-label={`解释段落 ${p.id}`}
                      onClick={() => {
                        const selection = { paragraph: p, text: p.text };
                        setSelected(selection);
                        void ask('请结合上下文解释这段文字。', selection);
                      }}
                      disabled={Boolean(busy)}
                    >
                      <Sparkles size={14} />
                    </button>
                    <button
                      className="icon-button"
                      title="摘录这一段"
                      aria-label={`摘录段落 ${p.id}`}
                      onClick={() => {
                        setSelected({ paragraph: p, text: p.text });
                        setNoteDraft('');
                        setPanel('notes');
                        setCompanionOpen(true);
                      }}
                    >
                      <Bookmark size={14} />
                    </button>
                  </div>
                  <div
                    className="original-text"
                    lang={book.language === 'auto' ? undefined : book.language}
                    dir="auto"
                  >
                    {p.text}
                  </div>
                  {view !== 'original' && (
                    <div
                      className={`translated-text ${pending ? 'streaming' : ''} ${!translated && !pending ? 'translation-waiting' : ''}`}
                      style={
                        !translated && automaticTranslation.streaming?.id === p.id
                          ? { minHeight: automaticTranslation.streaming.minHeight }
                          : undefined
                      }
                      lang={settings.language}
                      dir="auto"
                    >
                      {translated || pending || (
                        <div className="translation-placeholder">
                          <span className="translation-hint">
                            {!aiReady
                              ? '连接模型后，译文会自动出现'
                              : automaticTranslation.status === 'error'
                                ? '译文暂不可用，可以继续阅读原文'
                                : automaticTranslation.status === 'offline'
                                  ? '联网后自动继续'
                                  : '译文正在自动准备'}
                          </span>
                          {view === 'translation' ? (
                            <div className="translation-fallback" lang={book.language} dir="auto">
                              {p.text}
                            </div>
                          ) : (
                            <span className="translation-skeleton" aria-hidden="true">
                              <i />
                              <i />
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            <div className="chapter-end">
              <span className="end-asterisk">✳</span>
              <p>留一点时间，让文字沉淀。</p>
              <div>
                <button
                  className="secondary"
                  onClick={() => toChapter(position.chapter - 1)}
                  disabled={position.chapter === 0}
                >
                  <ArrowLeft size={16} />
                  上一章
                </button>
                <button
                  className="primary"
                  onClick={() =>
                    position.chapter < book.chapters.length - 1
                      ? toChapter(position.chapter + 1)
                      : setLibraryOpen(true)
                  }
                >
                  {position.chapter < book.chapters.length - 1 ? '继续下一章' : '回到书架'}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </article>
        </main>
        <footer className="reading-footer">
          <span>
            <span className="status-dot" />
            阅读位置自动保存
          </span>
          <div className="reading-progress">
            <span>{progress}%</span>
            <div>
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
          <span>
            {position.chapter + 1} / {book.chapters.length} 章
          </span>
        </footer>
      </section>

      {companionOpen && (
        <aside className="companion">
          <header className="companion-header">
            <span className="sparkle-mark">
              <Sparkles size={17} />
            </span>
            <strong>阅读伙伴</strong>
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="AI 设置"
              title="AI 设置"
            >
              <Settings2 size={17} />
            </button>
            <button
              className="icon-button close-companion"
              onClick={() => setCompanionOpen(false)}
              aria-label="关闭伴读"
            >
              <PanelRightClose size={17} />
            </button>
          </header>
          <div className="panel-tabs">
            <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}>
              <MessageCircle size={14} />
              AI 伴读
            </button>
            <button className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel('notes')}>
              <FileText size={14} />
              笔记{notes.length > 0 && <span>{notes.length}</span>}
            </button>
          </div>
          {panel === 'chat' ? (
            <>
              <div className="context-control">
                <BookOpen size={13} />
                <select
                  aria-label="AI 参考范围"
                  disabled={Boolean(busy)}
                  value={settings.scope}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, scope: e.target.value as typeof settings.scope }))
                  }
                >
                  {Object.entries(scopeNames).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="context-indicator" />
              </div>
              <div className="chat-scroll">
                {!messages.length && (
                  <div className="companion-welcome">
                    <div className="welcome-art">
                      <span className="orbit orbit-one" />
                      <span className="orbit orbit-two" />
                      <BookOpen size={32} strokeWidth={1.1} />
                      <Sparkles className="art-spark" size={15} />
                    </div>
                    <span className="welcome-kicker">A LITTLE CURIOSITY GOES A LONG WAY</span>
                    <h2>
                      读懂字里，
                      <br />
                      也读懂行间。
                    </h2>
                    <p>
                      已跟随你当前读到的位置。
                      <br />
                      直接问“这里是什么意思”，一起读深一点。
                    </p>
                    <div className="prompt-cards">
                      <button
                        onClick={() => void ask('请梳理本章的核心观点和论证结构，引用原文。')}
                      >
                        <span className="prompt-icon">
                          <List size={16} />
                        </span>
                        <span>
                          这一章在讲什么？<small>梳理观点与脉络</small>
                        </span>
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() =>
                          void ask(
                            selected
                              ? '这段文字有什么隐喻或文化背景？请区分原文与背景知识。'
                              : '请选出本章一个值得深入理解的概念，结合原文解释。',
                          )
                        }
                      >
                        <span className="prompt-icon gold">
                          <Sparkles size={16} />
                        </span>
                        <span>
                          把一个概念讲透<small>语境、含义与例子</small>
                        </span>
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() =>
                          void ask(
                            '请提出三个帮助我思考本章的问题，并指出对应原文；暂时不要给答案。',
                          )
                        }
                      >
                        <span className="prompt-icon blue">
                          <CircleHelp size={16} />
                        </span>
                        <span>
                          带着问题继续读<small>让理解更进一步</small>
                        </span>
                        <ArrowUp size={14} />
                      </button>
                    </div>
                    <div className="grounding-note">
                      <CheckCheck size={15} />
                      <span>有依据的解释，可以回到原文。</span>
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`chat-message ${m.role} ${m.partial ? 'partial-message' : ''}`}
                  >
                    <div className="message-label">
                      {m.role === 'assistant' ? (
                        <>
                          <Sparkles size={13} />
                          AI READ
                        </>
                      ) : (
                        '你'
                      )}
                      {m.partial && <span>未完成</span>}
                    </div>
                    {m.content ? (
                      <Answer
                        content={m.content}
                        sources={m.sources}
                        navigate={(id) => {
                          navigate(id);
                          if (window.innerWidth < 900) setCompanionOpen(false);
                        }}
                      />
                    ) : (
                      <div className="typing">
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                  </div>
                ))}
                {busy === 'chat' && (
                  <div className="chat-status">
                    <LoaderCircle size={12} className="spin" />
                    {busyText}
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
              <div className="chat-bottom">
                {!selected && (
                  <div className="reading-context" title={readingParagraph.text}>
                    <BookOpen size={12} /> 跟随阅读 · 段落 {readingParagraph.id}
                  </div>
                )}
                {selected && (
                  <div className="selected-context">
                    <span>
                      <FileText size={12} />
                      段落 {selected.paragraph.id}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="移除选中文段"
                      onClick={() => setSelected(null)}
                    >
                      <X size={12} />
                    </button>
                    <p>{selected.text}</p>
                  </div>
                )}
                <form
                  className="question-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask(question);
                  }}
                >
                  <textarea
                    aria-label="向 AI 提问"
                    placeholder="这里是什么意思？也可以问整章…"
                    value={question}
                    maxLength={4000}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void ask(question);
                      }
                    }}
                  />
                  <div>
                    <button
                      type="button"
                      className="model-chip"
                      onClick={() => setSettingsOpen(true)}
                    >
                      <span className={aiReady ? 'connected-dot' : 'setup-dot'} />
                      {aiReady ? settings.model : '连接 AI 模型'}
                      <ChevronDown size={11} />
                    </button>
                    {busy ? (
                      <button
                        type="button"
                        className="send-button stop"
                        onClick={() => operation.current?.abort()}
                        title="停止生成"
                        aria-label="停止生成"
                      >
                        <Square size={14} />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        disabled={!question.trim()}
                        aria-label="发送问题"
                      >
                        <ArrowUp size={18} />
                      </button>
                    )}
                  </div>
                </form>
                <div className="chat-footnote">
                  <span>AI 可能出错，请核对原文</span>
                  {messages.length > 0 && (
                    <button disabled={Boolean(busy)} onClick={() => setMessages([])}>
                      清空对话
                    </button>
                  )}
                  <button onClick={() => setGlossaryOpen(true)}>术语表</button>
                </div>
              </div>
            </>
          ) : (
            <div className="notes-panel">
              {selected && (
                <div className="note-composer">
                  <span className="eyebrow">保存一个想法</span>
                  <blockquote>{selected.text}</blockquote>
                  <textarea
                    aria-label="笔记内容"
                    value={noteDraft}
                    maxLength={4000}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="写下你的理解（也可以只保存摘录）"
                  />
                  <button className="primary full" onClick={saveNote}>
                    <Bookmark size={14} />
                    保存摘录与笔记
                  </button>
                </div>
              )}
              <div className="notes-heading">
                <span>{notes.length} 条笔记</span>
                <button disabled={!notes.length} onClick={exportNotes}>
                  <ArrowDownToLine size={14} />
                  导出 Markdown
                </button>
              </div>
              {!notes.length && (
                <div className="empty-notes">
                  <BookMarked size={32} strokeWidth={1} />
                  <h3>让想法留下来</h3>
                  <p>
                    选中文字，记录此刻的理解。
                    <br />
                    笔记和摘录只保存在本地。
                  </p>
                </div>
              )}
              {notes.map((n) => (
                <div className="note-card" key={n.id}>
                  <button className="note-source" onClick={() => navigate(n.paragraphId)}>
                    段落 {n.paragraphId}
                    <ArrowUp size={12} />
                  </button>
                  <blockquote>{n.quote}</blockquote>
                  {n.text && <p>{n.text}</p>}
                  <div>
                    <time>{new Date(n.createdAt).toLocaleDateString('zh-CN')}</time>
                    <button
                      className="icon-button"
                      onClick={() => setNotes((items) => items.filter((x) => x.id !== n.id))}
                      aria-label="删除这条笔记"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}
      {libraryOpen && (
        <LibraryModal
          books={books}
          active={book.id}
          importing={importing}
          open={(b) => void activate(b)}
          remove={setDeleteTarget}
          upload={() => inputRef.current?.click()}
          close={() => setLibraryOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          hasServerKey={hasServerKey}
          onSave={(s) => {
            settingsEdited.current = true;
            setSettings(s);
            setNotice('设置已保存，API Key 仅在当前页面有效');
          }}
          close={() => setSettingsOpen(false)}
        />
      )}
      {glossaryOpen && (
        <Modal title="这本书的术语表" close={() => setGlossaryOpen(false)}>
          <p className="modal-lead">为人物、概念指定一致的译名。AI 翻译和解释时会参考这份表。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get('glossary')).trim();
              setGlossary(value);
              void storage.saveGlossary(book.id, value).catch(report);
              setGlossaryOpen(false);
              setNotice('术语表已保存；修改后新翻译会使用新的缓存。');
            }}
          >
            <textarea
              className="glossary-input"
              name="glossary"
              maxLength={3000}
              defaultValue={glossary}
              placeholder={'attention = 注意力\ncontext = 语境\n…'}
            />
            <button className="primary full">保存术语表</button>
          </form>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title="移除这本书？" close={() => setDeleteTarget(null)}>
          <p className="modal-lead">
            将从当前浏览器删除《{deleteTarget.title}》及其笔记、译文和对话。原始文件不受影响。
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button className="danger-button" onClick={() => void removeBook()}>
              移除书籍
            </button>
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal title="跨越语言，读懂每一页。" close={() => setHelpOpen(false)}>
          <div className="about-copy">
            <p>
              AI Read 是一个开源的多语言阅读器。书籍、阅读位置、译文和笔记保存在浏览器 IndexedDB
              中；清除网站数据会移除它们。
            </p>
            <p>
              从左下角导入 EPUB 或
              TXT。双语和译文模式会自动翻译眼前内容，并提前准备后面几段；切回原文即暂停。阅读模式和已完成译文会自动保存。AI
              会跟随阅读位置，直接提问即可；选中文字可指定更精确的范围。
            </p>
            <p>
              “截至最远章节”包括你曾打开的章节，不代表逐段读过。长书采用关键词检索，回答可能只参考部分原文。引用可点击核对。
            </p>
            <p>
              当前版本专注文字阅读：暂不保留原书图片、复杂排版、数学公式和交互内容，不支持 PDF、DRM
              或云同步。请保留原始文件。
            </p>
            <a
              className="text-link"
              href="https://github.com/velobase/ai-read"
              target="_blank"
              rel="noreferrer"
            >
              GitHub · velobase/ai-read <ArrowUp size={14} />
            </a>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button className="icon-button" onClick={() => setNotice('')} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
      {(!ready || switching) && (
        <div className="loading-overlay" role="status">
          <LoaderCircle size={20} className="spin" />
          正在打开书籍…
        </div>
      )}
    </div>
  );
}
