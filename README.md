# EduTrack Backend

REST API dùng Express, TypeScript và MongoDB.

## Cấu hình local

1. Sao chép `.env.example` thành `.env`.
2. Điền các biến:
   - `MONGODB_URI`: chuỗi kết nối MongoDB.
   - `CLIENT_ORIGINS`: các origin frontend, phân tách bằng dấu phẩy.
   - `FRONTEND_URL`: URL frontend dùng cho OAuth redirect.
   - `JWT_ACCESS_SECRET`: chuỗi ngẫu nhiên dài dùng ký access token.
   - `EMAIL_USER`: tài khoản Gmail gửi OTP.
   - `EMAIL_APP_PASSWORD`: App Password của Gmail, không phải mật khẩu Gmail thường.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: thông tin OAuth Web Application.
   - `GOOGLE_CALLBACK_URL`: callback đã khai báo trong Google Cloud Console.
3. Chạy `npm run dev`.

## Tài khoản development

Khi `NODE_ENV=development`, server tạo hoặc cập nhật hai tài khoản:

- `user` / `User@123`
- `admin` / `Admin@123`

## Scripts

- `npm run dev`: chạy TypeScript watch mode.
- `npm run typecheck`: kiểm tra kiểu.
- `npm run build`: biên dịch vào `dist`.
- `npm start`: chạy bản production đã build.
