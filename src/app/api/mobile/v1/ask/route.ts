import { accountBody } from '@/lib/server/account-request';
import { handleAI } from '@/lib/server/ai';
import { mobileAI, mobileAIContextKey } from '@/lib/server/mobile-ai';
import { mobileAuthFailure } from '@/lib/server/mobile-auth';
import { observedRoute } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = observedRoute('api.ai', async (request: Request) => {
  let config;
  try {
    ({ config } = await mobileAI(request));
  } catch (error) {
    return mobileAuthFailure(error);
  }
  if (!config) return Response.json({ error: 'native_ai_unavailable' }, { status: 403 });
  try {
    // Keep the same transport budget as handleAI: bounded Chinese evidence,
    // chapter labels and conversation history can exceed 192 KiB in UTF-8.
    const body = await accountBody(request, 512 * 1024);
    if (
      typeof body.question !== 'string' ||
      !body.question.trim() ||
      body.question.length > 3000 ||
      !Array.isArray(body.sources) ||
      !body.sources.length ||
      body.sources.length > 200
    )
      return Response.json({ error: 'invalid_reading_question' }, { status: 400 });
    const sources = body.sources;
    if (
      sources.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          typeof item.id !== 'string' ||
          !/^[\w.:-]{1,200}$/.test(item.id) ||
          typeof item.chapter !== 'string' ||
          item.chapter.length > 4000 ||
          typeof item.text !== 'string' ||
          item.text.length > 4000,
      )
    )
      return Response.json({ error: 'invalid_reading_sources' }, { status: 400 });
    if (
      sources.reduce((total, source) => total + source.text.length, 0) > 16000 ||
      new Set(sources.map((source) => source.id)).size !== sources.length
    )
      return Response.json({ error: 'invalid_reading_sources' }, { status: 400 });
    const scopes = {
      chapter: 'Current chapter',
      read: 'Read chapters only; do not disclose later material',
      book: 'Whole-book search; supplied excerpts only',
    };
    if (
      body.scope !== undefined &&
      (typeof body.scope !== 'string' || !Object.hasOwn(scopes, body.scope))
    )
      return Response.json({ error: 'invalid_reading_scope' }, { status: 400 });
    let coverage = '';
    if (body.context !== undefined) {
      if (
        !body.scope ||
        !body.context ||
        typeof body.context !== 'object' ||
        Array.isArray(body.context)
      )
        return Response.json({ error: 'invalid_reading_scope' }, { status: 400 });
      const context = body.context as Record<string, unknown>;
      if (
        !Number.isSafeInteger(context.totalParagraphs) ||
        (context.totalParagraphs as number) < sources.length ||
        (context.totalParagraphs as number) > 20 * 1024 * 1024 ||
        typeof context.partial !== 'boolean' ||
        ((context.totalParagraphs as number) > sources.length && !context.partial)
      )
        return Response.json({ error: 'invalid_reading_scope' }, { status: 400 });
      coverage = `; passages ${sources.length}/${context.totalParagraphs}; partial=${context.partial}`;
    }
    const history = body.history ?? [];
    if (
      !Array.isArray(history) ||
      history.length > 8 ||
      history.length % 2 !== 0 ||
      history.some(
        (message, index) =>
          !message ||
          typeof message !== 'object' ||
          message.role !== (index % 2 === 0 ? 'user' : 'assistant') ||
          typeof message.content !== 'string' ||
          !message.content.trim() ||
          message.content.length > 4000,
      )
    )
      return Response.json({ error: 'invalid_reading_history' }, { status: 400 });
    if (
      body.aiContextKey !== undefined &&
      (typeof body.aiContextKey !== 'string' || !/^[a-f0-9]{64}$/.test(body.aiContextKey))
    )
      return Response.json({ error: 'invalid_reading_configuration' }, { status: 400 });
    const aiContextKey = mobileAIContextKey(config);
    if (body.aiContextKey !== undefined && body.aiContextKey !== aiContextKey)
      return Response.json(
        { error: 'native_ai_configuration_changed', aiContextKey, aiModel: config.model },
        { status: 409 },
      );
    // The server does not hold the local book. Scope describes the client's
    // bounded evidence selection, not a server verification of the whole chapter.
    const scope = body.scope
      ? `${scopes[body.scope as keyof typeof scopes]}${coverage}. Use only supplied passages and exact IDs.`
      : 'Only the supplied passages. Cite their exact IDs. Do not imply access to the full book.';
    const input = {
      action: 'ask',
      question: body.question,
      title: body.title,
      language: body.language,
      bookLanguage: body.bookLanguage,
      selection: body.selection,
      readingPassage: body.readingPassage,
      sources,
      history,
      scope,
    };
    // The caller cannot choose a provider or forward this server's key elsewhere.
    const safeRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: request.signal,
    });
    return handleAI(safeRequest, { ...config, accountManaged: true });
  } catch {
    return Response.json({ error: 'invalid_reading_question' }, { status: 400 });
  }
});
