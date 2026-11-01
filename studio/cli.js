// Cloud pipeline: plan -> produce -> publish -> analytics. Runs in GitHub Actions (also works locally).
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TMP = path.join(DATA, 'tmp');
const OUT = path.join(ROOT, 'out', 'jobs');
const CI = !!process.env.GITHUB_ACTIONS;

const CFG = {
  tz: 'Asia/Kolkata',
  handle: '@SimpledFinance',
  // 3 short + 3 long = ~9,900 of the 10,000 daily YouTube API quota units
  slots: [
    { time: '09:00', kind: 'short' }, { time: '11:00', kind: 'long' }, { time: '13:00', kind: 'short' },
    { time: '15:00', kind: 'long' }, { time: '17:00', kind: 'short' }, { time: '19:00', kind: 'long' }
  ],
  models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  disclaimer: 'Sirf educational jaankari, financial salah nahi.',
  gl: process.env.GL || (process.platform === 'darwin' ? 'angle' : 'swangle')
};

[DATA, TMP, OUT, path.join(ROOT, 'public', 'jobs')].forEach(d => fs.mkdirSync(d, { recursive: true }));

const file = n => path.join(DATA, n);
const readJson = (n, def) => (fs.existsSync(file(n)) ? JSON.parse(fs.readFileSync(file(n), 'utf8')) : def);
const writeJson = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const load = () => readJson('queue.json', { items: [] });
const save = db => writeJson('queue.json', db);
const patch = (id, fields) => {
  const db = load();
  const it = db.items.find(i => i.id === id);
  if (it) Object.assign(it, fields, { updatedAt: new Date().toISOString() });
  save(db);
  return it;
};

const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: CFG.tz }).format(d);
const tomorrow = () => dayKey(new Date(Date.now() + 24 * 3600 * 1000));

// Commit state back to the repo so progress survives the runner
const persist = msg => {
  if (!CI) return;
  try {
    const sh = c => execSync(c, { cwd: ROOT, stdio: 'pipe' });
    sh('git config user.name "studio-bot"');
    sh('git config user.email "studio-bot@users.noreply.github.com"');
    sh('git add data');
    try { sh('git diff --cached --quiet'); return; } catch (_) { /* has changes */ }
    sh(`git commit -m "${msg}"`);
    sh('git pull --rebase -q');
    sh('git push -q');
  } catch (e) {
    log('persist failed:', String(e.message).slice(0, 200));
  }
};

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, ...opts });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (out += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}: ${out.slice(-700)}`))));
  });

/* ---------- Google ---------- */
const authClient = () => {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) throw new Error('YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN missing');
  const auth = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
  return auth;
};
const youtubeClient = () => google.youtube({ version: 'v3', auth: authClient() });

const gemini = async prompt => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const model of CFG.models) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.8 } })
        });
        if (!res.ok) throw new Error(`${model} HTTP ${res.status}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        return JSON.parse(text.replace(/^```json|```$/g, '').trim());
      } catch (e) {
        lastErr = e;
      }
    }
    await sleep(8000 * (round + 1));
  }
  throw lastErr;
};

/* ---------- Plan ---------- */
const TOPIC_BANK = [
  'Sale ka sticker: asli discount ya marketing jaal?', 'Emergency fund kitna hona chahiye aur kahan rakhein?', 'SIP kya hai: har mahine chhota paisa, bada fayda',
  'Credit card ka minimum due debt trap', 'Inflation aapki bachat ko kaise khaa jaati hai', '50-30-20 budget rule asaan example ke saath',
  'FD vs RD vs SIP: beginner ke liye farq', 'EMI ka asli kharcha: ₹10,000 ka phone kitne ka padta hai', 'Compound interest: 8th wonder ka asli matlab',
  'Credit score kya hai aur kaise sudhaare', 'Lifestyle inflation: salary badhi par bachat nahi', 'Term insurance vs endowment: kya sahi hai',
  'Impulse buying se bachne ke 5 tareeke', 'Salary aate hi paisa kyun khatam ho jata hai', 'Mutual fund aur stock mein basic farq',
  'BNPL (Buy Now Pay Later) ka chhupa jaal', 'Tax bachane ke legal tareeke: 80C ki basic jaankari', 'Paise ki 4 aadatein jo ameer log apnate hain',
  'Insurance ko investment na samjho', 'Pehli salary ka sahi plan', 'Loan lene se pehle 5 sawaal', 'Cashback offers ka psychology'
];

