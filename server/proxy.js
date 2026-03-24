import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const ENCRYPTED_HEX = "1712182c12053c1d4864076527244334121a280b5e7d5a762726170a155c343d64030b5a032b1a301b233a1d420a5c0505333d3c1f3b171d";

function decryptKey(password) {
  if (!password || typeof password !== 'string' || password.length === 0 || password.length > 12) return null;
  let d = "";
  for (let i = 0; i < ENCRYPTED_HEX.length; i += 2) {
    d += String.fromCharCode(parseInt(ENCRYPTED_HEX.substr(i, 2), 16) ^ password.charCodeAt((i / 2) % password.length));
  }
  return d.startsWith("gsk_") ? d : null;
}

const failed = new Map();

app.post('/api/verify', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const rec = failed.get(ip);
  if (rec && rec.count >= 10 && Date.now() - rec.t < 60000) {
    return res.status(429).json({ valid: false, error: 'Too many attempts' });
  }

  const { password } = req.body || {};
  const key = decryptKey(password);

  if (!key) {
    const r = failed.get(ip) || { count: 0, t: 0 };
    r.count++; r.t = Date.now();
    failed.set(ip, r);
    return res.json({ valid: false });
  }

  res.json({ valid: true, key });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[Proxy] Running on http://localhost:${PORT}`));
