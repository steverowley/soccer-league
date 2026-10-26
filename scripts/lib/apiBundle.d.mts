// Types for scripts/lib/apiBundle.mjs (imported by the bundle tests).
export declare const API_BUNDLE_PATH: string;
export declare const API_ENTRY_PATH: string;
export declare const READ_CACHE_BUNDLE_PATH: string;
export declare const READ_CACHE_ENTRY_PATH: string;
export declare const API_BUNDLES: ReadonlyArray<{ out: string; entry: string; banner: string[] }>;
export declare function buildApiBundle(repoRoot: string, out?: string): Promise<string>;