// search.list costs 100 quota units, so trends are cached for 7 days
const research = async () => {
  const cache = readJson('trends.json', null);
  if (cache && Date.now() - new Date(cache.fetchedAt).getTime() < 7 * 24 * 3600 * 1000) return cache.titles;
  try {
    const yt = youtubeClient();
    const after = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const res = await yt.search.list({ part: 'snippet', q: 'personal finance tips hindi', type: 'video', order: 'viewCount', publishedAfter: after, maxResults: 20, regionCode: 'IN', relevanceLanguage: 'hi' });
    const titles = (res.data.items || []).map(i => i.snippet.title).slice(0, 20);
    if (titles.length) {
      writeJson('trends.json', { fetchedAt: new Date().toISOString(), titles });
      return titles;
    }
  } catch (e) {
    log('research failed:', e.message);
  }
  return cache?.titles || [];
};

const planDay = async (date = tomorrow()) => {
  const db = load();
  if (db.items.some(i => i.date === date && i.status !== 'removed')) return log('plan exists for', date);
  const used = new Set(db.items.map(i => i.topic));
  const trending = await research();
  let topics = [];
  try {
    const out = await gemini(`Tum ek Indian personal-finance YouTube channel ke content planner ho. Neeche trending finance videos ke titles hain (sirf trend samajhne ke liye, copy mat karna):\n${trending.join('\n') || '(none)'}\n\nIn trends se inspire hokar ${CFG.slots.length} ORIGINAL aur alag-alag topics suggest karo, beginner ke liye, Hinglish (Roman) mein, 8-14 words. Purane topics repeat mat karo: ${[...used].slice(-30).join(' | ')}.\nSirf JSON array of strings do.`);
    topics = (Array.isArray(out) ? out : out.topics || []).map(String).filter(t => t && !used.has(t)).slice(0, CFG.slots.length);
  } catch (e) {
    log('topic AI failed, using bank:', e.message);
  }
  const bank = TOPIC_BANK.filter(t => !used.has(t) && !topics.includes(t));
  while (topics.length < CFG.slots.length) topics.push(bank.shift() || `Paise ki baat ${date} #${topics.length + 1}`);
  const fresh = load();
  CFG.slots.forEach((slot, i) => {
    fresh.items.push({ id: `${date}-${i + 1}`, date, slot: slot.time, kind: slot.kind, topic: topics[i], status: 'planned', source: trending.length ? 'youtube-trends' : 'topic-bank', createdAt: new Date().toISOString() });
  });
  save(fresh);
  log('planned', date, topics.length, 'videos');
  persist(`plan ${date}`);
};

/* ---------- Script ---------- */
const TONES = ['gold', 'red', 'green'];
const TYPES = ['talk', 'coins', 'compare', 'list', 'outro'];
const MOODS = ['happy', 'worried', 'shock'];
const clampSize = (v, d) => Math.max(1, Math.min(26, +v || d));

