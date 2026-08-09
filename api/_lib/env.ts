// Every server-side env var read in this project goes through this
// helper instead of `process.env.X` directly. Vercel env values can pick
// up a stray leading/trailing space or newline from copy-pasting (this is
// exactly what caused the "couldn't sign in" WebKit error on iPhone --
// see src/lib/firebase.ts for the client-side equivalent). Trimming here
// means that mistake can never again reach an HMAC digest, a JSON.parse,
// or a URL construction.
export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
