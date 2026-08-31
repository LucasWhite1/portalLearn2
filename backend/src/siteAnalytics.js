const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { createRateLimiter, isUuid, sanitizeText } = require('./security');

const publicRouter = express.Router();
const adminRouter = express.Router();
let schemaEnsured = false;

const EVENT_NAMES = new Set([
  'page_view',
  'page_exit',
  'heartbeat',
  'click',
  'form_start',
  'form_submit',
  'scroll_depth',
  'video_play',
  'video_progress',
  'video_impression',
  'video_start',
  'video_resume',
  'video_pause',
  'video_seek',
  'video_complete',
  'video_exit',
  'video_speed_change',
  'video_volume_change',
  'video_fullscreen',
  'demo_interaction',
  'checkout_start',
  'purchase',
  'lead',
  'contact',
  'custom'
]);

const collectLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyFn: (req) => `site-analytics:${req.ip}`
});

const clampInteger = (value, min, max, fallback = 0) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const cleanText = (value, maxLength = 180) => sanitizeText(String(value || ''), maxLength) || null;

const cleanPagePath = (value) => {
  const raw = String(value || '/').trim();
  try {
    const parsed = new URL(raw, 'https://analytics.invalid');
    const allowedParams = new URLSearchParams();
    ['plan', 'demoTemplates', 'publicModuleId'].forEach((key) => {
      const param = parsed.searchParams.get(key);
      if (param) allowedParams.set(key, param.slice(0, 160));
    });
    const query = allowedParams.toString();
    return `${parsed.pathname.slice(0, 500) || '/'}${query ? `?${query}` : ''}`;
  } catch (error) {
    return '/';
  }
};

const cleanExternalHref = (value) => {
  if (!value) return null;
  try {
    const parsed = new URL(String(value), 'https://analytics.invalid');
    if (parsed.origin === 'https://analytics.invalid') return cleanPagePath(parsed.pathname + parsed.search);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.slice(0, 240)}`;
  } catch (error) {
    return null;
  }
};

const cleanMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .slice(0, 12)
      .map(([key, value]) => [
        String(key).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
        typeof value === 'number' || typeof value === 'boolean'
          ? value
          : String(value || '').slice(0, 180)
      ])
      .filter(([key]) => key)
  );
};

const parseClient = (userAgent = '') => {
  const ua = String(userAgent || '');
  let browser = 'Outro';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let operatingSystem = 'Outro';
  if (/Windows/i.test(ua)) operatingSystem = 'Windows';
  else if (/Android/i.test(ua)) operatingSystem = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystem = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) operatingSystem = 'macOS';
  else if (/Linux/i.test(ua)) operatingSystem = 'Linux';

  let deviceType = 'desktop';
  if (/iPad|Tablet/i.test(ua)) deviceType = 'tablet';
  else if (/Mobi|Android|iPhone|iPod/i.test(ua)) deviceType = 'mobile';
  return { browser, operatingSystem, deviceType };
};

const getReferrerDomain = (value) => {
  try {
    const hostname = new URL(String(value || '')).hostname.replace(/^www\./i, '');
    return cleanText(hostname, 180);
  } catch (error) {
    return null;
  }
};

const getNetworkHash = (req) => {
  const secret = process.env.ANALYTICS_HASH_SECRET || process.env.SESSION_SECRET || 'criatyve-analytics';
  return crypto.createHmac('sha256', secret).update(String(req.ip || '')).digest('hex');
};

const ensureAnalyticsSchema = async () => {
  if (schemaEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics_visitors (
      id UUID PRIMARY KEY,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sessions_count INT NOT NULL DEFAULT 0,
      first_source TEXT,
      first_campaign TEXT,
      latest_source TEXT,
      latest_campaign TEXT
    );
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id UUID PRIMARY KEY,
      visitor_id UUID NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      duration_seconds INT NOT NULL DEFAULT 0,
      landing_path TEXT NOT NULL,
      exit_path TEXT,
      referrer_domain TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term TEXT,
      click_id_kind TEXT,
      device_type TEXT,
      operating_system TEXT,
      browser_name TEXT,
      language TEXT,
      timezone TEXT,
      country_code TEXT,
      screen_width INT,
      screen_height INT,
      network_hash TEXT,
      event_count INT NOT NULL DEFAULT 0,
      pageview_count INT NOT NULL DEFAULT 0,
      max_scroll_depth SMALLINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS analytics_events (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
      visitor_id UUID NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      page_path TEXT NOT NULL,
      page_title TEXT,
      duration_ms INT,
      scroll_depth SMALLINT,
      element_tag TEXT,
      element_id TEXT,
      element_text TEXT,
      element_href TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON analytics_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor ON analytics_sessions(visitor_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_source ON analytics_sessions(utm_source, utm_campaign, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_name_date ON analytics_events(event_name, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_page_date ON analytics_events(page_path, occurred_at DESC);
  `);
  schemaEnsured = true;
};