const writeScript = async item => {
  const long = item.kind === 'long';
  const count = long ? 9 : 5;
  const words = long ? '45-60' : '28-40';
  const out = await gemini(`Tum ek Indian finance educator ho. Topic: "${item.topic}". Is par ORIGINAL ${long ? 'lambi (3-4 minute)' : 'short (45-60 second)'} video script likho, 3D cartoon characters ke liye. Rahul (young, curious) aur Dadaji (samajhdaar buzurg) hain. Kisi aur creator ki script copy mat karna. Investment advice mat do, sirf educational, example ke daam kalpanik.

Exactly ${count} scenes ka JSON do:
{"title":"<Hinglish title max 70 chars, curiosity wala>","description":"<2-3 line Hinglish description>","tags":["5-8 tags"],"thumb_text":"<maximum 3 shabd Devanagari, bahut chhota hook>","thumb_mood":"happy|worried|shock","scenes":[ {...} ]}

Har scene:
{"type":"talk|coins|compare|list|outro","speaker":"rahul|dada","mood":"happy|worried|shock","headline":"<Devanagari, max 6 shabd>","narration":"<Devanagari Hindi, ${words} shabd, bolchaal wali, numbers ko shabdon mein likho jaise 'पचास हज़ार रुपये'>","size":<1-26 coin tower, sirf coins>,"tone":"gold|red|green","label":"<chhota label sirf coins>","a":{"label":"","size":1-26,"tone":""},"b":{"label":"","size":1-26,"tone":""},"items":["<3-4 chhote points sirf list>"]}

Rules: scene 1 type talk (strong hook, sawaal ya chauka dene wali baat). Beech mein coins/compare/list mix karo. Aakhri scene type outro: summary + comment mein sawaal poochna + SimpledFinance ko follow karne ko kehna. Compare mein a aur b zaroor do, list mein items zaroor do.`);
  const raw = (out.scenes || []).slice(0, count + 2);
  const scenes = raw.map((s, i) => {
    const sc = {
      type: TYPES.includes(s.type) ? s.type : 'talk',
      speaker: s.speaker === 'dada' ? 'dada' : 'rahul',
      mood: MOODS.includes(s.mood) ? s.mood : 'happy',
      headline: String(s.headline || item.topic).slice(0, 70),
      narration: String(s.narration || '').trim()
    };
    if (sc.type === 'coins') Object.assign(sc, { size: clampSize(s.size, 12), tone: TONES.includes(s.tone) ? s.tone : 'gold', label: String(s.label || '').slice(0, 24) });
    if (sc.type === 'compare') {
      if (s.a && s.b) {
        sc.a = { label: String(s.a.label || '').slice(0, 24), size: clampSize(s.a.size, 8), tone: TONES.includes(s.a.tone) ? s.a.tone : 'green' };
        sc.b = { label: String(s.b.label || '').slice(0, 24), size: clampSize(s.b.size, 16), tone: TONES.includes(s.b.tone) ? s.b.tone : 'red' };
      } else sc.type = 'talk';
    }
    if (sc.type === 'list') {
      if (Array.isArray(s.items) && s.items.length) sc.items = s.items.map(String).slice(0, 4);
      else sc.type = 'talk';
    }
    if (i === raw.length - 1 && sc.type !== 'outro') sc.type = 'outro';
    return sc;
  }).filter(s => s.narration.length > 10);
  if (scenes.length < 3) throw new Error('script too short');
  return {
    title: String(out.title || item.topic).slice(0, 95),
    description: String(out.description || ''),
    tags: (out.tags || []).map(String).slice(0, 10),
    thumbText: String(out.thumb_text || 'ध्यान दो!').split(/\s+/).slice(0, 3).join(' '),
    thumbMood: MOODS.includes(out.thumb_mood) ? out.thumb_mood : 'shock',
    scenes
  };
};

/* ---------- Voice ---------- */
const VOICE = { rahul: ['+18%', '+8Hz'], dada: ['+8%', '-18Hz'] };
const duration = async f => {
  const out = await run(process.env.FFMPEG || 'ffmpeg', ['-i', f]).catch(e => e.message);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 5;
};
const voice = async (item, script) => {
  const dir = path.join(ROOT, 'public', 'jobs', item.id);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < script.scenes.length; i++) {
    const s = script.scenes[i];
    const mp3 = path.join(dir, `s${i + 1}.mp3`);
    const txt = path.join(dir, `s${i + 1}.txt`);
    const [rate, pitch] = VOICE[s.speaker];
    fs.writeFileSync(txt, s.narration, 'utf8');
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await run('python3', ['-m', 'edge_tts', '--file', txt, '--voice', 'hi-IN-MadhurNeural', `--rate=${rate}`, `--pitch=${pitch}`, '--write-media', mp3]);
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(4000);
      }
    }
    s.audio = `jobs/${item.id}/s${i + 1}.mp3`;
    s.seconds = Math.round((await duration(mp3)) * 100) / 100;
  }
};

