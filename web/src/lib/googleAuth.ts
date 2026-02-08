import fs from "node:fs";
import path from "node:path";

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

function getRepoRootPath() {
  // Next.js runs with CWD = web/ by default. Credentials are kept in repo root.
  return path.resolve(process.cwd(), "..");
}

function getCredentialsDirPath() {
  // Store credentials at repo root.
  return path.resolve(getRepoRootPath(), "credentials");
}

function getCredentialsPath(selectedFilename?: string) {
  if (selectedFilename) {
    return path.join(getCredentialsDirPath(), selectedFilename);
  }
  return process.env.GOOGLE_OAUTH_CREDENTIALS_PATH
    ? path.resolve(process.env.GOOGLE_OAUTH_CREDENTIALS_PATH)
    : path.join(getCredentialsDirPath(), "credentials.json");
}

function safeTokenSuffix(selectedFilename?: string) {
  if (!selectedFilename) return "";
  const base = path.parse(selectedFilename).name;
  const normalized = base.replace(/[^a-z0-9_-]+/gi, "_");
  return normalized ? `-${normalized}` : "";
}

function getTokenPath(selectedFilename?: string) {
  if (process.env.GOOGLE_OAUTH_TOKEN_PATH) {
    return path.resolve(process.env.GOOGLE_OAUTH_TOKEN_PATH);
  }
  const tokensDir = path.resolve(getRepoRootPath(), "tokens");
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }
  const suffix = safeTokenSuffix(selectedFilename);
  return path.join(tokensDir, `token${suffix}.json`);
}

function getRedirectUriFromEnvOrDefault() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  // Default for local dev (make sure this redirect URI is allowed in Google Cloud).
  return "http://localhost:3000/api/auth/callback";
}

function readClientSecrets(selectedFilename?: string): {
  clientId: string;
  clientSecret: string;
  redirectUris?: string[];
} {
  const credentialsPath = getCredentialsPath(selectedFilename);
  const raw = fs.readFileSync(credentialsPath, "utf8");
  const parsed = JSON.parse(raw) as CredentialsFile;

  const block = parsed.installed ?? parsed.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error(
      `Invalid credentials file at ${credentialsPath}. Expected 'installed' or 'web' OAuth client.`,
    );
  }

  return {
    clientId: block.client_id,
    clientSecret: block.client_secret,
    redirectUris: block.redirect_uris,
  };
}

export function createOAuthClient(selectedFilename?: string) {
  const { clientId, clientSecret, redirectUris } = readClientSecrets(selectedFilename);
  void redirectUris; // kept for debugging / future use
  const redirectUri = getRedirectUriFromEnvOrDefault();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(selectedFilename?: string) {
  const oauth2 = createOAuthClient(selectedFilename);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export function loadOAuthTokenIfExists(
  oauth2: InstanceType<typeof google.auth.OAuth2>,
  selectedFilename?: string,
) {
  const tokenPath = getTokenPath(selectedFilename);
  if (!fs.existsSync(tokenPath)) return false;
  const tokenJson = fs.readFileSync(tokenPath, "utf8");
  oauth2.setCredentials(JSON.parse(tokenJson));
  return true;
}

export async function exchangeCodeAndStoreToken(code: string, selectedFilename?: string) {
  const oauth2 = createOAuthClient(selectedFilename);
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const tokenPath = getTokenPath(selectedFilename);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf8");
  return tokens;
}

export function getAuthorizedGoogleAuthOrAuthUrl(selectedFilename?: string): {
  auth?: InstanceType<typeof google.auth.OAuth2>;
  authUrl?: string;
} {
  const oauth2 = createOAuthClient(selectedFilename);
  const ok = loadOAuthTokenIfExists(oauth2, selectedFilename);
  if (!ok) return { authUrl: getAuthUrl(selectedFilename) };
  return { auth: oauth2 };
}

export function getTokenPathForCredential(selectedFilename?: string) {
  return getTokenPath(selectedFilename);
}