const recordPurchaseEvent = async ({ visitorId, sessionId, payment = {}, planCode = '' } = {}) => {
  if (!isUuid(visitorId) || !isUuid(sessionId)) return false;
  await ensureAnalyticsSchema();
  const sessionResult = await db.query(
    'SELECT exit_path, landing_path FROM analytics_sessions WHERE id = $1 AND visitor_id = $2',
    [sessionId, visitorId]
  );
  if (!sessionResult.rows.length) return false;
  const providerPaymentId = cleanText(payment.id, 100);
  const deterministicId = crypto
    .createHash('sha256')
    .update(`purchase:${providerPaymentId || sessionId}`)
    .digest('hex');
  const eventId = `${deterministicId.slice(0, 8)}-${deterministicId.slice(8, 12)}-4${deterministicId.slice(13, 16)}-a${deterministicId.slice(17, 20)}-${deterministicId.slice(20, 32)}`;
  const pagePath = sessionResult.rows[0].exit_path || sessionResult.rows[0].landing_path || '/checkout-status.html';
  const result = await db.query(
    `INSERT INTO analytics_events (
       id, session_id, visitor_id, event_name, occurred_at, page_path, metadata
     ) VALUES ($1, $2, $3, 'purchase', NOW(), $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      eventId,
      sessionId,
      visitorId,
      pagePath,
      {
        plan: cleanText(planCode, 40),
        value: Number.isFinite(Number(payment.value)) ? Number(payment.value) : null,
        currency: 'BRL',
        billing_type: cleanText(payment.billingType, 30)
      }
    ]
  );
  if (result.rowCount) {
    await db.query(
      `UPDATE analytics_sessions
          SET event_count = event_count + 1,
              last_seen_at = NOW()
        WHERE id = $1`,
      [sessionId]
    );
  }
  return Boolean(result.rowCount);
};

const normalizeEvent = (event, visitorId, sessionId) => {
  if (!isUuid(event?.id)) return null;
  const eventName = EVENT_NAMES.has(event?.name) ? event.name : 'custom';
  const occurredAt = new Date(event?.occurredAt || Date.now());
  const safeOccurredAt = Number.isFinite(occurredAt.getTime()) && Math.abs(Date.now() - occurredAt.getTime()) < 7 * 86400000
    ? occurredAt.toISOString()
    : new Date().toISOString();
  return {
    id: event.id,
    visitorId,
    sessionId,
    name: eventName,
    occurredAt: safeOccurredAt,
    pagePath: cleanPagePath(event?.pagePath),
    pageTitle: cleanText(event?.pageTitle, 200),
    durationMs: event?.durationMs == null ? null : clampInteger(event.durationMs, 0, 12 * 60 * 60 * 1000),
    scrollDepth: event?.scrollDepth == null ? null : clampInteger(event.scrollDepth, 0, 100),
    elementTag: cleanText(event?.target?.tag, 30),
    elementId: cleanText(event?.target?.id, 100),
    elementText: cleanText(event?.target?.text, 140),
    elementHref: cleanExternalHref(event?.target?.href),
    metadata: cleanMetadata(event?.metadata)
  };
};

publicRouter.post('/collect', collectLimiter, async (req, res, next) => {
  try {
    const visitorId = req.body?.visitorId;
    const sessionId = req.body?.sessionId;
    if (!isUuid(visitorId) || !isUuid(sessionId)) {
      return res.status(400).json({ message: 'Identificadores de analytics invalidos.' });
    }
    await ensureAnalyticsSchema();
    const session = req.body?.session || {};
    const events = (Array.isArray(req.body?.events) ? req.body.events : [])
      .slice(0, 50)
      .map((event) => normalizeEvent(event, visitorId, sessionId))
      .filter(Boolean);
    const clientInfo = parseClient(req.headers['user-agent']);
    const source = cleanText(session.utmSource, 120);
    const campaign = cleanText(session.utmCampaign, 180);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const visitorInsert = await client.query(
        `INSERT INTO analytics_visitors (
           id, first_source, first_campaign, latest_source, latest_campaign, sessions_count
         ) VALUES ($1, $2, $3, $2, $3, 1)
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at = NOW(),
           latest_source = COALESCE(EXCLUDED.latest_source, analytics_visitors.latest_source),
           latest_campaign = COALESCE(EXCLUDED.latest_campaign, analytics_visitors.latest_campaign)
         RETURNING (xmax = 0) AS inserted`,
        [visitorId, source, campaign]
      );
      const newVisitor = visitorInsert.rows[0]?.inserted === true;
      const insertedSession = await client.query(
        `INSERT INTO analytics_sessions (
           id, visitor_id, landing_path, exit_path, referrer_domain,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id_kind,
           device_type, operating_system, browser_name, language, timezone, country_code,
           screen_width, screen_height, network_hash
         ) VALUES (
           $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19
         )
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at = NOW(),
           exit_path = EXCLUDED.exit_path,
           duration_seconds = GREATEST(analytics_sessions.duration_seconds, EXCLUDED.duration_seconds)
         RETURNING (xmax = 0) AS inserted`,
        [
          sessionId,
          visitorId,
          cleanPagePath(session.landingPath || session.pagePath),
          getReferrerDomain(session.referrer),
          source,
          cleanText(session.utmMedium, 120),
          campaign,
          cleanText(session.utmContent, 180),
          cleanText(session.utmTerm, 180),
          cleanText(session.clickIdKind, 40),
          clientInfo.deviceType,
          clientInfo.operatingSystem,
          clientInfo.browser,
          cleanText(session.language, 40),
          cleanText(session.timezone, 80),
          cleanText(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'], 2),
          clampInteger(session.screenWidth, 0, 16000),
          clampInteger(session.screenHeight, 0, 16000),
          getNetworkHash(req)
        ]
      );
      if (!newVisitor && insertedSession.rows[0]?.inserted === true) {
        await client.query('UPDATE analytics_visitors SET sessions_count = sessions_count + 1 WHERE id = $1', [visitorId]);
      }

      let insertedEvents = 0;
      let pageviews = 0;
      let maxScroll = 0;
      let maxDurationSeconds = 0;
      let exitPath = cleanPagePath(session.pagePath || session.landingPath);
      let endedAt = null;
      for (const event of events) {
        const result = await client.query(
          `INSERT INTO analytics_events (
             id, session_id, visitor_id, event_name, occurred_at, page_path, page_title,
             duration_ms, scroll_depth, element_tag, element_id, element_text, element_href, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (id) DO NOTHING`,
          [
            event.id, event.sessionId, event.visitorId, event.name, event.occurredAt,
            event.pagePath, event.pageTitle, event.durationMs, event.scrollDepth,
            event.elementTag, event.elementId, event.elementText, event.elementHref, event.metadata
          ]
        );
        if (!result.rowCount) continue;
        insertedEvents += 1;
        if (event.name === 'page_view') pageviews += 1;
        maxScroll = Math.max(maxScroll, event.scrollDepth || 0);
        maxDurationSeconds = Math.max(maxDurationSeconds, Math.round((event.durationMs || 0) / 1000));
        exitPath = event.pagePath || exitPath;
        if (event.name === 'page_exit') endedAt = event.occurredAt;
      }
      await client.query(
        `UPDATE analytics_sessions
            SET last_seen_at = NOW(),
                ended_at = COALESCE($2::timestamptz, ended_at),
                exit_path = $3,
                duration_seconds = GREATEST(duration_seconds, $4),
                event_count = event_count + $5,
                pageview_count = pageview_count + $6,
                max_scroll_depth = GREATEST(max_scroll_depth, $7)
          WHERE id = $1`,
        [sessionId, endedAt, exitPath, maxDurationSeconds, insertedEvents, pageviews, maxScroll]
      );
      await client.query('COMMIT');
      return res.status(202).json({ accepted: insertedEvents });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

const requireGlobalAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Somente o admin principal pode acessar o trackeamento.' });
  return next();
};

const buildSessionFilter = (query = {}) => {
  const values = [clampInteger(query.days, 1, 365, 30)];
  const conditions = [`s.started_at >= NOW() - ($1::int * INTERVAL '1 day')`];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };
  const source = cleanText(query.source, 120);
  const device = ['desktop', 'mobile', 'tablet'].includes(query.device) ? query.device : null;
  const page = cleanText(query.page, 300);
  const search = cleanText(query.search, 180);
  if (source) add(`COALESCE(s.utm_source, s.referrer_domain, 'Direto') = ?`, source);
  if (device) add('s.device_type = ?', device);
  if (page) add('EXISTS (SELECT 1 FROM analytics_events pe WHERE pe.session_id = s.id AND pe.page_path = ?)', page);
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(
      s.visitor_id::text ILIKE $${values.length}
      OR COALESCE(s.utm_campaign, '') ILIKE $${values.length}
      OR COALESCE(s.utm_source, '') ILIKE $${values.length}
      OR COALESCE(s.referrer_domain, '') ILIKE $${values.length}
    )`);
  }
  return { where: conditions.join(' AND '), values };
};

