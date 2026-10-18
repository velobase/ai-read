'use client';
import { useEffect } from 'react';
import { useIdentity } from '@/components/auth/identity-provider';
import { startLocalTranslationRunner } from '@/lib/local-translation-runner';

export function TranslationRuntime() {
  const { enabled } = useIdentity();
  useEffect(() => {
    if (!enabled) return startLocalTranslationRunner();
  }, [enabled]);
  return null;
}
