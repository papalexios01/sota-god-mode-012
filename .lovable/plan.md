
# God Mode 2.0 - Autonomous SEO Maintenance Engine

## Executive Summary
Transform the existing UI-only "God Mode" toggle into a fully autonomous 24/7 content maintenance system that automatically scans sitemaps, prioritizes pages by SEO health, generates/rewrites content, and publishes to WordPress without human intervention.

## Current State Analysis
- **UI Toggle Exists**: Checkbox in Gap Analysis tab toggles `godModeEnabled` flag in Zustand store
- **No Automation**: Flag is never read or used to trigger any background processing
- **Priority Queue UI**: Priority URL management exists but isn't connected to automation
- **All Infrastructure Ready**: Sitemap crawling, content generation, NeuronWriter integration, and WordPress publishing are fully functional

## Architecture Overview

```text
+-----------------------------------------------------------------------------------+
|                          GOD MODE 2.0 CONTROL CENTER                              |
+-----------------------------------------------------------------------------------+
|  [START/STOP]  Status: RUNNING | Cycle: 47 | Next Scan: 12:45 PM | Queue: 8      |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                           AUTONOMOUS LOOP ENGINE                                   |
|  +-----------+    +-----------+    +-----------+    +-----------+    +-----------+|
|  | 1. SCAN   | -> | 2. SCORE  | -> | 3. QUEUE  | -> | 4. GENERATE| -> | 5. PUBLISH||
|  | Sitemap   |    | SEO Health|    | Prioritize|    | Content    |    | WordPress ||
|  +-----------+    +-----------+    +-----------+    +-----------+    +-----------+|
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                              REAL-TIME DASHBOARD                                   |
|  - Live progress feed          - Content queue visualization                       |
|  - Quality metrics over time   - WordPress publish confirmations                   |
|  - Error recovery alerts       - NeuronWriter score tracking                       |
+-----------------------------------------------------------------------------------+
```

## Implementation Plan

### Phase 1: Core State Management
**File: `src/lib/store.ts`**

Add new state for autonomous operation:
- `godModeStatus`: 'idle' | 'scanning' | 'scoring' | 'generating' | 'publishing' | 'paused'
- `godModeCurrentUrl`: Currently processing URL
- `godModeLastScan`: Timestamp of last sitemap scan
- `godModeStats`: { totalProcessed, successCount, errorCount, avgQualityScore }
- `godModeQueue`: Array of URLs with scores pending processing
- `godModeHistory`: Log of all processed items with results
- `godModeConfig`: { scanIntervalMinutes, maxConcurrent, autoPublish, publishStatus }

### Phase 2: SEO Health Scoring Engine
**New File: `src/lib/sota/SEOHealthScorer.ts`**

Create a scoring system to evaluate existing pages:
- Fetch page content via proxy/Jina
- Analyze for:
  - Word count (target: 2500+)
  - Freshness (last modified date)
  - Heading structure (proper H1/H2/H3 hierarchy)
  - Internal link count
  - External authority links
  - Keyword density
  - Schema markup presence
  - Page speed indicators
- Generate 0-100 health score
- Flag pages needing refresh: score < 70

### Phase 3: God Mode Engine Hook
**New File: `src/hooks/useGodModeEngine.ts`**

Create the autonomous processing hook:

```typescript
export function useGodModeEngine() {
  const engineRef = useRef<GodModeEngine | null>(null);
  
  const start = async (options: GodModeOptions) => {
    // Initialize engine with config
    // Begin autonomous loop
  };
  
  const stop = () => {
    // Graceful shutdown
    // Persist queue state
  };
  
  const pause = () => { /* Pause without losing state */ };
  const resume = () => { /* Resume from pause */ };
}
```

### Phase 4: Autonomous Loop Implementation
**New File: `src/lib/sota/GodModeEngine.ts`**

The core engine with a perpetual cycle:

