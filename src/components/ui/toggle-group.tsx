'use client';

import type { ComponentProps } from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex items-center', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'flex items-center justify-center gap-[5px] rounded-sm px-[13px] py-[6px] text-[11px] text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 data-[state=on]:bg-card data-[state=on]:font-medium data-[state=on]:text-primary data-[state=on]:shadow-[0_1px_3px_#2e402114] max-[720px]:px-[10px]',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
