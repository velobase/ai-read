import type { ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

type Event<T> = (event: NativeSyntheticEvent<T>) => void;
export type NativePageProps = ViewProps & {
  pagesJSON: string;
  pageIndex: number;
  totalPages: number;
  effect: 'curl' | 'slide' | 'none';
  hasPrevious: boolean;
  hasNext: boolean;
  onPageChange: Event<{ index: number }>;
  onCenterTap: Event<Record<string, never>>;
  onSelect: Event<{
    paragraph: string;
    source: 'original' | 'translation';
    start: number;
    end: number;
  }>;
  onBoundary: Event<{ direction: -1 | 1 }>;
  onImagePress: Event<{ placementId: string }>;
  onImageError: Event<{ placementId: string }>;
  onReferencePress?: Event<{ id: string; paragraph: string; start: number }>;
};

const nativeReader = requireOptionalNativeModule<{
  mediaVersion?: number;
  referencesVersion?: number;
}>('ByPageReader');
export const nativeReaderSupportsImages = (nativeReader?.mediaVersion || 0) >= 1;
export const nativeReaderSupportsReferences = (nativeReader?.referencesVersion || 0) >= 1;
// Old development builds and Android retain the JS pager until the native module is installed.
export const NativePageView: ComponentType<NativePageProps> | null =
  Platform.OS === 'ios' && nativeReader
    ? requireNativeViewManager<NativePageProps>('ByPageReader')
    : null;
