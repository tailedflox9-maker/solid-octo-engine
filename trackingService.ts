// trackingService.ts - ENHANCED with AI search tracking
import { analyticsClient, isAnalyticsEnabled, safeAnalyticsOperation } from './analyticsClient';

// ============================================
// Types
// ============================================

export interface UserTrackingData {
  id?: string;
  user_name: string;
  device_id: string;
  first_visit_at?: string;
  last_visit_at?: string;
  total_visits?: number;
  user_agent?: string;
}

export interface VisitLog {
  id?: string;
  device_id: string;
  user_name?: string;
  visited_at?: string;
  page_path?: string;
  referrer?: string;
}

export interface AnalyticsSummary {
  total_unique_users: number;
  total_visits: number;
  last_updated: string;
}

export interface BusinessInteraction {
  event_type: 'view' | 'call' | 'whatsapp' | 'share';
  business_id: string;
  business_name?: string;
  device_id: string;
  user_name?: string;
}

// NEW: AI Search Log Type
export interface AiSearchLog {
  device_id: string;
  user_name?: string;
  search_query: string;
  ai_response_summary?: string;
  businesses_found?: string[]; // Array of business IDs
  businesses_count: number;
  search_success: boolean;
  model_used?: string;
  response_time_ms?: number;
  searched_at?: string;
}

// ============================================
// Device ID Management (localStorage)
// ============================================

const DEVICE_ID_KEY = 'jawala_device_id';
const USER_NAME_KEY = 'jawala_user_name';

export const getDeviceId = (): string => {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  
  return deviceId;
};

export const getUserName = (): string | null => {
  return localStorage.getItem(USER_NAME_KEY);
};

export const setUserName = (name: string): void => {
  localStorage.setItem(USER_NAME_KEY, name);
};

export const hasUserName = (): boolean => {
  return !!getUserName();
};

// ============================================
// EVENT BATCHING SYSTEM
// ============================================

let eventQueue: any[] = [];
let flushTimeout: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL = 5000; // Flush every 5 seconds
const MAX_QUEUE_SIZE = 10; // Or when queue reaches 10 events

const flushEvents = async () => {
  if (eventQueue.length === 0 || !isAnalyticsEnabled) return;
  
  const eventsToSend = [...eventQueue];
  eventQueue = [];
  
  await safeAnalyticsOperation(async () => {
    // Group events by table
    const businessInteractions = eventsToSend.filter(e => e.table === 'business_interactions');
    const visitLogs = eventsToSend.filter(e => e.table === 'visit_logs');
    const aiSearchLogs = eventsToSend.filter(e => e.table === 'ai_search_logs');
    
    // Batch insert business interactions
    if (businessInteractions.length > 0 && analyticsClient) {
      const { error } = await analyticsClient
        .from('business_interactions')
        .insert(businessInteractions.map(e => e.data));
      
      if (error) console.error('Error inserting business interactions:', error);
    }
    
    // Batch insert visit logs
    if (visitLogs.length > 0 && analyticsClient) {
      const { error } = await analyticsClient
        .from('visit_logs')
        .insert(visitLogs.map(e => e.data));
      
      if (error) console.error('Error inserting visit logs:', error);
    }
    
    // Batch insert AI search logs
    if (aiSearchLogs.length > 0 && analyticsClient) {
      const { error } = await analyticsClient
        .from('ai_search_logs')
        .insert(aiSearchLogs.map(e => e.data));
      
      if (error) console.error('Error inserting AI search logs:', error);
    }
  }, undefined);
};

const scheduleFlush = () => {
  if (flushTimeout) clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flushEvents, FLUSH_INTERVAL);
};

const queueEvent = (table: string, data: any) => {
  if (!isAnalyticsEnabled) return;
  
  eventQueue.push({ table, data });
  
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flushEvents();
  } else {
    scheduleFlush();
  }
};

// ============================================
// AI SEARCH TRACKING - NEW
// ============================================

export const trackAiSearch = (
  searchQuery: string,
  aiResponseSummary: string,
  businessesFound: string[], // Array of business IDs
  modelUsed: string = 'gemini-1.5-flash',
  responseTimeMs?: number
) => {
  queueEvent('ai_search_logs', {
    device_id: getDeviceId(),
    user_name: getUserName(),
    search_query: searchQuery,
    ai_response_summary: aiResponseSummary,
    businesses_found: businessesFound,
    businesses_count: businessesFound.length,
    search_success: businessesFound.length > 0,
    model_used: modelUsed,
    response_time_ms: responseTimeMs,
    searched_at: new Date().toISOString()
  });
};

// Get popular searches
export const getPopularSearches = async (limit: number = 20) => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const { data, error } = await analyticsClient
      .from('popular_searches')
      .select('*')
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  }, []);
};

// Get failed searches
export const getFailedSearches = async (limit: number = 20) => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const { data, error } = await analyticsClient
      .from('failed_searches')
      .select('*')
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  }, []);
};

// ============================================
// BUSINESS INTERACTION TRACKING
// ============================================

export const trackBusinessInteraction = (
  eventType: 'view' | 'call' | 'whatsapp' | 'share',
  businessId: string,
  businessName?: string
) => {
  queueEvent('business_interactions', {
    event_type: eventType,
    business_id: businessId,
    business_name: businessName || null,
    device_id: getDeviceId(),
    user_name: getUserName(),
    created_at: new Date().toISOString()
  });
};

// Get popular businesses
export const getPopularBusinesses = async (limit: number = 10) => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const { data, error } = await analyticsClient
      .from('interaction_stats')
      .select('*')
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  }, []);
};

