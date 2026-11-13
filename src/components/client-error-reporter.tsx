'use client';
import { useEffect } from 'react';
import { reportClientError } from '@/lib/client-error-reporter';

/** Mounted once from the root layout: reports uncaught errors and rejections. Renders nothing. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) =>
      reportClientError('window', event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      reportClientError('rejection', event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
