import { Link, NavLink } from "react-router-dom";
import AccountMenu from "./AccountMenu";
import { useWallet } from "../context/WalletContext";

function Navbar() {
  const { isAdmin } = useWallet();
  return (
    <nav className="navbar navbar-expand-lg navbar-light bg-light poap-nav">
      <div className="container">
        <Link className="navbar-brand poap-brand" to="/">
          <span className="poap-logo">POAP</span>
          <span className="brand-sep" />
          <span className="brand-title">Chứng chỉ</span>
        </Link>
        <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
          <ul className="navbar-nav ms-auto align-items-center gap-2">
            <li className="nav-item"><NavLink className={({isActive}) => `nav-link nav-link-poap ${isActive?'active':''}`} to="/">Trang chủ</NavLink></li>
            <li className="nav-item"><NavLink className={({isActive}) => `nav-link nav-link-poap ${isActive?'active':''}`} to="/mint">Cấp chứng chỉ</NavLink></li>
            <li className="nav-item"><NavLink className={({isActive}) => `nav-link nav-link-poap ${isActive?'active':''}`} to="/gallery">Bộ sưu tập</NavLink></li>
            {isAdmin && <li className="nav-item"><NavLink className={({isActive}) => `nav-link nav-link-poap ${isActive?'active':''}`} to="/admin">Admin</NavLink></li>}
            <li className="nav-item d-flex align-items-center ms-3"><AccountMenu /></li>
          </ul>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;

