import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, isAddress, keccak256, toUtf8Bytes, sha256 } from "ethers";
import contractABI from "../assets/CertificateNFT.json";
import { toast } from "react-toastify";
import { useWallet } from "../context/WalletContext";

// === ENV ===
const contractAddress =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CONTRACT_ADDRESS) ||
  (typeof process !== "undefined" && process.env?.REACT_APP_CONTRACT_ADDRESS) ||
  "";

const adminAddressesEnv =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ADMIN_ADDRESSES) ||
  (typeof process !== "undefined" && process.env?.VITE_ADMIN_ADDRESSES) ||
  "";

// (Types removed for .jsx)

// Optional ENV admin allowlist for UI gating (on-chain role still authoritative)
const adminList = (typeof adminAddressesEnv === 'string'
  ? adminAddressesEnv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : []);

// === EXPLORER ===
function getExplorerBaseByChain(chainId) {
  const id = Number(chainId);
  const map = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    137: "https://polygonscan.com",
    80002: "https://amoy.polygonscan.com",
    56: "https://bscscan.com",
    97: "https://testnet.bscscan.com",
    42161: "https://arbiscan.io",
    421614: "https://sepolia.arbiscan.io",
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org",
  };
  return map[id] || "https://etherscan.io";
}

// === IPFS HELPERS ===
function resolveIpfs(uri) {
  if (!uri) return "";
  return uri.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`
    : uri;
}

async function fetchJsonWithFallbacks(uri) {
  const apiBase = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) || "/api";

  // Backend proxy
  try {
    const res = await fetch(`${apiBase}/ipfs/fetch?uri=${encodeURIComponent(uri)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("json")) return (await res.json());
      const text = await res.text();
      return JSON.parse(text);
    }
  } catch {}

  // Public gateways
  const http = resolveIpfs(uri);
  const gateways = [
    http?.replace("https://ipfs.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"),
    http,
    http?.replace("https://ipfs.io/ipfs/", "https://cloudflare-ipfs.com/ipfs/"),
    http?.replace("https://ipfs.io/ipfs/", "https://nftstorage.link/ipfs/"),
  ].filter(Boolean);

  const candidates = gateways.flatMap((url) => [
    url,
    `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`,
  ]);

  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        mode: "cors",
        headers: {
          "Cache-Control": "no-cache",
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        },
      });
      if (!res.ok) continue;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("json")) return (await res.json());
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Không thể tải metadata");
}

function canonicalizeTokenUri(input) {
  if (!input) return "";
  const v = input.trim();
  if (v.startsWith("ipfs://")) return v;
  try {
    const url = new URL(v);
    const parts = url.pathname.split("/").filter(Boolean);
    const ipfsIdx = parts.indexOf("ipfs");
    if (ipfsIdx !== -1 && parts[ipfsIdx + 1]) {
      return `ipfs://${parts.slice(ipfsIdx + 1).join("/")}`;
    }
  } catch {}
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[1-9A-HJ-NP-Za-km-z]{20,})$/.test(v)) {
    return `ipfs://${v}`;
  }
  return v;
}

