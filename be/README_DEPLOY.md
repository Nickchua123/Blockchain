# Triển khai Backend + Frontend chung (Node/Express)

## Biến môi trường (be/.env)

PORT=3001
CORS_ORIGIN=*                  # hoặc domain FE, ví dụ: https://your-frontend.com
MONGODB_URI=
RPC_URL=
CONTRACT_ADDRESS=
PINATA_JWT=                    # nếu dùng Pinata
NFT_STORAGE_TOKEN=             # nếu dùng NFT.Storage

## Quy trình build & chạy (1 service)

1) Build FE
   cd fe && npm ci && npm run build
2) Chạy BE
   cd ../be && npm ci && npm run start

BE sẽ tự serve thư mục fe/dist ở mọi route không bắt đầu bằng /api.

## Render/Railway (khuyến nghị)
- Start command: npm run start
- Root directory: be
- Env: điền các biến như trên
- Nếu build FE trước khi start, thêm build command:
  (tùy nền tảng) "cd ../fe && npm ci && npm run build"

## Triển khai tách rời
- FE: deploy fe/dist lên Vercel/Netlify/S3. Cấu hình VITE_API_BASE trỏ về API BE (https://api.your-domain.com).
- BE: deploy lên Render/Railway. CORS_ORIGIN đặt domain FE để bật CORS đúng.

