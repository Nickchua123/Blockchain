import { useWallet } from "../context/WalletContext";

function HomePage() {
  const { address: walletAddress, connect } = useWallet();

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Vui lòng cài đặt MetaMask!");
      return;
    }
    try {
      await connect();
    } catch (e) {
      alert(e.message || "Không thể kết nối MetaMask");
    }
  };

  return (
    <div className="container py-5">
      <div className="home-hero">
        <h1 className="home-title display-5">Chứng chỉ học tập NFT</h1>
        <p className="home-subtitle">Phát hành, xác thực và sưu tập chứng chỉ trên blockchain. Kết nối ví để bắt đầu tạo hoặc khám phá bộ sưu tập của bạn.</p>
        <div className="home-actions">
          <button className="btn-poap btn-lg-poap" onClick={connectWallet}>
            {walletAddress ? `Đã kết nối: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Kết nối MetaMask"}
          </button>
        </div>
      </div>

      <div className="mt-5">
        <div className="row g-4">
          <div className="col-12 col-md-4">
            <div className="feature-card p-4">
              <div className="feature-icon mb-3">🧾</div>
              <h5 className="mb-2">Tạo chứng chỉ</h5>
              <p className="text-muted mb-0">Tải hình/PDF, nhập tiêu đề, mô tả và thuộc tính khóa học.</p>
            </div>
          </div>
          <div className="col-12 col-md-4">
            <div className="feature-card p-4">
              <div className="feature-icon mb-3">⚡</div>
              <h5 className="mb-2">Mint nhanh</h5>
              <p className="text-muted mb-0">Upload tới IPFS (NFT.Storage/Pinata) và mint một chạm.</p>
            </div>
          </div>
          <div className="col-12 col-md-4">
            <div className="feature-card p-4">
              <div className="feature-icon mb-3">🗂️</div>
              <h5 className="mb-2">Bộ sưu tập & tải xuống</h5>
              <p className="text-muted mb-0">Xem bộ sưu tập theo ví, tìm theo ID và tải về chứng chỉ.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;

