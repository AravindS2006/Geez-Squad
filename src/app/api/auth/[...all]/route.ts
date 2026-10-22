import { loggedRoute } from '@/lib/request-log';
import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';
const handlers = toNextJsHandler(auth);
export const GET = loggedRoute('/api/auth/[...all]', handlers.GET);
export const POST = loggedRoute('/api/auth/[...all]', handlers.POST);