// Get conversion rates
export const getConversionRates = async (limit: number = 15) => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const { data, error } = await analyticsClient
      .from('business_conversion_rates')
      .select('*')
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  }, []);
};

// ============================================
// LIVE USERS TRACKING (PING SYSTEM)
// ============================================

let pingInterval: NodeJS.Timeout | null = null;
const PING_INTERVAL = 20000;
const ACTIVE_THRESHOLD = 60000;
const MIN_ACTIVITY_GAP = 10000;

let lastActivity = Date.now();
let isTabActive = true;

['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
  document.addEventListener(event, () => {
    lastActivity = Date.now();
  }, { passive: true });
});

document.addEventListener('visibilitychange', () => {
  isTabActive = !document.hidden;
  if (isTabActive) lastActivity = Date.now();
});

export const startLiveTracking = async () => {
  if (!isAnalyticsEnabled) return;
  
  const deviceId = getDeviceId();
  const userName = getUserName();
  
  await sendPing(deviceId, userName);
  
  if (pingInterval) clearInterval(pingInterval);
  
  pingInterval = setInterval(() => {
    sendPing(deviceId, userName);
  }, PING_INTERVAL);
  
  window.addEventListener('beforeunload', () => {
    if (pingInterval) clearInterval(pingInterval);
    if (isAnalyticsEnabled && analyticsClient) {
      navigator.sendBeacon(
        `${analyticsClient.supabaseUrl}/rest/v1/live_users`,
        JSON.stringify({
          device_id: deviceId,
          user_name: userName,
          is_active: false,
          last_ping: new Date().toISOString()
        })
      );
    }
  });
};

const sendPing = async (deviceId: string, userName: string | null) => {
  if (!isTabActive || Date.now() - lastActivity > MIN_ACTIVITY_GAP || !isAnalyticsEnabled) {
    return;
  }
  
  await safeAnalyticsOperation(async () => {
    if (!analyticsClient) return;
    
    const { error } = await analyticsClient
      .from('live_users')
      .upsert({
        device_id: deviceId,
        user_name: userName,
        is_active: true,
        last_ping: new Date().toISOString()
      }, {
        onConflict: 'device_id'
      });
    
    if (error) console.error('Error sending ping:', error);
  }, undefined);
};

export const getLiveUsersCount = async (): Promise<number> => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return 0;
    
    const threshold = new Date(Date.now() - ACTIVE_THRESHOLD).toISOString();
    
    const { count, error } = await analyticsClient
      .from('live_users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('last_ping', threshold);
    
    if (error) throw error;
    return count || 0;
  }, 0);
};

// ============================================
// ORIGINAL TRACKING FUNCTIONS
// ============================================

export const trackUserVisit = async (userName: string): Promise<void> => {
  if (!isAnalyticsEnabled) {
    setUserName(userName);
    return;
  }
  
  await safeAnalyticsOperation(async () => {
    if (!analyticsClient) return;
    
    const deviceId = getDeviceId();
    const userAgent = navigator.userAgent;
    
    const { data: existingUser, error: fetchError } = await analyticsClient
      .from('user_tracking')
      .select('*')
      .eq('device_id', deviceId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching user:', fetchError);
    }
    
    if (existingUser) {
      const { error: updateError } = await analyticsClient
        .from('user_tracking')
        .update({
          user_name: userName,
          last_visit_at: new Date().toISOString(),
          total_visits: (existingUser.total_visits || 0) + 1,
        })
        .eq('device_id', deviceId);
      
      if (updateError) {
        console.error('Error updating user:', updateError);
      }
    } else {
      const { error: insertError } = await analyticsClient
        .from('user_tracking')
        .insert([{
          user_name: userName,
          device_id: deviceId,
          user_agent: userAgent,
          total_visits: 1,
        }]);
      
      if (insertError) {
        console.error('Error creating user:', insertError);
      }
    }
    
    queueEvent('visit_logs', {
      device_id: deviceId,
      user_name: userName,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      visited_at: new Date().toISOString()
    });
    
    setUserName(userName);
    startLiveTracking();
  }, undefined);
};

export const getAnalyticsSummary = async (): Promise<AnalyticsSummary | null> => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return null;
    
    const { data, error } = await analyticsClient
      .from('analytics_summary')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (error) {
      console.error('Error fetching analytics:', error);
      return null;
    }
    
    return data;
  }, null);
};

export const getAllUsers = async (): Promise<UserTrackingData[]> => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const { data, error } = await analyticsClient
      .from('user_tracking')
      .select('*')
      .order('last_visit_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching users:', error);
      return [];
    }
    
    return data || [];
  }, []);
};

export const getRecentVisits = async (limit: number = 50): Promise<VisitLog[]> => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const { data, error } = await analyticsClient
      .from('visit_logs')
      .select('*')
      .order('visited_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Error fetching visits:', error);
      return [];
    }
    
    return data || [];
  }, []);
};

export const initializeTracking = async (): Promise<void> => {
  if (!isAnalyticsEnabled) return;
  
  await safeAnalyticsOperation(async () => {
    if (!analyticsClient) return;
    
    const deviceId = getDeviceId();
    const userName = getUserName();
    
    if (userName) {
      queueEvent('visit_logs', {
        device_id: deviceId,
        user_name: userName,
        page_path: window.location.pathname,
        referrer: document.referrer || null,
        visited_at: new Date().toISOString()
      });
      
      await analyticsClient
        .from('user_tracking')
        .update({
          last_visit_at: new Date().toISOString()
        })
        .eq('device_id', deviceId);
      
      startLiveTracking();
    }
  }, undefined);
};

window.addEventListener('beforeunload', () => {
  flushEvents();
});
