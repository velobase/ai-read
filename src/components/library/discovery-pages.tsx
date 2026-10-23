'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useLibrary } from './library-provider';
import { LibraryShell, PageHeading } from './library-ui';
import { Modal } from '@/components/reader/reader-dialogs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function CollectionsPage() {
  const { t } = useI18n();
  const { state, books, createGroup } = useLibrary();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  return (
    <LibraryShell>
      <main className="library-container">
        <PageHeading title={t('分组')} back="/library">
          {state.groups.length > 0 && (
            <button
              onClick={() => setAdding(true)}
              className="flex size-11 items-center justify-center text-primary"
              aria-label={t('新建分组')}
            >
              <Plus size={22} />
            </button>
          )}
        </PageHeading>
        <div className="divide-y divide-border">
          {state.groups.map((group) => {
            const count = books.filter((book) => state.books[book.id]?.group === group).length;
            return (
              <Link
                key={group}
                href={`/library?group=${encodeURIComponent(group)}`}
                className="flex min-h-16 items-center gap-4 py-4"
              >
                <h2 className="min-w-0 flex-1 truncate text-base">{group}</h2>
                <span className="text-sm text-muted-foreground">
                  {t('{count} 本书', { count })}
                </span>
                <ChevronRight size={17} className="text-muted-foreground" aria-hidden="true" />
              </Link>
            );
          })}
          {!state.groups.length && (
            <div className="py-12 text-center">
              <button onClick={() => setAdding(true)} className="library-primary">
                {t('新建分组')}
              </button>
            </div>
          )}
        </div>
        {adding && (
          <Modal title={t('新建分组')} close={() => setAdding(false)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                createGroup(name);
                setAdding(false);
                setName('');
              }}
            >
              <Input
                autoFocus
                className="my-6"
                aria-label={t('分组名称')}
                placeholder={t('例如：睡前阅读')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
              <Button className="w-full" type="submit" disabled={!name.trim()}>
                {t('创建分组')}
              </Button>
            </form>
          </Modal>
        )}
      </main>
    </LibraryShell>
  );
}
