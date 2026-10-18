'use client';

import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'inline-flex items-center gap-1 rounded-lg p-[3px] text-muted-foreground',
  {
    variants: { variant: { default: 'bg-muted', line: 'rounded-none bg-transparent' } },
    defaultVariants: { variant: 'default' },
  },
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex h-full items-center gap-[6px] px-0.5 text-[11px] text-[#93998b] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 data-[state=active]:font-medium data-[state=active]:text-primary data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
