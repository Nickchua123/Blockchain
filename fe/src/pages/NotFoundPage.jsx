import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="container py-5">
      <div className="nf-hero text-center">
        <h1 className="nf-title">404</h1>
        <h2 className="nf-sub">KHÔNG TÌM THẤY TRANG</h2>
        <p className="nf-desc">Trang bạn tìm có thể đã bị xoá, URL thay đổi hoặc tạm thời không khả dụng.</p>
        <Link to="/" className="btn-poap nf-home-btn">Về trang chủ</Link>
      </div>
    </div>
  );
}

