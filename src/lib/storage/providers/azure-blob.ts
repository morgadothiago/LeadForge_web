import type { Readable } from "node:stream";
import { BlobSASPermissions, BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { assertSafeKey } from "../keys";
import type { SignedUrlOptions, StorageObjectInfo, StorageProvider } from "../provider";

/**
 * SPEC-050 (D-050-1/2) — Azure Blob Storage: container UNICO (privado, sem acesso publico anonimo) com prefixo
 * por org; auth por connection string (so server-side, nunca logada). Leitura via SAS `r` e escrita via SAS
 * `cw`, ambas de TTL curto, geradas pelo client (shared key da connection string).
 */
export class AzureBlobStorageProvider implements StorageProvider {
  readonly name = "azure" as const;
  private readonly container: ContainerClient;
  private ensured?: Promise<unknown>;

  constructor(connectionString: string, containerName: string) {
    this.container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
  }

  /** Cria o container (privado: sem `access`) 1x por instancia. */
  private ensureContainer(): Promise<unknown> {
    return (this.ensured ??= this.container.createIfNotExists().catch((e) => {
      this.ensured = undefined;
      throw e;
    }));
  }

  async put(key: string, body: Readable, opts: { contentType: string }): Promise<void> {
    assertSafeKey(key);
    await this.ensureContainer();
    await this.container.getBlockBlobClient(key).uploadStream(body, 4 * 1024 * 1024, 4, { blobHTTPHeaders: { blobContentType: opts.contentType } });
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    return this.container.getBlockBlobClient(key).exists();
  }

  async getReadUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    assertSafeKey(key);
    return this.container.getBlockBlobClient(key).generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      startsOn: new Date(Date.now() - 60_000),
      expiresOn: new Date(Date.now() + opts.ttlSeconds * 1000),
      ...(opts.fileName ? { contentDisposition: `attachment; filename="${opts.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"` } : {}),
    });
  }

  async getUploadUrl(key: string, opts: SignedUrlOptions & { contentType: string }): Promise<string> {
    assertSafeKey(key);
    return this.container.getBlockBlobClient(key).generateSasUrl({
      permissions: BlobSASPermissions.parse("cw"),
      startsOn: new Date(Date.now() - 60_000),
      expiresOn: new Date(Date.now() + opts.ttlSeconds * 1000),
      contentType: opts.contentType,
    });
  }

  async list(prefix: string): Promise<StorageObjectInfo[]> {
    await this.ensureContainer();
    const out: StorageObjectInfo[] = [];
    for await (const b of this.container.listBlobsFlat({ prefix })) {
      out.push({ key: b.name, sizeBytes: b.properties.contentLength ?? 0, lastModified: b.properties.lastModified ?? new Date(0) });
    }
    return out;
  }
}
