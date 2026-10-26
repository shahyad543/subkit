/* SubKit — shared subtitle engine. All processing is client-side. */

const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
Hello and welcome to the video...

2
00:00:03,500 --> 00:00:06,000
[door slams]
♪ upbeat music ♪

3
00:00:06,000 --> 00:00:09,000
Today we'll talk about subtitles.

4
00:00:09,000 --> 00:00:09,000

5
00:00:09,000 --> 00:00:11,500
Today we'll talk about subtitles.

6
00:00:11,500 --> 00:00:14,000
Really?!!   Let's get started...`;

/* ---------- parsing ---------- */

function detectFormat(text) {
  const t = text.trim();
  if (/^WEBVTT/i.test(t)) return 'vtt';
  if (/^\s*\[Script Info\]/im.test(t) || /^\s*Dialogue:/im.test(t)) return 'ass';
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(t)) return 'srt';
  return null;
}

function parseTimeToken(token) {
  // Accepts h:mm:ss,mmm | h:mm:ss.mmm | mm:ss.mmm
  const m = token.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return NaN;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, '0'), 10);
  return ((h * 60 + min) * 60 + sec) * 1000 + ms;
}

function parseSubtitles(text) {
  const kind = detectFormat(text);
  if (kind === 'ass') return parseASS(text);
  if (kind === 'vtt') return parseVTT(text);
  if (kind === 'srt') return parseSRT(text);
  return parseSRT(text); // last-ditch: SRT-style cue scan
}

function parseSRT(text) {
  const cues = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;
    const timeIdx = lines.findIndex(l => l.includes('-->'));
    if (timeIdx === -1) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = parseTimeToken(a);
    const end = parseTimeToken(b.split(/\s+/)[0] || '');
    if (isNaN(start) || isNaN(end)) continue;
    const body = lines.slice(timeIdx + 1).join('\n').trim();
    cues.push({ start, end, text: body });
  }
  return cues;
}

function parseVTT(text) {
  // VTT is SRT-shaped without index lines and with a WEBVTT header.
  const cleaned = text.replace(/^WEBVTT[^\n]*\n?/i, '')
                      .replace(/^NOTE\n(?:[^\n]*\n)*\n?/gmi, '');
  return parseSRT(cleaned);
}

function parseASS(text) {
  const cues = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fields = null;
  let inEvents = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Events\]/i.test(trimmed)) { inEvents = true; continue; }
    if (/^\[/.test(trimmed) && !/^\[Events\]/i.test(trimmed)) { inEvents = false; continue; }
    if (!inEvents) continue;
    const formatMatch = trimmed.match(/^Format:\s*(.+)$/i);
    if (formatMatch) {
      fields = formatMatch[1].split(',').map(f => f.trim().toLowerCase());
      continue;
    }
    const dialogue = trimmed.match(/^Dialogue:\s*(.*)$/i);
    if (dialogue && fields) {
      // The text field may itself contain commas — split only up to it.
      const textIdx = fields.indexOf('text');
      const parts = dialogue[1].split(',');
      const values = parts.slice(0, textIdx).concat(parts.slice(textIdx).join(','));
      const get = name => { const i = fields.indexOf(name); return i === -1 ? '' : (values[i] || ''); };
      const start = parseTimeToken(get('start'));
      const end = parseTimeToken(get('end'));
      if (isNaN(start) || isNaN(end)) continue;
      const body = get('text')
        .replace(/\{[^}]*\}/g, '')      // strip override tags {\b1} etc.
        .replace(/\\N/gi, '\n')
        .trim();
      cues.push({ start, end, text: body });
    }
  }
  return cues;
}

/* ---------- serialization ---------- */

function msToSRT(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60,
        s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}

function msToVTT(ms) { return msToSRT(ms).replace(',', '.'); }

function msToASSTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60,
        s = Math.floor(ms / 1000) % 60, cs = Math.round((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(cs, 99)).padStart(2, '0')}`;
}

function toSRT(cues) {
  return cues.map((c, i) =>
    `${i + 1}\n${msToSRT(c.start)} --> ${msToSRT(c.end)}\n${c.text}`
  ).join('\n\n') + '\n';
}

function toVTT(cues) {
  return 'WEBVTT\n\n' + cues.map((c, i) =>
    `${i + 1}\n${msToVTT(c.start)} --> ${msToVTT(c.end)}\n${c.text}`
  ).join('\n\n') + '\n';
}

function toASS(cues) {
  const header =
`[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,70,70,65,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const body = cues.map(c =>
    `Dialogue: 0,${msToASSTime(c.start)},${msToASSTime(c.end)},Default,,0,0,0,,` +
    c.text.replace(/\r\n?/g, '\n').replace(/\n/g, '\\N')
  ).join('\n');
  return header + body + '\n';
}

/* ---------- cleaning ---------- */

function cleanCues(cues, opts) {
  let out = cues.map(c => ({ ...c }));

  // Text-level cleaning first.
  for (const c of out) {
    let lines = c.text.split('\n').map(l => l.trim()).filter(l => l !== '');
    if (opts.hi) lines = lines.map(l => l.replace(/[\[\(][^\]\)]*[\]\)]/g, '').trim()).filter(l => l);
    if (opts.notes) lines = lines.map(l => l.replace(/[♪♫♪]+/g, '').replace(/[♪♫]/g, '').trim()).filter(l => l);
    if (opts.dots) lines = lines.map(l => l.replace(/\.{2,}\s*$/, '').trim());
    if (opts.punct) {
      lines = lines.map(l => l
        .replace(/([!?.,])\1{1,}/g, '$1')          // ?!! -> ?!
        .replace(/\s+([,.!?;:])/g, '$1')            // "word ," -> "word,"
        .replace(/([,.!?;:])(?=[A-Za-z])/g, '$1 ')  // "word.Next" -> "word. Next"
        .replace(/ {2,}/g, ' ')
        .trim());
    }
    c.text = lines.join('\n');
  }

  // Drop empties.
  if (opts.empty) out = out.filter(c => c.text.trim() !== '');

  // Drop consecutive duplicates (same text, overlapping/adjacent times).
  if (opts.dup) {
    const kept = [];
    for (const c of out) {
      const prev = kept[kept.length - 1];
      if (prev && prev.text.replace(/\s+/g, ' ').toLowerCase() ===
                  c.text.replace(/\s+/g, ' ').toLowerCase() &&
          c.start - prev.end <= 300) {
        prev.end = Math.max(prev.end, c.end); // extend instead of repeat
        continue;
      }
      kept.push(c);
    }
    out = kept;
  }

  // Drop zero-length cues and fix inverted ranges.
  return out.filter(c => c.end > c.start);
}

/* ---------- UI helpers ---------- */

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function downloadText(filename, content) {
  if (!content.trim()) { setStatus('Nothing to download yet.', true); return; }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyOutput(id) {
  const text = document.getElementById(id).value;
  if (!text.trim()) { setStatus('Nothing to copy yet.', true); return; }
  navigator.clipboard.writeText(text)
    .then(() => setStatus('Copied to clipboard.'))
    .catch(() => setStatus('Copy failed — select the text manually.', true));
}

function setupFileDrop(inputId, textareaId, after) {
  const input = document.getElementById(inputId);
  const area = document.getElementById(textareaId);
  if (!input || !area) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      area.value = reader.result;
      if (after) after();
      setStatus(`Loaded ${file.name} (${(file.size / 1024).toFixed(1)} KB).`);
    };
    reader.readAsText(file, 'utf-8');
  });
}