**Cycle 1 - Sitemap Scan (every 4 hours by default)**
- Use existing `crawlSitemapUrls` infrastructure
- Filter through exclusion rules
- Store discovered URLs with last-seen timestamps

**Cycle 2 - SEO Health Scoring**
- Fetch each page (throttled, 2 concurrent max)
- Run through SEOHealthScorer
- Store scores in memory with timestamps

**Cycle 3 - Smart Queue Prioritization**
- Priority URLs from user queue: weighted 3x
- Critical pages (score < 50): immediate queue
- High priority (score 50-70): next batch
- Apply exclusion filters

**Cycle 4 - Content Generation**
- Pop highest priority from queue
- Use EnterpriseContentOrchestrator (already built)
- Full NeuronWriter integration
- Validate 90%+ quality scores

**Cycle 5 - WordPress Publishing**
- If autoPublish enabled: publish immediately
- Otherwise: add to manual review queue
- Respect user's draft/publish preference
- Preserve original slug for rewrites

**Cycle 6 - Sleep & Repeat**
- Configurable interval (default: process 1 article per hour)
- Exponential backoff on errors
- Smart pause during low-traffic hours (optional)

### Phase 5: God Mode Dashboard UI
**New File: `src/components/optimizer/GodModeDashboard.tsx`**

Enterprise-grade control center:

**Header Section**
- Large START/STOP button with animated state
- Current status indicator (Running/Paused/Idle)
- Cycle counter and next scheduled action

**Live Activity Feed**
- Real-time log of actions being performed
- Progress bars for current operations
- Expandable error details with retry buttons

**Queue Visualization**
- Sorted by priority with color-coded badges
- Estimated time to completion
- Manual reorder capability
- Bulk remove/skip actions

**Statistics Panel**
- Total articles processed (lifetime/session)
- Average quality scores over time
- Success/error rates
- WordPress publish confirmations

**History Log**
- Searchable list of all processed items
- Filter by status (success/error/skipped)
- Link to WordPress posts
- NeuronWriter scores

### Phase 6: Configuration Panel
**Enhance: `src/components/optimizer/steps/ContentStrategy.tsx`**

Replace simple checkbox with full config panel:

**Scan Settings**
- Sitemap scan interval (1h / 4h / 12h / 24h)
- Max pages per scan batch
- Exclusion pattern builder

**Processing Settings**
- Concurrent generation limit (1-3)
- Quality threshold before publish (default: 85%)
- Auto-retry on failure (0-3 attempts)

**Publishing Settings**
- Auto-publish toggle (or queue for review)
- Default post status (draft/publish)
- Notification preferences

**Schedule Settings**
- Active hours (e.g., 6am-10pm)
- Rate limiting (max X articles per day)
- Weekend processing toggle

### Phase 7: Persistence & Recovery
**Enhance: `src/lib/store.ts`**

Ensure God Mode survives browser refresh:
- Persist queue to localStorage
- Store processing history (last 100 items)
- Auto-resume on page load if was running
- Sync state across tabs via BroadcastChannel

### Phase 8: Edge Function for Background Processing (Optional Enhancement)
**New File: `supabase/functions/god-mode-worker/index.ts`**

For true 24/7 operation without browser open:
- Scheduled via pg_cron (every 30 min)
- Reads queue from Supabase table
- Performs generation server-side
- Publishes to WordPress
- Updates status in database

This is marked as optional Phase 8 as it requires:
- Supabase database tables for queue/config
- Moving AI API keys to Supabase secrets
- More complex state synchronization

## Technical Specifications

### New Files to Create
| File | Purpose |
|------|---------|
| `src/lib/sota/GodModeEngine.ts` | Core autonomous loop logic |
| `src/lib/sota/SEOHealthScorer.ts` | Page health analysis |
| `src/hooks/useGodModeEngine.ts` | React hook for engine control |
| `src/components/optimizer/GodModeDashboard.tsx` | Full dashboard UI |
| `src/components/optimizer/GodModeActivityFeed.tsx` | Real-time log component |
| `src/components/optimizer/GodModeQueuePanel.tsx` | Queue visualization |
| `src/components/optimizer/GodModeConfigPanel.tsx` | Configuration UI |

