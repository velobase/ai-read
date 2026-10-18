'use client';

import type { ComponentProps } from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export function Slider({
  className,
  value,
  defaultValue,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex h-9 w-full touch-none select-none items-center data-[disabled]:opacity-40',
        className,
      )}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {(value ?? defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={props['aria-label']}
          className="block size-5 rounded-full border border-border bg-card shadow-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
        />
      ))}
    </SliderPrimitive.Root>
  );
}
