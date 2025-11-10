import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import axios from 'axios';
import FormData from 'form-data';
import mongoose from 'mongoose';
import Web3 from 'web3';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// CORS cấu hình theo biến môi trường (mặc định cho phép tất cả)
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  const origins = corsOrigin.split(',').map(s => s.trim());
  app.use(cors({ origin: origins, credentials: true }));
} else {
  app.use(cors());
}
app.use(express.json());

// MongoDB
const mongoUri = process.env.MONGODB_URI;
if (mongoUri) {
  mongoose.connect(mongoUri).then(()=>console.log('Mongo connected')).catch(err=>console.error('Mongo error', err));
}

// Web3
let web3, contract;
try {
  const rpcUrl = process.env.RPC_URL;
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (rpcUrl && contractAddress) {
    web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
    // Resolve ABI relative to repo root: ../fe/src/assets/CertificateNFT.json
    const abiPath = path.resolve(process.cwd(), '..', 'fe', 'src', 'assets', 'CertificateNFT.json');
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    contract = new web3.eth.Contract(abi, contractAddress);
  }
} catch (e) { console.error('Web3 init error', e); }

// Schemas
const StudentSchema = new mongoose.Schema({ address: { type: String, index: true }, name: String, email: String, course: String, createdAt: { type: Date, default: Date.now } });
const CertificateSchema = new mongoose.Schema({ tokenId: { type: String, index: true }, recipient: { type: String, index: true }, tokenURI: String, contentHash: String, txHash: String, course: String, score: String, issuedDate: String, createdAt: { type: Date, default: Date.now } });
const UserSchema = new mongoose.Schema({ address: { type: String, unique: true, index: true }, username: String, email: String, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
UserSchema.pre('save', function(next){ this.updatedAt = new Date(); next(); });
const Student = mongoose.models.Student || mongoose.model('Student', StudentSchema);
const Certificate = mongoose.models.Certificate || mongoose.model('Certificate', CertificateSchema);
const User = mongoose.models.User || mongoose.model('User', UserSchema);

app.get('/api/health', (req, res) => res.json({ ok: true, mongo: !!mongoose.connection.readyState, web3: !!web3, contract: !!contract }));

// Users (profile)
app.get('/api/users/:address', async (req, res) => {
  try {
    const address = String(req.params.address||'').toLowerCase();
    if (!address) return res.status(400).json({ error: 'address required' });
    const u = await User.findOne({ address });
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ address: u.address, username: u.username||'', email: u.email||'', createdAt: u.createdAt, updatedAt: u.updatedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const body = req.body||{};
    const address = String(body.address||'').toLowerCase();
    if (!address) return res.status(400).json({ error: 'address required' });
    const username = String(body.username||'').trim();
    const email = String(body.email||'').trim();
    const update = { address, username, email, updatedAt: new Date() };
    const u = await User.findOneAndUpdate({ address }, update, { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json({ address: u.address, username: u.username||'', email: u.email||'', createdAt: u.createdAt, updatedAt: u.updatedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List users (admin helper)
app.get('/api/users', async (req, res) => {
  try {
    const { q = '', skip = 0, limit = 50, sort = 'newest' } = req.query;
    const query = {};
    if (q) {
      const rx = new RegExp(String(q), 'i');
      query.$or = [ { address: rx }, { username: rx }, { email: rx } ];
    }
    const sortObj = (String(sort).toLowerCase() === 'oldest') ? { createdAt: 1 } : { createdAt: -1 };
    const list = await User.find(query).sort(sortObj).skip(Number(skip)).limit(Math.min(Number(limit), 200));
    const total = await User.countDocuments(query);
    res.json({ total, items: list.map(u => ({ address: u.address, username: u.username||'', email: u.email||'', createdAt: u.createdAt, updatedAt: u.updatedAt })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Simple admin middleware using shared secret header
function requireAdmin(req, res, next) {
  try {
    const sec = process.env.ADMIN_SECRET;
    if (!sec) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
    const hdr = req.header('X-Admin-Secret');
    if (!hdr || hdr !== sec) return res.status(403).json({ error: 'forbidden' });
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Delete user by address (admin helper)
app.delete('/api/users/:address', requireAdmin, async (req, res) => {
  try {
    const address = String(req.params.address||'').toLowerCase();
    if (!address) return res.status(400).json({ error: 'address required' });
    await User.deleteOne({ address });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ipfs/upload', upload.fields([{ name: 'metadata', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const provider = (req.body.provider || 'pinata').toLowerCase();
    const metaFile = req.files?.metadata?.[0];
    const imgFile = req.files?.image?.[0];
    if (!metaFile) return res.status(400).json({ error: 'metadata file required' });

    let parsed;
    try {
      parsed = JSON.parse(metaFile.buffer.toString('utf8'));
    } catch (e) {
      return res.status(400).json({ error: 'invalid JSON metadata' });
    }

    const nameJson = (metaFile.originalname || 'metadata.json').replace(/[^a-z0-9-_. ]/gi, '_');

    if (provider === 'pinata') {
      const jwt = process.env.PINATA_JWT;
      if (!jwt) return res.status(500).json({ error: 'server missing PINATA_JWT' });

      try {
        // Step 1: upload image (if provided) to get absolute ipfs://imageCID
        let imageCid = null;
        if (imgFile) {
          const formImg = new FormData();
          const imgName = imgFile.originalname || 'image';
          formImg.append('file', imgFile.buffer, { filename: imgName });
          formImg.append('pinataMetadata', JSON.stringify({ name: imgName }));
          formImg.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
          const upImg = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formImg, {
            headers: { Authorization: `Bearer ${jwt}`, ...formImg.getHeaders() },
            maxBodyLength: Infinity,
          });
          imageCid = upImg.data?.IpfsHash;
          if (!imageCid) return res.status(502).json({ error: 'pinata image upload failed' });
        }

        // Step 2: upload metadata (pin JSON). If image uploaded, set absolute ipfs:// for meta.image
        let metaObj = parsed;
        if (imageCid) metaObj = { ...parsed, image: `ipfs://${imageCid}` };
        const body = {
          pinataContent: metaObj,
          pinataMetadata: { name: nameJson.replace(/\.json$/i, '') },
          pinataOptions: { cidVersion: 1 },
        };
        const upMeta = await axios.post('https://api.pinata.cloud/pinning/pinJSONToIPFS', body, {
          headers: { Authorization: `Bearer ${jwt}` },
          maxBodyLength: Infinity,
        });
        const metaCid = upMeta.data?.IpfsHash;
        if (!metaCid) return res.status(502).json({ error: 'pinata metadata upload failed' });
        const uri = `ipfs://${metaCid}`;
        return res.json({ provider: 'pinata', cid: metaCid, uri, name: nameJson });
      } catch (e) {
        const status = e.response?.status || 500;
        const payload = e.response?.data || e.message || 'pinata error';
        return res.status(status).json({ error: payload });
      }
    }

    if (provider === 'nftstorage') {
      const token = process.env.NFT_STORAGE_TOKEN;
      if (!token) return res.status(500).json({ error: 'server missing NFT_STORAGE_TOKEN' });

      const headers = { Authorization: `Bearer ${token}` };
      let imageCid = null;
      if (imgFile) {
        try {
          const imgResp = await axios.post('https://api.nft.storage/upload', imgFile.buffer, {
            headers,
            maxBodyLength: Infinity,
          });
          imageCid = imgResp.data?.value?.cid || imgResp.data?.cid;
          if (!imageCid) return res.status(502).json({ error: 'nft.storage image upload failed' });
        } catch (e) {
          const status = e.response?.status || 500;
          const payload = e.response?.data || e.message || 'nft.storage error';
          return res.status(status).json({ error: payload });
        }
      }

      let metaObj = parsed;
      if (imgFile && imageCid) {
        metaObj = { ...parsed, image: `ipfs://${imageCid}` };
      }
      try {
        const metaResp = await axios.post('https://api.nft.storage/upload', Buffer.from(JSON.stringify(metaObj)), {
          headers: { ...headers, 'Content-Type': 'application/json' },
          maxBodyLength: Infinity,
        });
        const cid = metaResp.data?.value?.cid || metaResp.data?.cid;
        if (!cid) return res.status(502).json({ error: 'nft.storage metadata upload failed' });
        return res.json({ provider: 'nftstorage', cid, uri: `ipfs://${cid}`, name: nameJson });
      } catch (e) {
        const status = e.response?.status || 500;
        const payload = e.response?.data || e.message || 'nft.storage error';
        return res.status(status).json({ error: payload });
      }
    }

    return res.status(400).json({ error: 'unknown provider' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch IPFS JSON via server (CORS-friendly fallback for FE)
app.get('/api/ipfs/fetch', async (req, res) => {
  try {
    const uri = String(req.query.uri || '').trim();
    if (!uri) return res.status(400).json({ error: 'uri required' });

    const resolveIpfs = (u) => {
      if (!u) return u;
      if (u.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${u.replace('ipfs://', '')}`;
      return u;
    };
    const http = resolveIpfs(uri);
    const bases = Array.from(new Set([
      http,
      http?.replace('https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'),
      http?.replace('https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'),
      http?.replace('https://ipfs.io/ipfs/', 'https://nftstorage.link/ipfs/'),
      http?.replace('https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'),
    ].filter(Boolean)));

    let lastErr;
    for (const base of bases) {
      try {
        const resp = await axios.get(base, {
          responseType: 'text',
          headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8', 'Cache-Control': 'no-cache' },
          timeout: 15000,
          maxContentLength: 1024 * 1024 * 4,
          validateStatus: () => true,
        });
        if (resp.status < 200 || resp.status >= 300) { lastErr = new Error(String(resp.status)); continue; }
        const ct = String(resp.headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json') || ct.includes('application/ld+json') || ct.includes('text/json')) {
          res.set('Cache-Control', 'no-store');
          return res.json(typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data);
        }
        // try parse as JSON from text
        try {
          const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
          res.set('Cache-Control', 'no-store');
          return res.json(data);
        } catch (_) {
          lastErr = new Error('not json');
        }
      } catch (e) { lastErr = e; }
    }
    return res.status(502).json({ error: (lastErr && (lastErr.message || String(lastErr))) || 'fetch failed' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Students
app.post('/api/students', async (req, res) => { try { const s = await Student.create(req.body); res.json(s); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/students', async (req, res) => { const list = await Student.find().sort({ createdAt: -1 }).limit(200); res.json(list); });
app.get('/api/students/:id', async (req, res) => { const s = await Student.findById(req.params.id); if (!s) return res.status(404).json({ error: 'Not found' }); res.json(s); });

// Certificates
app.post('/api/certificates', async (req, res) => {
  try {
    const body = req.body || {};
    const recipient = String(body.recipient || '').trim();
    const tokenId = String(body.tokenId ?? '').trim();
    // Basic validation: require valid EVM address and tokenId present
    const isAddr = /^0x[a-fA-F0-9]{40}$/.test(recipient);
    if (!isAddr) return res.status(400).json({ error: 'invalid recipient address' });
    if (!tokenId) return res.status(400).json({ error: 'tokenId required' });
    const doc = {
      ...body,
      recipient: recipient.toLowerCase(),
      tokenId,
    };
    const c = await Certificate.create(doc);
    res.json(c);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete certificate by tokenId (admin)
app.delete('/api/certificates/:tokenId', requireAdmin, async (req, res) => {
  try {
    const tokenId = String(req.params.tokenId||'').trim();
    if (!tokenId) return res.status(400).json({ error: 'tokenId required' });
    await Certificate.deleteOne({ tokenId });
    res.json({ ok: true, tokenId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk delete by recipient (admin)
app.delete('/api/certificates/by-recipient/:address', requireAdmin, async (req, res) => {
  try {
    const address = String(req.params.address||'').toLowerCase();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'invalid address' });
    const r = await Certificate.deleteMany({ recipient: address });
    res.json({ ok: true, deleted: r.deletedCount||0, recipient: address });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/certificates', async (req, res) => { const { address, tokenId } = req.query; const q = {}; if (address) q.recipient = new RegExp(address, 'i'); if (tokenId) q.tokenId = String(tokenId); const list = await Certificate.find(q).sort({ createdAt: -1 }).limit(200); res.json(list); });

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const total = await Certificate.countDocuments();
    const byCourse = await Certificate.aggregate([
      { $group: { _id: '$course', count: { $sum: 1 } } }
    ]);
    const byRecipient = await Certificate.aggregate([
      { $group: { _id: '$recipient', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    const avgPipeline = [
      { $addFields: { scoreFirst: { $arrayElemAt: [ { $split: [ '$score', '/' ] }, 0 ] } } },
      { $addFields: { scoreNumber: { $convert: { input: '$scoreFirst', to: 'double', onError: null, onNull: null } } } },
      { $match: { scoreNumber: { $ne: null } } }
    ];
    const overall = await Certificate.aggregate([
      ...avgPipeline,
      { $group: { _id: null, avg: { $avg: '$scoreNumber' } } }
    ]);
    const byCourseAvg = await Certificate.aggregate([
      ...avgPipeline,
      { $group: { _id: '$course', avg: { $avg: '$scoreNumber' } } }
    ]);
    const avgScore = overall?.[0]?.avg ?? null;
    res.json({ total, byCourse, byRecipient, avgScore, byCourseAvg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify by tokenId (server-side)
app.get('/api/verify/:tokenId', async (req, res) => {
  try {
    if (!contract) return res.status(500).json({ error: 'Contract not configured' });
    const tokenId = req.params.tokenId;
    const uri = await contract.methods.tokenURI(tokenId).call();
    const metaResp = await axios.get(resolveIpfsServer(uri));
    const meta = metaResp.data;
    const score = getAttr(meta, ['Điểm số','Diem so','Score']);
    const date = getAttr(meta, ['Ngày cấp','Ngay cap','Issued']);
    const toHash = `${meta?.name||''}|${score||''}|${date||''}`;
    const crypto = await import('crypto');
    const expected = '0x' + crypto.createHash('sha256').update(toHash).digest('hex');
    let onchainHash = null; try { onchainHash = await contract.methods.certificateHash(tokenId).call(); } catch {}
    const verified = onchainHash && onchainHash !== '0x' && onchainHash.toLowerCase() === expected.toLowerCase();
    res.json({ tokenId, tokenURI: uri, expectedHash: expected, onchainHash, verified, metadata: meta });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function resolveIpfsServer(uri) { if (!uri) return uri; if (uri.startsWith('ipfs://')) { const p = uri.replace('ipfs://',''); return `https://ipfs.io/ipfs/${p}`; } try { new URL(uri); return uri; } catch {} if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[1-9A-HJ-NP-Za-km-z]{20,})$/.test(uri)) return `https://ipfs.io/ipfs/${uri}`; return uri; }
function getAttr(meta, names) { if (!Array.isArray(meta?.attributes)) return ''; const lower = names.map(s=>s.toLowerCase()); const f = meta.attributes.find(a => lower.includes(String(a.trait_type||'').toLowerCase())); return f?.value || ''; }

const port = process.env.PORT || 3001;

// Serve FE build (fe/dist) khi triển khai 1 dịch vụ
try {
  const distPath = path.resolve(process.cwd(), '..', 'fe', 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
} catch {}

app.listen(port, () => console.log(`Server listening on :${port}`));
