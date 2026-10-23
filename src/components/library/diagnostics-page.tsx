'use client';

import { useSyncExternalStore } from 'react';
import { LibraryShell, PageHeading } from './library-ui';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import {
  analyticsStatus,
  clearDiagnostics,
  diagnosticsEvents,
  diagnosticsRevision,
  diagnosticsVitals,
  setAnalyticsConsent,
  subscribeDiagnostics,
} from '@/lib/observability/client';
import type { ClientEventName } from '@/lib/observability/schema';

const serverRevision = () => 0;
const eventLabels: Record<ClientEventName, string> = {
  page_view: '页面导航',
  web_vital: '页面性能',
  library_load: '加载书架',
  book_import: '导入书籍',
  pdf_parse: '解析 PDF',
  book_open: '打开书籍',
  reader_ready: '准备阅读',
  reader_mode: '阅读模式',
  search: '搜索',
  note_save: '保存笔记',
  ai_request: 'AI 请求',
  sync: '账号同步',
  client_error: '页面异常',
};

export function DiagnosticsPage() {
  useSyncExternalStore(subscribeDiagnostics, diagnosticsRevision, serverRevision);
  const { text: t, number, date } = useI18n();
  const events = diagnosticsEvents();
  const vitals = diagnosticsVitals();
  const status = analyticsStatus();
  const errors = events.filter((event) => event.properties.outcome === 'error');
  const recent = events
    .filter((event) => event.name !== 'web_vital')
    .slice(-12)
    .reverse();
  const exportReport = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 2, exportedAt: new Date().toISOString(), vitals, events },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bypage-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page diagnostics-page">
        <PageHeading title={t('诊断与隐私')} back="/me" />
        <div className="diagnostics-local-note">
          <span>
            {t('记录仅保留在本次页面内存中，刷新后清除。不含书籍正文、书名、笔记、问题或密钥。')}
          </span>
        </div>

        <section aria-labelledby="performance-title" className="diagnostics-section">
          <div className="diagnostics-section-heading">
            <h2 id="performance-title">{t('页面性能')}</h2>
          </div>
          <div className="diagnostics-vitals">
            {(['LCP', 'INP', 'CLS'] as const).map((name) => {
              const metric = vitals[name]?.properties;
              const rating = metric?.rating;
              return (
                <div className="diagnostics-vital" key={name}>
                  <span className="diagnostics-vital-label">
                    {name}
                    <span>
                      {t(
                        name === 'LCP'
                          ? '主要内容加载'
                          : name === 'INP'
                            ? '交互响应'
                            : '布局稳定性',
                      )}
                    </span>
                  </span>
                  <strong>
                    {metric?.value === undefined
                      ? '—'
                      : number(name === 'LCP' ? metric.value / 1000 : metric.value, {
                          maximumFractionDigits: name === 'CLS' ? 3 : name === 'LCP' ? 2 : 0,
                        })}
                    <small>
                      {metric?.value === undefined || name === 'CLS'
                        ? ''
                        : name === 'LCP'
                          ? 's'
                          : 'ms'}
                    </small>
                  </strong>
                  <span className={`diagnostics-rating ${rating || 'pending'}`}>
                    {t(
                      !rating
                        ? '等待记录'
                        : rating === 'good'
                          ? '良好'
                          : rating === 'poor'
                            ? '需要关注'
                            : '有待改善',
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="diagnostics-hint">
            {t('部分指标在交互或切换页面后产生；空白不代表零耗时。')}
          </p>
        </section>

        <section
          className="settings-form-card diagnostics-consent"
          aria-labelledby="analytics-title"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
              <h2 id="analytics-title">{t('匿名使用统计')}</h2>
              <p>
                {t(
                  '默认关闭。开启后，将操作类型、耗时和错误类别发送到此部署配置的 PostHog，帮助改进体验。',
                )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.enabled && !status.blocked}
              aria-labelledby="analytics-title"
              className="diagnostics-switch"
              disabled={!status.configured || status.blocked}
              onClick={() => setAnalyticsConsent(!status.enabled)}
            >
              <span />
            </button>
          </div>
          <div className="diagnostics-consent-state">
            {t(
              status.blocked
                ? '已遵循浏览器的隐私偏好，统计保持关闭。'
                : !status.configured
                  ? '此部署尚未配置统计服务，数据不会发送。'
                  : status.enabled
                    ? '匿名统计已开启，可随时关闭。'
                    : '匿名统计已关闭，记录仅留在本页。',
            )}
          </div>
          <p className="diagnostics-hint">
            {t('不采集账号、完整网址或搜索词，不创建用户画像，不录屏。')}
          </p>
        </section>

        <section className="diagnostics-section" aria-labelledby="events-title">
          <div className="diagnostics-section-heading">
            <h2 id="events-title">{t('操作记录')}</h2>
            <span>{t('最近 {count} 条', { count: recent.length })}</span>
          </div>
          <div className="diagnostics-events">
            {recent.length ? (
              recent.map((event, index) => (
                <div className="diagnostics-event" key={`${event.at}-${index}`}>
                  <div>
                    <strong>{t(eventLabels[event.name])}</strong>
                    <span>
                      {event.properties.outcome === 'error'
                        ? t('需要关注')
                        : event.properties.outcome === 'cancelled'
                          ? t('已取消')
                          : t('已记录')}
                    </span>
                  </div>
                  <span className="diagnostics-event-duration">
                    {event.properties.durationMs === undefined
                      ? ''
                      : `${number(event.properties.durationMs, { maximumFractionDigits: 0 })} ms`}
                  </span>
                  <time dateTime={new Date(event.at).toISOString()}>
                    {date(event.at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </time>
                </div>
              ))
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{t('还没有操作记录。')}</p>
            )}
          </div>
          <p className="diagnostics-hint">
            {t('最多保留 160 条记录；当前有 {count} 条异常。', { count: errors.length })}
          </p>
          <div className="flex flex-wrap gap-3 pt-3">
            <Button variant="secondary" onClick={exportReport} disabled={!events.length}>
              {t('导出诊断')}
            </Button>
            <Button variant="ghost" onClick={clearDiagnostics} disabled={!events.length}>
              {t('清空记录')}
            </Button>
          </div>
        </section>
      </main>
    </LibraryShell>
  );
}
