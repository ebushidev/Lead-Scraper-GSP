import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

type CredentialsFile = {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
};

function getRedirectUriFromEnvOrDefault(redirectUris?: string[]) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  if (redirectUris && redirectUris.length > 0) return redirectUris[0];
  // Default for local dev (make sure this redirect URI is allowed in Google Cloud).
  return "http://localhost:3000/api/auth/callback";
}

function parseClientSecretsFromJson(raw: string, sourceLabel = "credentials JSON"): {
  clientId: string;
  clientSecret: string;
  redirectUris?: string[];
} {
  const parsed = JSON.parse(raw) as CredentialsFile;

  const block = parsed.installed ?? parsed.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error(
      `Invalid ${sourceLabel}. Expected 'installed' or 'web' OAuth client.`,
    );
  }

  return {
    clientId: block.client_id,
    clientSecret: block.client_secret,
    redirectUris: block.redirect_uris,
  };
}

export function createOAuthClient(selectedFilename?: string) {
  if (!process.env.GOOGLE_OAUTH_CREDENTIALS_JSON) {
    throw new Error("Missing GOOGLE_OAUTH_CREDENTIALS_JSON.");
  }
  const { clientId, clientSecret, redirectUris } = parseClientSecretsFromJson(
    process.env.GOOGLE_OAUTH_CREDENTIALS_JSON,
    "GOOGLE_OAUTH_CREDENTIALS_JSON",
  );
  const redirectUri = getRedirectUriFromEnvOrDefault(redirectUris);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createOAuthClientFromJson(raw: string) {
  const { clientId, clientSecret, redirectUris } = parseClientSecretsFromJson(raw);
  const redirectUri = getRedirectUriFromEnvOrDefault(redirectUris);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrlFromJson(raw: string, state?: string) {
  const oauth2 = createOAuthClientFromJson(raw);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    ...(state ? { state } : {}),
  });
}

export async function exchangeCodeForTokenWithJson(code: string, raw: string) {
  const oauth2 = createOAuthClientFromJson(raw);
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

export function getAuthorizedGoogleAuthFromToken(token: Record<string, unknown>) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials(token);
  return oauth2;
}
