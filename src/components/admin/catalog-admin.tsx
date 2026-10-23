'use client';
import { useEffect, useState } from 'react';
import type { Book } from '@/lib/types';

type Metadata = {
  slug: string;
  title: string;
  author: string;
  description: string;
  language: string;
  category: string;
  sourceUrl: string;
};
type Edition = {
  id: string;
  state: string;
  chapterCount: number;
  paragraphCount: number;
  characterCount: number;
  warnings: string[];
  createdAt: string;
  job: { state: string; error: string | null } | null;
};
type Entry = Metadata & {
  id: string;
  editions: Edition[];
  publication: { editionId: string } | null;
};
type Collection = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
  items: { bookId: string }[];
};
const blank: Metadata = {
  slug: '',
  title: '',
  author: '',
  description: '',
  language: 'en',
  category: 'Classics',
  sourceUrl: '',
};
const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm';
const buttonClass =
  'rounded-lg bg-[#286748] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40';
const secondaryClass =
  'rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm disabled:opacity-40';
async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function CatalogAdmin() {
  const [books, setBooks] = useState<Entry[]>([]),
    [collections, setCollections] = useState<Collection[]>([]);
  const [selected, setSelected] = useState(''),
    [metadata, setMetadata] = useState<Metadata>(blank);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<Book | null>(null),
    [chapter, setChapter] = useState(0);
  const [view, setView] = useState<'books' | 'collections'>('books');
  const [collection, setCollection] = useState({
    id: '',
    title: '',
    description: '',
    sortOrder: 0,
    bookIds: [] as string[],
  });
  const [progress, setProgress] = useState<number | null>(null);
  const current = books.find((b) => b.id === selected);
  async function refresh() {
    const data = await api('/api/admin/catalog');
    setBooks(data.books);
    setCollections(data.collections);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  const pending = books.some((b) =>
    b.editions.some((e) => ['queued', 'running'].includes(e.job?.state || '')),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void refresh().catch((error) => console.error('catalog.admin.refresh', error));
    }, 5000);
    return () => clearInterval(timer);
  }, [pending]);
  function choose(book?: Entry) {
    setSelected(book?.id || '');
    setMetadata(book ? { ...book } : { ...blank });
    setPreview(null);
    setError('');
    setNotice('');
  }
  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save');
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string, editionId?: string) {
    await perform(async () => {
      await api(`/api/admin/catalog/${selected}`, json({ action, editionId }, 'PATCH'));
      setNotice(
        action === 'publish'
          ? 'Published. Readers can now download this edition.'
          : action === 'unpublish'
            ? 'Removed from the bookstore. Existing reader copies are preserved.'
            : 'Import queued.',
      );
    });
  }
  async function upload(file?: File) {
    if (!file || !selected) return;
    await perform(async () => {
      if (file.size > 30 * 1024 * 1024) throw new Error('Please choose a file smaller than 30 MB');
      setProgress(0);
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/admin/catalog/${selected}/upload`);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              try {
                reject(new Error(JSON.parse(xhr.responseText).error));
              } catch {
                reject(new Error('Upload failed'));
              }
            }
          };
          xhr.onerror = () => reject(new Error('Upload interrupted. Please retry.'));
          xhr.timeout = 180000;
          xhr.ontimeout = () => reject(new Error('Upload timed out'));
          xhr.send(file);
        });
        setNotice('Uploaded. Parsing continues on the server; you can leave this page.');
      } finally {
        setProgress(null);
      }
    });
  }
  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          className={view === 'books' ? buttonClass : secondaryClass}
          onClick={() => setView('books')}
        >
          Books · {books.length}
        </button>
        <button
          className={view === 'collections' ? buttonClass : secondaryClass}
          onClick={() => setView('collections')}
        >
          Collections · {collections.length}
        </button>
        <span className="ml-auto text-sm text-gray-500">Upload → Parse → Preview → Publish</span>
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 p-4 text-green-800">
          {notice}
        </p>
      )}
      {view === 'books' ? (
        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          <aside className="space-y-2">
            <button
              className={`${buttonClass} w-full mb-3`}
              disabled={busy}
              onClick={() => choose()}
            >
              + Add book
            </button>
            {books.map((b) => (
              <button
                key={b.id}
                disabled={busy}
                className={`w-full rounded-xl border p-4 text-left ${selected === b.id ? 'border-[#286748] bg-green-50' : 'border-gray-200 bg-white'}`}
                onClick={() => choose(b)}
              >
                <strong className="block text-sm">{b.title}</strong>
                <span className="mt-2 block text-xs text-gray-500">
                  {b.author} · {b.publication ? 'Published' : 'Draft'}
                </span>
              </button>
            ))}
          </aside>
          <div className="space-y-6">
            <form
              className="rounded-2xl border border-gray-200 bg-white p-6"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  if (selected)
                    await api(
                      `/api/admin/catalog/${selected}`,
                      json({ action: 'metadata', ...metadata }, 'PATCH'),
                    );
                  else {
                    const saved = await api('/api/admin/catalog', json(metadata));
                    setSelected(saved.id);
                  }
                  setNotice('Book details saved.');
                });
              }}
            >
              <h1 className="mb-5 text-xl font-semibold">
                {current ? 'Book details' : 'Add a book'}
              </h1>
              <div className="grid gap-4 sm:grid-cols-2">
                {(['title', 'author', 'slug', 'language', 'category', 'sourceUrl'] as const).map(
                  (field) => (
                    <label key={field} className="text-sm capitalize">
                      {field === 'sourceUrl' ? 'Source link (optional)' : field}
                      <input
                        className={`${inputClass} mt-1.5`}
                        value={metadata[field]}
                        maxLength={field === 'sourceUrl' ? 1000 : 500}
                        required={field !== 'sourceUrl'}
                        disabled={busy}
                        onChange={(e) => setMetadata({ ...metadata, [field]: e.target.value })}
                        placeholder={
                          field === 'slug'
                            ? 'pride-and-prejudice'
                            : field === 'language'
                              ? 'en / zh-CN'
                              : ''
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <label className="mt-4 block text-sm">
                Description
                <textarea
                  className={`${inputClass} mt-1.5`}
                  rows={4}
                  maxLength={10000}
                  value={metadata.description}
                  disabled={busy}
                  onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                />
              </label>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className={buttonClass} disabled={busy}>
                  Save details
                </button>
                {current?.publication && (
                  <button
                    type="button"
                    className={secondaryClass}
                    disabled={busy}
                    onClick={() => void action('unpublish')}
                  >
                    Unpublish
                  </button>
                )}
              </div>
            </form>
            {selected && (
              <section className="rounded-2xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold">Reading editions</h2>
                <p className="my-3 text-sm leading-6 text-gray-500">
                  EPUB, PDF or UTF-8 TXT · up to 30 MB. Scanned PDFs need a text layer. Uploading
                  creates a new edition; published content stays available until you publish its
                  replacement.
                </p>
                <input
                  aria-label="Upload book"
                  type="file"
                  accept=".epub,.pdf,.txt"
                  disabled={busy}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  className="my-3 block w-full text-sm"
                />
                {progress !== null && (
                  <progress className="w-full" value={progress} max={100}>
                    {progress}%
                  </progress>
                )}
                <div className="mt-5 space-y-4">
                  {current?.editions.map((edition) => (
                    <div className="rounded-xl border p-4" key={edition.id}>
                      <div className="flex justify-between gap-2 text-sm">
                        <strong>{edition.job?.state || edition.state}</strong>
                        <span>{new Date(edition.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="my-2 text-xs text-gray-500">
                        {edition.chapterCount} chapters · {edition.paragraphCount.toLocaleString()}{' '}
                        paragraphs · {edition.characterCount.toLocaleString()} characters
                      </p>
                      {edition.job?.error && (
                        <p className="my-3 text-sm text-red-700">{edition.job.error}</p>
                      )}
                      {edition.warnings?.map((w, i) => (
                        <p key={i} className="my-2 text-xs text-amber-800">
                          {w}
                        </p>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        {edition.state === 'ready' && (
                          <>
                            <button
                              className={secondaryClass}
                              disabled={busy}
                              onClick={() =>
                                void perform(async () => {
                                  const book = await api(
                                    `/api/admin/catalog/${selected}/preview?edition=${edition.id}`,
                                  );
                                  setPreview(book);
                                  setChapter(0);
                                })
                              }
                            >
                              Preview
                            </button>
                            <button
                              className={buttonClass}
                              disabled={
                                busy ||
                                preview?.id !== edition.id ||
                                current.publication?.editionId === edition.id
                              }
                              onClick={() => void action('publish', edition.id)}
                            >
                              {current.publication?.editionId === edition.id
                                ? 'Published'
                                : preview?.id === edition.id
                                  ? 'Publish this edition'
                                  : 'Preview before publishing'}
                            </button>
                          </>
                        )}
                        {edition.state === 'failed' && (
                          <button
                            disabled={busy}
                            className={secondaryClass}
                            onClick={() => void action('retry', edition.id)}
                          >
                            Retry parsing
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {preview && (
              <section className="rounded-2xl border border-gray-200 bg-[#fffdf7] p-6">
                <h2 className="text-lg font-semibold">Reader preview · {preview.title}</h2>
                <select
                  aria-label="Preview chapter"
                  className={`${inputClass} my-5`}
                  value={chapter}
                  onChange={(e) => setChapter(Number(e.target.value))}
                >
                  {preview.chapters.map((c, i) => (
                    <option key={c.id} value={i}>
                      {i + 1}. {c.title}
                    </option>
                  ))}
                </select>
                <article className="max-h-[600px] overflow-y-auto space-y-5 font-serif leading-8">
                  {preview.chapters[chapter]?.paragraphs.map((p) => (
                    <p key={p.id} className={p.kind === 'heading' ? 'text-xl font-semibold' : ''}>
                      {p.text}
                    </p>
                  ))}
                </article>
              </section>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          <aside className="space-y-2">
            <button
              disabled={busy}
              className={`${buttonClass} mb-3 w-full`}
              onClick={() =>
                setCollection({ id: '', title: '', description: '', sortOrder: 0, bookIds: [] })
              }
            >
              + New collection
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                className={`${secondaryClass} w-full text-left`}
                onClick={() => setCollection({ ...c, bookIds: c.items.map((i) => i.bookId) })}
              >
                {c.title}
              </button>
            ))}
          </aside>
          <form
            className="space-y-5 rounded-2xl border bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const saved = await api(
                  '/api/admin/collections',
                  json({ ...collection, id: collection.id || undefined }),
                );
                setCollection({ ...collection, id: saved.id });
                setNotice('Collection saved. Only published books appear to readers.');
              });
            }}
          >
            <h1 className="text-xl font-semibold">Collection</h1>
            <label className="block">
              Title
              <input
                required
                disabled={busy}
                className={inputClass}
                value={collection.title}
                onChange={(e) => setCollection({ ...collection, title: e.target.value })}
              />
            </label>
            <label className="block">
              Description
              <textarea
                disabled={busy}
                className={inputClass}
                value={collection.description}
                onChange={(e) => setCollection({ ...collection, description: e.target.value })}
              />
            </label>
            <label className="block">
              Display order
              <input
                type="number"
                min="0"
                max="1000"
                disabled={busy}
                className={inputClass}
                value={collection.sortOrder}
                onChange={(e) =>
                  setCollection({ ...collection, sortOrder: Number(e.target.value) })
                }
              />
            </label>
            <fieldset className="space-y-3">
              <legend className="mb-3 font-medium">Books (selected order)</legend>
              {books.map((book) => (
                <label key={book.id} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={collection.bookIds.includes(book.id)}
                    onChange={(e) =>
                      setCollection({
                        ...collection,
                        bookIds: e.target.checked
                          ? [...collection.bookIds, book.id]
                          : collection.bookIds.filter((id) => id !== book.id),
                      })
                    }
                  />
                  {book.title}
                  {collection.bookIds.includes(book.id) && (
                    <span className="text-gray-500">
                      #{collection.bookIds.indexOf(book.id) + 1}
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
            <button disabled={busy} className={buttonClass}>
              Save collection
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
