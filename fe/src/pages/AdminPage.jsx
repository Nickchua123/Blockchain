import { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { useWallet } from '../context/WalletContext';

function StatCard({ title, value, sub }) {
  return (
    <div className="admin-card p-3">
      <div className="text-muted small mb-1">{title}</div>
      <div className="h3 m-0">{value}</div>
      {sub ? <div className="text-muted small mt-1">{sub}</div> : null}
    </div>
  );
}

export default function AdminPage() {
  const { address, isConnected, connect, nativeBalance, nativeSymbol } = useWallet();
  const [stats, setStats] = useState(null);
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);
  const [explorerBase, setExplorerBase] = useState('https://etherscan.io');

  const apiBase = useMemo(() => (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api', []);
  const envAdmins = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_ADDRESSES) || (typeof process !== 'undefined' && process.env?.VITE_ADMIN_ADDRESSES) || "";
  const contractAddress = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONTRACT_ADDRESS) || (typeof process !== 'undefined' && process.env?.REACT_APP_CONTRACT_ADDRESS) || "").trim();
  const MINTER_ROLE = useMemo(() => keccak256(toUtf8Bytes("MINTER_ROLE")), []);

  // Kiểm tra quyền admin (owner / MINTER_ROLE / danh sách env)
  useEffect(() => {
    (async () => {
      try {
        if (!isConnected || !address || !contractAddress) { setIsAdmin(false); setChecked(true); return; }
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const contract = new Contract(contractAddress, [
          { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
          { inputs:[{internalType:'bytes32',name:'role',type:'bytes32'},{internalType:'address',name:'account',type:'address'}],name:'hasRole',outputs:[{internalType:'bool',name:'',type:'bool'}],stateMutability:'view',type:'function' },
          { inputs:[{internalType:'address',name:'',type:'address'}], name:'isMinter', outputs:[{internalType:'bool',name:'',type:'bool'}], stateMutability:'view', type:'function' }
        ], signer);
        let ownerOk = false, roleOk = false, minterOk = false;
        try { ownerOk = (await contract.owner?.())?.toLowerCase?.() === address.toLowerCase(); } catch {}
        try { roleOk = await contract.hasRole?.(MINTER_ROLE, address); } catch {}
        try { minterOk = await contract.isMinter?.(address); } catch {}
        const envOk = envAdmins.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(address.toLowerCase());
        setIsAdmin(Boolean(ownerOk || roleOk || minterOk || envOk));
      } finally { setChecked(true); }
    })();
  }, [isConnected, address, envAdmins, contractAddress, MINTER_ROLE]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        fetch(`${apiBase}/stats`).then(r=>r.json()).catch(()=>null),
        fetch(`${apiBase}/certificates`).then(r=>r.json()).catch(()=>[]),
      ]);
      setStats(s);
      const list = Array.isArray(c) ? [...c] : [];
      list.sort((a, b) => {
        const da = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da; // mới nhất trước
      });
      setCerts(list.slice(0, 8));
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [apiBase]);

  const shortAddr = (a) => {
    if (!a || typeof a !== 'string') return '—';
    const v = a.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(v)) return `${v.slice(0,6)}...${v.slice(-4)}`;
    return v; // dữ liệu không hợp lệ: hiển thị nguyên văn
  };

  const getExplorerBaseByChain = (id) => {
    switch (Number(id)) {
      case 1: return 'https://etherscan.io';
      case 11155111: return 'https://sepolia.etherscan.io';
      case 137: return 'https://polygonscan.com';
      case 80002: return 'https://amoy.polygonscan.com';
      case 56: return 'https://bscscan.com';
      case 97: return 'https://testnet.bscscan.com';
      case 42161: return 'https://arbiscan.io';
      case 421614: return 'https://sepolia.arbiscan.io';
      case 8453: return 'https://basescan.org';
      case 84532: return 'https://sepolia.basescan.org';
      default: return 'https://etherscan.io';
    }
  };

  useEffect(() => {
    (async () => {
      try {
        if (!window?.ethereum) return;
        const provider = new BrowserProvider(window.ethereum);
        const net = await provider.getNetwork();
        setExplorerBase(getExplorerBaseByChain(net.chainId));
      } catch {}
    })();
  }, [isConnected]);

  if (!checked) return <div className="container py-5 text-center">Đang kiểm tra quyền...</div>;
  if (!isAdmin) return (
    <div className="container py-5 text-center">
      <h3>Chỉ Admin!</h3>
      {!isConnected && <button className="btn btn-primary mt-3" onClick={connect}>Kết nối ví</button>}
    </div>
  );

  return (
    <div className="admin dark">
      <div className="admin-sidebar">
        <div className="admin-brand">Admin</div>
        <nav className="admin-nav">
          <a className="active">Trang chủ</a>
          <a href="/admin/users">Người dùng</a>
        </nav>
        <div className="admin-sidebar-footer">{address ? `${address.slice(0,6)}...${address.slice(-4)}` : 'Chưa kết nối'}</div>
      </div>
      <div className="admin-content container-fluid py-4">
        <h2 className="text-light mb-3">Bảng điều khiển</h2>

        <div className="row g-3 mb-3">
          <div className="col-12 col-md-3"><StatCard title="Tổng chứng chỉ" value={stats?.total ?? '—'} /></div>
          <div className="col-12 col-md-3"><StatCard title="Số khóa học" value={stats?.byCourse?.length ?? '—'} /></div>
          <div className="col-12 col-md-3"><StatCard title="Người nhận (Top)" value={stats?.byRecipient?.length ?? '—'} /></div>
          <div className="col-12 col-md-3"><StatCard title="Điểm trung bình" value={stats?.avgScore ? stats.avgScore.toFixed(2) : '—'} /></div>
        </div>

        <div className="row g-3">
          <div className="col-12 col-lg-6">
            <div className="admin-card p-3 h-100">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="m-0 text-light">Số dư ví</h5>
              </div>
              <div className="text-muted">{address ? `${address.slice(0,6)}...${address.slice(-4)}` : ''}</div>
              <div className="display-6">{nativeBalance ? Number(nativeBalance).toFixed(4) : '—'} {nativeSymbol}</div>
              <div className="text-muted small">Dùng ví để mint / quản trị</div>
            </div>
          </div>
          <div className="col-12 col-lg-6">
            <div className="admin-card p-3 h-100">
              <h5 className="text-light">Chứng chỉ gần đây</h5>
              <div className="table-responsive">
                <table className="table table-dark table-sm align-middle">
                  <thead><tr><th>ID</th><th>Người nhận</th><th>Khóa học</th><th>Ngày</th></tr></thead>
                  <tbody>
                    {certs.length === 0 ? <tr><td colSpan={4} className="text-center text-muted">Không có dữ liệu</td></tr> :
                      certs.map((c,i) => (
                        <tr key={i}>
                          <td>{c.tokenId||'—'}</td>
                          <td className="text-break">
                            {/^0x[a-fA-F0-9]{40}$/.test(String(c.recipient||'')) ? (
                              <a href={`${explorerBase}/address/${String(c.recipient).toLowerCase()}`} target="_blank" rel="noreferrer">{shortAddr(c.recipient)}</a>
                            ) : shortAddr(c.recipient)}
                          </td>
                          <td>{c.course||'—'}</td>
                          <td>{c.createdAt ? new Date(c.createdAt).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Trang chủ gồm thống kê, số dư ví, chứng chỉ gần đây */}
      </div>
    </div>
  );
}
