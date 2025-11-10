import { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { toast } from 'react-toastify';
import { useWallet } from '../context/WalletContext';

export default function AdminUsersPage() {
  const { address, isConnected, connect, isAdmin, adminChecked } = useWallet();

  const [users, setUsers] = useState({ items: [], total: 0 });
  const [userQ, setUserQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sort, setSort] = useState('newest');
  const [loading, setLoading] = useState(false);
  const [confirmAddr, setConfirmAddr] = useState(null);
  // roleMap: addressLower -> { admin: boolean, lock: boolean, reason?: string }
  const [roleMap, setRoleMap] = useState(new Map());

  const apiBase = useMemo(() => (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api', []);
  const envAdmins = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_ADDRESSES) || (typeof process !== 'undefined' && process.env?.VITE_ADMIN_ADDRESSES) || '';
  const contractAddress = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONTRACT_ADDRESS) || (typeof process !== 'undefined' && process.env?.REACT_APP_CONTRACT_ADDRESS) || '').trim();
  const MINTER_ROLE = useMemo(() => keccak256(toUtf8Bytes('MINTER_ROLE')), []);

  function useDebounce(v, ms = 500) {
    const [d, setD] = useState(v);
    useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
    return d;
  }
  const debouncedQ = useDebounce(userQ, 500);

  const loadUsers = async (q, p, l, s) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ q, skip: String((p - 1) * l), limit: String(l), sort: s }).toString();
      const u = await fetch(`${apiBase}/users?${qs}`).then(r => r.json()).catch(() => ({ items: [], total: 0 }));
      setUsers(u || { items: [], total: 0 });
      // Prefetch role map (batch hasRole)
      try {
        const cAddr = contractAddress;
        const envSet = new Set(envAdmins.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
        if (cAddr && u?.items?.length) {
          if (!window?.ethereum) { setRoleMap(new Map()); return; }
          const provider = new BrowserProvider(window.ethereum);
          const abi = [
            { inputs: [{ internalType: 'bytes32', name: 'role', type: 'bytes32' }, { internalType: 'address', name: 'account', type: 'address' }], name: 'hasRole', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
            { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
            { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'isMinter', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
          ];
          const c = new Contract(cAddr, abi, provider);
          const DEFAULT_ADMIN_ROLE = '0x' + '00'.repeat(32);
          let ownerAddr = '';
          try { ownerAddr = (await c.owner?.())?.toLowerCase?.() || ''; } catch {}
          const entries = await Promise.all((u.items || []).map(async it => {
            const addr = String(it.address || '').toLowerCase();
            try {
              const [hasMinterRole, isDefAdmin, mappingMinter] = await Promise.all([
                c.hasRole?.(MINTER_ROLE, addr).catch(() => false),
                c.hasRole?.(DEFAULT_ADMIN_ROLE, addr).catch(() => false),
                c.isMinter?.(addr).catch(() => false),
              ]);
              const isOwner = ownerAddr && addr === ownerAddr;
              const envOk = envSet.has(addr);
              const lock = Boolean(isDefAdmin || isOwner || envOk);
              const admin = Boolean(hasMinterRole || mappingMinter || isDefAdmin || isOwner || envOk);
              const reason = isDefAdmin ? 'Đang giữ quyền ADMIN mặc định' : isOwner ? 'Chủ sở hữu hợp đồng' : envOk ? 'Admin cố định (env)' : '';
              return [addr, { admin, lock, reason }];
            } catch {
              const isOwner = ownerAddr && addr === ownerAddr;
              const envOk = envSet.has(addr);
              const lock = Boolean(isOwner || envOk);
              const admin = lock;
              const reason = isOwner ? 'Chủ sở hữu hợp đồng' : envOk ? 'Admin cố định (env)' : '';
              return [addr, { admin, lock, reason }];
            }
          }));
          setRoleMap(new Map(entries));
        } else { setRoleMap(new Map()); }
      } catch {}
    } finally { setLoading(false); }
  };

  useEffect(() => { loadUsers(debouncedQ, page, limit, sort); }, [apiBase, debouncedQ, page, limit, sort]);

  if (!adminChecked) return (<div className="container py-5 text-center">Đang kiểm tra quyền...</div>);
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
          <a href="/admin">Trang chủ</a>
          <a className="active">Người dùng</a>
        </nav>
        <div className="admin-sidebar-footer">{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Chưa kết nối'}</div>
      </div>
      <div className="admin-content container-fluid py-4">
        <div className="admin-card p-3">
          <div className="admin-breadcrumb text-muted mb-2">Trang chủ / <span className="text-light">Quản lý người dùng</span></div>
          <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
            <h3 className="text-light m-0">Quản lý người dùng</h3>
            <div className="text-muted">Tổng: <b>{users.total}</b> user • Trang <b>{page}</b>/{Math.max(1, Math.ceil((users.total || 0) / limit))}</div>
          </div>
          <div className="admin-toolbar d-flex flex-wrap gap-2 mb-2">
            <input className="form-control" placeholder="Tìm theo email, họ tên, địa chỉ" value={userQ} onChange={(e) => setUserQ(e.target.value)} style={{ minWidth: 320, maxWidth: 560 }} />
            <select className="form-select" style={{ width: 160 }} value={sort} onChange={(e) => { const s = e.target.value; setSort(s); setPage(1); loadUsers(userQ, 1, limit, s); }}>
              <option value="newest">Mới tạo nhất</option>
              <option value="oldest">Cũ nhất</option>
            </select>
            <select className="form-select" style={{ width: 120 }} value={limit} onChange={(e) => { const l = Number(e.target.value); setLimit(l); setPage(1); loadUsers(userQ, 1, l, sort); }}>
              <option value={5}>5/trang</option>
              <option value={10}>10/trang</option>
              <option value={20}>20/trang</option>
            </select>
            <button className="btn btn-primary" onClick={() => { setPage(1); loadUsers(userQ, 1, limit, sort); }}>Tìm</button>
          </div>
          <div className="table-responsive">
            <table className="table table-dark table-sm align-middle">
              <thead><tr><th>#</th><th>Avatar</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Địa chỉ</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center text-muted">Đang tải...</td></tr>
                ) : users.items?.length ? users.items.map((u, idx) => (
                  <tr key={u.address}>
                    <td>{(page - 1) * limit + idx + 1}</td>
                    <td><div className="avatar-circle">{(u.username || 'U').slice(0, 1).toUpperCase()}</div></td>
                    <td>{u.username || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td><RoleBadgeToggle address={u.address} initial={roleMap.get(u.address.toLowerCase())?.admin} locked={roleMap.get(u.address.toLowerCase())?.lock} lockedReason={roleMap.get(u.address.toLowerCase())?.reason} onChanged={(v) => { const m = new Map(roleMap); const cur = m.get(u.address.toLowerCase()) || { admin: false, lock: false }; m.set(u.address.toLowerCase(), { ...cur, admin: v }); setRoleMap(m); }} /></td>
                    <td className="text-break small">{u.address}</td>
                    <td className="text-muted small">{u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}</td>
                    <td>
                      <button className="btn btn-sm btn-danger-soft" onClick={() => setConfirmAddr(u.address)}>Xóa</button>
                    </td>
                  </tr>
                )) : <tr><td colSpan={8} className="text-center text-muted">Không có dữ liệu</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="d-flex justify-content-end gap-2">
            <button className="btn btn-sm btn-outline-light" disabled={page <= 1} onClick={() => { const p = Math.max(1, page - 1); setPage(p); loadUsers(userQ, p, limit, sort); }}>Trước</button>
            <div className="pagination-pill">{page}</div>
            <button className="btn btn-sm btn-outline-light" disabled={(page * limit) >= (users.total || 0)} onClick={() => { const p = page + 1; setPage(p); loadUsers(userQ, p, limit, sort); }}>Sau</button>
          </div>
        </div>

        {/* Bộ phận quản lý quyền theo yêu cầu */}
      </div>
      {confirmAddr && (
        <div className="modal d-block bg-dark bg-opacity-50" style={{ zIndex: 1200 }} onClick={() => setConfirmAddr(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Xóa người dùng</h5><button className="btn-close" onClick={() => setConfirmAddr(null)}></button></div>
              <div className="modal-body">
                Bạn chắc muốn xóa user có địa chỉ:<br /><code className="small">{confirmAddr}</code> khỏi cơ sở dữ liệu?
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setConfirmAddr(null)}>Hủy</button>
                <button className="btn btn-danger" onClick={async () => { try { const adminSecret = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_SECRET) || (typeof process !== 'undefined' && process.env?.VITE_ADMIN_SECRET) || ''; const res = await fetch(`${apiBase}/users/${confirmAddr}`, { method: 'DELETE', headers: adminSecret ? { 'X-Admin-Secret': adminSecret } : undefined }); if (!res.ok) throw new Error('Delete failed'); toast.success('Đã xóa'); setConfirmAddr(null); await loadUsers(debouncedQ, page, limit, sort); } catch (e) { toast.error(e.message || 'Delete failed'); } }}>Xóa</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleBadgeRO({ address }) {
  const contractAddress = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONTRACT_ADDRESS) || (typeof process !== 'undefined' && process.env?.REACT_APP_CONTRACT_ADDRESS) || '').trim();
  const MINTER_ROLE = keccak256(toUtf8Bytes('MINTER_ROLE'));
  const [isAdmin, setIsAdmin] = useState(null);
  const envAdmins = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_ADDRESSES) || (typeof process !== 'undefined' && process.env?.VITE_ADMIN_ADDRESSES) || '';

  useEffect(() => {
    (async () => {
      try {
        const envOk = envAdmins.split(',').map(s => s.trim().toLowerCase()).includes(String(address).toLowerCase());
        if (!contractAddress) { setIsAdmin(envOk); return; }
        if (!window?.ethereum) { setIsAdmin(envOk); return; }
        const provider = new BrowserProvider(window.ethereum);
        const abi = [{ inputs: [{ internalType: 'bytes32', name: 'role', type: 'bytes32' }, { internalType: 'address', name: 'account', type: 'address' }], name: 'hasRole', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' }];
        const c = new Contract(contractAddress, abi, provider);
        let ok = false; try { ok = await c.hasRole?.(MINTER_ROLE, address); } catch {}
        setIsAdmin(Boolean(ok || envOk));
      } catch { setIsAdmin(null); }
    })();
  }, [address, contractAddress, MINTER_ROLE, envAdmins]);

  if (isAdmin === null) return <span className="badge-role user">—</span>;
  return isAdmin ? <span className="badge-role admin">admin</span> : <span className="badge-role user">user</span>;
}

function RoleBadgeToggle({ address, initial, locked = false, lockedReason = '', onChanged }) {
  const contractAddress = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONTRACT_ADDRESS) || (typeof process !== 'undefined' && process.env?.REACT_APP_CONTRACT_ADDRESS) || '').trim();
  const MINTER_ROLE = keccak256(toUtf8Bytes('MINTER_ROLE'));
  const envAdmins = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_ADDRESSES) || (typeof process !== 'undefined' && process.env?.VITE_ADMIN_ADDRESSES) || '';

  const [isAdmin, setIsAdmin] = useState(initial ?? null);
  const [busy, setBusy] = useState(false);
  const envLock = useMemo(() => envAdmins.split(',').map(s => s.trim().toLowerCase()).includes(String(address).toLowerCase()), [envAdmins, address]);

  useEffect(() => {
    if (initial !== undefined && initial !== null) { setIsAdmin(initial); return; }
    (async () => {
      try {
        if (!contractAddress) { setIsAdmin(envLock); return; }
        if (!window?.ethereum) { setIsAdmin(envLock); return; }
        const provider = new BrowserProvider(window.ethereum);
        const abi = [{ inputs: [{ internalType: 'bytes32', name: 'role', type: 'bytes32' }, { internalType: 'address', name: 'account', type: 'address' }], name: 'hasRole', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' }];
        const c = new Contract(contractAddress, abi, provider);
        let ok = false; try { ok = await c.hasRole?.(MINTER_ROLE, address); } catch {}
        setIsAdmin(Boolean(ok || envLock));
      } catch { setIsAdmin(null); }
    })();
  }, [address, contractAddress, MINTER_ROLE, envLock, initial]);

  const toAdmin = async () => {
    if (busy || envLock) return;
    try {
      setBusy(true);
      if (!window?.ethereum) { return; }
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const c = new Contract(contractAddress, [{ inputs: [{ internalType: 'bytes32', name: 'role', type: 'bytes32' }, { internalType: 'address', name: 'account', type: 'address' }], name: 'grantRole', outputs: [], stateMutability: 'nonpayable', type: 'function' }], signer);
      const loading = toast.loading('Đang cấp quyền...');
      const tx = await c.grantRole(MINTER_ROLE, address);
      await tx.wait();
      toast.update(loading, { render: 'Đã cấp quyền!', type: 'success', isLoading: false, autoClose: 1800 });
      setIsAdmin(true);
      onChanged?.(true);
    } catch (e) { toast.error(e?.message || 'Grant failed'); } finally { setBusy(false); }
  };

  const toUser = async () => {
    if (busy || envLock) return;
    try {
      setBusy(true);
      if (!window?.ethereum) { return; }
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const c = new Contract(contractAddress, [{ inputs: [{ internalType: 'bytes32', name: 'role', type: 'bytes32' }, { internalType: 'address', name: 'account', type: 'address' }], name: 'revokeRole', outputs: [], stateMutability: 'nonpayable', type: 'function' }], signer);
      const loading = toast.loading('Đang thu hồi...');
      const tx = await c.revokeRole(MINTER_ROLE, address);
      await tx.wait();
      toast.update(loading, { render: 'Đã thu hồi!', type: 'success', isLoading: false, autoClose: 1800 });
      setIsAdmin(false);
      onChanged?.(false);
    } catch (e) { toast.error(e?.message || 'Revoke failed'); } finally { setBusy(false); }
  };

  if (!contractAddress) return <RoleBadgeRO address={address} />;
  if (isAdmin === null) return <span className="badge-role user">—</span>;
  const onChange = async (e) => {
    const v = e.target.value;
    if (v === 'admin' && !isAdmin) await toAdmin();
    if (v === 'user' && isAdmin) await toUser();
  };
  const titleText = (lockedReason || (envLock ? 'Admin cố định (env)' : '')) || undefined;
  return (
    <select className={`role-select ${isAdmin ? 'admin' : 'user'}`} disabled={busy || envLock || locked} value={isAdmin ? 'admin' : 'user'} onChange={onChange} title={titleText}>
      <option value="user">user</option>
      <option value="admin">admin</option>
    </select>
  );
}
