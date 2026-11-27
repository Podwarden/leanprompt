// Types for scripts/publish-site.mjs (plain JavaScript, so it runs with node alone), for its tests.
export declare const DEFAULT_PREFIX: string;
export declare const DEFAULT_REGION: string;
export declare const DEFAULT_PUBLIC_REPO: string;
export declare const CACHE_IMMUTABLE: string;
export declare const CACHE_MANIFEST: string;
export declare const CONTENT_TYPES: Record<string, string>;
export declare function sha256Hex(data: string | Uint8Array): string;
export declare function uriEncode(s: string, keepSlash: boolean): string;
export declare function signingKey(secret: string, date: string, region: string, service: string): Buffer;
export declare function signV4(req: {
  method: string;
  path: string;
  query?: [string, string][];
  headers: Record<string, string>;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  doubleEncode?: boolean;
}): { canonicalRequest: string; stringToSign: string; signature: string; authorization: string };
export declare function amzDateOf(d: Date): string;
export declare function listFiles(dir: string): string[];
export declare function contentTypeOf(path: string): string | undefined;
export interface Manifest {
  commit: string;
  version: string;
  published: string;
  files: Record<string, string>;
}
export declare function buildManifest(args: { paths: string[]; read: (path: string) => Uint8Array | string; commit: string; version: string; published: string }): Manifest;
export interface UploadItem {
  key: string;
  path?: string;
  contentType: string;
  cacheControl: string;
  manifest?: boolean;
}
export declare function uploadPlan(prefix: string, manifest: Manifest): UploadItem[];
export interface S3Config {
  endpoint: string;
  host: string;
  bucket: string;
  prefix: string;
  region: string;
  accessKey: string;
  secretKey: string;
}
export declare function s3Config(env: Record<string, string | undefined>): S3Config;
export declare function s3Request(
  cfg: S3Config,
  method: string,
  key: string,
  opts?: { body?: Uint8Array; headers?: Record<string, string>; fetchImpl?: typeof fetch },
): Promise<Response>;
export declare function parseArgs(argv: string[]): { dryRun: boolean; allowUnpublished: boolean; ref?: string; rollback?: string; help: boolean };
