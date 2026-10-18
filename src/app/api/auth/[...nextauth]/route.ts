import { handlers } from '@/lib/server/auth';
import { authConfigured } from '@/lib/server/auth-config';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const unavailable = () => Response.json({ error: '登录服务尚未配置。' }, { status: 503 });
export const GET = (request: NextRequest) =>
  authConfigured() ? handlers.GET(request) : unavailable();
export const POST = (request: NextRequest) =>
  authConfigured() ? handlers.POST(request) : unavailable();
