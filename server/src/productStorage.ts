import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ProductImageMimeType } from './productImageValidation.js';

export type StoredProductImage = {
  bytes: Buffer;
  mimeType: ProductImageMimeType;
};

export interface ProductStorage {
  put(companyId: string, key: string, bytes: Buffer, mimeType: ProductImageMimeType): Promise<void>;
  get(companyId: string, key: string): Promise<StoredProductImage | null>;
  exists(companyId: string, key: string): Promise<boolean>;
  remove(companyId: string, key: string): Promise<void>;
  buildUrl(key: string, baseUrl?: string): string;
  close?(): void;
}

export class InMemoryProductStorage implements ProductStorage {
  private readonly objects = new Map<string, { companyId: string; bytes: Buffer; mimeType: ProductImageMimeType }>();

  constructor(
    private readonly baseUrl: string,
    private readonly shouldFailPut: () => boolean = () => false,
  ) {}

  async put(companyId: string, key: string, bytes: Buffer, mimeType: ProductImageMimeType) {
    if (this.shouldFailPut()) throw new Error('Fake product storage write failed');
    this.objects.set(key, { companyId, bytes: Buffer.from(bytes), mimeType });
  }

  async get(companyId: string, key: string): Promise<StoredProductImage | null> {
    const object = this.objects.get(key);
    if (!object || object.companyId !== companyId) return null;
    return { bytes: Buffer.from(object.bytes), mimeType: object.mimeType };
  }

  async exists(companyId: string, key: string) {
    return Boolean(await this.get(companyId, key));
  }

  async remove(companyId: string, key: string) {
    if (this.objects.get(key)?.companyId === companyId) this.objects.delete(key);
  }

  buildUrl(key: string, baseUrl = this.baseUrl) {
    const url = new URL('/api/products/storage', baseUrl);
    url.searchParams.set('key', key);
    return url.toString();
  }
}

export type R2ProductStorageConfig = {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  publicBaseUrl?: string;
};

type CompleteR2ProductStorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

const R2_CONFIG_ENV_NAMES = {
  accountId: 'R2_ACCOUNT_ID',
  accessKeyId: 'R2_ACCESS_KEY_ID',
  secretAccessKey: 'R2_SECRET_ACCESS_KEY',
  bucket: 'R2_BUCKET',
  publicBaseUrl: 'R2_PUBLIC_BASE_URL',
} as const;

export function validateR2ProductStorageConfig(config: R2ProductStorageConfig): CompleteR2ProductStorageConfig {
  const missing = Object.entries(R2_CONFIG_ENV_NAMES)
    .filter(([field]) => !config[field as keyof R2ProductStorageConfig]?.trim())
    .map(([, envName]) => envName);
  if (missing.length > 0) {
    throw new Error(`R2 Product Storage configuration is incomplete: ${missing.join(', ')}`);
  }

  const complete = config as CompleteR2ProductStorageConfig;
  if (!/^[a-f0-9]{32}$/i.test(complete.accountId)) {
    throw new Error('R2_ACCOUNT_ID must be a valid Cloudflare account identifier.');
  }
  if (complete.bucket.includes('/') || complete.bucket.includes('\\')) {
    throw new Error('R2_BUCKET must be a bucket name, not a path.');
  }

  let publicBase: URL;
  try {
    publicBase = new URL(complete.publicBaseUrl);
  } catch {
    throw new Error('R2_PUBLIC_BASE_URL must be an HTTPS custom-domain origin.');
  }
  if (
    publicBase.protocol !== 'https:'
    || publicBase.username
    || publicBase.password
    || publicBase.pathname !== '/'
    || publicBase.search
    || publicBase.hash
    || publicBase.hostname.toLowerCase() === 'r2.dev'
    || publicBase.hostname.toLowerCase().endsWith('.r2.dev')
  ) {
    throw new Error('R2_PUBLIC_BASE_URL must be an HTTPS custom-domain origin; r2.dev is not supported.');
  }

  return { ...complete, publicBaseUrl: publicBase.origin };
}

export function createR2S3Client(config: R2ProductStorageConfig): S3Client {
  const complete = validateR2ProductStorageConfig(config);
  return new S3Client({
    region: 'auto',
    endpoint: `https://${complete.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: complete.accessKeyId,
      secretAccessKey: complete.secretAccessKey,
    },
  });
}

const isObjectNotFound = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    code?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return candidate.$metadata?.httpStatusCode === 404
    || ['NoSuchKey', 'NotFound'].includes(candidate.name || candidate.code || candidate.Code || '');
};

const isSafeObjectKey = (key: string) => {
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('?') || key.includes('#')) return false;
  const segments = key.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..');
};

const belongsToCompany = (companyId: string, key: string) => (
  Boolean(companyId)
  && !companyId.includes('/')
  && isSafeObjectKey(key)
  && key.startsWith(`products/${companyId}/`)
);

export class R2ProductStorage implements ProductStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: R2ProductStorageConfig, client?: S3Client) {
    const complete = validateR2ProductStorageConfig(config);
    this.client = client ?? createR2S3Client(complete);
    this.bucket = complete.bucket;
    this.publicBaseUrl = complete.publicBaseUrl;
  }

  async put(companyId: string, key: string, bytes: Buffer, mimeType: ProductImageMimeType) {
    if (!belongsToCompany(companyId, key)) throw new Error('Product object key is not scoped to the company.');
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
    }));
  }

  async get(companyId: string, key: string): Promise<StoredProductImage | null> {
    if (!belongsToCompany(companyId, key)) return null;
    let result;
    try {
      result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (isObjectNotFound(error)) return null;
      throw error;
    }
    if (!result.Body) throw new Error('R2 returned a product image without a body.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(result.ContentType || '')) {
      throw new Error('R2 returned a product image with an unsupported content type.');
    }
    return {
      bytes: Buffer.from(await result.Body.transformToByteArray()),
      mimeType: result.ContentType as ProductImageMimeType,
    };
  }

  async exists(companyId: string, key: string) {
    if (!belongsToCompany(companyId, key)) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isObjectNotFound(error)) return false;
      throw error;
    }
  }

  async remove(companyId: string, key: string) {
    if (!belongsToCompany(companyId, key)) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  buildUrl(key: string) {
    if (!isSafeObjectKey(key) || !key.startsWith('products/')) {
      throw new Error('Product object key is invalid.');
    }
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBaseUrl}/${encodedKey}`;
  }

  close() {
    this.client.destroy();
  }
}

export type ProductStorageSelection = {
  driver?: 'memory' | 'r2';
  allowMemory: boolean;
  memoryBaseUrl: string;
  r2: R2ProductStorageConfig;
};

export function selectProductStorage(selection: ProductStorageSelection): ProductStorage | null {
  if (selection.driver === 'r2') return new R2ProductStorage(selection.r2);
  if (selection.driver === 'memory' && !selection.allowMemory) {
    throw new Error('PRODUCT_STORAGE_DRIVER=memory is only allowed for local or QA databases.');
  }
  if (selection.driver === 'memory' || selection.allowMemory) {
    return new InMemoryProductStorage(selection.memoryBaseUrl);
  }
  return null;
}
