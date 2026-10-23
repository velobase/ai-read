'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { initializeClientObservability, recordClientEvent } from '@/lib/observability/client';
import { surfaceForPath } from '@/lib/observability/schema';

const reportVitals: Parameters<typeof useReportWebVitals>[0] = (metric) => {
  recordClientEvent('web_vital', {
    metric: metric.name as 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB',
    value: metric.value,
    rating: metric.rating,
  });
};

export function Observability() {
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);
  useReportWebVitals(reportVitals);
  useEffect(() => initializeClientObservability(), []);
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    recordClientEvent('page_view', { surface: surfaceForPath(pathname) });
  }, [pathname]);
  return null;
}
