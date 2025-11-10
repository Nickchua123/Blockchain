// GalleryPage — refreshed UI similar to POAP Gallery
import { useState, useEffect, useRef } from "react";
import { isAddress } from "ethers";
import { useLocation } from "react-router-dom";
import { BrowserProvider, Contract } from "ethers";
import contractABI from "../assets/CertificateNFT.json";
import { toast } from 'react-toastify';
import { useWallet } from "../context/WalletContext";

// Contract config
const envVite = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONTRACT_ADDRESS) || "";
const envCRA = (typeof process !== 'undefined' && process.env?.REACT_APP_CONTRACT_ADDRESS) || "";
const contractAddress = (envVite || envCRA || "YOUR_CONTRACT_ADDRESS").trim();

const deployBlockEnv = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEPLOY_BLOCK) ||
  (typeof process !== 'undefined' && process.env?.VITE_DEPLOY_BLOCK) ||
  ""
).trim();
const fromBlock = deployBlockEnv ? Number(deployBlockEnv) : undefined;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function getOwnedTokenIds(contract, owner) {
  try {
    const balance = Number(await contract.balanceOf(owner));
    const ids = [];
    for (let i = 0; i < balance; i++) ids.push(await contract.tokenOfOwnerByIndex(owner, i));
    return ids;
  } catch (_) {
    const inEvents = fromBlock !== undefined
      ? await contract.queryFilter(contract.filters.Transfer(null, owner), fromBlock)
      : await contract.queryFilter(contract.filters.Transfer(null, owner));
    const outEvents = fromBlock !== undefined
      ? await contract.queryFilter(contract.filters.Transfer(owner, null), fromBlock)
      : await contract.queryFilter(contract.filters.Transfer(owner, null));
    const candidates = new Set();
    for (const e of inEvents) candidates.add(e.args.tokenId);
    for (const e of outEvents) candidates.add(e.args.tokenId);
    const result = [];
    for (const id of candidates) {
      try { if ((await contract.ownerOf(id)).toLowerCase() === owner.toLowerCase()) result.push(id); } catch {}
    }
    return result;
  }
}

async function getAllMintedTokenIds(contract) {
  const mintedEvents = fromBlock !== undefined
    ? await contract.queryFilter(contract.filters.Transfer(ZERO_ADDRESS, null), fromBlock)
    : await contract.queryFilter(contract.filters.Transfer(ZERO_ADDRESS, null));
  const ids = new Set();
  for (const e of mintedEvents) ids.add(e.args.tokenId);
  return Array.from(ids);
}

// Alive tokenIds = minted - burned
async function getAliveTokenIds(contract) {
  const mintedEvents = fromBlock !== undefined
    ? await contract.queryFilter(contract.filters.Transfer(ZERO_ADDRESS, null), fromBlock)
    : await contract.queryFilter(contract.filters.Transfer(ZERO_ADDRESS, null));
  const burnedEvents = fromBlock !== undefined
    ? await contract.queryFilter(contract.filters.Transfer(null, ZERO_ADDRESS), fromBlock)
    : await contract.queryFilter(contract.filters.Transfer(null, ZERO_ADDRESS));
  const minted = new Set();
  const burned = new Set();
  for (const e of mintedEvents) minted.add(e.args.tokenId.toString());
  for (const e of burnedEvents) burned.add(e.args.tokenId.toString());
  const alive = [];
  minted.forEach(id => { if (!burned.has(id)) alive.push(id); });
  return alive;
}

function resolveIpfs(uri) {
  if (!uri) return uri;
  if (uri.startsWith('ipfs://')) {
    let path = uri.replace('ipfs://', '');
    if (path.startsWith('ipfs/')) path = path.slice(5);
    return `https://ipfs.io/ipfs/${path}`;
  }
  try { new URL(uri); return uri; } catch (_) {}
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[1-9A-HJ-NP-Za-km-z]{20,})$/.test(uri)) return `https://ipfs.io/ipfs/${uri}`;
  return uri;
}

