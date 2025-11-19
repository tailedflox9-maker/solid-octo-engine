// trackingService.ts - UPDATED to use separate analytics client
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
  device_id: string;
  user_name?: string;
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
  }, undefined);
};

const scheduleFlush = () => {
  if (flushTimeout) clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flushEvents, FLUSH_INTERVAL);
};

const queueEvent = (table: string, data: any) => {
  if (!isAnalyticsEnabled) return; // Skip if analytics disabled
  
  eventQueue.push({ table, data });
  
  // Flush immediately if queue is full
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flushEvents();
  } else {
    scheduleFlush();
  }
};

// ============================================
// BUSINESS INTERACTION TRACKING
// ============================================

export const trackBusinessInteraction = (
  eventType: 'view' | 'call' | 'whatsapp' | 'share',
  businessId: string
) => {
  queueEvent('business_interactions', {
    event_type: eventType,
    business_id: businessId,
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
      .from('business_interactions')
      .select('business_id, event_type')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Count interactions per business
    const counts: Record<string, { views: number; calls: number; whatsapp: number; shares: number }> = {};
    
    data?.forEach(item => {
      if (!counts[item.business_id]) {
        counts[item.business_id] = { views: 0, calls: 0, whatsapp: 0, shares: 0 };
      }
      counts[item.business_id][item.event_type]++;
    });
    
    // Sort by total interactions
    const sorted = Object.entries(counts)
      .map(([businessId, stats]) => ({
        business_id: businessId,
        ...stats,
        total: stats.views + stats.calls + stats.whatsapp + stats.shares
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
    
    return sorted;
  }, []);
};

// ============================================
// LIVE USERS TRACKING (PING SYSTEM)
// ============================================

let pingInterval: NodeJS.Timeout | null = null;
const PING_INTERVAL = 20000; // Ping every 20 seconds
const ACTIVE_THRESHOLD = 60000; // Consider active if pinged within 60 seconds
const MIN_ACTIVITY_GAP = 10000; // Don't ping if user inactive for 10+ seconds

// Track user activity
let lastActivity = Date.now();
let isTabActive = true;

// Listen for user activity
['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
  document.addEventListener(event, () => {
    lastActivity = Date.now();
  }, { passive: true });
});

// Listen for tab visibility
document.addEventListener('visibilitychange', () => {
  isTabActive = !document.hidden;
  if (isTabActive) lastActivity = Date.now();
});

export const startLiveTracking = async () => {
  if (!isAnalyticsEnabled) return; // Skip if analytics disabled
  
  const deviceId = getDeviceId();
  const userName = getUserName();
  
  // Send initial ping
  await sendPing(deviceId, userName);
  
  // Set up periodic pings
  if (pingInterval) clearInterval(pingInterval);
  
  pingInterval = setInterval(() => {
    sendPing(deviceId, userName);
  }, PING_INTERVAL);
  
  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (pingInterval) clearInterval(pingInterval);
    // Send final ping with is_active = false
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
  // Only ping if:
  // 1. Tab is visible
  // 2. User was active in last 10 seconds
  // 3. Analytics is enabled
  if (!isTabActive || Date.now() - lastActivity > MIN_ACTIVITY_GAP || !isAnalyticsEnabled) {
    return; // Skip ping
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
// TIME-BASED ANALYTICS
// ============================================

export const getHourlyStats = async (date?: string) => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const { data, error } = await analyticsClient
      .from('visit_logs')
      .select('visited_at')
      .gte('visited_at', `${targetDate}T00:00:00`)
      .lt('visited_at', `${targetDate}T23:59:59`);
    
    if (error) throw error;
    
    // Group by hour
    const hourlyData: Record<number, number> = {};
    for (let i = 0; i < 24; i++) hourlyData[i] = 0;
    
    data?.forEach(log => {
      const hour = new Date(log.visited_at).getHours();
      hourlyData[hour]++;
    });
    
    return Object.entries(hourlyData).map(([hour, count]) => ({
      hour: parseInt(hour),
      visits: count
    }));
  }, []);
};

export const getDailyStats = async (days: number = 7) => {
  return safeAnalyticsOperation(async () => {
    if (!analyticsClient) return [];
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const { data, error } = await analyticsClient
      .from('visit_logs')
      .select('visited_at')
      .gte('visited_at', startDate.toISOString());
    
    if (error) throw error;
    
    // Group by date
    const dailyData: Record<string, number> = {};
    
    data?.forEach(log => {
      const date = new Date(log.visited_at).toISOString().split('T')[0];
      dailyData[date] = (dailyData[date] || 0) + 1;
    });
    
    return Object.entries(dailyData)
      .map(([date, count]) => ({ date, visits: count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, []);
};

// ============================================
// ORIGINAL TRACKING FUNCTIONS (IMPROVED)
// ============================================

export const trackUserVisit = async (userName: string): Promise<void> => {
  if (!isAnalyticsEnabled) {
    // Still save name locally even if analytics disabled
    setUserName(userName);
    return;
  }
  
  await safeAnalyticsOperation(async () => {
    if (!analyticsClient) return;
    
    const deviceId = getDeviceId();
    const userAgent = navigator.userAgent;
    
    // Check if user already exists
    const { data: existingUser, error: fetchError } = await analyticsClient
      .from('user_tracking')
      .select('*')
      .eq('device_id', deviceId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching user:', fetchError);
    }
    
    if (existingUser) {
      // Update existing user
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
      // Create new user
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
    
    // Queue the visit log (batched)
    queueEvent('visit_logs', {
      device_id: deviceId,
      user_name: userName,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      visited_at: new Date().toISOString()
    });
    
    // Save to localStorage
    setUserName(userName);
    
    // Start live tracking
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
      // Queue visit log (batched)
      queueEvent('visit_logs', {
        device_id: deviceId,
        user_name: userName,
        page_path: window.location.pathname,
        referrer: document.referrer || null,
        visited_at: new Date().toISOString()
      });
      
      // Update last visit time (no need to increment, trigger will handle it)
      await analyticsClient
        .from('user_tracking')
        .update({
          last_visit_at: new Date().toISOString()
        })
        .eq('device_id', deviceId);
      
      // Start live tracking
      startLiveTracking();
    }
  }, undefined);
};

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  flushEvents(); // Flush any pending events
});
