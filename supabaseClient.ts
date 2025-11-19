import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { Business, Category } from './types';
import { DataVersion } from './cacheService';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL or Anon Key is missing!');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// ============================================
// Database Types (matching snake_case from DB)
// ============================================
export interface DbBusiness {
  id: string;
  category: string;
  shop_name: string;
  owner_name: string;
  contact_number: string;
  address?: string;
  opening_hours?: string;
  services?: string[];
  home_delivery?: boolean;
  payment_options?: string[];
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

export interface DbCategory {
  id: string;
  name: string;
  icon: string;
}

export interface AdminProfile {
  id: string;
  display_name: string;
  email: string;
}

export interface AuditLog {
  id: number;
  business_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  performed_by: string;
  admin_name: string;
  old_data?: any;
  new_data?: any;
  performed_at: string;
}

// ============================================
// Helper Functions: Convert between formats
// ============================================

// Convert DB format (snake_case) to App format (camelCase)
export const dbBusinessToBusiness = (db: DbBusiness): Business => ({
  id: db.id,
  category: db.category,
  shopName: db.shop_name,
  ownerName: db.owner_name,
  contactNumber: db.contact_number,
  address: db.address,
  openingHours: db.opening_hours,
  services: db.services || [],
  homeDelivery: db.home_delivery || false,
  paymentOptions: db.payment_options || [],
});

// Convert App format (camelCase) to DB format (snake_case)
export const businessToDbBusiness = (business: Business): Partial<DbBusiness> => ({
  id: business.id,
  category: business.category,
  shop_name: business.shopName,
  owner_name: business.ownerName,
  contact_number: business.contactNumber,
  address: business.address,
  opening_hours: business.openingHours,
  services: business.services || [],
  home_delivery: business.homeDelivery || false,
  payment_options: business.paymentOptions || [],
});

// ============================================
// Authentication Functions
// ============================================

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) throw error;
  
  // Check if user is admin
  const { data: adminProfile, error: adminError } = await supabase
    .from('admin_profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();
  
  if (adminError || !adminProfile) {
    await supabase.auth.signOut();
    throw new Error('You are not authorized as an admin');
  }
  
  return { user: data.user, adminProfile };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const getCurrentUser = async (): Promise<User | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

export const isUserAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('admin_profiles')
    .select('id')
    .eq('id', userId)
    .single();
  
  return !error && !!data;
};

// ============================================
// Categories Functions
// ============================================

export const fetchCategories = async (): Promise<Category[]> => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name');
  
  if (error) throw error;
  return data || [];
};

// ============================================
// Businesses Functions
// ============================================

export const fetchBusinesses = async (): Promise<Business[]> => {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return (data || []).map(dbBusinessToBusiness);
};

export const addBusiness = async (business: Business): Promise<Business> => {
  const dbBusiness = businessToDbBusiness(business);
  
  // Remove id if it's empty (let DB generate it)
  if (!dbBusiness.id) {
    delete dbBusiness.id;
  }
  
  const { data, error } = await supabase
    .from('businesses')
    .insert([dbBusiness])
    .select()
    .single();
  
  if (error) throw error;
  return dbBusinessToBusiness(data);
};

export const updateBusiness = async (business: Business): Promise<Business> => {
  const dbBusiness = businessToDbBusiness(business);
  
  const { data, error } = await supabase
    .from('businesses')
    .update(dbBusiness)
    .eq('id', business.id)
    .select()
    .single();
  
  if (error) throw error;
  return dbBusinessToBusiness(data);
};

export const deleteBusiness = async (businessId: string): Promise<void> => {
  const { error } = await supabase
    .from('businesses')
    .delete()
    .eq('id', businessId);
  
  if (error) throw error;
};

// ============================================
// Data Version/Sync Functions
// ============================================

/**
 * Get current data version from server
 * Returns count and last update timestamp for cache validation
 */
export const getDataVersion = async (): Promise<DataVersion> => {
  try {
    // Get total count
    const { count, error: countError } = await supabase
      .from('businesses')
      .select('*', { count: 'exact', head: true });
    
    if (countError) throw countError;
    
    // Get last updated timestamp
    const { data, error: updateError } = await supabase
      .from('businesses')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();
    
    if (updateError && updateError.code !== 'PGRST116') {
      // PGRST116 means no rows, which is fine for empty table
      throw updateError;
    }
    
    return {
      business_count: count || 0,
      last_updated: data?.updated_at || new Date().toISOString(),
      last_sync: Date.now(),
    };
  } catch (error) {
    console.error('Error fetching data version:', error);
    // Return safe defaults on error
    return {
      business_count: 0,
      last_updated: new Date().toISOString(),
      last_sync: Date.now(),
    };
  }
};

// ============================================
// Audit Log Functions
// ============================================

export const fetchAuditLogs = async (businessId?: string): Promise<AuditLog[]> => {
  let query = supabase
    .from('business_audit_log')
    .select('*')
    .order('performed_at', { ascending: false });
  
  if (businessId) {
    query = query.eq('business_id', businessId);
  }
  
  const { data, error } = await query.limit(100);
  
  if (error) throw error;
  return data || [];
};

// ============================================
// Real-time Subscriptions
// ============================================

export const subscribeToBusinessChanges = (
  callback: (payload: any) => void
) => {
  return supabase
    .channel('businesses-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'businesses' },
      callback
    )
    .subscribe();
};