function normalizeImage(tokenURI, image) {
  if (!image) return image;
  const lower = String(image).toLowerCase();
  if (lower.startsWith('ipfs://') || lower.startsWith('http') || lower.startsWith('data:')) return image;
  if (typeof tokenURI === 'string' && tokenURI.startsWith('ipfs://')) {
    const path = tokenURI.replace('ipfs://', '');
    const base = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : path;
    const cleanImage = String(image).replace(/^\.\//, '').replace(/^\//, '');
    return `ipfs://${base}/${cleanImage}`;
  }
  return image;
}

function parseDataUriJson(uri) {
  if (uri.startsWith('data:application/json;base64,')) {
    const b64 = uri.slice('data:application/json;base64,'.length);
    return JSON.parse(atob(b64));
  }
  if (uri.startsWith('data:application/json,')) {
    const encoded = uri.slice('data:application/json,'.length);
    return JSON.parse(decodeURIComponent(encoded));
  }
  return null;
}

async function fetchJsonWithFallbacks(uri) {
  if (!uri) throw new Error('Missing tokenURI');
  if (uri.startsWith('data:application/json')) {
    const parsed = parseDataUriJson(uri);
    if (parsed) return parsed;
  }
  const http = resolveIpfs(uri);
  // Thử backend trước để tránh CORS/gateway propagation
  try {
    const apiBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';
    const r = await fetch(`${apiBase}/ipfs/fetch?uri=${encodeURIComponent(uri)}`, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
    if (r.ok) {
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) return await r.json();
      try { const t = await r.text(); return JSON.parse(t); } catch {}
    }
  } catch (_) { /* ignore and fallback below */ }

  const pinata = http.replace('https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/');
  const cf = http.replace('https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/');
  const nftst = http.replace('https://ipfs.io/ipfs/', 'https://nftstorage.link/ipfs/');
  const bases = Array.from(new Set([pinata, http, cf, nftst].filter(Boolean)));
  const withBust = (u) => u + (u.includes('?') ? '&' : '?') + 'ts=' + Date.now();
  const candidates = bases.flatMap(u => [u, withBust(u)]);
  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-cache', headers: { 'Accept': 'application/json' } });
      const text = await res.text();
      const head = text.trim().slice(0, 32).toLowerCase();
      if (head.startsWith('<!doctype') || head.startsWith('<html')) throw new Error('Gateway returned HTML');
      return JSON.parse(text);
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('Failed to fetch metadata from IPFS');
}

async function downloadWithFallbacks(uri, filename) {
  if (!uri) throw new Error('Missing URL');
  if (uri.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = uri;
    a.download = filename || 'certificate';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const http = resolveIpfs(uri);
  const candidates = [
    http,
    http.replace('https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'),
    http.replace('https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'),
  ];
  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = blob.type.includes('/') ? blob.type.split('/')[1] : 'bin';
      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlObj;
      a.download = filename || `certificate.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
      return;
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('Cannot download file');
}

export default function GalleryPage() {
  const { address: walletAddress, connect } = useWallet();
  const hasValidContract = useRef(isAddress(contractAddress));
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(false);
  const toastIdRef = useRef(null);
  const loadingRef = useRef(false);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState('featured');
  const [sortBy, setSortBy] = useState('id_desc'); // id_desc | id_asc | name
  const previewRef = useRef(null);
  const autoScrollPausedRef = useRef(false);
  const [ownedCount, setOwnedCount] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [explorerBase, setExplorerBase] = useState("https://etherscan.io");
  const location = useLocation();

  const isMy = location.pathname?.toLowerCase().startsWith('/my');

  // Khi truy cập đường dẫn "/my", tự động chọn tab "Sở hữu"
  useEffect(() => {
    if (isMy && activeTab !== 'featured') {
      setActiveTab('featured');
      // Xoá truy vấn để hiển thị toàn bộ sở hữu
      setQuery('');
    }
  }, [isMy]);

  function getExplorerBaseByChain(id) {
    switch (Number(id)) {
      case 1: return "https://etherscan.io";
      case 11155111: return "https://sepolia.etherscan.io";
      case 5: return "https://goerli.etherscan.io";
      default: return "https://etherscan.io";
    }
  }

  const loadNFTs = async () => {
    if (loadingRef.current) return; if (activeTab !== 'all' && !walletAddress) return;
    if (!hasValidContract.current) { toast.error('Chưa cấu hình địa chỉ contract'); return; }
    if (!window.ethereum) { toast.error('Cần MetaMask để tải dữ liệu'); return; }
    loadingRef.current = true;
    setLoading(true);

    const toastId = toastIdRef.current && toast.isActive(toastIdRef.current)
      ? toastIdRef.current
      : toast.loading('Đang tải chứng chỉ...', { toastId: 'gallery-loading' });
    toastIdRef.current = toastId;

    try {
      const provider = new BrowserProvider(window.ethereum);
      const contract = new Contract(contractAddress, contractABI, provider);
      const network = await provider.getNetwork();
      setExplorerBase(getExplorerBaseByChain(network.chainId));

      let tokenIds = [];
       if (activeTab === 'all') { tokenIds = await getAliveTokenIds(contract); } else { if (!walletAddress) { setLoading(false); loadingRef.current = false; return; } tokenIds = await getOwnedTokenIds(contract, walletAddress); }

      const temp = [];
      let failed = 0;
      for (const tokenId of tokenIds) {
        try {
          const tokenURI = await contract.tokenURI(tokenId);
          try {
            const metadata = await fetchJsonWithFallbacks(tokenURI);
            const ownerAddr = await contract.ownerOf(tokenId);
            const normalizedImg = normalizeImage(tokenURI, metadata?.image);
            temp.push({ id: tokenId.toString(), owner: ownerAddr, tokenURI, metadata, image: normalizedImg, ...metadata });
          } catch {
            // Fallback card when metadata fails
            const ownerAddr = await contract.ownerOf(tokenId).catch(() => '');
            temp.push({ id: tokenId.toString(), owner: ownerAddr, tokenURI, name: `NFT #${tokenId}`, description: 'Không đọc được metadata', image: null, metadata: null });
            failed += 1;
          }
        } catch (e) { failed += 1; continue; }
      }
      setNfts(temp);
      if (activeTab === 'all') setAllCount(temp.length); else setOwnedCount(temp.length);
      toast.update(toastId, { render: `Đã tải ${temp.length} NFT${failed ? ' (' + failed + ' lỗi)' : ''}`, type: 'success', isLoading: false, autoClose: 1800 });
    } catch (e) {
      toast.update(toastId, { render: e.message || 'Tải thất bại', type: 'error', isLoading: false, autoClose: 2500 });
    } finally { setLoading(false); loadingRef.current = false; }
  };

  useEffect(() => { if (activeTab === 'all') loadNFTs(); else if (walletAddress) loadNFTs(); }, [walletAddress, activeTab]);

  // Prefetch counts for both tabs (Owned and All) on mount and when wallet changes
  useEffect(() => {
    (async () => {
      try {
        if (!window.ethereum) return;
        if (!isAddress(contractAddress)) return;
        const provider = new BrowserProvider(window.ethereum);
        const contract = new Contract(contractAddress, contractABI, provider);
        try { const network = await provider.getNetwork(); setExplorerBase(getExplorerBaseByChain(network.chainId)); } catch {}

        // All count (alive only)
        try {
          const allIds = await getAliveTokenIds(contract);
          setAllCount(allIds.length);
        } catch {}

        // Owned count
        if (walletAddress) {
          try {
            const ownedIds = await getOwnedTokenIds(contract, walletAddress);
            setOwnedCount(ownedIds.length);
          } catch {}
        } else {
          setOwnedCount(0);
        }
      } catch {}
    })();
  }, [walletAddress]);

  // Filter + sort
  const filtered = nfts.filter(n => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (n.id === q) return true;
    if ((n.name||'').toLowerCase().includes(q)) return true;
    if ((n.owner||'').toLowerCase().includes(q)) return true;
    return false;
  }).sort((a,b) => {
    if (sortBy === 'id_asc') return Number(a.id) - Number(b.id);
    if (sortBy === 'id_desc') return Number(b.id) - Number(a.id);
    const an = (a.name||'').toLowerCase();
    const bn = (b.name||'').toLowerCase();
    return an.localeCompare(bn);
  });

  // Auto-scroll the preview strip; pause on hover
  useEffect(() => {
    const el = previewRef.current;
    if (!el || filtered.length === 0) return;
    const onEnter = () => { autoScrollPausedRef.current = true; };
    const onLeave = () => { autoScrollPausedRef.current = false; };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    const timer = setInterval(() => {
      if (autoScrollPausedRef.current) return;
      try {
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 0) return;
        if (el.scrollLeft >= max - 1) {
          el.scrollLeft = 0;
        } else {
          el.scrollLeft += 1;
        }
      } catch {}
    }, 20);
    return () => {
      clearInterval(timer);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [filtered.length]);

  const executeSearch = async () => {
    const q = query.trim();
    if (!q) return;
    // address Tìm kiếm
    if (q.startsWith('0x') && q.length >= 10) {
      try {
        setLoading(true);
        const provider = new BrowserProvider(window.ethereum);
        const contract = new Contract(contractAddress, contractABI, provider);
        const temp = [];
        const tokens = await getOwnedTokenIds(contract, q);
        for (const tokenId of tokens) {
          try {
            const tokenURI = await contract.tokenURI(tokenId);
            const metadata = await fetchJsonWithFallbacks(tokenURI);
            const owner = await contract.ownerOf(tokenId).catch(() => '');
            const normalizedImg = normalizeImage(tokenURI, metadata?.image);
            temp.push({ id: String(tokenId), owner, tokenURI, course: '', metadata, image: normalizedImg, ...metadata });
          } catch {}
        }
        setNfts(temp);
        if (activeTab === 'all') setAllCount(temp.length); else setOwnedCount(temp.length);
        setActiveTab('featured');
      } catch (e) { toast.error('Không thể tải theo địa chỉ'); } finally { setLoading(false); }
      return;
    }
    // tokenId Tìm kiếm
    if (/^\d+$/.test(q)) {
      try {
        setLoading(true);
        const provider = new BrowserProvider(window.ethereum);
        const contract = new Contract(contractAddress, contractABI, provider);
        const tokenId = q;
        try {
          const tokenURI = await contract.tokenURI(tokenId);
          try {
            const metadata = await fetchJsonWithFallbacks(tokenURI);
            const owner = await contract.ownerOf(tokenId).catch(() => '');
            const normalizedImg = normalizeImage(tokenURI, metadata?.image);
            setNfts([{ id: String(tokenId), owner, tokenURI, course: '', metadata, image: normalizedImg, ...metadata }]);
          } catch {
            const owner = await contract.ownerOf(tokenId).catch(() => '');
            setNfts([{ id: String(tokenId), owner, tokenURI, course: '', metadata: null, image: null, name: `NFT #${tokenId}`, description: 'Không đọc được metadata' }]);
          }
        } catch {
          setNfts([]);
        }
        setActiveTab('all');
      } catch (e) { toast.error('Không tìm thấy tokenId này'); } finally { setLoading(false); }
      return;
    }
    // default: ensure data is loaded for current tab (so filter has data)
    if (nfts.length === 0 && !loadingRef.current) await loadNFTs();
  };

  const handleQueryChange = async (e) => {
    const v = e.target.value;
    setQuery(v);
    // Khi xoá trống ô tìm kiếm, nạp lại dữ liệu theo tab hiện tại
    if (v.trim() === '') {
      if (!loadingRef.current) await loadNFTs();
    }
  };

  const clearSearch = async () => {
    setQuery('');
    if (!loadingRef.current) await loadNFTs();
  };

  const handleDownload = async (nft) => {
    try {
      const source = nft.image || nft.metadata?.image || nft.metadata?.certificate || nft.tokenURI;
      const safeName = `${(nft.name || 'certificate').replace(/[^a-z0-9-_ ]/gi, '_')}-${nft.id}`;
      const tid = toast.loading('Chuẩn bị tải...');
      await downloadWithFallbacks(source, safeName);
      toast.update(tid, { render: 'Đã tải!', type: 'success', isLoading: false, autoClose: 1800 });
    } catch (e) { toast.error(e.message || 'Tải thất bại'); }
  };

  return (
    <div className="container my-5">
      <div className="gallery-hero mb-4">
        <div className="d-flex flex-column gap-3">
          <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
            <div>
              <h2 className="gallery-title m-0">{isMy ? 'Chứng chỉ của tôi' : 'Bộ sưu tập'}</h2>
              <div className="gallery-subtitle">Khám phá và tải chứng chỉ NFT của bạn.</div>
            </div>
            <div className="d-flex gap-2 w-100 w-md-auto">
              <input className="form-control gallery-search" placeholder="Tìm theo tiêu đề, ID hoặc địa chỉ" value={query} onChange={handleQueryChange} onKeyDown={e => { if (e.key === 'Enter') executeSearch(); }} />
              <button className="gallery-search-btn" onClick={executeSearch}>Tìm kiếm</button>
              {query && <button className="btn-poap-outline" onClick={clearSearch}>Hiển thị tất cả</button>}
            </div>
          </div>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gallery-tabs">
              <button className={`gallery-tab ${activeTab === 'featured' ? 'active' : ''}`} onClick={() => setActiveTab('featured')}>{`Sở hữu (${ownedCount})`}</button>
              <button className={`gallery-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>{`Tất cả (${allCount})`}</button>
            </div>
            <div className="seg-control">
              <button className={`seg-option ${sortBy==='id_desc'?'active':''}`} onClick={()=>setSortBy('id_desc')}>Mới nhất</button>
              <button className={`seg-option ${sortBy==='id_asc'?'active':''}`} onClick={()=>setSortBy('id_asc')}>Cũ nhất</button>
              <button className={`seg-option ${sortBy==='name'?'active':''}`} onClick={()=>setSortBy('name')}>Tên</button>
            </div>
          </div>
        </div>
      </div>

      {/* Preview strip like POAP: first few items */}
      {!loading && filtered.length > 0 && (
        <div className="preview-strip" ref={previewRef}>
          {filtered.slice(0, 6).map(n => (
            <div key={`chip-${n.id}`} className="preview-chip" onClick={() => setSelected(n)} style={{cursor:'pointer'}}>
              {n.image && <img className="chip-img" src={resolveIpfs(n.image)} alt="" />}
              <div>
                <div className="chip-title">{n.name || `NFT #${n.id}`}</div>
                <div className="chip-sub">ID {n.id}{n.owner?` – ${n.owner.slice(0,6)}...${n.owner.slice(-4)}`:''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="row row-cols-1 row-cols-md-3 row-cols-lg-4 g-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="col">
              <div className="card placeholder-glow">
                <div className="placeholder col-12" style={{ height: 220, borderRadius: 24 }}></div>
                <div className="card-body">
                  <h5 className="placeholder-glow"><span className="placeholder col-8"></span></h5>
                  <p className="placeholder-glow"><span className="placeholder col-6"></span></p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {isMy && !walletAddress && (
            <div className="alert alert-info">Kết nối ví để xem chứng chỉ của bạn. <button className="btn btn-sm btn-primary ms-2" onClick={connect}>Kết nối</button></div>
          )}
          <div className="row row-cols-1 row-cols-md-3 row-cols-lg-4 g-4">
            {filtered.length === 0 ? (
              <div className="empty-wrap col-12">
                <div className="empty-icon">🎓</div>
                <div>Không có chứng chỉ nào</div>
              </div>
            ) : (
              filtered.map(nft => (
                <div className="col" key={nft.id}>
                  <div className="card poap-card h-100">
                    <div className="poap-image-wrap" onClick={() => setSelected(nft)} style={{cursor:'pointer'}}>
                      {nft.image && (
                        <img src={resolveIpfs(nft.image)} alt={nft.name} className="poap-image" />
                      )}
                    </div>
                    <div className="card-body d-flex flex-column">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="poap-badge">ID {nft.id}</span>
                        <span className="text-muted small">{nft.course || 'Certificate'}</span>
                      </div>
                      <h6 className="mb-1" title={nft.name}>{nft.name || `NFT #${nft.id}`}</h6>
                      <p className="text-muted small flex-grow-1 mb-3" style={{minHeight: '2.5em'}}>{nft.description}</p>
                      <div className="poap-actions d-flex gap-2 mt-auto">
                        <button className="btn-poap-outline" onClick={() => setSelected(nft)}>Chi tiết</button>
                        <button className="btn-poap" onClick={() => handleDownload(nft)}>Tải xuống</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {selected && (
        <div className="modal d-block bg-dark bg-opacity-50" style={{ zIndex: 1050 }} onClick={() => setSelected(null)}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{selected.name}</h5>
                <button className="btn-close" onClick={() => setSelected(null)}></button>
              </div>
              <div className="modal-body">
                {selected.image && <img src={resolveIpfs(selected.image)} className="img-fluid rounded mb-3" alt="" />}
                <p><strong>Token ID:</strong> {selected.id}</p>
                <p className="text-break"><strong>Owner:</strong> {selected.owner}</p>
                {selected.attributes?.map((a, i) => (
                  <p key={i} className="mb-1"><strong>{a.trait_type}:</strong> {a.value}</p>
                ))}
              </div>
              <div className="modal-footer">
                <button className="btn btn-primary" onClick={() => handleDownload(selected)}>Tải xuống</button>
                <button className="btn btn-secondary" onClick={() => setSelected(null)}>Đóng</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
