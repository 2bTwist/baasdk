/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BAAS_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
