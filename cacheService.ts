import { Business, Category } from './types';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

// IndexedDB Schema
interface JawalaDB extends DBSchema {
  businesses: {
    key: string;
    value: Business & { _synced_at: number };
  };
  categories: {
    key: string;
    value: Category;
  };
  metadata: {
    key: string;
    value: {
      key: string;
      value: any;
      updated_at: number;
    };
  };
}

const DB_NAME = 'jawala-business-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<JawalaDB> | null = null;

// Initialize IndexedDB
export async function initDB(): Promise<IDBPDatabase<JawalaDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<JawalaDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Businesses store
      if (!db.objectStoreNames.contains('businesses')) {
        db.createObjectStore('businesses', { keyPath: 'id' });
      }
      
      // Categories store
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }
      
      // Metadata store (for version tracking)
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }
    },
  });

  return dbInstance;
}

// ============================================
// Metadata Management
// ============================================

export async function getMetadata(key: string): Promise<any | null> {
  const db = await initDB();
  const data = await db.get('metadata', key);
  return data ? data.value : null;
}

export async function setMetadata(key: string, value: any): Promise<void> {
  const db = await initDB();
  await db.put('metadata', {
    key,
    value,
    updated_at: Date.now(),
  });
}

// ============================================
// Business Count/Version Tracking
// ============================================

export interface DataVersion {
  business_count: number;
  last_updated: string; // ISO timestamp of last change
  last_sync: number; // Local timestamp of last successful sync
}

export async function getLocalVersion(): Promise<DataVersion | null> {
  return await getMetadata('data_version');
}

export async function setLocalVersion(version: DataVersion): Promise<void> {
  await setMetadata('data_version', version);
}

// ============================================
// Categories Caching
// ============================================

export async function getCachedCategories(): Promise<Category[]> {
  const db = await initDB();
  return await db.getAll('categories');
}

export async function setCachedCategories(categories: Category[]): Promise<void> {
  const db = await initDB();
  const tx = db.transaction('categories', 'readwrite');
  
  // Clear existing
  await tx.store.clear();
  
  // Add new
  for (const category of categories) {
    await tx.store.put(category);
  }
  
  await tx.done;
}

// ============================================
// Businesses Caching
// ============================================

export async function getCachedBusinesses(): Promise<Business[]> {
  const db = await initDB();
  const businesses = await db.getAll('businesses');
  
  // Remove the _synced_at field before returning
  return businesses.map(b => {
    const { _synced_at, ...business } = b;
    return business as Business;
  });
}

export async function setCachedBusinesses(businesses: Business[]): Promise<void> {
  const db = await initDB();
  const tx = db.transaction('businesses', 'readwrite');
  
  // Clear existing
  await tx.store.clear();
  
  // Add new with sync timestamp
  const now = Date.now();
  for (const business of businesses) {
    await tx.store.put({ ...business, _synced_at: now });
  }
  
  await tx.done;
}

export async function updateCachedBusiness(business: Business): Promise<void> {
  const db = await initDB();
  await db.put('businesses', { ...business, _synced_at: Date.now() });
}

export async function deleteCachedBusiness(businessId: string): Promise<void> {
  const db = await initDB();
  await db.delete('businesses', businessId);
}

// ============================================
// Sync Strategy Functions
// ============================================

export interface SyncResult {
  action: 'no_change' | 'full_sync' | 'incremental_sync';
  businesses: Business[];
  categories: Category[];
  fromCache: boolean;
}

/**
 * Determines if we need to sync data from server
 * Returns: 
 * - 'no_change': Local data is up to date
 * - 'full_sync': Need to fetch all data
 * - 'incremental_sync': Only fetch changes (if supported)
 */
export async function checkSyncNeeded(
  remoteVersion: DataVersion
): Promise<'no_change' | 'full_sync' | 'incremental_sync'> {
  const localVersion = await getLocalVersion();
  
  // First time - need full sync
  if (!localVersion) {
    console.log('🔄 First time sync - fetching all data');
    return 'full_sync';
  }
  
  // Count changed - need sync
  if (localVersion.business_count !== remoteVersion.business_count) {
    console.log(`🔄 Count changed: ${localVersion.business_count} → ${remoteVersion.business_count}`);
    return 'full_sync';
  }
  
  // Last updated timestamp changed - need sync
  if (localVersion.last_updated !== remoteVersion.last_updated) {
    console.log(`🔄 Data updated: ${localVersion.last_updated} → ${remoteVersion.last_updated}`);
    return 'full_sync';
  }
  
  console.log('✅ Local data is up to date');
  return 'no_change';
}

/**
 * Smart sync: Only fetch if needed, otherwise use cache
 */
export async function smartSync(
  fetchRemoteVersion: () => Promise<DataVersion>,
  fetchAllData: () => Promise<{ businesses: Business[]; categories: Category[] }>
): Promise<SyncResult> {
  try {
    // Step 1: Silent check for remote version (lightweight)
    const remoteVersion = await fetchRemoteVersion();
    
    // Step 2: Check if sync is needed
    const syncAction = await checkSyncNeeded(remoteVersion);
    
    if (syncAction === 'no_change') {
      // Use cached data
      const [businesses, categories] = await Promise.all([
        getCachedBusinesses(),
        getCachedCategories(),
      ]);
      
      return {
        action: 'no_change',
        businesses,
        categories,
        fromCache: true,
      };
    }
    
    // Step 3: Fetch fresh data
    console.log('📥 Fetching fresh data from server...');
    const { businesses, categories } = await fetchAllData();
    
    // Step 4: Update cache
    await Promise.all([
      setCachedBusinesses(businesses),
      setCachedCategories(categories),
      setLocalVersion({
        ...remoteVersion,
        last_sync: Date.now(),
      }),
    ]);
    
    console.log(`✅ Synced ${businesses.length} businesses, ${categories.length} categories`);
    
    return {
      action: 'full_sync',
      businesses,
      categories,
      fromCache: false,
    };
    
  } catch (error) {
    console.error('❌ Sync failed, using cached data:', error);
    
    // Fallback to cache on error
    const [businesses, categories] = await Promise.all([
      getCachedBusinesses(),
      getCachedCategories(),
    ]);
    
    return {
      action: 'no_change',
      businesses,
      categories,
      fromCache: true,
    };
  }
}

// ============================================
// Offline Detection
// ============================================

export function isOnline(): boolean {
  return navigator.onLine;
}

export function onOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  return () => window.removeEventListener('online', callback);
}

export function onOffline(callback: () => void): () => void {
  window.addEventListener('offline', callback);
  return () => window.removeEventListener('offline', callback);
}

// ============================================
// Cache Management
// ============================================

export async function clearCache(): Promise<void> {
  const db = await initDB();
  await Promise.all([
    db.clear('businesses'),
    db.clear('categories'),
    db.clear('metadata'),
  ]);
  console.log('🗑️ Cache cleared');
}

export async function getCacheSize(): Promise<{
  businesses: number;
  categories: number;
  lastSync: number | null;
}> {
  const db = await initDB();
  const [businesses, categories, version] = await Promise.all([
    db.count('businesses'),
    db.count('categories'),
    getLocalVersion(),
  ]);
  
  return {
    businesses,
    categories,
    lastSync: version?.last_sync || null,
  };
}

// ============================================
// Background Sync (for PWA)
// ============================================

export async function registerBackgroundSync(): Promise<void> {
  if ('serviceWorker' in navigator && 'sync' in (self as any).registration) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register('sync-businesses');
      console.log('📡 Background sync registered');
    } catch (error) {
      console.error('Background sync registration failed:', error);
    }
  }
}
