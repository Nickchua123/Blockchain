import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

export default function AccountMenu() {
  const { isConnected, address, connect, disconnect, profile, setNeedsProfile, nativeBalance, nativeSymbol, refreshNative } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const email = profile?.email || (typeof localStorage !== 'undefined' && localStorage.getItem('userEmail')) || '';

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  if (!isConnected) return <button className="btn btn-primary" onClick={connect}>Kết nối ví</button>;
  const short = `${address.slice(0,6)}...${address.slice(-4)}`;

  return (
    <div className="account-wrapper" ref={ref}>
      <button className="account-chip" onClick={() => setOpen(v => !v)}>
        <span className="account-avatar" aria-hidden>🧑</span>
        <span className="account-text">{short}</span>
        <span className="account-caret">▾</span>
      </button>
      {open && (
        <div className="account-card">
          <div className="account-card-header">
            <span className="account-avatar big" aria-hidden>🧑</span>
            <div className="account-id">{profile?.username || short}</div>
            {email ? (
              <div className="account-email">
                <span className="email-text">{email}</span>
                <span className="wavy" aria-hidden></span>
              </div>
            ) : null}
          </div>
          <div className="account-card-actions flex-column">
            {nativeBalance !== null && (
              <div className="balance-pill">
                <span>Số dư:</span>
                <strong>{Number(nativeBalance).toFixed(4)} {nativeSymbol}</strong>
                <button className="refresh-icon" onClick={() => { refreshNative(); }} aria-label="Làm mới" title="Làm mới">↻</button>
              </div>
            )}
            <div className="menu-actions">
              <button className="logout-btn" onClick={() => { setOpen(false); disconnect(); }}>Đăng xuất</button>
            </div>
          </div>
          <div className="account-card-sep" />
          <div className="account-card-links">
            <button className="link-btn" onClick={() => { setOpen(false); navigate('/my'); }}>Chứng chỉ của tôi</button>
            <button className="link-btn" onClick={() => { setOpen(false); setNeedsProfile(true); }}>Sửa thông tin</button>
          </div>
        </div>
      )}
    </div>
  );
}

