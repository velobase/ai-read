'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { BookMediaAsset, BookMediaPlacement } from '../../../packages/reading-core/src/types';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type Illustration = { asset: BookMediaAsset; placement: BookMediaPlacement };

/** A separate reading block: image labels never change text-selection offsets. */
export function BookIllustration({
  image,
  open,
}: {
  image: Illustration;
  open: (image: Illustration) => void;
}) {
  const { t } = useI18n();
  const { asset, placement } = image;
  return (
    <figure className="reader-illustration" data-media={placement.id}>
      <button
        type="button"
        onClick={() => open(image)}
        aria-label={placement.alt || t('查看插图')}
        style={{ maxWidth: asset.width }}
      >
        {/* Validated local raster bytes; fixed dimensions reserve space before decoding. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.dataUri}
          width={asset.width}
          height={asset.height}
          alt={placement.alt || t('查看插图')}
          decoding="async"
          draggable={false}
        />
      </button>
    </figure>
  );
}

export function IllustrationDialog({ image, close }: { image: Illustration; close: () => void }) {
  const { t } = useI18n();
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const center = useRef<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const displayWidth = Math.max(1, width - 24) * zoom;
  const displayHeight = (displayWidth * image.asset.height) / image.asset.width;
  useEffect(() => {
    const node = area;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, [area]);
  useLayoutEffect(() => {
    const node = area;
    if (!node || !center.current) return;
    node.scrollLeft = center.current.x * displayWidth - node.clientWidth / 2 + 12;
    node.scrollTop = center.current.y * displayHeight - node.clientHeight / 2 + 12;
    center.current = null;
  }, [area, displayWidth, displayHeight]);
  function changeZoom(next: number) {
    if (next === zoom) return;
    const node = area;
    if (node)
      center.current = {
        x: (node.scrollLeft + node.clientWidth / 2 - 12) / displayWidth,
        y: (node.scrollTop + node.clientHeight / 2 - 12) / displayHeight,
      };
    setZoom(next);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[92dvh] w-[calc(100vw-20px)] max-w-none flex-col gap-3 overflow-hidden rounded-xl p-4 sm:max-w-[1100px]"
      >
        <DialogHeader>
          <DialogTitle className="pe-8">{t('查看插图')}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('缩小插图')}
            disabled={zoom <= 1}
            onClick={() => changeZoom(Math.max(1, zoom - 0.5))}
          >
            <Minus size={18} />
          </Button>
          <Button variant="ghost" onClick={() => changeZoom(1)}>
            {zoom === 1 ? t('适合宽度') : `${Math.round(zoom * 100)}%`}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('放大插图')}
            disabled={zoom >= 4}
            onClick={() => changeZoom(Math.min(4, zoom + 0.5))}
          >
            <Plus size={18} />
          </Button>
        </div>
        <div
          ref={setArea}
          className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3"
          style={{ overflowAnchor: 'none' }}
          tabIndex={0}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.asset.dataUri}
            alt={image.placement.alt || t('查看插图')}
            width={image.asset.width}
            height={image.asset.height}
            style={{ width: displayWidth, height: displayHeight, maxWidth: 'none' }}
            draggable={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
