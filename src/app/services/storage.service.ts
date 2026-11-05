import { Injectable } from '@angular/core';
import { WrappedKeyData } from './crypto.service';

export interface VaultMeta {
  id: 'vault';
  passwordWrap: WrappedKeyData;
  recoveryWrap: WrappedKeyData;
  createdAt: number;
}

export interface PhotoRecord {
  id: string;
  iv: string;
  mimeType: string;
  fileName: string;
  addedAt: number;
  ciphertext: ArrayBuffer;
  thumbCiphertext: ArrayBuffer;
  thumbIv: string;
}

export interface PhotoListItem {
  id: string;
  mimeType: string;
  fileName: string;
  addedAt: number;
}

const DB_NAME = 'photo-vault-db';
const DB_VERSION = 1;
const META_STORE = 'meta';
const PHOTO_STORE = 'photos';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async getVaultMeta(): Promise<VaultMeta | undefined> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get('vault');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async saveVaultMeta(meta: VaultMeta): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async addPhoto(photo: PhotoRecord): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).put(photo);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getPhoto(id: string): Promise<PhotoRecord | undefined> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async listPhotos(): Promise<PhotoListItem[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_STORE).getAll();
      req.onsuccess = () => {
        const items: PhotoListItem[] = (req.result as PhotoRecord[])
          .map((p) => ({ id: p.id, mimeType: p.mimeType, fileName: p.fileName, addedAt: p.addedAt }))
          .sort((a, b) => b.addedAt - a.addedAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deletePhoto(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async photoCount(): Promise<number> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