/* ---------- Produce ---------- */
const produce = async item => {
  patch(item.id, { status: 'producing', error: null });
  try {
    const script = await writeScript(item);
    await voice(item, script);
    const props = { orientation: item.kind === 'long' ? 'landscape' : 'portrait', handle: CFG.handle, disclaimer: CFG.disclaimer, scenes: script.scenes };
    const propsFile = path.join(TMP, `${item.id}.props.json`);
    fs.writeFileSync(propsFile, JSON.stringify(props));
    const video = path.join(OUT, `${item.id}.mp4`);
    await run('npx', ['remotion', 'render', 'src/index.ts', 'Story', video, `--props=${propsFile}`, `--gl=${CFG.gl}`]);
    const thumb = path.join(OUT, `${item.id}.jpg`);
    const thumbProps = path.join(TMP, `${item.id}.thumb.json`);
    fs.writeFileSync(thumbProps, JSON.stringify({ text: script.thumbText, sub: 'SimpledFinance', mood: script.thumbMood }));
    await run('npx', ['remotion', 'still', 'src/index.ts', 'Thumb', thumb, `--props=${thumbProps}`, `--gl=${CFG.gl}`, '--image-format=jpeg']);
    patch(item.id, { status: 'ready', video, thumb, title: script.title, description: script.description, tags: script.tags, producedAt: new Date().toISOString() });
    log('produced', item.id, script.title);
  } catch (e) {
    patch(item.id, { status: 'failed', error: e.message.slice(0, 500) });
    log('produce failed', item.id, e.message.slice(0, 300));
  }
};

/* ---------- Publish ---------- */
const publishAtIso = item => {
  const when = new Date(`${item.date}T${item.slot}:00+05:30`);
  return when.getTime() > Date.now() + 5 * 60 * 1000 ? when.toISOString() : null;
};

const publishOne = async item => {
  const yt = youtubeClient();
  const publishAt = publishAtIso(item);
  const short = item.kind === 'short';
  const title = (short && !/#shorts/i.test(item.title) ? `${item.title.slice(0, 85)} #shorts` : item.title).slice(0, 100);
  const description = `${item.description}\n\n${CFG.disclaimer}\n\nFollow ${CFG.handle}\n\n${short ? '#shorts ' : ''}#personalfinance #money #hindi`.slice(0, 4900);
  const res = await yt.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: { title, description, tags: item.tags || [], categoryId: '27', defaultLanguage: 'hi' },
      status: { privacyStatus: publishAt ? 'private' : 'public', ...(publishAt ? { publishAt } : {}), selfDeclaredMadeForKids: false, containsSyntheticMedia: true }
    },
    media: { body: fs.createReadStream(item.video) }
  });
  const videoId = res.data.id;
  try {
    await yt.thumbnails.set({ videoId, media: { mimeType: 'image/jpeg', body: fs.createReadStream(item.thumb) } });
  } catch (e) {
    log('thumbnail failed', item.id, e.message);
  }
  patch(item.id, { status: publishAt ? 'scheduled' : 'published', videoId, url: `https://youtube.com/${short ? 'shorts/' : 'watch?v='}${videoId}`, publishAt, publishedAt: new Date().toISOString() });
  log('uploaded', item.id, videoId, publishAt || 'public now');
};

// Videos produced earlier but not uploaded yet (e.g. quota hit) are retried here
const publishReady = async () => {
  for (const item of load().items.filter(i => i.status === 'ready' && i.video && fs.existsSync(i.video))) {
    try {
      await publishOne(item);
      persist(`publish ${item.id}`);
    } catch (e) {
      const quota = /quota|exceeded|rateLimit/i.test(e.message);
      patch(item.id, { status: 'ready', error: e.message.slice(0, 400) });
      log('publish failed', item.id, e.message.slice(0, 200));
      if (quota) break;
    }
  }
};

