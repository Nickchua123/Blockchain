import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';

export default function ProfileSetupModal() {
  const { isConnected, address, needsProfile, setNeedsProfile, saveProfile } = useWallet();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!needsProfile) { setUsername(''); setEmail(''); }
  }, [needsProfile]);

  if (!isConnected || !needsProfile) return null;

  const onSave = async () => {
    if (!username.trim()) return alert('Vui lòng nhập tên hiển thị');
    await saveProfile(username, email);
  };

  return (
    <div className="modal d-block bg-dark bg-opacity-50" style={{ zIndex: 2000 }} onClick={() => setNeedsProfile(false)}>
      <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Thông tin tài khoản</h5>
            <button className="btn-close" onClick={() => setNeedsProfile(false)}></button>
          </div>
          <div className="modal-body">
            <div className="text-center mb-3">
              <div className="account-avatar big" aria-hidden>👤</div>
              <div className="text-muted mt-2" style={{fontSize:12}}>{address?.slice(0,6)}...{address?.slice(-4)}</div>
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">Tên hiển thị (username)</label>
              <input className="form-control" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Ví dụ: Nguyen Van A" />
            </div>
            <div className="mb-2">
              <label className="form-label">Email (tùy chọn)</label>
              <input type="email" className="form-control" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-poap" onClick={onSave}>Lưu</button>
          </div>
        </div>
      </div>
    </div>
  );
}

