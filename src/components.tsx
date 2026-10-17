import { useEffect, useRef, type ReactNode } from 'react';
import { X, BookOpen, Plus, Trash2, ArrowUpRight, Settings2, KeyRound, Globe2 } from 'lucide-react';
import type { Book, Settings } from './lib/types';
import { languages } from './lib/types';

export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function SettingsModal({
  settings,
  hasServerKey,
  onSave,
  close,
}: {
  settings: Settings;
  hasServerKey: boolean;
  onSave: (settings: Settings) => void;
  close: () => void;
}) {
  return (
    <Modal title="让 AI 成为你的阅读伙伴" close={close}>
      <p className="modal-lead">连接你自己的模型，用熟悉的语言探索书里的世界。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          onSave({
            ...settings,
            baseUrl: String(form.get('baseUrl')).trim(),
            model: String(form.get('model')).trim(),
            apiKey: String(form.get('apiKey')).trim(),
            language: String(form.get('language')),
          });
          close();
        }}
      >
        <label className="field">
          <span>
            <Globe2 size={15} /> 服务地址
          </span>
          <input
            name="baseUrl"
            type="url"
            required
            defaultValue={settings.baseUrl}
            placeholder="https://your-provider.com/v1"
          />
          <small>支持 OpenAI 兼容服务；本机 Ollama 可填 http://localhost:11434/v1。</small>
        </label>
        <label className="field">
          <span>
            <Settings2 size={15} /> 模型名称
          </span>
          <input
            name="model"
            required
            defaultValue={settings.model}
            placeholder="填写服务商提供的模型 ID"
          />
        </label>
        <label className="field">
          <span>
            <KeyRound size={15} /> API Key <em>可选</em>
          </span>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            defaultValue={settings.apiKey}
            placeholder={
              hasServerKey ? '服务端已配置；留空使用服务端密钥' : '只保留在当前页面，刷新后清除'
            }
          />
          <small>密钥不写入浏览器存储。切换服务地址后，服务端密钥不会转发给新地址。</small>
        </label>
        <label className="field">
          <span>翻译与回答语言</span>
          <select name="language" defaultValue={settings.language}>
            {languages.map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="privacy-note">
          书籍保存在此浏览器中。使用 AI
          时，相关原文、问题和术语表会发送到你配置的模型服务；不会上传整份 EPUB。
        </div>
        <button className="primary full" type="submit">
          保存设置 <ArrowUpRight size={17} />
        </button>
      </form>
    </Modal>
  );
}

export function LibraryModal({
  books,
  active,
  importing,
  open,
  remove,
  upload,
  close,
}: {
  books: Book[];
  active: string;
  importing: boolean;
  open: (book: Book) => void;
  remove: (book: Book) => void;
  upload: () => void;
  close: () => void;
}) {
  return (
    <Modal title="我的书架" wide close={close}>
      <div className="library-intro">
        <p>每一本书，都有一种新的看世界的方式。</p>
        <button className="primary" disabled={importing} onClick={upload}>
          <Plus size={17} />
          {importing ? '正在导入…' : '导入书籍'}
        </button>
      </div>
      <div className="book-grid">
        {books.map((book, i) => (
          <div className="library-book" key={book.id}>
            <button
              className={`book-cover cover-${i % 4}`}
              onClick={() => {
                open(book);
                close();
              }}
            >
              <span className="cover-kicker">AI READ LIBRARY</span>
              <strong>{book.title}</strong>
              <span className="cover-line" />
              <span>{book.author}</span>
              <BookOpen size={42} strokeWidth={1} />
            </button>
            <div className="library-meta">
              <div>
                <strong>{book.title}</strong>
                <small>
                  {book.chapters.length} 章 · {book.language.toUpperCase()}{' '}
                  {book.id === active ? '· 阅读中' : ''}
                </small>
              </div>
              {!book.sample && (
                <button
                  className="icon-button"
                  title="移除此书"
                  aria-label={`移除 ${book.title}`}
                  onClick={() => remove(book)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="footnote">
        支持无 DRM 的 EPUB、UTF-8 TXT · 最大 30 MB · 书架只保存在当前浏览器
      </p>
    </Modal>
  );
}

export function Answer({
  content,
  sources = [],
  navigate,
}: {
  content: string;
  sources?: string[];
  navigate: (id: string) => void;
}) {
  // Render only text, emphasis and verified citation buttons. Model HTML is never executed.
  const inline = (value: string) =>
    value.split(/(\[\d+\.\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      if (/^\[\d+\.\d+\]$/.test(part)) {
        const id = part.slice(1, -1);
        return sources.includes(id) ? (
          <button
            key={i}
            className="citation"
            onClick={() => navigate(id)}
            title={`查看原文 ${id}`}
          >
            {id}
          </button>
        ) : (
          <span className="unverified" key={i} title="引用未包含在本次提供的原文中">
            {part}?
          </span>
        );
      }
      return part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      );
    });
  return (
    <div className="answer-text">
      {content
        .split('\n')
        .map((line, i) =>
          line.startsWith('#') ? (
            <h4 key={i}>{inline(line.replace(/^#+\s*/, ''))}</h4>
          ) : line.trim() ? (
            <p key={i}>{inline(line)}</p>
          ) : (
            <div className="answer-space" key={i} />
          ),
        )}
    </div>
  );
}