const produceAll = async (date = dayKey()) => {
  for (;;) {
    const next = load().items.find(i => i.date <= date && ['planned', 'failed'].includes(i.status) && (i.tries || 0) < 3);
    if (!next) break;
    patch(next.id, { tries: (next.tries || 0) + 1 });
    await produce(next);
    persist(`produce ${next.id}`);
    await publishReady();
  }
};

// Items stuck in 'producing' from a killed runner go back to the queue
const recover = () => {
  const db = load();
  db.items.forEach(i => {
    if (i.status === 'producing') i.status = 'planned';
    if (i.status === 'ready' && !(i.video && fs.existsSync(i.video))) i.status = 'planned';
  });
  save(db);
};

/* ---------- Analytics ---------- */
const sumRows = (rows, i) => (rows || []).reduce((s, r) => s + (+r[i] || 0), 0);
const isoDate = d => d.toISOString().slice(0, 10);
const daysAgo = n => isoDate(new Date(Date.now() - n * 24 * 3600 * 1000));

const collectAnalytics = async () => {
  const auth = authClient();
  const yt = google.youtube({ version: 'v3', auth });
  const ya = google.youtubeAnalytics({ version: 'v2', auth });
  const errors = [];
  const safe = async (label, fn, def) => {
    try { return await fn(); } catch (e) { errors.push(`${label}: ${String(e.message).slice(0, 160)}`); return def; }
  };

  const ch = (await yt.channels.list({ part: 'snippet,statistics,contentDetails', mine: true })).data.items[0];
  const stats = ch.statistics;
  const uploads = ch.contentDetails.relatedPlaylists.uploads;

  const ids = [];
  let pageToken;
  do {
    const r = await yt.playlistItems.list({ part: 'contentDetails', playlistId: uploads, maxResults: 50, pageToken });
    r.data.items.forEach(i => ids.push(i.contentDetails.videoId));
    pageToken = r.data.nextPageToken;
  } while (pageToken && ids.length < 500);

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt.videos.list({ part: 'snippet,statistics,contentDetails,status', id: ids.slice(i, i + 50).join(',') });
    r.data.items.forEach(v => {
      const dur = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails.duration) || [];
      const seconds = (+dur[1] || 0) * 60 + (+dur[2] || 0);
      videos.push({
        id: v.id, title: v.snippet.title, publishedAt: v.snippet.publishedAt, privacy: v.status.privacyStatus, scheduledFor: v.status.publishAt || null,
        views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0,
        seconds, type: seconds <= 180 ? 'short' : 'long'
      });
    });
  }

  const dailyRep = await safe('daily', async () => (await ya.reports.query({ ids: 'channel==MINE', startDate: daysAgo(89), endDate: daysAgo(0), metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', dimensions: 'day', sort: 'day' })).data.rows || [], []);
  const yearRep = await safe('year', async () => (await ya.reports.query({ ids: 'channel==MINE', startDate: daysAgo(364), endDate: daysAgo(0), metrics: 'views,estimatedMinutesWatched,subscribersGained' })).data.rows || [], []);
  const typeRep = await safe('contentType', async () => (await ya.reports.query({ ids: 'channel==MINE', startDate: daysAgo(89), endDate: daysAgo(0), metrics: 'views,estimatedMinutesWatched', dimensions: 'creatorContentType' })).data.rows || [], []);
  const perVideo = await safe('perVideo', async () => (await ya.reports.query({ ids: 'channel==MINE', startDate: '2020-01-01', endDate: daysAgo(0), metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained', dimensions: 'video', sort: '-views', maxResults: 200 })).data.rows || [], []);
  const pv = new Map(perVideo.map(r => [r[0], r]));
  videos.forEach(v => {
    const r = pv.get(v.id);
    v.watchMinutes = r ? Math.round(+r[2]) : null;
    v.avgViewSeconds = r ? Math.round(+r[3]) : null;
    v.avgViewPercent = r ? Math.round(+r[4] * 10) / 10 : null;
    v.subsGained = r ? +r[5] : null;
  });
  videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const subs = +stats.subscriberCount || 0;
  const totalViews = +stats.viewCount || 0;
  const hours365 = Math.round(sumRows(yearRep, 1) / 60 * 10) / 10;
  const shortsRow = typeRep.find(r => String(r[0]).toUpperCase().startsWith('SHORT'));
  const shorts90 = shortsRow ? +shortsRow[1] : 0;
  const publicUploads90 = videos.filter(v => v.privacy === 'public' && Date.now() - new Date(v.publishedAt).getTime() < 90 * 24 * 3600 * 1000).length;

  // Today's views come from our own snapshots because the Analytics API lags 1-2 days
  const today = dayKey();
  const history = readJson('history.json', []);
  history.push({ ts: new Date().toISOString(), date: today, views: totalViews, subs, videos: +stats.videoCount || videos.length });
  const before = [...history].reverse().find(h => h.date < today);
  const firstToday = history.find(h => h.date === today);
  const base = before || firstToday;
  const viewsToday = base ? Math.max(0, totalViews - base.views) : 0;
  const subsToday = base ? subs - base.subs : 0;
  writeJson('history.json', history.slice(-1500));

  const pct = (cur, goal) => Math.min(100, Math.round((cur / goal) * 1000) / 10);
  const monetization = {
    tiers: [
      {
        name: 'YPP Tier 1 (fan funding, memberships)',
        requirements: [
          { label: 'Subscribers', current: subs, goal: 500, percent: pct(subs, 500) },
          { label: 'Public uploads (90 days)', current: publicUploads90, goal: 3, percent: pct(publicUploads90, 3) },
          { label: 'Watch hours (365 days) YA Shorts views (90 days)', current: `${hours365} h / ${shorts90.toLocaleString('en-IN')} views`, goal: '3,000 h ya 30 lakh Shorts views', percent: Math.max(pct(hours365, 3000), pct(shorts90, 3000000)) }
        ]
      },
      {
        name: 'YPP Tier 2 (ads revenue)',
        requirements: [
          { label: 'Subscribers', current: subs, goal: 1000, percent: pct(subs, 1000) },
          { label: 'Watch hours (365 days) YA Shorts views (90 days)', current: `${hours365} h / ${shorts90.toLocaleString('en-IN')} views`, goal: '4,000 h ya 1 crore Shorts views', percent: Math.max(pct(hours365, 4000), pct(shorts90, 10000000)) }
        ]
      }
    ],
    manual: [
      'Google AdSense account bana ke channel se link karo (YPP unlock hone par)',
      '2-Step Verification ON hona chahiye',
      'Koi active Community Guidelines strike nahi honi chahiye',
      'Reused / mass-produced content policy: har video ki script alag aur original rakho (template jaisi videos par demonetization ho sakta hai)'
    ]
  };

  const out = {
    updatedAt: new Date().toISOString(),
    channel: { title: ch.snippet.title, subscribers: subs, subscribersHidden: !!stats.hiddenSubscriberCount, totalViews, videoCount: +stats.videoCount || videos.length },
    today: { views: viewsToday, subscribers: subsToday },
    totals: { hours365, shorts90, publicUploads90, views365: sumRows(yearRep, 0), views90: sumRows(dailyRep, 0), subsGained365: sumRows(yearRep, 2) },
    daily: dailyRep.map(r => ({ date: r[0], views: +r[1], minutes: +r[2], subs: +r[3] - +r[4] })),
    videos,
    monetization,
    errors
  };
  writeJson('analytics.json', out);
  log('analytics updated', totalViews, 'views', subs, 'subs', videos.length, 'videos', errors.length ? `(${errors.length} api warnings)` : '');
};

/* ---------- Entry ---------- */
const main = async () => {
  const [cmd, arg] = process.argv.slice(2);
  recover();
  if (cmd === 'plan') await planDay(arg || tomorrow());
  else if (cmd === 'tick') {
    // retries any pending production/uploads, then refreshes analytics
    await produceAll(arg || dayKey());
    await publishReady();
  } else if (cmd !== 'analytics') throw new Error('usage: cli.js plan|tick|analytics [date]');
  await collectAnalytics().catch(e => log('analytics failed:', e.message));
  persist(`${cmd} update`);
};

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
