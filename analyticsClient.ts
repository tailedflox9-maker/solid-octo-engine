// analyticsClient.ts - Separate Supabase client for analytics/tracking
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Use separate environment variables for analytics
const analyticsUrl = import.meta.env.VITE_ANALYTICS_SUPABASE_URL || '';
const analyticsAnonKey = import.meta.env.VITE_ANALYTICS_SUPABASE_ANON_KEY || '';

// Flag to check if analytics is enabled
export const isAnalyticsEnabled = !!(analyticsUrl && analyticsAnonKey);

// Create analytics client (may be null if not configured)
export const analyticsClient: SupabaseClient | null = isAnalyticsEnabled
  ? createClient(analyticsUrl, analyticsAnonKey)
  : null;

// Helper function to safely execute analytics operations
export async function safeAnalyticsOperation<T>(
  operation: () => Promise<T>,
  fallbackValue: T
): Promise<T> {
  if (!analyticsClient || !isAnalyticsEnabled) {
    console.warn('Analytics not configured - operation skipped');
    return fallbackValue;
  }

  try {
    return await operation();
  } catch (error) {
    console.error('Analytics operation failed (non-critical):', error);
    return fallbackValue;
  }
}

// Export helper to check analytics status
export function getAnalyticsStatus() {
  return {
    enabled: isAnalyticsEnabled,
    configured: !!(analyticsUrl && analyticsAnonKey),
    url: analyticsUrl ? `${analyticsUrl.substring(0, 20)}...` : 'not set'
  };
}

if (!isAnalyticsEnabled) {
  console.warn(
    '⚠️ Analytics Supabase not configured. Tracking features will be disabled.\n' +
    'Set VITE_ANALYTICS_SUPABASE_URL and VITE_ANALYTICS_SUPABASE_ANON_KEY to enable.'
  );
} else {
  console.log('✅ Analytics Supabase client initialized');
}
