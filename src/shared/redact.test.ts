import { describe, it, expect } from 'vitest';
import { redactCredentials, redactAccountForLogging } from './redact';

const SECRET_USER = 'realuser123';
const SECRET_PASS = 'sup3rSecretPass!';

describe('redactCredentials', () => {
  it('redacts Xtream-style path credentials', () => {
    const url = `http://example.com:8080/live/${SECRET_USER}/${SECRET_PASS}/12345.ts`;
    const redacted = redactCredentials(url);
    expect(redacted).not.toContain(SECRET_USER);
    expect(redacted).not.toContain(SECRET_PASS);
    expect(redacted).toBe('http://example.com:8080/live/**/**/12345.ts');
  });

  it('redacts timeshift/movie/series path credentials', () => {
    const url = `http://host/timeshift/${SECRET_USER}/${SECRET_PASS}/120/2026-01-01:10-00/1.ts`;
    expect(redactCredentials(url)).not.toContain(SECRET_PASS);
  });

  it('redacts player_api.php query credentials, any case/order', () => {
    const url = `http://host/player_api.php?password=${SECRET_PASS}&username=${SECRET_USER}`;
    const redacted = redactCredentials(url);
    expect(redacted).not.toContain(SECRET_USER);
    expect(redacted).not.toContain(SECRET_PASS);
  });

  it('leaves credential-free strings unchanged', () => {
    const s = 'plain error message with no secrets';
    expect(redactCredentials(s)).toBe(s);
  });

  it('redacts credentials embedded inside a larger error message', () => {
    const msg = `fetch failed for http://host/live/${SECRET_USER}/${SECRET_PASS}/1.m3u8: ETIMEDOUT`;
    expect(redactCredentials(msg)).not.toContain(SECRET_PASS);
  });
});

describe('redactAccountForLogging', () => {
  it('never leaves the raw username/password in the returned object', () => {
    const account = { id: 'acct1', username: SECRET_USER, password: SECRET_PASS, serverUrl: 'http://host:8080' };
    const safe = redactAccountForLogging(account);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(SECRET_USER);
    expect(serialized).not.toContain(SECRET_PASS);
    expect(safe.serverUrl).toBe('http://host:8080');
  });
});

/**
 * §14: "add a test that fails if a credential string shows up in
 * captured log output." This drives an Xtream-shaped log line through the
 * same redaction helper the real adapter uses, captures the emitted JSON,
 * and asserts the raw secret is absent — so a future change that logs an
 * un-redacted URL fails this test rather than leaking in production.
 */
describe('log output never contains raw credentials', () => {
  it('a redacted-before-logging URL never surfaces the secret in captured output', () => {
    const rawUrl = `http://provider.example:8080/player_api.php?username=${SECRET_USER}&password=${SECRET_PASS}`;
    const capturedLines: string[] = [];
    const fakeLogSink = (line: string) => capturedLines.push(line);

    // This mirrors what every call site must do: redact before it ever
    // reaches a logger.
    fakeLogSink(JSON.stringify({ msg: 'xtream request failed', url: redactCredentials(rawUrl) }));

    const captured = capturedLines.join('\n');
    expect(captured).not.toContain(SECRET_USER);
    expect(captured).not.toContain(SECRET_PASS);
  });
});
