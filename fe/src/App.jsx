import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import MintPage from "./pages/MintPage";
import GalleryPage from "./pages/GalleryPage";
import AdminPage from "./pages/AdminPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import NotFoundPage from "./pages/NotFoundPage";
import { WalletProvider } from "./context/WalletContext";
import { ToastContainer } from 'react-toastify';
import ProfileSetupModal from './components/ProfileSetupModal';
import "./App.css";

function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/mint" element={<MintPage />} />
          <Route path="/my" element={<GalleryPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <ToastContainer position="top-right" autoClose={3000} newestOnTop closeOnClick pauseOnHover theme="colored" />
        <ProfileSetupModal />
      </BrowserRouter>
    </WalletProvider>
  );
}

export default App;