// === COMPONENT ===
export default function MintPage() {
  const { address: walletAddress, connect, isConnected } = useWallet();
  const hasValidContract = useMemo(() => contractAddress && isAddress(contractAddress), []);

  // === FORM STATE ===
  const [recipient, setRecipient] = useState("");
  const [tokenURI, setTokenURI] = useState("");
  const [jsonFile, setJsonFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [metaName, setMetaName] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [metaCourse, setMetaCourse] = useState("");
  const [metaScore, setMetaScore] = useState("");
  const [metaDate, setMetaDate] = useState("");
  const [uploader, setUploader] = useState("nftstorage");

  // === UI STATE ===
  const [uploading, setUploading] = useState(false);
  const [minting, setMinting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [txHash, setTxHash] = useState("");
  const [explorerBase, setExplorerBase] = useState("https://etherscan.io");

  const MAX_NAME = 150;
  const MAX_DESC = 1500;
  const MAX_FILE_SIZE = 25 * 1024 * 1024;

  // (removed adminList dead code; using local owner check only)

  // === CHECK ADMIN RIGHTS ===
  useEffect(() => {
    (async () => {
      if (!window.ethereum || !walletAddress || !contractAddress) {
        setIsAdmin(false);
        setAdminChecked(true);
        return;
      }

      try {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const contract = new Contract(contractAddress, contractABI, signer);

        let isOwner = false;
        try {
          const owner = await contract.owner?.();
          if (owner) isOwner = owner.toString().toLowerCase() === walletAddress.toLowerCase();
        } catch {}
        let roleOk = false;
        try {
          const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
          roleOk = await contract.hasRole?.(MINTER_ROLE, walletAddress).catch(() => false);
        } catch {}
        let minterOk = false;
        try {
          minterOk = await contract.isMinter?.(walletAddress).catch(() => false);
        } catch {}
        const isEnvAdmin = adminList.includes(walletAddress.toLowerCase());
        setIsAdmin(Boolean(isOwner || roleOk || minterOk || isEnvAdmin));
        setAdminChecked(true);

        try {
          const network = await provider.getNetwork();
          setExplorerBase(getExplorerBaseByChain(network.chainId));
        } catch {}
      } catch {
        setIsAdmin(false);
        setAdminChecked(true);
      }
    })();
  }, [walletAddress]);

  // === VALIDATE JSON ===
  const validateJsonFile = async (file) => {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json.name) throw new Error("Metadata JSON phải có trường `name`");
    const hasIpfsImage = !!json.image?.startsWith?.("ipfs://");
    return { hasIpfsImage };
  };

  // === UPLOAD METADATA ===
  const uploadMetadataJson = async () => {
    if (!jsonFile && !metaName) {
      toast.error("Vui lòng nhập tiêu đề chứng chỉ");
      return;
    }
    if (!jsonFile && !imageFile) {
      toast.error("Vui lòng chọn chứng chỉ (ảnh/PDF)");
      return;
    }
    if (imageFile && imageFile.size > MAX_FILE_SIZE) {
      toast.error("File quá lớn, tối đa 25MB");
      return;
    }

    setProgress(20);
    let hasIpfsImage = false;
    if (jsonFile) {
      try {
        const result = await validateJsonFile(jsonFile);
        hasIpfsImage = result.hasIpfsImage;
      } catch (e) {
        toast.error((e && e.message) || "JSON không hợp lệ");
        setProgress(0);
        return;
      }
    }
    if (jsonFile && !hasIpfsImage && !imageFile) {
      toast.error("Metadata JSON thiếu `image` dạng `ipfs://` và chưa chọn ảnh");
      setProgress(0);
      return;
    }

    try {
      const apiBase = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) || "/api";
      const form = new FormData();

      if (jsonFile) {
        form.append("metadata", jsonFile);
      } else {
        const attributes = [];
        if (metaCourse) attributes.push({ trait_type: "Course", value: metaCourse });
        if (metaScore) attributes.push({ trait_type: "Score", value: metaScore });
        if (metaDate) attributes.push({ trait_type: "Issued", value: metaDate });

        const generated = {
          name: metaName,
          description: metaDescription,
          image: imageFile ? "image" : "",
          ...(attributes.length ? { attributes } : {}),
        };
        const filename = `${metaName.replace(/[^a-z0-9-_. ]/gi, "_")}.json`;
        form.append("metadata", new Blob([JSON.stringify(generated)], { type: "application/json" }), filename);
      }

      if (imageFile) form.append("image", imageFile);
      form.append("provider", uploader);

      setUploading(true);
      const loadingId = toast.loading("Đang tải lên IPFS...");

      const resp = await fetch(`${apiBase}/ipfs/upload`, { method: "POST", body: form });
      if (!resp.ok) {
        let msg = `${resp.status}`;
        try {
          const t = await resp.text();
          try {
            const j = JSON.parse(t);
            msg = j?.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error)) : j?.message || t || msg;
          } catch {
            msg = t || msg;
          }
        } catch {}
        throw new Error(`Upload lỗi: ${msg}`);
      }

      const data = await resp.json();
      if (!data?.uri) throw new Error("Missing URI");

      setTokenURI(data.uri);
      setProgress(60);
      toast.update(loadingId, {
        render: `Tải lên thành công! (${data.provider})`,
        type: "success",
        isLoading: false,
        autoClose: 2000,
      });
    } catch (e) {
      toast.error((e && e.message) || "Tải lên thất bại");
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  // === MINT NFT ===
  const mintNFT = async () => {
    if (!hasValidContract) {
      toast.error("Chưa cấu hình địa chỉ contract");
      return;
    }
    if (!isAdmin) {
      toast.error("Chỉ owner mới được mint");
      return;
    }
    if (!isAddress(recipient) || recipient === "0x0000000000000000000000000000000000000000") {
      toast.error("Địa chỉ người nhận không hợp lệ");
      return;
    }
    if (!tokenURI) {
      toast.error("Chưa có Token URI");
      return;
    }

    try {
      if (window.ethereum) {
        const provider = new BrowserProvider(window.ethereum);
        const code = await provider.getCode(recipient);
        if (code && code !== '0x') {
          toast.error('Địa chỉ người nhận là contract không nhận ERC721 (có thể revert). Hãy dùng địa chỉ ví (EOA).');
          return;
        }
      }
    } catch {}
    if (!window.confirm(`Xác nhận mint NFT cho\n${recipient.slice(0, 6)}...${recipient.slice(-4)}?`)) return;

    setProgress(70);
    const canonical = canonicalizeTokenUri(tokenURI);
    if (canonical !== tokenURI) setTokenURI(canonical);
    setMinting(true);

    let course = "", score = "", issued = "";
    try {
      const meta = await fetchJsonWithFallbacks(canonical);
      const find = (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        return (
          meta.attributes?.find((a) =>
            arr.some((k) => String(a.trait_type || "").trim().toLowerCase() === String(k).trim().toLowerCase())
          )?.value || ""
        );
      };
      course = find(["course", "khóa học", "khoá"]);
      score = find(["score", "điểm", "điểm số"]);
      issued = find(["issued", "ngày cấp", "date", "ngày"]);
      if (!jsonFile) {
        course = course || metaCourse;
        score = score || metaScore;
        issued = issued || metaDate;
      }
    } catch (e) {
      toast.warn(`Không đọc metadata để lưu DB: ${(e && e.message)}`);
    }

    try {
      if (!window.ethereum) throw new Error("Cần MetaMask");

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractAddress, contractABI, signer);
      const loadingId = toast.loading("Vui lòng xác nhận trong MetaMask...");

      const tx = await contract.mintCertificate(recipient, canonical);

      setTxHash(tx.hash);
      toast.update(loadingId, { render: "Đang chờ xác nhận...", isLoading: true });
      const receipt = await tx.wait();
      setProgress(100);

      // Extract tokenId
      let mintedTokenId = null;
      try {
        for (const log of receipt.logs || []) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed?.name === "Transfer") {
              const to = String(parsed.args?.[1] || parsed.args?.to || "").toLowerCase();
              const id = parsed.args?.[2] ?? parsed.args?.tokenId;
              if (to === recipient.toLowerCase()) {
                mintedTokenId = id.toString();
                break;
              }
            }
          } catch {}
        }
      } catch {}

      if (mintedTokenId) {
        // Compute expected content hash like BE verify: sha256(name|score|issued)
        try {
          const nameForHash = (metaName || "").trim();
          const toHash = `${nameForHash}|${String(score||"")}|${String(issued||"")}`;
          const expectedHash = sha256(toUtf8Bytes(toHash));
          try { await contract.setCertificateHash?.(mintedTokenId, expectedHash); } catch {}
        } catch {}
        const apiBase = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) || "/api";
        const payload = {
          tokenId: mintedTokenId,
          recipient,
          tokenURI: canonical,
          course,
          score,
          issuedDate: issued,
        };
        try {
          await fetch(`${apiBase}/certificates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch {}
      }

      toast.update(loadingId, {
        render: "Đã mint thành công!",
        type: "success",
        isLoading: false,
        autoClose: 3000,
      });
      resetForm();
    } catch (error) {
      console.error("Mint error:", error);
      const reason = error?.reason || error?.message || "Lỗi không xác định";
      let msg = "Giao dịch thất bại";
      if (error?.code === 4001) msg = "Bạn đã từ chối giao dịch";
      else if (reason.includes("insufficient funds")) msg = "Không đủ tiền gas";
      else if (reason.includes("only owner")) msg = "Bạn không phải owner của contract";
      else msg = `Lỗi: ${reason}`;
      toast.error(msg);
      setProgress(60);
    } finally {
      setMinting(false);
    }
  };

  // === RESET FORM ===
  const resetForm = () => {
    setRecipient("");
    setTokenURI("");
    setJsonFile(null);
    setImageFile(null);
    setMetaName("");
    setMetaDescription("");
    setMetaCourse("");
    setMetaScore("");
    setMetaDate("");
    setProgress(0);
    setTxHash("");
  };

  // === PREVIEW ===
  const renderPreview = () => {
    if (!imageFile) return null;
    if (imageFile.type === "application/pdf") {
      return <embed src={URL.createObjectURL(imageFile)} width="100%" height="300" type="application/pdf" />;
    }
    return <img src={URL.createObjectURL(imageFile)} className="img-fluid rounded" alt="Preview" />;
  };

  // === RENDER ===
  return (
    <div className="container py-5 bg-light">
      <div className="mint-hero">
        <h2 className="mint-title m-0">Hãy tạo chứng chỉ của bạn.</h2>
      </div>

      {!adminChecked ? (
        <p className="text-center">Đang kiểm tra quyền owner...</p>
      ) : !isAdmin ? (
        <div className="alert alert-warning">
          Chỉ owner mới được mint!
          {!isConnected && (
            <button className="btn btn-primary ms-3" onClick={connect}>
              Kết nối ví
            </button>
          )}
        </div>
      ) : null}

      <div className="row g-4 mb-4">
        <div className="col-12 col-lg-4">
          <div className="card mint-card">
            <div className="card-body">
              <div className="mint-upload-drop mb-3">
                <p className="mb-2">Kéo thả hoặc tải tệp chứng chỉ của bạn.</p>
                <small className="text-muted">PNG, JPEG, GIF, WEBP, PDF • Tối đa 25MB</small>
              </div>
              <div className="d-grid">
                <label className="btn-poap">
                  Thêm chứng chỉ
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    hidden
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {(imageFile || tokenURI) && (
                <div className="text-center mt-3">
                  {renderPreview()}
                  <div className="mt-2 text-muted small">{metaName || "Certificate"}</div>
                </div>
              )}
              <hr />
              <div className="mb-2">Nâng cao: tải metadata JSON</div>
              <input
                type="file"
                accept=".json"
                className="form-control"
                onChange={(e) => setJsonFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-8">
          <div className="card mint-card">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label fw-semibold">
                    Tiêu đề chứng chỉ <span className="text-danger">*</span>
                  </label>
                  <input
                    className="form-control"
                    maxLength={MAX_NAME}
                    placeholder="Ví dụ: Flow"
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value.slice(0, MAX_NAME))}
                    disabled={!!jsonFile}
                  />
                  <div className="counter-right">{metaName.length}/{MAX_NAME}</div>
                </div>
                <div className="col-12">
                  <label className="form-label fw-semibold">
                    Mô tả <span className="text-danger">*</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows={5}
                    maxLength={MAX_DESC}
                    placeholder="Mô tả ngắn gọn về chứng chỉ"
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value.slice(0, MAX_DESC))}
                    disabled={!!jsonFile}
                  />
                  <div className="counter-right">{metaDescription.length}/{MAX_DESC}</div>
                </div>
                <div className="col-md-6">
                  <input
                    className="form-control"
                    placeholder="Khóa học"
                    value={metaCourse}
                    onChange={(e) => setMetaCourse(e.target.value)}
                    disabled={!!jsonFile}
                  />
                </div>
                <div className="col-md-6">
                  <input
                    className="form-control"
                    placeholder="Điểm số"
                    value={metaScore}
                    onChange={(e) => setMetaScore(e.target.value)}
                    disabled={!!jsonFile}
                  />
                </div>
                <div className="col-md-6">
                  <input
                    className="form-control"
                    type="date"
                    value={metaDate}
                    onChange={(e) => setMetaDate(e.target.value)}
                    disabled={!!jsonFile}
                  />
                </div>
              </div>

              <div className="d-flex align-items-center justify-content-between mt-3">
                <div className="pill-toggle">
                  <button
                    type="button"
                    className={`pill-option ${uploader === "nftstorage" ? "active" : ""}`}
                    onClick={() => setUploader("nftstorage")}
                  >
                    NFT.Storage
                  </button>
                  <button
                    type="button"
                    className={`pill-option ${uploader === "pinata" ? "active" : ""}`}
                    onClick={() => setUploader("pinata")}
                  >
                    Pinata
                  </button>
                </div>
                <button
                  className="btn-poap"
                  disabled={uploading || !adminChecked || !isAdmin}
                  onClick={uploadMetadataJson}
                >
                  {uploading ? "Đang tải..." : "Tạo metadata & Tải lên"}
                </button>
              </div>

              {tokenURI && (
                <div className="alert alert-info small mt-3">
                  Metadata: <a href={resolveIpfs(tokenURI)} target="_blank" rel="noreferrer">{tokenURI}</a>
                </div>
              )}

              <div className="mt-4">
                <label className="form-label fw-semibold">Người nhận</label>
                <div className="input-group mb-3">
                  <input
                    className="form-control"
                    placeholder="0x... địa chỉ người nhận"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  />
                  <button className="btn btn-outline-secondary" onClick={() => setRecipient(walletAddress || "")}>
                    Tự điền
                  </button>
                </div>

                {tokenURI && isAdmin && (
                  <button
                    className="btn btn-success w-100 mb-3"
                    onClick={mintNFT}
                    disabled={uploading || minting}
                  >
                    Tạo & Mint cho {recipient.slice(0, 6)}... ({metaName || "Chứng chỉ"})
                  </button>
                )}

                {progress > 0 && (
                  <div className="progress mb-3" style={{ height: 26 }}>
                    <div
                      className="progress-bar progress-bar-striped progress-bar-animated"
                      style={{ width: `${progress}%` }}
                    >
                      {progress === 100 ? "Hoàn tất!" : `${progress}%`}
                    </div>
                  </div>
                )}

                {txHash && (
                  <p className="text-center">
                    <a href={`${explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer">
                      Xem giao dịch
                    </a>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}