### Files to Modify
| File | Changes |
|------|---------|
| `src/lib/store.ts` | Add God Mode state, history, config |
| `src/components/optimizer/steps/ContentStrategy.tsx` | Replace checkbox with dashboard link |
| `src/components/optimizer/OptimizerNav.tsx` | Add God Mode status indicator |

### State Schema Addition

```typescript
interface GodModeState {
  status: 'idle' | 'running' | 'paused' | 'error';
  currentPhase: 'scanning' | 'scoring' | 'generating' | 'publishing' | null;
  currentUrl: string | null;
  
  queue: Array<{
    url: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    healthScore: number;
    addedAt: Date;
    source: 'manual' | 'scan';
  }>;
  
  history: Array<{
    url: string;
    action: 'generated' | 'published' | 'skipped' | 'error';
    timestamp: Date;
    qualityScore?: number;
    wordPressUrl?: string;
    error?: string;
  }>;
  
  stats: {
    totalProcessed: number;
    successCount: number;
    errorCount: number;
    avgQualityScore: number;
    lastScanAt: Date | null;
    nextScanAt: Date | null;
  };
  
  config: {
    scanIntervalHours: number;
    maxConcurrent: number;
    qualityThreshold: number;
    autoPublish: boolean;
    defaultStatus: 'draft' | 'publish';
    maxPerDay: number;
    activeHoursStart: number;
    activeHoursEnd: number;
    retryAttempts: number;
  };
}
```

### Processing Flow Pseudocode

```text
WHILE godModeEnabled AND status === 'running':
  
  IF shouldScan():
    status = 'scanning'
    urls = await crawlSitemap()
    urls = filterExclusions(urls)
    storeSitemapUrls(urls)
    updateLastScan()
  
  IF queue.length === 0:
    status = 'scoring'
    FOR url IN sitemapUrls:
      score = await scorePageHealth(url)
      IF score < 70:
        addToQueue(url, score)
    
    sortQueueByPriority()
  
  IF queue.length > 0 AND withinActiveHours():
    status = 'generating'
    item = queue.shift()
    currentUrl = item.url
    
    TRY:
      content = await orchestrator.generateContent({
        keyword: extractKeyword(item.url),
        sourceUrl: item.url
      })
      
      IF content.qualityScore >= qualityThreshold:
        IF autoPublish:
          status = 'publishing'
          await publishToWordPress(content, item.url)
          addToHistory(item.url, 'published', content)
        ELSE:
          addToReviewQueue(content)
          addToHistory(item.url, 'generated', content)
      ELSE:
        addToHistory(item.url, 'skipped', 'Quality below threshold')
    
    CATCH error:
      IF retryCount < retryAttempts:
        requeue(item)
      ELSE:
        addToHistory(item.url, 'error', error.message)
  
  AWAIT sleep(calculateInterval())
```

## Success Criteria
1. User can start God Mode with one click
2. System autonomously scans sitemap without intervention
3. Pages are scored and queued by SEO health priority
4. Content generates with 90%+ quality scores
5. WordPress publishing works with correct slugs
6. Dashboard shows real-time progress
7. System recovers gracefully from errors
8. State persists across browser sessions
9. User can pause/resume at any time
10. History is searchable and exportable

## Risk Mitigation
- **Rate Limiting**: Built-in throttling prevents API abuse
- **Quality Gates**: No publishing below threshold
- **Error Recovery**: Exponential backoff and retry logic
- **Manual Override**: User can always pause/stop
- **Audit Trail**: Complete history logging
- **Cost Control**: Max articles per day limit