adminRouter.get('/analytics/overview', requireGlobalAdmin, async (req, res, next) => {
  try {
    await ensureAnalyticsSchema();
    const { where, values } = buildSessionFilter(req.query);
    const [videoStats, summary, trend, pages, sources, campaigns, devices, browsers, events, recent] = await Promise.all([
      db.query([
        'WITH filtered_events AS (',
        '  SELECT e.session_id, e.event_name, e.metadata',
        '    FROM analytics_events e',
        '    JOIN analytics_sessions s ON s.id = e.session_id',
        '   WHERE ' + where,
        "     AND e.event_name IN ('video_impression', 'video_start', 'video_complete', 'video_progress', 'video_pause', 'video_exit')",
        '),',
        'event_totals AS (',
        "  SELECT COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'video_impression')::int AS impressions,",
        "         COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'video_start')::int AS starts,",
        "         COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'video_complete')::int AS completions",
        '    FROM filtered_events',
        '),',
        'watched_by_session AS (',
        '  SELECT session_id,',
        "         MAX(CASE WHEN (metadata->>'watched_seconds') ~ '^[0-9]+([.][0-9]+)?$' THEN (metadata->>'watched_seconds')::numeric ELSE 0 END) AS watched_seconds,",
        "         MAX(CASE WHEN (metadata->>'duration_seconds') ~ '^[0-9]+([.][0-9]+)?$' THEN (metadata->>'duration_seconds')::numeric ELSE 0 END) AS duration_seconds",
        '    FROM filtered_events',
        "   WHERE event_name IN ('video_progress', 'video_pause', 'video_complete', 'video_exit')",
        '   GROUP BY session_id',
        ')',
        'SELECT event_totals.impressions, event_totals.starts, event_totals.completions,',
        '       COALESCE(ROUND(AVG(watched_by_session.watched_seconds)), 0)::int AS avg_watched_seconds,',
        '       COALESCE(ROUND(AVG(CASE WHEN watched_by_session.duration_seconds > 0 THEN LEAST(100, (watched_by_session.watched_seconds / watched_by_session.duration_seconds) * 100) END)), 0)::int AS avg_completion_percent',
        '  FROM event_totals',
        '  LEFT JOIN watched_by_session ON TRUE',
        ' GROUP BY event_totals.impressions, event_totals.starts, event_totals.completions'
      ].join('\n'), values),
      db.query(`
        SELECT COUNT(*)::int AS sessions,
               COUNT(DISTINCT visitor_id)::int AS visitors,
               COALESCE(ROUND(AVG(duration_seconds)), 0)::int AS avg_duration_seconds,
               COUNT(*) FILTER (WHERE duration_seconds >= 10 OR event_count >= 3)::int AS engaged_sessions,
               COUNT(*) FILTER (WHERE pageview_count <= 1 AND duration_seconds < 10)::int AS bounced_sessions,
               COALESCE(SUM(pageview_count), 0)::int AS pageviews,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'checkout_start'))::int AS checkouts,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'purchase'))::int AS purchases
          FROM analytics_sessions s WHERE ${where}`, values),
      db.query(`
        SELECT TO_CHAR(DATE_TRUNC('day', s.started_at), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS sessions, COUNT(DISTINCT s.visitor_id)::int AS visitors,
               COALESCE(SUM(s.pageview_count), 0)::int AS pageviews
          FROM analytics_sessions s WHERE ${where}
         GROUP BY DATE_TRUNC('day', s.started_at) ORDER BY DATE_TRUNC('day', s.started_at)`, values),
      db.query(`
        SELECT e.page_path AS label, COUNT(*)::int AS value,
               COUNT(DISTINCT e.session_id)::int AS sessions
          FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id
         WHERE ${where} AND e.event_name = 'page_view'
         GROUP BY e.page_path ORDER BY value DESC LIMIT 12`, values),
      db.query(`
        SELECT COALESCE(s.utm_source, s.referrer_domain, 'Direto') AS label,
               COUNT(*)::int AS value, COUNT(DISTINCT s.visitor_id)::int AS visitors,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'purchase'))::int AS purchases
          FROM analytics_sessions s WHERE ${where}
         GROUP BY 1 ORDER BY value DESC LIMIT 12`, values),
      db.query(`
        SELECT COALESCE(s.utm_campaign, 'Sem campanha') AS label,
               COUNT(*)::int AS value,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'checkout_start'))::int AS checkouts,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'purchase'))::int AS purchases
          FROM analytics_sessions s WHERE ${where}
         GROUP BY 1 ORDER BY value DESC LIMIT 12`, values),
      db.query(`SELECT COALESCE(s.device_type, 'Outro') AS label, COUNT(*)::int AS value FROM analytics_sessions s WHERE ${where} GROUP BY 1 ORDER BY value DESC`, values),
      db.query(`SELECT COALESCE(s.browser_name, 'Outro') AS label, COUNT(*)::int AS value FROM analytics_sessions s WHERE ${where} GROUP BY 1 ORDER BY value DESC`, values),
      db.query(`
        SELECT e.event_name AS label, COUNT(*)::int AS value
          FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id
         WHERE ${where} AND e.event_name NOT IN ('heartbeat', 'page_exit')
         GROUP BY e.event_name ORDER BY value DESC LIMIT 16`, values),
      db.query(`
        SELECT s.id, s.visitor_id, s.started_at, s.last_seen_at, s.duration_seconds,
               s.landing_path, s.exit_path, s.referrer_domain, s.utm_source, s.utm_medium,
               s.utm_campaign, s.device_type, s.operating_system, s.browser_name,
               s.language, s.timezone, s.country_code, s.pageview_count, s.event_count,
               s.max_scroll_depth,
               EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'checkout_start') AS checkout_started,
               EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'purchase') AS purchased
          FROM analytics_sessions s WHERE ${where}
         ORDER BY s.started_at DESC LIMIT 100`, values)
    ]);
    const row = summary.rows[0] || {};
    const sessions = Number(row.sessions || 0);
    res.json({
      summary: {
        sessions,
        visitors: Number(row.visitors || 0),
        pageviews: Number(row.pageviews || 0),
        avgDurationSeconds: Number(row.avg_duration_seconds || 0),
        engagedSessions: Number(row.engaged_sessions || 0),
        engagementRate: sessions ? Math.round((Number(row.engaged_sessions || 0) / sessions) * 1000) / 10 : 0,
        bounceRate: sessions ? Math.round((Number(row.bounced_sessions || 0) / sessions) * 1000) / 10 : 0,
        checkouts: Number(row.checkouts || 0),
        purchases: Number(row.purchases || 0)
      },
      video: {
        impressions: Number(videoStats.rows[0]?.impressions || 0),
        starts: Number(videoStats.rows[0]?.starts || 0),
        completions: Number(videoStats.rows[0]?.completions || 0),
        avgWatchedSeconds: Number(videoStats.rows[0]?.avg_watched_seconds || 0),
        completionRate: Number(videoStats.rows[0]?.starts || 0)
          ? Math.round((Number(videoStats.rows[0]?.completions || 0) / Number(videoStats.rows[0]?.starts || 0)) * 1000) / 10
          : 0,
        avgCompletionPercent: Number(videoStats.rows[0]?.avg_completion_percent || 0)
      },
      trend: trend.rows,
      pages: pages.rows,
      sources: sources.rows,
      campaigns: campaigns.rows,
      devices: devices.rows,
      browsers: browsers.rows,
      events: events.rows,
      recentSessions: recent.rows
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/analytics/sessions/:sessionId', requireGlobalAdmin, async (req, res, next) => {
  try {
    if (!isUuid(req.params.sessionId)) return res.status(400).json({ message: 'Sessao invalida.' });
    await ensureAnalyticsSchema();
    const [session, events] = await Promise.all([
      db.query('SELECT * FROM analytics_sessions WHERE id = $1', [req.params.sessionId]),
      db.query(`
        SELECT id, event_name, occurred_at, page_path, page_title, duration_ms, scroll_depth,
               element_tag, element_id, element_text, element_href, metadata
          FROM analytics_events WHERE session_id = $1 ORDER BY occurred_at`, [req.params.sessionId])
    ]);
    if (!session.rows.length) return res.status(404).json({ message: 'Sessao nao encontrada.' });
    return res.json({ session: session.rows[0], events: events.rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = {
  adminRouter,
  publicRouter,
  ensureAnalyticsSchema,
  recordPurchaseEvent,
  parseClient,
  cleanPagePath,
  normalizeEvent
};
