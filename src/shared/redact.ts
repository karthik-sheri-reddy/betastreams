/**
 * Xtream Codes URLs embed the username and password as path segments:
 * http://host:port/live/{username}/{password}/{stream_id}.ts
 * player_api.php?username=...&password=...
 *
 * This must scrub both forms before anything reaches a log line, an
 * error message, the admin UI, or the database (§14).
 */

const CREDENTIAL_QUERY_KEYS = ['username', 'password', 'user', 'pass'];

// Redacts Xtream-style path segments, e.g. /live/USER/PASS/123.ts -> /live/[redacted]/[redacted]/123.ts
function redactPathCredentials(input: string): string {
  return input.replace(
    /\/(live|movie|series|timeshift)\/[^/\s?#]+\/[^/\s?#]+\//gi,
    '/$1/**/**/',
  );
}

/** Redacts username/password query params regardless of case or order. */
function redactQueryCredentials(input: string): string {
  let out = input;
  for (const key of CREDENTIAL_QUERY_KEYS) {
    out = out.replace(new RegExp(`([?&]${key}=)[^&\\s]+`, 'gi'), '$1**');
  }
  return out;
}

/**
 * Redacts any credential-bearing substrings in a URL or free-text string
 * (e.g. an error message that embeds the failing URL). Safe to call on
 * strings that contain no credentials — they pass through unchanged.
 */
export function redactCredentials(input: string): string {
  return redactQueryCredentials(redactPathCredentials(input));
}

/** Redacts known credential fields out of an Xtream account config before logging it. */
export function redactAccountForLogging<T extends { username?: string; password?: string }>(
  account: T,
): Omit<T, 'username' | 'password'> & { username: string; password: string } {
  const { username, password, ...rest } = account;
  return { ...rest, username: username ? '**' : '', password: password ? '**' : '' } as Omit<
    T,
    'username' | 'password'
  > &
    { username: string; password: string };
}
