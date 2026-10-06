import React, { useCallback, useEffect, useState } from 'react';

// Read-only Google Calendar view: today's events on the left, details of the
// clicked event on the right. Auth is Google Identity Services (OAuth token
// flow, no backend); the client ID comes from REACT_APP_GOOGLE_CLIENT_ID.

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'pipboy:gcal-token';

type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { displayName?: string; email?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  hangoutLink?: string;
};

type StoredToken = { token: string; expiresAt: number };

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void };
type GoogleWindow = Window & {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: {
          client_id: string;
          scope: string;
          callback: (resp: TokenResponse) => void;
          error_callback?: (err: { type: string }) => void;
        }) => TokenClient;
        revoke: (token: string, done?: () => void) => void;
      };
    };
  };
};

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as GoogleWindow).google?.accounts) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src: GIS_SRC, async: true });
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load Google sign-in script')));
    if (!existing) document.head.appendChild(script);
  });
}

function readStoredToken(): StoredToken | null {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    return parsed.expiresAt > Date.now() + 30_000 ? parsed : null;
  } catch {
    return null;
  }
}

function storeToken(token: StoredToken | null) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable — user just has to sign in again after reload
  }
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

const isAllDay = (e: CalendarEvent) => !e.start?.dateTime;

function timeRange(e: CalendarEvent): string {
  if (isAllDay(e)) return 'ALL DAY';
  const start = timeFmt.format(new Date(e.start!.dateTime!));
  const end = e.end?.dateTime ? timeFmt.format(new Date(e.end.dateTime)) : '';
  return end ? `${start} – ${end}` : start;
}

// Calendar descriptions can contain HTML; show it as plain text, never inject it.
function descriptionText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (doc.body.textContent ?? '').trim();
}

function DataTab() {
  const [token, setToken] = useState<StoredToken | null>(readStoredToken);
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    if (token) (window as GoogleWindow).google?.accounts.oauth2.revoke(token.token);
    storeToken(null);
    setToken(null);
    setEvents([]);
    setSelectedId(null);
  }, [token]);

  const signIn = async () => {
    if (!CLIENT_ID) return;
    setError(null);
    try {
      await loadGis();
      const client = (window as GoogleWindow).google!.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (!resp.access_token) {
            setError(resp.error ? `Sign-in failed: ${resp.error}` : 'Sign-in failed');
            return;
          }
          const next = { token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 };
          storeToken(next);
          setToken(next);
        },
        error_callback: (err) => setError(`Sign-in cancelled (${err.type})`),
      });
      client.requestAccessToken();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  };

  const accessToken = token?.token;

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      timeMin: day.toISOString(),
      timeMax: addDays(day, 1).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });

    setLoading(true);
    setError(null);
    fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          storeToken(null);
          setToken(null);
          throw new Error('Session expired — sign in again');
        }
        if (!res.ok) throw new Error(`Calendar request failed (${res.status})`);
        return res.json() as Promise<{ items?: CalendarEvent[] }>;
      })
      .then((data) => {
        const items = (data.items ?? []).filter((e) => e.status !== 'cancelled');
        setEvents(items);
        setSelectedId((prev) => (items.some((e) => e.id === prev) ? prev : null));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [accessToken, day]);

  if (!CLIENT_ID) {
    return (
      <div className="pipboy-placeholder">
        <div className="pipboy-placeholder__label">DATA</div>
        <div className="pipboy-placeholder__status">SET REACT_APP_GOOGLE_CLIENT_ID IN .env.local</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="pipboy-placeholder">
        <div className="pipboy-placeholder__label">DATA</div>
        <button type="button" className="inv-btn" onClick={signIn}>Connect Google Calendar</button>
        {error && <div className="data-error">{error}</div>}
      </div>
    );
  }

  const selected = events.find((e) => e.id === selectedId) ?? null;
  const isToday = day.getTime() === startOfDay(new Date()).getTime();

  return (
    <div className="data-layout">
      <section className="inv-panel data-list" aria-label="Events">
        <header className="inv-panel__header">
          <button type="button" className="inv-btn inv-btn--small" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>◀</button>
          <button type="button" className="data-day" onClick={() => setDay(startOfDay(new Date()))} title="Jump to today">
            {isToday ? 'TODAY · ' : ''}{dayFmt.format(day)}
          </button>
          <button type="button" className="inv-btn inv-btn--small" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>▶</button>
        </header>
        <ul className="inv-items">
          {error && <li className="data-error">{error}</li>}
          {!error && loading && events.length === 0 && <li className="inv-empty">LOADING…</li>}
          {!error && !loading && events.length === 0 && <li className="inv-empty">NO EVENTS</li>}
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`data-event ${e.id === selectedId ? 'data-event--active' : ''}`}
                aria-pressed={e.id === selectedId}
                onClick={() => setSelectedId(e.id)}
              >
                <span className="data-event__time">{timeRange(e)}</span>
                <span className="data-event__title">{e.summary || '(no title)'}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="data-footer">
          <button type="button" className="inv-btn inv-btn--small" onClick={signOut}>Disconnect</button>
        </div>
      </section>

      <section className="inv-panel data-details" aria-label="Event details">
        <header className="inv-panel__header"><span>DETAILS</span></header>
        {!selected ? (
          <div className="inv-empty">SELECT AN EVENT</div>
        ) : (
          <div className="data-details__body">
            <h2 className="data-details__title">{selected.summary || '(no title)'}</h2>
            <dl className="data-details__fields">
              <dt>When</dt>
              <dd>{timeRange(selected)}</dd>
              {selected.location && (<><dt>Where</dt><dd>{selected.location}</dd></>)}
              {selected.organizer && (selected.organizer.displayName || selected.organizer.email) && (
                <><dt>Organizer</dt><dd>{selected.organizer.displayName || selected.organizer.email}</dd></>
              )}
              {selected.attendees && selected.attendees.length > 0 && (
                <>
                  <dt>Guests</dt>
                  <dd>
                    {selected.attendees.map((a, i) => (
                      <div key={a.email ?? i}>{a.displayName || a.email}{a.responseStatus ? ` (${a.responseStatus})` : ''}</div>
                    ))}
                  </dd>
                </>
              )}
              {selected.description && (<><dt>Notes</dt><dd className="data-details__notes">{descriptionText(selected.description)}</dd></>)}
              {(selected.hangoutLink || selected.htmlLink) && (
                <>
                  <dt>Links</dt>
                  <dd>
                    {selected.hangoutLink && <div><a href={selected.hangoutLink} target="_blank" rel="noreferrer">Join meeting</a></div>}
                    {selected.htmlLink && <div><a href={selected.htmlLink} target="_blank" rel="noreferrer">Open in Google Calendar</a></div>}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}

export { DataTab };
