/**
 * Polarisor unified error envelope helpers for digist.
 * See: _Polarisor/error-envelope-spec.md
 */
import type http from 'node:http';

export interface EnvelopeError {
  ok: false;
  error: { code: string; message: string };
}

export interface EnvelopeSuccess<T = unknown> {
  ok: true;
  data: T;
}

export function digError(code: string, message: string): EnvelopeError {
  const prefixed = code.startsWith('DIG_') ? code : `DIG_${code.toUpperCase()}`;
  return { ok: false, error: { code: prefixed, message } };
}

export function envError(code: string, message: string): EnvelopeError {
  return { ok: false, error: { code, message } };
}

export function jsonError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(digError(code, message)));
}

export function jsonStdError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(envError(code, message)));
}
